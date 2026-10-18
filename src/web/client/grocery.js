document.querySelectorAll("[data-grocery-section]").forEach(function (select) {
    var dialog = select.closest("dialog");
    if (!dialog) return;
    var inferId = select.getAttribute("data-infer-section");
    dialog.querySelectorAll("form").forEach(function (form) {
        form.addEventListener("submit", function () {
            var val = select.value;
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
    });
});
