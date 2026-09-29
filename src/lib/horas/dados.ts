import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lerCustos, type LinhaDeCusto } from "@/lib/mesa/custos";
import { somarMeses, type Detalhe, type MesDoCliente, type PecasPorHora } from "@/lib/horas/calculos";

/**
 * Leitura da central de horas e custos (frente CR).
 * - horas_resumo (migration 20260928090000): tempo, entregas, plano e atrasos.
 * - mesa_custos_producao (já existente, src/lib/mesa/custos.ts): custo de IA por cliente e mês.
 * As duas chamadas por tela, uma vez (sem atualização automática em laço).
 */

export const RPC_DE_HORAS = "horas_resumo";
/** Meses de histórico lidos de uma vez (o escolhido e os anteriores). */
export const MESES_DE_HISTORICO = 12;

export interface EntregaBruta {
  client_id: string;
  nome: string;
  mes: string;
  pecas_aprovadas: number;
  videos_aprovados: number;
  roteiros: number;
  tarefas: number;
  marcos: number;
  publicados: number;
  pautas: number;
  pautas_feitas: number;
  atrasadas: number;
}

export interface ResumoDeHoras {
  mes: string;
  inicioHistorico: string;
  fim: string;
  escopo: "todos" | "meu" | "pessoa";
  meses: Array<{ client_id: string; nome: string; mes: string; segundos: number; dias: number; trechos: number }>;
  detalhe: Detalhe[];
  pecasPorHora: PecasPorHora[];
  entregas: EntregaBruta[];
  pacotes: Record<string, number>;
  pessoas: Array<{ id: string; nome: string; segundos: number }>;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : 0;
};
const txt = (v: unknown, padrao = ""): string => (typeof v === "string" && v ? v : padrao);
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []) as Record<string, unknown>[];

/** Aceita o que o banco devolver; o que não tem forma vira lista vazia. */
export function normalizarResumo(data: unknown): ResumoDeHoras {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const pacotes: Record<string, number> = {};
  for (const p of lista(d.pacotes)) if (typeof p.client_id === "string" && num(p.posts_por_mes) > 0) pacotes[p.client_id] = num(p.posts_por_mes);
  const escopo = d.escopo === "meu" || d.escopo === "pessoa" ? d.escopo : "todos";
  return {
    mes: txt(d.mes).slice(0, 10),
    inicioHistorico: txt(d.inicio_historico).slice(0, 10),
    fim: txt(d.fim).slice(0, 10),
    escopo,
    meses: lista(d.meses)
      .filter((m) => typeof m.client_id === "string")
      .map((m) => ({
        client_id: m.client_id as string,
        nome: txt(m.nome, "Cliente"),
        mes: txt(m.mes).slice(0, 10),
        segundos: num(m.segundos),
        dias: num(m.dias),
        trechos: num(m.trechos),
      })),
    detalhe: lista(d.detalhe)
      .filter((x) => typeof x.client_id === "string")
      .map((x) => ({ client_id: x.client_id as string, dia: txt(x.dia).slice(0, 10), hora: num(x.hora), segundos: num(x.segundos) })),
    pecasPorHora: lista(d.pecas_hora)
      .filter((x) => typeof x.client_id === "string")
      .map((x) => ({ client_id: x.client_id as string, hora: num(x.hora), pecas: num(x.pecas) })),
    entregas: lista(d.entregas)
      .filter((x) => typeof x.client_id === "string")
      .map((x) => ({
        client_id: x.client_id as string,
        nome: txt(x.nome, "Cliente"),
        mes: txt(x.mes).slice(0, 10),
        pecas_aprovadas: num(x.pecas_aprovadas),
        videos_aprovados: num(x.videos_aprovados),
        roteiros: num(x.roteiros),
        tarefas: num(x.tarefas),
        marcos: num(x.marcos),
        publicados: num(x.publicados),
        pautas: num(x.pautas),
        pautas_feitas: num(x.pautas_feitas),
        atrasadas: num(x.atrasadas),
      })),
    pacotes,
    pessoas: lista(d.pessoas)
      .filter((x) => typeof x.id === "string")
      .map((x) => ({ id: x.id as string, nome: txt(x.nome, "Pessoa"), segundos: num(x.segundos) })),
  };
}

export const TIPOS_DE_ENTREGA: Array<{ chave: keyof EntregaBruta; rotulo: string }> = [
  { chave: "pecas_aprovadas", rotulo: "Peças aprovadas" },
  { chave: "videos_aprovados", rotulo: "Vídeos aprovados" },
  { chave: "roteiros", rotulo: "Roteiros aprovados" },
  { chave: "tarefas", rotulo: "Tarefas concluídas" },
  { chave: "marcos", rotulo: "Marcos cumpridos" },
];

/** Entregas de uma linha: peças, vídeos, roteiros, tarefas e marcos (publicados ficam à parte). */
export function somaDasEntregas(e: EntregaBruta): number {
  return e.pecas_aprovadas + e.videos_aprovados + e.roteiros + e.tarefas + e.marcos;
}

/**
 * Junta tempo, entregas e custo por cliente e mês. Cliente que só tem custo
 * ou só tem entrega também entra (o custo sem hora aparece; nada some).
 */
export function juntarMeses(resumo: ResumoDeHoras, custos: LinhaDeCusto[]): MesDoCliente[] {
  const linhas: Record<string, MesDoCliente> = {};
  const linha = (client_id: string, nome: string, mes: string) => {
    const k = `${client_id}|${mes}`;
    if (!linhas[k]) {
      linhas[k] = { client_id, nome, mes, segundos: 0, dias: 0, custoUsd: 0, entregas: 0, porTipo: {}, previstas: null, feitasDoPlano: 0, atrasadas: 0 };
    }
    if (nome && nome !== "Cliente") linhas[k].nome = nome;
    return linhas[k];
  };
  for (const m of resumo.meses) {
    const l = linha(m.client_id, m.nome, m.mes);
    l.segundos += m.segundos;
    l.dias += m.dias;
  }
  for (const e of resumo.entregas) {
    const l = linha(e.client_id, e.nome, e.mes);
    l.entregas += somaDasEntregas(e);
    for (const t of TIPOS_DE_ENTREGA) l.porTipo[t.chave] = (l.porTipo[t.chave] || 0) + (e[t.chave] as number);
    l.porTipo.publicados = (l.porTipo.publicados || 0) + e.publicados;
    const pacote = resumo.pacotes[e.client_id] || 0;
    const previsto = Math.max(e.pautas, pacote);
    l.previstas = previsto > 0 ? previsto : null;
    l.feitasDoPlano = e.pautas_feitas;
    l.atrasadas = e.atrasadas;
  }
  // Pacote contratado vale mesmo em mês sem pauta nenhuma (plano vazio = 0 feito de N).
  for (const k of Object.keys(linhas)) {
    const l = linhas[k];
    if (l.previstas === null && resumo.pacotes[l.client_id]) l.previstas = resumo.pacotes[l.client_id];
  }
  for (const c of custos) {
    const l = linha(c.client_id, c.nome, c.mes);
    l.custoUsd += c.gasto_total_usd;
  }
  return Object.keys(linhas).map((k) => linhas[k]);
}

export async function lerResumoDeHoras(mes: string, meses: number, pessoa: string | null): Promise<ResumoDeHoras> {
  const { data, error } = await (supabase as any).rpc(RPC_DE_HORAS, { _mes: mes, _meses: meses, _pessoa: pessoa });
  if (error) throw error;
  return normalizarResumo(data);
}

export function useResumoDeHoras(mes: string, pessoa: string | null) {
  return useQuery({
    queryKey: ["horas", "resumo", mes, MESES_DE_HISTORICO, pessoa || "todos"],
    queryFn: () => lerResumoDeHoras(mes, MESES_DE_HISTORICO, pessoa),
    staleTime: 60_000,
    retry: false,
  });
}

/** Custo de IA do histórico inteiro (mesma fonte do painel de Custos da Mesa). */
export function useCustosDoHistorico(mes: string, nomes: Record<string, string>) {
  const inicio = somarMeses(mes, -(MESES_DE_HISTORICO - 1));
  const fim = somarMeses(mes, 1);
  return useQuery({
    queryKey: ["mesa", "custos", inicio, fim],
    queryFn: () => lerCustos(inicio, fim, nomes),
    staleTime: 60_000,
    retry: false,
  });
}
