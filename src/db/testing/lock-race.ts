import { SQL, type SQL as SqlClient } from "bun";
import { setSqlForTests } from "../sql.js";

/** Well inside the 5 s test timeout, so a failure reads as this message. */
export async function waitForLockWaiters(
    sql: SqlClient,
    count: number,
): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        const [row] = await sql`
            select count(*)::int as n
            from pg_stat_activity
            where datname = current_database()
              and wait_event_type = 'Lock'
        `;
        if (row.n >= count) return;
        await Bun.sleep(10);
    }
    throw new Error(`expected ${count} sessions waiting on the row lock`);
}

/**
 * Holds an uncommitted row on `blockInsert` so two concurrent writers block on
 * the same unique key, then rolls the holder back so both can race.
 */
export async function raceOnUniqueKey<T>(opts: {
    url: string;
    restoreSql: SqlClient;
    blockInsert: (tx: SqlClient) => Promise<void>;
    run: (client: SqlClient) => Promise<T>;
}): Promise<[T, T]> {
    const holder = new SQL(opts.url, { prepare: false, max: 1 });
    const left = new SQL(opts.url, { prepare: false, max: 1 });
    const right = new SQL(opts.url, { prepare: false, max: 1 });
    const observer = new SQL(opts.url, { prepare: false, max: 1 });
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((r) => (releaseLock = r));
    let lockTaken!: () => void;
    const lockHeld = new Promise<void>((r) => (lockTaken = r));
    const holding = holder.begin(async (tx) => {
        await opts.blockInsert(tx);
        lockTaken();
        await lockReleased;
        throw new Error("rollback blocking insert");
    });
    try {
        await lockHeld;
        setSqlForTests(left);
        const first = opts.run(left);
        setSqlForTests(right);
        const second = opts.run(right);
        setSqlForTests(opts.restoreSql);
        await waitForLockWaiters(observer, 2);
        releaseLock();
        await Promise.allSettled([holding]);
        return await Promise.all([first, second]);
    } finally {
        releaseLock();
        setSqlForTests(opts.restoreSql);
        await Promise.allSettled([holding]);
        await Promise.all([
            holder.close(),
            left.close(),
            right.close(),
            observer.close(),
        ]);
    }
}
