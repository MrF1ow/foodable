import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** POST routes that return 200 HTML on success must opt their forms out of Turbo. */
const POST_200_HTML_SUCCESS: { route: string; file: string }[] = [
    {
        route: "/settings/household/rotate-token",
        file: "pages/v2/settings-household-modals.ts",
    },
];

test("POST 200-success forms opt out of Turbo Drive", () => {
    for (const { route, file } of POST_200_HTML_SUCCESS) {
        const source = readFileSync(join(import.meta.dir, file), "utf8");
        expect(source, route).toContain(route);
        expect(source, route).toContain("turboFalse: true");
    }
});

test("modal forms can opt out of Turbo Drive", () => {
    const ui = readFileSync(join(import.meta.dir, "components/ui.ts"), "utf8");
    expect(ui).toContain('data-turbo="false"');
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
