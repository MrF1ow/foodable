/** Group barcode digits for display (EAN-13 and UPC-A); other lengths stay raw. */
export function formatBarcodeDisplay(code: string): string {
    const digits = code.replace(/\D/g, "");
    if (digits.length === 13) {
        return `${digits.slice(0, 1)} ${digits.slice(1, 7)} ${digits.slice(7)}`;
    }
    if (digits.length === 12) {
        return `${digits.slice(0, 1)} ${digits.slice(1, 6)} ${digits.slice(6, 11)} ${digits.slice(11)}`;
    }
    return digits.length > 0 ? digits : code;
}
