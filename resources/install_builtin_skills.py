#!/usr/bin/env python3
"""Install built-in OS automation skills into DeskApp's skill store."""
import os, json, sys
from datetime import datetime

SKILLS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builtin-skills.json')
DESKAPP_SKILLS = os.path.expanduser("~/.deskapp/skills")
DRY_RUN = "--dry-run" in sys.argv

def install():
    with open(SKILLS_FILE) as f:
        skills = json.load(f)

    idx_path = os.path.join(DESKAPP_SKILLS, "index.json")
    idx = {"version": 1, "updatedAt": "", "skills": []}
    if os.path.exists(idx_path):
        with open(idx_path) as f:
            idx = json.load(f)

    installed = 0
    for skill in skills:
        name = skill["name"]
        cat = skill["category"]
        if any(s["name"] == name for s in idx["skills"]):
            print(f"  SKIP {name}: already installed")
            continue

        now = datetime.now().isoformat()
        skill["installedAt"] = now
        skill["updatedAt"] = now

        if DRY_RUN:
            print(f"  [DRY] {name} ({cat})")
            installed += 1
            continue

        d = os.path.join(DESKAPP_SKILLS, cat, name)
        os.makedirs(d, exist_ok=True)

        lines = ["---"]
        for k in ["name", "version", "author", "category"]:
            lines.append(f"{k}: {skill[k]}")
        lines.append(f'description: "{skill["description"]}"')
        if skill.get("trigger"):
            lines.append(f"trigger: {skill['trigger']}")
        tags = skill.get("tags", [])
        if tags:
            lines.append("tags:")
            for t in tags:
                lines.append(f"  - {t}")
        lines.append("active: true")
        lines.append("activeFor:")
        for a in skill.get("activeFor", ["hermes"]):
            lines.append(f"  - {a}")
        lines.append("source: builtin")
        lines.append(f"installedAt: {now}")
        lines.append(f"updatedAt: {now}")
        if skill.get("adapters"):
            lines.append("adapters: {}")
        lines.append("---")
        lines.append("")
        lines.append(skill["instructions"])

        with open(os.path.join(d, "SKILL.canonical.md"), "w") as f:
            f.write("\n".join(lines))

        idx["skills"].append({
            "name": name, "version": skill["version"], "category": cat,
            "tags": skill.get("tags", []), "description": skill["description"],
            "active": True, "activeFor": skill.get("activeFor", ["hermes"]),
            "installedAt": now,
        })
        print(f"  + {name} ({cat})")
        installed += 1

    if not DRY_RUN and installed > 0:
        idx["updatedAt"] = datetime.now().isoformat()
        with open(idx_path, "w") as f:
            json.dump(idx, f, indent=2, ensure_ascii=False)

    print(f"\n{'[DRY] Would install' if DRY_RUN else 'Installed'} {installed} built-in skills")

if __name__ == "__main__":
    install()
