import { expect, test } from "bun:test";
import { readShare } from "../domain/share.js";
import { shareImportPrefill } from "./share-import-prefill.js";

test("empty share opens text-only paste step", () => {
    const prefill = shareImportPrefill(readShare({}));
    expect(prefill.importPasteStep).toBe(true);
    expect(prefill.importTextOnly).toBe(true);
    expect(prefill.importTextOrigin).toBe("shared");
});
