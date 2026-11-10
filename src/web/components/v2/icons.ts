/**
 * Stroke icons for the v2 components, drawn in a 24-unit box like the design's
 * `Icon/*` frames: the glyph is a 14-unit path (5..19) inside the 24 box, stroke
 * 1.7 unless noted. They inherit `currentColor`, so a component sets the colour
 * with its own `color` token.
 */
import { raw, type Html } from "./html.js";

function icon(inner: string, strokeWidth = 1.7): Html {
    return raw(
        `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`,
    );
}

/** `Icon/plus` (FigCraft 20333): 14x14 plus, stroke 1.7. */
export function iconPlus(): Html {
    return icon('<path d="M12 5v14M5 12h14"/>');
}

/** `Icon/minus` (FigCraft 20580): 14-wide bar, stroke 1.7. */
export function iconMinus(): Html {
    return icon('<path d="M5 12h14"/>');
}

/** Check mark in the grocery check circle (FigCraft 21994): stroke 2.4. */
export function iconCheck(): Html {
    return icon('<path d="M6.5 12.5l3.8 3.8L17.5 8.5"/>', 2.4);
}

/** Row chevron (FigCraft 22410): 6x12 chevron in a 24 box, stroke 1.7. */
export function iconChevronRight(): Html {
    return icon('<path d="M9 6l6 6-6 6"/>');
}

/** Repeat arrow for the swipe "Again" action (FigCraft 19380). */
export function iconRepeat(): Html {
    return icon(
        '<path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
    );
}
