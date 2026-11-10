import { escapeHtml } from "../shell.js";
import { errorBanner, modal, field } from "./ui.js";

export const LINK_PRODUCT_MODAL_ID = "link-product-prompt";

export type LinkProductPromptView = {
    product: { id: string; name: string; brand: string | null };
    plainOptions: Array<{ id: string; name: string }>;
    suggestedId: string | null;
    from: string;
    openOnLoad?: boolean;
    error?: string;
};

export function renderLinkProductPrompt(
    view: LinkProductPromptView | null,
): string {
    if (view == null) return "";
    const brand = view.product.brand
        ? ` (${escapeHtml(view.product.brand)})`
        : "";
    const options = [
        ...view.plainOptions.map((row) => {
            const sel = row.id === view.suggestedId ? " selected" : "";
            return `<option value="${escapeHtml(row.id)}"${sel}>${escapeHtml(row.name)}</option>`;
        }),
    ].join("");
    const body = `${view.error ? errorBanner(view.error) : ""}<p>${escapeHtml(view.product.name)}${brand} looks like a product. Link it to a food you already use?</p>
<form method="post" action="/settings/household/items/${escapeHtml(view.product.id)}/link">
<input type="hidden" name="from" value="${escapeHtml(view.from)}" />
${field({
    id: "link-product-food",
    label: "Food",
    control: `<select id="link-product-food" name="food_id" required>${options}</select>`,
})}
<label><input type="checkbox" name="make_usual" value="1" /> Make it our usual</label>
<div class="inline-form">
<button type="submit" class="btn-primary">Link</button>
<button type="button" class="modal-close" command="close" commandfor="${LINK_PRODUCT_MODAL_ID}">Skip</button>
</div>
</form>`;
    return modal({
        id: LINK_PRODUCT_MODAL_ID,
        title: "Is this one of your foods?",
        openOnLoad: view.openOnLoad,
        body,
    });
}
