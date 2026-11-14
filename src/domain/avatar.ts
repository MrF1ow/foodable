// Profile pictures: what a member may upload. The type comes from the file's
// own magic bytes, never from a name or a client-sent header, and the size is
// read from the container header. Nothing here decodes pixels, so there is no
// image library on the server; the browser downsizes before it uploads and
// this is the check that the result is what it claims to be.

export const AVATAR_MAX_BYTES = 65536;
export const AVATAR_MAX_SIDE = 256;
export const AVATAR_ALLOWED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
] as const;

export type AvatarContentType = (typeof AVATAR_ALLOWED_TYPES)[number];

export type AvatarRefusal =
    | "empty"
    | "too_large_bytes"
    | "unsupported_type"
    | "malformed"
    | "not_square"
    | "too_large_dimensions";

export type AvatarCheck =
    | {
          ok: true;
          contentType: AvatarContentType;
          width: number;
          height: number;
      }
    | { ok: false; reason: AvatarRefusal; message: string };

const MESSAGES: Record<AvatarRefusal, string> = {
    empty: "Choose a picture to upload.",
    too_large_bytes: "Pictures must be 64 KB or smaller.",
    unsupported_type: "Use a JPEG, PNG or WebP picture.",
    malformed: "That picture could not be read. Try another one.",
    not_square: "Pictures must be square.",
    too_large_dimensions: "Pictures must be 256 by 256 pixels or smaller.",
};

function refuse(reason: AvatarRefusal): AvatarCheck {
    return { ok: false, reason, message: MESSAGES[reason] };
}

type Size = { width: number; height: number };

function u16be(b: Uint8Array, i: number): number {
    return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
    return (
        ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0
    );
}
function u32le(b: Uint8Array, i: number): number {
    return (
        (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0
    );
}
function le24(b: Uint8Array, i: number): number {
    return b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
}
function tag(b: Uint8Array, i: number, text: string): boolean {
    if (i + text.length > b.length) return false;
    for (let k = 0; k < text.length; k++) {
        if (b[i + k] !== text.charCodeAt(k)) return false;
    }
    return true;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array): boolean {
    return PNG_SIGNATURE.every((v, i) => b[i] === v);
}
function isJpeg(b: Uint8Array): boolean {
    return b.length >= 2 && b[0] === 0xff && b[1] === 0xd8;
}
function isWebp(b: Uint8Array): boolean {
    return tag(b, 0, "RIFF") && tag(b, 8, "WEBP");
}

function pngSize(b: Uint8Array): Size | null {
    // 8 signature + 4 length + "IHDR" + width + height.
    if (b.length < 24 || !tag(b, 12, "IHDR")) return null;
    return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): Size | null {
    let i = 2;
    while (i < b.length) {
        // Skip fill bytes, then read the marker.
        if (b[i] !== 0xff) return null;
        while (i < b.length && b[i] === 0xff) i++;
        if (i >= b.length) return null;
        const marker = b[i]!;
        i++;
        // Markers with no length: stuffed zero, RSTn, SOI, TEM.
        if (
            marker === 0x00 ||
            marker === 0x01 ||
            (marker >= 0xd0 && marker <= 0xd8)
        ) {
            continue;
        }
        // Start of scan or end of image before any frame header.
        if (marker === 0xd9 || marker === 0xda) return null;
        if (i + 2 > b.length) return null;
        const length = u16be(b, i);
        if (length < 2) return null;
        const isFrame =
            marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc;
        if (isFrame) {
            // length(2) precision(1) height(2) width(2)
            if (i + 7 > b.length) return null;
            return { height: u16be(b, i + 3), width: u16be(b, i + 5) };
        }
        i += length;
    }
    return null;
}

function webpSize(b: Uint8Array): Size | null {
    // RIFF(4) size(4) WEBP(4) fourcc(4) chunkSize(4) payload...
    if (b.length < 20) return null;
    const payload = 20;
    if (tag(b, 12, "VP8 ")) {
        // frame tag (3), start code 9d 01 2a, then 14-bit width and height.
        if (b.length < payload + 10) return null;
        if (b[payload + 3] !== 0x9d || b[payload + 4] !== 0x01) return null;
        if (b[payload + 5] !== 0x2a) return null;
        return {
            width: u16le14(b, payload + 6),
            height: u16le14(b, payload + 8),
        };
    }
    if (tag(b, 12, "VP8L")) {
        if (b.length < payload + 5 || b[payload] !== 0x2f) return null;
        const bits = u32le(b, payload + 1);
        return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1,
        };
    }
    if (tag(b, 12, "VP8X")) {
        // flags(4) then 24-bit width-1 and height-1.
        if (b.length < payload + 10) return null;
        return {
            width: le24(b, payload + 4) + 1,
            height: le24(b, payload + 7) + 1,
        };
    }
    return null;
}

function u16le14(b: Uint8Array, i: number): number {
    return (b[i]! | (b[i + 1]! << 8)) & 0x3fff;
}

/** Checks an uploaded picture against the rules; never throws. */
export function validateAvatar(bytes: Uint8Array): AvatarCheck {
    if (bytes.length === 0) return refuse("empty");
    if (bytes.length > AVATAR_MAX_BYTES) return refuse("too_large_bytes");

    let contentType: AvatarContentType;
    let size: Size | null;
    if (isPng(bytes)) {
        contentType = "image/png";
        size = pngSize(bytes);
    } else if (isJpeg(bytes)) {
        contentType = "image/jpeg";
        size = jpegSize(bytes);
    } else if (isWebp(bytes)) {
        contentType = "image/webp";
        size = webpSize(bytes);
    } else {
        return refuse("unsupported_type");
    }

    if (!size || size.width <= 0 || size.height <= 0) {
        return refuse("malformed");
    }
    if (size.width !== size.height) return refuse("not_square");
    if (size.width > AVATAR_MAX_SIDE) return refuse("too_large_dimensions");
    return { ok: true, contentType, width: size.width, height: size.height };
}
