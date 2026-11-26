/**
 * Settings › Product score (FigCraft 417521) and its household default
 * (420618): the preset chips and the four weights. The chips are one form that
 * saves when a chip is picked (`autosave.js`). Each weight is a pull-down on
 * its row (the share it has now, a chevron) whose choices save the whole
 * choice as Custom with that one weight changed. Every save answers 303 back
 * to the page, or 4xx in place with the refusal on top.
 */
import type { AppChromeBase } from "../../attention.js";
import {
    SCORE_PARTS,
    SCORE_PRESET_LABELS,
    validateScoreChoice,
    type ScoreChoice,
    type ScoreChoicePreset,
    type ScorePart,
    type ScoreWeights,
} from "../../../domain/product-score.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, menuRow, type MenuItem } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";

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

/**
 * The weights that make `part` show `share` percent of the total while the
 * other parts keep their proportions to each other: the weights become whole
 * percents summing to 100 (largest remainders), so the row shows the share the
 * person picked and the other rows move only as far as that needs. Null when
 * the other parts are all zero (the part is then the whole total).
 */
export function weightsForShare(
    weights: ScoreWeights,
    part: ScorePart,
    share: number,
): ScoreWeights | null {
    const others = SCORE_PARTS.filter((p) => p !== part);
    const rest = others.reduce((sum, p) => sum + weights[p], 0);
    if (rest <= 0) return share === 100 ? { ...weights, [part]: 100 } : null;
    const room = 100 - share;
    const exact = others.map((p) => (weights[p] / rest) * room);
    const whole = exact.map(Math.floor);
    let spare = room - whole.reduce((sum, n) => sum + n, 0);
    exact
        .map((value, i) => ({ i, left: value - whole[i]! }))
        .sort((x, y) => y.left - x.left)
        .forEach(({ i }) => {
            if (spare > 0) {
                whole[i]! += 1;
                spare -= 1;
            }
        });
    const next = { ...weights, [part]: share } as ScoreWeights;
    others.forEach((p, i) => {
        next[p] = whole[i]!;
    });
    return next;
}

/** The shares a row pull-down offers: every ten that can be reached, and the current one if it is between. */
function shareChoices(current: number, reachable: boolean): number[] {
    if (!reachable) return [current];
    const grid = Array.from({ length: 11 }, (_, i) => i * 10);
    return grid.includes(current)
        ? grid
        : [...grid, current].sort((a, b) => a - b);
}

/** The preset chips and the weights they carry as hidden fields (a preset ignores them). */
function presetForm(opts: {
    action: string;
    selected: ScoreChoicePreset;
    weights: Record<ScorePart, string>;
    refused: boolean;
}): Html {
    const hidden = [
        `<input type="hidden" name="intent" value="choice">`,
        ...SCORE_PARTS.map(
            (part) =>
                `<input type="hidden" name="${weightField(part)}" value="${esc(opts.weights[part])}">`,
        ),
    ].join("");
    const chips = choiceGroup({
        name: "preset",
        legend: "Preset",
        showLegend: false,
        required: true,
        className: "fd-score-presets",
        options: PRESET_ORDER.map((preset) => ({
            value: preset,
            label: SCORE_PRESET_LABELS[preset],
            selected: preset === opts.selected,
        })),
    });
    return raw(
        `<form method="post" action="${esc(opts.action)}" class="fd-score-form" data-fd-autosave="form"${opts.refused ? " data-fd-invalid" : ""}>${hidden}${chips}<button type="submit" class="fd-visually-hidden">Save</button></form>`,
    );
}

/** One weight: its source, the share it has now, and a pull-down of weights. */
function weightRow(opts: {
    action: string;
    part: ScorePart;
    weights: Record<ScorePart, string>;
    share: number;
}): Html {
    const { part, weights } = opts;
    const label = PART_LABEL[part];
    const numeric = Object.fromEntries(
        SCORE_PARTS.map((p) => [p, Number(weights[p]) || 0]),
    ) as ScoreWeights;
    const others = SCORE_PARTS.some((p) => p !== part && numeric[p] > 0);
    // Each choice is the share the row will show, and picking it sets the
    // weights so it does (see weightsForShare).
    const items: MenuItem[] = shareChoices(opts.share, others).flatMap(
        (share): MenuItem[] => {
            // The share already shown is the current tick: choosing it again
            // posts nothing, so it can't turn the household default off or
            // make the preset Custom by itself.
            if (share === opts.share) {
                return [
                    {
                        kind: "checked" as const,
                        label: `${share}%`,
                        checked: true,
                        current: true,
                    },
                ];
            }
            const next = weightsForShare(numeric, part, share);
            if (!next) return [];
            return [
                {
                    kind: "checked" as const,
                    label: `${share}%`,
                    checked: false,
                    action: opts.action,
                    fields: {
                        intent: "choice",
                        preset: "custom",
                        ...Object.fromEntries(
                            SCORE_PARTS.map((p) => [
                                weightField(p),
                                String(next[p]),
                            ]),
                        ),
                    },
                },
            ];
        },
    );
    return menuRow({
        label: `${label.title} weight`,
        row: {
            title: label.title,
            subtitle: label.source,
            value: `${opts.share}%`,
        },
        items,
    });
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

/** The choice: preset chips, then the Weights header with its total and the four rows. */
function choiceSection(opts: {
    action: string;
    selected: ScoreChoicePreset;
    weights: Record<ScorePart, string>;
    draft: ScoreFormDraft | undefined;
}): Html {
    const numeric = Object.fromEntries(
        SCORE_PARTS.map((part) => [part, Number(opts.weights[part]) || 0]),
    ) as ScoreWeights;
    const shares = weightShares(numeric);
    const total = SCORE_PARTS.some((part) => numeric[part] > 0) ? 100 : 0;
    return join([
        sectionHeader({ label: "Preset", rule: false }),
        presetForm({
            action: opts.action,
            selected: opts.selected,
            weights: opts.weights,
            refused: opts.draft != null,
        }),
        sectionHeader({ label: "Weights", count: `${total}%`, rule: false }),
        listGroup({
            label: "Weights",
            rows: SCORE_PARTS.map((part) =>
                weightRow({
                    action: opts.action,
                    part,
                    weights: opts.weights,
                    share: shares[part],
                }),
            ),
        }),
    ]);
}

export function renderSettingsScoreV2Body(view: SettingsScoreV2View): string {
    const draft = view.draft;
    const selected = draftPreset(draft, view.preset);
    const weights = draft ? draft.weights : stringWeights(view.weights);
    // Off makes the household's choice the person's own; On drops their own.
    const follow = itemRow({
        title: "Use household default",
        subtitle: view.householdPresetLabel,
        trailing: {
            kind: "toggle",
            on: view.followsHousehold,
            label: "Use household default",
            form: {
                action: SCORE_PATH,
                fields: view.followsHousehold
                    ? {
                          intent: "choice",
                          preset: selected,
                          ...Object.fromEntries(
                              SCORE_PARTS.map((part) => [
                                  weightField(part),
                                  weights[part],
                              ]),
                          ),
                      }
                    : { intent: "household" },
            },
        },
    });
    const checks = [
        itemRow({
            title: "Allergies",
            value: view.allergensText,
            href: view.allergensHref,
            trailing: { kind: "chevron" },
        }),
        itemRow({
            title: "Warn on “may contain”",
            trailing: {
                kind: "toggle",
                on: view.warnTraces,
                label: "Warn on “may contain”",
                form: {
                    action: SCORE_PATH,
                    fields: {
                        intent: "warn_traces",
                        value: view.warnTraces ? "0" : "1",
                    },
                },
            },
        }),
        itemRow({
            title: "Compare with today's goals",
            trailing: {
                kind: "toggle",
                on: view.compareGoals,
                label: "Compare with today's goals",
                form: {
                    action: SCORE_PATH,
                    fields: {
                        intent: "compare_goals",
                        value: view.compareGoals ? "0" : "1",
                    },
                },
            },
        }),
    ];
    const household = view.canEditHousehold
        ? join([
              sectionHeader({ label: "Household", rule: false }),
              listGroup({
                  label: "Household",
                  rows: [
                      itemRow({
                          title: "Household default",
                          value: view.householdPresetLabel,
                          href: SCORE_HOUSEHOLD_PATH,
                          trailing: { kind: "chevron" },
                      }),
                  ],
              }),
          ])
        : raw("");
    return String(
        join([
            settingsErrorBanner(view.error),
            listGroup({ label: "Score source", rows: [follow] }),
            choiceSection({ action: SCORE_PATH, selected, weights, draft }),
            sectionHeader({ label: "Checks for you", rule: false }),
            listGroup({ label: "Checks for you", rows: checks }),
            household,
        ]),
    );
}

export function renderSettingsScoreV2Page(view: SettingsScoreV2View): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        page: "score",
        title: "Product score",
        className: "fd-score-page",
        body: renderSettingsScoreV2Body(view),
    });
}

export function renderSettingsScoreHouseholdV2Body(
    view: SettingsScoreHouseholdV2View,
): string {
    const draft = view.draft;
    const selected = draftPreset(draft, view.preset);
    const weights = draft ? draft.weights : stringWeights(view.weights);
    return String(
        join([
            settingsErrorBanner(view.error),
            choiceSection({
                action: SCORE_HOUSEHOLD_PATH,
                selected,
                weights,
                draft,
            }),
        ]),
    );
}

export function renderSettingsScoreHouseholdV2Page(
    view: SettingsScoreHouseholdV2View,
): string {
    // Clearing the default is the ⋯: it confirms in the menu.
    const actions = view.isSet
        ? menu({
              label: "Household default actions",
              anchor: "more",
              items: [
                  {
                      kind: "destructive",
                      label: "Clear the household default",
                      confirmLabel: "Clear",
                      action: SCORE_HOUSEHOLD_PATH,
                      fields: { intent: "clear" },
                  },
              ],
          })
        : undefined;
    return renderHouseholdLayout({
        chrome: view.chrome,
        page: "score",
        title: "Household default",
        backHref: SCORE_PATH,
        className: "fd-score-page",
        actions,
        body: renderSettingsScoreHouseholdV2Body(view),
    });
}
