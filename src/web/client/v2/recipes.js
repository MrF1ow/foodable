// Recipes list: paste a link in search → POST /recipes/import.
const searchBound = new WeakSet();
let addLinkBound = false;

function activeSearchInput(form) {
    const phone = form.querySelector(".fd-recipes-search-input--phone");
    const desk = form.querySelector(".fd-recipes-search-input--desk");
    if (!phone) return form.querySelector(".fd-recipes-search-input");
    const wide = matchMedia("(min-width: 1024px)").matches;
    if (wide && desk) {
        desk.disabled = false;
        desk.setAttribute("name", "q");
        phone.disabled = true;
        phone.removeAttribute("name");
        if (phone.value && !desk.value) desk.value = phone.value;
        return desk;
    }
    phone.disabled = false;
    phone.setAttribute("name", "q");
    if (desk) {
        desk.disabled = true;
        desk.removeAttribute("name");
        if (desk.value && !phone.value) phone.value = desk.value;
    }
    return phone;
}

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
    const importForm = root.querySelector("[data-fd-recipes-import]");
    const importUrl = importForm?.querySelector("[name=url]");
    if (!(importForm && importUrl)) return;
    searchBound.add(searchForm);
    const syncInputs = () => activeSearchInput(searchForm);
    syncInputs();
    matchMedia("(min-width: 1024px)").addEventListener("change", syncInputs);
    searchForm.addEventListener("submit", (event) => {
        const input = activeSearchInput(searchForm);
        const value = input.value.trim();
        if (!value || !/^https?:\/\//i.test(value)) return;
        event.preventDefault();
        importUrl.value = value;
        importForm.requestSubmit();
    });
});
