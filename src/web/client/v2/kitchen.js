// Kitchen page scripts: the Fridge's Use soon cards, the Add searches of the Fridge and Groceries, the Expires chips, the usual rows, and the Add a usual tabs. The row sheets open from `[data-fd-sheet-row]` (today.js).
function openSheet(id) {
    const dialog = document.getElementById(id);
    if (!dialog || typeof dialog.showModal !== "function" || dialog.open)
        return;
    dialog.showModal();
}

// A Use soon card opens its item's sheet; the link under it still works with
// no script (the page reopens with that item's sheet showing).
document.addEventListener("click", (event) => {
    const card = event.target?.closest?.("[data-fd-open-item]");
    if (!card) return;
    const dialog = document.getElementById(
        card.getAttribute("data-fd-open-item") || "",
    );
    if (!dialog || typeof dialog.showModal !== "function") return;
    event.preventDefault();
    openSheet(dialog.id);
});

// Add to fridge and Add to list: the search box narrows the usuals as it is
// typed; with no match the hand form is the way on. Each sheet names its
// input, its rows and its "no match" line.
const ADD_SEARCHES = [
    {
        input: "#fd-fridge-add-q",
        name: "#fd-fridge-add-name",
        rows: "[data-fd-fridge-usual]",
        rowAttr: "data-fd-fridge-usual",
        none: "[data-fd-fridge-none]",
    },
    {
        input: "#fd-grocery-add-q",
        name: "#fd-grocery-add-name",
        rows: "[data-fd-grocery-usual]",
        rowAttr: "data-fd-grocery-usual",
        none: "[data-fd-grocery-none]",
    },
];

function initAddSearch(root) {
    ADD_SEARCHES.forEach((spec) => {
        root.querySelectorAll(spec.input).forEach((input) => {
            if (input.dataset.fdAddSearchInit === "1") return;
            input.dataset.fdAddSearchInit = "1";
            const sheet = input.closest("dialog");
            if (!sheet) return;
            // What was searched for is what Add it by hand starts with, until
            // the Name is typed in by hand.
            const name = sheet.querySelector(spec.name);
            let nameTyped = false;
            if (name) {
                name.addEventListener("input", () => {
                    nameTyped = true;
                });
            }
            input.addEventListener("input", () => {
                if (name && !nameTyped) name.value = input.value.trim();
                const q = input.value.trim().toLowerCase();
                let shown = 0;
                sheet.querySelectorAll(spec.rows).forEach((row) => {
                    const hit =
                        q === "" ||
                        (row.getAttribute(spec.rowAttr) || "").includes(q);
                    row.hidden = !hit;
                    if (hit) shown += 1;
                });
                const none = sheet.querySelector(spec.none);
                if (none) none.hidden = q === "" || shown > 0;
            });
        });
    });
}

// The Expires chips set the one date field the form posts: keeping restores the
// date the item has, No date clears it, Pick a date shows the field.
function initExpires(root) {
    root.querySelectorAll("[data-fd-expires]").forEach((host) => {
        if (host.dataset.fdExpiresInit === "1") return;
        host.dataset.fdExpiresInit = "1";
        const input = host.querySelector('input[type="date"]');
        if (!input) return;
        const keep = host.getAttribute("data-fd-expires-keep") || "";
        host.addEventListener("change", (event) => {
            const radio = event.target;
            if (!radio || !radio.name.startsWith("expires_mode")) return;
            if (radio.value === "keep") input.value = keep;
            else if (radio.value === "none") input.value = "";
            else input.focus();
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
        initAddSearch(root);
        initExpires(root);
    }
    if (root.querySelector(".fd-kitchen-groceries-page")) {
        initAddSearch(root);
        initExpires(root);
    }
    if (root.querySelector(".fd-kitchen-usuals-page")) {
        initUsualRows(root);
        syncUsualUnitLabels(root);
        syncUsualProductRows(root);
    }
});

// Clear checked confirms in place: its button only arms the row (the dock, or
// a sheet's action row), and Cancel and the verb ("Clear 3") take its place.
function setConfirmArmed(row, armed, focus) {
    row.querySelectorAll(
        "[data-fd-confirm-arm],[data-fd-confirm-idle]",
    ).forEach((el) => (el.hidden = armed));
    row.querySelectorAll(
        "[data-fd-confirm-cancel],[data-fd-confirm-go]",
    ).forEach((el) => (el.hidden = !armed));
    const next = focus
        ? row.querySelector(
              armed ? "[data-fd-confirm-cancel]" : "[data-fd-confirm-arm]",
          )
        : null;
    if (next) next.focus();
}

document.addEventListener("click", (event) => {
    const control = event.target?.closest?.(
        "[data-fd-confirm-arm],[data-fd-confirm-cancel]",
    );
    const row = control?.closest("[data-fd-confirm]");
    if (!row) return;
    event.preventDefault();
    setConfirmArmed(row, control.hasAttribute("data-fd-confirm-arm"), true);
});

// A sheet that closes puts its row back, so it opens on the idle buttons.
document.addEventListener(
    "close",
    (event) => {
        event.target
            ?.querySelectorAll?.("[data-fd-confirm]")
            .forEach((row) => setConfirmArmed(row, false, false));
    },
    true,
);

// A Store or Section pull-down in a line's sheet saves its own pick. The
// amount and note typed in the sheet and not yet saved go with it.
document.addEventListener(
    "submit",
    (event) => {
        const form = event.target;
        if (!form?.classList?.contains("fd-menu__form")) return;
        const edit = form
            .closest("dialog")
            ?.querySelector("form[data-fd-line-edit]");
        if (!edit) return;
        const sent = new Set(new FormData(form).keys());
        new FormData(edit).forEach((value, name) => {
            if (sent.has(name) || typeof value !== "string") return;
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = value;
            form.append(input);
        });
    },
    true,
);
