function navQuery(from?: string): string {
    if (!from || from === "/") return "";
    return `?from=${encodeURIComponent(from)}`;
}

export function subnav(input: {
    label: string;
    sections: readonly { id: string; href: string; label: string }[];
    active: string;
    query?: string;
}): string {
    const suffix = input.query ?? "";
    const links = input.sections
        .map((section) => {
            const current =
                section.id === input.active ? ' aria-current="page"' : "";
            return `<a href="${section.href}${suffix}"${current}>${section.label}</a>`;
        })
        .join("");
    return `<nav class="subnav" aria-label="${input.label}">${links}</nav>`;
}

/** The phone has no Household tab, so Settings links to the members page too.
 *  "Household" stays the preferences page; the members page is "Members", as
 *  in the household sub-nav. */
const SETTINGS_SECTIONS = [
    { id: "account", href: "/settings", label: "Account" },
    {
        id: "household",
        href: "/settings/household-settings",
        label: "Household",
    },
    { id: "members", href: "/settings/household", label: "Members" },
    { id: "help", href: "/settings/help", label: "Help" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function renderSettingsNav(
    active: SettingsSection,
    from?: string,
): string {
    return subnav({
        label: "Settings sections",
        sections: SETTINGS_SECTIONS,
        active,
        query: navQuery(from),
    });
}

const HOUSEHOLD_SECTIONS = [
    { id: "members", href: "/settings/household", label: "Members" },
    { id: "items", href: "/settings/household/items", label: "Items" },
    {
        id: "usual-products",
        href: "/kitchen/usuals",
        label: "Usual products",
    },
] as const;

export type HouseholdSection =
    (typeof HOUSEHOLD_SECTIONS)[number]["id"] | "possible-duplicates";

export function renderHouseholdNav(
    active: HouseholdSection,
    opts?: { possibleDuplicates?: number },
): string {
    const count = opts?.possibleDuplicates ?? 0;
    const sections: { id: string; href: string; label: string }[] = [
        ...HOUSEHOLD_SECTIONS,
    ];
    if (count > 0) {
        const badge =
            count > 0 ? ` <span class="pill pill-dim">${count}</span>` : "";
        sections.push({
            id: "possible-duplicates",
            href: "/settings/household/possible-duplicates",
            label: `Possible duplicates${badge}`,
        });
    }
    return subnav({
        label: "Household sections",
        sections,
        active,
    });
}
