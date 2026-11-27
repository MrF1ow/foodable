/**
 * The icon set, named like the design's `Icon/<name>` components (Components
 * page, 40 of them), drawn from their vector geometry on the 24 x 24 icon
 * frame. Stroke weight is 1.8 with round caps and joins; the five glyphs the
 * design draws at 1.7 (scale, pot, fridge, book, trend) keep it. The few
 * filled parts (the dots of more, target and help) fill with `currentColor`
 * and have no stroke. Stroked paths are non-scaling, so an icon drawn at 18 or
 * 20 px keeps the design's weight, as an instance resized in the design does.
 * Colour comes from the parent's `color`, so one icon
 * serves every state.
 *
 * The two older icon modules (`../fd-icons.ts`, `./icons.ts`) keep their own
 * markup; this module is the one new components use.
 */
import { raw, type Html } from "./html.js";

type Glyph = {
    /** Stroked outline, one path. */
    stroke?: string;
    /** Stroke weight when it is not 1.8. */
    weight?: number;
    /** Filled parts (dots), one path. */
    fill?: string;
};

const GLYPHS = {
    bell: {
        stroke: "M6 16L6 11C6 7.69 8.69 5 12 5C15.31 5 18 7.69 18 11L18 16L19.5 18L4.5 18L6 16ZM10 20.5C10 21.6 10.9 22.5 12 22.5C13.1 22.5 14 21.6 14 20.5",
    },
    bolt: { stroke: "M13 3L6 13.5L11 13.5L10 21L17 10.5L12 10.5L13 3Z" },
    book: {
        stroke: "M5 17C5 15.34 6.34 14 8 14L19 14M5 4L16 4C17.66 4 19 5.34 19 7L19 20L8 20C6.34 20 5 18.66 5 17L5 4Z",
        weight: 1.7,
    },
    bookmark: { stroke: "M8 5L16 5L16 19L12 16L8 19L8 5Z" },
    calendar: {
        stroke: "M5 6L19 6L19 20L5 20L5 6ZM5 10L19 10M9 4L9 8M15 4L15 8",
    },
    camera: {
        stroke: "M4 8L8 8L10 6L14 6L16 8L20 8L20 19L4 19L4 8ZM12 16.5C13.93 16.5 15.5 14.93 15.5 13C15.5 11.07 13.93 9.5 12 9.5C10.07 9.5 8.5 11.07 8.5 13C8.5 14.93 10.07 16.5 12 16.5Z",
    },
    cart: {
        stroke: "M3 4L5 4L7 15L18 15L20 7L6.5 7M7.6 19C8.37 19 9 18.37 9 17.6C9 16.83 8.37 16.2 7.6 16.2C6.83 16.2 6.2 16.83 6.2 17.6C6.2 18.37 6.83 19 7.6 19ZM14.6 19C15.37 19 16 18.37 16 17.6C16 16.83 15.37 16.2 14.6 16.2C13.83 16.2 13.2 16.83 13.2 17.6C13.2 18.37 13.83 19 14.6 19Z",
    },
    check: { stroke: "M6.5 12.5L10.3 16.3L17.5 8.5" },
    "chevron-left": { stroke: "M15 6L9 12L15 18" },
    "chevron-right": { stroke: "M9 6L15 12L9 18" },
    clock: {
        stroke: "M12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20ZM12 8L12 12L15 14",
    },
    close: { stroke: "M6 6L18 18M18 6L6 18" },
    code: { stroke: "M8 8L4 12L8 16M16 8L20 12L16 16" },
    copy: { stroke: "M9 9L19 9L19 20L9 20L9 9ZM15 9L15 5L5 5L5 16L9 16" },
    download: { stroke: "M12 5L12 15M8 11L12 15L16 11M5 19L19 19" },
    drop: {
        stroke: "M12 3C16 8 18 11 18 14C18 17.31 15.31 20 12 20C8.69 20 6 17.31 6 14C6 11 8 8 12 3Z",
    },
    eye: {
        stroke: "M2.5 12C2.5 12 6 5.5 12 5.5C18 5.5 21.5 12 21.5 12C21.5 12 18 18.5 12 18.5C6 18.5 2.5 12 2.5 12ZM12 14.6C13.44 14.6 14.6 13.44 14.6 12C14.6 10.56 13.44 9.4 12 9.4C10.56 9.4 9.4 10.56 9.4 12C9.4 13.44 10.56 14.6 12 14.6Z",
    },
    filter: { stroke: "M4 7L20 7M7 12L17 12M10 17L14 17" },
    fridge: {
        stroke: "M6 10L18 10M9 6L9 8M9 13L9 16M9 3L15 3C16.66 3 18 4.34 18 6L18 18C18 19.66 16.66 21 15 21L9 21C7.34 21 6 19.66 6 18L6 6C6 4.34 7.34 3 9 3Z",
        weight: 1.7,
    },
    gauge: {
        stroke: "M4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4C7.58 4 4 7.58 4 12ZM8.5 12C8.5 13.93 10.07 15.5 12 15.5C13.93 15.5 15.5 13.93 15.5 12C15.5 10.07 13.93 8.5 12 8.5C10.07 8.5 8.5 10.07 8.5 12Z",
    },
    help: {
        stroke: "M4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4C7.58 4 4 7.58 4 12ZM9.5 9.2C10.18 8.34 11.32 7.98 12.37 8.29C13.42 8.59 14.19 9.51 14.3 10.6C14.3 12.6 11.5 12.9 11.5 14.5",
        fill: "M11.1 17.2C11.1 17.7 11.5 18.1 12 18.1C12.5 18.1 12.9 17.7 12.9 17.2C12.9 16.7 12.5 16.3 12 16.3C11.5 16.3 11.1 16.7 11.1 17.2Z",
    },
    link: {
        stroke: "M10 14C10.75 14.76 11.78 15.19 12.85 15.19C13.92 15.19 14.95 14.76 15.7 14L18.7 11C20.27 9.43 20.27 6.87 18.7 5.3C17.13 3.73 14.57 3.73 13 5.3L12 6.3M14 10C13.25 9.24 12.22 8.81 11.15 8.81C10.08 8.81 9.05 9.24 8.3 10L5.3 13C3.73 14.57 3.73 17.13 5.3 18.7C6.87 20.27 9.43 20.27 11 18.7L12 17.7",
    },
    minus: { stroke: "M5 12L19 12" },
    more: {
        fill: "M3.4 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0ZM10.4 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0ZM17.4 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0Z",
    },
    plus: { stroke: "M12 5L12 19M5 12L19 12" },
    pot: {
        stroke: "M4 10L20 10L20 15C20 17.76 17.76 20 15 20L9 20C6.24 20 4 17.76 4 15L4 10ZM2 10L4 10M20 10L22 10M9 6C9 5 10 5 10 4M14 6C14 5 15 5 15 4",
        weight: 1.7,
    },
    repeat: {
        stroke: "M20 12C20 15.78 17.35 19.05 13.65 19.83C9.95 20.61 6.21 18.69 4.68 15.23C3.15 11.77 4.26 7.71 7.34 5.5C10.41 3.3 14.61 3.55 17.4 6.1L20 8.5M20 4L20 8.5L15.5 8.5",
    },
    ruler: {
        stroke: "M4 15L15 4L20 9L9 20L4 15ZM8 11L10 13M11 8L13 10M14 5L15.5 6.5",
    },
    scale: {
        stroke: "M8 4L16 4C18.21 4 20 5.79 20 8L20 16C20 18.21 18.21 20 16 20L8 20C5.79 20 4 18.21 4 16L4 8C4 5.79 5.79 4 8 4ZM9 9C9.76 8.14 10.85 7.65 12 7.65C13.15 7.65 14.24 8.14 15 9L12 12",
        weight: 1.7,
    },
    scan: {
        stroke: "M4 8L4 5L7 5M17 5L20 5L20 8M20 16L20 19L17 19M7 19L4 19L4 16M8 9L8 15M11 9L11 15M14 9L14 15M17 9L17 15",
    },
    search: {
        stroke: "M10.5 17C14.09 17 17 14.09 17 10.5C17 6.91 14.09 4 10.5 4C6.91 4 4 6.91 4 10.5C4 14.09 6.91 17 10.5 17ZM15.5 15.5L20 20",
    },
    share: { stroke: "M12 15L12 4M8 8L12 4L16 8M5 13L5 19L19 19L19 13" },
    snowflake: { stroke: "M12 3L12 21M4.2 7.5L19.8 16.5M4.2 16.5L19.8 7.5" },
    star: {
        stroke: "M12 4L14.4 9L19.8 9.6L15.8 13.3L16.9 18.7L12 16L7.1 18.7L8.2 13.3L4.2 9.6L9.6 9L12 4Z",
    },
    sun: {
        stroke: "M8 12C8 14.21 9.79 16 12 16C14.21 16 16 14.21 16 12C16 9.79 14.21 8 12 8C9.79 8 8 9.79 8 12ZM12 2L12 4M12 20L12 22M4.93 4.93L6.34 6.34M17.66 17.66L19.07 19.07M2 12L4 12M20 12L22 12M4.93 19.07L6.34 17.66M17.66 6.34L19.07 4.93",
    },
    target: {
        stroke: "M4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4C7.58 4 4 7.58 4 12ZM8 12C8 14.21 9.79 16 12 16C14.21 16 16 14.21 16 12C16 9.79 14.21 8 12 8C9.79 8 8 9.79 8 12Z",
        fill: "M10.75 12C10.75 12.69 11.31 13.25 12 13.25C12.69 13.25 13.25 12.69 13.25 12C13.25 11.31 12.69 10.75 12 10.75C11.31 10.75 10.75 11.31 10.75 12Z",
    },
    trash: {
        stroke: "M4 7L20 7M10 11L10 17M14 11L14 17M6 7L7 19C7 20.1 7.9 21 9 21L15 21C16.1 21 17 20.1 17 19L18 7M9 7L9 4L15 4L15 7",
    },
    trend: { stroke: "M4 19L9 13L13 16L20 7", weight: 1.7 },
    user: {
        stroke: "M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM6 19L6 18C6 14.69 8.69 12 12 12C15.31 12 18 14.69 18 18L18 19",
    },
    users: {
        stroke: "M8 13C9.66 13 11 11.66 11 10C11 8.34 9.66 7 8 7C6.34 7 5 8.34 5 10M16 12C17.66 12 19 10.66 19 9C19 7.34 17.66 6 16 6C14.34 6 13 7.34 13 9M4 19L4 17.8C4 15.59 5.79 13.8 8 13.8M12 19L12 17.8C12 15.59 13.79 13.8 16 13.8M20 19L20 17.8C19.99 15.93 18.68 14.32 16.85 13.92",
    },
    // Not a FigCraft `Icon/` component: the design has no warning glyph. A
    // triangle on the same 24 box, with the mark drawn as a stroked bar and a
    // filled dot, as the help glyph draws its dot.
    warning: {
        stroke: "M12 4L21 19L3 19L12 4ZM12 10L12 14",
        fill: "M11.1 16.5C11.1 17 11.5 17.4 12 17.4C12.5 17.4 12.9 17 12.9 16.5C12.9 16 12.5 15.6 12 15.6C11.5 15.6 11.1 16 11.1 16.5Z",
    },
} as const satisfies Record<string, Glyph>;

/** The 40 FigCraft `Icon/<name>` names, and `warning`, which only the app draws. */
export type IconName = keyof typeof GLYPHS;

export const ICON_NAMES = Object.keys(GLYPHS) as readonly IconName[];

/** An icon at `size` px (default 24, the design's frame). Decorative: `aria-hidden`. */
export function icon(name: IconName, size = 24): Html {
    const glyph: Glyph = GLYPHS[name];
    const paths =
        (glyph.stroke
            ? `<path vector-effect="non-scaling-stroke" d="${glyph.stroke}"/>`
            : "") +
        (glyph.fill
            ? `<path fill="currentColor" stroke="none" d="${glyph.fill}"/>`
            : "");
    return raw(
        `<svg class="fd-icon fd-icon--${name}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${glyph.weight ?? 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`,
    );
}
