const SECTIONS = [
    { id: "account", href: "/settings", label: "Account" },
    { id: "household", href: "/settings/household", label: "Household" },
    { id: "foods", href: "/settings/foods", label: "Foods" },
    { id: "help", href: "/settings/help", label: "Help" },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]["id"];

/** Account / Household / Foods links, styled as a segmented control. */
export function renderSettingsNav(active: SettingsSection): string {
    const links = SECTIONS.map((section) => {
        const current = section.id === active ? ' aria-current="page"' : "";
        return `<a href="${section.href}"${current}>${section.label}</a>`;
    }).join("");
    return `<nav class="subnav" aria-label="Settings sections">${links}</nav>`;
}
