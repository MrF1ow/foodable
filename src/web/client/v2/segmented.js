// v2 segmented control (src/web/components/v2/segmented.ts): a radio group of
// equal segments, in two forms.
//
// A named group is native radios: the browser selects, moves focus with the
// arrow keys and posts the value, so this script only gives the bubbling
// `change` event a `detail.value`, as the other form has.
//
// An unnamed group is `role="radio"` buttons: a click or an arrow key selects
// a segment, moves the one tab stop to it and fires a bubbling `change` event
// on the group with `detail.value`. Home and End jump to the first and last
// enabled segment; an arrow with a modifier (Alt+Left is Back) is left alone.
//
// Binding is idempotent per group (a WeakSet), so Turbo re-running onLoad on a
// morph never double-binds. Only `[data-fd-segmented]` is touched; the older
// segment controls are not.

const bound = new WeakSet();

const SELECTED = "fd-segmented__segment--selected";

function allSegments(group) {
    return Array.from(group.querySelectorAll('[role="radio"]'));
}

function segmentsOf(group) {
    return allSegments(group).filter((seg) => !seg.disabled);
}

function valueOf(seg) {
    const value = seg.getAttribute("data-value");
    return value == null ? "" : value;
}

function select(group, target, focus) {
    const was = allSegments(group).find(
        (seg) => seg.getAttribute("aria-checked") === "true",
    );
    // Every segment is cleared, a disabled one drawn selected included; only
    // the target is selected, and it is always enabled.
    allSegments(group).forEach((seg) => {
        const on = seg === target;
        seg.setAttribute("aria-checked", on ? "true" : "false");
        seg.setAttribute("tabindex", on ? "0" : "-1");
        seg.classList.toggle(SELECTED, on);
    });
    if (focus) target.focus();
    if (was === target) return;
    group.dispatchEvent(
        new CustomEvent("change", {
            bubbles: true,
            detail: { value: valueOf(target) },
        }),
    );
}

function onKeydown(group, event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
    const segs = segmentsOf(group);
    const here = segs.indexOf(event.target.closest('[role="radio"]'));
    if (here < 0) return;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (here + 1) % segs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (here - 1 + segs.length) % segs.length;
    } else if (event.key === "Home") {
        next = 0;
    } else if (event.key === "End") {
        next = segs.length - 1;
    }
    if (next < 0) return;
    event.preventDefault();
    select(group, segs[next], true);
}

function initSegmented(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("[data-fd-segmented]").forEach((group) => {
        if (bound.has(group)) return;
        bound.add(group);
        group.addEventListener("click", (event) => {
            const seg = event.target.closest('[role="radio"]');
            if (!seg || seg.disabled || !group.contains(seg)) return;
            select(group, seg, false);
        });
        group.addEventListener("keydown", (event) => onKeydown(group, event));
        // Native radios: the change is the browser's own, so it reaches a
        // listener on the form or the document (autosave) unchanged; it only
        // gains the `detail` the button form's event carries.
        group.addEventListener("change", (event) => {
            const radio = event.target;
            if (!radio || radio.type !== "radio") return;
            Object.defineProperty(event, "detail", {
                value: { value: radio.value },
            });
        });
    });
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initSegmented);
    } else if (typeof document !== "undefined") {
        // Standalone page (the v2 gallery): no FoodableApp registry.
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initSegmented(document),
            );
        } else {
            initSegmented(document);
        }
    }
}
