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
import { esc } from "../../components/v2/html.js";
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
          confirmLabel: string;
      };

export type SelectMode = {
    /** Attribute for the element that holds the rows, the bar and the sheets. */
    rootAttrs: string;
    /** The Select button. */
    toggle: string;
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
    const body = `<form id="${esc(formId)}" method="post" action="${esc(spec.action)}" data-fd-select-form>${returnField(returnTo)}<p class="fd-sheet-message" data-fd-select-message data-one="${esc(spec.one)}" data-many="${esc(spec.many)}">${esc(message)}</p></form>`;
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
        tools: `<div class="fd-select-tools">${toggle}</div>`,
        bar,
        sheets,
    };
}
