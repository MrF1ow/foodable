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
