/**
 * The design's `Item row`: one row with every option, replacing the eight
 * row builders in `rows.ts` as pages move over.
 *
 *   text      title, meta (beside the title), subtitle, value (before the
 *             trailing control)
 *   lead      checkbox, avatar, icon, dot
 *   extras    score (on the title line), macros (under the subtitle)
 *   trailing  chevron, more, add, toggle (on / off), control (a slot)
 *   state     default, disabled (greyed, still there), warning (the words are
 *             in the subtitle or value; colour never carries it alone)
 *   swipe     left reveals Delete (trash, red bed), right reveals Again
 *             (repeat, green bed); icons only, phone only
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
    esc,
    join,
    raw,
    safeHref,
    type ActionForm,
    type Html,
} from "./html.js";
import { icon, type IconName } from "./icon.js";
import { macroLine, type Macros, type Text } from "./rows.js";
import { scoreBadge } from "./score-badge.js";

export type ItemRowLead =
    | {
          kind: "checkbox";
          /** What the box is named after. */
          label: string;
          checked?: boolean;
          /** Field the ticked box posts under. */
          name?: string;
          value?: string;
      }
    | { kind: "avatar"; initials: string }
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
    | ({ kind: "add"; label: string } & ButtonHooks)
    | ({ kind: "toggle"; on: boolean; label: string } & ButtonHooks)
    | { kind: "control"; html: Html };

export type ItemRowState = "default" | "disabled" | "warning";

/** What a swipe bed does when it is released; the label is its accessible name. */
export type ItemRowBed = ButtonHooks & { label?: string };

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
    /** Whole-row link; the row then holds no other control. */
    href?: string;
    swipe?: ItemRowSwipe;
    /** The pick box of a list in select mode. */
    select?: boolean | ItemRowSelect;
    id?: string;
    className?: string;
};

const present = (value: Text | undefined): value is Text =>
    value != null && value !== "";

function leadSlot(lead: ItemRowLead, disabled: boolean): Html {
    switch (lead.kind) {
        case "checkbox": {
            const attrs = [
                lead.name != null ? ` name="${esc(lead.name)}"` : "",
                lead.value != null ? ` value="${esc(lead.value)}"` : "",
                lead.checked ? " checked" : "",
                disabled ? " disabled" : "",
            ].join("");
            return raw(
                `<label class="fd-item-row__lead fd-item-row__check"><input type="checkbox" class="fd-item-row__check-input"${attrs} aria-label="${esc(lead.label)}"><span class="fd-item-row__check-box" aria-hidden="true">${icon("check")}</span></label>`,
            );
        }
        case "avatar":
            return raw(
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

function trailingSlot(trailing: ItemRowTrailing, disabled: boolean): Html {
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
                disabled,
                extraAttrs: ` role="switch" aria-checked="${trailing.on ? "true" : "false"}"`,
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
                content: icon(again ? "repeat" : "trash"),
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

export function itemRow(opts: ItemRowOptions): Html {
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
    if (opts.href != null) {
        const control =
            opts.lead?.kind === "checkbox" ||
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
    const main = join([
        `<span class="fd-item-row__line">${titleLine}</span>`,
        present(opts.subtitle)
            ? `<span class="fd-item-row__subtitle">${esc(opts.subtitle)}</span>`
            : "",
        opts.macros ? macroLine(opts.macros) : "",
    ]);
    const content = join([
        opts.lead ? leadSlot(opts.lead, disabled) : "",
        `<span class="fd-item-row__main">${main}</span>`,
        present(opts.value)
            ? `<span class="fd-item-row__value">${esc(opts.value)}</span>`
            : "",
        opts.trailing ? trailingSlot(opts.trailing, disabled) : "",
    ]);
    const pick = selectBox(opts.select, opts.title, disabled);
    // The pick box is a control, so it never sits inside the link: a selectable
    // link row is a face holding the box beside the link.
    const faceEl =
        href == null
            ? `<div class="fd-item-row__face">${pick}${content}</div>`
            : opts.select
              ? `<div class="fd-item-row__face fd-item-row__face--link">${pick}<a class="fd-item-row__anchor" href="${safeHref(href)}">${content}</a></div>`
              : `<a class="fd-item-row__face fd-item-row__face--link" href="${safeHref(href)}">${content}</a>`;

    const attrs = [
        opts.id != null ? ` id="${esc(opts.id)}"` : "",
        disabled ? ` aria-disabled="true"` : "",
        open ? ` data-swipe-open="${open}"` : "",
        pickable ? " data-fd-select-row" : "",
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
        ])}</li>`,
    );
}
