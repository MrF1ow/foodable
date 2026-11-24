/**
 * Days on the Household pages (an invite's expiry, a shared link's), counted
 * in the household's own time zone: a date near midnight UTC is another day
 * for the people it is shown to.
 */

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
] as const;

export type ZonedDay = { day: number; month: number; year: number };

/** The calendar day an instant falls on in `timeZone`; null when it is not a date. UTC for an unknown zone. */
export function dayInZone(iso: string, timeZone: string): ZonedDay | null {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    let zone = timeZone;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
    } catch {
        zone = "UTC";
    }
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
    }).formatToParts(at);
    const get = (type: string) =>
        Number(parts.find((p) => p.type === type)?.value);
    return { day: get("day"), month: get("month"), year: get("year") };
}

/** "Nov 24", with the year (", 2027") when it is not this year in that zone. */
export function monthDayLabel(
    iso: string,
    now: Date,
    timeZone: string,
): string {
    const day = dayInZone(iso, timeZone);
    if (!day) return iso;
    const label = `${MONTHS[day.month - 1]} ${day.day}`;
    return day.year === dayInZone(now.toISOString(), timeZone)?.year
        ? label
        : `${label}, ${day.year}`;
}

/** "24 Nov", with the year (" 2027") when it is not this year in that zone. */
export function dayMonthLabel(
    iso: string,
    now: Date,
    timeZone: string,
): string {
    const day = dayInZone(iso, timeZone);
    if (!day) return iso;
    const label = `${day.day} ${MONTHS[day.month - 1]}`;
    return day.year === dayInZone(now.toISOString(), timeZone)?.year
        ? label
        : `${label} ${day.year}`;
}
