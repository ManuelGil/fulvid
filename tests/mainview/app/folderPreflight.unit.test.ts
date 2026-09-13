import { describe, expect, test } from "bun:test";

import {
  folderDocumentPreflight,
  shouldLoadFolderWorkspace,
} from "../../../src/mainview/app/folderPreflight";
import type { ScannedNote } from "../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";

function note(path: string): ScannedNote {
  return {
    path,
    name: path,
    title: path,
    aliases: [],
    documentLinks: [],
    tags: [],
    categories: [],
    projects: [],
    summary: "",
    words: 0,
  };
}

// Intent: a complete empty scan must not become a folder; a partial one must not
// be reported as having no documents. Growth boundary: add a case only if the
// load rule or the Markdown/MDX split changes.
describe("folder document preflight", () => {
  test("loads when documents exist or the scan cannot honestly say there are none", () => {
    const markdown = folderDocumentPreflight({
      scannedNotes: [note("a.md"), note("b.markdown")],
      truncated: false,
      skipped: 0,
    });
    expect(markdown).toEqual({ markdown: 2, mdx: 0, total: 2, complete: true });
    expect(shouldLoadFolderWorkspace(markdown)).toBe(true);

    const mdx = folderDocumentPreflight({
      scannedNotes: [note("page.mdx")],
      truncated: false,
      skipped: 0,
    });
    expect(mdx).toEqual({ markdown: 0, mdx: 1, total: 1, complete: true });
    expect(shouldLoadFolderWorkspace(mdx)).toBe(true);

    const empty = folderDocumentPreflight({
      scannedNotes: [],
      truncated: false,
      skipped: 0,
    });
    expect(empty).toEqual({ markdown: 0, mdx: 0, total: 0, complete: true });
    expect(shouldLoadFolderWorkspace(empty)).toBe(false);

    expect(
      shouldLoadFolderWorkspace(
        folderDocumentPreflight({ scannedNotes: [], truncated: true, skipped: 0 }),
      ),
    ).toBe(true);
    expect(
      shouldLoadFolderWorkspace(
        folderDocumentPreflight({ scannedNotes: [], truncated: false, skipped: 1 }),
      ),
    ).toBe(true);
  });
});
