/**
 * Settings › Help (FigCraft 421933, Light and desktop twins): a search field,
 * then one row a topic. A row opens in place to its answer; typing in the
 * search field and pressing Enter lists the topics that hold every typed word
 * (a GET with `q`, so it works with no script). One-time explanations that a
 * page no longer carries live here.
 */
import type { AppChromeBase } from "../../attention.js";
import { escapeHtml } from "../../shell.js";
import { DRAFT_RECIPES_PROMPT } from "../../../copy/agent-prompts.js";
import { button } from "../../components/v2/button.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { field } from "../../components/v2/field.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { searchField } from "../../components/v2/search-field.js";
import { APP_PATHS } from "../../route-map.js";
import { renderSettingsV2Page } from "./settings-shared.js";

type GlossaryCopy = {
    id: string;
    title: string;
    body: string;
};

/** One glossary topic. `title` is plain text (escape it on render); `answer`
 *  is ready-to-render HTML: the paragraph, plus the copyable prompt block on
 *  the one entry that carries it. */
export type GlossaryEntry = {
    id: string;
    title: string;
    answer: string;
};

const GLOSSARY_COPY: GlossaryCopy[] = [
    {
        id: "food-vs-household-item",
        title: "Food vs household item",
        body: "Foods are things you eat, like eggs, milk and rice. Household items are supplies you stock but don't eat, like foil, soap and batteries. Add item on the Fridge page takes food. To stock a household item, ask your AI assistant to add it (it uses add_fridge_item). Both kinds sit in the same locations and use the same row actions.",
    },
    {
        id: "locations",
        title: "Locations",
        body: "A location is a place you keep things, such as Fridge, Freezer or Pantry. Add one in Settings › Household › Fridge places, or ask your AI assistant (it uses add_fridge_location); each gets its own panel. Putting groceries away and adding an item both go into one location.",
    },
    {
        id: "stores-and-sections",
        title: "Stores and sections",
        body: "Grocery stores group your shopping list. Each store has sections (aisles) such as Produce or Dairy. Leave the section on Other and the app picks an aisle: where you already shop for that food, otherwise a guess from its name. If it can't tell, the line stays in Other.",
    },
    {
        id: "store-pick-order",
        title: "Which store a line goes to",
        body: "A grocery line with no store of its own goes to its food's usual store. After that it depends on Settings › Household › Stores. With Use each food's usual store on, the default store comes next, then the store the food was last on the list. With it off, the store it was last on the list comes next, then the default store. New items go to the default store when Foodable has no better guess.",
    },
    {
        id: "expiry-levels",
        title: "Expiry levels",
        body: "A row's date turns warm as it gets close, and says Expired once it has passed. Items with no expiry date show No date. Use soon lists items already expired or due within three days, with the count beside its title. Opening an expired or expiring item offers Add to list, or says it is already on the list.",
    },
    {
        id: "allergens",
        title: "Allergens",
        body: "Adding a food to the grocery list that contains a member's allergen stops and asks first; Add anyway adds it. A recipe shows a warning when an ingredient contains the allergen of the person it is viewed for. Allergens come from the food's allergen list when it has one, otherwise from its name.",
    },
    {
        id: "put-away",
        title: "Put away",
        body: "After you check off a grocery line, Put away moves that amount into the location you pick. If that food is already there with the same expiry, the amounts combine; otherwise it's added as a new item. The line then leaves the grocery list.",
    },
    {
        id: "usual-products",
        title: "Usual products",
        body: "A plain food like Eggs can have products — the brands you buy, like Kirkland Large Eggs — and one usual product. Recipes, grocery lines and new meals use the usual product's nutrition, so switching brands updates every recipe at once. Meals you already logged keep their numbers. Pick or change it under Kitchen › Usuals.",
    },
    {
        id: "fridge-row-actions",
        title: "Fridge row actions",
        body: "Tap a fridge row to open its sheet. Ate some takes off a typical portion, Add to list puts it on the grocery list, Freeze moves it to the freezer with a new expiry, and Toss removes it without logging anything. How much is left, Expires and Kept in change the item itself; Save keeps them. On a row, swipe to Ate some or Toss.",
    },
    {
        id: "recipe-portions",
        title: "Recipe portions",
        body: "Yield is how many servings the whole recipe makes. Ingredient amounts are for the full batch; the page also shows the macros for one portion and how many portions are yours. Cook opens a sheet with a servings stepper: set how many you are cooking and it shows what will come out of your stock. Cook takes those ingredients out of your stock, and keeps one serving logged to the meal slot you picked unless you turn that off.",
    },
    {
        id: "needs-attention",
        title: "Notifications",
        body: "The bell at the top of the page shows a green dot when there is something new, and opens your Notifications. They are what needs a look: allergen warnings, food about to expire, a usual running low, a weigh-in that is due, and what others in the household changed with recipes, the week plan or usuals. A planned recipe's missing ingredients show on the Recipes page and the This week card instead. Open goes to the thing, Snooze brings it back tomorrow or in a week, and Dismiss clears it; an admin can also dismiss one for everyone. Allergen warnings can only be opened. A dismissal cannot be undone, and the notification stays gone while the problem lasts; it comes back only if the problem clears and then happens again. Choose which kinds you get under Settings › Notifications.",
    },
    {
        id: "restock",
        title: "Restock",
        body: "Restock puts things on the grocery list for you. On the restock day, it adds food that expires within 7 days and usuals whose schedule is due. On any day, it adds usuals set to “Add when it runs low” once they run low. Each goes on at its usual amount and store, and a usual already on the list is not added again. Ask your AI assistant to turn it on and pick the day and time (it uses update_household_config); one switch controls all of it. Nothing is added until it's on.",
    },
    {
        id: "recipe-drafts",
        title: "How do I finish an imported recipe?",
        body: "An imported recipe is a draft until you save it. A draft stays out of your recipe list, the week plan, cooking, the grocery list and search, and it is deleted 7 days after import unless you save it. Your drafts are listed under Drafts on the Recipes page. Save checks the recipe first and tells you what is left to fix. Once saved, an edit that would break the check is refused. To have your agent fix drafts, give it this prompt in a chat; it saves a draft only when you tell it to.",
    },
    {
        id: "share-to-foodable",
        title: "Share recipes from your phone",
        body: "Install Foodable to your home screen (Android Chrome: menu › Install app, or Add to home screen; iOS Safari: Share › Add to Home Screen — iPhone does not list web apps in the share sheet, so on iPhone paste the link instead). Then use Share › Foodable from TikTok, Instagram, Facebook or the browser. Captions that come through are filled in; if only a link arrives you may be asked to paste the caption.",
    },
    {
        id: "possible-duplicates",
        title: "Possible duplicates",
        body: "Settings › Saved foods & recipes › Possible duplicates lists plain foods that may be the same thing: names with the same words up to plurals, or one name containing every word of the other. Scanned products and foods filed as products never appear. Each pair has a ⋯ menu: Compare and merge, or Keep apart. Compare shows both foods: pick the one to keep, and every fridge item, grocery line and recipe that uses the other moves over to it. Where the two disagree on a value, such as nutrition or units, pick which food it comes from; a value you leave unpicked comes from the food you keep. A merge combines allergens, and the other name becomes another name for the food you keep. Keep apart hides the pair until a food is merged away.",
    },
    {
        id: "goals",
        title: "Goals",
        body: "Settings › Goals holds your daily targets. Tap a number to change it; it saves when you leave the field. A day can have its own goals, and clearing a day puts it back on your daily goals.",
    },
    {
        id: "product-score",
        title: "Product score",
        body: "Settings › Product score sets how much each part counts when Foodable scores a packaged food: nutrition, processing, additives and environment. Pick a preset or move the weights; each shows its share of the whole. Yours applies to your scans. Members who have not chosen their own use the household default, which an owner or admin sets under Household default. The Allergies line on that page comes from your person rules.",
    },
    {
        id: "units",
        title: "Units",
        body: "Settings › Units sets how Foodable shows amounts to you: your weight in kg or lb, and drinks as US drinks or UK units. Choosing one changes what you see from now on; what is already logged does not change.",
    },
    {
        id: "nutrients-shown",
        title: "Nutrients shown",
        body: "Settings › Nutrients shown chooses what Today and the chat cards show besides calories and macros: fiber, sugar, caffeine and alcohol. Fiber is a minimum and the others are limits, from your goals. Turning alcohol off hides it; the drinks you logged stay.",
    },
    {
        id: "ai-connections",
        title: "AI connections",
        body: "Agents you connect, such as Claude or ChatGPT, can log meals, read your fridge and plan groceries for this household. To connect one, add the address under Connect a new agent as a remote MCP server in your agent, then sign in when it asks. The ⋯ on a connected app disconnects it; you can connect it again later. Show cards in chat turns on the goal and meal cards agents show. Your agents can delete is off until you turn it on and covers only what you can delete yourself; the owner's Any agent can delete turns every member's agents off at once. Recent changes lists what agents deleted, cleared or overwrote; a connected app's ⋯ › Changes shows only that app's. You can undo your own agents' changes for 24 hours with ⋯ › Undo, and the owner can undo anyone's.",
    },
    {
        id: "time-zone",
        title: "Time zone",
        body: "Your days and times count in your time zone: a meal logged late at night belongs to the day it is there. Change yours under Settings › Account › Time zone. The household's own time zone, in Settings › Household, sets when the household's day turns over: restock and notices.",
    },
    {
        id: "add-member",
        title: "Adding a member",
        body: "Owners and admins add members under Settings › Household. A username has no @: 2–31 letters, digits, dots, dashes or underscores, starting with a letter or digit. They sign in with it on the same login page.",
    },
    {
        id: "export-data",
        title: "Export data",
        body: "Export data on Settings builds a ZIP of what you have logged: your meals and their items, water, weight, goals and profile, with a README. The download link works for 60 minutes. The meals file can be imported again.",
    },
];

const PROMPT_FIELD_ID = "help-recipe-drafts-prompt";

function promptBlockHtml(): string {
    return `${field({
        id: PROMPT_FIELD_ID,
        name: PROMPT_FIELD_ID,
        label: "Prompt",
        rows: 14,
        readonly: true,
        value: DRAFT_RECIPES_PROMPT,
    })}${button({
        label: "Copy",
        variant: "secondary",
        size: "md",
        attrs: {
            "data-copy-target": PROMPT_FIELD_ID,
            "data-copy-status": `${PROMPT_FIELD_ID}-status`,
        },
    })} <span id="${PROMPT_FIELD_ID}-status" class="fd-settings-help__status" role="status" aria-live="polite"></span>`;
}

/** The Help glossary: one entry per topic, rendered as the Help list rows. */
export const GLOSSARY: readonly GlossaryEntry[] = GLOSSARY_COPY.map(
    (entry) => ({
        id: entry.id,
        title: entry.title,
        // The newline after the paragraph is part of the rendered bytes.
        answer: `<p>${escapeHtml(entry.body)}</p>\n${
            entry.id === "recipe-drafts" ? promptBlockHtml() : ""
        }`,
    }),
);

export const HELP_IDS: readonly string[] = GLOSSARY.map((e) => e.id);

/** Stable anchors for tests and deep links. */
export const HELP_GLOSSARY_IDS = GLOSSARY.map((entry) => entry.id);

/** The most a search reads, so a pasted page cannot make a long query. */
export const HELP_QUERY_MAX = 100;
/** The most words a search counts. */
const HELP_QUERY_WORDS = 8;

const BODIES = new Map(GLOSSARY_COPY.map((entry) => [entry.id, entry.body]));

function queryWords(query: string): string[] {
    return query
        .slice(0, HELP_QUERY_MAX)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, HELP_QUERY_WORDS);
}

/** The topics whose title or text holds every typed word; all of them for none. */
export function searchGlossary(query: string | undefined): GlossaryEntry[] {
    const words = queryWords(query ?? "");
    if (words.length === 0) return [...GLOSSARY];
    return GLOSSARY.filter((entry) => {
        const text =
            `${entry.title} ${BODIES.get(entry.id) ?? ""}`.toLowerCase();
        return words.every((word) => text.includes(word));
    });
}

export type SettingsHelpV2View = {
    chrome: AppChromeBase;
    /** What the search field holds. */
    query?: string;
};

function helpRow(entry: GlossaryEntry): Html {
    return itemRow({
        id: entry.id,
        title: entry.title,
        disclosure: { answer: raw(entry.answer) },
    });
}

/** The search field draws the page's one search landmark; the form around it is none. */
function searchForm(query: string): Html {
    return raw(
        `<form class="fd-settings-help-search" method="get" action="${esc(APP_PATHS.settingsHelp)}" data-turbo-action="replace">${searchField(
            {
                label: "Search help",
                placeholder: "Search help",
                name: "q",
                value: query,
                clear: false,
            },
        )}</form>`,
    );
}

export function renderSettingsHelpV2Body(query = ""): string {
    const entries = searchGlossary(query);
    if (entries.length === 0) {
        return String(
            emptyState({
                title: "No topics match",
                body: `Nothing in Help has “${query.trim().slice(0, HELP_QUERY_MAX)}”.`,
            }),
        );
    }
    return String(
        listGroup({
            rows: entries.map(helpRow),
            label: "Help topics",
            className: "fd-settings-help",
        }),
    );
}

export function renderSettingsHelpV2Page(view: SettingsHelpV2View): string {
    const query = view.query ?? "";
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "help",
        title: "Help",
        headerExtra: searchForm(query.slice(0, HELP_QUERY_MAX)),
        className: "fd-settings--help fd-settings--flat",
        body: renderSettingsHelpV2Body(query),
    });
}
