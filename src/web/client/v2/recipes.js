// Recipes list: paste a link in search → POST /recipes/import (ui-v2).
const searchBound = new WeakSet();
let addLinkBound = false;

FoodableApp.onLoad((root) => {
    // On document, once: survives Turbo visits and morphs.
    if (!addLinkBound) {
        addLinkBound = true;
        document.addEventListener("click", (e) => {
            if (!e.target.closest?.("[data-fd-recipes-add-link]")) return;
            const d = document.querySelector(".fd-recipes-import-link");
            const url = d?.querySelector("[name=url]");
            if (!url) return;
            d.open = true;
            url.focus();
        });
    }
    const searchForm = root.querySelector("[data-fd-recipes-search]");
    if (!searchForm || searchBound.has(searchForm)) return;
    const input = searchForm.querySelector(".fd-recipes-search-input");
    const importForm = root.querySelector("[data-fd-recipes-import]");
    const importUrl = importForm?.querySelector("[name=url]");
    if (!(input && importForm && importUrl)) return;
    searchBound.add(searchForm);
    searchForm.addEventListener("submit", (event) => {
        const value = input.value.trim();
        if (!value || !/^https?:\/\//i.test(value)) return;
        event.preventDefault();
        importUrl.value = value;
        importForm.requestSubmit();
    });
});
