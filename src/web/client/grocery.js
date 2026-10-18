const grocerySectionInit = new WeakSet();

function syncGrocerySection(select) {
    const dialog = select.closest("dialog");
    if (!dialog) return;
    const inferId = select.getAttribute("data-infer-section");
    const val = select.value;
    dialog.querySelectorAll("form").forEach(function (form) {
        var existing = form.querySelector('input[name="section_id"]');
        if (inferId && val === inferId) {
            if (existing) existing.remove();
            return;
        }
        if (existing) existing.value = val;
        else {
            var input = document.createElement("input");
            input.type = "hidden";
            input.name = "section_id";
            input.value = val;
            form.appendChild(input);
        }
    });
}

function initGrocerySections(root) {
    root.querySelectorAll("[data-grocery-section]").forEach(function (select) {
        if (grocerySectionInit.has(select)) return;
        grocerySectionInit.add(select);
        select.addEventListener("change", function () {
            syncGrocerySection(select);
        });
        syncGrocerySection(select);
    });
}

window.FoodableApp.onLoad(initGrocerySections);
