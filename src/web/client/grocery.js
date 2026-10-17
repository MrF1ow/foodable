document.querySelectorAll(".grocery-store").forEach(function (store) {
    var select = store.querySelector("[data-grocery-section]");
    if (!select) return;
    store.querySelectorAll("form").forEach(function (form) {
        form.addEventListener("submit", function () {
            var existing = form.querySelector('input[name="section_id"]');
            if (existing) existing.value = select.value;
            else {
                var input = document.createElement("input");
                input.type = "hidden";
                input.name = "section_id";
                input.value = select.value;
                form.appendChild(input);
            }
        });
    });
});
