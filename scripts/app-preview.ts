/**
 * Renders every household-app page with fixture data, in light and dark, and
 * serves the result next to the real /app.css so the pages can be looked at
 * without Supabase. The widget equivalent is scripts/widget-harness.ts.
 *
 *   bun run preview:app            # writes tmp/app-preview/*.html, serves :4787
 *   bun run preview:app --shots    # also writes a 430px-wide PNG per page, then exits
 *
 * --shots needs Chromium on PATH (google-chrome-stable, chromium, or
 * chromium-browser — not the PATH google-chrome wrapper, which pins the GUI
 * profile). Shots pass --force-prefers-reduced-motion so --virtual-time-budget
 * does not freeze page entrances half-done, a throwaway --user-data-dir, and
 * an emulated prefers-color-scheme so bare pages (OS theme) render light and
 * dark as different bytes.
 * The server never imports this file.
 */
import { utcTodayFromDate } from "../src/domain/stock.js";
import { renderFridgePage } from "../src/web/pages/fridge.js";
import { renderGroceryPage } from "../src/web/pages/grocery.js";
import {
    renderRecipeDetailPage,
    renderRecipesPage,
} from "../src/web/pages/recipes.js";
import { renderSettingsPage } from "../src/web/pages/settings.js";
import { renderFoodsSettingsPage } from "../src/web/pages/foods.js";
import { renderHouseholdSettingsPage } from "../src/web/pages/household.js";
import {
    renderNutritionPage,
    viewerChromeFromProfile,
} from "../src/web/pages/nutrition.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
} from "../src/web/loaders.js";
import { getAppCss, getAppJs } from "../src/widgets.js";

const OUT = "./tmp/app-preview";
const PORT = 4787;
const H = "hh-1";
const ME = {
    householdId: H,
    userId: "u1",
    role: "owner",
    displayName: "Ethan",
};
const SAM = { ...ME, userId: "u2", role: "member", displayName: "Sam" };

// The widget templates carry a SAMPLE payload for standalone preview; reuse it
// so the nutrition page shows real cards.
async function widgetSample(key: string): Promise<unknown> {
    const src = await Bun.file(
        `./public/widgets/src/templates/${key}.html`,
    ).text();
    const m = src.match(/const SAMPLE = (\{[\s\S]*?\n {12}\});/);
    return m ? new Function(`return (${m[1]})`)() : { locale: "en" };
}

function addUtcDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function fridgeView(chrome: unknown) {
    const today = utcTodayFromDate();
    const loc = (id: string, name: string, sortOrder: number) => ({
        id,
        householdId: H,
        name,
        sortOrder,
    });
    const item = (
        id: string,
        locationId: string,
        displayName: string,
        amount: number,
        unit: string,
        expiresOn: string | null,
        food = true,
    ) => ({
        id,
        householdId: H,
        locationId,
        kind: food ? "food" : "supply",
        displayName,
        quantity: { amount, unit },
        identity: {},
        foodId: food ? `f-${id}` : null,
        expiresOn,
    });
    return {
        chrome,
        locations: [loc("l1", "Fridge", 0), loc("l2", "Pantry", 1)],
        items: [
            item("i1", "l1", "Expired milk", 1, "l", addUtcDays(today, -1)),
            item("i2", "l1", "Eggs", 6, "each", addUtcDays(today, 1)),
            item("i3", "l1", "Yogurt", 2, "each", addUtcDays(today, 3)),
            item("i4", "l1", "Cheese", 200, "g", addUtcDays(today, 5)),
            item("i5", "l1", "Butter", 250, "g", addUtcDays(today, 14)),
            item("i6", "l2", "Paper towels", 3, "roll", null, false),
        ],
    };
}

function groceryView(chrome: unknown) {
    const section = (
        storeId: string,
        id: string,
        name: string,
        isOther: boolean,
        lines: unknown[],
    ) => ({
        id,
        householdId: H,
        storeId,
        name,
        sortOrder: isOther ? 8 : 0,
        hidden: false,
        isOther,
        lines,
    });
    const line = (
        storeId: string,
        sectionId: string,
        id: string,
        name: string,
        amount: number,
        unit: string,
        checked: boolean,
        alreadyHave: unknown = null,
    ) => ({
        id,
        householdId: H,
        storeId,
        sectionId,
        kind: "food",
        displayName: name,
        quantity: { amount, unit },
        identity: {},
        foodId: `f-${id}`,
        checked,
        alreadyHave,
    });
    return {
        chrome,
        isOwner: true,
        locations: [
            { id: "l1", name: "Fridge" },
            { id: "l2", name: "Pantry" },
        ],
        stores: [
            {
                id: "s1",
                householdId: H,
                name: "Safeway",
                sortOrder: 0,
                rules: [{ id: "r1", body: "Prefer store brand." }],
                sections: [
                    section("s1", "sec1", "Produce", false, [
                        line("s1", "sec1", "g1", "Bananas", 6, "each", false),
                        line("s1", "sec1", "g2", "Spinach", 300, "g", true),
                    ]),
                    section("s1", "sec2", "Other", true, [
                        line("s1", "sec2", "g3", "Eggs", 12, "each", false, {
                            cover: "partial",
                            have: { amount: 6, unit: "each" },
                            need: { amount: 12, unit: "each" },
                        }),
                    ]),
                ],
            },
            {
                id: "s2",
                householdId: H,
                name: "Costco",
                sortOrder: 1,
                rules: [],
                sections: [
                    section("s2", "sec3", "Dairy", false, [
                        line("s2", "sec3", "g4", "Milk", 2, "l", false),
                    ]),
                ],
            },
        ],
    };
}

const RECIPE = {
    id: "r1",
    householdId: H,
    creatorId: "u1",
    name: "Shakshuka",
    yieldPortions: 4,
    instructions: "Simmer tomatoes, crack eggs, cover.",
    sourceUrl: null,
    tags: ["dinner", "vegetarian"],
    notes: null,
    prepMinutes: 10,
    cookMinutes: 20,
};

const RECIPE_TWO = {
    id: "r2",
    householdId: H,
    creatorId: "u1",
    name: "Oatmeal",
    yieldPortions: 2,
    instructions: "Simmer oats.",
    sourceUrl: null,
    tags: ["breakfast"],
    notes: null,
    prepMinutes: 5,
    cookMinutes: 10,
};

const MACROS = {
    calories: 320,
    protein_g: 18,
    carbs_g: 22,
    fat_g: 17,
    fiber_g: 5,
    sugar_g: 9,
    alcohol_g: 0,
    incomplete: false,
    incompleteReasons: [],
};

function food(id: string, name: string, calories: number | null) {
    return {
        id,
        householdId: H,
        kind: "food",
        name,
        normalizedName: name.toLowerCase(),
        brand: null,
        defaultUnit: "g",
        gramsPerEach: null,
        gramsPerMl: null,
        calories,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: null,
        allergens: [],
        offSourceId: null,
        createdBy: null,
        archivedAt: null,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        aliases: [],
    };
}

// Views are cast with `as never`: this script is not typechecked (CI's
// typecheck covers src/ only) and the fixtures only carry what renderers read.
async function pages(theme: "light" | "dark"): Promise<Record<string, string>> {
    const chrome = viewerChromeFromProfile({ theme });
    const nutrition = await renderNutritionPage({
        access: { ok: true, mode: "self", viewer: ME, subject: ME },
        members: [ME, SAM],
        summary: await widgetSample("nutrition-summary"),
        goals: await widgetSample("goal-progress"),
        trends: await widgetSample("trends"),
        weight: await widgetSample("weight-trends"),
        chrome,
        cardOrder: [
            "log",
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
    } as never);
    return {
        nutrition,
        fridge: renderFridgePage(fridgeView(chrome) as never),
        grocery: renderGroceryPage(groceryView(chrome) as never),
        recipes: renderRecipesPage({
            chrome,
            recipes: [RECIPE, RECIPE_TWO],
            members: [ME, SAM],
            viewerId: "u1",
        } as never),
        recipe: renderRecipeDetailPage({
            chrome,
            recipe: RECIPE,
            ingredients: [
                {
                    id: "ing1",
                    recipeId: "r1",
                    foodId: "f1",
                    displayName: "Eggs",
                    quantity: { amount: 6, unit: "each" },
                    note: "large",
                    sortOrder: 0,
                    perPortionAmount: 1.5,
                    personAmount: 1.5,
                },
            ],
            members: [ME, SAM],
            stores: [{ id: "s1", name: "Safeway" }],
            viewerId: "u1",
            filterUserId: "u1",
            portionCount: 1,
            macros: MACROS,
            isOwner: true,
        } as never),
        settings: renderSettingsPage({
            chrome,
            displayName: "Ethan",
            timezone: "America/Los_Angeles",
            weightUnit: "kg",
            widgetsEnabled: true,
            alcoholTrackingEnabled: false,
            drinkUnit: "",
        } as never),
        household: renderHouseholdSettingsPage({
            chrome,
            householdName: "Flow house",
            location: "Portland",
            members: [ME, SAM],
            stores: [
                {
                    id: "s1",
                    householdId: H,
                    name: "Safeway",
                    sortOrder: 0,
                    sections: [
                        {
                            id: "sec1",
                            householdId: H,
                            storeId: "s1",
                            name: "Produce",
                            sortOrder: 0,
                            hidden: false,
                            isOther: false,
                        },
                    ],
                    rules: [{ id: "r1", body: "Prefer store brand." }],
                },
            ],
            memberRules: [
                { member: ME, rules: [], allergens: [], dislikes: [] },
            ],
            isOwner: true,
        } as never),
        foods: renderFoodsSettingsPage({
            chrome,
            foods: [food("f1", "Eggs", 143), food("f2", "Milk", 64)],
        } as never),
        "create-household": createHouseholdFormHtml(undefined, theme),
        forbidden: forbiddenDashboardHtml(theme),
    };
}

function findChromium(): string | null {
    // Prefer the real binary. PATH `google-chrome` is often a wrapper that
    // pins --user-data-dir to the GUI profile and hangs headless shots.
    for (const bin of [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ]) {
        if (bin.startsWith("/")) {
            try {
                if (Bun.file(bin).size > 0) return bin;
            } catch {
                // missing
            }
            continue;
        }
        const path = Bun.which(bin);
        if (path) return path;
    }
    return null;
}

const names: string[] = [];
for (const theme of ["light", "dark"] as const) {
    for (const [name, html] of Object.entries(await pages(theme))) {
        const file = `${name}-${theme}`;
        await Bun.write(`${OUT}/${file}.html`, html);
        names.push(file);
    }
}

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/app.css") {
            return new Response(await getAppCss(), {
                headers: { "content-type": "text/css; charset=utf-8" },
            });
        }
        if (path === "/app.js") {
            return new Response(await getAppJs(), {
                headers: { "content-type": "text/javascript; charset=utf-8" },
            });
        }
        if (path === "/") {
            const links = names
                .map((n) => `<li><a href="/${n}.html">${n}</a></li>`)
                .join("");
            return new Response(`<!doctype html><ul>${links}</ul>`, {
                headers: { "content-type": "text/html" },
            });
        }
        const file = Bun.file(`${OUT}${path}`);
        if (await file.exists()) return new Response(file);
        const pub = Bun.file(`./public${path}`);
        return (await pub.exists())
            ? new Response(pub)
            : new Response("not found", { status: 404 });
    },
});
console.log(`app preview: http://localhost:${server.port}/`);

if (process.argv.includes("--shots")) {
    const chromium = findChromium();
    if (!chromium) {
        console.error("--shots: no chromium on PATH");
        process.exit(1);
    }
    for (const name of names) {
        const theme = name.endsWith("-dark") ? "dark" : "light";
        const dataDir = `${OUT}/chrome-${name}`;
        // Bare pages follow the OS; headless Chromium defaults to dark, so
        // emulate the shot's colour scheme. --user-data-dir is throwaway so
        // the GUI profile is never touched.
        const colorScheme = theme === "dark" ? 2 : 1;
        await Bun.$`${chromium} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-prefers-reduced-motion --blink-settings=preferredColorScheme=${colorScheme} --user-data-dir=${dataDir} --window-size=430,2400 --virtual-time-budget=3000 --screenshot=${OUT}/${name}.png http://localhost:${PORT}/${name}.html`.quiet();
        console.log(`${OUT}/${name}.png`);
    }
    server.stop();
}
