import {
    type DismissalKey,
    type NoticeDismissal,
    type NoticeDismissalsStore,
    type NoticeSubjectKind,
} from "../domain/notice-dismissals.js";
import type { NoticeCode } from "../domain/notices.js";
import {
    insertReturning,
    maybeOne,
    pgError,
    rows,
    run,
    type Tx,
} from "./sql.js";

const NOTICE_DISMISSALS = "notice_dismissals";
const NOTICE_DISMISSAL_COLS =
    "id, household_id, code, subject_kind, subject_id, related_key, dismissed_by, created_at";

export function noticeDismissalFromRow(
    row: Record<string, unknown>,
): NoticeDismissal {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        code: String(row.code) as NoticeCode,
        subjectKind: String(row.subject_kind) as NoticeSubjectKind,
        subjectId: String(row.subject_id),
        relatedKey: String(row.related_key ?? ""),
        dismissedBy: row.dismissed_by != null ? String(row.dismissed_by) : null,
        createdAt: String(row.created_at),
    };
}

function noticeDismissalToRow(
    row: Omit<NoticeDismissal, "createdAt"> & { createdAt?: string },
): Record<string, unknown> {
    return {
        id: row.id,
        household_id: row.householdId,
        code: row.code,
        subject_kind: row.subjectKind,
        subject_id: row.subjectId,
        related_key: row.relatedKey,
        dismissed_by: row.dismissedBy,
    };
}

async function selectDismissalByKey(
    tx: Tx,
    householdId: string,
    key: DismissalKey,
): Promise<NoticeDismissal | null> {
    const data = await maybeOne<Record<string, unknown>>(
        tx,
        tx`
            select ${tx.unsafe(NOTICE_DISMISSAL_COLS)}
            from ${tx.unsafe(NOTICE_DISMISSALS)}
            where household_id = ${householdId}
              and code = ${key.code}
              and subject_kind = ${key.subjectKind}
              and subject_id = ${key.subjectId}::uuid
              and related_key = ${key.relatedKey}
        `,
        "get notice dismissal",
    );
    return data ? noticeDismissalFromRow(data) : null;
}

export async function cleanupDismissalsForSubjectTx(
    tx: Tx,
    householdId: string,
    subjectKind: NoticeSubjectKind,
    subjectId: string,
): Promise<void> {
    await tx`
        delete from ${tx.unsafe(NOTICE_DISMISSALS)}
        where household_id = ${householdId}
          and subject_kind = ${subjectKind}
          and subject_id = ${subjectId}::uuid
    `;
}

export async function cleanupDismissalsForRelatedKeyTx(
    tx: Tx,
    householdId: string,
    relatedKey: string,
): Promise<void> {
    if (!relatedKey) return;
    await tx`
        delete from ${tx.unsafe(NOTICE_DISMISSALS)}
        where household_id = ${householdId}
          and related_key = ${relatedKey}
    `;
}

export async function cleanupDismissalsForFoodTx(
    tx: Tx,
    householdId: string,
    foodId: string,
): Promise<void> {
    await cleanupDismissalsForSubjectTx(tx, householdId, "food", foodId);
    await cleanupDismissalsForRelatedKeyTx(tx, householdId, foodId);
}

export async function cleanupDismissalsForFridgeLocationTx(
    tx: Tx,
    householdId: string,
    locationId: string,
): Promise<void> {
    await tx`
        delete from ${tx.unsafe(NOTICE_DISMISSALS)}
        where household_id = ${householdId}
          and subject_kind = 'fridge_item'
          and subject_id in (
              select id from fridge_items
              where household_id = ${householdId}
                and location_id = ${locationId}::uuid
          )
    `;
}

export async function cleanupDismissalsForRecipeTx(
    tx: Tx,
    householdId: string,
    recipeId: string,
): Promise<void> {
    await tx`
        delete from ${tx.unsafe(NOTICE_DISMISSALS)}
        where household_id = ${householdId}
          and subject_kind = 'recipe_ingredient'
          and subject_id in (
              select id from recipe_ingredients
              where household_id = ${householdId}
                and recipe_id = ${recipeId}::uuid
          )
    `;
    await cleanupDismissalsForSubjectTx(tx, householdId, "recipe", recipeId);
}

export function liveNoticeDismissalsStore(): NoticeDismissalsStore {
    return {
        async listForHousehold(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(NOTICE_DISMISSAL_COLS)}
                            from ${tx.unsafe(NOTICE_DISMISSALS)}
                            where household_id = ${householdId}
                            order by created_at desc
                        `,
                    );
                    return data.map((row) =>
                        noticeDismissalFromRow(row as Record<string, unknown>),
                    );
                } catch (err) {
                    throw pgError("list notice dismissals", err);
                }
            });
        },
        async insert(row) {
            return run(async (tx) => {
                const id = row.id ?? crypto.randomUUID();
                try {
                    const inserted = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            insert into ${tx.unsafe(NOTICE_DISMISSALS)} (
                                id, household_id, code, subject_kind, subject_id,
                                related_key, dismissed_by
                            )
                            values (
                                ${id}::uuid,
                                ${row.householdId},
                                ${row.code},
                                ${row.subjectKind},
                                ${row.subjectId}::uuid,
                                ${row.relatedKey},
                                ${row.dismissedBy}
                            )
                            on conflict (household_id, code, subject_kind, subject_id, related_key)
                            do nothing
                            returning ${tx.unsafe(NOTICE_DISMISSAL_COLS)}
                        `,
                        "dismiss notice",
                    );
                    if (inserted) {
                        return noticeDismissalFromRow(inserted);
                    }
                    const existing = await selectDismissalByKey(
                        tx,
                        row.householdId,
                        {
                            code: row.code,
                            subjectKind: row.subjectKind,
                            subjectId: row.subjectId,
                            relatedKey: row.relatedKey,
                        },
                    );
                    if (!existing) {
                        throw pgError(
                            "dismiss notice",
                            new Error("insert conflict but row missing"),
                        );
                    }
                    return existing;
                } catch (err) {
                    throw pgError("dismiss notice", err);
                }
            });
        },
        async delete(householdId, key) {
            return run(async (tx) => {
                const data = await rows<{ id: string }>(
                    tx,
                    tx`
                        delete from ${tx.unsafe(NOTICE_DISMISSALS)}
                        where household_id = ${householdId}
                          and code = ${key.code}
                          and subject_kind = ${key.subjectKind}
                          and subject_id = ${key.subjectId}::uuid
                          and related_key = ${key.relatedKey}
                        returning id
                    `,
                );
                return data.length > 0;
            });
        },
        async deleteById(householdId, id) {
            return run(async (tx) => {
                const data = await rows<{ id: string }>(
                    tx,
                    tx`
                        delete from ${tx.unsafe(NOTICE_DISMISSALS)}
                        where household_id = ${householdId}
                          and id = ${id}::uuid
                        returning id
                    `,
                );
                return data.length > 0;
            });
        },
        async deleteForSubject(householdId, subjectKind, subjectId) {
            return run(async (tx) => {
                await cleanupDismissalsForSubjectTx(
                    tx,
                    householdId,
                    subjectKind,
                    subjectId,
                );
            });
        },
        async deleteForRelatedKey(householdId, relatedKey) {
            return run(async (tx) => {
                await cleanupDismissalsForRelatedKeyTx(
                    tx,
                    householdId,
                    relatedKey,
                );
            });
        },
    };
}
