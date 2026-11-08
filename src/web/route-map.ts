/** Canonical household-app paths and legacy URL redirects (UI-1). */

export const APP_PATHS = {
    nutrition: "/",
    recipes: "/recipes",
    settings: "/settings",
    settingsHelp: "/settings/help",
    settingsHouseholdPrefs: "/settings/household-settings",
    needsAttention: "/needs-attention",
    createHousehold: "/create-household",
    share: "/share",
    kitchenFridge: "/kitchen/fridge",
    kitchenGroceries: "/kitchen/groceries",
    kitchenUsuals: "/kitchen/usuals",
    settingsHousehold: "/settings/household",
    settingsHouseholdItems: "/settings/household/items",
    settingsHouseholdPossibleDuplicates:
        "/settings/household/possible-duplicates",
    logMeal: "/log-meal",
    logWater: "/log-water",
    logWeight: "/log-weight",
    nutritionLayout: "/nutrition/layout",
} as const;

/** Longest match first — segment-boundary prefixes only. */
export const LEGACY_PATH_MOVES: readonly { from: string; to: string }[] = [
    { from: "/household/usual-products", to: APP_PATHS.kitchenUsuals },
    { from: "/settings/foods", to: APP_PATHS.settingsHouseholdItems },
    { from: "/fridge", to: APP_PATHS.kitchenFridge },
    { from: "/grocery", to: APP_PATHS.kitchenGroceries },
    { from: "/household", to: APP_PATHS.settingsHousehold },
];

function legacyPrefixMatch(
    pathname: string,
): { from: string; to: string } | null {
    for (const move of LEGACY_PATH_MOVES) {
        if (pathname === move.from) return move;
        if (pathname.startsWith(`${move.from}/`)) return move;
    }
    return null;
}

function isLegacyPathname(pathname: string): boolean {
    return legacyPrefixMatch(pathname) != null;
}

export function legacyRedirectTarget(pathWithQuery: string): string | null {
    const q = pathWithQuery.indexOf("?");
    const pathname = q >= 0 ? pathWithQuery.slice(0, q) : pathWithQuery;
    const query = q >= 0 ? pathWithQuery.slice(q) : "";
    const match = legacyPrefixMatch(pathname);
    if (!match) return null;
    const rest = pathname.slice(match.from.length);
    const target = `${match.to}${rest}${query}`;
    const targetPath = target.includes("?")
        ? target.slice(0, target.indexOf("?"))
        : target;
    if (isLegacyPathname(targetPath)) return null;
    return target;
}

export function canonicalAppPath(pathWithQuery: string): string {
    return legacyRedirectTarget(pathWithQuery) ?? pathWithQuery;
}

const URL_ATTR = /\b(?:href|action|formaction)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const DATA_ATTR = /\bdata-[a-z0-9_-]+\s*=\s*("([^"]*)"|'([^']*)')/gi;

function pathsInValue(value: string, out: Set<string>): void {
    const trimmed = value.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return;
    const pathPart = trimmed.split(/[\s#]/, 1)[0] ?? trimmed;
    if (isLegacyPathname(pathPart.split("?")[0] ?? pathPart)) {
        out.add(pathPart);
    }
    const fromParam = /(?:^|[?&])from=([^&]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = fromParam.exec(value)) !== null) {
        try {
            const decoded = decodeURIComponent(m[1] ?? "");
            if (decoded.startsWith("/")) {
                const legacy = legacyRedirectTarget(decoded);
                if (legacy) out.add(decoded);
            }
        } catch {
            /* ignore bad escape */
        }
    }
}

export function findLegacyLinks(html: string): string[] {
    const found = new Set<string>();
    for (const re of [URL_ATTR, DATA_ATTR]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
            const val = m[2] ?? m[3] ?? "";
            pathsInValue(val, found);
        }
    }
    return [...found].sort();
}
