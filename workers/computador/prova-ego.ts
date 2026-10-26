/**
 * Prova local do navegador do PC (26/10/2026): roda UM pedido só de leitura no Ego do dono, pelo mesmo
 * caminho do worker (umaTarefa → motor ego), com fila e armazém em memória. Não fala com o banco, não pega
 * tarefa da fila de produção e não mexe no worker que está rodando (outro nome de executor, nada de porta).
 *
 *   node prova-ego.ts                                  (gerenciador de anúncios: lê a conta ativa)
 *   node prova-ego.ts https://www.instagram.com/       (outra página da lista, só leitura)
 *
 * Os prints ficam em %TEMP%\aceleriq-ego-prova\<data>. Só navegar, esperar e ler: nada é clicado nem digitado.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CASO_DO_PC } from "../../supabase/functions/computador-do-agente/modulos/navegador-do-pc.ts";
import { motorDoEgo } from "./ego.ts";
import type { Fila, TarefaDoNavegador } from "./fila.ts";
import { umaTarefa } from "./trabalho.ts";

const url = process.argv[2] || "https://adsmanager.facebook.com/adsmanager/manage/campaigns";
const pasta = path.join(os.tmpdir(), "aceleriq-ego-prova", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(pasta, { recursive: true });

const ego = motorDoEgo(process.env, (m) => console.log(m));
if (!ego) {
  console.error("Ego Lite não encontrado (ou COMPUTADOR_EGO=desligado).");
  process.exit(1);
}

const conclusoes: Array<{ estado: string; resultado: Record<string, unknown>; motivo: string | null }> = [];
const fila: Fila = {
  pegar: async () => null,
  passo: async (_id, _token, prova) => {
    if (prova) console.log(`[prova] passo ${prova.passo}: ${prova.legenda}`);
    return "seguir";
  },
  concluir: async (_id, _token, estado, resultado, motivo) => {
    conclusoes.push({ estado, resultado, motivo });
    return true;
  },
  registrarUso: async () => undefined,
};

const tarefa: TarefaDoNavegador = {
  id: randomUUID(),
  client_id: null,
  caso: CASO_DO_PC,
  estado: "executando",
  url_inicial: url,
  dominios: [],
  objetivo: "prova local, só leitura",
  origem: "prova",
  teto_passos: 10,
  teto_custo_usd: 0,
  aprovado_por: "00000000-0000-4000-8000-000000000000",
  aprovado_em: new Date().toISOString(),
  criado_por: null,
  passos: [{ acao: "navegar", url }, { acao: "esperar", ms: 5000 }, { acao: "ler" }],
};

const saida = await umaTarefa(
  {
    fila,
    armazem: {
      async guardar(caminho, png) {
        const arquivo = path.join(pasta, path.basename(caminho));
        writeFileSync(arquivo, png);
        return arquivo;
      },
    },
    abrir: async () => {
      throw new Error("a prova do PC não usa o Chromium descartável");
    },
    comModelo: false,
    modelo: null,
    executor: `${os.hostname()}-navegador-prova-ego`,
    versao: "cus-1.3-prova",
    log: (m) => console.log(m),
    ego,
  },
  tarefa,
  randomUUID(),
);

const r = (conclusoes[0] && conclusoes[0].resultado) || {};
const passos = (r.passos_feitos as Array<{ acao: string; texto?: string }>) || [];
const lido = passos.find((p) => p.acao === "ler");
console.log(
  JSON.stringify(
    {
      estado: saida.estado,
      motivo: saida.motivo,
      motor: r.motor,
      sessao: r.sessao,
      url_final: r.url_final,
      titulo: r.titulo,
      parou: r.parou || null,
      prints: (r.imagens as unknown[] | undefined)?.length || 0,
      pasta_dos_prints: pasta,
      // Onde aparece a conta ativa (seletor de conta do gerenciador), sem despejar a página inteira.
      trechos_da_conta: String((lido && lido.texto) || "")
        .split(/\r?\n/)
        .filter((l) => /conta de an|ad account|seletor de conta|account selector|\(\d{10,}\)/i.test(l))
        .slice(0, 12)
        .map((l) => l.trim().slice(0, 200)),
      texto_inicio: String((lido && lido.texto) || "").slice(0, 600),
    },
    null,
    2,
  ),
);
