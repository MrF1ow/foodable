// Toast UI: flash seed from the server and FoodableApp.toast() for client actions.
const TOAST_CATALOG = null;

const TOAST_MAX_VISIBLE = 3;
const TOAST_AUTO_DISMISS_MS = 4000;
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

function dismissToast(el, region) {
    if (!el || !el.isConnected) return;
    el.classList.add("toast-item--out");
    window.setTimeout(function () {
        if (el.parentNode === region) region.removeChild(el);
        stackToasts(region);
    }, 220);
}

function showToastMessage(opts) {
    const region = getToastRegion();
    if (!region || !opts || !opts.text) return;
    const kind = toastKind(opts.kind);

    const el = document.createElement("button");
    el.type = "button";
    el.className = "toast-item toast-item--" + kind;

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = TOAST_ICONS[kind];
    el.appendChild(icon);

    const msg = document.createElement("span");
    msg.className = "toast-text";
    msg.textContent = opts.text;
    el.appendChild(msg);

    region.insertBefore(el, region.firstChild);
    stackToasts(region);

    while (region.children.length > TOAST_MAX_VISIBLE) {
        region.removeChild(region.lastChild);
    }

    let timer = null;
    let paused = false;

    function clearTimer() {
        if (timer != null) {
            window.clearTimeout(timer);
            timer = null;
        }
    }

    function scheduleDismiss() {
        clearTimer();
        if (paused) return;
        timer = window.setTimeout(function () {
            dismissToast(el, region);
        }, TOAST_AUTO_DISMISS_MS);
    }

    function pause() {
        paused = true;
        clearTimer();
        el.classList.add("toast-item--paused");
    }

    function resume() {
        paused = false;
        el.classList.remove("toast-item--paused");
        scheduleDismiss();
    }

    el.addEventListener("mouseenter", pause);
    el.addEventListener("mouseleave", resume);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", resume);
    el.addEventListener("click", function () {
        dismissToast(el, region);
    });

    scheduleDismiss();
}

function consumeToastSeed(root) {
    const scope = root && root.querySelector ? root : document;
    const seed = scope.querySelector("#toast-seed");
    if (!seed) return;
    const kind = seed.getAttribute("data-toast-kind");
    const text = seed.getAttribute("data-toast-text");
    seed.remove();
    if (!text) return;
    showToastMessage({
        kind: toastKind(kind),
        text: text,
    });
}

function toastByKey(key, params) {
    const formatted = formatCatalogText(key, params);
    if (!formatted) return;
    showToastMessage(formatted);
}

window.FoodableApp.toast = toastByKey;
window.FoodableApp.toast.show = showToastMessage;

window.FoodableApp.onLoad(function (root) {
    consumeToastSeed(root);
});
