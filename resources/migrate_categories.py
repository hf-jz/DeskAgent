#!/usr/bin/env python3
"""
Migrate DeskApp skill categories from old flat format to new hierarchical taxonomy.

Old:  { name: "deskapp", ..., category: "software-development" }
New:  { name: "deskapp", ..., category: "development/backend" }

Reads the old index.json, applies the mapping from categories.json,
updates each SKILL.canonical.md file in-place, and writes a new index.json.
"""

import json, os, sys

DESKAPP = os.path.expanduser('~/.deskapp/skills')
CATEGORIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'categories.json')
DRY_RUN = '--dry-run' in sys.argv

def load_mapping():
    with open(CATEGORIES_FILE) as f:
        data = json.load(f)
    mig = data.get('_migration_map', {})
    return {
        'categories': mig.get('mappings', {}),
        'per_skill': mig.get('_per_skill', {}),
    }

def migrate():
    mapping = load_mapping()
    index_path = os.path.join(DESKAPP, 'index.json')

    if not os.path.exists(index_path):
        print(f'No index.json at {index_path}')
        return

    with open(index_path) as f:
        index = json.load(f)

    migrated = 0
    unmapped = []

    for skill in index.get('skills', []):
        old_cat = skill.get('category', '')
        # Per-skill mapping takes priority over category-level mapping
        new_cat = mapping['per_skill'].get(skill['name']) or mapping['categories'].get(old_cat)

        if not new_cat:
            unmapped.append(f'{skill["name"]} (was: {old_cat})')
            continue

        # Update index entry
        skill['category'] = new_cat

        # Update SKILL.canonical.md file
        skill_dir = os.path.join(DESKAPP, old_cat, skill['name'])
        skill_file = os.path.join(skill_dir, 'SKILL.canonical.md')

        if os.path.exists(skill_file):
            with open(skill_file) as f:
                content = f.read()
            # Replace category: old_cat → new_cat
            content = content.replace(f'category: {old_cat}', f'category: {new_cat}')

            if DRY_RUN:
                print(f'[DRY] {skill["name"]}: {old_cat} → {new_cat}')
            else:
                # Write updated file in old location (keep old dir structure for now)
                with open(skill_file, 'w') as f:
                    f.write(content)
                print(f'  {skill["name"]}: {old_cat} → {new_cat}')
        else:
            print(f'  SKIP {skill["name"]}: SKILL.canonical.md not found at {skill_file}')
            continue

        migrated += 1

    if not DRY_RUN:
        index['updatedAt'] = __import__('datetime').datetime.now().isoformat()
        with open(index_path, 'w') as f:
            json.dump(index, f, indent=2, ensure_ascii=False)
        print(f'\n✓ Migrated {migrated} skills to new taxonomy')

    if unmapped:
        print(f'\n⚠ {len(unmapped)} skills NOT mapped (need manual assignment):')
        for u in unmapped:
            print(f'  {u}')

if __name__ == '__main__':
    tag = '[DRY RUN] ' if DRY_RUN else ''
    print(f'{tag}Migrating categories...\n')
    migrate()
