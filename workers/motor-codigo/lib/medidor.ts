/**
 * Medidor do custo real: um repasse local (127.0.0.1) entre o opencode e o
 * OpenRouter. Não muda nada no pedido nem na resposta; só lê o `usage.cost`
 * que o OpenRouter manda em toda resposta (no stream, no último evento) e soma
 * por trabalho. Assim o teto vale pelo custo real, não só pela tabela, e a
 * carteira recebe o valor que o OpenRouter cobrou.
 *
 * A chave continua só no ambiente do worker: o opencode manda o cabeçalho
 * Authorization e o repasse só o encaminha ao openrouter.ai.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const DESTINO = "https://openrouter.ai";

/** Custo que aparece num pedaço de resposta (JSON inteiro ou linhas "data: {...}" do stream). */
export function custosDoTexto(texto: string): number[] {
  const custos: number[] = [];
  const tentar = (json: string) => {
    if (json.indexOf('"cost"') < 0) return;
    try {
      const o = JSON.parse(json) as { usage?: { cost?: unknown } };
      const c = o && o.usage ? Number(o.usage.cost) : NaN;
      if (Number.isFinite(c) && c >= 0) custos.push(c);
    } catch {
      /* pedaço que não é JSON */
    }
  };
  const t = texto.trim();
  if (t.charAt(0) === "{") tentar(t);
  else for (const linha of texto.split("\n")) if (linha.indexOf("data:") === 0) tentar(linha.slice(5).trim());
  return custos;
}

export type Medidor = { url: string; total: () => number; chamadas: () => number; zerar: () => void; fechar: () => Promise<void> };

export async function abrirMedidor(): Promise<Medidor> {
  let total = 0;
  let chamadas = 0;
  const servidor: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const partes: Buffer[] = [];
      for await (const c of req) partes.push(c as Buffer);
      const corpo = Buffer.concat(partes);
      const cabecalhos: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!v || ["host", "connection", "content-length", "accept-encoding"].indexOf(k) >= 0) continue;
        cabecalhos[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      const r = await fetch(`${DESTINO}${req.url || "/"}`, { method: req.method, headers: cabecalhos, body: req.method === "GET" || req.method === "HEAD" ? undefined : corpo });
      chamadas++;
      const saida: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        if (["content-encoding", "content-length", "transfer-encoding", "connection"].indexOf(k) < 0) saida[k] = v;
      });
      res.writeHead(r.status, saida);
      if (!r.body) return res.end();
      const leitor = r.body.getReader();
      const decodificar = new TextDecoder();
      let resto = "";
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        res.write(Buffer.from(value));
        resto += decodificar.decode(value, { stream: true });
        const corte = resto.lastIndexOf("\n");
        if (corte >= 0) {
          custosDoTexto(resto.slice(0, corte)).forEach((c) => (total += c));
          resto = resto.slice(corte + 1);
        }
      }
      custosDoTexto(resto).forEach((c) => (total += c));
      res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `medidor: ${e instanceof Error ? e.message : "falha"}` } }));
    }
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", () => ok()));
  const endereco = servidor.address();
  const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
  return {
    url: `http://127.0.0.1:${porta}/api/v1`,
    total: () => Math.round(total * 1e8) / 1e8,
    chamadas: () => chamadas,
    zerar: () => {
      total = 0;
      chamadas = 0;
    },
    fechar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  };
}
