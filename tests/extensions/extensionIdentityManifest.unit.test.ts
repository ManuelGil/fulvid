import { describe, expect, test } from "bun:test";

import {
  namespacedExtensionCommandId,
  validateExtensionManifest,
} from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";

describe("publisher.name extension identity contract", () => {
  test("accepts publisher.name identities and namespaces commands", () => {
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

    expect(validateExtensionManifest(luaManifest("acme.notify-demo"))).toMatchObject({
      manifest: { id: "acme.notify-demo", publisher: "acme", name: "notify-demo" },
    });

    expect(
      validateExtensionManifest(
        luaManifest("acme.example-extension", ["lua", "commands", "ui"], {
          displayName: "Example Extension",
          description: "An extension from an arbitrary publisher.",
        }),
      ),
    ).toMatchObject({
      manifest: {
        id: "acme.example-extension",
        publisher: "acme",
        name: "example-extension",
      },
    });

    expect(namespacedExtensionCommandId("imgildev.todo-decorator", "todoNext")).toBe(
      "imgildev.todo-decorator.todoNext",
    );
  });

  test("rejects reserved local, mismatches, unknown caps, and invalid presentation", () => {
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

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.doc-demo", ["templates", "commands"], { entry: undefined }),
      }),
    ).toEqual({ reason: "templates capability requires the lua capability" });

    expect(
      validateExtensionManifest(
        luaManifest("test.no-lua-editor", ["editor", "commands"], {
          entry: undefined,
        }),
      ),
    ).toEqual({ reason: "editor capability requires the lua capability" });

    expect(
      validateExtensionManifest(
        luaManifest("test.no-lua-doc", ["document", "commands"], {
          entry: undefined,
        }),
      ),
    ).toEqual({ reason: "document capability requires the lua capability" });

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
