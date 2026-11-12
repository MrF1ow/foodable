import { touchTokenUse } from "./db/tokens.js";

/** A token's last use is recorded at most this often. */
export const TOKEN_USE_INTERVAL_MS = 10 * 60 * 1000;

/** Past this many remembered tokens, the ones already due again are dropped. */
const MAX_REMEMBERED = 1000;

export type TokenUseDeps = {
    now: () => Date;
    touch: (token: string, at: Date, minIntervalMs: number) => Promise<boolean>;
    intervalMs?: number;
};

/**
 * Records that a token was used, at most once per interval, without ever
 * failing the request it rides on.
 *
 * Two guards keep writes to one per token per interval. The lookup already
 * read `last_used_at`, so a recently used token costs nothing here. This
 * instance also remembers what it wrote, so a burst of requests that all read
 * "never used" before the first write landed still writes once from here; the
 * statement's own guard covers the same race across instances.
 *
 * The returned promise always resolves: callers on the request path do not
 * await it.
 */
export function createTokenUseRecorder(deps: TokenUseDeps) {
    const interval = deps.intervalMs ?? TOKEN_USE_INTERVAL_MS;
    const recorded = new Map<string, number>();

    return async function recordTokenUse(
        token: string,
        lastUsedAt: Date | null,
    ): Promise<void> {
        const now = deps.now();
        const nowMs = now.getTime();
        if (lastUsedAt && nowMs - lastUsedAt.getTime() < interval) return;
        const mine = recorded.get(token);
        if (mine !== undefined && nowMs - mine < interval) return;

        if (recorded.size >= MAX_REMEMBERED) {
            for (const [key, at] of recorded) {
                if (nowMs - at >= interval) recorded.delete(key);
            }
        }
        recorded.set(token, nowMs);
        try {
            await deps.touch(token, now, interval);
        } catch (err) {
            // Forget it, so the next use tries again; the call itself is
            // never held against the request.
            recorded.delete(token);
            const message = err instanceof Error ? err.message : String(err);
            console.warn("Failed to record token use:", message);
        }
    };
}

/** The recorder the MCP bearer check uses. */
export const recordTokenUse = createTokenUseRecorder({
    now: () => new Date(),
    touch: touchTokenUse,
});
