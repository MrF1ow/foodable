import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseIngredientLines } from "./ingredient-lines.js";
import { prepareImportedRecipe } from "./recipe-import.js";
import { readRecipeJsonLd } from "./recipe-jsonld.js";
import {
    BUNDLED_MENTION_WORDS,
    MENTION_KINDS,
    MENTION_NOT_FOOD_WORDS,
    MENTION_OWN_FOODS,
    MENTION_PART_WORDS,
    MENTION_SYNONYMS,
} from "./recipe-mention-words.js";
import { findMissingMentions } from "./recipe-mentions.js";

type Ingredient = {
    name: string;
    foodName?: string | null;
    foodId?: string;
    genericFoodId?: string | null;
    genericFoodName?: string | null;
};

function warn(
    steps: string[],
    ingredients: Ingredient[],
    extra: {
        vocabulary?: { name: string; foodId?: string }[];
        dismissed?: string[];
    } = {},
) {
    return findMissingMentions({
        instructions: steps.join("\n"),
        ingredients,
        vocabulary: extra.vocabulary ?? [],
        dismissed: extra.dismissed,
    });
}

const names = (list: { key: string }[]) => list.map((w) => w.key);

describe("findMissingMentions on a real imported page", () => {
    test("Pad See Ew: the steps scramble an egg the ingredients never list", async () => {
        const html = await Bun.file(
            join(import.meta.dir, "fixtures/recipe-pages/pad-see-ew.html"),
        ).text();
        const jsonld = readRecipeJsonLd(html);
        expect(jsonld).not.toBeNull();
        const prepared = prepareImportedRecipe({
            name: jsonld!.name,
            fallbackName: "Recipe",
            yieldPortions: jsonld!.yieldPortions,
            steps: jsonld!.instructions,
            prepMinutes: jsonld!.prepMinutes,
            cookMinutes: jsonld!.cookMinutes,
            parsed: parseIngredientLines(jsonld!.ingredients),
        });
        const found = findMissingMentions({
            instructions: prepared.instructions,
            ingredients: prepared.parsed.items.map((item) => ({
                name: item.name,
            })),
            vocabulary: [],
        });
        expect(found).toHaveLength(1);
        const [egg] = found;
        expect(egg!.key).toBe("egg");
        expect(egg!.food).toBe("egg");
        expect(egg!.note).toBe("lightly beaten");
        expect(egg!.amount).toBeNull();
        expect(egg!.excerpt).toContain("lightly beaten egg");
        expect(egg!.message).toBe(
            "The steps mention egg, which isn't an ingredient.",
        );
    });
});

describe("findMissingMentions stays quiet when the ingredients cover it", () => {
    test("a listed 'egg noodles' covers 'the noodles'", () => {
        expect(warn(["Add the noodles."], [{ name: "egg noodles" }])).toEqual(
            [],
        );
    });

    test("deliberate false negative: a listed 'egg noodles' also covers a bare 'egg'", () => {
        // The household would rather miss a warning than get a false one, so
        // any ingredient that contains the words covers the mention.
        expect(warn(["Scramble the egg."], [{ name: "egg noodles" }])).toEqual(
            [],
        );
    });

    test("salt listed covers 'season with salt'", () => {
        expect(warn(["Season with salt."], [{ name: "salt" }])).toEqual([]);
    });

    test("a listed 'vegetable oil' covers 'a little oil'", () => {
        expect(
            warn(
                ["Toss with a little oil."],
                [{ name: "vegetable oil", foodName: "Vegetable oil" }],
            ),
        ).toEqual([]);
    });

    test("a listed 'dark soy sauce' covers 'soy sauce'", () => {
        expect(
            warn(["Stir in the soy sauce."], [{ name: "dark soy sauce" }]),
        ).toEqual([]);
    });

    test("the food name of a linked ingredient counts as well as its line name", () => {
        expect(
            warn(
                ["Beat the eggs."],
                [{ name: "large ones", foodName: "Eggs" }],
            ),
        ).toEqual([]);
    });

    test("a plural step word is covered by the singular ingredient and the reverse", () => {
        expect(warn(["Chop the tomatoes."], [{ name: "tomato" }])).toEqual([]);
        expect(warn(["Chop the tomato."], [{ name: "tomatoes" }])).toEqual([]);
    });

    test("a catalog mention is covered by an ingredient holding the same food id", () => {
        expect(
            warn(
                ["Stir in the gochujang."],
                [{ name: "red paste", foodId: "f-1" }],
                { vocabulary: [{ name: "Gochujang", foodId: "f-1" }] },
            ),
        ).toEqual([]);
    });

    test("water and ice never warn, in any form", () => {
        for (const step of [
            "Boil water.",
            "Add cold water.",
            "Pour in the boiling water.",
            "Add ice.",
            "Drop in a few ice cubes.",
            "Top with ice water.",
        ]) {
            expect(warn([step], [])).toEqual([]);
        }
    });

    test("water and ice stay quiet even when the household catalog has them", () => {
        expect(
            warn(["Boil water. Add ice."], [], {
                vocabulary: [
                    { name: "Water", foodId: "w" },
                    { name: "Ice", foodId: "i" },
                ],
            }),
        ).toEqual([]);
    });

    test("generic references never warn", () => {
        for (const step of [
            "Pour over the sauce.",
            "Heat the pan.",
            "Stir the mixture.",
            "Preheat a wok or large skillet.",
            "Whisk the batter into the dough.",
            "Toss with the dressing and the marinade.",
        ]) {
            expect(warn([step], [])).toEqual([]);
        }
    });

    test("generic catalog foods named like a vessel or category stay quiet", () => {
        expect(
            warn(["Heat the pan. Pour over the sauce."], [], {
                vocabulary: [
                    { name: "Pan", foodId: "p" },
                    { name: "Sauce", foodId: "s" },
                ],
            }),
        ).toEqual([]);
    });
});

describe("findMissingMentions warns about a real gap", () => {
    test("'add 2 eggs' with no egg listed carries the amount 2", () => {
        const found = warn(["Add 2 eggs and stir."], [{ name: "flour" }]);
        expect(found).toHaveLength(1);
        expect(found[0]!.key).toBe("egg");
        expect(found[0]!.food).toBe("egg");
        expect(found[0]!.amount).toBe(2);
        expect(found[0]!.note).toBeNull();
    });

    test("an amount in words and a fraction are read too", () => {
        expect(warn(["Add two eggs."], [])[0]!.amount).toBe(2);
        expect(warn(["Add 1/2 onion."], [])[0]!.amount).toBe(0.5);
    });

    test("a number then descriptive words before the mention gives amount and note", () => {
        const [onion] = warn(["Fry 2 finely chopped onions."], []);
        expect(onion!.key).toBe("onion");
        expect(onion!.amount).toBe(2);
        expect(onion!.note).toBe("finely chopped");
    });

    test("a catalog-only food carries its food id", () => {
        const found = warn(
            ["Stir in a spoon of gochujang."],
            [{ name: "rice" }],
            { vocabulary: [{ name: "Gochujang", foodId: "food-gochu" }] },
        );
        expect(found).toHaveLength(1);
        expect(found[0]!.food).toBe("gochujang");
        expect(found[0]!.key).toBe("gochujang");
        expect(found[0]!.foodId).toBe("food-gochu");
    });

    test("a catalog entry wins over the bundled word and keeps the singular key", () => {
        const [egg] = warn(["Beat the eggs."], [], {
            vocabulary: [{ name: "Eggs", foodId: "food-egg" }],
        });
        expect(egg!.foodId).toBe("food-egg");
        expect(egg!.key).toBe("egg");
        expect(egg!.food).toBe("egg");
    });

    test("a dismissed key drops the warning", () => {
        const steps = ["Add 2 eggs and 1 onion."];
        expect(names(warn(steps, []))).toEqual(["egg", "onion"]);
        expect(names(warn(steps, [], { dismissed: ["egg"] }))).toEqual([
            "onion",
        ]);
    });

    test("one warning per food, in step order, from the first mention", () => {
        const found = warn(
            ["Heat butter, then add the onion.", "Add the egg.", "More egg."],
            [],
        );
        expect(names(found)).toEqual(["butter", "onion", "egg"]);
        const again = warn(["Add the egg.", "Add 3 eggs."], []);
        expect(again).toHaveLength(1);
        expect(again[0]!.amount).toBeNull();
        expect(again[0]!.excerpt).toBe("Add the egg.");
    });

    test("the longest vocabulary phrase wins", () => {
        const found = warn(["Splash in some dark soy sauce."], []);
        expect(names(found)).toEqual(["dark soy sauce"]);
        const plain = warn(["Splash in some soy sauce."], []);
        expect(names(plain)).toEqual(["soy sauce"]);
    });

    test("a listed 'soy sauce' covers a 'dark soy sauce' mention", () => {
        // The mention ends in a shorter food the household does list.
        expect(
            warn(["Splash in some dark soy sauce."], [{ name: "soy sauce" }]),
        ).toEqual([]);
    });

    test("an unrelated listed 'soy' does not cover a 'dark soy sauce' mention", () => {
        expect(
            names(warn(["Splash in some dark soy sauce."], [{ name: "soy" }])),
        ).toEqual(["dark soy sauce"]);
    });

    test("words match whole words only", () => {
        expect(warn(["Use a pegged board."], [])).toEqual([]);
        expect(warn(["The riceball rolled."], [])).toEqual([]);
    });

    test("optional and garnish clauses still warn", () => {
        // A garnish the steps name is still a food the household may need to
        // buy; no fixture shows skipping it removes noise.
        expect(
            names(
                warn(
                    ["Garnish with cilantro.", "Serve with lime (optional)."],
                    [],
                ),
            ),
        ).toEqual(["cilantro", "lime"]);
    });

    test("the excerpt is the sentence and stays short", () => {
        const long =
            "Meanwhile, " +
            "keep stirring the pot and watch it carefully as it thickens ".repeat(
                5,
            ) +
            "then add the egg " +
            "and keep stirring until the whole thing comes together nicely".repeat(
                3,
            ) +
            ".";
        const [egg] = warn([long], []);
        expect(egg!.excerpt.length).toBeLessThanOrEqual(170);
        expect(egg!.excerpt).toContain("egg");
    });

    test("no instructions, or only generic words, give no warnings", () => {
        expect(
            findMissingMentions({
                instructions: null,
                ingredients: [],
                vocabulary: [],
            }),
        ).toEqual([]);
        expect(warn([""], [])).toEqual([]);
    });
});

describe("bundled mention words", () => {
    test("is a reviewed list: no duplicates, lower-case, no water, ice or vessels", () => {
        const seen = new Set<string>();
        for (const word of BUNDLED_MENTION_WORDS) {
            expect(word).toBe(word.toLowerCase().trim());
            expect(seen.has(word)).toBe(false);
            seen.add(word);
        }
        for (const banned of [
            "water",
            "ice",
            "sauce",
            "pan",
            "wok",
            "skillet",
            "mixture",
            "dough",
            "batter",
            "marinade",
            "dressing",
        ]) {
            expect(seen.has(banned)).toBe(false);
        }
        for (const required of ["egg", "salt", "pepper", "oil", "soy sauce"]) {
            expect(seen.has(required)).toBe(true);
        }
    });
});

describe("clause breaks stop a phrase and an amount", () => {
    test("a comma or a sentence end splits a two-word food", () => {
        const listed = [
            { name: "chicken breast" },
            { name: "vegetable stock" },
            { name: "rice" },
        ];
        expect(warn(["Add the chicken, stock and rice."], listed)).toEqual([]);
        expect(
            warn(
                ["Place the chicken, breast side up, in the pan."],
                [{ name: "whole chicken" }],
            ),
        ).toEqual([]);
        expect(
            warn(["Fry until brown. Rice goes in next."], [{ name: "rice" }]),
        ).toEqual([]);
        expect(
            warn(
                ["Beat the egg, white sugar and vanilla."],
                [{ name: "egg" }, { name: "sugar" }, { name: "vanilla" }],
            ),
        ).toEqual([]);
    });

    test("an amount is not read across a sentence end", () => {
        const [egg] = warn(
            ["Heat the oven to 350. Eggs should be at room temperature."],
            [],
        );
        expect(egg!.key).toBe("egg");
        expect(egg!.amount).toBeNull();
    });
});

describe("a general food is covered by a listed kind of it", () => {
    test.each([
        ["Drain the pasta and toss.", "spaghetti"],
        ["Top with the cheese.", "shredded cheddar"],
        ["Add the noodles.", "udon"],
        ["Slice the peppers.", "jalapenos"],
        ["Pour in the broth.", "chicken stock"],
        ["Tear the lettuce.", "romaine hearts"],
    ])("%s with %s listed", (step, listed) => {
        expect(warn([step], [{ name: listed }])).toEqual([]);
    });

    test("an unrelated listed food does not cover the general one", () => {
        expect(
            names(warn(["Top with the cheese."], [{ name: "rice" }])),
        ).toEqual(["cheese"]);
    });
});

describe("synonyms are one food", () => {
    test.each([
        ["Top with green onions.", "scallions"],
        ["Top with spring onions.", "scallions"],
        ["Whisk in the corn starch.", "cornstarch"],
        ["Garnish with coriander.", "cilantro"],
        ["Slice the courgette.", "zucchini"],
        ["Roast the aubergine.", "eggplant"],
        ["Add the prawns.", "shrimp"],
        ["Add the chilli.", "chili"],
        ["Pour in the stock.", "vegetable broth"],
    ])("%s with %s listed", (step, listed) => {
        expect(warn([step], [{ name: listed }])).toEqual([]);
    });

    test("the warning uses one key for every spelling", () => {
        expect(names(warn(["Top with spring onions."], []))).toEqual([
            "scallion",
        ]);
        expect(names(warn(["Whisk in the corn starch."], []))).toEqual([
            "cornstarch",
        ]);
        expect(names(warn(["Add the prawns."], []))).toEqual(["shrimp"]);
    });

    test("a dismissed key drops every spelling of the food", () => {
        expect(
            warn(["Top with green onions."], [], { dismissed: ["scallion"] }),
        ).toEqual([]);
        expect(
            warn(["Top with scallions."], [], { dismissed: ["green onions"] }),
        ).toEqual([]);
    });
});

describe("more synonyms and kinds", () => {
    test.each([
        ["Coat in bread crumbs.", "breadcrumbs"],
        ["Toss in bread crumbs.", "panko breadcrumbs"],
        ["Toss in breadcrumbs.", "bread crumbs"],
        ["Fold in the yoghurt.", "yogurt"],
        ["Stir in the yogurt.", "yoghurt"],
        ["Add the chilli flakes.", "chili flakes"],
        ["Add the chili flakes.", "red pepper flakes"],
        ["Add the red pepper flakes.", "chilli flakes"],
        ["Sprinkle over the onions.", "green onions"],
        ["Season with pepper.", "black peppercorns"],
        ["Season with pepper.", "peppercorns"],
        ["Pour in the broth.", "chicken bouillon cubes"],
        ["Splash in the hot sauce.", "sriracha"],
        ["Cook until the oil separates.", "ghee"],
        ["Garnish with coriander.", "cilantro"],
    ])("%s with %s listed", (step, listed) => {
        expect(warn([step], [{ name: listed }])).toEqual([]);
    });

    test("every spelling of a phrase food shares its key", () => {
        for (const step of [
            "Add the red pepper flakes.",
            "Add the chilli flakes.",
            "Add the chili flakes.",
        ]) {
            expect(names(warn([step], []))).toEqual(["chili flake"]);
        }
        expect(names(warn(["Coat in bread crumbs."], []))).toEqual([
            "breadcrumb",
        ]);
        expect(names(warn(["Fold in the yoghurt."], []))).toEqual(["yogurt"]);
        expect(
            warn(["Add the red pepper flakes."], [], {
                dismissed: ["chilli flake"],
            }),
        ).toEqual([]);
    });
});

describe("ground coriander is the spice, not cilantro", () => {
    test("the spice warns under its own key when it is missing", () => {
        const [spice, ...rest] = warn(
            ["Add 2 tsp ground coriander."],
            [{ name: "turmeric" }],
        );
        expect(rest).toEqual([]);
        expect(spice!.key).toBe("coriander seed");
        expect(
            names(
                warn(["Toast the coriander seeds."], [{ name: "cumin seeds" }]),
            ),
        ).toEqual(["coriander seed"]);
        expect(
            names(warn(["Add the coriander powder."], [{ name: "cumin" }])),
        ).toEqual(["coriander seed"]);
    });

    test("a listed cilantro does not cover the spice, nor the spice the herb", () => {
        expect(
            names(warn(["Add the ground coriander."], [{ name: "cilantro" }])),
        ).toEqual(["coriander seed"]);
        expect(
            names(
                warn(
                    ["Garnish with fresh coriander."],
                    [{ name: "ground coriander" }],
                ),
            ),
        ).toEqual(["cilantro"]);
    });

    test("the spice listed under any of its names covers the mention", () => {
        expect(
            warn(["Add the ground coriander."], [{ name: "ground coriander" }]),
        ).toEqual([]);
        expect(
            warn(["Toast the coriander seeds."], [{ name: "coriander seed" }]),
        ).toEqual([]);
        expect(
            warn(["Add the ground coriander."], [{ name: "coriander seeds" }]),
        ).toEqual([]);
    });
});

describe("a part of a whole food is covered by the whole", () => {
    test.each([
        ["Whisk the egg whites to stiff peaks.", ["4 large eggs"]],
        ["Whisk the egg yolks with the sugar.", ["3 eggs", "sugar"]],
        ["Add 2 tbsp lemon juice.", ["2 lemons"]],
        ["Stir in the lime juice and onion.", ["1 lime", "1/2 red onion"]],
        ["Grate the orange zest.", ["1 orange"]],
    ])("%s with %j listed", (step, listed) => {
        expect(
            warn(
                [step],
                listed.map((name) => ({ name })),
            ),
        ).toEqual([]);
    });

    test("without the whole, the part still warns", () => {
        expect(names(warn(["Add the lemon juice."], []))).toEqual([
            "lemon juice",
        ]);
        expect(names(warn(["Whisk the egg whites."], []))).toEqual([
            "egg white",
        ]);
        expect(
            names(warn(["Add the lemon juice."], [{ name: "lime" }])),
        ).toEqual(["lemon juice"]);
    });

    test("a household part food is covered by its listed whole too", () => {
        expect(
            warn(
                ["Add the passion fruit juice."],
                [{ name: "passion fruit" }],
                { vocabulary: [{ name: "Passion fruit juice", foodId: "p" }] },
            ),
        ).toEqual([]);
        expect(
            names(
                warn(["Add the passion fruit juice."], [], {
                    vocabulary: [{ name: "Passion fruit juice", foodId: "p" }],
                }),
            ),
        ).toEqual(["passion fruit juice"]);
    });
});

describe("a longer mention is covered by its listed tail", () => {
    test.each([
        ["Season with kosher salt.", "salt"],
        ["Slice the red onion.", "onion"],
        ["Splash in some dark soy sauce.", "soy sauce"],
    ])("%s with %s listed", (step, listed) => {
        expect(warn([step], [{ name: listed }])).toEqual([]);
    });

    test("a compound that is its own food is not covered by its tail", () => {
        expect(
            names(warn(["Spread on the peanut butter."], [{ name: "butter" }])),
        ).toEqual(["peanut butter"]);
        expect(
            names(warn(["Stir in the coconut milk."], [{ name: "milk" }])),
        ).toEqual(["coconut milk"]);
        expect(
            names(warn(["Add the red pepper."], [{ name: "black pepper" }])),
        ).toEqual(["red pepper"]);
    });

    test("a tail that is a catalog food covered by its id counts", () => {
        expect(
            warn(
                ["Season with kosher salt."],
                [{ name: "x", foodId: "salt" }],
                {
                    vocabulary: [{ name: "Salt", foodId: "salt" }],
                },
            ),
        ).toEqual([]);
    });
});

describe("words that are not being used as a food", () => {
    test.each([
        ["Cream the butter and sugar until fluffy.", ["butter", "sugar"]],
        ["Cream butter and sugar until fluffy.", ["butter", "sugar"]],
        ["For the sake of time, use leftover rice.", ["rice"]],
        [
            "Bread the chicken cutlets.",
            ["chicken cutlets", "panko breadcrumbs"],
        ],
        ["Roast until the edges turn orange.", ["carrots"]],
        ["Lightly flour the surface.", ["dough"]],
        ["Salt the water generously.", ["spaghetti"]],
        ["Butter a baking dish.", ["flour"]],
        ["Serve with ice cream.", ["apples"]],
    ])("%s", (step, listed) => {
        expect(
            warn(
                [step],
                listed.map((name) => ({ name })),
            ),
        ).toEqual([]);
    });

    test("the same words still warn when they are the food", () => {
        expect(names(warn(["Whip the cream."], []))).toEqual(["cream"]);
        expect(names(warn(["Add the cream, then stir."], []))).toEqual([
            "cream",
        ]);
        expect(names(warn(["Salt and pepper to taste."], []))).toEqual([
            "salt",
            "pepper",
        ]);
        expect(names(warn(["Add a splash of sake."], []))).toEqual(["sake"]);
        expect(names(warn(["Peel the orange."], []))).toEqual(["orange"]);
        expect(names(warn(["Squeeze in 2 oranges."], []))).toEqual(["orange"]);
        expect(names(warn(["Heat oil in the pan."], []))).toEqual(["oil"]);
    });

    test("a household food named like a cooking word or a dish stays quiet", () => {
        const cases: [string, string, string[]][] = [
            ["Mince the garlic.", "Mince", ["garlic"]],
            ["Toast the sesame seeds.", "Toast", ["sesame seeds"]],
            ["Bake until the cake springs back.", "Cake", ["flour"]],
            ["Roast the carrots.", "Roast", ["carrots"]],
            ["Stir until it thickens, then steam.", "Steam", ["milk"]],
            ["Add the dates.", "Date", ["dates"]],
        ];
        for (const [step, name, listed] of cases) {
            expect(
                warn(
                    [step],
                    listed.map((n) => ({ name: n })),
                    { vocabulary: [{ name, foodId: "x" }] },
                ),
            ).toEqual([]);
        }
    });
});

describe("a cue only governs the food it acts on", () => {
    const noodles = [
        { name: "200 g flat rice noodles" },
        { name: "2 tbsp oyster sauce" },
        { name: "1 tbsp soy sauce" },
    ];
    const warned = (step: string, ingredients = noodles) =>
        names(warn([step], ingredients));

    test.each([
        ["Don't stir the egg until it starts to set.", "egg"],
        ["Do not overcook the shrimp or they turn rubbery.", "shrimp"],
        ["Don't crowd the mushrooms in the pan.", "mushroom"],
        ["Be careful not to burn the garlic.", "garlic"],
        ["Do not let the butter brown.", "butter"],
        ["Don't rinse the chicken before cooking.", "chicken"],
        ["Never wash mushrooms under running water.", "mushroom"],
        ["Avoid overmixing the eggs into the noodles.", "egg"],
        ["Toss gently without breaking the tofu.", "tofu"],
        ["Do not peel the potatoes.", "potato"],
        ["Don't skip toasting the sesame seeds.", "sesame seed"],
        ["Do not overcrowd the pan and scramble the eggs.", "egg"],
        ["Don't stir for a minute and then crack in the egg.", "egg"],
        ["Stir until no lumps remain and the butter has melted.", "butter"],
        ["Cook without moving the noodles and scramble the egg.", "egg"],
        ["No need to salt the water and add the eggs.", "egg"],
        [
            "Rinse the rice until not cloudy and add the coconut milk.",
            "coconut milk",
        ],
        ["You cannot skip the eggs here.", "egg"],
        ["Never omit the butter.", "butter"],
        ["Do not skip the cheese.", "cheese"],
        ["Make sure not to burn the garlic.", "garlic"],
        ["Do not stir the honey in.", "honey"],
        ["Do not add the cheese until the end.", "cheese"],
    ])("a step that uses the food warns: %s", (step, food) => {
        expect(warned(step)).toEqual([food]);
    });

    test("a negation followed by another food's verb warns the later food", () => {
        expect(
            warned("Cook the beef until no longer pink and add the broccoli."),
        ).toEqual(["beef", "broccoli"]);
        expect(
            warned("Without stirring the noodles crack the egg over."),
        ).toEqual(["egg"]);
    });

    test("a cue in a compound word is not a cue", () => {
        expect(
            warned("This no-bake cake needs cream cheese and sugar."),
        ).toEqual(["cream cheese", "sugar"]);
        expect(
            warned("For no-knead bread, stir the yeast into the flour."),
        ).toEqual(["yeast", "flour"]);
        expect(warned("Make a two-egg omelette with cheese.")).toEqual([
            "cheese",
        ]);
    });

    test.each([
        "Do not add any butter; skip the cheese.",
        "Without yogurt the sauce will split.",
        "If you don't have shallots, use onion instead; no cream needed.",
        "Do not substitute honey for sugar.",
        "Substitute almond milk for regular milk if vegan.",
        "Avoid using garlic powder here, it burns.",
        "Do not add any butter or cheese.",
        "Skip the cheese and butter.",
        "Do not stir in the butter.",
        "You don't need to add the cheese.",
        "Be careful not to add the egg.",
        "No cream, no butter.",
        "Without adding the cheese it is lighter.",
    ])("a food a cue directly leaves out stays quiet: %s", (step) => {
        expect(warned(step)).toEqual([]);
    });

    test("a cue silences its object only, not the next verb's", () => {
        expect(warned("Do not add the butter and scramble the egg.")).toEqual([
            "egg",
        ]);
        expect(warned("Skip the cheese and fold in the egg.")).toEqual(["egg"]);
    });

    test("'instead of' leaves out what follows and keeps what leads", () => {
        expect(warned("Use the eggs instead of flax.")).toEqual(["egg"]);
        expect(warned("Use butter rather than oil.")).toEqual(["butter"]);
        expect(warned("Use honey instead of sugar.")).toEqual(["honey"]);
        expect(warned("Use honey in place of sugar.")).toEqual(["honey"]);
        expect(warned("Use honey instead.")).toEqual([]);
    });
});

describe("a hyphen only silences a food next to a modifier", () => {
    const oil = [{ name: "1 tbsp oil" }];
    const warned = (step: string) => names(warn([step], oil));

    test("two foods joined by a hyphen are both foods", () => {
        expect(warned("Stir in the ginger-garlic paste.")).toEqual([
            "ginger",
            "garlic",
        ]);
        expect(warned("Glaze with a honey-soy mixture.")).toContain("honey");
    });

    test("a food with a hyphenated non-modifier is still the food", () => {
        expect(warned("Brush the pastry with egg-wash.")).toEqual(["egg"]);
        expect(warned("Brush the pastry with egg wash.")).toEqual(["egg"]);
    });

    test.each([
        "Use sugar-free syrup.",
        "This is egg-free and dairy-free.",
        "Cook in a tomato-based sauce.",
        "Brush with honey-glazed sauce.",
        "Use a non-dairy topping.",
        "Season with lemon-pepper.",
    ])("a modifier or a seasoning blend stays quiet: %s", (step) => {
        expect(warned(step)).toEqual([]);
    });

    test("a spelled-out blend: salt-and-pepper are two foods, half-and-half is not looked up", () => {
        expect(warned("Season with salt-and-pepper.")).toEqual([
            "salt",
            "pepper",
        ]);
        expect(warned("Whisk in the half-and-half.")).toEqual([]);
    });

    test("a hyphenated modifier beside a food keeps the food", () => {
        expect(warned("Mix in the gluten-free flour.")).toEqual(["flour"]);
        expect(warned("Pour in the low-fat milk.")).toEqual(["milk"]);
    });

    test("a rack after a meat is a cut, not gear", () => {
        expect(warned("Season the lamb rack generously.")).toEqual(["lamb"]);
        expect(warned("Roast the rack of lamb.")).toEqual(["lamb"]);
        expect(warned("Set the lamb on the wire rack.")).toEqual(["lamb"]);
        expect(warned("Use a cooling rack.")).toEqual([]);
    });
});

describe("a percentage or a ratio is not an amount", () => {
    const amountOf = (step: string) => warn([step], [])[0]!.amount;

    test("a number before a percent sign or the word percent is no amount", () => {
        expect(amountOf("Whisk in 2% milk until smooth.")).toBeNull();
        expect(amountOf("Pour in 1% milk.")).toBeNull();
        expect(amountOf("Pour in 2 percent milk.")).toBeNull();
    });

    test("an N/N that is not a kitchen fraction is no amount", () => {
        expect(amountOf("Brown the 80/20 ground beef.")).toBeNull();
        expect(amountOf("Brown the 90/10 ground beef.")).toBeNull();
    });

    test("a kitchen fraction and a count are still an amount", () => {
        expect(amountOf("Add 1/2 onion.")).toBe(0.5);
        expect(amountOf("Add 3/4 onion.")).toBe(0.75);
        expect(amountOf("Add 2 eggs.")).toBe(2);
        expect(amountOf("Add 1 1/2 onions.")).toBe(1.5);
    });
});

describe("amounts", () => {
    test("a mixed number adds up", () => {
        expect(warn(["Add 1 1/2 onions."], [])[0]!.amount).toBe(1.5);
        expect(warn(["Add 1½ onions."], [])[0]!.amount).toBe(1.5);
        expect(warn(["Add 2 ½ onions."], [])[0]!.amount).toBe(2.5);
    });

    test("a range takes its low end", () => {
        expect(warn(["Add 2-3 eggs."], [])[0]!.amount).toBe(2);
        expect(warn(["Add 2 to 3 eggs."], [])[0]!.amount).toBe(2);
        expect(warn(["Add two to three eggs."], [])[0]!.amount).toBe(2);
    });

    test("a unit or measure word after the food means the number is not a count of it", () => {
        expect(warn(["Add 3 garlic cloves."], [])[0]!.amount).toBeNull();
        expect(warn(["Add 2 onion slices."], [])[0]!.amount).toBeNull();
        expect(warn(["Add 1 onion tin."], [])[0]!.amount).toBeNull();
        expect(warn(["Add 2 egg pieces."], [])[0]!.amount).toBeNull();
        // The number still counts when the next word is just more sentence.
        expect(warn(["Add 2 eggs."], [])[0]!.amount).toBe(2);
        expect(warn(["Add 2 eggs and stir."], [])[0]!.amount).toBe(2);
    });

    test("a unit before the food was never an amount of it", () => {
        expect(warn(["Add 400 g chicken."], [])[0]!.amount).toBeNull();
        expect(warn(["Add 3 cloves garlic."], [])[0]!.amount).toBeNull();
    });
});

describe("where a mention sits", () => {
    test("the warning says which step and where in the step and the excerpt", () => {
        const steps = [
            "Boil the pot.",
            "Push them aside, pour in the lightly beaten egg and scramble.",
        ];
        const [egg] = warn(steps, []);
        expect(egg!.stepIndex).toBe(1);
        expect(steps[1]!.slice(egg!.start, egg!.end)).toBe("egg");
        expect(egg!.excerpt.slice(egg!.excerptStart, egg!.excerptEnd)).toBe(
            "egg",
        );
    });

    test("an accented, upper-case or plural spelling is cut out as written", () => {
        const steps = ["Fold in the Jalapeño, then add 2 EGGS."];
        const found = warn(steps, [{ name: "x" }], {
            vocabulary: [{ name: "jalapeño" }],
        });
        const spelled = found.map((w) => steps[0]!.slice(w.start, w.end));
        expect(spelled).toEqual(["Jalapeño", "EGGS"]);
    });

    test("a clipped long excerpt still points at the mention", () => {
        const lead =
            "Simmer the sauce gently while you stir and taste it ".repeat(4);
        const tail =
            " and keep stirring until everything is glossy and thick ".repeat(
                4,
            );
        const steps = [`${lead}pour in the egg${tail}.`];
        const [egg] = warn(steps, []);
        expect(egg!.excerpt.startsWith("…")).toBe(true);
        expect(egg!.excerpt.slice(egg!.excerptStart, egg!.excerptEnd)).toBe(
            "egg",
        );
        expect(steps[0]!.slice(egg!.start, egg!.end)).toBe("egg");
    });

    test("the step index counts the steps the recipe page lists", () => {
        const [garlic] = warn(["Boil.", "Drain.", "Add garlic."], []);
        expect(garlic!.stepIndex).toBe(2);
    });
});

describe("keys and spelling", () => {
    test("a dismissed key is compared the way the warnings are keyed", () => {
        expect(warn(["Add 2 eggs."], [], { dismissed: ["Eggs"] })).toEqual([]);
        expect(
            warn(["Add the all-purpose flour."], [], {
                dismissed: ["all purpose flour"],
            }),
        ).toEqual([]);
        expect(
            warn(["Add the all purpose flour."], [], {
                dismissed: ["all-purpose flour"],
            }),
        ).toEqual([]);
    });

    test("a household food no bundled word matches keeps its own name", () => {
        const [found] = warn(["Add the pickled beets."], [], {
            vocabulary: [{ name: "Pickled Beets", foodId: "b" }],
        });
        expect(found!.key).toBe("pickled beets");
        expect(found!.food).toBe("pickled beets");
        expect(found!.foodId).toBe("b");
        expect(
            warn(["Add the pickled beets."], [], {
                vocabulary: [{ name: "Pickled Beets", foodId: "b" }],
                dismissed: ["Pickled beet"],
            }),
        ).toEqual([]);
    });

    test("an accent in the step or the household name does not hide the food", () => {
        const [found] = warn(["Add the jalapeño."], [], {
            vocabulary: [{ name: "Jalapeño", foodId: "j" }],
        });
        expect(found!.foodId).toBe("j");
        expect(found!.excerpt).toBe("Add the jalapeño.");
        expect(names(warn(["Add the jalapeño."], []))).toEqual(["jalapeno"]);
        expect(
            names(
                warn(["Top with Gruyère."], [], {
                    vocabulary: [{ name: "Gruyère", foodId: "g" }],
                }),
            ),
        ).toEqual(["gruyere"]);
        expect(warn(["Add the jalapeño."], [{ name: "jalapeno" }])).toEqual([]);
    });
});

describe("a product's plain food is covered by the product", () => {
    test("the plain food's name covers a mention though the product's own name lacks it", () => {
        expect(
            names(
                warn(
                    ["Beat the cream cheese until smooth."],
                    [
                        {
                            name: "Philadelphia Original",
                            foodName: "Philadelphia Original",
                        },
                    ],
                ),
            ),
        ).toEqual(["cream cheese"]);
        expect(
            warn(
                ["Beat the cream cheese until smooth."],
                [
                    {
                        name: "Philadelphia Original",
                        foodName: "Philadelphia Original",
                        genericFoodName: "Cream cheese",
                    },
                ],
            ),
        ).toEqual([]);
    });

    test("the plain food's id covers a catalog mention of it", () => {
        const eggs = { name: "Eggs", foodId: "plain-eggs" };
        expect(
            warn(
                ["Whisk 2 eggs."],
                [{ name: "Happy Hens", foodId: "product-1" }],
                { vocabulary: [eggs] },
            ),
        ).toHaveLength(1);
        expect(
            warn(
                ["Whisk 2 eggs."],
                [
                    {
                        name: "Happy Hens",
                        foodId: "product-1",
                        genericFoodId: "plain-eggs",
                    },
                ],
                { vocabulary: [eggs] },
            ),
        ).toEqual([]);
    });
});

describe("other spellings of one food", () => {
    test("parmigiano-reggiano is parmesan", () => {
        expect(
            warn(["Top with parmesan."], [{ name: "parmigiano-reggiano" }]),
        ).toEqual([]);
        expect(
            warn(["Top with parmigiano reggiano."], [{ name: "parmesan" }]),
        ).toEqual([]);
        expect(
            names(warn(["Top with parmigiano-reggiano."], [{ name: "flour" }])),
        ).toEqual(["parmesan"]);
    });

    test("a listed panko covers the breadcrumbs a step names", () => {
        expect(
            warn(["Top with breadcrumbs and bake."], [{ name: "panko" }]),
        ).toEqual([]);
        expect(
            warn(["Top with bread crumbs and bake."], [{ name: "panko" }]),
        ).toEqual([]);
        expect(
            names(
                warn(["Top with breadcrumbs and bake."], [{ name: "flour" }]),
            ),
        ).toEqual(["breadcrumb"]);
    });
});

describe("hyphenated compounds and equipment are not a mention", () => {
    const flour = [{ name: "flour" }];
    const quiet = (step: string) => names(warn([step], flour));

    test("cream of tartar is its own food, never cream", () => {
        expect(quiet("Add cream of tartar.")).toEqual(["cream of tartar"]);
        expect(
            warn(["Add cream of tartar."], [{ name: "cream of tartar" }]),
        ).toEqual([]);
        expect(
            warn(["Add cream of tartar."], [{ name: "heavy cream" }]),
        ).toHaveLength(1);
    });

    test("a food word hyphenated to another word is not that food", () => {
        expect(quiet("Use sugar-free syrup.")).toEqual([]);
        expect(quiet("This is egg-free and dairy-free.")).toEqual([]);
        expect(quiet("Season with lemon-pepper.")).toEqual([]);
        expect(quiet("A gluten-free, butter-flavored cake.")).toEqual([]);
    });

    test("a hyphenated compound that is a listed food still matches", () => {
        expect(quiet("Add the all-purpose flour.")).toEqual([]);
        expect(quiet("Add olive-oil.")).toEqual(["olive oil"]);
        expect(
            names(warn(["Stir in the cashew-milk."], [{ name: "flour" }])),
        ).toEqual(["cashew milk"]);
    });

    test("a food word before a piece of equipment is not that food", () => {
        for (const step of [
            "Use a butter knife.",
            "Set an egg timer.",
            "Crush it in a garlic press.",
            "Pass it through a salt shaker.",
            "Cook in the rice cooker.",
            "Use a pepper grinder.",
            "Pour into the cheese board.",
        ]) {
            expect(quiet(step)).toEqual([]);
        }
    });

    test("egg wash is still the egg", () => {
        expect(quiet("Brush with egg wash.")).toEqual(["egg"]);
    });

    test("a plain mention beside equipment still warns", () => {
        expect(quiet("Use a butter knife to spread butter.")).toEqual([
            "butter",
        ]);
    });
});

describe("plant milks, butters and creams are one food", () => {
    const flour = [{ name: "flour" }];

    test.each([
        ["Stir in the almond milk.", "almond milk"],
        ["Add oat milk.", "oat milk"],
        ["Add soy milk.", "soy milk"],
        ["Add rice milk.", "rice milk"],
        ["Spread almond butter on top.", "almond butter"],
        ["Spread cashew butter on top.", "cashew butter"],
        ["Blend in the cashew cream.", "cashew cream"],
        ["Top with coconut cream.", "coconut cream"],
    ])("%s warns once, as %s", (step, key) => {
        expect(names(warn([step], flour))).toEqual([key]);
    });

    test("a listed milk or butter does not cover the plant version", () => {
        expect(
            names(warn(["Stir in the almond milk."], [{ name: "milk" }])),
        ).toEqual(["almond milk"]);
        expect(
            names(warn(["Spread almond butter."], [{ name: "butter" }])),
        ).toEqual(["almond butter"]);
        expect(
            names(warn(["Blend in coconut cream."], [{ name: "cream" }])),
        ).toEqual(["coconut cream"]);
    });

    test("the listed plant version covers itself, with a brand or size word", () => {
        expect(
            warn(
                ["Stir in the almond milk."],
                [{ name: "unsweetened almond milk" }],
            ),
        ).toEqual([]);
    });
});

describe("a step that leaves a food out or swaps it is not a mention", () => {
    const base = [{ name: "chicken" }, { name: "onion" }];
    const quiet = (step: string) => names(warn([step], base));

    test.each([
        "Do not add any butter; skip the cheese.",
        "Without yogurt the sauce will split.",
        "If you don't have shallots, use onion instead; no cream needed.",
        "Do not substitute honey for sugar.",
        "Substitute almond milk for regular milk if vegan.",
        "Avoid using garlic powder here.",
        "Omit the salt.",
        "Leave out the mustard, or use it rather than ketchup.",
        "Use chicken instead of butter.",
        "Use chicken in place of lemon juice.",
        "Never add the honey, and don't add the butter either.",
    ])("%s", (step) => {
        expect(quiet(step)).toEqual([]);
    });

    test("a bare trailing 'instead' leaves the food optional, so it is quiet", () => {
        expect(quiet("Use honey instead.")).toEqual([]);
    });

    test("a food named after the clause break still warns", () => {
        expect(quiet("Do not stir; add 2 eggs.")).toEqual(["egg"]);
        expect(quiet("Skip the cheese, then add 2 eggs.")).toEqual(["egg"]);
    });

    test("an ordinary mention warns, and a later affirmative one of a skipped food too", () => {
        expect(quiet("Add 2 eggs.")).toEqual(["egg"]);
        expect(quiet("Skip the butter. Later, stir in the butter.")).toEqual([
            "butter",
        ]);
    });
});

describe("a negated 'add' with a timing word is an instruction about when", () => {
    const noodles = [{ name: "200 g flat rice noodles" }];
    const warned = (step: string) => names(warn([step], noodles));

    test.each([
        [
            "Do not add the egg until the noodles are charred, then scramble it.",
            "egg",
        ],
        ["Do not add the egg until the pan is hot.", "egg"],
        ["Do not stir in the eggs until the mixture has cooled.", "egg"],
        ["Don't add the cheese too early or it will burn.", "cheese"],
        ["Make sure not to add the eggs all at once.", "egg"],
        ["Never add the garlic before the onions are translucent.", "garlic"],
        ["Don't add the garlic until the oil shimmers.", "garlic"],
        ["Do not add the egg after the sauce thickens.", "egg"],
        ["Don't add the butter too soon.", "butter"],
        ["Do not add the egg right away.", "egg"],
        ["Do not add the egg first.", "egg"],
        ["Do not add the egg yet.", "egg"],
        ["Do not add the egg at once.", "egg"],
    ])("%s", (step, food) => {
        expect(warned(step)).toContain(food);
    });

    test("a plain leave-out is still quiet", () => {
        expect(warned("Do not add any butter.")).toEqual([]);
        expect(warned("Do not add the egg.")).toEqual([]);
        expect(warned("Skip the cheese until later.")).toEqual([]);
    });
});

describe("a substitution reaches its own clause, not the next verb's", () => {
    const base = [{ name: "chicken" }];
    const warned = (step: string) => names(warn([step], base));

    test("a food added after 'and' + verb still warns", () => {
        expect(
            warned("You can substitute the butter with oil and add the eggs."),
        ).toEqual(["egg"]);
        expect(
            warned("Substitute tofu for chicken and add the shrimp."),
        ).toEqual(["shrimp"]);
        expect(warned("Add the eggs and substitute butter for oil.")).toEqual([
            "egg",
        ]);
        expect(warned("Substitute oil for butter, then add the eggs.")).toEqual(
            ["egg"],
        );
    });

    test("foods inside the swap stay quiet", () => {
        expect(
            warned("Substitute almond milk for regular milk if vegan."),
        ).toEqual([]);
        expect(warned("Do not substitute honey for sugar.")).toEqual([]);
        expect(
            warned("Substitute honey for the sugar and the brown sugar."),
        ).toEqual([]);
        expect(warned("Honey can be substituted for sugar.")).toEqual([]);
    });
});

describe("a comparison names a yardstick, not a food to add", () => {
    const base = [{ name: "chicken" }];
    const warned = (step: string) => names(warn([step], base));

    test.each([
        "Simmer until the sauce has the consistency of honey.",
        "Shape into a ball the size of a lemon.",
        "Beat until thick, like whipped cream.",
        "Cook until it has the texture of oatmeal and the thickness of honey.",
        "Cook until golden, the colour of honey.",
        "Whisk until smooth like mayonnaise.",
        "Whisk until creamy like yogurt.",
    ])("%s", (step) => {
        expect(warned(step)).toEqual([]);
    });

    test("'like' that is not a comparison still warns", () => {
        expect(warned("If you like, stir in the honey.")).toEqual(["honey"]);
        expect(warned("You would like the honey here.")).toEqual(["honey"]);
        expect(warned("Add the honey, then the consistency is fine.")).toEqual([
            "honey",
        ]);
    });
});

describe("a food as a size, shape or colour is not a mention", () => {
    const base = [{ name: "flour" }];
    const warned = (step: string) => names(warn([step], base));

    test.each([
        "Roll into 12 egg-sized balls.",
        "Divide the dough into lemon-sized pieces.",
        "Shape into pea-sized crumbs.",
        "Roll the dough into walnut-sized pieces.",
        "Pinch off a walnut-size piece.",
        "Roll into egg-size balls.",
        "Pinch off walnut size pieces of dough.",
        "Pinch off walnut sized pieces of dough.",
        "Cook until honey-colored.",
        "Cook until caramel-colored.",
        "Cook until cream-coloured.",
        "Cook until lemon-yellow.",
        "Pour into an egg-shaped mold.",
    ])("%s", (step) => {
        expect(warned(step)).toEqual([]);
    });

    test("the food itself still warns next to those words", () => {
        expect(warned("Add the walnuts, then roll into balls.")).toEqual([
            "walnut",
        ]);
        expect(warned("Cook until golden and add the honey.")).toEqual([
            "honey",
        ]);
    });

    test.each([
        "Strain the curds through a coffee filter.",
        "Line the tray with butter paper.",
        "Strain through a cheese cloth.",
        "Cut rounds with a wine glass.",
        "Cook the batter in an egg ring.",
        "Press the dough with a lemon squeezer.",
    ])("gear is not a food: %s", (step) => {
        expect(warned(step)).toEqual([]);
    });
});

describe("a household food named like a measure or a verb", () => {
    const warned = (
        step: string,
        catalog: string[],
        ingredients: Ingredient[] = [{ name: "garlic" }, { name: "rice" }],
    ) =>
        names(
            warn([step], ingredients, {
                vocabulary: catalog.map((name, i) => ({
                    name,
                    foodId: `f${i}`,
                })),
            }),
        );

    test("a 'Cloves' food is not the cloves of a garlic clove count", () => {
        expect(warned("Add 3 cloves garlic, minced.", ["Cloves"])).toEqual([]);
        expect(warned("Mince 4 cloves of garlic.", ["Cloves"])).toEqual([]);
        expect(
            warned("Mince 4 cloves of garlic.", ["Cloves"], [{ name: "rice" }]),
        ).toEqual(["garlic"]);
    });

    test("whole cloves for the rice are the spice and still warn", () => {
        expect(warned("Add 3 whole cloves to the rice.", ["Cloves"])).toEqual([
            "cloves",
        ]);
    });

    test.each([
        ["Roll the dough into a log and slice into rounds.", "Rolls"],
        ["Season the chicken, wrap in foil and bake.", "Wraps"],
        ["Dip the chicken in the egg, then the flour.", "Dip"],
        ["Spread the butter over the bread.", "Spread"],
        ["Glaze the ham with honey.", "Glaze"],
        ["Pickle the onion in vinegar.", "Pickles"],
        ["Fill the peppers, stuffing them tightly.", "Stuffing"],
    ])("a verb use is not the food: %s", (step, food) => {
        expect(warned(step, [food], [])).toEqual(
            expect.not.arrayContaining([food.toLowerCase()]),
        );
    });

    test("the household food is still found where the step uses it as one", () => {
        expect(
            warned("Serve with Stuffing on the side.", ["Stuffing"], []),
        ).toEqual(["stuffing"]);
        expect(warned("Add paneer in the pan.", ["Paneer"], [])).toEqual([
            "paneer",
        ]);
        expect(warned("Scramble the eggs in the pan.", ["Eggs"], [])).toEqual([
            "egg",
        ]);
    });
});

describe("mention word data", () => {
    const bundled = new Set(BUNDLED_MENTION_WORDS);

    test("every synonym key is a listed food and its other names are not listed", () => {
        for (const [key, ...others] of MENTION_SYNONYMS) {
            expect(bundled.has(key!)).toBe(true);
            for (const other of others) expect(bundled.has(other)).toBe(false);
        }
    });

    test("no bundled word is a cooking verb or a dish name", () => {
        for (const word of MENTION_NOT_FOOD_WORDS) {
            expect(bundled.has(word)).toBe(false);
        }
    });

    test("a part word is never a listed food on its own", () => {
        for (const word of MENTION_PART_WORDS) {
            expect(bundled.has(word)).toBe(false);
        }
    });

    test("every own-food compound and every kind head is a listed food", () => {
        for (const word of MENTION_OWN_FOODS)
            expect(bundled.has(word)).toBe(true);
        for (const head of Object.keys(MENTION_KINDS)) {
            expect(bundled.has(head)).toBe(true);
        }
    });
});
