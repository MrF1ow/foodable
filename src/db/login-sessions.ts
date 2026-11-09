import { maybeOne, rows, run } from "./sql.js";

export async function put(
    id: string,
    payload: unknown,
    ttlMs: number,
): Promise<void> {
    const json = JSON.stringify(payload);
    const ttlSeconds = ttlMs / 1000;
    await run(async (tx) => {
        await tx`
            insert into public.oauth_login_sessions (id, payload, expires_at)
            values (
                ${id},
                ${json}::jsonb,
                now() + (${ttlSeconds}::double precision * interval '1 second')
            )
            on conflict (id) do update
            set
                payload = excluded.payload,
                expires_at = excluded.expires_at
        `;
    });
}

export async function get<T = unknown>(id: string): Promise<T | null> {
    return run(async (tx) => {
        const row = await maybeOne<{ payload: unknown }>(
            tx,
            tx`
                select payload
                from public.oauth_login_sessions
                where id = ${id}
                  and expires_at > now()
            `,
            "get login session",
        );
        return row ? (row.payload as T) : null;
    });
}

export async function take<T = unknown>(id: string): Promise<T | null> {
    return run(async (tx) => {
        const data = await rows<{ payload: unknown }>(
            tx,
            tx`
                delete from public.oauth_login_sessions
                where id = ${id}
                  and expires_at > now()
                returning payload
            `,
        );
        const row = data[0];
        return row ? (row.payload as T) : null;
    });
}

export async function del(id: string): Promise<void> {
    await run(async (tx) => {
        await tx`
            delete from public.oauth_login_sessions
            where id = ${id}
        `;
    });
}

export async function sweepExpired(): Promise<number> {
    return run(async (tx) => {
        const deleted = await rows<{ _: number }>(
            tx,
            tx`
                delete from public.oauth_login_sessions
                where expires_at <= now()
                returning 1 as _
            `,
        );
        return deleted.length;
    });
}
