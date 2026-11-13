// Swipe-to-reveal row actions on coarse pointers. Fine pointers rely on
// components.css hover/focus overlays only. Guards match sheet.js: tests drive
// this against a fake window.
const MQ_COARSE = "(pointer: coarse)";
const SLOP_PX = 9;
const THRESHOLD_FRAC = 0.35;
const MAX_THRESHOLD_PX = 96;
const SNAP_MS = "transform 0.2s ease";

const mq = (q) =>
    typeof window.matchMedia === "function" && window.matchMedia(q).matches;
const mqReduced = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function defaultThreshold(width) {
    const w = Number.isFinite(width) && width > 0 ? width : MAX_THRESHOLD_PX;
    return Math.min(w * THRESHOLD_FRAC, MAX_THRESHOLD_PX);
}

/**
 * Pure gesture decision for unit tests (FOODABLE_EXPOSE_SWIPE_DECISION).
 * @param {{ dx: number, dy: number, width: number, threshold?: number, release?: boolean, horizontalLocked?: boolean }} opts
 * @returns {"lead"|"trail"|"cancel"|"pending"}
 */
function swipeDecision({
    dx,
    dy,
    width,
    threshold,
    release = false,
    horizontalLocked = false,
}) {
    const t = threshold ?? defaultThreshold(width);
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (!release) {
        if (horizontalLocked) return "pending";
        if (adx < SLOP_PX && ady < SLOP_PX) return "pending";
        if (ady > adx) return "cancel";
        return "pending";
    }
    if (!horizontalLocked && ady > adx) return "cancel";
    if (dx >= t) return "lead";
    if (dx <= -t) return "trail";
    return "cancel";
}

if (typeof window !== "undefined" && window.FOODABLE_EXPOSE_SWIPE_DECISION) {
    window.FOODABLE_EXPOSE_SWIPE_DECISION(swipeDecision);
}

const rowInit = new WeakSet();

function setSwipeX(row, px) {
    const body = row.querySelector(".fd-row__body");
    if (!body || !body.style) return;
    if (px === 0) {
        body.style.removeProperty("--fd-swipe-x");
        body.style.transform = "";
        body.style.transition = "";
        row.removeAttribute("data-swipe-dragging");
        return;
    }
    row.setAttribute("data-swipe-dragging", "");
    body.style.setProperty("--fd-swipe-x", `${px}px`);
    body.style.transform = `translateX(${px}px)`;
}

function snapBack(row) {
    const body = row.querySelector(".fd-row__body");
    if (!body || !body.style) return;
    row.removeAttribute("data-swipe-dragging");
    row.removeAttribute("data-swipe-open");
    if (mqReduced()) {
        setSwipeX(row, 0);
        return;
    }
    body.style.transition = SNAP_MS;
    setSwipeX(row, 0);
    const end = () => {
        if (body.style) body.style.transition = "";
    };
    if (typeof body.addEventListener === "function") {
        body.addEventListener("transitionend", end, { once: true });
    } else {
        end();
    }
}

function submitSwipeAction(row, side) {
    const wrap = row.querySelector(`.fd-row__action--${side}`);
    if (!wrap) return;
    const form =
        typeof wrap.querySelector === "function"
            ? wrap.querySelector("form.fd-inline-form, form")
            : null;
    if (!form || typeof form.requestSubmit !== "function") return;
    const btn =
        typeof form.querySelector === "function"
            ? form.querySelector('button[type="submit"]')
            : null;
    form.requestSubmit(btn ?? undefined);
}

function initSwipeRow(row) {
    if (!row.classList || !row.classList.contains("fd-row--swipe")) return;
    if (!mq(MQ_COARSE)) return;
    if (rowInit.has(row)) return;
    rowInit.add(row);

    const body =
        typeof row.querySelector === "function"
            ? row.querySelector(".fd-row__body")
            : null;
    if (!body) return;

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let pointerId = null;
    let aborted = false;
    let horizontalLocked = false;
    let suppressNextClick = false;

    const bodyNavLink =
        typeof row.querySelector === "function"
            ? row.querySelector(".fd-row__body--link")
            : null;

    const stopListening = () => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerCancel);
    };

    const onPointerMove = (e) => {
        if (!dragging || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (!horizontalLocked && adx > SLOP_PX && adx > ady) {
            horizontalLocked = true;
        }
        if (horizontalLocked && adx > SLOP_PX) suppressNextClick = true;
        const phase = swipeDecision({
            dx,
            dy,
            width: row.clientWidth ?? MAX_THRESHOLD_PX,
            horizontalLocked,
        });
        if (phase === "cancel") {
            aborted = true;
            snapBack(row);
            stopListening();
            dragging = false;
            pointerId = null;
            horizontalLocked = false;
            return;
        }
        if (phase === "pending" && adx < SLOP_PX) return;
        const clamped = Math.max(
            -MAX_THRESHOLD_PX,
            Math.min(MAX_THRESHOLD_PX, dx),
        );
        setSwipeX(row, clamped);
    };

    function endDrag(e, submit) {
        if (!dragging || e.pointerId !== pointerId) return;
        if (typeof body.releasePointerCapture === "function") {
            try {
                body.releasePointerCapture(pointerId);
            } catch (_) {}
        }
        stopListening();
        dragging = false;
        pointerId = null;
        if (aborted) {
            aborted = false;
            horizontalLocked = false;
            return;
        }
        if (!submit) {
            snapBack(row);
            horizontalLocked = false;
            return;
        }
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const width = row.clientWidth ?? MAX_THRESHOLD_PX;
        const outcome = swipeDecision({
            dx,
            dy,
            width,
            release: true,
            horizontalLocked,
        });
        horizontalLocked = false;
        if (outcome === "lead" || outcome === "trail") {
            setSwipeX(row, 0);
            submitSwipeAction(row, outcome);
            return;
        }
        snapBack(row);
    }

    function onPointerUp(e) {
        endDrag(e, true);
    }

    function onPointerCancel(e) {
        endDrag(e, false);
    }

    function pointerTargetBlocked(target) {
        if (!target || typeof target.closest !== "function") return true;
        const control = target.closest(
            "button, input, select, textarea, label, form",
        );
        if (control && row.contains(control)) return true;
        const link = target.closest("a");
        if (!link) return false;
        if (bodyNavLink && (link === bodyNavLink || bodyNavLink.contains(link)))
            return false;
        return true;
    }

    const onBodyClick = (e) => {
        if (!suppressNextClick) return;
        suppressNextClick = false;
        e.preventDefault();
        e.stopPropagation();
    };

    body.addEventListener("click", onBodyClick, true);

    body.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        // A list in select mode (select-mode.js) picks rows; a drag fires nothing.
        if (row.closest && row.closest("[data-fd-selecting]")) return;
        if (pointerTargetBlocked(e.target)) return;
        dragging = true;
        aborted = false;
        horizontalLocked = false;
        suppressNextClick = false;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        const bodyStyle = body.style;
        if (bodyStyle) bodyStyle.transition = "none";
        if (typeof body.setPointerCapture === "function") {
            try {
                body.setPointerCapture(pointerId);
            } catch (_) {}
        }
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerCancel);
    });
}

function initSwipeRows(root) {
    root.querySelectorAll(".fd-row--swipe").forEach((row) => initSwipeRow(row));
}

window.FoodableApp.onLoad(initSwipeRows);
