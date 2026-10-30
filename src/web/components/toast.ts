import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { escapeHtml } from "../../html.js";
import { TOASTS, type ToastKey, type ToastKind } from "../../copy/toasts.js";

export const TOAST_COOKIE = "foodable_toast";
const FLASH_MAX_AGE = 60;
const MAX_PARAMS = 4;
const MAX_PARAM_KEY_LEN = 16;
const MAX_PARAM_VAL_LEN = 80;
const MAX_ENCODED_LEN = 512;

export type ToastParams = Record<string, string | number>;

export type ToastFlash = {
    key: ToastKey;
    params?: ToastParams;
};

function placeholderNames(text: string): Set<string> {
    const names = new Set<string>();
    for (const match of text.matchAll(/\{([a-z_][a-z0-9_]*)\}/gi)) {
        if (match[1]) names.add(match[1]);
    }
    return names;
}

function sanitizeParams(
    key: ToastKey,
    params: ToastParams | undefined,
): ToastParams | undefined {
    if (!params) return undefined;
    const allowed = placeholderNames(TOASTS[key].text);
    if (allowed.size === 0) return undefined;
    const out: ToastParams = {};
    let count = 0;
    for (const [rawKey, rawVal] of Object.entries(params)) {
        if (count >= MAX_PARAMS) break;
        if (rawKey.length > MAX_PARAM_KEY_LEN || !allowed.has(rawKey)) continue;
        if (typeof rawVal === "number") {
            if (!Number.isFinite(rawVal)) continue;
            out[rawKey] = rawVal;
            count++;
            continue;
        }
        if (typeof rawVal !== "string") continue;
        const val = rawVal.trim();
        if (!val || val.length > MAX_PARAM_VAL_LEN) continue;
        out[rawKey] = val;
        count++;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

export function encodeToastFlash(flash: ToastFlash): string | null {
    if (!(flash.key in TOASTS)) return null;
    const params = sanitizeParams(flash.key, flash.params);
    const payload = params ? { k: flash.key, p: params } : { k: flash.key };
    const json = JSON.stringify(payload);
    if (json.length > MAX_ENCODED_LEN) return null;
    return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeToastFlash(
    encoded: string | undefined,
): ToastFlash | null {
    if (!encoded || encoded.length > MAX_ENCODED_LEN) return null;
    let parsed: unknown;
    try {
        const json = Buffer.from(encoded, "base64url").toString("utf8");
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const key = (parsed as { k?: unknown }).k;
    if (typeof key !== "string" || !(key in TOASTS)) return null;
    const toastKey = key as ToastKey;
    const rawParams = (parsed as { p?: unknown }).p;
    if (rawParams == null) return { key: toastKey };
    if (typeof rawParams !== "object" || Array.isArray(rawParams)) return null;
    const params: ToastParams = {};
    for (const [k, v] of Object.entries(rawParams)) {
        if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
        else if (typeof v === "string") params[k] = v;
        else return null;
    }
    const sanitized = sanitizeParams(toastKey, params);
    return sanitized ? { key: toastKey, params: sanitized } : { key: toastKey };
}

export function formatToastText(key: ToastKey, params?: ToastParams): string {
    const entry = TOASTS[key];
    let text: string = entry.text;
    const allowed = placeholderNames(entry.text);
    if (params && allowed.size > 0) {
        for (const name of allowed) {
            const raw = params[name];
            if (raw == null) continue;
            text = text.replaceAll(`{${name}}`, String(raw));
        }
    }
    return text;
}

export function toastKindForKey(key: ToastKey): ToastKind {
    return TOASTS[key].kind;
}

function requestSecure(c: Context): boolean {
    return (
        c.req.header("x-forwarded-proto") === "https" ||
        new URL(c.req.url).protocol === "https:"
    );
}

export function toastSetCookieHeader(value: string, secure: boolean): string {
    const parts = [
        `${TOAST_COOKIE}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${FLASH_MAX_AGE}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

export function toastClearCookieHeader(secure: boolean): string {
    const parts = [
        `${TOAST_COOKIE}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

export function readToastCookie(
    cookieHeader: string | undefined,
): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(
        new RegExp(`(?:^|;\\s*)${TOAST_COOKIE}=([^;]+)`),
    );
    if (!match?.[1]) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return null;
    }
}

export function redirectWithToast(
    c: Context,
    path: string,
    key: ToastKey,
    params?: ToastParams,
): Response {
    const encoded = encodeToastFlash({ key, params });
    if (encoded) {
        c.header("Set-Cookie", toastSetCookieHeader(encoded, requestSecure(c)));
    }
    return c.redirect(path, 303);
}

export function toastSeedElement(kind: ToastKind, text: string): string {
    return `<div id="toast-seed" hidden data-turbo-temporary data-toast-kind="${kind}" data-toast-text="${escapeHtml(text)}"></div>`;
}

export const flashToastMiddleware = createMiddleware(async (c, next) => {
    await next();
    if (c.req.method !== "GET") return;
    if (c.res.status !== 200) return;
    const contentType = c.res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return;

    const body = await c.res.text();
    const headers = new Headers(c.res.headers);

    function respond(html: string, clearCookie: boolean): void {
        if (clearCookie) {
            headers.append(
                "Set-Cookie",
                toastClearCookieHeader(requestSecure(c)),
            );
        }
        c.res = new Response(html, {
            status: c.res.status,
            statusText: c.res.statusText,
            headers,
        });
    }

    if (!body.includes('id="toast-region"')) {
        respond(body, false);
        return;
    }

    const raw = readToastCookie(c.req.header("cookie"));
    const flash = raw ? decodeToastFlash(raw) : null;

    if (!flash) {
        respond(body, Boolean(raw));
        return;
    }

    const kind = toastKindForKey(flash.key);
    const text = formatToastText(flash.key, flash.params);
    const seed = toastSeedElement(kind, text);
    const injected = body.includes("</body>")
        ? body.replace("</body>", `${seed}\n</body>`)
        : body + seed;

    respond(injected, true);
});
