/**
 * Select mode on a list: a Select button, then rows with a checkbox each, a
 * "N selected" bar with the list's bulk actions and Cancel, and a confirm sheet
 * for the ones that cannot be undone. One markup for Groceries, Fridge, Usuals
 * and Saved foods & recipes; the rows come from `components/v2/rows.ts`
 * (`select`), the behaviour from `src/web/client/v2/select-mode.js`.
 *
 * The picked ids are not in the markup. The forms here sit outside the rows,
 * and the client adds each ticked checkbox to a form as it is sent (a
 * `data-fd-select-form` form), so the same form serves any selection.
 */
import { esc, raw, type Html } from "../../components/v2/html.js";
import type { MenuItem } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { selectionBar } from "../../components/v2/selection-bar.js";
import { sheet, sheetTrigger } from "../../components/v2/sheet.js";

export type BulkActionSpec =
    | {
          /** Posts straight away: nothing here is lost (Check off). */
          kind: "submit";
          key: string;
          label: string;
          action: string;
      }
    | {
          /** Opens a confirm sheet that states the count first. */
          kind: "confirm";
          key: string;
          label: string;
          action: string;
          title: string;
          /** "Discard 1 item?" */
          one: string;
          /** "Discard {n} items?" */
          many: string;
          /**
           * What to say instead when any picked box posts under `name` (the
           * recipes among foods): the same two forms, with the extra warning.
           */
          ifPicked?: { name: string; one: string; many: string };
          confirmLabel: string;
      };

export type SelectMode = {
    /** Attribute for the element that holds the rows, the bar and the sheets. */
    rootAttrs: string;
    /** The Select button. */
    toggle: string;
    /** Select as an item of a page's ⋯ menu (the Detail bar's), in place of the button. */
    menuItem: Extract<MenuItem, { kind: "button" }>;
    /** The Select button alone on a right-aligned row, for a list's top. */
    tools: string;
    /** The count and actions bar. Hidden until the list enters select mode. */
    bar: string;
    /** The confirm sheets (inside the root, so the client finds the rows). */
    sheets: string;
};

function sheetId(scope: string, key: string): string {
    return `fd-select-${scope}-${key}`;
}

function returnField(returnTo: string): string {
    return `<input type="hidden" name="return_to" value="${esc(returnTo)}">`;
}

function plainAction(
    scope: string,
    returnTo: string,
    spec: Extract<BulkActionSpec, { kind: "submit" }>,
): string {
    const id = sheetId(scope, spec.key);
    return `<form id="${esc(id)}" method="post" action="${esc(spec.action)}" data-fd-select-form hidden>${returnField(returnTo)}</form><button type="submit" class="fd-btn fd-btn--primary" form="${esc(id)}" data-fd-select-action>${esc(spec.label)}</button>`;
}

function confirmTrigger(
    scope: string,
    spec: Extract<BulkActionSpec, { kind: "confirm" }>,
): string {
    return sheetTrigger({
        target: sheetId(scope, spec.key),
        label: spec.label,
        className: "fd-btn fd-btn--danger",
        data: { "fd-select-action": "" },
    });
}

function confirmSheet(
    scope: string,
    returnTo: string,
    spec: Extract<BulkActionSpec, { kind: "confirm" }>,
): string {
    const id = sheetId(scope, spec.key);
    const formId = `${id}-form`;
    // Until the client counts, the message names no number.
    const message = spec.many.replace("{n}", () => "the selected");
    const body = `<form id="${esc(formId)}" method="post" action="${esc(spec.action)}" data-fd-select-form>${returnField(returnTo)}<p class="fd-sheet-message" data-fd-select-message data-one="${esc(spec.one)}" data-many="${esc(spec.many)}"${spec.ifPicked ? ` data-if-name="${esc(spec.ifPicked.name)}" data-if-one="${esc(spec.ifPicked.one)}" data-if-many="${esc(spec.ifPicked.many)}"` : ""}>${esc(message)}</p></form>`;
    const actions = `<button type="button" class="fd-btn" command="close" commandfor="${esc(id)}">Cancel</button>
<button type="submit" class="fd-btn fd-btn--danger" form="${esc(formId)}">${esc(spec.confirmLabel)}</button>`;
    return sheet({
        id,
        kind: "confirm",
        title: spec.title,
        body,
        actions,
    });
}

export function selectMode(opts: {
    /** Names the list: code constant, lowercase letters and hyphens. */
    scope: string;
    /** Where an action returns to (a same-app path). */
    returnTo: string;
    actions: readonly BulkActionSpec[];
}): SelectMode {
    const toggle = `<button type="button" class="fd-btn fd-btn--sm fd-select-toggle" data-fd-select-toggle="${esc(opts.scope)}">Select</button>`;
    const actions = opts.actions
        .map((spec) =>
            spec.kind === "submit"
                ? plainAction(opts.scope, opts.returnTo, spec)
                : confirmTrigger(opts.scope, spec),
        )
        .join("");
    const bar = `<div class="fd-select-bar" data-fd-select-bar="${esc(opts.scope)}" role="region" aria-label="Selected items" hidden>
<span class="fd-select-bar__count" data-fd-select-count role="status">0 selected</span>
<div class="fd-select-bar__actions">${actions}</div>
<button type="button" class="fd-btn fd-btn--sm" data-fd-select-cancel>Cancel</button>
</div>`;
    const sheets = opts.actions
        .filter(
            (spec): spec is Extract<BulkActionSpec, { kind: "confirm" }> =>
                spec.kind === "confirm",
        )
        .map((spec) => confirmSheet(opts.scope, opts.returnTo, spec))
        .join("");
    return {
        rootAttrs: ` data-fd-select="${esc(opts.scope)}"`,
        toggle,
        menuItem: {
            kind: "button",
            label: "Select",
            data: { "fd-select-toggle": opts.scope },
        },
        tools: `<div class="fd-select-tools">${toggle}</div>`,
        bar,
        sheets,
    };
}

/**
 * Select mode drawn with the design's Selection bar, for a list whose actions
 * confirm in place: the bar floats over the page on the phone and sits flat
 * above the list from 1024px, and a destructive action turns into Cancel and
 * the same verb with the count ("Discard 3") where it stands, with no sheet.
 * A caps "N selected" row with Cancel heads the list while picking.
 *
 * Same hooks as `selectMode`: `rootAttrs` marks the list, the Select item is
 * `menuItem`, and `client/v2/select-mode.js` shows `head` and `bars`, counts,
 * and adds the ticked boxes to the forms here as they are sent.
 */
export type SelectionBarsSpec =
    | { kind: "submit"; key: string; label: string; action: string }
    | { kind: "confirm"; key: string; label: string; action: string };

export type SelectionBars = {
    rootAttrs: string;
    menuItem: Extract<MenuItem, { kind: "button" }>;
    /** The caps "N selected" row with Cancel (hidden until picking). */
    head: Html;
    /** The phone's floating bar and the desktop's inline one, with their forms. */
    bars: Html;
};

function selectionAction(
    scope: string,
    returnTo: string,
    spec: SelectionBarsSpec,
    placement: "floating" | "inline",
): { forms: string; actions: Parameters<typeof selectionBar>[0]["actions"] } {
    const id = sheetId(scope, spec.key);
    const submit = {
        label: spec.label,
        variant: "danger" as const,
        type: "submit" as const,
        attrs: {
            form: id,
            "data-fd-select-action": "",
            "data-fd-select-verb": spec.label,
        },
    };
    const forms =
        placement === "floating"
            ? `<form id="${esc(id)}" method="post" action="${esc(spec.action)}" data-fd-select-form hidden>${returnField(returnTo)}</form>`
            : "";
    if (spec.kind === "submit") {
        return { forms, actions: [submit] };
    }
    return {
        forms,
        actions: [
            {
                label: spec.label,
                variant: "danger",
                attrs: {
                    "data-fd-select-action": "",
                    "data-fd-select-ask": "",
                    "data-fd-select-verb": spec.label,
                    "data-fd-select-when": "idle",
                },
            },
            {
                label: "Cancel",
                attrs: {
                    "data-fd-select-unask": "",
                    "data-fd-select-when": "ask",
                },
            },
            {
                ...submit,
                attrs: { ...submit.attrs, "data-fd-select-when": "ask" },
            },
        ],
    };
}

export function selectionBars(opts: {
    scope: string;
    returnTo: string;
    actions: readonly SelectionBarsSpec[];
}): SelectionBars {
    const bar = (placement: "floating" | "inline") => {
        const built = opts.actions.map((spec) =>
            selectionAction(opts.scope, opts.returnTo, spec, placement),
        );
        const markup = selectionBar({
            placement,
            count: 0,
            showCount: placement === "inline",
            actions: built.flatMap((b) => b.actions),
        });
        const side = placement === "floating" ? "phone" : "desktop";
        return `${built.map((b) => b.forms).join("")}<div class="fd-select-bar-slot fd-select-bar-slot--${side}" data-fd-select-bar="${esc(opts.scope)}" hidden>${markup}</div>`;
    };
    const head = `<div class="fd-select-head" data-fd-select-head="${esc(opts.scope)}" hidden>${sectionHeader(
        {
            label: "0 selected",
            rule: false,
            action: { label: "Cancel", data: { "fd-select-cancel": "" } },
        },
    )}</div>`;
    return {
        rootAttrs: ` data-fd-select="${esc(opts.scope)}"`,
        menuItem: {
            kind: "button",
            label: "Select",
            data: { "fd-select-toggle": opts.scope },
        },
        head: raw(head),
        bars: raw(`${bar("floating")}${bar("inline")}`),
    };
}
