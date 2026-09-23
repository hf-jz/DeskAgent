#!/usr/bin/env python3
"""
Migrate hermes SKILL.md files → DeskApp canonical format.

Usage: python3 migrate_hermes_skills.py [--dry-run]
  Scans ~/.hermes/skills/ for all SKILL.md files, converts each to
  canonical format, and installs into ~/.deskapp/skills/.
  Original hermes files are NOT modified.
"""

import os, sys, json, re, shutil
from datetime import datetime

HERMES_SKILLS = os.path.expanduser('~/.hermes/skills')
DESKAPP_SKILLS = os.path.expanduser('~/.deskapp/skills')
DRY_RUN = '--dry-run' in sys.argv


def parse_frontmatter(raw):
    m = re.match(r'^---\r?\n(.*?)\r?\n---\r?\n?(.*)$', raw, re.DOTALL)
    if not m:
        return {}, ''
    fm_text = m.group(1)
    body = m.group(2).strip()
    fm = {}
    lines = fm_text.split('\n')
    current_key = None
    current_list = []
    in_list = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if in_list:
            list_match = re.match(r'^-\s+(.+)$', line)
            if list_match:
                current_list.append(list_match.group(1).strip())
                continue
            else:
                if current_key:
                    fm[current_key] = current_list
                current_list = []
                in_list = False
                current_key = None
        kv = re.match(r'^([a-zA-Z_][\w]*)\s*:\s*(.*)$', line)
        if kv:
            key = kv.group(1)
            val = kv.group(2).strip()
            if val == '':
                current_key = key
                current_list = []
                in_list = True
            else:
                fm[key] = _parse_yaml_val(val)
    if in_list and current_key:
        fm[current_key] = current_list
    return fm, body


def _parse_yaml_val(v):
    v = v.strip()
    if v == 'true': return True
    if v == 'false': return False
    try:
        if '.' in v:
            return float(v)
        return int(v)
    except ValueError:
        pass
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    return v


def _extract_tags(fm):
    """Extract tags from hermes frontmatter — supports both flat and nested formats."""
    tags = fm.get('tags', [])
    if tags:
        return tags if isinstance(tags, list) else []
    meta = fm.get('metadata', {})
    if isinstance(meta, dict):
        hermes_meta = meta.get('hermes', {})
        if isinstance(hermes_meta, dict):
            t = hermes_meta.get('tags', [])
            return t if isinstance(t, list) else []
    return []


def migrate():
    if not os.path.isdir(HERMES_SKILLS):
        print(f'No hermes skills dir at {HERMES_SKILLS}')
        return

    index = {'version': 1, 'updatedAt': datetime.now().isoformat(), 'skills': []}
    migrated = 0

    for category in sorted(os.listdir(HERMES_SKILLS)):
        cat_dir = os.path.join(HERMES_SKILLS, category)
        if not os.path.isdir(cat_dir) or category.startswith('.'):
            continue

        for skill_name in sorted(os.listdir(cat_dir)):
            skill_dir = os.path.join(cat_dir, skill_name)
            skill_file = os.path.join(skill_dir, 'SKILL.md')
            if not os.path.isfile(skill_file):
                continue

            with open(skill_file, 'r') as f:
                raw = f.read()

            fm, body = parse_frontmatter(raw)
            if not fm.get('name'):
                print(f'  SKIP {category}/{skill_name}: no name field')
                continue

            # Extract tools if present
            tools = fm.get('tools', [])
            if not isinstance(tools, list):
                tools = []

            # Build canonical skill
            canonical = {
                'name': fm.get('name', skill_name),
                'version': str(fm.get('version', '1.0.0')),
                'author': fm.get('author', 'unknown'),
                'category': category,
                'tags': _extract_tags(fm),
                'trigger': fm.get('trigger', ''),
                'description': fm.get('description', ''),
                'instructions': body,
                'adapters': {
                    'hermes': {
                        'toolHints': tools,
                        'extraInstructions': '',
                    }
                },
                'active': True,
                'activeFor': ['hermes'],
                'installedAt': datetime.now().isoformat(),
                'updatedAt': datetime.now().isoformat(),
                'source': 'migrated',
            }

            # Write canonical file
            dest_dir = os.path.join(DESKAPP_SKILLS, category, canonical['name'])
            dest_file = os.path.join(dest_dir, 'SKILL.canonical.md')
            if DRY_RUN:
                print(f'  {canonical["name"]} ({category})')
            else:
                os.makedirs(dest_dir, exist_ok=True)
                content = _serialize_canonical(canonical)
                with open(dest_file, 'w') as f:
                    f.write(content)

            # Add to index
            index['skills'].append({
                'name': canonical['name'],
                'version': canonical['version'],
                'category': category,
                'tags': canonical['tags'],
                'description': canonical['description'],
                'active': canonical['active'],
                'activeFor': canonical['activeFor'],
                'installedAt': canonical['installedAt'],
            })
            migrated += 1

    if DRY_RUN:
        print(f'[DRY RUN] Would migrate {migrated} skills')
    else:
        os.makedirs(DESKAPP_SKILLS, exist_ok=True)
        with open(os.path.join(DESKAPP_SKILLS, 'index.json'), 'w') as f:
            json.dump(index, f, indent=2, ensure_ascii=False)
        print(f'Migrated {migrated} skills from hermes → DeskApp canonical format')


def _serialize_canonical(skill):
    lines = ['---']
    for key in ['name', 'version', 'author', 'category', 'description', 'trigger', 'source']:
        val = skill.get(key, '')
        if val:
            lines.append(f'{key}: {val}')
    tags = skill.get('tags', [])
    if tags:
        lines.append('tags:')
        for t in tags:
            lines.append(f'  - {t}')
    lines.append(f'active: {str(skill.get("active", True)).lower()}')
    af = skill.get('activeFor', [])
    if af:
        lines.append('activeFor:')
        for a in af:
            lines.append(f'  - {a}')
    if skill.get('adapters'):
        lines.append('adapters: {}')
    for ts in ['installedAt', 'updatedAt']:
        val = skill.get(ts, '')
        if val:
            lines.append(f'{ts}: {val}')
    lines.append('---')
    lines.append('')
    instructions = skill.get('instructions', '')
    if instructions:
        lines.append(instructions)
    return '\n'.join(lines)


if __name__ == '__main__':
    migrate()
