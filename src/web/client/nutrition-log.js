const mealItemsInit = new WeakSet();
const mealAddInit = new WeakSet();

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

function initMealLog(root) {
    root.querySelectorAll("[data-meal-items]").forEach(function (mealRoot) {
        if (mealItemsInit.has(mealRoot)) return;
        mealItemsInit.add(mealRoot);
        mealRoot.querySelectorAll("[data-meal-item]").forEach(bindMealRow);
        var form = mealRoot.closest("form");
        var add = form && form.querySelector("[data-add-meal-item]");
        if (add && !mealAddInit.has(add)) {
            mealAddInit.add(add);
            add.addEventListener("click", function () {
                var first = mealRoot.querySelector("[data-meal-item]");
                if (!first) return;
                var clone = first.cloneNode(true);
                clone.querySelectorAll("input").forEach(function (el) {
                    el.value = "";
                });
                var list = clone.querySelector("[data-meal-item-results]");
                if (list) list.innerHTML = "";
                mealRoot.appendChild(clone);
                bindMealRow(clone);
            });
        }
    });
}

window.FoodableApp.onLoad(initMealLog);
