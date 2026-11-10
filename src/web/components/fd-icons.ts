// Icons of the v2 shell, taken from the vector geometry of the FigCraft design
// (Components › Nav bar, Desktop › Sidebar and Top bar), drawn on the design's
// 24 x 24 icon frame. Stroke weight is 1.7 with round caps and joins, except
// the search glyph on the green Log button (2). Colour comes from the parent's
// `color` through `currentColor`, so one icon serves every state.
//
// Do not substitute other icons: the paths are the design's own. The Settings
// entry of the sidebar uses the design's `sun` glyph.

export type FdIconName =
    | "cal"
    | "fridge"
    | "search"
    | "book"
    | "trend"
    | "sun"
    | "chevR"
    | "scan"
    | "plus";

export const FD_ICON_PATHS: Record<FdIconName, string> = {
    cal: "M4 10L20 10M9 3L9 7M15 3L15 7M7 5L17 5C18.657 5 20 6.343 20 8L20 17C20 18.657 18.657 20 17 20L7 20C5.343 20 4 18.657 4 17L4 8C4 6.343 5.343 5 7 5Z",
    fridge: "M6 10L18 10M9 6L9 8M9 13L9 16M9 3L15 3C16.657 3 18 4.343 18 6L18 18C18 19.657 16.657 21 15 21L9 21C7.343 21 6 19.657 6 18L6 6C6 4.343 7.343 3 9 3Z",
    search: "M16 16L20.5 20.5M4.5 11C4.5 14.59 7.41 17.5 11 17.5C14.59 17.5 17.5 14.59 17.5 11C17.5 7.41 14.59 4.5 11 4.5C7.41 4.5 4.5 7.41 4.5 11Z",
    book: "M5 17C5 15.343 6.343 14 8 14L19 14M5 4L16 4C17.657 4 19 5.343 19 7L19 20L8 20C6.343 20 5 18.657 5 17L5 4Z",
    trend: "M4 19L9 13L13 16L20 7",
    sun: "M12 2L12 4M12 20L12 22M2 12L4 12M20 12L22 12M8 12C8 14.209 9.791 16 12 16C14.209 16 16 14.209 16 12C16 9.791 14.209 8 12 8C9.791 8 8 9.791 8 12Z",
    chevR: "M9 6L15 12L9 18",
    scan: "M4 8L4 5L7 5M17 5L20 5L20 8M20 16L20 19L17 19M7 19L4 19L4 16M8 9L8 15M11 9L11 15M14 9L14 15M16.5 9L16.5 15",
    plus: "M12 5L12 19M5 12L19 12",
};

export function fdIcon(name: FdIconName, strokeWidth = 1.7): string {
    return `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${FD_ICON_PATHS[name]}"/></svg>`;
}
