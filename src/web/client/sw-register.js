window.FoodableApp.onLoad(function () {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(function (err) {
            console.error(err);
        });
});
