// Food database lookups. Phase 1: barcode resolution via the Open Food Facts
// REST JSON API (https://world.openfoodfacts.org/api/v2/product/{barcode}.json).
//
// The model stays the parser/orchestrator; this module's only job is to return
// canonical macros for an already-identified product. Every path degrades
// gracefully — a miss or an outage returns null/throws and the caller falls
// back to LLM estimation, so the lookup is always additive, never a hard
// dependency for logging a meal.

import {
    selectFoodCacheRow,
    selectFoodCacheRowsBySource,
    upsertFoodCacheRow,
} from "./db/food-cache.js";
import { gramsFromDrink, formatAlcohol, type DrinkUnit } from "./alcohol.js";
import {
    normalizeNovaGroup,
    normalizeNutriscoreGrade,
    qualityFromOff,
    type OffProductQuality,
} from "./domain/off-quality.js";
import { filterOffNutrientLevels } from "./domain/off-nutrient-levels.js";
import { buildBackgroundFlagContext, buildFlagContext } from "./flags.js";
import { killSwitchOn, type FlagCheck } from "./flag-pins.js";

const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
// v2 /api/v2/search is filter-only (no full-text). Name search still needs the
// legacy CGI JSON endpoint; see Open Food Facts API docs, Search section.
const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const OFF_SEARCH_PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 8_000;

export const SOURCE_OFF = "openfoodfacts" as const;

export const ONLINE_FOOD_LOOKUPS_PAUSED_MESSAGE =
    "Online food lookups are paused; showing your saved foods.";

export type FoodLookupOptions = {
    householdId?: string;
    isEnabled?: FlagCheck;
    notice?: { message: string | null };
};

export type FoodLookupHooks = FoodLookupOptions;

export async function foodLookupsOnline(
    hooks: FoodLookupOptions,
): Promise<boolean> {
    const check = hooks.isEnabled ?? killSwitchOn;
    const ctx =
        hooks.householdId !== undefined
            ? buildBackgroundFlagContext(hooks.householdId)
            : buildFlagContext({
                  auth: { kind: "user", userId: "__food_lookup__" },
              });
    return check("off-lookups", ctx);
}
// Open Food Facts is community-edited and changes often; refresh weekly.
const OFF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Open Food Facts requires a custom User-Agent in the form
// `AppName (ContactEmail)` so they can reach the operator about traffic. It is
// configuration, not a constant: every deployment (including self-hosters) must
// set OFF_USER_AGENT to its own app + contact.
function offUserAgent(): string {
    const ua = process.env.OFF_USER_AGENT;
    if (!ua) {
        throw new Error(
            "OFF_USER_AGENT is not configured — Open Food Facts requires a " +
                "User-Agent like 'Foodable (you@example.com)'",
        );
    }
    return ua;
}

/** What a `per_100` block (and a food's stored nutrition) is measured per. */
export type NutritionBasis = "100g" | "100ml";

/**
 * Open Food Facts' per-100 values (`*_100g` keys), whatever the top-level
 * fields of the hit are per. Null when OFF has no value. `alcohol_g` is always
 * null here: OFF reports alcohol as % vol, which cannot become grams per 100
 * without a density (see resolveAlcoholGrams).
 */
export interface FoodPer100 {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sugar_g: number | null;
    saturated_fat_g: number | null;
    alcohol_g: number | null;
}

export interface FoodResult {
    name: string;
    brand: string | null;
    serving: string | null; // human label for the basis of the macros below
    /** The serving as printed on the pack, even when the macros below are per 100. */
    serving_size?: string | null;
    serving_quantity?: number | null;
    serving_quantity_unit?: string | null;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sugar_g: number | null; // TOTAL sugars, incl. naturally occurring
    saturated_fat_g?: number | null;
    /**
     * Per-100 values from a fresh OFF normalization; absent on older cache
     * rows, and null on one OFF no longer returns (see
     * stampLegacyCacheNutrientLevels).
     */
    per_100?: FoodPer100 | null;
    /** Whether `per_100` is per 100 g or per 100 ml (OFF's `nutrition_data_per`). */
    nutrition_basis?: NutritionBasis;
    nutrient_levels?: Record<string, string> | null;
    alcohol_g: number | null; // pure ethanol; often null — see resolveAlcoholGrams
    // Open Food Facts' own quality scores. Both are null when OFF hasn't
    // computed one — a real gap (missing category or nutrition data on OFF's
    // side, e.g. water, coffee, baby food), not a lookup failure — so unlike
    // fiber/sugar we don't advise the caller to estimate a replacement.
    nutriscore_grade: "a" | "b" | "c" | "d" | "e" | null;
    nova_group: 1 | 2 | 3 | 4 | null; // processing classification, 1=least to 4=ultra-processed
    quality?: OffProductQuality;
    source: string; // stable id, e.g. "off:737628064502"
    source_name: typeof SOURCE_OFF;
    barcode: string;
    allergens?: string[];
    allergens_tags?: unknown;
}

// Strip everything but digits and validate length. Real barcodes (EAN-8/13,
// UPC-A/E, GTIN-14) are 8–14 digits. Returns the cleaned digits or null.
export function normalizeBarcode(raw: string): string | null {
    const digits = (raw ?? "").replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 14) return null;
    return digits;
}

// Coerce an Open Food Facts nutriment to a finite number rounded to one
// decimal, or null when absent/unparseable.
function num(value: unknown): number | null {
    const n = typeof value === "string" ? parseFloat(value) : (value as number);
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
}

interface OFFProduct {
    product_name?: string;
    brands?: string;
    serving_size?: string;
    // "100g" or "100ml": what the *_100g nutriments are per.
    nutrition_data_per?: unknown;
    // OFF's machine-parsed reading of serving_size ("33 cl" -> 330 + "ml").
    serving_quantity?: unknown;
    serving_quantity_unit?: unknown;
    nutriments?: Record<string, unknown>;
    // "a"-"e", or "not-applicable" / "unknown" when OFF hasn't computed one.
    nutriscore_grade?: unknown;
    nova_group?: unknown;
    ecoscore_grade?: unknown;
    environmental_score_grade?: unknown;
    additives_tags?: unknown;
    allergens_tags?: unknown;
    traces_tags?: unknown;
    ingredients_analysis_tags?: unknown;
    labels_tags?: unknown;
    nutrient_levels?: unknown;
}

// The only alcohol unit Open Food Facts actually emits (see below).
const OFF_ABV_UNIT = "% vol";

// Serving volume in millilitres, or null when OFF did not parse one or parsed
// it in some other unit (grams, or an empty/garbage unit — both occur).
function servingVolumeMl(product: OFFProduct): number | null {
    const unit = String(product.serving_quantity_unit ?? "")
        .trim()
        .toLowerCase();
    if (unit !== "ml") return null;
    const ml = num(product.serving_quantity);
    if (ml == null || ml <= 0) return null;
    return ml;
}

// Open Food Facts reports alcohol as ABV — percent by VOLUME — and NOT as grams
// per serving or per 100 g the way every other nutriment is reported.
//
// Verified against the live API rather than assumed: of 164 products carrying an
// `alcohol` nutriment, 164 declared `alcohol_unit: "% vol"` and none declared
// grams. Decisively, all 164 also had
// `alcohol === alcohol_100g === alcohol_serving`. That equality is the proof: a
// genuine gram nutriment scales with the serving — the same product (1664,
// barcode 3080216052885, 250 mL serving) reports `carbohydrates_100g: 3` but
// `carbohydrates_serving: 7.5` — so a value that flatly refuses to scale with
// serving size is a dimensionless percentage, not a mass.
//
// Copying that number into `alcohol_g` would therefore be garbage: a 40% vodka
// would log "40 g of ethanol" no matter the pour, and the 250 mL 1664 above
// would log 5.5 g instead of its true ~10.8 g. So we populate `alcohol_g` only
// when we can honestly convert, which needs the serving VOLUME:
// grams = mL x ABV/100 x 0.789 (gramsFromDrink, src/alcohol.ts).
//
// All three conditions must hold; any miss yields null, never a guess:
//   1. the declared unit really is "% vol" — an unrecognized unit means OFF
//      changed something, and null beats a misread number;
//   2. OFF parsed a serving quantity AND it is in mL. Only ~1/3 of alcoholic
//      products have one; most carry no serving quantity at all;
//   3. we resolved on the per-serving basis. On the per-100 g fallback basis
//      every other field is per 100 GRAMS while ABV is per unit VOLUME, so
//      converting would need the beverage's density — which OFF does not
//      publish. Mixing two bases inside one FoodResult is worse than a null.
//
// Net effect: a real number for products that declare a millilitre serving, and
// null (rendered "n/a", so the caller can fall back to estimation) for the rest.
// A null is correct; a wrong number is not.
function resolveAlcoholGrams(
    product: OFFProduct,
    n: Record<string, unknown>,
    hasServing: boolean,
): number | null {
    if (!hasServing) return null;

    const unit =
        typeof n["alcohol_unit"] === "string"
            ? n["alcohol_unit"].trim().toLowerCase()
            : null;
    if (unit !== OFF_ABV_UNIT) return null;

    // All three keys carry the same ABV; prefer the most specific that is set.
    const abv = num(n["alcohol_serving"] ?? n["alcohol_100g"] ?? n["alcohol"]);
    // Bounds-check before calling gramsFromDrink, which throws on nonsense — a
    // corrupt community-edited value must degrade to null, not blow up a lookup.
    if (abv == null || abv < 0 || abv > 100) return null;

    const ml = servingVolumeMl(product);
    if (ml == null) return null;

    return num(gramsFromDrink(ml, abv));
}

// What OFF's `*_100g` figures are per. A liquid whose label is per serving still
// reports them per 100 ml, so a serving parsed in ml means 100 ml too.
function nutritionBasisOf(product: OFFProduct): NutritionBasis {
    const per = String(product.nutrition_data_per ?? "")
        .trim()
        .toLowerCase();
    if (per === "100ml") return "100ml";
    if (per === "100g") return "100g";
    return servingVolumeMl(product) != null ? "100ml" : "100g";
}

// Normalize an OFF product into our shape. Prefer per-serving values when the
// product declares a serving size and a per-serving energy; otherwise fall back
// to the always-present per-100g basis and label it as such.
function normalizeOFFProduct(
    product: OFFProduct,
    barcode: string,
    fetchedAt: string,
): FoodResult {
    const n = product.nutriments ?? {};
    const hasServing =
        !!product.serving_size && n["energy-kcal_serving"] != null;
    const pick = (servingKey: string, hundredKey: string) =>
        hasServing ? num(n[servingKey]) : num(n[hundredKey]);

    return {
        name: product.product_name?.trim() || `Product ${barcode}`,
        brand: product.brands?.split(",")[0]?.trim() || null,
        serving: hasServing ? product.serving_size!.trim() : "100 g",
        serving_size: product.serving_size?.trim() || null,
        serving_quantity: num(product.serving_quantity),
        serving_quantity_unit: product.serving_quantity_unit
            ? String(product.serving_quantity_unit)
            : null,
        calories: pick("energy-kcal_serving", "energy-kcal_100g"),
        protein_g: pick("proteins_serving", "proteins_100g"),
        carbs_g: pick("carbohydrates_serving", "carbohydrates_100g"),
        fat_g: pick("fat_serving", "fat_100g"),
        // OFF spells it "fiber" (American) — no "fibre_*" key exists; confirmed
        // across 100 products, where only fiber_100g / fiber_serving appear.
        fiber_g: pick("fiber_serving", "fiber_100g"),
        // "sugars", plural. This is TOTAL sugars including naturally occurring
        // sugar from fruit and milk. OFF also carries a separate
        // `added-sugars_*`; we deliberately do not read it — the canonical
        // stored field is total sugar.
        sugar_g: pick("sugars_serving", "sugars_100g"),
        saturated_fat_g: pick("saturated-fat_serving", "saturated-fat_100g"),
        // One decimal like every other OFF value: the edit form's inputs step
        // by 0.1 and refuse a second decimal.
        per_100: {
            calories: num(n["energy-kcal_100g"]),
            protein_g: num(n["proteins_100g"]),
            carbs_g: num(n["carbohydrates_100g"]),
            fat_g: num(n["fat_100g"]),
            fiber_g: num(n["fiber_100g"]),
            sugar_g: num(n["sugars_100g"]),
            saturated_fat_g: num(n["saturated-fat_100g"]),
            alcohol_g: null,
        },
        nutrition_basis: nutritionBasisOf(product),
        nutrient_levels: filterOffNutrientLevels(product.nutrient_levels),
        alcohol_g: resolveAlcoholGrams(product, n, hasServing),
        nutriscore_grade: normalizeNutriscoreGrade(product.nutriscore_grade),
        nova_group: normalizeNovaGroup(product.nova_group),
        quality: qualityFromOff(product, fetchedAt),
        source: `off:${barcode}`,
        source_name: SOURCE_OFF,
        barcode,
        allergens_tags: product.allergens_tags,
    };
}

// Open Food Facts is full of "stub" products: an entry exists (status 1,
// sometimes even a name) but carries no nutriments at all. That is a miss
// for our purposes — returning it would report the product as "found" with
// every macro n/a (suppressing the caller's estimation fallback) and pin a
// useless record in the cache for the full TTL. Treat it as not found.
//
// Deliberately still keyed on the four core macros only, not on the newer
// fiber/sugar/alcohol fields. A product with sugar but no calories, protein,
// carbs or fat is a broken record, not a usable hit, and returning it would
// suppress exactly the estimation fallback this check exists to preserve.
// (Adding alcohol_g here would be a no-op regardless: it is only ever
// non-null on the per-serving basis, which requires energy-kcal_serving,
// which makes calories non-null.)
function usableFood(food: FoodResult): FoodResult | null {
    if (
        food.calories == null &&
        food.protein_g == null &&
        food.carbs_g == null &&
        food.fat_g == null
    ) {
        return null;
    }
    return food;
}

// Pure HTTP fetch + normalize, no caching. Returns null when the product is not
// in Open Food Facts; throws on network failure or an unexpected HTTP status so
// the caller can distinguish "not found" from "couldn't reach the service".
export async function fetchProductFromOFF(
    barcode: string,
): Promise<FoodResult | null> {
    const url = `${OFF_PRODUCT_URL}/${barcode}.json`;
    const res = await fetch(url, {
        headers: offHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(`Open Food Facts request failed: ${res.status}`);
    }

    const body = (await res.json()) as {
        status?: number;
        product?: OFFProduct;
    };
    if (!body || body.status === 0 || !body.product) return null;

    const fetchedAt = new Date().toISOString();
    return usableFood(normalizeOFFProduct(body.product, barcode, fetchedAt));
}

type OFFSearchProduct = OFFProduct & {
    code?: unknown;
    _id?: unknown;
};

function barcodeOfSearchProduct(product: OFFSearchProduct): string | null {
    const raw = product.code ?? product._id;
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    return normalizeBarcode(String(raw));
}

function offHeaders(): { "User-Agent": string; Accept: string } {
    return { "User-Agent": offUserAgent(), Accept: "application/json" };
}

// Pure HTTP name search + normalize, no caching. Throws on network failure or
// an unexpected HTTP status, same as fetchProductFromOFF.
export async function fetchProductsByNameFromOFF(
    query: string,
): Promise<FoodResult[]> {
    const params = new URLSearchParams({
        search_terms: query,
        search_simple: "1",
        action: "process",
        json: "1",
        page_size: String(OFF_SEARCH_PAGE_SIZE),
        page: "1",
    });
    const res = await fetch(`${OFF_SEARCH_URL}?${params}`, {
        headers: offHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
        throw new Error(`Open Food Facts request failed: ${res.status}`);
    }
    const body = (await res.json()) as { products?: OFFSearchProduct[] };
    const products = Array.isArray(body?.products) ? body.products : [];
    const hits: FoodResult[] = [];
    for (const product of products) {
        const barcode = barcodeOfSearchProduct(product);
        if (!barcode) continue;
        const fetchedAt = new Date().toISOString();
        const food = usableFood(
            normalizeOFFProduct(product, barcode, fetchedAt),
        );
        if (food) hits.push(food);
    }
    return hits;
}

// ---------- Cache ----------
// All cache access is best-effort: any failure (missing DATABASE_URL, Postgres
// error, transient error) is swallowed and treated as a miss so a cache
// problem can never break a lookup.

function hydrateCachedPayload(payload: FoodResult): FoodResult {
    // Rows cached before fiber/sugar/alcohol/nutriscore/nova shipped have no
    // such keys; name search still serves them, but barcode lookups require
    // a `quality` block and treat payloads without one as a cache miss.
    // Deserialized they would be `undefined`, not `null` — and an undefined
    // field is an ABSENT one once it reaches a structuredContent literal,
    // which for a .nullable() (hence *required*) schema field is a
    // validation failure rather than a null. Backfill explicitly so a cache
    // hit and a fresh fetch are always the same shape.
    return {
        ...payload,
        fiber_g: payload.fiber_g ?? null,
        sugar_g: payload.sugar_g ?? null,
        alcohol_g: payload.alcohol_g ?? null,
        nutriscore_grade: payload.nutriscore_grade ?? null,
        nova_group: payload.nova_group ?? null,
    };
}

/**
 * Cache rows written before per-100 values were kept lack the `per_100` key.
 * A null one was looked up again and OFF had nothing: it counts as looked up.
 */
export function hasPer100(food: FoodResult): boolean {
    return food.per_100 !== undefined;
}

// An OFF payload without `per_100` is a miss, so it refetches once instead of
// hiding the per-100 values and serving for the rest of the TTL. `allowLegacy`
// returns such a row anyway, for callers that would rather show stale data
// than nothing (lookups while offline or while OFF is unreachable).
export async function getCachedFood(
    source: string,
    sourceId: string,
    ttlMs: number,
    opts: { allowLegacy?: boolean } = {},
): Promise<FoodResult | null> {
    try {
        const data = await selectFoodCacheRow(source, sourceId);
        if (!data) return null;
        const ageMs = Date.now() - new Date(data.fetched_at).getTime();
        if (ageMs > ttlMs) return null;
        const food = hydrateCachedPayload(data.payload as FoodResult);
        if (source === SOURCE_OFF && !opts.allowLegacy && !hasPer100(food)) {
            return null;
        }
        return food;
    } catch {
        return null;
    }
}

export async function putCachedFood(
    source: string,
    sourceId: string,
    payload: FoodResult,
): Promise<void> {
    try {
        await upsertFoodCacheRow({
            source,
            source_id: sourceId,
            payload,
            fetched_at: new Date().toISOString(),
        });
    } catch {
        // best-effort; ignore
    }
}

export async function searchCachedFoodsByName(
    query: string,
): Promise<FoodResult[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    try {
        const data = await selectFoodCacheRowsBySource(SOURCE_OFF);
        if (!data.length) return [];
        const now = Date.now();
        const hits: FoodResult[] = [];
        for (const row of data) {
            const ageMs = now - new Date(row.fetched_at).getTime();
            if (ageMs > OFF_TTL_MS) continue;
            const food = hydrateCachedPayload(row.payload as FoodResult);
            const hay = `${food.name} ${food.brand ?? ""}`.toLowerCase();
            if (hay.includes(needle)) hits.push(food);
        }
        return hits;
    } catch {
        return [];
    }
}

function stampLegacyCacheNutrientLevels(
    barcode: string,
    cached: FoodResult,
): FoodResult {
    if (
        Object.prototype.hasOwnProperty.call(cached, "nutrient_levels") &&
        hasPer100(cached)
    ) {
        return cached;
    }
    // Both keys are stamped so a product OFF no longer returns stops being
    // refetched on every lookup.
    const stamped: FoodResult = {
        ...cached,
        nutrient_levels: cached.nutrient_levels ?? null,
        per_100: cached.per_100 ?? null,
    };
    void putCachedFood(SOURCE_OFF, barcode, stamped);
    return stamped;
}

/** Barcode cache hits need a `quality` block; search hits may omit it. */
export function isBarcodeCacheServable(
    cached: FoodResult | null,
): cached is FoodResult {
    return (
        cached != null &&
        cached.quality !== undefined &&
        Object.prototype.hasOwnProperty.call(cached, "nutrient_levels")
    );
}

// Cache-first barcode lookup. `barcode` must already be normalized
// (see normalizeBarcode). Returns null when the product is unknown; throws only
// when Open Food Facts itself is unreachable.
export async function lookupBarcode(
    barcode: string,
    hooks: FoodLookupHooks = {},
): Promise<FoodResult | null> {
    const online = await foodLookupsOnline(hooks);
    // A row without per-100 values is refetched like a miss, but it stays the
    // fallback: an outage must not turn a working lookup into a failure.
    const cached = await getCachedFood(SOURCE_OFF, barcode, OFF_TTL_MS, {
        allowLegacy: true,
    });
    if (!online) {
        if (hooks.notice) {
            hooks.notice.message = ONLINE_FOOD_LOOKUPS_PAUSED_MESSAGE;
        }
        if (isBarcodeCacheServable(cached)) return cached;
        if (cached) return cached;
        return null;
    }
    if (isBarcodeCacheServable(cached) && hasPer100(cached)) return cached;

    // A fresh row cached before quality data existed is refetched once so the
    // quality fills in, but it stays the fallback: an outage or a miss on the
    // refetch must not turn a working lookup into a failure.
    let food: FoodResult | null;
    try {
        food = await fetchProductFromOFF(barcode);
    } catch (err) {
        // An outage is not an answer: serve the old row but leave it
        // unstamped, so the next lookup tries Open Food Facts again.
        if (cached) return cached;
        throw err;
    }
    if (food) await putCachedFood(SOURCE_OFF, barcode, food);
    if (!food && cached) {
        return stampLegacyCacheNutrientLevels(barcode, cached);
    }
    return food ?? cached;
}

// ---------- Formatting ----------

function macro(value: number | null, unit: string): string {
    return value == null ? "n/a" : `${value} ${unit}`;
}

function novaLabel(group: 1 | 2 | 3 | 4): string {
    switch (group) {
        case 1:
            return "unprocessed/minimally processed";
        case 2:
            return "processed culinary ingredient";
        case 3:
            return "processed";
        case 4:
            return "ultra-processed";
    }
}

/**
 * Render a lookup for the model. `alcoholUnit` is the user's drink unit, or null
 * when alcohol tracking is off for them — in which case the alcohol line is
 * omitted entirely, matching every other display path. The value is still
 * returned in the FoodResult and still stored if the meal is logged; only the
 * rendering is gated.
 *
 * Fiber and sugar are never gated, and are shown even when null ("n/a"): a food
 * with no fiber figure in Open Food Facts is a fact worth stating, since the
 * alternative is the model quietly assuming zero.
 *
 * Nutri-Score and NOVA are the opposite: OFF simply hasn't computed them for
 * plenty of legitimate products (water, coffee, categories it can't classify),
 * so unlike fiber/sugar that's not a gap to estimate around — the line is
 * omitted entirely rather than shown as "n/a".
 */
export function formatFoodResult(
    food: FoodResult,
    alcoholUnit: DrinkUnit | null = null,
): string {
    const title = food.brand ? `${food.name} (${food.brand})` : food.name;
    const lines = [
        title,
        `Serving: ${food.serving ?? "n/a"}`,
        `Calories: ${macro(food.calories, "kcal")} · Protein: ${macro(
            food.protein_g,
            "g",
        )} · Carbs: ${macro(food.carbs_g, "g")} · Fat: ${macro(
            food.fat_g,
            "g",
        )}`,
        `Fiber: ${macro(food.fiber_g, "g")} · Sugar (total): ${macro(
            food.sugar_g,
            "g",
        )}`,
    ];
    const scoreParts = [
        food.nutriscore_grade
            ? `Nutri-Score: ${food.nutriscore_grade.toUpperCase()}`
            : null,
        food.nova_group
            ? `NOVA: ${food.nova_group} (${novaLabel(food.nova_group)})`
            : null,
    ].filter(Boolean);
    if (scoreParts.length > 0) lines.push(scoreParts.join(" · "));
    if (alcoholUnit && food.alcohol_g != null) {
        lines.push(`Alcohol: ${formatAlcohol(food.alcohol_g, alcoholUnit)}`);
    }
    // "n/a" states the gap honestly but says nothing about what to do next,
    // which is how a lookup with no fiber figure turns into a meal with no
    // fiber figure. The sibling error paths in mcp.ts all prescribe a fallback
    // ("fall back to web search or estimation"); the success path did not.
    const unknown = [
        food.fiber_g == null ? "fiber" : null,
        food.sugar_g == null ? "sugar" : null,
    ].filter(Boolean);
    if (unknown.length > 0) {
        lines.push(
            `(Open Food Facts has no ${unknown.join(" or ")} figure for this product — that is missing data, not a zero. Estimate from the ingredients or a web search and still pass the value to log_meal.)`,
        );
    }
    lines.push(`Source: Open Food Facts (barcode ${food.barcode})`);
    return lines.join("\n");
}
