// Fridge rows open the item sheet on tap; swipe actions stay as real buttons.
function openSheet(id) {
    const dialog = document.getElementById(id);
    if (!dialog || typeof dialog.showModal !== "function" || dialog.open)
        return;
    dialog.showModal();
}

function initFridgeRows(root) {
    root.querySelectorAll("[data-fd-fridge-row]").forEach((row) => {
        if (row.dataset.fdFridgeRowInit === "1") return;
        row.dataset.fdFridgeRowInit = "1";
        const sheetId = row.getAttribute("data-sheet-id");
        if (!sheetId) return;
        const open = () => openSheet(sheetId);
        row.addEventListener("click", (e) => {
            if (e.target.closest("button, form, a.fd-swipe-btn")) return;
            open();
        });
        row.addEventListener("keydown", (e) => {
            if (e.target !== row) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
        });
    });
}

// A round action with data-fd-reveal shows its panel (Freeze asks for a
// date before it submits).
function initReveals(root) {
    root.querySelectorAll("[data-fd-reveal]").forEach((btn) => {
        if (btn.dataset.fdRevealInit === "1") return;
        btn.dataset.fdRevealInit = "1";
        btn.addEventListener("click", () => {
            const panel = document.getElementById(
                btn.getAttribute("data-fd-reveal") || "",
            );
            if (!panel) return;
            const show = panel.hidden;
            panel.hidden = !show;
            btn.setAttribute("aria-expanded", show ? "true" : "false");
            if (show) panel.querySelector("input[type='date']")?.focus();
        });
    });
}

window.FoodableApp.onLoad((root) => {
    if (!root.querySelector(".fd-kitchen-fridge-page")) return;
    initFridgeRows(root);
    initReveals(root);
});
