/**
 * Controle local do Aceleriq Motores (frente SUP, 01/10/2026).
 *
 * Um cano nomeado por usuário (\\.\pipe\aceleriq-motores-<usuário>; no macOS e
 * no Linux, um socket na pasta dos motores). Serve para duas coisas:
 * - uma instância só: se o cano já existe, outro supervisor está ligado;
 * - comandos sem janela: `node lancador.mjs --comando estado|reiniciar|pausar|retomar|sair`
 *   (o instalador usa para trocar de versão e o migrar para conferir). O controle
 *   só lê e comanda: nunca abre navegador nem pasta (isso é só clique no menu).
 * Só o próprio usuário abre o cano (o Windows dá o cano ao dono do processo).
 */

import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export type ComandoDeControle = "estado" | "reiniciar" | "pausar" | "retomar" | "sair" | "sair-agora" | "atualizar";
export const COMANDOS: ComandoDeControle[] = ["estado", "reiniciar", "pausar", "retomar", "sair", "sair-agora", "atualizar"];

/** Um endereço por usuário e por pasta dos motores (o teste numa pasta temporária não esbarra no de verdade). */
export function enderecoDoControle(raiz: string, usuario = os.userInfo().username): string {
  const pasta = createHash("sha256").update(path.resolve(raiz).toLowerCase()).digest("hex").slice(0, 8);
  const nome = `aceleriq-motores-${usuario.replace(/[^A-Za-z0-9_.-]/g, "_").toLowerCase()}-${pasta}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${nome}` : path.join(raiz, `${nome}.sock`);
}

/** Abre o controle. Rejeita com `ja_ligado` quando outro supervisor já atende no mesmo endereço. */
export function abrirControle(endereco: string, atender: (c: ComandoDeControle) => Promise<unknown>): Promise<net.Server> {
  return new Promise((resolver, rejeitar) => {
    const servidor = net.createServer((s) => {
      let buf = "";
      s.setEncoding("utf8");
      s.on("data", (d) => {
        buf += d;
        const i = buf.indexOf("\n");
        if (i < 0) return;
        const linha = buf.slice(0, i);
        buf = "";
        let cmd: ComandoDeControle | null = null;
        try {
          const c = (JSON.parse(linha) as { comando?: string }).comando as ComandoDeControle;
          if (COMANDOS.indexOf(c) >= 0) cmd = c;
        } catch {
          /* inválido */
        }
        if (!cmd) {
          s.end(JSON.stringify({ ok: false, erro: "comando desconhecido" }) + "\n");
          return;
        }
        atender(cmd).then(
          (r) => s.end(JSON.stringify({ ok: true, resposta: r ?? null }) + "\n"),
          (e) => s.end(JSON.stringify({ ok: false, erro: e instanceof Error ? e.message : String(e) }) + "\n"),
        );
      });
      s.on("error", () => {});
    });
    servidor.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") rejeitar(Object.assign(new Error("já há um Aceleriq Motores ligado nesta conta"), { code: "ja_ligado" }));
      else rejeitar(e);
    });
    servidor.listen(endereco, () => resolver(servidor));
  });
}

/** Manda um comando ao supervisor ligado. Sem supervisor: `{ ok: false, erro: "desligado" }`. */
export function mandarComando(endereco: string, comando: ComandoDeControle, prazoMs = 10_000): Promise<{ ok: boolean; resposta?: unknown; erro?: string }> {
  return new Promise((resolver) => {
    const s = net.connect(endereco);
    let buf = "";
    const t = setTimeout(() => {
      s.destroy();
      resolver({ ok: false, erro: "sem resposta" });
    }, prazoMs);
    s.setEncoding("utf8");
    s.on("connect", () => s.write(JSON.stringify({ comando }) + "\n"));
    s.on("data", (d) => (buf += d));
    s.on("end", () => {
      clearTimeout(t);
      try {
        resolver(JSON.parse(buf.trim()));
      } catch {
        resolver({ ok: false, erro: "resposta inválida" });
      }
    });
    s.on("error", () => {
      clearTimeout(t);
      resolver({ ok: false, erro: "desligado" });
    });
  });
}
