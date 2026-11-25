/**
 * Generates public/login.html from the typed data in src/copy/login.ts.
 *
 * This is a TEMPLATE, not a final document: src/oauth.ts's renderLoginPage()
 * reads the output this writes and fills in {{SESSION_ID}}, {{CONNECT_HINT}}
 * (the line under the name), {{ERROR}}, {{INVITE_FIELDS}} and the stylesheet
 * and script hrefs at request time. Those tokens must reach the written file
 * untouched; nothing below interpolates them.
 *
 * Re-run after editing src/copy/login.ts:
 *   bun run scripts/gen-login.ts
 * The generated .html file is the served artifact — don't hand-edit it.
 */

import { HTML_LANG } from "../src/routes.js";
import { brandHero } from "../src/web/components/v2/brand-hero.js";
import { button } from "../src/web/components/v2/button.js";
import { field } from "../src/web/components/v2/field.js";
import { generatedBanner } from "./site-partials.js";
import { escapeHtml as esc } from "../src/html.js";
import { appHead } from "../src/web/shell.js";
import { getAppCss, getAppJs } from "../src/widgets.js";
import { LOGIN, type LoginDoc } from "../src/copy/login.js";
import { rm } from "node:fs/promises";

const STALE_LOCALES = ["de", "es", "fr", "nl", "pl", "it", "uk", "ja"] as const;

async function removeStaleMarketingHtml(): Promise<void> {
    const files = [
        "public/index.html",
        "public/tools.html",
        "public/privacy.html",
        "public/terms.html",
        "public/sitemap.xml",
        "public/llms.txt",
    ];
    for (const locale of STALE_LOCALES) {
        for (const name of [
            "index.html",
            "tools.html",
            "privacy.html",
            "terms.html",
            "login.html",
        ]) {
            files.push(`public/${locale}/${name}`);
        }
    }
    await Promise.all(files.map((f) => rm(f, { force: true })));
    await rm("public/alternatives", { recursive: true, force: true });
    await Promise.all(
        STALE_LOCALES.map((locale) =>
            rm(`public/${locale}`, {
                recursive: true,
                force: true,
            }),
        ),
    );
}

await removeStaleMarketingHtml();
await getAppCss();
await getAppJs();

function loginAppHead(title: string): string {
    return appHead(title, "system", "page")
        .replace(/href="[^"]*app\.css[^"]*"/, 'href="{{APP_CSS_HREF}}"')
        .replace(/src="[^"]*app\.js[^"]*"/, 'src="{{APP_JS_HREF}}"')
        .concat(
            '\n<link rel="stylesheet" href="{{APP_V2_CSS_HREF}}" data-turbo-track="reload" />',
        );
}

function renderDoc(doc: LoginDoc): string {
    // appHead escapes the title itself.
    const head = loginAppHead(`${doc.title} — ${doc.heading}`)
        .split("\n")
        .map((line) => `        ${line}`)
        .join("\n");

    // Legal HTML is gone. Keep the consent sentence, but the {terms}/
    // {privacy} tokens are the localized names as text, not anchors.
    const consent = esc(doc.consentNote)
        .replace("{terms}", () => esc(doc.termsLinkText))
        .replace("{privacy}", () => esc(doc.privacyLinkText));

    // Styled by /app.css and /app-v2.css with the app's own <head> (appHead).
    // No data-theme on <html>: login always follows the OS theme. The line
    // under the name is {{CONNECT_HINT}}: the tagline, or "Sign in to
    // connect <host>" when an agent is signing in. The `/approve` form keeps
    // its route, method, fields and hidden field; a boxed field is named by
    // its placeholder and by a label no one sees. `auth-form` styles nothing:
    // client/v2/shell.js and check:nav find the login HTML by it, so an
    // expired session's login page reloads instead of morphing into the app.
    const hero = brandHero({ title: doc.title, tagline: "{{CONNECT_HINT}}" });
    const emailField = field({
        id: "email",
        name: "email",
        label: doc.emailLabel,
        labelHidden: true,
        placeholder: doc.emailLabel,
        type: "text",
        required: true,
        autocomplete: "username",
        autocapitalize: "none",
        spellcheck: false,
    });
    // No minlength: the server lets any existing password sign in, however
    // short. A new account's own minimum (MIN_PASSWORD_LENGTH) is checked
    // there and answered in place with {{ERROR}}.
    const passwordField = field({
        id: "password",
        name: "password",
        label: doc.passwordLabel,
        labelHidden: true,
        placeholder: doc.passwordLabel,
        type: "password",
        required: true,
        autocomplete: "current-password",
    });
    const submit = button({
        label: doc.continueButton,
        variant: "primary",
        type: "submit",
        attrs: { name: "action", value: "login" },
    });
    return `<!doctype html>
<html lang="${HTML_LANG.en}">
    <head>
${head}
        <!-- No canonical/hreflang: this page has no fixed URL (rendered
             per in-flight OAuth session via GET /authorize, not routed by
             path — see src/copy/login.ts). noindex is a defensive
             belt-and-suspenders in case a stray link to /authorize is ever
             crawled. -->
        <meta name="robots" content="noindex, nofollow" />
        <meta name="turbo-visit-control" content="reload" />
    </head>
    <body class="fd-body fd-auth-body">
${generatedBanner("scripts/gen-login.ts")}
        <main id="main" class="fd-auth native">
            <h1 class="fd-visually-hidden">${esc(doc.heading)}</h1>
            ${hero}
            <div class="fd-auth__content">
                <form method="POST" action="/approve" class="auth-form fd-auth__form" data-turbo="false">
                    <input type="hidden" name="session_id" value="{{SESSION_ID}}" />
                    ${emailField}
                    ${passwordField}
                    {{INVITE_FIELDS}}
                    {{ERROR}}
                    ${submit}
                </form>
                <p class="fd-auth__caption">${consent}</p>
            </div>
        </main>
    </body>
</html>
`;
}

await Bun.write("./public/login.html", renderDoc(LOGIN));
console.log("wrote ./public/login.html");
