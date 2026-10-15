/**
 * End-to-end agent tests: everyday household flows driven through the Grok
 * CLI against the local stack, each checked against the database.
 *
 *   bun run e2e:agent                  # run every scenario, then restore the DB
 *   bun run e2e:agent --list           # list scenarios
 *   bun run e2e:agent --only meal,eat  # run a subset (ids from --list)
 *   bun run e2e:agent --keep           # leave the test writes in place
 *   bun run e2e:agent --restore        # reload the last snapshot (after --keep)
 *
 * Needs: the local stack from ~/.local/share/foodable-dev (server on :8080,
 * Supabase on :54322), and Grok signed in to its `foodable` MCP server
 * (`grok` → /mcps → foodable → i). Grok acts as whoever signed in; the
 * scenarios are written for the seeded household (owner Ethan, member
 * Morgan), so the actor must be a member of it.
 *
 * Every agent turn is checked three ways:
 *   - which tools ran, as whom, and that none failed (tool_analytics rows
 *     written by the server during the turn, not the agent's own account);
 *   - the exact database change the turn should cause;
 *   - invariants: every food's fridge stock still equals its stock ledger
 *     (the real ledgerMatchesStock), and no fridge amount is negative.
 *
 * Before the run the public schema's data is snapshotted (as supabase_admin,
 * inside the DB container); afterwards it is restored, so the seed data comes
 * back unchanged. OAuth tables and tool_analytics are left out of both:
 * restoring an older refresh token would sign Grok out mid-session.
 */

import { SQL } from "bun";
import { mkdir } from "node:fs/promises";
import { foodFromRow } from "../src/domain/foods.js";
import { fridgeItemFromRow, type FridgeItem } from "../src/domain/fridge.js";
import { ledgerMatchesStock, type StockMovement } from "../src/domain/stock.js";
import { movementFromRow } from "../src/db/stock.js";

const DB_URL =
    process.env.E2E_DB_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SERVER = process.env.E2E_SERVER ?? "http://localhost:8080";
const CONTAINER = process.env.E2E_DB_CONTAINER ?? "supabase_db_foodable-dev";
const GROK = process.env.GROK_BIN ?? `${process.env.HOME}/.grok/bin/grok`;
const MCP_NAME = process.env.E2E_MCP_NAME ?? "foodable";
const TURN_TIMEOUT_MS = 240_000;

const OUT_DIR = "tmp/e2e-agent";
// Grok resumes sessions per working directory, and an empty one keeps repo
// instructions out of the agent's context.
const WORK_DIR = `${OUT_DIR}/work`;
const SNAPSHOT_IN_CONTAINER = "/tmp/foodable-e2e-snapshot.sql";
const NOT_SNAPSHOTTED = [
    "oauth_tokens",
    "refresh_tokens",
    "registered_clients",
    "auth_codes",
    "tool_analytics",
];

const sql = new SQL(DB_URL);

// ---- terminal output ----

const tty = process.stdout.isTTY;
const paint = (code: string, s: string) =>
    tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const green = (s: string) => paint("32", s);
const red = (s: string) => paint("31", s);
const dim = (s: string) => paint("2", s);
const bold = (s: string) => paint("1", s);

// ---- checks ----

type Check = { ok: boolean; label: string; detail?: string };

class Checks {
    readonly list: Check[] = [];
    check(ok: boolean, label: string, detail?: unknown): boolean {
        this.list.push({
            ok,
            label,
            detail:
                detail === undefined
                    ? undefined
                    : typeof detail === "string"
                      ? detail
                      : JSON.stringify(detail),
        });
        return ok;
    }
    near(actual: number | null, expected: number, label: string, tol = 0.5) {
        return this.check(
            actual != null && Math.abs(actual - expected) <= tol,
            label,
            `expected ${expected}, got ${actual}`,
        );
    }
}

// ---- the agent ----

type ToolCall = {
    tool: string;
    ok: boolean;
    userId: string;
    error: string | null;
};
type Turn = {
    prompt: string;
    text: string;
    sessionId: string | null;
    tools: ToolCall[];
    ms: number;
    since: Date;
    /** Meal ids that existed before the turn (meals has no created_at). */
    mealsBefore: Set<string>;
};

async function dbNow(): Promise<Date> {
    const [row] = await sql`select now() as now`;
    return new Date(row.now);
}

let running: ReturnType<typeof Bun.spawn> | null = null;

async function runGrok(prompt: string, sessionId?: string | null) {
    const args = [
        "-p",
        prompt,
        "--tools",
        "search_tool,use_tool",
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "json",
        "--no-auto-update",
    ];
    if (sessionId) args.push("-r", sessionId);
    const proc = (running = Bun.spawn([GROK, ...args], {
        cwd: WORK_DIR,
        stdout: "pipe",
        stderr: "pipe",
    }));
    const timer = setTimeout(() => proc.kill(), TURN_TIMEOUT_MS);
    const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    clearTimeout(timer);
    // The result is one JSON object, pretty-printed over many lines; log
    // lines may precede it. Try the whole output, then each line that opens
    // an object, last first.
    const body = out.trim();
    const starts = [0];
    for (
        let i = body.indexOf("\n{");
        i !== -1;
        i = body.indexOf("\n{", i + 1)
    ) {
        starts.push(i + 1);
    }
    for (const at of starts.reverse()) {
        try {
            const parsed = JSON.parse(body.slice(at));
            if (parsed && typeof parsed === "object") {
                return {
                    text: String(parsed.text ?? parsed.message ?? ""),
                    sessionId: parsed.sessionId ?? sessionId ?? null,
                    error:
                        parsed.type === "error" ? String(parsed.message) : null,
                };
            }
        } catch {}
    }
    return {
        text: "",
        sessionId: sessionId ?? null,
        error: `no JSON result (exit ${proc.exitCode}): ${(err || out).slice(-400)}`,
    };
}

async function agent(prompt: string, sessionId?: string | null): Promise<Turn> {
    const since = await dbNow();
    const mealsBefore = new Set<string>(
        (await sql`select id from meals`).map((r: Record<string, unknown>) =>
            String(r.id),
        ),
    );
    const started = performance.now();
    const res = await runGrok(prompt, sessionId);
    const ms = Math.round(performance.now() - started);
    if (res.error) throw new Error(`grok failed: ${res.error}`);
    // Analytics rows are written as each tool returns; give the last one a
    // moment to land.
    await Bun.sleep(400);
    const rows = await sql`
        select tool_name, success, user_id, error_category
        from tool_analytics where invoked_at >= ${since}
        order by invoked_at`;
    return {
        prompt,
        text: res.text,
        sessionId: res.sessionId,
        ms,
        since,
        mealsBefore,
        tools: rows.map((r: Record<string, unknown>) => ({
            tool: String(r.tool_name),
            ok: Boolean(r.success),
            userId: String(r.user_id),
            error: r.error_category == null ? null : String(r.error_category),
        })),
    };
}

// ---- database reads used by the checks ----

type Member = { userId: string; name: string; role: string };

async function members(): Promise<Member[]> {
    const rows =
        await sql`select user_id, display_name, role from household_members`;
    return rows.map((r: Record<string, unknown>) => ({
        userId: String(r.user_id),
        name: String(r.display_name),
        role: String(r.role),
    }));
}

async function timezoneOf(userId: string): Promise<string> {
    const [row] =
        await sql`select timezone from profiles where user_id = ${userId}`;
    return row?.timezone ?? "UTC";
}

type MealRow = {
    id: string;
    description: string;
    calories: number | null;
    protein_g: number | null;
    caffeine_mg: number | null;
    user_id: string;
};

/** Meals created during a turn. */
async function mealsSince(t: Turn): Promise<MealRow[]> {
    const rows = await sql`
        select id, description, calories, protein_g, caffeine_mg, user_id
        from meals`;
    return rows.map(toMeal).filter((m: MealRow) => !t.mealsBefore.has(m.id));
}

function toMeal(r: Record<string, unknown>): MealRow {
    const num = (v: unknown) => (v == null ? null : Number(v));
    return {
        id: String(r.id),
        description: String(r.description ?? ""),
        calories: num(r.calories),
        protein_g: num(r.protein_g),
        caffeine_mg: num(r.caffeine_mg),
        user_id: String(r.user_id),
    };
}

async function mealById(id: string): Promise<MealRow | null> {
    const [row] = await sql`
        select id, description, calories, protein_g, caffeine_mg, user_id
        from meals where id = ${id}`;
    return row ? toMeal(row) : null;
}

async function todayCalories(userId: string, tz: string): Promise<number> {
    const [row] = await sql`
        select coalesce(sum(calories), 0)::int as total from meals
        where user_id = ${userId}
          and (logged_at at time zone ${tz})::date = (now() at time zone ${tz})::date`;
    return Number(row.total);
}

async function todayWaterMl(userId: string, tz: string): Promise<number> {
    const [row] = await sql`
        select coalesce(sum(amount_ml), 0)::int as total from water_log
        where user_id = ${userId}
          and (logged_at at time zone ${tz})::date = (now() at time zone ${tz})::date`;
    return Number(row.total);
}

async function foodId(name: string): Promise<string | null> {
    const [row] = await sql`
        select id from foods where normalized_name = lower(trim(${name}))
        and archived_at is null`;
    return row ? String(row.id) : null;
}

/** Total fridge stock for a food, per unit (a food can sit in two units). */
async function stockOf(id: string | null): Promise<Record<string, number>> {
    if (!id) return {};
    const rows = await sql`
        select unit, sum(amount)::float8 as amount from fridge_items
        where food_id = ${id} group by unit`;
    return Object.fromEntries(
        rows.map((r: Record<string, unknown>) => [
            String(r.unit),
            Number(r.amount),
        ]),
    );
}

type MovementRow = {
    food_id: string;
    delta: number;
    unit: string;
    reason: string;
    meal_id: string | null;
    recipe_id: string | null;
    grocery_line_id: string | null;
    fridge_item_id: string | null;
};

async function movementsSince(since: Date): Promise<MovementRow[]> {
    const rows = await sql`
        select food_id, delta::float8, unit, reason, meal_id, recipe_id,
               grocery_line_id, fridge_item_id
        from stock_movements where created_at >= ${since}
        order by created_at`;
    return rows.map((r: Record<string, unknown>) => ({
        food_id: String(r.food_id),
        delta: Number(r.delta),
        unit: String(r.unit),
        reason: String(r.reason),
        meal_id: r.meal_id == null ? null : String(r.meal_id),
        recipe_id: r.recipe_id == null ? null : String(r.recipe_id),
        grocery_line_id:
            r.grocery_line_id == null ? null : String(r.grocery_line_id),
        fridge_item_id:
            r.fridge_item_id == null ? null : String(r.fridge_item_id),
    }));
}

type GroceryRow = {
    id: string;
    food_id: string | null;
    display_name: string;
    amount: number | null;
    unit: string | null;
    checked: boolean;
};

async function groceryLines(): Promise<GroceryRow[]> {
    const rows = await sql`
        select id, food_id, display_name, amount::float8, unit, checked
        from grocery_lines`;
    return rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        food_id: r.food_id == null ? null : String(r.food_id),
        display_name: String(r.display_name),
        amount: r.amount == null ? null : Number(r.amount),
        unit: r.unit == null ? null : String(r.unit),
        checked: Boolean(r.checked),
    }));
}

/** Foods whose fridge stock disagrees with their stock ledger. */
async function ledgerMismatches(): Promise<string[]> {
    const [foods, items, moves] = await Promise.all([
        sql`select * from foods`,
        sql`select * from fridge_items`,
        sql`select * from stock_movements`,
    ]);
    const fridge: FridgeItem[] = items.map(fridgeItemFromRow);
    const ledger: StockMovement[] = moves.map(movementFromRow);
    const touched = new Set([
        ...fridge.map((i) => i.foodId).filter(Boolean),
        ...ledger.map((m) => m.foodId),
    ]);
    const bad: string[] = [];
    for (const row of foods) {
        const food = foodFromRow(row);
        if (!touched.has(food.id)) continue;
        if (!ledgerMatchesStock(fridge, ledger, food)) bad.push(food.name);
    }
    return bad.sort();
}

function mentionsNumber(text: string, n: number): boolean {
    const plain = text.replace(/(\d),(\d{3})/g, "$1$2");
    return new RegExp(`(^|[^\\d.])${n}([^\\d]|$)`).test(plain);
}

// ---- scenario plumbing ----

type Ctx = {
    me: Member;
    other: Member;
    tz: string;
    baselineLedger: string[];
    turn(
        title: string,
        prompt: string,
        opts: { resume?: Turn } | undefined,
        verify: (t: Turn, c: Checks) => Promise<void>,
    ): Promise<Turn>;
};

type Scenario = {
    id: string;
    title: string;
    covers: string;
    run(ctx: Ctx): Promise<void>;
};

const called = (t: Turn, tool: string) => t.tools.some((c) => c.tool === tool);
const toolList = (t: Turn) =>
    t.tools.map((c) => (c.ok ? c.tool : `${c.tool}✗`)).join(", ") || "none";

// ---- scenarios ----
//
// Written for the seeded household. Seed facts the checks rely on:
// Ethan is allergic to shellfish and dislikes mushrooms and cilantro;
// Morgan is allergic to peanuts and tree nuts and dislikes olives.

const RECIPES_UNSAFE_FOR_BOTH: Record<string, string> = {
    "peanut noodle bowls": "peanut butter (Morgan: peanut allergy)",
    "garlic shrimp spaghetti": "shrimp (Ethan: shellfish allergy)",
    "mushroom cheddar omelette": "mushrooms (Ethan: dislike + rule)",
    "greek salad": "kalamata olives (Morgan: dislike)",
    "overnight oats": "almonds (Morgan: tree nut allergy)",
};

const SCENARIOS: Scenario[] = [
    {
        id: "meal",
        title: "Log a meal, correct it, and the totals follow",
        covers: "log_meal → update_meal → goal progress reads the new total",
        async run(ctx) {
            const before = await todayCalories(ctx.me.userId, ctx.tz);
            let mealId: string | null = null;
            const t1 = await ctx.turn(
                "Log lunch",
                "I just had a turkey sandwich for lunch: about 450 calories, 32 g protein, 40 g carbs and 15 g fat.",
                undefined,
                async (t, c) => {
                    c.check(called(t, "log_meal"), "log_meal was called");
                    const fresh = (await mealsSince(t)).filter(
                        (m) => m.user_id === ctx.me.userId,
                    );
                    c.check(
                        fresh.length === 1,
                        "exactly one new meal for me",
                        fresh,
                    );
                    const meal = fresh[0];
                    mealId = meal?.id ?? null;
                    c.check(
                        /turkey/i.test(meal?.description ?? ""),
                        "it is the turkey sandwich",
                        meal?.description,
                    );
                    c.near(meal?.calories ?? null, 450, "450 kcal stored");
                    c.near(meal?.protein_g ?? null, 32, "32 g protein stored");
                    c.near(
                        await todayCalories(ctx.me.userId, ctx.tz),
                        before + 450,
                        "today's calories rose by 450",
                    );
                },
            );
            const t2 = await ctx.turn(
                "Correct it",
                "Actually that sandwich was more like 520 calories.",
                { resume: t1 },
                async (t, c) => {
                    c.check(called(t, "update_meal"), "update_meal was called");
                    c.check(!called(t, "log_meal"), "no second meal logged");
                    const meal = mealId ? await mealById(mealId) : null;
                    c.near(
                        meal?.calories ?? null,
                        520,
                        "the same meal now says 520 kcal",
                    );
                    c.near(meal?.protein_g ?? null, 32, "protein kept at 32 g");
                    c.near(
                        await todayCalories(ctx.me.userId, ctx.tz),
                        before + 520,
                        "today's calories now up by 520, not 970",
                    );
                },
            );
            await ctx.turn(
                "Ask how the day is going",
                "How am I doing against my goals today?",
                { resume: t2 },
                async (t, c) => {
                    c.check(
                        called(t, "get_goal_progress") ||
                            called(t, "get_nutrition_summary"),
                        "read goal progress or the summary",
                        toolList(t),
                    );
                    const total = await todayCalories(ctx.me.userId, ctx.tz);
                    c.check(
                        mentionsNumber(t.text, total),
                        `reply quotes today's total (${total} kcal)`,
                    );
                },
            );
        },
    },
    {
        id: "water-weight",
        title: "Water and weight in one sentence",
        covers: "log_water + log_weight from one message",
        async run(ctx) {
            const water = await todayWaterMl(ctx.me.userId, ctx.tz);
            await ctx.turn(
                "Log both",
                "I drank 500 ml of water and weighed in at 81.4 kg this morning.",
                undefined,
                async (t, c) => {
                    c.check(called(t, "log_water"), "log_water was called");
                    c.check(called(t, "log_weight"), "log_weight was called");
                    c.near(
                        await todayWaterMl(ctx.me.userId, ctx.tz),
                        water + 500,
                        "today's water rose by 500 ml",
                    );
                    const rows = await sql`
                        select weight_g::float8 from weight_log
                        where user_id = ${ctx.me.userId} and created_at >= ${t.since}`;
                    c.check(rows.length === 1, "one new weight entry", rows);
                    c.near(
                        rows[0] ? Number(rows[0].weight_g) : null,
                        81400,
                        "stored as 81.4 kg",
                        50,
                    );
                },
            );
        },
    },
    {
        id: "rules-pick",
        title: "Household rules decide what's for dinner",
        covers: "get_household_rules drives a recipe pick for two members",
        async run(ctx) {
            const recipes = (
                await sql`select lower(name) as name from recipes`
            ).map((r: Record<string, unknown>) => String(r.name));
            await ctx.turn(
                "Pick dinner for both",
                `Pick one of our saved recipes for dinner tonight that works for both me and ${ctx.other.name}. End your reply with one final line exactly like: PICK: <recipe name>`,
                undefined,
                async (t, c) => {
                    c.check(
                        called(t, "get_household_rules"),
                        "read the household rules",
                        toolList(t),
                    );
                    c.check(
                        called(t, "list_recipes") || called(t, "get_recipe"),
                        "looked at the recipes",
                        toolList(t),
                    );
                    const pick = (t.text.match(/PICK:\s*(.+)\s*$/im)?.[1] ?? "")
                        .replace(/[*_`"]/g, "")
                        .trim()
                        .toLowerCase();
                    c.check(
                        recipes.includes(pick),
                        "picked a saved recipe",
                        pick || "(no PICK line)",
                    );
                    c.check(
                        !(pick in RECIPES_UNSAFE_FOR_BOTH),
                        "the pick is safe for both",
                        RECIPES_UNSAFE_FOR_BOTH[pick] ?? pick,
                    );
                },
            );
        },
    },
    {
        id: "grocery",
        title: "Add groceries; allergen warning; shop and put away",
        covers: "add_grocery_line (allergen warning) → put_away_grocery_lines → fridge + purchase ledger",
        async run(ctx) {
            const pb = await foodId("Peanut butter");
            const banana = await foodId("Banana");
            const pbBefore = await stockOf(pb);
            const bananaBefore = await stockOf(banana);
            let added: GroceryRow[] = [];
            const t1 = await ctx.turn(
                "Add to the list",
                "Add a jar of peanut butter (16 tbsp) and 6 bananas to the grocery list.",
                undefined,
                async (t, c) => {
                    c.check(
                        called(t, "add_grocery_line"),
                        "add_grocery_line was called",
                    );
                    const lines =
                        await sql`select id from grocery_lines where created_at >= ${t.since}`;
                    const ids = new Set(
                        lines.map((r: Record<string, unknown>) => String(r.id)),
                    );
                    added = (await groceryLines()).filter((l) => ids.has(l.id));
                    c.check(
                        added.some(
                            (l) => l.food_id === banana && l.amount === 6,
                        ),
                        "a line for 6 bananas, linked to Banana",
                        added,
                    );
                    // Allergen warnings are blocking (SERVER_INSTRUCTIONS),
                    // and the model often holds the line back even after
                    // an explicit "add it anyway". The warning in the
                    // reply is the requirement. If the line was added,
                    // the shop turn checks its purchase movement.
                    c.check(
                        /peanut/i.test(t.text) &&
                            /allerg/i.test(t.text) &&
                            new RegExp(ctx.other.name, "i").test(t.text),
                        `reply passes on ${ctx.other.name}'s peanut allergy warning`,
                    );
                },
            );
            await ctx.turn(
                "Shop and put away",
                "I bought the peanut butter and the bananas. Put them both away in the Pantry.",
                { resume: t1 },
                async (t, c) => {
                    c.check(
                        called(t, "put_away_grocery_lines"),
                        "put_away_grocery_lines was called",
                        toolList(t),
                    );
                    const remaining = (await groceryLines()).filter(
                        (l) => added.some((a) => a.id === l.id) && !l.checked,
                    );
                    c.check(
                        remaining.length === 0,
                        "every line from the add turn is off the open list",
                        remaining,
                    );
                    const moves = (await movementsSince(t.since)).filter(
                        (m) => m.reason === "purchase",
                    );
                    c.check(
                        moves.some(
                            (m) => m.food_id === banana && m.grocery_line_id,
                        ),
                        "a purchase movement for bananas, tied to its line",
                        moves,
                    );
                    const bananaAfter = await stockOf(banana);
                    c.near(
                        bananaAfter.each ?? 0,
                        (bananaBefore.each ?? 0) + 6,
                        "6 more bananas in stock",
                    );
                    const pbLine = added.find((l) => l.food_id === pb);
                    if (pbLine) {
                        c.check(
                            moves.some(
                                (m) =>
                                    m.food_id === pb &&
                                    m.grocery_line_id === pbLine.id,
                            ),
                            "a purchase movement for peanut butter, tied to its line",
                            moves,
                        );
                        const pbAfter = await stockOf(pb);
                        const pbGain =
                            Object.values(pbAfter).reduce((a, b) => a + b, 0) -
                            Object.values(pbBefore).reduce((a, b) => a + b, 0);
                        c.check(pbGain > 0, "more peanut butter in stock", {
                            before: pbBefore,
                            after: pbAfter,
                        });
                    }
                },
            );
        },
    },
    {
        id: "eat",
        title: "Eat something from the fridge",
        covers: "eat_fridge_item → fridge decrement + food-backed meal with computed totals",
        async run(ctx) {
            const yogurt = await foodId("Greek yogurt");
            const before = await stockOf(yogurt);
            const [food] =
                await sql`select calories::float8 from foods where id = ${yogurt}`;
            await ctx.turn(
                "Eat yogurt",
                "I just ate 150 g of the Greek yogurt from the fridge.",
                undefined,
                async (t, c) => {
                    c.check(
                        called(t, "eat_fridge_item"),
                        "eat_fridge_item was called",
                        toolList(t),
                    );
                    c.near(
                        (await stockOf(yogurt)).g ?? 0,
                        (before.g ?? 0) - 150,
                        "150 g less yogurt in the fridge",
                    );
                    const eat = (await movementsSince(t.since)).filter(
                        (m) => m.reason === "eat",
                    );
                    c.check(
                        eat.length === 1 &&
                            eat[0]!.food_id === yogurt &&
                            eat[0]!.delta === -150,
                        "one eat movement of -150 g",
                        eat,
                    );
                    const fresh = await mealsSince(t);
                    c.check(
                        fresh.length === 1 &&
                            fresh[0]!.user_id === ctx.me.userId,
                        "one new meal, logged for me",
                        fresh,
                    );
                    const meal = fresh[0] ?? null;
                    // stock_movements.meal_id exists for this link, but
                    // eat_fridge_item writes the movement before it creates
                    // the meal and never fills it in.
                    c.check(
                        meal != null && eat[0]?.meal_id === meal.id,
                        "the eat movement links to that meal (meal_id)",
                        { movement_meal_id: eat[0]?.meal_id, meal: meal?.id },
                    );
                    const items = meal
                        ? await sql`select food_id, grams::float8 from meal_items where meal_id = ${meal.id}`
                        : [];
                    c.check(
                        items.length === 1 && items[0].food_id === yogurt,
                        "the meal has one item: the yogurt",
                        items,
                    );
                    c.near(
                        meal?.calories ?? null,
                        Math.round((Number(food.calories) * 150) / 100),
                        "meal calories computed from the food (per 100 g × 150 g)",
                        1,
                    );
                },
            );
        },
    },
    {
        id: "discard",
        title: "Throw out something that went bad",
        covers: "discard_fridge_item → item gone, discard movement, no meal",
        async run(ctx) {
            const spinach = await foodId("Baby spinach");
            const before = await stockOf(spinach);
            await ctx.turn(
                "Toss the spinach",
                "The baby spinach went bad. Throw it out.",
                undefined,
                async (t, c) => {
                    c.check(
                        called(t, "discard_fridge_item"),
                        "discard_fridge_item was called",
                        toolList(t),
                    );
                    c.check(
                        !called(t, "eat_fridge_item") && !called(t, "log_meal"),
                        "nothing logged as eaten",
                    );
                    c.near(
                        (await stockOf(spinach)).g ?? 0,
                        0,
                        "no spinach left",
                    );
                    const discard = (await movementsSince(t.since)).filter(
                        (m) => m.reason === "discard",
                    );
                    c.near(
                        discard.reduce((s, m) => s + m.delta, 0),
                        -(before.g ?? 0),
                        `discard movements total -${before.g ?? 0} g`,
                    );
                    c.check(
                        (await mealsSince(t)).length === 0,
                        "no meal was created",
                    );
                },
            );
        },
    },
    {
        id: "cook",
        title: "Cook a recipe for two and log it for both",
        covers: "cook_recipe → ingredient decrements + cook ledger + one meal per member",
        async run(ctx) {
            const [recipe] =
                await sql`select id from recipes where name = 'Chicken & broccoli stir-fry'`;
            const chicken = await foodId("Chicken breast");
            const broccoli = await foodId("Broccoli");
            const chickenBefore = await stockOf(chicken);
            const broccoliBefore = await stockOf(broccoli);
            await ctx.turn(
                "Cook stir-fry",
                `We're making the Chicken & broccoli stir-fry tonight: 2 portions, one for me and one for ${ctx.other.name}. Cook it from the fridge and log a portion for each of us.`,
                undefined,
                async (t, c) => {
                    c.check(
                        called(t, "cook_recipe"),
                        "cook_recipe was called",
                        toolList(t),
                    );
                    const cook = (await movementsSince(t.since)).filter(
                        (m) => m.reason === "cook",
                    );
                    c.check(
                        cook.length > 0 &&
                            cook.every((m) => m.recipe_id === recipe.id),
                        "cook movements, all tied to the recipe",
                        cook,
                    );
                    // Recipe yields 4; 2 portions use half: 250 g chicken, 150 g broccoli.
                    c.near(
                        (await stockOf(chicken)).g ?? 0,
                        (chickenBefore.g ?? 0) - 250,
                        "250 g chicken used",
                    );
                    c.near(
                        (await stockOf(broccoli)).g ?? 0,
                        (broccoliBefore.g ?? 0) - 150,
                        "150 g broccoli used",
                    );
                    const fresh = await mealsSince(t);
                    c.check(
                        fresh.filter((m) => m.user_id === ctx.me.userId)
                            .length === 1,
                        "one meal logged for me",
                        fresh,
                    );
                    c.check(
                        fresh.filter((m) => m.user_id === ctx.other.userId)
                            .length === 1,
                        `one meal logged for ${ctx.other.name}`,
                        fresh,
                    );
                    c.check(
                        fresh.every((m) => (m.calories ?? 0) > 0),
                        "both meals have calories",
                        fresh,
                    );
                },
            );
        },
    },
    {
        id: "for-member",
        title: "Log something for the other member",
        covers: "log_meal with target_member / user_id",
        async run(ctx) {
            await ctx.turn(
                "Coffee for the other member",
                `Log a black coffee for ${ctx.other.name}: 5 calories, 95 mg caffeine.`,
                undefined,
                async (t, c) => {
                    c.check(called(t, "log_meal"), "log_meal was called");
                    const fresh = await mealsSince(t);
                    c.check(
                        fresh.length === 1 &&
                            fresh[0]!.user_id === ctx.other.userId,
                        `the meal is ${ctx.other.name}'s, not mine`,
                        fresh,
                    );
                    c.near(
                        fresh[0]?.caffeine_mg ?? null,
                        95,
                        "95 mg caffeine stored",
                    );
                },
            );
        },
    },
    {
        id: "fridge-fix",
        title: "Correct a fridge count",
        covers: "update_fridge_item → adjust movement keeps the ledger whole",
        async run(ctx) {
            const eggs = await foodId("Eggs");
            await ctx.turn(
                "Recount eggs",
                "We actually only have 6 eggs left. Update the fridge.",
                undefined,
                async (t, c) => {
                    c.check(
                        called(t, "update_fridge_item"),
                        "update_fridge_item was called",
                        toolList(t),
                    );
                    c.near(
                        (await stockOf(eggs)).each ?? 0,
                        6,
                        "6 eggs in stock",
                    );
                    const adjust = (await movementsSince(t.since)).filter(
                        (m) => m.reason === "adjust" && m.food_id === eggs,
                    );
                    c.check(
                        adjust.length >= 1,
                        "an adjust movement was written",
                        adjust,
                    );
                    c.check(
                        (await mealsSince(t)).length === 0,
                        "no meal was created",
                    );
                },
            );
        },
    },
    {
        id: "recipe-to-list",
        title: "Shop for a whole recipe: add only what's missing",
        covers: "add_recipe_to_grocery for the whole batch → open lines for exactly the uncovered ingredients",
        async run(ctx) {
            const RECIPE = "Banana bread";
            // An ingredient is covered when fridge stock plus open grocery
            // lines (same unit) reach the recipe amount.
            type Coverage = {
                foodId: string;
                name: string;
                need: number;
                stock: number;
                listed: number;
            };
            const coverage = async (): Promise<Coverage[]> =>
                (
                    await sql`
                    select i.food_id, i.display_name, i.amount::float8 as need,
                      coalesce((select sum(fi.amount) from fridge_items fi
                                where fi.food_id = i.food_id and fi.unit = i.unit), 0)::float8 as stock,
                      coalesce((select sum(gl.amount) from grocery_lines gl
                                where gl.food_id = i.food_id and gl.unit = i.unit and not gl.checked), 0)::float8 as listed
                    from recipe_ingredients i join recipes r on r.id = i.recipe_id
                    where r.name = ${RECIPE}`
                ).map((r: Record<string, unknown>) => ({
                    foodId: String(r.food_id),
                    name: String(r.display_name),
                    need: Number(r.need),
                    stock: Number(r.stock),
                    listed: Number(r.listed),
                }));
            const before = await coverage();
            const missing = before.filter((i) => i.stock + i.listed < i.need);
            await ctx.turn(
                "Missing ingredients",
                `We're baking a whole ${RECIPE} loaf this weekend. Add whatever we're missing to the grocery list.`,
                undefined,
                async (t, c) => {
                    c.check(
                        called(t, "add_recipe_to_grocery") ||
                            called(t, "add_grocery_line"),
                        "added lines (add_recipe_to_grocery or add_grocery_line)",
                        toolList(t),
                    );
                    const after = await coverage();
                    for (const m of missing) {
                        const now = after.find((a) => a.foodId === m.foodId);
                        c.check(
                            now != null && now.stock + now.listed >= now.need,
                            `${m.name} is now covered by the list`,
                            now,
                        );
                    }
                    const touched = new Set(
                        (
                            await sql`select food_id from grocery_lines
                                      where created_at >= ${t.since} or updated_at >= ${t.since}`
                        ).map((r: Record<string, unknown>) =>
                            String(r.food_id),
                        ),
                    );
                    const needless = before.filter(
                        (i) =>
                            i.stock + i.listed >= i.need &&
                            touched.has(i.foodId),
                    );
                    c.check(
                        needless.length === 0,
                        "nothing already covered was added",
                        needless.map((i) => i.name),
                    );
                },
            );
        },
    },
];

// ---- snapshot / restore ----

async function snapshot(): Promise<void> {
    const excludes = NOT_SNAPSHOTTED.map(
        (t) => `--exclude-table-data=public.${t}`,
    );
    await Bun.$`docker exec ${CONTAINER} pg_dump -U supabase_admin -d postgres --data-only --schema=public --disable-triggers ${excludes} -f ${SNAPSHOT_IN_CONTAINER}`.quiet();
    await Bun.$`docker cp ${CONTAINER}:${SNAPSHOT_IN_CONTAINER} ${OUT_DIR}/snapshot.sql`.quiet();
}

async function restore(): Promise<void> {
    const tables = (
        await sql`select tablename from pg_tables where schemaname = 'public'`
    )
        .map((r: Record<string, unknown>) => String(r.tablename))
        .filter((t: string) => !NOT_SNAPSHOTTED.includes(t))
        .map((t: string) => `public.${t}`)
        .join(", ");
    // One transaction: truncate every snapshotted table together (no
    // CASCADE, so an excluded table can never be emptied by accident), then
    // reload the snapshot.
    await Bun.$`docker exec ${CONTAINER} psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --single-transaction -q -c ${"set session_replication_role = replica"} -c ${`truncate ${tables}`} -f ${SNAPSHOT_IN_CONTAINER}`.quiet();
}

// ---- main ----

async function preflight(): Promise<{ me: Member; other: Member; tz: string }> {
    const health = await fetch(`${SERVER}/health`)
        .then((r) => r.text())
        .catch(() => "");
    if (health !== "ok")
        throw new Error(
            `server ${SERVER} is not up (GET /health → ${health || "no answer"})`,
        );
    const doctor = await Bun.$`${GROK} mcp doctor ${MCP_NAME}`
        .nothrow()
        .quiet();
    const report = doctor.stdout.toString();
    if (!/1 healthy, 0 failing/.test(report)) {
        throw new Error(
            `grok MCP '${MCP_NAME}' is not healthy; sign in via grok → /mcps → ${MCP_NAME} → i\n${report}`,
        );
    }
    const [token] =
        await sql`select user_id from oauth_tokens order by created_at desc limit 1`;
    const all = await members();
    const me = all.find((m) => m.userId === String(token?.user_id));
    if (!me)
        throw new Error(
            "the newest OAuth token does not belong to a household member",
        );
    const other = all.find((m) => m.userId !== me.userId);
    if (!other) throw new Error("the scenarios need a second household member");
    return { me, other, tz: await timezoneOf(me.userId) };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes("--list")) {
        for (const s of SCENARIOS)
            console.log(
                `${bold(s.id.padEnd(15))} ${s.title}\n${" ".repeat(16)}${dim(s.covers)}`,
            );
        return;
    }
    const onlyArg = args[args.indexOf("--only") + 1];
    const only = args.includes("--only") && onlyArg ? onlyArg.split(",") : null;
    const keep = args.includes("--keep");
    if (args.includes("--restore")) {
        await restore();
        await sql.close();
        console.log(green("Database restored to the last snapshot."));
        return;
    }
    const scenarios = only
        ? SCENARIOS.filter((s) => only.includes(s.id))
        : SCENARIOS;
    if (only && scenarios.length !== only.length) {
        throw new Error(
            `unknown scenario in --only; known: ${SCENARIOS.map((s) => s.id).join(", ")}`,
        );
    }

    await mkdir(WORK_DIR, { recursive: true });
    const { me, other, tz } = await preflight();
    console.log(
        `Agent: Grok as ${bold(me.name)} (${me.role}); other member ${other.name}; tz ${tz}`,
    );

    const baselineLedger = await ledgerMismatches();
    if (baselineLedger.length)
        console.log(
            red(
                `Ledger already off before the run for: ${baselineLedger.join(", ")}`,
            ),
        );

    await snapshot();
    console.log(dim(`Snapshot saved to ${OUT_DIR}/snapshot.sql`));

    const results: Array<{
        scenario: string;
        turn: string;
        prompt: string;
        tools: string;
        ms: number;
        reply: string;
        checks: Check[];
        error?: string;
    }> = [];
    let restored = false;
    const cleanup = async () => {
        if (restored) return;
        restored = true;
        if (keep) {
            console.log(
                dim(
                    `--keep: test writes left in place; ${OUT_DIR}/snapshot.sql restores them by hand`,
                ),
            );
            return;
        }
        await restore();
        console.log(green("Database restored to the pre-run snapshot."));
    };
    process.on("SIGINT", () => {
        running?.kill();
        void cleanup().finally(() => process.exit(130));
    });

    try {
        for (const s of scenarios) {
            console.log(`\n${bold(`▶ ${s.title}`)} ${dim(`[${s.id}]`)}`);
            const ctx: Ctx = {
                me,
                other,
                tz,
                baselineLedger,
                async turn(title, prompt, opts, verify) {
                    const c = new Checks();
                    let t: Turn | null = null;
                    let error: string | undefined;
                    try {
                        t = await agent(prompt, opts?.resume?.sessionId);
                        await verify(t, c);
                        const failed = t.tools.filter((x) => !x.ok);
                        c.check(
                            failed.length === 0,
                            "no tool call failed",
                            failed,
                        );
                        const strangers = t.tools.filter(
                            (x) => x.userId !== me.userId,
                        );
                        c.check(
                            strangers.length === 0,
                            `every tool call ran as ${me.name}`,
                            strangers,
                        );
                        const ledger = (await ledgerMismatches()).filter(
                            (f) => !baselineLedger.includes(f),
                        );
                        c.check(
                            ledger.length === 0,
                            "fridge stock matches the stock ledger for every food",
                            ledger,
                        );
                        const [neg] =
                            await sql`select count(*)::int as n from fridge_items where amount < 0`;
                        c.check(neg.n === 0, "no negative fridge amounts");
                    } catch (e) {
                        error = e instanceof Error ? e.message : String(e);
                        c.check(false, "turn ran", error);
                    }
                    const ok = c.list.every((x) => x.ok);
                    console.log(
                        `  ${ok ? green("✓") : red("✗")} ${title} ${dim(`(${((t?.ms ?? 0) / 1000).toFixed(0)}s · ${t ? toolList(t) : "-"})`)}`,
                    );
                    console.log(dim(`    “${prompt}”`));
                    for (const x of c.list) {
                        if (x.ok) console.log(`    ${green("✓")} ${x.label}`);
                        else
                            console.log(
                                `    ${red("✗")} ${x.label}${x.detail ? dim(` — ${x.detail.slice(0, 300)}`) : ""}`,
                            );
                    }
                    if (!ok && t?.text)
                        console.log(
                            dim(
                                `    reply: ${t.text.replace(/\s+/g, " ").slice(0, 400)}`,
                            ),
                        );
                    results.push({
                        scenario: s.id,
                        turn: title,
                        prompt,
                        tools: t ? toolList(t) : "",
                        ms: t?.ms ?? 0,
                        reply: t?.text ?? "",
                        checks: c.list,
                        error,
                    });
                    return (
                        t ??
                        ({
                            prompt,
                            text: "",
                            sessionId: null,
                            tools: [],
                            ms: 0,
                            since: new Date(),
                            mealsBefore: new Set(),
                        } as Turn)
                    );
                },
            };
            await s.run(ctx);
        }
    } finally {
        await cleanup();
        await sql.close();
    }

    const turns = results.length;
    const okTurns = results.filter((r) => r.checks.every((c) => c.ok)).length;
    const checks = results.flatMap((r) => r.checks);
    const okChecks = checks.filter((c) => c.ok).length;
    const file = `${OUT_DIR}/report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await Bun.write(file, JSON.stringify({ actor: me.name, results }, null, 2));
    console.log(
        `\n${okTurns === turns ? green("PASS") : red("FAIL")}: ${okTurns}/${turns} turns, ${okChecks}/${checks.length} checks. Report: ${file}`,
    );
    if (okTurns !== turns) process.exitCode = 1;
}

await main();
