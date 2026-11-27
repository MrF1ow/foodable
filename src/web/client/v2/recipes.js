// Recipes list: the search field. Typing filters the rows on the page (the
// server stays the source on load and on Enter), reads "N of M recipes" in the
// heading and shows the clear X; a pasted recipe link swaps the
// lead icon for the link, shows Go and hides the filter, and Enter or Go posts
// the link to /recipes/import through the page's own import form.
const bound = new WeakSet();

function isLink(text) {
    return /^https?:\/\/\S+$/i.test(String(text ?? "").trim());
}

function bindSearch(form) {
    if (bound.has(form)) return;
    bound.add(form);
    const input = form.querySelector(".fd-search-field__input");
    const box = form.querySelector(".fd-search-field");
    const go = form.querySelector("[data-fd-recipes-import-go]");
    const importForm = document.querySelector("[data-fd-recipes-import]");
    const clearButton = form.querySelector("[data-fd-search-clear]");
    if (!(input instanceof HTMLInputElement) || !box) return;
    const section = document.querySelector("[data-fd-recipes-total]");
    const label = section?.querySelector(".fd-section-header__label");
    const count = section?.querySelector(".fd-section-header__count");
    const total = Number(section?.getAttribute("data-fd-recipes-total"));
    // The heading the server drew, to put back when the field is emptied.
    const headLabel = label ? label.textContent : "";
    const headCount = count ? count.textContent : "";

    function sync() {
        const link = isLink(input.value);
        if (link) box.setAttribute("data-link-detected", "");
        else box.removeAttribute("data-link-detected");
        if (go) go.hidden = !link;
        if (clearButton) clearButton.hidden = input.value === "";
        return link;
    }

    // Typing narrows "All recipes" to "N of M recipes" for the rows left, as
    // the server's answer to Enter does; emptying the field restores it.
    function head(narrowed, shown) {
        if (!label) return;
        if (narrowed && Number.isFinite(total)) {
            label.textContent = `${shown} of ${total} recipes`;
            if (count) count.hidden = true;
        } else {
            label.textContent = headLabel;
            if (count) {
                count.textContent = headCount;
                count.hidden = false;
            }
        }
    }

    function importLink() {
        const url = input.value.trim();
        const target = importForm?.querySelector('input[name="url"]');
        if (!importForm || !target) return;
        target.value = url;
        importForm.requestSubmit();
    }

    input.addEventListener("input", () => {
        const link = sync();
        const text = input.value.trim().toLowerCase();
        let shown = 0;
        for (const row of document.querySelectorAll(".fd-recipes-row")) {
            const title = row.querySelector(".fd-item-row__title");
            row.hidden =
                !link &&
                text !== "" &&
                !(title?.textContent ?? "").toLowerCase().includes(text);
            if (!row.hidden) shown += 1;
        }
        head(!link && text !== "", shown);
    });
    form.addEventListener("submit", (event) => {
        if (!isLink(input.value) || !importForm) return;
        event.preventDefault();
        importLink();
    });
    form.addEventListener("click", (event) => {
        if (!event.target.closest?.("[data-fd-search-clear]")) return;
        input.value = "";
        sync();
        form.requestSubmit();
    });
    sync();
}

// The Plan sheet (renderPlanSheet): the Starts row opens a month picker, a
// Repeat of "Pick days" shows the weekday chips, and the chips keep one hidden
// `days` field each, so the form posts the same fields with or without them.
const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

function pad(n) {
    return String(n).padStart(2, "0");
}

function isoDay(year, month, day) {
    return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function dayLabel(day, today) {
    const at = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(at.getTime())) return day;
    if (day === today) return "Today";
    const next = new Date(`${today}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (day === next.toISOString().slice(0, 10)) return "Tomorrow";
    return `${WEEKDAYS[at.getUTCDay()].slice(0, 3)} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()].slice(0, 3)}`;
}

function showMonth(picker, year, month) {
    const grid = picker.querySelector("[data-fd-month-grid]");
    const field = picker
        .closest("form")
        ?.querySelector("[data-fd-month-field]");
    if (!grid) return;
    const today = picker.getAttribute("data-today") || "";
    const min = picker.getAttribute("data-min") || "";
    const picked = field ? field.value : "";
    picker.setAttribute("data-month", `${year}-${pad(month + 1)}`);
    const label = picker.querySelector("[data-fd-month-label]");
    if (label) label.textContent = `${MONTHS[month]} ${year}`;
    const prev = picker.querySelector("[data-fd-month-prev]");
    if (prev) prev.disabled = min !== "" && isoDay(year, month, 1) <= min;
    grid.textContent = "";
    for (let i = 0; i < new Date(Date.UTC(year, month, 1)).getUTCDay(); i++) {
        const blank = document.createElement("span");
        blank.className = "fd-month-picker__blank";
        blank.setAttribute("aria-hidden", "true");
        grid.append(blank);
    }
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let n = 1; n <= length; n++) {
        const day = isoDay(year, month, n);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "fd-month-picker__day";
        if (day === picked)
            button.classList.add("fd-month-picker__day--picked");
        if (day === today) {
            button.classList.add("fd-month-picker__day--today");
            button.setAttribute("aria-current", "date");
        }
        button.setAttribute("data-fd-month-day", day);
        button.setAttribute("aria-pressed", String(day === picked));
        button.setAttribute(
            "aria-label",
            `${WEEKDAYS[new Date(Date.UTC(year, month, n)).getUTCDay()]} ${n} ${MONTHS[month]}`,
        );
        button.disabled = min !== "" && day < min;
        button.textContent = String(n);
        grid.append(button);
    }
}

function syncRepeat(form) {
    const field = form.querySelector('[data-fd-menu-field][name="repeat"]');
    const days = form.querySelector("[data-fd-plan-days]");
    if (!field || !days) return;
    const picking = field.value === "days";
    days.hidden = !picking;
    const fields = days.querySelector("[data-fd-plan-days-fields]");
    // Weekdays go with a repeat of days only, so the others post none.
    if (fields && !picking) fields.textContent = "";
    if (fields && picking && fields.children.length === 0) {
        for (const chip of days.querySelectorAll(".fd-pill-chip--on")) {
            addDay(fields, chip.getAttribute("data-value"));
        }
    }
}

function addDay(fields, value) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "days";
    input.value = value;
    fields.append(input);
}

const boundPlans = new WeakSet();

function bindPlan(form) {
    if (boundPlans.has(form)) return;
    boundPlans.add(form);
    form.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const toggle = target.closest("[data-fd-month-toggle]");
        const picker = form.querySelector("[data-fd-month-picker]");
        if (!picker) return;
        if (toggle) {
            const open = picker.hidden;
            picker.hidden = !open;
            toggle.setAttribute("aria-expanded", String(open));
            return;
        }
        const [year, month] = (picker.getAttribute("data-month") || "")
            .split("-")
            .map(Number);
        if (target.closest("[data-fd-month-prev]")) {
            showMonth(picker, month === 1 ? year - 1 : year, (month + 10) % 12);
            return;
        }
        if (target.closest("[data-fd-month-next]")) {
            showMonth(picker, month === 12 ? year + 1 : year, month % 12);
            return;
        }
        const day = target.closest("[data-fd-month-day]");
        if (!day || day.disabled) return;
        const value = day.getAttribute("data-fd-month-day");
        const field = form.querySelector("[data-fd-month-field]");
        if (field) field.value = value;
        const shown = form.querySelector(
            "[data-fd-month-toggle] .fd-item-row__value",
        );
        if (shown) {
            shown.textContent = dayLabel(
                value,
                picker.getAttribute("data-today") || "",
            );
        }
        for (const other of picker.querySelectorAll("[data-fd-month-day]")) {
            const on = other === day;
            other.setAttribute("aria-pressed", String(on));
            other.classList.toggle("fd-month-picker__day--picked", on);
        }
        picker.hidden = true;
        form.querySelector("[data-fd-month-toggle]")?.setAttribute(
            "aria-expanded",
            "false",
        );
    });
    form.addEventListener("change", (event) => {
        const target = event.target;
        if (
            target instanceof HTMLInputElement &&
            target.getAttribute("name") === "repeat"
        ) {
            syncRepeat(form);
            return;
        }
        const chips = target instanceof Element ? target : null;
        if (
            !chips?.matches("[data-fd-chips]") ||
            !chips.closest("[data-fd-plan-days]")
        ) {
            return;
        }
        const fields = form.querySelector("[data-fd-plan-days-fields]");
        if (!fields) return;
        fields.textContent = "";
        for (const value of event.detail?.values ?? []) addDay(fields, value);
    });
}

// The importer's first landing on a draft asks before anything leaves it: the
// "Discard this recipe?" sheet opens instead (Keep editing closes it; Discard
// posts the discard route). It holds a link click, a Turbo visit that is not
// a link click, and a form that leaves (a GET to another path, Log out). The
// page's own actions go through: a form posting under the recipe's own path
// (Save, the menu's Discard, the ingredient ⋯ actions) and a visit back to
// this same page. The browser's back button and a closed tab cannot be held
// reliably, so they are not tried; the sheet's words hold for every path.
// The sheet is only on that landing, so every handler is inert elsewhere.
let leaveGuarded = false;
let ownSubmit = false;
let discarding = false;

function leaveSheet() {
    return document.getElementById("fd-recipe-leave-sheet");
}

function openLeaveSheet(sheet) {
    if (!sheet.open) sheet.showModal();
}

// Where a form posts, as a path: its submitter's `formaction` wins.
function formPath(form, submitter) {
    const action =
        (submitter && submitter.formAction) ||
        form.action ||
        form.getAttribute("action") ||
        "";
    try {
        return new URL(action, "http://fd.invalid").pathname;
    } catch (_) {
        return "";
    }
}

// The recipe's own routes: the sheet's discard form posts under them.
function ownPrefix() {
    const form = document.getElementById("fd-recipe-leave-form");
    const path = form ? formPath(form, null) : "";
    return path.endsWith("/discard")
        ? path.slice(0, path.length - "discard".length)
        : null;
}

function isDiscardPath(path) {
    return /\/discard$/.test(path) && path.startsWith("/recipes/");
}

function guardLeaving() {
    if (leaveGuarded) return;
    leaveGuarded = true;
    document.addEventListener(
        "click",
        (event) => {
            const sheet = leaveSheet();
            if (!sheet || event.defaultPrevented || event.button !== 0) return;
            if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            ) {
                return;
            }
            const link =
                event.target instanceof Element
                    ? event.target.closest("a[href]")
                    : null;
            if (!link || sheet.contains(link)) return;
            const target = link.getAttribute("target");
            if (target && target !== "_self") return;
            if (link.hasAttribute("download")) return;
            const href = link.getAttribute("href") || "";
            if (href === "" || href.startsWith("#")) return;
            event.preventDefault();
            event.stopPropagation();
            openLeaveSheet(sheet);
        },
        true,
    );
    document.addEventListener(
        "submit",
        (event) => {
            const form = event.target;
            if (!form || !form.getAttribute) return;
            const path = formPath(form, event.submitter);
            // A discard, from the sheet or the menu, is the page's own, and
            // Turbo's back button must not bring the deleted draft back.
            if (isDiscardPath(path)) discarding = true;
            const sheet = leaveSheet();
            if (!sheet || sheet.contains(form)) {
                if (sheet) ownSubmit = true;
                return;
            }
            const own = ownPrefix();
            if (own && path.startsWith(own)) {
                ownSubmit = true;
                return;
            }
            const method = (form.method || "get").toLowerCase();
            const leaves =
                path === "/logout" ||
                (method === "get" && path !== location.pathname);
            // Any other form (a log sheet's water, the bell) is the person
            // acting: it is sent, and its redirect is let through too.
            if (!leaves) {
                ownSubmit = true;
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            openLeaveSheet(sheet);
        },
        true,
    );
    document.addEventListener("turbo:before-visit", (event) => {
        const sheet = leaveSheet();
        if (!sheet) return;
        if (ownSubmit) {
            ownSubmit = false;
            return;
        }
        const url = event.detail && event.detail.url;
        try {
            if (new URL(url, location.href).pathname === location.pathname) {
                return; // our own 303 back to this page
            }
        } catch (_) {
            return;
        }
        event.preventDefault();
        openLeaveSheet(sheet);
    });
    document.addEventListener("turbo:submit-end", (event) => {
        if (event.detail && event.detail.success === false) {
            ownSubmit = false;
            discarding = false;
        }
    });
    document.addEventListener("turbo:load", () => {
        ownSubmit = false;
        if (!discarding) return;
        discarding = false;
        if (typeof Turbo !== "undefined" && Turbo.cache) Turbo.cache.clear();
    });
}

// Missing for the plan: the button counts the ticked foods, and is off at none.
const boundMissing = new WeakSet();

function bindMissing(form) {
    if (boundMissing.has(form)) return;
    boundMissing.add(form);
    const add = document.querySelector(
        '[data-fd-plan-missing-add][form="' + form.id + '"]',
    );
    function sync() {
        if (!add) return;
        // Per food: a food on two rows is one box, and counts once.
        const foods = new Set();
        for (const box of form.querySelectorAll('input[name="food_ids[]"]')) {
            if (box.checked) foods.add(box.value);
        }
        const n = foods.size;
        const text = add.querySelector(".fd-btn__label") || add;
        text.textContent = "Add " + n + " to groceries";
        add.disabled = n === 0;
    }
    form.addEventListener("change", sync);
    sync();
}

FoodableApp.onLoad((root) => {
    for (const form of root.querySelectorAll("[data-fd-recipes-search]")) {
        bindSearch(form);
    }
    for (const form of root.querySelectorAll("[data-fd-plan-missing]")) {
        bindMissing(form);
    }
    for (const form of root.querySelectorAll("[data-fd-plan-form]")) {
        bindPlan(form);
    }
    guardLeaving();
});
