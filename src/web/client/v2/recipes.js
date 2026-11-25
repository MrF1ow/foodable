// Recipes list: the search field. Typing filters the rows on the page (the
// server stays the source on load and on Enter), reads "N of M recipes" in the
// heading and shows the clear X; a pasted recipe link swaps the
// lead icon for the link, shows Go and hides the filter, and Enter or Go posts
// the link to /recipes/import through the page's own import form.
const bound = new WeakSet();

function isLink(text) {
    return /^https?:\/\/\S+$/i.test(String(text ?? "").trim());
}

function bindSearch(form) {
    if (bound.has(form)) return;
    bound.add(form);
    const input = form.querySelector(".fd-search-field__input");
    const box = form.querySelector(".fd-search-field");
    const go = form.querySelector("[data-fd-recipes-import-go]");
    const importForm = document.querySelector("[data-fd-recipes-import]");
    const clearButton = form.querySelector("[data-fd-search-clear]");
    if (!(input instanceof HTMLInputElement) || !box) return;
    const section = document.querySelector("[data-fd-recipes-total]");
    const label = section?.querySelector(".fd-section-header__label");
    const count = section?.querySelector(".fd-section-header__count");
    const total = Number(section?.getAttribute("data-fd-recipes-total"));
    // The heading the server drew, to put back when the field is emptied.
    const headLabel = label ? label.textContent : "";
    const headCount = count ? count.textContent : "";

    function sync() {
        const link = isLink(input.value);
        if (link) box.setAttribute("data-link-detected", "");
        else box.removeAttribute("data-link-detected");
        if (go) go.hidden = !link;
        if (clearButton) clearButton.hidden = input.value === "";
        return link;
    }

    // Typing narrows "All recipes" to "N of M recipes" for the rows left, as
    // the server's answer to Enter does; emptying the field restores it.
    function head(narrowed, shown) {
        if (!label) return;
        if (narrowed && Number.isFinite(total)) {
            label.textContent = `${shown} of ${total} recipes`;
            if (count) count.hidden = true;
        } else {
            label.textContent = headLabel;
            if (count) {
                count.textContent = headCount;
                count.hidden = false;
            }
        }
    }

    function importLink() {
        const url = input.value.trim();
        const target = importForm?.querySelector('input[name="url"]');
        if (!importForm || !target) return;
        target.value = url;
        importForm.requestSubmit();
    }

    input.addEventListener("input", () => {
        const link = sync();
        const text = input.value.trim().toLowerCase();
        let shown = 0;
        for (const row of document.querySelectorAll(".fd-recipes-row")) {
            const title = row.querySelector(".fd-item-row__title");
            row.hidden =
                !link &&
                text !== "" &&
                !(title?.textContent ?? "").toLowerCase().includes(text);
            if (!row.hidden) shown += 1;
        }
        head(!link && text !== "", shown);
    });
    form.addEventListener("submit", (event) => {
        if (!isLink(input.value) || !importForm) return;
        event.preventDefault();
        importLink();
    });
    form.addEventListener("click", (event) => {
        if (!event.target.closest?.("[data-fd-search-clear]")) return;
        input.value = "";
        sync();
        form.requestSubmit();
    });
    sync();
}

FoodableApp.onLoad((root) => {
    for (const form of root.querySelectorAll("[data-fd-recipes-search]")) {
        bindSearch(form);
    }
});
