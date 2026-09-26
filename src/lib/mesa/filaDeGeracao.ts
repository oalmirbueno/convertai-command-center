import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, ErroDaMesa, mensagemDoCodigo } from "@/lib/mesa/api";
import type { AndamentoDaLamina, EtapaDaLamina } from "@/components/mesa/PranchetaDoEstudio";

/**
 * Fila de geração do Estúdio no servidor (frente G, 26/09).
 *
 * Bug do dono: "estou gerando para um cliente, abro outro cliente e, quando
 * volto, ele parou". O laço de geração vivia na tela (AbaEstudio): abrir outro
 * card, entrar em tela cheia ou trocar de cliente remontava a tela e o
 * andamento sumia; a recarga do painel (versão nova) matava o laço.
 *
 * Agora "Gerar" vira pedido no servidor (estudio-arte, acao enfileirar; tabela
 * public.estudio_fila). A função processa em segundo plano, um passo por vez,
 * e a tela só LÊ o andamento daqui (poll leve). Qualquer tela pode ser
 * fechada: a fila segue. A vigia global (useGeracoesEmAndamento, montada no
 * cabeçalho) mostra "Gerando em N clientes" e, se a corrente do servidor
 * quebrar, pede o próximo passo com o login de quem pediu.
 *
 * Sem a tabela ou sem a função nova no ar, `enfileirar` devolve null e a tela
 * gera pelo caminho antigo (degradado, igual a antes).
 */

export type StatusNaFila = "fila" | "rodando" | "feito" | "erro" | "cancelado";
export type EtapaNaFila = "fundo" | "gerar" | "conferir" | "corrigir";

export interface ItemNaFila {
  id: string;
  client_id: string;
  trabalho_id: string;
  ordem: number;
  lote_id: string;
  status: StatusNaFila;
  etapa: EtapaNaFila;
  rodadas: number;
  tentativas: number;
  custo_usd: number;
  pedido_por: string | null;
  proxima_em: string | null;
  trava_ate: string | null;
  criado_em: string;
  iniciado_em: string | null;
  concluido_em: string | null;
  erro_codigo: string | null;
  erro_mensagem: string | null;
  aviso: string | null;
}

export const COLUNAS_NA_TELA =
  "id, client_id, trabalho_id, ordem, lote_id, status, etapa, rodadas, tentativas, custo_usd, pedido_por, proxima_em, trava_ate, criado_em, iniciado_em, concluido_em, erro_codigo, erro_mensagem, aviso";

/** Códigos que dizem "a fila ainda não está no ar": a tela gera do jeito antigo. */
export const CODIGOS_SEM_FILA = ["fila_indisponivel", "acao_desconhecida"];

export const INTERVALO_DO_TRABALHO_MS = 4_000;
export const INTERVALO_GLOBAL_ATIVO_MS = 15_000;
export const INTERVALO_GLOBAL_PARADO_MS = 60_000;
/** Vigia: só empurra quando o passo está parado há mais que isto. */
export const PARADO_HA_MS = 45_000;
/** Vigia: no máximo um empurrão a cada. */
export const INTERVALO_DO_EMPURRAO_MS = 30_000;

export const chaveDaFila = ["mesa", "fila-de-geracao"] as const;
export const chaveDaFilaDoTrabalho = (trabalhoId: string) => [...chaveDaFila, "trabalho", trabalhoId] as const;
export const chaveDaFilaGlobal = [...chaveDaFila, "global"] as const;

const numero = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : 0;
};
const textoOuNulo = (v: unknown) => (typeof v === "string" && v ? v : null);

export function normalizarItens(data: unknown): ItemNaFila[] {
  const lista = Array.isArray(data) ? data : [];
  const saida: ItemNaFila[] = [];
  for (const b of lista) {
    if (!b || typeof b !== "object") continue;
    const l = b as Record<string, unknown>;
    if (typeof l.id !== "string" || typeof l.trabalho_id !== "string") continue;
    saida.push({
      id: l.id,
      client_id: String(l.client_id || ""),
      trabalho_id: l.trabalho_id,
      ordem: numero(l.ordem),
      lote_id: String(l.lote_id || ""),
      status: String(l.status || "fila") as StatusNaFila,
      etapa: String(l.etapa || "gerar") as EtapaNaFila,
      rodadas: numero(l.rodadas),
      tentativas: numero(l.tentativas),
      custo_usd: numero(l.custo_usd),
      pedido_por: textoOuNulo(l.pedido_por),
      proxima_em: textoOuNulo(l.proxima_em),
      trava_ate: textoOuNulo(l.trava_ate),
      criado_em: String(l.criado_em || ""),
      iniciado_em: textoOuNulo(l.iniciado_em),
      concluido_em: textoOuNulo(l.concluido_em),
      erro_codigo: textoOuNulo(l.erro_codigo),
      erro_mensagem: textoOuNulo(l.erro_mensagem),
      aviso: textoOuNulo(l.aviso),
    });
  }
  return saida;
}

export const estaAtivo = (i: ItemNaFila) => i.status === "fila" || i.status === "rodando";

/** Etapa que a prancheta mostra para um item ativo da fila. */
export function etapaNaPrancheta(i: ItemNaFila): { etapa: EtapaDaLamina; detalhe?: string } {
  if (i.etapa === "conferir") return { etapa: i.rodadas > 0 ? "reconferindo" : "conferindo" };
  if (i.etapa === "corrigir") return { etapa: "corrigindo" };
  if (i.status === "fila" && !i.iniciado_em) return { etapa: "fila" };
  if (i.etapa === "fundo") return { etapa: "gerando", detalhe: "Fundo contínuo" };
  return { etapa: "gerando" };
}

/** Andamento por lâmina, lido do servidor (o mesmo formato do indicador da prancheta). */
export function andamentoDaFila(itens: ItemNaFila[]): Record<number, AndamentoDaLamina> {
  const saida: Record<number, AndamentoDaLamina> = {};
  for (const i of itens) {
    if (!estaAtivo(i)) continue;
    const { etapa, detalhe } = etapaNaPrancheta(i);
    const desde = Date.parse(i.iniciado_em || i.criado_em);
    saida[i.ordem] = { etapa, desde: isFinite(desde) ? desde : Date.now(), ...(detalhe ? { detalhe } : {}) };
  }
  return saida;
}

export type MudancaNaFila = { tipo: "avancou" | "terminou" | "falhou"; item: ItemNaFila };

/**
 * O que mudou entre duas leituras: lâmina gerada (passou a conferir),
 * terminada ou com erro. `antes` null é a primeira leitura: aí só conta erro
 * recente (quem volta ao cliente vê o que deu errado enquanto estava fora).
 */
export function mudancasDaFila(antes: ItemNaFila[] | null, depois: ItemNaFila[], agora = Date.now(), recenteMs = 10 * 60_000): MudancaNaFila[] {
  const saida: MudancaNaFila[] = [];
  const mapa: Record<string, ItemNaFila> = {};
  for (const i of antes || []) mapa[i.id] = i;
  for (const d of depois) {
    const a = mapa[d.id];
    if (!antes) {
      const fim = d.concluido_em ? Date.parse(d.concluido_em) : NaN;
      if (d.status === "erro" && isFinite(fim) && agora - fim <= recenteMs) saida.push({ tipo: "falhou", item: d });
      continue;
    }
    if (!a) {
      if (!estaAtivo(d)) saida.push({ tipo: d.status === "erro" ? "falhou" : "terminou", item: d });
      continue;
    }
    if (a.status === d.status && a.etapa === d.etapa && a.rodadas === d.rodadas) continue;
    if (estaAtivo(a) && d.status === "erro") saida.push({ tipo: "falhou", item: d });
    else if (estaAtivo(a) && !estaAtivo(d)) saida.push({ tipo: "terminou", item: d });
    else if (estaAtivo(d)) saida.push({ tipo: "avancou", item: d });
  }
  return saida;
}

/** O passo está parado (corrente do servidor quebrou) e a vigia pode empurrar? */
export function precisaDeEmpurrao(itens: ItemNaFila[], userId: string | null | undefined, agora = Date.now()): boolean {
  if (!userId) return false;
  return itens.some((i) => {
    if (i.pedido_por !== userId) return false;
    if (i.status === "rodando") {
      const trava = i.trava_ate ? Date.parse(i.trava_ate) : NaN;
      return isFinite(trava) && trava < agora;
    }
    if (i.status !== "fila") return false;
    const proxima = Date.parse(i.proxima_em || i.criado_em);
    return isFinite(proxima) && agora - proxima > PARADO_HA_MS;
  });
}

export interface GeracaoDoCliente {
  client_id: string;
  nome: string;
  laminas: number;
  gerando: number;
  link: string;
}

/** "Gerando em N clientes": uma linha por cliente, com o link para voltar ao trabalho. */
export function geracoesPorCliente(
  itens: ItemNaFila[],
  nomes: Record<string, string>,
  trabalhos: Record<string, { task_id: string | null; tipo: string | null }>,
): GeracaoDoCliente[] {
  const porCliente: Record<string, GeracaoDoCliente> = {};
  const ordem: string[] = [];
  for (const i of itens) {
    if (!estaAtivo(i)) continue;
    let g = porCliente[i.client_id];
    if (!g) {
      const t = trabalhos[i.trabalho_id];
      const link = t && t.tipo === "ads"
        ? `/mesa-ads?client=${i.client_id}&etapa=estudio`
        : `/mesa?client=${i.client_id}&aba=estudio${t && t.task_id ? `&task=${t.task_id}` : ""}`;
      g = { client_id: i.client_id, nome: nomes[i.client_id] || "Cliente", laminas: 0, gerando: 0, link };
      porCliente[i.client_id] = g;
      ordem.push(i.client_id);
    }
    g.laminas += 1;
    if (i.status === "rodando") g.gerando += 1;
  }
  return ordem.map((c) => porCliente[c]);
}

// ------------------------------------------------------------------ banco

const semTabela = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === "42P01" || error.code === "PGRST205" || /estudio_fila|schema cache|does not exist/i.test(String(error.message || "")));

/** Leitura da fila de um trabalho: ativos e o que terminou na última meia hora. Null quando a tabela não existe. */
export async function lerFilaDoTrabalho(trabalhoId: string): Promise<ItemNaFila[] | null> {
  const desde = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data, error } = await (supabase as any)
    .from("estudio_fila")
    .select(COLUNAS_NA_TELA)
    .eq("trabalho_id", trabalhoId)
    .or(`status.in.(fila,rodando),concluido_em.gte.${desde}`)
    .order("criado_em", { ascending: true })
    .limit(80);
  if (error) {
    if (semTabela(error)) return null;
    throw error;
  }
  return normalizarItens(data);
}

export interface FilaGlobal {
  itens: ItemNaFila[];
  clientes: GeracaoDoCliente[];
}

/** Tudo que está na fila agora (clientes que a equipe vê pela RLS), com nome e link. Null sem a tabela. */
export async function lerFilaGlobal(): Promise<FilaGlobal | null> {
  const { data, error } = await (supabase as any)
    .from("estudio_fila")
    .select(COLUNAS_NA_TELA)
    .in("status", ["fila", "rodando"])
    .order("criado_em", { ascending: true })
    .limit(200);
  if (error) {
    if (semTabela(error)) return null;
    throw error;
  }
  const itens = normalizarItens(data);
  if (!itens.length) return { itens, clientes: [] };
  const clientes = Array.from(new Set(itens.map((i) => i.client_id)));
  const trabalhos = Array.from(new Set(itens.map((i) => i.trabalho_id)));
  const [perfis, trab] = await Promise.all([
    (supabase as any).from("profiles").select("id, company_name, full_name").in("id", clientes),
    (supabase as any).from("estudio_trabalhos").select("id, task_id, tipo").in("id", trabalhos),
  ]);
  const nomes: Record<string, string> = {};
  for (const p of (perfis && perfis.data) || []) nomes[p.id] = String(p.company_name || p.full_name || "Cliente");
  const mapa: Record<string, { task_id: string | null; tipo: string | null }> = {};
  for (const t of (trab && trab.data) || []) mapa[t.id] = { task_id: t.task_id || null, tipo: t.tipo || null };
  return { itens, clientes: geracoesPorCliente(itens, nomes, mapa) };
}

// ------------------------------------------------------------------ função

export const semFila = (e: unknown) => e instanceof ErroDaMesa && CODIGOS_SEM_FILA.indexOf(e.codigo) >= 0;

export interface RespostaDoEnfileirar {
  lote_id: string;
  itens: ItemNaFila[];
  ja_na_fila: number[];
}

/** Fila fora do ar: não pergunta de novo por 5 minutos (o caminho antigo segue sem uma chamada a mais por lâmina). */
let semFilaAte = 0;
export const esquecerSemFila = () => { semFilaAte = 0; };

/** Pede as lâminas à fila do servidor. Null quando a fila ainda não está no ar (a tela gera como antes). */
export async function enfileirarLaminas(trabalhoId: string, ordens: number[], corrigirSozinho: boolean): Promise<RespostaDoEnfileirar | null> {
  if (Date.now() < semFilaAte) return null;
  try {
    const r = await chamarFuncao<any>("estudio-arte", { acao: "enfileirar", trabalho_id: trabalhoId, ordens, corrigir_sozinho: corrigirSozinho });
    return {
      lote_id: String((r && r.lote_id) || ""),
      itens: normalizarItens(r && r.itens),
      ja_na_fila: Array.isArray(r && r.ja_na_fila) ? r.ja_na_fila.map(Number) : [],
    };
  } catch (e) {
    if (semFila(e)) {
      semFilaAte = Date.now() + 5 * 60_000;
      return null;
    }
    throw e;
  }
}

export async function cancelarFilaDoTrabalho(trabalhoId: string, ordens?: number[]): Promise<number[]> {
  const r = await chamarFuncao<any>("estudio-arte", { acao: "cancelar_fila", trabalho_id: trabalhoId, ...(ordens && ordens.length ? { ordens } : {}) });
  return Array.isArray(r && r.canceladas) ? r.canceladas.map(Number) : [];
}

/** Pede o próximo passo da fila de quem está logado (vigia). Erro não sobe: a próxima volta tenta de novo. */
export async function empurrarFila(): Promise<void> {
  try {
    await chamarFuncao<any>("estudio-arte", { acao: "processar_fila" });
  } catch {
    /* sem fila, sem login ou função fora do ar: a vigia tenta na próxima volta */
  }
}

/** O erro de um item da fila no formato que a tela já sabe mostrar (avisarErro). */
export function erroDoItem(i: ItemNaFila): ErroDaMesa {
  const codigo = i.erro_codigo || "falha_interna";
  const msg = mensagemDoCodigo(codigo, { mensagem: i.erro_mensagem || undefined }, "estudio-arte");
  return new ErroDaMesa(codigo, msg, { mensagem: i.erro_mensagem });
}

// ------------------------------------------------------------------ hooks

const VISTOS = "mesa:fila-de-geracao:erros-vistos";
function jaVisto(id: string): boolean {
  try {
    const lista = JSON.parse(window.sessionStorage.getItem(VISTOS) || "[]");
    return Array.isArray(lista) && lista.indexOf(id) >= 0;
  } catch {
    return false;
  }
}
function marcarVisto(id: string) {
  try {
    const lista = JSON.parse(window.sessionStorage.getItem(VISTOS) || "[]");
    const nova = (Array.isArray(lista) ? lista : []).concat([id]).slice(-200);
    window.sessionStorage.setItem(VISTOS, JSON.stringify(nova));
  } catch {
    /* sem armazenamento: pode avisar de novo, sem problema */
  }
}

export interface FilaDoTrabalho {
  /** false: tabela ou função ainda não estão no ar (a tela usa o caminho antigo). */
  disponivel: boolean;
  itens: ItemNaFila[];
  ativos: ItemNaFila[];
  andamento: Record<number, AndamentoDaLamina>;
  /** Pede as lâminas; null quando a fila não está no ar. */
  enfileirar: (ordens: number[], corrigirSozinho: boolean) => Promise<RespostaDoEnfileirar | null>;
  cancelar: (ordens?: number[]) => Promise<void>;
}

/**
 * Fila de um trabalho lida do servidor. Não mora no componente: desmontar a
 * tela (tela cheia, outro card, outro cliente) não para nada; montar de novo
 * relê o andamento. `aoMudar` roda quando uma lâmina fica pronta ou termina
 * (para reler o trabalho); `aoFalhar`, uma vez por erro.
 */
export function useFilaDoTrabalho(
  trabalhoId: string | null | undefined,
  opcoes: { aoMudar?: () => void; aoFalhar?: (item: ItemNaFila) => void } = {},
): FilaDoTrabalho {
  const queryClient = useQueryClient();
  const id = trabalhoId || "";
  const q = useQuery({
    queryKey: chaveDaFilaDoTrabalho(id),
    enabled: !!id,
    retry: false,
    staleTime: 2_000,
    queryFn: () => lerFilaDoTrabalho(id),
    refetchInterval: (query) => {
      const d = query.state.data as ItemNaFila[] | null | undefined;
      return d && d.some(estaAtivo) ? INTERVALO_DO_TRABALHO_MS : false;
    },
  });
  const disponivel = !!id && q.data !== null && !q.isError;
  const itens = useMemo(() => (q.data || []) as ItemNaFila[], [q.data]);
  const ativos = useMemo(() => itens.filter(estaAtivo), [itens]);
  const andamento = useMemo(() => andamentoDaFila(itens), [itens]);

  const cb = useRef(opcoes);
  cb.current = opcoes;
  const anterior = useRef<{ id: string; itens: ItemNaFila[] | null }>({ id: "", itens: null });
  useEffect(() => {
    if (!q.data) return;
    const antes = anterior.current.id === id ? anterior.current.itens : null;
    anterior.current = { id, itens: q.data };
    const mudancas = mudancasDaFila(antes, q.data);
    if (!mudancas.length) return;
    // Lâmina pronta, terminada ou com erro: a tela relê o trabalho (a arte nova aparece).
    cb.current.aoMudar?.();
    for (const m of mudancas) {
      if (m.tipo !== "falhou" || jaVisto(m.item.id)) continue;
      marcarVisto(m.item.id);
      cb.current.aoFalhar?.(m.item);
    }
    // O indicador global acompanha sem esperar a volta dele.
    void queryClient.invalidateQueries({ queryKey: chaveDaFilaGlobal });
  }, [q.data, id, queryClient]);

  const enfileirar = useCallback(
    async (ordens: number[], corrigirSozinho: boolean) => {
      if (!id) return null;
      const r = await enfileirarLaminas(id, ordens, corrigirSozinho);
      if (r) {
        await queryClient.invalidateQueries({ queryKey: chaveDaFilaDoTrabalho(id) });
        void queryClient.invalidateQueries({ queryKey: chaveDaFilaGlobal });
      }
      return r;
    },
    [id, queryClient],
  );
  const cancelar = useCallback(
    async (ordens?: number[]) => {
      if (!id) return;
      await cancelarFilaDoTrabalho(id, ordens);
      await queryClient.invalidateQueries({ queryKey: chaveDaFilaDoTrabalho(id) });
      void queryClient.invalidateQueries({ queryKey: chaveDaFilaGlobal });
    },
    [id, queryClient],
  );

  return { disponivel, itens, ativos, andamento, enfileirar, cancelar };
}

/**
 * Fila de todos os clientes (indicador global) e vigia: se o passo de quem
 * está logado ficou parado (a corrente do servidor quebrou), pede o próximo,
 * no máximo a cada 30 s. Sem a tabela, não lê de novo.
 */
export function useGeracoesEmAndamento(ativo: boolean, userId: string | null | undefined) {
  const q = useQuery({
    queryKey: chaveDaFilaGlobal,
    enabled: ativo,
    retry: false,
    staleTime: 5_000,
    queryFn: lerFilaGlobal,
    refetchInterval: (query) => {
      const d = query.state.data as FilaGlobal | null | undefined;
      if (d === null || query.state.status === "error") return false;
      return d && d.itens.length ? INTERVALO_GLOBAL_ATIVO_MS : INTERVALO_GLOBAL_PARADO_MS;
    },
  });
  const ultimoEmpurrao = useRef(0);
  useEffect(() => {
    const d = q.data;
    if (!d || !d.itens.length) return;
    const agora = Date.now();
    if (agora - ultimoEmpurrao.current < INTERVALO_DO_EMPURRAO_MS) return;
    if (!precisaDeEmpurrao(d.itens, userId, agora)) return;
    ultimoEmpurrao.current = agora;
    void empurrarFila();
  }, [q.data, userId]);
  return { clientes: (q.data && q.data.clientes) || [], itens: (q.data && q.data.itens) || [] };
}
