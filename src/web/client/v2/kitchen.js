// Fridge rows open the item sheet on tap; swipe actions stay as real buttons.
function openSheet(id) {
    const dialog = document.getElementById(id);
    if (!dialog || typeof dialog.showModal !== "function" || dialog.open)
        return;
    dialog.showModal();
}

function initFridgeRows(root) {
    root.querySelectorAll("[data-fd-fridge-row]").forEach((row) => {
        if (row.dataset.fdFridgeRowInit === "1") return;
        row.dataset.fdFridgeRowInit = "1";
        const sheetId = row.getAttribute("data-sheet-id");
        if (!sheetId) return;
        const open = () => openSheet(sheetId);
        row.addEventListener("click", (e) => {
            if (e.target.closest("button, form, a.fd-swipe-btn")) return;
            open();
        });
        row.addEventListener("keydown", (e) => {
            if (e.target !== row) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
        });
    });
}

// A round action with data-fd-reveal shows its panel (Freeze asks for a
// date before it submits).
function initReveals(root) {
    root.querySelectorAll("[data-fd-reveal]").forEach((btn) => {
        if (btn.dataset.fdRevealInit === "1") return;
        btn.dataset.fdRevealInit = "1";
        btn.addEventListener("click", () => {
            const panel = document.getElementById(
                btn.getAttribute("data-fd-reveal") || "",
            );
            if (!panel) return;
            const show = panel.hidden;
            panel.hidden = !show;
            btn.setAttribute("aria-expanded", show ? "true" : "false");
            if (show) panel.querySelector("input[type='date']")?.focus();
        });
    });
}

function formatPutDateLabel(value) {
    if (!value) return "No date";
    const d = new Date(`${value}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

function initPutAwayDates(root) {
    root.querySelectorAll("[data-fd-put-date]").forEach((wrap) => {
        if (wrap.dataset.fdPutDateInit === "1") return;
        wrap.dataset.fdPutDateInit = "1";
        const input = wrap.querySelector(".fd-kitchen-put-date__input");
        const text = wrap.querySelector("[data-fd-put-date-text]");
        const btn = wrap.querySelector("[data-fd-put-date-btn]");
        if (!input || !text) return;
        const sync = () => {
            text.textContent = formatPutDateLabel(input.value);
        };
        input.addEventListener("change", sync);
        if (btn) {
            btn.addEventListener("click", (e) => {
                if (e.target === input) return;
                e.preventDefault();
                input.showPicker?.();
                input.click();
            });
        }
    });
}

// Overview grocery rows open the line on the Groceries tab.
function initOverviewGroceryRows(root) {
    root.querySelectorAll("[data-fd-grocery-line-href]").forEach((row) => {
        if (row.dataset.fdOverviewRowInit === "1") return;
        row.dataset.fdOverviewRowInit = "1";
        const href = row.getAttribute("data-fd-grocery-line-href");
        if (!href || !href.startsWith("/kitchen/groceries")) return;
        const go = () => {
            if (window.Turbo?.visit) window.Turbo.visit(href);
            else window.location.assign(href);
        };
        row.addEventListener("click", (e) => {
            if (e.target.closest("button, form, a")) return;
            go();
        });
        row.addEventListener("keydown", (e) => {
            if (e.target !== row) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                go();
            }
        });
    });
}

function syncUsualUnitLabels(root) {
    root.querySelectorAll("[data-fd-usual-unit]").forEach((select) => {
        if (select.dataset.fdUsualUnitInit === "1") return;
        select.dataset.fdUsualUnitInit = "1";
        const formId = select.getAttribute("form");
        const form = formId
            ? document.getElementById(formId)
            : select.closest("form");
        const unitEl = form?.querySelector(".fd-stepper__unit");
        if (!unitEl) return;
        const hiddenId = select.getAttribute("data-fd-usual-unit-target");
        const hidden = hiddenId ? document.getElementById(hiddenId) : null;
        const amount = form?.querySelector('input[name="usual_amount"]');
        const sync = () => {
            const opt = select.options[select.selectedIndex];
            if (opt) {
                // "No amount" sends neither amount nor unit.
                unitEl.textContent =
                    opt.value === "" ? "" : (opt.textContent ?? "");
                if (hidden) hidden.value = opt.value;
                if (amount) amount.disabled = opt.value === "";
            }
        };
        sync();
        select.addEventListener("change", sync);
    });
}

// The Product row shows the product picked in its picker before Save.
function syncUsualProductRows(root) {
    root.querySelectorAll(
        'input[type="radio"][name="product_food_id"]',
    ).forEach((radio) => {
        if (radio.dataset.fdProductSyncInit === "1") return;
        radio.dataset.fdProductSyncInit = "1";
        radio.addEventListener("change", () => {
            const picker = radio.closest("dialog");
            if (!picker?.id || !radio.checked) return;
            const meta = document.querySelector(
                `[commandfor="${CSS.escape(picker.id)}"] .fd-kitchen-sheet-row__meta`,
            );
            const label = radio.closest("label")?.textContent?.trim();
            if (meta && label) meta.textContent = label;
        });
    });
}

function initUsualRows(root) {
    root.querySelectorAll("[data-fd-usual-row]").forEach((row) => {
        if (row.dataset.fdUsualRowInit === "1") return;
        row.dataset.fdUsualRowInit = "1";
        const sheetId = row.getAttribute("data-sheet-id");
        if (!sheetId) return;
        const open = () => openSheet(sheetId);
        row.addEventListener("click", (e) => {
            if (e.target.closest("button, form, a.fd-swipe-btn")) return;
            e.preventDefault();
            open();
        });
        row.addEventListener("keydown", (e) => {
            if (e.target !== row) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
        });
    });
}

function initGroceryRows(root) {
    root.querySelectorAll("[data-fd-grocery-row]").forEach((row) => {
        if (row.dataset.fdGroceryRowInit === "1") return;
        row.dataset.fdGroceryRowInit = "1";
        const sheetId = row.getAttribute("data-sheet-id");
        if (!sheetId) return;
        const open = () => openSheet(sheetId);
        row.addEventListener("click", (e) => {
            if (e.target.closest("button, form, a.fd-swipe-btn")) return;
            open();
        });
        row.addEventListener("keydown", (e) => {
            if (e.target !== row) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
        });
    });
}

// Add a usual: Scan, Search and Type it are tabs of one sheet. The server
// renders the right one selected and the others `hidden`; this swaps them.
const USUAL_ADD_TAB = "[data-fd-usual-add-tab]";

function selectUsualAddTab(dialog, tab) {
    dialog.querySelectorAll(USUAL_ADD_TAB).forEach((button) => {
        const on = button.getAttribute("data-fd-usual-add-tab") === tab;
        button.setAttribute("aria-selected", on ? "true" : "false");
        button.setAttribute("tabindex", on ? "0" : "-1");
    });
    dialog.querySelectorAll("[data-fd-usual-add-panel]").forEach((panel) => {
        panel.hidden = panel.getAttribute("data-fd-usual-add-panel") !== tab;
    });
}

document.addEventListener("click", (event) => {
    const button = event.target?.closest?.(USUAL_ADD_TAB);
    const dialog = button?.closest("dialog");
    if (!button || !dialog) return;
    selectUsualAddTab(dialog, button.getAttribute("data-fd-usual-add-tab"));
});

// Arrow keys move between the tabs, as a tablist does.
document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const current = event.target?.closest?.(USUAL_ADD_TAB);
    const dialog = current?.closest("dialog");
    if (!current || !dialog) return;
    const tabs = Array.from(dialog.querySelectorAll(USUAL_ADD_TAB));
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next =
        tabs[(tabs.indexOf(current) + step + tabs.length) % tabs.length];
    if (!next) return;
    event.preventDefault();
    selectUsualAddTab(dialog, next.getAttribute("data-fd-usual-add-tab"));
    next.focus();
});

// Typing a name for a new food picks "A new food" for the person.
document.addEventListener("input", (event) => {
    const input = event.target?.closest?.("[data-fd-usual-add-newname]");
    const form = input?.closest("form");
    const radio = form?.querySelector('input[name="food_choice"][value="new"]');
    if (radio) radio.checked = true;
});

window.FoodableApp.onLoad((root) => {
    if (root.querySelector(".fd-kitchen-fridge-page")) {
        initFridgeRows(root);
        initReveals(root);
        initOverviewGroceryRows(root);
    }
    if (root.querySelector(".fd-kitchen-groceries-page")) {
        initGroceryRows(root);
        initPutAwayDates(root);
    }
    if (root.querySelector(".fd-kitchen-usuals-page")) {
        initUsualRows(root);
        syncUsualUnitLabels(root);
        syncUsualProductRows(root);
    }
});
