// Backdrop dismiss, bottom-sheet drag, focus on open, error reopen, scroll lock.
// Guards match shell.js: tests run this against a fake window.
const MQ_SHEET = "(max-width: 640px)";
const DRAG_CLOSE_PX = 80;
const FLICK_VELOCITY = 0.8;

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

function onModalOpen() {
    openModalCount += 1;
    lockPageScroll();
}

function onModalClose() {
    openModalCount = Math.max(0, openModalCount - 1);
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
document.addEventListener("turbo:before-morph", releaseScrollLockForSwap);

function focusFirstField(dialog) {
    const field = dialog.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    if (field && typeof field.focus === "function") field.focus();
}

const dialogInit = new WeakSet();

function initDialog(dialog) {
    if (typeof dialog.showModal !== "function") return;
    if (dialogInit.has(dialog)) return;
    dialogInit.add(dialog);

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

    dialog.addEventListener("toggle", () => {
        if (dialog.open) {
            onModalOpen();
            focusFirstField(dialog);
            return;
        }
        onModalClose();
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
