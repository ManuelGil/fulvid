/**
 * Seed text for untitled documents.
 *
 * Templates are not document types, stored notes, or a second lifecycle —
 * only the initial buffer body passed to `createUntitledDocument`.
 */
export type DocumentTemplateId = "blank" | "note" | "meeting" | "daily" | "project";

export type DocumentTemplate = {
  id: DocumentTemplateId;
  labelKey: `templates.${DocumentTemplateId}`;
  body: string;
};

const DATE_TOKEN = "{date}";

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: "blank",
    labelKey: "templates.blank",
    body: "",
  },
  {
    id: "note",
    labelKey: "templates.note",
    body: `# Note

`,
  },
  {
    id: "meeting",
    labelKey: "templates.meeting",
    body: `# Meeting

Date: {date}

## Attendees

-

## Notes

-

## Actions

- [ ]
`,
  },
  {
    id: "daily",
    labelKey: "templates.daily",
    body: `# {date}

## Today

-

## Later
`,
  },
  {
    id: "project",
    labelKey: "templates.project",
    body: `# Project

## Goal

-

## Status

-

## Next
`,
  },
];

export function documentTemplateDate(now = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Expand `{date}` in a template. Empty string if the id is unknown. */
export function renderDocumentTemplate(id: DocumentTemplateId, now = new Date()): string {
  const template = DOCUMENT_TEMPLATES.find((entry) => entry.id === id);
  if (!template) {
    return "";
  }
  return template.body.replaceAll(DATE_TOKEN, documentTemplateDate(now));
}
