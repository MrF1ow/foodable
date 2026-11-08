import { escapeHtml } from "../../html.js";
import {
    didYouMeanView,
    type DidYouMeanView,
    type SimilarFoodsError,
} from "../../domain/foods.js";

export function hiddenFieldsHtml(fields: Record<string, string>): string {
    return Object.entries(fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
        )
        .join("\n");
}

export type DidYouMeanModal = {
    modalId: string;
    action: string;
    view: DidYouMeanView;
};

export function didYouMeanModalBlock(
    didYouMean: DidYouMeanModal | undefined,
    modalId: string,
    openModalId: string | undefined,
): string {
    if (!didYouMean || didYouMean.modalId !== modalId) return "";
    if (openModalId !== modalId) return "";
    return renderDidYouMeanBlock({
        action: didYouMean.action,
        view: didYouMean.view,
    });
}

export function renderDidYouMeanBlock(opts: {
    action: string;
    view: DidYouMeanView;
}): string {
    const hidden = hiddenFieldsHtml(opts.view.hiddenFields);
    const candidateButtons = opts.view.candidates
        .map(
            (row) =>
                `<button type="submit" name="food_id" value="${escapeHtml(row.foodId)}" class="btn-sm">${escapeHtml(row.label)}</button>`,
        )
        .join("\n");
    const heading =
        opts.view.candidates.length === 1
            ? `<p class="did-you-mean-heading">Did you mean <em>${escapeHtml(opts.view.candidates[0]!.label)}</em>?</p>`
            : `<p class="did-you-mean-heading">${escapeHtml(opts.view.heading)}</p>`;
    return `<div data-fill-transient class="did-you-mean-block">
${heading}
<form class="did-you-mean-form" method="post" action="${escapeHtml(opts.action)}">
${hidden}
<label class="did-you-mean-remember"><input type="checkbox" name="remember_alias" value="1" /> ${escapeHtml(opts.view.aliasLabel)}</label>
<div class="did-you-mean-candidates">${candidateButtons}</div>
<button type="submit" name="new_food" value="1" class="btn-sm">${escapeHtml(opts.view.newFoodLabel)}</button>
</form>
</div>`;
}

export function buildDidYouMeanModal(
    err: SimilarFoodsError,
    fields: Record<string, string>,
    modalId: string,
    action: string,
): DidYouMeanModal | null {
    const entry = err.entries[0];
    if (!entry) return null;
    return {
        modalId,
        action,
        view: didYouMeanView(entry, fields),
    };
}
