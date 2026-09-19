import { describe, expect, test } from "bun:test";

import {
  namespacedExtensionCommandId,
  validateExtensionManifest,
} from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";

describe("publisher.name extension identity contract", () => {
  test("manifest identity accepts valid publisher.name and rejects reserved, mismatched, and invalid presentation", () => {
    expect(
      validateExtensionManifest(
        luaManifest("imgildev.todo-decorator", ["lua", "commands", "ui", "document"], {
          displayName: "TODO Decorator",
          description: "Decorates TODO markers.",
        }),
      ),
    ).toMatchObject({
      manifest: {
        id: "imgildev.todo-decorator",
        publisher: "imgildev",
        name: "todo-decorator",
      },
    });

    expect(namespacedExtensionCommandId("imgildev.todo-decorator", "todoNext")).toBe(
      "imgildev.todo-decorator.todoNext",
    );

    expect(
      validateExtensionManifest({
        ...luaManifest("imgildev.todo-decorator"),
        publisher: "local",
        id: "local.todo-decorator",
      }),
    ).toEqual({
      reason: 'reserved publisher: "local" is not allowed; use your own slug',
    });

    expect(
      validateExtensionManifest({
        ...luaManifest("local.retired-extension"),
        publisher: undefined,
      }),
    ).toMatchObject({
      reason: expect.stringMatching(/^invalid publisher:/),
    });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        id: "acme.other-extension",
      }),
    ).toEqual({
      reason: 'id must equal publisher.name (expected "acme.example-extension")',
    });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.notify-demo"),
        api: 2,
      }),
    ).toEqual({ reason: "unsupported api version: 2" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.notify-demo"),
        capabilities: ["monaco"],
      }),
    ).toEqual({ reason: "unknown capability: monaco" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.notify-demo"),
        capabilities: ["commands", "ui"],
        entry: undefined,
      }),
    ).toEqual({ reason: "commands capability requires the lua capability" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.notify-demo"),
        commands: [{ id: "ping", title: "Ping", action: "notify", message: "hi" }],
      }),
    ).toEqual({ reason: "forbidden manifest key: commands" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.doc-demo", ["lua", "commands", "ui", "document"]),
        templates: [{ id: "t", name: "T", file: "t.md" }],
      }),
    ).toEqual({ reason: "forbidden manifest key: templates" });

    expect(
      validateExtensionManifest({
        ...luaManifest("imgildev.adr-templates", [
          "lua",
          "commands",
          "ui",
          "document",
          "templates",
        ]),
      }),
    ).toMatchObject({
      manifest: expect.objectContaining({
        capabilities: expect.arrayContaining(["templates"]),
      }),
    });

    // One representative: host capabilities require lua (templates/editor/document share the rule).
    expect(
      validateExtensionManifest({
        ...luaManifest("acme.doc-demo", ["templates", "commands"], { entry: undefined }),
      }),
    ).toEqual({ reason: "templates capability requires the lua capability" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        version: "1.0",
      }),
    ).toEqual({
      reason: 'invalid extension version: expect semver MAJOR.MINOR.PATCH (e.g. "1.0.0")',
    });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        displayName: " ",
      }),
    ).toEqual({ reason: "invalid displayName: non-empty string required" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        description: "",
      }),
    ).toEqual({ reason: "invalid description: non-empty string required" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        keywords: Array.from({ length: 9 }, (_, index) => `keyword-${index}`),
      }),
    ).toEqual({ reason: "too many keywords" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        keywords: ["x".repeat(33)],
      }),
    ).toEqual({ reason: "invalid keyword" });
  });
});
