import { searchFoodsByName } from "../../food-search.js";
import {
    lookupBarcode,
    normalizeBarcode,
    type FoodResult,
} from "../../foods.js";
import { escapeHtml } from "../shell.js";
import { renderQuantityField } from "./quantity-field.js";

type SearchHooks = Parameters<typeof searchFoodsByName>[2];

export async function searchPickerFoods(
    query: string,
    householdNames: string[] = [],
    hooks: SearchHooks = {},
): Promise<FoodResult[]> {
    return searchFoodsByName(query, householdNames, hooks);
}

export async function runBarcodeLookupAction(
    raw: string,
    opts: {
        lookup?: (barcode: string) => Promise<FoodResult | null>;
    } = {},
): Promise<{ barcode: string; food: FoodResult | null } | { error: string }> {
    const barcode = normalizeBarcode(raw);
    if (!barcode) return { error: "invalid barcode" };
    const lookup = opts.lookup ?? lookupBarcode;
    const food = await lookup(barcode);
    return { barcode, food };
}

function hiddenInputs(fields: Record<string, string>): string {
    return Object.entries(fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
        )
        .join("");
}

function pickerScript(id: string, method: "get" | "post"): string {
    const hitHtml =
        method === "post"
            ? `if (food.food_id) {
                return '<li><button type="submit" name="food_id" value="' + esc(food.food_id) + '" data-default-unit="' + esc(food.default_unit || "") + '">' + esc(label) + "</button></li>";
            }
            return '<li><button type="submit" name="barcode" value="' + esc(food.barcode || "") + '" data-default-unit="' + esc(food.default_unit || "") + '">' + esc(label) + "</button></li>";`
            : `return "<li>" + esc(label) + "</li>";`;
    return `<script>
(function () {
    var root = document.getElementById(${JSON.stringify(id)});
    if (!root) return;
    var tabs = root.querySelectorAll('[role="tab"]');
    var panels = root.querySelectorAll('[role="tabpanel"]');
    function show(name) {
        tabs.forEach(function (tab) {
            var on = tab.getAttribute("data-tab") === name;
            tab.setAttribute("aria-selected", on ? "true" : "false");
        });
        panels.forEach(function (panel) {
            panel.hidden = panel.getAttribute("data-panel") !== name;
        });
    }
    tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
            show(tab.getAttribute("data-tab"));
        });
    });
    var searchInput = root.querySelector("[data-search-input]");
    var searchResults = root.querySelector("[data-search-results]");
    var searchTimer = null;
    function esc(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
    function renderHits(target, hits) {
        if (!target) return;
        target.innerHTML = hits.map(function (food) {
            var label = food.brand ? food.brand + " · " + food.name : food.name;
            ${hitHtml}
        }).join("");
        target.querySelectorAll("button[data-default-unit]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var unit = btn.getAttribute("data-default-unit");
                if (!unit) return;
                var form = btn.closest("form");
                if (!form) return;
                var sel = form.querySelector('select[name="qty_unit"]');
                if (!sel) return;
                for (var i = 0; i < sel.options.length; i++) {
                    if (sel.options[i].value === unit) {
                        sel.value = unit;
                        break;
                    }
                }
            });
        });
    }
    if (searchInput && searchResults) {
        searchInput.addEventListener("input", function () {
            var q = String(searchInput.value || "").trim();
            if (searchTimer) clearTimeout(searchTimer);
            if (!q) {
                searchResults.innerHTML = "";
                return;
            }
            searchTimer = setTimeout(function () {
                fetch("/api/foods/search?q=" + encodeURIComponent(q), {
                    credentials: "same-origin",
                })
                    .then(function (res) { return res.ok ? res.json() : { foods: [] }; })
                    .then(function (data) {
                        renderHits(searchResults, (data && data.foods) || []);
                    })
                    .catch(function () {
                        searchResults.innerHTML = "";
                    });
            }, 200);
        });
    }
    var form = root.querySelector("[data-barcode-form]");
    var barcodeResults = root.querySelector("[data-barcode-results]");
    var posts = form && String(form.getAttribute("method") || "").toLowerCase() === "post";
    if (form && !posts) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            var input = form.querySelector('input[name="barcode"]');
            var digits = String(input && input.value ? input.value : "").replace(/\\D/g, "");
            form.setAttribute("data-lookup-called", "lookupBarcode");
            if (barcodeResults) {
                barcodeResults.setAttribute("data-lookup-path", "lookupBarcode");
            }
            if (digits.length < 8 || digits.length > 14) {
                if (barcodeResults) barcodeResults.innerHTML = "<li>Invalid barcode</li>";
                return;
            }
            if (barcodeResults) barcodeResults.setAttribute("data-barcode", digits);
        });
    }
})();
</script>`;
}

export type FoodPickerOptions = {
    id?: string;
    action?: string;
    method?: "get" | "post";
    hiddenFields?: Record<string, string>;
    includeQuantity?: boolean;
};

export function renderFoodPicker(opts: FoodPickerOptions = {}): string {
    const id = opts.id ?? "food-picker";
    const action = opts.action ?? "#";
    const method = opts.method ?? "get";
    const extras = hiddenInputs(opts.hiddenFields ?? {});
    const qty = opts.includeQuantity
        ? renderQuantityField({
              kind: "food",
              idPrefix: `${id}-qty`,
              namePrefix: "qty",
              required: method === "post",
          })
        : "";
    const barcodePanel = `${id}-barcode`;
    const searchPanel = `${id}-search`;
    const manualPanel = `${id}-manual`;
    const manualQty = renderQuantityField({
        kind: "food",
        idPrefix: `${id}-manual-qty`,
        namePrefix: method === "post" ? "qty" : `${id.replace(/-/g, "_")}_qty`,
        required: method === "post",
    });
    const barcodeSubmit = method === "post" ? "Add food" : "Look up";
    const searchQty =
        method === "post" && opts.includeQuantity
            ? renderQuantityField({
                  kind: "food",
                  idPrefix: `${id}-search-qty`,
                  namePrefix: "qty",
                  required: true,
              })
            : "";
    const searchFields = `<label for="${escapeHtml(id)}-search">Search</label>
<input id="${escapeHtml(id)}-search" type="search" data-search-input autocomplete="off" />
${
    method === "post"
        ? `<form class="food-picker-search" data-search-form method="post" action="${escapeHtml(action)}">
${extras}
${searchQty}
<ul class="food-picker-results" data-search-results></ul>
</form>`
        : `<ul class="food-picker-results" data-search-results></ul>`
}`;
    const manualBlock =
        method === "post"
            ? `<form class="food-picker-manual" method="post" action="${escapeHtml(action)}">
${extras}
<label for="${escapeHtml(id)}-name">Name</label>
<input id="${escapeHtml(id)}-name" name="food_name" type="text" required autocomplete="off" />
${manualQty}
<button type="submit" class="btn-primary">Add food</button>
</form>`
            : `<label for="${escapeHtml(id)}-name">Name</label>
<input id="${escapeHtml(id)}-name" name="food_name" type="text" autocomplete="off" />
${manualQty}`;
    return `<div class="food-picker" id="${escapeHtml(id)}" data-food-picker>
<div class="food-picker-tabs seg" role="tablist" aria-label="Food identity">
<button type="button" role="tab" class="seg-btn" id="${escapeHtml(id)}-tab-barcode" data-tab="barcode" aria-controls="${escapeHtml(barcodePanel)}" aria-selected="true">Barcode</button>
<button type="button" role="tab" class="seg-btn" id="${escapeHtml(id)}-tab-search" data-tab="search" aria-controls="${escapeHtml(searchPanel)}" aria-selected="false">Search</button>
<button type="button" role="tab" class="seg-btn" id="${escapeHtml(id)}-tab-manual" data-tab="manual" aria-controls="${escapeHtml(manualPanel)}" aria-selected="false">Manual</button>
</div>
<div class="food-picker-panel" role="tabpanel" id="${escapeHtml(barcodePanel)}" data-panel="barcode" aria-labelledby="${escapeHtml(id)}-tab-barcode">
<form class="food-picker-barcode" data-barcode-form data-lookup-path="lookupBarcode" action="${escapeHtml(action)}" method="${method}">
${extras}
<label for="${escapeHtml(id)}-barcode">Barcode</label>
<input id="${escapeHtml(id)}-barcode" name="barcode" inputmode="numeric" pattern="[0-9]*" autocomplete="off" />
${qty}
<button type="submit" class="btn-primary">${escapeHtml(barcodeSubmit)}</button>
</form>
<ul class="food-picker-results" data-barcode-results></ul>
</div>
<div class="food-picker-panel" role="tabpanel" id="${escapeHtml(searchPanel)}" data-panel="search" aria-labelledby="${escapeHtml(id)}-tab-search" hidden>
${searchFields}
</div>
<div class="food-picker-panel" role="tabpanel" id="${escapeHtml(manualPanel)}" data-panel="manual" aria-labelledby="${escapeHtml(id)}-tab-manual" hidden>
${manualBlock}
</div>
</div>
${pickerScript(id, method)}`;
}
