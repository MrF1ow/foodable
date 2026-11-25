// Range tabs on /trends: four server-rendered panels, no fetch. The tabs are
// links to the same page with `?range=`, so with no script a tab still works;
// here a press flips the tab, the panel and the subtitle in place. Go to a day
// is a date picker that opens Today on the day picked.
const trendsBound = new WeakSet();
const ACTIVE_TAB = "fd-tab-row__tab--active";

// Calories by day opens on the newest day: a list that overflows is scrolled
// to its right edge. A hidden panel has no width to scroll, so this runs when
// the panel is shown as well as on load.
function scrollBarsToEnd(root) {
    for (const bars of root.querySelectorAll(".fd-trends-bars")) {
        if (bars.offsetParent === null) continue;
        bars.scrollLeft = bars.scrollWidth;
    }
}

function subtitleForRange(range) {
    return String(range) === "365" ? "Last year" : `Last ${range} days`;
}

function setActiveRange(root, range) {
    for (const tab of root.querySelectorAll("[data-fd-trends-range]")) {
        const on = tab.getAttribute("data-fd-trends-range") === String(range);
        if (on) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
        tab.classList.toggle(ACTIVE_TAB, on);
    }
    for (const panel of root.querySelectorAll("[data-fd-trends-panel]")) {
        const show =
            panel.getAttribute("data-fd-trends-panel") === String(range);
        if (show) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
    }
    const subtitle = root.querySelector(".fd-page-header__subtitle");
    if (subtitle) subtitle.textContent = subtitleForRange(range);
    scrollBarsToEnd(root);
}

function syncRangeQuery(range) {
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

function activateFromTab(root, tab) {
    const range = tab.getAttribute("data-fd-trends-range");
    if (!range) return;
    setActiveRange(root, range);
    syncRangeQuery(range);
    root.setAttribute("data-fd-trends-active", range);
}

function initTrends(root) {
    if (trendsBound.has(root) || !root.matches?.("[data-fd-trends-root]"))
        return;
    if (!root.querySelector("[data-fd-trends-panel]")) return;
    trendsBound.add(root);
    scrollBarsToEnd(root);

    root.addEventListener("click", (event) => {
        const tab = event.target.closest?.("[data-fd-trends-range]");
        if (!tab || !root.contains(tab)) return;
        event.preventDefault();
        activateFromTab(root, tab);
    });

    // A day picked opens Today on it (a form GET, so Turbo follows it).
    root.addEventListener("change", (event) => {
        const input = event.target.closest?.("[data-fd-trends-goto]");
        if (!input || !input.value) return;
        input.form?.requestSubmit();
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
