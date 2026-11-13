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
// A backdrop tap that moves more than this, or lasts longer, is a gesture.
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 500;
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
    openOrder.push(dialog);
    lockPageScroll();
    return true;
}

function markClosed(dialog) {
    const state = sheetState.get(dialog);
    if (!state || !state.counted) return;
    state.counted = false;
    openSheetCount = Math.max(0, openSheetCount - 1);
    const at = openOrder.indexOf(dialog);
    if (at !== -1) openOrder.splice(at, 1);
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
    let field = dialog.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    // A radio group takes focus on its checked option, so the focus ring
    // never sits on a choice that is not the selected one.
    if (field && field.type === "radio" && !field.checked && field.name) {
        const checked = dialog.querySelector(
            `input[type="radio"][name="${CSS.escape(field.name)}"]:checked`,
        );
        if (checked) field = checked;
    }
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

// Dismiss on the dimmed page behind the TOPMOST open sheet. One code path, on
// `document` in the capture phase, because it cannot be known where a
// backdrop tap lands: the ::backdrop belongs to the dialog, but iOS Safari
// has been seen to hand the tap to the page behind it (WebKit bug 267688's
// workaround listens on document.body), and it does not reliably deliver a
// pointerdown that targets the dialog either. Listening on the dialog alone
// left the sheet open. "Behind" is geometry: outside the dialog's box, and
// the target is the dialog (its backdrop) or something that is not part of it.
// The dialog's own padding is `e.target === dialog` too but inside its box.
// A press that began inside the sheet (a text-selection drag, a scroll that
// ends over the backdrop) never dismisses.
//
// A sheet is only dismissed from behind when nothing sits above it. The
// barcode scanner is a full-screen modal dialog opened from inside the open log
// sheet, which stays open beneath it: every tap on the scanner is outside the
// sheet's box, and would otherwise close the hidden sheet and swallow the click
// (Close did nothing on the first tap). So every open dialog is tracked in the
// order it opened, whoever opened it, and a sheet with another dialog opened
// after it is covered.
const openOrder = []; // open sheets, oldest first
const dialogStack = []; // every open dialog, oldest first

const isDialog = (el) => !!el && el.tagName === "DIALOG";

const trackDialog = (e) => {
    const dialog = e.target;
    if (isDialog(dialog) && !dialogStack.includes(dialog)) {
        dialogStack.push(dialog);
    }
};
// beforetoggle precedes the open synchronously; toggle is the same signal for
// engines without it. Neither moves a dialog that is already tracked.
document.addEventListener(
    "beforetoggle",
    (e) => {
        if (e.newState === "open") trackDialog(e);
    },
    true,
);
document.addEventListener(
    "toggle",
    (e) => {
        if (e.target && e.target.open) trackDialog(e);
    },
    true,
);
document.addEventListener(
    "close",
    (e) => {
        const at = dialogStack.indexOf(e.target);
        // A dialog reopened before its queued close event arrives stays.
        if (at !== -1 && !e.target.open) dialogStack.splice(at, 1);
    },
    true,
);

const coveredByDialog = (sheet) => {
    const at = dialogStack.indexOf(sheet);
    if (at === -1) return false; // no order known: keep dismissing as before
    for (let i = at + 1; i < dialogStack.length; i++) {
        const above = dialogStack[i];
        if (above.open && isConnected(above)) return true;
    }
    return false;
};

const topSheet = () => {
    for (let i = openOrder.length - 1; i >= 0; i--) {
        const sheet = openOrder[i];
        if (!sheet.open) continue;
        return coveredByDialog(sheet) ? null : sheet;
    }
    return null;
};

const hasPoint = (x, y) => typeof x === "number" && typeof y === "number";

const behindSheet = (dialog, target, x, y) => {
    if (!hasPoint(x, y) || typeof dialog.getBoundingClientRect !== "function") {
        return false;
    }
    const r = dialog.getBoundingClientRect();
    const outside = x < r.left || x > r.right || y < r.top || y > r.bottom;
    return outside && (target === dialog || !dialog.contains(target));
};

// A click that carries no pointer position (dialog.click(), a keyboard
// activation: detail 0 and 0,0) is not a tap on the backdrop.
const isPointerClick = (e) =>
    e.detail !== 0 &&
    hasPoint(e.clientX, e.clientY) &&
    !(e.clientX === 0 && e.clientY === 0);

let pressedInside = false;
const notePress = (e, x, y) => {
    const dialog = topSheet();
    pressedInside = !!dialog && !behindSheet(dialog, e.target, x, y);
};

let tap = null; // a touch that began behind the sheet, to confirm on touchend
let swallowClick = null; // the click a dismissing touch may still produce

document.addEventListener(
    "pointerdown",
    (e) => notePress(e, e.clientX, e.clientY),
    true,
);
document.addEventListener(
    "pointercancel",
    () => {
        pressedInside = false;
    },
    true,
);
document.addEventListener(
    "click",
    (e) => {
        const wasInside = pressedInside;
        pressedInside = false;
        if (swallowClick) {
            const s = swallowClick;
            swallowClick = null;
            if (
                Date.now() - s.at <= TAP_MAX_MS &&
                Math.abs(e.clientX - s.x) <= 3 * TAP_SLOP_PX &&
                Math.abs(e.clientY - s.y) <= 3 * TAP_SLOP_PX
            ) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }
        }
        const dialog = topSheet();
        if (!dialog || wasInside || !isPointerClick(e)) return;
        if (!behindSheet(dialog, e.target, e.clientX, e.clientY)) return;
        e.stopPropagation();
        e.preventDefault();
        dialog.close();
    },
    true,
);

// Touch path for engines that never turn a backdrop tap into a click: a short,
// still tap that starts and ends behind the sheet. The touchend is cancelled
// (and the click that may still follow swallowed) so nothing lands on the
// page the sheet just uncovered.
document.addEventListener(
    "touchstart",
    (e) => {
        tap = null;
        const t = e.touches && e.touches.length === 1 ? e.touches[0] : null;
        if (!t) return;
        notePress(e, t.clientX, t.clientY);
        const dialog = topSheet();
        if (
            dialog &&
            !pressedInside &&
            behindSheet(dialog, e.target, t.clientX, t.clientY)
        ) {
            tap = { x: t.clientX, y: t.clientY, at: Date.now() };
        }
    },
    { capture: true, passive: true },
);
document.addEventListener(
    "touchend",
    (e) => {
        const start = tap;
        tap = null;
        const t = e.changedTouches && e.changedTouches[0];
        const dialog = topSheet();
        if (!start || !t || !dialog || (e.touches && e.touches.length)) return;
        const still =
            Math.abs(t.clientX - start.x) <= TAP_SLOP_PX &&
            Math.abs(t.clientY - start.y) <= TAP_SLOP_PX;
        if (
            still &&
            Date.now() - start.at <= TAP_MAX_MS &&
            behindSheet(dialog, e.target, t.clientX, t.clientY)
        ) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            swallowClick = { x: t.clientX, y: t.clientY, at: Date.now() };
            pressedInside = false;
            dialog.close();
        }
    },
    { capture: true, passive: false },
);
document.addEventListener(
    "touchcancel",
    () => {
        tap = null;
    },
    true,
);

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
        fitSheetsToKeyboard();
    };
    const onClosed = () => {
        markClosed(dialog);
        unfitSheet(dialog);
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
            fitSheetsToKeyboard();
        }
    });
}

// iOS covers the page with the keyboard instead of shrinking it, so an open
// bottom sheet stays under it and Safari pans its field off screen. Fit open
// bottom sheets to the visual viewport; cleared when nothing is covered.
const SHEET_VIEWPORT_SHARE = 0.9; // matches max-height: 90dvh in sheet.css

function unfitSheet(dialog) {
    dialog.style.bottom = "";
    dialog.style.maxHeight = "";
}

function fitSheetsToKeyboard() {
    const vv = window.visualViewport;
    if (!vv || !document || typeof document.querySelectorAll !== "function") {
        return;
    }
    // Not innerHeight: iOS shrinks it with the keyboard.
    const layout =
        (document.documentElement && document.documentElement.clientHeight) ||
        window.innerHeight ||
        0;
    const covered = Math.max(
        0,
        Math.round(layout - (vv.offsetTop + vv.height)),
    );
    const fit = covered >= 1 && !mq(MQ_PANEL);
    document.querySelectorAll("dialog.fd-sheet[open]").forEach((dialog) => {
        if (!fit) {
            unfitSheet(dialog);
            return;
        }
        dialog.style.bottom = `${covered}px`;
        dialog.style.maxHeight = `${Math.floor(vv.height * SHEET_VIEWPORT_SHARE)}px`;
    });
}

if (
    window.visualViewport &&
    typeof window.visualViewport.addEventListener === "function"
) {
    window.visualViewport.addEventListener("resize", fitSheetsToKeyboard);
    window.visualViewport.addEventListener("scroll", fitSheetsToKeyboard);
}

window.FoodableApp.onLoad(initSheets);
