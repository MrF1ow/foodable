// Disable submit buttons and swap labels while a marked form is posting.
const busyForms = new WeakSet();

window.FoodableApp.onLoad(function initBusySubmit(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("form[data-busy-form]").forEach((form) => {
        if (busyForms.has(form)) return;
        busyForms.add(form);
        form.addEventListener("submit", () => {
            const btn = form.querySelector(
                'button[type="submit"], input[type="submit"]',
            );
            if (!btn || btn.disabled) return;
            const busy = btn.getAttribute("data-busy-label");
            if (busy) {
                if (!btn.dataset.busyDefaultLabel) {
                    btn.dataset.busyDefaultLabel = btn.textContent || "";
                }
                btn.textContent = busy;
            }
            btn.disabled = true;
        });
    });
});
