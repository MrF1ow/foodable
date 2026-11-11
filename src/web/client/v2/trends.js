// Range toggle on /trends: four server-rendered panels, no fetch.
const trendsBound = new WeakSet();

function subtitleForRange(range) {
    return (
        {
            7: "This week",
            30: "How the last 30 days went",
            90: "How the last 90 days went",
            365: "How the last year went",
        }[range] ?? "How the last 30 days went"
    );
}

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
    const subtitle = root.querySelector(".fd-trends-subtitle");
    if (subtitle) subtitle.textContent = subtitleForRange(range);
}

function syncRangeQuery(root, range) {
    if (typeof window === "undefined" || !window.location?.href) return;
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("range") === range) return;
        url.searchParams.set("range", range);
        window.history.replaceState?.(null, "", url);
    } catch {
        // ignore in non-browser harnesses
    }
}

// The month card's previous / next links carry the range, so a month change
// keeps the range the viewer picked here.
function syncMonthLinks(root, range) {
    for (const link of root.querySelectorAll?.(".fd-trends-month__nav") ?? []) {
        try {
            const url = new URL(link.getAttribute("href"), "http://x");
            url.searchParams.set("range", range);
            link.setAttribute("href", `${url.pathname}${url.search}`);
        } catch {
            // leave the server's href
        }
    }
}

function activateFromButton(root, btn) {
    const range = btn.getAttribute("data-fd-trends-range");
    if (!range) return;
    setActiveRange(root, range);
    syncRangeQuery(root, range);
    syncMonthLinks(root, range);
    root.setAttribute("data-fd-trends-active", range);
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
