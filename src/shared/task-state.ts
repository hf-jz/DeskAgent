// ── Task state vocabulary — single source for main + renderer ──
//
// Shape adopted from google/ax's `TaskStatus{phase, conditions}` (see
// docs/ax/01-borrow-list.md A3):
//   - `phase` is a one-word answer to "where is this in its lifecycle";
//   - `conditions` are orthogonal, persistent properties that survive phase
//     changes (ax: Ready / WorkspaceReady / GatewayReady).
//
// ax lesson NOT repeated: its phases are bare strings — only `PhaseTerminating`
// is a constant (`pkg/apis/v1alpha1/types.go:41`), so a typo silently invents a
// phase. Here the phase set is the const object below; consumers import it.

export const TaskPhase = {
  pending: 'pending',
  running: 'running',
  /** paused with its state checkpointed, resumable (ax: SuspendTask) */
  suspended: 'suspended',
  failed: 'failed',
  done: 'done',
  /** delete requested, resources still being torn down (ax: Terminating) */
  terminating: 'terminating',
} as const

export type TaskPhase = (typeof TaskPhase)[keyof typeof TaskPhase]

/** Phases with no automatic outgoing transition — a new run starts over. */
const TERMINAL_PHASES: readonly TaskPhase[] = [TaskPhase.done, TaskPhase.failed]

export function isTerminalPhase(phase: TaskPhase): boolean {
  return TERMINAL_PHASES.includes(phase)
}

export type ConditionStatus = 'True' | 'False'

/** Durable properties of a task, independent of its phase. */
export type ConditionType =
  | 'Ready' //          can accept work right now
  | 'BridgeReady' //    the python bridge finished warm-up (bridge:ready frame)
  | 'WorkspaceReady' // workspace profile materialized (.deskapp marker written)
  | 'ApprovalPending' // blocked on a user decision (approval card / question)

export interface TaskCondition {
  type: ConditionType
  status: ConditionStatus
  /** short machine-readable reason, e.g. 'TurnRunning' / 'NoCredentials' */
  reason: string
  message: string
  /** epoch ms of the last time `status` actually changed */
  lastTransitionAt: number
}

export interface ConditionPatch {
  type: ConditionType
  status: ConditionStatus
  reason: string
  message: string
}

/** Merge by `type`, in place, like ax's reconciler.setCondition
 *  (`internal/controller/reconciler.go`): re-setting the same status keeps the
 *  original lastTransitionAt, so "how long has it been True" stays meaningful. */
export function setCondition(
  list: readonly TaskCondition[] | undefined,
  patch: ConditionPatch,
  now: number = Date.now(),
): TaskCondition[] {
  const out = list ? [...list] : []
  const i = out.findIndex((c) => c.type === patch.type)
  if (i < 0) {
    out.push({ ...patch, lastTransitionAt: now })
    return out
  }
  const prev = out[i]
  out[i] = { ...patch, lastTransitionAt: prev.status === patch.status ? prev.lastTransitionAt : now }
  return out
}

export function getCondition(
  list: readonly TaskCondition[] | undefined,
  type: ConditionType,
): TaskCondition | undefined {
  return list?.find((c) => c.type === type)
}

export function conditionTrue(list: readonly TaskCondition[] | undefined, type: ConditionType): boolean {
  return getCondition(list, type)?.status === 'True'
}
