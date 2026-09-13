import { describe, expect, test } from "bun:test";

import {
  auditCatalogs,
  auditI18n,
  hasBlockingIssues,
  type MessageCatalog,
} from "../../scripts/i18nCheck";

const english = {
  app: {
    title: "Fulvid",
    greeting: "Hello {name}",
  },
  nested: {
    value: "Value",
  },
} satisfies MessageCatalog;

const spanish = {
  app: {
    title: "Fulvid",
    greeting: "Hola {name}",
  },
  nested: {
    value: "Valor",
  },
} satisfies MessageCatalog;

// Intent: fail the catalog gate on missing structure, missing usages, or unescaped pipes.
describe("i18n catalog auditor", () => {
  test("reports missing keys, unused static usages, and unescaped plural pipes", () => {
    expect(
      auditCatalogs({
        en: english,
        es: {
          app: spanish.app,
        },
      }).missingKeys,
    ).toEqual([{ locale: "es", key: "nested.value" }]);

    const missingUsage = auditI18n({ en: english, es: spanish }, [
      {
        path: "src/mainview/Missing.vue",
        content: `<template><button :aria-label="t('actions.missing')">Save</button></template>`,
      },
    ]);
    expect(missingUsage.missingUsages).toEqual([
      { file: "src/mainview/Missing.vue", line: 1, key: "actions.missing" },
    ]);
    expect(hasBlockingIssues(missingUsage)).toBe(true);

    const pipes = auditI18n({
      en: { hint: "Treat [[note]] and [[note|Label]] as document links." },
      es: { hint: "Trata [[note]] y [[note\\|Label]] como enlaces." },
    });
    expect(pipes.unescapedPipes).toEqual([{ locale: "en", key: "hint" }]);
    expect(hasBlockingIssues(pipes)).toBe(true);
  });
});
