/**
 * The design's Brand hero (FigCraft 383401): a soft accent glow, the logo mark,
 * the name and a tagline, centred, for the sign-in and sign-up pages.
 *
 * The mark is the brand geometry from `src/brand.ts`, drawn in the current
 * colour so the stylesheet sets it to the accent in both themes. The glow is a
 * radial wash in CSS from the accent token.
 *
 * Styles: `public/app/v2/brand-hero.css`.
 */
import { BRAND_GREEN, markSvg } from "../../../brand.js";
import { cls, esc, raw, type Html } from "./html.js";

export type BrandHeroOptions = {
    title: string;
    tagline?: string;
    className?: string;
};

/** The bare mark: fixed size and the brand fill taken out, so CSS sets both. */
function mark(): string {
    return markSvg()
        .trim()
        .replace(/ width="\d+" height="\d+"/, "")
        .replace(
            `fill="${BRAND_GREEN}"`,
            'fill="currentColor" aria-hidden="true" focusable="false"',
        );
}

export function brandHero(opts: BrandHeroOptions): Html {
    const tagline =
        opts.tagline != null
            ? `<p class="fd-brand-hero__tagline">${esc(opts.tagline)}</p>`
            : "";
    return raw(
        `<div class="${cls("fd-brand-hero", opts.className)}"><span class="fd-brand-hero__glow" aria-hidden="true"></span><span class="fd-brand-hero__mark" aria-hidden="true">${mark()}</span><p class="fd-brand-hero__title">${esc(opts.title)}</p>${tagline}</div>`,
    );
}
