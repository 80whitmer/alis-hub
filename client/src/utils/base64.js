/**
 * Converts an ArrayBuffer to a base64 string in fixed-size chunks rather
 * than one `String.fromCharCode` call (or one string concatenation) per
 * byte — the naive `new Uint8Array(buf).reduce((s, b) => s +
 * String.fromCharCode(b), '')` pattern this replaces does a full string
 * copy per byte, which becomes noticeably slow (and can be tab-freezing)
 * once a file gets into the multi-MB range — exactly the size a real
 * multi-page PDF report can reach. 32KB chunks stay well under
 * `String.fromCharCode.apply`'s argument-count ceiling in every browser
 * this app targets.
 */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
