// Backdrop dismiss, bottom-sheet drag, focus on open, error reopen, scroll lock.
// Guards match shell.js: tests run this against a fake window.
const MQ_SHEET = "(max-width: 640px)";
const DRAG_CLOSE_PX = 80;
const FLICK_VELOCITY = 0.8;
// A backdrop tap that moves more than this, or lasts longer, is a gesture.
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 500;

const mq = (q) =>
    typeof window.matchMedia === "function" && window.matchMedia(q).matches;

let openModalCount = 0;
let scrollLockY = 0;
let bodyWasFixed = false;

function lockPageScroll() {
    if (openModalCount === 1 && document.body) {
        scrollLockY = window.scrollY ?? window.pageYOffset ?? 0;
        bodyWasFixed = true;
        document.body.style.position = "fixed";
        document.body.style.top = `-${scrollLockY}px`;
        document.body.style.width = "100%";
    }
}

function unlockPageScroll() {
    if (openModalCount === 0 && bodyWasFixed && document.body) {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        bodyWasFixed = false;
        window.scrollTo(0, scrollLockY);
    }
}

const openOrder = []; // open dialogs, oldest first

function onModalOpen(dialog) {
    openModalCount += 1;
    if (!openOrder.includes(dialog)) openOrder.push(dialog);
    lockPageScroll();
}

function onModalClose(dialog) {
    openModalCount = Math.max(0, openModalCount - 1);
    const at = openOrder.indexOf(dialog);
    if (at !== -1) openOrder.splice(at, 1);
    unlockPageScroll();
}

function releaseScrollLockForSwap() {
    document.querySelectorAll("dialog[open]").forEach((dialog) => {
        if (typeof dialog.close === "function") dialog.close();
    });
    openModalCount = 0;
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
document.addEventListener("turbo:before-morph-element", (event) => {
    const el = event.detail?.currentElement;
    if (el instanceof HTMLDialogElement && el.classList.contains("modal")) {
        releaseScrollLockForSwap();
    }
});

function focusFirstField(dialog) {
    const field = dialog.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    if (field && typeof field.focus === "function") field.focus();
}

// Dismiss on the dimmed page behind the TOPMOST open dialog. The same logic as
// the redesign's v2/sheet.js (a separate bundle, so repeated, not shared).
// One code path, on `document` in the capture phase, because it cannot be
// known where a backdrop tap lands: the ::backdrop belongs to the dialog, but
// iOS Safari has been seen to hand the tap to the page behind it (WebKit bug
// 267688's workaround listens on document.body), and it does not reliably
// deliver a pointerdown that targets the dialog either. "Behind" is geometry:
// outside the dialog's box, and the target is the dialog (its backdrop) or
// something that is not part of it. A press that began inside the dialog (a
// text-selection drag, a scroll that ends over the backdrop) never dismisses.
const topModal = () => {
    for (let i = openOrder.length - 1; i >= 0; i--) {
        if (openOrder[i].open) return openOrder[i];
    }
    return null;
};

const hasPoint = (x, y) => typeof x === "number" && typeof y === "number";

const behindModal = (dialog, target, x, y) => {
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
    const dialog = topModal();
    pressedInside = !!dialog && !behindModal(dialog, e.target, x, y);
};

let tap = null; // a touch that began behind the dialog, to confirm on touchend
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
        const dialog = topModal();
        if (!dialog || wasInside || !isPointerClick(e)) return;
        if (!behindModal(dialog, e.target, e.clientX, e.clientY)) return;
        e.stopPropagation();
        e.preventDefault();
        dialog.close();
    },
    true,
);

// Touch path for engines that never turn a backdrop tap into a click: a short,
// still tap that starts and ends behind the dialog. The touchend is cancelled
// (and the click that may still follow swallowed) so nothing lands on the
// page the dialog just uncovered.
document.addEventListener(
    "touchstart",
    (e) => {
        tap = null;
        const t = e.touches && e.touches.length === 1 ? e.touches[0] : null;
        if (!t) return;
        notePress(e, t.clientX, t.clientY);
        const dialog = topModal();
        if (
            dialog &&
            !pressedInside &&
            behindModal(dialog, e.target, t.clientX, t.clientY)
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
        const dialog = topModal();
        if (!start || !t || !dialog || (e.touches && e.touches.length)) return;
        const still =
            Math.abs(t.clientX - start.x) <= TAP_SLOP_PX &&
            Math.abs(t.clientY - start.y) <= TAP_SLOP_PX;
        if (
            still &&
            Date.now() - start.at <= TAP_MAX_MS &&
            behindModal(dialog, e.target, t.clientX, t.clientY)
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

const dialogInit = new WeakSet();

function initDialog(dialog) {
    if (typeof dialog.showModal !== "function") return;
    if (dialogInit.has(dialog)) return;
    dialogInit.add(dialog);

    dialog.addEventListener("toggle", () => {
        if (dialog.open) {
            onModalOpen(dialog);
            focusFirstField(dialog);
            return;
        }
        onModalClose(dialog);
        dialog.style.transform = "";
    });

    let startY = 0;
    let dragY = 0;
    let dragging = false;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let pointerId = null;

    const sheet = dialog.querySelector(".modal-sheet");

    const resetDrag = () => {
        dragging = false;
        pointerId = null;
        dragY = 0;
        velocity = 0;
        dialog.style.transform = "";
    };

    const onPointerMove = (e) => {
        if (!dragging || e.pointerId !== pointerId) return;
        const dy = Math.max(0, e.clientY - startY);
        dragY = dy;
        const now = e.timeStamp || Date.now();
        const dt = now - lastT;
        if (dt > 0) {
            velocity = (e.clientY - lastY) / dt;
        }
        lastY = e.clientY;
        lastT = now;
        dialog.style.transform = `translateY(${dy}px)`;
    };

    const onPointerUp = (e) => {
        if (!dragging || e.pointerId !== pointerId) return;
        if (typeof dialog.releasePointerCapture === "function") {
            try {
                dialog.releasePointerCapture(pointerId);
            } catch (_) {}
        }
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
        if (dragY > DRAG_CLOSE_PX || velocity > FLICK_VELOCITY) {
            resetDrag();
            dialog.close();
            return;
        }
        resetDrag();
    };

    dialog.addEventListener("pointerdown", (e) => {
        if (!mq(MQ_SHEET)) return;
        const handle =
            e.target instanceof Element &&
            e.target.closest(".modal-handle, .modal-head");
        if (!handle || !(sheet && sheet.contains(handle))) return;
        if (e.button !== 0) return;
        if (
            e.target instanceof Element &&
            e.target.closest("button, a, input, select, textarea, label")
        ) {
            return;
        }
        dragging = true;
        pointerId = e.pointerId;
        startY = e.clientY;
        lastY = e.clientY;
        lastT = e.timeStamp || Date.now();
        velocity = 0;
        dragY = 0;
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

function initModals(root) {
    root.querySelectorAll("dialog.modal").forEach((dialog) => {
        initDialog(dialog);
        if (
            dialog.hasAttribute("data-modal-open-on-load") &&
            !dialog.open &&
            typeof dialog.showModal === "function"
        ) {
            dialog.showModal();
        }
    });
}

window.FoodableApp.onLoad(initModals);
