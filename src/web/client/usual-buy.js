// Usual-product picker: "Usually buy" and "at" follow the selected radio.
// Each radio carries the store and amount its own row already has (None
// carries the plain food's), and saving writes the fields to that row. So
// switching the radio must swap the fields, or one row's values are copied
// onto another. Without this script the fields keep the server's prefill
// for the radio that was checked on load.

function applyUsualBuy(radio) {
    const form = radio.form;
    if (!form || !form.hasAttribute("data-usual-buy-follow")) return;
    const amount = form.querySelector('[name="usual_amount"]');
    const unit = form.querySelector('[name="usual_unit"]');
    const store = form.querySelector('[name="usual_store_id"]');
    if (amount) amount.value = radio.getAttribute("data-usual-amount") || "";
    if (unit) unit.value = radio.getAttribute("data-usual-unit") || "";
    if (store) store.value = radio.getAttribute("data-usual-store") || "";
}

if (
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function"
) {
    document.addEventListener("change", function (event) {
        const target = event.target;
        if (
            target &&
            target.matches &&
            target.matches('input[type="radio"][name="product_food_id"]')
        ) {
            applyUsualBuy(target);
        }
    });
}
