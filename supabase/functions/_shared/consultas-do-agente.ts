/**
 * Consultas do agente (núcleo comum, 09/10/2026): "consultar antes de pedir,
 * criar tarefa ou delegar".
 *
 * Caso de origem (Casa dos Assados): pedido "confira o briefing e me diga o
 * que temos e o que falta" virou uma TAREFA "conferir briefing", porque o
 * agente só tinha ferramentas de escrita. Aqui ficam as leituras reais que
 * qualquer agente pode pedir numa rodada (até 4), sempre do cliente do
 * recorte (isolamento), sem segredo no resultado:
 * - as do Agente de Contexto (agente-contexto/modulos/ferramentas-do-cliente.ts):
 *   arquivos, briefing, métricas, agenda, cérebro, dossiê;
 * - ler_contexto_da_mesa: o contexto completo da marca que as Mesas usam
 *   (kit, contexto consolidado, referências, fotos, cérebro), o mesmo pacote
 *   de _shared/contexto-completo-da-marca.ts.
 * Cada leitura vira uma fonte (L1..Ln) que a resposta pode citar e que passa
 * pelas mesmas barreiras (código + Jev) das outras fontes.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  executarLeituras, FERRAMENTAS_DO_CLIENTE, MAX_LEITURAS_POR_RODADA, type NomeDaFerramenta, TETO_DO_RESULTADO,
} from "../agente-contexto/modulos/ferramentas-do-cliente.ts";
import { lerDossie } from "./contexto-cliente.ts";
import { resumoDoCerebro } from "./cerebro-nas-mesas.ts";
import { AREAS_DO_CEREBRO } from "./cerebro-do-cliente.ts";
import { contextoCompletoParaPrompt } from "./contexto-completo-da-marca.ts";
import { limparSegredos } from "./pacote-externo.ts";

export type NomeDaConsulta = NomeDaFerramenta | "ler_contexto_da_mesa";

export const CONSULTAS_DO_AGENTE: Record<NomeDaConsulta, { descricao: string; argumento: string }> = {
  ...FERRAMENTAS_DO_CLIENTE,
  ler_contexto_da_mesa: { descricao: "lê o contexto completo do cliente na Mesa: kit da marca, contexto consolidado, referências, fotos e o que os agentes já aprenderam", argumento: "vazio" },
};

export const NOMES_DAS_CONSULTAS = Object.keys(CONSULTAS_DO_AGENTE) as NomeDaConsulta[];

export type PedidoDeConsulta = { ferramenta: NomeDaConsulta; argumento: string };
export type FonteDeConsulta = { apelido: string; ferramenta: NomeDaConsulta; argumento: string; texto: string };

/** Esquema do campo `consultas` (strict: todos os campos obrigatórios). */
export const ESQUEMA_DAS_CONSULTAS = {
  type: "array",
  maxItems: MAX_LEITURAS_POR_RODADA,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["ferramenta", "argumento"],
    properties: { ferramenta: { type: "string", enum: NOMES_DAS_CONSULTAS }, argumento: { type: "string" } },
  },
};

export function normalizarConsultas(bruto: unknown): PedidoDeConsulta[] {
  const saida: PedidoDeConsulta[] = [];
  for (const x of Array.isArray(bruto) ? bruto : []) {
    const f = String((x as { ferramenta?: unknown })?.ferramenta || "") as NomeDaConsulta;
    if (!(f in CONSULTAS_DO_AGENTE)) continue;
    const a = String((x as { argumento?: unknown })?.argumento ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (saida.some((p) => p.ferramenta === f && p.argumento === a)) continue;
    saida.push({ ferramenta: f, argumento: a });
    if (saida.length >= MAX_LEITURAS_POR_RODADA) break;
  }
  return saida;
}

/** O bloco do prompt com as consultas disponíveis. */
export function blocoDasConsultas(): string {
  return `CONSULTAS (leituras reais do OS, do cliente do recorte; peça em "consultas" e você recebe o resultado numa segunda rodada):\n${NOMES_DAS_CONSULTAS.map((n) => `- ${n}: ${CONSULTAS_DO_AGENTE[n].descricao}. argumento: ${CONSULTAS_DO_AGENTE[n].argumento}`).join("\n")}`;
}

const hojeSP = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

/** Executa as consultas do cliente e devolve uma fonte por leitura (L1..). Nunca lança. */
export async function executarConsultas(db: SupabaseClient, clientId: string, pedidos: PedidoDeConsulta[], inicio = 1): Promise<FonteDeConsulta[]> {
  const fontes: FonteDeConsulta[] = [];
  let n = inicio;
  for (const p of pedidos) {
    let texto: string;
    try {
      if (p.ferramenta === "ler_contexto_da_mesa") {
        const c = await contextoCompletoParaPrompt(db as never, clientId, null, { area: "geral", teto: TETO_DO_RESULTADO, semTitulo: true });
        texto = limparSegredos(c.bloco || "Sem contexto registrado na Mesa.").slice(0, TETO_DO_RESULTADO);
      } else {
        const bloco = await executarLeituras(db as never, clientId, [{ ferramenta: p.ferramenta, argumento: p.argumento }], {
          hoje: hojeSP(),
          lerDossie: (c) => lerDossie(db, c, 12000),
          lerCerebro: async (c) => (await resumoDoCerebro(db as never, c, [...AREAS_DO_CEREBRO], { limite: 8000 })).texto,
        });
        // executarLeituras devolve "### nome\n<resultado>": a fonte fica só com o resultado.
        texto = bloco.replace(/^### [^\n]*\n/, "");
      }
    } catch {
      texto = "Leitura indisponível agora.";
    }
    fontes.push({ apelido: `L${n++}`, ferramenta: p.ferramenta, argumento: p.argumento, texto: texto.trim() || "Nada registrado." });
  }
  return fontes;
}
