// Kitchen page scripts: the Fridge's Use soon cards, the Add searches of the Fridge and Groceries, the Expires chips, the Usuals' unit, product and Add a usual pieces. The row sheets open from `[data-fd-sheet-row]` (today.js).
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
    // Add a usual: the box narrows the foods listed; Enter searches them all.
    {
        input: "#fd-usual-add-q",
        name: "#fd-usual-add-none-name",
        rows: "[data-fd-usual-food]",
        rowAttr: "data-fd-usual-food",
        none: "[data-fd-usual-none]",
        serverSearch: true,
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
                // Only the first foods are listed: when none of them match and
                // more exist, ask the server, which searches them all.
                if (spec.serverSearch) {
                    clearTimeout(input._fdServerSearch);
                    if (
                        q !== "" &&
                        shown === 0 &&
                        sheet.querySelector("[data-fd-usual-more]")
                    ) {
                        input._fdServerSearch = setTimeout(() => {
                            if (input.value.trim() !== "") {
                                input.form?.requestSubmit();
                            }
                        }, 400);
                    }
                }
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

// The unit pull-down of a usual's amount names the stepper's unit; "No amount"
// sends neither an amount nor a unit.
function syncUsualUnit(field) {
    const form = field.closest("form");
    const unitEl = form?.querySelector(".fd-stepper-control__unit");
    const amount = form?.querySelector('input[name="usual_amount"]');
    const checked = field
        .closest("[data-fd-menu]")
        ?.querySelector('[aria-checked="true"] .fd-menu__label');
    const value = field.value;
    if (unitEl) {
        // "No amount" leaves the figure bare.
        unitEl.textContent =
            value === "" ? "" : (checked?.textContent ?? value);
    }
    if (amount) amount.disabled = value === "";
}

function initUsualUnits(root) {
    root.querySelectorAll('[data-fd-menu-field][name="usual_unit"]').forEach(
        (field) => {
            if (field.dataset.fdUsualUnitInit === "1") return;
            field.dataset.fdUsualUnitInit = "1";
            syncUsualUnit(field);
            field.addEventListener("change", () => syncUsualUnit(field));
        },
    );
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
            const value = document.querySelector(
                `[commandfor="${CSS.escape(picker.id)}"] .fd-item-row__value`,
            );
            const label = radio
                .closest(".fd-item-row")
                ?.querySelector(".fd-item-row__title")
                ?.textContent?.trim();
            if (value && label) value.textContent = label;
        });
    });
}

// The picker's search box narrows the products listed as it is typed.
function initUsualProductSearch(root) {
    root.querySelectorAll("[data-fd-usual-product-search] input").forEach(
        (input) => {
            if (input.dataset.fdProductSearchInit === "1") return;
            input.dataset.fdProductSearchInit = "1";
            const sheet = input.closest("dialog");
            input.addEventListener("input", () => {
                const q = input.value.trim().toLowerCase();
                sheet
                    ?.querySelectorAll("[data-fd-usual-product]")
                    .forEach((row) => {
                        row.hidden =
                            q !== "" &&
                            !(
                                row.getAttribute("data-fd-usual-product") || ""
                            ).includes(q);
                    });
            });
            // The box is not a form: Enter must not submit the sheet's page.
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") event.preventDefault();
            });
        },
    );
}

// Add a usual: Search your foods and Type it are two views of one sheet. The
// server renders the right one showing and the others `hidden`; the quick
// actions swap them. (Scan a barcode opens the scanner, not a view.)
// Restock: "Weeks between" shows only while "Every N weeks" is chosen. With no
// script it always shows, and the form posts the same fields either way.
function syncRestockWeeks(form) {
    const box = form.querySelector("[data-fd-restock-weeks]");
    const chosen = form.querySelector('input[name="restock_schedule"]:checked');
    if (box) box.hidden = chosen?.value !== "every_n_weeks";
}

function initRestockWeeks(root) {
    root.querySelectorAll("form").forEach((form) => {
        if (form.querySelector("[data-fd-restock-weeks]"))
            syncRestockWeeks(form);
    });
}

document.addEventListener("change", (event) => {
    const radio = event.target?.closest?.('input[name="restock_schedule"]');
    const form = radio?.closest("form");
    if (form) syncRestockWeeks(form);
});

const USUAL_ADD_TAB = "[data-fd-usual-add-tab]";

function selectUsualAddTab(dialog, tab) {
    dialog.querySelectorAll(USUAL_ADD_TAB).forEach((button) => {
        const on = button.getAttribute("data-fd-usual-add-tab") === tab;
        if (button.hasAttribute("aria-pressed"))
            button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // Type it shows its form alone; Back (a tab button for Search) restores the tiles.
    dialog.querySelectorAll("[data-fd-usual-add-tiles]").forEach((tiles) => {
        tiles.hidden = tab === "type";
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

// Add a usual offers the usual amount of the food being added, so adding a
// food that already has one never changes it unseen. A food picked from the
// scan's choices, or a name typed that a food already has, fills the amount and
// unit; a new food starts at one each. Once the person edits either, it stays.
const PURCHASE_TOUCHED = "fdUsualPurchaseTouched";

function setUsualPurchase(form, amount, unit) {
    const field = form.querySelector('[data-fd-menu-field][name="usual_unit"]');
    const input = form.querySelector('input[name="usual_amount"]');
    if (!field || !input || form.dataset[PURCHASE_TOUCHED]) return;
    const menu = field.closest("[data-fd-menu]");
    const item = menu?.querySelector(
        `[data-fd-menu-value="${CSS.escape(unit)}"]`,
    );
    if (item) {
        menu.querySelectorAll("[data-fd-menu-value]").forEach((other) => {
            other.setAttribute(
                "aria-checked",
                other === item ? "true" : "false",
            );
        });
        const shown = menu.querySelector(".fd-item-row__value");
        const label = item.querySelector(".fd-menu__label");
        if (shown && label) shown.textContent = label.textContent;
    }
    field.value = unit;
    input.value = amount;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
}

document.addEventListener("input", (event) => {
    if (!event.isTrusted) return;
    const target = event.target;
    if (target?.matches?.('input[name="usual_amount"]')) {
        const form = target.closest("form");
        if (form) form.dataset[PURCHASE_TOUCHED] = "1";
    }
});

document.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    const target = event.target;
    const form = target?.closest?.("form");
    if (!form?.querySelector('input[name="usual_amount"]')) return;
    if (
        target.closest(".fd-stepper-control") ||
        target.closest("[data-fd-menu]")?.querySelector('[name="usual_unit"]')
    ) {
        form.dataset[PURCHASE_TOUCHED] = "1";
    }
});

function applyChoiceAmount(radio) {
    const row = radio.closest("[data-fd-usual-amount]");
    const form = radio.closest("form");
    if (!row || !form || !radio.checked) return;
    setUsualPurchase(
        form,
        row.getAttribute("data-fd-usual-amount") || "",
        row.getAttribute("data-fd-usual-unit") || "",
    );
}

document.addEventListener("change", (event) => {
    const radio = event.target?.closest?.('input[name="food_choice"]');
    if (radio) applyChoiceAmount(radio);
});

// Typing a name for a new food picks "A new food" for the person.
document.addEventListener("input", (event) => {
    const input = event.target?.closest?.("[data-fd-usual-add-newname]");
    const form = input?.closest("form");
    const radio = form?.querySelector('input[name="food_choice"][value="new"]');
    if (radio && !radio.checked) {
        radio.checked = true;
        applyChoiceAmount(radio);
    }
});

// Type it: a name a food already has brings that food's usual amount.
document.addEventListener("input", (event) => {
    const input = event.target?.closest?.('input[name="name"]');
    const form = input?.closest("form[data-fd-usual-known]");
    if (!form) return;
    let known;
    try {
        known = JSON.parse(form.getAttribute("data-fd-usual-known") || "{}");
    } catch {
        return;
    }
    const key = input.value.trim().replace(/\s+/g, " ").toLowerCase();
    const usual = Object.prototype.hasOwnProperty.call(known, key)
        ? known[key]
        : ["1", "each"];
    setUsualPurchase(form, String(usual[0]), String(usual[1]));
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
        initAddSearch(root);
        initUsualUnits(root);
        syncUsualProductRows(root);
        initUsualProductSearch(root);
        initRestockWeeks(root);
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
