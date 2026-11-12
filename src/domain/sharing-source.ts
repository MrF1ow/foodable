import {
    urlAllowedForFetch,
    type FetchFailure,
    type SafeFetcher,
} from "../fetch-safe.js";
import {
    parseShareDocument,
    SHARE_DOCUMENT_MAX_BYTES,
    SHARE_DOCUMENT_VERSION,
    ShareDocumentError,
    type ShareDocument,
} from "./sharing-document.js";

/**
 * Where an imported shared recipe comes from: a share link another Foodable
 * deploy made, or the document itself pasted as JSON. This module decides what
 * a pasted string may be fetched from (the SSRF guard) and turns it into a
 * `ShareDocument`; it never writes anything. The import itself is
 * `sharing-import.ts`.
 */

export const SHARED_RECIPE_ERROR_CODES = [
    "not_share_link",
    "not_found",
    "unreachable",
    "too_large",
    "not_recipe",
    "unsupported_version",
] as const;

export type SharedRecipeErrorCode = (typeof SHARED_RECIPE_ERROR_CODES)[number];

/**
 * Why a shared recipe could not be read. The message is written for the
 * person (the app shows it as it is, an agent gets it as the tool error); the
 * code lets a caller tell the causes apart.
 */
export class SharedRecipeImportError extends Error {
    constructor(
        readonly code: SharedRecipeErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "SharedRecipeImportError";
    }
}

/** What a pasted string is: an address to fetch, or the document itself. */
export type SharedRecipeInput =
    { kind: "url"; url: string } | { kind: "document"; text: string };

/** A share token is 32 random bytes in base64url. */
const TOKEN = "[A-Za-z0-9_-]{43}";
const PAGE_PATH = new RegExp(`^/s/(${TOKEN})(?:\\.json)?$`);
const JSON_PATH = new RegExp(`^/s/${TOKEN}\\.json$`);

const NOT_A_SHARE_LINK =
    "That isn't a Foodable share link. Paste a link that looks like https://…/s/… or the recipe's JSON.";

/**
 * Whether `url` is one this importer may fetch: https, an address
 * `urlAllowedForFetch` accepts (no credentials, no odd port, no private or
 * local host) and exactly the `/s/<token>.json` path. The fetcher applies it
 * to every redirect, so a hop can never leave the shape of a share document.
 */
export function isSharedRecipeJsonUrl(url: URL): boolean {
    return (
        url.protocol === "https:" &&
        urlAllowedForFetch(url) &&
        JSON_PATH.test(url.pathname)
    );
}

/**
 * Whether a pasted link has the shape of a Foodable share link (a path of
 * `/s/<token>` or `/s/<token>.json`), on any host and scheme. The household
 * app uses it to send such a link to this importer instead of reading it as a
 * recipe website; `parseSharedRecipeInput` then decides whether it may be
 * fetched, and says why not when it may not.
 */
export function looksLikeSharedRecipeLink(raw: string): boolean {
    try {
        return PAGE_PATH.test(new URL(raw.trim()).pathname);
    } catch {
        return false;
    }
}

/**
 * Classifies what the person pasted. Text that opens with `{` is a document;
 * anything else must be a share link, which becomes the one address that gets
 * fetched: `https://<host>/s/<token>.json`, rebuilt from the parts so a query
 * string, fragment or stray suffix never travels. Throws
 * `SharedRecipeImportError("not_share_link")` for everything else, before any
 * network call.
 */
export function parseSharedRecipeInput(raw: string): SharedRecipeInput {
    const text = raw.replace(/^﻿/, "");
    const trimmed = text.trim();
    if (trimmed === "") {
        throw new SharedRecipeImportError(
            "not_share_link",
            "Paste a share link or the recipe's JSON.",
        );
    }
    if (trimmed.startsWith("{")) return { kind: "document", text: raw };
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new SharedRecipeImportError("not_share_link", NOT_A_SHARE_LINK);
    }
    if (parsed.protocol !== "https:") {
        throw new SharedRecipeImportError(
            "not_share_link",
            "Share links start with https://. Paste the whole link.",
        );
    }
    if (!urlAllowedForFetch(parsed)) {
        throw new SharedRecipeImportError(
            "not_share_link",
            "Foodable can't import from that address.",
        );
    }
    const token = PAGE_PATH.exec(parsed.pathname)?.[1];
    if (!token) {
        throw new SharedRecipeImportError("not_share_link", NOT_A_SHARE_LINK);
    }
    return { kind: "url", url: `https://${parsed.host}/s/${token}.json` };
}

/** How long the other deploy has to answer, connection and body together. */
export const SHARE_FETCH_TIMEOUT_MS = 10_000;

/** The slice of `SafeFetcher` the importer needs, so a test can hand in a stub. */
export type SharedRecipeFetcher = Pick<SafeFetcher, "fetchPage">;

function failureFor(reason: FetchFailure): SharedRecipeImportError {
    switch (reason) {
        case "invalid_link":
        case "blocked_address":
        case "host_not_allowed":
            // The pasted address, or a redirect from it, is not one Foodable
            // will fetch from. The address itself is not echoed.
            return new SharedRecipeImportError(
                "not_share_link",
                "That link's address isn't one Foodable will import from. Paste the share link as it was given to you.",
            );
        case "too_many_redirects":
            return new SharedRecipeImportError(
                "unreachable",
                "That link redirected too many times. Paste the share link as it was given to you.",
            );
        case "not_found":
            return new SharedRecipeImportError(
                "not_found",
                "That share link doesn't work any more. It may have been revoked or expired, or it isn't a recipe link.",
            );
        case "too_large":
            return new SharedRecipeImportError(
                "too_large",
                `That recipe is too large to import (the limit is ${SHARE_DOCUMENT_MAX_BYTES / 1024} KB).`,
            );
        case "bad_content_type":
            return new SharedRecipeImportError(
                "not_recipe",
                "That link didn't return a recipe document.",
            );
        case "timeout":
            return new SharedRecipeImportError(
                "unreachable",
                `The other Foodable didn't answer within ${SHARE_FETCH_TIMEOUT_MS / 1000} seconds. Try again in a moment.`,
            );
        case "site_refused":
        case "robots_disallowed":
        case "http_error":
        case "network_error":
            return new SharedRecipeImportError(
                "unreachable",
                "Couldn't reach the other Foodable. Check the link and try again in a moment.",
            );
    }
}

/**
 * A document `parseShareDocument` refused, told apart for the caller. The
 * parser owns the refusal and its message; this only reads the text again to
 * name the cause (too large, another version, or just not a recipe).
 */
function documentFailure(text: string, err: ShareDocumentError) {
    if (new TextEncoder().encode(text).length > SHARE_DOCUMENT_MAX_BYTES) {
        return new SharedRecipeImportError("too_large", err.message);
    }
    try {
        const value: unknown = JSON.parse(text);
        if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
        ) {
            const version = (value as { version?: unknown }).version;
            if (version !== undefined && version !== SHARE_DOCUMENT_VERSION) {
                return new SharedRecipeImportError(
                    "unsupported_version",
                    err.message,
                );
            }
        }
    } catch {
        // Not JSON: the parser's own message says so.
    }
    return new SharedRecipeImportError(
        "not_recipe",
        `That isn't a Foodable recipe. ${err.message}`,
    );
}

/**
 * Reads a shared recipe from what the person pasted: a share link (fetched
 * through the safe fetcher: https only, only `/s/<token>.json`, redirects only
 * to the same shape, 10 s, 256 KB, `application/json`) or the document's JSON
 * (no network). Throws `SharedRecipeImportError`; returns a validated
 * `ShareDocument`.
 */
export async function readSharedRecipe(
    raw: string,
    deps: { fetcher: SharedRecipeFetcher; timeoutMs?: number },
): Promise<ShareDocument> {
    const input = parseSharedRecipeInput(raw);
    let text: string;
    if (input.kind === "document") {
        text = input.text;
    } else {
        const outcome = await deps.fetcher.fetchPage(input.url, {
            accept: ["application/json"],
            // The person pasted this address; robots.txt is for crawlers.
            checkRobots: false,
            maxBytes: SHARE_DOCUMENT_MAX_BYTES,
            timeoutMs: deps.timeoutMs ?? SHARE_FETCH_TIMEOUT_MS,
            redirectAllowed: isSharedRecipeJsonUrl,
        });
        if (!outcome.ok) throw failureFor(outcome.reason);
        text = outcome.body;
    }
    try {
        return parseShareDocument(text);
    } catch (err) {
        if (err instanceof ShareDocumentError) {
            throw documentFailure(text, err);
        }
        throw err;
    }
}
