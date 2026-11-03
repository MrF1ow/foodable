import {
    combineBearerLookups,
    hashHouseholdToken,
    householdTokenHashHex,
    type TableLookup,
} from "../household-token.js";
import { definedColumns, maybeOne, rows, run } from "./sql.js";

// ---------- OAuth tokens ----------

const OAUTH_TOKENS = "oauth_tokens";
const AUTH_CODES = "auth_codes";
const REFRESH_TOKENS = "refresh_tokens";
const REGISTERED_CLIENTS = "registered_clients";

export async function storeToken(token: string, userId: string): Promise<void> {
    const expiresAt = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const payload = {
        token,
        user_id: userId,
        expires_at: expiresAt,
    };

    await run(async (tx) => {
        const { row, keys } = definedColumns(payload);
        const updateKeys = keys.filter((k) => k !== "token");
        const setClause = updateKeys
            .map((k) => `${k} = excluded.${k}`)
            .join(", ");
        try {
            await tx`
                insert into ${tx.unsafe(OAUTH_TOKENS)} ${tx(
                    row,
                    ...(keys as [string, ...string[]]),
                )}
                on conflict (token) do update set ${tx.unsafe(setClause)}
            `;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to store token: ${message}`);
        }
    });
}

// "invalid" means the token definitively isn't valid; "unavailable" means we
// could not find out. Callers must not treat the two alike: counting an
// unavailable lookup as a failed auth attempt would let a brief database outage
// — during which *every* token looks invalid — trip the repeat-failure bans in
// rate-limit.ts and keep clients shed long after the database recovered.
export type TokenLookup =
    | { status: "valid"; kind: "user"; userId: string }
    | { status: "valid"; kind: "household"; householdId: string }
    | { status: "invalid" }
    | { status: "unavailable" };

async function lookupOauthToken(token: string): Promise<TableLookup> {
    try {
        const now = new Date().toISOString();
        const data = await run(async (tx) => {
            return await maybeOne<{ user_id: string }>(
                tx,
                tx`
                    select user_id
                    from ${tx.unsafe(OAUTH_TOKENS)}
                    where token = ${token}
                      and expires_at > ${now}
                `,
                "lookup oauth token",
            );
        });
        if (!data?.user_id) return { status: "miss" };
        return { status: "hit", id: data.user_id };
    } catch {
        return { status: "unavailable" };
    }
}

async function lookupHouseholdToken(token: string): Promise<TableLookup> {
    try {
        const hex = householdTokenHashHex(hashHouseholdToken(token));
        const data = await run(async (tx) => {
            return await maybeOne<{ household_id: string | null }>(
                tx,
                tx`
                    select public.resolve_household_mcp_token(
                        p_token_hash_hex => ${hex}
                    ) as household_id
                `,
                "resolve household mcp token",
            );
        });
        if (
            typeof data?.household_id !== "string" ||
            data.household_id.length === 0
        ) {
            return { status: "miss" };
        }
        return { status: "hit", id: data.household_id };
    } catch {
        return { status: "unavailable" };
    }
}

export async function lookupBearer(token: string): Promise<TokenLookup> {
    const oauth = await lookupOauthToken(token);
    if (oauth.status === "hit") {
        return { status: "valid", kind: "user", userId: oauth.id };
    }
    return combineBearerLookups(oauth, await lookupHouseholdToken(token));
}

// ---------- Auth codes ----------

export async function storeAuthCode(
    code: string,
    redirectUri: string,
    userId: string,
    codeChallenge?: string,
): Promise<void> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await run(async (tx) => {
        try {
            await tx`
                insert into ${tx.unsafe(AUTH_CODES)} (
                    code,
                    redirect_uri,
                    user_id,
                    code_challenge,
                    expires_at
                )
                values (
                    ${code},
                    ${redirectUri},
                    ${userId},
                    ${codeChallenge ?? null},
                    ${expiresAt}
                )
            `;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to store auth code: ${message}`);
        }
    });
}

export interface AuthCodeData {
    code: string;
    redirect_uri: string;
    user_id: string;
    code_challenge: string | null;
}

export async function consumeAuthCode(
    code: string,
): Promise<AuthCodeData | null> {
    const now = new Date().toISOString();

    return run(async (tx) => {
        const data = await maybeOne<AuthCodeData>(
            tx,
            tx`
                delete from ${tx.unsafe(AUTH_CODES)}
                where code = ${code}
                  and expires_at > ${now}
                returning code, redirect_uri, user_id, code_challenge
            `,
            "consume auth code",
        );
        return data;
    }).catch(() => null);
}

// ---------- Refresh tokens ----------

export async function storeRefreshToken(
    token: string,
    userId: string,
): Promise<void> {
    const expiresAt = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await run(async (tx) => {
        try {
            await tx`
                insert into ${tx.unsafe(REFRESH_TOKENS)} (
                    token,
                    user_id,
                    expires_at
                )
                values (${token}, ${userId}, ${expiresAt})
            `;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to store refresh token: ${message}`);
        }
    });
}

export async function consumeRefreshToken(
    token: string,
): Promise<string | null> {
    const now = new Date().toISOString();

    return run(async (tx) => {
        const data = await maybeOne<{ user_id: string }>(
            tx,
            tx`
                delete from ${tx.unsafe(REFRESH_TOKENS)}
                where token = ${token}
                  and expires_at > ${now}
                returning user_id
            `,
            "consume refresh token",
        );
        return data?.user_id ?? null;
    }).catch(() => null);
}

// ---------- Registered clients ----------

export function registerClient(
    clientName: string | null,
    redirectUris: string[],
): void {
    run(async (tx) => {
        await tx`
            insert into ${tx.unsafe(REGISTERED_CLIENTS)} (
                client_name,
                redirect_uris
            )
            values (${clientName}, ${tx.array(redirectUris, "text")})
        `;
    }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("Failed to persist client registration:", message);
    });
}
