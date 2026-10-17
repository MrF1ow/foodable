// html.fx is set inside a frame, never under prefers-reduced-motion, so a
// renderer that never ticks keeps the static page. Guard matchMedia: tests
// run this script against a fake window without it. The pointer glow on
// panels (magic-card) only reads --mx / --my.
const mq = (q) =>
    typeof window.matchMedia === "function" && window.matchMedia(q).matches;
if (
    typeof window.matchMedia === "function" &&
    !mq("(prefers-reduced-motion: reduce)")
) {
    window.requestAnimationFrame(() =>
        document.documentElement.classList.add("fx"),
    );
}
if (mq("(hover: hover) and (pointer: fine)")) {
    document.addEventListener(
        "pointermove",
        (e) => {
            const panel =
                e.target instanceof Element &&
                e.target.closest(".app-main .panel");
            if (!panel) return;
            const r = panel.getBoundingClientRect();
            panel.style.setProperty("--mx", e.clientX - r.left + "px");
            panel.style.setProperty("--my", e.clientY - r.top + "px");
        },
        { passive: true },
    );
}
document.querySelectorAll(".widget-frame").forEach((frame) => {
    // Same max-content measure as the bridge's size-changed report.
    // scrollHeight never drops below the frame's own height, so it could
    // only grow a frame, never shrink one back to its content.
    const fit = () => {
        try {
            const doc = frame.contentDocument;
            if (!doc) return;
            const el = doc.documentElement;
            const prev = el.style.height;
            el.style.height = "max-content";
            const height = Math.ceil(el.getBoundingClientRect().height);
            el.style.height = prev;
            if (height) frame.style.height = height + "px";
        } catch (_) {}
    };
    // This script waits for /app.css, and a srcdoc frame does not: by the
    // time it runs, a frame may already have loaded and posted its first
    // size-changed, both missed. So measure now as well as on load; a frame
    // still on its initial about:blank measures 0 and is left alone.
    fit();
    frame.addEventListener("load", fit);
    window.addEventListener("message", (e) => {
        if (e.source !== frame.contentWindow) return;
        const d = e.data;
        if (
            d &&
            d.method &&
            String(d.method).endsWith("size-changed") &&
            d.params &&
            d.params.height
        ) {
            frame.style.height = d.params.height + "px";
        }
    });
});
