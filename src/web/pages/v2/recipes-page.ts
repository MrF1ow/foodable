import type { FridgeItem, FridgeLocation } from "../../../domain/fridge.js";
import { formatFridgeExpiryLabel } from "./kitchen-fridge.js";
import type { PlanSlot } from "../../../domain/plan.js";
import {
    recipeSteps,
    recipeTimeLabel,
    type Recipe,
    type RecipeIngredient,
    type RecipeMacros,
} from "../../../domain/recipes.js";
import {
    fridgeItemMatchesFood,
    type FamilyFoodRow,
} from "../../../domain/stock.js";
import {
    formatLogMacroGrams,
    formatLogMacroKcal,
} from "../../../domain/log-macro-format.js";
import type { AppChromeBase } from "../../attention.js";
import { formatRecipeAmountParts } from "./amount-text.js";
import { button } from "../../components/v2/button.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { pageHeader } from "../../components/v2/page-header.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { statTiles, type StatTile } from "../../components/v2/stat-tiles.js";
import { APP_PATHS } from "../../route-map.js";
import { renderAppShell } from "../../shell.js";
import {
    renderMentionCards,
    stepWithMentions,
    type MentionWarningView,
} from "./recipes-page-mentions.js";
import {
    COOK_SHEET_ID,
    renderCookSheet,
    type CookSheetView,
} from "./recipes-page-cook.js";
import {
    PLAN_SHEET_ID,
    PLAN_SLOT_LABEL,
    planDayLabel,
    renderPlanSheet,
    type PlanSheetView,
} from "./recipes-plan.js";
import { RECIPE_SHARE_SHEET_ID, renderShareSheet } from "./share-sheet.js";

export const RECIPE_NOT_IN_STOCK_ID = "__not_in_stock__";

/** The "Discard this recipe?" sheet the importer's landing opens before a link or form leaves it. */
export const RECIPE_LEAVE_SHEET_ID = "fd-recipe-leave-sheet";
const RECIPE_LEAVE_FORM_ID = "fd-recipe-leave-form";

/**
 * What the sheet says besides its question. Discard deletes the draft now; a
 * draft left unsaved goes on its expiry day, the one the draft card names
 * (the browser's back button and a closed tab are not held, so the words hold
 * for every way off the page).
 */
export function leaveMessage(expiresOn: string | null): string {
    const day = draftDayLabel(expiresOn);
    return day
        ? `Discard deletes it now. A draft you leave unsaved is deleted on ${day}.`
        : "Discard deletes it now. A draft you leave unsaved is deleted when it expires.";
}

/** An expiry day as the draft card names it. */
function draftDayLabel(expiresOn: string | null): string | null {
    if (!expiresOn) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(expiresOn)
        ? planDayLabel(expiresOn)
        : expiresOn;
}

/**
 * The leave guard of a draft's first landing after an import: Keep editing
 * stays on the page, Discard posts the discard route (which deletes the draft,
 * and answers where it always does). `client/v2/recipes.js` opens it when a
 * link, a Turbo visit or a form would leave the page.
 */
function leaveSheet(recipeId: string, expiresOn: string | null): string {
    return sheet({
        id: RECIPE_LEAVE_SHEET_ID,
        placement: "dialog",
        header: { kind: "title", title: "Discard this recipe?" },
        body: join([
            raw(
                `<form id="${RECIPE_LEAVE_FORM_ID}" method="post" action="/recipes/${esc(recipeId)}/discard"></form>`,
            ),
            sheetSection({
                kind: "message",
                text: leaveMessage(expiresOn),
            }),
        ]),
        actions: {
            kind: "destructive",
            cancel: {
                label: "Keep editing",
                attrs: { command: "close", commandfor: RECIPE_LEAVE_SHEET_ID },
            },
            danger: {
                label: "Discard",
                type: "submit",
                form: RECIPE_LEAVE_FORM_ID,
            },
        },
        focus: "panel",
    });
}

export type RecipeIngredientPlaceLine = {
    ingredientId: string;
    displayName: string;
    amountLabel: string;
    expiresOn: string | null;
};

export type RecipeIngredientPlaceGroup = {
    placeId: string;
    placeName: string;
    lines: RecipeIngredientPlaceLine[];
};

/**
 * Whose version of the recipe the page shows, and who may be picked instead.
 * Absent on a recipe nobody has a version of (a household of one with no
 * changes) and on a draft: the caption is then a plain "Per serving".
 */
export type RecipeVersionPicker = {
    /** The viewer's own id: their version is the page's address with no `member`. */
    viewerId: string;
    /** `base`, or the id of the member whose version is shown. */
    viewing: string;
    /** Who the caption names: "Base" or the person's name. */
    viewingName: string;
    /** How many changes the shown version has from the base; 0 for the base. */
    changeCount: number;
    /** Every member of the household, in the order the menu lists them. */
    people: { userId: string; name: string }[];
    /** The viewer may open the compare page (`household.align_recipe_versions`). */
    canCompare: boolean;
};

export type RecipeDetailV2View = {
    chrome: AppChromeBase;
    recipe: Recipe;
    ingredients: IngredientRow[];
    ingredientGroups: RecipeIngredientPlaceGroup[];
    macrosPerPortion: RecipeMacros;
    /** One sentence per reason the macros are incomplete (from the recipe's notices). */
    gapReasons: string[];
    /** How many portions of the recipe are the viewer's own; absent shows no line. */
    portionCount?: number;
    /** The whose-version pull-down; see {@link RecipeVersionPicker}. */
    versions?: RecipeVersionPicker;
    /** The viewer has starred this recipe. Absent means not. */
    favourite?: boolean;
    /**
     * Foods the steps use that the ingredients lack, each with Add and Dismiss.
     * Advice only; absent or empty shows nothing.
     */
    mentions?: MentionWarningView[];
    /** The cook sheet. Absent when the recipe cannot be cooked (a draft). */
    cook?: CookSheetView;
    /** Ingredient food ids an unticked grocery line already covers. */
    onList?: readonly string[];
    /** The Add to plan sheet. */
    plan?: PlanSheetView;
    /**
     * This recipe's plans from the household's today on, in day then meal
     * order. Absent or empty shows nothing; otherwise a "Planned" line under
     * the title, so the redirect after Add to plan lands on the result.
     */
    planned?: { date: string; slot: PlanSlot }[];
    /**
     * The Share sheet; a refused post re-renders the page with it open. Absent
     * leaves the Share item and the sheet out (`mcp-share-links` is off).
     */
    share?: { open?: boolean; error?: string };
    /**
     * Set when the recipe is an imported draft nobody has saved: what the
     * check still finds and when the sweep deletes it. The page then shows the
     * draft bar, with Save, in place of Plan and Cook.
     */
    draft?: {
        problems: string[];
        expiresOn: string | null;
        /** The viewer may save recipes (`recipe.edit`). */
        canSave: boolean;
        /** The viewer imported it, or is the owner. */
        canDiscard: boolean;
        /**
         * The page is the importer's first landing after the app import
         * (`?imported=1`, and the draft is theirs): it asks "Discard this
         * recipe?" before anything leaves it. Never on a later visit or on
         * another person's draft.
         */
        leaveGuard: boolean;
    };
    error?: string;
};

type IngredientRow = Pick<
    RecipeIngredient,
    "id" | "foodId" | "displayName" | "quantity" | "note"
> & {
    /**
     * How the shown version's line differs from the base, said as the row's
     * first subline words ("Yours · base 6 oz"); absent on a line the base
     * has as it is.
     */
    versionNote?: string;
};

function ingredientAmountLabel(
    quantity: RecipeIngredient["quantity"],
    note: string | null,
): string {
    if (quantity == null) return note?.trim() || "to taste";
    return formatRecipeAmountParts(quantity.amount, quantity.unit);
}

function soonestExpiry(dates: Array<string | null | undefined>): string | null {
    const set = dates.filter((d): d is string => Boolean(d?.trim()));
    if (set.length === 0) return null;
    return set.slice().sort()[0]!;
}

export function groupRecipeIngredientsByPlace(
    ingredients: IngredientRow[],
    fridgeItems: FridgeItem[],
    locations: FridgeLocation[],
    familyFoodMap: ReadonlyMap<string, FamilyFoodRow>,
): RecipeIngredientPlaceGroup[] {
    const sortedLocations = locations
        .slice()
        .sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        );
    const groupMap = new Map<string, RecipeIngredientPlaceGroup>();
    for (const loc of sortedLocations) {
        groupMap.set(loc.id, {
            placeId: loc.id,
            placeName: loc.name,
            lines: [],
        });
    }
    const notInStock: RecipeIngredientPlaceLine[] = [];

    for (const ingredient of ingredients) {
        const needFoodId = ingredient.foodId;
        const matches =
            needFoodId == null
                ? []
                : fridgeItems.filter((item) =>
                      fridgeItemMatchesFood(
                          item.foodId,
                          needFoodId,
                          familyFoodMap,
                      ),
                  );
        const amountLabel = ingredientAmountLabel(
            ingredient.quantity,
            ingredient.note,
        );
        if (matches.length === 0) {
            notInStock.push({
                ingredientId: ingredient.id,
                displayName: ingredient.displayName,
                amountLabel,
                expiresOn: null,
            });
            continue;
        }
        const placed = new Set<string>();
        for (const loc of sortedLocations) {
            const inLoc = matches.filter((item) => item.locationId === loc.id);
            if (inLoc.length === 0) continue;
            placed.add(loc.id);
            const group = groupMap.get(loc.id)!;
            group.lines.push({
                ingredientId: ingredient.id,
                displayName: ingredient.displayName,
                amountLabel,
                expiresOn: soonestExpiry(inLoc.map((item) => item.expiresOn)),
            });
        }
        const unlocated = matches.filter(
            (item) =>
                !sortedLocations.some((loc) => loc.id === item.locationId),
        );
        if (unlocated.length > 0 && placed.size === 0) {
            notInStock.push({
                ingredientId: ingredient.id,
                displayName: ingredient.displayName,
                amountLabel,
                expiresOn: soonestExpiry(
                    unlocated.map((item) => item.expiresOn),
                ),
            });
        }
    }

    const out: RecipeIngredientPlaceGroup[] = [];
    for (const loc of sortedLocations) {
        const group = groupMap.get(loc.id)!;
        if (group.lines.length > 0) out.push(group);
    }
    if (notInStock.length > 0) {
        out.push({
            placeId: RECIPE_NOT_IN_STOCK_ID,
            placeName: "Not in stock",
            lines: notInStock,
        });
    }
    return out;
}

function macroValue(value: number | null | undefined, grams: boolean) {
    if (value == null) return "—";
    return grams ? formatLogMacroGrams(value) : formatLogMacroKcal(value);
}

/**
 * "Per serving" and the four tiles; a figure the recipe cannot give is a dash,
 * never a zero. Each reason the totals are incomplete is a caption under them
 * in the warning tone.
 */
function macrosBlock(
    macros: RecipeMacros,
    gapReasons: string[],
    portionCount: number | undefined,
    caption: string,
    portionsFor: string,
): string {
    const tiles: StatTile[] = [
        {
            label: "kcal",
            value: macroValue(macros.calories, false),
            dot: "calories",
        },
        {
            label: "Protein",
            value: macroValue(macros.protein_g, true),
            ...(macros.protein_g != null ? { unit: "g" } : {}),
            dot: "protein",
        },
        {
            label: "Carbs",
            value: macroValue(macros.carbs_g, true),
            ...(macros.carbs_g != null ? { unit: "g" } : {}),
            dot: "carbs",
        },
        {
            label: "Fat",
            value: macroValue(macros.fat_g, true),
            ...(macros.fat_g != null ? { unit: "g" } : {}),
            dot: "fat",
        },
    ];
    const portions =
        portionCount == null
            ? ""
            : `<p class="fd-recipe-caption fd-recipe-portions">${esc(portionCount === 1 ? `1 portion for ${portionsFor}` : `${portionCount} portions for ${portionsFor}`)}</p>`;
    const gaps =
        macros.incomplete || macros.calories == null
            ? gapReasons
                  .map(
                      (reason) =>
                          `<p class="fd-recipe-caption fd-recipe-caption--warn">${esc(reason)}</p>`,
                  )
                  .join("")
            : "";
    return `<section class="fd-recipe-macros" aria-label="Per serving">${caption}${String(
        statTiles(tiles, {
            label: "Per serving",
            className: "fd-recipe-macro-tiles",
        }),
    )}${portions}${gaps}</section>`;
}

type IngredientPlace = {
    amountLabel: string;
    inStock: boolean;
    places: string[];
    expiresOn: string | null;
};

/** What each ingredient's row says about the kitchen, by ingredient id. */
function placesByIngredient(
    groups: readonly RecipeIngredientPlaceGroup[],
): Map<string, IngredientPlace> {
    const out = new Map<string, IngredientPlace>();
    for (const group of groups) {
        const inStock = group.placeId !== RECIPE_NOT_IN_STOCK_ID;
        for (const line of group.lines) {
            const known = out.get(line.ingredientId);
            if (!known) {
                out.set(line.ingredientId, {
                    amountLabel: line.amountLabel,
                    inStock,
                    places: inStock ? [group.placeName] : [],
                    expiresOn: line.expiresOn,
                });
                continue;
            }
            if (inStock) {
                known.inStock = true;
                if (!known.places.includes(group.placeName)) {
                    known.places.push(group.placeName);
                }
            }
            known.expiresOn = soonestExpiry([known.expiresOn, line.expiresOn]);
        }
    }
    return out;
}

export const VERSION_MENU_LABEL = "Whose version";

/**
 * What a changed line of a version says about the base, as the row's first
 * subline words: who changed it and what it was ("Yours · base 6 oz"). `who`
 * is "Yours" or "Mia's".
 */
export function ingredientVersionNote(
    who: string,
    change: "amount" | "food" | "add",
    base: Pick<RecipeIngredient, "displayName" | "quantity"> | undefined,
): string {
    if (change === "add" || !base) return `${who} · not in base`;
    const amount = base.quantity
        ? formatRecipeAmountParts(base.quantity.amount, base.quantity.unit)
        : "to taste";
    return change === "food"
        ? `${who} · base ${base.displayName} ${amount}`
        : `${who} · base ${amount}`;
}

function changesLabel(count: number): string {
    return `${count} ${count === 1 ? "change" : "changes"} from base`;
}

/**
 * The caption over the macro tiles. With a version to pick it is the Link
 * button of the whose-version pull-down ("Per serving · Ethan · 1 change from
 * base"): Base, each member, and Compare versions for an admin or the owner.
 * Without one it is the plain words.
 */
function perServingCaption(view: RecipeDetailV2View): string {
    const picker = view.versions;
    if (!picker) return `<p class="fd-recipe-caption">Per serving</p>`;
    const recipeId = view.recipe.id;
    const items: MenuItem[] = [
        {
            kind: "checked",
            label: "Base",
            checked: picker.viewing === "base",
            href: `/recipes/${recipeId}?member=base`,
        },
        // The viewer comes right after Base, then everyone else.
        ...[...picker.people]
            .sort(
                (a, b) =>
                    Number(b.userId === picker.viewerId) -
                    Number(a.userId === picker.viewerId),
            )
            .map((person): MenuItem => ({
                kind: "checked",
                label: person.name,
                checked: picker.viewing === person.userId,
                href:
                    person.userId === picker.viewerId
                        ? `/recipes/${recipeId}`
                        : `/recipes/${recipeId}?member=${encodeURIComponent(person.userId)}`,
            })),
    ];
    if (picker.canCompare) {
        items.push({
            kind: "link",
            label: "Compare versions",
            href: `/recipes/${recipeId}/compare`,
        });
    }
    const label = [
        "Per serving",
        picker.viewingName,
        ...(picker.changeCount > 0 ? [changesLabel(picker.changeCount)] : []),
    ].join(" · ");
    return String(
        menu({
            label: VERSION_MENU_LABEL,
            anchor: "link",
            link: { label, icon: "users" },
            className: "fd-recipe-version",
            items,
        }),
    );
}

function ingredientSubline(
    place: IngredientPlace | undefined,
    onList: boolean,
    versionNote?: string,
): string {
    const stock =
        !place || !place.inStock
            ? "Not in stock"
            : place.expiresOn
              ? `${place.places.join(", ")} · expires ${formatFridgeExpiryLabel(place.expiresOn)}`
              : place.places.join(", ");
    const line = onList ? `${stock} · On the list` : stock;
    return versionNote ? `${versionNote} · ${line}` : line;
}

/**
 * An ingredient's ⋯: Open food, and Add to grocery list on a saved recipe
 * (a draft cannot be put on the list, and a food already on it says so). The add posts to this recipe's own
 * route, which adds the food with its usual amount and store and comes back
 * to the recipe.
 */
function ingredientMenu(
    recipeId: string,
    ingredient: Pick<RecipeIngredient, "foodId" | "displayName">,
    draft: boolean,
    onList: boolean,
): Html {
    const items: MenuItem[] = [
        {
            kind: "link",
            label: "Open food",
            href: `${APP_PATHS.product}/${ingredient.foodId}?from=${encodeURIComponent(`/recipes/${recipeId}`)}`,
        },
    ];
    if (!draft && !onList) {
        items.push({
            kind: "post",
            label: "Add to grocery list",
            action: `/recipes/${recipeId}/ingredients/${ingredient.foodId}/add-to-grocery`,
        });
    }
    return menu({
        label: `Actions for ${ingredient.displayName}`,
        anchor: "more",
        items,
    });
}

function ingredientsSection(view: RecipeDetailV2View): string {
    const places = placesByIngredient(view.ingredientGroups);
    const listed = new Set(view.onList ?? []);
    if (view.ingredients.length === 0) {
        return `<p class="fd-recipe-empty">No ingredients yet.</p>`;
    }
    const rows = view.ingredients.map((ingredient) => {
        const place = places.get(ingredient.id);
        const onList =
            ingredient.foodId != null && listed.has(ingredient.foodId);
        return itemRow({
            title: ingredient.displayName,
            meta:
                place?.amountLabel ??
                ingredientAmountLabel(ingredient.quantity, ingredient.note),
            subtitle: ingredientSubline(place, onList, ingredient.versionNote),
            trailing: {
                kind: "control",
                html: ingredientMenu(
                    view.recipe.id,
                    ingredient,
                    Boolean(view.draft),
                    onList,
                ),
            },
        });
    });
    return `<div class="fd-recipe-group">${String(
        sectionHeader({
            label: "Ingredients",
            count: view.ingredients.length,
            rule: false,
            id: "fd-recipe-ingredients-heading",
        }),
    )}${String(listGroup({ rows, label: "Ingredients" }))}</div>`;
}

function instructionsHtml(
    instructions: string | null,
    mentions: readonly MentionWarningView[] | undefined,
): string {
    const steps = recipeSteps(instructions);
    const head = String(
        sectionHeader({
            label: "Steps",
            rule: false,
            id: "fd-recipe-method-heading",
        }),
    );
    if (steps.length === 0) {
        return `<div class="fd-recipe-group">${head}<p class="fd-recipe-empty">No steps yet.</p></div>`;
    }
    return `<div class="fd-recipe-group">${head}<ol class="fd-recipe-steps">${steps.map((step, i) => `<li>${stepWithMentions(step, i, mentions)}</li>`).join("")}</ol></div>`;
}

function recipeSourceHint(sourceUrl: string | null): string {
    if (!sourceUrl?.trim()) return "";
    try {
        const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
        return host ? `from ${host}` : "";
    } catch {
        return "";
    }
}

/** How many planned days the caption names before it counts the rest. */
const PLANNED_SHOWN = 4;

function plannedLine(planned: RecipeDetailV2View["planned"]): string {
    if (!planned || planned.length === 0) return "";
    const shown = planned
        .slice(0, PLANNED_SHOWN)
        .map(
            (p) =>
                `${planDayLabel(p.date)} · ${PLAN_SLOT_LABEL[p.slot].toLowerCase()}`,
        );
    const more = planned.length - shown.length;
    const text = `Planned · ${shown.join(", ")}${more > 0 ? ` · +${more} more` : ""}`;
    return `<p class="fd-recipe-caption fd-recipe-planned">${esc(text)}</p>`;
}

/** Whose portions the "N portions" line counts: the viewer's, or the person whose version is shown. */
function portionsFor(view: RecipeDetailV2View): string {
    const picker = view.versions;
    return picker &&
        picker.viewing !== "base" &&
        picker.viewing !== picker.viewerId
        ? picker.viewingName
        : "you";
}

function servingsMeta(portions: number): string {
    return portions === 1 ? "1 serving" : `${portions} servings`;
}

/**
 * What is left on a draft: that it is not saved, when it goes, and what the
 * check still finds. The draft bar's Save answers it.
 */
function draftCard(draft: NonNullable<RecipeDetailV2View["draft"]>): string {
    const day = draftDayLabel(draft.expiresOn);
    const expires = day ? ` It is deleted on ${day} unless you save it.` : "";
    const left =
        draft.problems.length > 0
            ? `<p class="fd-recipe-caption">Fix these before you save it:</p><ul class="fd-recipe-draft__problems">${draft.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`
            : `<p class="fd-recipe-caption">It passes the check and is ready to save.</p>`;
    return `<section class="fd-recipe-draft" id="fd-recipe-draft" aria-label="Draft">
<p class="fd-recipe-draft__lead">Not saved yet.${esc(expires)}</p>
${left}
</section>`;
}

/**
 * The bar at the foot of the phone (and under the Detail bar on desktop):
 * Plan and Cook on a saved recipe; on a draft the draft bar, which is Save
 * and how many things are left to fix.
 */
function actionBar(view: RecipeDetailV2View, recipeId: string): Html {
    if (view.draft) {
        if (!view.draft.canSave) return raw("");
        const left = view.draft.problems.length;
        const status =
            left === 0
                ? "Ready to save"
                : left === 1
                  ? "1 thing to fix"
                  : `${left} things to fix`;
        return raw(
            `<div class="fd-recipe-bar fd-recipe-bar--draft" id="fd-recipe-draft-bar"><p class="fd-recipe-bar__status">${esc(status)}</p><form method="post" action="/recipes/${esc(recipeId)}/save" class="fd-recipe-bar__form">${view.draft.leaveGuard ? '<input type="hidden" name="imported" value="1">' : ""}${button({ label: "Save", variant: "primary", type: "submit" })}</form></div>`,
        );
    }
    const buttons = [
        view.plan
            ? button({
                  label: "Plan",
                  attrs: { command: "show-modal", commandfor: PLAN_SHEET_ID },
              })
            : "",
        view.cook
            ? button({
                  label: "Cook",
                  variant: "primary",
                  attrs: { command: "show-modal", commandfor: COOK_SHEET_ID },
              })
            : "",
    ];
    if (!view.plan && !view.cook) return raw("");
    return raw(
        `<div class="fd-recipe-bar" id="fd-recipe-cook-heading">${join(buttons)}</div>`,
    );
}

/**
 * The Detail bar's ⋯: Share (with `mcp-share-links` on) and the viewer's
 * star on a saved recipe, Discard on a draft. With nothing to offer there is
 * no ⋯, and the bar keeps its title centred.
 */
function detailMenu(view: RecipeDetailV2View): Html | null {
    const items: MenuItem[] = [];
    if (view.draft) {
        if (view.draft.canDiscard) {
            items.push({
                kind: "destructive",
                label: "Discard draft",
                confirmLabel: "Discard",
                action: `/recipes/${view.recipe.id}/discard`,
            });
        }
    } else {
        if (view.share) {
            items.push({
                kind: "opens",
                label: "Share",
                sheetId: RECIPE_SHARE_SHEET_ID,
            });
        }
        items.push({
            kind: "post",
            label: view.favourite
                ? "Remove from favourites"
                : "Add to favourites",
            action: `/recipes/${view.recipe.id}/favourite`,
            fields: { on: view.favourite ? "0" : "1", back: "recipe" },
        });
    }
    if (items.length === 0) return null;
    return menu({
        label: `Actions for ${view.recipe.name}`,
        anchor: "more",
        items,
    });
}

export function renderRecipeDetailBody(view: RecipeDetailV2View): string {
    const recipe = view.recipe;
    const time = recipeTimeLabel(recipe);
    const metaParts = [servingsMeta(recipe.yieldPortions)];
    if (time) metaParts.push(time);
    const source = recipeSourceHint(recipe.sourceUrl);
    if (source) metaParts.push(source);
    if (view.draft) metaParts.unshift("Draft");
    const more = detailMenu(view);
    const detail = detailBar({
        back: { href: "/recipes", label: "Back to recipes" },
        ...(more ? { trailing: { slot: more } } : { balance: true }),
    });
    const title = pageHeader({
        title: recipe.name,
        subtitle: metaParts.join(" · "),
    });
    const planned = plannedLine(view.planned);
    const pageError =
        view.error &&
        // A draft has no sheets to hold the error.
        (view.draft ||
            (!view.cook?.open && !view.plan?.open && !view.share?.open))
            ? `<p class="fd-recipe-error" role="alert">${esc(view.error)}</p>`
            : "";
    const header = join([
        detail,
        actionBar(view, recipe.id),
        raw(`<div class="fd-recipe-head">${String(title)}${planned}</div>`),
    ]);
    const left = raw(
        `${pageError}${view.draft ? draftCard(view.draft) : ""}${renderMentionCards(recipe.id, view.mentions)}${macrosBlock(view.macrosPerPortion, view.gapReasons, view.portionCount, perServingCaption(view), portionsFor(view))}${ingredientsSection(view)}`,
    );
    const right = raw(instructionsHtml(recipe.instructions, view.mentions));
    const layout = pageLayout({
        layout: "two-columns",
        className: "fd-recipe-layout",
        header,
        left,
        right,
    });
    return `<div class="fd-recipe-detail">
${String(layout)}
${view.cook && !view.draft ? renderCookSheet(view.cook) : ""}
${view.plan && !view.draft ? renderPlanSheet(view.plan) : ""}
${view.draft?.leaveGuard && view.draft.canDiscard ? leaveSheet(recipe.id, view.draft.expiresOn) : ""}
${
    view.share && !view.draft
        ? renderShareSheet({
              id: RECIPE_SHARE_SHEET_ID,
              action: `/recipes/${recipe.id}/share`,
              title: `Share ${recipe.name}`,
              what: "recipe",
              open: view.share.open,
              error: view.share.open ? view.error : undefined,
          })
        : ""
}
</div>`;
}

export function renderRecipeDetailV2Page(view: RecipeDetailV2View): string {
    return renderAppShell({
        ...view.chrome,
        title: view.recipe.name,
        active: "recipes",
        body: renderRecipeDetailBody(view),
    });
}
