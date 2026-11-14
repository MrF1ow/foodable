// v2 autosave: a form marked `data-fd-autosave` submits itself when one of its
// fields is left with a new value (Settings › Goals today). It only calls
// `form.requestSubmit()`, so the server answers as it would to a Save button
// and Turbo morphs the 303 back to the page. Without this script Enter still
// submits the form, so nothing depends on it.
//
// An edit is never lost. Every listener sits on `document` (capture), so a
// form Turbo replaced after a 422 needs no re-binding, and the state is the
// page's, not a form's:
//  - One save is in flight at a time. A second field left meanwhile is queued
//    by name and sent once the first response has rendered: Turbo's
//    `Navigator.submitForm` stops the pending submission and its render, so
//    two requests overlapping lose the first edit.
//  - `change` and `blur` can both fire for one edit, and Enter fires a submit
//    of its own after `change`: a submit for the form in flight with the value
//    already sent is swallowed. A different value (the field edited again) is
//    queued like another field's.
//  - A field being edited (focused, or queued) keeps what was typed when the
//    response renders: the 303 morph skips the input
//    (`turbo:before-morph-element`) and a 422 body gets the typed text put back
//    (`turbo:before-render`) with the focus and caret (`turbo:render`). It then
//    still differs from its stored value, so leaving it saves it.
// A submit that never reports back must not wedge the queue: a timer releases it.
//  - A field the server rejected (422, `aria-invalid`) keeps its typed text and
//    its error through the next field's morph, until it is sent again.
//  - A save that fails on the network says so (a toast) and keeps the field's
//    text; it is retried after the next save that gets an answer, or when the
//    field is left again.
//  - Leaving the page (a Turbo visit elsewhere) while a save is in flight or
//    queued posts those fields with `fetch(keepalive)` instead of
//    `requestSubmit()`, which would stop the visit and bring the user back.

const SELECTOR = "form[data-fd-autosave]";
const INPUT = "[data-fd-autosave-input]";
const SAFETY_MS = 8000;
const AFTER_END_MS = 3000;

const sent = new WeakMap();
const waiting = new Set();
const failed = new Set();
let active = null;
let timer = 0;
let rendered = false;
let ended = false;
let restoreFocus = null;

// The marked form a node is, or belongs to (an input has `form`).
function formOf(node) {
    if (!node || !node.hasAttribute) return null;
    if (node.hasAttribute("data-fd-autosave")) return node;
    const form = node.form;
    return form && form.hasAttribute && form.hasAttribute("data-fd-autosave")
        ? form
        : null;
}

function inputOf(form) {
    return form.querySelector(INPUT);
}

// The field a form saves: Goals' hidden `field`, else the input's own name.
function nameOf(form) {
    const field = form.querySelector('input[name="field"]');
    if (field && field.value) return field.value;
    const input = inputOf(form);
    return (input && input.name) || "";
}

function findForm(root, name) {
    for (const form of root.querySelectorAll(SELECTOR)) {
        if (nameOf(form) === name) return form;
    }
    return null;
}

function block(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
}

function release() {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (active) sent.delete(active);
    active = null;
    rendered = false;
    ended = false;
    setTimeout(drain, 0);
}

// Send the next queued field, reading its value now (it may have changed).
function drain() {
    if (active) return;
    while (waiting.size > 0) {
        const name = waiting.values().next().value;
        waiting.delete(name);
        const form = findForm(document, name);
        const input = form && inputOf(form);
        if (!input || input.value === input.defaultValue) continue;
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        return;
    }
}

// The typed text of a field the user is editing: focused or queued, and not
// what the page shows from the server.
function isEditing(input, serverValue) {
    const form = formOf(input);
    if (!form || input.value === serverValue) return false;
    const name = nameOf(form);
    return (
        input === document.activeElement ||
        waiting.has(name) ||
        failed.has(name)
    );
}

function isRejected(form) {
    const input = inputOf(form);
    return !!input && input.getAttribute
        ? input.getAttribute("aria-invalid") === "true"
        : false;
}

function sayFailed() {
    const app = typeof window !== "undefined" ? window.FoodableApp : null;
    if (app && app.toast && typeof app.toast.show === "function") {
        app.toast.show({
            kind: "error",
            text: "Couldn't save. Check your connection; it saves again when you leave the field.",
        });
    }
}

document.addEventListener(
    "submit",
    (event) => {
        const form = formOf(event.target);
        if (!form) return;
        if (active === form) {
            const input = inputOf(form);
            if (input && input.value !== sent.get(form)) {
                waiting.add(nameOf(form));
            }
            block(event);
            return;
        }
        if (active) {
            waiting.add(nameOf(form));
            block(event);
            return;
        }
        active = form;
        rendered = false;
        ended = false;
        const input = inputOf(form);
        sent.set(form, input ? input.value : "");
        timer = setTimeout(release, SAFETY_MS);
    },
    true,
);

// The response arrived; the next save goes once its render has landed (or
// straight away when there is nothing to render, such as a network error).
document.addEventListener("turbo:submit-end", (event) => {
    const form = formOf(event.target);
    if (!form || form !== active) return;
    const detail = event.detail || {};
    if (!detail.fetchResponse) {
        // No answer at all (offline, aborted): keep the text, say so.
        const name = nameOf(form);
        const input = inputOf(form);
        if (name && input && input.value !== input.defaultValue) {
            failed.add(name);
            sayFailed();
        }
        release();
        return;
    }
    // An answer came back, so the network works again: retry what failed.
    for (const name of failed) waiting.add(name);
    failed.clear();
    if (rendered) {
        release();
        return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(release, AFTER_END_MS);
    ended = true;
});

document.addEventListener("turbo:render", () => {
    if (restoreFocus) {
        const form = findForm(document, restoreFocus.name);
        const input = form && inputOf(form);
        if (input && input !== document.activeElement) {
            input.focus({ preventScroll: true });
            if (input.setSelectionRange) {
                try {
                    input.setSelectionRange(
                        restoreFocus.start,
                        restoreFocus.end,
                    );
                } catch (_) {
                    // Not every input type has a selection.
                }
            }
        }
        restoreFocus = null;
    }
    rendered = true;
    if (active && ended) release();
});

// A 303 refresh morphs the page in place: leave an input being edited alone,
// and a field the server rejected (its typed text and error) unless it is the
// one this response answers.
document.addEventListener("turbo:before-morph-element", (event) => {
    const input = event.target;
    if (!input || !input.hasAttribute) return;
    if (input.hasAttribute("data-fd-autosave")) {
        if (input !== active && isRejected(input)) event.preventDefault();
        return;
    }
    if (!input.hasAttribute("data-fd-autosave-input")) return;
    const next = event.detail && event.detail.newElement;
    if (isEditing(input, next ? next.value : "")) event.preventDefault();
});

// A 422 replaces the body: put the typed text of the fields being edited into
// the new one, and remember which field had the focus.
document.addEventListener("turbo:before-render", (event) => {
    const body = event.detail && event.detail.newBody;
    if (!body || !body.querySelectorAll) return;
    restoreFocus = null;
    for (const form of document.querySelectorAll(SELECTOR)) {
        const input = inputOf(form);
        if (!input || input.value === input.defaultValue) continue;
        const name = nameOf(form);
        if (input !== document.activeElement && !waiting.has(name)) continue;
        const target = findForm(body, name);
        const next = target && inputOf(target);
        if (!next) continue;
        next.value = input.value;
        if (input === document.activeElement) {
            restoreFocus = {
                name,
                start: input.selectionStart,
                end: input.selectionEnd,
            };
        }
    }
});

// Leaving for another page: post what is in flight or queued without Turbo
// (a `requestSubmit()` now would stop the visit), then forget it.
document.addEventListener("turbo:before-visit", (event) => {
    if (!active && waiting.size === 0) return;
    const url = event.detail && event.detail.url;
    if (typeof location !== "undefined" && url) {
        try {
            if (new URL(url, location.href).pathname === location.pathname) {
                return; // our own 303 back to this page
            }
        } catch (_) {
            return;
        }
    }
    const forms = [];
    if (active && !ended && !rendered) forms.push(active);
    for (const name of waiting) {
        const form = findForm(document, name);
        if (form && form !== active) forms.push(form);
    }
    if (typeof fetch === "function" && typeof FormData === "function") {
        for (const form of forms) {
            try {
                fetch(form.action, {
                    method: "POST",
                    body: new FormData(form),
                    credentials: "same-origin",
                    keepalive: true,
                });
            } catch (_) {
                // Best effort: the page is going away.
            }
        }
    }
    waiting.clear();
    failed.clear();
    if (timer) clearTimeout(timer);
    timer = 0;
    active = null;
    rendered = false;
    ended = false;
});

function maybeSubmit(event) {
    const target = event.target;
    if (!target || !target.hasAttribute) return;
    if (!target.hasAttribute("data-fd-autosave-input")) return;
    const form = formOf(target);
    if (!form) return;
    const last = sent.has(form) ? sent.get(form) : target.defaultValue;
    if (target.value === last) return;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
}
document.addEventListener("change", maybeSubmit, true);
document.addEventListener("focusout", maybeSubmit, true);
