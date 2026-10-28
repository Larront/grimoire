// Drag-and-drop PDF import (issue #102). The app keeps `dragDropEnabled: false`
// and uses HTML5 drag-drop, reading the dropped `File`'s bytes in JS — the same
// pattern as the editor's image drop. The backend copies the bytes into the
// ledger (ADR-0011: PDFs are path-addressed), so nothing outside the ledger is
// referenced and name collisions auto-suffix silently.
import { api } from "$lib/api";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

/** A dropped file is a PDF if the OS-supplied MIME type says so, falling back to
 *  the extension for drag sources that don't set a type. */
export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** Import a dropped PDF into the ledger at `targetFolder` (ledger-relative;
 *  `""` = ledger root). Returns the new ledger-relative path. */
export async function importPdfFromHandle(file: File, targetFolder: string): Promise<string> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return api.savePdfBytes(bytes, file.name, targetFolder);
}

/** The explicit way in (a drop is the implicit one): choose PDFs in the OS dialog and
 *  import them into `targetFolder` (`""` = ledger root). The dialog gives paths, so the
 *  bytes are read here and handed to the same command a drop uses. Returns how many. */
export async function pickPdfsInto(targetFolder: string): Promise<number> {
  const picked = await open({
    title: "Import PDF",
    multiple: true,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  for (const p of paths) {
    const bytes: number[] = Array.from(await readFile(p));
    const name = p.replace(/\\/g, "/").split("/").pop() ?? "document.pdf";
    await api.savePdfBytes(bytes, name, targetFolder);
  }
  return paths.length;
}
