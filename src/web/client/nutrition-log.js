const mealItemsInit = new WeakSet();

function bindMealRow(row) {
    var input = row.querySelector("[data-meal-item-name]");
    var hidden = row.querySelector("[data-meal-item-food-id]");
    var results = row.querySelector("[data-meal-item-results]");
    var timer = null;
    if (!input || !results) return;
    input.addEventListener("input", function () {
        var q = String(input.value || "").trim();
        if (hidden) hidden.value = "";
        if (timer) clearTimeout(timer);
        if (!q) {
            results.innerHTML = "";
            return;
        }
        timer = setTimeout(function () {
            fetch("/api/foods/search?q=" + encodeURIComponent(q), {
                credentials: "same-origin",
            })
                .then(function (res) {
                    return res.ok ? res.json() : { foods: [] };
                })
                .then(function (data) {
                    results.innerHTML = ((data && data.foods) || [])
                        .map(function (food) {
                            var label = food.brand
                                ? food.brand + " · " + food.name
                                : food.name;
                            var id = food.food_id || "";
                            return (
                                '<li><button type="button" data-food-id="' +
                                id.replace(/"/g, "&quot;") +
                                '" data-name="' +
                                String(food.name || "").replace(
                                    /"/g,
                                    "&quot;",
                                ) +
                                '">' +
                                label.replace(/</g, "&lt;") +
                                "</button></li>"
                            );
                        })
                        .join("");
                })
                .catch(function () {
                    results.innerHTML = "";
                });
        }, 200);
    });
    results.addEventListener("click", function (event) {
        var btn =
            event.target && event.target.closest
                ? event.target.closest("button[data-food-id]")
                : null;
        if (!btn) return;
        if (hidden) hidden.value = btn.getAttribute("data-food-id") || "";
        input.value = btn.getAttribute("data-name") || input.value;
        results.innerHTML = "";
    });
}

function syncMealItemRemoveButtons(mealRoot) {
    var rows = mealRoot.querySelectorAll("[data-meal-item]");
    var showRemove = rows.length > 1;
    rows.forEach(function (row) {
        var btn = row.querySelector("[data-meal-item-remove]");
        if (!btn) return;
        if (showRemove) btn.removeAttribute("hidden");
        else btn.setAttribute("hidden", "");
    });
}

function initMealLog(root) {
    root.querySelectorAll("[data-meal-items]").forEach(function (mealRoot) {
        if (mealItemsInit.has(mealRoot)) return;
        mealItemsInit.add(mealRoot);
        mealRoot.querySelectorAll("[data-meal-item]").forEach(bindMealRow);
        syncMealItemRemoveButtons(mealRoot);
        mealRoot.addEventListener("click", function (event) {
            var target = event.target;
            if (!target || !target.closest) return;
            if (target.closest("[data-add-meal-item]")) {
                var first = mealRoot.querySelector("[data-meal-item]");
                if (!first) return;
                var clone = first.cloneNode(true);
                clone.querySelectorAll("input").forEach(function (el) {
                    el.value = "";
                });
                var list = clone.querySelector("[data-meal-item-results]");
                if (list) list.innerHTML = "";
                var addBtn = mealRoot.querySelector("[data-add-meal-item]");
                if (addBtn) mealRoot.insertBefore(clone, addBtn);
                else mealRoot.appendChild(clone);
                bindMealRow(clone);
                syncMealItemRemoveButtons(mealRoot);
                return;
            }
            if (target.closest("[data-meal-item-remove]")) {
                var row = target.closest("[data-meal-item]");
                if (
                    !row ||
                    mealRoot.querySelectorAll("[data-meal-item]").length <= 1
                )
                    return;
                row.remove();
                syncMealItemRemoveButtons(mealRoot);
            }
        });
    });
}

window.FoodableApp.onLoad(initMealLog);
