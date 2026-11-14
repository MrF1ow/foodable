import type { GroceryLine, GroceryListStore } from "./grocery.js";
import { findSection } from "./grocery-lines.js";
import {
    renameSection,
    sameName,
    SettingsInputError,
    storeNameTaken,
    type GrocerySection,
    type GroceryStore,
    type SettingsStore,
} from "./settings.js";

/** Renames a store. A name another store of the household has is refused. */
export async function renameStore(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
    name: string,
): Promise<GroceryStore> {
    const trimmed = name.trim();
    if (!trimmed) throw new SettingsInputError("Enter a store name.");
    const stores = await settings.listStores(householdId);
    const current = stores.find((row) => row.id === storeId);
    if (!current) throw new SettingsInputError("Unknown store.");
    if (storeNameTaken(stores, trimmed, storeId)) {
        throw new SettingsInputError("That store already exists.");
    }
    const updated = await settings.updateStore({ ...current, name: trimmed });
    if (!updated) throw new SettingsInputError("Unknown store.");
    return updated;
}

async function storeSections(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
): Promise<GrocerySection[]> {
    const stores = await settings.listStores(householdId);
    if (!stores.some((row) => row.id === storeId)) {
        throw new SettingsInputError("Unknown store.");
    }
    return settings.listSections(storeId);
}

/** Writes dense positions 0..n-1 for the given order, only where one changed. */
async function writeSectionOrder(
    settings: SettingsStore,
    ordered: readonly GrocerySection[],
): Promise<void> {
    for (const [index, row] of ordered.entries()) {
        if (row.sortOrder === index) continue;
        await settings.updateSection({ ...row, sortOrder: index });
    }
}

/**
 * Adds a section to a store, just before its Other section so Other stays the
 * last stop of the walk.
 */
export async function addSection(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
    name: string,
): Promise<GrocerySection> {
    const trimmed = name.trim();
    if (!trimmed) throw new SettingsInputError("Enter a section name.");
    const existing = await storeSections(settings, householdId, storeId);
    if (existing.some((row) => sameName(row.name, trimmed))) {
        throw new SettingsInputError("That section already exists.");
    }
    const created = await settings.insertSection({
        id: crypto.randomUUID(),
        householdId,
        storeId,
        name: trimmed,
        // Past every current position; the dense rewrite below settles it.
        sortOrder: existing.length,
        hidden: false,
        isOther: false,
    });
    const otherIndex = existing.findIndex((row) => row.isOther);
    const ordered =
        otherIndex < 0
            ? [...existing, created]
            : [
                  ...existing.slice(0, otherIndex),
                  created,
                  ...existing.slice(otherIndex),
              ];
    await writeSectionOrder(settings, ordered);
    return (await settings.getSection(householdId, created.id)) ?? created;
}

/**
 * Reorders a store's visible sections. `orderedIds` must be exactly the
 * sections that are neither hidden nor Other, each once. They fill the slots
 * those sections already held, so hidden sections keep their place and Other
 * stays last.
 */
export async function reorderSections(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
    orderedIds: readonly string[],
): Promise<GrocerySection[]> {
    const all = await storeSections(settings, householdId, storeId);
    const movable = all.filter((row) => !row.hidden && !row.isOther);
    const known = new Set(movable.map((row) => row.id));
    const seen = new Set<string>();
    for (const id of orderedIds) {
        if (!known.has(id)) throw new SettingsInputError("Unknown section.");
        if (seen.has(id)) {
            throw new SettingsInputError("A section is listed twice.");
        }
        seen.add(id);
    }
    if (seen.size !== known.size) {
        throw new SettingsInputError("List every section once.");
    }
    const byId = new Map(movable.map((row) => [row.id, row] as const));
    let next = 0;
    const ordered = all.map((row) =>
        row.hidden || row.isOther ? row : byId.get(orderedIds[next++]!)!,
    );
    await writeSectionOrder(settings, ordered);
    return settings.listSections(storeId);
}

/** Hides or shows a section. The Other section is the fallback, so it stays. */
export async function setSectionHidden(
    settings: SettingsStore,
    householdId: string,
    sectionId: string,
    hidden: boolean,
): Promise<GrocerySection> {
    const current = await settings.getSection(householdId, sectionId);
    if (!current) throw new SettingsInputError("Unknown section.");
    if (hidden && current.isOther) {
        throw new SettingsInputError("The Other section cannot be hidden.");
    }
    const updated = await settings.updateSection({ ...current, hidden });
    if (!updated) throw new SettingsInputError("Unknown section.");
    return updated;
}

export type GroceryLineCounts = {
    byStore: Map<string, number>;
    bySection: Map<string, number>;
};

/** How many lines are on the list per store and per section ("5 on the list"). */
export function groceryLineCounts(
    lines: readonly Pick<GroceryLine, "storeId" | "sectionId">[],
): GroceryLineCounts {
    const byStore = new Map<string, number>();
    const bySection = new Map<string, number>();
    for (const line of lines) {
        byStore.set(line.storeId, (byStore.get(line.storeId) ?? 0) + 1);
        bySection.set(line.sectionId, (bySection.get(line.sectionId) ?? 0) + 1);
    }
    return { byStore, bySection };
}

/**
 * The up/down buttons of an order form: `move` is "<id>:up" or "<id>:down".
 * Returns the order with that one id moved a step; an id already at the edge,
 * an id not in the list or a malformed `move` leaves the order as it was.
 */
export function applyOrderMove(ids: readonly string[], move: string): string[] {
    const cut = move.lastIndexOf(":");
    const next = [...ids];
    if (cut < 0) return next;
    const id = move.slice(0, cut);
    const direction = move.slice(cut + 1);
    const from = next.indexOf(id);
    const to =
        direction === "up" ? from - 1 : direction === "down" ? from + 1 : -1;
    if (from < 0 || to < 0 || to >= next.length) return next;
    [next[from], next[to]] = [next[to]!, next[from]!];
    return next;
}

/**
 * Where "Move N lines to …" sends a deleted store's lines: the default store
 * when it is another store, else the first other store. Null when the store
 * is the only one, so the only choice left is deleting its lines.
 */
export function deleteMoveTarget(
    stores: readonly GroceryStore[],
    storeId: string,
    defaultStoreId: string | null,
): GroceryStore | null {
    const others = stores.filter((row) => row.id !== storeId);
    return others.find((row) => row.id === defaultStoreId) ?? others[0] ?? null;
}

/** The one settings write removing a section needs. */
export type SectionRemovalStore = Pick<SettingsStore, "deleteSection">;

export type SectionRemovalPlan = {
    storeId: string;
    /** Where the removed sections' lines go. */
    otherSectionId: string;
    removals: { section: GrocerySection; lineIds: string[] }[];
};

/**
 * Pure plan for removing sections of one store. Their lines move to the
 * store's Other section; Other itself stays, since it is where lines with no
 * section land.
 */
export function planSectionRemoval(input: {
    storeId: string;
    sectionIds: readonly string[];
    /** The store's sections. */
    sections: readonly GrocerySection[];
    lines: readonly Pick<GroceryLine, "id" | "storeId" | "sectionId">[];
}): SectionRemovalPlan {
    const other = input.sections.find((row) => row.isOther);
    if (!other)
        throw new SettingsInputError("That store has no Other section.");
    const removals: SectionRemovalPlan["removals"] = [];
    for (const id of new Set(input.sectionIds)) {
        const section = input.sections.find((row) => row.id === id);
        if (!section) throw new SettingsInputError("Unknown section.");
        if (section.isOther) {
            throw new SettingsInputError(
                "The Other section cannot be removed.",
            );
        }
        removals.push({
            section,
            lineIds: input.lines
                .filter(
                    (row) =>
                        row.storeId === input.storeId && row.sectionId === id,
                )
                .map((row) => row.id),
        });
    }
    return { storeId: input.storeId, otherSectionId: other.id, removals };
}

/**
 * Step one of a removal: moves each removed section's lines to Other. Returns
 * how many lines moved. A line that vanished since the plan was read fails
 * the whole call. The sections are still there, so a caller that records them
 * does so between this and `deleteRemovedSections`.
 */
export async function moveRemovedSectionLines(
    grocery: Pick<GroceryListStore, "listLines" | "updateLine">,
    householdId: string,
    plan: SectionRemovalPlan,
): Promise<number> {
    const lines = await grocery.listLines(householdId);
    let moved = 0;
    for (const { lineIds } of plan.removals) {
        for (const id of lineIds) {
            const line = lines.find((row) => row.id === id);
            if (!line) {
                throw new SettingsInputError("The list changed. Try again.");
            }
            await grocery.updateLine({
                ...line,
                sectionId: plan.otherSectionId,
            });
            moved += 1;
        }
    }
    return moved;
}

/** Step two: deletes the planned sections, which no longer hold a line. */
export async function deleteRemovedSections(
    removal: SectionRemovalStore,
    householdId: string,
    plan: SectionRemovalPlan,
): Promise<void> {
    for (const { section } of plan.removals) {
        if (!(await removal.deleteSection(householdId, section.id))) {
            throw new SettingsInputError("The list changed. Try again.");
        }
    }
}

/**
 * Several changes to one store's sections in one go, applied in this order:
 * remove, add, rename, hide, show, order. Sections are named by id or by name
 * in any case; each step sees the result of the steps before it.
 */
export type SectionsChange = {
    /** Their lines move to the store's Other section. */
    remove?: readonly string[];
    /** New sections, placed before Other. */
    add?: readonly string[];
    rename?: readonly { section: string; name: string }[];
    hide?: readonly string[];
    show?: readonly string[];
    /**
     * The visible sections to put first, in order. The rest keep their order,
     * hidden ones keep their place and Other stays last.
     */
    order?: readonly string[];
};

/** A section of the plan: one the store has, or the nth one the plan adds. */
export type SectionRef = { id: string } | { added: number };

export type SectionsChangePlan = {
    storeId: string;
    /** Sections to remove, with the lines that move to Other. Empty when none. */
    removal: SectionRemovalPlan;
    /** Names of the sections to add, trimmed, in order. */
    add: string[];
    /** Only real renames: a name that is already the section's own is left out. */
    rename: { ref: SectionRef; from: string; to: string }[];
    /** Only sections that are shown now. */
    hide: { ref: SectionRef; name: string }[];
    /** Only sections that are hidden now. */
    show: { ref: SectionRef; name: string }[];
    /**
     * Every visible section other than Other in its final order, ready for
     * `reorderSections`; null when the change does not order.
     */
    order: SectionRef[] | null;
};

type PlannedSection = {
    ref: SectionRef;
    name: string;
    hidden: boolean;
    isOther: boolean;
};

const sameSection = (a: SectionRef, b: SectionRef): boolean =>
    "id" in a
        ? "id" in b && a.id === b.id
        : "added" in b && a.added === b.added;

/**
 * Pure plan for a `SectionsChange` to one store: resolves every named section,
 * expands a partial order, refuses what the app refuses (Other cannot be
 * removed or hidden, hidden sections and Other cannot be ordered) and writes
 * nothing. It refuses a new name (an added section, or the target of a rename)
 * that another section holds when the call starts, even one the same call
 * removes or renames away: undo puts that section back under its old name
 * beside the new one, and the store takes a name once. The caller makes two
 * calls instead.
 */
export function planStoreSectionsChange(input: {
    storeId: string;
    storeName: string;
    /** The store's sections as they are now, in order. */
    sections: readonly GrocerySection[];
    lines: readonly Pick<GroceryLine, "id" | "storeId" | "sectionId">[];
    change: SectionsChange;
}): SectionsChangePlan {
    const { storeId, storeName, sections, change } = input;
    const missing = (ref: string) =>
        new SettingsInputError(`${storeName} has no section "${ref}".`);

    const goneSections = (change.remove ?? []).map((ref) => {
        const found = findSection(sections, ref);
        if (!found) throw missing(ref);
        return found;
    });
    const removal = planSectionRemoval({
        storeId,
        sectionIds: goneSections.map((row) => row.id),
        sections,
        lines: input.lines,
    });
    const goneIds = new Set(removal.removals.map((row) => row.section.id));

    // What the store looks like after each step, as the writes will leave it.
    const working: PlannedSection[] = sections
        .filter((row) => !goneIds.has(row.id))
        .map((row) => ({
            ref: { id: row.id },
            name: row.name,
            hidden: row.hidden,
            isOther: row.isOther,
        }));
    const find = (
        list: readonly PlannedSection[],
        ref: string,
    ): PlannedSection | undefined => {
        const trimmed = ref.trim();
        return (
            list.find((row) => "id" in row.ref && row.ref.id === trimmed) ??
            list.find((row) => sameName(row.name, trimmed))
        );
    };
    const resolve = (ref: string): PlannedSection => {
        const found = find(working, ref);
        if (!found) throw missing(ref);
        return found;
    };

    const add: string[] = [];
    for (const raw of change.add ?? []) {
        const name = raw.trim();
        if (!name) throw new SettingsInputError("Enter a section name.");
        const created: PlannedSection = {
            ref: { added: add.length },
            name,
            hidden: false,
            isOther: false,
        };
        add.push(name);
        const at = working.findIndex((row) => row.isOther);
        if (at < 0) working.push(created);
        else working.splice(at, 0, created);
    }

    const rename: SectionsChangePlan["rename"] = [];
    for (const edit of change.rename ?? []) {
        const target = edit.name.trim();
        if (!target) throw new SettingsInputError("Enter a section name.");
        const section = resolve(edit.section);
        if (section.name === target) continue;
        rename.push({ ref: section.ref, from: section.name, to: target });
        section.name = target;
    }

    const hide: SectionsChangePlan["hide"] = [];
    for (const ref of change.hide ?? []) {
        const section = resolve(ref);
        if (section.isOther) {
            throw new SettingsInputError("The Other section cannot be hidden.");
        }
        if (section.hidden) continue;
        section.hidden = true;
        hide.push({ ref: section.ref, name: section.name });
    }
    const show: SectionsChangePlan["show"] = [];
    for (const ref of change.show ?? []) {
        const section = resolve(ref);
        if (!section.hidden) continue;
        section.hidden = false;
        show.push({ ref: section.ref, name: section.name });
    }

    let order: SectionRef[] | null = null;
    if (change.order?.length) {
        const movable = working.filter((row) => !row.hidden && !row.isOther);
        const first: PlannedSection[] = [];
        for (const ref of change.order) {
            const found = find(movable, ref);
            if (!found) {
                const known = find(working, ref);
                throw known
                    ? new SettingsInputError(
                          `${known.name} cannot be ordered: ${known.isOther ? "Other always stays last" : "it is hidden"}.`,
                      )
                    : missing(ref);
            }
            if (first.includes(found)) {
                throw new SettingsInputError("A section is listed twice.");
            }
            first.push(found);
        }
        order = [
            ...first,
            ...movable.filter((row) => !first.includes(row)),
        ].map((row) => row.ref);
    }

    // Every name the call gives a section, checked against the names held when
    // it starts. A rename's own section may keep its name in another case.
    const touched = (section: GrocerySection) =>
        goneIds.has(section.id) ||
        rename.some((row) => "id" in row.ref && row.ref.id === section.id);
    const claimed = new Set<string>();
    const targets: { name: string; ref: SectionRef | null }[] = [
        ...add.map((name, index) => ({
            name,
            ref: { added: index } as SectionRef,
        })),
        ...rename.map((row) => ({ name: row.to, ref: row.ref })),
    ];
    for (const target of targets) {
        const holder = sections.find(
            (row) =>
                sameName(row.name, target.name) &&
                !(target.ref && sameSection(target.ref, { id: row.id })),
        );
        if (holder) {
            throw new SettingsInputError(
                touched(holder)
                    ? `${storeName} has a section named "${holder.name}" when this call starts, and this call also removes or renames it. Undo could not put it back beside a new "${target.name}". Split it into two calls: first remove or rename "${holder.name}", then add or rename to "${target.name}".`
                    : "That section already exists.",
            );
        }
        const key = target.name.toLowerCase();
        if (claimed.has(key)) {
            throw new SettingsInputError(
                `The section name "${target.name}" is used twice in this call.`,
            );
        }
        claimed.add(key);
    }

    return { storeId, removal, add, rename, hide, show, order };
}

/**
 * Applies everything in a plan except the removal (`moveRemovedSectionLines`
 * and `deleteRemovedSections` do that, so a caller that records can step in
 * between): adds, renames, hides, shows and orders. `added` is called with
 * each section as it is created, before the next write.
 */
export async function applySectionEdits(
    settings: SettingsStore,
    householdId: string,
    plan: SectionsChangePlan,
    hooks: { added?: (section: GrocerySection) => void } = {},
): Promise<{ added: GrocerySection[] }> {
    const added: GrocerySection[] = [];
    for (const name of plan.add) {
        const created = await addSection(
            settings,
            householdId,
            plan.storeId,
            name,
        );
        hooks.added?.(created);
        added.push(created);
    }
    const idOf = (ref: SectionRef): string =>
        "id" in ref ? ref.id : added[ref.added]!.id;
    for (const row of plan.rename) {
        await renameSection(settings, householdId, idOf(row.ref), row.to);
    }
    for (const row of plan.hide) {
        await setSectionHidden(settings, householdId, idOf(row.ref), true);
    }
    for (const row of plan.show) {
        await setSectionHidden(settings, householdId, idOf(row.ref), false);
    }
    if (plan.order) {
        await reorderSections(
            settings,
            householdId,
            plan.storeId,
            plan.order.map(idOf),
        );
    }
    return { added };
}

/** Whether a name, a position or hidden changed on any section. */
export function sectionsChanged(
    before: readonly GrocerySection[],
    after: readonly GrocerySection[],
): boolean {
    const signature = (list: readonly GrocerySection[]) =>
        JSON.stringify(
            list.map((row) => [row.id, row.name, row.sortOrder, row.hidden]),
        );
    return signature(before) !== signature(after);
}

/**
 * The renames a call made, as they net out: a section renamed away and back
 * has none, and one renamed twice has one, from its name at the start to its
 * name at the end. A section the call added is named as it was added.
 */
export function netRenames(
    plan: SectionsChangePlan["rename"],
    before: readonly GrocerySection[],
    after: readonly GrocerySection[],
): { from: string; to: string }[] {
    const out: { from: string; to: string }[] = [];
    const seen = new Set<string>();
    for (const row of plan) {
        if (!("id" in row.ref)) {
            out.push({ from: row.from, to: row.to });
            continue;
        }
        const id = row.ref.id;
        if (seen.has(id)) continue;
        seen.add(id);
        const first = before.find((section) => section.id === id);
        const last = after.find((section) => section.id === id);
        if (first && last && first.name !== last.name) {
            out.push({ from: first.name, to: last.name });
        }
    }
    return out;
}

/** Whether the sections that were there before and still are changed their relative order. */
export function sectionsReordered(
    before: readonly GrocerySection[],
    after: readonly GrocerySection[],
): boolean {
    const kept = (
        list: readonly GrocerySection[],
        other: readonly GrocerySection[],
    ) =>
        list
            .filter((row) => other.some((old) => old.id === row.id))
            .map((row) => row.id);
    return (
        JSON.stringify(kept(before, after)) !==
        JSON.stringify(kept(after, before))
    );
}
