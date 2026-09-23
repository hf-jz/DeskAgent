/**
 * Memory Store — three-tier scoped memory for agent context injection.
 *
 * Scopes:
 *   global    — cross-project user preferences / facts
 *   workspace — project-specific conventions / commands
 *   session   — current conversation only (cleared on session end)
 *
 * Injected into the agent context as:
 *   [#id] value
 *
 * Uses better-sqlite3 (same pattern as inbox / session-store). Falls back
 * silently when the native module is unavailable (no crash).
 */
export type MemoryScope = 'global' | 'workspace' | 'session';
export interface MemoryEntry {
    id: number;
    scope: MemoryScope;
    workspace: string;
    sessionId: string;
    key: string;
    value: string;
    createdAt: number;
    updatedAt: number;
}
/** Store or update a memory entry. If key is provided and an entry with the
 *  same (scope, workspace, sessionId, key) exists, it is updated in-place.
 *  Otherwise a new row is inserted. Returns the entry id. */
export declare function remember(scope: MemoryScope, value: string, opts?: {
    key?: string;
    workspace?: string;
    sessionId?: string;
}): number | null;
/** Query memories by scope. workspace and sessionId narrow the results. */
export declare function recall(scope: MemoryScope, workspace?: string, sessionId?: string): MemoryEntry[];
/** Update a specific memory entry by id. */
export declare function updateMemory(id: number, value: string): boolean;
/** Delete a memory entry by id. */
export declare function forget(id: number): boolean;
/** Move a memory entry to a different scope. */
export declare function moveMemory(id: number, newScope: MemoryScope): boolean;
/** List all memories (for settings UI). */
export declare function listAll(): MemoryEntry[];
/** Format memories for agent context injection. */
export declare function formatForContext(entries: MemoryEntry[]): string;
/** Clear all session-scoped memories for a given sessionId. */
export declare function clearSession(sessionId: string): void;
