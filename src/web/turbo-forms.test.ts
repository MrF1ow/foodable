import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
