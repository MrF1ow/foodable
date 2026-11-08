# Product score: plan

Status: proposed, 2026-11-07. Food only; cosmetics are out of scope.

Show how good a packaged food is, the way Yuka does, and what it means for each person in the household. Yuka cannot do the second part, because it does not know who lives in the house.

## Why Open Food Facts, and nothing else

We looked for open-source Yuka alternatives. For food, Open Food Facts is the only real source: an open database (ODbL, no API key) that already computes the parts of a rating. The open apps we found (OFF's own `smooth-app`, OpenPharm, Nutrifact) are views over OFF data, so there is nothing to adopt beyond the data. Yuka's own score is proprietary; its published method weights Nutri-Score 60%, additives 30% and organic 10%.

`lookupBarcode` in `src/foods.ts` calls the OFF v2 product API. The same call returns every quality field below, and SCORE-1 stores them on the household `foods` row.

## Data (SCORE-1)

Store on `foods`, as additive columns, from the OFF product:

- `nutriscore_grade` (a–e), `nova_group` (1–4), `ecoscore_grade` (Green-Score, A+–F; stored as `a-plus`, `a`–`f`)
- additives (`additives_tags`), each with OFF's over-exposure risk tier (high, moderate, none or very low)
- `allergens_tags` and `traces_tags` ("may contain")
- `ingredients_analysis_tags` (palm oil, vegan, vegetarian) and `labels_tags` (for organic)
- when the data was fetched

Null means unknown, never a bad grade. OFF writes `unknown` and `not-applicable` for unscored products; both map to null. These are product-level facts, not per-100 g or per-serving values, so the serving-size trap in `catalogNutritionFromOff` does not apply. Foods without a barcode simply have none of this. Existing barcode foods fill in on their next lookup or through a one-off backfill. A barcode OFF does not know is stamped with an all-null quality and a fetch time, so later scans skip OFF; a later `lookup_barcode` hit replaces the stamp. An OFF entry with no core macros counts as a miss today, so its quality is not kept.

## Score with configurable weights (SCORE-2, SCORE-3)

A pure `scoreProduct(product, weights)` in `src/domain/`, tested with fixtures. Each part becomes 0–100:

| Part        | From                | 0–100                                                                 |
| ----------- | ------------------- | --------------------------------------------------------------------- |
| Nutrition   | Nutri-Score         | A = 100 … E = 0                                                       |
| Processing  | NOVA                | 1 = 100 … 4 = 0                                                       |
| Additives   | additive risk tiers | starts at 100, minus a penalty per additive by tier; any high caps it |
| Environment | Green-Score         | A+ = 100 … F = 0 (map `a-plus` and `f` as well as `a`–`e`)            |
| Organic     | organic label       | a bonus only, never a penalty                                         |

The overall score is the weighted mean of the parts that are known. A missing part drops out and the remaining weights scale up; the result says which parts it used ("scored on 2 of 3"). Below a minimum of known weight it is "not enough data", not a number. Every score comes with its breakdown. SCORE-2's Environment mapping must treat Green-Score A+ and F the same way the stored `ecoscore_grade` values do.

Weights are presets with sliders underneath: Balanced (close to Yuka's split), Whole foods (processing heavy), Additive-averse, Planet-friendly, and Custom. They are stored per member, with a household default, and the score is computed on read, so changing weights re-scores everything at once.

Open: the exact penalty per additive tier and the minimum known weight. Pick them with fixtures of real products when SCORE-2 starts.

## What it means for each person (SCORE-4)

A pure `checkProductForMember(product, member, today)` returning notices, one card per member:

- **Allergens.** Member allergens use the codes in `src/domain/rules.ts`. Map OFF tags onto them (`en:peanuts` → peanut, `en:nuts` → tree_nut, `en:milk` → milk, `en:eggs` → egg, `en:soybeans` → soy, `en:fish` → fish, `en:crustaceans` / `en:molluscs` → shellfish, `en:sesame-seeds` → sesame). A match is `block`, like the existing grocery and recipe allergen notices. OFF mostly tags gluten, not wheat: `en:gluten` → wheat is a "possible" warning, not a block.
- **Traces.** A "may contain" match is `warn`.
- **Goals.** A serving against what is left of today's goals ("18 g sugar, 9 g left today"). Reads the existing goals and today's totals.
- **Dislikes.** Free text, so a fuzzy match against the ingredient list. `info`, never a block.

Diet checks (vegan, vegetarian, palm oil) need a structured diet preference; person rules are free text today. That is a decision (SCORE-7), not part of SCORE-4.

## Where it shows (SCORE-5, SCORE-6)

- The food page and the barcode lookup result in the web app: the score, its breakdown, and the per-member cards. The camera scan (BAR-2) lands on the same result.
- An MCP tool, `rate_product`, taking a barcode or `food_id` and an optional member, returning the score, breakdown and checks as `structuredContent`. Update `TOOLS` and the tools-list snapshot in the same PR.
