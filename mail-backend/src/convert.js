// DroCon mail backend — DOCX → PDF conversion via headless LibreOffice.
// Produces a true-to-Word PDF (same engine as "Save as PDF" in an Office suite),
// so the branded letterhead and tables render exactly like the .docx.
//
// Requires LibreOffice on the host:  sudo apt-get install -y libreoffice-writer
// (or full `libreoffice`). Override the binary with env SOFFICE_BIN if needed.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);
const SOFFICE = process.env.SOFFICE_BIN || "soffice";

// Convert a .docx Buffer to a PDF Buffer. Each call uses its own temp dir and a
// private LibreOffice user profile, so concurrent conversions don't clash.
export async function docxToPdf(docxBuffer) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dcbconv-"));
  try {
    const inPath = path.join(dir, "in.docx");
    await writeFile(inPath, docxBuffer);
    const profile = "file://" + path.join(dir, "profile");
    await execFileP(
      SOFFICE,
      ["--headless", "--norestore", "--nolockcheck",
       "-env:UserInstallation=" + profile,
       "--convert-to", "pdf:writer_pdf_Export",
       "--outdir", dir, inPath],
      { timeout: 90_000, maxBuffer: 64 * 1024 * 1024 }
    );
    return await readFile(path.join(dir, "in.pdf"));
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
