import {
    shareLinkFromRow,
    type ShareLinkRow,
    type ShareLinkStore,
} from "../domain/sharing.js";
import { runAsSystem } from "./actor.js";
import { maybeOne, pgError, rows, run } from "./sql.js";

const SHARE_LINKS = "share_links";
// token_hash is deliberately not selected: nothing outside the table needs it.
const COLS =
    "id, household_id, kind, target_id, created_by, created_at, expires_at, revoked_at";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Omit<ShareLinkRow, "token_hash">;

function mapRow(row: Row) {
    return shareLinkFromRow({ ...row, token_hash: "" });
}

export function liveShareLinkStore(): ShareLinkStore {
    return {
        async create(input) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Row>(
                        tx,
                        tx`
                            insert into ${tx.unsafe(SHARE_LINKS)} (
                                household_id, kind, target_id, token_hash,
                                created_by, expires_at
                            )
                            values (
                                ${input.householdId}, ${input.kind},
                                ${input.targetId}, ${input.tokenHash},
                                ${input.createdBy},
                                ${input.expiresAt}::timestamptz
                            )
                            returning ${tx.unsafe(COLS)}
                        `,
                        "create share link",
                    );
                    if (!data) throw new Error("no row returned");
                    return mapRow(data);
                } catch (err) {
                    throw pgError("create share link", err);
                }
            });
        },
        // A visitor has no household and no member, so row level security
        // would show them nothing: the lookup runs as the system, by hash
        // only. The raw token never reaches the database.
        async findByHash(tokenHash) {
            return runAsSystem("resolve share link", () =>
                run(async (tx) => {
                    try {
                        const data = await maybeOne<Row>(
                            tx,
                            tx`
                                select ${tx.unsafe(COLS)}
                                from ${tx.unsafe(SHARE_LINKS)}
                                where token_hash = ${tokenHash}
                            `,
                            "load share link",
                        );
                        return data ? mapRow(data) : null;
                    } catch (err) {
                        throw pgError("load share link", err);
                    }
                }),
            );
        },
        async listForHousehold(householdId, opts) {
            const now = (opts?.now ?? new Date()).toISOString();
            const includeInactive = opts?.includeInactive === true;
            return run(async (tx) => {
                try {
                    const data = await rows<Row>(
                        tx,
                        tx`
                            select ${tx.unsafe(COLS)}
                            from ${tx.unsafe(SHARE_LINKS)}
                            where household_id = ${householdId}
                              and (
                                  ${includeInactive}::boolean
                                  or (
                                      revoked_at is null
                                      and (
                                          expires_at is null
                                          or expires_at > ${now}::timestamptz
                                      )
                                  )
                              )
                            order by created_at desc, id desc
                        `,
                    );
                    return data.map(mapRow);
                } catch (err) {
                    throw pgError("list share links", err);
                }
            });
        },
        async revoke(householdId, id, now) {
            // An id from a tool call may not be a uuid; Postgres would fail the
            // cast rather than find nothing.
            if (!UUID_RE.test(id)) return null;
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Row>(
                        tx,
                        tx`
                            update ${tx.unsafe(SHARE_LINKS)}
                            set revoked_at = coalesce(
                                revoked_at, ${now.toISOString()}::timestamptz
                            )
                            where household_id = ${householdId}
                              and id = ${id}
                            returning ${tx.unsafe(COLS)}
                        `,
                        "revoke share link",
                    );
                    return data ? mapRow(data) : null;
                } catch (err) {
                    throw pgError("revoke share link", err);
                }
            });
        },
    };
}
