function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

const foodPickerInit = new WeakSet();
var foodPickerFillResetBound = false;

function resetFoodPicker(root) {
    root._foodPickerEpoch = (root._foodPickerEpoch || 0) + 1;
    if (root._foodPickerSearchTimer) {
        clearTimeout(root._foodPickerSearchTimer);
        root._foodPickerSearchTimer = null;
    }
    var searchInput = root.querySelector("[data-search-input]");
    if (searchInput) searchInput.value = "";
    var searchResults = root.querySelector("[data-search-results]");
    if (searchResults) searchResults.textContent = "";
    var barcodeResults = root.querySelector("[data-barcode-results]");
    if (barcodeResults) {
        barcodeResults.textContent = "";
        if (typeof barcodeResults.removeAttribute === "function") {
            barcodeResults.removeAttribute("data-barcode");
        }
    }
    var form = root.querySelector("[data-barcode-form]");
    if (form && typeof form.removeAttribute === "function") {
        form.removeAttribute("data-lookup-called");
    }
    // A moved dialog opens on the tab a fresh picker starts on.
    if (root._foodPickerShow && root._foodPickerInitialTab) {
        root._foodPickerShow(root._foodPickerInitialTab);
    }
}

function bindFoodPickerFillReset() {
    if (foodPickerFillResetBound) return;
    if (
        typeof document === "undefined" ||
        typeof document.addEventListener !== "function"
    ) {
        return;
    }
    foodPickerFillResetBound = true;
    document.addEventListener("foodable:dialog-fill", function (event) {
        var scope = event && event.target;
        if (!scope || typeof scope.querySelectorAll !== "function") return;
        scope.querySelectorAll("[data-food-picker]").forEach(resetFoodPicker);
    });
}

function initFoodPicker(root) {
    if (foodPickerInit.has(root)) return;
    foodPickerInit.add(root);

    var tabs = root.querySelectorAll('[role="tab"]');
    var panels = root.querySelectorAll('[role="tabpanel"]');
    function show(name) {
        tabs.forEach(function (tab) {
            var on = tab.getAttribute("data-tab") === name;
            tab.setAttribute("aria-selected", on ? "true" : "false");
        });
        panels.forEach(function (panel) {
            panel.hidden = panel.getAttribute("data-panel") !== name;
        });
    }
    tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
            show(tab.getAttribute("data-tab"));
        });
    });
    var initialTab = root.querySelector('[role="tab"][aria-selected="true"]');
    root._foodPickerShow = show;
    root._foodPickerInitialTab = initialTab
        ? initialTab.getAttribute("data-tab")
        : null;
    var searchInput = root.querySelector("[data-search-input]");
    var searchResults = root.querySelector("[data-search-results]");
    var hit = root.getAttribute("data-hit");
    function renderHits(target, hits) {
        if (!target) return;
        target.innerHTML = hits
            .map(function (food) {
                var label = food.brand
                    ? food.brand + " · " + food.name
                    : food.name;
                if (hit === "submit") {
                    if (food.food_id) {
                        return (
                            '<li><button type="submit" name="food_id" value="' +
                            esc(food.food_id) +
                            '" data-default-unit="' +
                            esc(food.default_unit || "") +
                            '">' +
                            esc(label) +
                            "</button></li>"
                        );
                    }
                    return (
                        '<li><button type="submit" name="barcode" value="' +
                        esc(food.barcode || "") +
                        '" data-default-unit="' +
                        esc(food.default_unit || "") +
                        '">' +
                        esc(label) +
                        "</button></li>"
                    );
                }
                return "<li>" + esc(label) + "</li>";
            })
            .join("");
        target
            .querySelectorAll("button[data-default-unit]")
            .forEach(function (btn) {
                btn.addEventListener("click", function () {
                    var unit = btn.getAttribute("data-default-unit");
                    if (!unit) return;
                    var form = btn.closest("form");
                    if (!form) return;
                    var sel = form.querySelector('select[name="qty_unit"]');
                    if (!sel) return;
                    for (var i = 0; i < sel.options.length; i++) {
                        if (sel.options[i].value === unit) {
                            sel.value = unit;
                            break;
                        }
                    }
                });
            });
    }
    if (searchInput && searchResults) {
        searchInput.addEventListener("input", function () {
            var q = String(searchInput.value || "").trim();
            if (root._foodPickerSearchTimer) {
                clearTimeout(root._foodPickerSearchTimer);
                root._foodPickerSearchTimer = null;
            }
            if (!q) {
                searchResults.innerHTML = "";
                return;
            }
            var epoch = root._foodPickerEpoch || 0;
            root._foodPickerSearchTimer = setTimeout(function () {
                fetch("/api/foods/search?q=" + encodeURIComponent(q), {
                    credentials: "same-origin",
                })
                    .then(function (res) {
                        return res.ok ? res.json() : { foods: [] };
                    })
                    .then(function (data) {
                        if ((root._foodPickerEpoch || 0) !== epoch) return;
                        renderHits(searchResults, (data && data.foods) || []);
                    })
                    .catch(function () {
                        if ((root._foodPickerEpoch || 0) !== epoch) return;
                        searchResults.innerHTML = "";
                    });
            }, 200);
        });
    }
    var form = root.querySelector("[data-barcode-form]");
    var barcodeResults = root.querySelector("[data-barcode-results]");
    var posts =
        form &&
        String(form.getAttribute("method") || "").toLowerCase() === "post";
    if (form && !posts) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            var input = form.querySelector('input[name="barcode"]');
            var digits = String(
                input && input.value ? input.value : "",
            ).replace(/\D/g, "");
            form.setAttribute("data-lookup-called", "lookupBarcode");
            if (barcodeResults) {
                barcodeResults.setAttribute(
                    "data-lookup-path",
                    "lookupBarcode",
                );
            }
            if (digits.length < 8 || digits.length > 14) {
                if (barcodeResults)
                    barcodeResults.innerHTML = "<li>Invalid barcode</li>";
                return;
            }
            if (barcodeResults)
                barcodeResults.setAttribute("data-barcode", digits);
        });
    }
}

function initFoodPickers(root) {
    root.querySelectorAll("[data-food-picker]").forEach(initFoodPicker);
}

window.FoodableApp.onLoad(function (root) {
    bindFoodPickerFillReset();
    initFoodPickers(root);
});
