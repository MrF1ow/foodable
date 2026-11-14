// Profile pictures over HTTP, against real Postgres: upload, serve, remove,
// and who can read what.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { getAvatar } from "../../db/avatars.js";
import { setSqlForTests } from "../../db/sql.js";
import { asUser, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { resetFlagsForTests } from "../../flags.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
// The whole-app test below imports src/index.ts, which builds the OAuth router
// at load and needs these; ||= so a real .env still wins.
process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const pgAvailable = await findPgBin();

const app = new Hono();
app.route("/", settingsRoutes);

// Header-only images: the server reads the container header, never pixels.
function u32be(n: number): number[] {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function ascii(s: string): number[] {
    return [...s].map((c) => c.charCodeAt(0));
}
function png(side: number, pad = 0): Uint8Array {
    const head = [
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
        ...u32be(side),
        ...u32be(side),
        8,
        6,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    return Uint8Array.from([...head, ...new Array(pad).fill(7)]);
}
function jpeg(side: number): Uint8Array {
    return Uint8Array.from([
        0xff,
        0xd8,
        0xff,
        0xc0,
        0,
        11,
        8,
        (side >>> 8) & 255,
        side & 255,
        (side >>> 8) & 255,
        side & 255,
        1,
        1,
        0x11,
        0,
    ]);
}
function webp(side: number): Uint8Array {
    const payload = [
        0x10,
        0x02,
        0x00,
        0x9d,
        0x01,
        0x2a,
        side & 255,
        (side >>> 8) & 0x3f,
        side & 255,
        (side >>> 8) & 0x3f,
    ];
    const chunk = [...ascii("VP8 "), payload.length, 0, 0, 0, ...payload];
    const body = [...ascii("WEBP"), ...chunk];
    return Uint8Array.from([...ascii("RIFF"), body.length, 0, 0, 0, ...body]);
}
const SVG = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"></svg>',
);
const GIF = Uint8Array.from([...ascii("GIF89a"), 0, 1, 0, 1, 0, 0, 0]);

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describeDb(pgAvailable !== null, "profile pictures routes", (getCtx) => {
    let ownerId: string;
    let householdId: string;
    let memberId: string;
    let strangerId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId: ownerId, householdId } = await seedHousehold(sql));
        memberId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${memberId}, ${`m-${memberId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${memberId}, ${"member"}, ${"Peer Person"})
        `;
        ({ userId: strangerId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    const stored = (userId: string) =>
        asUser(userId, () => getAvatar(householdId, userId), householdId);

    function upload(
        user: string,
        bytes: Uint8Array,
        opts: {
            type?: string;
            name?: string;
            extra?: Record<string, string>;
        } = {},
    ) {
        const form = new FormData();
        form.set(
            "photo",
            new File([bytes], opts.name ?? "me.png", {
                type: opts.type ?? "image/png",
            }),
        );
        for (const [k, v] of Object.entries(opts.extra ?? {})) form.set(k, v);
        return app.request("http://test/settings/account/photo", {
            method: "POST",
            headers: { cookie: cookie(user) },
            body: form,
        });
    }
    const remove = (user: string, extra = "") =>
        app.request("http://test/settings/account/photo/remove", {
            method: "POST",
            headers: {
                cookie: cookie(user),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: extra,
        });
    const fetchAvatar = (viewer: string, of: string) =>
        app.request(`http://test/avatars/${of}`, {
            headers: { cookie: cookie(viewer) },
        });
    const accountPage = (user: string) =>
        app.request("http://test/settings/account", {
            headers: { cookie: cookie(user) },
        });

    for (const [name, make, type] of [
        ["PNG", () => png(256), "image/png"],
        ["JPEG", () => jpeg(256), "image/jpeg"],
        ["WebP", () => webp(256), "image/webp"],
    ] as const) {
        test(`${name}: upload, then the same bytes come back with safe headers`, async () => {
            const bytes = make();
            const res = await upload(ownerId, bytes, { type });
            expect(res.status).toBe(303);

            const got = await fetchAvatar(ownerId, ownerId);
            expect(got.status).toBe(200);
            expect(got.headers.get("content-type")).toBe(type);
            expect(got.headers.get("x-content-type-options")).toBe("nosniff");
            expect(got.headers.get("cache-control")).toBe(
                "private, max-age=31536000, immutable",
            );
            expect(got.headers.get("etag")).toBeTruthy();
            expect(got.headers.get("content-disposition")).toBe("inline");
            expect(got.headers.get("content-security-policy")).toBe(
                "default-src 'none'; sandbox",
            );
            expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(
                true,
            );
        });
    }

    test("another member of the household can read it; another household cannot", async () => {
        await upload(ownerId, png(256));
        expect((await fetchAvatar(memberId, ownerId)).status).toBe(200);
        expect((await fetchAvatar(strangerId, ownerId)).status).toBe(404);
    });

    test("a member with no picture, and a stranger's id, are both 404", async () => {
        expect((await fetchAvatar(ownerId, memberId)).status).toBe(404);
        expect((await fetchAvatar(ownerId, crypto.randomUUID())).status).toBe(
            404,
        );
        expect((await fetchAvatar(ownerId, "not-a-uuid")).status).toBe(404);
    });

    test("a request without a site session is not served", async () => {
        await upload(ownerId, png(256));
        const res = await app.request(`http://test/avatars/${ownerId}`);
        // The sign-in page, never the picture.
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(res.headers.get("etag")).toBeNull();
    });

    test("the type comes from the bytes, not the declared type or name", async () => {
        const res = await upload(ownerId, png(256), {
            type: "image/jpeg",
            name: "photo.jpg",
        });
        expect(res.status).toBe(303);
        const got = await fetchAvatar(ownerId, ownerId);
        expect(got.headers.get("content-type")).toBe("image/png");
    });

    test("an upload names no one but the signed-in member", async () => {
        const res = await upload(ownerId, png(256), {
            extra: { user_id: memberId, userId: memberId },
        });
        expect(res.status).toBe(303);
        expect((await fetchAvatar(ownerId, ownerId)).status).toBe(200);
        expect((await fetchAvatar(ownerId, memberId)).status).toBe(404);
        // An owner cannot overwrite or remove a member's picture either.
        await upload(memberId, jpeg(256), { type: "image/jpeg" });
        await remove(ownerId, `user_id=${memberId}`);
        expect((await fetchAvatar(ownerId, memberId)).status).toBe(200);
    });

    test("replacing a picture changes the stored bytes", async () => {
        await upload(ownerId, png(256));
        const first = await stored(ownerId);
        await upload(ownerId, jpeg(128), { type: "image/jpeg" });
        const second = await stored(ownerId);
        expect(second?.contentType).toBe("image/jpeg");
        expect(second!.updatedAt.getTime()).toBeGreaterThanOrEqual(
            first!.updatedAt.getTime(),
        );
    });

    const refusals: [string, () => Uint8Array, string][] = [
        ["a 70 KB file", () => png(256, 70 * 1024), "64 KB or smaller"],
        ["an SVG", () => SVG, "JPEG, PNG or WebP"],
        ["a GIF", () => GIF, "JPEG, PNG or WebP"],
        ["a 512 by 512 PNG", () => png(512), "256 by 256"],
        [
            "a rectangle",
            () => jpeg(100).map((b, i) => (i === 7 ? 1 : b)),
            "square",
        ],
    ];
    for (const [what, make, message] of refusals) {
        test(`refuses ${what} in place with 422 and stores nothing`, async () => {
            const res = await upload(ownerId, make());
            expect(res.status).toBe(422);
            const html = await res.text();
            expect(html).toContain(message);
            expect(html).toContain('name="photo"');
            expect(await stored(ownerId)).toBeNull();
        });
    }

    test("an empty file is refused in place with 422", async () => {
        const res = await upload(ownerId, new Uint8Array(0));
        expect(res.status).toBe(422);
        expect(await res.text()).toContain("Choose a picture");
    });

    test("a missing photo field is refused in place with 422", async () => {
        const res = await app.request("http://test/settings/account/photo", {
            method: "POST",
            headers: { cookie: cookie(ownerId) },
            body: new FormData(),
        });
        expect(res.status).toBe(422);
    });

    test("a body over the route limit is refused with 413 HTML before it is read", async () => {
        const res = await upload(ownerId, png(256, 200 * 1024));
        expect(res.status).toBe(413);
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(await res.text()).toContain("64 KB or smaller");
        expect(await stored(ownerId)).toBeNull();
    });

    // The app-wide 1 MB limit sits in front of every route; it has to leave
    // this one to its own, stricter limit, or the person gets bare JSON instead
    // of the Settings page and its message.
    describe("through the whole app (its own body limit in front)", () => {
        const big = 3 * 1024 * 1024;
        const post = async (chunked: boolean) => {
            const { app: wholeApp } = await import("../../index.js");
            const boundary = "----fdtest";
            const head = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="me.png"\r\nContent-Type: image/png\r\n\r\n`;
            const tail = `\r\n--${boundary}--\r\n`;
            const payload = new Uint8Array(
                head.length + big + tail.length,
            ).fill(7);
            payload.set(new TextEncoder().encode(head), 0);
            payload.set(new TextEncoder().encode(tail), head.length + big);
            const headers: Record<string, string> = {
                cookie: cookie(ownerId),
                "content-type": `multipart/form-data; boundary=${boundary}`,
            };
            // A stream body carries no Content-Length, so the limit has to
            // count the bytes as they arrive.
            const body = chunked
                ? new ReadableStream({
                      start(controller) {
                          controller.enqueue(payload);
                          controller.close();
                      },
                  })
                : payload;
            if (!chunked) headers["content-length"] = String(payload.length);
            return wholeApp.request("http://test/settings/account/photo", {
                method: "POST",
                headers,
                body,
            });
        };

        for (const chunked of [false, true]) {
            test(`an over-1 MB upload ${chunked ? "without" : "with"} Content-Length gets the Settings page and the 64 KB message`, async () => {
                const res = await post(chunked);
                expect(res.status).toBe(413);
                expect(res.headers.get("content-type")).toContain("text/html");
                expect(await res.text()).toContain("64 KB or smaller");
                expect(await stored(ownerId)).toBeNull();
            });
        }

        test("any other route still gets the app-wide limit", async () => {
            const { app: wholeApp } = await import("../../index.js");
            const res = await wholeApp.request(
                "http://test/settings/account/photo/remove",
                {
                    method: "POST",
                    headers: {
                        cookie: cookie(ownerId),
                        "content-type": "application/octet-stream",
                        "content-length": String(big),
                    },
                    body: new Uint8Array(big),
                },
            );
            expect(res.status).toBe(413);
            expect(await res.json()).toEqual({ error: "payload_too_large" });
        });
    });

    test("remove deletes the picture and the URL goes 404", async () => {
        await upload(ownerId, png(256));
        const res = await remove(ownerId);
        expect(res.status).toBe(303);
        expect((await fetchAvatar(ownerId, ownerId)).status).toBe(404);
        // Removing again is harmless.
        expect((await remove(ownerId)).status).toBe(303);
    });

    test("Settings > Account shows the control, and Remove only once a picture is set", async () => {
        let html = await (await accountPage(ownerId)).text();
        expect(html).toContain('name="photo"');
        expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
        expect(html).toContain('enctype="multipart/form-data"');
        expect(html).toContain("Change photo");
        expect(html).not.toContain("Remove photo");
        expect(html).not.toContain("<img");

        await upload(ownerId, png(256));
        html = await (await accountPage(ownerId)).text();
        expect(html).toContain("Remove photo");
        expect(html).toContain(`src="/avatars/${ownerId}?v=`);
    });
});
