// Shared widget helpers — esc, fmt, tpl, plural.
//
// Each template @include's this file directly, beside shared/bridge.js, and
// deletes its local copies. Do not pull it in from another partial:
// src/widgets.test.ts requires every included partial's full text to appear
// verbatim in the assembled HTML, so a nested include would splice this file
// away from the template's own marker.
//
// esc is the superset of the three copies this replaced (plan D4): a missing
// value renders blank rather than the word "null", and ' is escaped too.
// Nothing that works today changes — widgets stay pixel-identical.

function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function fmt(n, decimals) {
    if (n == null || isNaN(n)) return "0";
    const r = decimals ? n.toFixed(decimals) : Math.round(n);
    return Number(r).toLocaleString();
}

// Fill {placeholders} in a template string, e.g.
// tpl(MACRO_COPY.byMealTitle, { label: "Protein" }) -> "Protein by meal".
function tpl(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, (_, k) =>
        vars && vars[k] != null ? String(vars[k]) : "",
    );
}

// Pick the right grammatical form of a PluralForms value ({ one, other }) for
// count `n` in English, then fill {n} (and any other placeholder in vars).
function plural(forms, n, vars) {
    let category = "other";
    try {
        category = new Intl.PluralRules("en").select(n);
    } catch (_) {}
    const form = forms[category] || forms.other || forms.one || "";
    return tpl(form, Object.assign({ n }, vars));
}
