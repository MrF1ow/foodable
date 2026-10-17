// Backdrop dismiss, bottom-sheet drag, focus on open, and error reopen.
// Guards match shell.js: tests run this against a fake window.
const MQ_SHEET = "(max-width: 640px)";
const DRAG_CLOSE_PX = 80;
const FLICK_VELOCITY = 0.8;

const mq = (q) =>
    typeof window.matchMedia === "function" && window.matchMedia(q).matches;

function focusFirstField(dialog) {
    const field = dialog.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    if (field && typeof field.focus === "function") field.focus();
}

function initDialog(dialog) {
    if (typeof dialog.showModal !== "function") return;

    if (dialog.hasAttribute("data-modal-open-on-load")) {
        dialog.showModal();
    }

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
        if (!dialog.open) {
            dialog.style.transform = "";
            return;
        }
        focusFirstField(dialog);
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

document.querySelectorAll("dialog.modal").forEach(initDialog);
