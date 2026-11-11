import type { AppChromeBase } from "../attention.js";
import type {
    PossibleDuplicatePair,
    MergePairPickField,
} from "../../domain/foods.js";
import {
    foodDisplayName,
    defaultMergeKeepId,
    foodPairMergeConflicts,
} from "../../domain/foods.js";
import { ALLERGEN_LABELS, isAllergenCode } from "../../domain/rules.js";
import { escapeHtml, renderAppShell } from "../shell.js";
import { renderHouseholdNav } from "../components/settings-nav.js";
import {
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    panel,
    type ModalFill,
    row,
} from "../components/ui.js";

export const DUP_MERGE_MODAL_ID = "dup-merge";

export type PossibleDuplicatesView = {
    chrome: AppChromeBase;
    pairs: PossibleDuplicatePair[];
    refCounts: ReadonlyMap<string, number>;
    error?: string;
    openModalId?: string;
    /** Reposted merge fields when validation fails. */
    mergePost?: {
        foodA: string;
        foodB: string;
        keepId: string;
        picks: Partial<Record<MergePairPickField, string>>;
    };
};

function ruleLabel(rule: PossibleDuplicatePair["rule"]): string {
    return rule === "same_words" ? "Same words" : "Contains every word";
}

function foodTitle(food: { name: string; brand: string | null }): string {
    return foodDisplayName(food);
}

function pairRowTitle(pair: PossibleDuplicatePair): string {
    return `${foodTitle(pair.subject)} · ${foodTitle(pair.related)}`;
}

function pickFieldLabel(wire: MergePairPickField): string {
    switch (wire) {
        case "calories":
            return "Calories";
        case "protein_g":
            return "Protein";
        case "carbs_g":
            return "Carbs";
        case "fat_g":
            return "Fat";
        case "fiber_g":
            return "Fiber";
        case "sugar_g":
            return "Sugar";
        case "alcohol_g":
            return "Alcohol";
        case "caffeine_mg":
            return "Caffeine";
        case "grams_per_each":
            return "Grams per each";
        case "grams_per_ml":
            return "Grams per ml";
        case "default_unit":
            return "Default unit";
    }
}

function allergenDisplayLabel(code: string): string {
    return isAllergenCode(code) ? ALLERGEN_LABELS[code] : code;
}

function formatPickValue(
    food: PossibleDuplicatePair["subject"],
    wire: MergePairPickField,
): string {
    if (wire === "default_unit") {
        return food.defaultUnit.trim() || "g";
    }
    const key =
        wire === "protein_g"
            ? "proteinG"
            : wire === "carbs_g"
              ? "carbsG"
              : wire === "fat_g"
                ? "fatG"
                : wire === "fiber_g"
                  ? "fiberG"
                  : wire === "sugar_g"
                    ? "sugarG"
                    : wire === "alcohol_g"
                      ? "alcoholG"
                      : wire === "caffeine_mg"
                        ? "caffeineMg"
                        : wire === "grams_per_each"
                          ? "gramsPerEach"
                          : wire === "grams_per_ml"
                            ? "gramsPerMl"
                            : "calories";
    const v = food[key as keyof typeof food];
    return v == null ? "unknown" : String(v);
}

function mergeFormBody(
    pair: PossibleDuplicatePair,
    refCounts: ReadonlyMap<string, number>,
    post?: PossibleDuplicatesView["mergePost"],
): string {
    const defaultKeep = defaultMergeKeepId(
        pair.subject,
        pair.related,
        refCounts,
    );
    const keepId = post?.keepId ?? defaultKeep;
    const picks = post?.picks ?? {};
    const conflicts = foodPairMergeConflicts(pair.subject, pair.related);
    const subjectAllergens = pair.subject.allergens;
    const relatedAllergens = pair.related.allergens;
    const allergenUnion = [
        ...new Set([...subjectAllergens, ...relatedAllergens]),
    ];
    const allergenNote =
        subjectAllergens.length > 0 || relatedAllergens.length > 0
            ? `<p>Allergens are combined: ${escapeHtml(
                  allergenUnion.map(allergenDisplayLabel).join(", "),
              )}.</p>`
            : "";
    const keepRadios = [pair.subject, pair.related]
        .map((food) => {
            const checked = keepId === food.id ? " checked" : "";
            return `<label><input type="radio" name="keep_id" value="${escapeHtml(food.id)}"${checked} /> ${escapeHtml(foodTitle(food))}</label>`;
        })
        .join("\n");
    let conflictFields = "";
    if (conflicts.length === 0) {
        conflictFields = "<p>No conflicting fields.</p>";
    } else {
        const fieldsets = conflicts
            .map((wire) => {
                const defaultPick = picks[wire] ?? keepId;
                const radios = [pair.subject, pair.related]
                    .map((food) => {
                        const checked =
                            defaultPick === food.id ? " checked" : "";
                        const val = formatPickValue(food, wire);
                        return `<label><input type="radio" name="pick_${escapeHtml(wire)}" value="${escapeHtml(food.id)}"${checked} /> ${escapeHtml(foodTitle(food))}: ${escapeHtml(val)}</label>`;
                    })
                    .join("\n");
                return `<fieldset class="field-grid"><legend>${escapeHtml(pickFieldLabel(wire))}</legend>${radios}</fieldset>`;
            })
            .join("\n");
        conflictFields = fieldsets;
    }
    return `<form method="post" action="/settings/household/possible-duplicates/merge" class="field-grid">
<input type="hidden" name="food_a" value="${escapeHtml(pair.subject.id)}" />
<input type="hidden" name="food_b" value="${escapeHtml(pair.related.id)}" />
<fieldset class="field-grid"><legend>Name to keep</legend>${keepRadios}</fieldset>
${conflictFields}
${allergenNote}
<button type="submit" class="btn-danger">Merge</button>
</form>`;
}

function mergeTemplate(
    pair: PossibleDuplicatePair,
    view: PossibleDuplicatesView,
): string {
    const tid = `dup-merge-${pair.subject.id}-${pair.related.id}`;
    const post =
        view.mergePost &&
        ((view.mergePost.foodA === pair.subject.id &&
            view.mergePost.foodB === pair.related.id) ||
            (view.mergePost.foodA === pair.related.id &&
                view.mergePost.foodB === pair.subject.id))
            ? view.mergePost
            : undefined;
    return `<template id="${escapeHtml(tid)}">${mergeFormBody(pair, view.refCounts, post)}</template>`;
}

function mergeFill(pair: PossibleDuplicatePair): ModalFill {
    const tid = `dup-merge-${pair.subject.id}-${pair.related.id}`;
    return {
        title: `Merge ${pair.subject.name} · ${pair.related.name}`,
        templates: { body: tid },
    };
}

function mergeSubmitClass(v2: boolean): string {
    return v2 ? "fd-settings-btn fd-settings-btn--danger" : "btn-danger";
}

function mergeFormBodyV2(
    pair: PossibleDuplicatePair,
    refCounts: ReadonlyMap<string, number>,
    post?: PossibleDuplicatesView["mergePost"],
): string {
    return mergeFormBody(pair, refCounts, post).replace(
        'class="btn-danger"',
        `class="${mergeSubmitClass(true)}"`,
    );
}

function pairRowV2(
    pair: PossibleDuplicatePair,
    view: PossibleDuplicatesView,
): string {
    const rowId = `dup-${pair.subject.id}-${pair.related.id}`;
    const mergeBtn = modalTrigger({
        target: DUP_MERGE_MODAL_ID,
        label: "Merge…",
        className: "fd-settings-btn fd-settings-btn--sm",
        fill: mergeFill(pair),
    });
    const keepSeparate = `<form method="post" action="/settings/household/possible-duplicates/keep-separate" class="fd-settings-inline-form">
<input type="hidden" name="subject_id" value="${escapeHtml(pair.subject.id)}" />
<input type="hidden" name="related_id" value="${escapeHtml(pair.related.id)}" />
<button type="submit" class="fd-settings-btn fd-settings-btn--sm">Keep separate</button>
</form>`;
    return `<li class="fd-row fd-row--dup" id="${escapeHtml(rowId)}"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${escapeHtml(pairRowTitle(pair))}</span><span class="fd-row__meta">${escapeHtml(ruleLabel(pair.rule))}</span></span></div><div class="fd-row__actions fd-row__actions--wrap">${mergeBtn}${keepSeparate}</div></div></li>`;
}

function pairRow(
    pair: PossibleDuplicatePair,
    view: PossibleDuplicatesView,
): string {
    const rowId = `dup-${pair.subject.id}-${pair.related.id}`;
    const mergeBtn = modalTrigger({
        target: DUP_MERGE_MODAL_ID,
        label: "Merge…",
        className: "btn-sm",
        fill: mergeFill(pair),
    });
    const keepSeparate = `<form method="post" action="/settings/household/possible-duplicates/keep-separate" class="row-actions">
<input type="hidden" name="subject_id" value="${escapeHtml(pair.subject.id)}" />
<input type="hidden" name="related_id" value="${escapeHtml(pair.related.id)}" />
<button type="submit" class="btn-sm">Keep separate</button>
</form>`;
    return `<li id="${escapeHtml(rowId)}">${row({
        title: pairRowTitle(pair),
        meta: ruleLabel(pair.rule),
        actions: `${mergeBtn}\n${keepSeparate}`,
    })}</li>`;
}

export type PossibleDuplicatesBlockOpts = {
    v2?: boolean;
};

/** Inline block for the v2 household page (list + merge modal). */
export function renderPossibleDuplicatesBlock(
    view: PossibleDuplicatesView,
    opts: PossibleDuplicatesBlockOpts = {},
): {
    listHtml: string;
    modalsHtml: string;
} {
    const v2 = opts.v2 === true;
    const openMerge = view.openModalId === DUP_MERGE_MODAL_ID;
    const activePair =
        view.mergePost &&
        view.pairs.find(
            (p) =>
                (p.subject.id === view.mergePost!.foodA &&
                    p.related.id === view.mergePost!.foodB) ||
                (p.subject.id === view.mergePost!.foodB &&
                    p.related.id === view.mergePost!.foodA),
        );
    const mergeError = openMerge && view.error ? errorBanner(view.error) : "";
    const mergeBody = (() => {
        if (openMerge && activePair) {
            const tid = `dup-merge-${activePair.subject.id}-${activePair.related.id}`;
            const html = v2
                ? mergeFormBodyV2(activePair, view.refCounts, view.mergePost)
                : mergeFormBody(activePair, view.refCounts, view.mergePost);
            return `${mergeError}<div data-fill-slot="body" data-filled-template="${escapeHtml(tid)}">${html}</div>`;
        }
        return `${mergeError}<div data-fill-slot="body"></div>`;
    })();
    const mergeModal =
        view.pairs.length > 0
            ? modal({
                  id: DUP_MERGE_MODAL_ID,
                  title: activePair
                      ? `Merge ${activePair.subject.name} · ${activePair.related.name}`
                      : "Merge",
                  openOnLoad: openMerge,
                  body: mergeBody,
                  submitDisabled: !openMerge,
              })
            : "";
    const templates = view.pairs
        .map((p) => {
            if (!v2) return mergeTemplate(p, view);
            const tid = `dup-merge-${p.subject.id}-${p.related.id}`;
            const post =
                view.mergePost &&
                ((view.mergePost.foodA === p.subject.id &&
                    view.mergePost.foodB === p.related.id) ||
                    (view.mergePost.foodA === p.related.id &&
                        view.mergePost.foodB === p.subject.id))
                    ? view.mergePost
                    : undefined;
            return `<template id="${escapeHtml(tid)}">${mergeFormBodyV2(p, view.refCounts, post)}</template>`;
        })
        .join("");
    const rows = view.pairs
        .map((p) => (v2 ? pairRowV2(p, view) : pairRow(p, view)))
        .join("");
    const listHtml =
        view.pairs.length === 0
            ? emptyState("No possible duplicates.")
            : v2
              ? `<ul class="fd-list">${rows}</ul>${templates}`
              : `<ul class="list">${rows}</ul>${templates}`;
    return { listHtml, modalsHtml: mergeModal };
}

export function renderPossibleDuplicatesPage(
    view: PossibleDuplicatesView,
): string {
    const openMerge = view.openModalId === DUP_MERGE_MODAL_ID;
    const activePair =
        view.mergePost &&
        view.pairs.find(
            (p) =>
                (p.subject.id === view.mergePost!.foodA &&
                    p.related.id === view.mergePost!.foodB) ||
                (p.subject.id === view.mergePost!.foodB &&
                    p.related.id === view.mergePost!.foodA),
        );
    const mergeError = openMerge && view.error ? errorBanner(view.error) : "";
    const mergeBody = (() => {
        if (openMerge && activePair) {
            const tid = `dup-merge-${activePair.subject.id}-${activePair.related.id}`;
            const html = mergeFormBody(
                activePair,
                view.refCounts,
                view.mergePost,
            );
            return `${mergeError}<div data-fill-slot="body" data-filled-template="${escapeHtml(tid)}">${html}</div>`;
        }
        return `${mergeError}<div data-fill-slot="body"></div>`;
    })();
    const mergeModal =
        view.pairs.length > 0
            ? modal({
                  id: DUP_MERGE_MODAL_ID,
                  title: activePair
                      ? `Merge ${activePair.subject.name} · ${activePair.related.name}`
                      : "Merge",
                  openOnLoad: openMerge,
                  body: mergeBody,
                  submitDisabled: !openMerge,
              })
            : "";
    const templates = view.pairs.map((p) => mergeTemplate(p, view)).join("");
    const rows = view.pairs.map((p) => pairRow(p, view)).join("");
    const list =
        view.pairs.length === 0
            ? emptyState("No possible duplicates.")
            : panel({
                  body: `<ul class="list">${rows}</ul>${templates}`,
              });
    const modalIds = view.pairs.length > 0 ? [DUP_MERGE_MODAL_ID] : [];
    const body = `
        ${pageHeader({ title: "Possible duplicates" })}
        ${pageLevelErrorBanner(view, modalIds)}
        ${renderHouseholdNav("possible-duplicates", {
            possibleDuplicates: view.chrome.householdPossibleDuplicates,
        })}
        ${list}
        ${mergeModal}
    `;
    return renderAppShell({
        ...view.chrome,
        title: "Possible duplicates",
        active: "household",
        body,
    });
}
