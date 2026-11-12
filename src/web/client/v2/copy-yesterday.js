// The log sheet's "Copy yesterday" tile (src/web/pages/v2/log-sheet.ts). The
// sheet picks the meal it logs to with the ADD TO chips; this keeps the tile's
// hidden slot on that meal and disables the tile while the meal has nothing to
// copy (the form lists the slots that do). The server re-checks on submit.
// Binding is idempotent per form (a WeakSet), so Turbo re-running onLoad on a
// morph never double-binds.

const bound = new WeakSet();

function initCopyYesterday(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("[data-fd-copy-yesterday]").forEach((form) => {
        if (bound.has(form)) return;
        bound.add(form);
        const slotInput = form.querySelector('input[name="slot"]');
        const button = form.querySelector("[data-fd-copy-yesterday-button]");
        if (!slotInput || !button) return;
        const slots = (form.getAttribute("data-fd-copy-yesterday-slots") || "")
            .split(" ")
            .filter(Boolean);
        const dialog = form.closest("dialog") || document;

        function sync() {
            const checked = dialog.querySelector(
                'input[name="search_meal_type"]:checked',
            );
            if (!checked || !checked.value) return;
            slotInput.value = checked.value;
            button.disabled = !slots.includes(checked.value);
        }

        dialog.addEventListener("change", (event) => {
            if (event.target && event.target.name === "search_meal_type") {
                sync();
            }
        });
        sync();
    });
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initCopyYesterday);
    }
}
