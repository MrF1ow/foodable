// Shell behaviour. Loaded after /app.js, so FoodableApp and
// Turbo are already there.
//
// 1. The log-meal dialog is reached by fragment. Search, Scan and Log food link
//    to `/#nutrition-log-meal`. The Trends tab goes to `/trends`. On the
//    nutrition page the fragment opens the dialog (then drops it so a morph
//    does not reopen it). On any other page that link navigates to `/`, and the
//    same code runs after the visit.
// 2. ⌘K / Ctrl+K opens the log search sheet (log-sheet.js handles it).
// 3. The tapped nav entry becomes current right away, as app.js does for the
//    old nav, so it fades up while the visit loads. (Not fragment links,
//    which stay on the same page.)
// 4. Login HTML coming back during an in-app visit full-loads instead of
//    morphing into app chrome (the old shell's guard looks for nav.bottom-nav).

const LOG_MEAL_ID = "nutrition-log-meal";
const TRENDS_CARD = "trends";

function clearFragment() {
    try {
        window.history.replaceState(
            window.history.state,
            "",
            window.location.pathname + window.location.search,
        );
    } catch (_) {}
}

// Acts on a fragment this file owns. True when it did something, so the caller
// knows to drop the fragment.
function actOnFragment(hash) {
    if (hash === LOG_MEAL_ID) {
        const dialog = document.getElementById(LOG_MEAL_ID);
        if (
            dialog instanceof HTMLDialogElement &&
            typeof dialog.showModal === "function"
        ) {
            if (!dialog.open) dialog.showModal();
            return true;
        }
        return false;
    }
    if (hash === TRENDS_CARD) {
        const card = document.querySelector(
            '[data-nutrition-card="' + TRENDS_CARD + '"]',
        );
        if (card) {
            card.scrollIntoView({ block: "start" });
            return true;
        }
    }
    return false;
}

// After a visit (or a full load) that arrived with a fragment.
function handleFragment() {
    const hash = decodeURIComponent((window.location.hash || "").slice(1));
    if (hash && actOnFragment(hash)) clearFragment();
}

window.FoodableApp.onLoad(handleFragment);
window.addEventListener("hashchange", handleFragment);

// A fragment link to the page already showing: Turbo answers it with a history
// entry and no hashchange, so act here and leave the URL alone.
document.addEventListener("click", (event) => {
    const link = event.target.closest?.(
        "a.fd-tab[href*='#'], a.fd-log, a.fd-search, a.fd-scan, a.fd-logfood",
    );
    if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    )
        return;
    const url = new URL(link.href, window.location.href);
    if (
        url.origin !== window.location.origin ||
        url.pathname !== window.location.pathname ||
        url.search !== window.location.search ||
        !url.hash
    )
        return;
    if (actOnFragment(decodeURIComponent(url.hash.slice(1))))
        event.preventDefault();
});

document.addEventListener("click", (event) => {
    const link = event.target.closest?.(
        ".fd-tabs a.fd-tab[href]:not([href*='#']), .fd-sidenav a.fd-sidelink[href]:not([href*='#']):not([data-turbo='false'])",
    );
    if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    )
        return;
    for (const a of link.closest("nav").querySelectorAll("a[aria-current]"))
        a.removeAttribute("aria-current");
    link.setAttribute("aria-current", "page");
});

document.addEventListener("turbo:before-render", (event) => {
    const newBody = event.detail?.newBody;
    if (
        newBody &&
        newBody.querySelector("form.auth-form") &&
        document.querySelector(".fd-shell")
    ) {
        event.preventDefault();
        window.location.reload();
    }
});
