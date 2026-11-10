// The redesign's sheet (dialog.fd-sheet): native showModal/close, backdrop
// dismiss, focus on open and returned to the invoker on close, drag to
// dismiss, page scroll lock, and reopen after a 4xx re-render.
// Modeled on ../modal.js and independent of it (own scroll-lock counter).
// Guards match shell.js: tests run this against a fake window.
//
// Platform notes. The `command` / `commandfor` invoker attributes (and the
// `command` event whose `source` names the button) and the `beforetoggle`
// event on dialogs are recent: the same browser exposure as today's
// `modalTrigger`, so nothing here needs more than that. Native `showModal()`
// already returns focus to the previously focused element on close; the
// invoker tracking below only exists because Safari does not focus a button on
// click, so `document.activeElement` is the body when the sheet opens.
const MQ_PANEL = "(min-width: 1024px)"; // the one breakpoint: no bottom sheet at or above it
const MQ_COARSE = "(pointer: coarse)"; // drag-to-dismiss is a touch gesture
const MQ_REDUCED = "(prefers-reduced-motion: reduce)";
// Release past this many px of downward travel closes the sheet.
const DRAG_CLOSE_PX = 80;
// ...or a flick faster than this (px per ms) that moved at least FLICK_MIN_PX.
const FLICK_VELOCITY = 0.8;
const FLICK_MIN_PX = 12;
// A pointer that sat still this long before release is no longer flicking.
const FLICK_STALE_MS = 100;
const SNAP_BACK = "transform 180ms ease-out";

const mq = (q) =>
    typeof window.matchMedia === "function" && window.matchMedia(q).matches;

let openSheetCount = 0;
let scrollLockY = 0;
let bodyWasFixed = false; // true only while THIS module owns the body lock

// modal.js may already hold the lock (it sets body position:fixed too); never
// take over a lock another module owns, and never clear one we did not take.
// A sheet that opened under a modal's lock takes it when the next sheet opens.
// Stacking an old modal on top of a sheet is unsupported: modal.js would read
// scrollY as 0 under our fixed body. The two never nest today.
function lockPageScroll() {
    if (
        openSheetCount >= 1 &&
        !bodyWasFixed &&
        document.body &&
        document.body.style.position !== "fixed"
    ) {
        scrollLockY = window.scrollY ?? window.pageYOffset ?? 0;
        bodyWasFixed = true;
        document.body.style.position = "fixed";
        document.body.style.top = `-${scrollLockY}px`;
        document.body.style.width = "100%";
    }
}

function unlockPageScroll() {
    if (openSheetCount === 0 && bodyWasFixed && document.body) {
        if (document.querySelectorAll("dialog.modal[open]").length > 0) {
            // A modal is still open and holds the page too: leave the styles to
            // modal.js, which clears them when its last dialog closes.
            bodyWasFixed = false;
            return;
        }
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        bodyWasFixed = false;
        window.scrollTo(0, scrollLockY);
    }
}

// Per-dialog open state, so the toggle/close events and the direct calls below
// can overlap without counting one sheet twice.
const sheetState = new WeakMap();

// Returns true when this call counted the sheet open (false: already counted).
function markOpen(dialog) {
    const state = sheetState.get(dialog);
    if (!state || state.counted) return false;
    state.counted = true;
    openSheetCount += 1;
    lockPageScroll();
    return true;
}

function markClosed(dialog) {
    const state = sheetState.get(dialog);
    if (!state || !state.counted) return;
    state.counted = false;
    openSheetCount = Math.max(0, openSheetCount - 1);
    unlockPageScroll();
}

// Turbo must never cache a locked page. modal.js also closes every open dialog
// here; both handlers are safe to run in either order.
function releaseScrollLockForSwap() {
    document.querySelectorAll("dialog.fd-sheet[open]").forEach((dialog) => {
        if (typeof dialog.close === "function") dialog.close();
    });
    openSheetCount = 0;
    if (bodyWasFixed && document.body) {
        const y = scrollLockY;
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        bodyWasFixed = false;
        window.scrollTo(0, y);
        window.dispatchEvent(
            new CustomEvent("foodable:scroll-lock-release", {
                detail: { y },
            }),
        );
    }
}

document.addEventListener("turbo:before-render", releaseScrollLockForSwap);
// Parity with modal.js. A morph would strip the server-rendered dialog's `open`
// attribute anyway, and today morphs only follow the page's own form submits,
// so this is a safety net rather than a path anything exercises yet.
document.addEventListener("turbo:before-morph-element", (event) => {
    const el = event.detail?.currentElement;
    if (el && el.classList && el.classList.contains("fd-sheet")) {
        releaseScrollLockForSwap();
    }
});

function focusFirstField(dialog) {
    if (!dialog) return;
    if (dialog.dataset?.fdSheetFocus === "panel") {
        const panel = dialog.querySelector(".fd-sheet-panel");
        if (panel && typeof panel.focus === "function") {
            panel.focus({ preventScroll: true });
        }
        return;
    }
    const field = dialog.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    if (field && typeof field.focus === "function") {
        field.focus();
        return;
    }
    // No field (a confirmation): park focus on the panel so showModal's own
    // pick, the close button, does not light up its focus ring uninvited.
    const panel = dialog.querySelector(".fd-sheet-panel");
    if (panel && typeof panel.focus === "function") {
        panel.focus({ preventScroll: true });
    }
}

const isConnected = (el) => !!el && el.isConnected !== false;

const sheetInit = new WeakSet();

function initSheet(dialog) {
    if (typeof dialog.showModal !== "function") return;
    if (sheetInit.has(dialog)) return;
    sheetInit.add(dialog);
    sheetState.set(dialog, { counted: false });

    let invoker = null;

    const rememberInvoker = (el) => {
        if (el && el !== dialog && el !== document.body && isConnected(el)) {
            invoker = el;
        }
    };

    // Drag state. Declared before the handlers that reset it.
    let startY = 0;
    let dragY = 0;
    let dragging = false;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let pointerId = null;

    const resetDrag = () => {
        stopListening();
        dragging = false;
        pointerId = null;
        dragY = 0;
        velocity = 0;
        dialog.style.transform = "";
        dialog.style.transition = "";
    };

    // Native command="show-modal": event.source is the invoking button.
    dialog.addEventListener("command", (e) => rememberInvoker(e.source));
    // Fires synchronously before the sheet opens, while focus is still on the
    // invoker (covers showModal() called from script, too).
    dialog.addEventListener("beforetoggle", (e) => {
        if (e.newState === "open") rememberInvoker(document.activeElement);
    });

    const onOpened = () => {
        // initSheets already counted and focused an open-on-load sheet; the
        // toggle event that follows must not focus a second time.
        if (markOpen(dialog)) focusFirstField(dialog);
    };
    const onClosed = () => {
        markClosed(dialog);
        resetDrag();
        const back = invoker;
        invoker = null;
        if (isConnected(back) && typeof back.focus === "function") {
            back.focus();
        }
    };

    dialog.addEventListener("toggle", () => {
        if (dialog.open) onOpened();
    });
    dialog.addEventListener("close", onClosed);
    // Esc: the browser closes the dialog itself; just drop any drag in flight.
    dialog.addEventListener("cancel", resetDrag);

    let backdropPointerDown = false;
    dialog.addEventListener("pointerdown", (e) => {
        backdropPointerDown = e.target === dialog;
    });
    dialog.addEventListener("pointerup", (e) => {
        if (e.target !== dialog) backdropPointerDown = false;
    });
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog && backdropPointerDown) dialog.close();
        backdropPointerDown = false;
    });

    const onPointerMove = (e) => {
        if (!dragging || e.pointerId !== pointerId) return;
        const dy = Math.max(0, e.clientY - startY);
        dragY = dy;
        const now = e.timeStamp || Date.now();
        const dt = now - lastT;
        if (dt > 0) velocity = (e.clientY - lastY) / dt;
        lastY = e.clientY;
        lastT = now;
        dialog.style.transform = `translateY(${dy}px)`;
    };

    const stopListening = () => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
    };

    function onPointerUp(e) {
        if (!dragging || e.pointerId !== pointerId) return;
        if (typeof dialog.releasePointerCapture === "function") {
            try {
                dialog.releasePointerCapture(pointerId);
            } catch (_) {}
        }
        stopListening();
        // Finger parked before lifting: whatever speed it had is stale.
        if ((e.timeStamp || Date.now()) - lastT > FLICK_STALE_MS) velocity = 0;
        const flick = velocity > FLICK_VELOCITY && dragY >= FLICK_MIN_PX;
        if (dragY > DRAG_CLOSE_PX || flick) {
            resetDrag();
            dialog.close();
            return;
        }
        // Snap back. Reduced motion: no transition at all, it just jumps.
        const animate = !mq(MQ_REDUCED) && dragY > 0;
        dragging = false;
        pointerId = null;
        dragY = 0;
        velocity = 0;
        if (animate) {
            dialog.style.transition = SNAP_BACK;
            dialog.addEventListener(
                "transitionend",
                () => {
                    dialog.style.transition = "";
                },
                { once: true },
            );
        } else {
            dialog.style.transition = "";
        }
        dialog.style.transform = "";
    }

    dialog.addEventListener("pointerdown", (e) => {
        if (!mq(MQ_COARSE) || mq(MQ_PANEL)) return;
        const t = e.target;
        if (!t || typeof t.closest !== "function") return;
        const grip = t.closest(".fd-sheet-handle, .fd-sheet-head");
        if (!grip || !dialog.contains(grip)) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (t.closest("button, a, input, select, textarea, label")) return;
        dragging = true;
        pointerId = e.pointerId;
        startY = e.clientY;
        lastY = e.clientY;
        lastT = e.timeStamp || Date.now();
        velocity = 0;
        dragY = 0;
        dialog.style.transition = "none";
        if (typeof dialog.setPointerCapture === "function") {
            try {
                dialog.setPointerCapture(pointerId);
            } catch (_) {}
        }
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerUp);
    });
}

function initSheets(root) {
    root.querySelectorAll("dialog.fd-sheet").forEach((dialog) => {
        initSheet(dialog);
        if (
            dialog.hasAttribute("data-sheet-open-on-load") &&
            !dialog.open &&
            typeof dialog.showModal === "function"
        ) {
            dialog.showModal();
            // Don't wait for the async toggle event.
            markOpen(dialog);
            focusFirstField(dialog);
        }
    });
}

window.FoodableApp.onLoad(initSheets);
