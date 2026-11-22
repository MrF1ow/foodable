/**
 * The design's Week day (FigCraft 381765, State: Default, Selected) and Week
 * strip (381771): a weekday letter over a round date, with a dot under it when
 * the day has something logged, between a previous and a next button.
 *
 * A day is a link when it has a `href`, else a toggle button. Selected fills
 * the date; as a link it is `aria-current="date"`. The dot is part of the
 * accessible name ("Monday 2 November, logged"), so it is never colour alone.
 * An end with no `href` is a disabled button, not removed.
 *
 * Styles: `public/app/v2/week-strip.css`.
 */
import { button } from "./button.js";
import { cls, esc, raw, safeHref, type Html } from "./html.js";

export type WeekDayOptions = {
    /** One letter ("S"). */
    weekday: string;
    day: number | string;
    /** The full date for a screen reader ("Sunday 1 November"). */
    label: string;
    selected?: boolean;
    /** Something is logged that day. */
    marked?: boolean;
    href?: string;
    className?: string;
};

export function weekDay(opts: WeekDayOptions): Html {
    if (typeof opts.day === "number" && !Number.isFinite(opts.day)) {
        throw new Error(
            `weekDay: day must be a finite number, got ${opts.day}`,
        );
    }
    const classes = cls(
        "fd-week-day",
        opts.selected && "fd-week-day--selected",
        opts.className,
    );
    const name = `aria-label="${esc(opts.marked ? `${opts.label}, logged` : opts.label)}"`;
    const inner = `<span class="fd-week-day__weekday" aria-hidden="true">${esc(opts.weekday)}</span><span class="fd-week-day__num" aria-hidden="true">${esc(opts.day)}</span><span class="${cls("fd-week-day__dot", opts.marked && "fd-week-day__dot--on")}" aria-hidden="true"></span>`;
    if (opts.href != null) {
        return raw(
            `<a class="${classes}" href="${safeHref(opts.href)}"${opts.selected ? ' aria-current="date"' : ""} ${name}>${inner}</a>`,
        );
    }
    return raw(
        `<button type="button" class="${classes}" aria-pressed="${opts.selected ? "true" : "false"}" ${name}>${inner}</button>`,
    );
}

export type WeekStripEnd = { label: string; href?: string };

export type WeekStripOptions = {
    /** The strip's accessible name ("Week"). */
    label: string;
    days: readonly WeekDayOptions[];
    previous?: WeekStripEnd;
    next?: WeekStripEnd;
    className?: string;
};

function end(side: "previous" | "next", e: WeekStripEnd): string {
    return String(
        button({
            round: true,
            size: "md",
            icon: side === "previous" ? "chevron-left" : "chevron-right",
            label: e.label,
            href: e.href,
            disabled: e.href == null,
        }),
    );
}

export function weekStrip(opts: WeekStripOptions): Html {
    return raw(
        `<nav class="${cls("fd-week-strip", opts.className)}" aria-label="${esc(opts.label)}">${opts.previous ? end("previous", opts.previous) : ""}<div class="fd-week-strip__days">${opts.days.map(weekDay).join("")}</div>${opts.next ? end("next", opts.next) : ""}</nav>`,
    );
}
