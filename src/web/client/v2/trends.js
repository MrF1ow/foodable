// Range toggle on /trends: four server-rendered panels, no fetch.
const trendsBound = new WeakSet();

function setActiveRange(root, range) {
    for (const btn of root.querySelectorAll("[data-fd-trends-range]")) {
        const on = btn.getAttribute("data-fd-trends-range") === String(range);
        btn.classList.toggle("fd-seg-btn--on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const panel of root.querySelectorAll("[data-fd-trends-panel]")) {
        const show =
            panel.getAttribute("data-fd-trends-panel") === String(range);
        if (show) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
    }
}

function activateFromButton(root, btn) {
    const range = btn.getAttribute("data-fd-trends-range");
    if (!range) return;
    setActiveRange(root, range);
}

function initTrends(root) {
    if (trendsBound.has(root) || !root.matches?.("[data-fd-trends-root]"))
        return;
    if (!root.querySelector("[data-fd-trends-panel]")) return;
    trendsBound.add(root);

    root.addEventListener("click", (event) => {
        const btn = event.target.closest?.("[data-fd-trends-range]");
        if (!btn || !root.contains(btn)) return;
        event.preventDefault();
        activateFromButton(root, btn);
    });

    root.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const btn = event.target.closest?.("[data-fd-trends-range]");
        if (!btn || !root.contains(btn)) return;
        event.preventDefault();
        activateFromButton(root, btn);
    });

    if (typeof window.FOODABLE_EXPOSE_TRENDS === "function") {
        window.FOODABLE_EXPOSE_TRENDS({
            setActiveRange: (range) => setActiveRange(root, range),
            root,
        });
    }
}

FoodableApp.onLoad((root) => {
    for (const el of root.querySelectorAll("[data-fd-trends-root]")) {
        initTrends(el);
    }
});
