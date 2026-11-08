> Research memo produced on 2026-11-04 by a Grok 4.7 research task for the recipe import plan. Kept as the record behind the "no server fetch of social posts" decision. Not legal advice; platform terms change, so re-check before relying on any single clause.

# Foodable recipe import: what the platforms actually allow

**Not legal advice.** This is a research memo for a product decision. It quotes platform terms, developer docs, robots.txt, one Copyright Office manual, and published court opinions. It is not a lawyer's opinion, and terms change.

**Scope.** Foodable is a self-hosted, single-household app. Import is always user-initiated, one public URL at a time, with no login to the social platform. The product rule is stricter than "might we win a lawsuit": **do not do what the platform's terms forbid.**

**Access date for every page read or called in this research: 2026-11-04.**

**What was called, and what was not.** Official oEmbed endpoints were called with an identifying User-Agent (`FoodableTosResearch/1.0`) and with the platforms' own documented sample URLs. robots.txt files were fetched the same way, and several were truncated. **Post HTML was not fetched. No crawler User-Agent was impersonated.** Observations about `facebookexternalhit`, Instagram `og:` tags, TikTok `__UNIVERSAL_DATA_FOR_REHYDRATION__`, and Facebook caption text inside oEmbed HTML are the owner's 2026-11-04 tests, reported here and not repeated.

---

## 1. Verdict table

"Allowed" means the platform documents that use. "Prohibited" means the written terms forbid it, which is the product rule even where a contract or the CFAA might not be enforceable against a logged-out server. "Grey" means the docs do not bless the use and do not spell the prohibition in those words. "Unknown" means no primary source was found.

| Source                   | Allowed route for recipe text                                                                                                                                                                         | What the official route actually returns                                                                                                                                                                                                                                       | What it requires                                                                                                                                                                                                               | Official oEmbed                                                                                                                                                                                                                                                                                                                                    | Crawler-UA page fetch                                                                                    | Browser-UA page fetch                                                                                                                                                                    | Share-sheet / pasted text                                                                                                                                                                                   | Other official API                                                                                                                                                                                                                                                            | Confidence                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram                | None for the caption. Render the official embed only. Recipe text must come from the user.                                                                                                            | Tokenless `instagram_oembed`: `html`, `provider_name`, `provider_url`, `type`, `version`, `width`. No caption field. Live call 2026-11-04 confirmed this on Meta's sample post.                                                                                                | Nothing for the tokenless embed call (no app, no review). 1,000 requests/hour on the Instagram endpoint. Embed is front-end view only.                                                                                         | **Allowed** only to render the embed. **Prohibited** to extract, store, or derive a recipe from the HTML or metadata.                                                                                                                                                                                                                              | **Prohibited**                                                                                           | **Prohibited**                                                                                                                                                                           | **Allowed** if the user pastes or the OS delivers text the user chose to share. What the Instagram app puts in the share payload: **unknown**.                                                              | **No** no-login API for an arbitrary public caption. Basic Display is shut down (see unverified list for the shutdown post). Graph API needs the account holder.                                                                                                              | **High** on the prohibitions and on the oEmbed fields. **Low** on share-payload contents.                                                                                                                                                                     |
| Facebook                 | Same as Instagram: render the embed, do not mine it.                                                                                                                                                  | `oembed_video` reference fields: `height`, `html`, `provider_name`, `provider_url`, `type`, `version`, `width`. `author_*` and `thumbnail_*` removed. Owner saw caption text inside `html`. That was not re-tested.                                                            | Tokenless embed: no token, no App Review. Same "technical data" list as the June 15, 2026 blog.                                                                                                                                | **Allowed** to render the embed. **Prohibited** to pull caption text out of `html` and store or transform it into a recipe (Automated Data Collection Terms limit use to search results, URL previews, or separate written permission). The Instagram-style "strictly prohibited" sentence was **not** found on the Facebook video reference page. | **Prohibited**                                                                                           | **Prohibited**                                                                                                                                                                           | **Allowed** for text the user supplies. Facebook share-payload contents: **unknown**.                                                                                                                       | **No** no-login API that returns an arbitrary public post's text for storage.                                                                                                                                                                                                 | **High** on page-fetch and on not mining the embed. **Medium** on whether Facebook's own oEmbed page repeats Instagram's sentence.                                                                                                                            |
| Threads                  | Same pattern.                                                                                                                                                                                         | June 15, 2026 blog: tokenless Threads oEmbed returns the same technical fields (`version`, `provider_name`, `provider_url`, `html`, `width`, `type`). No caption field in that list.                                                                                           | Tokenless: no token, no App Review, per the June 15, 2026 blog. Older embed-guide text that still demands App Review looks stale.                                                                                              | **Allowed** to render the embed. **Prohibited** to extract a caption from it or from the page.                                                                                                                                                                                                                                                     | **Prohibited**                                                                                           | **Prohibited**                                                                                                                                                                           | **Allowed** for text the user already has and types or shares in. Threads' "manual process" clause targets extraction from the Threads Service, not typing into another app. Payload contents: **unknown**. | Threads API was not found to offer a no-login read of an arbitrary public post.                                                                                                                                                                                               | **High** on the scrape ban. **Medium** on current oEmbed field list (blog plus prior docs; the Threads reference page was not re-opened while drafting).                                                                                                      |
| TikTok                   | TikTok's own embed player, which can _display_ the description inside TikTok's iframe. Not a caption field you may copy.                                                                              | Live `oembed` call: `embed_product_id`, `embed_type`, `height`, `html`, `provider_name`, `provider_url`, `type`, `version`, `width`. No `title`, no author, no caption. The iframe URL contains `description=1`, which is a player flag.                                       | Nothing for oEmbed. Display API needs the video owner's Login Kit authorization. Research API is for approved academic research only.                                                                                          | **Allowed** to show TikTok's player. **Prohibited** to treat that as a caption API. The current video response has no caption to store.                                                                                                                                                                                                            | **Prohibited**                                                                                           | **Prohibited** (including reading `__UNIVERSAL_DATA_FOR_REHYDRATION__` or a WebVTT URL out of the page)                                                                                  | **Allowed** for user-supplied text. What the TikTok app attaches on Share: **unknown**.                                                                                                                     | **Not usable** for "paste any public URL" without that creator connecting, and a household app is not eligible for Research API.                                                                                                                                              | **High**                                                                                                                                                                                                                                                      |
| Pinterest                | Official Pin widget / oEmbed for _displaying the Pin_. Not established as a recipe-text API.                                                                                                          | Owner's test of `oembed.json`: `title`, `author_name`, `thumbnail_url`, embed `html`, no outbound recipe link. **Not re-called** in this research (no documented sample pin was used).                                                                                         | Consumer terms forbid automated access without express prior permission. API v5 is OAuth for the authorizing user's own pins, boards, and ads, after a business account and app review.                                        | **Allowed** to render the official widget/embed. **Grey**, leaning not allowed, to store `title` and turn it into a recipe. No oEmbed storage clause was found that permits that.                                                                                                                                                                  | **Prohibited**                                                                                           | **Prohibited**                                                                                                                                                                           | **Allowed** for user-supplied text. Pinterest share payload: **unknown**.                                                                                                                                   | **Not usable** for an arbitrary public pin with no user connection.                                                                                                                                                                                                           | **High** on the scrape ban. **Medium** on reusing `title`. **Low** on the exact current oEmbed JSON, because it was not re-called.                                                                                                                            |
| YouTube                  | Embed the player. For description text, the Data API is the sanctioned read, and it is a poor fit for a permanent recipe (30-day cap, no derived data). Practical route: user pastes the description. | Live oEmbed: `title`, `author_name`, `author_url`, thumbnails, and a `youtube.com/embed` iframe. **No description.** Data API `videos.list` `snippet` includes title, description, and channel title (standard `part=snippet`; the field list was not re-read while drafting). | oEmbed: none. Data API: Google Cloud API key, YouTube API Services Terms and Developer Policies, quota. Default quota figure was **not** re-opened while drafting (commonly published as 10,000 units/day, `videos.list` = 1). | **Allowed** to show title, author, thumbnail, and player. **Grey** to store the title as a permanent household recipe. oEmbed is not the Data API, and nothing blesses permanent storage.                                                                                                                                                          | **Prohibited** (automated access except public search engines obeying robots.txt, or written permission) | **Prohibited** on the same clause                                                                                                                                                        | **Allowed** for user-supplied text. YouTube share payload: **unknown**.                                                                                                                                     | **Allowed** to call `videos.list` with a key. **Prohibited** to keep snippet text, including description, longer than 30 days without refresh, and **prohibited** to use API Data to create derived data or metrics. A stored recipe built from the description does not fit. | **High** on the 30-day rule, the derived-data clause, the live oEmbed fields, and the automated-access ban. **Medium** on the English ToS page (mobile/search extract and Spanish mirror; desktop `/t/terms` was not retrieved). **Medium** on quota numbers. |
| Ordinary recipe websites | One user-triggered fetch of that URL, identifying User-Agent, honor robots.txt, parse schema.org `Recipe` JSON-LD if present.                                                                         | JSON-LD `Recipe` (ingredients, instructions) where the site publishes it. This was not re-fetched from a live site.                                                                                                                                                            | Each site's own terms. No Allrecipes / NYT Cooking / similar terms were opened.                                                                                                                                                | n/a (use the site's own JSON-LD, not an oEmbed, unless the site offers one)                                                                                                                                                                                                                                                                        | **Prohibited** to pretend to be Googlebot or any other bot                                               | **Grey.** A single identified, user-triggered fetch is the normal good-faith pattern and is not "crawling" in Google's own model, but a site contract can still forbid automated access. | **Allowed.** Paste, or a browser clipper the user runs.                                                                                                                                                     | n/a                                                                                                                                                                                                                                                                           | **Medium.** The Google fetcher distinction is high-confidence. Per-site contracts were not read.                                                                                                                                                              |

---

## 2. Platform by platform

### Instagram

**Terms that govern.** The Meta Terms of Service do not govern Instagram. The Instagram terms say so: "The Meta Terms of Service do not apply to this Service." Fetched from <https://www.facebook.com/help/instagram/581066165581870> on 2026-11-04. The fetched page has **no "Last updated" line**. It ends with a 2026 copyright notice. A preview of a later update (effective January 20, 2027) was seen in search and was not used as the current text.

Section 4.2, as fetched:

> You can't attempt to create accounts or access or collect information in unauthorized ways. This includes creating accounts or accessing or collecting information in an automated way without our express permission, regardless of whether such automated access or collection is undertaken while logged-in to an Instagram account.

Same section: "You can't sell, license, or purchase any account or data obtained from us or our Service, regardless of whether such data was obtained while logged-in to an Instagram account." And: "You can't do, or attempt to do, anything to circumvent, by-pass, or override any technological measures that control or limit access to the Service or data."

**Automated Data Collection Terms.** <https://www.facebook.com/legal/automated_data_collection_terms> (same document as `facebook.com/apps/site_scraping_tos_terms.php`). **Effective October 7, 2024.** Fetched in full.

Section 2:

> You will not engage in Automated Data Collection without first obtaining Meta's express written permission or in any manner that is not explicitly authorized by Meta. The term of these Terms will begin on the date you accept them or otherwise engage in Automated Data Collection of Meta Company Products...

Section 3: accepting the terms is not the permission. "Acceptance of these Terms alone does not constitute the required written permission to conduct Automated Data Collection; such permission must be obtained separately through Meta's formal authorization process."

Section 4, permitted uses of Collected Data, only:

> (i) providing results for your Search Engine, or (ii) displaying previews of Meta URLs to your users, and (iii) for other purposes for which you have received Meta's express written permission... All other Uses are prohibited, including... data derived from Collected Data...

Section 4 also: "You will comply with Meta's robots.txt protocols, page header tags, and similar opt-out protocols." And:

> You will only use IP addresses, user-agent strings, and other identifiers that identify your services.

"Automated Data Collection" is defined as collection via automated or programmatic tools capable of navigating or indexing, "including but not limited to web scrapers, bots, robots, spiders, crawlers, user-agents, and other automated or programmatic mechanisms." "Use" includes storage, adaptation, retrieval, combination, and erasure.

A server-side GET of an Instagram post, logged out, one URL, any User-Agent, is Automated Data Collection under that definition. Doing it with `facebookexternalhit/1.1` is also a false identifier under the user-agent sentence. Meta's crawler docs (not re-opened while drafting; <https://developers.facebook.com/docs/sharing/webmasters/crawler>) describe `facebookexternalhit` as Meta's own link-preview crawler. Those docs are not a permission for anyone else to use that string.

Developer documentation, Automated Data Collection page, updated February 3, 2025, as read earlier in this research and not re-opened while drafting (<https://developers.facebook.com/documentation/development/terms-and-policies/automated-data-collection>): "Platform APIs are the only allowable means to access data programmatically, unless you have our prior written permission."

**robots.txt.** Fetched 2026-11-04 from <https://www.instagram.com/robots.txt>, first ~1,800 characters only. The file opens with:

> Notice: Collection of data on Instagram through automated means is prohibited unless you have express written permission from Instagram and may only be conducted for the limited purpose contained in said permission. All authorized user-agents listed on this page must comply with Meta's Automated Data Collection Terms available at: https://www.facebook.com/legal/automated_data_collection_terms

Named bots (Amazonbot, Applebot-Extended, Brightbot, ClaudeBot, Google-Extended, GPTBot, PerplexityBot, PetalBot, Scrapy, and others) are `Disallow: /`. The `User-agent: *` rule was **not** in the truncated portion. Do not treat a blog's claim of `Disallow: /` for `*` as verified.

**oEmbed, tokenless since June 15, 2026.** Meta for Developers blog, "Introducing Tokenless Access to Meta oEmbed APIs," June 15, 2026, fetched 2026-11-04:

> You can now call Meta oEmbed APIs to embed public Facebook, Threads, and Instagram content without an access token. ... App Review for will no longer be required to embed public Meta content.

Endpoints named: Threads oEmbed, Instagram oEmbed, Facebook oEmbed Post, Facebook oEmbed Video. The blog says the response is `version`, `provider_name`, `provider_url`, `html`, `width`, and `type`, and: "No personal data is shared through these endpoints." Token-based access "is still available" and "may offer higher rate limits." The blog does not state the higher number. An older "millions per day" figure was **not** re-confirmed.

Instagram oEmbed limitations, <https://developers.facebook.com/docs/instagram-platform/oembed/>, fetched 2026-11-04:

> The Instagram oEmbed endpoint is only meant to be used for embedding Instagram content in websites and apps. It is not to be used for any other purpose. Using metadata and page, post, or video content (or their derivations) from the endpoint for any purpose other than providing a front-end view of the page, post, or video is strictly prohibited. This prohibition encompasses consuming, manipulating, extracting, or persisting the metadata and content, including but not limited to deriving information about pages, posts, and videos from the metadata for analytics purposes.

Rate limit on that page: "You can make up to 1,000 requests every hour." Private, inactive, age-restricted, embed-disabled, and Stories are unsupported.

**Live call, 2026-11-04.** `GET https://graph.facebook.com/v27.0/instagram_oembed?url=https://www.instagram.com/p/fA9uwTtkSN/` (the sample URL in Meta's own April 2025 blog). HTTP 200. Keys: `html`, `provider_name`, `provider_url`, `type`, `version`, `width`. `type` is `rich`, `width` is 658. The HTML is a `blockquote.instagram-media` with `data-instgrm-captioned` and a permalink. There is no caption field. The word "caption" appears only inside the attribute name `data-instgrm-captioned`.

**April 8, 2025 oEmbed blog** (update October 8, 2025; field removal effective November 3, 2025), fetched 2026-11-04. Removed from Facebook post, Facebook video, and Instagram post oEmbed: `author_name`, `author_url`, `thumbnail_url`, `thumbnail_width`, `thumbnail_height`. On thumbnails it says: "we recommend that developers generate their own thumbnails by accessing the HTML metadata directly from the Instagram post used for the oEmbed request."

That sentence is about thumbnails, not captions. It is not the "formal authorization process" the Automated Data Collection Terms require. The Instagram oEmbed limitations page, which forbids extracting and persisting metadata, is the operative developer rule. It does not authorize `facebookexternalhit` or a browser User-Agent scrape. The owner's test (crawler User-Agent returned a ~2,000-character `og:description`; a browser User-Agent returned nothing useful) is consistent with Meta serving previews only to its own crawler, and copying that string is the thing section 4 forbids.

**Other APIs.** Instagram Basic Display API: prior research recorded a Meta developer post (September 4, 2024, shutdown December 4, 2024). That post was **not** re-opened while drafting. See the unverified list. There is no current consumer API that, with no account connection, returns an arbitrary public post's caption. Instagram API with Instagram Login, and Graph API features such as Business Discovery, require a professional account's token and app review. They read data for accounts that authorize the app, or for approved professional-account use. They are not a "paste any reel URL" feature for a household server.

**Store and display.** If you render Meta's embed HTML as a front-end view, with their permalink, that is the documented use. Storing the caption, or a recipe derived from it, is an "other use" under the Automated Data Collection Terms and is "strictly prohibited" by the Instagram oEmbed limitations. There is no caching-duration clause to comply with, because the use itself is refused.

**Share sheet.** Unknown what the Instagram app attaches. See section 2.8.

### Facebook

**Terms.** <https://www.facebook.com/legal/terms>, **effective January 1, 2025**, fetched 2026-11-04. They cover Facebook, Messenger, and other Meta Products "except where we expressly state that separate terms (and not these) apply," and they say Instagram has its own terms.

Section 3.2, item 3:

> You may not access or collect data from our Products using automated means (without our prior permission) or attempt to access data you do not have permission to access, regardless of whether such automated access or collection is undertaken while logged-in to a Facebook account.

Item 5: except as provided in the Platform Terms, you may not sell, license, or purchase any data obtained from Meta, "regardless of whether such data was obtained while logged-in to a Facebook account." Item 7: you may not circumvent technological measures that control access to Products or data.

The "regardless of whether logged-in" wording is in the current terms. It was not in the terms Judge Chen applied in _Meta v. Bright Data_ (January 23, 2024). See the legal section. Whether it binds a person who never created an account is **unknown**. It is still the rule Foodable has chosen to follow.

The Automated Data Collection Terms and the robots.txt notice apply. <https://www.facebook.com/robots.txt>, fetched 2026-11-04, truncated, opens with the same prohibition notice as Instagram, naming Facebook and linking the Automated Data Collection Terms. `User-agent: *` was not in the truncated head.

**oEmbed.** June 15, 2026 blog, above: tokenless, no App Review, same technical fields, "no personal data." Graph API Reference v27.0 for Oembed Video, fetched 2026-11-04 (<https://developers.facebook.com/docs/graph-api/reference/oembed-video/>): default fields are `height`, `html`, `provider_name`, `provider_url`, `type`, `version`, `width`. It records that `author_name`, `author_url`, and the thumbnail fields "are no longer returned and will be fully deprecated on November 3, 2025." Parameters include `url` (required) and `useiframe`.

The Facebook reference page that was fetched does **not** repeat Instagram's "strictly prohibited" sentence. The allowed-use constraint that does apply is the Automated Data Collection Terms: Collected Data may be used to display previews of Meta URLs, and other uses, including data derived from Collected Data, need separate written permission. A recipe parsed out of embed HTML is a derived use, not a preview. The June 15, 2026 blog also frames the API as embed HTML for "embedded rich previews," and says no personal data is shared. The owner's observation that caption text appears inside Facebook `oembed_video` HTML was not re-tested. If it is still true, the permitted thing to do with `html` is to render the embed, not to mine it.

**Store.** Do not store the caption. Rendering the official embed and linking back is the preview use. There is no published retention period for a mined caption, because mining it is outside the permitted uses.

**APIs.** No no-login API was found that returns an arbitrary public Facebook post's text for an app to keep. Graph API reads require tokens and, for other people's content, the permissions and review Meta documents for that edge. Not a fit for this feature.

### Threads

**Terms.** <https://www.facebook.com/help/instagram/769983657850450>, fetched 2026-11-04. **Last Updated: 28 May 2025.**

Section 3(a)(iv), you shall not, and shall not cause a third party to:

> use any robot, spider, crawlers, scraper or other automatic device, process, software or queries that intercepts, "mines", scrapes, extracts or otherwise accesses the Threads Service to monitor, extract, copy or collect information or data from the Threads Service, or engage in any manual process to do the same.

Section 3(b) incorporates the Instagram Terms of Use, including "Your Commitments," which is the automated-access clause quoted above.

"Manual process to do the same" sits on extracting from the Threads Service. It is not a ban on a person typing, into Foodable, text they already have. A server fetch of threads.net is exactly the robot clause.

Search results disagreed about dates (a UK snippet said 7 July 2025; a preview page said updates would take effect January 21, 2026 and was still labeled Preview). The US English page that was actually fetched says 28 May 2025. That is the text used here.

**robots.txt.** <https://www.threads.net/robots.txt>, fetched 2026-11-04, truncated, same prohibition notice, naming Threads, plus the Automated Data Collection Terms link. `User-agent: *` was not in the truncated head.

**oEmbed.** Covered by the June 15, 2026 tokenless blog. Fields listed there do not include a caption. Threads oEmbed reference was described in earlier research as updated November 3, 2026, with fields `html`, `provider_name`, `provider_url`, `type`, `version`, `width`. That reference page was **not** re-opened while drafting. Older embed docs that still require an app token, App Review, and "standard access" limited to official Meta accounts should be treated as possibly stale against the June 15, 2026 blog. Do not build against the stale requirements, and do not treat tokenless oEmbed as a caption API.

**Store.** Same as Instagram and Facebook. Render the embed or don't use the endpoint. Do not persist post text from it.

### TikTok

**US terms, fetched in full enough to quote the operative clause.** <https://www.tiktok.com/legal/page/us/terms-of-service/en>, **Last updated: July 15, 2026.** Contract is with TikTok USDS Joint Venture LLC. "You form a contract with us when you accept these Terms or when you otherwise use or access the Platform." Section 3.2: basic features can be used without an account, and "these Terms still apply to you."

Section 3.4:

> scrape, crawl, export or otherwise extract any data or content in any form, for any purpose, from the Platform using any automated system or software, including automated "bots," except as approved in writing by TikTok USDS Joint Venture

Also forbidden without written authorization: reverse engineering any component, "including its algorithms, code, or infrastructure." The Platform definition in section 1 expressly includes "the TikTok embeddable media player" and "enabling third party search engines to surface public TikTok content." So the embed player is a TikTok-provided system. A household server pulling `__UNIVERSAL_DATA_FOR_REHYDRATION__`, `desc`, or a speech-to-text WebVTT URL out of the video page is an automated extraction, and it is not the embed player.

**Other regions, search excerpts only, full pages not re-opened while drafting.**

- EEA/UK/CH terms, last updated August 2025, as returned in search: extract data or content "using any automated system or software that is not provided by TikTok or approved in writing by TikTok." URL pattern: <https://www.tiktok.com/legal/page/eea/terms-of-service/en>.
- Rest-of-world terms, last updated 1 December 2025, as returned in search: do not "use automated scripts to collect information from or otherwise interact with the Services."

Those two excerpts match the US rule closely enough that the product answer does not depend on region: do not fetch the video page.

**robots.txt.** <https://www.tiktok.com/robots.txt>, fetched 2026-11-04, truncated after the Bingbot block. A long list of AI and search bots is `Disallow: /` (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, meta-externalagent, Bytespider, and others). `User-agent: *` allows `/foryou`, `/discover`, `/share`, `/music`, and similar, and disallows `/embed/@`, `/embed/v2`, `/link`, `/search`, `/api/share/settings`, `/api/recommend/embed_videos`, and more. An allow in robots.txt is not permission under section 3.4.

**oEmbed.** Docs: <https://developers.tiktok.com/docs/en/embed-videos>, last updated October 23, 2026, as read earlier in this research: "Embed Videos will be deprecated soon. Existing integrations will migrate automatically. We recommend using Embed Player for new integrations." That docs page was **not** re-opened while drafting. The live call was.

**Live call, 2026-11-04.** `GET https://www.tiktok.com/oembed?url=https://www.tiktok.com/@scout2015/video/6718335390845095173` (TikTok's documented sample). HTTP 200. Keys: `embed_product_id`, `embed_type`, `height`, `html`, `provider_name`, `provider_url`, `type`, `version`, `width`. No `title`, no `author_name`. `html` is an iframe to `https://www.tiktok.com/player/v1/6718335390845095173?embed_from=oembed&music_info=1&description=1&autoplay=1&muted=1`. `description=1` is a query flag so TikTok's player can show the description. The caption text is not in the JSON. Third-party writeups that still list `title` and `author_name` on the video endpoint are out of date. A creator-profile oEmbed example in the docs does include `title` and `author_name` for a profile URL; that is not the video caption. Embed Player docs (last updated October 28, 2026, not re-opened while drafting) are the recommended replacement and likewise display the description inside TikTok's player.

**Display API.** Overview and get-started pages were read earlier (<https://developers.tiktok.com/doc/display-api-overview> and the Login Kit flow). Endpoints are on the order of `/v2/user/info/`, `/v2/video/list/`, `/v2/video/query/`. The creator must authorize the app. `video_description` is capped (150 characters in the docs as previously read), and cover image URLs expire (6 hours, as previously read). This returns the authorizing user's own videos. It does not accept an arbitrary public URL from someone who has not connected TikTok. A household app can use it only for the household member who completes Login Kit, and only for that member's videos. It does not solve "paste a creator's link."

**Research API.** FAQ fetched 2026-11-04, "Last updated September 1, 2026," <https://developers.tiktok.com/> research FAQ (page title "Frequently Asked Questions | TikTok for Developers"):

> I am a creator, advertiser, or commercial user. Am I eligible for access to the Research Tools? No.

Daily quota stated there: 1,000 requests per day, up to 100,000 records per day. Eligibility text on the same page and the linked Research Tools page is an application for a specific research project. A self-hosted household app does not qualify. A developer account alone "is not sufficient."

**Store.** Nothing in the video oEmbed response is recipe text. Do not store the iframe's description by fetching the player page or the video page. Showing TikTok's iframe is the provided system. User-pasted caption text is the user's copy in your database, not a TikTok extract.

### Pinterest

**Terms.** <https://policy.pinterest.com/en/terms-of-service>, fetched 2026-11-04. The page says both "Effective date: April 30, 2025" and, in a banner, "We're updating our Terms of Service, effective November 12, 2026," with a preview link. The November 12 text was not fetched. The clause below is the current text.

Section 2(a):

> In using Pinterest, you agree not to scrape, collect, search, copy or otherwise access data or content from Pinterest in unauthorized ways, such as by using automated means (without our express prior permission), or access or attempt to access data you do not have permission to access.

And: "Any use of Pinterest not expressly permitted by these Terms is a breach of these Terms and may violate copyright, trademark, and other laws."

Section 2(c): commercial use requires a business account and the Business Terms of Service (<https://business.pinterest.com/business-terms-of-service>). Those business terms were **not** re-opened while drafting. The consumer clause already covers automated access.

The terms also say that by accessing or using Pinterest you agree to be bound. That is Pinterest's formation position. It is not a court holding about a logged-out server. The product rule still follows the clause.

**Developer terms.** <https://developers.pinterest.com/terms/> was located earlier and **not** re-opened while drafting. The earlier reading recorded a ban on automated means or scraping except as expressly permitted, and a ban on using the materials to access Pinterest Data in unauthorized ways. Treat the exact wording as unverified in this draft. API v5, from Pinterest's developer docs as previously read, needs a business account, an app, review, and an OAuth token for the Pinterest user. It manages that user's pins, boards, and ads. It is not a no-login lookup of any public pin by URL.

**oEmbed / widgets.** Widgets are documented at <https://developers.pinterest.com/docs/web-features/widgets/> (Pin, Board, Profile). That page does not state a storage policy for `oembed.json` fields. `oembed.com` lists `title` as an optional oEmbed field. The owner's test (title, author_name, thumbnail_url, html, no outbound recipe link) was **not** repeated, because no official sample pin URL was used. Rendering Pinterest's widget is the permitted display. Copying `title` into a recipe record is not "expressly permitted" by any clause that was fetched. Call that grey, and do not do it under this product rule.

**robots.txt.** <https://www.pinterest.com/robots.txt>, fetched 2026-11-04, truncated inside the bot-name list, before any `Disallow`. It starts with "Allowlist your bot: https://help.pinterest.com/bot-submission-form". The `User-agent: *` rules are **unknown**.

### YouTube

**Terms of Service.** Desktop English <https://www.youtube.com/t/terms> was not retrieved. `robots.txt` disallows `/t/terms`. Search returned the English text on <https://m.youtube.com/t/terms> with the heading "Dated: December 15, 2023," and the same restriction in the current Spanish terms (<https://www.youtube.com/t/terms?hl=es>). The restriction, in that English extract:

> access the Service using any automated means (such as robots, botnets or scrapers) except (a) in the case of public search engines, in accordance with YouTube's robots.txt file; or (b) with YouTube's prior written permission

And, same list: you may not access or reproduce any part of the Service or Content except as expressly authorized by the Service or with prior written permission. The embeddable player is called out as allowed ("You may also show YouTube videos through the embeddable YouTube player"). A 2018 English archive with an older "more requests than a human" robots clause is **not** the current text. Confidence on the English wording is medium-high because the Spanish page matches and the mobile English extract is explicit, and the desktop page itself was not opened.

Paid Service Terms effective 29 July 2026 are a different document and do not replace the main terms.

**robots.txt.** <https://www.youtube.com/robots.txt>, fetched 2026-11-04. `User-agent: *` disallows `/api/`, `/get_video`, `/get_video_info`, `/timedtext_video`, `/watch_ajax`, `/watch_popup`, `/youtubei/`, `/results`, `/comment`, `/t/terms`, `/login`, and others. It does **not** disallow `/watch`. That does not authorize a scraper. The terms' exception is for public search engines following robots.txt, not for a recipe app.

**oEmbed, live call, 2026-11-04.** `GET https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=M3r2XDceM6A` (the oEmbed.com example, "Amazing Nintendo Facts" by ZackScott). HTTP 200. Keys include `title` ("Amazing Nintendo Facts"), `author_name` ("ZackScott"), `author_url`, `thumbnail_url`, and `html` pointing at `https://www.youtube.com/embed/M3r2XDceM6A`. No description.

oEmbed is not the YouTube Data API. The 30-day rule below is a Data API rule. Nothing in the oEmbed response says you may store `title` permanently as your own recipe record. Showing it beside the official player is the ordinary embed use. Persisting it as cookbook data is grey. The safe choice is not to.

**Data API and storage.** YouTube API Services Developer Policies, <https://developers.google.com/youtube/terms/developer-policies>, fetched 2026-11-04 (page truncated by the fetch tool at 30,720 of 94,314 bytes; the storage section was inside the saved portion).

Section III.E.4.d:

> API Clients may temporarily store limited amounts of Non-Authorized Data for as long as is necessary for the purposes of the API Client but not longer than 30 calendar days. ... after 30 calendar days, the API Client must either delete or refresh the stored data.

"Non-Authorized Data" is API Data accessible without user credentials. A `videos.list` call with an API key, including `snippet.title` and `snippet.description`, is Non-Authorized Data.

Section III.E.4.c: other Authorized Data, not in the longer-lived statistics/analytics buckets, is also kept "no longer than 30 calendar days," then delete or refresh.

Section III.E.4.h:

> Your API Clients must not (i) replace API Data with similar, independently calculated data, or (ii) access or use API Data to create new or derived data or metrics.

The examples are likes and view-based scores, not recipes. A structured recipe extracted from `snippet.description` is still a new artifact made from API Data, and the description itself cannot sit in the database past 30 days unless refreshed from the API. Refreshing forever does not make a derived recipe lawful under III.E.4.h, and a household cookbook that must delete or rewrite itself every 30 days is a bad product. An additional June 1, 2026 derived-metrics exception for audited analytics developers was described in earlier research and was **not** in the portion relied on here. Do not count on it. It would not cover a recipe even if it exists: that research note said titles, creator names, descriptions, and comment text stay on the 30-day rule.

Quota: an API key from a Google Cloud project is required (Policies, III.D). The published default of 10,000 units/day and the cost of 1 for `videos.list` were **not** re-opened while drafting. See <https://developers.google.com/youtube/v3/determine_quota_cost>. Policies also forbid masking identity and sharding projects to multiply quota.

**Store and display.** Allowed display of a video is the embeddable player. If Foodable ever calls the Data API, it must show YouTube's Terms link, have its own privacy policy before users can use the client (III.A), and delete or refresh stored API Data within 30 days, including when a user asks (user-data deletion within 7 days, III.E.4.g). That apparatus is disproportionate for a few imports a week, and it still does not yield a permanent recipe. Do not use the Data API as the recipe source.

### Ordinary recipe websites

**No specific site terms were opened** (not Allrecipes, NYT Cooking, Serious Eats, or BBC Good Food). Many publishers' terms forbid scraping, copying, or automated access. That has to be checked per site before a server fetch, or treated as a residual contract risk. See the unverified list.

schema.org `Recipe` JSON-LD is the document sites publish so that machines can read ingredients and instructions. Parsing that block on a page the user just asked for is the route recipe managers actually use. It is not a license, and it is not a robots.txt exemption.

**Is one user-triggered fetch "crawling"?** Google's own docs draw that line. <https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers>, fetched 2026-11-04:

> User-triggered fetchers are initiated by users to perform a fetching function within a Google product. ... Because the fetch was requested by a user, these fetchers generally ignore robots.txt rules.

The same page lists Feedfetcher, Google Messages link previews, Google Read Aloud, and others, and warns that a User-Agent string can be spoofed. This is Google describing Google. It is not permission for Foodable to ignore robots.txt or a site's contract. It is evidence that a single fetch a person just requested is treated, by at least one major operator, as different from a crawler that walks a site on its own schedule.

RFC 9309 (robots exclusion protocol) was **not** read. robots.txt is a voluntary protocol plus, on Meta's properties, an express notice. A `Disallow` is a strong signal to stop. An allow, or a missing file, is not a grant of rights.

**Best-practice User-Agent for a recipe-site fetch.** Identify the client and give a contact. Do not use a browser User-Agent to look like Chrome, and do not use `facebookexternalhit`, `Googlebot`, `bingbot`, or any other bot's token. Example shape: `Foodable/1.0 (+https://example.invalid/contact; one user-requested recipe import)`. Fetch the one URL the user submitted. Honor `robots.txt` for that path. Stop on 401, 403, 429, or a `noindex` you cannot honestly ignore. Do not follow pagination, do not download every image, do not keep the raw HTML longer than needed to parse. If JSON-LD `Recipe` is absent, ask the user to paste the text. Cache the recipe the user saved, not a mirror of the site.

### Share sheet and pasted text (all platforms)

**Pasted text.** The user copies the caption and pastes it into Foodable. Foodable does not contact the platform. That is the clean route on every platform above. Threads' "manual process" clause is about a manual process that extracts from the Threads Service, not about a person typing into a different application.

**OS share sheet and PWA `share_target`.** The Web Share Target spec lets a PWA register to receive `title`, `text`, and `url` from the operating system's share sheet (<https://w3c.github.io/web-share-target/> and the MDN `share_target` manifest member). The receiver gets whatever the sending app put in the payload. **No Instagram, Facebook, Threads, TikTok, Pinterest, or YouTube document was found that says whether Share includes the caption or only the URL.** Secondary app marketing (section 4) describes "tap Share, pick the recipe app, it gets the recipe," and does not show a payload dump. Some of those apps may be fetching the page after they receive the URL. That would not become lawful because the user tapped Share.

Implement `share_target` only as a way to receive user-supplied fields. If `text` is present, offer it as the source text. If only `url` is present, do not fetch the social page. Ask the user to paste the caption, and optionally show the official embed.

---

## 3. Legal background (not legal advice)

Three different questions get conflated. Separating them is the point of this section.

**CFAA (access "without authorization").** _hiQ Labs, Inc. v. LinkedIn Corp._, 31 F.4th 1180 (9th Cir. Apr. 18, 2022), on remand after _Van Buren v. United States_, 141 S. Ct. 1648 (2021): <https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf>. The Ninth Circuit held that scraping publicly accessible LinkedIn profiles, with no authentication gate, likely does not violate the CFAA, because "without authorization" is about breaking into a system that has restricted access, not about a website's wish that the public not copy what it shows to everyone. The opinion text was not re-read line by line while drafting; the holding is the published one at that URL.

That CFAA result did not end the case. Later district-court proceedings (summary judgment in November 2022, and a consent judgment and permanent injunction in December 2022) found hiQ in breach of LinkedIn's User Agreement. hiQ had agreed to those terms, and the facts included logged-in access with fake accounts. A CFAA win is not a terms win. Docket context: <https://www.courtlistener.com/docket/4176410/hiq-labs-inc-v-linkedin-corporation/>.

**Contract.** _Meta Platforms, Inc. v. Bright Data Ltd._, No. 3:23-cv-00077-EMC (N.D. Cal., order Jan. 23, 2024, Judge Edward Chen): <https://www.courtlistener.com/docket/66748224/meta-platforms-inc-v-bright-data-ltd/>. Summary judgment for Bright Data on the breach-of-contract claim for logged-off scraping of publicly available Facebook and Instagram data, including after Bright Data's accounts were terminated. The court treated the terms then in force as not reaching logged-off collection of public data. The full order was not re-read while drafting.

Meta has since changed the terms. Facebook's Terms, effective January 1, 2025, and the Instagram terms fetched on 2026-11-04, both say the automated-collection ban applies "regardless of whether" the collection happens while logged in. The Automated Data Collection Terms say they begin when you accept them **or otherwise engage** in Automated Data Collection. That is Meta's drafting position. **No 2025 or 2026 opinion was found that decides whether those new sentences bind a person who never created an account and never clicked agree.** Browsewrap (a link in a footer) is harder to enforce than clickwrap (an "I agree" on signup). _Bright Data_ is about the old terms. It is not a holding that the new sentence fails, and it is not a holding that the new sentence works against a stranger.

_X Corp. v. Bright Data Ltd._, No. 3:23-cv-03698-WHA (N.D. Cal., May 9, 2024, Judge Alsup): <https://www.courtlistener.com/docket/67586683/x-corp-v-bright-data-ltd/>. The complaint was dismissed. As pleaded, scraping and selling public posts did not state a claim. The order followed _hiQ_ on platforms not owning public data, and it said a terms violation by itself did not state trespass or fraud without harm to the servers or a misrepresented identity. The order left technological self-help in place (blocking, rate limits). This is an X case, not a Meta, TikTok, Pinterest, or YouTube case. The opinion was not re-read while drafting.

**What this means for Foodable.** A logged-out, one-URL fetch of a public page is a weak CFAA case under _hiQ_ and _Van Buren_, and contract formation against a server that never opened an account is genuinely unsettled after _Bright Data_. Copyright can still apply to the text that is copied. And the product decision on the table is not "will a court make us stop." It is "we will not go against the terms." On that rule, Instagram §4.2, Facebook §3.2.3, the Automated Data Collection Terms, Threads §3(a)(iv), TikTok §3.4, Pinterest §2(a), and the YouTube automated-means clause all forbid the server fetch. Low volume does not appear in any of those clauses as an exception.

**Copyright in recipes.** Not legal advice. 17 U.S.C. § 102(b) withholds copyright from any "idea, procedure, process, system, method of operation, concept, principle, or discovery" regardless of how it is described: <https://www.copyright.gov/title17/92chap1.html#102>.

U.S. Copyright Office, _Compendium of U.S. Copyright Office Practices_ (3d ed. 2021), the governing administrative manual for registrations on or after January 28, 2021: <https://www.copyright.gov/comp3>. Section 313.4(F), "Mere Listing of Ingredients or Contents," as printed in the Office's chapter 300 redline and consistent with the current manual's treatment:

> A mere listing of ingredients or contents is not copyrightable and cannot be registered with the U.S. Copyright Office.

The section cites 37 C.F.R. § 202.1(a). The Office's examples include "a list of ingredients for a recipe." The same discussion says the Office may register a cookbook or manual that contains enough explanatory text, photographs, or other expression, and that the registration does not extend to the ingredient list. It cites _Publications International, Ltd. v. Meredith Corp._, 88 F.3d 473, 480 (7th Cir. 1996) ("We do not view the functional listing of ingredients as original within the meaning of the Copyright Act."). The 1,396-page current PDF was not re-read cover to cover. The quoted sentence is the Office's published text for that section. A short set of bare directions can also be refused as de minimis authorship (Compendium § 313.4(B)); a caesar-dressing example of that kind appears in Office materials and was not re-opened. _Tomaydo-Tomahhdo, LLC v. Vozary_, 629 F. App'x 658 (6th Cir. 2015), is in the same line in secondary writing and the opinion was not re-read.

So: an ingredient list, and the bare method of the dish, are the uncopyrightable part. Headnotes, stories, photos, and creative wording of the steps can be copyrighted. Copying a site's instruction prose verbatim into Foodable can be a copyright problem even when the terms problem is solved by the user pasting it. Prefer the user's own wording, or the structured fields the site marked up as `Recipe`, and keep a link back. Do not store the site's photos.

---

## 4. How others do it

No primary source was found of an official Meta, TikTok, or Pinterest partnership, API entitlement, takedown, cease-and-desist, or lawsuit involving ReciMe, Paprika, Mealie, Tandoor, Samsung Food (Whisk), Pestle, Honeydew, or Crouton. Absence from this search is not proof that none exists.

What is public, almost all of it secondary (app store copy, 2025–2026 review roundups, vendor blogs):

- **ReciMe.** Marketing and reviews describe Share → ReciMe on iOS and Android. The app is said to read the caption, then fall back to audio, then to a link in the creator's profile. That is a description of the product, not a disclosure of whether the caption arrives in the share payload or the app fetches the page. No official API is named.
- **Paprika.** Paprika 3, the shipping app, is a web clipper / bookmarklet for ordinary recipe pages, not a social importer. Paprika 4, an open beta discussed in 2026 coverage (announcements clustered around mid-to-late 2026), is described as adding Instagram, TikTok, Facebook, and YouTube import behind the share button, aimed at a future paid tier. Secondary only.
- **Samsung Food (formerly Whisk).** A July 2025 news report, secondary, describes sharing from Instagram or TikTok and using AI on what is said or shown. No partnership document was found.
- **Pestle.** Secondary reviews say on-device Apple Intelligence parses captions the user shares from Instagram, TikTok, Facebook, and YouTube. If that is accurate, the parse happens on text already on the device. That was not confirmed from Apple's or Pestle's developer docs.
- **Tandoor.** Imports recipe-website HTML/schema through the usual recipe-scraper approach, and can import a Pestle **export file** (JSON the user already has). That file import is not a live fetch of Instagram. A 2026 security note about server-side request forgery in the Pestle importer, fixed before Tandoor 2.7.0, was seen in passing and not re-read; it is not evidence of a social-platform integration.
- **Mealie.** Same website-scraper pattern (schema.org and HTML). Social import was not documented in a vendor page that was opened.
- **Honeydew and Crouton.** Comparison posts disagree. Crouton is generally described as website import, OCR, and iCloud sync, not as a social-caption client. Honeydew is described, in some 2026 roundups, as having social import and, in others, as not. Vendor docs were not opened. Treat both as unknown.
- **2025–2026 change that is documented by the platforms, not by these apps.** Meta's oEmbed fields shrank on November 3, 2025 (no author, no thumbnail). Meta dropped the token requirement on June 15, 2026, and still does not return a caption. TikTok's video oEmbed no longer returns `title` or author and is marked for deprecation in favor of Embed Player. None of that is a new caption API.

The pattern that is consistent with the terms: the apps that work ask the user to tap Share, or to paste, and some then transcribe audio or frames **on device**. The pattern that is not consistent with the terms: a server that loads the post HTML, spoofs a crawler, or reads private JSON. Public reviews do not prove which pattern a given app uses.

---

## 5. What Foodable should build

Stay inside every platform's written terms. The user is the source of recipe text for social posts. The server does not fetch those posts.

**All social platforms (Instagram, Facebook, Threads, TikTok, Pinterest, YouTube).**

1. Do not GET the post or video page. Not with `facebookexternalhit`, not with a browser User-Agent, not with an honest User-Agent. The honest User-Agent fixes impersonation and does not fix the automated-collection ban.
2. Do not parse `og:` tags, `__UNIVERSAL_DATA_FOR_REHYDRATION__`, embedded captions, or WebVTT URLs.
3. Do not mine oEmbed `html` for text. Instagram forbids it in those words. The others forbid the resulting use (storage and derivation) even where the embed call itself is allowed.
4. Optional and within terms: if the user pastes a URL, show the platform's official embed (Instagram blockquote, Facebook/Threads embed HTML, TikTok player, Pinterest widget, YouTube iframe) as a view, with the permalink. Do not persist the embed payload as the recipe. If the embed is disabled, show the bare link.
5. The recipe itself: a paste box, pre-filled only from text the user pasted or from `share_target` `text`/`title` if the OS actually sent them. If the share payload is only a URL, stop and ask for the caption. Do not "helpfully" fetch.
6. Store that user-supplied text as the household's recipe. Keep the source URL as a link-back and show the creator's name if the user included it. Do not download or store the platform's images or video. If the user deletes the recipe, delete the text.
7. Skip the official APIs that need a connected account (Instagram Graph, TikTok Display, Pinterest v5, Threads API). They do not answer "any public URL," and they add app review, business verification, and tokens a household deploy should not hold. Skip TikTok Research API. Skip YouTube Data API unless you are willing to build the 30-day delete-or-refresh machinery and still not keep a recipe; that is the wrong tool here.

**YouTube, specifically.** Embed the player. Let the user paste the description. oEmbed `title` and `author_name` may be shown next to the player. Do not write them into the permanent recipe unless you accept the grey area; the conservative build copies them only after the user confirms, as user-supplied fields, or not at all.

**Ordinary recipe sites.** This is the one server fetch worth building.

- User submits one URL.
- User-Agent identifies Foodable and a contact address. One request, no crawl, no concurrency, a few imports a week is already inside any sane rate.
- Read robots.txt for that host. If the path is disallowed, do not fetch. Offer paste instead.
- Parse `script[type="application/ld+json"]` for `@type` of `Recipe` (including it inside `@graph`). Map `name`, `recipeIngredient`, `recipeInstructions`. Ignore the rest of the page if JSON-LD is present.
- If there is no `Recipe` block, do not invent a scraper for arbitrary HTML as a silent fallback. Tell the user, and offer paste. A heuristic HTML scraper is where site terms and copyright in prose get worst.
- Do not store the site's images. Link to the original. Keep the parsed ingredients and steps the user accepted, because that is the household's copy of a method, and drop the raw HTML.
- Per-site terms were not reviewed. A site can still forbid this by contract. If you later add a host whose terms you have read and they forbid all automated access, disable the fetch for that host.

**What not to build.** A "works with any link" importer that server-fetches social URLs. A User-Agent switch that tries `facebookexternalhit` when the browser User-Agent returns an empty page. A subtitle downloader. A thumbnail fetcher that follows the April 2025 blog's HTML-metadata sentence. A cache of other people's captions "just in case."

---

## 6. Not verified

Stated plainly. These were not established by a page opened in this research, or were only half-read.

- Desktop English YouTube Terms at `youtube.com/t/terms`. The mobile English extract is dated December 15, 2023, and the Spanish terms match the automated-means clause. The desktop document itself was not opened. robots.txt disallows `/t/terms`.
- The exact `User-agent: *` rules for instagram.com, facebook.com, and threads.net. Only the first ~1,800 characters were fetched. The prohibition notice at the top was fetched. Pinterest robots.txt was truncated before any `Disallow`.
- Whether the Facebook oEmbed docs contain Instagram's "strictly prohibited" sentence. The v27.0 video reference that was fetched does not. The Automated Data Collection Terms still limit use.
- A live Pinterest `oembed.json` response. The owner's field list was not re-checked. No official sample pin was used.
- Pinterest Developer Terms and Business Terms, exact current wording. Consumer §2(a) was fetched and is enough to forbid a server fetch.
- Pinterest API v5's current app-review checklist, beyond "business account, OAuth, the authorizing user's own data."
- Threads oEmbed reference page as updated November 3, 2026. The June 15, 2026 blog's field list was fetched. The older App Review requirement was not re-checked against that reference and may be stale.
- The higher token-based oEmbed rate (the "5 million per day" figure). The June 15, 2026 blog only says token-based limits may be higher.
- Instagram Basic Display shutdown post (recorded earlier as announced September 4, 2024, shut down December 4, 2024). Not re-opened while drafting.
- Meta web-crawler documentation listing `facebookexternalhit/1.1` and `meta-externalfetcher`. Not re-opened. The Automated Data Collection user-agent rule was fetched and does the legal work.
- TikTok Display API field caps (`video_description` length, cover URL TTL) and Embed Player / Embed Videos docs. Behavior of video oEmbed was confirmed with a live call. The docs pages were not re-opened while drafting.
- TikTok EEA/UK/CH and rest-of-world terms, full text. Search excerpts only.
- YouTube quota numbers (10,000 units/day, `videos.list` = 1) and the June 1, 2026 analytics derived-metrics exception. Not re-opened. III.E.4.d and III.E.4.h were fetched.
- What each mobile app puts in the iOS/Android share payload (URL only, or URL plus caption). No platform doc, no Apple or Google doc, no payload dump.
- RFC 9309, full text.
- Terms of particular recipe publishers (Allrecipes, NYT Cooking, and others).
- Full opinions, re-read while drafting, for _hiQ_, _Meta v. Bright Data_, _X v. Bright Data_, _Publications International v. Meredith_, and _Tomaydo-Tomahhdo_. Holdings above are tied to the published opinions and the Copyright Office manual; they were not re-quoted from a fresh read of every page.
- Any 2025–2026 case applying Meta's new "regardless of whether logged-in" sentence to a defendant who never had an account. None found. That is unknown, not a holding either way.
- Official partnerships, takedowns, cease-and-desist letters, or lawsuits involving ReciMe, Paprika, Mealie, Tandoor, Samsung Food, Pestle, Honeydew, or Crouton. None found.
- How those apps technically obtain captions (share-extension text, on-device model, or server scrape). Marketing claims only.
- Mealie and Tandoor docs, opened and checked, for social import. Not opened in the final pass.
- Whether a never-logged-in server is bound by browsewrap. The memo does not resolve that. The product rule does not depend on it.
