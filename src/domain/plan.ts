// The household's week plan: recipes planned on a day and a meal slot. This
// file is the store seam (types, the input checks both stores share, and an
// in-memory twin of the Postgres adapter); planning logic builds on it.

import type { Notify } from "./foods.js";
import type { NotificationEvent } from "./notifications.js";
import type { RecipesStore } from "./recipes.js";

export const PLAN_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type PlanSlot = (typeof PLAN_SLOTS)[number];

export type RecipePlan = {
    id: string;
    householdId: string;
    recipeId: string;
    /** The calendar day as `YYYY-MM-DD`, with no time zone. */
    date: string;
    slot: PlanSlot;
    servings: number;
    /** Who planned it; null once that login is gone. */
    createdBy: string | null;
    createdAt: string;
    /**
     * The repeating plan this entry is a day of; absent on a one-off plan.
     * Such an entry is worked out on read (`expandRules`), not stored: its id
     * is `rule:<rule id>:<day>` (`ruleEntryId`).
     */
    ruleId?: string;
};

/** A plan as the week shows it: a stored one-off or one day of a repeat. */
export type PlanEntry = RecipePlan;

export const PLAN_REPEATS = [
    "once",
    "weekly",
    "daily",
    "weekdays",
    "days",
] as const;
export type PlanRepeat = (typeof PLAN_REPEATS)[number];

/**
 * A recipe planned on a repeat from a start day. `days` holds the weekdays of
 * a "pick days" rule, numbered like `Date#getUTCDay` and the restock day
 * (0 = Sunday). `skippedOn` are days taken off the series; `endsOn` is its
 * last day, null while it goes on.
 */
export type PlanRule = {
    id: string;
    householdId: string;
    recipeId: string;
    slot: PlanSlot;
    servings: number;
    startsOn: string;
    repeat: PlanRepeat;
    days: number[];
    endsOn: string | null;
    skippedOn: string[];
    createdBy: string | null;
    createdAt: string;
};

export type NewPlanRule = {
    id?: string;
    householdId: string;
    recipeId: string;
    slot: PlanSlot;
    /** Defaults to 1. */
    servings?: number;
    startsOn: string;
    repeat: PlanRepeat;
    days?: number[];
    createdBy?: string | null;
};

export type NewRecipePlan = {
    id?: string;
    householdId: string;
    recipeId: string;
    date: string;
    slot: PlanSlot;
    /** Defaults to 1. */
    servings?: number;
    createdBy?: string | null;
};

/** Every method is scoped to one household: an id from another household names nothing. */
export type PlansStore = {
    /**
     * Plans a recipe once. Null when the recipe is not in this household. When
     * the recipe is already planned on that day and meal, a one-off or a day of
     * a repeat, nothing is written and that entry comes back as it is, whatever
     * servings were asked for.
     */
    addPlan(plan: NewRecipePlan): Promise<RecipePlan | null>;
    /**
     * A stored plan, or one day of a repeat by its `rule:<id>:<day>` id: the
     * entry the week shows under that id, so null for a day that is skipped,
     * ended or shown under another repeat's id.
     */
    getPlan(householdId: string, id: string): Promise<RecipePlan | null>;
    /**
     * Plans from `from` to `to`, both days included, in day then slot order:
     * the stored one-offs and the days of every repeat in the range
     * (`expandRules`). The writes keep a day to one entry per recipe and meal;
     * should stored data ever hold two, both are listed, as they are.
     */
    listPlans(
        householdId: string,
        from: string,
        to: string,
    ): Promise<RecipePlan[]>;
    /**
     * Moves a plan to another day and slot, optionally setting its servings.
     * When the same recipe is already planned there (a one-off or a day of a
     * repeat), nothing changes: the answer is that entry with `alreadyPlanned`
     * true. Null when the household has no such plan.
     *
     * A day of a repeat (`rule:<id>:<day>`) moves on its own: that day is
     * taken off its repeat and a one-off plan of the same recipe and meal, at
     * its servings (or the servings given), is made on the new day, in one
     * step. The returned plan is that one-off. A move that changes nothing
     * leaves the day on its repeat.
     */
    movePlan(
        householdId: string,
        id: string,
        date: string,
        slot: PlanSlot,
        servings?: number,
    ): Promise<PlanMove | null>;
    /** Null when the household has no such plan. */
    updatePlanServings(
        householdId: string,
        id: string,
        servings: number,
    ): Promise<RecipePlan | null>;
    /**
     * False when the household has no such plan. A day of a repeat
     * (`rule:<id>:<day>`) is taken off its repeat, for that day only.
     */
    removePlan(householdId: string, id: string): Promise<boolean>;
    /**
     * Starts a repeat. Null when the recipe is not in this household. Throws
     * `PlanRepeatOverlapError` when a repeat of the same recipe and meal
     * already shows on a day the new one would. One-offs already on days the
     * repeat covers keep those days: the repeat skips them and their servings
     * stay as they are.
     */
    addRule(rule: NewPlanRule): Promise<PlanRule | null>;
    getRule(householdId: string, id: string): Promise<PlanRule | null>;
    /** Every repeat of the household with no end day, in the order made. */
    listRules(householdId: string): Promise<PlanRule[]>;
    /**
     * Ends a repeat the day before `date`, so the days before it stay. Null
     * when the household has no such repeat.
     */
    endRuleBefore(
        householdId: string,
        ruleId: string,
        date: string,
    ): Promise<PlanRule | null>;
};

/** What a move did: the plan, and whether the move was refused as already planned. */
export type PlanMove = { plan: RecipePlan; alreadyPlanned: boolean };

export class PlanInputError extends Error {
    readonly code = "plan_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "PlanInputError";
    }
}

/**
 * Where a new repeat meets the ones already there: the weekdays (0 = Sunday)
 * of the days they share, and each repeat's pattern in words.
 */
export type RepeatClash = { weekdays: number[]; patterns: string[] };

/**
 * A new repeat would land on a day another repeat of the same recipe and meal
 * already holds. The stores throw it with no recipe name; `planRecipe` says it
 * again with the name it has.
 */
export class PlanRepeatOverlapError extends PlanInputError {
    constructor(
        readonly slot: PlanSlot,
        recipeName?: string | null,
        /** The last day of the clash when every repeat in the way has ended. */
        readonly endedOn: string | null = null,
        readonly clash: RepeatClash | null = null,
    ) {
        super(repeatOverlapMessage(slot, recipeName, endedOn, clash));
        this.name = "PlanRepeatOverlapError";
    }
}

/**
 * The overlap error for the repeats in the way: it names the days they share
 * and how each repeats. When all of them have ended, the person has already
 * ended the series: the message names its last day instead of asking them to
 * end it.
 */
export function repeatOverlapError(
    slot: PlanSlot,
    clashing: readonly PlanRule[],
    candidate: RuleShape,
    recipeName?: string | null,
): PlanRepeatOverlapError {
    const ends = clashing.map((rule) => rule.endsOn);
    const endedOn =
        ends.length > 0 && ends.every((end): end is string => end !== null)
            ? ends.reduce((a, b) => (b > a ? b : a))
            : null;
    const weekdays = [
        ...new Set(
            clashing.flatMap((rule) =>
                sharedDays(rule, candidate).map((day) =>
                    weekdayOfDayNumber(dayNumber(day)),
                ),
            ),
        ),
    ].sort((a, b) => mondayFirst(a) - mondayFirst(b));
    const patterns = [
        ...new Set(clashing.map((rule) => repeatPatternWords(rule))),
    ];
    return new PlanRepeatOverlapError(slot, recipeName, endedOn, {
        weekdays,
        patterns,
    });
}

/** "Mon, Jan 4" for a `YYYY-MM-DD`. */
function overlapDayText(date: string): string {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

/** Sunday last, as a week reads. */
function mondayFirst(weekday: number): number {
    return (weekday + 6) % 7;
}

/** "Mon", "Mon and Tue", "Mon, Tue and Wed". */
function listWords(items: readonly string[]): string {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How a repeat repeats, in words: "every day", "on weekdays", "on Mon and Sat". */
export function repeatPatternWords(
    rule: Pick<PlanRule, "repeat" | "days" | "startsOn">,
): string {
    switch (rule.repeat) {
        case "once":
            return `once on ${overlapDayText(rule.startsOn)}`;
        case "daily":
            return "every day";
        case "weekly":
            return `every week on ${WEEKDAY_LONG[weekdayOfDayNumber(dayNumber(rule.startsOn))]}`;
        case "weekdays":
            return "on weekdays";
        case "days":
            return `on ${listWords(
                [...rule.days]
                    .sort((a, b) => mondayFirst(a) - mondayFirst(b))
                    .map((day) => WEEKDAY_SHORT[day]!),
            )}`;
    }
}

export function repeatOverlapMessage(
    slot: PlanSlot,
    recipeName?: string | null,
    endedOn?: string | null,
    clash?: RepeatClash | null,
): string {
    const name = recipeName?.trim() || "That recipe";
    if (endedOn) {
        return `${name} still repeats at ${slot} until ${overlapDayText(endedOn)}. Pick a start after that, or other days.`;
    }
    if (clash && clash.weekdays.length > 0 && clash.patterns.length > 0) {
        const days = listWords(clash.weekdays.map((d) => WEEKDAY_SHORT[d]!));
        return `${name} is already planned at ${slot} on ${days} by the repeat ${listWords(clash.patterns)}. End that series first, or pick other days.`;
    }
    return `${name} is already planned at ${slot} on some of those days by another repeat. End that series first, or pick other days.`;
}

export function isPlanSlot(value: unknown): value is PlanSlot {
    return (PLAN_SLOTS as readonly unknown[]).includes(value);
}

/** A real calendar day written `YYYY-MM-DD`. */
export function isPlanDate(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1) return false;
    const probe = new Date(0);
    probe.setUTCFullYear(year, month - 1, day);
    return (
        probe.getUTCFullYear() === year &&
        probe.getUTCMonth() === month - 1 &&
        probe.getUTCDate() === day
    );
}

export function checkPlanDate(value: unknown): string {
    if (!isPlanDate(value)) {
        throw new PlanInputError("A plan date must be a day like 2026-11-12.");
    }
    return value;
}

export function checkPlanSlot(value: unknown): PlanSlot {
    if (!isPlanSlot(value)) {
        throw new PlanInputError(
            `A plan slot must be one of ${PLAN_SLOTS.join(", ")}.`,
        );
    }
    return value;
}

export function checkPlanServings(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new PlanInputError("Plan servings must be more than zero.");
    }
    return value;
}

/** The most servings one plan may hold. */
export const PLAN_SERVINGS_MAX = 999;

/**
 * A plan day must be a real day and not already past, in the household's
 * calendar (`today`): a plan for yesterday would never show.
 */
export function checkPlanDay(value: unknown, today: string): string {
    const date = checkPlanDate(value);
    if (date < today) throw new PlanInputError("Pick today or a later day.");
    return date;
}

/** Servings above zero and within `PLAN_SERVINGS_MAX`. */
export function checkPlanServingsCapped(value: unknown): number {
    const servings = checkPlanServings(value);
    if (servings > PLAN_SERVINGS_MAX) {
        throw new PlanInputError(
            `Keep it to ${PLAN_SERVINGS_MAX} servings or fewer.`,
        );
    }
    return servings;
}

export function isPlanRepeat(value: unknown): value is PlanRepeat {
    return (PLAN_REPEATS as readonly unknown[]).includes(value);
}

export function checkPlanRepeat(value: unknown): PlanRepeat {
    if (!isPlanRepeat(value)) {
        throw new PlanInputError(
            `A repeat must be one of ${PLAN_REPEATS.join(", ")}.`,
        );
    }
    return value;
}

/**
 * The weekdays of a "pick days" repeat: at least one, each 0 (Sunday) to 6
 * (Saturday), in order and without repeats.
 */
export function checkPlanDays(value: unknown): number[] {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ) {
        throw new PlanInputError(
            "Pick at least one weekday, from 0 (Sunday) to 6 (Saturday).",
        );
    }
    return [...new Set(value as number[])].sort((a, b) => a - b);
}

const MS_PER_DAY = 86_400_000;

/** Whole days since 1970-01-01 for a `YYYY-MM-DD`: calendar math, no zone, no DST. */
function dayNumber(date: string): number {
    return Math.round(Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY);
}

function dateOfDayNumber(day: number): string {
    return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday, like `Date#getUTCDay`. */
function weekdayOfDayNumber(day: number): number {
    return (((day + 4) % 7) + 7) % 7;
}

/** The id of one day of a repeat: `rule:<rule id>:<yyyy-mm-dd>`. */
export function ruleEntryId(ruleId: string, date: string): string {
    return `rule:${ruleId}:${date}`;
}

const RULE_ENTRY_RE =
    /^rule:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{4}-\d{2}-\d{2})$/i;

/** The repeat and day a `rule:<id>:<day>` names; null for any other id. */
export function parseRuleEntryId(
    id: string,
): { ruleId: string; date: string } | null {
    const match = RULE_ENTRY_RE.exec(id);
    if (!match || !isPlanDate(match[2])) return null;
    return { ruleId: match[1]!.toLowerCase(), date: match[2]! };
}

/** The last day a `YYYY-MM-DD` can name. */
const LAST_PLAN_DATE = "9999-12-31";

type RuleShape = Pick<
    PlanRule,
    "startsOn" | "endsOn" | "repeat" | "days" | "skippedOn"
>;

/**
 * The days two repeats both show on: their date ranges meet on a day both
 * patterns name and neither has skipped. A `once` repeat is just its start
 * day, and an open end runs forever, so the days are looked for from the
 * overlap's start up to a bound that always holds a full week of the patterns.
 */
function sharedDays(a: RuleShape, b: RuleShape): string[] {
    const lastOf = (rule: RuleShape): number =>
        rule.repeat === "once"
            ? dayNumber(rule.startsOn)
            : rule.endsOn === null
              ? Number.POSITIVE_INFINITY
              : dayNumber(rule.endsOn);
    const first = Math.max(dayNumber(a.startsOn), dayNumber(b.startsOn));
    // Patterns repeat every week, so a day both name turns up within a week of
    // the overlap's start; each skipped day can hide one of them.
    const reach = first + 7 * (a.skippedOn.length + b.skippedOn.length + 1) + 6;
    const last = Math.min(lastOf(a), lastOf(b), reach);
    const shared: string[] = [];
    for (let day = first; day <= last; day++) {
        const date = dateOfDayNumber(day);
        if (
            ruleCovers(a, day) &&
            ruleCovers(b, day) &&
            !a.skippedOn.includes(date) &&
            !b.skippedOn.includes(date)
        ) {
            shared.push(date);
        }
    }
    return shared;
}

/** True when two repeats both show on some day. */
export function rulesShareDay(a: RuleShape, b: RuleShape): boolean {
    return sharedDays(a, b).length > 0;
}

function ruleCovers(rule: RuleShape, day: number): boolean {
    switch (rule.repeat) {
        case "once":
            return day === dayNumber(rule.startsOn);
        case "daily":
            return true;
        case "weekly":
            return (
                weekdayOfDayNumber(day) ===
                weekdayOfDayNumber(dayNumber(rule.startsOn))
            );
        case "weekdays": {
            const weekday = weekdayOfDayNumber(day);
            return weekday >= 1 && weekday <= 5;
        }
        case "days":
            return rule.days.includes(weekdayOfDayNumber(day));
    }
}

/**
 * The days of each repeat from `from` to `to`, both included, as plan entries.
 * Days are calendar days (`YYYY-MM-DD`), counted as whole days, so a daylight
 * saving change in the household's zone can neither drop nor double one. A
 * repeat covers its start day and every day up to its end day that its
 * pattern names, minus its skipped days. Entries come in day then meal order.
 */
export function expandRules(
    rules: readonly PlanRule[],
    from: string,
    to: string,
): PlanEntry[] {
    const first = dayNumber(checkPlanDate(from));
    const last = dayNumber(checkPlanDate(to));
    const entries: PlanEntry[] = [];
    for (const rule of rules) {
        const start = Math.max(first, dayNumber(rule.startsOn));
        const end = Math.min(
            last,
            rule.endsOn === null ? last : dayNumber(rule.endsOn),
        );
        for (let day = start; day <= end; day++) {
            const date = dateOfDayNumber(day);
            if (!ruleCovers(rule, day) || rule.skippedOn.includes(date)) {
                continue;
            }
            entries.push({
                id: ruleEntryId(rule.id, date),
                ruleId: rule.id,
                householdId: rule.householdId,
                recipeId: rule.recipeId,
                date,
                slot: rule.slot,
                servings: rule.servings,
                createdBy: rule.createdBy,
                createdAt: rule.createdAt,
            });
        }
    }
    return entries.sort(comparePlanEntries);
}

/** Day, then breakfast to snack, then the order they were planned in. */
export function comparePlanEntries(a: PlanEntry, b: PlanEntry): number {
    return (
        a.date.localeCompare(b.date) ||
        planSlotRank(a.slot) - planSlotRank(b.slot) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
    );
}

/**
 * One-off plans and the days of repeats as one list, in day, meal then
 * planning order. The writes keep a day to one entry per recipe and meal, so
 * nothing here merges or adds anything up: should stored data ever hold the
 * same recipe, day and meal twice, both are listed, each as it is stored.
 */
export function planEntries(
    oneOffs: readonly RecipePlan[],
    rules: readonly PlanRule[],
    from: string,
    to: string,
): PlanEntry[] {
    return [...oneOffs, ...expandRules(rules, from, to)].sort(
        comparePlanEntries,
    );
}

/**
 * The first day the repeat shows, from its start day on and within a year;
 * null when it shows none (every day it covers is skipped).
 */
export function firstRuleEntry(rule: PlanRule): PlanEntry | null {
    // A start near the end of the calendar looks only up to its last day.
    const year = dateOfDayNumber(
        Math.min(dayNumber(rule.startsOn) + 365, dayNumber(LAST_PLAN_DATE)),
    );
    return expandRules([rule], rule.startsOn, year)[0] ?? null;
}

/** `date` moved by `days` calendar days. */
export function shiftPlanDate(date: string, days: number): string {
    return dateOfDayNumber(dayNumber(checkPlanDate(date)) + days);
}

/** The Monday of the ISO week a `YYYY-MM-DD` falls in. */
export function planWeekStart(date: string): string {
    const day = dayNumber(checkPlanDate(date));
    const sinceMonday = (weekdayOfDayNumber(day) + 6) % 7;
    return dateOfDayNumber(day - sinceMonday);
}

/** The repeat's day of this entry id, when that day is still on the series. */
export function ruleEntryOf(
    rules: readonly PlanRule[],
    id: string,
): PlanEntry | null {
    const parsed = parseRuleEntryId(id);
    if (!parsed) return null;
    const rule = rules.find((r) => r.id === parsed.ruleId);
    if (!rule) return null;
    return expandRules([rule], parsed.date, parsed.date)[0] ?? null;
}

/**
 * Runs `fn` as one serialized step. The live callers pass one that holds a
 * per-household lock for the duration, so two parallel calls cannot both find
 * nothing and both insert; the default runs `fn` directly (the memory store).
 */
export type PlanTransaction = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Plans a recipe on a day and slot. The day is checked against `today`, then
 * the slot, then the servings (default: `recipeYield`). With a `repeat` the
 * day is where it starts and the plan that comes back is the first day of the
 * repeat; the same repeat twice is one repeat. A day holds a recipe once per
 * meal: planning it again on a day and slot it is already on (a one-off or a
 * day of a repeat), whatever the servings, writes nothing and the existing
 * entry comes back with `alreadyPlanned`. A repeat that would show on a day
 * another repeat of the recipe and meal shows on is refused
 * (`PlanRepeatOverlapError`); one over days that already hold a one-off skips
 * them and leaves them as they are. Null when the store does not know the
 * recipe.
 * The check and the insert run inside `opts.transaction`. A new plan tells the
 * household through `opts.notify` once that transaction has finished, with
 * `recipeName` as it stands; the plan that was already there changes nothing,
 * so it sends nothing.
 */
export async function planRecipe(
    store: PlansStore,
    input: {
        householdId: string;
        recipeId: string;
        /** The name the notification freezes; the caller already has the recipe. */
        recipeName?: string | null;
        recipeYield: number;
        date: string;
        slot: string;
        servings?: number | null;
        /** How it repeats from `date`; default `once`, one plan on that day. */
        repeat?: string | null;
        /** The weekdays of `repeat: "days"`, 0 = Sunday. */
        days?: number[] | null;
        today: string;
        createdBy: string | null;
    },
    opts: { transaction?: PlanTransaction; notify?: Notify } = {},
): Promise<{ plan: RecipePlan; alreadyPlanned: boolean } | null> {
    const date = checkPlanDay(input.date, input.today);
    const slot = checkPlanSlot(input.slot);
    const servings = checkPlanServingsCapped(
        input.servings ?? input.recipeYield,
    );
    const repeat = checkPlanRepeat(input.repeat ?? "once");
    const days = repeat === "days" ? checkPlanDays(input.days) : [];
    if (repeat !== "days" && input.days && input.days.length > 0) {
        throw new PlanInputError("Weekdays go with a repeat of days only.");
    }
    const runTx: PlanTransaction = opts.transaction ?? ((fn) => fn());
    // A repeat asked again for a day taken off it plans that one day.
    let plannedOnce = false;
    const outcome = await runTx(async () => {
        if (repeat !== "once") {
            // The same repeat twice is one repeat: a running repeat of this
            // recipe and meal with the same pattern that started on or before
            // this day already covers every day the new one would.
            const same = (await store.listRules(input.householdId)).find(
                (r) =>
                    r.recipeId === input.recipeId &&
                    r.slot === slot &&
                    r.repeat === repeat &&
                    r.days.join(",") === days.join(",") &&
                    r.startsOn <= date &&
                    (repeat !== "weekly" ||
                        weekdayOfDayNumber(dayNumber(r.startsOn)) ===
                            weekdayOfDayNumber(dayNumber(date))),
            );
            if (!same) {
                // A repeat that reaches no day before the calendar ends would
                // be saved and then shown as nothing.
                const reaches = firstRuleEntry({
                    id: "",
                    householdId: input.householdId,
                    recipeId: input.recipeId,
                    slot,
                    servings,
                    startsOn: date,
                    repeat,
                    days,
                    endsOn: null,
                    skippedOn: [],
                    createdBy: input.createdBy,
                    createdAt: "",
                });
                if (!reaches) {
                    throw new PlanInputError(
                        "That repeat has no day before the calendar ends. Pick an earlier start.",
                    );
                }
            }
            let rule: PlanRule | null;
            if (same) {
                // Asked again from a day the running repeat should hold: the
                // answer is about that day. It already holds the recipe (the
                // repeat or a one-off in its place): already planned. It was
                // taken off the repeat: plan it there once.
                const held = (
                    await store.listPlans(input.householdId, date, date)
                ).find((p) => p.recipeId === input.recipeId && p.slot === slot);
                if (held) return { plan: held, alreadyPlanned: true };
                if (same.skippedOn.includes(date)) {
                    const plan = await store.addPlan({
                        householdId: input.householdId,
                        recipeId: input.recipeId,
                        date,
                        slot,
                        servings: servings ?? same.servings,
                        createdBy: input.createdBy,
                    });
                    plannedOnce = plan !== null;
                    return plan ? { plan, alreadyPlanned: false } : null;
                }
                rule = same;
            } else {
                try {
                    rule = await store.addRule({
                        householdId: input.householdId,
                        recipeId: input.recipeId,
                        slot,
                        servings,
                        startsOn: date,
                        repeat,
                        days,
                        createdBy: input.createdBy,
                    });
                } catch (err) {
                    // The store knows the clash, planRecipe knows the name.
                    if (err instanceof PlanRepeatOverlapError) {
                        throw new PlanRepeatOverlapError(
                            slot,
                            input.recipeName,
                            err.endedOn,
                            err.clash,
                        );
                    }
                    throw err;
                }
            }
            // The plan is what the week shows on the first day the repeat
            // reaches: its own entry, or the one-off standing on that day when
            // one stands on every day it covers.
            // A repeat asked for again is answered from the day asked for.
            const from = rule && same ? { ...rule, startsOn: date } : rule;
            const day = from
                ? (firstRuleEntry(from)?.date ??
                  from.skippedOn.find((d) => d >= from.startsOn))
                : undefined;
            const first =
                rule && day !== undefined
                    ? ((
                          await store.listPlans(input.householdId, day, day)
                      ).find(
                          (p) =>
                              p.recipeId === rule.recipeId &&
                              p.slot === rule.slot,
                      ) ?? null)
                    : null;
            return rule && first
                ? { plan: first, alreadyPlanned: same !== undefined }
                : null;
        }
        const existing = (
            await store.listPlans(input.householdId, date, date)
        ).find((p) => p.recipeId === input.recipeId && p.slot === slot);
        if (existing) return { plan: existing, alreadyPlanned: true };
        const plan = await store.addPlan({
            householdId: input.householdId,
            recipeId: input.recipeId,
            date,
            slot,
            servings,
            createdBy: input.createdBy,
        });
        return plan ? { plan, alreadyPlanned: false } : null;
    });
    if (outcome && !outcome.alreadyPlanned) {
        const event = planEvent(
            "planned",
            outcome.plan,
            input.recipeName ?? null,
        );
        // A repeat says how it repeats, so the others do not read it as one day.
        if (repeat !== "once" && !plannedOnce) {
            event.payload = {
                ...event.payload,
                repeat,
                ...(repeat === "days" ? { days } : {}),
            };
        }
        await opts.notify?.(event);
    }
    return outcome;
}

export type UnplanScope = "day" | "series";

/**
 * Takes one entry off the week plan. True when it was there. The recipe
 * itself is untouched. A day of a repeat is, by default, only that day
 * (`scope: "day"`: the day is skipped and the rest stay); `scope: "series"`
 * ends the repeat from that day on, so the days before it stay. `series`
 * on a plan that does not repeat is refused. The removal tells the household through `deps.notify`
 * once the store has removed it, with the recipe's name and the day it was
 * planned for. This is the one way the app and the agent tools unplan.
 */
export async function unplanRecipe(
    store: PlansStore,
    householdId: string,
    planId: string,
    deps: {
        recipes: Pick<RecipesStore, "getRecipe">;
        notify?: Notify;
        /** The recipe's name when the caller already has it: no read then. */
        recipeName?: string | null;
    },
    scope: UnplanScope = "day",
): Promise<boolean> {
    const plan = await store.getPlan(householdId, planId);
    if (!plan) return false;
    if (scope === "series" && !plan.ruleId) {
        throw new PlanInputError(
            "That plan does not repeat, so there is no series to remove. Remove the day instead.",
        );
    }
    // The name is read before the removal: a failed read after it would
    // fail an unplan that already happened. Without the name the event
    // still goes, unnamed.
    const recipeName = !deps.notify
        ? null
        : deps.recipeName !== undefined
          ? deps.recipeName
          : await deps.recipes
                .getRecipe(householdId, plan.recipeId)
                .then((recipe) => recipe?.name ?? null)
                .catch(() => null);
    const removed =
        scope === "series" && plan.ruleId
            ? (await store.endRuleBefore(
                  householdId,
                  plan.ruleId,
                  plan.date,
              )) !== null
            : await store.removePlan(householdId, planId);
    if (removed && deps.notify) {
        const event = planEvent("unplanned", plan, recipeName);
        // Ending a series is not one day: say so, so the others do not read
        // every later day as still planned.
        if (scope === "series") {
            event.payload = { ...event.payload, scope: "series" };
        }
        await deps.notify(event);
    }
    return removed;
}

/**
 * Moves one entry to another day or meal (and sets its servings). The same
 * recipe already planned there is "already planned": nothing moves and the
 * entry that is there comes back (`PlansStore.movePlan`). A move to another
 * day or meal tells the household through `deps.notify`, with where it was
 * and where it is now; a servings-only change and a refused move do not. Null
 * when the household has no such plan.
 */
export async function movePlannedRecipe(
    store: PlansStore,
    householdId: string,
    plan: Pick<RecipePlan, "id" | "recipeId" | "date" | "slot">,
    to: { date: string; slot: PlanSlot; servings?: number },
    deps: { recipes: Pick<RecipesStore, "getRecipe">; notify?: Notify },
): Promise<PlanMove | null> {
    const relocates = to.date !== plan.date || to.slot !== plan.slot;
    // Read before the write, as in unplanRecipe: a failed name read never
    // fails a move that already happened.
    const recipeName =
        deps.notify && relocates
            ? await deps.recipes
                  .getRecipe(householdId, plan.recipeId)
                  .then((recipe) => recipe?.name ?? null)
                  .catch(() => null)
            : null;
    const moved = await store.movePlan(
        householdId,
        plan.id,
        to.date,
        to.slot,
        to.servings,
    );
    if (moved && !moved.alreadyPlanned && relocates && deps.notify) {
        const event = planEvent("moved", moved.plan, recipeName);
        event.payload = {
            ...event.payload,
            fromDate: plan.date,
            fromSlot: plan.slot,
        };
        await deps.notify(event);
    }
    return moved;
}

function planEvent(
    change: "planned" | "unplanned" | "moved",
    plan: Pick<RecipePlan, "recipeId" | "date" | "slot">,
    recipeName: string | null,
): NotificationEvent {
    return {
        kind: "week_plan_changes",
        subjectKind: "recipe",
        subjectId: plan.recipeId,
        payload: { recipeName, date: plan.date, slot: plan.slot, change },
    };
}

/** Position of a slot within the day, for ordering. */
export function planSlotRank(slot: PlanSlot): number {
    return PLAN_SLOTS.indexOf(slot);
}

export type MemoryPlansOptions = {
    /**
     * Whether the household owns the recipe. The Postgres adapter asks its
     * recipes table; without this every recipe id is accepted.
     */
    recipeInHousehold?: (householdId: string, recipeId: string) => boolean;
};

export function createMemoryPlansStore(
    options: MemoryPlansOptions = {},
): PlansStore {
    const plans: RecipePlan[] = [];
    const rules: PlanRule[] = [];

    const copyRule = (rule: PlanRule): PlanRule => ({
        ...rule,
        days: [...rule.days],
        skippedOn: [...rule.skippedOn],
    });

    function householdRules(householdId: string): PlanRule[] {
        return rules.filter((r) => r.householdId === householdId);
    }

    /** The day of a repeat an entry id names, when it is still on the series. */
    function ruleDay(
        householdId: string,
        id: string,
    ): { rule: PlanRule; entry: PlanEntry } | null {
        const parsed = parseRuleEntryId(id);
        if (!parsed) return null;
        const rule = householdRules(householdId).find(
            (r) => r.id === parsed.ruleId,
        );
        if (!rule) return null;
        const entry = expandRules([rule], parsed.date, parsed.date)[0];
        return entry ? { rule, entry } : null;
    }

    function skipDay(rule: PlanRule, date: string): void {
        rule.skippedOn = [...new Set([...rule.skippedOn, date])].sort();
    }

    /** What the week shows from `from` to `to`, repeats and one-offs. */
    function entriesBetween(
        householdId: string,
        from: string,
        to: string,
    ): PlanEntry[] {
        return planEntries(
            plans
                .filter(
                    (p) =>
                        p.householdId === householdId &&
                        p.date >= from &&
                        p.date <= to,
                )
                .map((p) => ({ ...p })),
            householdRules(householdId),
            from,
            to,
        );
    }

    /**
     * The entry the week shows for this recipe, day and meal, a one-off or a
     * day of a repeat, other than `exceptId`.
     */
    function planAt(
        householdId: string,
        recipeId: string,
        date: string,
        slot: PlanSlot,
        exceptId?: string,
    ): PlanEntry | undefined {
        return entriesBetween(householdId, date, date).find(
            (entry) =>
                entry.recipeId === recipeId &&
                entry.slot === slot &&
                entry.id !== exceptId,
        );
    }

    /**
     * One day of a repeat leaves the series and lands on its own: the day is
     * skipped in its repeat and a one-off plan is made on the new day. A day
     * that already holds the recipe and meal is already planned, and nothing
     * changes.
     */
    function moveDay(
        householdId: string,
        found: { rule: PlanRule; entry: PlanEntry },
        date: string,
        slot: PlanSlot,
        servings: number | undefined,
    ): PlanMove {
        const { rule, entry } = found;
        // Saved with nothing changed: the day stays on its series.
        if (
            date === entry.date &&
            slot === entry.slot &&
            (servings === undefined || servings === entry.servings)
        ) {
            return { plan: { ...entry }, alreadyPlanned: false };
        }
        const there = planAt(householdId, rule.recipeId, date, slot, entry.id);
        if (there) return { plan: there, alreadyPlanned: true };
        skipDay(rule, entry.date);
        const saved: RecipePlan = {
            id: crypto.randomUUID(),
            householdId,
            recipeId: rule.recipeId,
            date,
            slot,
            servings: servings ?? entry.servings,
            createdBy: rule.createdBy,
            createdAt: new Date().toISOString().replace("Z", "+00:00"),
        };
        plans.push(saved);
        return { plan: { ...saved }, alreadyPlanned: false };
    }

    function find(householdId: string, id: string): RecipePlan | undefined {
        return plans.find((p) => p.householdId === householdId && p.id === id);
    }

    return {
        async addPlan(input) {
            const date = checkPlanDate(input.date);
            const slot = checkPlanSlot(input.slot);
            const servings = checkPlanServings(input.servings ?? 1);
            if (
                options.recipeInHousehold &&
                !options.recipeInHousehold(input.householdId, input.recipeId)
            ) {
                return null;
            }
            // One plan per recipe, day and meal, a one-off or a day of a
            // repeat: planning it again is that plan, whatever the servings.
            const planned = planAt(
                input.householdId,
                input.recipeId,
                date,
                slot,
            );
            if (planned) return planned;
            const saved: RecipePlan = {
                id: input.id ?? crypto.randomUUID(),
                householdId: input.householdId,
                recipeId: input.recipeId,
                date,
                slot,
                servings,
                createdBy: input.createdBy ?? null,
                createdAt: new Date().toISOString().replace("Z", "+00:00"),
            };
            plans.push(saved);
            return { ...saved };
        },
        async getPlan(householdId, id) {
            const row = find(householdId, id);
            if (row) return { ...row };
            const parsed = parseRuleEntryId(id);
            if (!parsed) return null;
            return (
                entriesBetween(householdId, parsed.date, parsed.date).find(
                    (entry) =>
                        entry.id === ruleEntryId(parsed.ruleId, parsed.date),
                ) ?? null
            );
        },
        async listPlans(householdId, from, to) {
            checkPlanDate(from);
            checkPlanDate(to);
            return entriesBetween(householdId, from, to);
        },
        async movePlan(householdId, id, date, slot, servings) {
            const nextDate = checkPlanDate(date);
            const nextSlot = checkPlanSlot(slot);
            const nextServings =
                servings === undefined
                    ? undefined
                    : checkPlanServings(servings);
            const row = find(householdId, id);
            if (!row) {
                const found = ruleDay(householdId, id);
                return found
                    ? moveDay(
                          householdId,
                          found,
                          nextDate,
                          nextSlot,
                          nextServings,
                      )
                    : null;
            }
            const there = planAt(
                householdId,
                row.recipeId,
                nextDate,
                nextSlot,
                row.id,
            );
            if (there) return { plan: there, alreadyPlanned: true };
            row.date = nextDate;
            row.slot = nextSlot;
            if (nextServings !== undefined) row.servings = nextServings;
            return { plan: { ...row }, alreadyPlanned: false };
        },
        async updatePlanServings(householdId, id, servings) {
            const next = checkPlanServings(servings);
            const row = find(householdId, id);
            if (!row) {
                // One day of a repeat with other servings is a plan of its own.
                const found = ruleDay(householdId, id);
                return found
                    ? moveDay(
                          householdId,
                          found,
                          found.entry.date,
                          found.entry.slot,
                          next,
                      ).plan
                    : null;
            }
            row.servings = next;
            return { ...row };
        },
        async removePlan(householdId, id) {
            const at = plans.findIndex(
                (p) => p.householdId === householdId && p.id === id,
            );
            if (at < 0) {
                const found = ruleDay(householdId, id);
                if (!found) return false;
                skipDay(found.rule, found.entry.date);
                return true;
            }
            plans.splice(at, 1);
            return true;
        },
        async addRule(input) {
            const startsOn = checkPlanDate(input.startsOn);
            const slot = checkPlanSlot(input.slot);
            const servings = checkPlanServings(input.servings ?? 1);
            const repeat = checkPlanRepeat(input.repeat);
            const days = repeat === "days" ? checkPlanDays(input.days) : [];
            if (
                options.recipeInHousehold &&
                !options.recipeInHousehold(input.householdId, input.recipeId)
            ) {
                return null;
            }
            const candidate = {
                startsOn,
                endsOn: null,
                repeat,
                days,
                skippedOn: [],
            };
            const clashing = householdRules(input.householdId).filter(
                (r) =>
                    r.recipeId === input.recipeId &&
                    r.slot === slot &&
                    rulesShareDay(r, candidate),
            );
            if (clashing.length > 0) {
                throw repeatOverlapError(slot, clashing, candidate);
            }
            const saved: PlanRule = {
                id: input.id ?? crypto.randomUUID(),
                householdId: input.householdId,
                recipeId: input.recipeId,
                slot,
                servings,
                startsOn,
                repeat,
                days,
                endsOn: null,
                skippedOn: [],
                createdBy: input.createdBy ?? null,
                createdAt: new Date().toISOString().replace("Z", "+00:00"),
            };
            rules.push(saved);
            // One-offs already on days the repeat covers hold those days: the
            // repeat skips them and leaves their servings alone.
            for (const plan of plans.filter(
                (p) =>
                    p.householdId === input.householdId &&
                    p.recipeId === input.recipeId &&
                    p.slot === slot &&
                    p.date >= startsOn,
            )) {
                if (expandRules([saved], plan.date, plan.date).length > 0) {
                    skipDay(saved, plan.date);
                }
            }
            return copyRule(saved);
        },
        async getRule(householdId, id) {
            const rule = householdRules(householdId).find((r) => r.id === id);
            return rule ? copyRule(rule) : null;
        },
        async listRules(householdId) {
            return householdRules(householdId)
                .filter((r) => r.endsOn === null)
                .map(copyRule);
        },
        async endRuleBefore(householdId, ruleId, date) {
            const lastDay = shiftPlanDate(date, -1);
            const rule = householdRules(householdId).find(
                (r) => r.id === ruleId,
            );
            if (!rule) return null;
            // Ending from a later day never brings an earlier end back.
            if (rule.endsOn === null || lastDay < rule.endsOn) {
                rule.endsOn = lastDay;
            }
            return copyRule(rule);
        },
    };
}
