import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    ROTATE_TOKEN_PATH,
    rotateTokenSheet,
} from "./pages/v2/settings-household-token.js";

/** POST routes that return 200 HTML on success must opt their forms out of Turbo. */
const POST_200_HTML_SUCCESS: { route: string; file: string }[] = [
    {
        route: "/settings/household/rotate-token",
        file: "pages/v2/settings-household-token.ts",
    },
];

test("POST 200-success forms opt out of Turbo Drive", () => {
    for (const { route, file } of POST_200_HTML_SUCCESS) {
        const source = readFileSync(join(import.meta.dir, file), "utf8");
        expect(source, route).toContain(route);
        expect(source, route).toContain('data-turbo="false"');
    }
});

test("the rotate confirm's own form opts out of Turbo", () => {
    const html = rotateTokenSheet();
    const form = html.match(
        new RegExp(`<form[^>]*action="${ROTATE_TOKEN_PATH}"[^>]*>`),
    );
    expect(form).not.toBeNull();
    expect(form![0]).toContain('data-turbo="false"');
});

test("logout and login approve opt out of Turbo", () => {
    const shell = readFileSync(join(import.meta.dir, "shell.ts"), "utf8");
    expect(shell).toContain('href="/logout" data-turbo="false"');
    const login = readFileSync(
        join(import.meta.dir, "../../public/login.html"),
        "utf8",
    );
    expect(login).toContain('action="/approve"');
    expect(login).toContain('data-turbo="false"');
});
