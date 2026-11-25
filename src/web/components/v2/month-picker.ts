/**
 * The design's Month picker (FigCraft "Month picker", in the plan sheet's
 * "pick a start day").
 *
 * `monthPicker` is two parts that go in different places of a sheet: the
 * `row` (an Item row: its title, the day it holds and a chevron) and the
 * `picker` (a month label with previous and next buttons, the weekday
 * letters and a grid of round dates) that the row opens beneath itself. The
 * picked day rides in a hidden input of the row, so the form posts it with no
 * script; `client/v2/recipes.js` opens the picker, moves between months and
 * writes the pick into the input and the row. A day before `min` is disabled.
 *
 * Styles: `public/app/v2/month-picker.css`.
 */
import { button } from "./button.js";
import { cls, esc, raw, type Html } from "./html.js";
import { itemRow } from "./item-row.js";

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
] as const;
const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
] as const;

/** The date a `YYYY-MM-DD` names, or null when it is not a real day. */
function parseDay(day: string): Date | null {
    if (!DAY_SHAPE.test(day)) return null;
    const at = new Date(`${day}T00:00:00Z`);
    return Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== day
        ? null
        : at;
}

function dayAfter(day: string, days: number): string {
    const at = parseDay(day);
    if (!at) return day;
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
}

/**
 * What the Starts row reads for a day: "Today", "Tomorrow", then "Sat 21 Nov";
 * a value that is not a day (a failed save's typed text) is shown as typed.
 */
export function monthPickerLabel(day: string, today: string): string {
    const at = parseDay(day);
    if (!at) return day;
    if (day === today) return "Today";
    if (day === dayAfter(today, 1)) return "Tomorrow";
    return `${WEEKDAYS[at.getUTCDay()]!.slice(0, 3)} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]!.slice(0, 3)}`;
}

export type MonthPickerOptions = {
    /** Prefix of the ids the row and the picker use. */
    id: string;
    /** The hidden field the picked day posts as. */
    name: string;
    /** The row's title ("Starts"). */
    title: string;
    /** The picked day, `YYYY-MM-DD`; anything else is kept as typed. */
    value: string;
    /** The household's today: what the row calls "Today" and "Tomorrow". */
    today: string;
    /** The first day that can be picked; earlier days are disabled. */
    min?: string;
    /** The picker starts open (a failed save re-renders with it closed). */
    open?: boolean;
};

function dayCell(
    day: string,
    opts: { picked: boolean; today: boolean; disabled: boolean },
): string {
    const at = parseDay(day)!;
    const name = `${WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
    return `<button type="button" class="${cls("fd-month-picker__day", opts.picked && "fd-month-picker__day--picked", opts.today && "fd-month-picker__day--today")}" data-fd-month-day="${esc(day)}" aria-pressed="${opts.picked ? "true" : "false"}" aria-label="${esc(name)}"${opts.today ? ' aria-current="date"' : ""}${opts.disabled ? " disabled" : ""}>${at.getUTCDate()}</button>`;
}

/** The grid of one month: blanks to the first weekday, then a button per day. */
function monthGrid(
    year: number,
    month: number,
    opts: { picked: string; today: string; min: string | undefined },
): string {
    const first = new Date(Date.UTC(year, month, 1));
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells: string[] = Array.from(
        { length: first.getUTCDay() },
        () => `<span class="fd-month-picker__blank" aria-hidden="true"></span>`,
    );
    for (let n = 1; n <= length; n += 1) {
        const day = new Date(Date.UTC(year, month, n))
            .toISOString()
            .slice(0, 10);
        cells.push(
            dayCell(day, {
                picked: day === opts.picked,
                today: day === opts.today,
                disabled: opts.min != null && day < opts.min,
            }),
        );
    }
    return cells.join("");
}

export function monthPicker(opts: MonthPickerOptions): {
    row: Html;
    picker: Html;
} {
    const pickerId = `${opts.id}-picker`;
    const shown = parseDay(opts.value) ?? parseDay(opts.today) ?? new Date();
    const year = shown.getUTCFullYear();
    const month = shown.getUTCMonth();
    const label = `${MONTHS[month]} ${year}`;
    const label0 = monthPickerLabel(opts.value, opts.today);
    // The hidden field rides inside the row (`overlay`), beside its face.
    const row = itemRow({
        title: opts.title,
        value: label0,
        trailing: { kind: "chevron" },
        toggles: {
            controls: pickerId,
            expanded: opts.open === true,
            data: { "fd-month-toggle": pickerId },
        },
        overlay: raw(
            `<input type="hidden" name="${esc(opts.name)}" value="${esc(opts.value)}" data-fd-month-field>`,
        ),
    });
    const firstShown = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const prev = button({
        label: "Previous month",
        icon: "chevron-left",
        round: true,
        // No month before the one the first pickable day is in.
        disabled: opts.min != null && firstShown <= opts.min,
        attrs: { "data-fd-month-prev": "" },
    });
    const next = button({
        label: "Next month",
        icon: "chevron-right",
        round: true,
        attrs: { "data-fd-month-next": "" },
    });
    const letters = WEEKDAYS.map(
        (name) => `<span>${esc(name.slice(0, 1))}</span>`,
    ).join("");
    const picker = raw(
        `<div class="fd-month-picker" id="${esc(pickerId)}" data-fd-month-picker data-today="${esc(opts.today)}" data-min="${esc(opts.min ?? "")}" data-month="${year}-${String(month + 1).padStart(2, "0")}"${opts.open ? "" : " hidden"}>
<div class="fd-month-picker__head"><p class="fd-month-picker__label" data-fd-month-label aria-live="polite">${esc(label)}</p>${prev}${next}</div>
<div class="fd-month-picker__weekdays" aria-hidden="true">${letters}</div>
<div class="fd-month-picker__grid" role="group" aria-label="Pick a day" data-fd-month-grid>${monthGrid(year, month, { picked: opts.value, today: opts.today, min: opts.min })}</div>
</div>`,
    );
    return { row, picker };
}
