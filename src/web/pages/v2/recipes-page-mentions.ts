import type { MentionWarning } from "../../../domain/recipe-mentions.js";
import { button } from "../../components/v2/button.js";
import { card } from "../../components/v2/card.js";
import { esc, raw } from "../../components/v2/html.js";

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

function pillForm(
    recipeId: string,
    action: "add" | "dismiss",
    key: string,
    control: string,
): string {
    return `<form class="fd-inline-form" method="post" action="/recipes/${esc(recipeId)}/mentions/${action}"><input type="hidden" name="key" value="${esc(key)}">${control}</form>`;
}

/**
 * The quote a card shows: the step from the clause the food is in, so "Push
 * the noodles aside, pour in the lightly beaten egg…" reads "…pour in the
 * lightly beaten egg…" (405904). The food's offsets move with the cut.
 */
export function trimmedExcerpt(
    warning: Pick<
        MentionWarningView,
        "excerpt" | "excerptStart" | "excerptEnd"
    >,
): { text: string; start: number; end: number } {
    const { excerpt, excerptStart, excerptEnd } = warning;
    const comma = excerpt.lastIndexOf(", ", excerptStart - 1);
    if (comma <= 0 || excerptStart < 0 || excerptEnd > excerpt.length) {
        return { text: excerpt, start: excerptStart, end: excerptEnd };
    }
    const from = comma + 2;
    const lead = excerpt.startsWith("…") ? "" : "…";
    const shift = from - lead.length;
    return {
        text: `${lead}${excerpt.slice(from)}`,
        start: excerptStart - shift,
        end: excerptEnd - shift,
    };
}

/** One warning: "Steps mention egg", what the step said, with Dismiss and Add. */
function mentionCard(recipeId: string, warning: MentionWarningView): string {
    const quote = trimmedExcerpt(warning);
    const excerpt = markSpans(quote.text, [
        { start: quote.start, end: quote.end },
    ]);
    const dismiss = pillForm(
        recipeId,
        "dismiss",
        warning.key,
        String(button({ label: "Dismiss", size: "md", type: "submit" })),
    );
    const add = pillForm(
        recipeId,
        "add",
        warning.key,
        String(
            button({
                label: `Add ${warning.food}`,
                variant: "primary",
                size: "md",
                type: "submit",
            }),
        ),
    );
    return String(
        card({
            label: `Steps mention ${warning.food}`,
            className: "fd-mention-card",
            children: raw(
                `<p class="fd-mention-card__title">Steps mention ${esc(warning.food)}</p><q class="fd-mention-card__excerpt">${excerpt}</q><div class="fd-mention-card__actions">${dismiss}${add}</div>`,
            ),
        }),
    );
}

/** The cards under the page title; empty without warnings. */
export function renderMentionCards(
    recipeId: string,
    warnings: readonly MentionWarningView[] | undefined,
): string {
    if (!warnings || warnings.length === 0) return "";
    return `<div class="fd-mention-cards">${warnings
        .map((w) => mentionCard(recipeId, w))
        .join("")}</div>`;
}
