/**
 * Hairline rows and section headers (FigCraft Screens: Today, Search, Kitchen,
 * Product). Every row is an `<li class="fd-row fd-row--<variant>">` meant to sit
 * inside `rowList()`; a `surface/bg` fill with a 1px `--line` bottom border.
 *
 * Swipe slots are markup only: the actions are real, focusable buttons in the
 * DOM behind the row face (or hover/focus overlay with a fine pointer); the
 * gesture itself is another module's job. See `components.css` "Swipe rows".
 */
import { memberAvatar } from "./avatar.js";
import { dot, type DotColor } from "./dot.js";
import {
    actionButton,
    cls,
    esc,
    join,
    raw,
    safeHref,
    srOnly,
    type ActionForm,
    type Html,
} from "./html.js";
import { iconCheck, iconChevronRight, iconPlus, iconTrash } from "./icons.js";
import { scoreBadge } from "./score-badge.js";
import { sheetTrigger } from "./sheet.js";

/** A value the caller already formatted. Only escaped here. */
export type Text = string | number;

export type RowLead = { dot: DotColor } | { html: Html };

export type SwipeAction = {
    /** Visible text and accessible name. */
    label: string;
    /** Optional icon beside the label (e.g. `iconRepeat()`). */
    icon?: Html;
    /** POST form wrapped around the button so it works without JS. */
    form?: ActionForm;
    name?: string;
    value?: string;
    /** `data-*` hooks for whatever wires the action (key must be lowercase-kebab). */
    data?: Readonly<Record<string, string>>;
};

/**
 * FigCraft `#19380` swipe slots. `lead` is revealed by swiping right (accent
 * text, e.g. "Again"), `trail` by swiping left (danger text, e.g. "Delete").
 * `open` renders the row already swiped, for the gallery and for a script
 * restoring state: it sets `data-swipe-open`, which the CSS reads.
 */
export type RowSwipe = {
    lead?: SwipeAction;
    trail?: SwipeAction;
    open?: "lead" | "trail";
    /** `id` of the row's `dialog.fd-sheet` (accessible actions path). */
    sheetId?: string;
};

/** Stable gesture descriptor for `data-swipe-right` / `data-swipe-left`. */
function swipeDataAttr(action: SwipeAction, side: "left" | "right"): string {
    const url = action.form?.action ?? "";
    return ` data-swipe-${side}="${esc(`${url}\t${action.label}`)}"`;
}

/**
 * A row that can be picked with others and acted on once. The checkbox is in
 * the markup always; `select-mode.js` shows it only while a list is in
 * selection mode, and its form reads the ticked ones as `name=value`
 * fields (the checkbox belongs to no form of its own).
 */
export type RowSelect = {
    /** Field the ticked box posts under (`ids[]`). */
    name: string;
    /** The row's id. */
    value: string;
    /** What the box is named after: "Select <label>". */
    label: Text;
};

type RowBase = {
    /** Leading dot or caller markup (avatar, icon). Built by `dot()` / v2 helpers only. */
    lead?: RowLead;
    swipe?: RowSwipe;
    /** Makes the row pickable in the list's selection mode. */
    select?: RowSelect;
    className?: string;
    id?: string;
};

type ShellOpts = RowBase & {
    variant: string;
    main: Html;
    trailing?: Html;
    /** Whole-row link. The row body becomes an `<a>`; no interactive children then. */
    href?: string;
    extraClass?: string;
    /** Markup after the row body, still inside the `<li>` (a nested list). */
    after?: Html | string;
};

function leadSlot(lead: RowLead | undefined): string {
    if (!lead) return "";
    const inner = "dot" in lead ? dot(lead.dot) : lead.html;
    return `<span class="fd-row__lead">${inner}</span>`;
}

function selectBox(select: RowSelect | undefined): string {
    if (!select) return "";
    return `<label class="fd-row__select"><input type="checkbox" class="fd-row__select-input" data-fd-select-item name="${esc(select.name)}" value="${esc(select.value)}" aria-label="Select ${esc(select.label)}"><span class="fd-row__select-box" aria-hidden="true">${iconCheck()}</span></label>`;
}

function swipeAction(action: SwipeAction, side: "lead" | "trail"): Html {
    const button = actionButton({
        label: action.label,
        content: join([
            action.icon,
            `<span class="fd-swipe-btn__text">${esc(action.label)}</span>`,
        ]),
        className: cls(
            "fd-swipe-btn",
            side === "lead" ? "fd-swipe-btn--accent" : "fd-swipe-btn--danger",
        ),
        name: action.name,
        value: action.value,
        data: action.data,
        form: action.form,
    });
    return raw(
        `<div class="fd-row__action fd-row__action--${side}">${button}</div>`,
    );
}

function rowShell(opts: ShellOpts): Html {
    const swipe = opts.swipe;
    const hasSwipe = !!(swipe?.lead || swipe?.trail);
    const open =
        hasSwipe && swipe?.open ? ` data-swipe-open="${swipe.open}"` : "";
    const swipeData =
        swipe?.lead != null ? swipeDataAttr(swipe.lead, "right") : "";
    const swipeDataTrail =
        swipe?.trail != null ? swipeDataAttr(swipe.trail, "left") : "";
    const sheetLink =
        hasSwipe && swipe?.sheetId
            ? ` data-sheet-id="${esc(swipe.sheetId)}" aria-controls="${esc(swipe.sheetId)}"`
            : "";
    const id = opts.id ? ` id="${esc(opts.id)}"` : "";
    if (opts.select && opts.href) {
        // A checkbox inside a link would be a second control in one tap target.
        throw new Error("v2 rows: select cannot be combined with href");
    }
    const body = [
        selectBox(opts.select),
        leadSlot(opts.lead),
        `<div class="fd-row__main">${opts.main}</div>`,
        opts.trailing ?? "",
    ].join("");
    const bodyEl = opts.href
        ? `<a class="fd-row__body fd-row__body--link" href="${safeHref(opts.href)}">${body}</a>`
        : `<div class="fd-row__body">${body}</div>`;
    return raw(
        `<li class="${cls(
            "fd-row",
            `fd-row--${opts.variant}`,
            hasSwipe && "fd-row--swipe",
            opts.select && "fd-row--selectable",
            opts.extraClass,
            opts.className,
        )}"${id}${open}${swipeData}${swipeDataTrail}${sheetLink}${opts.select ? " data-fd-select-row" : ""}>${swipe?.lead ? swipeAction(swipe.lead, "lead") : ""}${bodyEl}${swipe?.trail ? swipeAction(swipe.trail, "trail") : ""}${opts.after ?? ""}</li>`,
    );
}

function titleLine(
    title: Text,
    extra: Html | string | undefined,
    titleClass?: string,
): Html {
    return raw(
        `<span class="fd-row__line"><span class="${cls("fd-row__title", titleClass)}" title="${esc(title)}">${esc(title)}</span>${extra ?? ""}</span>`,
    );
}

function metaSpan(meta: Text | undefined, className = "fd-row__meta"): string {
    return meta == null || meta === ""
        ? ""
        : `<span class="${className}">${esc(meta)}</span>`;
}

/**
 * The red trash button that ends a list row's action line: icon only, a 32px
 * circle, named after the item ("Delete Eggs"). It opens the item's confirm
 * sheet (`target`), so it never deletes on its own tap. `verb` swaps the word
 * for the same gesture ("Revoke").
 */
export function rowDeleteTrigger(opts: {
    /** `id` of the confirm sheet it opens. */
    target: string;
    /** What is deleted; goes into the accessible name. */
    name: Text;
    verb?: string;
}): Html {
    return raw(
        sheetTrigger({
            target: opts.target,
            label: `${opts.verb ?? "Delete"} ${opts.name}`,
            className: "fd-icon-btn fd-icon-btn--danger",
            icon: String(iconTrash()),
        }),
    );
}

/**
 * Manage row: a one-line name that ends in "…" when it does not fit (the full
 * name stays in the markup and in the `title` attribute), an optional meta
 * line, and the row's action buttons (`actions`, e.g. `rowDeleteTrigger`) at
 * the end, always on the row's own line. `after` is a nested list that belongs
 * to the row (products under a food).
 */
export function manageRow(
    opts: RowBase & {
        title: Text;
        meta?: Text;
        actions?: Html | string;
        after?: Html | string;
    },
): Html {
    const main = join([
        titleLine(opts.title, undefined),
        opts.meta != null && opts.meta !== ""
            ? `<span class="fd-row__sub">${esc(opts.meta)}</span>`
            : "",
    ]);
    const actions = opts.actions
        ? raw(`<span class="fd-row__actions">${opts.actions}</span>`)
        : undefined;
    return rowShell({
        ...opts,
        variant: "manage",
        main,
        trailing: actions,
    });
}

/** Grams / counts the caller formatted ("19", 2, "–"). */
export type Macros = { protein: Text; carbs: Text; fat: Text };

/**
 * "P 19 C 2 F 15" in the macro colours (FigCraft `#19186` Macros). The visible
 * letter is `aria-hidden`; the spoken name ("Protein 19") is in a visually
 * hidden span, so the line is not read as "P nineteen C two".
 */
export function macroLine(macros: Macros): Html {
    const one = (
        key: "protein" | "carbs" | "fat",
        letter: string,
        name: string,
    ) =>
        `<span class="fd-macro fd-macro--${key}"><span aria-hidden="true">${letter} </span>${srOnly(`${name} `)}${esc(macros[key])}</span>`;
    return raw(
        `<span class="fd-macros">${one("protein", "P", "Protein")}${one("carbs", "C", "Carbs")}${one("fat", "F", "Fat")}</span>`,
    );
}

function value(text: Text | undefined, className = "fd-row__value"): Html {
    return raw(
        text == null || text === ""
            ? ""
            : `<span class="${className}">${esc(text)}</span>`,
    );
}

/**
 * Food row, FigCraft `#19186` / `#19383` (a logged meal on Today): title with an
 * inline meta ("3 large"), a macro line, and a trailing value (kcal).
 */
export function foodRow(
    opts: RowBase & {
        title: Text;
        meta?: Text;
        subtitle?: Text;
        macros?: Macros;
        trailing?: Text;
        href?: string;
    },
): Html {
    const main = join([
        titleLine(opts.title, metaSpan(opts.meta)),
        opts.subtitle != null && opts.subtitle !== ""
            ? `<span class="fd-row__sub">${esc(opts.subtitle)}</span>`
            : "",
        opts.macros ? macroLine(opts.macros) : "",
    ]);
    return rowShell({
        ...opts,
        variant: "food",
        main,
        trailing: value(opts.trailing),
    });
}

/**
 * Search result, FigCraft `#20321`: title (+ optional inline score badge), a
 * subtitle, a macro line and a round add button. `add` is the button's
 * accessible name and optional POST form; it is the only interactive child,
 * so these rows never take `href`.
 */
export function searchResultRow(
    opts: RowBase & {
        title: Text;
        /** 0–100 product score; omitted or non-finite shows no badge. */
        score?: number | null;
        subtitle?: Text;
        macros?: Macros;
        add: {
            label: string;
            form?: ActionForm;
            name?: string;
            value?: string;
            data?: Readonly<Record<string, string>>;
        };
    },
): Html {
    const main = join([
        titleLine(opts.title, scoreBadge(opts.score)),
        opts.subtitle != null && opts.subtitle !== ""
            ? `<span class="fd-row__sub">${esc(opts.subtitle)}</span>`
            : "",
        opts.macros ? macroLine(opts.macros) : "",
    ]);
    const add = actionButton({
        label: opts.add.label,
        content: iconPlus(),
        iconOnly: true,
        className: "fd-icon-btn",
        form: opts.add.form,
        name: opts.add.name,
        value: opts.add.value,
        data: opts.add.data,
    });
    return rowShell({ ...opts, variant: "search", main, trailing: add });
}

/**
 * Grocery row, FigCraft `#21945` / `#21994`: a check circle, title, subtitle
 * with an optional tag pill, and a trailing amount. The circle is a
 * `role="checkbox"` button named after the line (`aria-checked`); `toggle`
 * carries the POST form that flips it. A checked line is struck through.
 */
export function groceryRow(
    opts: Omit<RowBase, "select"> & {
        title: Text;
        /** 0–100 product score; omitted or non-finite shows no badge. */
        score?: number | null;
        subtitle?: Text;
        /** Small outlined pill after the subtitle ("usual"). */
        tag?: Text;
        amount?: Text;
        checked?: boolean;
        toggle?: {
            form?: ActionForm;
            name?: string;
            value?: string;
            data?: Readonly<Record<string, string>>;
        };
    },
): Html {
    const checked = !!opts.checked;
    // Without a form the circle would be a button that does nothing with no
    // JS, so it renders as a status image instead of a dead checkbox.
    const check = !opts.toggle?.form
        ? raw(
              `<span class="${cls("fd-check", checked && "fd-check--on")}" role="img" aria-label="${checked ? "Checked off" : "Not checked off"}">${checked ? iconCheck() : ""}</span>`,
          )
        : actionButton({
              label: String(opts.title),
              iconOnly: true,
              content: checked ? iconCheck() : raw(""),
              className: cls("fd-check", checked && "fd-check--on"),
              extraAttrs: ` role="checkbox" aria-checked="${checked ? "true" : "false"}"`,
              form: opts.toggle?.form,
              name: opts.toggle?.name,
              value: opts.toggle?.value,
              data: opts.toggle?.data,
          });
    const sub =
        (opts.subtitle != null && opts.subtitle !== "") || opts.tag
            ? `<span class="fd-row__subline">${metaSpan(opts.subtitle, "fd-row__sub")}${opts.tag != null && opts.tag !== "" ? `<span class="fd-tag">${esc(opts.tag)}</span>` : ""}</span>`
            : "";
    const main = join([
        titleLine(
            opts.title,
            scoreBadge(opts.score),
            checked ? "fd-row__title--done" : "",
        ),
        sub,
    ]);
    return rowShell({
        ...opts,
        variant: "grocery",
        extraClass: checked ? "fd-row--checked" : undefined,
        main,
        lead: { html: check },
        trailing: value(opts.amount, "fd-row__amount"),
    });
}

/**
 * Fridge row, FigCraft `#21411`: title with an inline quantity and a trailing
 * date in tertiary text. `dateTime` (ISO) turns the date into a `<time>`.
 */
export function fridgeRow(
    opts: RowBase & {
        title: Text;
        qty?: Text;
        date?: Text;
        dateTime?: string;
        /** Extra class on the date cell (expiry tone). */
        dateClass?: string;
        href?: string;
    },
): Html {
    const dateExtra = opts.dateClass ? ` ${opts.dateClass}` : "";
    const date =
        opts.date == null || opts.date === ""
            ? ""
            : opts.dateTime
              ? `<time class="fd-row__date${dateExtra}" datetime="${esc(opts.dateTime)}">${esc(opts.date)}</time>`
              : `<span class="fd-row__date${dateExtra}">${esc(opts.date)}</span>`;
    return rowShell({
        ...opts,
        variant: "fridge",
        main: titleLine(opts.title, metaSpan(opts.qty)),
        trailing: raw(date),
    });
}

/** One piece of a usual row's subtitle. Tone colours it ("low now", "on the list", "Paused"). */
export type UsualPart =
    Text | { text: Text; tone: "warn" | "accent" | "muted" };

/**
 * Usual row, FigCraft `#22410`: title with an inline meta (the specific
 * product), a subtitle of ` · `-joined parts (some toned), and a trailing
 * chevron. The whole row is a link, so `href` is required.
 */
export function usualRow(
    opts: RowBase & {
        title: Text;
        meta?: Text;
        parts?: readonly UsualPart[];
        /** When omitted the row is not a link (sheet / script opens it). */
        href?: string;
    },
): Html {
    const parts = (opts.parts ?? [])
        .map((part) => {
            if (typeof part === "object") {
                return `<span class="fd-tone fd-tone--${part.tone}">${esc(part.text)}</span>`;
            }
            return `<span>${esc(part)}</span>`;
        })
        .join(`<span class="fd-sep" aria-hidden="true"> · </span>`);
    const main = join([
        titleLine(
            opts.title,
            metaSpan(opts.meta, "fd-row__meta fd-row__meta--lg"),
        ),
        parts ? `<span class="fd-row__sub">${parts}</span>` : "",
    ]);
    return rowShell({
        ...opts,
        variant: "usual",
        main,
        trailing: raw(
            `<span class="fd-row__chevron" aria-hidden="true">${iconChevronRight()}</span>`,
        ),
    });
}

export type PartStatus = "good" | "warn" | "over";

const PART_STATUS_LABEL: Record<PartStatus, string> = {
    good: "Good",
    warn: "Moderate",
    over: "Poor",
};

/**
 * Member check row, FigCraft `#21143`: avatar initials, name, verdict label, one
 * line reason, trailing status dot (Good / Careful / Avoid).
 */
export function memberCheckRow(opts: {
    name: Text;
    initials: Text;
    verdict: "good" | "careful" | "avoid";
    reason: Text;
    /** Set when the profile-pictures flag is on: whose picture, and its
     *  version (null = none). The initials stay the fallback. */
    avatar?: { userId: string; version: Date | null };
}): Html {
    const verdictLabel =
        opts.verdict === "good"
            ? "Good"
            : opts.verdict === "careful"
              ? "Careful"
              : "Avoid";
    const dotColor =
        opts.verdict === "good"
            ? ("good" as const)
            : opts.verdict === "careful"
              ? ("warn" as const)
              : ("over" as const);
    const verdictClass = `fd-member-verdict fd-member-verdict--${opts.verdict}`;
    return rowShell({
        variant: "member",
        lead: {
            html: memberAvatar({
                name: String(opts.name),
                initials: String(opts.initials),
                userId: opts.avatar?.userId,
                version: opts.avatar?.version,
                enabled: opts.avatar !== undefined,
                className: "fd-avatar--row",
            }),
        },
        main: join([
            titleLine(
                opts.name,
                raw(
                    `<span class="${verdictClass}">${esc(verdictLabel)}</span>`,
                ),
            ),
            `<span class="fd-row__sub">${esc(opts.reason)}</span>`,
        ]),
        trailing: raw(
            `<span class="fd-row__status">${dot(dotColor, { label: verdictLabel })}</span>`,
        ),
    });
}

/**
 * Part row, FigCraft `#21113` (a line of the product score breakdown): a fixed
 * 116px label, a value filling the rest, and a trailing 8px status dot. The dot
 * is a `role="img"` named by `statusLabel` (default Good / Moderate / Poor).
 */
export function partRow(
    opts: RowBase & {
        label: Text;
        value: Text;
        status?: PartStatus;
        statusLabel?: string;
    },
): Html {
    const status = opts.status
        ? dot(opts.status, {
              label: opts.statusLabel ?? PART_STATUS_LABEL[opts.status],
          })
        : "";
    return rowShell({
        ...opts,
        variant: "part",
        main: raw(
            `<span class="fd-row__label">${esc(opts.label)}</span><span class="fd-row__partvalue">${esc(opts.value)}</span>`,
        ),
        trailing: raw(
            status ? `<span class="fd-row__status">${status}</span>` : "",
        ),
    });
}

/** Wraps rows in `<ul class="fd-list">`. `label` names the list for screen readers. */
export function rowList(
    rows: readonly Html[],
    opts: { label?: string; className?: string } = {},
): Html {
    const label = opts.label ? ` aria-label="${esc(opts.label)}"` : "";
    return raw(
        `<ul class="${cls("fd-list", opts.className)}"${label}>${rows.join("")}</ul>`,
    );
}

/**
 * Section header, FigCraft `#21941`: an uppercase label on the left, a count on
 * the right, a hairline underneath. The label is a real heading (`level`,
 * default 2) so the page outline keeps it.
 */
export function sectionHeader(opts: {
    title: Text;
    count?: Text;
    level?: 2 | 3 | 4;
    className?: string;
    id?: string;
}): Html {
    const level = opts.level ?? 2;
    const id = opts.id ? ` id="${esc(opts.id)}"` : "";
    return raw(
        `<div class="${cls("fd-section-head", opts.className)}"><h${level} class="fd-section-head__title"${id}>${esc(opts.title)}</h${level}>${
            opts.count != null && opts.count !== ""
                ? `<span class="fd-section-head__count">${esc(opts.count)}</span>`
                : ""
        }</div>`,
    );
}
