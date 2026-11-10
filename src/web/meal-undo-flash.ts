import type { Context } from "hono";
import {
    UNDO_COOKIE,
    UNDO_COOKIE_LINE_MAX_BYTES,
    type UndoFlash,
} from "../domain/meal-undo.js";

export const UNDO_SNAPSHOT_COOKIE = "foodable_undo_snap";

const UNDO_COOKIE_MAX_AGE = 60 * 10;

function requestSecure(c: Context): boolean {
    return (
        c.req.header("x-forwarded-proto") === "https" ||
        new URL(c.req.url).protocol === "https:"
    );
}

export function undoCookieLine(
    name: string,
    value: string,
    secure: boolean,
): string {
    return [
        `${name}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${UNDO_COOKIE_MAX_AGE}`,
        secure ? "Secure" : "",
    ]
        .filter(Boolean)
        .join("; ");
}

export function undoCookieLineBytes(
    name: string,
    value: string,
    secure: boolean,
): number {
    return Buffer.byteLength(undoCookieLine(name, value, secure), "utf8");
}

export function undoCookiesFit(flash: UndoFlash, secure: boolean): boolean {
    const tokenBytes = undoCookieLineBytes(UNDO_COOKIE, flash.token, secure);
    const snapBytes = undoCookieLineBytes(
        UNDO_SNAPSHOT_COOKIE,
        flash.snapshotPayload,
        secure,
    );
    return (
        tokenBytes <= UNDO_COOKIE_LINE_MAX_BYTES &&
        snapBytes <= UNDO_COOKIE_LINE_MAX_BYTES
    );
}

export function undoSetCookieHeaders(
    flash: UndoFlash,
    secure: boolean,
): string[] {
    if (!undoCookiesFit(flash, secure)) {
        return [];
    }
    return [
        undoCookieLine(UNDO_COOKIE, flash.token, secure),
        undoCookieLine(UNDO_SNAPSHOT_COOKIE, flash.snapshotPayload, secure),
    ];
}

export function undoClearCookieHeaders(secure: boolean): string[] {
    const common = (name: string) =>
        [
            `${name}=`,
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            "Max-Age=0",
            secure ? "Secure" : "",
        ]
            .filter(Boolean)
            .join("; ");
    return [common(UNDO_COOKIE), common(UNDO_SNAPSHOT_COOKIE)];
}

export function readUndoCookies(cookieHeader: string | undefined): {
    token: string | null;
    snapshotPayload: string | null;
} {
    if (!cookieHeader) return { token: null, snapshotPayload: null };
    const read = (name: string) => {
        const match = cookieHeader.match(
            new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
        );
        if (!match?.[1]) return null;
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return null;
        }
    };
    return {
        token: read(UNDO_COOKIE),
        snapshotPayload: read(UNDO_SNAPSHOT_COOKIE),
    };
}
