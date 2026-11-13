// Select several rows, act once (Groceries, Fridge, Usuals, Saved foods &
// recipes). The markup is src/web/pages/v2/select-mode.ts and the row's
// checkbox (components/v2/rows.ts); this is the behaviour. A list root
// `[data-fd-select="<scope>"]` holds the rows, the "N selected" bar and the
// confirm sheets; its Select button `[data-fd-select-toggle="<scope>"]` may sit
// outside it.
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

function sync(root) {
    const n = picked(root).length;
    root.querySelectorAll("[data-fd-select-count]").forEach((el) => {
        el.textContent = `${n} selected`;
    });
    root.querySelectorAll("[data-fd-select-action]").forEach((el) => {
        el.disabled = n === 0;
    });
    root.querySelectorAll("[data-fd-select-message]").forEach((el) => {
        el.textContent = countMessage(
            n,
            el.getAttribute("data-one") || "",
            el.getAttribute("data-many") || "",
        );
    });
}

function setSelecting(root, on) {
    if (on) root.setAttribute("data-fd-selecting", "");
    else root.removeAttribute("data-fd-selecting");
    const bar = root.querySelector("[data-fd-select-bar]");
    if (bar) bar.hidden = !on;
    togglesFor(root.getAttribute("data-fd-select")).forEach((el) => {
        el.hidden = on;
    });
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
            setSelecting(root, true);
            const first = boxes(root)[0];
            if (first) first.focus();
            return;
        }
        const cancel = target.closest("[data-fd-select-cancel]");
        if (cancel) {
            const root = cancel.closest(ROOT);
            if (!root) return;
            setSelecting(root, false);
            const back = togglesFor(root.getAttribute("data-fd-select"))[0];
            if (back) back.focus();
            return;
        }
        const row = target.closest("[data-fd-select-row]");
        if (!row) return;
        const root = row.closest(ROOT);
        if (!root || !root.hasAttribute("data-fd-selecting")) return;
        // A row only picks in select mode: nothing in it opens, follows or submits.
        event.stopPropagation();
        // The box's own tap is the checkbox's to toggle.
        if (target.closest(".fd-row__select")) return;
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
            document
                .querySelectorAll("[data-fd-selecting]")
                .forEach((root) => setSelecting(root, false));
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
