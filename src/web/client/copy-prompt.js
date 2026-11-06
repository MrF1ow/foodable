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
            const statusId = btn.getAttribute("data-copy-status");
            const status = statusId ? document.getElementById(statusId) : null;
            const announce = function (message) {
                if (status) status.textContent = message;
            };
            btn.addEventListener("click", function () {
                const text =
                    "value" in target ? target.value : target.textContent || "";
                navigator.clipboard.writeText(text).then(
                    function () {
                        btn.textContent = "Copied";
                        announce("Prompt copied.");
                        setTimeout(function () {
                            btn.textContent = label;
                            announce("");
                        }, 2000);
                    },
                    function () {
                        announce(
                            "Couldn't copy. Select the prompt and copy it yourself.",
                        );
                    },
                );
            });
        });
    });
}
