/**
 * Prova real do computer use (coleta_publica) contra a API do provedor, sem banco e sem painel.
 *
 * Roda uma tarefa de ponta a ponta num site público, com teto de US$ 0,20 e 8 passos, e guarda em
 * tmp/prova-real-<provedor>-<data>/:
 * - cada pedido à API (sem a chave e sem o PNG em base64) e cada resposta, em JSON;
 * - o print de cada passo (PNG);
 * - o resumo (estado, motivo, modelo, custo, passos).
 * Se a API recusar alguma forma do corpo (400), o erro fica no resumo: corrija o corpo do turno
 * (modelo.ts: corpoDoTurno da Anthropic ou corpoDaOpenAI) e rode de novo antes de ligar.
 *
 * Rodar (PowerShell, na pasta workers/computador, com a chave só na sessão, nunca em arquivo):
 *   npm run prova-real                                   (Anthropic, Claude Sonnet 5.5, https://www.example.com)
 *   npm run prova-real -- --provedor openai              (OpenAI, GPT-6.1 Sol; usa OPENAI_API_KEY)
 *   npm run prova-real -- --modelo openai:gpt-6-astra    (um modelo conhecido)
 *   npm run prova-real -- https://site-publico.com.br "preços e serviços da página inicial" --provedor openai
 * A chave vem da sessão; sem ela, do usuário do Windows (ANTHROPIC_API_KEY ou OPENAI_API_KEY).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Fila, ProvaDoPasso, RespostaDoPasso, TarefaDoNavegador, UsoDoModelo } from "./fila.ts";
import { clienteAnthropic, clienteOpenAI, type ClienteDoModelo, MODELOS_DO_COMPUTADOR, modeloConhecido, modeloDoComputador, type ModeloDoComputador } from "./modelo.ts";
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

/** Tira o PNG (base64 da Anthropic ou data URL da OpenAI) do que vai para o disco. */
const semImagem = (k: string, v: unknown) =>
  typeof v === "string" && v.length > 200 && (k === "data" || /^data:image\//.test(v)) ? `<png base64 ${v.length} chars>` : v;

/** Cliente que guarda pedido (sem chave e sem PNG) e resposta de cada turno. */
export function clienteQueGuarda<R>(base: ClienteDoModelo<R>, pasta: string): ClienteDoModelo<R> {
  let n = 0;
  return {
    async enviar(corpo) {
      n += 1;
      const nome = String(n).padStart(2, "0");
      writeFileSync(path.join(pasta, `turno-${nome}-pedido.json`), JSON.stringify(corpo, semImagem, 1));
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

/** Argumentos: URL e objetivo (posicionais), --provedor anthropic|openai e --modelo <id conhecido>. */
export function argumentosDaProva(args: string[], env: Record<string, string | undefined>): { url: string; objetivo: string; modelo: ModeloDoComputador } {
  const soltos: string[] = [];
  let provedor = "";
  let nomeDoModelo = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provedor") provedor = String(args[++i] || "").toLowerCase();
    else if (args[i] === "--modelo") nomeDoModelo = String(args[++i] || "");
    else soltos.push(args[i]);
  }
  let modelo = nomeDoModelo ? modeloConhecido(nomeDoModelo) : null;
  if (nomeDoModelo && !modelo) throw new Error(`Modelo desconhecido para a prova: ${nomeDoModelo}. Use um de: ${Object.values(MODELOS_DO_COMPUTADOR).map((m) => m.id).join(", ")}.`);
  if (!modelo) modelo = provedor === "openai" ? MODELOS_DO_COMPUTADOR["gpt-6.1-sol"] : modeloDoComputador(env.COMPUTADOR_MODELO);
  if (provedor && modelo.provedor !== provedor) throw new Error(`O modelo ${modelo.id} não é do provedor ${provedor}.`);
  return { url: soltos[0] || "https://www.example.com/", objetivo: soltos[1] || "o título da página e o texto principal", modelo };
}

/** Chave da sessão; sem ela, a do usuário do Windows (o valor nunca é mostrado nem gravado). */
function chaveDe(nome: string): string {
  const daSessao = String(process.env[nome] || "").trim();
  if (daSessao.length >= 20) return daSessao;
  if (process.platform !== "win32") return "";
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", `[Environment]::GetEnvironmentVariable('${nome}','User')`], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function principal() {
  const { url, objetivo, modelo } = argumentosDaProva(process.argv.slice(2), process.env);
  const nomeDaChave = modelo.provedor === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const chave = chaveDe(nomeDaChave);
  if (chave.length < 20) throw new Error(`Falta ${nomeDaChave} na sessão ou no usuário do Windows (nunca em arquivo).`);
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const pasta = path.join(aqui, "tmp", `prova-real-${modelo.provedor}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(pasta, { recursive: true });
  const dominio = new URL(url).hostname.replace(/^www\./, "");
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
    modelo_id: modelo.id,
    urls: [],
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
      modelo: modelo.provedor === "anthropic" ? clienteQueGuarda(clienteAnthropic(chave, String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim()), pasta) : null,
      openai: modelo.provedor === "openai" ? clienteQueGuarda(clienteOpenAI(chave), pasta) : null,
      qualModelo: modelo,
      executor: "prova-real",
      versao: "prova-real",
      log: (m) => console.log(m),
    },
    tarefa,
    "prova-real",
  );
  const resumo = { url, objetivo, provedor: modelo.provedor, modelo: modelo.api, estado: s.estado, motivo: s.motivo, custo_usd: Math.round(f.gasto() * 10000) / 10000, passos: f.passos.length, usos: f.usos, resultado: f.fim.resultado || s.resultado };
  writeFileSync(path.join(pasta, "resumo.json"), JSON.stringify(resumo, null, 1));
  console.log(JSON.stringify({ pasta, provedor: modelo.provedor, modelo: modelo.api, estado: s.estado, motivo: s.motivo, custo_usd: resumo.custo_usd, passos: resumo.passos }, null, 1));
  if (s.estado !== "feita") process.exit(2);
}

if (process.argv[1] && /prova-real\.ts$/.test(process.argv[1])) {
  principal().catch((err) => {
    console.error(`[prova-real] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
