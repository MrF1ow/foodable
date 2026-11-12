/** Past this many remembered keys, the ones already due again are dropped. */
const MAX_REMEMBERED = 1000;

export type UseRecorderDeps = {
    /** Names what is recorded, for the warning when a write fails. */
    label: string;
    now: () => Date;
    touch: (key: string, at: Date, minIntervalMs: number) => Promise<boolean>;
    intervalMs: number;
};

/**
 * Records that something was used, at most once per interval per key, without
 * ever failing the request it rides on.
 *
 * Two guards keep writes to one per key per interval. A caller that already
 * read the stored time passes it as `lastKnown`, so a recently used key costs
 * nothing here. This instance also remembers what it wrote, so a burst of
 * requests that all read "never" before the first write landed still writes
 * once from here; the statement's own guard covers the same race across
 * instances.
 *
 * The returned promise always resolves: callers on the request path do not
 * await it.
 */
export function createUseRecorder(deps: UseRecorderDeps) {
    const recorded = new Map<string, number>();

    return async function record(
        key: string,
        lastKnown: Date | null = null,
    ): Promise<void> {
        const now = deps.now();
        const nowMs = now.getTime();
        if (lastKnown && nowMs - lastKnown.getTime() < deps.intervalMs) return;
        const mine = recorded.get(key);
        if (mine !== undefined && nowMs - mine < deps.intervalMs) return;

        if (recorded.size >= MAX_REMEMBERED) {
            for (const [k, at] of recorded) {
                if (nowMs - at >= deps.intervalMs) recorded.delete(k);
            }
        }
        recorded.set(key, nowMs);
        try {
            await deps.touch(key, now, deps.intervalMs);
        } catch (err) {
            // Forget it, so the next use tries again; the call itself is
            // never held against the request.
            recorded.delete(key);
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`Failed to record ${deps.label}:`, message);
        }
    };
}
