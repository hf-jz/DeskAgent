# stable-pretraining Integration Analysis for le-wm

## 1. Library Discovery

### stable-pretraining
- **PyPI name:** `stable-pretraining` (v0.1.0–0.1.6)
- **GitHub:** `rbalestr-lab/stable-pretraining` (MIT License)
- **Author:** Randall Balestriero, Hugues Van Assel, Lucas Maes
- **Size:** ~2 MB, 162 Python files, ~49K lines of code
- **Dependencies:** torch, torchvision, lightning, transformers, timm, hydra-core, omegaconf, wandb, datasets, submitit, loguru, rich, pandas, scikit-learn, minari, pyarrow, matplotlib, etc.

### stable-worldmodel (related, also imported by le-wm)
- **PyPI name:** `stable-worldmodel` (v0.0.2–0.0.6)
- Also authored by same group

### le-wm Project
- **GitHub:** `lucas-maes/le-wm` (MIT License)
- Lucas Maes is common author across all three projects

---

## 2. stable-pretraining Source Structure

```
stable_pretraining/
├── __init__.py          # Logging, exports Manager/Module/backbone/data/callbacks/losses
├── __about__.py         # Version, URL
├── cli.py / config.py / run.py / forward.py / static.py
├── manager.py           # spt.Manager — training orchestrator (578 lines)
├── module.py            # spt.Module — pl.LightningModule with manual optim (650 lines)
├── backbone/
│   ├── __init__.py      # Exports vit_hf, from_timm, from_torchvision, MLP, etc.
│   ├── utils.py         # ⭐ KEY FILE: vit_hf(), TeacherStudentWrapper, HiddenStateExtractor
│   ├── vit.py           # Custom ViT components (MaskedEncoder, MAEDecoder, etc.)
│   ├── patch_masking.py # IJEPAMasking
│   ├── probe.py / mlp.py / resnet9.py / convmixer.py / aggregator.py
│   └── mae.py / pos_embed.py
├── data/
│   ├── __init__.py      # Exports DataModule, HFDataset, random_split, transforms
│   ├── dataset_stats.py # ⭐ Key: ImageNet = {mean, std} dict
│   ├── transforms.py    # ⭐ Key: dict-aware transforms (Compose, ToImage, Resize, WrapTorchTransform)
│   ├── module.py        # DataModule — pl.LightningDataModule wrapper
│   ├── utils.py         # random_split, fold_views, apply_masks
│   ├── datasets.py / collate.py / sampler.py / masking.py
│   └── synthetic_data.py / download.py
├── callbacks/           # 17 modules (OnlineProbe, OnlineKNN, RankMe, etc.)
├── losses/              # NTXEntLoss, DINOLoss, reconstruction, joint_embedding
├── methods/             # ijepa, lejepa, mae, nepa
├── optim/               # LARS, lr_scheduler, utils
├── utils/               # distributed, error_handling, flops, lightning_patch, etc.
└── tests/               # unit + integration
```

---

## 3. le-wm Dependencies on stable-pretraining (Complete Map)

### File: `lewm/encoders/video.py`
| Line | Usage | Category |
|------|-------|----------|
| 8 | `import stable_pretraining as spt` | Module import |
| 73 | `spt.backbone.utils.vit_hf(scale, patch_size, image_size, pretrained, use_mask_token)` | ⚠️ **CRITICAL** — only way to create ViT backbone |

### File: `train.py`
| Line | Usage | Category |
|------|-------|----------|
| 19 | `import stable_pretraining as spt` | Module import |
| 177 | `spt.data.transforms.Compose(*transforms_list)` | Replaceable |
| 182 | `spt.data.random_split(...)` | Replaceable (≈torch.utils.data.random_split) |
| 247 | `spt.data.DataModule(train=train, val=val)` | Replaceable |
| 248 | `spt.Module(...)` | Replaceable |
| 285 | `spt.Manager(...)` | Replaceable |
| 342 | `spt.data.transforms.WrapTorchTransform(...)` | Replaceable |

### File: `eval.py`
| Line | Usage | Category |
|------|-------|----------|
| 10 | `import stable_pretraining as spt` | Module import |
| 22 | `spt.data.dataset_stats.ImageNet` | Replaceable (simple dict) |

### File: `utils.py`
| Line | Usage | Category |
|------|-------|----------|
| 4 | `from stable_pretraining import data as dt` | Module import |
| 8 | `dt.dataset_stats.ImageNet` | Replaceable |
| 9 | `dt.transforms.ToImage(...)` | Replaceable |
| 10 | `dt.transforms.Resize(...)` | Replaceable |
| 11 | `dt.transforms.Compose(to_image, resize)` | Replaceable |
| 25 | `dt.transforms.WrapTorchTransform(...)` | Replaceable |

### File: `lewm/data/preprocessor.py`
| Line | Usage | Category |
|------|-------|----------|
| 215 | Docstring only: `spt.data.transforms.Compose` | Not an actual import |

---

## 4. Detailed Analysis of `vit_hf()` Implementation

The function at `backbone/utils.py:59-158` is **~60 lines** and does the following:

1. Defines size_configs dict mapping "tiny"/"small"/"base"/"large"/"huge" to hidden_size, num_hidden_layers, num_attention_heads
2. Creates `transformers.ViTConfig` with those params + image_size + patch_size
3. If `pretrained=True`, loads from `google/vit-{size}-patch{patch_size}-{image_size}` via `ViTModel.from_pretrained()`
4. If `pretrained=False`, creates from scratch: `ViTModel(config, add_pooling_layer=False, use_mask_token=use_mask_token)`
5. Sets `model.config.interpolate_pos_encoding = True` for dynamic input sizes
6. Returns the `ViTModel`

**This is trivially replaceable** — the VideoEncoder's `__init__` and `_encode_frames` only access `self.vit.config.hidden_size` and `self.vit(x, interpolate_pos_encoding=True)`.

---

## 5. Integration Strategies

### Strategy A: Full Embedding (Vendor stable-pretraining as subpackage)
**Approach:** Copy `stable_pretraining/` into le-wm as `lewm/vendor/stable_pretraining/`

**Pros:**
- Zero external dependency — works offline/air-gapped
- All 162 files available if needed for future features
- Lucas Maes is co-author of both projects (clean IP)
- MIT license compatible
- spt.Module and spt.Manager are genuinely useful (handle multi-optimizer, callback ecosystem)

**Cons:**
- Adds ~2MB / 49K LOC to the repo
- Need to maintain fork if upstream changes
- `spt.data.transforms` uses `stable_pretraining.data.masking` internally (circular within vendored copy — fine)

**Vendoring steps:**
1. Create `lewm/vendor/` directory
2. Copy `stable_pretraining/` package
3. Add `from lewm.vendor.stable_pretraining import ... as spt` shim
4. Or better: insert `lewm/vendor` into `sys.path` with higher priority than site-packages
5. Update `pyproject.toml` to remove `stable-pretraining` dependency
6. Test: `python -c "from lewm.encoders.video import VideoEncoder"`

### Strategy B: Minimal Shimming (Replace only used APIs)
**Approach:** Replace each stable-pretraining usage with vanilla torch/torchvision/transformers equivalents

**Pros:**
- Minimal code added (~100 lines)
- No maintenance burden
- Cleaner dependency tree

**Cons:**
- spt.Module and spt.Manager are non-trivial (650+ lines with multi-optimizer, gradient accumulation, callback state management)
- Rewriting those loses tested, working infrastructure
- spt.data.transforms dict-awareness is useful for multimodal pipelines

**Replacement mapping:**

| stable-pretraining API | Replacement |
|---|---|
| `spt.backbone.utils.vit_hf()` | Inline: `transformers.ViTModel(ViTConfig(...))` (~20 lines) |
| `spt.data.dataset_stats.ImageNet` | Inline dict: `{'mean': [0.485,0.456,0.406], 'std': [0.229,0.224,0.225]}` |
| `spt.data.transforms.Compose` | `torchvision.transforms.v2.Compose` (le-wm's preprocessor already uses `v2`) |
| `spt.data.transforms.ToImage` | `torchvision.transforms.v2.ToImage()` + `v2.ToDtype()` |
| `spt.data.transforms.Resize` | `torchvision.transforms.v2.Resize` |
| `spt.data.transforms.WrapTorchTransform` | `torchvision.transforms.v2.Lambda` |
| `spt.data.random_split` | `torch.utils.data.random_split` |
| `spt.data.DataModule` | Simplified `pl.LightningDataModule` (~80 lines) |
| `spt.Module` | Simplified `pl.LightningModule` (~100 lines if single optimizer) |
| `spt.Manager` | Direct `pl.Trainer.fit()` call (~20 lines) |

### Strategy C: Try/Except with Fallback (Current approach, improved)
**Approach:** Keep stable-pretraining as optional dependency, add native fallback

The current `video.py` already does this partially (try/except on import) but raises at construction. A better approach:
- Wrap `vit_hf` in a try/except that falls back to a pure `transformers.ViTModel` implementation
- This preserves backward compatibility while eliminating the hard failure

---

## 6. Recommendation

### Recommended: Strategy A (Full Embedding)

**Rationale:**
1. **Lucas Maes** is a co-author of BOTH `stable-pretraining` and `le-wm` — no IP friction
2. The library is **MIT licensed** — fully compatible
3. At **2MB / 49K LOC**, it's a reasonable vendor footprint
4. `spt.Module` and `spt.Manager` handle complex optimization patterns that `le-wm` depends on (multi-optimizer, JEPA training loops) — rewriting these is error-prone
5. The `train.py` and `eval.py` scripts use `spt` extensively for data pipeline + training orchestration; full embedding keeps everything working
6. No network access needed at install time (important for production deployment)

### Implementation Plan

```
Phase 1 — Vendor the package:
  mkdir -p lewm/vendor/stable_pretraining
  cp -r stable_pretraining/* lewm/vendor/stable_pretraining/
  # Add __init__.py to lewm/vendor/
  # Remove 'stable-pretraining' from pyproject.toml dependencies

Phase 2 — Create import shim:
  cat > lewm/vendor/__init__.py <<EOF
  # Vendor packages for offline deployment
  EOF

Phase 3 — Ensure imports resolve:
  # Option A: Add to sys.path at lewm.__init__ time
  # Option B: Create wrapper module that re-exports vendored spt
  # Option C: Modify le-wm imports to use lewm.vendor.stable_pretraining
  
Phase 4 — Test:
  python -c "from lewm.encoders.video import VideoEncoder; print('OK')"
  python train.py ...
  python eval.py ...
```

---

## 7. Files to Create/Modify

| File | Action |
|------|--------|
| `~/LeWorldModel/le-wm/lewm/vendor/__init__.py` | **Create** — vendor package marker |
| `~/LeWorldModel/le-wm/lewm/vendor/stable_pretraining/` | **Create** — copy of entire stable-pretraining source |
| `~/LeWorldModel/le-wm/pyproject.toml` | **Modify** — remove `stable-pretraining` dependency |
| `~/LeWorldModel/le-wm/lewm/encoders/video.py` | **Modify** — optionally redirect import to vendored copy |
| `~/LeWorldModel/le-wm/lewm/__init__.py` | **Modify** — add vendored path to sys.path |

---

## 8. Alternative: If Full Embedding is Too Much

If 2MB / 162 files is excessive, a **middle-ground approach** is to extract only the ~6 source files that le-wm actually uses at runtime:

```
lewm/vendor/stable_pretraining/
├── __init__.py       # Minimal - only exports what le-wm needs
├── data/
│   ├── __init__.py   # Exports DataModule, random_split, transforms
│   ├── dataset_stats.py      # ~30 lines of dict definitions
│   ├── transforms.py         # ~500 lines (but le-wm only uses Compose, ToImage, Resize, WrapTorchTransform)
│   ├── module.py             # DataModule - ~240 lines
│   └── utils.py              # random_split, fold_views - ~150 lines
├── backbone/
│   ├── __init__.py   # Exports vit_hf (no timm dependency needed)
│   └── utils.py      # vit_hf() + register_lr_scale_hook - ~160 lines
├── module.py         # spt.Module - ~650 lines (heavy but necessary for train.py)
├── manager.py        # spt.Manager - ~580 lines (heavy but necessary for train.py)
└── utils/
    ├── __init__.py
    ├── error_handling.py     # @catch_errors_class decorator
    └── lightning_patch.py    # Lightning manual optimization patch
```

This trims from **162 files to ~15 files** while keeping 100% compatibility with `train.py` and `eval.py`.
