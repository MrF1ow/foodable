import {
    combineBearerLookups,
    hashHouseholdToken,
    householdTokenHashHex,
    type TableLookup,
} from "../household-token.js";
import { runAsSystem } from "./actor.js";
import { definedColumns, maybeOne, rows, run, type Tx } from "./sql.js";

// ---------- OAuth tokens ----------

const OAUTH_TOKENS = "oauth_tokens";
const AUTH_CODES = "auth_codes";
const REFRESH_TOKENS = "refresh_tokens";
const REGISTERED_CLIENTS = "registered_clients";

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// oauth_tokens.client_id is text (it may hold the deploy-wide id, which is not
// a uuid) while registered_clients.id is a uuid. Joining on `rc.id::text =
// t.client_id` casts the indexed side, so Postgres cannot use the primary key
// and scans a table that anyone can grow through /register. This casts the
// token side instead, and only when it is uuid-shaped, so the lookup is a
// primary-key probe and a non-uuid id is "no registration", not a cast error.
const CLIENT_UUID_SQL = (column: string) =>
    `case when ${column} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then ${column}::uuid end`;

export async function storeToken(
    token: string,
    userId: string,
    clientId: string | null = null,
): Promise<void> {
    const expiresAt = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const payload = {
        token,
        user_id: userId,
        expires_at: expiresAt,
        client_id: clientId,
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
    | {
          status: "valid";
          kind: "user";
          userId: string;
          // The AI app the token was issued to (null for a token that
          // predates the column), its registered name when it has one, and
          // when the token was last recorded as used. Absent only on lookups
          // built by hand.
          clientId?: string | null;
          clientName?: string | null;
          lastUsedAt?: Date | null;
      }
    | { status: "valid"; kind: "household"; householdId: string }
    | { status: "invalid" }
    | { status: "unavailable" };

type OauthTokenLookup =
    | {
          status: "hit";
          id: string;
          clientId: string | null;
          clientName: string | null;
          lastUsedAt: Date | null;
      }
    | { status: "miss" }
    | { status: "unavailable" };

/** The bearer lookup statement; exported so a test can read its plan. */
export function oauthTokenLookupQuery(tx: Tx, token: string, now: string) {
    return tx`
        select t.user_id,
               t.client_id,
               (select rc.client_name
                from ${tx.unsafe(REGISTERED_CLIENTS)} rc
                where rc.id = ${tx.unsafe(CLIENT_UUID_SQL("t.client_id"))}
               ) as client_name,
               t.last_used_at
        from ${tx.unsafe(OAUTH_TOKENS)} t
        where t.token = ${token}
          and t.expires_at > ${now}
    `;
}

async function lookupOauthToken(token: string): Promise<OauthTokenLookup> {
    try {
        const now = new Date().toISOString();
        const data = await run(async (tx) => {
            return await maybeOne<{
                user_id: string;
                client_id: string | null;
                client_name: string | null;
                last_used_at: Date | string | null;
            }>(tx, oauthTokenLookupQuery(tx, token, now), "lookup oauth token");
        });
        if (!data?.user_id) return { status: "miss" };
        return {
            status: "hit",
            id: data.user_id,
            clientId: data.client_id,
            clientName: data.client_name,
            lastUsedAt:
                data.last_used_at === null ? null : new Date(data.last_used_at),
        };
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
        return {
            status: "valid",
            kind: "user",
            userId: oauth.id,
            clientId: oauth.clientId,
            clientName: oauth.clientName,
            lastUsedAt: oauth.lastUsedAt,
        };
    }
    return combineBearerLookups(oauth, await lookupHouseholdToken(token));
}

// ---------- Auth codes ----------

export async function storeAuthCode(
    code: string,
    redirectUri: string,
    userId: string,
    codeChallenge?: string,
    clientId: string | null = null,
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
                    client_id,
                    expires_at
                )
                values (
                    ${code},
                    ${redirectUri},
                    ${userId},
                    ${codeChallenge ?? null},
                    ${clientId},
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
    client_id: string | null;
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
                returning code, redirect_uri, user_id, code_challenge, client_id
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
    clientId: string | null = null,
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
                    client_id,
                    expires_at
                )
                values (${token}, ${userId}, ${clientId}, ${expiresAt})
            `;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to store refresh token: ${message}`);
        }
    });
}

export async function consumeRefreshToken(
    token: string,
): Promise<{ userId: string; clientId: string | null } | null> {
    const now = new Date().toISOString();

    return run(async (tx) => {
        const data = await maybeOne<{
            user_id: string;
            client_id: string | null;
        }>(
            tx,
            tx`
                delete from ${tx.unsafe(REFRESH_TOKENS)}
                where token = ${token}
                  and expires_at > ${now}
                returning user_id, client_id
            `,
            "consume refresh token",
        );
        return data ? { userId: data.user_id, clientId: data.client_id } : null;
    }).catch(() => null);
}

// ---------- Registered clients ----------

/**
 * Persists a dynamic client registration and returns its id, the value the
 * client is told to use as `client_id`. Null when the row could not be
 * written: the caller falls back to the deploy-wide client id, so a database
 * hiccup never fails a registration.
 */
export async function registerClient(
    clientName: string | null,
    redirectUris: string[],
): Promise<string | null> {
    try {
        return await run(async (tx) => {
            const row = await maybeOne<{ id: string }>(
                tx,
                tx`
                    insert into ${tx.unsafe(REGISTERED_CLIENTS)} (
                        client_name,
                        redirect_uris
                    )
                    values (${clientName}, ${tx.array(redirectUris, "text")})
                    returning id
                `,
                "register client",
            );
            return row?.id ?? null;
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("Failed to persist client registration:", message);
        return null;
    }
}

/** True when `clientId` is the id of a client that registered itself. */
export async function isRegisteredClient(clientId: string): Promise<boolean> {
    // The column is a uuid: a malformed value must be "no", not a cast error.
    if (!UUID_PATTERN.test(clientId)) return false;
    try {
        return await run(async (tx) => {
            const row = await maybeOne<{ id: string }>(
                tx,
                tx`
                    select id
                    from ${tx.unsafe(REGISTERED_CLIENTS)}
                    where id = ${clientId}
                `,
                "check registered client",
            );
            return row !== null;
        });
    } catch {
        return false;
    }
}

// ---------- Use and connections ----------

/**
 * Records that `token` was used at `at`, unless it was already recorded within
 * `minIntervalMs` before `at`. The guard is in the statement, so instances that
 * race on one token write once between them. Returns whether a row was written.
 * Runs as the system: the caller has already authenticated the token.
 */
export async function touchTokenUse(
    token: string,
    at: Date,
    minIntervalMs: number,
): Promise<boolean> {
    const staleBefore = new Date(at.getTime() - minIntervalMs);
    return runAsSystem("record oauth token use", () =>
        run(async (tx) => {
            const touched = await rows<{ token: string }>(
                tx,
                tx`
                    update ${tx.unsafe(OAUTH_TOKENS)}
                    set last_used_at = ${at.toISOString()}
                    where token = ${token}
                      and (last_used_at is null or last_used_at <= ${staleBefore.toISOString()})
                    returning token
                `,
            );
            return touched.length > 0;
        }),
    );
}

/** The connection listing statement; exported so a test can read its plan. */
export function connectionsQuery(tx: Tx, userId: string, now: string) {
    return tx`
        select g.client_id,
               (select rc.client_name
                from ${tx.unsafe(REGISTERED_CLIENTS)} rc
                where rc.id = ${tx.unsafe(CLIENT_UUID_SQL("g.client_id"))}
               ) as client_name,
               g.first_connected_at,
               g.last_used_at
        from (
            select t.client_id,
                   min(t.created_at) as first_connected_at,
                   max(t.last_used_at) as last_used_at
            from ${tx.unsafe(OAUTH_TOKENS)} t
            where t.user_id = ${userId}
              and t.expires_at > ${now}
            group by t.client_id
        ) g
        order by g.first_connected_at, g.client_id
    `;
}

export interface AiConnection {
    /** Null for tokens issued before clients were recorded. */
    clientId: string | null;
    /** The registered client's name, null when it has none. */
    clientName: string | null;
    firstConnectedAt: Date;
    lastUsedAt: Date | null;
}

/**
 * The AI apps a member has connected: their live access tokens grouped by
 * client, oldest connection first. Runs as the system because registered
 * clients carry no per-member policy; the user id filter is the scope.
 */
export async function listConnections(userId: string): Promise<AiConnection[]> {
    const now = new Date().toISOString();
    return runAsSystem("list ai connections", () =>
        run(async (tx) => {
            const found = await rows<{
                client_id: string | null;
                client_name: string | null;
                // rows() round-trips through json, so timestamps arrive as text.
                first_connected_at: Date | string;
                last_used_at: Date | string | null;
            }>(tx, connectionsQuery(tx, userId, now));
            return found.map((r) => ({
                clientId: r.client_id,
                clientName: r.client_name,
                firstConnectedAt: new Date(r.first_connected_at),
                lastUsedAt:
                    r.last_used_at === null ? null : new Date(r.last_used_at),
            }));
        }),
    );
}

/**
 * Disconnects one app: deletes every access and refresh token the member holds
 * for `clientId` (null = the tokens with no recorded client). The refresh
 * tokens go too, or the app could mint a new access token, and so do the
 * member's unspent authorization codes for it, or a code issued just before
 * could still be exchanged afterwards. Returns how many tokens were deleted
 * (codes are not counted).
 *
 * Not covered: a refresh already in flight when this runs can still mint a
 * fresh pair after the delete, since the refresh consumes its token first.
 * Closing that needs the refresh and the revoke to serialise on the member.
 */
export async function revokeConnection(
    userId: string,
    clientId: string | null,
): Promise<number> {
    return runAsSystem("revoke ai connection", () =>
        run(async (tx) => {
            const access = await rows<{ token: string }>(
                tx,
                tx`
                    delete from ${tx.unsafe(OAUTH_TOKENS)}
                    where user_id = ${userId}
                      and client_id is not distinct from ${clientId}
                    returning token
                `,
            );
            const refresh = await rows<{ token: string }>(
                tx,
                tx`
                    delete from ${tx.unsafe(REFRESH_TOKENS)}
                    where user_id = ${userId}
                      and client_id is not distinct from ${clientId}
                    returning token
                `,
            );
            await tx`
                delete from ${tx.unsafe(AUTH_CODES)}
                where user_id = ${userId}
                  and client_id is not distinct from ${clientId}
            `;
            return access.length + refresh.length;
        }),
    );
}
