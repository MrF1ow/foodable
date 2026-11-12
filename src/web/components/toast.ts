import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { escapeHtml } from "../../html.js";
import { TOASTS, type ToastKey, type ToastKind } from "../../copy/toasts.js";

export const TOAST_COOKIE = "foodable_toast";
/** POST targets allowed from an unsigned flash action cookie. */
export const TOAST_ACTION_PATH_ALLOWLIST = new Set(["/meals/undo"]);
const FLASH_MAX_AGE = 60;
const MAX_PARAMS = 4;
const MAX_PARAM_KEY_LEN = 16;
const MAX_PARAM_VAL_LEN = 80;
const MAX_ENCODED_LEN = 512;

export type ToastParams = Record<string, string | number>;

export type ToastAction = {
    label: string;
    action: string;
    fields?: Record<string, string>;
};

export type ToastFlash = {
    key: ToastKey;
    params?: ToastParams;
    dismissMs?: number;
    action?: ToastAction;
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
    const payload: Record<string, unknown> = { k: flash.key };
    if (params) payload.p = params;
    if (flash.dismissMs != null) payload.d = flash.dismissMs;
    if (flash.action) payload.a = flash.action;
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
    let sanitized: ToastParams | undefined;
    if (rawParams != null) {
        if (typeof rawParams !== "object" || Array.isArray(rawParams))
            return null;
        const params: ToastParams = {};
        for (const [k, v] of Object.entries(rawParams)) {
            if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
            else if (typeof v === "string") params[k] = v;
            else return null;
        }
        sanitized = sanitizeParams(toastKey, params);
    }
    const dismissRaw = (parsed as { d?: unknown }).d;
    const dismissMs =
        typeof dismissRaw === "number" && Number.isFinite(dismissRaw)
            ? dismissRaw
            : undefined;
    const actionRaw = (parsed as { a?: unknown }).a;
    let action: ToastAction | undefined;
    if (
        actionRaw &&
        typeof actionRaw === "object" &&
        !Array.isArray(actionRaw)
    ) {
        const label = (actionRaw as { label?: unknown }).label;
        const actionPath = (actionRaw as { action?: unknown }).action;
        if (
            typeof label === "string" &&
            typeof actionPath === "string" &&
            TOAST_ACTION_PATH_ALLOWLIST.has(actionPath)
        ) {
            const fieldsRaw = (actionRaw as { fields?: unknown }).fields;
            const fields: Record<string, string> = {};
            if (
                fieldsRaw &&
                typeof fieldsRaw === "object" &&
                !Array.isArray(fieldsRaw)
            ) {
                for (const [k, v] of Object.entries(fieldsRaw)) {
                    if (typeof v === "string") fields[k] = v;
                }
            }
            action = {
                label,
                action: actionPath,
                fields: Object.keys(fields).length > 0 ? fields : undefined,
            };
        }
    }
    const base =
        sanitized != null
            ? { key: toastKey, params: sanitized }
            : { key: toastKey };
    return {
        ...base,
        ...(dismissMs != null ? { dismissMs } : {}),
        ...(action ? { action } : {}),
    };
}

export function formatToastText(key: ToastKey, params?: ToastParams): string {
    const entry = TOASTS[key];
    let text: string = entry.text;
    const allowed = placeholderNames(entry.text);
    if (params && allowed.size > 0) {
        for (const name of allowed) {
            const raw = params[name];
            if (raw == null) continue;
            // A function replacement, so a `$` in a name is not a pattern.
            text = text.replaceAll(`{${name}}`, () => String(raw));
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
    opts?: { dismissMs?: number; action?: ToastAction },
): Response {
    const encoded = encodeToastFlash({
        key,
        params,
        dismissMs: opts?.dismissMs,
        action: opts?.action,
    });
    if (encoded) {
        c.header(
            "Set-Cookie",
            toastSetCookieHeader(encoded, requestSecure(c)),
            {
                append: true,
            },
        );
    }
    return c.redirect(path, 303);
}

function encodeToastAction(action: ToastAction | undefined): string {
    if (!action) return "";
    const fields = action.fields
        ? Object.entries(action.fields)
              .map(
                  ([k, v]) =>
                      `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
              )
              .join("")
        : "";
    return `<form class="toast-action" method="post" action="${escapeHtml(action.action)}">${fields}<button type="submit" class="toast-action__btn">${escapeHtml(action.label)}</button></form>`;
}

export function toastSeedElement(
    kind: ToastKind,
    text: string,
    opts?: { dismissMs?: number; action?: ToastAction },
): string {
    const dismiss =
        opts?.dismissMs != null
            ? ` data-toast-dismiss-ms="${opts.dismissMs}"`
            : "";
    const action = opts?.action ? ` data-toast-has-action="1"` : "";
    return `<div id="toast-seed" hidden data-turbo-temporary data-toast-kind="${kind}" data-toast-text="${escapeHtml(text)}"${dismiss}${action}>${encodeToastAction(opts?.action)}</div>`;
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
    const seed = toastSeedElement(kind, text, {
        dismissMs: flash.dismissMs,
        action: flash.action,
    });
    const injected = body.includes("</body>")
        ? // A function replacement: the seed carries the toast text, and a
          // string replacement would read a `$` in it as a pattern that pastes
          // the page back in.
          body.replace("</body>", () => `${seed}\n</body>`)
        : body + seed;

    respond(injected, true);
});
