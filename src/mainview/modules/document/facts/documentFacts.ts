/** Facts shown beside a document in Context and Search. */
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import { i18n } from "../../../i18n";
import { noteConnections, unresolvedDocumentLinks } from "../links/linkSemantics";

export type DocumentFactId =
  | "documents"
  | "references"
  | "words"
  | "tags"
  | "incomplete_references"
  | "outbound_references"
  | "inbound_references"
  | "reachability";

export interface DocumentFact {
  id: DocumentFactId;
  label: string;
  value: string;
}

const FACT_KEYS: Record<DocumentFactId, string> = {
  documents: "facts.documents",
  references: "facts.references",
  words: "facts.words",
  tags: "facts.tags",
  incomplete_references: "facts.incompleteReferences",
  outbound_references: "facts.outboundReferences",
  inbound_references: "facts.inboundReferences",
  reachability: "facts.reachability",
};

export function documentFactLabel(id: DocumentFactId): string {
  return i18n.global.t(FACT_KEYS[id]);
}

export function documentFact(id: DocumentFactId, value: string): DocumentFact {
  return {
    id,
    label: documentFactLabel(id),
    value,
  };
}

/** Reference structure for a document. */
export function documentReferenceFacts(path: string, notes: ScannedNote[]): DocumentFact[] {
  const note = notes.find((entry) => entry.path === path);
  if (!note) {
    return [];
  }

  const { references, referencedBy } = noteConnections(path, notes);
  const incomplete = unresolvedDocumentLinks(note, notes).length;
  const facts: DocumentFact[] = [];

  if (references.length === 0 && referencedBy.length === 0) {
    facts.push(documentFact("references", i18n.global.t("facts.noReferences")));
    if (incomplete > 0) {
      facts.push(
        documentFact(
          "incomplete_references",
          i18n.global.t("facts.incomplete", {
            count: incomplete.toLocaleString(i18n.global.locale.value),
          }),
        ),
      );
    }
    return facts;
  }

  facts.push(
    documentFact(
      "outbound_references",
      i18n.global.t("facts.outbound", {
        count: references.length.toLocaleString(i18n.global.locale.value),
      }),
    ),
  );
  facts.push(
    documentFact(
      "inbound_references",
      i18n.global.t("facts.inbound", {
        count: referencedBy.length.toLocaleString(i18n.global.locale.value),
      }),
    ),
  );

  if (incomplete > 0) {
    facts.push(
      documentFact(
        "incomplete_references",
        i18n.global.t("facts.incomplete", {
          count: incomplete.toLocaleString(i18n.global.locale.value),
        }),
      ),
    );
  }

  return facts;
}

/** Compact continuity line for document rows. */
export function formatDocumentFacts(facts: readonly DocumentFact[]): string {
  return facts.map((fact) => fact.value).join(" · ");
}

export function documentFactsForNote(note: ScannedNote): DocumentFact[] {
  const facts: DocumentFact[] = [documentFact("words", note.words.toLocaleString())];

  if (note.tags.length > 0) {
    facts.push(documentFact("tags", note.tags.join(", ")));
  }

  return facts;
}
