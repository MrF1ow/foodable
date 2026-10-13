import {
    createMcpHandler,
    McpServer,
    ProtocolError,
    JSONRPC_VERSION,
    type McpRequestContext,
} from "@modelcontextprotocol/server";
import { getBaseUrl } from "../url.js";
import { formatClientId } from "../client-id.js";
import type { Context } from "hono";
import type { AuthContext } from "../auth-context.js";
import {
    widgetsEnabledFromProfile,
    alcoholTrackingEnabledFromProfile,
    preferredDrinkUnitFromProfile,
    getProfile,
} from "../db/profiles.js";
import {
    createToolContext,
    NUTRIENT_COVERAGE,
    type AlcoholDisplay,
} from "./shared.js";
import {
    registerNutritionWriteTools,
    registerNutritionEditTools,
} from "./tools/nutrition.js";
import {
    registerNutritionReadTools,
    registerNutritionInsightTools,
} from "./tools/nutrition-insights.js";
import {
    registerLookupBarcodeTool,
    registerSearchFoodTool,
    registerCatalogFoodTools,
} from "./tools/food.js";
import { registerGoalsTools } from "./tools/goals.js";
import { registerWaterTools } from "./tools/water.js";
import { registerWeightTools } from "./tools/weight.js";
import {
    registerProfilePreferenceTools,
    registerProfileTools,
} from "./tools/profile.js";
import { registerFridgeTools } from "./tools/fridge.js";
import { registerGroceryTools } from "./tools/grocery.js";
import { registerRecipesTools } from "./tools/recipes.js";
import { registerRulesTools } from "./tools/rules.js";
import { registerHouseholdTools } from "./tools/household.js";

// Sent to clients in the initialize response (SDK ServerOptions.instructions).
// Advisory — not every client surfaces it, so the enforcement rule ("interview
// the user one question at a time; never log from a photo until every open
// question is resolved") is repeated in log_meal's own description. Keep both
// in sync. Note this is guidance only: the client model decides whether to
// follow it, so the loop cannot be strictly enforced from here.
const SERVER_INSTRUCTIONS = `Foodable is a household kitchen: nutrition, fridge, grocery, recipes, and settings, for one household.

All nutrition figures are estimates and this server does not provide medical or dietary advice.

Five pillars — nutrition (meals, water, weight, goals, trends), fridge (what is in the house), grocery (what to buy), recipes (what we cook), and settings (members, stores, preferences). They share one food catalog. Adding household members and rotating the household bot token are owner-only in the web app at Settings → Household; there is no MCP tool for either — point the user there instead of guessing.

Foods are the shared identity. Always search_food (or lookup_barcode for a packaged product) and then pass food_id into writes — add_fridge_item, add_grocery_line, add_recipe_ingredient, log_meal items, upsert_food. Do not invent a parallel name for something the catalog already has. get_food reads a catalog row; merge_foods is how duplicates get cleaned up.

The loop: grocery list → put_away_grocery_lines into the fridge → cook_recipe or eat_fridge_item → meals. Checking a grocery line does not stock the fridge; put-away does. eat_fridge_item deducts stock and can log a meal; cook_recipe deducts recipe ingredients and can log one meal per member. log_meal is the direct nutrition write when stock is not involved.

Member targeting — nutrition is per person. On an OAuth user token, omit user_id to act as the caller; pass target_member on writes (log_meal, update_meal, delete_meal, bulk_import_meals, log_water, delete_water, log_weight, update_weight, delete_weight, set_nutrition_goals, log_recipe_portion) to log for another household member. user_id on those writes is not a way to sudo. On a household token, pass user_id to pick whose nutrition to read or write. Call list_members when you need ids. Fridge, grocery, recipes, and the food catalog are household-scoped.

Constraints the agent must honor: call get_household_rules before proposing a grocery line, a recipe, or a meal for someone. Store rules say how that store is shopped (aisle, brand, "dairy is on the back wall"). Person rules, allergens, and dislikes are hard constraints — do not add a disliked food, and never ignore an allergen. Grocery and recipe tools warn on allergen matches; treat a warning as blocking unless the user overrides it explicitly.

Knowing what time it is — some hosts put the current date and time in your context and some do not, but this server always knows both the clock and the user's timezone. Never ask the user what time it is.
- Logging something that just happened: omit logged_at entirely. The server stamps the entry with the current time, which is more accurate than any time you could reconstruct.
- Resolving a relative time ("this morning", "an hour ago", "last Monday") or working out what "today" means: call get_current_time, then pass the resolved local time as logged_at.
- Only ask the user for a time when the entry is for some other moment they have not told you.

Recording a complete meal — this applies to every write path (log_meal, update_meal, a barcode lookup you then log, a meal you copied from search_meals), not just to photos.
${NUTRIENT_COVERAGE}
When you notice after the fact that a meal went in without its fiber or sugar, do not leave it: fill it in with update_meal rather than mentioning it in prose.

Photo-based meal logging — when the user sends a photo of food, follow these steps in order:
1. Pick the flow. A packaged product with a visible barcode: transcribe the digits printed under the barcode and call lookup_barcode. A plate, bowl, or prepared meal: continue below.
2. Identify each distinct dish or food item in the photo.
3. Establish provenance: restaurant/takeout or homemade? It changes everything downstream, so settle it before asking anything else. Read the photo for cues — restaurant plating, branded packaging or cups, a table setting in a venue, a tray — versus home tableware and a domestic background. If the cues are clear, state your read and let the user correct it ("Looks like this is from a restaurant — right?"). If they are not, just ask. Homemade: skip to step 6. Restaurant: continue to step 4.
4. Restaurant path — ask which restaurant it is and where it's located (city, or neighbourhood for a chain with many branches). Ask both in one message; they are a single natural question. Then search the web for that restaurant's menu.
   - Chains and fast food (McDonald's, Starbucks, Pret, and similar) usually publish full per-item nutrition. Find the specific item and use those numbers; they beat any estimate.
   - Independent restaurants usually publish a menu with dish names and ingredient lists but NO macros. Use the menu to identify which dish the photo shows and what is actually in it (the ingredient list is the real value — it reveals butter, cream, oil, and sugar that the photo hides), then estimate macros from those ingredients and the visible portion.
   - If you cannot find the menu — or cannot tell which of several dishes it is — say so plainly, make your best assumption, and put it to the user as a question. Never present a guess as if it came from the menu.
   - Be honest about where each number came from. Published chain nutrition is reliable; a macro figure from a recipe aggregator or a random site is not, and a dish cooked in a restaurant kitchen is usually richer than the same dish cooked at home. Say which of these you are working from, and do not dress up an estimate as verified data.
5. Restaurant path, continued — also call search_meals for the dish and for the restaurant name. The user may have eaten there before, and a past log is better evidence than any web result.
6. Homemade path — call search_meals with a short keyword per dish, passing alternatives in both the conversation language and English (past logs may be in either). Past variations reveal ingredients invisible in the photo (raisins vs banana, milk vs water, added honey or oil). Offer them as options: "Is this the oatmeal with raisins like Monday, or with banana, or something else?"
7. Estimate portions in household measures the user can verify at a glance — "a glass of", "a handful of", "a tablespoon of", "half the plate" — never grams or ounces (nobody can weigh food from a photo). For a restaurant meal, what matters most is how much of the serving was actually eaten: ask whether they finished it, left some, or shared it.
8. Interview the user — this is a multi-turn conversation, not a single confirmation step. Build a checklist of every open question across all dishes: which variation or menu item each dish is, how much of each the user actually ate, and any ingredient the photo cannot show (oil, butter, sugar, dressing, sauce, what a drink was made with). On the restaurant path, any dish you could not pin down from the menu is a checklist item too. Then work through that checklist ONE question per message. Ask the single most impactful open question, wait for the answer, let it update your assumptions, and ask the next. Do NOT batch the whole checklist into one message and do NOT stop after the first answer — a single round-trip is not an interview.
9. Keep going until every item on the checklist is resolved. Before each question it helps to note what is already settled and what is still open ("Got it — oatmeal with raisins. Two things left: how much you ate, and whether there was honey"). When the checklist is empty, summarize the full meal as you understand it and ask for a final yes before logging. Never log straight from a photo, and never log while any checklist item is still open.
10. When logging, write the confirmed household-measure portions into the meal description itself (e.g. "Oatmeal (1 glass raw oats, 2 glasses milk) with banana and honey (1 tbsp)") so future search_meals results are self-describing. For a restaurant meal, name the venue and city in the description too (e.g. "Pad thai with chicken (1 plate, finished) at Thai Basil, Podil, Kyiv") — the next time the user eats there, search_meals surfaces this entry and its macros, which is better evidence than searching the web again. Put anything about sourcing that the user should be able to revisit in notes, e.g. whether macros came from published chain nutrition or from an estimate.

Keep the interview proportional: a single obvious item with one known past variation may need only one question, while a full plate with several dishes usually needs several. A restaurant meal you pinned down from published chain nutrition may need only the how-much-did-you-eat question. If the user says to just log it or otherwise signals impatience, stop asking, state your remaining assumptions plainly, and log.

For "log my usual X" requests, use search_meals the same way: search, then interview to confirm the variation and the amount before logging.

Importing history from another app — when the user wants to bring in past meals from MyFitnessPal, Cronometer, Lose It!, MacroFactor or a similar export:
1. If they have a FILE, call start_meal_import first and let them drive it. The importer reads and maps the file in the browser, so the rows never pass through you and cannot be mistranscribed, and it handles column mapping, batching and retries. Do not ask them to paste a file you could import properly.
2. Call bulk_import_meals directly only when the importer is not an option: the data is already pasted into the conversation, the user cannot use the panel, or the importer reports that this client will not let it save. Then parse the rows yourself and follow that tool's description exactly — in particular, compute the row count and calorie total from the source text with real counting rather than by re-reading what you just wrote, and dry-run first.
3. Never log a backfill by calling log_meal in a loop. It is rate-limited per call, so a single week of meals would exhaust the budget; one bulk_import_meals call carries up to 50 rows for the same cost.
4. Check get_profile before any sizeable import and offer set_timezone if the timezone is unset. Times without an explicit UTC offset are placed using the saved timezone, so correcting it afterwards moves every imported meal — onto an adjacent day for anything logged near midnight.
5. Show the user what was resolved before treating an import as done: the dry run echoes back the date, time and meal type for every row, and a misread date column shows up there rather than in the totals. Re-sending the same rows is safe — the server recognises them and skips them — so a retry after a failure or a timeout never duplicates anything.`;

export function registerTools(
    server: McpServer,
    auth: AuthContext,
    widgetsEnabled: boolean,
    alcohol: AlcoholDisplay,
    // Optional so the many direct callers in mcp.test.ts keep working: they
    // exercise tool behaviour, not analytics attribution, and a row with no era
    // is exactly what a non-HTTP embedding should record.
    protocolEra?: "legacy" | "modern",
) {
    const ctx = createToolContext(auth, widgetsEnabled, alcohol, protocolEra);
    // Original registerTool order is not grouped by domain. Call consecutive
    // runs so tools/list stays byte-identical, including order.
    registerNutritionWriteTools(server, ctx);
    registerLookupBarcodeTool(server, ctx);
    registerNutritionReadTools(server, ctx);
    registerGoalsTools(server, ctx);
    registerNutritionEditTools(server, ctx);
    registerWaterTools(server, ctx);
    registerWeightTools(server, ctx);
    registerProfilePreferenceTools(server, ctx);
    registerNutritionInsightTools(server, ctx);
    registerProfileTools(server, ctx);
    registerFridgeTools(server, ctx);
    registerGroceryTools(server, ctx);
    registerRecipesTools(server, ctx);
    registerRulesTools(server, ctx);
    registerSearchFoodTool(server, ctx);
    registerCatalogFoodTools(server, ctx);
    registerHouseholdTools(server, ctx);
}

// The bare server: identity, capabilities and instructions, no tools. Shared
// by both factory paths so the surface a `server/discover` probe is answered
// from cannot drift from the one a tools/call is served by — the two responses
// come from the same literal.
function newMcpServer(baseUrl: string): McpServer {
    return new McpServer(
        {
            name: "Foodable",
            title: "Foodable",
            version: "0.1.0",
            icons: [
                {
                    src: `${baseUrl}/favicon.ico`,
                    mimeType: "image/x-icon",
                },
                {
                    src: `${baseUrl}/brand/icon-light.svg`,
                    mimeType: "image/svg+xml",
                    sizes: ["any"],
                    theme: "light",
                },
                {
                    src: `${baseUrl}/brand/icon-dark.svg`,
                    mimeType: "image/svg+xml",
                    sizes: ["any"],
                    theme: "dark",
                },
            ],
        },
        {
            // listChanged is explicitly false: v2 would advertise true by
            // default, but /mcp is stateless and refuses the SSE stream, so
            // there is never a channel to deliver a list_changed notification
            // on. Advertising it would invite hosts to wait for one (the
            // 2026-07-28 conformance suite warns on exactly this). A tool
            // surface change (set_widget_display) is picked up on reconnect.
            capabilities: {
                tools: { listChanged: false },
                resources: { listChanged: false },
            },
            instructions: SERVER_INSTRUCTIONS,
        },
    );
}

// The full server: the bare one plus this user's tools registered. `baseUrl` is
// the public origin the client reached us on (from the forwarding headers),
// used only to advertise the server icon.
async function buildMcpServer(
    baseUrl: string,
    auth: AuthContext,
    protocolEra?: "legacy" | "modern",
): Promise<McpServer> {
    const server = newMcpServer(baseUrl);

    // ONE `select * from profiles` for all three display preferences. The
    // getWidgetsEnabled / getAlcoholTrackingEnabled / getPreferredDrinkUnit
    // wrappers each run that identical query themselves, so calling all three
    // tripled it on the hot path of every single tool call; the *FromProfile
    // derivations are the pure halves, exported for exactly this. Alcohol
    // resolves to a drink unit only when tracking is on — null is what every
    // display path treats as "this user does not track alcohol" (storage is
    // never affected).
    const profile = auth.kind === "user" ? await getProfile(auth.userId) : null;
    const drinkUnit = preferredDrinkUnitFromProfile(profile);

    registerTools(
        server,
        auth,
        widgetsEnabledFromProfile(profile),
        alcoholTrackingEnabledFromProfile(profile) ? (drinkUnit ?? "us") : null,
        protocolEra,
    );
    return server;
}

// The two modern-era methods the SDK answers from server identity and
// capabilities alone, without ever consulting a tool handler: `server/discover`
// (supportedVersions + capabilities + instructions) and `subscriptions/listen`
// (refused outright below, but the SDK still reads getCapabilities() and the
// serverInfo off the instance before refusing). Both are served from
// newMcpServer, skipping a Supabase profile read and every tool registration.
// server/discover is the FIRST request every negotiating client sends, so under
// Supabase pressure it was the probe that failed — for a response that contains
// nothing a registration produces.
//
// Safe only because a modern request cannot reach the factory with a header
// that disagrees with its body: classification rejects a Mcp-Method that names
// a different method than the body does, and validateStandardRequestHeaders
// rejects an absent one — both with -32020 / HTTP 400, both before the factory
// runs. Those checks exist on the modern leg only — the legacy fallback ignores
// the header entirely — hence the era guard.
const IDENTITY_ONLY_METHODS = new Set([
    "server/discover",
    "subscriptions/listen",
]);

// Dual-era /mcp entry. createMcpHandler serves the 2026-07-28 revision
// (per-request `_meta` envelope, `server/discover` instead of `initialize`, no
// protocol-level sessions) and, with the default `legacy: "stateless"`, still
// answers 2025-era traffic through exactly the idiom handleMcp used to hand-roll:
// a fresh transport with `sessionIdGenerator: undefined` plus a fresh McpServer
// from this same factory, torn down when the response completes. One factory
// backs both eras, so the tool surface cannot drift between them. Nothing is
// kept in-process between requests on either leg, which is what keeps deploys
// invisible to clients — there is no session to lose.
// Observability only, and the instrument that makes retiring the legacy leg a
// measurable decision rather than a guess. The negotiated era is decided inside
// the SDK and surfaces in exactly one place — `ctx.era` on the factory context —
// so handleMcp passes a mutable holder down through the `authInfo` pass-through
// for the factory to stamp on the way through. When no request has logged
// era=legacy for a sustained window, flipping `legacy: "reject"` is safe.
//
// Requests refused before the factory runs (415, header/body mismatch,
// unsupported revision) never get stamped, and log without an era rather than a
// guessed one.
export type McpEraTrace = {
    era?: "legacy" | "modern";
    // The server built for this request, kept so handleMcp can read the client
    // identity the SDK resolved. Only readable AFTER the exchange: on the modern
    // leg the envelope backfills it per request, on the legacy leg only
    // `initialize` carries clientInfo at all.
    server?: McpServer;
};

function isAuthContext(value: unknown): value is AuthContext {
    if (value === null || typeof value !== "object") return false;
    const rec = value as Record<string, unknown>;
    if (
        rec.kind === "household" &&
        typeof rec.householdId === "string" &&
        rec.householdId.length > 0
    ) {
        return true;
    }
    if (
        rec.kind === "user" &&
        typeof rec.userId === "string" &&
        rec.userId.length > 0
    ) {
        return true;
    }
    return false;
}

function authFromExtra(
    extra: Record<string, unknown> | undefined,
): AuthContext | null {
    const auth = extra?.auth;
    return isAuthContext(auth) ? auth : null;
}

const mcpHandler = createMcpHandler(
    async (ctx: McpRequestContext) => {
        const trace = ctx.authInfo?.extra?.trace as McpEraTrace | undefined;
        if (trace) trace.era = ctx.era;

        const auth = authFromExtra(
            ctx.authInfo?.extra as Record<string, unknown> | undefined,
        );
        if (!auth) {
            throw new Error("mcp: request reached the handler without auth");
        }
        // requestInfo is set on both HTTP legs; the fallback only covers a
        // non-HTTP embedding of this factory (e.g. serveStdio), which never
        // reaches production.
        const baseUrl = ctx.requestInfo
            ? getBaseUrl(ctx.requestInfo)
            : "http://localhost";

        const mcpMethod = ctx.requestInfo?.headers.get("mcp-method") ?? "";
        if (ctx.era === "modern" && IDENTITY_ONLY_METHODS.has(mcpMethod)) {
            const bare = newMcpServer(baseUrl);
            if (trace) trace.server = bare;
            return bare;
        }

        const server = await buildMcpServer(baseUrl, auth, ctx.era);
        if (trace) trace.server = server;
        return server;
    },
    {
        legacy: "stateless",
        // The 2026-07-28 revision replaces the GET stream with POST
        // subscriptions/listen, which would otherwise be served as a long-lived
        // SSE stream — the same deploy-severed connection the 405 in handleMcp
        // exists to refuse, and one whose cap is per process, not per user.
        // Nothing here is subscribable anyway (listChanged is false), so the
        // limit is zero and the SDK answers every listen with -32603
        // "Subscription limit reached" without opening a stream. This is the
        // only refusal: a pre-check in handleMcp used to answer -32601 off the
        // Mcp-Method header alone, which pre-empted the SDK's 415 Content-Type
        // gate and its -32020 header/body cross-check (so a client that sent
        // the header on a tools/call POST was told the TOOL did not exist) and
        // disagreed with this code. IDENTITY_ONLY_METHODS keeps what that
        // pre-check was actually worth — the factory stays cheap for a listen.
        maxSubscriptions: 0,
        // A stack for anything that might be ours, one line for what is not.
        // The SDK routes server-factory throws — a Supabase outage inside
        // getProfile, a bad icon URL, a bug in registerTools — solely to
        // onerror on BOTH legs, so a message-only line here left on-call with
        // no idea what failed. A ProtocolError is by construction a rejection
        // the SDK is already answering on the wire with a typed JSON-RPC error
        // (unsupported revision, missing capability, header/body mismatch), and
        // the [req] access line already records its status, so those keep the
        // one-line form. Everything else logs its stack; the SDK also reports
        // some routine rejections as plain Errors, and their stacks are noise
        // we accept rather than risk swallowing a real fault.
        //
        // Never interpolated raw: the SDK's rejection messages embed
        // client-controlled header values verbatim (the Mcp-Name path decodes a
        // client-supplied base64 blob with a non-sanitizing TextDecoder), so a
        // raw message could carry newlines and forge fake "[req] 200 …" access
        // log lines. JSON.stringify escapes newlines and control characters,
        // and covers the stack too — which contains the same message.
        onerror: (err) =>
            console.error(
                `[mcp] ${JSON.stringify(
                    err instanceof ProtocolError
                        ? err.message
                        : (err.stack ?? err.message),
                )}`,
            ),
    },
);

// Stateless: /mcp holds no per-session state on either protocol era, so a
// restart/deploy can never strand a connected client.
//
// Only POST (JSON-RPC request/response) is served. We reject GET and DELETE
// ourselves with 405 so a GET never opens a long-lived standalone SSE stream,
// the one piece of state a deploy still severs. The handler's legacy fallback
// answers 405 too, with its own JSON-RPC error ("Method not allowed."), but
// without an `Allow` header — which is what this adds, alongside a message that
// tells the client why rather than just that. Since stateless mode never pushes
// server-initiated messages, that stream carries nothing; the only thing it does
// is die on every restart and leave some clients (observed: a Claude connector)
// wedged in a "connected but no tools" state. Refusing the stream (spec-allowed: a server
// MAY return 405 when it offers no SSE stream at this endpoint) means the client
// holds nothing that a deploy can break, so updates become truly invisible.
export const handleMcp = async (c: Context) => {
    if (c.req.method !== "POST") {
        return c.json(
            {
                jsonrpc: JSONRPC_VERSION,
                id: null,
                error: {
                    // The SDK's own 405 uses -32000 for exactly this; matching
                    // it keeps one wire code for "wrong HTTP method here"
                    // whichever leg answers. There is no exported constant for
                    // -32000 (the named ones are PARSE_ERROR, INVALID_REQUEST,
                    // METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR) and
                    // none of them means this.
                    code: -32000,
                    message:
                        "Method Not Allowed: this endpoint serves POST only and offers no SSE stream",
                },
            },
            405,
            { Allow: "POST" },
        );
    }

    const auth = c.get("authContext");
    if (!auth) {
        throw new Error("mcp: handleMcp ran without authenticateBearer");
    }

    // The handler never derives auth from headers: authInfo is pass-through,
    // and the only consumer is our own factory above. clientId is left blank
    // on purpose: it is an OAuth field the SDK documents as "the client ID
    // associated with this token", not an app-identity slot. Nothing on the
    // serve path reads it. The real bearer token is deliberately NOT forwarded
    // either — nothing downstream needs it, and keeping it out of the SDK's
    // context means no handler or error path can echo it.
    const trace: McpEraTrace = {};
    const response = await mcpHandler.fetch(c.req.raw, {
        authInfo: {
            token: "",
            clientId: "",
            scopes: [],
            extra: {
                auth,
                trace,
            },
        },
    });

    // Published for the access log in src/index.ts, which runs outermost and
    // reads this after next() resolves. Set after fetch resolves, which is
    // after the factory has run even when the response body is still streaming.
    if (trace.era) c.set("mcpEra", trace.era);
    const client = formatClientId(trace.server?.server.getClientVersion());
    if (client) c.set("mcpClient", client);
    return response;
};

// Aborts any in-flight 2026-era exchanges on shutdown. The legacy leg holds
// nothing between requests, so there is nothing of it to close.
export const closeMcpHandler = (): Promise<void> => mcpHandler.close();
