/** Inspector context helpers - narrative only. */
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import {
  ambiguousOutboundLinks,
  buildFocusGraph,
  candidateNotesForLink,
  noteConnections,
  resolvingDocumentLinks,
  unresolvedDocumentLinks,
} from "../links/linkSemantics";
import { documentFact, type DocumentFact } from "../facts/documentFacts";
import { i18n } from "../../../i18n";

/**
 * How many documents are reachable by following explicit references from this
 * document, excluding itself - as a fact, or none when nothing is reachable.
 */
export function noteReachFacts(focusPath: string, notes: ScannedNote[]): DocumentFact[] {
  const reached = buildFocusGraph(focusPath, notes, Number.POSITIVE_INFINITY).nodes.filter(
    (node) => node.id !== focusPath,
  ).length;
  return reached > 0 ? [documentFact("documents", reached.toLocaleString())] : [];
}

/** Context narrative kept short; detailed references appear in their own sections. */
export function buildReadingGuidance(focusPath: string, notes: ScannedNote[]): string[] {
  const note = notes.find((entry) => entry.path === focusPath);
  if (!note) {
    return [];
  }

  const { references, referencedBy } = noteConnections(focusPath, notes);
  const incomplete = unresolvedDocumentLinks(note, notes);
  const ambiguous = ambiguousOutboundLinks(note, notes);
  const connected = references.length > 0 || referencedBy.length > 0;
  const paragraphs: string[] = [];

  if (connected) {
    const neighborCount = new Set([...references, ...referencedBy]).size;
    paragraphs.push(
      neighborCount === 1
        ? i18n.global.t("context.sharedOne")
        : i18n.global.t("context.sharedMany", {
            count: neighborCount.toLocaleString(i18n.global.locale.value),
          }),
    );
  }

  if (incomplete.length > 0) {
    // Beside shared references these links are "unresolved"; in a document
    // with none they are the whole story, so they read as "incomplete".
    const one = incomplete.length === 1;
    paragraphs.push(
      i18n.global.t(
        connected
          ? one
            ? "context.unresolvedOne"
            : "context.unresolvedMany"
          : one
            ? "context.incompleteOne"
            : "context.incompleteMany",
        { count: incomplete.length.toLocaleString(i18n.global.locale.value) },
      ),
    );
    if (incomplete.some((link) => candidateNotesForLink(link, notes).length > 0)) {
      paragraphs.push(i18n.global.t("context.nearbyHint"));
    }
  }

  if (ambiguous.length > 0) {
    paragraphs.push(
      ambiguous.length === 1
        ? i18n.global.t("context.ambiguousOne")
        : i18n.global.t("context.ambiguousMany", {
            count: ambiguous.length.toLocaleString(i18n.global.locale.value),
          }),
    );
  }

  return paragraphs;
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
