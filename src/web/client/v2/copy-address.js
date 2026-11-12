// Settings › AI connections: the copy button beside the connect address
// (src/web/pages/v2/settings-ai.ts). It copies the address with the clipboard
// API; where that is refused or missing it selects the address and tries the
// selection copy, and the live region says what happened either way. The
// address is public config and never leaves the page.
// Binding is idempotent per box (a WeakSet), so Turbo re-running onLoad on a
// morph never double-binds.

const bound = new WeakSet();

function selectText(el) {
    try {
        const selection = window.getSelection && window.getSelection();
        if (!selection || typeof document.createRange !== "function") return;
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (_e) {
        // Selecting is a courtesy; the status line still tells the person.
    }
}

async function copyText(el) {
    const text = (el.textContent || "").trim();
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
    selectText(el);
    try {
        return (
            typeof document.execCommand === "function" &&
            document.execCommand("copy") === true
        );
    } catch (_e) {
        return false;
    }
}

function initCopyAddress(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("[data-fd-copy-address]").forEach((box) => {
        if (bound.has(box)) return;
        bound.add(box);
        const source = box.querySelector("[data-fd-copy-source]");
        const button = box.querySelector("[data-fd-copy-trigger]");
        if (!source || !button) return;
        // The live region sits beside the box, not in it.
        const page = box.parentNode;
        const status =
            (page && page.querySelector
                ? page.querySelector("[data-fd-copy-status]")
                : null) || box.querySelector("[data-fd-copy-status]");
        button.addEventListener("click", () => {
            copyText(source).then((ok) => {
                if (status) {
                    status.textContent = ok
                        ? "Copied to the clipboard."
                        : "Press and hold the address to copy it.";
                }
            });
        });
    });
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initCopyAddress);
    } else if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initCopyAddress(document),
            );
        } else {
            initCopyAddress(document);
        }
    }
}
