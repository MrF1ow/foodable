// Settings › Stores: drag a row's handle to reorder (the order form submits on
// release), put focus back on an up/down arrow after its press reloaded the
// page, and focus the field of an add row when it opens. Without this script
// the arrows and the add rows still work through the server.

const dragForms = new WeakSet();
const addRows = new WeakSet();

// Pure: where `id` lands when dropped at `y`; `mids` are the items' midpoints.
function reorderByPointer(ids, id, y, mids) {
    const from = ids.indexOf(id);
    if (from < 0) return ids.slice();
    const others = ids.filter((_, i) => i !== from);
    const otherMids = mids.filter((_, i) => i !== from);
    let index = 0;
    for (const mid of otherMids) {
        if (mid < y) index += 1;
    }
    others.splice(index, 0, id);
    return others;
}

// Pure: the move button to refocus: the pressed `<id>:<dir>`, or its row's other arrow when that end is disabled.
function moveFocusTarget(buttons, wanted) {
    const flip =
        wanted.slice(0, wanted.lastIndexOf(":")) +
        (wanted.endsWith(":up") ? ":down" : ":up");
    for (const value of [wanted, flip]) {
        const hit = buttons.find((b) => b.value === value && !b.disabled);
        if (hit) return hit;
    }
    return null;
}

// Pure: the ⋯ of section row `fd-section-<id>`, or null.
function sectionTrigger(rows, id) {
    const row = rows.find((el) => el.id === "fd-section-" + id);
    return row ? row.querySelector("[data-fd-menu-trigger]") : null;
}

// The server redirects an arrow press to `?reorder=1&focus=<id>:<dir>` and a section's ⋯ move to `?focus=<section id>`: refocus that, then drop `focus` (`reorder` is the mode and stays).
function restoreMoveFocus(root, win) {
    const url = new URL(win.location.href);
    const params = url.searchParams;
    const wanted = params.get("focus");
    if (wanted === null) return;
    const hit =
        moveFocusTarget(
            Array.from(root.querySelectorAll('button[name="move"]')),
            wanted,
        ) ||
        sectionTrigger(
            Array.from(root.querySelectorAll('[id^="fd-section-"]')),
            wanted,
        );
    if (hit) hit.focus();
    params.delete("focus");
    win.history.replaceState(
        win.history.state,
        "",
        url.pathname + url.search + url.hash,
    );
}

if (typeof window !== "undefined" && window.FOODABLE_EXPOSE_STORES) {
    window.FOODABLE_EXPOSE_STORES({
        reorderByPointer,
        moveFocusTarget,
        sectionTrigger,
        restoreMoveFocus,
        focusAutofocus,
    });
}

function itemId(item) {
    const field = item.querySelector('input[name="order"]');
    return field ? field.value : "";
}

function midpoint(item) {
    const box = item.getBoundingClientRect();
    return box.top + box.height / 2;
}

function initDragForm(form) {
    if (dragForms.has(form)) return;
    const list = form.querySelector("[data-fd-order-list]");
    if (!list) return;
    dragForms.add(form);

    const items = () =>
        Array.prototype.filter
            .call(
                list.children,
                (el) =>
                    el.hasAttribute && el.hasAttribute("data-fd-order-item"),
            )
            .filter((el) => itemId(el) !== "");

    list.addEventListener("pointerdown", (event) => {
        const handle =
            event.target && event.target.closest
                ? event.target.closest("[data-fd-order-handle]")
                : null;
        if (!handle || (event.button != null && event.button > 0)) return;
        const item = handle.closest("[data-fd-order-item]");
        if (!item || itemId(item) === "") return;
        event.preventDefault();
        const id = itemId(item);
        const before = items().map(itemId);
        item.setAttribute("data-fd-dragging", "");

        // On the window: moving the row drops the handle's pointer capture.
        const onMove = (move) => {
            const rows = items();
            const ids = rows.map(itemId);
            const next = reorderByPointer(
                ids,
                id,
                move.clientY,
                rows.map(midpoint),
            );
            if (next.join("|") === ids.join("|")) return;
            const at = next.indexOf(id);
            const after = next[at + 1];
            const reference = rows.find((row) => itemId(row) === after) || null;
            list.insertBefore(item, reference);
        };
        const finish = (cancelled) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            item.removeAttribute("data-fd-dragging");
            const now = items().map(itemId);
            if (cancelled) {
                const byId = new Map(items().map((row) => [itemId(row), row]));
                for (const key of before) list.appendChild(byId.get(key));
                return;
            }
            if (now.join("|") !== before.join("|")) {
                if (typeof form.requestSubmit === "function")
                    form.requestSubmit();
                else form.submit();
            }
        };
        const onUp = () => finish(false);
        const onCancel = () => finish(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
    });
}

function initAddRow(details) {
    if (addRows.has(details)) return;
    addRows.add(details);
    details.addEventListener("toggle", () => {
        if (!details.open) return;
        const input = details.querySelector("input");
        if (input) input.focus();
    });
}

// A field the server asked to be focused (Rename, a row being renamed): Turbo
// drops `autofocus` from a page it renders, so the field also carries `data-fd-autofocus` and the page does, unless the person is
// already typing in a field (a menu item or link that led here may still hold focus).
function focusAutofocus(root) {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (
        active &&
        active.matches &&
        active.matches("input, textarea, select, [contenteditable]")
    ) {
        return;
    }
    const field = root.querySelector("[data-fd-autofocus]:not([disabled])");
    if (field) field.focus();
}

function initStores(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    if (typeof root.querySelector === "function") focusAutofocus(root);
    root.querySelectorAll("[data-fd-order-form]").forEach(initDragForm);
    root.querySelectorAll("details[data-fd-add-row]").forEach(initAddRow);
    if (window.location) restoreMoveFocus(root, window);
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initStores);
    } else if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initStores(document),
            );
        } else {
            initStores(document);
        }
    }
}
