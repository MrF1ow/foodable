self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    if (event.request.mode !== "navigate") return;
    event.respondWith(
        fetch(event.request).catch(
            () =>
                new Response(
                    '<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Offline</title></head><body><p>You\'re offline. Foodable needs a connection.</p></body></html>',
                    {
                        headers: {
                            "Content-Type": "text/html; charset=utf-8",
                        },
                    },
                ),
        ),
    );
});
