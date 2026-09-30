import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import {
  diaValido,
  ehStatus,
  hojeEmSaoPaulo,
  normalizarConteudo,
  normalizarItens,
  normalizarModelo,
  pendenciasDaProposta,
  statusEfetivo,
  totaisDosItens,
  type ConteudoDaProposta,
  type ItemDaProposta,
  type ModeloDeProposta,
  type Pendencia,
  type StatusDaProposta,
  type Totais,
} from "../../../supabase/functions/_shared/proposta-modelo";
import {
  normalizarAnexos,
  normalizarPacotes,
  normalizarPagamento,
  normalizarProva,
  normalizarServico,
  normalizarVisual,
  type AnexoDaProposta,
  type Pacotes,
  type Pagamento,
  type ParametrosDaHora,
  type ProvaDaAgencia,
  type ServicoDaBiblioteca,
  type VisualDaProposta,
} from "../../../supabase/functions/_shared/proposta-comercial";
import { lerUpsell, type UpsellDaProposta } from "../../../supabase/functions/mesa-proposta/modulos/proposta-upsell";

/**
 * Mesa Proposta: a ponte da tela com a função mesa-proposta e as tabelas
 * propostas, proposta_versoes, proposta_eventos e proposta_modelos (frente
 * PRO). A leitura vai direto ao banco pela RLS (admin e gestor com acesso ao
 * cliente); toda escrita passa pela função (só service_role grava). O formato
 * dos dados e as regras moram em supabase/functions/_shared/proposta-modelo.ts
 * (o mesmo código roda na função, aqui e na página pública).
 */

export const CHAVES = {
  propostas: (clientId: string) => ["mesa-proposta", "propostas", clientId] as const,
  proposta: (id: string) => ["mesa-proposta", "proposta", id] as const,
  versoes: (id: string) => ["mesa-proposta", "versoes", id] as const,
  eventos: (id: string) => ["mesa-proposta", "eventos", id] as const,
  modelos: () => ["mesa-proposta", "modelos"] as const,
  leads: () => ["mesa-proposta", "leads"] as const,
  servicos: () => ["mesa-proposta", "servicos"] as const,
  provas: () => ["mesa-proposta", "provas"] as const,
  hora: () => ["mesa-proposta", "hora-tecnica"] as const,
  versao: (id: string, versao: number) => ["mesa-proposta", "versao", id, versao] as const,
};

export type Material = { nome: string; tipo: string; texto: string; em: string };
export type ConferenciaDoDado = { rotulo: string; valor: string; url: string; veredito: "confere" | "contradiz" | "nao_mostra" | "sem_trecho" | "sem_conferencia"; confianca: number | null };

export interface Proposta {
  id: string;
  client_id: string;
  marca_id: string | null;
  lead_id: string | null;
  modelo_id: string | null;
  numero: string;
  titulo: string;
  status: StatusDaProposta;
  status_efetivo: StatusDaProposta;
  versao: number;
  conteudo: ConteudoDaProposta;
  itens: ItemDaProposta[];
  totais: Totais;
  validade_ate: string | null;
  contexto: { notas?: string; transcricao?: string; materiais?: Material[]; perguntas?: string[]; conferencia?: ConferenciaDoDado[]; revisao?: { em?: string; avisos?: string[]; notas?: Record<string, number | null> } | null };
  pendencias: Pendencia[];
  token: string | null;
  aceite: { nome?: string; email?: string; em?: string } | null;
  enviada_em: string | null;
  vista_em: string | null;
  aceita_em: string | null;
  recusada_em: string | null;
  arquivada_em: string | null;
  custo_usd: number;
  atualizado_em: string | null;
  /** Frente PRO2. */
  pacotes: Pacotes;
  pagamento: Pagamento;
  visual: VisualDaProposta;
  anexos: AnexoDaProposta[];
  duplicada_de: string | null;
  pacote_aceito: string | null;
  pagamento_aceito: string | null;
  ultimo_followup_em: string | null;
  /** Frente PRO3: "upsell" (cliente da casa, com o retrato em contexto.upsell) ou "nova". */
  tipo: "nova" | "upsell";
  upsell: UpsellDaProposta | null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tabela nova ainda não criada no banco? */
export function faltaATabela(erro: unknown): boolean {
  const e = (erro || {}) as { code?: string; message?: string };
  return e.code === "42P01" || e.code === "PGRST205" || /propostas?(_modelos|_versoes|_eventos)?.*(does not exist|schema cache)/i.test(String(e.message || ""));
}

/** Linha do banco (ou da função) em forma segura. */
export function normalizarProposta(d: unknown): Proposta | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.client_id !== "string") return null;
  const conteudo = normalizarConteudo(o.conteudo);
  const itens = normalizarItens(o.itens);
  const validade = diaValido(o.validade_ate);
  const status = ehStatus(o.status) ? o.status : "rascunho";
  const contexto = (o.contexto && typeof o.contexto === "object" ? o.contexto : {}) as Proposta["contexto"];
  const upsell = lerUpsell(o.contexto);
  const hoje = hojeEmSaoPaulo();
  return {
    id: o.id,
    client_id: o.client_id,
    marca_id: (o.marca_id as string) || null,
    lead_id: (o.lead_id as string) || null,
    modelo_id: (o.modelo_id as string) || null,
    numero: String(o.numero || ""),
    titulo: String(o.titulo || "Proposta comercial"),
    status,
    status_efetivo: statusEfetivo(status, validade, hoje),
    versao: Math.max(1, Number(o.versao) || 1),
    conteudo,
    itens,
    totais: totaisDosItens(itens),
    validade_ate: validade,
    contexto,
    pendencias: pendenciasDaProposta({ conteudo, itens, validade_ate: validade, contexto }, hoje),
    token: typeof o.token === "string" ? o.token : null,
    aceite: o.aceite && typeof o.aceite === "object" ? (o.aceite as Proposta["aceite"]) : null,
    enviada_em: (o.enviada_em as string) || null,
    vista_em: (o.vista_em as string) || null,
    aceita_em: (o.aceita_em as string) || null,
    recusada_em: (o.recusada_em as string) || null,
    arquivada_em: (o.arquivada_em as string) || null,
    custo_usd: Number(o.custo_usd) || 0,
    atualizado_em: (o.atualizado_em as string) || null,
    pacotes: normalizarPacotes(o.pacotes, itens),
    pagamento: normalizarPagamento(o.pagamento),
    visual: normalizarVisual(o.visual),
    anexos: normalizarAnexos(o.anexos),
    duplicada_de: (o.duplicada_de as string) || null,
    pacote_aceito: (o.pacote_aceito as string) || null,
    pagamento_aceito: (o.pagamento_aceito as string) || null,
    ultimo_followup_em: (o.ultimo_followup_em as string) || null,
    tipo: upsell || o.tipo === "upsell" ? "upsell" : "nova",
    upsell,
  };
}

const CAMPOS_BASE =
  "id, client_id, marca_id, lead_id, modelo_id, numero, titulo, status, versao, conteudo, itens, validade_ate, contexto, token, aceite, enviada_em, vista_em, aceita_em, recusada_em, arquivada_em, custo_usd, atualizado_em";
/** Colunas da frente PRO2: sem a migration no banco, a lista lê as de antes (a mesa não quebra). */
const CAMPOS = `${CAMPOS_BASE}, pacotes, pagamento, visual, anexos, duplicada_de, pacote_aceito, pagamento_aceito, ultimo_followup_em`;

/** Coluna nova da PRO2 ainda não criada no banco. */
export function faltaAColunaNova(erro: unknown): boolean {
  const e = (erro || {}) as { code?: string; message?: string };
  return e.code === "42703" || /column .* does not exist/i.test(String(e.message || ""));
}

/** Propostas do cliente, as mais recentes antes (sem a tabela: lista vazia com o aviso). */
export function usePropostas(clientId: string) {
  return useQuery({
    queryKey: CHAVES.propostas(clientId),
    enabled: !!clientId,
    staleTime: 20_000,
    queryFn: async (): Promise<{ lista: Proposta[]; semTabela: boolean }> => {
      let { data, error } = await (supabase as any).from("propostas").select(CAMPOS).eq("client_id", clientId).order("atualizado_em", { ascending: false }).limit(60);
      if (error && faltaAColunaNova(error)) ({ data, error } = await (supabase as any).from("propostas").select(CAMPOS_BASE).eq("client_id", clientId).order("atualizado_em", { ascending: false }).limit(60));
      if (error) {
        if (faltaATabela(error)) return { lista: [], semTabela: true };
        throw error;
      }
      return { lista: ((data || []) as unknown[]).map(normalizarProposta).filter((p): p is Proposta => !!p), semTabela: false };
    },
  });
}

export type Versao = { versao: number; titulo: string | null; origem: string; nota: string | null; criado_em: string };

export function useVersoes(propostaId: string | null) {
  return useQuery({
    queryKey: CHAVES.versoes(propostaId || "nenhuma"),
    enabled: !!propostaId,
    queryFn: async (): Promise<Versao[]> => {
      const { data, error } = await (supabase as any).from("proposta_versoes").select("versao, titulo, origem, nota, criado_em").eq("proposta_id", propostaId).order("versao", { ascending: false }).limit(40);
      if (error) {
        if (faltaATabela(error)) return [];
        throw error;
      }
      return (data || []) as Versao[];
    },
  });
}

export type EventoDaProposta = { id: string; tipo: string; sessao: string | null; segundos: number | null; dados: Record<string, unknown>; criado_em: string; user_agent: string | null };

export function useEventos(propostaId: string | null) {
  return useQuery({
    queryKey: CHAVES.eventos(propostaId || "nenhuma"),
    enabled: !!propostaId,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<EventoDaProposta[]> => {
      const { data, error } = await (supabase as any).from("proposta_eventos").select("id, tipo, sessao, segundos, dados, criado_em, user_agent").eq("proposta_id", propostaId).order("criado_em", { ascending: false }).limit(200);
      if (error) {
        if (faltaATabela(error)) return [];
        throw error;
      }
      return (data || []) as EventoDaProposta[];
    },
  });
}

/** Rastreio em números: aberturas (sessões), tempo total e o maior, primeira e última abertura. */
export function resumoDoRastreio(eventos: EventoDaProposta[]): { aberturas: number; segundos: number; maior: number; primeira: string | null; ultima: string | null } {
  const abertas = eventos.filter((e) => e.tipo === "aberta");
  const segundos = abertas.reduce((s, e) => s + (Number(e.segundos) || 0), 0);
  const maior = abertas.reduce((m, e) => Math.max(m, Number(e.segundos) || 0), 0);
  const datas = abertas.map((e) => e.criado_em).sort();
  return { aberturas: abertas.length, segundos, maior, primeira: datas[0] || null, ultima: datas[datas.length - 1] || null };
}

export function tempoLegivel(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function useModelosDeProposta() {
  return useQuery({
    queryKey: CHAVES.modelos(),
    staleTime: 120_000,
    queryFn: async (): Promise<Array<ModeloDeProposta & { padrao: boolean }>> => {
      const { data, error } = await (supabase as any).from("proposta_modelos").select("id, nome, descricao, padrao, blocos, validade_dias, condicoes").is("arquivado_em", null).order("padrao", { ascending: false }).order("nome", { ascending: true });
      if (error) {
        if (faltaATabela(error)) return [];
        throw error;
      }
      return ((data || []) as Array<Record<string, unknown>>).map((l) => ({ ...normalizarModelo(l), padrao: l.padrao === true }));
    },
  });
}

export type LeadAberto = { id: string; nome: string; empresa: string | null; estagio: string; won_client_id: string | null };

/** Leads do Comercial para ligar à proposta (os abertos e os ganhos). */
export function useLeadsDoComercial() {
  return useQuery({
    queryKey: CHAVES.leads(),
    staleTime: 60_000,
    queryFn: async (): Promise<LeadAberto[]> => {
      const { data, error } = await (supabase as any).from("commercial_leads").select("id, name, company, stage, won_client_id").is("archived_at", null).neq("stage", "perdido").order("updated_at", { ascending: false }).limit(200);
      if (error) throw error;
      return ((data || []) as Array<Record<string, unknown>>).map((l) => ({ id: String(l.id), nome: String(l.name || "Lead"), empresa: (l.company as string) || null, estagio: String(l.stage || ""), won_client_id: (l.won_client_id as string) || null }));
    },
  });
}

/** Chama a função e devolve o corpo (erro vira ErroDaMesa com a frase). */
export function chamarProposta<T = any>(acao: string, corpo: Record<string, unknown>): Promise<T> {
  return chamarFuncao<T>("mesa-proposta", { acao, ...corpo });
}

/** Põe a proposta devolvida pela função na lista (sem esperar reler) e relê em volta. */
export function aplicarNaLista(qc: QueryClient, clientId: string, bruta: unknown) {
  const p = normalizarProposta(bruta);
  if (!p) return null;
  qc.setQueryData<{ lista: Proposta[]; semTabela: boolean }>(CHAVES.propostas(clientId), (atual) => {
    const lista = atual ? atual.lista.filter((x) => x.id !== p.id) : [];
    return { lista: [p].concat(lista), semTabela: false };
  });
  void qc.invalidateQueries({ queryKey: CHAVES.versoes(p.id) });
  void qc.invalidateQueries({ queryKey: CHAVES.eventos(p.id) });
  return p;
}

export function relerTudo(qc: QueryClient, clientId: string, propostaId?: string | null) {
  void qc.invalidateQueries({ queryKey: CHAVES.propostas(clientId) });
  if (propostaId) {
    void qc.invalidateQueries({ queryKey: CHAVES.versoes(propostaId) });
    void qc.invalidateQueries({ queryKey: CHAVES.eventos(propostaId) });
  }
}

/** Link público da proposta (o mesmo endereço que a função devolve no envio). */
export function linkPublico(token: string | null): string | null {
  if (!token || typeof window === "undefined") return null;
  return `${window.location.origin}/proposta/${token}`;
}

/**
 * Proposta aceita -> contrato (frente CON, função contratos, ação
 * gerar_do_aceite { proposta_id }). Precisa de alguém da gestão do cliente,
 * por isso sai da tela (etapa Envio) e não do link público.
 */
export async function gerarContratoDoAceite(propostaId: string): Promise<{ contratoId: string | null; jaExistia: boolean; pergunta: string | null }> {
  const { data, error } = await supabase.functions.invoke("contratos", { body: { acao: "gerar_do_aceite", proposta_id: propostaId } });
  if (error) {
    const ctx = (error as { context?: { status?: number; clone?: () => Response } }).context;
    const status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
    let corpo: Record<string, unknown> | null = null;
    try {
      corpo = ctx && typeof ctx.clone === "function" ? await ctx.clone().json() : null;
    } catch {
      corpo = null;
    }
    if (status === 404 && !(corpo && corpo.error)) throw new Error("A mesa de contratos ainda não está publicada. O aceite fica registrado e o contrato sai quando ela entrar.");
    throw new Error((corpo && typeof corpo.mensagem === "string" && corpo.mensagem) || "O contrato não foi gerado. Tente de novo.");
  }
  const d = (data || {}) as Record<string, any>;
  if (typeof d.error === "string") throw new Error(typeof d.mensagem === "string" ? d.mensagem : "O contrato não foi gerado.");
  const contrato = d.contrato && typeof d.contrato === "object" ? d.contrato : null;
  return { contratoId: contrato && contrato.id ? String(contrato.id) : null, jaExistia: d.ja_existia === true, pergunta: typeof d.pergunta === "string" ? d.pergunta : null };
}

// ------------------------------------------------------------------ frente PRO2

/** Chama a função da biblioteca comercial (serviços, provas e hora técnica). */
export function chamarBiblioteca<T = any>(acao: string, corpo: Record<string, unknown> = {}): Promise<T> {
  return chamarFuncao<T>("proposta-biblioteca", { acao, ...corpo });
}

const semTabelaNova = (erro: unknown, tabela: string) => faltaATabela(erro) || new RegExp(`${tabela}.*(does not exist|schema cache)`, "i").test(String(((erro || {}) as { message?: string }).message || ""));

/** Serviços da biblioteca da agência. */
export function useServicos() {
  return useQuery({
    queryKey: CHAVES.servicos(),
    staleTime: 60_000,
    queryFn: async (): Promise<{ lista: ServicoDaBiblioteca[]; semTabela: boolean }> => {
      const { data, error } = await (supabase as any).from("proposta_servicos").select("id, nome, categoria, descricao, unidade, preco, recorrencia, horas, entregaveis, ordem, arquivado_em").order("ordem", { ascending: true }).order("nome", { ascending: true }).limit(300);
      if (error) {
        if (semTabelaNova(error, "proposta_servicos")) return { lista: [], semTabela: true };
        throw error;
      }
      return { lista: ((data || []) as unknown[]).map(normalizarServico).filter((s): s is ServicoDaBiblioteca => !!s), semTabela: false };
    },
  });
}

/** Cases e depoimentos da agência, com a autorização. */
export function useProvas() {
  return useQuery({
    queryKey: CHAVES.provas(),
    staleTime: 60_000,
    queryFn: async (): Promise<{ lista: ProvaDaAgencia[]; semTabela: boolean }> => {
      const { data, error } = await (supabase as any).from("proposta_provas").select("id, tipo, titulo, texto, nome, cargo, empresa, link, nicho, autorizado, autorizacao, autorizado_em, arquivado_em").order("criado_em", { ascending: false }).limit(300);
      if (error) {
        if (semTabelaNova(error, "proposta_provas")) return { lista: [], semTabela: true };
        throw error;
      }
      return { lista: ((data || []) as unknown[]).map(normalizarProva).filter((p): p is ProvaDaAgencia => !!p), semTabela: false };
    },
  });
}

export type HoraTecnicaNaTela = {
  parametros: ParametrosDaHora;
  usar_financeiro: boolean;
  financeiro: { custos_fixos_mes: number; pro_labore_mes: number; regras: number } | null;
  aviso: string | null;
  custo_hora: number;
  preco_hora: number;
};

/** Hora técnica (parâmetros e custos do Financeiro), pela função: só quando a calculadora abre. */
export function useHoraTecnica(ativo = true) {
  return useQuery({
    queryKey: CHAVES.hora(),
    enabled: ativo,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<HoraTecnicaNaTela> => {
      const d = await chamarBiblioteca<{ hora: HoraTecnicaNaTela }>("calculadora_ler");
      return d.hora;
    },
  });
}

export type VersaoCompleta = { versao: number; titulo: string | null; conteudo: ConteudoDaProposta; itens: ItemDaProposta[]; origem: string; criado_em: string };

/** Uma versão inteira (para comparar com a atual). */
export function useVersaoCompleta(propostaId: string | null, versao: number | null) {
  return useQuery({
    queryKey: CHAVES.versao(propostaId || "nenhuma", versao || 0),
    enabled: !!propostaId && !!versao,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<VersaoCompleta | null> => {
      const { data, error } = await (supabase as any).from("proposta_versoes").select("versao, titulo, conteudo, itens, origem, criado_em").eq("proposta_id", propostaId).eq("versao", versao).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { versao: Number(data.versao), titulo: data.titulo || null, conteudo: normalizarConteudo(data.conteudo), itens: normalizarItens(data.itens), origem: String(data.origem || ""), criado_em: String(data.criado_em || "") };
    },
  });
}
