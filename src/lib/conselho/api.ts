import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";

/**
 * Conselho de agentes na tela (frente CNS, 30/09). A função `conselho` roda
 * a sessão em passos no servidor; a tela lê as tabelas pela RLS da equipe
 * (conselho_sessoes e conselho_falas), escuta o Realtime para o andamento ao
 * vivo e, enquanto a Sala está aberta, é a vigia: se a sessão parou no meio
 * (queda do worker), pede o próximo passo (nunca mais que uma vez a cada 30 s).
 */

export type EtapaDoConselho = "propostas" | "critica" | "revisao" | "consolidacao";
export type EtapaOuConversa = EtapaDoConselho | "conversa";
export type StatusDaSessao = "fila" | "rodando" | "concluida" | "parada" | "teto" | "erro";
export type StatusDaFala = "fila" | "falando" | "feita" | "erro" | "pulada";

export interface EspecialistaDoCatalogo {
  id: string;
  nome: string;
  area: string;
  visao: string;
  criterio: string;
}

export interface CatalogoDoConselho {
  especialistas: EspecialistaDoCatalogo[];
  padrao: string[];
  criterios: string[];
  limites: { min_especialistas: number; max_especialistas: number; min_rodadas: number; max_rodadas: number; teto_maximo_usd: number };
  modelo_padrao: string | null;
  /** Frente BRF2: presets por tema e os modos (vêm do servidor, já filtrados pela origem). */
  presets?: PresetDoConselho[];
  modos?: Array<{ id: ModoDoConselho; rotulo: string; rodadas: number | null }>;
}

export interface MembroDoConselho {
  id: string;
  nome: string;
  modelo_id: string;
}

export interface Divergencia {
  tipo: "nota" | "preferencia" | "jev_x_notas" | "mantida";
  texto: string;
  especialistas: string[];
  proposta?: string;
  criterio?: string;
  diferenca?: number;
}

export interface LinhaDoRanking {
  especialista: string;
  nome: string;
  titulo: string;
  nota_jev: number | null;
  nota_media: number | null;
  probabilidade: number | null;
}

export interface ResultadoDoConselho {
  vencedor: string | null;
  ranking: LinhaDoRanking[];
  consenso: number | null;
  nivel: "alto" | "medio" | "baixo" | "sem_medida";
  fonte: "jev" | "notas" | "nenhuma";
  acordo: number | null;
  divergencias: Divergencia[];
  recomendacao: string;
  porque: string;
  em_aberto: string[];
  proximos_passos: string[];
  acao: { tipo: "nenhuma" | "usar_na_mesa"; rotulo: string; texto: string };
  aviso: string | null;
  rodada: number;
}

export interface DecisaoDoDono {
  escolha: "recomendacao" | "proposta" | "nenhuma";
  especialista: string | null;
  nota: string | null;
  por: string | null;
  por_nome: string | null;
  em: string;
  desfeita_em?: string | null;
}

export interface SessaoDoConselho {
  id: string;
  client_id: string;
  marca_id: string | null;
  origem: string;
  tema: string;
  pergunta: string;
  criterios: string[];
  especialistas: MembroDoConselho[];
  rodadas: number;
  rodadas_extras: number;
  rodada_atual: number;
  etapa: EtapaDoConselho | "fim";
  status: StatusDaSessao;
  teto_usd: number;
  estimativa_usd: number;
  custo_usd: number;
  resultado: ResultadoDoConselho | null;
  decisao: DecisaoDoDono | null;
  memoria_id: string | null;
  erro_codigo: string | null;
  erro_mensagem: string | null;
  aviso: string | null;
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
  trava_ate: string | null;
  /**
   * Frente UXS (CNS-09): lidos só na sessão aberta, para o "Convocar de novo"
   * voltar ao formulário já preenchido (a lista de sessões não traz).
   */
  modo?: ModoDoConselho | null;
  contexto?: string | null;
  pauta?: { itens?: string[]; anexos?: Array<{ file_id: string; nome?: string }> } | null;
  referencia?: Record<string, unknown> | null;
}

export interface NotaDaCritica {
  autor: string;
  alvo: string;
  criterio: string;
  nota: number;
}

export interface FalaDoConselho {
  id: string;
  sessao_id: string;
  rodada: number;
  etapa: EtapaOuConversa;
  especialista: string;
  papel: "especialista" | "moderador";
  modelo_id: string | null;
  pedido: string | null;
  status: StatusDaFala;
  conteudo: Record<string, unknown> | null;
  texto: string | null;
  notas: NotaDaCritica[] | null;
  custo_usd: number;
  erro_mensagem: string | null;
  criado_em: string;
}

export interface EstimativaDaSessao {
  por_rodada: Array<{ rodada: number; etapa: EtapaDoConselho; usd: number }>;
  total_usd: number;
}

export const NOME_DA_ETAPA: Record<EtapaOuConversa, string> = {
  propostas: "Propostas",
  critica: "Crítica cruzada",
  revisao: "Revisão",
  consolidacao: "Consolidação",
  conversa: "Conversa",
};

export const NOME_DO_STATUS: Record<StatusDaSessao, string> = {
  fila: "Na fila",
  rodando: "Em debate",
  concluida: "Concluída",
  parada: "Parada",
  teto: "Parou no teto",
  erro: "Com erro",
};

export const NOME_DO_NIVEL: Record<ResultadoDoConselho["nivel"], string> = {
  alto: "Consenso alto",
  medio: "Consenso médio",
  baixo: "Consenso baixo",
  sem_medida: "Consenso sem medida",
};

/** Mesmo plano do servidor (_shared/conselho.ts, planoDasEtapas). */
export function planoDasEtapas(rodadas: number, extras = 0): EtapaDoConselho[] {
  const r = Math.max(2, Math.min(4, Math.round(Number(rodadas) || 4)));
  const base: EtapaDoConselho[] = r === 2 ? ["propostas", "consolidacao"] : r === 3 ? ["propostas", "critica", "consolidacao"] : ["propostas", "critica", "revisao", "consolidacao"];
  const e = Math.max(0, Math.min(2, Math.round(Number(extras) || 0)));
  for (let i = 0; i < e; i++) base.push("critica", "revisao", "consolidacao");
  return base;
}

export const sessaoAtiva = (s: Pick<SessaoDoConselho, "status"> | null | undefined) => !!s && (s.status === "fila" || s.status === "rodando");

/** Nome do especialista (o moderador não está no catálogo). */
export function nomeDe(id: string, sessao?: Pick<SessaoDoConselho, "especialistas"> | null, catalogo?: EspecialistaDoCatalogo[]): string {
  if (id === "moderador") return "Moderador";
  const m = sessao && sessao.especialistas.find((x) => x.id === id);
  if (m) return m.nome;
  const c = catalogo && catalogo.find((x) => x.id === id);
  return c ? c.nome : id;
}

/** Média das notas que cada proposta recebeu numa rodada de crítica. */
export function mediasRecebidas(falas: FalaDoConselho[], rodada: number): Record<string, number> {
  const soma: Record<string, { s: number; n: number }> = {};
  falas
    .filter((f) => f.rodada === rodada && f.etapa === "critica" && f.status === "feita")
    .forEach((f) => (f.notas || []).forEach((n) => {
      const a = soma[n.alvo] || (soma[n.alvo] = { s: 0, n: 0 });
      a.s += Number(n.nota) || 0;
      a.n += 1;
    }));
  const r: Record<string, number> = {};
  Object.keys(soma).forEach((k) => {
    r[k] = Math.round((soma[k].s / soma[k].n) * 10) / 10;
  });
  return r;
}

// ------------------------------------------------------------------ chamadas

export const chamarConselho = <T = unknown>(corpo: Record<string, unknown>) => chamarFuncao<T>("conselho", corpo);

export function lerCatalogoDoConselho(origem: string): Promise<CatalogoDoConselho> {
  return chamarConselho<CatalogoDoConselho>({ acao: "catalogo", origem });
}

export function estimarConselho(p: { clientId: string; origem: string; especialistas: string[]; modelos: Record<string, string>; rodadas: number; modo?: ModoDoConselho }) {
  return chamarConselho<{ estimativa: EstimativaDaSessao; teto_sugerido_usd: number }>({
    acao: "estimar",
    client_id: p.clientId,
    origem: p.origem,
    especialistas: p.especialistas,
    modelos: p.modelos,
    rodadas: p.rodadas,
    modo: p.modo || "padrao",
  });
}

export interface PedidoDeConvocacao {
  clientId: string;
  origem: string;
  referencia?: Record<string, unknown> | null;
  tema: string;
  pergunta: string;
  contexto?: string | null;
  especialistas: string[];
  modelos: Record<string, string>;
  rodadas: number;
  teto_usd: number;
  modo?: ModoDoConselho;
  criterios?: string[];
  pauta?: { itens: string[]; anexos: string[] } | null;
}

export function convocarConselho(p: PedidoDeConvocacao) {
  return chamarConselho<{ sessao: SessaoDoConselho; estimativa: EstimativaDaSessao }>({
    acao: "convocar",
    client_id: p.clientId,
    origem: p.origem,
    referencia: p.referencia || {},
    tema: p.tema,
    pergunta: p.pergunta,
    contexto: p.contexto || "",
    especialistas: p.especialistas,
    modelos: p.modelos,
    rodadas: p.rodadas,
    teto_usd: p.teto_usd,
    modo: p.modo || "padrao",
    criterios: p.criterios && p.criterios.length ? p.criterios : undefined,
    pauta: p.pauta || undefined,
  });
}

// ------------------------------------------------------------------ leitura ao vivo

const COLUNAS_DA_SESSAO =
  "id, client_id, marca_id, origem, tema, pergunta, criterios, especialistas, rodadas, rodadas_extras, rodada_atual, etapa, status, teto_usd, estimativa_usd, custo_usd, resultado, decisao, memoria_id, erro_codigo, erro_mensagem, aviso, criado_em, atualizado_em, concluido_em, trava_ate";
// A sessão aberta lê também o que o "Convocar de novo" precisa (colunas de 20260930050000 e 196200).
// A lista de sessões fica sem elas: a pauta guarda trechos dos anexos e pesaria 20 vezes.
const COLUNAS_DA_SESSAO_ABERTA = `${COLUNAS_DA_SESSAO}, modo, contexto, pauta, referencia`;
const COLUNAS_DA_FALA = "id, sessao_id, rodada, etapa, especialista, papel, modelo_id, pedido, status, conteudo, texto, notas, custo_usd, erro_mensagem, criado_em";

// As tabelas do conselho ainda não estão nos tipos gerados do Supabase (entram quando o SQL CNS-01 for aplicado).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabela = (nome: "conselho_sessoes" | "conselho_falas") => (supabase as any).from(nome);

const numero = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

function sessaoDaLinha(l: Record<string, unknown>): SessaoDoConselho {
  return {
    ...l,
    criterios: Array.isArray(l.criterios) ? l.criterios : [],
    especialistas: Array.isArray(l.especialistas) ? l.especialistas : [],
    teto_usd: numero(l.teto_usd),
    estimativa_usd: numero(l.estimativa_usd),
    custo_usd: numero(l.custo_usd),
  } as SessaoDoConselho;
}

export function useSessoesDoConselho(clientId: string | null) {
  return useQuery({
    queryKey: ["conselho", "sessoes", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<SessaoDoConselho[]> => {
      const { data, error } = await tabela("conselho_sessoes")
        .select(COLUNAS_DA_SESSAO)
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data || []) as Record<string, unknown>[]).map(sessaoDaLinha);
    },
  });
}

export function useSessaoDoConselho(sessaoId: string | null) {
  const qc = useQueryClient();
  const sessao = useQuery({
    queryKey: ["conselho", "sessao", sessaoId],
    enabled: !!sessaoId,
    queryFn: async (): Promise<SessaoDoConselho | null> => {
      const { data, error } = await tabela("conselho_sessoes").select(COLUNAS_DA_SESSAO_ABERTA).eq("id", sessaoId).maybeSingle();
      if (error) throw error;
      return data ? sessaoDaLinha(data as Record<string, unknown>) : null;
    },
    // Rede de segurança do tempo real: enquanto roda, relê a cada 15 s.
    refetchInterval: (q) => (sessaoAtiva(q.state.data as SessaoDoConselho | null) ? 15_000 : false),
  });
  const falas = useQuery({
    queryKey: ["conselho", "falas", sessaoId],
    enabled: !!sessaoId,
    queryFn: async (): Promise<FalaDoConselho[]> => {
      const { data, error } = await tabela("conselho_falas")
        .select(COLUNAS_DA_FALA)
        .eq("sessao_id", sessaoId)
        .order("rodada", { ascending: true })
        .order("criado_em", { ascending: true });
      if (error) throw error;
      return ((data || []) as Record<string, unknown>[]).map((f) => ({ ...f, custo_usd: numero(f.custo_usd) })) as unknown as FalaDoConselho[];
    },
    refetchInterval: () => (sessaoAtiva(qc.getQueryData(["conselho", "sessao", sessaoId]) as SessaoDoConselho | null) ? 15_000 : false),
  });

  // Andamento ao vivo: quem está falando, notas e resultado chegam pelo Realtime.
  useEffect(() => {
    if (!sessaoId) return;
    let espera: ReturnType<typeof setTimeout> | null = null;
    const reler = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => {
        espera = null;
        void qc.invalidateQueries({ queryKey: ["conselho", "sessao", sessaoId] });
        void qc.invalidateQueries({ queryKey: ["conselho", "falas", sessaoId] });
      }, 250);
    };
    let canal: ReturnType<typeof supabase.channel> | null = null;
    try {
      canal = supabase
        .channel(`conselho:${sessaoId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "conselho_falas", filter: `sessao_id=eq.${sessaoId}` }, reler)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conselho_sessoes", filter: `id=eq.${sessaoId}` }, reler)
        .subscribe();
    } catch {
      canal = null; // sem tempo real: a releitura de 15 s segue
    }
    return () => {
      if (espera) clearTimeout(espera);
      if (canal) void supabase.removeChannel(canal);
    };
  }, [sessaoId, qc]);

  // Vigia: sessão ativa sem mudar há 60 s e sem trava válida pede o próximo passo (no máximo a cada 30 s).
  const ultimoPedido = useRef(0);
  const s = sessao.data;
  useEffect(() => {
    if (!s || !sessaoAtiva(s)) return;
    const relogio = setInterval(() => {
      const agora = Date.now();
      const parada = agora - new Date(s.atualizado_em).getTime() > 60_000;
      const semTrava = !s.trava_ate || new Date(s.trava_ate).getTime() < agora;
      if (parada && semTrava && agora - ultimoPedido.current > 30_000) {
        ultimoPedido.current = agora;
        chamarConselho({ acao: "avancar", sessao_id: s.id }).catch((e) => {
          // A próxima volta da vigia tenta de novo; o erro do passo fica na própria sessão.
          console.warn("[conselho] vigia não retomou a sessão", { sessao_id: s.id, erro: e instanceof Error ? e.message : String(e) });
        });
      }
    }, 10_000);
    return () => clearInterval(relogio);
  }, [s]);

  return { sessao, falas };
}

// ------------------------------------------------------------------ frente BRF2: presets, modos, elencos e ata em PDF

export type ModoDoConselho = "rapido" | "padrao" | "profundo";

export interface PresetDoConselho {
  id: "marca" | "campanha" | "proposta" | "site" | "crise";
  nome: string;
  /** Mesa do preset ("mesa-proposta", "mesa-site"...): a Sala aberta dessa mesa já começa por ele. */
  origem?: string;
  especialistas: string[];
  criterios: string[];
  modo: ModoDoConselho;
  rodadas: number;
  tema: string;
  pergunta: string;
}

export interface ElencoSalvo {
  id: string;
  client_id: string | null;
  nome: string;
  preset: PresetDoConselho["id"] | null;
  especialistas: string[];
  modelos: Record<string, string>;
  criterios: string[];
  rodadas: number;
  modo: ModoDoConselho;
  criado_em: string;
}

export const ROTULO_DO_MODO: Record<ModoDoConselho, string> = { rapido: "Rápido", padrao: "Padrão", profundo: "Profundo" };

/** Rodadas de cada modo (mesmo que o servidor: rápido 2, profundo 4, padrão o escolhido). */
export const rodadasDoModo = (modo: ModoDoConselho, escolhidas: number) => (modo === "rapido" ? 2 : modo === "profundo" ? 4 : escolhidas);

export function listarElencos(clientId: string) {
  return chamarConselho<{ elencos: ElencoSalvo[] }>({ acao: "elencos", client_id: clientId }).then((r) => r.elencos || []);
}

export function salvarElenco(p: { clientId: string; nome: string; especialistas: string[]; modelos: Record<string, string>; criterios: string[]; rodadas: number; modo: ModoDoConselho; preset?: string | null; daAgencia?: boolean }) {
  return chamarConselho<{ elenco: ElencoSalvo }>({
    acao: "salvar_elenco",
    client_id: p.clientId,
    nome: p.nome,
    especialistas: p.especialistas,
    modelos: p.modelos,
    criterios: p.criterios,
    rodadas: p.rodadas,
    modo: p.modo,
    preset: p.preset || null,
    da_agencia: !!p.daAgencia,
  }).then((r) => r.elenco);
}

export function arquivarElenco(elencoId: string) {
  return chamarConselho<{ elenco: ElencoSalvo }>({ acao: "arquivar_elenco", elenco_id: elencoId });
}

/** A ata em PDF (pdf-base), guardada em Arquivos; volta o link assinado de 1 hora. */
export function ataEmPdf(sessaoId: string) {
  return chamarConselho<{ file_id: string; url: string | null; nome_do_arquivo: string; ja_existia: boolean }>({ acao: "ata_pdf", sessao_id: sessaoId });
}
