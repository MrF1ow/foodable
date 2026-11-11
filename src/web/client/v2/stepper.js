// v2 stepper: the − / + buttons around a number input (src/web/components/v2/stepper.ts).
// The input is the source of truth and submits with the form; this only moves
// it. Each click calls input.stepUp() / stepDown(), then clamps to min / max
// (some engines leave an out-of-range value alone) and rounds to the step's
// decimals (0.1 + 0.2 must not become 0.30000000000000004), fires `input` and
// `change` so listeners see a real edit, and refreshes the disabled state of
// the buttons. Typing also refreshes it. Binding is idempotent per stepper
// (a WeakSet), so Turbo re-running onLoad on a morph never double-binds.

const bound = new WeakSet();

function decimalsOf(value) {
    const text = String(value == null ? "" : value);
    if (text === "" || text === "any") return 0;
    const dot = text.indexOf(".");
    return dot < 0 ? 0 : text.length - dot - 1;
}

function numberOrNull(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function syncStepper(root, input) {
    const min = numberOrNull(input.min);
    const max = numberOrNull(input.max);
    const value = numberOrNull(input.value);
    const down = root.querySelector('[data-fd-step="-1"]');
    const up = root.querySelector('[data-fd-step="1"]');
    if (down) down.disabled = min != null && value != null && value <= min;
    if (up) up.disabled = max != null && value != null && value >= max;
    // No-CSS-field-sizing browsers size the input by character count.
    root.style.setProperty(
        "--fd-chars",
        String(Math.max(2, String(input.value || "").length)),
    );
}

function buttonStepSize(root, input) {
    const attr =
        typeof root.getAttribute === "function"
            ? root.getAttribute("data-fd-button-step")
            : null;
    if (attr != null && attr !== "") return attr;
    return input.step == null || input.step === "" ? "1" : input.step;
}

function step(root, input, direction) {
    const min = numberOrNull(input.min);
    const max = numberOrNull(input.max);
    const buttonStep = buttonStepSize(root, input);
    if (
        input.step === "any" &&
        typeof root.hasAttribute === "function" &&
        root.hasAttribute("data-fd-button-step")
    ) {
        const typed = input.value;
        let value = numberOrNull(typed);
        if (value == null) value = min != null && min > 0 ? min : 0;
        const delta = Number(buttonStep);
        if (!Number.isFinite(delta)) return;
        value += direction < 0 ? -delta : delta;
        if (min != null && value < min) value = min;
        if (max != null && value > max) value = max;
        // Keep a typed value's own precision: 100.5 + 1 is 101.5, not 102.
        const decimals = Math.max(
            decimalsOf(buttonStep),
            decimalsOf(input.min),
            Math.min(decimalsOf(typed), 3),
        );
        input.value = String(Number(value.toFixed(decimals)));
    } else {
        if (direction < 0) input.stepDown();
        else input.stepUp();
        let value = numberOrNull(input.value);
        if (value == null) return;
        if (min != null && value < min) value = min;
        if (max != null && value > max) value = max;
        const decimals = Math.max(
            decimalsOf(buttonStep),
            decimalsOf(input.min),
        );
        input.value = String(Number(value.toFixed(decimals)));
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    syncStepper(root, input);
}

function initSteppers(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("[data-fd-stepper]").forEach((el) => {
        if (bound.has(el)) return;
        const input = el.querySelector("input");
        if (!input) return;
        bound.add(el);
        el.addEventListener("click", (event) => {
            const target = event.target;
            const button =
                target && target.closest
                    ? target.closest("[data-fd-step]")
                    : null;
            if (!button || button.disabled || !el.contains(button)) return;
            step(
                el,
                input,
                button.getAttribute("data-fd-step") === "-1" ? -1 : 1,
            );
        });
        input.addEventListener("input", () => syncStepper(el, input));
        syncStepper(el, input);
    });
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initSteppers);
    } else if (typeof document !== "undefined") {
        // Standalone page (the v2 gallery): no FoodableApp registry.
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initSteppers(document),
            );
        } else {
            initSteppers(document);
        }
    }
}
