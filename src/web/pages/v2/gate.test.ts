import { describe, expect, test } from "bun:test";
import {
    createHouseholdGate,
    noHouseholdGate,
    notAllowedGate,
    notFoundGate,
} from "./gate.js";

describe("createHouseholdGate", () => {
    const html = createHouseholdGate();

    test("is the Brand hero and a form posting the two names to the same route", () => {
        expect(html).toContain("fd-brand-hero");
        expect(html).toContain("Name your household");
        expect(html).toContain(
            '<form method="POST" action="/create-household" class="fd-auth__form">',
        );
        for (const name of ["household_name", "display_name"]) {
            const at = html.indexOf(`name="${name}"`);
            expect(at, name).toBeGreaterThan(-1);
            const tag = html.slice(
                html.lastIndexOf("<input", at),
                html.indexOf(">", at),
            );
            expect(tag).toContain("required");
            expect(tag).toContain('maxlength="80"');
        }
        expect(html).toContain(
            '<button type="submit" class="fd-btn fd-btn--primary"',
        );
    });

    test("shows no error until there is one, then in place above the button", () => {
        expect(html).not.toContain("fd-auth__error");
        const withError = createHouseholdGate("Enter a household name.");
        const error = withError.indexOf(
            '<p class="fd-auth__error" role="alert">',
        );
        expect(error).toBeGreaterThan(withError.indexOf('name="display_name"'));
        expect(error).toBeLessThan(withError.indexOf('type="submit"'));
    });
});

describe("createHouseholdGate's way out", () => {
    test("Log out is a Secondary full-load link after the form", () => {
        const html = createHouseholdGate();
        const logout = html.indexOf('href="/logout"');
        expect(logout).toBeGreaterThan(html.indexOf("</form>"));
        const tag = html.slice(html.lastIndexOf("<a", logout), logout + 40);
        expect(tag).toContain('class="fd-btn"');
        expect(tag).not.toContain("fd-btn--primary");
        expect(html).toContain('data-turbo="false"');
    });
});

describe("noHouseholdGate", () => {
    test("says there is no household and offers Log out as a full load", () => {
        const html = noHouseholdGate();
        expect(html).toContain("No household yet");
        expect(html).toContain("Ask the owner for an invite code");
        expect(html).toContain('href="/logout"');
        expect(html).toContain('data-turbo="false"');
        expect(html).not.toContain("<form");
    });
});

describe("notAllowedGate", () => {
    test("a refusal's own words are the caption, escaped, with Go to Today and no Log out", () => {
        const html = notAllowedGate("Only <owners> can.");
        expect(html).toContain("Not allowed");
        expect(html).toContain("Only &lt;owners&gt; can.");
        expect(html).toContain('href="/"');
        expect(html).toContain("Go to Today");
        expect(html).not.toContain("/logout");
        expect(html).not.toContain("No household yet");
    });

    test("without a message it says so plainly", () => {
        expect(notAllowedGate()).toContain(
            "You don't have access to this page.",
        );
    });
});

describe("notFoundGate", () => {
    test("names what is missing and goes to Today", () => {
        const html = notFoundGate("Store");
        expect(html).toContain("Store not found");
        expect(html).toContain("It may have moved or been deleted");
        expect(html).toContain('href="/"');
        expect(html).toContain("Go to Today");
        expect(html).not.toContain("/logout");
    });
});
