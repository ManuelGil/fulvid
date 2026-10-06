/**
 * The one place document bytes become text, and text becomes bytes.
 *
 * `readFile(path, "utf8")` decodes in replacement mode: an invalid byte becomes
 * U+FFFD, the editor shows that replacement character as if it were the
 * document, and the next save writes it back - the original bytes are gone and
 * nobody was told. Every decode here is strict, so that silent loss becomes a
 * refusal the renderer can explain, and every encode refuses text it cannot
 * write faithfully rather than substituting characters.
 *
 * A document's encoding is metadata of this boundary. It is detected here,
 * travels with the snapshot, and comes back with the write. Nothing downstream
 * keeps a second copy of the bytes: Monaco owns the text, the file owns the
 * bytes, and this module converts between them.
 */
import { filesystemErrorMessage } from "../../../mainview/modules/workspace/filesystem/workspaceErrors";
import {
  DEFAULT_DOCUMENT_ENCODING,
  hasUnpairedSurrogate,
  type DocumentEncoding,
} from "../../../mainview/modules/workspace/filesystem/workspaceTypes";

const UTF8_BOM_BYTES = [0xef, 0xbb, 0xbf] as const;
const UTF16LE_BOM_BYTES = [0xff, 0xfe] as const;
const UTF16BE_BOM_BYTES = [0xfe, 0xff] as const;

/** `ignoreBOM` because this module slices a BOM off itself before decoding. */
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const utf16LeDecoder = new TextDecoder("utf-16le", { ignoreBOM: true });
const utf16BeDecoder = new TextDecoder("utf-16be", { ignoreBOM: true });
const utf8Encoder = new TextEncoder();

function refuseUndecodable(): never {
  throw new Error(filesystemErrorMessage("undecodableDocument"));
}

function startsWithBytes(bytes: Uint8Array | Buffer, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Which supported encoding these bytes are in.
 *
 * Only a BOM decides between encodings; without one the bytes are read as UTF-8
 * and the decode itself proves whether that was right. Fulvid does not guess
 * between encodings that a file cannot distinguish for it.
 */
export function detectDocumentEncoding(bytes: Uint8Array | Buffer): DocumentEncoding {
  if (startsWithBytes(bytes, UTF8_BOM_BYTES)) {
    return "utf8-bom";
  }
  if (startsWithBytes(bytes, UTF16LE_BOM_BYTES)) {
    // FF FE 00 00 is a UTF-32 LE BOM. Reading it as UTF-16 would produce text
    // full of NUL characters and write that back, so it is refused instead.
    if (bytes.length >= 4 && bytes[2] === 0x00 && bytes[3] === 0x00) {
      refuseUndecodable();
    }
    return "utf16le";
  }
  if (startsWithBytes(bytes, UTF16BE_BOM_BYTES)) {
    return "utf16be";
  }
  return DEFAULT_DOCUMENT_ENCODING;
}

/** One UTF-16 code unit at a byte offset. */
function utf16CodeUnitAt(bytes: Uint8Array | Buffer, index: number, littleEndian: boolean): number {
  const first = bytes[index] ?? 0;
  const second = bytes[index + 1] ?? 0;
  return littleEndian ? first | (second << 8) : (first << 8) | second;
}

/**
 * A UTF-16 document whose surrogates do not pair is not valid Unicode.
 *
 * The decoder would replace each lone unit with U+FFFD and the next save would
 * write that replacement, so the file is refused while it is still intact.
 */
function hasUnpairedUtf16Surrogate(body: Uint8Array | Buffer, littleEndian: boolean): boolean {
  for (let index = 0; index + 1 < body.length; index += 2) {
    const unit = utf16CodeUnitAt(body, index, littleEndian);
    if (unit < 0xd800 || unit > 0xdfff) {
      continue;
    }
    if (unit > 0xdbff) {
      return true;
    }
    const next = index + 3 < body.length ? utf16CodeUnitAt(body, index + 2, littleEndian) : 0;
    if (next < 0xdc00 || next > 0xdfff) {
      return true;
    }
    index += 2;
  }
  return false;
}

function decodeUtf16(bytes: Uint8Array | Buffer, encoding: "utf16le" | "utf16be"): string {
  const littleEndian = encoding === "utf16le";
  const bom = littleEndian ? UTF16LE_BOM_BYTES : UTF16BE_BOM_BYTES;
  const body = bytes.subarray(bom.length);
  // An odd byte count leaves half a code unit, which the decoder would turn into
  // U+FFFD. That is a malformed document, not a document with a replacement
  // character in it.
  if (body.length % 2 !== 0 || hasUnpairedUtf16Surrogate(body, littleEndian)) {
    refuseUndecodable();
  }
  return littleEndian ? utf16LeDecoder.decode(body) : utf16BeDecoder.decode(body);
}

/**
 * Document text from bytes read in `encoding`, or a refusal when the bytes are
 * not that encoding. The BOM never reaches the text: it is what `encoding`
 * already records.
 */
export function decodeDocumentText(bytes: Uint8Array | Buffer, encoding: DocumentEncoding): string {
  switch (encoding) {
    case "utf16le":
    case "utf16be":
      return decodeUtf16(bytes, encoding);
    case "utf8-bom":
    case "utf8": {
      const body = encoding === "utf8-bom" ? bytes.subarray(UTF8_BOM_BYTES.length) : bytes;
      try {
        return strictUtf8Decoder.decode(body);
      } catch {
        refuseUndecodable();
      }
    }
  }
}

const MAX_UTF8_SEQUENCE_BYTES = 4;

/** How many bytes the sequence starting at this lead byte occupies. */
function utf8SequenceLength(leadByte: number): number {
  if (leadByte >= 0xf0) {
    return 4;
  }
  if (leadByte >= 0xe0) {
    return 3;
  }
  if (leadByte >= 0xc0) {
    return 2;
  }
  return 1;
}

function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  const firstPossibleLead = bytes.length - MAX_UTF8_SEQUENCE_BYTES;
  for (let index = bytes.length - 1; index >= 0 && index >= firstPossibleLead; index -= 1) {
    const byte = bytes[index] ?? 0;
    if ((byte & 0b1100_0000) === 0b1000_0000) {
      continue;
    }
    // A lead byte: keep its sequence only when all of it was read.
    const expected = utf8SequenceLength(byte);
    return bytes.length - index >= expected ? bytes : bytes.subarray(0, index);
  }
  return bytes;
}

/**
 * Bytes without a character the read stopped in the middle of.
 *
 * Only the capped scan read needs this: it stops at a byte offset, so the last
 * character of a large document can be half there. Decoding is strict, so handing
 * those bytes over would refuse the whole document instead of analysing the part
 * that was read.
 */
export function trimPartialEncodedText(bytes: Uint8Array, encoding: DocumentEncoding): Uint8Array {
  if (encoding !== "utf16le" && encoding !== "utf16be") {
    return trimPartialUtf8(bytes);
  }
  // Whole code units only, and never a high surrogate whose pair was cut off.
  let end = bytes.length - (bytes.length % 2);
  if (end >= 2) {
    const unit = utf16CodeUnitAt(bytes, end - 2, encoding === "utf16le");
    if (unit >= 0xd800 && unit <= 0xdbff) {
      end -= 2;
    }
  }
  return bytes.subarray(0, end);
}

/**
 * Bytes for text written in `encoding`, or a refusal when the text cannot be
 * written faithfully. UTF-16 always gets its BOM: it is what makes the file
 * recognisable on the next open.
 *
 * The UTF-16 code units are written by hand because the platform ships no
 * UTF-16 encoder, and doing it directly keeps both byte orders symmetric.
 */
export function encodeDocumentText(
  text: string,
  encoding: DocumentEncoding,
): Uint8Array<ArrayBuffer> {
  if (hasUnpairedSurrogate(text)) {
    throw new Error(filesystemErrorMessage("unrepresentableInEncoding"));
  }

  if (encoding === "utf8" || encoding === "utf8-bom") {
    const body = utf8Encoder.encode(text);
    if (encoding === "utf8") {
      return body;
    }
    const bytes = new Uint8Array(UTF8_BOM_BYTES.length + body.length);
    bytes.set(UTF8_BOM_BYTES);
    bytes.set(body, UTF8_BOM_BYTES.length);
    return bytes;
  }

  const littleEndian = encoding === "utf16le";
  const bom = littleEndian ? UTF16LE_BOM_BYTES : UTF16BE_BOM_BYTES;
  const bytes = new Uint8Array(bom.length + text.length * 2);
  bytes.set(bom);
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const at = bom.length + index * 2;
    bytes[at] = littleEndian ? unit & 0xff : unit >>> 8;
    bytes[at + 1] = littleEndian ? unit >>> 8 : unit & 0xff;
  }
  return bytes;
}
