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
        body: "Foods are things you eat and track nutrition for — eggs, milk, rice. Household items are supplies you stock but do not eat: foil, soap, batteries. On the Fridge page, Add food links to your food catalog; Add household item is a free-text supply with no meal logging.",
    },
    {
        id: "locations",
        title: "Locations",
        body: "Locations are where stock lives: fridge, freezer, pantry, and any names you add under Fridge › Add location. Each location is its own panel on the Fridge page. Grocery put-away and manual adds target one location at a time.",
    },
    {
        id: "stores-and-sections",
        title: "Stores and sections",
        body: "Grocery stores group your shopping list. Each store has sections (aisles) such as Produce or Dairy. When you add a line, the Section picker chooses the aisle; the default Other section lets the app guess an aisle from the food name when you leave it on Other.",
    },
    {
        id: "expiry-levels",
        title: "Expiry levels",
        body: "Badges on fridge rows use UTC calendar days until the expiry date: Expired (past date), High (today or tomorrow), Medium (2–3 days), Low (4–7 days). More than seven days out, or no date, shows no badge. Expiring soon lists every item that is High or Medium — the same window as three days or less — and shows the count in its summary.",
    },
    {
        id: "put-away",
        title: "Put away",
        body: "After you check off a grocery line, Put away moves that quantity into a fridge location you pick. It writes a purchase movement and adds or merges stock there, then removes the line from the list.",
    },
    {
        id: "ate-it-vs-toss",
        title: "Ate it vs Toss",
        body: "Both reduce stock on the item. Ate it records an eat movement and, for food linked to the catalog, logs a snack meal with the amount removed and links that meal to the movement. Toss records a discard movement only — nothing is added to your nutrition log.",
    },
    {
        id: "recipe-portions",
        title: "Recipe portions",
        body: "Yield is how many portions the full recipe makes. Ingredient amounts in the recipe are totals for the whole batch; the page shows per-portion and your-portion amounts using that yield. Your portion is saved per person: changing it rescales the amounts shown for you. Cook and Log a portion use your portion (or per-person cook amounts) to scale what is eaten or logged.",
    },
    {
        id: "nutrition-arrange",
        title: "Arranging the Nutrition page",
        body: "Arrange opens a modal with up and down controls for each card. Order is stored on your profile only — each household member can order their own Nutrition page, including when viewing someone else's data.",
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
