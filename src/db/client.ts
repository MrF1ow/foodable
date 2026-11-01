import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export { SignInError } from "../domain/auth.js";
export { authUserCount, signInUser, signUpUser } from "./users.js";

let supabase: SupabaseClient;

export const SUPABASE_TIMEOUT_MS = 15_000;

export function createTimedFetch(timeoutMs: number): typeof fetch {
    const timedFetch = (input: string | URL | Request, init?: RequestInit) => {
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = init?.signal
            ? AbortSignal.any([init.signal, timeout])
            : timeout;
        return fetch(input, { ...init, signal });
    };
    return timedFetch as typeof fetch;
}

const timedFetch = createTimedFetch(SUPABASE_TIMEOUT_MS);

function buildClient(): SupabaseClient {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
    }
    // persistSession: false keeps the client stateless — signIn/signUp on this
    // client won't attach a user JWT to future requests. Without this, the
    // singleton would silently downgrade from service-role to authenticated
    // after any auth call, making RLS fire on subsequent writes.
    return createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
        global: { fetch: timedFetch },
    });
}

export function getSupabase(): SupabaseClient {
    if (!supabase) supabase = buildClient();
    return supabase;
}
