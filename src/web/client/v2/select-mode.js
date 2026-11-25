// Select several rows, act once (Groceries, Fridge, Usuals, Saved foods &
// recipes). The markup is src/web/pages/v2/select-mode.ts and the row's
// checkbox (components/v2/rows.ts, item-row.ts); this is the behaviour. A list
// root `[data-fd-select="<scope>"]` holds the rows, the "N selected" bar (or the
// Selection bars) and the confirm sheets; its Select button or menu item
// `[data-fd-select-toggle="<scope>"]` may sit outside it.
//
// In select mode (`data-fd-selecting` on the root) a tap on a row ticks its
// box and nothing else (no sheet opens, no link follows, no swipe action
// fires), the bar shows the count and enables the actions, and each form of the
// list (`data-fd-select-form`) adds the ticked boxes as it is sent. Leaving the
// page or Cancel clears the picks: a page restored in select mode starts over.
// Delegated on the document, so Turbo visits need no re-binding.

const ROOT = "[data-fd-select]";

function rootFor(scope) {
    return (
        Array.from(document.querySelectorAll(ROOT)).find(
            (root) => root.getAttribute("data-fd-select") === scope,
        ) || null
    );
}

function togglesFor(scope) {
    return Array.from(
        document.querySelectorAll("[data-fd-select-toggle]"),
    ).filter((el) => el.getAttribute("data-fd-select-toggle") === scope);
}

const boxes = (root) =>
    Array.from(root.querySelectorAll("input[data-fd-select-item]"));
const picked = (root) => boxes(root).filter((box) => box.checked);

// Pure: "Delete 1 item?" for one, the many form with {n} filled in otherwise.
function countMessage(n, one, many) {
    return n === 1 ? one : many.replace("{n}", () => String(n));
}

// A message may carry a second wording for when a box of one field is among the
// picks (`data-if-name`, `data-if-one`, `data-if-many`).
function messageFor(root, el, n) {
    const name = el.getAttribute("data-if-name");
    const extra = name != null && picked(root).some((box) => box.name === name);
    return extra
        ? countMessage(
              n,
              el.getAttribute("data-if-one") || "",
              el.getAttribute("data-if-many") || "",
          )
        : countMessage(
              n,
              el.getAttribute("data-one") || "",
              el.getAttribute("data-many") || "",
          );
}

// A bar whose destructive action confirms in place (`data-fd-select-ask`)
// shows Cancel and the verb with the count in place of the action; the bar
// carries `data-fd-select-asking` while it does.
function setAsking(root, on) {
    root.querySelectorAll("[data-fd-select-bar]").forEach((bar) => {
        if (on) bar.setAttribute("data-fd-select-asking", "");
        else bar.removeAttribute("data-fd-select-asking");
    });
}

// Move focus to a button of the same bar as `from`: the bar swaps its buttons
// when it asks or stops asking, and the one that was focused is hidden.
function focusIn(from, selector) {
    const bar = from.closest("[data-fd-select-bar]");
    const next = bar && bar.querySelector(selector);
    if (next) next.focus();
}

function sync(root) {
    const n = picked(root).length;
    root.querySelectorAll("[data-fd-select-count]").forEach((el) => {
        el.textContent = `${n} selected`;
    });
    // The Selection bar's own count and the caps row above the list.
    root.querySelectorAll(
        ".fd-selection-bar__count, [data-fd-select-head] .fd-section-header__label",
    ).forEach((el) => {
        el.textContent = `${n} selected`;
    });
    root.querySelectorAll("[data-fd-select-verb]").forEach((el) => {
        const label = el.querySelector(".fd-btn__label");
        const verb = el.getAttribute("data-fd-select-verb") || "";
        if (label) label.textContent = n > 0 ? `${verb} ${n}` : verb;
    });
    root.querySelectorAll("[data-fd-select-action]").forEach((el) => {
        el.disabled = n === 0;
    });
    if (n === 0) setAsking(root, false);
    root.querySelectorAll("[data-fd-select-message]").forEach((el) => {
        el.textContent = messageFor(root, el, n);
    });
}

// A Select that lives in a menu (the Detail bar's ⋯) stays in it while picking,
// reading "Cancel selection", so the menu is never empty; any other Select
// button is hidden while the list is picking (the bar has Cancel).
const CANCEL_LABEL = "Cancel selection";

function labelOf(el) {
    return el.querySelector(".fd-menu__label");
}

function setToggle(el, on) {
    if (!el.closest("[data-fd-menu]")) {
        el.hidden = on;
        return;
    }
    const label = labelOf(el);
    if (!label) return;
    if (on && !el.hasAttribute("data-fd-select-label")) {
        el.setAttribute("data-fd-select-label", label.textContent || "");
    }
    label.textContent = on
        ? CANCEL_LABEL
        : el.getAttribute("data-fd-select-label") || label.textContent;
}

// Where focus goes when picking ends: the Select button, or the ⋯ that holds
// it. A page draws its ⋯ for the phone bar and for the desktop header and CSS
// shows one, so the one that is showing is the one that takes focus.
function focusToggle(scope) {
    const spots = togglesFor(scope).map((el) => {
        const menu = el.closest("[data-fd-menu]");
        return (menu && menu.querySelector("[data-fd-menu-trigger]")) || el;
    });
    const showing = spots.find(
        (el) =>
            typeof el.getClientRects !== "function" ||
            el.getClientRects().length > 0,
    );
    const spot = showing || spots[0];
    if (spot) spot.focus();
}

function setSelecting(root, on) {
    if (on) root.setAttribute("data-fd-selecting", "");
    else root.removeAttribute("data-fd-selecting");
    root.querySelectorAll(
        "[data-fd-select-bar], [data-fd-select-head]",
    ).forEach((el) => {
        el.hidden = !on;
    });
    if (!on) setAsking(root, false);
    togglesFor(root.getAttribute("data-fd-select")).forEach((el) =>
        setToggle(el, on),
    );
    if (!on) boxes(root).forEach((box) => (box.checked = false));
    sync(root);
}

function flip(root, row) {
    const box = row.querySelector("input[data-fd-select-item]");
    if (!box) return;
    box.checked = !box.checked;
    sync(root);
}

document.addEventListener(
    "click",
    (event) => {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        const toggle = target.closest("[data-fd-select-toggle]");
        if (toggle) {
            const root = rootFor(toggle.getAttribute("data-fd-select-toggle"));
            if (!root) return;
            // A Select in a menu is Cancel selection while picking.
            if (root.hasAttribute("data-fd-selecting")) {
                setSelecting(root, false);
                focusToggle(root.getAttribute("data-fd-select"));
                return;
            }
            setSelecting(root, true);
            const first = boxes(root).find((box) => !box.disabled);
            if (first) first.focus();
            return;
        }
        const ask = target.closest("[data-fd-select-ask]");
        if (ask) {
            const root = ask.closest(ROOT);
            if (root && picked(root).length > 0) {
                setAsking(root, true);
                // The button that had focus is hidden now: the question has it.
                focusIn(ask, "[data-fd-select-unask]");
            }
            return;
        }
        const unask = target.closest("[data-fd-select-unask]");
        if (unask) {
            const root = unask.closest(ROOT);
            if (root) {
                setAsking(root, false);
                focusIn(unask, "[data-fd-select-ask]");
            }
            return;
        }
        const cancel = target.closest("[data-fd-select-cancel]");
        if (cancel) {
            const root = cancel.closest(ROOT);
            if (!root) return;
            setSelecting(root, false);
            focusToggle(root.getAttribute("data-fd-select"));
            return;
        }
        const row = target.closest("[data-fd-select-row]");
        if (!row) return;
        const root = row.closest(ROOT);
        if (!root || !root.hasAttribute("data-fd-selecting")) return;
        // A row only picks in select mode: nothing in it opens, follows or submits.
        event.stopPropagation();
        // The box's own tap is the checkbox's to toggle.
        if (target.closest(".fd-row__select, .fd-item-row__select")) return;
        event.preventDefault();
        flip(root, row);
    },
    true,
);

document.addEventListener("change", (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (!target.hasAttribute("data-fd-select-item")) return;
    const root = target.closest(ROOT);
    if (root) sync(root);
});

document.addEventListener(
    "keydown",
    (event) => {
        if (event.key === "Escape") {
            // An open sheet takes Escape first.
            if (document.querySelector("dialog[open]")) return;
            // So does an anchored menu. Which listener runs first is up to
            // registration order: either the menu already closed and prevented
            // the event, or its panel is still showing.
            if (event.defaultPrevented) return;
            for (const menu of document.querySelectorAll("[data-fd-menu]")) {
                const panel = menu.querySelector(".fd-menu__panel");
                if (panel && !panel.hidden) return;
            }
            document.querySelectorAll("[data-fd-selecting]").forEach((root) => {
                setSelecting(root, false);
                // Where Cancel would have left focus.
                focusToggle(root.getAttribute("data-fd-select"));
            });
            return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        const row = event.target;
        if (!row || typeof row.hasAttribute !== "function") return;
        if (!row.hasAttribute("data-fd-select-row")) return;
        const root = row.closest(ROOT);
        if (!root || !root.hasAttribute("data-fd-selecting")) return;
        event.stopPropagation();
        event.preventDefault();
        flip(root, row);
    },
    true,
);

// The forms of the list sit outside the rows; the ticked boxes join them here.
document.addEventListener("formdata", (event) => {
    const form = event.target;
    if (!form || typeof form.hasAttribute !== "function") return;
    if (!form.hasAttribute("data-fd-select-form")) return;
    const root = form.closest(ROOT);
    if (!root) return;
    picked(root).forEach((box) => event.formData.append(box.name, box.value));
});

function resetAll() {
    document
        .querySelectorAll(ROOT)
        .forEach((root) => setSelecting(root, false));
}

if (typeof window !== "undefined") {
    if (window.FOODABLE_EXPOSE_SELECT_MODE) {
        window.FOODABLE_EXPOSE_SELECT_MODE({ countMessage });
    }
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(resetAll);
    }
}
