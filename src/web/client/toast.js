// Toast UI: flash seed from the server and FoodableApp.toast() for client actions.
const TOAST_CATALOG = null;

const TOAST_MAX_VISIBLE = 3;
// A toast leaves 3 s after it shows, on a tap, or on the next navigation,
// whichever comes first. Hover and focus never pause it: iPhone Safari fires
// mouseenter on a tap and never a mouseleave, so a pause there never ended.
const TOAST_AUTO_DISMISS_MS = 3000;
const TOAST_OUT_MS = 220;

// The live toasts and the timer each one waits on.
const toastTimers = new Map();
// Toasts already on their way out, so a tap after the timer (or the reverse) is one exit.
const toastLeaving = new WeakSet();
const TOAST_ICONS = {
    success: "\u2713",
    info: "i",
    warning: "!",
    error: "\u2715",
};

function toastKind(kind) {
    return Object.prototype.hasOwnProperty.call(TOAST_ICONS, kind)
        ? kind
        : "success";
}

function placeholderNames(text) {
    const names = [];
    const re = /\{([a-z_][a-z0-9_]*)\}/gi;
    let m;
    while ((m = re.exec(text))) {
        if (m[1]) names.push(m[1]);
    }
    return names;
}

function formatCatalogText(key, params) {
    const catalog = TOAST_CATALOG;
    if (!catalog || !Object.prototype.hasOwnProperty.call(catalog, key)) {
        return null;
    }
    const entry = catalog[key];
    let text = entry.text;
    const names = placeholderNames(text);
    if (params && names.length) {
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            if (!Object.prototype.hasOwnProperty.call(params, name)) continue;
            const raw = params[name];
            if (raw == null) continue;
            text = text.split("{" + name + "}").join(String(raw));
        }
    }
    return { kind: entry.kind, text: text };
}

function getToastRegion() {
    return document.getElementById("toast-region");
}

function stackToasts(region) {
    const items = region.querySelectorAll(".toast-item");
    for (let i = 0; i < items.length; i++) {
        const el = items[i];
        el.style.setProperty("--toast-depth", String(i));
        if (i >= TOAST_MAX_VISIBLE) {
            el.hidden = true;
        } else {
            el.hidden = false;
        }
    }
}

function cancelToastTimer(el) {
    const timer = toastTimers.get(el);
    if (timer != null) window.clearTimeout(timer);
    toastTimers.delete(el);
}

function dismissToast(el, region) {
    if (!el || !el.isConnected) return;
    if (toastLeaving.has(el)) return;
    toastLeaving.add(el);
    cancelToastTimer(el);
    el.classList.add("toast-item--out");
    window.setTimeout(function () {
        if (el.parentNode === region) region.removeChild(el);
        stackToasts(region);
    }, TOAST_OUT_MS);
}

// A navigation takes every toast with it, at once and without the exit motion.
// A toast meant for the page a POST redirects to is seeded on turbo:load, after
// this runs, so it still shows.
function clearToasts() {
    const region = getToastRegion();
    toastTimers.forEach(function (_timer, el) {
        cancelToastTimer(el);
    });
    if (!region) return;
    while (region.firstChild) region.removeChild(region.firstChild);
}

function showToastMessage(opts) {
    const region = getToastRegion();
    if (!region || !opts || !opts.text) return;
    const kind = toastKind(opts.kind);
    const hasAction = Boolean(opts.actionForm);
    const dismissMs =
        typeof opts.dismissMs === "number" && opts.dismissMs > 0
            ? opts.dismissMs
            : TOAST_AUTO_DISMISS_MS;

    const el = document.createElement(hasAction ? "div" : "button");
    if (!hasAction) el.type = "button";
    el.className = "toast-item toast-item--" + kind;
    if (hasAction) el.setAttribute("role", "status");

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = TOAST_ICONS[kind];
    el.appendChild(icon);

    const msg = document.createElement("span");
    msg.className = "toast-text";
    msg.textContent = opts.text;
    el.appendChild(msg);

    if (opts.actionForm) {
        const wrap = document.createElement("div");
        wrap.innerHTML = opts.actionForm;
        const form = wrap.firstElementChild;
        if (form) {
            form.addEventListener("submit", function () {
                dismissToast(el, region);
            });
            el.appendChild(form);
        }
    }

    region.insertBefore(el, region.firstChild);
    stackToasts(region);

    while (region.children.length > TOAST_MAX_VISIBLE) {
        cancelToastTimer(region.lastChild);
        region.removeChild(region.lastChild);
    }

    // A tap anywhere on the toast closes it. An action button runs first: its
    // form submits after this click handler, and the toast leaves after its exit
    // motion, so the form is still there to submit.
    el.addEventListener("click", function () {
        dismissToast(el, region);
    });

    toastTimers.set(
        el,
        window.setTimeout(function () {
            dismissToast(el, region);
        }, dismissMs),
    );
}

function consumeToastSeed(root) {
    const scope = root && root.querySelector ? root : document;
    const seed = scope.querySelector("#toast-seed");
    if (!seed) return;
    const kind = seed.getAttribute("data-toast-kind");
    const text = seed.getAttribute("data-toast-text");
    const dismissRaw = seed.getAttribute("data-toast-dismiss-ms");
    const dismissMs = dismissRaw ? Number(dismissRaw) : undefined;
    const actionForm =
        seed.getAttribute("data-toast-has-action") === "1"
            ? (seed.querySelector(".toast-action")?.outerHTML ?? "")
            : "";
    seed.remove();
    if (!text) return;
    showToastMessage({
        kind: toastKind(kind),
        text: text,
        dismissMs: dismissMs,
        actionForm: actionForm || undefined,
    });
}

function toastByKey(key, params) {
    const formatted = formatCatalogText(key, params);
    if (!formatted) return;
    showToastMessage(formatted);
}

window.FoodableApp.toast = toastByKey;
window.FoodableApp.toast.show = showToastMessage;

document.addEventListener("turbo:visit", clearToasts);

window.FoodableApp.onLoad(function (root) {
    consumeToastSeed(root);
});
