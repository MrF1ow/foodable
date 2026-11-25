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
    SCORE_PART_LABELS,
} from "../../../domain/product-score-display.js";
import {
    memberProductVerdict,
    scoredFoodProduct,
    scoreQualityFromFoodQuality,
    type MemberProductVerdict,
} from "../../../domain/product-screen.js";
import type { Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { scoreCard } from "../../components/v2/score-card.js";
import { sectionHeader } from "../../components/v2/section-header.js";
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
    /** Set when the profile-pictures flag is on (null version = no picture). */
    avatar?: { userId: string; version: Date | null };
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
    rows.push(itemRow({ title: label, value: `${amount}${level}` }));
}

/** The score parts in the order the page lists them; a part with no data is named last. */
const SCORE_PARTS = ["nutrition", "processing", "additives"] as const;

const VERDICT_LABEL: Record<MemberProductVerdict, string> = {
    good: "Good",
    careful: "Careful",
    avoid: "Avoid",
};

export function whyScoreRows(food: Food, scored: ProductScore): Html[] {
    if (food.offQuality == null) return [];
    const quality = scoreQualityFromFoodQuality(food.offQuality);
    const rows: Html[] = [];
    const missing: string[] = [];
    const part = (name: (typeof SCORE_PARTS)[number] | "environment") => {
        const row = breakdownValue(name, quality, scored);
        if (row) rows.push(itemRow({ title: row.label, value: row.value }));
        else missing.push(SCORE_PART_LABELS[name]);
    };
    for (const name of SCORE_PARTS) part(name);
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
    // The Green-Score sits after the nutrients, as the design lists it.
    part("environment");
    // Parts with no data stay in the list, last, so the gap is stated.
    return [
        ...rows,
        ...missing.map((label) => itemRow({ title: label, value: "No data" })),
    ];
}

export function buildProductMemberCards(
    food: Food,
    members: readonly ProductCheckMember[],
    noticesByMember: ReadonlyMap<string, Notice[]>,
    /** Picture versions by user id; given only when pictures are on. */
    avatarVersions?: ReadonlyMap<string, Date>,
): ProductMemberCard[] {
    return members.map((member) => {
        const notices = noticesByMember.get(member.id) ?? [];
        return {
            id: member.id,
            name: member.name,
            initials: initialsOf(member.name),
            verdict: memberProductVerdict(notices),
            // Nothing to say is nothing shown: "Good" alone says it.
            reason:
                notices.length === 0 ? "" : productMemberReasonLine(notices),
            ...(avatarVersions
                ? {
                      avatar: {
                          userId: member.id,
                          version: avatarVersions.get(member.id) ?? null,
                      },
                  }
                : {}),
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
    const partial = scored.partsUsed < scored.partsTotal;
    const note = partial
        ? `Scored on ${scored.partsUsed} of ${scored.partsTotal}`
        : `Your weights: ${presetLabel}`;
    const whyRows = whyScoreRows(food, scored);
    const memberRows = memberCards.map((card) =>
        itemRow({
            title: card.name,
            subtitle: card.reason,
            value: VERDICT_LABEL[card.verdict],
            lead: {
                kind: "avatar",
                initials: card.initials,
                picture: card.avatar,
            },
        }),
    );
    const why =
        whyRows.length > 0
            ? `<div class="fd-product-group">${sectionHeader({ label: "Why this score", rule: false })}${listGroup({ rows: whyRows, label: "Score breakdown" })}</div>`
            : "";
    const household =
        memberRows.length > 0
            ? `<div class="fd-product-group">${sectionHeader({ label: "For your household", rule: false })}${listGroup({ rows: memberRows, label: "Household members" })}</div>`
            : "";
    return `<section class="fd-product-score" aria-label="Product score">${scoreCard({ score: scored.score, note })}${why}${household}</section>`;
}

export async function loadProductScoreSection(
    householdId: string,
    food: Food,
    viewerUserId: string,
    scoreSettings: ScoreSettingsStore = liveScoreSettingsStore(),
    /** Picture versions by user id; given only when pictures are on. */
    avatarVersions?: ReadonlyMap<string, Date>,
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
    const memberCards = buildProductMemberCards(
        food,
        members,
        noticesByMember,
        avatarVersions,
    );
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
