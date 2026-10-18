import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { pageHeader, panel } from "../components/ui.js";
import { renderSettingsNav } from "../components/settings-nav.js";

export type SettingsHelpView = {
    chrome: ViewerChrome;
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
        body: "Foods are things you eat, like eggs, milk and rice. Household items are supplies you stock but don't eat, like foil, soap and batteries. Add food picks from your foods; Add household item just asks for a name. On a food row, the fork logs it as eaten (a snack). The trash asks to confirm, then removes it without logging anything. Household items only show edit and trash.",
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
        body: "Badges follow the expiry date: Expired if that day has passed, High for today or tomorrow, Medium in 2–3 days, Low in 4–7 days. Later than that, or no date, shows no badge. Expiring soon lists items already expired or due within three days, and shows that count.",
    },
    {
        id: "put-away",
        title: "Put away",
        body: "After you check off a grocery line, Put away moves that amount into the location you pick. If that food is already there with the same expiry, the amounts combine; otherwise it's added as a new item. The line then leaves the grocery list.",
    },
    {
        id: "fridge-row-actions",
        title: "Fridge row icons",
        body: "The pencil edits quantity, location and expiry. The fork logs a food as eaten (a snack). The trash opens a confirm to remove the item without logging anything.",
    },
    {
        id: "recipe-portions",
        title: "Recipe portions",
        body: "Yield is how many portions the whole recipe makes. Ingredient amounts are for the full batch; the page also shows one portion and the amount for the portion size of the person you're viewing. Your portion is saved just for you. Cooked it starts from your portion and 1 for everyone else, and can take the ingredients out of your stock and log a meal for each person. Log a portion only adds a meal — it doesn't change what's in stock.",
    },
    {
        id: "nutrition-arrange",
        title: "Arranging the Nutrition page",
        body: "Arrange opens a modal with up and down controls for each card. Tap Save to store the order once. Order is stored on your profile only — each household member can order their own Nutrition page, including when viewing someone else's data.",
    },
];

function glossaryHtml(): string {
    return GLOSSARY.map(
        (
            entry,
        ) => `<section class="help-entry psec" id="${escapeHtml(entry.id)}">
<h3>${escapeHtml(entry.title)}</h3>
<p>${escapeHtml(entry.body)}</p>
</section>`,
    ).join("");
}

export function renderSettingsHelpPage(view: SettingsHelpView): string {
    const body = `
        ${pageHeader({ title: "Help" })}
        ${renderSettingsNav("help")}
        ${panel({
            title: "Glossary",
            body: glossaryHtml(),
        })}
    `;
    return renderAppShell({
        title: "Help",
        active: "settings",
        theme: view.chrome.theme,
        body,
    });
}

/** Stable anchors for tests and deep links. */
export const HELP_GLOSSARY_IDS = GLOSSARY.map((entry) => entry.id);
