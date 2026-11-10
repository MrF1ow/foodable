import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import { getMealsByDate, getGoalsForDate } from "../../db/nutrition.js";
import { listHouseholdMembers } from "../../db/household.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRulesStore } from "../../db/rules.js";
import { getProfile, timezoneFromProfile } from "../../db/profiles.js";
import {
    normalizeBarcode,
    lookupBarcode,
    type FoodResult,
} from "../../foods.js";
import {
    checkProductForMember,
    OFF_ALLERGEN_TAG_TO_CODE,
    type ProductCheckInput,
    type ProductCheckMember,
    type ProductCheckNutrient,
    type ProductServingNutrition,
    type ProductCheckToday,
} from "../../domain/product-checks.js";
import {
    catalogNutritionFromOff,
    foodQualityFromHit,
    type Food,
    type FoodQuality,
} from "../../domain/foods.js";
import type {
    AllergenCode,
    MemberAllergen,
    NamedAllergen,
} from "../../domain/rules.js";
import { filterOffNutrientLevels } from "../../domain/off-nutrient-levels.js";
import {
    DEFAULT_SCORE_PRESET,
    productInfoRows,
    SCORE_PARTS,
    SCORE_PRESETS,
    scoreProduct,
    type NutrientLevel,
    type ScoreQuality,
    type ScorePresetId,
} from "../../domain/product-score.js";
import { todayInTz } from "../../domain/tz.js";
import type { NutritionGoals } from "../../db/nutrition.js";
import { gatedTool } from "../gated.js";
import {
    NOTICE_SCHEMA,
    noticeToWire,
    sumMeals,
    type DailyTotals,
    type ToolContext,
} from "../shared.js";

const SCORE_PART_SCHEMA = z.enum([
    "nutrition",
    "processing",
    "additives",
    "environment",
]);

const BREAKDOWN_ENTRY_SCHEMA = z.object({
    part: SCORE_PART_SCHEMA,
    value: z.number().nullable(),
    weight: z.number(),
    known: z.boolean(),
    source: z.string().nullable(),
});

const INFO_ROW_SCHEMA = z.object({
    kind: z.enum(["sugars", "saturated-fat"]),
    per_100g: z.number().nullable(),
    level: z.enum(["low", "moderate", "high"]).nullable(),
});

const PRODUCT_HEADER_SCHEMA = z.object({
    food_id: z.string().nullable(),
    barcode: z.string().nullable(),
    name: z.string(),
    brand: z.string().nullable(),
});

export const RATE_PRODUCT_OUTPUT_SCHEMA = z.object({
    found: z.boolean(),
    product: PRODUCT_HEADER_SCHEMA,
    score: z.number().nullable(),
    label: z.enum(["good", "middling", "poor", "not_enough_data"]),
    preset: z.string(),
    breakdown: z.array(BREAKDOWN_ENTRY_SCHEMA),
    parts_used: z.number(),
    parts_total: z.number(),
    missing: z.array(SCORE_PART_SCHEMA),
    info_rows: z.array(INFO_ROW_SCHEMA),
    checks: z.array(
        z.object({
            user_id: z.string(),
            name: z.string(),
            notices: z.array(NOTICE_SCHEMA),
        }),
    ),
});

type RateProductOutput = z.infer<typeof RATE_PRODUCT_OUTPUT_SCHEMA>;

function scoreQualityFromFoodQuality(quality: FoodQuality): ScoreQuality {
    return {
        nutriscoreGrade: quality.nutriscoreGrade,
        novaGroup: quality.novaGroup,
        ecoscoreGrade: quality.ecoscoreGrade,
        additives: quality.additives,
    };
}

const OFF_TAG_FOR_NAMED: Partial<Record<NamedAllergen, string>> = (() => {
    const out: Partial<Record<NamedAllergen, string>> = {};
    for (const [tag, code] of Object.entries(OFF_ALLERGEN_TAG_TO_CODE)) {
        if (out[code] == null) out[code] = tag;
    }
    return out;
})();

function servingGramsFromHit(hit: FoodResult): number | null {
    const unit = String(hit.serving_quantity_unit ?? "")
        .trim()
        .toLowerCase();
    const qty = hit.serving_quantity;
    if (qty == null || !Number.isFinite(qty) || qty <= 0) return null;
    if (unit === "g" || unit === "gram" || unit === "grams") return qty;
    return null;
}

function offHitIsPer100g(hit: FoodResult): boolean {
    const serving = (hit.serving ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    return serving === "100g";
}

function per100gFromFood(food: Food) {
    return {
        calories: food.calories,
        proteinG: food.proteinG,
        carbsG: food.carbsG,
        fatG: food.fatG,
        fiberG: food.fiberG,
        sugarG: food.sugarG,
        alcoholG: food.alcoholG,
        caffeineMg: food.caffeineMg,
    };
}

function per100gFromOffHit(hit: FoodResult) {
    const n = catalogNutritionFromOff(hit);
    return {
        calories: n.calories,
        proteinG: n.proteinG,
        carbsG: n.carbsG,
        fatG: n.fatG,
        fiberG: n.fiberG,
        sugarG: n.sugarG,
        alcoholG: n.alcoholG,
        caffeineMg: null,
    };
}

function servingNutritionFromOffHit(
    hit: FoodResult,
): ProductServingNutrition | null {
    // A hit that is not per 100 g carries every value per serving (see
    // normalizeOFFProduct), whatever the serving's unit: 330 ml, 1 bar.
    if (offHitIsPer100g(hit)) return null;
    return {
        calories: hit.calories,
        proteinG: hit.protein_g,
        carbsG: hit.carbs_g,
        fatG: hit.fat_g,
        fiberG: hit.fiber_g,
        sugarG: hit.sugar_g,
        alcoholG: hit.alcohol_g,
        caffeineMg: null,
    };
}

function allergenTagsForFood(food: Food): string[] | null {
    const offTags = food.offQuality?.allergensTags ?? [];
    const tags = new Set<string>(offTags);
    // A food created from Open Food Facts stores en:gluten as a wheat
    // allergen. When OFF itself only says gluten, keep it a possible-wheat
    // warning, as for the same barcode rated straight from OFF.
    const wheatFromGluten =
        offTags.includes("en:gluten") && !offTags.includes("en:wheat");
    for (const code of food.allergens) {
        if (code === "other") continue;
        if (code === "wheat" && wheatFromGluten) continue;
        const tag = OFF_TAG_FOR_NAMED[code as NamedAllergen];
        if (tag) tags.add(tag);
    }
    return tags.size > 0 ? [...tags] : null;
}

async function activeHouseholdFood(
    foods: ReturnType<typeof liveFoodsStore>,
    householdId: string,
    foodId: string,
): Promise<Food | null> {
    const food = await foods.getFood(householdId, foodId);
    if (!food || food.archivedAt) return null;
    return food;
}

function productCheckFromFood(food: Food, checkId: string): ProductCheckInput {
    const q = food.offQuality;
    return {
        id: checkId,
        name: food.name,
        allergensTags: allergenTagsForFood(food),
        tracesTags: q?.tracesTags ?? null,
        ingredientsText: null,
        per100g: per100gFromFood(food),
        servingGrams: food.gramsPerEach,
    };
}

function productCheckFromHit(
    hit: FoodResult,
    checkId: string,
): ProductCheckInput {
    const q = hit.quality;
    return {
        id: checkId,
        name: hit.name,
        allergensTags: q?.allergens_tags ?? null,
        tracesTags: q?.traces_tags ?? null,
        ingredientsText: null,
        per100g: per100gFromOffHit(hit),
        servingNutrition: servingNutritionFromOffHit(hit),
        servingGrams: servingGramsFromHit(hit),
    };
}

type DailyGoalKey = Exclude<
    keyof NutritionGoals,
    "user_id" | "updated_at" | "target_weight_g"
>;

const GOAL_REMAINING: {
    nutrient: ProductCheckNutrient;
    goal: DailyGoalKey;
    total: keyof DailyTotals;
}[] = [
    { nutrient: "calories", goal: "daily_calories", total: "calories" },
    { nutrient: "protein_g", goal: "daily_protein_g", total: "protein_g" },
    { nutrient: "carbs_g", goal: "daily_carbs_g", total: "carbs_g" },
    { nutrient: "fat_g", goal: "daily_fat_g", total: "fat_g" },
    { nutrient: "fiber_g", goal: "daily_fiber_g", total: "fiber_g" },
    { nutrient: "sugar_g", goal: "daily_sugar_g", total: "sugar_g" },
    { nutrient: "alcohol_g", goal: "daily_alcohol_g", total: "alcohol_g" },
    {
        nutrient: "caffeine_mg",
        goal: "daily_caffeine_mg",
        total: "caffeine_mg",
    },
];

function todayRemaining(
    goals: NutritionGoals | null,
    totals: DailyTotals,
    showAlcohol: boolean,
): ProductCheckToday["remaining"] {
    if (goals == null) return {};
    const remaining: ProductCheckToday["remaining"] = {};
    for (const row of GOAL_REMAINING) {
        if (row.nutrient === "alcohol_g" && !showAlcohol) continue;
        const target = goals[row.goal];
        if (typeof target !== "number") continue;
        const used = totals[row.total];
        remaining[row.nutrient] = Math.max(0, target - used);
    }
    return remaining;
}

function emptyBreakdown() {
    return SCORE_PARTS.map((part) => ({
        part,
        value: null,
        weight: 0,
        known: false,
        source: null,
    }));
}

function formatChecksSummary(checks: RateProductOutput["checks"]): string {
    const lines: string[] = [];
    for (const row of checks) {
        for (const notice of row.notices) {
            if (notice.severity === "block") lines.push(notice.message);
        }
    }
    return lines.join(" ");
}

function formatContent(out: RateProductOutput): string {
    if (!out.found) {
        const id =
            out.product.barcode != null
                ? `barcode ${out.product.barcode}`
                : "product";
        return `No product found for ${id}.`;
    }
    const scored =
        out.score != null
            ? `Score ${out.score}/100 (${out.label})`
            : `Not enough data to score (${out.label})`;
    const parts = `scored on ${out.parts_used} of ${out.parts_total}`;
    const member = formatChecksSummary(out.checks);
    return member ? `${scored}, ${parts}. ${member}` : `${scored}, ${parts}.`;
}

async function buildOutputAsync(args: {
    found: boolean;
    product: RateProductOutput["product"];
    quality: ScoreQuality | null;
    sugarG: number | null;
    saturatedFatG: number | null;
    offNutrientLevels: Record<string, NutrientLevel> | null;
    checkProduct: ProductCheckInput;
    members: ProductCheckMember[];
    memberToday: (userId: string) => Promise<ProductCheckToday>;
    preset: ScorePresetId;
}): Promise<RateProductOutput> {
    const weights = SCORE_PRESETS[args.preset];
    const scored =
        args.quality != null ? scoreProduct(args.quality, weights) : null;
    const breakdown = scored?.breakdown ?? emptyBreakdown();
    const infoRows = productInfoRows({
        sugarG: args.sugarG,
        saturatedFatG: args.saturatedFatG,
        offNutrientLevels: args.offNutrientLevels,
    }).map((row) => ({
        kind: row.kind,
        per_100g: row.per100g,
        level: row.level,
    }));

    const checks: RateProductOutput["checks"] = [];
    for (const member of args.members) {
        const today = await args.memberToday(member.id);
        checks.push({
            user_id: member.id,
            name: member.name,
            notices: checkProductForMember(
                args.checkProduct,
                member,
                today,
            ).map(noticeToWire),
        });
    }

    return {
        found: args.found,
        product: args.product,
        score: scored?.score ?? null,
        label: scored?.label ?? "not_enough_data",
        preset: args.preset,
        breakdown: breakdown.map((row) => ({
            part: row.part,
            value: row.value,
            weight: row.weight,
            known: row.known,
            source: row.source,
        })),
        parts_used: scored?.partsUsed ?? 0,
        parts_total: scored?.partsTotal ?? SCORE_PARTS.length,
        missing: scored?.missing ?? [...SCORE_PARTS],
        info_rows: infoRows,
        checks,
    };
}

function allergenCodes(rows: MemberAllergen[]): AllergenCode[] {
    return rows.map((row) => row.allergen);
}

export function registerRateProductTools(server: McpServer, ctx: ToolContext) {
    const {
        personSchema,
        callerHouseholdId,
        requireHouseholdMemberId,
        analytics,
        alcohol,
    } = ctx;

    gatedTool(
        server,
        ctx,
        "mcp-rate-product",
        "rate_product",
        {
            title: "Rate Product",
            description:
                "Score a packaged product for quality (Nutri-Score, NOVA, additives, environment) and list per-member allergen, trace, goal and dislike notices. Pass food_id for a household catalog product or barcode for a lookup (read from Open Food Facts, cached; never adds it to the catalog). Optional user_id limits checks to one member.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            inputSchema: personSchema({
                food_id: z
                    .string()
                    .uuid()
                    .optional()
                    .describe("Household catalog food id."),
                barcode: z
                    .string()
                    .optional()
                    .describe(
                        "Product barcode digits. Uses the household food when linked, otherwise a read-only Open Food Facts lookup.",
                    ),
            }),
            outputSchema: RATE_PRODUCT_OUTPUT_SCHEMA,
        },
        async ({ food_id, barcode, user_id }) => {
            return withAnalytics(
                "rate_product",
                async () => {
                    const hasFood = food_id != null && food_id !== "";
                    const hasBarcode = barcode != null && barcode.trim() !== "";
                    if (hasFood === hasBarcode) {
                        throw new Error(
                            "Pass exactly one of food_id or barcode.",
                        );
                    }

                    const householdId = await callerHouseholdId();
                    const preset: ScorePresetId = DEFAULT_SCORE_PRESET;
                    const rules = liveRulesStore();
                    const foods = liveFoodsStore();

                    let memberRows = await listHouseholdMembers(householdId);
                    if (user_id != null) {
                        await requireHouseholdMemberId(user_id);
                        memberRows = memberRows.filter(
                            (m) => m.userId === user_id,
                        );
                    }

                    const members: ProductCheckMember[] = await Promise.all(
                        memberRows.map(async (member) => {
                            const [allergens, dislikes] = await Promise.all([
                                rules.listAllergens(householdId, member.userId),
                                rules.listDislikes(householdId, member.userId),
                            ]);
                            return {
                                id: member.userId,
                                name: member.displayName,
                                allergens: allergenCodes(allergens),
                                dislikes: dislikes.map((d) => d.displayName),
                            };
                        }),
                    );

                    const memberToday = async (
                        memberId: string,
                    ): Promise<ProductCheckToday> => {
                        const profile = await getProfile(memberId);
                        const tz = timezoneFromProfile(profile) ?? "UTC";
                        const day = todayInTz(tz);
                        const [meals, goals] = await Promise.all([
                            getMealsByDate(memberId, day, tz),
                            getGoalsForDate(memberId, day),
                        ]);
                        const totals = sumMeals(meals);
                        // Alcohol stays hidden, as in get_goal_progress and
                        // the digest, unless the caller shows it and the
                        // member tracks it.
                        const showAlcohol =
                            alcohol != null &&
                            (profile?.alcohol_tracking_enabled ?? false);
                        return {
                            remaining: todayRemaining(
                                goals,
                                totals,
                                showAlcohol,
                            ),
                        };
                    };

                    if (hasFood) {
                        const food = await activeHouseholdFood(
                            foods,
                            householdId,
                            food_id!,
                        );
                        if (food == null) {
                            const out: RateProductOutput = {
                                found: false,
                                product: {
                                    food_id,
                                    barcode: null,
                                    name: "",
                                    brand: null,
                                },
                                score: null,
                                label: "not_enough_data",
                                preset,
                                breakdown: emptyBreakdown(),
                                parts_used: 0,
                                parts_total: SCORE_PARTS.length,
                                missing: [...SCORE_PARTS],
                                info_rows: [],
                                checks: [],
                            };
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: formatContent(out),
                                    },
                                ],
                                structuredContent: out,
                            };
                        }

                        const barcodes = await foods.listBarcodes(
                            householdId,
                            food.id,
                        );
                        const productBarcode = barcodes[0] ?? null;
                        const quality =
                            food.offQuality != null
                                ? scoreQualityFromFoodQuality(food.offQuality)
                                : null;

                        const out = await buildOutputAsync({
                            found: true,
                            product: {
                                food_id: food.id,
                                barcode: productBarcode,
                                name: food.name,
                                brand: food.brand,
                            },
                            quality,
                            sugarG: food.sugarG,
                            saturatedFatG: food.saturatedFatG,
                            offNutrientLevels: food.offNutrientLevels,
                            checkProduct: productCheckFromFood(food, food.id),
                            members,
                            memberToday,
                            preset,
                        });

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: formatContent(out),
                                },
                            ],
                            structuredContent: out,
                        };
                    }

                    const normalized = normalizeBarcode(barcode!);
                    if (!normalized) {
                        throw new Error(
                            `"${barcode}" is not a valid barcode (expected 8–14 digits).`,
                        );
                    }

                    const linkedId = await foods.getBarcodeFoodId(
                        householdId,
                        normalized,
                    );
                    if (linkedId != null) {
                        const food = await activeHouseholdFood(
                            foods,
                            householdId,
                            linkedId,
                        );
                        if (food != null) {
                            const quality =
                                food.offQuality != null
                                    ? scoreQualityFromFoodQuality(
                                          food.offQuality,
                                      )
                                    : null;
                            const out = await buildOutputAsync({
                                found: true,
                                product: {
                                    food_id: food.id,
                                    barcode: normalized,
                                    name: food.name,
                                    brand: food.brand,
                                },
                                quality,
                                sugarG: food.sugarG,
                                saturatedFatG: food.saturatedFatG,
                                offNutrientLevels: food.offNutrientLevels,
                                checkProduct: productCheckFromFood(
                                    food,
                                    food.id,
                                ),
                                members,
                                memberToday,
                                preset,
                            });
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: formatContent(out),
                                    },
                                ],
                                structuredContent: out,
                            };
                        }
                    }

                    const hit = await lookupBarcode(normalized);
                    if (hit == null) {
                        const out: RateProductOutput = {
                            found: false,
                            product: {
                                food_id: null,
                                barcode: normalized,
                                name: "",
                                brand: null,
                            },
                            score: null,
                            label: "not_enough_data",
                            preset,
                            breakdown: emptyBreakdown(),
                            parts_used: 0,
                            parts_total: SCORE_PARTS.length,
                            missing: [...SCORE_PARTS],
                            info_rows: [],
                            checks: [],
                        };
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: formatContent(out),
                                },
                            ],
                            structuredContent: out,
                        };
                    }

                    const offQ = foodQualityFromHit(hit);
                    const quality =
                        offQ != null ? scoreQualityFromFoodQuality(offQ) : null;
                    const offCatalog = catalogNutritionFromOff(hit);
                    const checkId = `off:${normalized}`;
                    const out = await buildOutputAsync({
                        found: true,
                        product: {
                            food_id: null,
                            barcode: normalized,
                            name: hit.name,
                            brand: hit.brand,
                        },
                        quality,
                        sugarG: offCatalog.sugarG,
                        saturatedFatG: offCatalog.saturatedFatG,
                        offNutrientLevels: filterOffNutrientLevels(
                            hit.nutrient_levels,
                        ),
                        checkProduct: productCheckFromHit(hit, checkId),
                        members,
                        memberToday,
                        preset,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: formatContent(out),
                            },
                        ],
                        structuredContent: out,
                    };
                },
                analytics,
            );
        },
    );
}
