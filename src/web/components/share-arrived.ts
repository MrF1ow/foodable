import type { ReadShareResult } from "../../domain/share.js";
import { escapeHtml } from "../shell.js";
import { disclosure } from "./ui.js";

function fieldLine(label: string, value: string): string {
    const display =
        value.length > 0
            ? `<pre class="share-arrived-value">${escapeHtml(value)}</pre>`
            : `<span class="muted">(empty)</span>`;
    const count = value.length;
    return `<p class="share-arrived-row"><strong>${escapeHtml(label)}</strong> (${count} chars)<br />${display}</p>`;
}

function detectedLine(share: ReadShareResult): string {
    if (!share.link) {
        return '<p class="muted">Detected link: none</p>';
    }
    const where =
        share.detectedFrom === "url"
            ? "url field"
            : share.detectedFrom === "text"
              ? "inside text"
              : share.detectedFrom === "title"
                ? "inside title"
                : "unknown";
    return `<p>Detected link (${escapeHtml(where)}): <code>${escapeHtml(share.link)}</code></p>`;
}

export function shareArrivedDisclosure(
    share: ReadShareResult,
    opts: { open: boolean },
): string {
    const body = `${fieldLine("title", share.raw.title)}${fieldLine("text", share.raw.text)}${fieldLine("url", share.raw.url)}${detectedLine(share)}`;
    return disclosure({
        summary: "What arrived",
        open: opts.open,
        body,
    });
}
