/**
 * Routes reopen a shared dialog with `<prefix><itemId>` (for example
 * `fridge-edit-<id>`). When that item is on the page, the caller pre-fills
 * the one dialog and reports `openModalId` to `pageLevelErrorBanner` so the
 * error is not repeated under the header. An unknown id returns null and the
 * page banner stays.
 */
export type SharedDialogMatch<T> = {
    item: T;
    openModalId: string;
};

export function sharedDialogItem<T>(opts: {
    openModalId?: string;
    prefix: string;
    lookup: (id: string) => T | null | undefined;
}): SharedDialogMatch<T> | null {
    const openModalId = opts.openModalId;
    if (!openModalId?.startsWith(opts.prefix)) return null;
    const id = openModalId.slice(opts.prefix.length);
    if (id.length === 0) return null;
    const item = opts.lookup(id);
    if (item == null) return null;
    return { item, openModalId };
}
