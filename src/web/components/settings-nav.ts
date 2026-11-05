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

const SETTINGS_SECTIONS = [
    { id: "account", href: "/settings", label: "Account" },
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
    { id: "members", href: "/household", label: "Members" },
    { id: "items", href: "/household/items", label: "Items" },
    {
        id: "usual-products",
        href: "/household/usual-products",
        label: "Usual products",
    },
] as const;

export type HouseholdSection = (typeof HOUSEHOLD_SECTIONS)[number]["id"];

export function renderHouseholdNav(active: HouseholdSection): string {
    return subnav({
        label: "Household sections",
        sections: HOUSEHOLD_SECTIONS,
        active,
    });
}
