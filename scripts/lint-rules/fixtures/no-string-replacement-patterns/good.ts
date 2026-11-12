const html = "<main></main>";
const body = "price: $& and $` and $'";
const a = html.replace("<main>", () => `<main>${body}`);
const b = html.replace(/main/g, function () {
    return body;
});
const c = html.replaceAll("main", "section");
// A literal replacement is a pattern the author wrote on purpose.
const d = html.replace(/(m)ain/, "$1ore");
const e = html.replace("main", `section`);
const g = html.replace("main", () => body).replace(/x/g, "");
export { a, b, c, d, e, g };
