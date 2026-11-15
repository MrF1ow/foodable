/**
 * Settings › Saved foods & recipes › Possible duplicates (FigCraft 62847,
 * 63301) and its compare page (63177).
 *
 * The list shows each pair once with a "⋯" menu: Merge into A, Merge into B,
 * Not the same, More…. More… opens the compare page: both foods, a radio for
 * the one to keep, Merge and "Keep them separate". Nothing here merges on its
 * own: every action posts to the household routes
 * (`/settings/household/possible-duplicates/{merge,keep-separate}`), which
 * carry an optional `back` that this module validates (`duplicatesBackFrom`).
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
import { esc, raw, type Html } from "../../components/v2/html.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { rowList } from "../../components/v2/rows.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsPageHeader,
} from "./settings-shared.js";

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

function menuItems(
    pair: PossibleDuplicatePair,
    refCounts: ReadonlyMap<string, number>,
): MenuItem[] {
    const pairFields = {
        food_a: pair.subject.id,
        food_b: pair.related.id,
        back: DUPLICATES_PATH,
    };
    const mergeInto = (food: Food): MenuItem => ({
        kind: "post",
        label: `Merge into ${foodDisplayName(food)}`,
        hint: `Keeps ${foodDisplayName(food)} · ${usesLabel(usesOf(refCounts, food))}`,
        action: DUPLICATES_MERGE_ACTION,
        fields: { ...pairFields, keep_id: food.id },
    });
    return [
        mergeInto(pair.subject),
        mergeInto(pair.related),
        {
            kind: "post",
            label: "Not the same",
            action: DUPLICATES_KEEP_SEPARATE_ACTION,
            fields: {
                subject_id: pair.subject.id,
                related_id: pair.related.id,
                back: DUPLICATES_PATH,
            },
        },
        { kind: "separator" },
        {
            kind: "link",
            label: "More…",
            hint: "Compare details first",
            href: duplicateComparePath(pair.subject.id, pair.related.id),
        },
    ];
}

function pairRow(
    pair: PossibleDuplicatePair,
    refCounts: ReadonlyMap<string, number>,
): Html {
    const title = pairTitle(pair);
    const sub = `${usesLabel(usesOf(refCounts, pair.subject))} and ${usesLabel(usesOf(refCounts, pair.related))}`;
    return raw(
        `<li class="fd-row fd-row--dup" id="${esc(duplicateRowId(pair))}"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title" title="${esc(title)}">${esc(title)}</span></span><span class="fd-row__sub">${esc(sub)}</span></div>${String(menu({ label: `Actions for ${title}`, items: menuItems(pair, refCounts), className: "fd-dup-menu" }))}</div></li>`,
    );
}

export function renderSettingsDuplicatesV2Body(
    view: SettingsDuplicatesV2View,
): string {
    const lead =
        "Foods that look like the same thing. Use ⋯ to merge or keep them apart.";
    const list =
        view.pairs.length === 0
            ? `<p class="fd-settings-household-empty">No possible duplicates.</p>`
            : String(
                  rowList(
                      view.pairs.map((p) => pairRow(p, view.refCounts)),
                      {
                          label: "Possible duplicates",
                          className: "fd-list--card",
                      },
                  ),
              );
    return `${String(settingsPageHeader("Possible duplicates"))}${String(settingsErrorBanner(view.error))}<div class="fd-settings-hh fd-dups" data-fd-duplicates><p class="fd-dups__lead">${esc(lead)}</p>${list}</div>`;
}

export function renderSettingsDuplicatesV2Page(
    view: SettingsDuplicatesV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "saved",
        title: "Possible duplicates",
        backHref: "/settings/saved",
        backLabel: "Saved foods & recipes",
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

function choiceRow(
    food: Food,
    refCounts: ReadonlyMap<string, number>,
    checked: boolean,
    slot: "a" | "b",
): string {
    const meta = [food.brand, usesLabel(usesOf(refCounts, food))]
        .filter(Boolean)
        .join(" · ");
    return `<li class="fd-row fd-row--dup-choice"><label class="fd-row__body fd-dup-choice"><span class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${esc(food.name)}</span></span><span class="fd-row__sub">${esc(meta)}</span></span><input type="radio" class="fd-dup-radio" name="keep_id" value="${esc(food.id)}" data-fd-dup-keep="${slot}"${checked ? " checked" : ""}></label></li>`;
}

function conflictFields(
    pair: PossibleDuplicatePair,
    post: DuplicateMergePost | undefined,
): string {
    const conflicts = foodPairMergeConflicts(pair.subject, pair.related);
    if (conflicts.length === 0) return "";
    const picks = post?.picks ?? {};
    const sets = conflicts
        .map((wire) => {
            // Checked only when a refused post carried this pick: a default would
            // not follow the keep radio, and the server already takes the kept
            // food's value for any pick not posted.
            const chosen = picks[wire];
            const radios = [pair.subject, pair.related]
                .map(
                    (food) =>
                        `<label class="fd-dup-pick"><input type="radio" name="pick_${esc(wire)}" value="${esc(food.id)}"${chosen === food.id ? " checked" : ""}><span>${esc(foodDisplayName(food))}: ${esc(pickValue(food, wire))}</span></label>`,
                )
                .join("");
            return `<fieldset class="fd-dup-field"><legend class="fd-dup-field__legend">${esc(PICK_LABELS[wire])}</legend>${radios}</fieldset>`;
        })
        .join("");
    return `<section class="fd-dup-differ" aria-label="Values that differ"><h2 class="fd-dup-differ__title">Values that differ</h2><p class="fd-dups__lead">Pick which food each value comes from. A value you leave unpicked comes from the food you keep.</p>${sets}</section>`;
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
    const allergenNote =
        allergens.length > 0
            ? `<p class="fd-dups__lead">Allergens are combined: ${esc(allergens.map(allergenLabel).join(", "))}.</p>`
            : "";
    const choices = `<ul class="fd-list fd-list--card fd-dup-choices" aria-label="Food to keep">${choiceRow(pair.subject, refCounts, keepId === pair.subject.id, "a")}${choiceRow(pair.related, refCounts, keepId === pair.related.id, "b")}</ul>`;
    const mergeForm = `<form method="post" action="${DUPLICATES_MERGE_ACTION}" class="fd-dup-merge-form"><input type="hidden" name="food_a" value="${esc(pair.subject.id)}"><input type="hidden" name="food_b" value="${esc(pair.related.id)}"><input type="hidden" name="back" value="${DUPLICATES_PATH}"><input type="hidden" name="view" value="${DUPLICATES_VIEW_COMPARE}">${choices}${conflictFields(pair, mergePost)}${allergenNote}<button type="submit" class="fd-dup-btn fd-dup-btn--primary"><span class="fd-dup-btn__a">Merge into ${esc(subjectName)}</span><span class="fd-dup-btn__b">Merge into ${esc(relatedName)}</span></button></form>`;
    const separateForm = `<form method="post" action="${DUPLICATES_KEEP_SEPARATE_ACTION}" class="fd-dup-separate-form"><input type="hidden" name="subject_id" value="${esc(pair.subject.id)}"><input type="hidden" name="related_id" value="${esc(pair.related.id)}"><input type="hidden" name="back" value="${DUPLICATES_PATH}"><input type="hidden" name="view" value="${DUPLICATES_VIEW_COMPARE}"><button type="submit" class="fd-dup-btn">Keep them separate</button></form>`;
    return `${String(settingsPageHeader(`${subjectName} or ${relatedName}?`))}${String(settingsErrorBanner(view.error))}<div class="fd-settings-hh fd-dups fd-dup-compare" data-fd-duplicate-compare><p class="fd-dups__lead">Pick the one to keep. Every fridge item, grocery line and recipe that uses the other moves over to it.</p>${mergeForm}${separateForm}</div>`;
}

export function renderSettingsDuplicateCompareV2Page(
    view: SettingsDuplicateCompareV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "saved",
        title: `${foodDisplayName(view.pair.subject)} or ${foodDisplayName(view.pair.related)}?`,
        backHref: DUPLICATES_PATH,
        backLabel: "Possible duplicates",
        body: renderSettingsDuplicateCompareV2Body(view),
    });
}

/** The "Possible duplicates" link at the top of Saved foods & recipes. */
export function duplicatesLink(count: number): Html {
    const badge =
        count > 0
            ? `<span class="fd-settings-menu__badge">${esc(String(count))}</span>`
            : "";
    return raw(
        `<a class="fd-settings-saved-dups" href="${DUPLICATES_PATH}"><span class="fd-settings-saved-dups__label">Possible duplicates</span>${badge}<span class="fd-settings-menu__chev" aria-hidden="true">${String(iconChevronRight())}</span></a>`,
    );
}
