// Recipe cook sheet: re-fetch "Takes from your kitchen" when the servings change
// or the sheet opens. The confirm reads the servings field, so the sheet works
// without this. Bound once on the document (beforetoggle does not bubble).

const DEBOUNCE_MS = 250;
const timers = new WeakMap();
const inflight = new WeakMap();

function servingsValue(input) {
    const n = Number(input.value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function syncUnit(form, value) {
    const unit = form.querySelector(".fd-stepper__unit");
    if (unit) unit.textContent = value === 1 ? "serving" : "servings";
}

async function refresh(form) {
    const url = form.getAttribute("data-fd-cook-preview-url");
    const input = form.querySelector('[name="servings"]');
    if (!url || !input) return;
    const value = servingsValue(input);
    // Mid-edit (empty, zero): keep what is shown.
    if (value == null) return;
    syncUnit(form, value);
    const previous = inflight.get(form);
    if (previous) previous.abort();
    const controller = new AbortController();
    inflight.set(form, controller);
    form.setAttribute("aria-busy", "true");
    try {
        const res = await fetch(
            `${url}?servings=${encodeURIComponent(value)}`,
            {
                headers: { Accept: "text/html" },
                credentials: "same-origin",
                signal: controller.signal,
            },
        );
        // 400 carries the fragment with its message.
        if (res.status !== 200 && res.status !== 400) return;
        const html = await res.text();
        const holder = document.createElement("template");
        holder.innerHTML = html.trim();
        const next = holder.content.querySelector("[data-fd-cook-region]");
        const current = form.querySelector("[data-fd-cook-region]");
        if (next && current) current.replaceWith(next);
    } catch (err) {
        // Aborted or offline: the old preview stays.
        void err;
    } finally {
        if (inflight.get(form) === controller) {
            inflight.delete(form);
            form.removeAttribute("aria-busy");
        }
    }
}

function schedule(form) {
    const pending = timers.get(form);
    if (pending) clearTimeout(pending);
    timers.set(
        form,
        setTimeout(() => {
            timers.delete(form);
            refresh(form);
        }, DEBOUNCE_MS),
    );
}

function cookFormOf(target) {
    if (!target || typeof target.closest !== "function") return null;
    return target.closest("[data-fd-cook-form]");
}

document.addEventListener("input", (event) => {
    const target = event.target;
    if (!target || target.name !== "servings") return;
    const form = cookFormOf(target);
    if (form) schedule(form);
});

document.addEventListener("change", (event) => {
    const target = event.target;
    if (!target || target.name !== "servings") return;
    const form = cookFormOf(target);
    if (form) schedule(form);
});

// Look again when the sheet opens: stock may have changed since page load.
document.addEventListener(
    "beforetoggle",
    (event) => {
        if (event.newState !== "open") return;
        const dialog = event.target;
        if (!dialog || typeof dialog.querySelector !== "function") return;
        const form = dialog.querySelector("[data-fd-cook-form]");
        if (form) refresh(form);
    },
    true,
);
