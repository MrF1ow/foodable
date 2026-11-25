export const DRAFT_RECIPES_PROMPT = `Help me finish my Foodable recipe drafts. Call \`list_recipes\` with \`verification: "unverified"\`, the filter that lists drafts. For each one, call \`get_recipe\` and read its import data: the source link, the pasted text, unresolved lines and problems. Work only from that text. Do not open or fetch the original post or page. If something needed is missing, list it for me instead of guessing.

Fix only what the text supports:

- split run-together ingredient lines;
- turn each into an ingredient with an amount and unit, leaving the amount empty for "to taste" or anything never measured;
- fill in the steps.

Do not invent quantities or ingredients, and do not pick a brand: ingredients name plain foods.

Then call \`verify_recipe\`. If it still fails, leave it and say what is missing. When a draft is ready to save, ask me; call \`save_recipe\` only for the ones I say yes to. Finish with a short summary: saved, still drafts, and why. Drafts nobody saves are deleted 7 days after import.`;
