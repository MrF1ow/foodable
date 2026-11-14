// Settings › Account › Photo: shrink the chosen picture in the browser before
// it is posted. On submit it centre-crops a square, draws it to 256 by 256,
// encodes WebP (JPEG where the browser cannot) at a quality that fits 64 KB,
// swaps that file into the input and submits again. Anything it cannot do
// (undecodable file, no DataTransfer) posts the original: the server checks
// everything again and says what is wrong. Idempotent per form (a WeakSet).

const SIDE = 256;
const MAX_BYTES = 65536;
const QUALITIES = [0.85, 0.7, 0.55, 0.4];
const TYPES = [
    ["image/webp", "photo.webp"],
    ["image/jpeg", "photo.jpg"],
];

const bound = new WeakSet();
const resized = new WeakSet();
const inFlight = new WeakSet();

function decode(file) {
    if (typeof createImageBitmap === "function") {
        // Honour the photo's rotation; an older browser that rejects the
        // option still decodes the file as it is.
        return createImageBitmap(file, {
            imageOrientation: "from-image",
        }).catch(() => createImageBitmap(file));
    }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({
                width: img.naturalWidth,
                height: img.naturalHeight,
                img,
            });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("undecodable"));
        };
        img.src = url;
    });
}

function toBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function shrink(file) {
    const bitmap = await decode(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = SIDE;
    canvas.height = SIDE;
    const ctx = canvas.getContext("2d");
    // White underneath: a see-through picture would turn black as a JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SIDE, SIDE);
    ctx.drawImage(
        bitmap.img || bitmap,
        Math.floor((bitmap.width - side) / 2),
        Math.floor((bitmap.height - side) / 2),
        side,
        side,
        0,
        0,
        SIDE,
        SIDE,
    );
    if (bitmap.close) bitmap.close();
    for (const [type, name] of TYPES) {
        for (const quality of QUALITIES) {
            const blob = await toBlob(canvas, type, quality);
            // A browser that cannot encode the type answers with a PNG.
            if (!blob || blob.type !== type) break;
            if (blob.size <= MAX_BYTES) return new File([blob], name, { type });
        }
    }
    return null;
}

async function resizeAndSubmit(form, input) {
    try {
        if (typeof DataTransfer === "function") {
            const small = await shrink(input.files[0]);
            if (small) {
                const transfer = new DataTransfer();
                transfer.items.add(small);
                input.files = transfer.files;
            }
        }
    } catch (_e) {
        // Post the original; the server refuses it with a clear message.
    }
    inFlight.delete(form);
    resized.add(form);
    form.requestSubmit();
}

function initAvatarUpload(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll("form[data-fd-avatar-upload]").forEach((form) => {
        if (bound.has(form)) return;
        bound.add(form);
        form.addEventListener("submit", (event) => {
            if (resized.has(form)) {
                resized.delete(form);
                return;
            }
            // A second tap while the first is still resizing would post twice.
            if (inFlight.has(form)) {
                event.preventDefault();
                return;
            }
            const input = form.querySelector('input[type="file"]');
            if (!input || !input.files || input.files.length === 0) return;
            event.preventDefault();
            inFlight.add(form);
            resizeAndSubmit(form, input);
        });
    });
}

if (typeof window !== "undefined") {
    if (window.FoodableApp && typeof window.FoodableApp.onLoad === "function") {
        window.FoodableApp.onLoad(initAvatarUpload);
    } else if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                initAvatarUpload(document),
            );
        } else {
            initAvatarUpload(document);
        }
    }
}
