// v2 chip groups (src/web/components/v2/chip.ts): `[data-fd-chips]`.
//
// "multiple": a click toggles a chip's `aria-pressed`. "single": a radio group;
// a click or an arrow key selects one chip, moves the one tab stop to it and
// clears the rest. In both, the arrow keys, Home and End move focus along the
// chips. Every change fires a bubbling `change` event on the group with
// `detail.values` (the `data-value` of each chip that is on) and `detail.value`
// (the chip that changed). Binding is idempotent per group (a WeakSet), so
// Turbo re-running onLoad on a morph never double-binds. The older `.fd-chip`
// filters and choice radios are not touched.

const bound = new WeakSet();

const ON = "fd-pill-chip--on";

function allChips(group) {
    return Array.from(group.querySelectorAll(".fd-pill-chip"));
}

function chipsOf(group) {
    return allChips(group).filter((chip) => !chip.disabled);
}

function valueOf(chip) {
    const value = chip.getAttribute("data-value");
    return value == null ? "" : value;
}

function isOn(group, chip) {
    const attr =
        group.getAttribute("data-fd-chips") === "single"
            ? "aria-checked"
            : "aria-pressed";
    return chip.getAttribute(attr) === "true";
}

function paint(group, chip, on) {
    const single = group.getAttribute("data-fd-chips") === "single";
    chip.setAttribute(single ? "aria-checked" : "aria-pressed", String(on));
    chip.classList.toggle(ON, on);
    if (single) chip.setAttribute("tabindex", on ? "0" : "-1");
}

function announce(group, chip) {
    const values = allChips(group)
        .filter((c) => isOn(group, c))
        .map(valueOf);
    group.dispatchEvent(
        new CustomEvent("change", {
            bubbles: true,
            detail: { value: valueOf(chip), values },
        }),
    );
}

function choose(group, chip) {
    if (group.getAttribute("data-fd-chips") === "single") {
        if (isOn(group, chip)) return;
        // A disabled chip drawn on is cleared too; only the chosen one stays on.
        allChips(group).forEach((c) => paint(group, c, c === chip));
    } else {
        paint(group, chip, !isOn(group, chip));
    }
    announce(group, chip);
}

function onKeydown(group, event) {
    // An arrow with a modifier (Alt+Left is Back) is not ours.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
    const chips = chipsOf(group);
    const here = chips.indexOf(event.target.closest(".fd-pill-chip"));
    if (here < 0) return;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (here + 1) % chips.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (here - 1 + chips.length) % chips.length;
    } else if (event.key === "Home") {
        next = 0;
    } else if (event.key === "End") {
        next = chips.length - 1;
    }
    if (next < 0) return;
    event.preventDefault();
    chips[next].focus();
    // A radio group selects with the arrow keys; toggles only move focus.
    if (group.getAttribute("data-fd-chips") === "single") {
        choose(group, chips[next]);
    }
}

function initChips(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("[data-fd-chips]").forEach((group) => {
        if (bound.has(group)) return;
        bound.add(group);
        group.addEventListener("click", (event) => {
            const chip = event.target.closest(".fd-pill-chip");
            if (!chip || chip.disabled || !group.contains(chip)) return;
            choose(group, chip);
        });
        group.addEventListener("keydown", (event) => onKeydown(group, event));
    });
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initChips);
    } else if (typeof document !== "undefined") {
        // Standalone page (the v2 gallery): no FoodableApp registry.
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initChips(document),
            );
        } else {
            initChips(document);
        }
    }
}
