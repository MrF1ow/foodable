import type { Notice, NoticeCode, NoticeSubject } from "./notices.js";
import { NOTICE_SEVERITY } from "./notices.js";
import {
    NOTICE_COPY,
    noticeCodeDismissible,
    noticeDismissPair,
    noticeDismissScope,
} from "../copy/notices.js";

export type NoticeSubjectKind = NoticeSubject["kind"];

export type NoticeDismissal = {
    id: string;
    householdId: string;
    code: NoticeCode;
    subjectKind: NoticeSubjectKind;
    subjectId: string;
    relatedKey: string;
    dismissedBy: string | null;
    createdAt: string;
};

export type DismissalKey = {
    code: NoticeCode;
    subjectKind: NoticeSubjectKind;
    subjectId: string;
    relatedKey: string;
};

export type NoticeDismissalsStore = {
    listForHousehold(householdId: string): Promise<NoticeDismissal[]>;
    insert(
        row: Omit<NoticeDismissal, "id" | "createdAt"> & { id?: string },
    ): Promise<NoticeDismissal>;
    delete(householdId: string, key: DismissalKey): Promise<boolean>;
    deleteById(householdId: string, id: string): Promise<boolean>;
    deleteForSubject(
        householdId: string,
        subjectKind: NoticeSubjectKind,
        subjectId: string,
    ): Promise<void>;
    deleteForRelatedKey(householdId: string, relatedKey: string): Promise<void>;
};

export function dismissalKeyString(key: DismissalKey): string {
    return `${key.code}|${key.subjectKind}|${key.subjectId}|${key.relatedKey}`;
}

/** Order pair subjects so subject_id is the smaller uuid and related_key the larger. */
export function normalizePairIds(
    idA: string,
    idB: string,
): {
    subjectId: string;
    relatedKey: string;
} {
    if (idA === idB) {
        return { subjectId: idA, relatedKey: "" };
    }
    if (idA < idB) return { subjectId: idA, relatedKey: idB };
    return { subjectId: idB, relatedKey: idA };
}

export function dismissalKey(notice: Notice): DismissalKey {
    const subject = notice.subject;
    if (noticeDismissPair(notice.code)) {
        const foodRel = notice.related.find((r) => r.kind === "food");
        if (foodRel) {
            const pair = normalizePairIds(subject.id, foodRel.id);
            return {
                code: notice.code,
                subjectKind: subject.kind,
                subjectId: pair.subjectId,
                relatedKey: pair.relatedKey,
            };
        }
    }
    return {
        code: notice.code,
        subjectKind: subject.kind,
        subjectId: subject.id,
        // Empty unless the notice ties its dismissal to something that changes.
        relatedKey: noticeDismissScope(notice),
    };
}

export function lookupDismissalKey(
    code: NoticeCode,
    subjectKind: NoticeSubjectKind,
    subjectId: string,
    relatedId?: string,
): DismissalKey {
    if (noticeDismissPair(code) && relatedId) {
        const pair = normalizePairIds(subjectId, relatedId);
        return {
            code,
            subjectKind,
            subjectId: pair.subjectId,
            relatedKey: pair.relatedKey,
        };
    }
    return { code, subjectKind, subjectId, relatedKey: relatedId ?? "" };
}

export function isDismissedIn(
    notice: Notice,
    dismissed: ReadonlySet<string>,
): boolean {
    const key = dismissalKey(notice);
    if (dismissed.has(dismissalKeyString(key))) return true;
    if (noticeDismissPair(notice.code)) {
        const alt = lookupDismissalKey(
            notice.code,
            notice.subject.kind,
            notice.subject.id,
            notice.related.find((r) => r.kind === "food")?.id,
        );
        return dismissed.has(dismissalKeyString(alt));
    }
    return false;
}

export function isDismissed(
    notice: Notice,
    dismissals: readonly NoticeDismissal[],
): boolean {
    return isDismissedIn(notice, dismissedKeySet(dismissals));
}

export function dismissedKeySet(
    dismissals: readonly NoticeDismissal[],
): Set<string> {
    const set = new Set<string>();
    for (const row of dismissals) {
        set.add(
            dismissalKeyString({
                code: row.code,
                subjectKind: row.subjectKind,
                subjectId: row.subjectId,
                relatedKey: row.relatedKey,
            }),
        );
    }
    return set;
}

export class NoticeDismissError extends Error {
    readonly code = "notice_dismiss" as const;

    constructor(message: string) {
        super(message);
        this.name = "NoticeDismissError";
    }
}

export function createMemoryNoticeDismissalsStore(): NoticeDismissalsStore {
    const rows: NoticeDismissal[] = [];

    return {
        async listForHousehold(householdId) {
            return rows
                .filter((row) => row.householdId === householdId)
                .slice()
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        },
        async insert(row) {
            const key = dismissalKeyString({
                code: row.code,
                subjectKind: row.subjectKind,
                subjectId: row.subjectId,
                relatedKey: row.relatedKey,
            });
            const existing = rows.find(
                (r) =>
                    r.householdId === row.householdId &&
                    dismissalKeyString({
                        code: r.code,
                        subjectKind: r.subjectKind,
                        subjectId: r.subjectId,
                        relatedKey: r.relatedKey,
                    }) === key,
            );
            if (existing) return { ...existing };
            const saved: NoticeDismissal = {
                id: row.id ?? crypto.randomUUID(),
                householdId: row.householdId,
                code: row.code,
                subjectKind: row.subjectKind,
                subjectId: row.subjectId,
                relatedKey: row.relatedKey,
                dismissedBy: row.dismissedBy,
                createdAt: new Date().toISOString(),
            };
            rows.push(saved);
            return { ...saved };
        },
        async delete(householdId, key) {
            const want = dismissalKeyString(key);
            const before = rows.length;
            const next = rows.filter(
                (r) =>
                    !(
                        r.householdId === householdId &&
                        dismissalKeyString({
                            code: r.code,
                            subjectKind: r.subjectKind,
                            subjectId: r.subjectId,
                            relatedKey: r.relatedKey,
                        }) === want
                    ),
            );
            rows.length = 0;
            rows.push(...next);
            return next.length < before;
        },
        async deleteById(householdId, id) {
            const before = rows.length;
            const next = rows.filter(
                (r) => !(r.householdId === householdId && r.id === id),
            );
            rows.length = 0;
            rows.push(...next);
            return next.length < before;
        },
        async deleteForSubject(householdId, subjectKind, subjectId) {
            const next = rows.filter(
                (r) =>
                    !(
                        r.householdId === householdId &&
                        r.subjectKind === subjectKind &&
                        r.subjectId === subjectId
                    ),
            );
            rows.length = 0;
            rows.push(...next);
        },
        async deleteForRelatedKey(householdId, relatedKey) {
            const next = rows.filter(
                (r) =>
                    !(
                        r.householdId === householdId &&
                        r.relatedKey === relatedKey
                    ),
            );
            rows.length = 0;
            rows.push(...next);
        },
    };
}

export type MemoryNoticeDismissalsHolder = {
    linkDismissals(store: NoticeDismissalsStore): void;
    dismissalsStore(): NoticeDismissalsStore | undefined;
};

export async function cleanupDismissalsForSubject(
    dismissals: NoticeDismissalsStore | undefined,
    householdId: string,
    subjectKind: NoticeSubjectKind,
    subjectId: string,
): Promise<void> {
    if (!dismissals) return;
    await dismissals.deleteForSubject(householdId, subjectKind, subjectId);
}

export async function cleanupDismissalsForFood(
    dismissals: NoticeDismissalsStore | undefined,
    householdId: string,
    foodId: string,
): Promise<void> {
    if (!dismissals) return;
    await dismissals.deleteForSubject(householdId, "food", foodId);
    await dismissals.deleteForRelatedKey(householdId, foodId);
}

export async function cleanupDismissalsForFridgeLocation(
    dismissals: NoticeDismissalsStore | undefined,
    householdId: string,
    locationId: string,
    itemIds: readonly string[],
): Promise<void> {
    if (!dismissals) return;
    for (const id of itemIds) {
        await dismissals.deleteForSubject(householdId, "fridge_item", id);
    }
}

export async function cleanupDismissalsForRecipe(
    dismissals: NoticeDismissalsStore | undefined,
    householdId: string,
    recipeId: string,
    ingredientIds: readonly string[],
): Promise<void> {
    if (!dismissals) return;
    for (const ingredientId of ingredientIds) {
        await dismissals.deleteForSubject(
            householdId,
            "recipe_ingredient",
            ingredientId,
        );
    }
    await dismissals.deleteForSubject(householdId, "recipe", recipeId);
}

export function assertDismissibleCode(code: NoticeCode): void {
    if (!NOTICE_COPY[code]) {
        throw new NoticeDismissError("Unknown notice.");
    }
    // The registry says what can be dismissed; a block never can. Running low
    // and missing-for-plan are warnings that the person may still dismiss.
    if (NOTICE_SEVERITY[code] === "block" || !noticeCodeDismissible(code)) {
        throw new NoticeDismissError(
            "This notice can't be dismissed; fix the cause instead.",
        );
    }
}
