import { inflateSync } from 'node:zlib';

/**
 * The words printed in a PDF this server made, as one string.
 *
 * A PDF's pages are compressed content streams, and pdfkit writes each run of
 * text as hex-encoded character codes inside a `TJ` array — so searching the
 * file's bytes for a name finds nothing whether or not the name is on the page.
 * An assertion that a name is absent would pass on every PDF ever made.
 *
 * This undoes both layers: inflate every stream, then decode the hex strings
 * in each text operator. Enough for pdfkit's standard fonts, which is all the
 * server uses; not a general PDF reader, and not meant to be one.
 */
export function pdfText(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const latin = raw.toString('latin1');
  const runs = [];

  const streamRe = /stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end === -1) break;
    const body = raw.subarray(start, end);
    let content;
    try {
      content = inflateSync(body).toString('latin1');
    } catch {
      // Not compressed, or not a content stream (a font program, an image).
      content = body.toString('latin1');
    }
    for (const op of content.matchAll(/\[(.*?)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/gs)) {
      const hexes = op[1] !== undefined ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]) : [op[2]];
      runs.push(hexes.map(decodeHex).join(''));
    }
    streamRe.lastIndex = end;
  }

  return runs.join('\n');
}

function decodeHex(hex) {
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return out;
}
