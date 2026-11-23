import {
    dismissalKey,
    dismissalKeyString,
    type DismissalKey,
    type NoticeDismissal,
    type NoticeDismissalsStore,
} from "./notice-dismissals.js";
import { noticeCodeDismissible } from "../copy/notices.js";
import type { Notice, NoticeCode } from "./notices.js";
import {
    NOTIFICATION_KINDS,
    isNotificationKind,
    kindForNoticeCode,
    type NotificationBucket,
    type NotificationKind,
    type NotificationSource,
} from "./notification-kinds.js";
import {
    can,
    type PermissionActor,
    type PermissionRole,
} from "./permissions.js";
import { dateInTz, parseLoggedAt, shiftLocalDate, zonedHourUtc } from "./tz.js";

/** One stored notification: one row per person. Timestamps are ISO strings. */
export type NotificationRow = {
    id: string;
    householdId: string;
    recipientUserId: string;
    kind: NotificationKind;
    bucket: NotificationBucket;
    source: NotificationSource;
    /** A condition's `dismissalKeyString`, or `event:<uuid>`. */
    noticeKey: string;
    subjectKind: string | null;
    subjectId: string | null;
    actorUserId: string | null;
    /** Sentence parameters; an event freezes its names here at write time. */
    payload: Record<string, unknown>;
    createdAt: string;
    readAt: string | null;
    snoozedUntil: string | null;
    snoozedBy: string | null;
    dismissedAt: string | null;
    dismissedBy: string | null;
    resolvedAt: string | null;
};

/** The state fields a store may change on an existing row. */
export type NotificationPatch = Partial<
    Pick<
        NotificationRow,
        | "readAt"
        | "snoozedUntil"
        | "snoozedBy"
        | "dismissedAt"
        | "dismissedBy"
        | "resolvedAt"
    >
>;

/** A person's choice for one kind. A row exists only when it differs from the
 * kind's default. */
export type NotificationPref = {
    householdId: string;
    userId: string;
    kind: NotificationKind;
    enabled: boolean;
    updatedAt: string;
};

/** A new payload for one stored row. */
export type PayloadUpdate = {
    id: string;
    payload: Record<string, unknown>;
};

export type NotificationMember = { userId: string; role: PermissionRole };

export type NotificationsStore = {
    listForHousehold(householdId: string): Promise<NotificationRow[]>;
    /** The household's unresolved condition rows: what a sync compares the
     * current notices against. */
    listOpenConditions(householdId: string): Promise<NotificationRow[]>;
    listForRecipient(
        householdId: string,
        userId: string,
    ): Promise<NotificationRow[]>;
    get(householdId: string, id: string): Promise<NotificationRow | null>;
    /** Inserts the rows, skipping one whose recipient already has an open row
     * with the same `noticeKey`. Returns the rows it inserted. */
    insertMany(rows: readonly NotificationRow[]): Promise<NotificationRow[]>;
    update(
        householdId: string,
        ids: readonly string[],
        patch: NotificationPatch,
    ): Promise<NotificationRow[]>;
    /** Replaces the payload of each named row. Only a sync calls it, for open
     * condition rows whose sentence parameters changed. */
    updatePayloads(
        householdId: string,
        updates: readonly PayloadUpdate[],
    ): Promise<NotificationRow[]>;
    /** Updates every unresolved row of the household with this key. With
     * `skipDismissed`, a row that is already dismissed is left as it is. With
     * `keepOwnSnoozeFrom`, a row whose recipient snoozed it themselves to that
     * time or later is left as it is (a snooze someone else set is replaced). */
    updateOpenByKey(
        householdId: string,
        noticeKey: string,
        patch: NotificationPatch,
        options?: { skipDismissed?: boolean; keepOwnSnoozeFrom?: string },
    ): Promise<NotificationRow[]>;
    /** Rows dismissed or resolved before `before`: the sweep's candidates. */
    listForSweep(before: string): Promise<NotificationRow[]>;
    deleteMany(ids: readonly string[]): Promise<number>;
    listPrefs(householdId: string, userId: string): Promise<NotificationPref[]>;
    listHouseholdPrefs(householdId: string): Promise<NotificationPref[]>;
    upsertPref(pref: NotificationPref): Promise<NotificationPref>;
    deletePref(
        householdId: string,
        userId: string,
        kind: NotificationKind,
    ): Promise<boolean>;
};

export type NotificationsDeps = {
    store: NotificationsStore;
    /** The household-wide dismissals: the one place a dismiss for everyone of a
     * dismissible condition is stored. */
    dismissals: NoticeDismissalsStore;
};

export function createMemoryNotificationsStore(): NotificationsStore {
    const rows: NotificationRow[] = [];
    const prefs: NotificationPref[] = [];
    const copy = (row: NotificationRow): NotificationRow => ({
        ...row,
        payload: structuredClone(row.payload),
    });
    const apply = (row: NotificationRow, patch: NotificationPatch) => {
        for (const [field, value] of Object.entries(patch)) {
            if (value !== undefined) {
                (row as Record<string, unknown>)[field] = value;
            }
        }
    };

    return {
        async listForHousehold(householdId) {
            return rows.filter((r) => r.householdId === householdId).map(copy);
        },
        async listOpenConditions(householdId) {
            return rows
                .filter(
                    (r) =>
                        r.householdId === householdId &&
                        r.source === "condition" &&
                        r.resolvedAt === null,
                )
                .map(copy);
        },
        async listForRecipient(householdId, userId) {
            return rows
                .filter(
                    (r) =>
                        r.householdId === householdId &&
                        r.recipientUserId === userId,
                )
                .map(copy);
        },
        async get(householdId, id) {
            const row = rows.find(
                (r) => r.householdId === householdId && r.id === id,
            );
            return row ? copy(row) : null;
        },
        async insertMany(input) {
            const inserted: NotificationRow[] = [];
            for (const row of input) {
                const clash = rows.some(
                    (r) =>
                        r.recipientUserId === row.recipientUserId &&
                        r.noticeKey === row.noticeKey &&
                        r.resolvedAt === null &&
                        row.resolvedAt === null,
                );
                if (clash) continue;
                rows.push(copy(row));
                inserted.push(copy(row));
            }
            return inserted;
        },
        async update(householdId, ids, patch) {
            const want = new Set(ids);
            const out: NotificationRow[] = [];
            for (const row of rows) {
                if (row.householdId !== householdId || !want.has(row.id)) {
                    continue;
                }
                apply(row, patch);
                out.push(copy(row));
            }
            return out;
        },
        async updatePayloads(householdId, updates) {
            const out: NotificationRow[] = [];
            for (const { id, payload } of updates) {
                const row = rows.find(
                    (r) => r.householdId === householdId && r.id === id,
                );
                if (!row) continue;
                row.payload = structuredClone(payload);
                out.push(copy(row));
            }
            return out;
        },
        async updateOpenByKey(householdId, noticeKey, patch, options) {
            const out: NotificationRow[] = [];
            for (const row of rows) {
                if (
                    row.householdId !== householdId ||
                    row.noticeKey !== noticeKey ||
                    row.resolvedAt !== null ||
                    (options?.skipDismissed && row.dismissedAt !== null) ||
                    (options?.keepOwnSnoozeFrom !== undefined &&
                        row.snoozedUntil !== null &&
                        row.snoozedBy === row.recipientUserId &&
                        row.snoozedUntil >= options.keepOwnSnoozeFrom)
                ) {
                    continue;
                }
                apply(row, patch);
                out.push(copy(row));
            }
            return out;
        },
        async listForSweep(before) {
            return rows
                .filter(
                    (r) =>
                        (r.dismissedAt !== null && r.dismissedAt < before) ||
                        (r.resolvedAt !== null && r.resolvedAt < before),
                )
                .map(copy);
        },
        async deleteMany(ids) {
            const drop = new Set(ids);
            let removed = 0;
            for (let i = rows.length - 1; i >= 0; i--) {
                if (drop.has(rows[i]!.id)) {
                    rows.splice(i, 1);
                    removed++;
                }
            }
            return removed;
        },
        async listPrefs(householdId, userId) {
            return prefs
                .filter(
                    (p) => p.householdId === householdId && p.userId === userId,
                )
                .map((p) => ({ ...p }));
        },
        async listHouseholdPrefs(householdId) {
            return prefs
                .filter((p) => p.householdId === householdId)
                .map((p) => ({ ...p }));
        },
        async upsertPref(pref) {
            const at = prefs.findIndex(
                (p) => p.userId === pref.userId && p.kind === pref.kind,
            );
            if (at >= 0) prefs[at] = { ...pref };
            else prefs.push({ ...pref });
            return { ...pref };
        },
        async deletePref(householdId, userId, kind) {
            const at = prefs.findIndex(
                (p) =>
                    p.householdId === householdId &&
                    p.userId === userId &&
                    p.kind === kind,
            );
            if (at < 0) return false;
            prefs.splice(at, 1);
            return true;
        },
    };
}

/** The inbox kind a notice feeds, or null when it is not a notification (a
 * data-quality mark, a plan gap, restocked). */
export function inboxKindForNotice(notice: Notice): NotificationKind | null {
    return kindForNoticeCode(notice.code);
}

export type SyncInput = {
    householdId: string;
    /** The current notices, household-dismissed ones included: a dismissed
     * condition that is still true must read as true and stay open. */
    notices: readonly Notice[];
    rows: readonly NotificationRow[];
    members: readonly NotificationMember[];
    now: Date;
    newId?: () => string;
};

export type SyncPlan = {
    insert: NotificationRow[];
    resolve: string[];
    /** Open rows whose condition is still true but whose sentence parameters
     * have changed (days left, an amount). */
    update: PayloadUpdate[];
};

/** The payload a condition row stores: what its sentence is built from. */
function conditionPayload(notice: Notice): Record<string, unknown> {
    return {
        code: notice.code,
        params: notice.params,
        related: notice.related,
    };
}

/** A canonical text for a JSON value: object keys sorted, so two values that
 * differ only in key order (what a jsonb column hands back) compare equal. */
function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
        return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/** What to write so the stored rows match the conditions that are true now.
 * Personal kinds go only to the member they name, household kinds to every
 * member. An open row whose condition is gone is resolved for everyone, and
 * one whose condition is still true but reads differently now gets the new
 * payload (an event row never does: it keeps what it froze). A household
 * dismissal (`notice_dismissals`) is not copied onto rows: a row under one
 * starts undismissed and `inboxFor` hides it. */
export function syncConditions(input: SyncInput): SyncPlan {
    const newId = input.newId ?? (() => crypto.randomUUID());
    const nowIso = input.now.toISOString();
    const open = new Map<string, NotificationRow>();
    for (const row of input.rows) {
        if (row.source === "condition" && row.resolvedAt === null) {
            open.set(`${row.recipientUserId}|${row.noticeKey}`, row);
        }
    }

    const wanted = new Set<string>();
    const insert: NotificationRow[] = [];
    const update: PayloadUpdate[] = [];
    for (const notice of input.notices) {
        const kind = inboxKindForNotice(notice);
        if (kind === null) continue;
        const spec = NOTIFICATION_KINDS[kind];
        const noticeKey = dismissalKeyString(dismissalKey(notice));
        const recipients =
            spec.bucket === "personal"
                ? input.members.filter(
                      (m) =>
                          notice.subject.kind === "member" &&
                          m.userId === notice.subject.id,
                  )
                : input.members;
        for (const member of recipients) {
            const slot = `${member.userId}|${noticeKey}`;
            if (wanted.has(slot)) continue;
            wanted.add(slot);
            const existing = open.get(slot);
            if (existing) {
                const payload = conditionPayload(notice);
                if (
                    canonicalJson(existing.payload) !== canonicalJson(payload)
                ) {
                    update.push({ id: existing.id, payload });
                }
                continue;
            }
            insert.push({
                id: newId(),
                householdId: input.householdId,
                recipientUserId: member.userId,
                kind,
                bucket: spec.bucket,
                source: "condition",
                noticeKey,
                subjectKind: notice.subject.kind,
                subjectId: notice.subject.id,
                actorUserId: null,
                payload: conditionPayload(notice),
                createdAt: nowIso,
                readAt: null,
                snoozedUntil: null,
                snoozedBy: null,
                dismissedAt: null,
                dismissedBy: null,
                resolvedAt: null,
            });
        }
    }

    const resolve = input.rows
        .filter(
            (row) =>
                row.source === "condition" &&
                row.resolvedAt === null &&
                !wanted.has(`${row.recipientUserId}|${row.noticeKey}`),
        )
        .map((row) => row.id);
    return { insert, resolve, update };
}

/** `syncConditions` against a store: reads the open condition rows, then
 * writes the plan (nothing when there is nothing to change). */
export async function syncHouseholdConditions(
    deps: NotificationsDeps,
    input: {
        householdId: string;
        notices: readonly Notice[];
        members: readonly NotificationMember[];
        now: Date;
        newId?: () => string;
    },
): Promise<SyncPlan> {
    const rows = await deps.store.listOpenConditions(input.householdId);
    const plan = syncConditions({ ...input, rows });
    if (plan.insert.length > 0) await deps.store.insertMany(plan.insert);
    if (plan.resolve.length > 0) {
        await deps.store.update(input.householdId, plan.resolve, {
            resolvedAt: input.now.toISOString(),
        });
    }
    if (plan.update.length > 0) {
        await deps.store.updatePayloads(input.householdId, plan.update);
    }
    return plan;
}

/** Why a notification action was refused. `forbidden` carries the reason
 * `can()` gave; `not_found` is a row that does not exist (or is not open);
 * `locked` is a kind that is always on and never dismissed (Allergens);
 * `invalid` is input that makes no sense (a snooze in the past). */
export class NotificationActionError extends Error {
    readonly reason: string;

    constructor(
        readonly code: "forbidden" | "not_found" | "locked" | "invalid",
        reason: string,
    ) {
        super(reason);
        this.name = "NotificationActionError";
        this.reason = reason;
    }
}

/** Whether the person gets this kind: the registry default unless they have a
 * row. `prefs` are one person's rows. Allergens is on whatever a row says. */
export function kindEnabled(
    prefs: readonly Pick<NotificationPref, "kind" | "enabled">[],
    kind: NotificationKind,
): boolean {
    const spec = NOTIFICATION_KINDS[kind];
    if (!spec.canDisable) return true;
    const row = prefs.find((p) => p.kind === kind);
    return row ? row.enabled : spec.defaultOn;
}

export type NotificationEvent = {
    kind: NotificationKind;
    subjectKind?: string | null;
    subjectId?: string | null;
    /** Sentence parameters, names frozen at write time. */
    payload: Record<string, unknown>;
    /** One id for the whole fan-out; made when absent. */
    eventId?: string;
};

/** The rows an event writes: one per member, except the person who acted
 * (an agent's action counts as its person's) and every member with the kind
 * off. All rows share one `event:<uuid>` key. */
export function fanOutEvent(input: {
    householdId: string;
    event: NotificationEvent;
    actorUserId: string | null;
    members: readonly NotificationMember[];
    /** Every member's preference rows. */
    prefs: readonly NotificationPref[];
    now: Date;
    newId?: () => string;
}): NotificationRow[] {
    const spec = NOTIFICATION_KINDS[input.event.kind];
    if (spec.source !== "event") {
        throw new Error(`${input.event.kind} is a condition, not an event`);
    }
    const newId = input.newId ?? (() => crypto.randomUUID());
    const noticeKey = `event:${input.event.eventId ?? crypto.randomUUID()}`;
    return input.members
        .filter((m) => m.userId !== input.actorUserId)
        .filter((m) =>
            kindEnabled(
                input.prefs.filter((p) => p.userId === m.userId),
                input.event.kind,
            ),
        )
        .map((m) => ({
            id: newId(),
            householdId: input.householdId,
            recipientUserId: m.userId,
            kind: input.event.kind,
            bucket: spec.bucket,
            source: "event",
            noticeKey,
            subjectKind: input.event.subjectKind ?? null,
            subjectId: input.event.subjectId ?? null,
            actorUserId: input.actorUserId,
            payload: { ...input.event.payload },
            createdAt: input.now.toISOString(),
            readAt: null,
            snoozedUntil: null,
            snoozedBy: null,
            dismissedAt: null,
            dismissedBy: null,
            resolvedAt: null,
        }));
}

/** Whether a row counts as new to its person: never opened, or back from a
 * snooze that ended after they last opened it. The one rule for "unread": the
 * bell's dot, the inbox, `list_notices` and `markRead` all ask it, so marking
 * read clears whatever made a row new. */
export function isNewNotification(
    row: Pick<NotificationRow, "readAt" | "snoozedUntil">,
    now: Date,
): boolean {
    if (row.readAt === null) return true;
    return (
        row.snoozedUntil !== null &&
        row.snoozedUntil <= now.toISOString() &&
        row.readAt < row.snoozedUntil
    );
}

export type Inbox = {
    /** Visible rows that are new (`isNewNotification`), snoozed ones not
     * counted. */
    unread: number;
    today: NotificationRow[];
    earlier: NotificationRow[];
    snoozed: NotificationRow[];
};

/** One person's inbox. Pass that person's rows and preference rows. A row is
 * hidden when it is dismissed, resolved, or its kind is off; a condition also
 * hides under a household dismissal (the one store a dismiss for everyone
 * writes); a personal row honours only the dismissal its own person made.
 * A snooze whose time has passed is back in the list. */
export function inboxFor(input: {
    rows: readonly NotificationRow[];
    prefs: readonly NotificationPref[];
    now: Date;
    bucket?: NotificationBucket | "all";
    /** Household-wide dismissals, to hide a condition they cover. */
    householdDismissals: readonly NoticeDismissal[];
    /** IANA zone that decides which rows are "today". */
    timezone: string;
}): Inbox {
    const tz = input.timezone;
    const nowIso = input.now.toISOString();
    const today = dateInTz(input.now, tz);
    // Key -> who dismissed it (null when unknown).
    const dismissedBy = new Map<string, Set<string | null>>();
    for (const d of input.householdDismissals) {
        const key = dismissalKeyString({
            code: d.code,
            subjectKind: d.subjectKind,
            subjectId: d.subjectId,
            relatedKey: d.relatedKey,
        });
        const who = dismissedBy.get(key) ?? new Set<string | null>();
        who.add(d.dismissedBy);
        dismissedBy.set(key, who);
    }
    const hiddenByHousehold = (row: NotificationRow): boolean => {
        const who = dismissedBy.get(row.noticeKey);
        if (!who) return false;
        // Only its person dismisses a personal notification.
        return row.bucket === "personal" ? who.has(row.recipientUserId) : true;
    };
    const bucket = input.bucket ?? "all";
    const visible = input.rows.filter((row) => {
        if (row.resolvedAt !== null || row.dismissedAt !== null) return false;
        if (bucket !== "all" && row.bucket !== bucket) return false;
        if (!kindEnabled(input.prefs, row.kind)) return false;
        const locked = !NOTIFICATION_KINDS[row.kind].canDisable;
        if (!locked && row.source === "condition" && hiddenByHousehold(row)) {
            return false;
        }
        return true;
    });
    const newestFirst = (a: NotificationRow, b: NotificationRow) =>
        b.createdAt.localeCompare(a.createdAt);
    const waiting = (row: NotificationRow) =>
        row.snoozedUntil !== null && row.snoozedUntil > nowIso;
    const shown = visible.filter((r) => !waiting(r)).sort(newestFirst);
    return {
        unread: shown.filter((r) => isNewNotification(r, input.now)).length,
        today: shown.filter((r) => dateInTz(r.createdAt, tz) === today),
        earlier: shown.filter((r) => dateInTz(r.createdAt, tz) !== today),
        snoozed: visible
            .filter(waiting)
            .sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!)),
    };
}

/** Turn a kind on or off for one person. Only the person themselves can, and
 * Allergens cannot be turned off. A choice equal to the kind's default stores
 * no row (and removes an old one). */
export async function setPref(
    deps: Pick<NotificationsDeps, "store">,
    input: {
        householdId: string;
        actor: PermissionActor;
        userId: string;
        kind: NotificationKind;
        enabled: boolean;
        now: Date;
    },
): Promise<void> {
    if (!isNotificationKind(input.kind)) {
        throw new NotificationActionError(
            "invalid",
            "That is not a notification kind.",
        );
    }
    if (typeof input.enabled !== "boolean") {
        throw new NotificationActionError(
            "invalid",
            "A preference is on or off.",
        );
    }
    const spec = NOTIFICATION_KINDS[input.kind];
    if (!spec.canDisable && !input.enabled) {
        throw new NotificationActionError(
            "locked",
            "Allergen notifications can't be turned off.",
        );
    }
    const allowed = can(input.actor, "notification.act", {
        userId: input.userId,
    });
    if (!allowed.ok) {
        throw new NotificationActionError("forbidden", allowed.reason);
    }
    if (input.enabled === spec.defaultOn) {
        await deps.store.deletePref(
            input.householdId,
            input.userId,
            input.kind,
        );
        return;
    }
    await deps.store.upsertPref({
        householdId: input.householdId,
        userId: input.userId,
        kind: input.kind,
        enabled: input.enabled,
        updatedAt: input.now.toISOString(),
    });
}

const DAY_MS = 86_400_000;

/** The two forms an exact snooze time may take: a date and time with a Z or an
 * offset, or a local date and time (read in the household zone). A date alone,
 * a bare year or a space instead of the T is not a time to snooze to. */
const SNOOZE_AT_SHAPE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** When a snooze ends: tomorrow 9:00 in the household zone, a week from now,
 * or an exact time within the next year (an offset-less one is household-zone
 * wall time). */
export function resolveSnoozeUntil(
    choice: "tomorrow" | "week" | { at: string },
    now: Date,
    timezone: string,
): Date {
    const isAt =
        typeof choice === "object" &&
        choice !== null &&
        typeof (choice as { at?: unknown }).at === "string";
    if (choice !== "tomorrow" && choice !== "week" && !isAt) {
        throw new NotificationActionError(
            "invalid",
            "Snooze until tomorrow, next week, or an exact time.",
        );
    }
    if (choice === "tomorrow") {
        return zonedHourUtc(
            shiftLocalDate(dateInTz(now, timezone), 1),
            timezone,
            9,
        );
    }
    if (choice === "week") return new Date(now.getTime() + 7 * DAY_MS);
    const text = (choice as { at: string }).at.trim();
    const parsed = SNOOZE_AT_SHAPE.test(text)
        ? parseLoggedAt(text, timezone)
        : null;
    if (!parsed || !parsed.ok) {
        throw new NotificationActionError(
            "invalid",
            "That is not a time. Use a date and time, like 2026-12-01T08:30.",
        );
    }
    const at = parsed.value.instant;
    if (at.getTime() <= now.getTime()) {
        throw new NotificationActionError(
            "invalid",
            "A snooze has to end in the future.",
        );
    }
    assertWithinSnoozeCap(at, now);
    return at;
}

/** A snooze ends at most one calendar year from now. */
function assertWithinSnoozeCap(at: Date, now: Date): void {
    const limit = new Date(now.getTime());
    limit.setUTCFullYear(limit.getUTCFullYear() + 1);
    if (at.getTime() > limit.getTime()) {
        throw new NotificationActionError(
            "invalid",
            "A snooze can't be longer than a year.",
        );
    }
}

/** Splits a `dismissalKeyString` back into its parts. A key from an event, or
 * one that does not parse, gives null. */
function parseDismissalKey(noticeKey: string): DismissalKey | null {
    const parts = noticeKey.split("|");
    if (parts.length < 4) return null;
    const [code, subjectKind, subjectId, ...rest] = parts;
    return {
        code: code as NoticeCode,
        subjectKind: subjectKind as DismissalKey["subjectKind"],
        subjectId: subjectId!,
        relatedKey: rest.join("|"),
    };
}

/** The open row an action is about, after the refusals every action shares:
 * it must exist and be open, Allergens never moves, and the actor must own it. */
async function ownOpenRow(
    deps: Pick<NotificationsDeps, "store">,
    input: { householdId: string; actor: PermissionActor; id: string },
    verb: string,
): Promise<NotificationRow> {
    const row = await deps.store.get(input.householdId, input.id);
    if (!row || row.resolvedAt !== null) {
        throw new NotificationActionError("not_found", "No such notification.");
    }
    if (!NOTIFICATION_KINDS[row.kind].canDisable) {
        throw new NotificationActionError(
            "locked",
            `Allergen notifications can't be ${verb}; fix the cause instead.`,
        );
    }
    const mine = can(input.actor, "notification.act", {
        userId: row.recipientUserId,
    });
    if (!mine.ok) throw new NotificationActionError("forbidden", mine.reason);
    return row;
}

/** Dismissing for everyone is for a household row, and for the admin or owner. */
function assertEveryone(
    actor: PermissionActor,
    row: NotificationRow,
    action: "notification.dismiss_everyone",
): void {
    if (row.bucket === "personal") {
        throw new NotificationActionError(
            "forbidden",
            "A personal notification is only for its person.",
        );
    }
    const allowed = can(actor, action);
    if (!allowed.ok) {
        throw new NotificationActionError("forbidden", allowed.reason);
    }
}

/** Scope `me` dismisses the actor's own row; one already dismissed keeps its
 * first time. Scope `everyone` (admin and owner, household rows) lives in one
 * store: a condition whose notice can be dismissed gets a `notice_dismissals`
 * row and no row is stamped (every inbox hides it through that row, and
 * Settings › Dismissed brings it back everywhere by deleting it); anything
 * else (an event, a condition that cannot be dismissed on Kitchen) stamps every
 * open row with the key that is not already dismissed. Returns the rows it
 * changed. */
export async function dismiss(
    deps: NotificationsDeps,
    input: {
        householdId: string;
        actor: PermissionActor;
        id: string;
        scope: "me" | "everyone";
        now: Date;
    },
): Promise<NotificationRow[]> {
    if (input.scope !== "me" && input.scope !== "everyone") {
        throw new NotificationActionError(
            "invalid",
            "Dismiss for me or for everyone.",
        );
    }
    const row = await ownOpenRow(deps, input, "dismissed");
    const patch = {
        dismissedAt: input.now.toISOString(),
        dismissedBy: input.actor.userId,
    };
    if (input.scope === "me") {
        if (row.dismissedAt !== null) return [];
        return deps.store.update(input.householdId, [row.id], patch);
    }
    assertEveryone(input.actor, row, "notification.dismiss_everyone");
    if (row.source === "condition") {
        const key = parseDismissalKey(row.noticeKey);
        // A notice that cannot be dismissed on Kitchen and Today must not get
        // a household dismissal that would hide it there.
        if (key && noticeCodeDismissible(key.code)) {
            await deps.dismissals.insert({
                householdId: input.householdId,
                ...key,
                dismissedBy: input.actor.userId,
            });
            return [];
        }
    }
    return deps.store.updateOpenByKey(input.householdId, row.noticeKey, patch, {
        skipDismissed: true,
    });
}

/** Snooze until `until` (see `resolveSnoozeUntil`). On a household row, an
 * admin or owner snoozes every open row with the same key; anyone else, and
 * any personal row, snoozes only the actor's own. A snooze for everyone
 * leaves alone a row whose own person snoozed it to a later time, and
 * replaces any other (so the one who snoozed can shorten it). A snooze that
 * has passed puts the row back. */
export async function snooze(
    deps: NotificationsDeps,
    input: {
        householdId: string;
        actor: PermissionActor;
        id: string;
        until: Date;
        now: Date;
    },
): Promise<NotificationRow[]> {
    if (!(input.until instanceof Date) || Number.isNaN(input.until.getTime())) {
        throw new NotificationActionError("invalid", "That is not a time.");
    }
    if (input.until.getTime() <= input.now.getTime()) {
        throw new NotificationActionError(
            "invalid",
            "A snooze has to end in the future.",
        );
    }
    assertWithinSnoozeCap(input.until, input.now);
    const row = await ownOpenRow(deps, input, "snoozed");
    const patch = {
        snoozedUntil: input.until.toISOString(),
        snoozedBy: input.actor.userId,
    };
    const everyone =
        row.bucket === "household" &&
        can(input.actor, "notification.snooze_everyone").ok;
    if (!everyone) {
        return deps.store.update(input.householdId, [row.id], patch);
    }
    // Never cut short a snooze a member set on their own row to a later time;
    // the actor's own row always takes the new one.
    const others = await deps.store.updateOpenByKey(
        input.householdId,
        row.noticeKey,
        patch,
        { keepOwnSnoozeFrom: patch.snoozedUntil },
    );
    if (others.some((r) => r.id === row.id)) return others;
    const own = await deps.store.update(input.householdId, [row.id], patch);
    return [...others, ...own];
}

/** Mark the actor's own rows read: the named ids, or `"all"`, every new row
 * the inbox shows (not snoozed, not a kind they turned off, not dismissed). A
 * row that is not new keeps its read time; one back from a snooze is stamped
 * again, so it stops counting as new. Returns the rows it changed. */
export async function markRead(
    deps: NotificationsDeps,
    input: {
        householdId: string;
        actor: PermissionActor;
        ids: readonly string[] | "all";
        now: Date;
    },
): Promise<NotificationRow[]> {
    let rows: NotificationRow[];
    if (input.ids === "all") {
        const [own, prefs, householdDismissals] = await Promise.all([
            deps.store.listForRecipient(input.householdId, input.actor.userId),
            deps.store.listPrefs(input.householdId, input.actor.userId),
            deps.dismissals.listForHousehold(input.householdId),
        ]);
        // The inbox decides what is shown; the zone only splits today from
        // earlier, which does not matter here.
        const inbox = inboxFor({
            rows: own,
            prefs,
            now: input.now,
            householdDismissals,
            timezone: "UTC",
        });
        rows = [...inbox.today, ...inbox.earlier];
    } else {
        rows = [];
        for (const id of input.ids) {
            const row = await deps.store.get(input.householdId, id);
            if (!row) {
                throw new NotificationActionError(
                    "not_found",
                    "No such notification.",
                );
            }
            const mine = can(input.actor, "notification.act", {
                userId: row.recipientUserId,
            });
            if (!mine.ok) {
                throw new NotificationActionError("forbidden", mine.reason);
            }
            rows.push(row);
        }
    }
    const unread = rows
        .filter((r) => r.resolvedAt === null && isNewNotification(r, input.now))
        .map((r) => r.id);
    if (unread.length === 0) return [];
    return deps.store.update(input.householdId, unread, {
        readAt: input.now.toISOString(),
    });
}

/** How long a dismissed event, or a cleared condition, is kept. */
export const SWEEP_AFTER_DAYS = 30;

/** The rows nobody can see any more: event rows dismissed over 30 days ago
 * and condition rows that cleared over 30 days ago. A dismissed condition that
 * is still open is never selected: deleting it would let the next sync bring
 * it back. */
export function sweepable(
    rows: readonly NotificationRow[],
    now: Date,
): NotificationRow[] {
    const cutoff = new Date(
        now.getTime() - SWEEP_AFTER_DAYS * DAY_MS,
    ).toISOString();
    return rows.filter((row) =>
        row.source === "event"
            ? row.dismissedAt !== null && row.dismissedAt < cutoff
            : row.resolvedAt !== null && row.resolvedAt < cutoff,
    );
}

/** Delete what `sweepable` selects. Returns how many rows went. */
export async function sweepNotifications(
    deps: Pick<NotificationsDeps, "store">,
    now: Date,
): Promise<number> {
    const cutoff = new Date(now.getTime() - SWEEP_AFTER_DAYS * DAY_MS);
    const candidates = await deps.store.listForSweep(cutoff.toISOString());
    const ids = sweepable(candidates, now).map((r) => r.id);
    return ids.length === 0 ? 0 : deps.store.deleteMany(ids);
}

/** A `public.notifications` row as the database returns it. */
export type NotificationDbRow = {
    id: string;
    household_id: string;
    recipient_user_id: string;
    kind: string;
    bucket: string;
    source: string;
    notice_key: string;
    subject_kind: string | null;
    subject_id: string | null;
    actor_user_id: string | null;
    payload: Record<string, unknown>;
    created_at: string | Date;
    read_at: string | Date | null;
    snoozed_until: string | Date | null;
    snoozed_by: string | null;
    dismissed_at: string | Date | null;
    dismissed_by: string | null;
    resolved_at: string | Date | null;
};

const iso = (v: string | Date): string =>
    v instanceof Date ? v.toISOString() : new Date(v).toISOString();
const isoOrNull = (v: string | Date | null): string | null =>
    v === null ? null : iso(v);

export function notificationFromDb(row: NotificationDbRow): NotificationRow {
    return {
        id: row.id,
        householdId: row.household_id,
        recipientUserId: row.recipient_user_id,
        kind: row.kind as NotificationKind,
        bucket: row.bucket as NotificationBucket,
        source: row.source as NotificationSource,
        noticeKey: row.notice_key,
        subjectKind: row.subject_kind,
        subjectId: row.subject_id,
        actorUserId: row.actor_user_id,
        payload: row.payload,
        createdAt: iso(row.created_at),
        readAt: isoOrNull(row.read_at),
        snoozedUntil: isoOrNull(row.snoozed_until),
        snoozedBy: row.snoozed_by,
        dismissedAt: isoOrNull(row.dismissed_at),
        dismissedBy: row.dismissed_by,
        resolvedAt: isoOrNull(row.resolved_at),
    };
}

export function notificationToDb(row: NotificationRow): NotificationDbRow {
    return {
        id: row.id,
        household_id: row.householdId,
        recipient_user_id: row.recipientUserId,
        kind: row.kind,
        bucket: row.bucket,
        source: row.source,
        notice_key: row.noticeKey,
        subject_kind: row.subjectKind,
        subject_id: row.subjectId,
        actor_user_id: row.actorUserId,
        payload: row.payload,
        created_at: row.createdAt,
        read_at: row.readAt,
        snoozed_until: row.snoozedUntil,
        snoozed_by: row.snoozedBy,
        dismissed_at: row.dismissedAt,
        dismissed_by: row.dismissedBy,
        resolved_at: row.resolvedAt,
    };
}

/** A `public.notification_prefs` row as the database returns it. */
export type NotificationPrefDbRow = {
    household_id: string;
    user_id: string;
    kind: string;
    enabled: boolean;
    updated_at: string | Date;
};

export function notificationPrefFromDb(
    row: NotificationPrefDbRow,
): NotificationPref {
    return {
        householdId: row.household_id,
        userId: row.user_id,
        kind: row.kind as NotificationKind,
        enabled: row.enabled,
        updatedAt: iso(row.updated_at),
    };
}

export function notificationPrefToDb(
    pref: NotificationPref,
): NotificationPrefDbRow {
    return {
        household_id: pref.householdId,
        user_id: pref.userId,
        kind: pref.kind,
        enabled: pref.enabled,
        updated_at: pref.updatedAt,
    };
}
