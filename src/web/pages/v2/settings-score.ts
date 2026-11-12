import type { AppChromeBase } from "../../attention.js";
import {
    SCORE_PARTS,
    SCORE_PRESET_LABELS,
    SCORE_PRESETS,
    SCORE_WEIGHT_MAX,
    SCORE_WEIGHT_MIN,
    validateScoreChoice,
    type ScoreChoice,
    type ScoreChoicePreset,
    type ScorePart,
    type ScoreWeights,
} from "../../../domain/product-score.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { esc } from "../../components/v2/html.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsMenuIcon,
    settingsPageHeader,
    settingsPrimarySubmit,
} from "./settings-shared.js";

export const SCORE_PATH = "/settings/product-score";
export const SCORE_HOUSEHOLD_PATH = "/settings/product-score/household";

/** What a person's save on this page is for; one field, `intent`, says which. */
export type ScoreIntent =
    "choice" | "household" | "warn_traces" | "compare_goals";

const SCORE_INTENTS: readonly ScoreIntent[] = [
    "choice",
    "household",
    "warn_traces",
    "compare_goals",
];

export function parseScoreIntent(raw: string): ScoreIntent | null {
    return (SCORE_INTENTS as readonly string[]).includes(raw)
        ? (raw as ScoreIntent)
        : null;
}

const PRESET_ORDER: readonly ScoreChoicePreset[] = [
    "balanced",
    "health_first",
    "less_processed",
    "planet",
    "custom",
];

const PART_LABEL: Record<ScorePart, { title: string; source: string }> = {
    nutrition: { title: "Nutrition", source: "Nutri-Score" },
    processing: { title: "Processing", source: "NOVA" },
    additives: { title: "Additives", source: "Risk tiers" },
    environment: { title: "Environment", source: "Green-Score" },
};

const weightField = (part: ScorePart) => `weight_${part}`;

/** What the form held when it was refused: the raw text, to show again. */
export type ScoreFormDraft = {
    preset: string;
    weights: Record<ScorePart, string>;
};

export type ScoreFormParse =
    | { ok: true; choice: ScoreChoice }
    | { ok: false; error: string; draft: ScoreFormDraft };

type FormBody = Record<string, unknown>;

function text(body: FormBody, name: string): string {
    const value = body[name];
    return typeof value === "string" ? value : "";
}

/** A whole number written out in full, else NaN (an empty field is not 0). */
function wholeNumber(value: string): number {
    return /^\s*\d{1,4}\s*$/.test(value) ? Number(value) : Number.NaN;
}

/**
 * Reads the preset and four weights a person submitted. A preset ignores the
 * weights; Custom needs four whole numbers from 0 to 100, at least one above 0.
 * The handler calls this before any write, so a refused form changes nothing.
 */
export function parseScoreForm(body: FormBody): ScoreFormParse {
    const preset = text(body, "preset");
    const weights = Object.fromEntries(
        SCORE_PARTS.map((part) => [part, text(body, weightField(part))]),
    ) as Record<ScorePart, string>;
    const draft: ScoreFormDraft = { preset, weights };
    const checked = validateScoreChoice({
        preset,
        weights: Object.fromEntries(
            SCORE_PARTS.map((part) => [part, wholeNumber(weights[part])]),
        ),
    });
    if (!checked.ok) return { ok: false, error: checked.error, draft };
    return { ok: true, choice: checked.value };
}

export type SettingsScoreV2View = {
    chrome: AppChromeBase;
    /** The preset the viewer's scores use now (their own, else the household's). */
    preset: ScoreChoicePreset;
    /** The weights behind it. */
    weights: ScoreWeights;
    /** True when the viewer has no choice of their own. */
    followsHousehold: boolean;
    /** The household default's name ("Balanced" when none is set). */
    householdPresetLabel: string;
    /** Owners and admins edit the household default; others only read it. */
    canEditHousehold: boolean;
    warnTraces: boolean;
    compareGoals: boolean;
    /** "Milk, Peanut" or "None set": the viewer's allergens, from person rules. */
    allergensText: string;
    /** Where the Allergies row goes: the viewer's own person rules. */
    allergensHref: string;
    error?: string;
    /** A refused save: what the form held. */
    draft?: ScoreFormDraft;
};

export type SettingsScoreHouseholdV2View = {
    chrome: AppChromeBase;
    /** The household default now; Balanced when none is set. */
    preset: ScoreChoicePreset;
    weights: ScoreWeights;
    /** True when a default is set (so it can be cleared). */
    isSet: boolean;
    error?: string;
    draft?: ScoreFormDraft;
};

/** Each part's share of the total, in whole percent; all zero when no weights. */
export function weightShares(weights: ScoreWeights): ScoreWeights {
    const total = SCORE_PARTS.reduce((sum, part) => sum + weights[part], 0);
    const share = (part: ScorePart) =>
        total > 0 ? Math.round((weights[part] / total) * 100) : 0;
    return {
        nutrition: share("nutrition"),
        processing: share("processing"),
        additives: share("additives"),
        environment: share("environment"),
    };
}

function presetsJson(): string {
    return JSON.stringify(SCORE_PRESETS);
}

function weightRow(
    part: ScorePart,
    value: string,
    share: number,
    idPrefix: string,
): string {
    const id = `${idPrefix}-${part}`;
    const label = PART_LABEL[part];
    const numeric = Number(value);
    const fill = Number.isFinite(numeric)
        ? Math.min(SCORE_WEIGHT_MAX, Math.max(SCORE_WEIGHT_MIN, numeric))
        : 0;
    return `<div class="fd-scoreset__weight" data-fd-score-part="${esc(part)}"><div class="fd-scoreset__weight-head"><span class="fd-scoreset__weight-label" id="${esc(id)}-label"><span class="fd-scoreset__weight-title">${esc(label.title)}</span><span class="fd-scoreset__weight-source">${esc(label.source)}</span></span><output class="fd-scoreset__weight-value" for="${esc(id)}" data-fd-score-share>${esc(share)}%</output></div><input class="fd-scoreset__range" type="range" id="${esc(id)}" aria-labelledby="${esc(id)}-label" name="${esc(weightField(part))}" min="${SCORE_WEIGHT_MIN}" max="${SCORE_WEIGHT_MAX}" step="1" value="${esc(value)}" style="--fd-fill:${fill}%"></div>`;
}

/** The preset chips and four sliders: one form body, shared by member and household. */
function choiceFields(opts: {
    selected: ScoreChoicePreset;
    weights: Record<ScorePart, string>;
    idPrefix: string;
}): string {
    const numeric = Object.fromEntries(
        SCORE_PARTS.map((part) => [part, Number(opts.weights[part]) || 0]),
    ) as ScoreWeights;
    const shares = weightShares(numeric);
    const shareTotal = SCORE_PARTS.some((part) => numeric[part] > 0) ? 100 : 0;
    const chips = String(
        choiceGroup({
            name: "preset",
            legend: "Preset",
            showLegend: true,
            required: true,
            className: "fd-scoreset__presets",
            options: PRESET_ORDER.map((preset) => ({
                value: preset,
                label: SCORE_PRESET_LABELS[preset],
                selected: preset === opts.selected,
            })),
        }),
    );
    const rows = SCORE_PARTS.map((part) =>
        weightRow(part, opts.weights[part], shares[part], opts.idPrefix),
    ).join("");
    return `<div class="fd-scoreset__choice" data-fd-score-form data-fd-score-presets="${esc(presetsJson())}">${chips}<div class="fd-scoreset__weights-head"><h2 class="fd-scoreset__label">Weights</h2><span class="fd-scoreset__total" data-fd-score-total>${esc(shareTotal)}%</span></div><div class="fd-scoreset__weights">${rows}</div></div>`;
}

function stringWeights(weights: ScoreWeights): Record<ScorePart, string> {
    return Object.fromEntries(
        SCORE_PARTS.map((part) => [part, String(weights[part])]),
    ) as Record<ScorePart, string>;
}

function draftPreset(
    draft: ScoreFormDraft | undefined,
    fallback: ScoreChoicePreset,
): ScoreChoicePreset {
    return draft && (PRESET_ORDER as readonly string[]).includes(draft.preset)
        ? (draft.preset as ScoreChoicePreset)
        : fallback;
}

function switchForm(opts: {
    intent: "warn_traces" | "compare_goals";
    on: boolean;
    title: string;
    sub: string;
}): string {
    return `<li class="fd-scoreset__row"><form method="post" action="${SCORE_PATH}" class="fd-scoreset__switch-form" data-turbo="false"><input type="hidden" name="intent" value="${esc(opts.intent)}"><input type="hidden" name="value" value="${opts.on ? "0" : "1"}"><span class="fd-scoreset__row-text"><span class="fd-scoreset__row-title">${esc(opts.title)}</span><span class="fd-scoreset__row-sub">${esc(opts.sub)}</span></span><button type="submit" class="fd-switch" role="switch" aria-checked="${opts.on ? "true" : "false"}" aria-label="${esc(opts.title)}"><span class="fd-switch__knob" aria-hidden="true"></span></button></form></li>`;
}

function chevron(): string {
    return `<span class="fd-scoreset__chev" aria-hidden="true">${String(iconChevronRight())}</span>`;
}

function allergiesRow(view: SettingsScoreV2View): string {
    return `<li class="fd-scoreset__row fd-scoreset__row--link"><a class="fd-scoreset__link" href="${esc(view.allergensHref)}"><span class="fd-scoreset__row-text"><span class="fd-scoreset__row-title">Allergies</span><span class="fd-scoreset__row-sub">${esc(view.allergensText)} · from your person rules</span></span>${chevron()}</a></li>`;
}

function householdRow(view: SettingsScoreV2View): string {
    const inner = `<span class="fd-scoreset__household-icon">${settingsMenuIcon("users", "fd-scoreset__household-svg")}</span><span class="fd-scoreset__household-title">Household default</span><span class="fd-scoreset__household-value">${esc(view.householdPresetLabel)}</span>`;
    if (view.canEditHousehold) {
        return `<a class="fd-scoreset__household" href="${SCORE_HOUSEHOLD_PATH}">${inner}${chevron()}</a>`;
    }
    return `<div class="fd-scoreset__household fd-scoreset__household--static">${inner}</div>`;
}

export function renderSettingsScoreV2Body(view: SettingsScoreV2View): string {
    const draft = view.draft;
    const selected = draftPreset(draft, view.preset);
    const weights = draft ? draft.weights : stringWeights(view.weights);
    const following = view.followsHousehold
        ? `<p class="fd-scoreset__note">You are using the household default (${esc(view.householdPresetLabel)}). Save a choice to use your own.</p>`
        : `<form method="post" action="${SCORE_PATH}" class="fd-scoreset__reset" data-turbo="false"><input type="hidden" name="intent" value="household"><button type="submit" class="fd-scoreset__use-default">Use household default (${esc(view.householdPresetLabel)})</button></form>`;
    const choiceForm = `<form method="post" action="${SCORE_PATH}" class="fd-scoreset__form" data-turbo="false"><input type="hidden" name="intent" value="choice">${choiceFields({ selected, weights, idPrefix: "fd-score-w" })}${settingsPrimarySubmit("Save weights")}</form>`;
    const checks = `<h2 class="fd-scoreset__label">Checks for you</h2><ul class="fd-scoreset__rows">${allergiesRow(view)}${switchForm({ intent: "warn_traces", on: view.warnTraces, title: "Warn on “may contain”", sub: "Traces of your allergens" })}${switchForm({ intent: "compare_goals", on: view.compareGoals, title: "Compare with today's goals", sub: "Protein, sugar, saturated fat" })}</ul>`;
    return `${String(settingsPageHeader("Product score"))}${String(settingsErrorBanner(view.error))}<div class="fd-scoreset"><p class="fd-scoreset__lead">How much each part counts when Foodable scores a packaged food. Yours applies to your scans; members without their own use the household default.</p>${choiceForm}${following}${checks}<h2 class="fd-scoreset__label">Household</h2>${householdRow(view)}</div>`;
}

export function renderSettingsScoreV2Page(view: SettingsScoreV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "score",
        title: "Product score",
        body: renderSettingsScoreV2Body(view),
    });
}

export function renderSettingsScoreHouseholdV2Body(
    view: SettingsScoreHouseholdV2View,
): string {
    const draft = view.draft;
    const selected = draftPreset(draft, view.preset);
    const weights = draft ? draft.weights : stringWeights(view.weights);
    const clear = view.isSet
        ? `<form method="post" action="${SCORE_HOUSEHOLD_PATH}" class="fd-scoreset__reset" data-turbo="false"><input type="hidden" name="intent" value="clear"><button type="submit" class="fd-scoreset__use-default">Clear the household default</button></form>`
        : "";
    return `${String(settingsPageHeader("Household default"))}${String(settingsErrorBanner(view.error))}<div class="fd-scoreset"><p class="fd-scoreset__lead">Members who have not chosen their own weights use this. Only owners and admins can change it.</p><form method="post" action="${SCORE_HOUSEHOLD_PATH}" class="fd-scoreset__form" data-turbo="false"><input type="hidden" name="intent" value="choice">${choiceFields({ selected, weights, idPrefix: "fd-score-hw" })}${settingsPrimarySubmit("Save household default")}</form>${clear}</div>`;
}

export function renderSettingsScoreHouseholdV2Page(
    view: SettingsScoreHouseholdV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "score",
        title: "Household default",
        backHref: SCORE_PATH,
        body: renderSettingsScoreHouseholdV2Body(view),
    });
}
