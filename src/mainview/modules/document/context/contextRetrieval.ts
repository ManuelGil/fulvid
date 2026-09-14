/** Inspector context helpers - narrative only. */
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import {
  buildFocusGraph,
  candidateNotesForLink,
  noteConnections,
  resolvingDocumentLinks,
  unresolvedDocumentLinks,
} from "../links/linkSemantics";
import { documentFact, type DocumentFact } from "../facts/documentFacts";
import { i18n } from "../../../i18n";

interface NoteReach {
  documents: number;
}

/**
 * Documents reachable by following explicit references from this document,
 * excluding itself.
 */
export function noteReach(focusPath: string, notes: ScannedNote[]): NoteReach {
  const reached = buildFocusGraph(focusPath, notes, Number.POSITIVE_INFINITY).nodes.filter(
    (node) => node.id !== focusPath,
  );

  return { documents: reached.length };
}

export function noteReachFacts(reach: NoteReach): DocumentFact[] {
  if (reach.documents <= 0) {
    return [];
  }

  return [documentFact("documents", reach.documents.toLocaleString())];
}

/** Context narrative kept short; detailed references appear in their own sections. */
export function buildReadingGuidance(focusPath: string, notes: ScannedNote[]): string[] {
  const note = notes.find((entry) => entry.path === focusPath);
  if (!note) {
    return [];
  }

  const { references, referencedBy } = noteConnections(focusPath, notes);
  const incomplete = unresolvedDocumentLinks(note, notes);
  const paragraphs: string[] = [];

  if (references.length === 0 && referencedBy.length === 0) {
    if (incomplete.length > 0) {
      paragraphs.push(
        incomplete.length === 1
          ? i18n.global.t("context.incompleteOne", {
              count: incomplete.length.toLocaleString(i18n.global.locale.value),
            })
          : i18n.global.t("context.incompleteMany", {
              count: incomplete.length.toLocaleString(i18n.global.locale.value),
            }),
      );
      if (incompleteHasCandidates(incomplete, notes)) {
        paragraphs.push(i18n.global.t("context.nearbyHint"));
      }
    }
    return paragraphs;
  }

  const neighborCount = new Set([...references, ...referencedBy]).size;
  paragraphs.push(
    neighborCount === 1
      ? i18n.global.t("context.sharedOne")
      : i18n.global.t("context.sharedMany", {
          count: neighborCount.toLocaleString(i18n.global.locale.value),
        }),
  );

  if (incomplete.length > 0) {
    paragraphs.push(
      incomplete.length === 1
        ? i18n.global.t("context.unresolvedOne", {
            count: incomplete.length.toLocaleString(i18n.global.locale.value),
          })
        : i18n.global.t("context.unresolvedMany", {
            count: incomplete.length.toLocaleString(i18n.global.locale.value),
          }),
    );
    if (incompleteHasCandidates(incomplete, notes)) {
      paragraphs.push(i18n.global.t("context.nearbyHint"));
    }
  }

  return paragraphs;
}

function incompleteHasCandidates(incomplete: string[], notes: ScannedNote[]): boolean {
  return incomplete.some((link) => candidateNotesForLink(link, notes).length > 0);
}

/**
 * Structural reason two documents share a reference - raw link text only.
 */
export function explainReferenceEvidence(
  fromPath: string,
  toPath: string,
  notes: ScannedNote[],
): string | null {
  const source = notes.find((note) => note.path === fromPath);
  if (!source) {
    return null;
  }

  const links = resolvingDocumentLinks(source, toPath, notes);
  if (links.length === 0) {
    return null;
  }

  return i18n.global.t("context.referenceEvidence", {
    links: links.join(", "),
  });
}
