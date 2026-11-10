// Recipes list: paste a link in search → POST /recipes/import (ui-v2).
const searchBound = new WeakSet();

FoodableApp.onLoad((root) => {
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
