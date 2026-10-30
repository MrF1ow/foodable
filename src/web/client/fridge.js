// Shared fridge edit and delete dialogs. Row buttons carry the item in
// data-* attributes; this copies them onto the one dialog before it opens.
// The command event fires before showModal (and before modal.js focuses the
// first field on toggle). The click listener covers browsers without it.
const fridgeDialogInit = new WeakSet();
const fridgeTriggerInit = new WeakSet();

const FRIDGE_EDIT_FOOD = "fridge-edit-food";
const FRIDGE_EDIT_SUPPLY = "fridge-edit-supply";
const FRIDGE_DELETE_ITEM = "fridge-delete-item";

function commandInvokers() {
    return (
        typeof HTMLButtonElement !== "undefined" &&
        "commandForElement" in HTMLButtonElement.prototype
    );
}

function attr(el, name) {
    const value = el.getAttribute(name);
    return value == null ? "" : value;
}

function clearErrorBanners(dialog) {
    dialog.querySelectorAll(".error-banner").forEach(function (banner) {
        banner.remove();
    });
}

function setFormAction(form, dialog, action) {
    if (!form) return;
    if (form.getAttribute("action") !== action) clearErrorBanners(dialog);
    form.setAttribute("action", action);
}

function fillFridgeDialog(trigger) {
    const dialogId = trigger.getAttribute("commandfor");
    if (!dialogId) return;
    const dialog = document.getElementById(dialogId);
    if (!dialog) return;
    const id = attr(trigger, "data-item-id");
    const name = attr(trigger, "data-item-name");
    if (dialogId === FRIDGE_DELETE_ITEM) {
        setFormAction(
            dialog.querySelector("form"),
            dialog,
            "/fridge/items/" + id + "/delete",
        );
        const message = dialog.querySelector(".modal-message");
        if (message) {
            message.textContent = "Remove " + name + " from the fridge?";
        }
        return;
    }
    if (dialogId !== FRIDGE_EDIT_FOOD && dialogId !== FRIDGE_EDIT_SUPPLY) {
        return;
    }
    const form = dialog.querySelector("form.fridge-item-edit");
    setFormAction(form, dialog, "/fridge/items/" + id);
    if (form) {
        const amount = form.querySelector('input[name="qty_amount"]');
        if (amount) amount.value = attr(trigger, "data-item-amount");
        const unit = form.querySelector('select[name="qty_unit"]');
        if (unit) unit.value = attr(trigger, "data-item-unit");
        const location = form.querySelector('select[name="location_id"]');
        if (location) location.value = attr(trigger, "data-item-location");
        const expires = form.querySelector('input[name="expires_on"]');
        if (expires) expires.value = attr(trigger, "data-item-expires");
    }
    const title = dialog.querySelector(".modal-title");
    if (title) title.textContent = "Edit " + name;
}

function initFridgeItemModals(root) {
    root.querySelectorAll(
        "#" +
            FRIDGE_EDIT_FOOD +
            ", #" +
            FRIDGE_EDIT_SUPPLY +
            ", #" +
            FRIDGE_DELETE_ITEM,
    ).forEach(function (dialog) {
        if (fridgeDialogInit.has(dialog)) return;
        fridgeDialogInit.add(dialog);
        dialog.addEventListener("command", function (event) {
            const source = event.source;
            if (!source || typeof source.getAttribute !== "function") return;
            if (!source.hasAttribute("data-item-id")) return;
            fillFridgeDialog(source);
        });
    });
    const nativeCommand = commandInvokers();
    root.querySelectorAll("button[data-item-id][command='show-modal']").forEach(
        function (button) {
            if (fridgeTriggerInit.has(button)) return;
            fridgeTriggerInit.add(button);
            button.addEventListener("click", function () {
                fillFridgeDialog(button);
                if (nativeCommand) return;
                const dialogId = button.getAttribute("commandfor");
                const dialog = dialogId
                    ? document.getElementById(dialogId)
                    : null;
                if (
                    dialog &&
                    !dialog.open &&
                    typeof dialog.showModal === "function"
                ) {
                    dialog.showModal();
                }
            });
        },
    );
}

window.FoodableApp.onLoad(initFridgeItemModals);
