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

/** Trash can for the row Delete action (FigCraft 42193 desktop hover). */
export function iconTrash(): Html {
    return icon(
        '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
    );
}

/** Repeat arrow for the swipe "Again" action (FigCraft 19380). */
export function iconRepeat(): Html {
    return icon(
        '<path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
    );
}

/** Shopping cart for product and grocery actions (FigCraft Icon/cart 21094). */
export function iconCart(): Html {
    return icon(
        '<path d="M3 4h2l2 11h11l2-8H6.5"/><path d="M7.6 19a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z"/><path d="M14.6 19a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z"/>',
    );
}

/** Restock row icon (FigCraft Icon/refresh 22696): two arrows chasing round. */
export function iconRefresh(): Html {
    return icon(
        '<path d="M19 11a7 7 0 0 0-12.5-3.4L5 9"/><path d="M5 4.5V9h4.5"/><path d="M5 13a7 7 0 0 0 12.5 3.4L19 15"/><path d="M19 19.5V15h-4.5"/>',
    );
}

/** "Add when it runs low" icon (FigCraft Icon/bolt 22704): a lightning bolt. */
export function iconBolt(): Html {
    return icon('<path d="M13 3L6 13.5h5L10 21l7-10.5h-5L13 3Z"/>');
}

/** Water goal icon (FigCraft Icon/drop 23601): a drop, 12x17 in the 24 box. */
export function iconDrop(): Html {
    return icon('<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z"/>');
}

/** Fiber and sugar goal icon (FigCraft Icon/list 23607): a page of lines. */
export function iconList(): Html {
    return icon('<path d="M9 8h6M9 12h6M9 16h3M5 4h14v16H5z"/>');
}
