import { formatQuantityDisplayParts } from "../display-quantity.js";
import {
    recipeSteps,
    type Recipe,
    type RecipeIngredientView,
    type RecipeMacros,
} from "../../domain/recipes.js";
import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { renderFoodPicker } from "../components/food-picker.js";
import { renderMemberMultiSelect } from "../components/member-multi-select.js";
import {
    renderRecipeCard,
    renderRecipeIngredientRow,
} from "../components/page-markup.js";
import { sharedDialogItem } from "../components/shared-dialog.js";
import {
    confirmModal,
    disclosure,
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    panel,
    type ModalFill,
    field,
} from "../components/ui.js";

export type RecipeMember = { userId: string; displayName: string };
export type RecipeStoreOption = { id: string; name: string };

export type RecipesPageFilter = {
    tag: string;
    canMakeNow: boolean;
    safeFor: string;
};

export type RecipesPageView = {
    chrome: ViewerChrome;
    recipes: Recipe[];
    members: RecipeMember[];
    viewerId: string;
    filter?: RecipesPageFilter;
    error?: string;
    openModalId?: string;
};

export type RecipeDetailView = {
    chrome: ViewerChrome;
    recipe: Recipe;
    ingredients: RecipeIngredientView[];
    members: RecipeMember[];
    stores: RecipeStoreOption[];
    viewerId: string;
    filterUserId: string;
    portionCount: number;
    macros: RecipeMacros;
    macrosPerPortion?: RecipeMacros;
    allergenWarning?: string;
    dislikeNote?: string;
    isOwner: boolean;
    error?: string;
    openModalId?: string;
};

const NEW_RECIPE_MODAL_ID = "recipe-new";

function modalOpen(view: { openModalId?: string }, id: string): boolean {
    return view.openModalId === id;
}

function modalFormError(
    view: { error?: string; openModalId?: string },
    modalId: string,
): string {
    if (view.error && view.openModalId === modalId) {
        return errorBanner(view.error);
    }
    return "";
}

function quantityLabel(amount: number, unit: string): string {
    return formatQuantityDisplayParts(amount, unit);
}

function editRecipeModalId(recipeId: string): string {
    return `recipe-edit-${recipeId}`;
}

function deleteRecipeModalId(recipeId: string): string {
    return `recipe-delete-${recipeId}`;
}

function addIngredientModalId(recipeId: string): string {
    return `recipe-add-ingredient-${recipeId}`;
}

function methodModalId(recipeId: string): string {
    return `recipe-method-${recipeId}`;
}

function cookModalId(recipeId: string): string {
    return `recipe-cook-${recipeId}`;
}

const RECIPE_EDIT_INGREDIENT_ID = "recipe-edit-ingredient";
const RECIPE_DELETE_INGREDIENT_ID = "recipe-delete-ingredient";
const EDIT_INGREDIENT_PREFIX = "recipe-edit-ingredient-";
const DELETE_INGREDIENT_PREFIX = "recipe-delete-ingredient-";

function reopenIngredient(
    view: RecipeDetailView,
    prefix: string,
): RecipeIngredientView | null {
    return (
        sharedDialogItem({
            openModalId: view.openModalId,
            prefix,
            lookup: (id) =>
                view.ingredients.find((ingredient) => ingredient.id === id) ??
                null,
        })?.item ?? null
    );
}

function ingredientFill(
    view: RecipeDetailView,
    ingredient: RecipeIngredientView,
    mode: "edit" | "delete",
): ModalFill {
    const recipeId = view.recipe.id;
    if (mode === "delete") {
        return {
            action: `/recipes/${recipeId}/ingredients/${ingredient.id}/delete`,
            message: `Remove ${ingredient.displayName} from this recipe?`,
        };
    }
    return {
        action: `/recipes/${recipeId}/ingredients/${ingredient.id}`,
        title: `Edit ${ingredient.displayName}`,
        fields: {
            note: ingredient.note ?? "",
            amount: ingredient.quantity.amount,
        },
    };
}

function panelHead(title: string, actions: string): string {
    return `<div class="recipe-panel-head row">
<h2 class="row-title">${escapeHtml(title)}</h2>
${actions}
</div>`;
}

export function renderRecipesPage(view: RecipesPageView): string {
    const filter = view.filter ?? {
        tag: "",
        canMakeNow: false,
        safeFor: "",
    };
    const error = pageLevelErrorBanner(view, [NEW_RECIPE_MODAL_ID]);
    const empty =
        view.recipes.length === 0
            ? emptyState("Add a recipe.", "empty-recipes")
            : "";
    const cards = view.recipes
        .map((recipe) =>
            renderRecipeCard({
                id: recipe.id,
                name: recipe.name,
                yieldPortions: recipe.yieldPortions,
                tags: recipe.tags,
            }),
        )
        .join("");
    const memberOptions = [
        `<option value="">Anyone</option>`,
        ...view.members.map((member) => {
            const sel = member.userId === filter.safeFor ? " selected" : "";
            return `<option value="${escapeHtml(member.userId)}"${sel}>${escapeHtml(member.displayName)}</option>`;
        }),
    ].join("");
    const filtering =
        filter.tag !== "" || filter.canMakeNow || filter.safeFor !== "";
    const list =
        view.recipes.length === 0
            ? ""
            : panel({
                  body: `<ul class="recipe-list list">${cards}</ul>`,
              });
    const newRecipeModal = modal({
        id: NEW_RECIPE_MODAL_ID,
        title: "New recipe",
        openOnLoad: modalOpen(view, NEW_RECIPE_MODAL_ID),
        body: `${modalFormError(view, NEW_RECIPE_MODAL_ID)}<form class="recipe-create" method="post" action="/recipes">
                ${field({ id: "recipe-name", label: "Name", control: `<input id="recipe-name" name="name" type="text" required maxlength="80" autocomplete="off" />` })}
                ${field({ id: "recipe-yield", label: "Yield", control: `<input id="recipe-yield" name="yield_portions" type="number" min="0" step="any" required value="4" />` })}
                <button type="submit" class="btn-primary">Create recipe</button>
            </form>`,
    });
    const body = `
        ${pageHeader({
            title: "Recipes",
            titleActions: modalTrigger({
                target: NEW_RECIPE_MODAL_ID,
                label: "New recipe",
                className: "btn-sm btn-primary",
            }),
        })}
        ${error}
        ${disclosure({
            summary: "Filter",
            open: filtering,
            body: `<form class="recipe-list-filters" method="get" action="/recipes">
                ${field({ id: "recipe-tag", label: "Tag", control: `<input id="recipe-tag" name="tag" type="text" value="${escapeHtml(filter.tag)}" autocomplete="off" />` })}
                <label class="recipe-filter-check">
                    <input type="checkbox" name="can_make_now" value="1"${filter.canMakeNow ? " checked" : ""} />
                    Can make now
                </label>
                ${field({ id: "recipe-safe-for", label: "Safe for", control: `<select id="recipe-safe-for" name="safe_for">${memberOptions}</select>` })}
                <button type="submit" class="btn-primary">Filter</button>
            </form>`,
        })}
        ${empty}
        ${list}
        ${newRecipeModal}
    `;
    return renderAppShell({
        title: "Recipes",
        active: "recipes",
        theme: view.chrome.theme,
        body,
    });
}

function ingredientRow(
    view: RecipeDetailView,
    ingredient: RecipeIngredientView,
): string {
    const unit = ingredient.quantity.unit;
    const showPersonPortion =
        view.portionCount !== 1 ||
        ingredient.personAmount !== ingredient.perPortionAmount;
    return renderRecipeIngredientRow({
        id: ingredient.id,
        recipeId: view.recipe.id,
        displayName: ingredient.displayName,
        totalLabel: quantityLabel(ingredient.quantity.amount, unit),
        perPortionLabel: quantityLabel(ingredient.perPortionAmount, unit),
        personPortionLabel: showPersonPortion
            ? quantityLabel(ingredient.personAmount, unit)
            : null,
        perPortionAmount: ingredient.perPortionAmount,
        personAmount: ingredient.personAmount,
        totalAmount: ingredient.quantity.amount,
        note: ingredient.note,
        editModalId: RECIPE_EDIT_INGREDIENT_ID,
        deleteModalId: RECIPE_DELETE_INGREDIENT_ID,
        editFill: ingredientFill(view, ingredient, "edit"),
        deleteFill: ingredientFill(view, ingredient, "delete"),
    });
}

function sharedIngredientModals(view: RecipeDetailView): string {
    if (view.ingredients.length === 0) return "";
    const editItem = reopenIngredient(view, EDIT_INGREDIENT_PREFIX);
    const deleteItem = reopenIngredient(view, DELETE_INGREDIENT_PREFIX);
    const editOpen =
        editItem != null &&
        modalOpen(view, `${EDIT_INGREDIENT_PREFIX}${editItem.id}`);
    const deleteOpen =
        deleteItem != null &&
        modalOpen(view, `${DELETE_INGREDIENT_PREFIX}${deleteItem.id}`);
    const recipeId = escapeHtml(view.recipe.id);
    const editId = editItem ? escapeHtml(editItem.id) : "";
    return (
        modal({
            id: RECIPE_EDIT_INGREDIENT_ID,
            title: editItem
                ? `Edit ${editItem.displayName}`
                : "Edit ingredient",
            openOnLoad: editOpen,
            submitDisabled: editItem == null,
            body: `${editOpen ? modalFormError(view, `${EDIT_INGREDIENT_PREFIX}${editItem?.id}`) : ""}<form class="recipe-ingredient-edit" method="post" action="${editItem ? `/recipes/${recipeId}/ingredients/${editId}` : ""}">
${field({ id: "recipe-ingredient-note", label: "Note", control: `<input id="recipe-ingredient-note" name="note" type="text" maxlength="500" value="${escapeHtml(editItem?.note ?? "")}" autocomplete="off" />` })}
${field({ id: "recipe-ingredient-amount", label: "Amount", control: `<input id="recipe-ingredient-amount" name="amount" type="number" min="0" step="any" required value="${editItem ? escapeHtml(String(editItem.quantity.amount)) : ""}" />` })}
<button type="submit" class="btn-primary">Save ingredient</button>
</form>`,
        }) +
        confirmModal({
            id: RECIPE_DELETE_INGREDIENT_ID,
            title: "Remove ingredient",
            message: deleteItem
                ? `Remove ${deleteItem.displayName} from this recipe?`
                : "Remove this ingredient from this recipe?",
            action: deleteItem
                ? `/recipes/${view.recipe.id}/ingredients/${deleteItem.id}/delete`
                : "",
            confirmLabel: "Remove",
            openOnLoad: deleteOpen,
            bodyPrefix: deleteOpen
                ? modalFormError(
                      view,
                      `${DELETE_INGREDIENT_PREFIX}${deleteItem?.id}`,
                  )
                : "",
            submitDisabled: deleteItem == null,
        })
    );
}

function macrosBlock(
    macros: RecipeMacros,
    scope: "portion" | "person",
): string {
    const label = scope === "portion" ? "Per portion" : "This portion";
    const reasons =
        macros.incompleteReasons.length > 0
            ? `<ul class="recipe-macros-reasons">${macros.incompleteReasons
                  .map((reason) => `<li>${escapeHtml(reason)}</li>`)
                  .join("")}</ul>`
            : "";
    if (macros.incomplete && macros.calories == null) {
        return `<p class="recipe-macros" data-scope="${scope}" data-incomplete="true">${escapeHtml(label)}: Macros incomplete</p>${reasons}`;
    }
    const incomplete = macros.incomplete
        ? `<p class="recipe-macros-incomplete">${escapeHtml(label)}: Macros incomplete</p>`
        : "";
    return `<p class="recipe-macros" data-scope="${scope}" data-incomplete="${macros.incomplete ? "true" : "false"}" data-calories="${escapeHtml(String(macros.calories ?? ""))}" data-protein="${escapeHtml(String(macros.protein_g ?? ""))}">${escapeHtml(label)}: Calories ${escapeHtml(String(macros.calories ?? "—"))} · Protein ${escapeHtml(String(macros.protein_g ?? "—"))} g · Carbs ${escapeHtml(String(macros.carbs_g ?? "—"))} g · Fat ${escapeHtml(String(macros.fat_g ?? "—"))} g</p>${incomplete}${reasons}`;
}

export function renderRecipeDetailPage(view: RecipeDetailView): string {
    const recipeId = view.recipe.id;
    const editIngredient = reopenIngredient(view, EDIT_INGREDIENT_PREFIX);
    const deleteIngredient = reopenIngredient(view, DELETE_INGREDIENT_PREFIX);
    const renderedModalIds = [
        editRecipeModalId(recipeId),
        deleteRecipeModalId(recipeId),
        addIngredientModalId(recipeId),
        methodModalId(recipeId),
        cookModalId(recipeId),
        ...(editIngredient && view.error
            ? [`${EDIT_INGREDIENT_PREFIX}${editIngredient.id}`]
            : []),
        ...(deleteIngredient && view.error
            ? [`${DELETE_INGREDIENT_PREFIX}${deleteIngredient.id}`]
            : []),
    ];
    const error = pageLevelErrorBanner(view, renderedModalIds);
    const allergen = view.allergenWarning
        ? `<p class="allergen-warning" data-blocking="true">${escapeHtml(view.allergenWarning)}</p>`
        : "";
    const dislike = view.dislikeNote
        ? `<p class="dislike-note">${escapeHtml(view.dislikeNote)}</p>`
        : "";
    const rows = view.ingredients
        .map((ingredient) => ingredientRow(view, ingredient))
        .join("");
    const ingredientModals = sharedIngredientModals(view);
    const viewingSelf = view.filterUserId === view.viewerId;
    const memberOptions = view.members
        .map((member) => {
            const sel = member.userId === view.filterUserId ? " selected" : "";
            return `<option value="${escapeHtml(member.userId)}"${sel}>${escapeHtml(member.displayName)}</option>`;
        })
        .join("");
    const portion = viewingSelf
        ? `<form class="recipe-portion inline-form" method="post" action="/recipes/${escapeHtml(view.recipe.id)}/portions">
${field({ id: "portion-count", label: "Your portion", control: `<input id="portion-count" name="portion_count" type="number" min="0" step="any" required value="${escapeHtml(String(view.portionCount))}" />` })}
<button type="submit">Save</button>
</form>`
        : `<p class="person-portion muted" data-portion-count="${escapeHtml(String(view.portionCount))}" data-readonly="true">Portion ${escapeHtml(String(view.portionCount))}</p>`;
    const storeOptions = view.stores
        .map(
            (store) =>
                `<option value="${escapeHtml(store.id)}">${escapeHtml(store.name)}</option>`,
        )
        .join("");
    const grocery =
        view.stores.length === 0
            ? emptyState(
                  "Add a grocery store in Settings, then add this recipe to the list.",
                  "empty-recipe-store",
              )
            : `<form class="recipe-add-grocery" method="post" action="/recipes/${escapeHtml(view.recipe.id)}/add-to-grocery">
${renderMemberMultiSelect(view.members, [view.viewerId])}
${field({ id: "recipe-store", label: "Store", control: `<select id="recipe-store" name="store_id" required>${storeOptions}</select>` })}
${field({ id: "recipe-total-portions", label: "Total portions", control: `<input id="recipe-total-portions" name="total_portions" type="number" min="0" step="any" placeholder="${escapeHtml(String(view.recipe.yieldPortions))} for the whole recipe" />` })}
<p class="muted">Leave blank to shop for the people above. Enter more for a whole batch or leftovers.</p>
<button type="submit" class="btn-primary">Add to grocery</button>
</form>`;
    const recipeIdEsc = escapeHtml(recipeId);
    const personMacros =
        view.portionCount === 1 ? "" : macrosBlock(view.macros, "person");
    const perPortion = view.macrosPerPortion ?? view.macros;
    const tagsValue = escapeHtml(view.recipe.tags.join(", "));

    const editId = editRecipeModalId(recipeId);
    const deleteId = deleteRecipeModalId(recipeId);
    const addIngredientId = addIngredientModalId(recipeId);
    const methodId = methodModalId(recipeId);
    const cookId = cookModalId(recipeId);
    const pickerId = `recipe-picker-${recipeId}`;

    const cookFormBody = `<form class="recipe-cook field-grid" method="post" action="/recipes/${recipeIdEsc}/cook">
                    ${view.members
                        .map((member) => {
                            const value =
                                member.userId === view.viewerId
                                    ? String(view.portionCount)
                                    : "1";
                            return `<label>${escapeHtml(member.displayName)}
<input id="cook-portion-${escapeHtml(member.userId)}" name="portion:${escapeHtml(member.userId)}" type="number" min="0" step="any" value="${escapeHtml(value)}" />
</label>`;
                        })
                        .join("")}
                    <label>Total portions
                        <input id="cook-total-portions" name="total_portions" type="number" min="0" step="any" placeholder="${escapeHtml(String(view.recipe.yieldPortions))} for the whole recipe" />
                    </label>
                    <label>Meal type
                        <select id="cook-meal-type" name="meal_type">
                            <option value="breakfast">Breakfast</option>
                            <option value="lunch">Lunch</option>
                            <option value="dinner" selected>Dinner</option>
                            <option value="snack">Snack</option>
                        </select>
                    </label>
                    <fieldset class="choice-row">
                        <legend>Also</legend>
                        <label><input type="checkbox" name="deduct_stock" value="1" checked /> Deduct stock</label>
                        <label><input type="checkbox" name="log_meals" value="1" checked /> Log meals</label>
                    </fieldset>
                    <button type="submit" class="btn-primary">Cooked it</button>
                </form>`;

    const pageModals =
        modal({
            id: editId,
            title: "Edit recipe",
            openOnLoad: modalOpen(view, editId),
            body: `${modalFormError(view, editId)}<form class="recipe-edit" method="post" action="/recipes/${recipeIdEsc}">
                ${field({ id: "edit-name", label: "Name", control: `<input id="edit-name" name="name" type="text" required maxlength="80" value="${escapeHtml(view.recipe.name)}" />` })}
                ${field({ id: "edit-yield", label: "Yield", control: `<input id="edit-yield" name="yield_portions" type="number" min="0" step="any" required value="${escapeHtml(String(view.recipe.yieldPortions))}" />` })}
                ${field({ id: "edit-source", label: "Source URL", control: `<input id="edit-source" name="source_url" type="text" value="${escapeHtml(view.recipe.sourceUrl ?? "")}" />` })}
                ${field({ id: "edit-tags", label: "Tags", control: `<input id="edit-tags" name="tags" type="text" value="${tagsValue}" placeholder="dinner, vegetarian" />` })}
                ${field({ id: "edit-prep", label: "Prep minutes", control: `<input id="edit-prep" name="prep_minutes" type="number" min="0" step="1" value="${escapeHtml(view.recipe.prepMinutes == null ? "" : String(view.recipe.prepMinutes))}" />` })}
                ${field({ id: "edit-cook", label: "Cook minutes", control: `<input id="edit-cook" name="cook_minutes" type="number" min="0" step="1" value="${escapeHtml(view.recipe.cookMinutes == null ? "" : String(view.recipe.cookMinutes))}" />` })}
                ${field({ id: "edit-notes", label: "Notes", control: `<textarea id="edit-notes" name="notes" rows="3">${escapeHtml(view.recipe.notes ?? "")}</textarea>` })}
                <button type="submit" class="btn-primary">Save recipe</button>
            </form>`,
        }) +
        confirmModal({
            id: deleteId,
            title: "Delete recipe",
            message: `Delete ${view.recipe.name}? This cannot be undone.`,
            action: `/recipes/${recipeId}/delete`,
            confirmLabel: "Delete recipe",
            openOnLoad: modalOpen(view, deleteId),
            bodyPrefix: modalFormError(view, deleteId),
        }) +
        modal({
            id: addIngredientId,
            title: "Add ingredient",
            openOnLoad: modalOpen(view, addIngredientId),
            body: `${modalFormError(view, addIngredientId)}${renderFoodPicker({
                id: pickerId,
                action: `/recipes/${recipeId}/ingredients`,
                method: "post",
                includeQuantity: true,
            })}`,
        }) +
        modal({
            id: methodId,
            title: "Method",
            openOnLoad: modalOpen(view, methodId),
            body: `${modalFormError(view, methodId)}<form class="recipe-method-form" method="post" action="/recipes/${recipeIdEsc}/instructions">
                ${field({ id: "method-instructions", label: "Steps", control: `<textarea id="method-instructions" name="instructions" rows="12" placeholder="Boil a large pot of salted water.\nCook the pasta until al dente.">${escapeHtml(view.recipe.instructions ?? "")}</textarea>` })}
                <p class="muted">One step per line. Leave a blank line between steps to write a step over several lines.</p>
                <button type="submit" class="btn-primary">Save steps</button>
            </form>`,
        }) +
        modal({
            id: cookId,
            title: "Cooked it",
            openOnLoad: modalOpen(view, cookId),
            body: `${modalFormError(view, cookId)}${cookFormBody}`,
        });

    const headerActions = [
        modalTrigger({
            target: editId,
            label: "Edit recipe",
            className: "btn-sm",
        }),
        modalTrigger({
            target: deleteId,
            label: "Delete recipe",
            className: "btn-sm btn-danger",
        }),
    ].join("\n");

    const ingredientsHead = panelHead(
        "Ingredients",
        `<div class="row-actions">
${modalTrigger({
    target: addIngredientId,
    label: "Add ingredient",
    className: "btn-sm",
})}
</div>`,
    );

    const steps = recipeSteps(view.recipe.instructions);
    const methodHead = panelHead(
        "Method",
        `<div class="row-actions">
${modalTrigger({
    target: methodId,
    label: steps.length === 0 ? "Add steps" : "Edit steps",
    className: "btn-sm",
})}
</div>`,
    );
    const methodBody =
        steps.length === 0
            ? emptyState("No steps yet.", "empty-recipe-steps")
            : `<ol class="recipe-steps">${steps
                  .map((step) => `<li>${escapeHtml(step)}</li>`)
                  .join("")}</ol>`;
    const notes = view.recipe.notes
        ? `<p class="recipe-notes muted">${escapeHtml(view.recipe.notes)}</p>`
        : "";

    const cookHead = panelHead(
        "Cook and log",
        `<div class="row-actions">
${modalTrigger({
    target: cookId,
    label: "Cooked it",
    className: "btn-sm",
})}
</div>`,
    );

    const body = `
        <p class="recipe-back"><a href="/recipes">← Recipes</a></p>
        ${pageHeader({
            title: view.recipe.name,
            actions: headerActions,
        })}
        ${error}
        ${allergen}
        ${dislike}
        <p class="recipe-yield muted" data-yield="${escapeHtml(String(view.recipe.yieldPortions))}">Yield ${escapeHtml(String(view.recipe.yieldPortions))}</p>
        ${panel({
            title: "Nutrition",
            body: `<form class="recipe-filter inline-form" method="get" action="/recipes/${recipeIdEsc}" data-filter-member="${escapeHtml(view.filterUserId)}">
                ${field({ id: "recipe-member", label: "Filter by person", control: `<select id="recipe-member" name="member">${memberOptions}</select>` })}
                <button type="submit">View</button>
            </form>
            ${portion}
            ${macrosBlock(perPortion, "portion")}
            ${personMacros}`,
        })}
        <section class="panel">
${ingredientsHead}
<ul class="recipe-ingredients list">${rows}</ul>
</section>
        <section class="panel recipe-method">
${methodHead}
${methodBody}
${notes}
</section>
        <section class="panel">
${cookHead}
<form class="recipe-log-portion field-grid" method="post" action="/recipes/${recipeIdEsc}/log-portion">
                <label>Portions
                    <input id="log-portion-count" name="portions" type="number" min="0" step="any" required value="${escapeHtml(String(view.portionCount))}" />
                </label>
                <label>Meal type
                    <select id="log-portion-type" name="meal_type">
                        <option value="breakfast">Breakfast</option>
                        <option value="lunch">Lunch</option>
                        <option value="dinner">Dinner</option>
                        <option value="snack" selected>Snack</option>
                    </select>
                </label>
                <button type="submit" class="btn-primary">Log a portion</button>
            </form>
</section>
        ${panel({
            title: "Groceries",
            body: grocery,
        })}
        ${pageModals}
        ${ingredientModals}
    `;
    return renderAppShell({
        title: view.recipe.name,
        active: "recipes",
        theme: view.chrome.theme,
        body,
    });
}
