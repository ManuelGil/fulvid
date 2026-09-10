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

// Intent: fail the catalog gate on missing structure or statically missing keys.
// Growth boundary: add cases only for new blocking audit rules.
describe("i18n catalog auditor", () => {
  test("reports a missing key", () => {
    const report = auditCatalogs({
      en: english,
      es: {
        app: spanish.app,
      },
    });

    expect(report.missingKeys).toEqual([{ locale: "es", key: "nested.value" }]);
  });

  test("reports a statically used key that is absent from every catalog", () => {
    const report = auditI18n({ en: english, es: spanish }, [
      {
        path: "src/mainview/Missing.vue",
        content: `<template><button :aria-label="t('actions.missing')">Save</button></template>`,
      },
    ]);

    expect(report.missingUsages).toEqual([
      {
        file: "src/mainview/Missing.vue",
        line: 1,
        key: "actions.missing",
      },
    ]);
    expect(hasBlockingIssues(report)).toBe(true);
  });

  test("reports an unescaped | that vue-i18n would treat as a plural split", () => {
    const report = auditI18n({
      en: {
        hint: "Treat [[note]] and [[note|Label]] as document links.",
      },
      es: {
        hint: "Trata [[note]] y [[note\\|Label]] como enlaces.",
      },
    });

    expect(report.unescapedPipes).toEqual([{ locale: "en", key: "hint" }]);
    expect(hasBlockingIssues(report)).toBe(true);
  });
});
