import { NOTICE_SEVERITY, type Notice } from "../domain/notices.js";
import type { NotificationKind } from "../domain/notification-kinds.js";
import type { NotificationRow } from "../domain/notifications.js";
import { noticeSentence } from "./notices.js";

/** What each kind is called where a person sees it: the settings list and the
 * agent tools. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
    allergens: "Allergens",
    food_expiring: "Food expiring",
    running_low: "Running low",
    weigh_in_due: "Weigh-in due",
    recipe_changes: "Recipe changes by others",
    week_plan_changes: "Week plan changes",
    new_usuals: "New usual products",
};

const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : null;

/** "Tue, Dec 1" for a `YYYY-MM-DD` date, or the text as it came when it is not one. */
function dayText(date: string): string {
    const at = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(at.getTime())) return date;
    return at.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

/** "dinner on Tue, Dec 1": a plan slot on a day. */
function placeText(slot: unknown, date: unknown): string | null {
    const day = text(date);
    const where = text(slot);
    if (!day) return where;
    return where ? `${where} on ${dayText(day)}` : dayText(day);
}

/**
 * The sentence of an event notification. Its names are frozen in the payload
 * when the event is written ("Sarah removed Beef chili" stays true after the
 * recipe is renamed); the actor's name is read when the sentence is built, so
 * the caller passes it ("Someone" when that person has left).
 */
export function eventSentence(
    row: Pick<NotificationRow, "kind" | "payload">,
    actorName: string,
): string {
    const p = row.payload;
    switch (row.kind) {
        case "recipe_changes":
            return `${actorName} removed ${text(p.recipeName) ?? "a recipe"}.`;
        case "week_plan_changes": {
            const recipe = text(p.recipeName) ?? "a recipe";
            const place = placeText(p.slot, p.date);
            switch (p.change) {
                case "unplanned":
                    return `${actorName} took ${recipe} off ${place ?? "the plan"}.`;
                case "moved": {
                    const from = placeText(p.fromSlot, p.fromDate);
                    return `${actorName} moved ${recipe}${from ? ` from ${from}` : ""} to ${place ?? "another day"}.`;
                }
                default:
                    return `${actorName} planned ${recipe}${place ? ` for ${place}` : ""}.`;
            }
        }
        case "new_usuals": {
            const food = text(p.foodName) ?? "a food";
            const product = text(p.productName);
            return `${actorName} added ${food} to the usuals${product ? ` with ${product}` : ""}.`;
        }
        default:
            throw new Error(`${row.kind} is not an event`);
    }
}

/** The notice a condition row was built from: its stored code, parameters and
 * related rows, and the subject the row names. */
function conditionNotice(row: NotificationRow): Notice {
    const payload = row.payload as {
        code: Notice["code"];
        params?: Notice["params"];
        related?: Notice["related"];
    };
    return {
        code: payload.code,
        severity: NOTICE_SEVERITY[payload.code],
        subject: { kind: row.subjectKind, id: row.subjectId } as never,
        related: payload.related ?? [],
        params: payload.params ?? {},
    };
}

/** "Contains peanut — Pat." says what is in it only beside its item, which an
 * inbox row is not: name the item ("Peanut butter contains peanut — Pat.").
 * The notice's own sentence stays as it is for the pages that show it next to
 * the item; a row stored without a name keeps that sentence. */
const CONTAINS = "Contains ";

function conditionSentence(row: NotificationRow): string {
    const notice = conditionNotice(row);
    const sentence = noticeSentence(notice);
    const name = text(notice.params.name);
    if (
        row.kind === "allergens" &&
        name !== null &&
        sentence.startsWith(CONTAINS)
    ) {
        return `${name} contains ${sentence.slice(CONTAINS.length)}`;
    }
    return sentence;
}

/** The sentence of any stored notification: a condition reads as its notice
 * does everywhere else (an Allergens one also names its item), an event by
 * `eventSentence`. */
export function notificationSentence(
    row: NotificationRow,
    actorName: string,
): string {
    return row.source === "event"
        ? eventSentence(row, actorName)
        : conditionSentence(row);
}
