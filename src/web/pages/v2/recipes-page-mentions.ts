import type { MentionWarning } from "../../../domain/recipe-mentions.js";
import { esc } from "../../components/v2/html.js";

/**
 * The recipe page's "the steps mention a food the ingredients don't list"
 * cards, and the dotted underline on that food inside its step. Advice only:
 * nothing here blocks cooking, planning or groceries.
 */

export type MentionWarningView = Pick<
    MentionWarning,
    | "food"
    | "key"
    | "message"
    | "excerpt"
    | "excerptStart"
    | "excerptEnd"
    | "stepIndex"
    | "start"
    | "end"
>;

/** The one underline style, in a step and in a card's excerpt. */
function mark(text: string): string {
    return `<span class="fd-mention-mark">${esc(text)}</span>`;
}

/**
 * `text` escaped, with each [start, end) span wrapped in the underline. Spans
 * that overlap an earlier one, run backwards or leave the text are skipped
 * rather than trusted.
 */
function markSpans(text: string, spans: { start: number; end: number }[]) {
    let out = "";
    let at = 0;
    for (const span of [...spans].sort((a, b) => a.start - b.start)) {
        if (span.start < at || span.end <= span.start) continue;
        if (span.end > text.length) continue;
        out += esc(text.slice(at, span.start));
        out += mark(text.slice(span.start, span.end));
        at = span.end;
    }
    return out + esc(text.slice(at));
}

/**
 * One step's text for the Steps list. The detector measured its offsets on the
 * NFC form of the step, so the step is normalized the same way before it is cut.
 */
export function stepWithMentions(
    step: string,
    stepIndex: number,
    warnings: readonly MentionWarningView[] | undefined,
): string {
    const spans = (warnings ?? [])
        .filter((w) => w.stepIndex === stepIndex)
        .map((w) => ({ start: w.start, end: w.end }));
    if (spans.length === 0) return esc(step);
    return markSpans(step.normalize("NFC"), spans);
}

const WARN_ICON = `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.1"/></svg>`;

function pillForm(
    recipeId: string,
    action: "add" | "dismiss",
    key: string,
    button: string,
): string {
    return `<form class="fd-inline-form" method="post" action="/recipes/${esc(recipeId)}/mentions/${action}"><input type="hidden" name="key" value="${esc(key)}">${button}</form>`;
}

/** One warning: what the steps said, with Add and Dismiss. */
function mentionCard(recipeId: string, warning: MentionWarningView): string {
    const excerpt = markSpans(warning.excerpt, [
        { start: warning.excerptStart, end: warning.excerptEnd },
    ]);
    const add = pillForm(
        recipeId,
        "add",
        warning.key,
        `<button type="submit" class="fd-mention-pill fd-mention-pill--primary">Add ${esc(warning.food)}</button>`,
    );
    const dismiss = pillForm(
        recipeId,
        "dismiss",
        warning.key,
        `<button type="submit" class="fd-mention-pill">Dismiss</button>`,
    );
    return `<aside class="fd-mention-card" aria-label="${esc(warning.message)}">
<p class="fd-mention-card__title"><span class="fd-mention-card__icon">${WARN_ICON}</span><span>${esc(warning.message)}</span></p>
<q class="fd-mention-card__excerpt">${excerpt}</q>
<div class="fd-mention-card__actions">${add}${dismiss}</div>
</aside>`;
}

/** The cards for the top of the Ingredients section; empty without warnings. */
export function renderMentionCards(
    recipeId: string,
    warnings: readonly MentionWarningView[] | undefined,
): string {
    if (!warnings || warnings.length === 0) return "";
    return `<div class="fd-mention-cards">${warnings
        .map((w) => mentionCard(recipeId, w))
        .join("")}</div>`;
}
