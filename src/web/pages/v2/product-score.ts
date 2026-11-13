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
    type ScoreChoicePreset,
    type ScoreWeights,
} from "../../../domain/product-score.js";
import { liveScoreSettingsStore } from "../../../db/score-settings.js";
import {
    scoreSettingsForViewer,
    type ScoreSettingsStore,
} from "../../../domain/score-settings.js";
import type { ProductCheckMember } from "../../../domain/product-checks.js";
import {
    breakdownValue,
    levelStatus,
} from "../../../domain/product-score-display.js";
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

/** How the viewer weights the score; Balanced when not given. */
export type ProductScoreViewer = {
    weights?: ScoreWeights;
    preset?: ScoreChoicePreset;
};

export function buildProductScoreSection(
    food: Food,
    memberCards: ProductMemberCard[],
    viewer: ProductScoreViewer = {},
): ProductScoreSection | null {
    const score = scoredFoodProduct(food, viewer.weights);
    if (score == null) return null;
    return {
        score,
        presetLabel: SCORE_PRESET_LABELS[viewer.preset ?? DEFAULT_SCORE_PRESET],
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
    scoreSettings: ScoreSettingsStore = liveScoreSettingsStore(),
): Promise<ProductScoreSection | null> {
    const viewerSettings = await scoreSettingsForViewer(
        scoreSettings,
        householdId,
        viewerUserId,
    );
    if (scoredFoodProduct(food, viewerSettings.weights) == null) return null;
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
    // Each member's own switches decide what their card reports.
    const members: ProductCheckMember[] = await Promise.all(
        memberRows.map(async (member) => {
            const [allergens, dislikes, switches] = await Promise.all([
                rules.listAllergens(householdId, member.userId),
                rules.listDislikes(householdId, member.userId),
                scoreSettings.getMember(householdId, member.userId),
            ]);
            return {
                warnTraces: switches?.warnTraces ?? true,
                compareGoals: switches?.compareGoals ?? true,
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
    return buildProductScoreSection(food, memberCards, {
        weights: viewerSettings.weights,
        preset: viewerSettings.preset,
    });
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
