import { escapeHtml } from "../../html.js";
import { button } from "./v2/button.js";
import { itemRow } from "./v2/item-row.js";
import { listGroup } from "./v2/list-group.js";
import { toggle } from "./v2/toggle.js";
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

/**
 * The "did you mean" question of an Add sheet, from the shared components: the
 * candidates are the design's buttons, one tap picks that food; the alias
 * choice is an Item row with a Toggle; "add as a new food" is a button. One
 * form posts the same fields as before (`food_id`, `new_food`,
 * `remember_alias`).
 */
export function renderDidYouMeanBlock(opts: {
    action: string;
    view: DidYouMeanView;
}): string {
    const hidden = hiddenFieldsHtml(opts.view.hiddenFields);
    const candidateButtons = opts.view.candidates
        .map((row) =>
            button({
                label: row.label,
                type: "submit",
                size: "md",
                attrs: { name: "food_id", value: row.foodId },
            }),
        )
        .join("\n");
    const heading =
        opts.view.candidates.length === 1
            ? `<p class="did-you-mean-heading">Did you mean <em>${escapeHtml(opts.view.candidates[0]!.label)}</em>?</p>`
            : `<p class="did-you-mean-heading">${escapeHtml(opts.view.heading)}</p>`;
    const remember = listGroup({
        label: "Remember this name",
        rows: [
            itemRow({
                title: "Remember this name",
                subtitle: opts.view.aliasLabel,
                trailing: {
                    kind: "control",
                    html: toggle({
                        label: opts.view.aliasLabel,
                        name: "remember_alias",
                        value: "1",
                    }),
                },
            }),
        ],
    });
    const newFood = button({
        label: opts.view.newFoodLabel,
        type: "submit",
        size: "md",
        attrs: { name: "new_food", value: "1" },
    });
    return `<div data-fill-transient class="did-you-mean-block">
${heading}
<form class="did-you-mean-form" method="post" action="${escapeHtml(opts.action)}">
${hidden}
<div class="did-you-mean-candidates">${candidateButtons}</div>
${remember}
<div class="did-you-mean-candidates">${newFood}</div>
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
