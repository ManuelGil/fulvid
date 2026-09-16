import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDocument,
  deleteDocument,
  readDocument,
  renameDocument,
  saveSelectedDocument,
  saveSelectedHtmlExport,
  validateHtmlBasename,
  writeDocument,
} from "../../../../src/bun/filesystem/io/documentIo";
import { scanWorkspace } from "../../../../src/bun/filesystem/scanning/scanDirectory";
import {
  documentConflictMessage,
  filesystemErrorMessage,
} from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";
import { linkDirectory } from "../../../support/platform";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "editor-document-io-"));
}

// Intent: protect document CRUD, atomic writes, basename safety, and containment.
describe("document I/O", () => {
  test("supports create, read, atomic write, rename, delete; refuses traversal and drive forms", async () => {
    const root = await makeWorkspace();
    const outsideFolder = filesystemErrorMessage("outsideFolder");

    try {
      await expect(readDocument(root, "../../../src/etc/passwd.md")).rejects.toThrow(outsideFolder);
      await expect(readDocument(root, "..\\..\\outside.md")).rejects.toThrow(outsideFolder);
      await expect(writeDocument(root, join(root, "document.md"), "# x\n")).rejects.toThrow(
        outsideFolder,
      );
      await expect(createDocument(root, "notes/../document.md", "# x\n")).rejects.toThrow(
        outsideFolder,
      );
      await expect(createDocument(root, "C:\\Windows\\note.md", "# x\n")).rejects.toThrow(
        outsideFolder,
      );

      const created = await createDocument(
        root,
        "notes/example.mdx",
        "---\ntitle: Example\n---\n# Initial\n",
      );
      expect(created.note).toMatchObject({
        path: "notes/example.mdx",
        name: "example.mdx",
        title: "Example",
      });
      const scan = await scanWorkspace(root);
      expect(scan.scannedNotes).toEqual([
        expect.objectContaining({
          path: "notes/example.mdx",
          name: "example.mdx",
          title: "Example",
        }),
      ]);

      const snapshot = await readDocument(root, "notes/example.mdx");
      expect(snapshot.content).toContain("# Initial");
      await expect(createDocument(root, "notes/example.mdx", "# Stolen\n")).rejects.toThrow(
        filesystemErrorMessage("documentExists"),
      );
      await expect(writeDocument(root, "notes/example.mdx", "# Stale\n", 0)).rejects.toThrow(
        documentConflictMessage("notes/example.mdx"),
      );
      expect((await readDocument(root, "notes/example.mdx")).content).toContain("# Initial");

      const crlf = await createDocument(root, "notes/eol.md", "alpha\r\nbeta\r\n");
      expect(crlf.note.path).toBe("notes/eol.md");
      expect((await readDocument(root, "notes/eol.md")).content).toBe("alpha\r\nbeta\r\n");
      const crlfWritten = await writeDocument(
        root,
        "notes/eol.md",
        "gamma\r\ndelta\r\n",
        (await readDocument(root, "notes/eol.md")).mtimeMs,
      );
      expect((await readDocument(root, "notes/eol.md")).content).toBe("gamma\r\ndelta\r\n");
      expect(await deleteDocument(root, "notes/eol.md", crlfWritten.mtimeMs)).toBe(true);

      const written = await writeDocument(
        root,
        "notes/example.mdx",
        "---\ntitle: Updated\n---\n[[other]]\n",
        snapshot.mtimeMs,
        "wikilink",
      );
      expect(written.note).toMatchObject({
        path: "notes/example.mdx",
        title: "Updated",
        documentLinks: [
          expect.objectContaining({
            syntax: "wikilink",
            target: "other",
          }),
        ],
      });
      expect(await readdir(join(root, "notes"))).toEqual(["example.mdx"]);

      const renamed = await renameDocument(
        root,
        "notes/example.mdx",
        "notes/renamed.md",
        written.mtimeMs,
      );
      expect(renamed.note).toMatchObject({
        path: "notes/renamed.md",
        name: "renamed.md",
      });

      expect(await deleteDocument(root, "notes/renamed.md", renamed.mtimeMs)).toBe(true);
      await expect(readDocument(root, "notes/renamed.md")).rejects.toThrow(
        filesystemErrorMessage("documentMissing"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("HTML export stays in-folder; Windows basename rules refuse reserved and padded names", async () => {
    const root = await makeWorkspace();

    try {
      const created = await createDocument(root, "note.md", "# Keep\n");
      const original = await readFile(join(root, "note.md"), "utf8");

      expect(validateHtmlBasename("page")).toBe("page.html");
      expect(validateHtmlBasename("Page.HTML")).toBe("Page.html");
      expect(() => validateHtmlBasename("page.md")).toThrow(filesystemErrorMessage("unsafeName"));
      expect(() => validateHtmlBasename("../escape.html")).toThrow(
        filesystemErrorMessage("unsafeName"),
      );

      const saved = await saveSelectedHtmlExport(
        root,
        "page.html",
        "<!doctype html>\n<html></html>\n",
      );
      expect(saved.status).toBe("saved");
      if (saved.status === "saved") {
        expect(saved.absolutePath.endsWith(".html")).toBe(true);
      }
      expect(await readFile(join(root, "page.html"), "utf8")).toContain("<!doctype html>");
      expect(await readFile(join(root, "note.md"), "utf8")).toBe(original);

      const exists = await saveSelectedHtmlExport(root, "page.html", "second");
      expect(exists).toEqual({ status: "exists", absolutePath: join(root, "page.html") });

      const overwritten = await saveSelectedHtmlExport(
        root,
        "page.html",
        "<!doctype html>\n<html><title>Two</title></html>\n",
        true,
      );
      expect(overwritten.status).toBe("saved");
      expect(await readFile(join(root, "page.html"), "utf8")).toContain("Two");
      expect(await readFile(join(root, "note.md"), "utf8")).toBe(original);
      expect(created.note.path).toBe("note.md");

      await expect(saveSelectedHtmlExport(root, "note.md", "nope")).rejects.toThrow(
        filesystemErrorMessage("unsafeName"),
      );

      const unsafe = filesystemErrorMessage("unsafeName");
      expect(() => validateHtmlBasename("CON.html")).toThrow(unsafe);
      expect(() => validateHtmlBasename("com1.html")).toThrow(unsafe);
      expect(() => validateHtmlBasename("page.html ")).toThrow(unsafe);
      expect(() => validateHtmlBasename("page.html.")).toThrow(unsafe);
      expect(() => validateHtmlBasename("C:x.html")).toThrow(unsafe);
      await expect(saveSelectedDocument(root, "CON.md", "# x\n")).rejects.toThrow(unsafe);
      await expect(saveSelectedDocument(root, "note.md ", "# x\n")).rejects.toThrow(unsafe);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// Security boundary: one end-to-end symlink mutation check across I/O entry points.
describe("folder containment for document I/O", () => {
  test("a symlinked directory cannot be read, written, created in or deleted from", async () => {
    const base = await mkdtemp(join(tmpdir(), "editor-symlink-"));
    const root = join(base, "folder");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "SECRET\n");
    await linkDirectory(outside, join(root, "link"));

    const outsideFolder = filesystemErrorMessage("outsideFolder");
    try {
      await expect(readDocument(root, "link/secret.md")).rejects.toThrow(outsideFolder);
      await expect(writeDocument(root, "link/secret.md", "OVERWRITTEN\n")).rejects.toThrow(
        outsideFolder,
      );
      await expect(createDocument(root, "link/new.md", "x")).rejects.toThrow(outsideFolder);
      await expect(renameDocument(root, "link/secret.md", "link/renamed.md")).rejects.toThrow(
        outsideFolder,
      );
      await expect(deleteDocument(root, "link/secret.md")).rejects.toThrow(outsideFolder);
      await expect(readFile(join(outside, "secret.md"), "utf8")).resolves.toBe("SECRET\n");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
