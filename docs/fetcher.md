# Foodable fetcher

[Foodable](https://github.com/MrF1ow/foodable) is a self-hosted app for one household. It is not a public search engine or crawler.

## Why you saw this request

A household member pasted a link to import a recipe. Foodable made **one** HTTPS request for that import, or **two** when a TikTok read also fetches that video's subtitle file. It fetches `robots.txt` once per host (cached for a day), checks it before the page and on every redirect hop (up to **3** redirects for a page, **5** for a robots fetch), sends an honest user agent, does not retry failed requests, and does not crawl, paginate, or download images. Raw pages are not kept after the recipe or caption is read.

## User agent

```
Mozilla/5.0 (compatible; Foodable/<version>; +https://github.com/MrF1ow/foodable/blob/main/docs/fetcher.md)
```

`<version>` matches the deployed app version. The `Foodable` token is what `robots.txt` should name.

## Block Foodable

To refuse these requests, add to your site's `robots.txt`:

```
User-agent: Foodable
Disallow: /
```

A **401**, **403**, or **429** response stops the import with no retry. After that, Foodable remembers the host for **7 days** and skips further requests for any recipe link on that host (use **Check again** on the import error or **Try again** in Household › Recipe settings to lift it sooner). A **404** or **410** is remembered for that exact cleaned link (**30 days** for **404**, **410** permanently until someone checks again).

## Contact

Questions or abuse reports: [GitHub issues](https://github.com/MrF1ow/foodable/issues).
