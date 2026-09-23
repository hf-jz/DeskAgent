/**
 * Canonical Skill format — the universal skill definition used by DeskApp Skill Hub.
 * One source of truth, auto-translated to each agent's native format.
 *
 * Category is a hierarchical path: "parent/child" (e.g. "development/frontend").
 * Tags are flat, cross-cutting labels for multi-faceted discovery.
 */

export interface CanonicalSkill {
  /** Unique identifier, hyphenated (e.g. "organize-downloads") */
  name: string
  /** Semver version */
  version: string
  /** Author name or handle */
  author: string
  /** Hierarchical category path: "parent/child" (e.g. "development/frontend") */
  category: string
  /** Search/filter tags — flat, cross-cutting */
  tags: string[]
  /** Regex-like trigger keywords for auto-activation */
  trigger: string
  /** One-line summary */
  description: string
  /** Markdown body — the actual skill instructions */
  instructions: string

  /** Agent-specific adaptations (optional per agent) */
  adapters: SkillAdapters

  // ── Runtime metadata ──
  installedAt?: string
  updatedAt?: string
  source?: 'migrated' | 'hub' | 'local'
  active: boolean
  activeFor: string[]
  /** #25: declared capabilities — consent-gated on enable */
  capabilities?: string[]
}

export interface SkillAdapters {
  hermes?: HermesAdapter
  claudeCode?: ClaudeCodeAdapter
  cursor?: CursorAdapter
  codex?: CodexAdapter
}

export interface HermesAdapter {
  toolHints?: string[]
  extraInstructions?: string
}

export interface ClaudeCodeAdapter {
  sectionTitle?: string
  toolHints?: string[]
  extraInstructions?: string
}

export interface CursorAdapter {
  mergeSection?: string
}

export interface CodexAdapter {
  sectionTitle?: string
  extraInstructions?: string
}

/** Index entry — lightweight reference for listing */
export interface SkillIndexEntry {
  name: string
  version: string
  category: string
  tags: string[]
  description: string
  active: boolean
  activeFor: string[]
  /** #25: declared capabilities — consent-gated on enable */
  capabilities?: string[]
  installedAt?: string
}

/** Full skill registry index */
export interface SkillIndex {
  version: 1
  updatedAt: string
  skills: SkillIndexEntry[]
}

/** Agent type identifiers */
export type AgentId = 'hermes' | 'claude-code' | 'cursor' | 'codex' | 'openclaw'

// ── Taxonomy types ──

export interface Subcategory {
  id: string
  label: string
}

export interface Category {
  id: string
  icon: string
  label: string
  subcategories: Subcategory[]
}

export interface Taxonomy {
  version: number
  categories: Category[]
}
