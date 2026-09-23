// ── Session Grants — In-memory authorization memory (P0-4A) ──
//
// Based on openworker's session-level always-allow tool/command/path grants.
// Grants live in process memory (cleared on restart / new session).
// Three granularities:
//   always_tool    — trust ALL calls to this specific tool in this session
//   always_command — trust this exact command string (terminal tool only)
//   always_path    — trust this tool operating on this path
//
// Grants are checked BEFORE the RiskConfirmDialog, so repeated use of a
// trusted tool in the same session skips the dialog entirely.

export type GrantKind = 'always_tool' | 'always_command' | 'always_path'

export interface Grant {
  kind: GrantKind
  tool: string
  /** For always_command: the exact command string */
  command?: string
  /** For always_path: the file/directory path */
  path?: string
  createdAt: number
}

// ── In-memory store ──

const grants = new Map<string, Grant>()
// Audit log for grant hits (non-persistent, just for stats)
const grantHits: { tool: string; kind: GrantKind; ts: number }[] = []

// ── Grant keys ──

function grantKey(kind: GrantKind, tool: string, command?: string, path?: string): string {
  switch (kind) {
    case 'always_tool': return `tool:${tool}`
    case 'always_command': return `cmd:${tool}:${command || ''}`
    case 'always_path': return `path:${tool}:${path || ''}`
  }
}

// ── CRUD ──

export function addGrant(kind: GrantKind, tool: string, command?: string, path?: string): Grant {
  const key = grantKey(kind, tool, command, path)
  const grant: Grant = { kind, tool, command, path, createdAt: Date.now() }
  grants.set(key, grant)
  return grant
}

export function removeGrant(kind: GrantKind, tool: string, command?: string, path?: string): boolean {
  const key = grantKey(kind, tool, command, path)
  return grants.delete(key)
}

export function clearAllGrants(): void {
  grants.clear()
  grantHits.length = 0
}

export function getAllGrants(): Grant[] {
  return Array.from(grants.values())
}

// ── Check ──

/**
 * Check if a tool call is covered by an existing grant.
 * Returns the matching grant if found, null otherwise.
 */
export function checkGrant(
  name: string,
  args?: string,
  targetPath?: string,
): Grant | null {
  // 1. always_tool: trust ALL calls to this tool
  const toolGrant = grants.get(grantKey('always_tool', name))
  if (toolGrant) {
    grantHits.push({ tool: name, kind: 'always_tool', ts: Date.now() })
    return toolGrant
  }

  // 2. always_command: trust this exact command string (terminal tool)
  if (name === 'terminal' && args) {
    const cmdGrant = grants.get(grantKey('always_command', name, args))
    if (cmdGrant) {
      grantHits.push({ tool: name, kind: 'always_command', ts: Date.now() })
      return cmdGrant
    }
  }

  // 3. always_path: trust this tool on this path
  if (targetPath) {
    const pathGrant = grants.get(grantKey('always_path', name, targetPath))
    if (pathGrant) {
      grantHits.push({ tool: name, kind: 'always_path', ts: Date.now() })
      return pathGrant
    }
  }

  return null
}

// ── Audit ──

export function getGrantHits(): { tool: string; kind: GrantKind; ts: number }[] {
  return [...grantHits]
}

export function getGrantHitCount(): number {
  return grantHits.length
}

// ── Input-gate grants (P0-4A) ──
//
// The bubble's pre-send text risk scan (analyzeRisks) is category-based, not
// tool-call-based. "总是允许" there means: this combination of risk categories
// is trusted for the rest of the session. Encoded as an always_tool grant on
// the synthetic tool name `input:<sorted categories>`.

function inputGrantTool(categories: string[]): string {
  return `input:${[...categories].sort().join(',')}`
}

export function addInputGrant(categories: string[]): Grant {
  return addGrant('always_tool', inputGrantTool(categories))
}

export function checkInputGrant(categories: string[]): Grant | null {
  if (!categories.length) return null
  return checkGrant(inputGrantTool(categories))
}
