import { formatQuantity, type Quantity } from "../../domain/quantity.js";
import { escapeHtml } from "../shell.js";

export type AlreadyHaveState =
    { cover: "full" } | { cover: "partial"; have: Quantity; need: Quantity };

export function renderAlreadyHaveTag(state: AlreadyHaveState): string {
    if (state.cover === "full") {
        return `<span class="already-have-tag" data-cover="full">already have</span>`;
    }
    const have = formatQuantity(state.have);
    const need = formatQuantity(state.need);
    return `<span class="already-have-tag" data-cover="partial">have ${escapeHtml(have)}, need ${escapeHtml(need)}</span>`;
}
