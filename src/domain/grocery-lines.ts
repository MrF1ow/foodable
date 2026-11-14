import { destinationSectionId } from "./grocery-stores.js";
import { canonicalUnitText } from "./quantity.js";
import {
    GroceryInputError,
    type GroceryLine,
    type GroceryListStore,
} from "./grocery.js";
import {
    sameName,
    type GrocerySection,
    type GroceryStore,
    type SettingsStore,
} from "./settings.js";

/**
 * Editing the grocery list as a whole: clearing it, moving lines between
 * stores and sections, changing one line. Each is a plan (a pure function that
 * reads and validates, and writes nothing) and an apply step, so a caller that
 * must record the rows first can do so between the two.
 */

type LineReads = Pick<GroceryListStore, "listLines">;
type PlacementReads = Pick<SettingsStore, "listStores" | "listSections">;

/** Where a line should end up. Either part may be left out. */
export type LineTarget = {
    /** The destination store; a line keeps its own store when this is left out. */
    storeId?: string;
    /** A section of the destination store, by name (any case) or id. */
    section?: string;
};

/** A line and the store and section it moves to. */
export type LinePlacement = {
    line: GroceryLine;
    storeId: string;
    sectionId: string;
};

/** Stores and each store's sections, read once for a plan. */
export type StoreLayout = {
    stores: readonly GroceryStore[];
    sectionsByStore: ReadonlyMap<string, readonly GrocerySection[]>;
};

export async function readStoreLayout(
    settings: PlacementReads,
    householdId: string,
): Promise<StoreLayout> {
    const stores = await settings.listStores(householdId);
    const lists = await Promise.all(
        stores.map((row) => settings.listSections(row.id)),
    );
    return {
        stores,
        sectionsByStore: new Map(
            stores.map((row, index) => [row.id, lists[index]!] as const),
        ),
    };
}

/** The section a reference names: its id, else its name in any case. */
export function findSection(
    sections: readonly GrocerySection[],
    ref: string,
): GrocerySection | undefined {
    const trimmed = ref.trim();
    return (
        sections.find((row) => row.id === trimmed) ??
        sections.find((row) => sameName(row.name, trimmed))
    );
}

function storeName(layout: StoreLayout, storeId: string): string {
    return layout.stores.find((row) => row.id === storeId)?.name ?? "the store";
}

/**
 * Where `line` goes. An explicit section must exist in the destination store;
 * without one, a line that changes store keeps its aisle by name and falls back
 * to the destination's Other section (`destinationSectionId`, the rule deleting
 * a store uses), and a line that stays put keeps its section.
 */
function placeLine(
    layout: StoreLayout,
    line: GroceryLine,
    target: LineTarget,
): LinePlacement {
    const storeId = target.storeId ?? line.storeId;
    if (!layout.stores.some((row) => row.id === storeId)) {
        throw new GroceryInputError("Unknown store.");
    }
    const to = layout.sectionsByStore.get(storeId) ?? [];
    const from = layout.sectionsByStore.get(line.storeId) ?? [];
    const section = target.section?.trim();
    if (section) {
        const found = findSection(to, section);
        if (!found) {
            const have = to.map((row) => row.name).join(", ");
            throw new GroceryInputError(
                `${storeName(layout, storeId)} has no section "${section}". Its sections: ${have || "none"}.`,
            );
        }
        return { line, storeId, sectionId: found.id };
    }
    if (storeId === line.storeId) {
        return { line, storeId, sectionId: line.sectionId };
    }
    return {
        line,
        storeId,
        sectionId: destinationSectionId(from, to, line),
    };
}

/** The lines `clear_grocery_list` removes: every line, or one store's. */
export function linesToClear(
    lines: readonly GroceryLine[],
    stores: readonly Pick<GroceryStore, "id">[],
    storeId?: string,
): GroceryLine[] {
    if (storeId === undefined) return [...lines];
    if (!stores.some((row) => row.id === storeId)) {
        throw new GroceryInputError("Unknown store.");
    }
    return lines.filter((row) => row.storeId === storeId);
}

export type LineMovePlan = {
    /** The lines that change place, with where they go. */
    moves: LinePlacement[];
    /** Lines named that are already where they should be. */
    unchanged: GroceryLine[];
    /** Ids that are not lines of this household. */
    notFound: string[];
};

/** Pure plan for moving lines to a store and/or a section. */
export function planLineMoves(input: {
    lines: readonly GroceryLine[];
    layout: StoreLayout;
    lineIds: readonly string[];
    target: LineTarget;
}): LineMovePlan {
    if (!input.target.storeId && !input.target.section?.trim()) {
        throw new GroceryInputError(
            "Say where to move the lines: a store, a section, or both.",
        );
    }
    const byId = new Map(input.lines.map((row) => [row.id, row] as const));
    const plan: LineMovePlan = { moves: [], unchanged: [], notFound: [] };
    for (const id of new Set(input.lineIds)) {
        const line = byId.get(id);
        if (!line) {
            plan.notFound.push(id);
            continue;
        }
        const placed = placeLine(input.layout, line, input.target);
        if (
            placed.storeId === line.storeId &&
            placed.sectionId === line.sectionId
        ) {
            plan.unchanged.push(line);
        } else {
            plan.moves.push(placed);
        }
    }
    return plan;
}

export async function planGroceryLineMoves(
    deps: { grocery: LineReads; settings: PlacementReads },
    householdId: string,
    lineIds: readonly string[],
    target: LineTarget,
): Promise<LineMovePlan & { layout: StoreLayout }> {
    const layout = await readStoreLayout(deps.settings, householdId);
    const plan = planLineMoves({
        lines: await deps.grocery.listLines(householdId),
        layout,
        lineIds,
        target,
    });
    return { ...plan, layout };
}

/** Writes the placements. A line that vanished since the plan fails the batch. */
export async function applyLinePlacements(
    grocery: Pick<GroceryListStore, "updateLine">,
    placements: readonly LinePlacement[],
): Promise<GroceryLine[]> {
    const moved: GroceryLine[] = [];
    for (const placed of placements) {
        const updated = await grocery.updateLine({
            ...placed.line,
            storeId: placed.storeId,
            sectionId: placed.sectionId,
        });
        if (!updated) {
            throw new GroceryInputError("The list changed. Try again.");
        }
        moved.push(updated);
    }
    return moved;
}

/** What `update_grocery_line` may change. Left out means left alone. */
export type LineEdit = LineTarget & {
    amount?: number;
    unit?: string;
    /** A note, or null (or blank) to remove it. */
    note?: string | null;
};

export type LineEditPlan = { before: GroceryLine; after: GroceryLine };

/** Pure plan for editing one line; `after` equals `before` when nothing changes. */
export function planLineEdit(input: {
    line: GroceryLine;
    layout: StoreLayout;
    edit: LineEdit;
}): LineEditPlan {
    const { line, edit } = input;
    if (
        edit.amount === undefined &&
        edit.unit === undefined &&
        edit.note === undefined &&
        edit.storeId === undefined &&
        edit.section === undefined
    ) {
        throw new GroceryInputError(
            "Nothing to change: pass an amount, unit, note, store or section.",
        );
    }
    let after: GroceryLine = line;
    if (edit.storeId !== undefined || edit.section !== undefined) {
        const placed = placeLine(input.layout, line, edit);
        after = {
            ...after,
            storeId: placed.storeId,
            sectionId: placed.sectionId,
        };
    }
    if (edit.amount !== undefined) {
        if (!Number.isFinite(edit.amount) || edit.amount <= 0) {
            throw new GroceryInputError("Enter an amount greater than zero.");
        }
        after = {
            ...after,
            quantity: { ...after.quantity, amount: edit.amount },
        };
    }
    if (edit.unit !== undefined) {
        const unit = canonicalUnitText(edit.unit);
        if (!unit) throw new GroceryInputError("Enter a unit.");
        after = { ...after, quantity: { ...after.quantity, unit } };
    }
    if (edit.note !== undefined) {
        const note = edit.note === null ? "" : edit.note.trim();
        after = { ...after, note: note === "" ? null : note };
    }
    return { before: line, after };
}

/** Reads the line and plans the edit; null when the household has no such line. */
export async function planGroceryLineEdit(
    deps: { grocery: LineReads; settings: PlacementReads },
    householdId: string,
    lineId: string,
    edit: LineEdit,
): Promise<(LineEditPlan & { layout: StoreLayout }) | null> {
    const line = (await deps.grocery.listLines(householdId)).find(
        (row) => row.id === lineId,
    );
    if (!line) return null;
    const layout = await readStoreLayout(deps.settings, householdId);
    return { ...planLineEdit({ line, layout, edit }), layout };
}

/** True when the edit changes anything a person can see. */
export function lineEditChanges(plan: LineEditPlan): boolean {
    const { before, after } = plan;
    return (
        before.storeId !== after.storeId ||
        before.sectionId !== after.sectionId ||
        before.quantity.amount !== after.quantity.amount ||
        before.quantity.unit !== after.quantity.unit ||
        before.note !== after.note
    );
}

export async function applyLineEdit(
    grocery: Pick<GroceryListStore, "updateLine">,
    plan: LineEditPlan,
): Promise<GroceryLine> {
    const updated = await grocery.updateLine(plan.after);
    if (!updated) {
        throw new GroceryInputError("The list changed. Try again.");
    }
    return updated;
}
