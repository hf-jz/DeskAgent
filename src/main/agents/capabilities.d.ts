/**
 * Model capability table — drives UI visibility (attachment types, model
 * features) and provides capabilities info to the renderer.
 *
 * Known models are hardcoded; unknown models get a safe default. Hermes's own
 * internal registries (_PROVIDERS_WITHOUT_VISION etc.) are intentionally NOT
 * consulted — they are hermes implementation details that may change.
 */
export interface ModelCapabilities {
    /** Supports function/tool calling */
    tools: boolean;
    /** Supports image input (vision) */
    vision: boolean;
    /** Supports PDF input */
    pdf: boolean;
    /** Supports SSE streaming */
    streaming: boolean;
    /** Supports reasoning_content (thinking / chain-of-thought deltas) */
    reasoning: boolean;
}
/** Look up capabilities for a model name. Falls back to DEFAULT for unknowns. */
export declare function getCapabilities(model: string): ModelCapabilities;
/** Human-readable label for a single capability. */
export declare function capabilityLabel(key: keyof ModelCapabilities): string;
/** Summary line for display in settings / model selector. */
export declare function capabilitiesSummary(caps: ModelCapabilities): string;
