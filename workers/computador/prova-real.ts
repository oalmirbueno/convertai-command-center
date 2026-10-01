/**
 * Prova real do computer use (coleta_publica) contra a API da Anthropic, sem banco e sem painel.
 *
 * O caso com modelo vai DESLIGADO até esta prova passar. Ela roda uma tarefa de ponta a ponta num
 * site público, com teto de US$ 0,20 e 8 passos, e guarda em tmp/prova-real-<data>/:
 * - cada pedido à API (sem a chave) e cada resposta, em JSON;
 * - o print de cada passo (PNG);
 * - o resumo (estado, motivo, custo, passos).
 * Se a API recusar alguma forma do corpo (400), o erro fica no resumo: corrija o corpo do turno
 * (modelo.ts, corpoDoTurno) e rode de novo antes de ligar.
 *
 * Rodar (PowerShell, na pasta workers/computador, com a chave só na sessão, nunca em arquivo):
 *   $env:ANTHROPIC_API_KEY = "<cole aqui>"
 *   npm run prova-real                      (padrão: https://www.example.com)
 *   npm run prova-real -- https://site-publico.com.br "preços e serviços da página inicial"
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Fila, ProvaDoPasso, RespostaDoPasso, TarefaDoNavegador, UsoDoModelo } from "./fila.ts";
import { clienteAnthropic, type ClienteDoModelo, modeloDoComputador } from "./modelo.ts";
import { abrirNavegador } from "./navegador.ts";
import { umaTarefa } from "./trabalho.ts";

export const TETO_DA_PROVA_USD = 0.2;
export const PASSOS_DA_PROVA = 8;

/** Fila em memória com o mesmo teto de custo da RPC (passo devolve "teto" quando passa). */
export function filaDaProva(teto: number) {
  const passos: Array<ProvaDoPasso | null> = [];
  const usos: UsoDoModelo[] = [];
  const fim: { estado?: string; motivo?: string | null; resultado?: Record<string, unknown> } = {};
  let gasto = 0;
  const fila: Fila = {
    pegar: async () => null,
    async passo(_id, _token, prova, custo): Promise<RespostaDoPasso> {
      passos.push(prova);
      gasto += Number(custo) || 0;
      return gasto >= teto ? "teto" : "seguir";
    },
    async concluir(_id, _token, estado, resultado, motivo) {
      Object.assign(fim, { estado, resultado, motivo });
      return true;
    },
    async registrarUso(u) {
      usos.push(u);
    },
  };
  return { fila, passos, usos, fim, gasto: () => gasto };
}

/** Cliente que guarda pedido (sem chave) e resposta de cada turno. */
export function clienteQueGuarda(base: ClienteDoModelo, pasta: string): ClienteDoModelo {
  let n = 0;
  return {
    async enviar(corpo) {
      n += 1;
      const nome = String(n).padStart(2, "0");
      writeFileSync(path.join(pasta, `turno-${nome}-pedido.json`), JSON.stringify(corpo, (k, v) => (k === "data" && typeof v === "string" && v.length > 200 ? `<png base64 ${v.length} chars>` : v), 1));
      try {
        const r = await base.enviar(corpo);
        writeFileSync(path.join(pasta, `turno-${nome}-resposta.json`), JSON.stringify(r, null, 1));
        return r;
      } catch (err) {
        writeFileSync(path.join(pasta, `turno-${nome}-erro.txt`), err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
  };
}

async function principal() {
  const chave = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (chave.length < 20) throw new Error("Falta ANTHROPIC_API_KEY na sessão (nunca em arquivo).");
  const url = process.argv[2] || "https://www.example.com/";
  const objetivo = process.argv[3] || "o título da página e o texto principal";
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const pasta = path.join(aqui, "tmp", `prova-real-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(pasta, { recursive: true });
  const dominio = new URL(url).hostname.replace(/^www\./, "");
  const qualModelo = modeloDoComputador(process.env.COMPUTADOR_MODELO);
  const f = filaDaProva(TETO_DA_PROVA_USD);
  const tarefa: TarefaDoNavegador = {
    id: "00000000-0000-4000-8000-000000000001",
    client_id: "00000000-0000-4000-8000-000000000002",
    caso: "coleta_publica",
    estado: "aprovada",
    url_inicial: url,
    dominios: [dominio],
    objetivo,
    origem: "painel",
    teto_passos: PASSOS_DA_PROVA,
    teto_custo_usd: TETO_DA_PROVA_USD,
    aprovado_por: "00000000-0000-4000-8000-000000000003",
    aprovado_em: new Date().toISOString(),
    criado_por: null,
  };
  const s = await umaTarefa(
    {
      fila: f.fila,
      armazem: {
        async guardar(caminho, png) {
          const arq = path.join(pasta, path.basename(caminho));
          writeFileSync(arq, png);
          return arq;
        },
      },
      abrir: (op) => abrirNavegador({ ...op, executavel: String(process.env.COMPUTADOR_CHROME || "").trim() || null }),
      comModelo: true,
      modelo: clienteQueGuarda(clienteAnthropic(chave), pasta),
      qualModelo,
      executor: "prova-real",
      versao: "prova-real",
      log: (m) => console.log(m),
    },
    tarefa,
    "prova-real",
  );
  const resumo = { url, objetivo, modelo: qualModelo.api, estado: s.estado, motivo: s.motivo, custo_usd: Math.round(f.gasto() * 10000) / 10000, passos: f.passos.length, usos: f.usos, resultado: s.resultado };
  writeFileSync(path.join(pasta, "resumo.json"), JSON.stringify(resumo, null, 1));
  console.log(JSON.stringify({ pasta, estado: s.estado, motivo: s.motivo, custo_usd: resumo.custo_usd, passos: resumo.passos }, null, 1));
  if (s.estado !== "feita") process.exit(2);
}

if (process.argv[1] && /prova-real\.ts$/.test(process.argv[1])) {
  principal().catch((err) => {
    console.error(`[prova-real] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
