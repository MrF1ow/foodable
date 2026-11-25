/**
 * How a use-by day reads on a page: the words for the days left and the tone
 * class that colours them. Kitchen › Fridge draws both; the classes are styled
 * in `public/app/v2/kitchen.css`.
 */
import { daysUntilExpiry, type ExpiryLevel } from "../../../domain/stock.js";

/** The tone class of an expiry level: high and expired alike, medium, low. */
export function expiryToneClass(level: ExpiryLevel): string {
    if (level === "expired" || level === "high") return "fd-expiry--high";
    if (level === "medium") return "fd-expiry--medium";
    return "fd-expiry--low";
}

/** "Expired", "Today", "Tomorrow", "3 days", or the date itself past a week. */
export function formatExpiryWhen(today: string, expiresOn: string): string {
    const days = daysUntilExpiry(today, expiresOn);
    if (days < 0) return "Expired";
    if (days === 1) return "Tomorrow";
    if (days === 0) return "Today";
    if (days <= 7) return `${days} days`;
    return expiresOn;
}
