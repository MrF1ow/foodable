const TOAST_PARAM_MAX_LEN = 80;
const ELLIPSIS = "…";

/** Keeps toast flash params within the sanitizer's per-value limit. */
export function truncateToastParam(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= TOAST_PARAM_MAX_LEN) return trimmed;
    const keep = TOAST_PARAM_MAX_LEN - ELLIPSIS.length;
    return trimmed.slice(0, keep) + ELLIPSIS;
}
