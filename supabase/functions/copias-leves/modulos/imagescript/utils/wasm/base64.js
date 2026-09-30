// Parte local da cópia do imagescript: base64 -> bytes do .wasm (atob existe no Deno e no Edge Runtime).
export function bytesDoBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
