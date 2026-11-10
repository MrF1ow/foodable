// Today: week-strip swipe navigation, meal row → edit sheet, live edit macros.
const MQ_REDUCED = "(prefers-reduced-motion: reduce)";
const WEEK_SWIPE_SLOP = 12;
const WEEK_SWIPE_MIN = 48;

const mq = (q) =>
    typeof window.matchMedia === "function" && window.matchMedia(q).matches;

function visit(href) {
    if (!href) return;
    if (typeof window.Turbo !== "undefined" && window.Turbo.visit) {
        window.Turbo.visit(href);
        return;
    }
    window.location.assign(href);
}

/**
 * @param {{ dx: number, dy: number, threshold?: number }} opts
 * @returns {"prev"|"next"|null}
 */
function weekSwipeDecision({ dx, dy, threshold = WEEK_SWIPE_MIN }) {
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < WEEK_SWIPE_SLOP && ady < WEEK_SWIPE_SLOP) return null;
    if (ady > adx) return null;
    if (dx <= -threshold) return "next";
    if (dx >= threshold) return "prev";
    return null;
}

if (typeof window !== "undefined" && window.FOODABLE_EXPOSE_TODAY_WEEK) {
    window.FOODABLE_EXPOSE_TODAY_WEEK(weekSwipeDecision);
}

if (typeof window !== "undefined" && window.FOODABLE_EXPOSE_TODAY_EDIT) {
    window.FOODABLE_EXPOSE_TODAY_EDIT({
        parseNum,
        updateMacroTiles,
        scaleTiles,
        tileValues,
    });
}

function parseNum(raw) {
    if (raw == null || String(raw).trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function tileValues(root) {
    const calories = parseNum(root.getAttribute("data-fd-calories"));
    const protein_g = parseNum(root.getAttribute("data-fd-protein"));
    const carbs_g = parseNum(root.getAttribute("data-fd-carbs"));
    const fat_g = parseNum(root.getAttribute("data-fd-fat"));
    return { calories, protein_g, carbs_g, fat_g };
}

function scaleTiles(root, factor) {
    const v = tileValues(root);
    const scale = (n) => (n == null ? null : Math.round(n * factor * 10) / 10);
    return {
        calories: v.calories == null ? null : Math.round(v.calories * factor),
        protein_g: scale(v.protein_g),
        carbs_g: scale(v.carbs_g),
        fat_g: scale(v.fat_g),
    };
}

function updateMacroTiles(container, macros) {
    if (!container) return;
    const tiles = container.querySelectorAll(".fd-tile");
    tiles.forEach((tile) => {
        const label = tile.querySelector(".fd-tile__label");
        const valueEl = tile.querySelector(".fd-tile__value");
        if (!label || !valueEl) return;
        const text = label.textContent || "";
        const key = text.toLowerCase();
        let val = null;
        if (key.includes("kcal")) val = macros.calories;
        else if (key.includes("protein")) val = macros.protein_g;
        else if (key.includes("carbs")) val = macros.carbs_g;
        else if (key.includes("fat")) val = macros.fat_g;
        // Keep the unit span the server rendered; grams under 10 keep a tenth.
        const unitEl =
            typeof valueEl.querySelector === "function"
                ? valueEl.querySelector(".fd-stat__unit")
                : null;
        let shown = "—";
        if (val != null) {
            shown = key.includes("kcal")
                ? String(Math.round(val))
                : String(
                      val < 10 ? Math.round(val * 10) / 10 : Math.round(val),
                  );
        }
        valueEl.textContent = shown;
        if (unitEl) valueEl.append(unitEl);
    });
}

function initWeekSwipe(strip) {
    if (strip.dataset.fdWeekSwipeInit === "1") return;
    strip.dataset.fdWeekSwipeInit = "1";
    const prev = strip.getAttribute("data-fd-week-prev") || "";
    const next = strip.getAttribute("data-fd-week-next") || "";
    let startX = 0;
    let startY = 0;
    let tracking = false;
    strip.addEventListener(
        "pointerdown",
        (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            if (mq(MQ_REDUCED)) return;
            tracking = true;
            startX = e.clientX;
            startY = e.clientY;
        },
        { passive: true },
    );
    strip.addEventListener(
        "pointerup",
        (e) => {
            if (!tracking) return;
            tracking = false;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const dir = weekSwipeDecision({ dx, dy });
            if (dir === "prev" && prev) visit(prev);
            if (dir === "next" && next) visit(next);
        },
        { passive: true },
    );
    strip.addEventListener("pointercancel", () => {
        tracking = false;
    });
}

function openSheet(id) {
    const dialog = document.getElementById(id);
    if (!dialog || typeof dialog.showModal !== "function" || dialog.open) {
        return;
    }
    dialog.showModal();
}

function initMealRows(root) {
    root.querySelectorAll("[data-fd-meal-row]").forEach((row) => {
        if (row.dataset.fdMealRowInit === "1") return;
        row.dataset.fdMealRowInit = "1";
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

function initEditMacros(root) {
    root.querySelectorAll("[data-fd-edit-macros]").forEach((macroRoot) => {
        const form = macroRoot.closest("form");
        if (!form) return;
        const rerender = () => {
            const itemRows = form.querySelectorAll("[data-fd-edit-item]");
            if (itemRows.length === 0) {
                const servings = form.querySelector('input[name="servings"]');
                const host = form.querySelector("[data-fd-edit-servings]");
                if (!servings || !host) return;
                const base = Number(servings.defaultValue || servings.value);
                const val = Number(servings.value);
                if (
                    !Number.isFinite(val) ||
                    !Number.isFinite(base) ||
                    base <= 0
                )
                    return;
                updateMacroTiles(macroRoot, scaleTiles(host, val / base));
                return;
            }
            // Null-aware: a macro no item knows stays unknown, never 0.
            const totals = {
                calories: null,
                protein_g: null,
                carbs_g: null,
                fat_g: null,
            };
            const add = (key, n) => {
                if (n == null) return;
                totals[key] = (totals[key] ?? 0) + n;
            };
            let any = false;
            itemRows.forEach((row) => {
                const input = row.querySelector("input[type='number']");
                const base = parseNum(row.getAttribute("data-fd-base-amount"));
                if (!input || base == null || base <= 0) return;
                const val = Number(input.value);
                if (!Number.isFinite(val)) return;
                const scaled = scaleTiles(row, val / base);
                any = true;
                add("calories", scaled.calories);
                add("protein_g", scaled.protein_g);
                add("carbs_g", scaled.carbs_g);
                add("fat_g", scaled.fat_g);
            });
            if (!any) return;
            updateMacroTiles(macroRoot, totals);
        };
        form.addEventListener("input", rerender);
        form.addEventListener("change", rerender);
    });
}

function initToday(root) {
    const scope = root && root.querySelector ? root : document;
    scope.querySelectorAll("[data-fd-week-strip]").forEach(initWeekSwipe);
    initMealRows(scope);
    initEditMacros(scope);
}

window.FoodableApp.onLoad(initToday);
