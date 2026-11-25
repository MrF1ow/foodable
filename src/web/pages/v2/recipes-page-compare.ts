/**
 * Compare versions (FigCraft 402803 and its Light and desktop twins): for the
 * owner and admins, how each person's version of a recipe differs from the
 * base, and what to do about it.
 *
 * "Different from base" lists each ingredient that differs, with the base
 * amount and every person's. "People" lists each member with how many
 * changes they have, and a version's ⋯ has Align to base, Make theirs the
 * base and Delete their version. Align to base and Delete take back the
 * person's rows (the reset route, which wants the rows this page showed);
 * Make theirs the base pushes one change at a time into the base (the align
 * route) from a sheet that lists them.
 */
import type {
    VersionDifference,
    VersionsCompare,
} from "../../../domain/recipe-variants.js";
import type { AppChromeBase } from "../../attention.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { button } from "../../components/v2/button.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { initialsOf } from "../../initials.js";
import { renderAppShell } from "../../shell.js";

/** A member of the household, as the page lists them. */
export type ComparePerson = {
    userId: string;
    name: string;
    /** Their picture's version, when they have one (the profile-pictures flag). */
    picture?: Date | number | null;
    /**
     * The rows a reset takes back, as the compare read named them. The
     * reset route wants exactly these back, so it can tell the person saved
     * again since.
     */
    resetRowKeys?: readonly string[];
};

export type RecipeCompareV2View = {
    chrome: AppChromeBase;
    recipeId: string;
    recipeName: string;
    compare: VersionsCompare;
    /** Every member of the household, in the order they are listed. */
    people: readonly ComparePerson[];
    error?: string;
    /**
     * Whose Make-theirs-the-base sheet is open on load (after one of their
     * changes was used, with more still to use).
     */
    openFor?: string;
};

type LineQuantity = { amount: number; unit: string } | null;

function quantityLabel(q: LineQuantity): string {
    return q ? formatQuantityDisplayParts(q.amount, q.unit) : "to taste";
}

/** What one change says for the person it belongs to ("Mia 10 oz"). */
function personPart(name: string, d: VersionDifference): string {
    switch (d.kind) {
        case "removed":
            return `${name} none`;
        case "amount":
            return `${name} ${quantityLabel(d.version)}`;
        case "swapped":
            return `${name} ${d.foodName} ${quantityLabel(d.version)}`;
        case "added":
            return `${name} ${quantityLabel(d.version)}`;
    }
}

export type CompareLine = { key: string; title: string; subtitle: string };

/**
 * The "Different from base" rows: one per ingredient the people differ on,
 * in the base's order, then the foods people added. The subtitle is the
 * base amount and then each person's.
 */
export function compareLines(
    compare: VersionsCompare,
    names: ReadonlyMap<string, string>,
): CompareLine[] {
    const lines: CompareLine[] = [];
    for (const base of compare.base) {
        const parts: string[] = [];
        for (const version of compare.versions) {
            const name = names.get(version.userId) ?? "";
            for (const d of version.differences) {
                if (d.ingredientId === base.ingredientId) {
                    parts.push(personPart(name, d));
                }
            }
        }
        if (parts.length === 0) continue;
        lines.push({
            key: base.ingredientId,
            title: base.displayName,
            subtitle: [`Base ${quantityLabel(base.quantity)}`, ...parts].join(
                " · ",
            ),
        });
    }
    // Added lines of one food are one row, whoever added them.
    const added = new Map<string, { title: string; parts: string[] }>();
    for (const version of compare.versions) {
        const name = names.get(version.userId) ?? "";
        for (const d of version.differences) {
            if (d.kind !== "added") continue;
            const key = d.foodId ?? d.displayName.trim().toLowerCase();
            const row = added.get(key) ?? { title: d.displayName, parts: [] };
            row.parts.push(personPart(name, d));
            added.set(key, row);
        }
    }
    for (const [key, row] of added) {
        lines.push({
            key: `added:${key}`,
            title: row.title,
            subtitle: ["Not in base", ...row.parts].join(" · "),
        });
    }
    return lines;
}

/** "2 changes · 1 added": a change is to a base line; an added line is its own count. */
export function changeSummary(
    differences: readonly VersionDifference[],
): string {
    const added = differences.filter((d) => d.kind === "added").length;
    const n = differences.length - added;
    return [
        ...(n > 0 ? [`${n} ${n === 1 ? "change" : "changes"}`] : []),
        ...(added > 0 ? [`${added} added`] : []),
    ].join(" · ");
}

export function makeBaseSheetId(userId: string): string {
    return `fd-compare-base-${userId}`;
}

/** What a change says in the Make-the-base sheet: the base, then theirs. */
function changeDetail(name: string, d: VersionDifference): string {
    if (d.kind === "added") return `Not in base · ${personPart(name, d)}`;
    if (d.kind === "removed") return `Base ${quantityLabel(d.base)}`;
    return `Base ${quantityLabel(d.base)} · ${personPart(name, d)}`;
}

/**
 * The changes align can push into the base: an amount, a swap or an added
 * line. A removal is not one (take the ingredient out of the recipe itself).
 */
function alignable(
    differences: readonly VersionDifference[],
): Exclude<VersionDifference, { kind: "removed" }>[] {
    return differences.filter(
        (d): d is Exclude<VersionDifference, { kind: "removed" }> =>
            d.kind !== "removed",
    );
}

function makeBaseSheet(
    recipeId: string,
    person: ComparePerson,
    differences: readonly VersionDifference[],
    openOnLoad: boolean,
): string {
    const rows = alignable(differences).map((d) =>
        itemRow({
            title: d.displayName,
            subtitle: changeDetail(person.name, d),
            trailing: {
                kind: "control",
                html: raw(
                    `<form class="fd-inline-form" method="post" action="/recipes/${esc(recipeId)}/versions/align"><input type="hidden" name="user_id" value="${esc(person.userId)}"><input type="hidden" name="ingredient_id" value="${esc(d.ref)}"><input type="hidden" name="row_key" value="${esc(d.rowKey)}"><input type="hidden" name="back" value="compare">${button({ label: "Use", size: "md", type: "submit", attrs: { title: `Use ${person.name}'s ${d.displayName}` } })}</form>`,
                ),
            },
        }),
    );
    return sheet({
        id: makeBaseSheetId(person.userId),
        placement: "dialog",
        openOnLoad,
        header: { kind: "title", title: `Make ${person.name}'s the base` },
        body: sheetSection({
            kind: "rows",
            content: listGroup({
                rows,
                label: `${person.name}'s changes`,
            }),
        }),
    });
}

function personMenu(
    recipeId: string,
    person: ComparePerson,
    differences: readonly VersionDifference[],
): Html {
    const reset = {
        action: `/recipes/${recipeId}/versions/reset`,
        fields: {
            user_id: person.userId,
            confirm: "1",
            back: "compare",
            row_keys: person.resetRowKeys ?? [],
        },
    };
    const items: MenuItem[] = [
        {
            kind: "destructive",
            plain: true,
            label: `Align ${person.name} to base`,
            confirmLabel: "Align",
            ...reset,
        },
    ];
    if (alignable(differences).length > 0) {
        items.push({
            kind: "opens",
            label: `Make ${person.name}'s the base`,
            sheetId: makeBaseSheetId(person.userId),
        });
    }
    items.push({
        kind: "destructive",
        label: `Delete ${person.name}'s version`,
        confirmLabel: "Delete",
        ...reset,
    });
    return menu({
        label: `Actions for ${person.name}`,
        anchor: "more",
        items,
    });
}

function personRow(
    recipeId: string,
    person: ComparePerson,
    differences: readonly VersionDifference[] | null,
): Html {
    return itemRow({
        title: person.name,
        subtitle: differences ? changeSummary(differences) : "No version yet",
        lead: {
            kind: "avatar",
            initials: initialsOf(person.name),
            picture:
                person.picture != null
                    ? { userId: person.userId, version: person.picture }
                    : undefined,
        },
        ...(differences
            ? {
                  trailing: {
                      kind: "control" as const,
                      html: personMenu(recipeId, person, differences),
                  },
              }
            : {}),
    });
}

export function renderRecipeCompareBody(view: RecipeCompareV2View): string {
    const names = new Map(view.people.map((p) => [p.userId, p.name]));
    const lines = compareLines(view.compare, names);
    const byPerson = new Map(
        view.compare.versions.map((v) => [v.userId, v.differences]),
    );
    const bar = detailBar({
        title: "Compare versions",
        back: { href: `/recipes/${view.recipeId}`, label: "Back to recipe" },
        balance: true,
    });
    const error = view.error
        ? `<p class="fd-recipe-error" role="alert">${esc(view.error)}</p>`
        : "";
    const differing =
        lines.length > 0
            ? listGroup({
                  rows: lines.map((line) =>
                      itemRow({
                          title: line.title,
                          subtitle: line.subtitle,
                      }),
                  ),
                  label: "Different from base",
              })
            : raw(`<p class="fd-recipe-empty">Everyone uses the base.</p>`);
    const left = raw(
        `<p class="fd-recipe-caption fd-recipe-compare-name">${esc(view.recipeName)}</p><div class="fd-recipe-group">${String(
            sectionHeader({ label: "Different from base", rule: false }),
        )}${String(differing)}</div>`,
    );
    const right = raw(
        `<div class="fd-recipe-group">${String(sectionHeader({ label: "People", rule: false }))}${String(
            listGroup({
                rows: view.people.map((person) =>
                    personRow(
                        view.recipeId,
                        person,
                        byPerson.get(person.userId) ?? null,
                    ),
                ),
                label: "People",
            }),
        )}</div>`,
    );
    const sheets = view.people
        .map((person) => {
            const differences = byPerson.get(person.userId);
            return differences && alignable(differences).length > 0
                ? makeBaseSheet(
                      view.recipeId,
                      person,
                      differences,
                      person.userId.toLowerCase() === view.openFor,
                  )
                : "";
        })
        .join("\n");
    const layout = pageLayout({
        layout: "two-columns",
        className: "fd-recipe-layout fd-recipe-compare-layout",
        header: join([bar, raw(error)]),
        left,
        right,
    });
    return `<div class="fd-recipe-detail fd-recipe-compare">
${String(layout)}
${sheets}
</div>`;
}

export function renderRecipeCompareV2Page(view: RecipeCompareV2View): string {
    return renderAppShell({
        ...view.chrome,
        title: "Compare versions",
        active: "none",
        body: renderRecipeCompareBody(view),
    });
}
