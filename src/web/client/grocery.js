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

function bindGrocerySection(select) {
    if (!grocerySectionInit.has(select)) {
        grocerySectionInit.add(select);
        select.addEventListener("change", function () {
            syncGrocerySection(select);
        });
    }
    syncGrocerySection(select);
}

function initGrocerySections(root) {
    root.querySelectorAll("[data-grocery-section]").forEach(bindGrocerySection);
}

function resyncAllGrocerySections() {
    document
        .querySelectorAll("[data-grocery-section]")
        .forEach(function (select) {
            syncGrocerySection(select);
        });
}

// The shared add-food dialog swaps the section <select> in on fill. Bind the
// new element and copy its value onto the picker forms.
function onGroceryDialogFill(event) {
    const scope = event && event.target;
    if (!scope || typeof scope.querySelectorAll !== "function") return;
    scope
        .querySelectorAll("[data-grocery-section]")
        .forEach(bindGrocerySection);
}

if (
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function"
) {
    document.addEventListener("foodable:dialog-fill", onGroceryDialogFill);
}

window.FoodableApp.onLoad(initGrocerySections);
document.addEventListener("turbo:morph", resyncAllGrocerySections);
