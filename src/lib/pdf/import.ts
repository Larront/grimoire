// Drag-and-drop PDF import (issue #102). The app keeps `dragDropEnabled: false`
// and uses HTML5 drag-drop, reading the dropped `File`'s bytes in JS — the same
// pattern as the editor's image drop. The backend copies the bytes into the
// ledger (ADR-0011: PDFs are path-addressed), so nothing outside the ledger is
// referenced and name collisions auto-suffix silently.
import { api } from "$lib/api";

/** A dropped file is a PDF if the OS-supplied MIME type says so, falling back to
 *  the extension for drag sources that don't set a type. */
export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** Import a dropped PDF into the ledger at `targetFolder` (ledger-relative;
 *  `""` = ledger root). Returns the new ledger-relative path. */
export async function importPdfFromHandle(
  file: File,
  targetFolder: string,
): Promise<string> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return api.savePdfBytes(bytes, file.name, targetFolder);
}
