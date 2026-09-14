/**
 * Document Context helpers shared by inspector and Search summaries.
 * Document counts only — not a folder-level Context root.
 */
import { i18n } from "../../../i18n";

/** One notation for document counts everywhere: "1 document", "12 documents". */
export function formatDocumentCount(count: number): string {
  return i18n.global.t(count === 1 ? "context.oneDocument" : "context.manyDocuments", {
    count: count.toLocaleString(i18n.global.locale.value),
  });
}
