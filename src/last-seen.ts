import { touchUserSeen } from "./db/users.js";
import { createUseRecorder } from "./use-recorder.js";

/** A user's last-active time is recorded at most this often. */
export const USER_SEEN_INTERVAL_MS = 60 * 60 * 1000;

export type UserSeenDeps = {
    now: () => Date;
    touch: (
        userId: string,
        at: Date,
        minIntervalMs: number,
    ) => Promise<boolean>;
    intervalMs?: number;
};

/**
 * Records that a signed-in user was active on the site, at most once per
 * interval, without ever failing the request it rides on (see
 * `createUseRecorder`). Nothing has read `last_seen_at` yet at this point, so
 * this instance's memory and the statement's own guard do the throttling.
 */
export function createUserSeenRecorder(deps: UserSeenDeps) {
    const record = createUseRecorder({
        label: "user activity",
        now: deps.now,
        touch: deps.touch,
        intervalMs: deps.intervalMs ?? USER_SEEN_INTERVAL_MS,
    });
    return (userId: string): Promise<void> => record(userId);
}

/** The recorder the site middleware uses. */
export const recordUserSeen = createUserSeenRecorder({
    now: () => new Date(),
    touch: touchUserSeen,
});
