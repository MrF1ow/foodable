// The household's week plan: recipes planned on a day and a meal slot. This
// file is the store seam (types, the input checks both stores share, and an
// in-memory twin of the Postgres adapter); planning logic builds on it.

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
    /** Plans a recipe. Null when the recipe is not in this household. */
    addPlan(plan: NewRecipePlan): Promise<RecipePlan | null>;
    getPlan(householdId: string, id: string): Promise<RecipePlan | null>;
    /** Plans from `from` to `to`, both days included, in day then slot order. */
    listPlans(
        householdId: string,
        from: string,
        to: string,
    ): Promise<RecipePlan[]>;
    /** Null when the household has no such plan. */
    movePlan(
        householdId: string,
        id: string,
        date: string,
        slot: PlanSlot,
    ): Promise<RecipePlan | null>;
    /** Null when the household has no such plan. */
    updatePlanServings(
        householdId: string,
        id: string,
        servings: number,
    ): Promise<RecipePlan | null>;
    /** False when the household has no such plan. */
    removePlan(householdId: string, id: string): Promise<boolean>;
};

export class PlanInputError extends Error {
    readonly code = "plan_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "PlanInputError";
    }
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
            return row ? { ...row } : null;
        },
        async listPlans(householdId, from, to) {
            checkPlanDate(from);
            checkPlanDate(to);
            return plans
                .filter(
                    (p) =>
                        p.householdId === householdId &&
                        p.date >= from &&
                        p.date <= to,
                )
                .sort(
                    (a, b) =>
                        a.date.localeCompare(b.date) ||
                        planSlotRank(a.slot) - planSlotRank(b.slot) ||
                        a.createdAt.localeCompare(b.createdAt) ||
                        a.id.localeCompare(b.id),
                )
                .map((p) => ({ ...p }));
        },
        async movePlan(householdId, id, date, slot) {
            const nextDate = checkPlanDate(date);
            const nextSlot = checkPlanSlot(slot);
            const row = find(householdId, id);
            if (!row) return null;
            row.date = nextDate;
            row.slot = nextSlot;
            return { ...row };
        },
        async updatePlanServings(householdId, id, servings) {
            const next = checkPlanServings(servings);
            const row = find(householdId, id);
            if (!row) return null;
            row.servings = next;
            return { ...row };
        },
        async removePlan(householdId, id) {
            const at = plans.findIndex(
                (p) => p.householdId === householdId && p.id === id,
            );
            if (at < 0) return false;
            plans.splice(at, 1);
            return true;
        },
    };
}
