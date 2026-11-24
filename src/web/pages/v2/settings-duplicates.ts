/**
 * Settings › Saved foods & recipes › Possible duplicates (FigCraft 415958,
 * 416211) and its compare page (416488).
 *
 * The list shows each pair once as an Item row with a ⋯: Compare and merge
 * opens the compare page, Keep apart dismisses the pair. The compare page picks
 * the food to keep (a radio row each), shows the values that differ with a
 * segmented choice per value, and ends with Keep apart and Merge into the kept
 * food. Nothing here merges on its own: every action posts to the household
 * routes (`/settings/household/possible-duplicates/{merge,keep-separate}`),
 * which carry an optional `back` that this module validates
 * (`duplicatesBackFrom`).
 */
import type { AppChromeBase } from "../../attention.js";
import {
    defaultMergeKeepId,
    foodDisplayName,
    foodPairMergeConflicts,
    type Food,
    type MergePairPickField,
    type PossibleDuplicatePair,
} from "../../../domain/foods.js";
import { ALLERGEN_LABELS, isAllergenCode } from "../../../domain/rules.js";
import { button } from "../../components/v2/button.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { segmented } from "../../components/v2/segmented.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";

export const DUPLICATES_PATH = "/settings/saved/duplicates";
export const DUPLICATES_MERGE_ACTION =
    "/settings/household/possible-duplicates/merge";
export const DUPLICATES_KEEP_SEPARATE_ACTION =
    "/settings/household/possible-duplicates/keep-separate";

/**
 * Posted by the compare page's forms (`view=compare`): a success goes to the
 * list, since the pair is gone, but a refusal re-renders the compare page.
 */
export const DUPLICATES_VIEW_COMPARE = "compare";

// Lowercase only, like the ids the app emits: `findDuplicatePair` compares ids
// exactly, so an uppercase UUID would pass here and then 404.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const COMPARE_PATH = new RegExp(`^${DUPLICATES_PATH}/${UUID}/${UUID}$`);

export function duplicateComparePath(a: string, b: string): string {
    return `${DUPLICATES_PATH}/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
}

/** The anchor of a pair's row on the list (a notice's link opens it). */
export function duplicateRowId(pair: PossibleDuplicatePair): string {
    return `dup-${pair.subject.id}-${pair.related.id}`;
}

/**
 * Where a merge or keep-separate post goes back to: the list, or the compare
 * page of one pair. An explicit allowlist, not `isSafeAppBackPath` (which
 * refuses `/settings` paths): anything else, an absolute URL included, is the
 * list.
 */
export function duplicatesBackFrom(value: string | undefined | null): string {
    if (value === DUPLICATES_PATH) return DUPLICATES_PATH;
    if (typeof value === "string" && COMPARE_PATH.test(value)) return value;
    return DUPLICATES_PATH;
}

export type DuplicateMergePost = {
    foodA: string;
    foodB: string;
    keepId: string;
    picks: Partial<Record<MergePairPickField, string>>;
};

export type SettingsDuplicatesV2View = {
    chrome: AppChromeBase;
    pairs: readonly PossibleDuplicatePair[];
    refCounts: ReadonlyMap<string, number>;
    error?: string;
};

export type SettingsDuplicateCompareV2View = {
    chrome: AppChromeBase;
    pair: PossibleDuplicatePair;
    refCounts: ReadonlyMap<string, number>;
    error?: string;
    /** The fields of a refused merge, so the form shows what was chosen. */
    mergePost?: DuplicateMergePost;
};

/** The pair a compare URL names, in either order, when it is a current suggestion. */
export function findDuplicatePair(
    pairs: readonly PossibleDuplicatePair[],
    a: string,
    b: string,
): PossibleDuplicatePair | undefined {
    return pairs.find(
        (p) =>
            (p.subject.id === a && p.related.id === b) ||
            (p.subject.id === b && p.related.id === a),
    );
}

function usesLabel(count: number): string {
    return `${count} ${count === 1 ? "use" : "uses"}`;
}

function usesOf(
    refCounts: ReadonlyMap<string, number>,
    food: { id: string },
): number {
    return refCounts.get(food.id) ?? 0;
}

function pairTitle(pair: PossibleDuplicatePair): string {
    return `${foodDisplayName(pair.subject)} · ${foodDisplayName(pair.related)}`;
}

function menuItems(pair: PossibleDuplicatePair): MenuItem[] {
    return [
        {
            kind: "link",
            label: "Compare and merge",
            href: duplicateComparePath(pair.subject.id, pair.related.id),
        },
        {
            kind: "post",
            label: "Keep apart",
            action: DUPLICATES_KEEP_SEPARATE_ACTION,
            fields: {
                subject_id: pair.subject.id,
                related_id: pair.related.id,
                back: DUPLICATES_PATH,
            },
        },
    ];
}

function pairRow(
    pair: PossibleDuplicatePair,
    refCounts: ReadonlyMap<string, number>,
): Html {
    const title = pairTitle(pair);
    return itemRow({
        id: duplicateRowId(pair),
        title,
        subtitle: `${usesLabel(usesOf(refCounts, pair.subject))} and ${usesLabel(usesOf(refCounts, pair.related))}`,
        trailing: {
            kind: "control",
            html: menu({
                label: `Actions for ${title}`,
                anchor: "more",
                items: menuItems(pair),
            }),
        },
    });
}

export function renderSettingsDuplicatesV2Body(
    view: SettingsDuplicatesV2View,
): string {
    return String(
        join([
            settingsErrorBanner(view.error),
            view.pairs.length === 0
                ? emptyState({ title: "No possible duplicates" })
                : listGroup({
                      label: "Possible duplicates",
                      rows: view.pairs.map((p) => pairRow(p, view.refCounts)),
                  }),
        ]),
    );
}

export function renderSettingsDuplicatesV2Page(
    view: SettingsDuplicatesV2View,
): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        page: "saved",
        title: "Possible duplicates",
        backHref: "/settings/saved",
        backLabel: "Saved foods & recipes",
        className: "fd-dups-page",
        body: renderSettingsDuplicatesV2Body(view),
    });
}

// ---- compare page ----

const PICK_LABELS: Record<MergePairPickField, string> = {
    calories: "Calories",
    protein_g: "Protein",
    carbs_g: "Carbs",
    fat_g: "Fat",
    fiber_g: "Fiber",
    sugar_g: "Sugar",
    alcohol_g: "Alcohol",
    caffeine_mg: "Caffeine",
    grams_per_each: "Grams per each",
    grams_per_ml: "Grams per ml",
    default_unit: "Default unit",
};

const PICK_KEYS: Record<
    Exclude<MergePairPickField, "default_unit">,
    keyof Food
> = {
    calories: "calories",
    protein_g: "proteinG",
    carbs_g: "carbsG",
    fat_g: "fatG",
    fiber_g: "fiberG",
    sugar_g: "sugarG",
    alcohol_g: "alcoholG",
    caffeine_mg: "caffeineMg",
    grams_per_each: "gramsPerEach",
    grams_per_ml: "gramsPerMl",
};

function pickValue(food: Food, wire: MergePairPickField): string {
    if (wire === "default_unit") return food.defaultUnit.trim() || "g";
    const v = food[PICK_KEYS[wire]];
    return v == null ? "unknown" : String(v);
}

function allergenLabel(code: string): string {
    return isAllergenCode(code) ? ALLERGEN_LABELS[code] : code;
}

const SEPARATE_FORM_ID = "fd-dup-separate";

/** The food to keep: a radio row each; the one chosen names the Merge button. */
function keepRow(
    food: Food,
    refCounts: ReadonlyMap<string, number>,
    checked: boolean,
    slot: "a" | "b",
): Html {
    const subtitle = [food.brand, usesLabel(usesOf(refCounts, food))]
        .filter(Boolean)
        .join(" · ");
    return itemRow({
        title: food.name,
        subtitle,
        lead: {
            kind: "radio",
            label: `Keep ${foodDisplayName(food)}`,
            name: "keep_id",
            value: food.id,
            checked,
        },
        className: `fd-dup-keep fd-dup-keep--${slot}`,
    });
}

/**
 * The values the two foods disagree on, one row each with the foods' values as
 * a segmented choice. No radio starts checked: a value nobody picks comes from
 * the food kept, whichever one that is when the form posts, and the stylesheet
 * draws that food's value as the current one until a pick is made. Only a
 * refused post's own picks come back checked.
 */
function differRows(
    pair: PossibleDuplicatePair,
    post: DuplicateMergePost | undefined,
): Html[] {
    const picks = post?.picks ?? {};
    return foodPairMergeConflicts(pair.subject, pair.related).map((wire) =>
        itemRow({
            title: PICK_LABELS[wire],
            className: "fd-dup-differ-row",
            trailing: {
                kind: "control",
                html: segmented({
                    label: PICK_LABELS[wire],
                    name: `pick_${wire}`,
                    className: "fd-dup-segment",
                    segments: [pair.subject, pair.related].map((food) => ({
                        label: pickValue(food, wire),
                        value: food.id,
                        selected: picks[wire] === food.id,
                    })),
                }),
            },
        }),
    );
}

export function renderSettingsDuplicateCompareV2Body(
    view: SettingsDuplicateCompareV2View,
): string {
    const { pair, refCounts, mergePost } = view;
    const keepId =
        mergePost?.keepId ??
        defaultMergeKeepId(pair.subject, pair.related, refCounts);
    const subjectName = foodDisplayName(pair.subject);
    const relatedName = foodDisplayName(pair.related);
    const allergens = [
        ...new Set([...pair.subject.allergens, ...pair.related.allergens]),
    ];
    const differ = differRows(pair, mergePost);
    const hidden = (name: string, value: string) =>
        `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
    const mergeButton = (name: string, cls: string) =>
        `<span class="${cls}">${button({ label: `Merge into ${name}`, variant: "primary", type: "submit" })}</span>`;
    const mergeForm = `<form method="post" action="${DUPLICATES_MERGE_ACTION}" class="fd-dup-merge-form">${hidden("food_a", pair.subject.id)}${hidden("food_b", pair.related.id)}${hidden("back", DUPLICATES_PATH)}${hidden("view", DUPLICATES_VIEW_COMPARE)}${join(
        [
            sectionHeader({ label: "Keep", rule: false }),
            raw(
                `<div role="radiogroup" aria-label="Food to keep">${String(
                    listGroup({
                        rows: [
                            keepRow(
                                pair.subject,
                                refCounts,
                                keepId === pair.subject.id,
                                "a",
                            ),
                            keepRow(
                                pair.related,
                                refCounts,
                                keepId === pair.related.id,
                                "b",
                            ),
                        ],
                    }),
                )}</div>`,
            ),
            differ.length > 0
                ? join([
                      sectionHeader({
                          label: "Values that differ",
                          rule: false,
                      }),
                      listGroup({ label: "Values that differ", rows: differ }),
                  ])
                : raw(""),
            allergens.length > 0
                ? listGroup({
                      label: "Allergens",
                      rows: [
                          itemRow({
                              title: "Allergens combined",
                              value: allergens.map(allergenLabel).join(", "),
                          }),
                      ],
                  })
                : raw(""),
        ],
    )}<div class="fd-dup-actions">${button({ label: "Keep apart", type: "submit", attrs: { form: SEPARATE_FORM_ID } })}${mergeButton(subjectName, "fd-dup-merge-a")}${mergeButton(relatedName, "fd-dup-merge-b")}</div></form>`;
    const separateForm = `<form id="${SEPARATE_FORM_ID}" method="post" action="${DUPLICATES_KEEP_SEPARATE_ACTION}">${hidden("subject_id", pair.subject.id)}${hidden("related_id", pair.related.id)}${hidden("back", DUPLICATES_PATH)}${hidden("view", DUPLICATES_VIEW_COMPARE)}</form>`;
    return `${String(settingsErrorBanner(view.error))}${mergeForm}${separateForm}`;
}

export function renderSettingsDuplicateCompareV2Page(
    view: SettingsDuplicateCompareV2View,
): string {
    const title = `${foodDisplayName(view.pair.subject)} or ${foodDisplayName(view.pair.related)}?`;
    return renderHouseholdLayout({
        chrome: view.chrome,
        page: "saved",
        title,
        backHref: DUPLICATES_PATH,
        backLabel: "Possible duplicates",
        className: "fd-dups-page fd-dup-compare",
        body: renderSettingsDuplicateCompareV2Body(view),
    });
}
