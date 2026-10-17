// SPIKE: the JS half of motion.css. fxEnter(root) runs once, after the first
// paint: it marks the subtree for the CSS entrance and counts the calorie
// figure up (number-ticker). Re-renders (a range toggle) do not replay it.
const fxReduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
let fxPlayed = false;

function fxTick(el, ms) {
    const node = el.firstChild;
    if (!node || node.nodeType !== 3) return;
    const final = node.nodeValue;
    const to = Number(final.replace(/[^\d.]/g, ""));
    if (!isFinite(to) || to <= 0) return;
    const fmt = new Intl.NumberFormat("en-US");
    const t0 = performance.now();
    function step(now) {
        const k = Math.min(1, (now - t0) / ms);
        const eased = 1 - Math.pow(1 - k, 3);
        node.nodeValue = k < 1 ? fmt.format(Math.round(to * eased)) : final;
        if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function fxEnter(root) {
    if (fxPlayed || fxReduced || !root) return;
    fxPlayed = true;
    // Only turn effects on from inside a frame: if frames never tick, the
    // widget keeps its static final state.
    requestAnimationFrame(() => {
        document.documentElement.classList.add("fx");
        root.classList.add("fx-enter");
        root.querySelectorAll(".cal-val").forEach((el) => fxTick(el, 900));
        setTimeout(() => root.classList.remove("fx-enter"), 1500);
    });
}
