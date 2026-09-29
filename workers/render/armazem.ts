/**
 * Storage do Supabase pelo HTTP (frente EDT): baixar direto para o disco (nunca
 * o arquivo inteiro na memória) e subir o MP4 pelo upload resumível (TUS) em
 * partes de 6 MB, o tamanho que o Storage exige (docs/video/CONTRATOS.md).
 * A base e a chave vêm do ambiente; nada é gravado em arquivo.
 */

import { createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PARTE_DO_UPLOAD_BYTES } from "../../supabase/functions/_shared/render-do-editor.ts";

export interface Armazem {
  baixar(bucket: string, caminho: string, destino: string): Promise<number>;
  subir(bucket: string, caminho: string, arquivo: string, tipo: string, aoAndar?: (feito: number, total: number) => void): Promise<void>;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const caminhoUrl = (c: string) => c.split("/").map(encodeURIComponent).join("/");

export function metadadosDoTus(bucket: string, caminho: string, tipo: string): string {
  return [`bucketName ${b64(bucket)}`, `objectName ${b64(caminho)}`, `contentType ${b64(tipo)}`, `cacheControl ${b64("3600")}`].join(",");
}

export function armazemSupabase(base: string, chave: string, o: { parte?: number; tentativas?: number } = {}): Armazem {
  const raiz = base.replace(/\/+$/, "");
  const parte = o.parte || PARTE_DO_UPLOAD_BYTES;
  const tentativas = o.tentativas || 3;
  const cab = { Authorization: `Bearer ${chave}`, apikey: chave };
  return {
    async baixar(bucket, caminho, destino) {
      const r = await fetch(`${raiz}/storage/v1/object/${encodeURIComponent(bucket)}/${caminhoUrl(caminho)}`, { headers: cab });
      if (!r.ok || !r.body) throw new Error(`Não baixou ${bucket}/${caminho} (HTTP ${r.status}).`);
      await pipeline(Readable.fromWeb(r.body as import("node:stream/web").ReadableStream), createWriteStream(destino));
      return (await stat(destino)).size;
    },
    async subir(bucket, caminho, arquivo, tipo, aoAndar) {
      const total = (await stat(arquivo)).size;
      const criar = await fetch(`${raiz}/storage/v1/upload/resumable`, {
        method: "POST",
        headers: { ...cab, "Tus-Resumable": "1.0.0", "Upload-Length": String(total), "Upload-Metadata": metadadosDoTus(bucket, caminho, tipo), "x-upsert": "true" },
      });
      if (criar.status !== 201) throw new Error(`O Storage não abriu o envio (HTTP ${criar.status}).`);
      const onde = criar.headers.get("location") || "";
      const url = /^https?:\/\//.test(onde) ? onde : `${raiz}${onde.indexOf("/") === 0 ? "" : "/"}${onde}`;
      const f = await open(arquivo, "r");
      try {
        let feito = 0;
        const buf = Buffer.alloc(parte);
        while (feito < total) {
          const { bytesRead } = await f.read(buf, 0, Math.min(parte, total - feito), feito);
          let ok = false;
          let ultimo = "";
          for (let t = 0; t < tentativas && !ok; t++) {
            const r = await fetch(url, {
              method: "PATCH",
              headers: { ...cab, "Tus-Resumable": "1.0.0", "Upload-Offset": String(feito), "Content-Type": "application/offset+octet-stream" },
              body: buf.subarray(0, bytesRead),
            }).catch((e: unknown) => {
              ultimo = e instanceof Error ? e.message : "rede";
              return null;
            });
            if (r && (r.status === 204 || r.status === 200)) {
              const novo = Number(r.headers.get("upload-offset"));
              feito = isFinite(novo) && novo > feito ? novo : feito + bytesRead;
              ok = true;
            } else if (r) ultimo = `HTTP ${r.status}`;
          }
          if (!ok) throw new Error(`Parte do envio falhou em ${feito} de ${total} bytes (${ultimo}).`);
          if (aoAndar) aoAndar(feito, total);
        }
      } finally {
        await f.close();
      }
    },
  };
}
