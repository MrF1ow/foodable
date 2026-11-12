import { touchTokenUse } from "./db/tokens.js";
import { createUseRecorder } from "./use-recorder.js";

/** A token's last use is recorded at most this often. */
export const TOKEN_USE_INTERVAL_MS = 10 * 60 * 1000;

export type TokenUseDeps = {
    now: () => Date;
    touch: (token: string, at: Date, minIntervalMs: number) => Promise<boolean>;
    intervalMs?: number;
};

/**
 * Records that a token was used, at most once per interval, without ever
 * failing the request it rides on (see `createUseRecorder`). The lookup
 * already read `last_used_at`, so a recently used token costs nothing.
 */
export function createTokenUseRecorder(deps: TokenUseDeps) {
    const record = createUseRecorder({
        label: "token use",
        now: deps.now,
        touch: deps.touch,
        intervalMs: deps.intervalMs ?? TOKEN_USE_INTERVAL_MS,
    });
    return (token: string, lastUsedAt: Date | null): Promise<void> =>
        record(token, lastUsedAt);
}

/** The recorder the MCP bearer check uses. */
export const recordTokenUse = createTokenUseRecorder({
    now: () => new Date(),
    touch: touchTokenUse,
});
