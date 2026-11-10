// Calendar-day helpers shared by widgets that name a specific date on their
// card (goal-progress, meal-logged, nutrition-summary).

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

// "2026-07-11" -> "11 Jul". Split on the string rather than through Date: the
// payload's date is already resolved in the account's timezone, and
// new Date("2026-07-11") is UTC midnight, which renders as the 10th for anyone
// west of Greenwich. Anything not date-shaped passes through untouched.
function shortDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

// True when `iso` (YYYY-MM-DD) names the viewer's current local calendar day.
function isToday(iso) {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return String(iso || "") === `${y}-${mo}-${d}`;
}
