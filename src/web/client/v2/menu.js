// The anchored menu (src/web/components/v2/menu.ts, `[data-fd-menu]`): a ⋯ or
// Filter button opens a panel of items. Closes on Escape and on a tap outside,
// arrow keys move between items, focus goes back to the trigger, and a
// destructive item confirms in place (Cancel + the same verb, no popup).
// The `<details>` menu (settings-duplicates) has no `[data-fd-menu]` and is
// never touched here. Binding is idempotent per menu (a WeakSet), so Turbo
// re-running onLoad on a morph never double-binds.

const bound = new WeakSet();
let documentBound = false;
const EDGE = 8; // px kept clear of the screen edge when flipping the panel

const panelOf = (root) => root.querySelector(".fd-menu__panel");
const triggerOf = (root) => root.querySelector("[data-fd-menu-trigger]");
const isOpen = (root) => {
    const panel = panelOf(root);
    return !!panel && !panel.hidden;
};

function items(root) {
    const panel = panelOf(root);
    if (!panel) return [];
    return Array.from(
        panel.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]'),
    ).filter((el) => !el.disabled && !el.closest("[hidden]"));
}

function resetConfirms(root) {
    root.querySelectorAll("[data-fd-menu-confirm]").forEach((box) => {
        const arm = box.querySelector("[data-fd-menu-arm]");
        const row = box.querySelector(".fd-menu__confirm-row");
        if (arm) arm.hidden = false;
        if (row) row.hidden = true;
    });
}

// A sheet clips what hangs out of it (its own overflow, and its scrolling
// body), so a panel inside one is placed on the screen instead: fixed, under
// the trigger when the room below fits it, else above, else on the side with
// more room, scrolling inside itself.
function placeInSheet(root, panel) {
    delete panel.dataset.align;
    delete panel.dataset.side;
    panel.dataset.fixed = "";
    panel.style.maxHeight = "";
    panel.style.left = "0px";
    panel.style.top = "0px";
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const box = root.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.scrollHeight;
    const gap = 4;
    const left = Math.max(EDGE, Math.min(box.right - width, vw - EDGE - width));
    // A centred dialog card ends above the screen's bottom edge: a panel that
    // would hang past the card opens above the row instead, as the design draws
    // it. A bottom sheet ends at the screen edge, so this changes nothing there.
    const sheet = root.closest(".fd-sheet");
    const sheetBottom =
        sheet && typeof sheet.getBoundingClientRect === "function"
            ? sheet.getBoundingClientRect().bottom
            : vh;
    const below = Math.min(vh, sheetBottom) - EDGE - (box.bottom + gap);
    const above = box.top - gap - EDGE;
    const under = height <= below || (height > above && below >= above);
    const room = Math.floor(under ? below : above);
    const used = Math.min(height, room);
    if (height > room) panel.style.maxHeight = room + "px";
    panel.style.left = left + "px";
    panel.style.top = (under ? box.bottom + gap : box.top - gap - used) + "px";
}

// Right-aligned under the trigger; flipped to start when that fits the screen
// better, and above the trigger when it would leave the bottom. When neither
// side fits, the side with more room is used and the panel is clamped inside
// the screen margin.
function place(root) {
    const panel = panelOf(root);
    const trigger = triggerOf(root);
    if (!panel || !trigger) return;
    if (root.closest(".fd-sheet")) {
        placeInSheet(root, panel);
        return;
    }
    delete panel.dataset.fixed;
    panel.style.top = "";
    delete panel.dataset.align;
    delete panel.dataset.side;
    panel.style.left = "";
    panel.style.right = "";
    panel.style.maxHeight = "";
    // Measured before any flip: a panel hanging off an edge would widen the
    // layout viewport and hide its own overflow.
    const vw = document.documentElement.clientWidth;
    const box = root.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const fits = (left) => left >= EDGE && left + rect.width <= vw - EDGE;
    if (!fits(rect.left)) {
        if (fits(box.left)) {
            panel.dataset.align = "start";
        } else {
            const startRoom = vw - EDGE - box.left;
            const endRoom = box.right - EDGE;
            const startSide = startRoom > endRoom;
            if (startSide) panel.dataset.align = "start";
            const left = Math.max(
                EDGE,
                Math.min(
                    startSide ? box.left : rect.left,
                    vw - EDGE - rect.width,
                ),
            );
            panel.style.right = "auto";
            panel.style.left = left - box.left + "px";
        }
    }
    // Below the trigger by default; above it when it would leave the bottom and
    // there is more room there. A panel taller than the room scrolls inside
    // itself, so it never runs off the screen.
    const now = panel.getBoundingClientRect();
    if (now.bottom > window.innerHeight - EDGE) {
        const above = trigger.getBoundingClientRect().top - EDGE;
        const below = window.innerHeight - EDGE - now.top;
        const top = above >= now.height || above > below;
        if (top) panel.dataset.side = "top";
        const room = top ? above : below;
        if (now.height > room) panel.style.maxHeight = Math.floor(room) + "px";
    }
}

function close(root, restoreFocus) {
    const panel = panelOf(root);
    const trigger = triggerOf(root);
    if (!panel || panel.hidden) return;
    resetConfirms(root);
    panel.hidden = true;
    if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
        if (restoreFocus) trigger.focus();
    }
}

function closeAll(except, restoreFocus) {
    document.querySelectorAll("[data-fd-menu]").forEach((root) => {
        if (root !== except) close(root, restoreFocus);
    });
}

function open(root, focusFirst) {
    const panel = panelOf(root);
    const trigger = triggerOf(root);
    if (!panel || !trigger) return;
    closeAll(root, false);
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    place(root);
    if (focusFirst) {
        const first = items(root)[0];
        if (first) first.focus();
    }
}

function move(root, from, step) {
    const list = items(root);
    if (list.length === 0) return;
    const at = list.indexOf(from);
    let next;
    if (step === "first") next = 0;
    else if (step === "last") next = list.length - 1;
    else if (at < 0) next = step > 0 ? 0 : list.length - 1;
    else next = (at + step + list.length) % list.length;
    list[next].focus();
}

function arm(root, box) {
    const armButton = box.querySelector("[data-fd-menu-arm]");
    const row = box.querySelector(".fd-menu__confirm-row");
    if (!armButton || !row) return;
    resetConfirms(root);
    armButton.hidden = true;
    row.hidden = false;
    const cancel = row.querySelector("[data-fd-menu-cancel]");
    if (cancel) cancel.focus();
}

function disarm(root, box) {
    resetConfirms(root);
    const armButton = box.querySelector("[data-fd-menu-arm]");
    if (armButton) armButton.focus();
}

// A shared sheet serves every row of a long list: the item that opens it says
// what the sheet holds (`data-fd-menu-set`, JSON): control name → value, an
// array ticking a checkbox group, and `@action` for the form's action. A
// refusal the sheet was showing was for the row that opened it before, so it
// goes; a group marked `data-fd-menu-not="<name>"` leaves out the choice that
// is the value of that control (the food being merged in cannot be kept).
function clearRefusals(dialog) {
    dialog
        .querySelectorAll(".fd-settings-error, .fd-field__error")
        .forEach((el) => el.remove());
    dialog.querySelectorAll(".fd-field--invalid").forEach((el) => {
        el.classList.remove("fd-field--invalid");
        const input = el.querySelector("[aria-invalid]");
        if (input) {
            input.removeAttribute("aria-invalid");
            input.removeAttribute("aria-describedby");
        }
    });
}

function fillSheet(dialog, spec) {
    let values;
    try {
        values = JSON.parse(spec);
    } catch (_e) {
        return;
    }
    if (!values || typeof values !== "object") return;
    clearRefusals(dialog);
    for (const [name, value] of Object.entries(values)) {
        if (name === "@action") {
            const form = dialog.querySelector("form");
            if (form) form.setAttribute("action", String(value));
            continue;
        }
        dialog.querySelectorAll("[name]").forEach((control) => {
            if (control.getAttribute("name") !== name) return;
            if (control.type === "checkbox" || control.type === "radio") {
                control.checked = Array.isArray(value)
                    ? value.includes(control.value)
                    : control.value === String(value);
            } else {
                control.value = value == null ? "" : String(value);
            }
        });
    }
    dialog.querySelectorAll("[data-fd-menu-not]").forEach((group) => {
        const source = group.getAttribute("data-fd-menu-not");
        const excluded = values[source];
        group.querySelectorAll("li").forEach((row) => {
            const input = row.querySelector("input");
            row.hidden =
                !!input && excluded != null && input.value === String(excluded);
        });
    });
}

function bindMenu(root) {
    if (bound.has(root)) return;
    bound.add(root);
    const trigger = triggerOf(root);
    const panel = panelOf(root);
    if (!trigger || !panel) return;

    trigger.addEventListener("click", (event) => {
        if (isOpen(root)) {
            close(root, true);
        } else {
            // detail 0 is a keyboard activation: move into the menu.
            open(root, event.detail === 0);
        }
    });

    root.addEventListener("keydown", (event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey) return;
        const key = event.key;
        if (event.target === trigger) {
            if (key === "ArrowDown" || key === "ArrowUp") {
                event.preventDefault();
                if (!isOpen(root)) open(root, false);
                move(root, null, key === "ArrowDown" ? "first" : "last");
            }
            return;
        }
        if (!panel.contains(event.target)) return;
        if (key === "ArrowDown") {
            event.preventDefault();
            move(root, event.target, 1);
        } else if (key === "ArrowUp") {
            event.preventDefault();
            move(root, event.target, -1);
        } else if (key === "Home") {
            event.preventDefault();
            move(root, event.target, "first");
        } else if (key === "End") {
            event.preventDefault();
            move(root, event.target, "last");
        } else if (key === "Tab") {
            // Focus carries on past the menu; the menu does not stay open.
            close(root, false);
        } else if (key === " " && event.target.tagName === "A") {
            // A link activates on Enter only; a menu item takes Space too.
            event.preventDefault();
            event.target.click();
        }
    });

    panel.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const item = target && target.closest(".fd-menu__item");
        if (!item || !panel.contains(item)) return;
        const box = item.closest("[data-fd-menu-confirm]");
        if (item.hasAttribute("data-fd-menu-arm") && box) {
            arm(root, box);
            return;
        }
        if (item.hasAttribute("data-fd-menu-cancel") && box) {
            disarm(root, box);
            return;
        }
        // The value already chosen (a pull-down's current tick) only closes
        // the menu: picking it again changes nothing, so nothing is posted.
        if (
            item.getAttribute("role") === "menuitemcheckbox" &&
            item.hasAttribute("data-fd-menu-close")
        ) {
            close(root, true);
            return;
        }
        // A pull-down that sets a field of the form around it (a store, a
        // unit): the choice goes in the hidden input and in the row, the ticks
        // follow it, and the menu closes. Nothing is posted until the form is.
        if (item.hasAttribute("data-fd-menu-value")) {
            const field = root.querySelector("[data-fd-menu-field]");
            if (field) {
                field.value = item.getAttribute("data-fd-menu-value") || "";
                items(root).forEach((other) => {
                    if (other.hasAttribute("data-fd-menu-value")) {
                        other.setAttribute(
                            "aria-checked",
                            other === item ? "true" : "false",
                        );
                    }
                });
                const shown = root.querySelector(".fd-item-row__value");
                const label = item.querySelector(".fd-menu__label");
                if (shown && label) shown.textContent = label.textContent;
                close(root, true);
                field.dispatchEvent(new Event("change", { bubbles: true }));
                return;
            }
        }
        // A tick that posts a form (a pull-down that saves its value) just submits.
        if (
            item.getAttribute("role") === "menuitemcheckbox" &&
            item.tagName === "BUTTON" &&
            item.type !== "submit"
        ) {
            const checked = item.getAttribute("aria-checked") !== "true";
            item.setAttribute("aria-checked", checked ? "true" : "false");
            item.dispatchEvent(
                new CustomEvent("fd-menu-select", {
                    bubbles: true,
                    detail: { checked },
                }),
            );
            return;
        }
        // An item that opens a sheet closes the menu behind it, and the sheet
        // gives focus back to the ⋯ when it closes (the item it came from is
        // hidden by then, so the browser's own return would land on the page).
        if (item.getAttribute("command") === "show-modal") {
            const dialog = document.getElementById(
                item.getAttribute("commandfor") || "",
            );
            close(root, false);
            const set = item.getAttribute("data-fd-menu-set");
            if (dialog && set) fillSheet(dialog, set);
            if (dialog) {
                dialog.addEventListener(
                    "close",
                    () => {
                        if (trigger.isConnected) trigger.focus();
                    },
                    { once: true },
                );
            }
            return;
        }
        // A button the page's script reads (Select) closes the menu; the
        // script acts on the same click.
        if (item.hasAttribute("data-fd-menu-close")) {
            close(root, false);
            return;
        }
        // A link or a submit leaves the page; the menu is closed as it goes.
        if (item.tagName === "A") close(root, false);
    });
}

function bindDocument() {
    if (documentBound) return;
    documentBound = true;
    // A fixed panel inside a sheet follows its trigger while the sheet's body
    // scrolls under it.
    document.addEventListener(
        "scroll",
        (event) => {
            const target =
                event.target instanceof Element ? event.target : null;
            document.querySelectorAll("[data-fd-menu]").forEach((root) => {
                const panel = panelOf(root);
                if (
                    isOpen(root) &&
                    panel &&
                    panel.dataset.fixed !== undefined &&
                    !(target && panel.contains(target))
                ) {
                    place(root);
                }
            });
        },
        true,
    );
    // A press outside every open menu closes it; focus stays where the person
    // put it.
    document.addEventListener("pointerdown", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        document.querySelectorAll("[data-fd-menu]").forEach((root) => {
            if (isOpen(root) && !(target && root.contains(target))) {
                close(root, false);
            }
        });
    });
    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key !== "Escape") return;
            let handled = false;
            document.querySelectorAll("[data-fd-menu]").forEach((root) => {
                if (!isOpen(root)) return;
                const wasInside = root.contains(document.activeElement);
                const resting =
                    !document.activeElement ||
                    document.activeElement === document.body;
                close(root, wasInside || resting);
                handled = true;
            });
            // An open menu takes the Escape; a dialog around it stays open.
            if (handled) event.preventDefault();
        },
        true,
    );
}

function initMenus(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("[data-fd-menu]").forEach(bindMenu);
    bindDocument();
}

if (typeof window !== "undefined") {
    if (window.FOODABLE_EXPOSE_MENU) {
        window.FOODABLE_EXPOSE_MENU({ fillSheet });
    }
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initMenus);
    } else if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initMenus(document),
            );
        } else {
            initMenus(document);
        }
    }
}
