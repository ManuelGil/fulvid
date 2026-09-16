import { describe, expect, test } from "bun:test";

import {
  migrateLegacyExtensionId,
  namespacedExtensionCommandId,
  validateExtensionManifest,
} from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";

describe("publisher.name extension identity contract", () => {
  test("accepts official and arbitrary publisher manifests", () => {
    const official = validateExtensionManifest(
      luaManifest("imgildev.todo-decorator", ["lua", "commands", "ui", "document"], {
        displayName: "TODO Decorator",
        description: "Decorates TODO markers.",
      }),
    );
    expect(official).toMatchObject({
      manifest: {
        id: "imgildev.todo-decorator",
        publisher: "imgildev",
        name: "todo-decorator",
      },
    });

    const thirdParty = validateExtensionManifest(
      luaManifest("acme.example-extension", ["lua", "commands", "ui"], {
        displayName: "Example Extension",
        description: "An extension from an arbitrary publisher.",
      }),
    );
    expect(thirdParty).toMatchObject({
      manifest: {
        id: "acme.example-extension",
        publisher: "acme",
        name: "example-extension",
      },
    });
  });

  test("rejects the reserved local publisher", () => {
    expect(
      validateExtensionManifest({
        ...luaManifest("imgildev.todo-decorator"),
        publisher: "local",
        id: "local.todo-decorator",
      }),
    ).toEqual({ reason: "reserved publisher" });
  });

  test("rejects a missing publisher before legacy id validation", () => {
    expect(
      validateExtensionManifest({
        ...luaManifest("local.legacy-extension"),
        publisher: undefined,
      }),
    ).toEqual({ reason: "invalid publisher" });
  });

  test("rejects an id that does not match publisher.name", () => {
    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        id: "acme.other-extension",
      }),
    ).toEqual({ reason: "id must equal publisher.name" });
  });

  test("rejects invalid version, empty presentation text, and oversized keywords", () => {
    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        version: "1.0",
      }),
    ).toEqual({ reason: "invalid extension version" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        displayName: " ",
      }),
    ).toEqual({ reason: "invalid displayName" });

    expect(
      validateExtensionManifest({
        ...luaManifest("acme.example-extension"),
        description: "",
      }),
    ).toEqual({ reason: "invalid description" });

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

  test("migrates known local identities and rejects unknown local ids", () => {
    expect(migrateLegacyExtensionId("local.todo-decorator")).toBe("imgildev.todo-decorator");
    expect(migrateLegacyExtensionId("local.blank-note")).toBe("fulvid.blank-note");
    expect(migrateLegacyExtensionId("local.host-notify")).toBe("fulvid.host-notify");
    expect(migrateLegacyExtensionId("local.unknown")).toBeNull();
    expect(migrateLegacyExtensionId("acme.example-extension")).toBe("acme.example-extension");
  });

  test("namespaces commands with the canonical extension id", () => {
    expect(namespacedExtensionCommandId("imgildev.todo-decorator", "todoNext")).toBe(
      "imgildev.todo-decorator.todoNext",
    );
  });
});
