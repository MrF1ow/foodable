import type { Food } from "../../../domain/foods.js";
import type { Notice } from "../../../domain/notices.js";
import { productMemberReasonLine } from "../../../copy/product-member-reason.js";
import { getGoalsForRange, getMealsByDate } from "../../../db/nutrition.js";
import { getProfile } from "../../../db/profiles.js";
import { productCheckRemainingForDay } from "../../../domain/product-check-today.js";
import { todayDayTotals } from "../../../domain/today.js";
import { todayInTz, validateTz } from "../../../domain/tz.js";
import {
    DEFAULT_SCORE_PRESET,
    SCORE_PRESET_LABELS,
    productInfoRows,
    type ProductScore,
    type ScoreQuality,
    type NutrientLevel,
} from "../../../domain/product-score.js";
import type { ProductCheckMember } from "../../../domain/product-checks.js";
import {
    memberProductVerdict,
    scoredFoodProduct,
    scoreQualityFromFoodQuality,
    type MemberProductVerdict,
} from "../../../domain/product-screen.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import {
    memberCheckRow,
    partRow,
    rowList,
    sectionHeader,
    type PartStatus,
} from "../../components/v2/rows.js";
import { scoreBig, scoreVerdict } from "../../components/v2/score-badge.js";
import { initialsOf } from "../../shell-v2.js";
import { listHouseholdMembers } from "../../../db/household.js";
import { liveRulesStore } from "../../../db/rules.js";
import type { AllergenCode } from "../../../domain/rules.js";
import {
    memberChecksForProduct,
    productCheckFromFood,
} from "../../../domain/product-screen.js";

export type ProductMemberCard = {
    id: string;
    name: string;
    initials: string;
    verdict: MemberProductVerdict;
    reason: string;
};

export type ProductScoreSection = {
    score: ProductScore;
    presetLabel: string;
    memberCards: ProductMemberCard[];
};

function nutriscoreStatus(
    grade: NonNullable<ScoreQuality["nutriscoreGrade"]>,
): PartStatus {
    if (grade === "a" || grade === "b") return "good";
    if (grade === "c") return "warn";
    return "over";
}

function levelStatus(level: NutrientLevel | null): PartStatus {
    if (level === "low") return "good";
    if (level === "moderate") return "warn";
    if (level === "high") return "over";
    return "warn";
}

function partValueStatus(value: number): PartStatus {
    if (value >= 70) return "good";
    if (value >= 40) return "warn";
    return "over";
}

const NOVA_LABEL: Record<1 | 2 | 3 | 4, string> = {
    1: "NOVA 1 · unprocessed",
    2: "NOVA 2 · processed culinary",
    3: "NOVA 3 · processed",
    4: "NOVA 4 · ultra-processed",
};

function formatEco(grade: NonNullable<ScoreQuality["ecoscoreGrade"]>): string {
    return grade === "a-plus" ? "A+" : grade.toUpperCase();
}

function formatInfoAmount(
    kind: "sugars" | "saturated-fat",
    g: number | null,
): string {
    if (g == null) return "–";
    const rounded = Math.round(g * 10) / 10;
    const text =
        kind === "saturated-fat"
            ? rounded.toFixed(1)
            : Number.isInteger(rounded)
              ? String(rounded)
              : rounded.toFixed(1);
    return `${text} g per 100 g`;
}

function additivesLabel(quality: ScoreQuality): string {
    const list = quality.additives;
    if (list == null) return "–";
    if (list.length === 0) return "None";
    const high = list.filter((row) => row.risk === "high").length;
    return high > 0
        ? `${list.length} additive(s), ${high} high risk`
        : `${list.length} additive(s)`;
}

function breakdownValue(
    part: "nutrition" | "processing" | "additives" | "environment",
    quality: ScoreQuality,
    scored: ProductScore,
): { label: string; value: string; status: PartStatus } | null {
    const entry = scored.breakdown.find((row) => row.part === part);
    if (part === "nutrition" && quality.nutriscoreGrade != null) {
        const g = quality.nutriscoreGrade;
        return {
            label: "Nutri-Score",
            value: g.toUpperCase(),
            status: nutriscoreStatus(g),
        };
    }
    if (part === "processing" && quality.novaGroup != null) {
        const status =
            entry?.value != null
                ? partValueStatus(entry.value)
                : partValueStatus(50);
        return {
            label: "Processing",
            value: NOVA_LABEL[quality.novaGroup],
            status,
        };
    }
    if (part === "additives" && quality.additives != null) {
        const status =
            entry?.value != null ? partValueStatus(entry.value) : "good";
        return {
            label: "Additives",
            value: additivesLabel(quality),
            status,
        };
    }
    if (part === "environment" && quality.ecoscoreGrade != null) {
        const status =
            entry?.value != null
                ? partValueStatus(entry.value)
                : partValueStatus(50);
        return {
            label: "Green-Score",
            value: formatEco(quality.ecoscoreGrade),
            status,
        };
    }
    return null;
}

function pushInfoRow(
    rows: Html[],
    info: ReturnType<typeof productInfoRows>[number] | undefined,
    label: string,
) {
    if (info == null || (info.per100g == null && info.level == null)) return;
    const amount = formatInfoAmount(info.kind, info.per100g);
    const level = info.level != null ? ` · ${info.level}` : "";
    rows.push(
        partRow({
            label,
            value: `${amount}${level}`,
            status: levelStatus(info.level),
        }),
    );
}

export function whyScoreRows(food: Food, scored: ProductScore): Html[] {
    if (food.offQuality == null) return [];
    const quality = scoreQualityFromFoodQuality(food.offQuality);
    const rows: Html[] = [];
    for (const part of ["nutrition", "processing", "additives"] as const) {
        const row = breakdownValue(part, quality, scored);
        if (row) {
            rows.push(
                partRow({
                    label: row.label,
                    value: row.value,
                    status: row.status,
                }),
            );
        }
    }
    const infos = productInfoRows({
        sugarG: food.sugarG,
        saturatedFatG: food.saturatedFatG,
        offNutrientLevels: food.offNutrientLevels,
    });
    pushInfoRow(
        rows,
        infos.find((row) => row.kind === "sugars"),
        "Sugar",
    );
    pushInfoRow(
        rows,
        infos.find((row) => row.kind === "saturated-fat"),
        "Saturated fat",
    );
    const env = breakdownValue("environment", quality, scored);
    if (env) {
        rows.push(
            partRow({
                label: env.label,
                value: env.value,
                status: env.status,
            }),
        );
    }
    return rows;
}

export function buildProductMemberCards(
    food: Food,
    members: readonly ProductCheckMember[],
    noticesByMember: ReadonlyMap<string, Notice[]>,
): ProductMemberCard[] {
    return members.map((member) => {
        const notices = noticesByMember.get(member.id) ?? [];
        return {
            id: member.id,
            name: member.name,
            initials: initialsOf(member.name),
            verdict: memberProductVerdict(notices),
            reason: productMemberReasonLine(notices),
        };
    });
}

export function buildProductScoreSection(
    food: Food,
    memberCards: ProductMemberCard[],
): ProductScoreSection | null {
    const score = scoredFoodProduct(food);
    if (score == null) return null;
    return {
        score,
        presetLabel: SCORE_PRESET_LABELS[DEFAULT_SCORE_PRESET],
        memberCards,
    };
}

export function renderProductScoreSection(
    food: Food,
    section: ProductScoreSection,
): string {
    const { score: scored, presetLabel, memberCards } = section;
    const partsCount =
        scored.partsUsed < scored.partsTotal
            ? `<p class="fd-product-score__parts">scored on ${scored.partsUsed} of ${scored.partsTotal}</p>`
            : "";
    const partsHint = `<p class="fd-product-score__parts-hint">Parts with no data are left out, not counted against it.</p>`;
    const whyRows = whyScoreRows(food, scored);
    const memberRows = memberCards.map((card) =>
        memberCheckRow({
            name: card.name,
            initials: card.initials,
            verdict: card.verdict,
            reason: card.reason,
        }),
    );
    return `<section class="fd-product-score" aria-label="Product score">
<div class="fd-product-score__hero">
${String(scoreBig(scored.score))}
<div class="fd-product-score__hero-aside">
${String(scoreVerdict(scored.score))}
<p class="fd-product-score__weights">Your weights: ${esc(presetLabel)}</p>
</div>
</div>
${String(sectionHeader({ title: "Why this score", level: 2 }))}
${String(rowList(whyRows, { label: "Score breakdown" }))}
<div class="fd-product-score__parts-block">${partsCount}${partsHint}</div>
${String(sectionHeader({ title: "For your household", level: 2 }))}
${String(rowList(memberRows, { label: "Household members" }))}
</section>`;
}

export async function loadProductScoreSection(
    householdId: string,
    food: Food,
    viewerUserId: string,
): Promise<ProductScoreSection | null> {
    if (scoredFoodProduct(food) == null) return null;
    const viewerProfile = await getProfile(viewerUserId);
    const rawTz = viewerProfile?.timezone;
    const tz = rawTz && validateTz(rawTz) ? rawTz : "UTC";
    const today = todayInTz(tz);
    const [dayMeals, goalsRange] = await Promise.all([
        getMealsByDate(viewerUserId, today, tz),
        getGoalsForRange(viewerUserId, today, today),
    ]);
    const viewerRemaining = productCheckRemainingForDay(
        goalsRange.forDate(today),
        todayDayTotals(dayMeals, 0),
        viewerProfile?.alcohol_tracking_enabled ?? false,
    );
    const memberRows = await listHouseholdMembers(householdId);
    const rules = liveRulesStore();
    const members: ProductCheckMember[] = await Promise.all(
        memberRows.map(async (member) => {
            const [allergens, dislikes] = await Promise.all([
                rules.listAllergens(householdId, member.userId),
                rules.listDislikes(householdId, member.userId),
            ]);
            return {
                id: member.userId,
                name: member.displayName,
                allergens: allergens.map(
                    (row) => row.allergen,
                ) as AllergenCode[],
                dislikes: dislikes.map((row) => row.displayName),
            };
        }),
    );
    const product = productCheckFromFood(food);
    const noticesByMember = memberChecksForProduct(
        product,
        members,
        (member) =>
            member.id === viewerUserId
                ? { remaining: viewerRemaining }
                : { remaining: {} },
    );
    const memberCards = buildProductMemberCards(food, members, noticesByMember);
    return buildProductScoreSection(food, memberCards);
}

/** Fixture helper: build member cards without a database. */
export function previewMemberCards(
    food: Food,
    members: ProductCheckMember[],
): ProductMemberCard[] {
    const product = productCheckFromFood(food);
    const noticesByMember = memberChecksForProduct(product, members, () => ({
        remaining: {},
    }));
    return buildProductMemberCards(food, members, noticesByMember);
}
