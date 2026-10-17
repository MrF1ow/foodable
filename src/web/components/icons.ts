const SVG_OPEN =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

function icon(inner: string): string {
    return `${SVG_OPEN}${inner}</svg>`;
}

/** Lucide-style pencil (square-and-pencil). */
export function iconPencil(): string {
    return icon(
        '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414L11.5 15.5 8 16l.5-3.5Z"/>',
    );
}

export function iconTrash(): string {
    return icon(
        '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    );
}

/** Fork (eat / log as snack). */
export function iconFork(): string {
    return icon(
        '<path d="M6 3v8"/><path d="M10 3v8"/><path d="M6 11v2a4 4 0 0 0 4 4v4"/><path d="M10 11v2a4 4 0 0 1-4 4"/><path d="M18 3v12a3 3 0 0 1-3 3"/>',
    );
}
