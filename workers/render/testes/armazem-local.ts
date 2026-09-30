/**
 * Storage local para os testes do worker (frente MOT): o mesmo protocolo do
 * Supabase que o worker usa (download do objeto e upload resumível TUS em
 * partes de 6 MB). Guarda tudo numa pasta do disco.
 */

import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { PARTE_DO_UPLOAD_BYTES } from "../../../supabase/functions/_shared/render-do-editor.ts";

export interface EnvioLocal {
  bucket: string;
  objeto: string;
  total: number;
  feito: number;
  arquivo: string;
  partes: number[];
}

export const CHAVE_LOCAL = "chave-de-teste-local-sem-valor";

export function armazemLocal(raiz: string): Promise<{ url: string; envios: EnvioLocal[]; fechar: () => void }> {
  const envios: EnvioLocal[] = [];
  const abertos: Record<string, EnvioLocal> = {};
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://x");
    if (String(req.headers.authorization || "") !== `Bearer ${CHAVE_LOCAL}`) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === "GET" && u.pathname.indexOf("/storage/v1/object/") === 0) {
      const f = path.join(raiz, decodeURIComponent(u.pathname.slice("/storage/v1/object/".length)));
      if (!existsSync(f)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      createReadStream(f).pipe(res);
      return;
    }
    if (req.method === "POST" && u.pathname === "/storage/v1/upload/resumable") {
      const meta: Record<string, string> = {};
      String(req.headers["upload-metadata"] || "")
        .split(",")
        .forEach((par) => {
          const [k, v] = par.trim().split(" ");
          if (k) meta[k] = Buffer.from(v || "", "base64").toString("utf8");
        });
      const id = `u${envios.length + 1}`;
      const e: EnvioLocal = { bucket: meta.bucketName, objeto: meta.objectName, total: Number(req.headers["upload-length"]), feito: 0, arquivo: path.join(raiz, `${id}.parte`), partes: [] };
      envios.push(e);
      abertos[id] = e;
      res.writeHead(201, { Location: `/storage/v1/upload/resumable/${id}`, "Tus-Resumable": "1.0.0" }).end();
      return;
    }
    if (req.method === "PATCH" && u.pathname.indexOf("/storage/v1/upload/resumable/") === 0) {
      const e = abertos[u.pathname.split("/").pop() || ""];
      if (!e || Number(req.headers["upload-offset"]) !== e.feito) {
        res.writeHead(409).end();
        return;
      }
      const pedacos: Buffer[] = [];
      req.on("data", (d: Buffer) => pedacos.push(d));
      req.on("end", async () => {
        const b = Buffer.concat(pedacos);
        if (b.length !== PARTE_DO_UPLOAD_BYTES && e.feito + b.length !== e.total) {
          res.writeHead(400).end();
          return;
        }
        await new Promise<void>((ok) => createWriteStream(e.arquivo, { flags: "a" }).end(b, () => ok()));
        e.feito += b.length;
        e.partes.push(b.length);
        if (e.feito === e.total) {
          const destino = path.join(raiz, e.bucket, e.objeto);
          await mkdir(path.dirname(destino), { recursive: true });
          await rename(e.arquivo, destino);
        }
        res.writeHead(204, { "Upload-Offset": String(e.feito), "Tus-Resumable": "1.0.0" }).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, envios, fechar: () => srv.close() })));
}
