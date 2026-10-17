import { escapeHtml } from "../shell.js";
import { DEFAULT_STORE_SECTIONS } from "../../domain/settings.js";

export { DEFAULT_STORE_SECTIONS };

export function renderStoreSectionList(
    sections: readonly string[] = DEFAULT_STORE_SECTIONS,
): string {
    const items = sections
        .map((name) => `<li>${escapeHtml(name)}</li>`)
        .join("");
    return `<ul class="store-section-list">${items}</ul>`;
}
