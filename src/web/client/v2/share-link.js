// The "Link ready" screen (src/web/pages/v2/share-sheet.ts): copies the new
// link's address. It tries once on load, which most browsers allow only after
// a tap, so the Copy button is the dependable way; either way the field is
// selected so a long press or Ctrl+C works too. The address never leaves the
// field: it is not stored, logged or sent anywhere.
// Binding is idempotent per box (a WeakSet), so Turbo re-running onLoad on a
// morph never double-binds.

const bound = new WeakSet();

function selectField(input) {
    if (typeof input.focus === "function") input.focus();
    if (typeof input.select === "function") input.select();
}

async function copyText(input) {
    const text = input.value;
    if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
    ) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_e) {
            // Fall through to the selection copy.
        }
    }
    try {
        selectField(input);
        return (
            typeof document !== "undefined" &&
            typeof document.execCommand === "function" &&
            document.execCommand("copy") === true
        );
    } catch (_e) {
        return false;
    }
}

function initShareMade(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("[data-fd-share-made]").forEach((box) => {
        if (bound.has(box)) return;
        bound.add(box);
        const input = box.querySelector("[data-fd-share-url]");
        const button = box.querySelector("[data-fd-share-copy]");
        const page = box.parentNode;
        const status =
            page && page.querySelector
                ? page.querySelector("[data-fd-share-status]")
                : null;
        if (!input) return;

        // Leaving by a Turbo visit snapshots this page for the Back button;
        // the address must not be in it.
        document.addEventListener(
            "turbo:before-cache",
            () => {
                input.value = "";
            },
            { once: true },
        );

        function say(text) {
            if (status) status.textContent = text;
        }

        selectField(input);
        copyText(input).then((ok) => {
            if (ok) say("Copied to the clipboard.");
        });
        if (button) {
            button.addEventListener("click", () => {
                copyText(input).then((ok) => {
                    if (!ok) selectField(input);
                    say(
                        ok
                            ? "Copied to the clipboard."
                            : "Press and hold the link to copy it.",
                    );
                });
            });
        }
    });
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initShareMade);
    } else if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initShareMade(document),
            );
        } else {
            initShareMade(document);
        }
    }
}
