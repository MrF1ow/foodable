// Log search, amount, quick calories and weigh-in sheets (the markup is
// src/web/pages/v2/log-sheet.ts; the rows written here are the same as its
// `logResultRow`). Search hits /api/log/search; amount posts to /log.
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

/**
 * The amount to show after the unit changes. A portion count and a mass or
 * volume are different scales, so moving from or to portion restarts at that
 * unit's default; between g, ml and each the number stays.
 */
function amountAfterUnitChange(prev, next, current) {
    if (prev && prev !== next && (prev === "portion" || next === "portion")) {
        return String(defaultAmountForUnit(next));
    }
    return current;
}

/** One portion is the pack serving, in the serving's own unit. */
function resolvePortion(serving, portions) {
    return {
        amount: Math.round(serving.amount * portions * 100) / 100,
        unit: serving.unit,
    };
}

/** "1 portion · 30 ml": what the amount is in the serving's own unit. */
function portionLabel(serving, portions) {
    const q = resolvePortion(serving, portions);
    const t = (n) => String(Math.round(n * 100) / 100);
    return `${t(portions)} portion · ${t(q.amount)} ${q.unit}`;
}

function perLabel(item) {
    return item.basis === "100ml" ? "100 ml" : "100 g";
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

/** The ml a per-100 ml food's figures scale by; null without a density. */
function mlFor(amount, unit, item) {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (unit === "ml") return amount;
    const grams = itemGrams(amount, unit, item);
    const d = item.grams_per_ml;
    return grams != null && d != null && d > 0 ? round1(grams / d) : null;
}

/**
 * Live macros for the amount sheet (tests via FOODABLE_EXPOSE_LOG_MACROS).
 * @param {Record<string, unknown>} item search JSON item
 * @param {number} amount
 * @param {string} unit
 */
function macrosFor(item, amount, unit) {
    if (unit === "portion" && item.serving) {
        const q = resolvePortion(item.serving, amount);
        return macrosFor({ ...item, serving: null }, q.amount, q.unit);
    }
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
    // A per-100 ml food scales by ml: the amount itself in ml, or grams ÷
    // density for g and each. No density, no figure.
    const grams =
        item.basis === "100ml"
            ? mlFor(amount, unit, item)
            : itemGrams(amount, unit, item);
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
    const density = item.grams_per_ml != null && item.grams_per_ml > 0;
    const perMl = item.basis === "100ml";
    const out = perMl ? ["ml"] : ["g"];
    if (perMl && density) out.push("g");
    if (!perMl && density) out.push("ml");
    if (
        item.grams_per_each != null &&
        item.grams_per_each > 0 &&
        (!perMl || density)
    )
        out.push("each");
    const serving = item.serving;
    if (
        serving &&
        serving.amount > 0 &&
        (perMl
            ? serving.unit === "ml" || density
            : serving.unit === "g" || density)
    )
        out.unshift("portion");
    return out;
}

const FILTER = {
    All: new Set(["food", "recipe", "history", "stock", "off"]),
    Foods: new Set(["food", "stock", "off"]),
    Recipes: new Set(["recipe"]),
    "My foods": new Set(["food", "stock"]),
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
        const kcalBit =
            kcal != null ? `${Math.round(kcal)} / ${perLabel(item)} kcal` : "";
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
            ? `${brand} · ${Math.round(kcal)} / ${perLabel(item)} kcal`
            : brand;
    }
    const brand = item.brand?.trim();
    const kcal = item.kcal_per_100g;
    if (brand)
        return kcal != null
            ? `${brand} · ${Math.round(kcal)} / ${perLabel(item)} kcal`
            : brand;
    return kcal != null
        ? `Generic · ${Math.round(kcal)} / ${perLabel(item)} kcal`
        : "Generic";
}

function plusIcon() {
    return `<svg class="fd-icon fd-icon--plus" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path vector-effect="non-scaling-stroke" d="M12 5L12 19M5 12L19 12"/></svg>`;
}

function chevronIcon() {
    return `<svg class="fd-icon fd-icon--chevron-right" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path vector-effect="non-scaling-stroke" d="M9 6L15 12L9 18"/></svg>`;
}

function scoreBadgeHtml(score) {
    if (typeof score !== "number" || !Number.isFinite(score)) return "";
    const value = Math.min(100, Math.max(0, Math.round(score)));
    const band = value >= 70 ? "good" : value >= 40 ? "middling" : "poor";
    return `<span class="fd-score-pill fd-score-pill--${band}" role="img" aria-label="Product score ${value} of 100, ${band}"><span class="fd-score-pill__dot" aria-hidden="true"></span><span class="fd-score-pill__num" aria-hidden="true">${value}</span></span>`;
}

// One search result, as the design draws it: the face opens the thing (a link
// with a chevron), the + beside it logs it. A result that only logs (a past
// meal) has no chevron, and its face picks like its plus. A result that cannot
// be logged has no plus.
function searchRowHtml(item, kind, rowIndex) {
    const relivable =
        item.loggable !== false &&
        (kind !== "history" || logItemIsRelivable(item));
    const subtitle = itemSubtitle(item, kind);
    // Several items or free text has no single food to pick, so its add action
    // logs the whole meal again.
    const againMealId =
        kind === "history" && !relivable && item.loggable !== false
            ? String(item.meal_id ?? "").trim()
            : "";
    const payload = esc(JSON.stringify({ ...item, kind }));
    const addLabel = `Add ${esc(item.name)}`;
    const addIcon = plusIcon();
    const add = relivable
        ? `<button type="button" class="fd-item-row__trail fd-item-row__add" aria-label="${addLabel}" data-fd-log-pick="${payload}">${addIcon}</button>`
        : againMealId
          ? againFormHtml(
                againMealId,
                `<button type="submit" class="fd-item-row__trail fd-item-row__add" aria-label="${addLabel}">${addIcon}</button>`,
            )
          : "";
    const rowId = rowIndex != null ? ` id="fd-log-result-${rowIndex}"` : "";
    const pickAttr = relivable
        ? ` data-fd-log-row-pick="${payload}"`
        : againMealId
          ? ` data-fd-log-row-meal="${esc(againMealId)}"`
          : "";
    const open = typeof item.open === "string" ? item.open : "";
    // A past meal opens the log form, not a page: its row is no link.
    const link = open !== "" && kind !== "history";
    const main = `<span class="fd-item-row__main"><span class="fd-item-row__line"><span class="fd-item-row__title" title="${esc(item.name)}">${esc(item.name)}</span>${scoreBadgeHtml(item.product_score)}</span><span class="fd-item-row__subtitle">${esc(subtitle)}</span></span>`;
    const face = link
        ? `<div class="fd-item-row__face fd-item-row__face--link"><a class="fd-item-row__anchor" href="${esc(open)}">${main}<span class="fd-item-row__trail fd-item-row__chevron" aria-hidden="true">${chevronIcon()}</span></a>${add}</div>`
        : `<div class="fd-item-row__face">${main}${add}</div>`;
    return `<li class="fd-item-row"${rowId} role="option"${pickAttr}>${face}</li>`;
}

// The past meal a ?log=meal:<id> link landed on when it has no single food to
// prefill. The search sheet shows its row first, so the meal that was tapped is
// the one offered even when a name search would not reach it.
let linkedMeal = null;

function linkedMealFor(query) {
    if (!linkedMeal) return null;
    return query.trim().toLowerCase() === linkedMeal.name.trim().toLowerCase()
        ? linkedMeal
        : null;
}

// Result rows as html, the linked meal first and never twice.
function searchRowsHtml(rows, pinned) {
    const pinnedId = pinned ? String(pinned.meal_id ?? "").trim() : "";
    const rest = pinnedId
        ? rows.filter(
              ({ item }) => String(item.meal_id ?? "").trim() !== pinnedId,
          )
        : rows;
    const all = pinned ? [{ item: pinned, kind: "history" }, ...rest] : rest;
    return all
        .map(({ item, kind }, i) => searchRowHtml(item, kind, i))
        .join("");
}

/** Page the chip returns to after logging a whole meal again. */
function againReturnPath() {
    return `${window.location.pathname}${window.location.search}`;
}

function againDate() {
    return new URLSearchParams(window.location.search).get("date") ?? "";
}

// One key per rendered Again form: the server logs a key once, so a double tap
// on the same chip adds one meal.
function againSubmitKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

// The form that logs a whole past meal again, around its submit control.
function againFormHtml(mealId, submitHtml) {
    return `<form class="fd-log-recent-form" method="post" action="/meals/${encodeURIComponent(mealId)}/again"><input type="hidden" name="return_to" value="${esc(againReturnPath())}" /><input type="hidden" name="date" value="${esc(againDate())}" /><input type="hidden" name="submit_key" value="${esc(againSubmitKey())}" />${submitHtml}</form>`;
}

function recentChipHtml(item) {
    const relivable = logItemIsRelivable(item);
    const mealId = String(item.meal_id ?? "").trim();
    if (!relivable && !mealId) return "";
    const kcal =
        item.meal_kcal ??
        item.kcal ??
        (item.kcal_per_100g != null ? Math.round(item.kcal_per_100g) : null);
    const count =
        kcal != null
            ? `<span class="fd-chip__count">${Math.round(kcal)}</span>`
            : "";
    if (!relivable) {
        // Several items or free text: log the whole meal again as it was.
        return againFormHtml(
            mealId,
            `<button type="submit" class="fd-chip"><span class="fd-chip__label">${esc(item.name)}</span>${count}</button>`,
        );
    }
    const payload = { ...item, kind: item.kind || "history" };
    return `<button type="button" class="fd-chip" data-fd-log-pick="${esc(JSON.stringify(payload))}"><span class="fd-chip__label">${esc(item.name)}</span>${count}</button>`;
}

// The four tiles of the amount sheet (the server's `macroTiles`): an unknown
// figure is a dash, never a zero.
function macroValueHtml(text) {
    return text == null
        ? `<span aria-hidden="true">—</span><span class="fd-sr">no data</span>`
        : esc(text);
}

function renderMacroTiles(container, m) {
    if (!container) return;
    const known = (v) => v != null && Number.isFinite(Number(v));
    const kcal = m && known(m.kcal) ? formatLogMacroKcal(m.kcal) : null;
    const grams = (v) => (known(v) ? `${formatLogMacroGrams(v)} g` : null);
    const tile = (kind, dotColor, label, text) =>
        `<div class="fd-macro-tile fd-macro-tile--${kind}"><dt class="fd-macro-tile__label"><span class="fd-dot fd-dot--${dotColor} fd-dot--sm" aria-hidden="true"></span>${label}</dt><dd class="fd-macro-tile__value">${macroValueHtml(text)}</dd></div>`;
    container.innerHTML = `<dl class="fd-macro-tiles" aria-label="This amount">${tile("kcal", "calories", "kcal", kcal)}${tile("protein", "protein", "Protein", grams(m?.protein_g))}${tile("carbs", "carbs", "Carbs", grams(m?.carbs_g))}${tile("fat", "fat", "Fat", grams(m?.fat_g))}</dl>`;
}

// The unit as the small Segmented (the server's `unitControl`); one unit has
// nothing to choose, so it posts from a hidden field.
// "each · 174 g": a piece says what it weighs when the food knows.
function unitSegmentLabel(unit, item) {
    const g = item?.grams_per_each;
    if (unit !== "each" || g == null || !(g > 0)) return unit;
    return `each · ${Math.round(g * 10) / 10} g`;
}

function rebuildUnitChips(form, units, selected, item) {
    const slot = form?.querySelector("[data-fd-log-units]");
    if (!slot) return;
    if (units.length < 2) {
        slot.innerHTML = units.length
            ? `<input type="hidden" name="unit" value="${esc(units[0])}">`
            : "";
        return;
    }
    const segments = units
        .map(
            (unit) =>
                `<label class="fd-segmented__option"><input class="fd-segmented__input" type="radio" name="unit" value="${esc(unit)}"${unit === selected ? " checked" : ""}><span class="fd-segmented__segment">${esc(unitSegmentLabel(unit, item))}</span></label>`,
        )
        .join("");
    slot.innerHTML = `<div class="fd-segmented fd-segmented--small" role="radiogroup" aria-label="Unit" data-fd-segmented>${segments}</div>`;
}

// The unit the amount is in: the checked segment, or the one a lone unit posts.
function currentUnit(form, item) {
    return (
        form.querySelector('input[name="unit"]:checked')?.value ||
        form.querySelector('input[type="hidden"][name="unit"]')?.value ||
        (item ? allowedUnits(item)[0] : "g")
    );
}

let lastLogOpener = null;

// The Top bar's search field is a wrapper around the input that takes focus;
// focus returns to the input, not to the wrapper.
const LOG_TRIGGER_FIELD = ".fd-top-bar .fd-search-field[data-fd-open-sheet]";

function focusableOpener(opener) {
    if (opener instanceof HTMLElement && opener.matches?.(LOG_TRIGGER_FIELD))
        return opener.querySelector(".fd-search-field__input") ?? opener;
    return opener;
}

function isLogTriggerInput(el) {
    return (
        el instanceof HTMLInputElement &&
        Boolean(el.closest?.(LOG_TRIGGER_FIELD))
    );
}

// Quick calories and Weigh in replace the search sheet, so one sheet shows.
const REPLACES_SEARCH = new Set([QUICK_CAL_ID, WEIGH_IN_ID]);

function openSheet(id, opener) {
    if (opener) lastLogOpener = focusableOpener(opener);
    if (REPLACES_SEARCH.has(id)) closeSheet(SEARCH_ID);
    const d = document.getElementById(id);
    if (d instanceof HTMLDialogElement && typeof d.showModal === "function") {
        if (!d.open) d.showModal();
    }
}

// Touch: no auto-focus, so the keyboard waits for a tap (sheet.js focused the panel).
function focusLogSearchInput(dialog, query) {
    const input = dialog?.querySelector("#fd-log-search-q");
    if (!(input instanceof HTMLInputElement)) return;
    if (query != null && query !== "") {
        input.value = query;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const touch =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches;
    if (!touch) input.focus();
}

function visibleLogOpener() {
    const desktop = document.querySelector(LOG_TRIGGER_FIELD);
    if (desktop instanceof HTMLElement && desktop.offsetParent !== null)
        return focusableOpener(desktop);
    const phone = document.querySelector("a.fd-log[data-fd-open-sheet]");
    if (phone instanceof HTMLElement && phone.offsetParent !== null)
        return phone;
    return (
        document.querySelector(".fd-top-bar a[data-fd-open-sheet]") ??
        document.querySelector("[data-fd-open-sheet]")
    );
}

// A meal's plus opens the search with that meal under ADD TO; any other way
// in (the Top bar, the shortcut, the Search tab) gets the server's default
// back when the last open chose another.
let searchMealChosenByOpener = false;

function preselectSearchMeal(dialog, opener) {
    const meal = opener?.getAttribute?.("data-fd-log-meal");
    if (!meal && !searchMealChosenByOpener) return;
    const radios = [
        ...dialog.querySelectorAll('input[name="search_meal_type"]'),
    ];
    const target = meal
        ? radios.find((r) => r.value === meal)
        : radios.find((r) => r.defaultChecked);
    searchMealChosenByOpener = Boolean(meal && target);
    if (!target || target.checked) return;
    target.checked = true;
    target.dispatchEvent(new Event("change", { bubbles: true }));
}

function openLogSearchSheet(opener, initialQuery) {
    const existing = document.getElementById(SEARCH_ID);
    if (existing && !existing.open) preselectSearchMeal(existing, opener);
    openSheet(SEARCH_ID, opener ?? visibleLogOpener());
    const dialog = document.getElementById(SEARCH_ID);
    if (dialog?.open) focusLogSearchInput(dialog, initialQuery);
}

function closeSheet(id) {
    const d = document.getElementById(id);
    if (d instanceof HTMLDialogElement) d.close();
}

// A recipe link pasted into the search: the lead icon becomes a link and Go
// imports it as a draft, as Recipes' own search does.
function isRecipeLink(text) {
    return /^https?:\/\/\S+$/i.test(String(text ?? "").trim());
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
    if (submit) setSubmitLabel(submit, mealType);
}

// The submit button's text is its label span, not the button itself.
function setSubmitLabel(button, mealType) {
    const label = button.querySelector(".fd-btn__label") ?? button;
    label.textContent = MEAL_LABEL[mealType] ?? MEAL_LABEL.dinner;
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
    const input = dialog.querySelector("#fd-log-search-q");
    const box = dialog.querySelector(".fd-sheet__search");
    const clearBtn = dialog.querySelector("[data-fd-log-search-clear]");
    const goBtn = dialog.querySelector("[data-fd-log-import-go]");
    const importForm = dialog.querySelector("[data-fd-log-import]");
    const results = dialog.querySelector("[data-fd-log-results]");
    const empty = dialog.querySelector("[data-fd-log-empty]");
    const recentRoot = dialog.querySelector("[data-fd-log-recent]");
    const recentSection = dialog.querySelector("[data-fd-log-recent-section]");
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
            ...(root?.querySelectorAll(".fd-item-row") ?? []),
        ]);
    }

    function syncActiveRow() {
        const rows = resultRows();
        for (let i = 0; i < rows.length; i++) {
            const on = i === activeRow;
            rows[i].classList.toggle("fd-item-row--active", on);
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

    const isPreview = !!dialog.querySelector(
        "[data-fd-log-results]:not([hidden]) .fd-item-row",
    );

    // A pasted recipe link swaps the lead icon for the link and shows Go.
    function syncLink() {
        const link = isRecipeLink(input?.value);
        if (box) {
            if (link) box.setAttribute("data-link-detected", "");
            else box.removeAttribute("data-link-detected");
        }
        if (goBtn) goBtn.hidden = !link;
        return link;
    }

    function importLink() {
        const url = String(input?.value ?? "").trim();
        if (!isRecipeLink(url) || !importForm) return;
        const field = importForm.querySelector('input[name="url"]');
        if (field) field.value = url;
        if (typeof importForm.requestSubmit === "function")
            importForm.requestSubmit();
        else importForm.submit();
    }

    async function fetchResults(q) {
        // Only the empty query is capped: it lists the ten latest distinct logs.
        const limit = q ? "" : "&limit=10";
        const url = `/api/log/search?q=${encodeURIComponent(q)}${online ? "&online=1" : ""}${limit}`;
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

    function pinnedFor(q) {
        const allow = FILTER[activeFilter] || FILTER.All;
        return allow.has("history") ? linkedMealFor(q) : null;
    }

    function paintRows(data) {
        const rows = filteredItems(data);
        const html = searchRowsHtml(
            rows,
            pinnedFor(String(input?.value || "")),
        );
        activeRow = -1;
        if (list) list.innerHTML = html;
        syncActiveRow();
    }

    function paintEmpty(data) {
        if (!recentRoot) return;
        const hist = (data?.groups || []).find((g) => g.kind === "history");
        const chips =
            hist?.items
                ?.map((i) => recentChipHtml({ ...i, kind: "history" }))
                .join("") || "";
        recentRoot.innerHTML = chips;
        // No recent logs: no Recent label over nothing.
        if (recentSection) recentSection.hidden = chips === "";
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
        const has = filteredItems(data).length > 0 || !!pinnedFor(q);
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
        const link = syncLink();
        if (clearBtn) clearBtn.hidden = q.length === 0;
        // A link is not a search: the sheet reads as it does empty, and Go
        // imports it.
        const seq = ++fetchSeq;
        const data = await fetchResults(link ? "" : q);
        if (seq !== fetchSeq) return;
        if (!data) return;
        if (link) {
            lastData = data;
            setMode(false);
            paintEmpty(data);
        } else paint(data);
    }

    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(run, DEBOUNCE_MS);
    }

    input?.addEventListener("input", () => {
        online = false;
        syncLink();
        if (clearBtn)
            clearBtn.hidden = String(input.value || "").trim().length === 0;
        schedule();
    });

    goBtn?.addEventListener("click", importLink);

    clearBtn?.addEventListener("click", () => {
        if (input) {
            input.value = "";
            input.focus();
        }
        online = false;
        run();
    });

    filters?.addEventListener("change", (event) => {
        const radio = event.target;
        if (radio?.name !== "fd_log_filter") return;
        activeFilter = radio.value || "All";
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
        linkedMeal = null;
        activeRow = -1;
        syncActiveRow();
        const back =
            lastLogOpener instanceof HTMLElement ? lastLogOpener : null;
        if (back?.isConnected) back.focus();
    });

    input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && syncLink()) {
            event.preventDefault();
            importLink();
            return;
        }
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

    dialog.addEventListener("change", (event) => {
        if (event.target?.name === "search_meal_type") {
            syncMealToAmount(root, searchMealType(dialog));
        }
    });
    syncLink();
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
        return `${brand} · ${kcal != null ? `${Math.round(kcal)} kcal` : ""} per ${perLabel(item)}`.trim();
    return `Generic · ${kcal != null ? `${Math.round(kcal)} kcal` : ""} per ${perLabel(item)}`.trim();
}

function syncPortionEcho(root, item, amount, unit) {
    const el = root?.querySelector("[data-fd-log-portion]");
    if (!el) return;
    const show = unit === "portion" && item?.serving && amount > 0;
    el.hidden = !show;
    el.textContent = show ? portionLabel(item.serving, amount) : "";
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

// "Today 5:10 PM": the When chip that logs at submit time.
function todayLabelNow() {
    const now = new Date();
    const h = now.getHours();
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `Today ${h % 12 || 12}:${mm} ${h >= 12 ? "PM" : "AM"}`;
}

// Pick a time shows the time box. A disabled field is not submitted, so
// "Today" logs at submit time.
function syncTimePick(form, modeName) {
    const wrap = form.querySelector("[data-fd-log-time-pick]");
    const input = wrap?.querySelector("input");
    if (!wrap || !input) return;
    const pick = form.querySelector(
        `input[name="${modeName}"][value="pick"]:checked`,
    );
    wrap.hidden = !pick;
    input.disabled = !pick;
}

function bindQuickCalSheet(root) {
    const dialog = document.getElementById(QUICK_CAL_ID);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (quickCalSheetInit.has(dialog)) return;
    quickCalSheetInit.add(dialog);
    const form = dialog.querySelector("#fd-log-quick-cal-form");
    const submit = dialog.querySelector("[data-fd-quick-cal-submit]");
    form?.addEventListener("change", (event) => {
        if (event.target?.name === "meal_type" && submit) {
            const meal = form.querySelector(
                'input[name="meal_type"]:checked',
            )?.value;
            setSubmitLabel(submit, meal);
        }
    });
}

function bindWeighInSheet(root) {
    const dialog = document.getElementById(WEIGH_IN_ID);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (weighInSheetInit.has(dialog)) return;
    weighInSheetInit.add(dialog);
    const form = dialog.querySelector("#fd-log-weigh-in-form");
    const todayLabel = dialog.querySelector("[data-fd-weigh-today-label]");
    if (todayLabel?.textContent?.startsWith("Today ")) {
        todayLabel.textContent = todayLabelNow();
    }
    form?.addEventListener("change", (event) => {
        if (event.target?.name === "fd_weigh_time_mode") {
            syncTimePick(form, "fd_weigh_time_mode");
        }
    });
}

function bindAmountSheet(root) {
    const dialog = root.querySelector(`#${AMOUNT_ID}`);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (amountSheetInit.has(dialog)) return;
    amountSheetInit.add(dialog);
    const form = dialog.querySelector("#fd-log-amount-form");
    const macroRoot = dialog.querySelector("[data-fd-log-macros]");
    const submit = dialog.querySelector("[data-fd-log-submit]");
    const stepperUnit = dialog.querySelector(".fd-stepper-control__unit");

    function refreshMacros() {
        if (!selectedItem || !form) return;
        const amount = Number(form.querySelector('[name="amount"]')?.value);
        const unit = currentUnit(form, selectedItem);
        renderMacroTiles(macroRoot, macrosFor(selectedItem, amount, unit));
        if (stepperUnit) stepperUnit.textContent = unit;
        form.dataset.fdUnit = unit;
        syncPortionEcho(dialog, selectedItem, amount, unit);
    }

    form?.addEventListener("input", refreshMacros);
    form?.addEventListener("change", (event) => {
        if (event.target?.name === "meal_type" && submit) {
            const meal = form.querySelector(
                'input[name="meal_type"]:checked',
            )?.value;
            setSubmitLabel(submit, meal);
        }
        if (event.target?.name === "unit") {
            // A portion count and a mass or volume are different scales:
            // keeping "1" would turn 1 portion into 1 ml.
            const amountInput = form.querySelector('[name="amount"]');
            if (amountInput) {
                amountInput.value = amountAfterUnitChange(
                    form.dataset.fdUnit,
                    String(event.target.value),
                    amountInput.value,
                );
            }
            refreshMacros();
        }
        if (event.target?.name === "fd_log_time_mode") {
            syncTimePick(form, "fd_log_time_mode");
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
    if (target.closest("[data-fd-log-time-pick]")) return false;
    if (target.closest("[data-fd-step]")) return false;
    if (target.closest(".fd-chip")) return false;
    if (target.closest(".fd-segmented")) return false;
    if (target.closest(".fd-item-row__add")) return false;
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

// The amount sheet has no subtitle until a food is picked: it is made here.
function setAmountSubtitle(dialog, text) {
    let sub = dialog?.querySelector(".fd-sheet__subtitle");
    if (!sub) {
        const titles = dialog?.querySelector(".fd-sheet__titles");
        if (!titles) return;
        sub = document.createElement("p");
        sub.className = "fd-sheet__subtitle";
        sub.id = `${AMOUNT_ID}-sub`;
        titles.appendChild(sub);
        dialog.setAttribute("aria-describedby", sub.id);
    }
    sub.textContent = text;
}

function pickItem(item) {
    if (!logItemIsRelivable(item)) return;
    selectedItem = item;
    const searchDialog = document.getElementById(SEARCH_ID);
    const searchMeal = searchDialog ? searchMealType(searchDialog) : "dinner";
    closeSheet(SEARCH_ID);
    const amountDialog = document.getElementById(AMOUNT_ID);
    const form = amountDialog?.querySelector("#fd-log-amount-form");
    const title = amountDialog?.querySelector(".fd-sheet__title");
    const submit = amountDialog?.querySelector("[data-fd-log-submit]");
    if (title) title.textContent = item.name || "Food";
    setAmountSubtitle(amountDialog, amountSubtitleLine(item));
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
        rebuildUnitChips(form, units, unit, item);
        const mealInput = form.querySelector(
            `input[name="meal_type"][value="${searchMeal}"]`,
        );
        if (mealInput) mealInput.checked = true;
        if (submit) setSubmitLabel(submit, searchMeal);
        const stepperUnit = form.querySelector(".fd-stepper-control__unit");
        if (stepperUnit) stepperUnit.textContent = unit;
        form.dataset.fdUnit = unit;
        syncPortionEcho(amountDialog, item, Number(amountInput?.value), unit);
        // The stepper sizes its box by the figure's length.
        amountInput?.dispatchEvent(new Event("input", { bubbles: true }));
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
            return;
        }
        // A result whose face is no link (a past meal) acts like its plus: it
        // opens the log form, or the meal's own search when it has no single
        // food. The row's links and its plus act for themselves.
        const row = event.target.closest?.(
            "[data-fd-log-row-pick], [data-fd-log-row-meal]",
        );
        if (
            row &&
            !modifiedClick &&
            !event.target.closest?.("a, button, form")
        ) {
            const raw = row.getAttribute("data-fd-log-row-pick");
            if (raw) {
                try {
                    pickItem(JSON.parse(raw));
                } catch (_) {}
            } else {
                // The meal's own search: the path is built here from its id,
                // never taken from the page as a whole address.
                const mealId = row.getAttribute("data-fd-log-row-meal");
                const open = mealId
                    ? `/?log=meal:${encodeURIComponent(mealId)}`
                    : "";
                if (open && window.Turbo?.visit) window.Turbo.visit(open);
                else if (open) window.location.assign(open);
            }
        }
    });
    document.addEventListener(
        "click",
        (event) => {
            const open = event.target.closest?.(
                "a.fd-log[data-fd-open-sheet], .fd-top-bar [data-fd-open-sheet]",
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
    // The Top bar's search field is a trigger: typing into it (reached by Tab)
    // moves what was typed into the sheet's search and opens it.
    document.addEventListener("input", (event) => {
        const input = event.target;
        if (!isLogTriggerInput(input)) return;
        const query = input.value;
        input.value = "";
        openLogSearchSheet(input, query);
    });
    // Enter and ArrowDown on the focused field open the sheet, as they did on
    // the link this field replaced.
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== "ArrowDown") return;
        if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            !isLogTriggerInput(event.target)
        )
            return;
        event.preventDefault();
        openLogSearchSheet(event.target);
    });
}

let logShortcutsBound = false;

function bindLogShortcuts() {
    if (logShortcutsBound) return;
    logShortcutsBound = true;
    document.addEventListener("keydown", (event) => {
        if (!isLogSearchShortcut(event)) return;
        const active = document.activeElement;
        if (isEditableTarget(active) && !isLogTriggerInput(active)) return;
        if (!document.querySelector(".fd-shell")) return;
        event.preventDefault();
        openLogSearchSheet(visibleLogOpener());
    });
}

// The log dialogs are rendered after .fd-shell, directly in <body>, so they
// are found from the document, not from the shell.
// The Quick grid's "Add to groceries" tile lands on the Groceries tab with
// ?add=1: open its add sheet once, then drop the flag so a reload does not.
function openGroceryAddFromLink() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") !== "1") return;
    const dialog = document.getElementById("fd-grocery-add");
    if (!(dialog instanceof HTMLDialogElement)) return;
    params.delete("add");
    const query = params.toString();
    window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    openSheet("fd-grocery-add");
}

// ?log=meal:<id> (a past meal chosen in search): open the log form prefilled
// from that meal once, then drop the flag so a reload does not. A meal with
// several items or free text has no single food to prefill, so it opens the
// search sheet on its name with that meal's own row first, whose Add button
// logs it again whole.
async function openLogFromLink() {
    const params = new URLSearchParams(window.location.search);
    const match = /^meal:([^/\s]+)$/.exec(params.get("log") ?? "");
    if (!match) return;
    params.delete("log");
    const query = params.toString();
    window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    let item;
    try {
        const res = await fetch(
            `/api/log/meal/${encodeURIComponent(match[1])}`,
            { headers: { accept: "application/json" } },
        );
        if (!res.ok) return;
        item = await res.json();
    } catch (_) {
        return;
    }
    const pick = { ...item, kind: "history" };
    if (logItemIsRelivable(pick)) pickItem(pick);
    else {
        linkedMeal = pick;
        openLogSearchSheet(null, item.name);
    }
}

function init() {
    if (!document.querySelector(".fd-shell")) return;
    openGroceryAddFromLink();
    void openLogFromLink();
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
        portionLabel,
        amountAfterUnitChange,
        openGroceryAddFromLink,
        openLogFromLink,
        allowedUnits,
        itemGrams,
        formatLogMacroKcal,
        formatLogMacroGrams,
        rebuildUnitChips,
        unitSegmentLabel,
        recentChipHtml,
        searchRowHtml,
        searchRowsHtml,
        linkedMealFor,
        isRecipeLink,
        currentUnit,
        macroValueHtml,
        renderMacroTiles,
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
