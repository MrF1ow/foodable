import { formatQuantityDisplayParts } from "../display-quantity.js";
import {
    recipeSteps,
    type Recipe,
    type RecipeIngredientView,
    type RecipeMacros,
    type RecipeVerification,
} from "../../domain/recipes.js";
import type { Notice } from "../../domain/notices.js";
import type {
    RecipeImport,
    RecipeProblem,
} from "../../domain/recipe-import.js";
import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { renderFoodPicker } from "../components/food-picker.js";
import { renderQuantityField } from "../components/quantity-field.js";
import { renderMemberMultiSelect } from "../components/member-multi-select.js";
import {
    renderRecipeCard,
    renderRecipeIngredientRow,
} from "../components/page-markup.js";
import { sharedDialogItem } from "../components/shared-dialog.js";
import {
    renderLinkProductPrompt,
    type LinkProductPromptView,
} from "../components/link-product-prompt.js";
import {
    confirmModal,
    disclosure,
    emptyState,
    errorBanner,
    errorBannerWithLink,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    panel,
    type ModalFill,
    field,
} from "../components/ui.js";
import {
    noticeAction,
    noticeList,
    type NoticeRouteContext,
} from "../components/notices.js";
import { sourceIcon } from "../components/source-icon.js";
import {
    recipeDisplaySource,
    type RecipeSourceKind,
} from "../../domain/recipe-import.js";
import type { ReadShareResult } from "../../domain/share.js";
import { shareArrivedDisclosure } from "../components/share-arrived.js";

export type RecipeMember = { userId: string; displayName: string };
export type RecipeStoreOption = { id: string; name: string };

export type RecipesPageFilter = {
    tag: string;
    canMakeNow: boolean;
    safeFor: string;
    verification: "" | RecipeVerification;
};

export function recipesListHref(
    verification: "" | RecipeVerification,
    filter: RecipesPageFilter,
): string {
    const params = new URLSearchParams();
    if (filter.tag.trim()) params.set("tag", filter.tag.trim());
    if (filter.canMakeNow) params.set("can_make_now", "1");
    if (filter.safeFor) params.set("safe_for", filter.safeFor);
    if (verification) params.set("verification", verification);
    const query = params.toString();
    return query ? `/recipes?${query}` : "/recipes";
}

export type RecipeListImportRow = {
    recipeId: string;
    sourceKind: RecipeImport["sourceKind"];
    sourceUrl: string | null;
};

export type RecipesPageView = {
    chrome: ViewerChrome;
    recipes: Recipe[];
    members: RecipeMember[];
    viewerId: string;
    filter?: RecipesPageFilter;
    error?: string;
    openModalId?: string;
    importByRecipeId?: Record<string, RecipeListImportRow>;
    importUrl?: string;
    importError?: string;
    importDuplicateRecipeId?: string;
    importPasteStep?: boolean;
    importPasteText?: string;
    importCredit?: string;
    importWebsiteError?: string;
    importSourceKind?: RecipeSourceKind;
    importSourceLabel?: string;
    importTextOrigin?: "shared" | "pasted";
    importTextOnly?: boolean;
    /** Memory short-circuit: show Check again above paste step */
    importShowRetry?: boolean;
    importRetryDisabled?: boolean;
    shareArrived?: ReadShareResult;
    shareArrivedOpen?: boolean;
};

export type RecipeIngredientRow = RecipeIngredientView & {
    defaultUnit?: string;
};

export type RecipeDetailView = {
    chrome: ViewerChrome;
    recipe: Recipe;
    ingredients: RecipeIngredientRow[];
    notices: Notice[];
    noticeContext: NoticeRouteContext;
    members: RecipeMember[];
    stores: RecipeStoreOption[];
    viewerId: string;
    filterUserId: string;
    portionCount: number;
    macros: RecipeMacros;
    macrosPerPortion?: RecipeMacros;
    allergenNotices?: Notice[];
    dislikeNote?: string;
    isOwner: boolean;
    error?: string;
    openModalId?: string;
    linkProductPrompt?: LinkProductPromptView | null;
    problems?: RecipeProblem[];
    importRow?: RecipeImport | null;
};

const NEW_RECIPE_MODAL_ID = "recipe-new";
export const IMPORT_RECIPE_MODAL_ID = "recipe-import-url";

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

function ingredientAmountLabel(
    quantity: RecipeIngredientView["quantity"],
    note: string | null,
): string {
    if (quantity == null) return note?.trim() || "to taste";
    return quantityLabel(quantity.amount, quantity.unit);
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
            ing_amount:
                ingredient.quantity == null
                    ? ""
                    : String(ingredient.quantity.amount),
            ing_unit:
                ingredient.quantity?.unit ??
                (ingredient as RecipeIngredientRow).defaultUnit ??
                "g",
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
        verification: "",
    };
    const error = pageLevelErrorBanner(view, [NEW_RECIPE_MODAL_ID]);
    const empty =
        view.recipes.length === 0
            ? emptyState("Add a recipe.", "empty-recipes")
            : "";
    const cards = view.recipes
        .map((recipe) => {
            const imp = view.importByRecipeId?.[recipe.id];
            const display = recipeDisplaySource(
                recipe,
                imp
                    ? {
                          sourceKind: imp.sourceKind,
                          sourceUrl: imp.sourceUrl,
                      }
                    : null,
            );
            return renderRecipeCard({
                id: recipe.id,
                name: recipe.name,
                yieldPortions: recipe.yieldPortions,
                tags: recipe.tags,
                verification: recipe.verification,
                sourceIconHtml: display
                    ? sourceIcon(display.kind, { label: display.label })
                    : undefined,
            });
        })
        .join("");
    const memberOptions = [
        `<option value="">Anyone</option>`,
        ...view.members.map((member) => {
            const sel = member.userId === filter.safeFor ? " selected" : "";
            return `<option value="${escapeHtml(member.userId)}"${sel}>${escapeHtml(member.displayName)}</option>`;
        }),
    ].join("");
    const filtering =
        filter.tag !== "" ||
        filter.canMakeNow ||
        filter.safeFor !== "" ||
        filter.verification !== "";
    const verificationSeg = (value: "" | RecipeVerification, label: string) => {
        const href = recipesListHref(value, filter);
        // Links, not tabs: the current filter is aria-current, styled by the
        // shared .seg-btn.active rule.
        return filter.verification === value
            ? `<a class="seg-btn active" href="${href}" aria-current="page">${escapeHtml(label)}</a>`
            : `<a class="seg-btn" href="${href}">${escapeHtml(label)}</a>`;
    };
    const verificationField =
        filter.verification === ""
            ? ""
            : `<input type="hidden" name="verification" value="${escapeHtml(filter.verification)}" />`;
    const list =
        view.recipes.length === 0
            ? ""
            : panel({
                  body: `<ul class="recipe-list list">${cards}</ul>`,
              });
    const importUrlValue = escapeHtml(view.importUrl ?? "");
    const importPasteTextValue = escapeHtml(view.importPasteText ?? "");
    const importCreditValue = escapeHtml(view.importCredit ?? "");
    const importDuplicateBanner =
        view.importDuplicateRecipeId != null
            ? errorBannerWithLink(
                  "You already imported this.",
                  `/recipes/${view.importDuplicateRecipeId}`,
                  "Open it",
              )
            : "";
    const importErrorBanner =
        view.importError && !view.importDuplicateRecipeId
            ? errorBanner(view.importError)
            : "";
    const importTextOriginHidden =
        view.importTextOrigin === "shared"
            ? `<input type="hidden" name="text_origin" value="shared" />`
            : "";
    const importRetryForm = view.importShowRetry
        ? `<form class="recipe-import-retry-form" method="post" action="/recipes/import">
<input type="hidden" name="url" value="${importUrlValue}" />
${view.importPasteStep ? `<input type="hidden" name="import_step" value="paste" />` : ""}
${view.importTextOrigin === "shared" ? `<input type="hidden" name="text_origin" value="shared" />` : ""}
<p class="recipe-import-retry"><button type="submit" name="retry" value="1" formnovalidate${view.importRetryDisabled ? " disabled" : ""}>Check again</button></p>
</form>`
        : "";
    const importPasteBody = view.importPasteStep
        ? (() => {
              if (view.importTextOnly) {
                  return `<form class="recipe-import-paste" method="post" action="/recipes/import" data-busy-form>
<input type="hidden" name="import_step" value="paste" />
<input type="hidden" name="text_only" value="1" />
${importTextOriginHidden}
${field({
    id: "import-url-optional",
    label: "Recipe link",
    control: `<input id="import-url-optional" name="url" type="text" inputmode="url" autocapitalize="off" spellcheck="false" autocomplete="off" placeholder="https://… (optional)" />`,
})}
${field({
    id: "import-text",
    label: "Recipe text",
    control: `<textarea id="import-text" name="text" rows="10" required>${importPasteTextValue}</textarea>`,
})}
<button type="submit" class="btn-primary" data-busy-label="Importing…">Import</button>
</form>${importRetryForm}`;
              }
              const kind = view.importSourceKind ?? "website";
              const label = escapeHtml(view.importSourceLabel ?? "Link");
              const openLabel =
                  kind === "website" ? "Open the page" : "Open the post";
              const textLabel =
                  kind === "website" ? "Paste the recipe" : "Paste the caption";
              const creditField =
                  kind === "website"
                      ? ""
                      : field({
                            id: "import-credit",
                            label: "Creator",
                            control: `<input id="import-credit" name="credit" type="text" maxlength="120" autocomplete="off" value="${importCreditValue}" />`,
                        });
              const websiteError = view.importWebsiteError
                  ? `<span class="field-error">${escapeHtml(view.importWebsiteError)}</span>`
                  : "";
              const pinterestFields =
                  kind === "pinterest"
                      ? `${field({
                            id: "import-website-url",
                            label: "Recipe website link",
                            control: `<input id="import-website-url" name="website_url" type="text" inputmode="url" autocapitalize="off" spellcheck="false" autocomplete="off" placeholder="https://…" />${websiteError}`,
                        })}<p class="muted recipe-import-pin-hint">Pins usually lead to the recipe's website. Paste that link here.</p><h3 class="recipe-import-or">Or paste the recipe</h3>`
                      : "";
              const textRequired = kind === "pinterest" ? "" : " required";
              return `<form class="recipe-import-paste" method="post" action="/recipes/import" data-busy-form>
<input type="hidden" name="import_step" value="paste" />
<input type="hidden" name="url" value="${importUrlValue}" />
${importTextOriginHidden}
<p class="recipe-import-source">${sourceIcon(kind, { label, decorative: true })} ${label}</p>
<p class="recipe-import-open"><a href="${importUrlValue}" target="_blank" rel="noopener noreferrer">${escapeHtml(openLabel)}</a></p>
${pinterestFields}
${field({
    id: "import-text",
    label: textLabel,
    control: `<textarea id="import-text" name="text" rows="10"${textRequired}>${importPasteTextValue}</textarea>`,
})}
${creditField}
<button type="submit" class="btn-primary" data-busy-label="Importing…">Import</button>
</form>${importRetryForm}`;
          })()
        : `<form class="recipe-import-url" method="post" action="/recipes/import" data-busy-form>
                ${field({ id: "import-url", label: "Recipe link", control: `<input id="import-url" name="url" type="text" inputmode="url" autocapitalize="off" spellcheck="false" autocomplete="off" required placeholder="https://…" value="${importUrlValue}" />` })}
                <button type="submit" class="btn-primary" data-busy-label="Importing…">Import</button>
            </form>${importRetryForm}`;
    const importModal = modal({
        id: IMPORT_RECIPE_MODAL_ID,
        title: "Import from link",
        openOnLoad: modalOpen(view, IMPORT_RECIPE_MODAL_ID),
        body: `${importDuplicateBanner}${importErrorBanner}${importPasteBody}`,
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
            titleActions: `${modalTrigger({
                target: IMPORT_RECIPE_MODAL_ID,
                label: "Import from link",
                className: "btn-sm",
            })}
${modalTrigger({
    target: NEW_RECIPE_MODAL_ID,
    label: "New recipe",
    className: "btn-sm btn-primary",
})}`,
        })}
        ${error}
        <nav class="seg recipe-verification-filter" aria-label="Verification">
            ${verificationSeg("", "All")}
            ${verificationSeg("verified", "Verified")}
            ${verificationSeg("unverified", "Unverified")}
        </nav>
        ${disclosure({
            summary: "Filter",
            open: filtering,
            body: `<form class="recipe-list-filters" method="get" action="/recipes">
                ${verificationField}
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
        ${
            view.shareArrived
                ? shareArrivedDisclosure(view.shareArrived, {
                      open: view.shareArrivedOpen === true,
                  })
                : ""
        }
        ${importModal}
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
    ingredient: RecipeIngredientRow,
): string {
    const showPersonPortion =
        ingredient.quantity != null &&
        (view.portionCount !== 1 ||
            ingredient.personAmount !== ingredient.perPortionAmount);
    const noNutrition = view.notices.find(
        (n) =>
            n.code === "recipe.no_nutrition" &&
            n.subject.kind === "recipe_ingredient" &&
            n.subject.id === ingredient.id,
    );
    const usualProductActionHtml = noNutrition
        ? noticeAction(noNutrition, view.noticeContext)
        : "";
    return renderRecipeIngredientRow({
        id: ingredient.id,
        recipeId: view.recipe.id,
        displayName: ingredient.displayName,
        totalLabel: ingredientAmountLabel(ingredient.quantity, ingredient.note),
        perPortionLabel:
            ingredient.quantity == null
                ? ingredientAmountLabel(null, ingredient.note)
                : quantityLabel(
                      ingredient.perPortionAmount!,
                      ingredient.quantity.unit,
                  ),
        personPortionLabel: showPersonPortion
            ? ingredient.personAmount == null
                ? ingredientAmountLabel(null, ingredient.note)
                : quantityLabel(
                      ingredient.personAmount,
                      ingredient.quantity!.unit,
                  )
            : null,
        perPortionAmount: ingredient.perPortionAmount,
        personAmount: ingredient.personAmount,
        totalAmount: ingredient.quantity?.amount ?? null,
        note: ingredient.note,
        editModalId: RECIPE_EDIT_INGREDIENT_ID,
        deleteModalId: RECIPE_DELETE_INGREDIENT_ID,
        editFill: ingredientFill(view, ingredient, "edit"),
        deleteFill: ingredientFill(view, ingredient, "delete"),
        usualProductActionHtml,
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
${renderQuantityField({ kind: "food", namePrefix: "ing", idPrefix: "recipe-ingredient", amount: editItem?.quantity?.amount, unit: editItem?.quantity?.unit ?? (editItem as RecipeIngredientRow | null)?.defaultUnit ?? "g" })}
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
    view: RecipeDetailView,
    macros: RecipeMacros,
    scope: "portion" | "person",
): string {
    const label = scope === "portion" ? "Per portion" : "This portion";
    const reasons =
        macros.incompleteReasons.length > 0
            ? noticeList(view.notices, {
                  className: "recipe-macros-reasons",
              })
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
    const displaySource = recipeDisplaySource(
        view.recipe,
        view.importRow ?? null,
    );
    const sourceLine = displaySource
        ? `<p class="recipe-source-line muted"><a href="${escapeHtml(displaySource.url)}" target="_blank" rel="noopener noreferrer">${sourceIcon(displaySource.kind, { label: displaySource.label, decorative: true })} ${escapeHtml(displaySource.label)}</a>${view.importRow?.credit ? ` · by ${escapeHtml(view.importRow.credit)}` : ""}</p>`
        : "";
    const error = pageLevelErrorBanner(view, renderedModalIds);
    const allergen = noticeList(view.allergenNotices ?? [], {
        className: "allergen-warning",
    });
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
    const unverified = view.recipe.verification === "unverified";
    const blockedNote =
        '<p class="muted">This recipe is unverified. Fix the problems, then check again.</p>';
    const grocery =
        view.stores.length === 0
            ? emptyState(
                  "Add a grocery store under Household, then add this recipe to the list.",
                  "empty-recipe-store",
              )
            : unverified
              ? blockedNote
              : `<form class="recipe-add-grocery" method="post" action="/recipes/${escapeHtml(view.recipe.id)}/add-to-grocery">
${renderMemberMultiSelect(view.members, [view.viewerId])}
${field({ id: "recipe-store", label: "Store", control: `<select id="recipe-store" name="store_id" required>${storeOptions}</select>` })}
${field({ id: "recipe-total-portions", label: "Total portions", control: `<input id="recipe-total-portions" name="total_portions" type="number" min="0" step="any" placeholder="${escapeHtml(String(view.recipe.yieldPortions))} for the whole recipe" />` })}
<p class="muted">Leave blank to shop for the people above. Enter more for a whole batch or leftovers.</p>
<button type="submit" class="btn-primary">Add to grocery</button>
</form>`;
    const recipeIdEsc = escapeHtml(recipeId);
    const personMacros =
        view.portionCount === 1 ? "" : macrosBlock(view, view.macros, "person");
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
                optionalQuantity: true,
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
        unverified
            ? ""
            : `<div class="row-actions">
${modalTrigger({
    target: cookId,
    label: "Cooked it",
    className: "btn-sm",
})}
</div>`,
    );

    const problems = view.problems ?? [];
    const problemList =
        problems.length === 0
            ? ""
            : `<ul class="list">${problems
                  .map((p) => `<li>${escapeHtml(p.message)}</li>`)
                  .join("")}</ul>`;
    const textSummary =
        view.importRow?.sourceTextOrigin === "read"
            ? "Caption"
            : view.importRow?.sourceTextOrigin === "shared"
              ? "Shared text"
              : "Pasted text";
    const pastedText =
        (view.importRow?.sourceText != null
            ? disclosure({
                  summary: textSummary,
                  body: `<pre class="recipe-import-text">${escapeHtml(view.importRow.sourceText)}</pre>`,
              })
            : "") +
        (view.importRow?.transcript
            ? disclosure({
                  summary: "Spoken transcript",
                  body: `<pre class="recipe-import-text">${escapeHtml(view.importRow.transcript)}</pre>`,
              })
            : "");
    const unresolved =
        view.importRow && view.importRow.unresolvedLines.length > 0
            ? `<ul class="list">${view.importRow.unresolvedLines
                  .map((line) => `<li>${escapeHtml(line)}</li>`)
                  .join("")}</ul>`
            : "";
    const unverifiedPanel = unverified
        ? panel({
              title: "Unverified",
              body: `${problemList}${pastedText}${unresolved}<form method="post" action="/recipes/${recipeIdEsc}/verify"><button type="submit" class="btn-primary">Check again</button></form>`,
          })
        : "";

    const body = `
        <p class="recipe-back"><a href="/recipes">← Recipes</a></p>
        ${pageHeader({
            title: view.recipe.name,
            actions: headerActions,
        })}
        ${error}
        ${unverifiedPanel}
        ${allergen}
        ${dislike}
        ${sourceLine}
        <p class="recipe-yield muted" data-yield="${escapeHtml(String(view.recipe.yieldPortions))}">Yield ${escapeHtml(String(view.recipe.yieldPortions))}</p>
        ${panel({
            title: "Nutrition",
            body: `<form class="recipe-filter inline-form" method="get" action="/recipes/${recipeIdEsc}" data-filter-member="${escapeHtml(view.filterUserId)}">
                ${field({ id: "recipe-member", label: "Filter by person", control: `<select id="recipe-member" name="member">${memberOptions}</select>` })}
                <button type="submit">View</button>
            </form>
            ${portion}
            ${macrosBlock(view, perPortion, "portion")}
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
${
    unverified
        ? blockedNote
        : `<form class="recipe-log-portion field-grid" method="post" action="/recipes/${recipeIdEsc}/log-portion">
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
            </form>`
}
</section>
        ${panel({
            title: "Groceries",
            body: grocery,
        })}
        ${pageModals}
        ${ingredientModals}
        ${renderLinkProductPrompt(view.linkProductPrompt ?? null)}
    `;
    return renderAppShell({
        title: view.recipe.name,
        active: "recipes",
        theme: view.chrome.theme,
        body,
    });
}
