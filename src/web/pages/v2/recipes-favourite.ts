import { esc } from "../../components/v2/html.js";

/**
 * Where the star's form sends the member back to: the recipes list with its
 * search and filter, or the recipe page. The server builds the address from
 * these fields, so the form never carries a path of its own.
 */
export type FavouriteBack =
    { kind: "recipe" } | { kind: "list"; query: string; filter: string };

// A five-point star on the design's 24 x 24 icon frame, drawn with the same
// 1.7 round stroke as the shell's icons. The design has no star glyph yet.
const STAR_PATH =
    "M12 3.6L14.6 9.1L20.6 9.8L16.1 13.9L17.4 19.8L12 16.8L6.6 19.8L7.9 13.9L3.4 9.8L9.4 9.1Z";

function starIcon(filled: boolean): string {
    return `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`;
}

/**
 * The star that adds or removes a recipe from the viewer's favourites: a plain
 * POST, so it works without JavaScript. It names the state to move to (`on`),
 * not "toggle", so a repeated submit cannot flip it back.
 */
export function favouriteStarForm(opts: {
    recipeId: string;
    recipeName: string;
    /** Whether the recipe is a favourite now. */
    on: boolean;
    back: FavouriteBack;
    className?: string;
}): string {
    const label = opts.on
        ? `Remove ${opts.recipeName} from favourites`
        : `Add ${opts.recipeName} to favourites`;
    const hidden = (name: string, value: string) =>
        `<input type="hidden" name="${name}" value="${esc(value)}" />`;
    const backFields =
        opts.back.kind === "recipe"
            ? hidden("back", "recipe")
            : [
                  hidden("back", "list"),
                  opts.back.query ? hidden("q", opts.back.query) : "",
                  opts.back.filter ? hidden("filter", opts.back.filter) : "",
              ].join("");
    const className = ["fd-star-form", opts.className]
        .filter(Boolean)
        .join(" ");
    return `<form class="${className}" method="post" action="/recipes/${esc(opts.recipeId)}/favourite">${hidden("on", opts.on ? "0" : "1")}${backFields}<button type="submit" class="fd-star${opts.on ? " fd-star--on" : ""}" aria-label="${esc(label)}" title="${esc(label)}">${starIcon(opts.on)}</button></form>`;
}
