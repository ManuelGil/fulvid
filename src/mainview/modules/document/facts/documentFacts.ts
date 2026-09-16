/** Facts shown beside a document in Context and Search. */
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import { i18n } from "../../../i18n";

export type DocumentFactId =
  | "documents"
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

export function documentFactsForNote(note: ScannedNote): DocumentFact[] {
  const facts: DocumentFact[] = [documentFact("words", note.words.toLocaleString())];

  if (note.tags.length > 0) {
    facts.push(documentFact("tags", note.tags.join(", ")));
  }

  return facts;
}
