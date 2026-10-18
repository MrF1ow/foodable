function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

const foodPickerInit = new WeakSet();

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
    var searchInput = root.querySelector("[data-search-input]");
    var searchResults = root.querySelector("[data-search-results]");
    var searchTimer = null;
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
            if (searchTimer) clearTimeout(searchTimer);
            if (!q) {
                searchResults.innerHTML = "";
                return;
            }
            searchTimer = setTimeout(function () {
                fetch("/api/foods/search?q=" + encodeURIComponent(q), {
                    credentials: "same-origin",
                })
                    .then(function (res) {
                        return res.ok ? res.json() : { foods: [] };
                    })
                    .then(function (data) {
                        renderHits(searchResults, (data && data.foods) || []);
                    })
                    .catch(function () {
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

window.FoodableApp.onLoad(initFoodPickers);
