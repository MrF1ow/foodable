/**
 * The design's Top bar (FigCraft 590953): the desktop bar over the page, with
 * the search field (a `⌘K` hint at its end), a spacer, the bell and the Small
 * primary Log food button. There is no scan button: scanning is a phone
 * action (rule 25).
 *
 * Built from the Search field, Bell and Button components. It is the shell's
 * top bar from 1024 px (`shell.css` hides it below).
 *
 * Styles: `public/app/v2/layout.css`.
 */
import { bell, type BellOptions } from "./bell.js";
import { button } from "./button.js";
import { raw, type Html } from "./html.js";
import { searchField } from "./search-field.js";

export type TopBarOptions = {
    search?: {
        /** Accessible name of the field; default "Search foods, recipes, barcodes". */
        label?: string;
        placeholder?: string;
        /** The shortcut hint; default "⌘K", `false` leaves it out. */
        shortcut?: string | false;
        name?: string;
        /**
         * `fd-open-sheet` wires the field to the log search sheet, the one the
         * page script's Command/Control+K opens. Only a wired field with the
         * shortcut announces it (`aria-keyshortcuts`), whatever hint it shows.
         */
        data?: Readonly<Record<string, string>>;
    };
    /** The bell; omit for a bell with nothing new, `false` for none. */
    bell?: BellOptions | false;
    logFood: {
        href: string;
        /** Default "Log food". */
        label?: string;
        attrs?: Readonly<Record<string, string>>;
    };
};

const SEARCH_TEXT = "Search foods, recipes, barcodes";

export function topBar(opts: TopBarOptions): Html {
    const search = opts.search ?? {};
    const field = searchField({
        label: search.label ?? SEARCH_TEXT,
        placeholder: search.placeholder ?? SEARCH_TEXT,
        shortcut:
            search.shortcut === false ? undefined : (search.shortcut ?? "⌘K"),
        // The keys the page script binds, announced only where it handles them.
        keyShortcuts:
            search.shortcut !== false && search.data?.["fd-open-sheet"]
                ? "Control+K Meta+K"
                : undefined,
        name: search.name,
        data: search.data,
        style: "boxed",
    });
    const logFood = button({
        label: opts.logFood.label ?? "Log food",
        variant: "primary",
        size: "md",
        icon: "plus",
        href: opts.logFood.href,
        attrs: opts.logFood.attrs,
    });
    return raw(
        `<header class="fd-top-bar"><div class="fd-top-bar__search">${field}</div><span class="fd-top-bar__spacer" aria-hidden="true"></span>${opts.bell === false ? "" : bell(opts.bell ?? {})}${logFood}</header>`,
    );
}
