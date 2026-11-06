import {
    escapeHtml,
    renderSettingsPage as renderSettingsShell,
    type ViewerChrome,
} from "../shell.js";
import { pageHeader, panel, field } from "../components/ui.js";
import { UNVERIFIED_RECIPES_PROMPT } from "../../copy/agent-prompts.js";
import { renderSettingsNav } from "../components/settings-nav.js";

export type SettingsHelpView = {
    chrome: ViewerChrome;
    backHref: string;
};

type GlossaryEntry = {
    id: string;
    title: string;
    body: string;
};

const GLOSSARY: GlossaryEntry[] = [
    {
        id: "food-vs-household-item",
        title: "Food vs household item",
        body: "Foods are things you eat, like eggs, milk and rice. Household items are supplies you stock but don't eat, like foil, soap and batteries. Add food picks from your foods; Add household item just asks for a name. On both food and household rows, the pencil edits and the trash asks to confirm, then removes the item without logging anything.",
    },
    {
        id: "locations",
        title: "Locations",
        body: "A location is a place you keep things, such as Fridge, Freezer or Pantry. Add each one under Fridge › Add location; each gets its own panel. Putting groceries away and adding an item both go into one location.",
    },
    {
        id: "stores-and-sections",
        title: "Stores and sections",
        body: "Grocery stores group your shopping list. Each store has sections (aisles) such as Produce or Dairy. Leave the section on Other and the app picks an aisle: where you already shop for that food, otherwise a guess from its name. If it can't tell, the line stays in Other.",
    },
    {
        id: "expiry-levels",
        title: "Expiry levels",
        body: "Only expired items show an Expired badge on the row. Later dates and items with no expiry date show no badge. Expiring soon lists items already expired or due within three days, and shows that count. Expired and expiring food offers Add to grocery list, or says it is already on the list.",
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
        body: "A plain food like Eggs can have products — the brands you buy, like Kirkland Large Eggs — and one usual product. Recipes, grocery lines and new meals use the usual product's nutrition, so switching brands updates every recipe at once. Meals you already logged keep their numbers. Pick or change it under Household › Usual products.",
    },
    {
        id: "fridge-row-actions",
        title: "Fridge row icons",
        body: "The pencil edits quantity, location and expiry. The trash opens a confirm to remove the item without logging anything.",
    },
    {
        id: "recipe-portions",
        title: "Recipe portions",
        body: "Yield is how many portions the whole recipe makes. Ingredient amounts are for the full batch; the page also shows one portion and the amount for the portion size of the person you're viewing. Your portion is saved just for you. Cooked it starts from your portion and 1 for everyone else, and can take the ingredients out of your stock and log a meal for each person. Log a portion only adds a meal — it doesn't change what's in stock.",
    },
    {
        id: "nutrition-arrange",
        title: "Arranging the Nutrition page",
        body: "Arrange opens a modal with up and down controls for each card. Tap Save to store the order once. Order is stored on your profile only and applies to your own Nutrition page view. Arrange is not available while you are viewing someone else's data.",
    },
    {
        id: "needs-attention",
        title: "Needs attention",
        body: "The number beside Settings counts every open warning and suggestion across the household (not allergen blocks). Dismiss hides a suggestion for good, until that thing is removed or merged away. Undo dismissed notices under Show dismissed on the Needs attention page.",
    },
    {
        id: "restock",
        title: "Restock",
        body: "Restock adds food that's about to expire to the grocery list for you, once a week. Turn it on under Settings › Household and pick the day and time; food in the fridge that expires within 7 days goes on the list at its usual amount and store. Nothing is added until it's on.",
    },
    {
        id: "unverified-recipes",
        title: "How do I get unverified recipes verified?",
        body: "Imports that do not pass the check stay unverified. They cannot go on the grocery list, be cooked, or be logged until the check passes. Give this prompt to your agent, or set it up as a nightly or weekly automation in your agent.",
    },
];

export const HELP_IDS: readonly string[] = GLOSSARY.map((e) => e.id);
const PROMPT_FIELD_ID = "help-unverified-recipes-prompt";

function glossaryHtml(): string {
    return GLOSSARY.map((entry) => {
        const promptBlock =
            entry.id === "unverified-recipes"
                ? `${field({
                      id: PROMPT_FIELD_ID,
                      label: "Prompt",
                      control: `<textarea id="${PROMPT_FIELD_ID}" readonly rows="14">${escapeHtml(UNVERIFIED_RECIPES_PROMPT)}</textarea>`,
                  })}<button type="button" class="btn-sm" data-copy-target="${PROMPT_FIELD_ID}">Copy</button>`
                : "";
        return `<section class="help-entry psec" id="${escapeHtml(entry.id)}">
<h3 class="subsection-title">${escapeHtml(entry.title)}</h3>
<p>${escapeHtml(entry.body)}</p>
${promptBlock}
</section>`;
    }).join("");
}

export function renderSettingsHelpPage(view: SettingsHelpView): string {
    const body = `
        ${pageHeader({ title: "Help" })}
        ${renderSettingsNav("help", view.backHref)}
        ${panel({
            title: "Glossary",
            body: glossaryHtml(),
        })}
    `;
    return renderSettingsShell({
        title: "Help",
        theme: view.chrome.theme,
        backHref: view.backHref,
        body,
    });
}

/** Stable anchors for tests and deep links. */
export const HELP_GLOSSARY_IDS = GLOSSARY.map((entry) => entry.id);
