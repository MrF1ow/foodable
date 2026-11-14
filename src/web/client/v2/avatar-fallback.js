// A member's picture sits over their initials (components/v2/avatar.ts). When
// it cannot load (removed in another tab, a session that expired and got the
// sign-in page back) the picture is hidden, so the initials under it show
// instead of an empty disc with a broken-image glyph.

const PICTURE = "img.fd-avatar__img";

function hideIfBroken(img) {
    // Loaded and empty: it failed before this script was listening.
    if (img.complete && img.naturalWidth === 0) img.hidden = true;
}

if (typeof document !== "undefined") {
    // `error` does not bubble, so one capturing listener covers every picture,
    // including ones a Turbo visit or morph adds later.
    document.addEventListener(
        "error",
        (event) => {
            const img = event.target;
            if (img && img.matches && img.matches(PICTURE)) img.hidden = true;
        },
        true,
    );
}

if (typeof window !== "undefined") {
    const scan = (scope) => {
        const root = scope && scope.querySelectorAll ? scope : document;
        root.querySelectorAll(PICTURE).forEach(hideIfBroken);
    };
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(scan);
    } else if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => scan(document));
        } else {
            scan(document);
        }
    }
}
