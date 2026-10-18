import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** POST routes that return 200 HTML on success must opt forms out of Turbo. */
const POST_200_HTML_SUCCESS: { route: string; turboFalse: true }[] = [
    { route: "/settings/household/rotate-token", turboFalse: true },
];

test("POST 200-success forms opt out of Turbo Drive", () => {
    const household = readFileSync(
        join(import.meta.dir, "pages/household.ts"),
        "utf8",
    );
    for (const { route } of POST_200_HTML_SUCCESS) {
        expect(household, route).toContain(route);
        expect(household, route).toContain("turboFalse: true");
    }
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
