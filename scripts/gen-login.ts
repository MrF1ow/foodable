/**
 * Generates public/login.html from the typed data in src/copy/login.ts.
 *
 * This is a TEMPLATE, not a final document: src/oauth.ts's renderLoginPage()
 * reads the output this writes and fills in {{SESSION_ID}}, {{CONNECT_HINT}}
 * and {{ERROR}} at request time. Those tokens must reach the written file untouched; nothing
 * below interpolates them.
 *
 * Re-run after editing src/copy/login.ts:
 *   bun run scripts/gen-login.ts
 * The generated .html file is the served artifact — don't hand-edit it.
 */

import { HTML_LANG } from "../src/routes.js";
import { esc, generatedBanner } from "./site-partials.js";
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

function renderDoc(doc: LoginDoc): string {
    const title = `${esc(doc.title)} — ${esc(doc.subtitle)}`;

    // Legal HTML is gone. Keep the consent sentence, but the {terms}/
    // {privacy} tokens are the localized names as text, not anchors.
    const consent = esc(doc.consentNote)
        .replace("{terms}", esc(doc.termsLinkText))
        .replace("{privacy}", esc(doc.privacyLinkText));

    // Styled by /app.css, the household app's stylesheet. No data-theme on
    // <html>: login always follows the OS theme.
    return `<!doctype html>
<html lang="${HTML_LANG.en}">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/brand/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <!-- No canonical/hreflang: this page has no fixed URL (rendered
             per in-flight OAuth session via GET /authorize, not routed by
             path — see src/copy/login.ts). noindex is a defensive
             belt-and-suspenders in case a stray link to /authorize is ever
             crawled. -->
        <meta name="robots" content="noindex, nofollow" />
        <link rel="stylesheet" href="/app.css" />
    </head>
    <body class="auth">
${generatedBanner("scripts/gen-login.ts")}
        <main id="main" class="auth-stage native">
            <div class="auth-card panel">
                <div class="auth-head">
                    <img class="auth-mark" src="/brand/icon.svg" width="52" height="52" alt="" />
                    <h1 class="auth-title">${esc(doc.title)}</h1>
                    <p class="auth-sub">${esc(doc.subtitle)}</p>
                </div>

                {{CONNECT_HINT}}
                {{ERROR}}

                <form method="POST" action="/approve" class="auth-form">
                    <input type="hidden" name="session_id" value="{{SESSION_ID}}" />
                    <label for="email">${esc(doc.emailLabel)}</label>
                    <input type="text" id="email" name="email" required autocomplete="username" autocapitalize="none" spellcheck="false" />
                    <label for="password">${esc(doc.passwordLabel)}</label>
                    <input type="password" id="password" name="password" required minlength="6" autocomplete="current-password" />
                    <button type="submit" name="action" value="login" class="btn-primary">${esc(doc.continueButton)}</button>
                    <p class="auth-note">${consent}</p>
                    <p class="auth-note">${esc(doc.newHereNote)}</p>
                    <p class="auth-note">${esc(doc.afterConnectNote)}</p>
                </form>
            </div>
            <p class="auth-foot">${esc(doc.footerNote)}</p>
        </main>
    </body>
</html>
`;
}

await Bun.write("./public/login.html", renderDoc(LOGIN));
console.log("wrote ./public/login.html");
