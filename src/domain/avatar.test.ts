import { describe, expect, test } from "bun:test";
import {
    AVATAR_ALLOWED_TYPES,
    AVATAR_MAX_BYTES,
    AVATAR_MAX_SIDE,
    validateAvatar,
} from "./avatar.js";

// Header-only fixtures: the validator reads the container header, never the
// pixels, so a few real header bytes are enough.

function u32be(n: number): number[] {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function u16be(n: number): number[] {
    return [(n >>> 8) & 255, n & 255];
}
function u32le(n: number): number[] {
    return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}
function ascii(s: string): number[] {
    return [...s].map((c) => c.charCodeAt(0));
}

function png(w: number, h: number): Uint8Array {
    return Uint8Array.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...u32be(13),
        ...ascii("IHDR"),
        ...u32be(w),
        ...u32be(h),
        8,
        6,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ]);
}

function jpeg(w: number, h: number, sof = 0xc0, withApp = true): Uint8Array {
    const app = withApp
        ? [
              0xff,
              0xe0,
              ...u16be(16),
              ...ascii("JFIF"),
              0,
              1,
              1,
              0,
              0,
              1,
              0,
              1,
              0,
              0,
          ]
        : [];
    // A DHT segment (C4) before SOF must not be read as a frame header.
    const dht = [0xff, 0xc4, ...u16be(4), 0, 0];
    return Uint8Array.from([
        0xff,
        0xd8,
        ...app,
        ...dht,
        0xff,
        sof,
        ...u16be(11),
        8,
        ...u16be(h),
        ...u16be(w),
        1,
        1,
        0x11,
        0,
    ]);
}

function riff(chunk: number[]): Uint8Array {
    const body = [...ascii("WEBP"), ...chunk];
    return Uint8Array.from([...ascii("RIFF"), ...u32le(body.length), ...body]);
}
function le24(n: number): number[] {
    return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
}
function webpVp8(w: number, h: number): Uint8Array {
    const payload = [
        0x10,
        0x02,
        0x00,
        0x9d,
        0x01,
        0x2a,
        w & 255,
        (w >>> 8) & 0x3f,
        h & 255,
        (h >>> 8) & 0x3f,
    ];
    return riff([...ascii("VP8 "), ...u32le(payload.length), ...payload]);
}
function webpVp8l(w: number, h: number): Uint8Array {
    const bits = (w - 1) | ((h - 1) << 14);
    const payload = [0x2f, ...u32le(bits >>> 0)];
    return riff([...ascii("VP8L"), ...u32le(payload.length), ...payload]);
}
function webpVp8x(w: number, h: number): Uint8Array {
    const payload = [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)];
    return riff([...ascii("VP8X"), ...u32le(payload.length), ...payload]);
}

describe("validateAvatar", () => {
    test("exports the limits", () => {
        expect(AVATAR_MAX_BYTES).toBe(65536);
        expect(AVATAR_MAX_SIDE).toBe(256);
        expect([...AVATAR_ALLOWED_TYPES]).toEqual([
            "image/jpeg",
            "image/png",
            "image/webp",
        ]);
    });

    test("accepts a 256x256 PNG", () => {
        expect(validateAvatar(png(256, 256))).toEqual({
            ok: true,
            contentType: "image/png",
            width: 256,
            height: 256,
        });
    });

    test("accepts a JPEG with segments before the frame header", () => {
        expect(validateAvatar(jpeg(128, 128))).toEqual({
            ok: true,
            contentType: "image/jpeg",
            width: 128,
            height: 128,
        });
        expect(validateAvatar(jpeg(64, 64, 0xc2, false))).toMatchObject({
            ok: true,
            width: 64,
            height: 64,
        });
    });

    test("accepts WebP of each flavour", () => {
        for (const make of [webpVp8, webpVp8l, webpVp8x]) {
            expect(validateAvatar(make(200, 200))).toEqual({
                ok: true,
                contentType: "image/webp",
                width: 200,
                height: 200,
            });
        }
    });

    test("accepts 1x1", () => {
        expect(validateAvatar(png(1, 1))).toMatchObject({ ok: true });
        expect(validateAvatar(webpVp8l(1, 1))).toMatchObject({ ok: true });
    });

    test("refuses an image over 256 on a side", () => {
        const r = validateAvatar(png(512, 512));
        expect(r).toMatchObject({ ok: false, reason: "too_large_dimensions" });
        expect(validateAvatar(webpVp8x(257, 257))).toMatchObject({
            ok: false,
            reason: "too_large_dimensions",
        });
    });

    test("refuses a non-square image", () => {
        expect(validateAvatar(png(200, 100))).toMatchObject({
            ok: false,
            reason: "not_square",
        });
        expect(validateAvatar(jpeg(100, 200))).toMatchObject({
            ok: false,
            reason: "not_square",
        });
    });

    test("refuses zero dimensions", () => {
        expect(validateAvatar(png(0, 0))).toMatchObject({ ok: false });
    });

    test("refuses more than 64 KB", () => {
        const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
        big.set(png(64, 64));
        expect(validateAvatar(big)).toMatchObject({
            ok: false,
            reason: "too_large_bytes",
        });
        const exactly = new Uint8Array(AVATAR_MAX_BYTES);
        exactly.set(png(64, 64));
        expect(validateAvatar(exactly)).toMatchObject({ ok: true });
    });

    test("refuses empty input", () => {
        expect(validateAvatar(new Uint8Array(0))).toMatchObject({
            ok: false,
            reason: "empty",
        });
    });

    test("refuses GIF, SVG, BMP and garbage as an unsupported type", () => {
        const gif = Uint8Array.from([...ascii("GIF89a"), 1, 0, 1, 0, 0, 0, 0]);
        const svg = new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        );
        const bmp = Uint8Array.from([...ascii("BM"), ...new Array(30).fill(0)]);
        const junk = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        for (const bytes of [gif, svg, bmp, junk]) {
            expect(validateAvatar(bytes)).toMatchObject({
                ok: false,
                reason: "unsupported_type",
            });
        }
    });

    test("refuses truncated headers without throwing", () => {
        const cases = [
            png(64, 64).slice(0, 20),
            png(64, 64).slice(0, 8),
            jpeg(64, 64).slice(0, 12),
            Uint8Array.from([0xff, 0xd8]),
            Uint8Array.from([0xff, 0xd8, 0xff]),
            webpVp8(64, 64).slice(0, 20),
            webpVp8x(64, 64).slice(0, 25),
            Uint8Array.from(ascii("RIFF")),
        ];
        for (const bytes of cases) {
            const r = validateAvatar(bytes);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
        }
    });

    test("reads the type from the bytes, not a name", () => {
        // The caller may have called this file avatar.jpg; only bytes count.
        expect(validateAvatar(png(32, 32))).toMatchObject({
            ok: true,
            contentType: "image/png",
        });
    });
});
