// Shared dialogs. A trigger carries data-fill-action, data-fill-title,
// data-fill-message, and data-fill-field-<name>. This copies them onto the
// one dialog before it opens. Loaded before modal.js: the command event
// fires before showModal and before modal.js focuses the first field. The
// click listener covers browsers without command invokers.
const dialogFillInit = new WeakSet();
const dialogFillTriggerInit = new WeakSet();

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

function isFillTrigger(el) {
    if (!el || typeof el.hasAttribute !== "function") return false;
    if (
        el.hasAttribute("data-fill-action") ||
        el.hasAttribute("data-fill-title") ||
        el.hasAttribute("data-fill-message")
    ) {
        return true;
    }
    const listed = el.attributes;
    if (!listed) return false;
    for (let i = 0; i < listed.length; i++) {
        const name = listed[i].name || "";
        if (name.indexOf("data-fill-field-") === 0) return true;
    }
    return false;
}

function fieldNameOk(name) {
    return /^[\w.-]+$/.test(name);
}

function readFillFields(trigger) {
    const fields = [];
    const listed = trigger.attributes;
    if (!listed) return fields;
    for (let i = 0; i < listed.length; i++) {
        const name = listed[i].name || "";
        if (name.indexOf("data-fill-field-") !== 0) continue;
        const field = name.slice("data-fill-field-".length);
        if (!fieldNameOk(field)) continue;
        fields.push({ name: field, value: listed[i].value });
    }
    return fields;
}

function controlsNamed(dialog, name) {
    return dialog.querySelectorAll('[name="' + name + '"]');
}

function checkboxGroup(nodes) {
    let count = 0;
    nodes.forEach(function (node) {
        if (String(node.type || "").toLowerCase() === "checkbox") count += 1;
    });
    return count > 1;
}

function checkboxWanted(raw, control, group) {
    if (!group) return raw === "1" || raw === "true";
    const parts = raw.split(",");
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].trim() === control.value) return true;
    }
    return false;
}

function controlWouldChange(control, raw, group) {
    const type = String(control.type || "").toLowerCase();
    if (type === "checkbox") {
        return !!control.checked !== checkboxWanted(raw, control, group);
    }
    if (type === "radio") return !!control.checked !== (control.value === raw);
    const current = control.value == null ? "" : String(control.value);
    return current !== raw;
}

function applyControl(control, raw, group) {
    const type = String(control.type || "").toLowerCase();
    if (type === "checkbox") {
        control.checked = checkboxWanted(raw, control, group);
        return;
    }
    if (type === "radio") {
        control.checked = control.value === raw;
        return;
    }
    control.value = raw;
    if (String(control.tagName || "").toUpperCase() !== "SELECT") return;
    // A stored value missing from the list falls back to the first option,
    // as the server-rendered select does, rather than blank.
    if (
        typeof control.selectedIndex === "number" &&
        control.selectedIndex < 0 &&
        control.options &&
        control.options.length > 0
    ) {
        control.selectedIndex = 0;
    }
}

function fillDialog(trigger) {
    const dialogId = trigger.getAttribute("commandfor");
    if (!dialogId) return;
    const dialog = document.getElementById(dialogId);
    if (!dialog) return;
    const forms = dialog.querySelectorAll("form");
    const action = trigger.hasAttribute("data-fill-action")
        ? attr(trigger, "data-fill-action")
        : null;
    const fields = readFillFields(trigger);
    let changed = false;
    if (action != null) {
        forms.forEach(function (form) {
            if (form.getAttribute("action") !== action) changed = true;
        });
    }
    fields.forEach(function (field) {
        const nodes = controlsNamed(dialog, field.name);
        const group = checkboxGroup(nodes);
        nodes.forEach(function (node) {
            if (controlWouldChange(node, field.value, group)) changed = true;
        });
    });
    // A new target drops the previous item's error. The same target keeps a
    // server-rendered banner (the page was just re-rendered with it).
    if (changed) clearErrorBanners(dialog);
    if (action != null) {
        forms.forEach(function (form) {
            form.setAttribute("action", action);
        });
    }
    fields.forEach(function (field) {
        const nodes = controlsNamed(dialog, field.name);
        const group = checkboxGroup(nodes);
        nodes.forEach(function (node) {
            applyControl(node, field.value, group);
        });
    });
    if (trigger.hasAttribute("data-fill-title")) {
        const title = dialog.querySelector(".modal-title");
        if (title) title.textContent = attr(trigger, "data-fill-title");
    }
    if (trigger.hasAttribute("data-fill-message")) {
        const message = dialog.querySelector(".modal-message");
        if (message) message.textContent = attr(trigger, "data-fill-message");
    }
    dialog.querySelectorAll('button[type="submit"]').forEach(function (button) {
        button.disabled = false;
    });
    if (
        typeof dialog.dispatchEvent === "function" &&
        typeof CustomEvent === "function"
    ) {
        dialog.dispatchEvent(
            new CustomEvent("foodable:dialog-fill", { bubbles: true }),
        );
    }
}

function initDialogFill(root) {
    root.querySelectorAll("dialog").forEach(function (dialog) {
        if (dialogFillInit.has(dialog)) return;
        dialogFillInit.add(dialog);
        dialog.addEventListener("command", function (event) {
            const source = event.source;
            if (!isFillTrigger(source)) return;
            fillDialog(source);
        });
    });
    const nativeCommand = commandInvokers();
    root.querySelectorAll("button[command='show-modal']").forEach(
        function (button) {
            if (!isFillTrigger(button)) return;
            if (dialogFillTriggerInit.has(button)) return;
            dialogFillTriggerInit.add(button);
            button.addEventListener("click", function () {
                fillDialog(button);
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

window.FoodableApp.onLoad(initDialogFill);
