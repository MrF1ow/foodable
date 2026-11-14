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

type Ingredient = { name: string; foodName?: string | null; foodId?: string };

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
