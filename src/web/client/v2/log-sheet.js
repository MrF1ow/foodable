// Log search + amount sheets (flag ui-v2). Search hits /api/log/search;
// amount posts to /log.
const SEARCH_ID = "fd-log-search";
const AMOUNT_ID = "fd-log-amount";
const QUICK_CAL_ID = "fd-log-quick-cal";
const WEIGH_IN_ID = "fd-log-weigh-in";
const DEBOUNCE_MS = 250;

const MEAL_LABEL = {
    breakfast: "Add to breakfast",
    lunch: "Add to lunch",
    dinner: "Add to dinner",
    snack: "Add to snacks",
};

function round1(n) {
    return Math.round(n * 10) / 10;
}

function formatLogMacroKcal(value) {
    if (value == null || !Number.isFinite(Number(value))) return "–";
    return String(Math.round(Number(value)));
}

function formatLogMacroGrams(value) {
    if (value == null || !Number.isFinite(Number(value))) return "–";
    const v = Number(value);
    if (v >= 10) return String(Math.round(v));
    const one = Math.round(v * 10) / 10;
    if (one % 1 === 0) return String(Math.round(one));
    return one.toFixed(1).replace(/\.0$/, "");
}

function defaultAmountForUnit(unit) {
    if (unit === "portion" || unit === "each") return 1;
    return 100;
}

function logItemIsRelivable(item) {
    return !!(
        item?.food_id?.trim() ||
        item?.recipe_id?.trim() ||
        item?.barcode?.trim()
    );
}

function itemGrams(amount, unit, item) {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (unit === "g") return amount;
    if (unit === "ml") {
        const d = item.grams_per_ml;
        return d != null && d > 0 ? round1(amount * d) : null;
    }
    if (unit === "each") {
        const d = item.grams_per_each;
        return d != null && d > 0 ? round1(amount * d) : null;
    }
    return null;
}

/**
 * Live macros for the amount sheet (tests via FOODABLE_EXPOSE_LOG_MACROS).
 * @param {Record<string, unknown>} item search JSON item
 * @param {number} amount
 * @param {string} unit
 */
function macrosFor(item, amount, unit) {
    if (unit === "portion" && item.recipe_id) {
        const p = amount;
        const scale = (v) =>
            v != null && Number.isFinite(Number(v))
                ? round1(Number(v) * p)
                : null;
        return {
            kcal: scale(item.kcal),
            protein_g: scale(item.protein_g),
            carbs_g: scale(item.carbs_g),
            fat_g: scale(item.fat_g),
        };
    }
    const grams = itemGrams(amount, unit, item);
    if (grams == null) return null;
    const scale100 = (v) =>
        v != null && Number.isFinite(Number(v))
            ? Math.round((Number(v) * grams) / 10) / 10
            : null;
    return {
        kcal: scale100(item.kcal_per_100g),
        protein_g: scale100(item.protein_per_100g),
        carbs_g: scale100(item.carbs_per_100g),
        fat_g: scale100(item.fat_per_100g),
    };
}

function allowedUnits(item) {
    const hints = item.unit_hints;
    if (Array.isArray(hints) && hints.length > 0) return hints;
    if (item.recipe_id) return ["portion"];
    const out = ["g"];
    if (item.grams_per_ml != null && item.grams_per_ml > 0) out.push("ml");
    if (item.grams_per_each != null && item.grams_per_each > 0)
        out.push("each");
    return out;
}

const FILTER = {
    All: new Set(["food", "recipe", "history", "stock", "off"]),
    Foods: new Set(["food", "stock", "off"]),
    Recipes: new Set(["recipe"]),
    "My foods": new Set(["food", "stock"]),
};

const MEAL_ADDING_LABEL = {
    breakfast: "Adding to breakfast",
    lunch: "Adding to lunch",
    dinner: "Adding to dinner",
    snack: "Adding to snacks",
};

/** @param {EventTarget | null} el */
function isEditableTarget(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = el.tagName;
    if (tag === "BUTTON") return false;
    if (tag === "TEXTAREA") {
        const ta = /** @type {HTMLTextAreaElement} */ (el);
        return !ta.disabled && !ta.readOnly;
    }
    if (tag === "SELECT") {
        return !(/** @type {HTMLSelectElement} */ (el).disabled);
    }
    if (tag === "INPUT") {
        const input = /** @type {HTMLInputElement} */ (el);
        const type = (input.type || "text").toLowerCase();
        if (
            type === "button" ||
            type === "submit" ||
            type === "reset" ||
            type === "checkbox" ||
            type === "radio" ||
            type === "file" ||
            type === "hidden"
        )
            return false;
        return !input.disabled && !input.readOnly;
    }
    return /** @type {HTMLElement} */ (el).isContentEditable;
}

/** @param {KeyboardEvent} event */
function isLogSearchShortcut(event) {
    if (event.defaultPrevented || event.altKey || event.shiftKey) return false;
    if (!(event.metaKey || event.ctrlKey)) return false;
    return String(event.key).toLowerCase() === "k";
}

/**
 * @param {number} current -1 when none active
 * @param {number} count
 * @param {1 | -1} direction
 */
function nextSearchRowIndex(current, count, direction) {
    if (count <= 0) return -1;
    if (current < 0) return direction > 0 ? 0 : count - 1;
    let next = current + direction;
    if (next < 0) next = count - 1;
    if (next >= count) next = 0;
    return next;
}

function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
}

function macroLineHtml(m) {
    if (!m) return "";
    const one = (key, letter, name, val) =>
        val != null && Number.isFinite(Number(val))
            ? `<span class="fd-macro fd-macro--${key}"><span aria-hidden="true">${letter} </span><span class="fd-sr">${name} </span>${esc(val)}</span>`
            : "";
    const parts = [
        one("protein", "P", "Protein", m.protein_g),
        one("carbs", "C", "Carbs", m.carbs_g),
        one("fat", "F", "Fat", m.fat_g),
    ].filter(Boolean);
    return parts.length
        ? `<span class="fd-macros">${parts.join("")}</span>`
        : "";
}

function formatAmountUnit(amount, unit) {
    if (amount == null || unit == null) return "";
    const n = Number(amount);
    if (!Number.isFinite(n)) return "";
    const text = n % 1 === 0 ? String(n) : String(round1(n));
    return `${text} ${unit}`;
}

function itemSubtitle(item, kind) {
    const k = kind || item.kind || "food";
    if (k === "stock") {
        const amt = formatAmountUnit(item.stock_amount, item.stock_unit);
        const kcal = item.kcal_per_100g;
        const kcalBit = kcal != null ? `${Math.round(kcal)} / 100 g kcal` : "";
        return ["In your fridge", amt, kcalBit].filter(Boolean).join(" · ");
    }
    if (k === "recipe") {
        const kcal = item.kcal ?? item.kcal_per_100g;
        return `Your recipe · 1 serving${kcal != null ? ` · ${Math.round(kcal)} kcal` : ""}`;
    }
    if (k === "history") {
        const kcal = item.meal_kcal ?? item.kcal;
        if (item.log_count != null)
            return `Logged ${item.log_count} times${kcal != null ? ` · ${Math.round(kcal)} kcal` : ""}`;
        if (item.logged_at)
            return `Logged ${String(item.logged_at).slice(0, 10)}${kcal != null ? ` · ${Math.round(kcal)} kcal` : ""}`;
        return kcal != null ? `Logged · ${Math.round(kcal)} kcal` : "Logged";
    }
    if (k === "off") {
        const brand = item.brand || "Open Food Facts";
        const kcal = item.kcal_per_100g;
        return kcal != null
            ? `${brand} · ${Math.round(kcal)} / 100 g kcal`
            : brand;
    }
    const brand = item.brand?.trim();
    const kcal = item.kcal_per_100g;
    if (brand)
        return kcal != null
            ? `${brand} · ${Math.round(kcal)} / 100 g kcal`
            : brand;
    return kcal != null
        ? `Generic · ${Math.round(kcal)} / 100 g kcal`
        : "Generic";
}

function rowPreviewMacros(item, kind) {
    const unit =
        item.unit && allowedUnits(item).includes(String(item.unit))
            ? String(item.unit)
            : allowedUnits(item)[0];
    const amount =
        item.amount != null && Number.isFinite(Number(item.amount))
            ? Number(item.amount)
            : kind === "recipe"
              ? 1
              : 100;
    const m = macrosFor(item, amount, unit);
    if (m) return m;
    if (kind === "recipe" && item.kcal != null) {
        return {
            protein_g: item.protein_g,
            carbs_g: item.carbs_g,
            fat_g: item.fat_g,
            kcal: item.kcal,
        };
    }
    return null;
}

function macroParts(m) {
    if (!m) return null;
    return {
        protein: m.protein_g ?? null,
        carbs: m.carbs_g ?? null,
        fat: m.fat_g ?? null,
    };
}

function plusIcon() {
    return `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>`;
}

function searchRowHtml(item, kind, rowIndex) {
    const relivable = kind !== "history" || logItemIsRelivable(item);
    const subtitle = itemSubtitle(item, kind);
    const macros = macroLineHtml(macroParts(rowPreviewMacros(item, kind)));
    const add = relivable
        ? `<button type="button" class="fd-icon-btn" aria-label="Add ${esc(item.name)}" data-fd-log-pick="${esc(JSON.stringify({ ...item, kind }))}">${plusIcon()}</button>`
        : "";
    const rowId = rowIndex != null ? ` id="fd-log-result-${rowIndex}"` : "";
    const pickAttr = relivable
        ? ` data-fd-log-row-pick="${esc(JSON.stringify({ ...item, kind }))}"`
        : "";
    return `<li class="fd-row fd-row--search" role="option"${rowId}${pickAttr}><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${esc(item.name)}</span></span><span class="fd-row__sub">${esc(subtitle)}</span>${macros}</div>${add}</div></li>`;
}

function recentChipHtml(item) {
    if (!logItemIsRelivable(item)) return "";
    const kcal =
        item.meal_kcal ??
        item.kcal ??
        (item.kcal_per_100g != null ? Math.round(item.kcal_per_100g) : null);
    const count =
        kcal != null
            ? `<span class="fd-chip__count">${Math.round(kcal)}</span>`
            : "";
    const payload = { ...item, kind: item.kind || "history" };
    return `<button type="button" class="fd-chip fd-log-recent" data-fd-log-pick="${esc(JSON.stringify(payload))}"><span class="fd-chip__label">${esc(item.name)}</span>${count}</button>`;
}

function renderMacroTiles(container, m) {
    if (!container) return;
    const vals = m || {
        kcal: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
    };
    container.innerHTML = `<dl class="fd-tiles fd-log-macros" aria-label="This amount">
<div class="fd-tile"><dt class="fd-tile__label"><span class="fd-dot fd-dot--sm fd-dot--calories" aria-hidden="true"></span>kcal</dt><dd class="fd-tile__value">${formatLogMacroKcal(vals.kcal)}</dd></div>
<div class="fd-tile"><dt class="fd-tile__label"><span class="fd-dot fd-dot--sm fd-dot--protein" aria-hidden="true"></span>Protein</dt><dd class="fd-tile__value">${formatLogMacroGrams(vals.protein_g)}<span class="fd-stat__unit"> g</span></dd></div>
<div class="fd-tile"><dt class="fd-tile__label"><span class="fd-dot fd-dot--sm fd-dot--carbs" aria-hidden="true"></span>Carbs</dt><dd class="fd-tile__value">${formatLogMacroGrams(vals.carbs_g)}<span class="fd-stat__unit"> g</span></dd></div>
<div class="fd-tile"><dt class="fd-tile__label"><span class="fd-dot fd-dot--sm fd-dot--fat" aria-hidden="true"></span>Fat</dt><dd class="fd-tile__value">${formatLogMacroGrams(vals.fat_g)}<span class="fd-stat__unit"> g</span></dd></div>
</dl>`;
}

function rebuildUnitChips(form, units, selected) {
    const fieldset = form?.querySelector("[data-fd-log-unit-chips]");
    if (!fieldset) return;
    const chips = units
        .map(
            (unit) =>
                `<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" name="unit" value="${esc(unit)}"${unit === selected ? " checked" : ""} required><span class="fd-chip__face"><span class="fd-chip__label">${esc(unit)}</span></span></label>`,
        )
        .join("");
    fieldset.innerHTML = `<legend class="fd-sr">Unit</legend><div class="fd-chips">${chips}</div>`;
}

let lastLogOpener = null;

function openSheet(id, opener) {
    if (opener) lastLogOpener = opener;
    const d = document.getElementById(id);
    if (d instanceof HTMLDialogElement && typeof d.showModal === "function") {
        if (!d.open) d.showModal();
    }
}

function focusLogSearchInput(dialog, query) {
    const input = dialog?.querySelector(".fd-log-search-input");
    if (!(input instanceof HTMLInputElement)) return;
    if (query != null && query !== "") input.value = query;
    input.focus();
}

function visibleLogOpener() {
    const desktop = document.querySelector("a.fd-search[data-fd-open-sheet]");
    if (desktop instanceof HTMLElement && desktop.offsetParent !== null)
        return desktop;
    const phone = document.querySelector("a.fd-log[data-fd-open-sheet]");
    if (phone instanceof HTMLElement && phone.offsetParent !== null)
        return phone;
    return (
        document.querySelector("a.fd-logfood[data-fd-open-sheet]") ??
        document.querySelector("[data-fd-open-sheet]")
    );
}

function openLogSearchSheet(opener, initialQuery) {
    openSheet(SEARCH_ID, opener ?? visibleLogOpener());
    const dialog = document.getElementById(SEARCH_ID);
    if (dialog?.open) focusLogSearchInput(dialog, initialQuery);
}

function closeSheet(id) {
    const d = document.getElementById(id);
    if (d instanceof HTMLDialogElement) d.close();
}

function searchMealType(root) {
    const el = root.querySelector('input[name="search_meal_type"]:checked');
    return el?.value || "dinner";
}

function syncMealToAmount(root, mealType) {
    const amount = document.getElementById(AMOUNT_ID);
    if (!amount) return;
    for (const el of amount.querySelectorAll('input[name="meal_type"]')) {
        if (el.value === mealType) el.checked = true;
    }
    const submit = amount.querySelector("[data-fd-log-submit]");
    if (submit) submit.textContent = MEAL_LABEL[mealType] ?? MEAL_LABEL.dinner;
}

const searchSheetInit = new WeakSet();
const amountSheetInit = new WeakSet();
const quickCalSheetInit = new WeakSet();
const weighInSheetInit = new WeakSet();
let openersBound = false;

function bindSearchSheet(root) {
    const dialog = root.querySelector(`#${SEARCH_ID}`);
    if (!(dialog instanceof HTMLDialogElement)) return;
    // Keyed on the dialog: Turbo replaces it on a visit, and the new one binds.
    if (searchSheetInit.has(dialog)) return;
    searchSheetInit.add(dialog);
    const input = dialog.querySelector(".fd-log-search-input");
    const clearBtn = dialog.querySelector("[data-fd-log-search-clear]");
    const results = dialog.querySelector("[data-fd-log-results]");
    const empty = dialog.querySelector("[data-fd-log-empty]");
    const recentRoot = dialog.querySelector("[data-fd-log-recent]");
    const filters = dialog.querySelector("[data-fd-log-filters]");
    const onlineBtn = dialog.querySelector("[data-fd-log-online]");
    const list = dialog.querySelector("[data-fd-log-result-list]");
    let timer = 0;
    let lastQ = null;
    let online = false;
    let activeFilter = "All";
    let lastData = null;
    let fetchSeq = 0;
    let activeRow = -1;

    function resultListRoot() {
        if (list?.isConnected) return list;
        return dialog.querySelector("[data-fd-log-result-list]");
    }

    function resultRows() {
        const root = resultListRoot();
        return /** @type {HTMLElement[]} */ ([
            ...(root?.querySelectorAll(".fd-row--search") ?? []),
        ]);
    }

    function syncActiveRow() {
        const rows = resultRows();
        for (let i = 0; i < rows.length; i++) {
            const on = i === activeRow;
            rows[i].classList.toggle("fd-row--active", on);
        }
        if (input instanceof HTMLInputElement) {
            if (activeRow >= 0 && rows[activeRow]?.id) {
                input.setAttribute("aria-activedescendant", rows[activeRow].id);
            } else {
                input.removeAttribute("aria-activedescendant");
            }
        }
        const row = rows[activeRow];
        row?.scrollIntoView({ block: "nearest" });
    }

    function pickActiveRow() {
        const rows = resultRows();
        const row = rows[activeRow];
        if (!row) return;
        const raw =
            row.getAttribute("data-fd-log-row-pick") ??
            row
                .querySelector("[data-fd-log-pick]")
                ?.getAttribute("data-fd-log-pick");
        if (!raw) return;
        try {
            pickItem(JSON.parse(raw));
        } catch (_) {}
    }

    function syncSearchSubtitle() {
        const meal = searchMealType(dialog);
        const sub = dialog.querySelector(".fd-sheet-sub");
        if (sub)
            sub.textContent =
                MEAL_ADDING_LABEL[meal] ?? MEAL_ADDING_LABEL.dinner;
    }

    const isPreview = !!dialog.querySelector(
        ".fd-log-search-results:not([hidden]) .fd-row",
    );

    async function fetchResults(q) {
        const url = `/api/log/search?q=${encodeURIComponent(q)}${online ? "&online=1" : ""}`;
        const res = await fetch(url, {
            headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        return res.json();
    }

    function filteredItems(data) {
        const allow = FILTER[activeFilter] || FILTER.All;
        const out = [];
        for (const g of data?.groups || []) {
            if (!allow.has(g.kind)) continue;
            for (const item of g.items || []) {
                out.push({ item, kind: g.kind });
            }
        }
        return out;
    }

    function paintRows(data) {
        const rows = filteredItems(data);
        const html = rows
            .map(({ item, kind }, i) => searchRowHtml(item, kind, i))
            .join("");
        activeRow = -1;
        if (list) {
            list.innerHTML = html;
        } else if (results) {
            results.innerHTML = `<ul class="fd-list" id="fd-log-result-listbox" role="listbox" data-fd-log-result-list>${html}</ul>`;
        }
        syncActiveRow();
    }

    function paintEmpty(data) {
        if (!recentRoot) return;
        const hist = (data?.groups || []).find((g) => g.kind === "history");
        recentRoot.innerHTML =
            hist?.items
                ?.map((i) => recentChipHtml({ ...i, kind: "history" }))
                .join("") || "";
    }

    function setMode(hasQuery) {
        if (!results || !empty) return;
        if (hasQuery) {
            results.hidden = false;
            empty.hidden = true;
            if (filters) filters.hidden = false;
        } else {
            results.hidden = true;
            empty.hidden = false;
            if (filters) filters.hidden = true;
        }
        if (onlineBtn) {
            onlineBtn.hidden =
                !hasQuery ||
                (lastData?.groups || []).some((g) => g.kind === "off");
        }
    }

    function paint(data) {
        lastData = data;
        const q = String(input?.value || "").trim();
        const has = filteredItems(data).length > 0;
        setMode(q.length > 0);
        if (!q) {
            paintEmpty(data);
            return;
        }
        if (has) paintRows(data);
        else {
            if (list) list.innerHTML = "";
            activeRow = -1;
            syncActiveRow();
        }
    }

    async function run() {
        const q = String(input?.value || "").trim();
        if (clearBtn) clearBtn.hidden = q.length === 0;
        const seq = ++fetchSeq;
        const data = await fetchResults(q);
        if (seq !== fetchSeq) return;
        if (data) paint(data);
    }

    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(run, DEBOUNCE_MS);
    }

    input?.addEventListener("input", () => {
        online = false;
        schedule();
    });

    clearBtn?.addEventListener("click", () => {
        if (input) {
            input.value = "";
            input.focus();
        }
        online = false;
        run();
    });

    filters?.addEventListener("click", (event) => {
        const btn = event.target.closest?.("[data-fd-log-filter]");
        if (!btn) return;
        activeFilter = btn.getAttribute("data-fd-log-filter") || "All";
        for (const chip of filters.querySelectorAll(".fd-log-filter")) {
            const on = chip === btn;
            chip.classList.toggle("fd-chip--selected", on);
            chip.setAttribute("aria-pressed", on ? "true" : "false");
        }
        if (lastData) paintRows(lastData);
    });

    onlineBtn?.addEventListener("click", () => {
        online = true;
        run();
    });

    dialog.addEventListener("toggle", () => {
        if (dialog.open) {
            focusLogSearchInput(dialog);
            if (isPreview) return;
            const cur = String(input?.value || "").trim();
            if (lastQ !== cur) {
                lastQ = cur;
                run();
            }
            return;
        }
        activeRow = -1;
        syncActiveRow();
        const back =
            lastLogOpener instanceof HTMLElement ? lastLogOpener : null;
        if (back?.isConnected) back.focus();
    });

    input?.addEventListener("keydown", (event) => {
        const rows = resultRows();
        if (rows.length === 0 || results?.hidden) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            activeRow = nextSearchRowIndex(activeRow, rows.length, 1);
            syncActiveRow();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            activeRow = nextSearchRowIndex(activeRow, rows.length, -1);
            syncActiveRow();
        } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (activeRow >= 0) {
                pickActiveRow();
            } else if (rows.length > 0) {
                activeRow = 0;
                pickActiveRow();
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeSheet(SEARCH_ID);
        }
    });
    input?.setAttribute("role", "combobox");
    input?.setAttribute("aria-autocomplete", "list");
    input?.setAttribute("aria-controls", "fd-log-result-listbox");
    if (list && !list.id) list.id = "fd-log-result-listbox";

    dialog
        .querySelector(".fd-log-meals-search")
        ?.addEventListener("change", () => {
            syncMealToAmount(root, searchMealType(dialog));
            syncSearchSubtitle();
        });
}

let selectedItem = null;

function amountSubtitleLine(item) {
    if (item.recipe_id) {
        const k = item.kcal ?? item.kcal_per_100g;
        return `Your recipe · ${k != null ? `${Math.round(k)} kcal` : ""} per portion`.trim();
    }
    const brand = item.brand?.trim();
    const kcal = item.kcal_per_100g;
    if (brand)
        return `${brand} · ${kcal != null ? `${Math.round(kcal)} kcal` : ""} per 100 g`.trim();
    return `Generic · ${kcal != null ? `${Math.round(kcal)} kcal` : ""} per 100 g`.trim();
}

function syncAmountHidden(form, item) {
    if (!form || !item) return;
    const set = (name, value) => {
        let el = form.querySelector(`input[name="${name}"]`);
        if (!value) {
            el?.remove();
            return;
        }
        if (!el) {
            el = document.createElement("input");
            el.type = "hidden";
            el.name = name;
            form.appendChild(el);
        }
        el.value = value;
    };
    set("food_id", item.food_id || "");
    set("recipe_id", item.recipe_id || "");
    set("barcode", item.barcode || "");
    set("display_name", item.name || "");
}

function bindQuickCalSheet(root) {
    const dialog = document.getElementById(QUICK_CAL_ID);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (quickCalSheetInit.has(dialog)) return;
    quickCalSheetInit.add(dialog);
    const form = dialog.querySelector(".fd-log-quick-cal-form");
    const submit = dialog.querySelector("[data-fd-quick-cal-submit]");
    form?.addEventListener("change", (event) => {
        if (event.target?.name === "meal_type" && submit) {
            const meal = form.querySelector(
                'input[name="meal_type"]:checked',
            )?.value;
            submit.textContent = MEAL_LABEL[meal] ?? MEAL_LABEL.dinner;
        }
    });
}

function bindWeighInSheet(root) {
    const dialog = document.getElementById(WEIGH_IN_ID);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (weighInSheetInit.has(dialog)) return;
    weighInSheetInit.add(dialog);
    const form = dialog.querySelector(".fd-log-weigh-in-form");
    const timeInput = dialog.querySelector("#fd-weigh-time");
    const todayLabel = dialog.querySelector("[data-fd-weigh-today-label]");
    if (todayLabel?.textContent) {
        const m = todayLabel.textContent.match(/^Today /);
        if (m) {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, "0");
            const mm = String(now.getMinutes()).padStart(2, "0");
            todayLabel.textContent = `Today ${hh}:${mm}`;
        }
    }
    form?.addEventListener("change", (event) => {
        if (event.target?.name === "fd_weigh_time_mode" && timeInput) {
            const pick = form.querySelector(
                'input[name="fd_weigh_time_mode"][value="pick"]:checked',
            );
            timeInput.hidden = !pick;
            timeInput.disabled = !pick;
        }
    });
}

function bindAmountSheet(root) {
    const dialog = root.querySelector(`#${AMOUNT_ID}`);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (amountSheetInit.has(dialog)) return;
    amountSheetInit.add(dialog);
    const form = dialog.querySelector(".fd-log-amount-form");
    const macroRoot = dialog.querySelector("[data-fd-log-macros]");
    const title = dialog.querySelector(".fd-sheet-title");
    const sub = dialog.querySelector(".fd-sheet-sub");
    const submit = dialog.querySelector("[data-fd-log-submit]");
    const timeInput = dialog.querySelector(".fd-log-time-input");
    const stepperUnit = dialog.querySelector(".fd-stepper__unit");

    function refreshMacros() {
        if (!selectedItem || !form) return;
        const amount = Number(form.querySelector('[name="amount"]')?.value);
        const unit =
            form.querySelector('input[name="unit"]:checked')?.value ||
            allowedUnits(selectedItem)[0];
        renderMacroTiles(macroRoot, macrosFor(selectedItem, amount, unit));
        if (stepperUnit) stepperUnit.textContent = unit;
    }

    form?.addEventListener("input", refreshMacros);
    form?.addEventListener("change", (event) => {
        if (event.target?.name === "meal_type" && submit) {
            const meal = form.querySelector(
                'input[name="meal_type"]:checked',
            )?.value;
            submit.textContent = MEAL_LABEL[meal] ?? MEAL_LABEL.dinner;
        }
        if (event.target?.name === "unit") refreshMacros();
        if (event.target?.name === "fd_log_time_mode" && timeInput) {
            const pick = form.querySelector(
                'input[name="fd_log_time_mode"][value="pick"]:checked',
            );
            timeInput.hidden = !pick;
            // A disabled field is not submitted: "Today" logs at submit time.
            timeInput.disabled = !pick;
        }
    });
    dialog.addEventListener("toggle", () => {
        if (dialog.open) refreshMacros();
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
        if (!shouldAmountEnterSubmit(event.target)) return;
        const submit = amountFormSubmitButton(form, dialog);
        if (!(submit instanceof HTMLButtonElement) || !form) return;
        event.preventDefault();
        if (typeof form.requestSubmit === "function") {
            form.requestSubmit(submit);
        } else {
            submit.click();
        }
    });
}

/** @param {EventTarget | null} target */
function shouldAmountEnterSubmit(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest(".fd-log-time-input")) return false;
    if (target.closest("[data-fd-step]")) return false;
    if (target.closest(".fd-chip")) return false;
    if (target.closest(".fd-icon-btn")) return false;
    if (target.closest('button[type="submit"]')) return false;
    if (target.matches('input[type="number"]')) return true;
    if (target.classList.contains("fd-sheet-panel")) return true;
    return false;
}

/**
 * @param {HTMLFormElement | null | undefined} form
 * @param {HTMLElement | null | undefined} dialog
 */
function amountFormSubmitButton(form, dialog) {
    if (!(form instanceof HTMLFormElement)) {
        return dialog?.querySelector("[data-fd-log-submit]") ?? null;
    }
    const id = form.id;
    if (id) {
        const external = document.querySelector(
            `[form="${id}"][data-fd-log-submit]`,
        );
        if (external instanceof HTMLButtonElement) return external;
    }
    const inner = form.querySelector("[data-fd-log-submit]");
    if (inner instanceof HTMLButtonElement) return inner;
    return dialog?.querySelector("[data-fd-log-submit]") ?? null;
}

function pickItem(item) {
    if (!logItemIsRelivable(item)) return;
    selectedItem = item;
    const searchDialog = document.getElementById(SEARCH_ID);
    const searchMeal = searchDialog ? searchMealType(searchDialog) : "dinner";
    closeSheet(SEARCH_ID);
    const amountDialog = document.getElementById(AMOUNT_ID);
    const form = amountDialog?.querySelector(".fd-log-amount-form");
    const title = amountDialog?.querySelector(".fd-sheet-title");
    const sub = amountDialog?.querySelector(".fd-sheet-sub");
    const submit = amountDialog?.querySelector("[data-fd-log-submit]");
    if (title) title.textContent = item.name || "Food";
    if (sub) sub.textContent = amountSubtitleLine(item);
    if (form) {
        syncAmountHidden(form, item);
        const units = allowedUnits(item);
        const unit =
            item.unit && units.includes(item.unit) ? item.unit : units[0];
        const amountInput = form.querySelector('[name="amount"]');
        if (amountInput) {
            const unitMatches = item.unit && units.includes(String(item.unit));
            amountInput.value =
                unitMatches && item.amount != null
                    ? String(item.amount)
                    : String(defaultAmountForUnit(unit));
        }
        rebuildUnitChips(form, units, unit);
        const mealInput = form.querySelector(
            `input[name="meal_type"][value="${searchMeal}"]`,
        );
        if (mealInput) mealInput.checked = true;
        if (submit)
            submit.textContent = MEAL_LABEL[searchMeal] ?? MEAL_LABEL.dinner;
        const stepperUnit = form.querySelector(".fd-stepper__unit");
        if (stepperUnit) stepperUnit.textContent = unit;
    }
    openSheet(AMOUNT_ID);
}

function bindOpeners() {
    if (openersBound) return;
    openersBound = true;
    document.addEventListener("click", (event) => {
        const modifiedClick =
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey;
        const open = event.target.closest?.("[data-fd-open-sheet]");
        if (open && !modifiedClick) {
            const id = open.getAttribute("data-fd-open-sheet");
            if (id) {
                event.preventDefault();
                if (id === SEARCH_ID) openLogSearchSheet(open);
                else openSheet(id, open);
            }
        }
        const pick = event.target.closest?.("[data-fd-log-pick]");
        if (pick && !modifiedClick) {
            event.preventDefault();
            try {
                const raw = pick.getAttribute("data-fd-log-pick");
                const item = JSON.parse(raw);
                pickItem(item);
            } catch (_) {}
        }
    });
    document.addEventListener(
        "click",
        (event) => {
            const open = event.target.closest?.(
                "a.fd-log[data-fd-open-sheet], a.fd-search[data-fd-open-sheet], a.fd-logfood[data-fd-open-sheet]",
            );
            if (
                !open ||
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            )
                return;
            const id = open.getAttribute("data-fd-open-sheet");
            if (id) {
                event.preventDefault();
                if (id === SEARCH_ID) openLogSearchSheet(open);
                else openSheet(id, open);
            }
        },
        true,
    );
}

let logShortcutsBound = false;

function bindLogShortcuts() {
    if (logShortcutsBound) return;
    logShortcutsBound = true;
    document.addEventListener("keydown", (event) => {
        if (!isLogSearchShortcut(event)) return;
        if (isEditableTarget(document.activeElement)) return;
        if (!document.querySelector(".fd-shell")) return;
        event.preventDefault();
        openLogSearchSheet(visibleLogOpener());
    });
}

// The log dialogs are rendered after .fd-shell, directly in <body>, so they
// are found from the document, not from the shell.
function init() {
    if (!document.querySelector(".fd-shell")) return;
    bindSearchSheet(document);
    bindAmountSheet(document);
    bindQuickCalSheet(document);
    bindWeighInSheet(document);
    bindOpeners();
    bindLogShortcuts();
}

window.FoodableApp.onLoad(init);

if (typeof window !== "undefined" && window.FOODABLE_EXPOSE_LOG_MACROS) {
    window.FOODABLE_EXPOSE_LOG_MACROS({
        macrosFor,
        allowedUnits,
        itemGrams,
        formatLogMacroKcal,
        formatLogMacroGrams,
        rebuildUnitChips,
    });
}

if (typeof window !== "undefined" && window.FOODABLE_EXPOSE_LOG_KEYBOARD) {
    window.FOODABLE_EXPOSE_LOG_KEYBOARD({
        isEditableTarget,
        isLogSearchShortcut,
        nextSearchRowIndex,
        shouldAmountEnterSubmit,
        amountFormSubmitButton,
    });
}
