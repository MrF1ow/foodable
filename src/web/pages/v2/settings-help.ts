import type { AppChromeBase } from "../../attention.js";
import { escapeHtml } from "../../shell.js";
import { field } from "../../components/ui.js";
import { UNVERIFIED_RECIPES_PROMPT } from "../../../copy/agent-prompts.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import { renderSettingsV2Page, settingsPageHeader } from "./settings-shared.js";

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
        body: "A location is a place you keep things, such as Fridge, Freezer or Pantry. Ask your AI assistant to add one (it uses add_fridge_location); each gets its own panel. Putting groceries away and adding an item both go into one location.",
    },
    {
        id: "stores-and-sections",
        title: "Stores and sections",
        body: "Grocery stores group your shopping list. Each store has sections (aisles) such as Produce or Dairy. Leave the section on Other and the app picks an aisle: where you already shop for that food, otherwise a guess from its name. If it can't tell, the line stays in Other.",
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
        title: "Needs attention",
        body: "A dot on a tab, or on Settings, means there is an open warning or suggestion under it (not allergen blocks). Today lists them in its Needs attention card, and View all opens the full list. Dismiss hides a suggestion for good, until that thing is removed or merged away. Undo dismissed notices under Show dismissed on the Needs attention page.",
    },
    {
        id: "restock",
        title: "Restock",
        body: "Restock puts things on the grocery list for you. On the restock day, it adds food that expires within 7 days and usuals whose schedule is due. On any day, it adds usuals set to “Add when it runs low” once they run low. Each goes on at its usual amount and store, and a usual already on the list is not added again. Ask your AI assistant to turn it on and pick the day and time (it uses update_household_config); one switch controls all of it. Nothing is added until it's on.",
    },
    {
        id: "unverified-recipes",
        title: "How do I get unverified recipes verified?",
        body: "Imports that do not pass the check stay unverified. They cannot go on the grocery list, be cooked, or be logged until the check passes. Give this prompt to your agent, or set it up as a nightly or weekly automation in your agent.",
    },
    {
        id: "share-to-foodable",
        title: "Share recipes from your phone",
        body: "Install Foodable to your home screen (Android Chrome: menu › Install app, or Add to home screen; iOS Safari: Share › Add to Home Screen — iPhone does not list web apps in the share sheet, so on iPhone paste the link instead). Then use Share › Foodable from TikTok, Instagram, Facebook or the browser. Captions that come through are filled in; if only a link arrives you may be asked to paste the caption.",
    },
    {
        id: "possible-duplicates",
        title: "Possible duplicates",
        body: "Household › Possible duplicates lists plain foods that may be the same thing: names with the same words up to plurals, or one name containing every word of the other. Scanned products and foods filed as products never appear. Merge… keeps one name, lets you choose conflicting nutrition or unit values, and combines allergens; the other name becomes another name for it. Keep separate hides the pair until a food is merged away. Undo a Keep separate from Needs attention › Show dismissed.",
    },
];

const PROMPT_FIELD_ID = "help-unverified-recipes-prompt";

function promptBlockHtml(): string {
    return `${field({
        id: PROMPT_FIELD_ID,
        label: "Prompt",
        control: `<textarea id="${PROMPT_FIELD_ID}" readonly rows="14">${escapeHtml(UNVERIFIED_RECIPES_PROMPT)}</textarea>`,
    })}<button type="button" class="btn-sm" data-copy-target="${PROMPT_FIELD_ID}" data-copy-status="${PROMPT_FIELD_ID}-status" aria-label="Copy prompt">Copy</button> <span id="${PROMPT_FIELD_ID}-status" class="muted" role="status" aria-live="polite"></span>`;
}

/** The Help glossary: one entry per topic, rendered as the Help list rows. */
export const GLOSSARY: readonly GlossaryEntry[] = GLOSSARY_COPY.map(
    (entry) => ({
        id: entry.id,
        title: entry.title,
        // The newline after the paragraph is part of the rendered bytes.
        answer: `<p>${escapeHtml(entry.body)}</p>\n${
            entry.id === "unverified-recipes" ? promptBlockHtml() : ""
        }`,
    }),
);

export const HELP_IDS: readonly string[] = GLOSSARY.map((e) => e.id);

/** Stable anchors for tests and deep links. */
export const HELP_GLOSSARY_IDS = GLOSSARY.map((entry) => entry.id);

export type SettingsHelpV2View = {
    chrome: AppChromeBase;
};

function helpRow(entry: GlossaryEntry): string {
    return `<li class="fd-settings-help__item"><details class="fd-settings-help__row" id="${escapeHtml(entry.id)}">
<summary class="fd-settings-help__summary"><span class="fd-settings-help__label">${escapeHtml(entry.title)}</span><span class="fd-settings-help__chev" aria-hidden="true">${iconChevronRight()}</span></summary>
<div class="fd-settings-help__answer">${entry.answer}</div>
</details></li>`;
}

export function renderSettingsHelpV2Body(): string {
    const rows = GLOSSARY.map(helpRow).join("");
    return `${String(settingsPageHeader("Help"))}<ul class="fd-settings-help" aria-label="Help topics">${rows}</ul>`;
}

export function renderSettingsHelpV2Page(view: SettingsHelpV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "help",
        title: "Help",
        body: renderSettingsHelpV2Body(),
    });
}
