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

/** The part of the app a kind is about: the first words of a row's subtitle. */
export const NOTIFICATION_KIND_AREAS: Record<NotificationKind, string> = {
    allergens: "Allergens",
    food_expiring: "Fridge",
    running_low: "Groceries",
    weigh_in_due: "Weigh-in",
    recipe_changes: "Recipes",
    week_plan_changes: "Week plan",
    new_usuals: "Usuals",
};

/** The second half of a row's subtitle: who else gets it. */
export const NOTIFICATION_BUCKET_LABELS = {
    household: "Household",
    personal: "Just you",
} as const;

export const NOTIFICATIONS_PAGE = {
    title: "Notifications",
    back: "Back",
    bellLabel: "Notifications",
    filterLabel: "Whose notifications",
    filterAll: "All",
    filterPersonal: "Just me",
    filterHousehold: "Household",
    today: "Today",
    earlier: "Earlier",
    snoozed: "Snoozed",
    emptyTitle: "Nothing to look at",
    emptyBody: "New notifications show up here.",
    open: "Open",
    snoozeTomorrow: "Snooze until tomorrow",
    snoozeWeek: "Snooze 1 week",
    dismiss: "Dismiss",
    dismissForMe: "Dismiss for me",
    dismissForEveryone: "Dismiss for everyone",
    turnOff: (kindLabel: string) => `Turn off “${kindLabel}”`,
    actionsFor: (title: string) => `Actions for ${title}`,
} as const;

/** How the inbox words a row's title, shorter than the notice sentences: the
 * name, then when. `daysLeft` is counted from today in the household's zone. */
export const NOTIFICATION_TITLES = {
    expires: (name: string, daysLeft: number): string => {
        if (daysLeft < 0) return `${name} expired`;
        if (daysLeft === 0) return `${name} expires today`;
        if (daysLeft === 1) return `${name} expires tomorrow`;
        return `${name} expires in ${daysLeft} days`;
    },
    expired: (name: string): string => `${name} expired`,
    runningLow: (name: string): string => `${name} is running low`,
    weighInDue: "Weigh-in due",
} as const;

/** The event rows, worded as the design words them: who, what they did, then
 * (for the week plan) which day. `who` is a member's name, or "Someone". */
export const NOTIFICATION_EVENT_TITLES = {
    someone: "Someone",
    recipeRemoved: (who: string, recipe: string): string =>
        `${who} removed ${recipe}`,
    planned: (who: string, recipe: string, day: string): string =>
        `${who} planned ${recipe} for ${day}`,
    unplanned: (who: string, recipe: string): string =>
        `${who} took ${recipe} off the plan`,
    moved: (who: string, recipe: string, day: string): string =>
        `${who} moved ${recipe} to ${day}`,
    newUsual: (who: string, food: string): string =>
        `${who} added ${food} to the usuals`,
} as const;

/** How long ago an event row happened, the first words of its subtitle. */
export const NOTIFICATION_AGO = {
    justNow: "just now",
    minutes: (n: number): string => `${n} min ago`,
    hours: (n: number): string => `${n} h ago`,
    yesterday: "yesterday",
    days: (n: number): string => `${n} days ago`,
} as const;
