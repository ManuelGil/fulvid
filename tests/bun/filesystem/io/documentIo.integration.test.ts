import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertWithinWorkspace,
  createDocument,
  deleteDocument,
  readDocument,
  renameDocument,
  saveSelectedHtmlExport,
  validateHtmlBasename,
  writeDocument,
} from "../../../../src/bun/filesystem/io/documentIo";
import { scanWorkspace } from "../../../../src/bun/filesystem/scanning/scanDirectory";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "editor-document-io-"));
}

// Intent: protect document CRUD, atomic writes, and containment side effects.
// Growth boundary: add cases only for new observable I/O or security rules.
describe("document I/O", () => {
  test("rejects traversal and absolute document targets", async () => {
    const root = await makeWorkspace();

    try {
      expect(() => assertWithinWorkspace(root, "../../../src/etc/passwd.md")).toThrow(
        filesystemErrorMessage("outsideFolder"),
      );
      expect(() => assertWithinWorkspace(root, join(root, "document.md"))).toThrow(
        filesystemErrorMessage("outsideFolder"),
      );
      expect(() => assertWithinWorkspace(root, "notes/../document.md")).toThrow(
        filesystemErrorMessage("outsideFolder"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("supports create, read, atomic write, rename, and delete", async () => {
    const root = await makeWorkspace();

    try {
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

  test("writes HTML exports through the same folder boundary without touching the document", async () => {
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
      expect(await readFile(join(root, "page.html"), "utf8")).toContain("<!doctype html>");

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
      expect(await readFile(join(root, "note.md"), "utf8")).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// Security boundary: keep one end-to-end symlink side-effect check; do not add
// one test per operation unless a distinct escape or mutation is introduced.
describe("folder containment for document I/O", () => {
  test("a symlinked directory cannot be read, written, created in or deleted from", async () => {
    const base = await mkdtemp(join(tmpdir(), "editor-symlink-"));
    const root = join(base, "folder");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "SECRET\n");
    await symlink(outside, join(root, "link"));

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

      // The file outside the folder is untouched by any of it.
      await expect(readFile(join(outside, "secret.md"), "utf8")).resolves.toBe("SECRET\n");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
