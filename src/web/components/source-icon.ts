import { escapeHtml } from "../../html.js";
import type { RecipeSourceKind } from "../../domain/recipe-import.js";

function monogramTile(label: string, text: string): string {
    return `<svg class="recipe-source-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.25" role="img" aria-label="${escapeHtml(label)}">
<rect x="2" y="2" width="16" height="16" rx="3" />
<text x="10" y="13" text-anchor="middle" font-size="7" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">${escapeHtml(text)}</text>
</svg>`;
}

function globeIcon(label: string): string {
    return `<svg class="recipe-source-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.25" role="img" aria-label="${escapeHtml(label)}">
<circle cx="10" cy="10" r="7.5" />
<path d="M2.5 10h15M10 2.5c2 2.5 2 12.5 0 15M10 2.5c-2 2.5-2 12.5 0 15" />
</svg>`;
}

function textIcon(label: string): string {
    return `<svg class="recipe-source-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.25" role="img" aria-label="${escapeHtml(label)}">
<rect x="4" y="3" width="12" height="14" rx="1.5" />
<path d="M7 7h6M7 10h6M7 13h4" />
</svg>`;
}

export function sourceIcon(
    kind: RecipeSourceKind,
    opts: { label: string },
): string {
    const label = opts.label.trim() || kind;
    switch (kind) {
        case "website":
            return globeIcon(label);
        case "text":
            return textIcon(label);
        case "instagram":
            return monogramTile(label, "IG");
        case "tiktok":
            return monogramTile(label, "TT");
        case "facebook":
            return monogramTile(label, "f");
        case "threads":
            return monogramTile(label, "@");
        case "pinterest":
            return monogramTile(label, "P");
        case "youtube":
            return monogramTile(label, "YT");
        default:
            return globeIcon(label);
    }
}
