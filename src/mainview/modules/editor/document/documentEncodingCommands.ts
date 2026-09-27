/**
 * The Convert Encoding command family and the names Fulvid shows for encodings.
 *
 * One list so the Format menu, the command registry and the status bar cannot
 * disagree about which encodings exist. The names themselves are standard
 * identifiers rather than prose: they go through i18n like every other label, and
 * every catalog keeps them identical so a document's encoding is recognisable in
 * any language.
 */
import type { DocumentEncoding } from "../../workspace/filesystem/workspaceTypes";

/** i18n key for each encoding's standard name. */
export const ENCODING_LABEL_KEYS: Record<DocumentEncoding, string> = {
  utf8: "encodings.utf8",
  "utf8-bom": "encodings.utf8Bom",
  utf16le: "encodings.utf16le",
  utf16be: "encodings.utf16be",
};

/**
 * One command per conversion target. Adding an encoding means adding it here and
 * to `ENCODING_LABEL_KEYS`, which the compiler requires.
 */
export const CONVERT_ENCODING_COMMANDS = [
  { id: "convertEncodingUtf8", encoding: "utf8" },
  { id: "convertEncodingUtf8Bom", encoding: "utf8-bom" },
  { id: "convertEncodingUtf16Le", encoding: "utf16le" },
  { id: "convertEncodingUtf16Be", encoding: "utf16be" },
] as const satisfies readonly { id: string; encoding: DocumentEncoding }[];

export type ConvertEncodingCommandId = (typeof CONVERT_ENCODING_COMMANDS)[number]["id"];
