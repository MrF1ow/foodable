// v2 Settings › Product score: the preset chips and the four weight sliders
// (src/web/pages/v2/settings-score.ts). The form posts without this script; it
// only keeps the page honest while it is being edited:
//  - choosing a preset moves the sliders to that preset's weights, read from
//    the form's `data-fd-score-presets` (the server's own table);
//  - moving a slider selects Custom;
//  - each slider shows its share of the total, which is how the score uses it
//    (weights are relative), and its track fills to the raw value.
// Binding is idempotent per form (a WeakSet), so Turbo re-running onLoad on a
// morph never double-binds.

const bound = new WeakSet();

function shares(values) {
    const total = values.reduce((sum, v) => sum + v, 0);
    return values.map((v) => (total > 0 ? Math.round((v / total) * 100) : 0));
}

function initScoreForms(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("[data-fd-score-form]").forEach((form) => {
        if (bound.has(form)) return;
        bound.add(form);
        let presets = {};
        try {
            presets = JSON.parse(form.getAttribute("data-fd-score-presets"));
        } catch (_e) {
            presets = {};
        }
        const sliders = Array.from(
            form.querySelectorAll(".fd-scoreset__range"),
        );
        const outputs = Array.from(
            form.querySelectorAll("[data-fd-score-share]"),
        );
        const total = form.querySelector("[data-fd-score-total]");
        const custom = form.querySelector(
            'input[name="preset"][value="custom"]',
        );

        function paint() {
            const values = sliders.map((s) => Number(s.value) || 0);
            const parts = shares(values);
            sliders.forEach((slider, i) => {
                if (outputs[i]) outputs[i].textContent = parts[i] + "%";
                slider.style.setProperty("--fd-fill", values[i] + "%");
            });
            if (total) {
                const sum = values.reduce((a, b) => a + b, 0);
                total.textContent = (sum > 0 ? 100 : 0) + "%";
            }
        }

        form.addEventListener("change", (event) => {
            const target = event.target;
            if (!target || target.name !== "preset") return;
            const weights = presets[target.value];
            if (!weights) return; // Custom keeps whatever the sliders hold.
            sliders.forEach((slider) => {
                const part = slider.name.replace(/^weight_/, "");
                if (weights[part] != null) slider.value = String(weights[part]);
            });
            paint();
        });
        form.addEventListener("input", (event) => {
            const target = event.target;
            if (!target || !target.classList) return;
            if (!target.classList.contains("fd-scoreset__range")) return;
            if (custom && !custom.checked) custom.checked = true;
            paint();
        });
        paint();
    });
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initScoreForms);
    } else if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initScoreForms(document),
            );
        } else {
            initScoreForms(document);
        }
    }
}
