import { dateInTz, shiftLocalDate } from "./tz.js";

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

/** Whole local days from `from` to `to` (both YYYY-MM-DD). */
function daysBetween(from: string, to: string): number {
    let days = 0;
    let cursor = from;
    // Bounded: anything a week or more back is a date, so never walk far.
    while (cursor < to && days < 7) {
        cursor = shiftLocalDate(cursor, 1);
        days += 1;
    }
    return days;
}

/**
 * How long ago a household member was last active, in the household's own
 * days: Today, Yesterday, "N days ago" up to six, then a date (with the year
 * only when it is not this one). Null means they never have been.
 */
export function lastActiveLabel(
    at: Date | null,
    now: Date,
    tz: string,
): string {
    if (at == null) return "Not yet";
    const seenDay = dateInTz(at, tz);
    const today = dateInTz(now, tz);
    if (seenDay >= today) return "Today";
    const days = daysBetween(seenDay, today);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    const [y, m, d] = seenDay.split("-").map(Number);
    const month = MONTHS[(m ?? 1) - 1] ?? "";
    const thisYear = today.slice(0, 4);
    return String(y) === thisYear ? `${month} ${d}` : `${month} ${d}, ${y}`;
}
