if (window.FoodableApp) {
    const seen = new WeakSet();
    window.FoodableApp.onLoad(function () {
        document.querySelectorAll("[data-copy-target]").forEach(function (btn) {
            if (seen.has(btn)) return;
            seen.add(btn);
            const targetId = btn.getAttribute("data-copy-target");
            if (!targetId) return;
            const target = document.getElementById(targetId);
            if (!target) return;
            const label = btn.textContent || "Copy";
            btn.addEventListener("click", function () {
                const text =
                    "value" in target ? target.value : target.textContent || "";
                navigator.clipboard.writeText(text).then(
                    function () {
                        btn.textContent = "Copied";
                        setTimeout(function () {
                            btn.textContent = label;
                        }, 2000);
                    },
                    function () {},
                );
            });
        });
    });
}
