#!/usr/bin/env python3
"""
DeskApp Voice Sidecar — ASR (SenseVoiceSmall) + TTS (edge-tts / macos say).

Protocol: JSON Lines over stdin/stdout
  stdin commands:
    {"cmd":"asr","audio_b64":"<base64 int16 PCM 16kHz mono>"}
    {"cmd":"tts","text":"...","id":"req-1"}
    {"cmd":"shutdown"}
  stdout events:
    {"type":"ready"}
    {"type":"asr_final","text":"..."}
    {"type":"tts_done","id":"req-1","path":"/tmp/voice/<hash>.mp3"}
    {"type":"error","message":"..."}

ponytail: base64 PCM for V1 push-to-talk; switch to length-prefixed binary
frames in V2 if streaming throughput becomes a bottleneck.
"""

import sys, json, os, re, time, base64, subprocess, tempfile, io
from pathlib import Path

# ── Clean text: strip FunASR emotion/language/formatting tags ──
_TAG_RE = re.compile(r"<\|[^|]+\|>")
_SPACE_RE = re.compile(r"\s+")

# Emotion tag extraction — SenseVoice emits <|HAPPY|><|SAD|><|ANGRY|> etc.
_EMOTION_RE = re.compile(r"<\|(HAPPY|SAD|ANGRY|NEUTRAL|SURPRISED|FEARFUL|DISGUSTED)\|>")
_KNOWN_EMOTIONS = {"HAPPY","SAD","ANGRY","NEUTRAL","SURPRISED","FEARFUL","DISGUSTED"}

def _extract_emotion(text: str):  # → str | None
    m = _EMOTION_RE.search(text)
    return m.group(1).lower() if m else None

def _clean_text(text: str) -> str:
    cleaned = _TAG_RE.sub("", text)
    cleaned = _SPACE_RE.sub(" ", cleaned)
    return cleaned.strip()


def _emit(d: dict) -> None:
    sys.stdout.write(json.dumps(d, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ── CJK detection for TTS voice selection ──
_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]")

def _has_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text))


# ═══════════════════════════════════════════════════════════════════════════
# ASR Engine — SenseVoiceSmall via FunASR
# ═══════════════════════════════════════════════════════════════════════════

SENSEVOICE_MODEL = "iic/SenseVoiceSmall"


class ASREngine:
    def __init__(self, language: str = "zh"):
        self.language = language
        self._model = None
        self._loaded = False

    def load(self) -> None:
        if self._loaded:
            return
        import torch
        torch.set_num_threads(8)

        from funasr import AutoModel
        self._model = AutoModel(
            model=SENSEVOICE_MODEL,
            device="cpu",
            disable_update=True,
            ncpu=8,
        )
        self._loaded = True

    def transcribe(self, audio_b64: str):  # → (str, str | None)
        """Transcribe → (clean_text, emotion_tag or None)."""
        self.load()

        raw = base64.b64decode(audio_b64)
        import numpy as np
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

        import torch
        with torch.inference_mode():
            result = self._model.generate(
                input=samples,
                language=self.language,
                use_itn=True,
                batch_size_s=0,
            )

        if not result or not isinstance(result, list) or len(result) == 0:
            return "", None
        raw_text = str(result[0].get("text", "")).strip()
        emotion = _extract_emotion(raw_text)
        return _clean_text(raw_text), emotion


# ═══════════════════════════════════════════════════════════════════════════
# TTS Engine — edge-tts (primary) + macOS say (fallback)
# ═══════════════════════════════════════════════════════════════════════════

VOICE_DIR: Path = None  # set on init


def _tts_edge(text: str, out_path: str, voice: str) -> bool:
    """Synthesize via edge-tts. Returns True on success."""
    try:
        import edge_tts
        import asyncio
        async def _run():
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(out_path)
        asyncio.run(_run())
        return True
    except Exception:
        return False


def _tts_say(text: str, out_path: str) -> bool:
    """Synthesize via macOS say → AAC .m4a (mp4f/mp3 is not a valid afconvert
    combo; .m4a plays fine in HTMLAudioElement). out_path should end .m4a."""
    try:
        base = out_path.rsplit(".", 1)[0]
        aiff_path = base + ".aiff"
        subprocess.run(
            ["say", "-o", aiff_path, text],  # no --data-format: LEI16@22050 rejected on modern macOS
            timeout=15, capture_output=True,
        )
        if not os.path.exists(aiff_path):
            return False
        r = subprocess.run(
            ["afconvert", "-f", "m4af", "-d", "aac", aiff_path, out_path],
            timeout=10, capture_output=True,
        )
        os.unlink(aiff_path)
        return r.returncode == 0 and os.path.exists(out_path)
    except Exception:
        return False


def synthesize(text: str, req_id: str) -> dict:
    """Synthesize speech, return {"id":..., "path":...} or {"id":..., "error":...}."""
    VOICE_DIR.mkdir(parents=True, exist_ok=True)

    # Hash text for cache key; edge → .mp3, say fallback → .m4a
    import hashlib
    h = hashlib.sha1(text.encode()).hexdigest()[:12]
    mp3_path = str(VOICE_DIR / f"{h}.mp3")
    m4a_path = str(VOICE_DIR / f"{h}.m4a")

    # Return cached if either engine's artifact exists
    for p in (mp3_path, m4a_path):
        if os.path.exists(p) and os.path.getsize(p) > 0:
            return {"id": req_id, "path": p}

    # Try edge-tts first
    voice = "zh-CN-XiaoxiaoNeural" if _has_cjk(text) else "en-US-AvaNeural"
    if _tts_edge(text, mp3_path, voice):
        return {"id": req_id, "path": mp3_path}

    # Fallback to macOS say (outputs .m4a)
    if _tts_say(text, m4a_path):
        return {"id": req_id, "path": m4a_path}

    return {"id": req_id, "error": "TTS synthesis failed"}


# ═══════════════════════════════════════════════════════════════════════════
# Main loop
# ═══════════════════════════════════════════════════════════════════════════

def main() -> None:
    global VOICE_DIR

    # voice cache in user temp
    VOICE_DIR = Path(tempfile.gettempdir()) / "deskapp-voice"
    VOICE_DIR.mkdir(parents=True, exist_ok=True)

    # Suppress stdout during ASR model load (FunASR prints version info)
    real_stdout = sys.stdout
    sys.stdout = open(os.devnull, "w")
    try:
        asr = ASREngine(language="zh")
        asr.load()
    finally:
        sys.stdout.close()
        sys.stdout = real_stdout

    _emit({"type": "ready"})

    # JSONL dispatcher loop — single readline, route by cmd type
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            _emit({"type": "error", "message": f"Invalid JSON: {line[:80]}"})
            continue

        cmd = msg.get("cmd", "")

        if cmd == "asr":
            audio_b64 = msg.get("audio_b64", "")
            if not audio_b64:
                _emit({"type": "error", "message": "asr: missing audio_b64"})
                continue
            try:
                text, emotion = asr.transcribe(audio_b64)
                result = {"type": "asr_final", "text": text}
                if emotion:
                    result["emotion"] = emotion
                _emit(result)
            except Exception as e:
                _emit({"type": "error", "message": f"ASR failed: {e}"})

        elif cmd == "tts":
            text = msg.get("text", "")
            req_id = msg.get("id", "")
            if not text:
                _emit({"type": "error", "message": "tts: missing text"})
                continue
            result = synthesize(text, req_id)
            if "error" in result:
                _emit({"type": "error", "message": result["error"], "id": req_id})
            else:
                _emit({"type": "tts_done", "id": result["id"], "path": result["path"]})

        elif cmd == "shutdown":
            break

        else:
            _emit({"type": "error", "message": f"Unknown command: {cmd}"})


def _selftest() -> int:
    """Fast self-check: pure functions + TTS path. Skips ASR model load (heavy).
    Usage: voice.py --selftest → exit 0 on pass."""
    global VOICE_DIR
    VOICE_DIR = Path(tempfile.gettempdir()) / "deskapp-voice-selftest"
    VOICE_DIR.mkdir(parents=True, exist_ok=True)

    # 1. tag stripping + emotion extraction
    raw = "<|zh|><|HAPPY|><|Speech|><|withitn|>今天天气真好"
    assert _extract_emotion(raw) == "happy", "emotion extraction failed"
    assert _clean_text(raw) == "今天天气真好", f"clean_text failed: {_clean_text(raw)!r}"

    # 2. CJK detection
    assert _has_cjk("你好") and not _has_cjk("hello")

    # 3. TTS: macOS say path (offline, deterministic)
    out = str(VOICE_DIR / "selftest.m4a")
    ok = _tts_say("test", out)
    assert ok and os.path.exists(out) and os.path.getsize(out) > 0, "say TTS failed"

    # 4. funasr importable (no model load)
    try:
        import funasr  # noqa: F401
    except ImportError:
        print("selftest: funasr not installed", file=sys.stderr)
        return 1

    print("selftest: OK")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    main()
