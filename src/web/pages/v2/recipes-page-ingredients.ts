/**
 * The recipe page's ingredient editing: a row opens its edit sheet (amount,
 * unit, note, food, remove), Add ingredient opens another, an unreadable import
 * line gets a row of its own with Resolve and Drop, and an ingredient with a
 * problem draws a warning icon that opens what is wrong and a link to its
 * food. Every sheet is built from the `fd-` components; the routes behind them
 * are the web twin of the agent's `update_recipe_ingredient`,
 * `remove_recipe_ingredient` and `add_recipe_ingredient`.
 *
 * A row opens its sheet by the shared `[data-fd-open-item]` hook (`kitchen.js`)
 * and is a link to this page with the sheet open on load, so it works with no
 * script. Only the base's own lines are editable: a version's lines carry its
 * own changes (`view.editable` is off there).
 */
import { FOOD_QUANTITY_UNITS } from "../../../domain/quantity.js";
import type { RecipeGap, RecipeIngredient } from "../../../domain/recipes.js";
import { quantityUnitOptionLabel } from "../../display-quantity.js";
import {
    renderDidYouMeanBlock,
    type DidYouMeanModal,
} from "../../components/did-you-mean.js";
import { button } from "../../components/v2/button.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, menuRow, type MenuItem } from "../../components/v2/menu.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { stepperControl } from "../../components/v2/stepper-control.js";
import { APP_PATHS } from "../../route-map.js";

export const INGREDIENT_ADD_SHEET_ID = "fd-recipe-add-ingredient";
export const ingredientSheetId = (ingredientId: string): string =>
    `fd-recipe-ing-${ingredientId}`;
export const warnSheetId = (ingredientId: string): string =>
    `fd-recipe-warn-${ingredientId}`;
export const resolveSheetId = (index: number): string =>
    `fd-recipe-line-${index}`;

/** One thing the check found on a draft; a line or an ingredient when it has one. */
export type RecipeLineProblem = {
    message: string;
    ingredientId: string | null;
    line: string | null;
};

/** The ingredient sheet that is open on load, and what it says. */
export type RecipeIngredientEditState = {
    /** The sheet's id: an ingredient's, the add sheet's or a line's. */
    open: string;
    error?: string;
    /** What was posted (`amount`, `unit`, `note`, `food_name`), shown again. */
    typed?: Readonly<Record<string, string>>;
    /** The similar-foods question the sheet asks. */
    didYouMean?: DidYouMeanModal;
};

/** What an editable ingredient row needs beyond its words. */
export type EditableIngredient = Pick<
    RecipeIngredient,
    "id" | "foodId" | "displayName" | "quantity" | "note"
> & {
    /** The food's own name (the row's title can carry its usual product). */
    foodName?: string;
    /** The food's own unit, for a line with no amount. */
    defaultUnit?: string;
};

export type IngredientEditView = {
    recipeId: string;
    /**
     * The member view the page shows when the address names one (`base`, or a
     * member's id). Every link and form here carries it, so a refusal or a
     * save lands back on the view the person was editing.
     */
    member?: string;
    /** Foods on the Usuals list: a warning's food link opens that usual's sheet, not Saved foods. */
    usualFoodIds?: readonly string[];
    /** The lines are the base's own and the viewer may edit recipes. */
    editable: boolean;
    /** Saved recipes get Add to grocery list in the sheet's menu; a draft cannot be put on the list. */
    draft: boolean;
    edit?: RecipeIngredientEditState;
    gaps?: readonly RecipeGap[];
    problems?: readonly RecipeLineProblem[];
};

/** What the checks say about each ingredient, by ingredient id; nothing twice. */
export function ingredientWarnings(
    view: Pick<IngredientEditView, "gaps" | "problems">,
): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const add = (id: string | null, message: string) => {
        if (!id) return;
        const list = out.get(id) ?? [];
        if (!list.includes(message)) list.push(message);
        out.set(id, list);
    };
    for (const gap of view.gaps ?? []) add(gap.ingredientId, gap.message);
    for (const problem of view.problems ?? []) {
        add(problem.ingredientId, problem.message);
    }
    return out;
}

const memberParam = (member: string | undefined): string =>
    member ? `&member=${encodeURIComponent(member)}` : "";

/** The recipe page on the member view it was on (the base's, or a member's version). */
export function recipeViewHref(recipeId: string, member?: string): string {
    return `/recipes/${recipeId}${member ? `?member=${encodeURIComponent(member)}` : ""}`;
}

/** A form field that carries the member view through a post. */
function memberField(member: string | undefined): string {
    return member
        ? `<input type="hidden" name="member" value="${esc(member)}">`
        : "";
}

/** The ingredient's edit sheet, as a link that works with no script. */
export function ingredientHref(
    recipeId: string,
    ingredientId: string,
    member?: string,
): string {
    return `/recipes/${recipeId}?ingredient=${encodeURIComponent(ingredientId)}${memberParam(member)}`;
}

/** The Add ingredient link, as a link that works with no script. */
export function addIngredientHref(recipeId: string, member?: string): string {
    return `/recipes/${recipeId}?add=1${memberParam(member)}`;
}

/**
 * Where a food is edited: a usual opens its sheet on Usuals, any other food its
 * edit sheet on Saved foods. The one place that says which.
 */
export function foodEditHref(
    foodId: string,
    usualFoodIds: readonly string[] | undefined,
): { href: string; usual: boolean } {
    const usual = usualFoodIds?.includes(foodId) === true;
    return {
        usual,
        href: usual
            ? `${APP_PATHS.kitchenUsuals}/${encodeURIComponent(foodId)}`
            : `${APP_PATHS.settingsSaved}?food=${encodeURIComponent(foodId)}`,
    };
}

/** A small icon button that opens an ingredient's warning sheet. */
export function warningButton(ingredientId: string, name: string): Html {
    return raw(
        `<span class="fd-recipe-warn">${button({
            label: `What is wrong with ${name}`,
            round: true,
            icon: "warning",
            attrs: {
                command: "show-modal",
                commandfor: warnSheetId(ingredientId),
            },
        })}</span>`,
    );
}

/**
 * A row that opens its ingredient's edit sheet; the warning icon is its own
 * control beside it. The icon is drawn before the chevron (`recipes.css`), so
 * every row's chevron stays at the row's end.
 */
export function editableIngredientRow(
    view: Pick<IngredientEditView, "recipeId" | "member">,
    ingredient: Pick<RecipeIngredient, "id" | "displayName">,
    words: { meta: string; subtitle: string },
    warnings: readonly string[],
): Html {
    return itemRow({
        title: ingredient.displayName,
        meta: words.meta,
        subtitle: words.subtitle,
        href: ingredientHref(view.recipeId, ingredient.id, view.member),
        linkData: { "fd-open-item": ingredientSheetId(ingredient.id) },
        trailing: { kind: "chevron" },
        ...(warnings.length > 0
            ? {
                  className: "fd-recipe-ing--warn",
                  beside: {
                      trailing: warningButton(
                          ingredient.id,
                          ingredient.displayName,
                      ),
                  },
              }
            : {}),
    });
}

const sheetError = (error: string | undefined): string =>
    error
        ? `<p class="fd-recipe-sheet-error" role="alert">${esc(error)}</p>`
        : "";

/** The unit as a pull-down on a row; its choice rides in `unit`. */
function unitPulldown(unit: string, emptyLabel: string): Html {
    const known = (FOOD_QUANTITY_UNITS as readonly string[]).includes(unit);
    const choices = [
        { value: "", label: emptyLabel },
        ...(unit !== "" && !known
            ? [{ value: unit, label: quantityUnitOptionLabel(unit) }]
            : []),
        ...FOOD_QUANTITY_UNITS.map((u) => ({
            value: u as string,
            label: quantityUnitOptionLabel(u),
        })),
    ];
    const current = choices.find((c) => c.value === unit) ?? choices[0]!;
    return menuRow({
        label: "Unit",
        row: { title: "Unit", value: current.label },
        field: { name: "unit", value: current.value },
        items: choices.map((choice) => ({
            kind: "checked" as const,
            label: choice.label,
            checked: choice.value === current.value,
            value: choice.value,
        })),
    });
}

/** A number as the stepper's plain figure. */
function figure(value: string | number | undefined, fallback: number): number {
    const n = typeof value === "string" ? Number(value) : value;
    return n != null && Number.isFinite(n) && n >= 0 ? n : fallback;
}

type LineFields = {
    id: string;
    amount: number;
    unit: string;
    emptyUnitLabel: string;
    food: { label: string; value: string; required: boolean } | null;
};

/** The fields every ingredient sheet shares: amount and unit, food, note. */
function lineSections(f: LineFields): Html {
    const sections = [
        sheetSection({
            kind: "amount",
            label: "Amount · 0 is to taste",
            content: stepperControl({
                name: "amount",
                label: "Amount",
                value: f.amount,
                min: 0,
                step: f.amount >= 1 ? 1 : 0.25,
                inputStep: "any",
                id: `${f.id}-amount`,
            }),
        }),
        sheetSection({
            kind: "rows",
            content: listGroup({
                label: "Unit",
                rows: [unitPulldown(f.unit, f.emptyUnitLabel)],
            }),
        }),
    ];
    if (f.food) {
        sections.push(
            sheetSection({
                kind: "fields",
                label: "Food",
                content: field({
                    id: `${f.id}-food`,
                    label: f.food.label,
                    labelHidden: true,
                    name: "food_name",
                    value: f.food.value,
                    placeholder: "Food name",
                    required: f.food.required,
                    autocomplete: "off",
                    maxlength: 200,
                }),
            }),
        );
    }
    return join(sections);
}

function didYouMeanBlock(
    edit: RecipeIngredientEditState | undefined,
    sheetId: string,
): string {
    const modal = edit?.didYouMean;
    if (!modal || edit?.open !== sheetId) return "";
    return renderDidYouMeanBlock({
        action: modal.action,
        view: modal.view,
    }).replaceAll("did-you-mean-", "fd-did-you-mean-");
}

/** What a sheet shows in a field: what was posted when it is the one that was refused, else the saved value. */
function typedOr(
    edit: RecipeIngredientEditState | undefined,
    sheetId: string,
    key: string,
    saved: string,
): string {
    return edit?.open === sheetId && edit.typed && key in edit.typed
        ? edit.typed[key]!
        : saved;
}

/** An ingredient's ⋯: its food, the grocery list and Remove. */
function ingredientSheetMenu(
    view: IngredientEditView,
    ingredient: EditableIngredient,
    onList: boolean,
): Html {
    const items: MenuItem[] = [];
    if (ingredient.foodId) {
        items.push({
            kind: "link",
            label: "Open food",
            href: `${APP_PATHS.product}/${ingredient.foodId}?from=${encodeURIComponent(recipeViewHref(view.recipeId, view.member))}`,
        });
        if (!view.draft && !onList) {
            items.push({
                kind: "post",
                label: "Add to grocery list",
                action: `/recipes/${view.recipeId}/ingredients/${ingredient.foodId}/add-to-grocery`,
                ...(view.member ? { fields: { member: view.member } } : {}),
            });
        }
    }
    items.push({
        kind: "destructive",
        label: "Remove ingredient",
        confirmLabel: "Remove",
        action: `/recipes/${view.recipeId}/ingredients/${ingredient.id}/remove`,
        ...(view.member ? { fields: { member: view.member } } : {}),
    });
    return menu({
        label: `Actions for ${ingredient.displayName}`,
        anchor: "more",
        items,
    });
}

/** One ingredient's edit sheet. */
function ingredientSheet(
    view: IngredientEditView,
    ingredient: EditableIngredient,
    onList: boolean,
): string {
    const id = ingredientSheetId(ingredient.id);
    const formId = `${id}-form`;
    const open = view.edit?.open === id;
    const unit = typedOr(
        view.edit,
        id,
        "unit",
        ingredient.quantity?.unit ?? ingredient.defaultUnit ?? "",
    );
    const amount = figure(
        typedOr(
            view.edit,
            id,
            "amount",
            String(ingredient.quantity?.amount ?? 0),
        ),
        ingredient.quantity?.amount ?? 0,
    );
    const note = typedOr(view.edit, id, "note", ingredient.note ?? "");
    const foodName = typedOr(
        view.edit,
        id,
        "food_name",
        ingredient.foodName ?? ingredient.displayName,
    );
    const form = `<form id="${esc(formId)}" method="post" action="/recipes/${esc(view.recipeId)}/ingredients/${esc(ingredient.id)}">${memberField(view.member)}${lineSections(
        {
            id,
            amount,
            unit,
            emptyUnitLabel: "Usual unit",
            food: { label: "Food", value: foodName, required: true },
        },
    )}${sheetSection({
        kind: "fields",
        label: "Note",
        content: field({
            id: `${id}-note`,
            label: "Note",
            labelHidden: true,
            name: "note",
            value: note,
            placeholder: "Diced, room temperature…",
            autocomplete: "off",
            maxlength: 500,
        }),
    })}</form>`;
    return sheet({
        id,
        placement: "side",
        header: {
            kind: "title",
            title: ingredient.displayName,
            menu: ingredientSheetMenu(view, ingredient, onList),
        },
        body: raw(
            `${open ? sheetError(view.edit?.error) : ""}${didYouMeanBlock(view.edit, id)}${form}`,
        ),
        actions: {
            kind: "single",
            primary: { label: "Save", type: "submit", form: formId },
        },
        openOnLoad: open,
        focus: "panel",
    });
}

/** The sheet that adds a food to the recipe: a name, an amount and a unit. */
function addSheet(view: IngredientEditView): string {
    const id = INGREDIENT_ADD_SHEET_ID;
    const formId = `${id}-form`;
    const open = view.edit?.open === id;
    const body = `<form id="${esc(formId)}" method="post" action="/recipes/${esc(view.recipeId)}/ingredients">${memberField(view.member)}${lineSections(
        {
            id,
            amount: figure(typedOr(view.edit, id, "amount", "1"), 1),
            unit: typedOr(view.edit, id, "unit", ""),
            emptyUnitLabel: "Usual unit",
            food: {
                label: "Food",
                value: typedOr(view.edit, id, "food_name", ""),
                required: true,
            },
        },
    )}</form>`;
    return sheet({
        id,
        placement: "side",
        header: { kind: "title", title: "Add ingredient" },
        body: raw(
            `${open ? sheetError(view.edit?.error) : ""}${didYouMeanBlock(view.edit, id)}${body}`,
        ),
        actions: {
            kind: "single",
            primary: { label: "Add", type: "submit", form: formId },
        },
        openOnLoad: open,
        focus: "panel",
    });
}

/** An unreadable line's Resolve sheet: what food it is, and how much. */
function resolveSheet(
    view: IngredientEditView,
    line: string,
    index: number,
): string {
    const id = resolveSheetId(index);
    const formId = `${id}-form`;
    const open = view.edit?.open === id;
    const body = `<form id="${esc(formId)}" method="post" action="/recipes/${esc(view.recipeId)}/unresolved/resolve">${memberField(view.member)}<input type="hidden" name="line" value="${esc(line)}">${lineSections(
        {
            id,
            amount: figure(typedOr(view.edit, id, "amount", "1"), 1),
            unit: typedOr(view.edit, id, "unit", ""),
            emptyUnitLabel: "Usual unit",
            food: {
                label: "Food",
                value: typedOr(view.edit, id, "food_name", ""),
                required: true,
            },
        },
    )}</form>`;
    return sheet({
        id,
        placement: "side",
        header: {
            kind: "title",
            title: "Add as an ingredient",
            subtitle: line,
        },
        body: raw(
            `${open ? sheetError(view.edit?.error) : ""}${didYouMeanBlock(view.edit, id)}${body}`,
        ),
        actions: {
            kind: "single",
            primary: { label: "Add ingredient", type: "submit", form: formId },
        },
        openOnLoad: open,
        focus: "panel",
    });
}

/** An ingredient's warning sheet: what is wrong, and where to fix it. */
function warningSheet(
    view: IngredientEditView,
    ingredient: Pick<EditableIngredient, "id" | "foodId" | "displayName"> & {
        foodName?: string;
    },
    messages: readonly string[],
): string {
    const id = warnSheetId(ingredient.id);
    const rows: Html[] = [];
    if (view.editable) {
        rows.push(
            itemRow({
                title: "Edit ingredient",
                subtitle: "Amount, unit, note or food",
                opens: ingredientSheetId(ingredient.id),
                trailing: { kind: "chevron" },
            }),
        );
    }
    if (ingredient.foodId) {
        const name = ingredient.foodName ?? ingredient.displayName;
        const target = foodEditHref(ingredient.foodId, view.usualFoodIds);
        rows.push(
            itemRow({
                title: `Edit ${name}`,
                subtitle: target.usual
                    ? "Its usual product and restock"
                    : "Nutrition and grams in its food",
                href: target.href,
                trailing: { kind: "chevron" },
            }),
        );
    }
    const sections = [
        ...messages.map((text) => sheetSection({ kind: "message", text })),
        ...(rows.length > 0
            ? [
                  sheetSection({
                      kind: "rows",
                      content: listGroup({
                          label: `Fix ${ingredient.displayName}`,
                          rows,
                      }),
                  }),
              ]
            : []),
    ];
    return sheet({
        id,
        placement: "dialog",
        header: {
            kind: "title",
            title: ingredient.displayName,
            subtitle: "Needs a look",
        },
        body: join(sections),
    });
}

/** Every sheet the ingredient editing needs, for the page to put after its layout. */
export function renderIngredientSheets(
    view: IngredientEditView,
    ingredients: readonly (EditableIngredient & { foodName?: string })[],
    onList: ReadonlySet<string>,
    lines: readonly string[],
): string {
    const warnings = ingredientWarnings(view);
    const parts: string[] = [];
    for (const ingredient of ingredients) {
        if (view.editable) {
            parts.push(
                ingredientSheet(
                    view,
                    ingredient,
                    ingredient.foodId != null && onList.has(ingredient.foodId),
                ),
            );
        }
        const messages = warnings.get(ingredient.id);
        if (messages && messages.length > 0) {
            parts.push(warningSheet(view, ingredient, messages));
        }
    }
    if (view.editable) {
        parts.push(addSheet(view));
        lines.forEach((line, index) =>
            parts.push(resolveSheet(view, line, index)),
        );
    }
    return parts.join("\n");
}

/**
 * The draft's unreadable lines, each a row of its own: what it said, and
 * Resolve (opens its sheet) and Drop (forgets the line). Without the right to
 * edit the rows only say what the line was.
 */
export function unreadableLines(
    view: Pick<IngredientEditView, "recipeId" | "editable" | "member">,
    lines: readonly string[],
): string {
    if (lines.length === 0) return "";
    const rows = lines.map((line, index) =>
        itemRow({
            title: line,
            subtitle: "Couldn't be read as an ingredient",
            ...(view.editable
                ? {
                      trailing: {
                          kind: "control" as const,
                          html: raw(
                              `<span class="fd-recipe-line-actions">${button({
                                  label: "Resolve",
                                  size: "md",
                                  attrs: {
                                      command: "show-modal",
                                      commandfor: resolveSheetId(index),
                                  },
                              })}<form class="fd-inline-form" method="post" action="/recipes/${esc(view.recipeId)}/unresolved/drop">${memberField(view.member)}<input type="hidden" name="line" value="${esc(line)}">${button(
                                  {
                                      label: "Drop",
                                      size: "md",
                                      type: "submit",
                                  },
                              )}</form></span>`,
                          ),
                      },
                  }
                : {}),
            // The line is what the person has to read: it wraps, never cut short.
            className: "fd-recipe-line fd-item-row--wrap",
        }),
    );
    return `<p class="fd-recipe-caption">Lines we couldn't read:</p>${String(
        listGroup({
            rows,
            label: "Lines we couldn't read",
            className: "fd-recipe-draft__lines",
        }),
    )}`;
}
