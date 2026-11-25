/**
 * The design's `Item row`: one row with every option, replacing the eight
 * row builders in `rows.ts` as pages move over.
 *
 *   text      title, meta (beside the title), subtitle, value (before the
 *             trailing control)
 *   lead      checkbox, radio, check (a ring that posts a form: a grocery
 *             line's check-off), done (the same ring, filled and not a
 *             control), avatar, icon, dot
 *   extras    score (on the title line), macros (under the subtitle)
 *   trailing  chevron, more, add, toggle (on / off, or disabled: shown, nothing
 *             to press, and described by the row's subtitle when the row has
 *             an `id`, which is where its reason goes), control (a slot)
 *   state     default, disabled (greyed, still there), warning (the words are
 *             in the subtitle or value; colour never carries it alone)
 *   swipe     left reveals Delete (trash, red bed), right reveals Again
 *             (repeat, green bed); icons only, phone only
 *   reorder   the row of an inline reorder list: a handle at the start
 *             (`data-fd-order-handle`, dragged by `client/v2/stores.js`), the
 *             row's id in a hidden field the form posts, and up and down
 *             buttons for the keyboard and for no script
 *   edit      the row as a rename: the title becomes a field with Save and
 *             Cancel, posting one form
 *   input     the row as a value that saves itself: the title beside an input
 *             (and a unit), one autosaving form (`autosave-input.ts`), with the
 *             refusal under it
 *   disclosure the row opens in place to its answer: a native `<details>`
 *             whose summary is the face (title, chevron turning down) and
 *             whose body is `answer`; the row's `id` is on the `<details>`
 *   select    the pick box of a list in select mode: always in the markup of a
 *             selectable row, shown only while the list root carries
 *             `[data-fd-selecting]` (`client/v2/select-mode.js`); it combines
 *             with swipe and a link, like today's selectable rows
 *
 * The result is an `<li>` for `listGroup()`. Styles are
 * `public/app/v2/item-row.css`; the swipe gesture is `client/v2/swipe-rows.js`.
 * Alongside the face the Add and More controls are plain buttons: the design
 * draws them as a bare glyph and a 36 px circle, which no `button()` tier is.
 * A disabled row keeps its words and its pick box (disabled, so the columns
 * line up) but draws no swipe beds and is not pickable.
 */
import type { DotColor } from "./dot.js";
import {
    actionButton,
    cls,
    dataAttrs,
    esc,
    join,
    raw,
    safeHref,
    type ActionForm,
    type Html,
} from "./html.js";
import { autosaveInput, type AutosaveInputOptions } from "./autosave-input.js";
import { field } from "./field.js";
import { icon, type IconName } from "./icon.js";
import { memberAvatar } from "./avatar.js";
import { macroLine, type Macros, type Text } from "./rows.js";
import { scoreBadge } from "./score-badge.js";

export type ItemRowLead =
    | {
          kind: "checkbox";
          /** What the box is named after. */
          label: string;
          checked?: boolean;
          /** Drawn greyed and not pressable, in a row that is otherwise live (a line the cook cannot take). */
          disabled?: boolean;
          /** Field the ticked box posts under. */
          name?: string;
          value?: string;
      }
    | {
          /**
           * A ring that is a button: pressing it posts `form` (a grocery line's
           * check-off). `checked` fills it; the name says what it checks.
           */
          kind: "check";
          label: string;
          checked?: boolean;
          form: ActionForm;
      }
    | {
          /** The ring filled with its tick, and nothing to press (a line already checked off). */
          kind: "done";
          label: string;
      }
    | {
          /** One of a group of choices: a ring that fills when picked, and the
           *  whole row is the label, so tapping the title picks it too. */
          kind: "radio";
          label: string;
          name: string;
          value: string;
          checked?: boolean;
          /** The id of a form the radio belongs to, when its row sits outside that form. */
          form?: string;
      }
    | {
          kind: "avatar";
          initials: string;
          /** The member's picture over the initials (the profile-pictures flag). */
          picture?: { userId: string; version: Date | number | null };
      }
    | { kind: "icon"; name: IconName }
    | { kind: "dot"; color?: DotColor };

type ButtonHooks = {
    form?: ActionForm;
    name?: string;
    value?: string;
    data?: Readonly<Record<string, string>>;
};

export type ItemRowTrailing =
    | { kind: "chevron" }
    | ({ kind: "more"; label: string } & Pick<ButtonHooks, "data">)
    | ({
          kind: "add";
          label: string;
          /** A link instead of a button: where the plus goes with no script. */
          href?: string;
      } & ButtonHooks)
    | ({
          kind: "toggle";
          on: boolean;
          label: string;
          /** Held in place: drawn, but nothing to press. */
          disabled?: boolean;
      } & ButtonHooks)
    | { kind: "control"; html: Html };

export type ItemRowState = "default" | "disabled" | "warning";

/**
 * What a swipe bed does when it is released; the label is its accessible name.
 * `icon` replaces the glyph the side draws (trash on the left, repeat on the
 * right) for a bed that does something else (Ate some).
 */
export type ItemRowBed = ButtonHooks & { label?: string; icon?: IconName };

export type ItemRowSwipe = {
    /** Swiping left reveals Delete. */
    left?: ItemRowBed;
    /** Swiping right reveals Again. */
    right?: ItemRowBed;
    /** Render already swiped (the gallery, a script restoring state). */
    open?: "left" | "right";
};

export type ItemRowSelect = {
    name?: string;
    value?: string;
    checked?: boolean;
};

/** The row of a reorder list; its list posts every row's field, in DOM order. */
export type ItemRowReorder = {
    /** Field each row posts its id under (`order`). */
    name: string;
    value: string;
    /** What the move buttons are named after ("Move Costco up"). */
    label: string;
    canUp: boolean;
    canDown: boolean;
};

/** The row as a rename: one form, a field and the two ways out. */
export type ItemRowEdit = {
    action: string;
    name: string;
    value: string;
    /** Accessible name of the field. */
    label: string;
    maxlength?: number;
    /** Where Cancel goes. */
    cancelHref: string;
    /** The refusal the server sent back; shown under the field. */
    error?: string;
    fields?: Readonly<Record<string, string>>;
};

/** The row as a value that saves itself: the title is the input's label. */
export type ItemRowInput = Omit<
    AutosaveInputOptions,
    "label" | "className" | "data"
> & {
    /** A chevron at the end: the row reads as a link into the value. */
    chevron?: boolean;
};

/** The row as a disclosure: the face opens its answer beneath it. */
export type ItemRowDisclosure = {
    /** Ready-to-render HTML: the answer, escaped by whoever built it. */
    answer: Html;
};

export type ItemRowOptions = {
    title: Text;
    meta?: Text;
    subtitle?: Text;
    value?: Text;
    lead?: ItemRowLead;
    /** 0–100 product score; null or non-finite draws no badge. */
    score?: number | null;
    macros?: Macros;
    trailing?: ItemRowTrailing;
    state?: ItemRowState;
    /** Whole-row link; the row then holds no other control, except `add`. */
    href?: string;
    /**
     * A search result's plus: a link row's second control. The face opens
     * `href`; this button, drawn beside it and not inside it, does the other
     * thing (logs the food). Needs `href`.
     */
    add?: Extract<ItemRowTrailing, { kind: "add" }>;
    /**
     * Controls beside a link row's face, not inside it: one at the start (a
     * favourite star) and one at the end (a ⋯ menu), both ready-made markup.
     * The face opens `href`. Needs `href`; not selectable or swipeable.
     */
    beside?: { lead?: Html; trailing?: Html };
    /** `data-*` on the row itself (what a script reads when the row is picked). */
    data?: Readonly<Record<string, string>>;
    /** The row's ARIA role: `option` in a combobox's listbox (search results). */
    role?: "option";
    /** Puts the row in the tab order, for a row that opens a sheet by script. */
    focusable?: boolean;
    /** A control laid over the whole row (Go to a day's date input); trusted markup. */
    overlay?: Html;
    /** `data-*` on the link of a link row (`turbo: "false"` for a response
     *  Turbo cannot follow, such as Log out). */
    linkData?: Readonly<Record<string, string>>;
    /** Whole-row button: the row posts this form when pressed (Export data).
     *  Like a link row, it holds no other control. `formData` goes on the
     *  `<form>` (`data-turbo="false"` for a response Turbo cannot follow). */
    submit?: ActionForm & { formData?: Readonly<Record<string, string>> };
    /** Whole-row button that opens the sheet with this id (Name on Account). */
    opens?: string;
    swipe?: ItemRowSwipe;
    reorder?: ItemRowReorder;
    edit?: ItemRowEdit;
    input?: ItemRowInput;
    disclosure?: ItemRowDisclosure;
    /** The pick box of a list in select mode. */
    select?: boolean | ItemRowSelect;
    id?: string;
    className?: string;
};

function hiddenFieldsOf(fields?: Readonly<Record<string, string>>): string {
    return Object.entries(fields ?? {})
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`,
        )
        .join("");
}

const present = (value: Text | undefined): value is Text =>
    value != null && value !== "";

function leadSlot(lead: ItemRowLead, disabled: boolean): Html {
    switch (lead.kind) {
        case "checkbox": {
            const attrs = [
                lead.name != null ? ` name="${esc(lead.name)}"` : "",
                lead.value != null ? ` value="${esc(lead.value)}"` : "",
                lead.checked ? " checked" : "",
                disabled || lead.disabled ? " disabled" : "",
            ].join("");
            return raw(
                `<label class="fd-item-row__lead fd-item-row__check"><input type="checkbox" class="fd-item-row__check-input"${attrs} aria-label="${esc(lead.label)}"><span class="fd-item-row__check-box" aria-hidden="true">${icon("check")}</span></label>`,
            );
        }
        case "check":
            return actionButton({
                label: lead.label,
                iconOnly: true,
                className:
                    "fd-item-row__lead fd-item-row__check fd-item-row__check-btn",
                content: raw(
                    `<span class="fd-item-row__check-box" aria-hidden="true">${icon("check")}</span>`,
                ),
                form: lead.form,
                disabled,
                extraAttrs: ` role="checkbox" aria-checked="${lead.checked ? "true" : "false"}"`,
            });
        case "done":
            return raw(
                `<span class="fd-item-row__lead fd-item-row__check fd-item-row__done" role="img" aria-label="${esc(lead.label)}"><span class="fd-item-row__check-box" aria-hidden="true">${icon("check")}</span></span>`,
            );
        case "radio": {
            const attrs = [
                ` name="${esc(lead.name)}"`,
                ` value="${esc(lead.value)}"`,
                lead.form != null ? ` form="${esc(lead.form)}"` : "",
                lead.checked ? " checked" : "",
                disabled ? " disabled" : "",
            ].join("");
            return raw(
                `<span class="fd-item-row__lead fd-item-row__check fd-item-row__check--radio"><input type="radio" class="fd-item-row__check-input"${attrs} aria-label="${esc(lead.label)}"><span class="fd-item-row__check-box" aria-hidden="true">${icon("check")}</span></span>`,
            );
        }
        case "avatar":
            return lead.picture?.version != null
                ? memberAvatar({
                      name: lead.initials,
                      initials: lead.initials,
                      userId: lead.picture.userId,
                      version: lead.picture.version,
                      enabled: true,
                      className: "fd-item-row__lead fd-item-row__avatar",
                  })
                : raw(
                      `<span class="fd-item-row__lead fd-item-row__avatar" aria-hidden="true">${esc(lead.initials)}</span>`,
                  );
        case "icon":
            return raw(
                `<span class="fd-item-row__lead fd-item-row__icon">${icon(lead.name)}</span>`,
            );
        case "dot":
            return raw(
                `<span class="fd-item-row__lead fd-item-row__dot fd-dot--${lead.color ?? "good"}" aria-hidden="true"></span>`,
            );
    }
}

function trailingSlot(
    trailing: ItemRowTrailing,
    disabled: boolean,
    describedBy?: string,
): Html {
    switch (trailing.kind) {
        case "chevron":
            return raw(
                `<span class="fd-item-row__trail fd-item-row__chevron" aria-hidden="true">${icon("chevron-right")}</span>`,
            );
        case "control":
            return raw(
                `<span class="fd-item-row__trail fd-item-row__control"${disabled ? " inert" : ""}>${trailing.html}</span>`,
            );
        case "more":
            return actionButton({
                label: trailing.label,
                iconOnly: true,
                className: "fd-item-row__trail fd-item-row__more",
                content: icon("more"),
                data: trailing.data,
                disabled,
                extraAttrs: ` aria-haspopup="menu"`,
            });
        case "add":
            if (trailing.href != null) {
                return raw(
                    `<a class="fd-item-row__trail fd-item-row__add" href="${safeHref(trailing.href)}" aria-label="${esc(trailing.label)}"${dataAttrs(trailing.data)}>${icon("plus")}</a>`,
                );
            }
            return actionButton({
                label: trailing.label,
                iconOnly: true,
                className: "fd-item-row__trail fd-item-row__add",
                content: icon("plus"),
                form: trailing.form,
                name: trailing.name,
                value: trailing.value,
                data: trailing.data,
                disabled,
            });
        case "toggle":
            return actionButton({
                label: trailing.label,
                iconOnly: true,
                className: "fd-item-row__trail fd-item-row__toggle",
                content: raw(`<span class="fd-item-row__knob"></span>`),
                form: trailing.form,
                name: trailing.name,
                value: trailing.value,
                data: trailing.data,
                disabled: disabled || trailing.disabled === true,
                extraAttrs: ` role="switch" aria-checked="${trailing.on ? "true" : "false"}"${describedBy != null ? ` aria-describedby="${esc(describedBy)}"` : ""}`,
            });
    }
}

function bed(side: "left" | "right", spec: ItemRowBed): Html {
    const again = side === "right";
    return raw(
        `<div class="fd-item-row__bed fd-item-row__bed--${again ? "again" : "delete"}">${actionButton(
            {
                label: spec.label ?? (again ? "Again" : "Delete"),
                iconOnly: true,
                className: "fd-item-row__bed-btn",
                content: icon(spec.icon ?? (again ? "repeat" : "trash")),
                form: spec.form,
                name: spec.name,
                value: spec.value,
                data: spec.data,
            },
        )}</div>`,
    );
}

function selectBox(
    select: ItemRowOptions["select"],
    title: Text,
    disabled: boolean,
): Html {
    if (!select) return raw("");
    const spec = select === true ? {} : select;
    const attrs = [
        spec.name != null ? ` name="${esc(spec.name)}"` : "",
        spec.value != null ? ` value="${esc(spec.value)}"` : "",
        spec.checked && !disabled ? " checked" : "",
        disabled ? " disabled" : "",
    ].join("");
    return raw(
        `<label class="fd-item-row__select"><input type="checkbox" class="fd-item-row__select-input" data-fd-select-item${attrs} aria-label="Select ${esc(title)}"><span class="fd-item-row__select-box" aria-hidden="true">${icon("check")}</span></label>`,
    );
}

function moveButton(
    reorder: ItemRowReorder,
    dir: "up" | "down",
    enabled: boolean,
): string {
    return `<button type="submit" class="fd-item-row__move fd-item-row__move--${dir}" name="move" value="${esc(reorder.value)}:${dir}" aria-label="Move ${esc(reorder.label)} ${dir}"${enabled ? "" : " disabled"}>${icon("chevron-right")}</button>`;
}

function reorderRow(opts: ItemRowOptions, reorder: ItemRowReorder): Html {
    const subtitle = present(opts.subtitle)
        ? `<span class="fd-item-row__subtitle">${esc(opts.subtitle)}</span>`
        : "";
    return raw(
        `<li class="${cls("fd-item-row fd-item-row--reorder", opts.className)}" data-fd-order-item><div class="fd-item-row__face"><input type="hidden" name="${esc(reorder.name)}" value="${esc(reorder.value)}"><span class="fd-item-row__lead fd-item-row__handle" data-fd-order-handle aria-hidden="true">${icon("filter")}</span><span class="fd-item-row__main"><span class="fd-item-row__line"><span class="fd-item-row__title" title="${esc(opts.title)}">${esc(opts.title)}</span></span>${subtitle}</span><span class="fd-item-row__moves">${moveButton(reorder, "up", reorder.canUp)}${moveButton(reorder, "down", reorder.canDown)}</span></div></li>`,
    );
}

function editRow(opts: ItemRowOptions, edit: ItemRowEdit): Html {
    if (opts.id == null) throw new Error("itemRow: an edit row needs an id");
    const input = field({
        id: `${opts.id}-field`,
        label: edit.label,
        labelHidden: true,
        name: edit.name,
        value: edit.value,
        maxlength: edit.maxlength,
        required: true,
        autocomplete: "off",
        autofocus: true,
        inputData: { "fd-autofocus": "" },
        error: edit.error,
        className: "fd-item-row__edit-field",
    });
    return raw(
        `<li class="${cls("fd-item-row fd-item-row--edit", opts.className)}" id="${esc(opts.id)}"><form class="fd-item-row__face fd-item-row__edit" method="post" action="${esc(edit.action)}">${hiddenFieldsOf(edit.fields)}${input}<button type="submit" class="fd-item-row__edit-btn" aria-label="Save">${icon("check")}</button><a class="fd-item-row__edit-btn" href="${safeHref(edit.cancelHref)}" aria-label="Cancel">${icon("close")}</a></form></li>`,
    );
}

function inputRow(opts: ItemRowOptions, input: ItemRowInput): Html {
    if (
        opts.href != null ||
        opts.submit != null ||
        opts.opens != null ||
        opts.lead != null ||
        opts.trailing != null ||
        opts.swipe != null ||
        opts.select != null ||
        opts.value != null ||
        opts.reorder != null ||
        opts.edit != null
    ) {
        throw new Error("itemRow: an input row is only a title and its input");
    }
    const { chevron, ...rest } = input;
    const face = autosaveInput({
        ...rest,
        label: String(opts.title),
        className: "fd-item-row__face",
    });
    return raw(
        `<li class="${cls("fd-item-row fd-item-row--input", chevron && "fd-item-row--input-chevron", opts.className)}">${face}${chevron ? `<span class="fd-item-row__trail fd-item-row__chevron" aria-hidden="true">${icon("chevron-right")}</span>` : ""}</li>`,
    );
}

function disclosureRow(
    opts: ItemRowOptions,
    disclosure: ItemRowDisclosure,
): Html {
    if (
        opts.href != null ||
        opts.submit != null ||
        opts.opens != null ||
        opts.lead != null ||
        opts.trailing != null ||
        opts.swipe != null ||
        opts.select != null ||
        opts.value != null ||
        opts.reorder != null ||
        opts.edit != null ||
        opts.input != null
    ) {
        throw new Error(
            "itemRow: a disclosure row is only a title (and a subtitle) and its answer",
        );
    }
    const subtitle = present(opts.subtitle)
        ? `<span class="fd-item-row__subtitle">${esc(opts.subtitle)}</span>`
        : "";
    const id = opts.id != null ? ` id="${esc(opts.id)}"` : "";
    return raw(
        `<li class="${cls("fd-item-row fd-item-row--disclosure", opts.className)}"><details class="fd-item-row__disclosure"${id}>
<summary class="fd-item-row__face fd-item-row__face--link"><span class="fd-item-row__main"><span class="fd-item-row__line"><span class="fd-item-row__title" title="${esc(opts.title)}">${esc(opts.title)}</span></span>${subtitle}</span>${trailingSlot({ kind: "chevron" }, false)}</summary>
<div class="fd-item-row__answer">${disclosure.answer}</div>
</details></li>`,
    );
}

export function itemRow(opts: ItemRowOptions): Html {
    if (opts.disclosure != null) return disclosureRow(opts, opts.disclosure);
    if (opts.input != null) return inputRow(opts, opts.input);
    if (opts.reorder != null || opts.edit != null) {
        const mode = opts.reorder != null ? "reorder" : "edit";
        if (
            opts.href != null ||
            opts.submit != null ||
            opts.opens != null ||
            opts.lead != null ||
            opts.trailing != null ||
            opts.swipe != null ||
            opts.select != null ||
            opts.value != null ||
            (opts.reorder != null && opts.edit != null)
        ) {
            throw new Error(
                `itemRow: a ${mode} row is only a title (and a subtitle on reorder)`,
            );
        }
        return opts.reorder != null
            ? reorderRow(opts, opts.reorder)
            : editRow(opts, opts.edit!);
    }
    const state = opts.state ?? "default";
    const disabled = state === "disabled";
    // A disabled row draws no beds: they would stay live buttons under it.
    const swipe = disabled ? undefined : opts.swipe;
    const hasSwipe = !!(swipe?.left || swipe?.right);
    // Left is the Delete bed and right the Again bed: open slides over one
    // only when that bed exists.
    const open =
        swipe?.open && swipe[swipe.open] != null ? swipe.open : undefined;
    const pickable = !!opts.select && !disabled;
    // A disabled row is not a link: an anchor would stay focusable and followable.
    const href = disabled ? undefined : opts.href;

    if (
        state === "warning" &&
        !present(opts.subtitle) &&
        !present(opts.value)
    ) {
        throw new Error(
            "itemRow: a warning row needs its words in the subtitle or the value",
        );
    }
    if (
        [opts.href, opts.submit, opts.opens].filter((x) => x != null).length > 1
    ) {
        throw new Error("itemRow: a row is a link or a button, not both");
    }
    if (opts.add != null && opts.href == null) {
        throw new Error("itemRow: add needs an href (a link row's plus)");
    }
    if (opts.add != null && (opts.select != null || opts.swipe != null)) {
        throw new Error("itemRow: a link row with a plus is not selectable");
    }
    if (opts.beside != null && opts.href == null) {
        throw new Error(
            "itemRow: beside needs an href (a link row's controls)",
        );
    }
    if (
        opts.beside != null &&
        (opts.add != null || opts.select != null || opts.swipe != null)
    ) {
        throw new Error(
            "itemRow: a link row with controls beside it is not selectable and has no plus",
        );
    }
    if (opts.href != null || opts.submit != null || opts.opens != null) {
        const control =
            opts.lead?.kind === "checkbox" ||
            opts.lead?.kind === "radio" ||
            (opts.trailing != null && opts.trailing.kind !== "chevron");
        if (control) {
            throw new Error(
                "itemRow: a link row cannot hold a checkbox or a trailing control",
            );
        }
    }

    const titleLine = join([
        `<span class="fd-item-row__title" title="${esc(opts.title)}">${esc(opts.title)}</span>`,
        present(opts.meta)
            ? `<span class="fd-item-row__meta">${esc(opts.meta)}</span>`
            : "",
        opts.score != null ? scoreBadge(opts.score) : "",
    ]);
    // A held switch is described by the reason under the title.
    const reasonId =
        opts.trailing?.kind === "toggle" &&
        opts.trailing.disabled === true &&
        opts.id != null &&
        present(opts.subtitle)
            ? `${opts.id}-reason`
            : undefined;
    const main = join([
        `<span class="fd-item-row__line">${titleLine}</span>`,
        present(opts.subtitle)
            ? `<span class="fd-item-row__subtitle"${reasonId != null ? ` id="${esc(reasonId)}"` : ""}>${esc(opts.subtitle)}</span>`
            : "",
        opts.macros ? macroLine(opts.macros) : "",
    ]);
    const content = join([
        opts.lead ? leadSlot(opts.lead, disabled) : "",
        `<span class="fd-item-row__main">${main}</span>`,
        present(opts.value)
            ? `<span class="fd-item-row__value">${esc(opts.value)}</span>`
            : "",
        opts.trailing ? trailingSlot(opts.trailing, disabled, reasonId) : "",
    ]);
    const pick = selectBox(opts.select, opts.title, disabled);
    // The pick box is a control, so it never sits inside the link: a selectable
    // link row is a face holding the box beside the link.
    const submitEl = opts.submit
        ? `<form class="fd-inline-form" method="${opts.submit.method ?? "post"}" action="${esc(opts.submit.action)}"${dataAttrs(opts.submit.formData)}>${hiddenFieldsOf(opts.submit.fields)}<button type="submit" class="fd-item-row__face fd-item-row__face--link">${content}</button></form>`
        : null;
    const opensEl =
        opts.opens != null
            ? `<button type="button" class="fd-item-row__face fd-item-row__face--link" commandfor="${esc(opts.opens)}" command="show-modal">${content}</button>`
            : null;
    const faceEl =
        submitEl != null && !disabled
            ? submitEl
            : opensEl != null && !disabled
              ? opensEl
              : href == null
                ? opts.lead?.kind === "radio" && !opts.select
                    ? `<label class="fd-item-row__face fd-item-row__face--choice">${content}</label>`
                    : `<div class="fd-item-row__face">${pick}${content}</div>`
                : opts.beside != null
                  ? `<div class="fd-item-row__face fd-item-row__face--link">${opts.beside.lead ?? ""}<a class="fd-item-row__anchor" href="${safeHref(href)}"${dataAttrs(opts.linkData)}>${content}</a>${opts.beside.trailing ?? ""}</div>`
                  : opts.add != null
                    ? `<div class="fd-item-row__face fd-item-row__face--link"><a class="fd-item-row__anchor" href="${safeHref(href)}"${dataAttrs(opts.linkData)}>${content}</a>${trailingSlot(opts.add, disabled)}</div>`
                    : opts.select
                      ? `<div class="fd-item-row__face fd-item-row__face--link">${pick}<a class="fd-item-row__anchor" href="${safeHref(href)}"${dataAttrs(opts.linkData)}>${content}</a></div>`
                      : `<a class="fd-item-row__face fd-item-row__face--link" href="${safeHref(href)}"${dataAttrs(opts.linkData)}>${content}</a>`;

    const attrs = [
        opts.id != null ? ` id="${esc(opts.id)}"` : "",
        disabled ? ` aria-disabled="true"` : "",
        open ? ` data-swipe-open="${open}"` : "",
        pickable ? " data-fd-select-row" : "",
        opts.role != null ? ` role="${opts.role}"` : "",
        opts.focusable ? ` tabindex="0"` : "",
        dataAttrs(opts.data),
    ].join("");
    return raw(
        `<li class="${cls(
            "fd-item-row",
            state !== "default" && `fd-item-row--${state}`,
            hasSwipe && "fd-item-row--swipe",
            opts.select && "fd-item-row--select",
            opts.className,
        )}"${attrs}>${join([
            swipe?.right ? bed("right", swipe.right) : "",
            faceEl,
            swipe?.left ? bed("left", swipe.left) : "",
            opts.overlay ?? "",
        ])}</li>`,
    );
}
