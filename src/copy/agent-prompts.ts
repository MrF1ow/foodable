export const UNVERIFIED_RECIPES_PROMPT = `Check my Foodable recipes for unverified imports. Call \`list_recipes\` with \`verification: "unverified"\`. For each one, call \`get_recipe\` and read its import data: the source link, the pasted text, unresolved lines and problems. Work only from that text. Do not open or fetch the original post or page. If something needed is missing, list it for me instead of guessing.

Fix only what the text supports:

- split run-together ingredient lines;
- turn each into an ingredient with an amount and unit, leaving the amount empty for "to taste" or anything never measured;
- fill in the steps.

Do not invent quantities or ingredients, and do not pick a brand: ingredients name plain foods.

Then call \`verify_recipe\`. If it still fails, leave it and add a note saying what is missing. Finish with a short summary: verified, still unverified, and why.`;
