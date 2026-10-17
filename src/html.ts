// The one HTML escaper for server-rendered markup: the app, the OAuth pages
// and the login generator all use it. Escapes the characters that matter in
// element bodies and double-quoted attributes.
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
