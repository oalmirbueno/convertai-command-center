/**
 * Base dos agentes (17/10/2026): leitura direta (a equipe lê pela RLS) e as
 * mudanças pela função base-dos-agentes (só admin e gestor escrevem).
 */
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";

export interface FichaDaBase {
  id: string;
  fonte_id: string | null;
  agente: string;
  client_id: string | null;
  titulo: string;
  tecnica: string;
  quando_usar: string;
  exemplo: string;
  fonte_url: string | null;
  ativa: boolean;
  usos: number;
  ultimo_uso: string | null;
  criado_em: string;
  /** 17/10: o resultado das peças feitas com a ficha (rotina da base). */
  aprovadas: number;
  ajustadas: number;
  reprovadas: number;
  posts: number;
  multiplo: number | string | null;
  resultado_em: string | null;
  /** 17/10 (rodada 4): anúncios no ar feitos com a ficha e a eficiência média (custo por resultado contra o normal da conta). */
  anuncios: number;
  eficiencia: number | string | null;
  /** Arquivada pela faxina: sem uso em 60 dias ou repetida de outra. */
  arquivada_por: "sem_uso" | "repetida" | null;
}

export interface FonteDaBase {
  id: string;
  agente: string;
  client_id: string | null;
  tipo: "texto" | "documento" | "link" | "pesquisa";
  nome: string;
  url: string | null;
  status: "lendo" | "pronta" | "erro";
  erro: string | null;
  fichas: number;
  custo_usd: number;
  criado_em: string;
}

export interface ClienteDaBase {
  id: string;
  nome: string;
}

const db = supabase as any;

export async function lerFichas(agente: string): Promise<FichaDaBase[]> {
  const { data, error } = await db
    .from("agente_base_fichas")
    .select("id, fonte_id, agente, client_id, titulo, tecnica, quando_usar, exemplo, fonte_url, ativa, usos, ultimo_uso, criado_em, aprovadas, ajustadas, reprovadas, posts, multiplo, resultado_em, anuncios, eficiencia, arquivada_por")
    .eq("agente", agente)
    .order("criado_em", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as FichaDaBase[];
}

export async function lerFontes(agente: string): Promise<FonteDaBase[]> {
  const { data, error } = await db
    .from("agente_base_fontes")
    .select("id, agente, client_id, tipo, nome, url, status, erro, fichas, custo_usd, criado_em")
    .eq("agente", agente)
    .order("criado_em", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []) as FonteDaBase[];
}

/** Fichas ativas por agente e a última pesquisa, para a lista da esquerda. */
export async function lerResumoDosAgentes(): Promise<Record<string, { ativas: number; ultimaPesquisa: string | null }>> {
  const [fichas, pesquisas] = await Promise.all([
    db.from("agente_base_fichas").select("agente").eq("ativa", true).limit(5000),
    db.from("agente_base_fontes").select("agente, criado_em").eq("tipo", "pesquisa").order("criado_em", { ascending: false }).limit(500),
  ]);
  if (fichas.error) throw fichas.error;
  const resumo: Record<string, { ativas: number; ultimaPesquisa: string | null }> = {};
  for (const f of (fichas.data || []) as { agente: string }[]) {
    resumo[f.agente] = resumo[f.agente] || { ativas: 0, ultimaPesquisa: null };
    resumo[f.agente].ativas += 1;
  }
  for (const p of (pesquisas.data || []) as { agente: string; criado_em: string }[]) {
    resumo[p.agente] = resumo[p.agente] || { ativas: 0, ultimaPesquisa: null };
    if (!resumo[p.agente].ultimaPesquisa) resumo[p.agente].ultimaPesquisa = p.criado_em;
  }
  return resumo;
}

/** Clientes do painel (papel client, sem apagados), para a ficha "só deste cliente". */
export async function lerClientesDaBase(): Promise<ClienteDaBase[]> {
  const { data: papeis, error: e1 } = await supabase.from("user_roles").select("user_id").eq("role", "client");
  if (e1) throw e1;
  const ids = ((papeis as { user_id: string }[] | null) || []).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data, error } = await supabase.from("profiles").select("id, full_name, company_name").in("id", ids).is("deleted_at", null);
  if (error) throw error;
  return ((data as { id: string; full_name: string | null; company_name: string | null }[] | null) || [])
    .map((c) => ({ id: c.id, nome: (c.company_name || c.full_name || "Cliente").trim() }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export interface ResultadoDoEnsino {
  fonte_id: string;
  fichas: number;
  titulos: string[];
  observacao: string;
  custo_usd: number;
}

export const ensinar = (p: { agente: string; clientId: string | null; tipo: "texto" | "documento" | "link"; nome?: string; texto?: string; url?: string }) =>
  chamarFuncao<ResultadoDoEnsino>("base-dos-agentes", {
    acao: "ensinar",
    agente: p.agente,
    client_id: p.clientId,
    tipo: p.tipo,
    nome: p.nome,
    texto: p.texto,
    url: p.url,
  });

export const pesquisarAgora = (agente: string) => chamarFuncao<ResultadoDoEnsino>("base-dos-agentes", { acao: "pesquisar", agente });

export const novaFicha = (p: { agente: string; clientId: string | null; titulo: string; tecnica: string; quando_usar: string; exemplo: string }) =>
  chamarFuncao<{ id: string }>("base-dos-agentes", { acao: "nova_ficha", agente: p.agente, client_id: p.clientId, titulo: p.titulo, tecnica: p.tecnica, quando_usar: p.quando_usar, exemplo: p.exemplo });

export const editarFicha = (id: string, mudar: Partial<Pick<FichaDaBase, "titulo" | "tecnica" | "quando_usar" | "exemplo" | "ativa" | "client_id">>) =>
  chamarFuncao("base-dos-agentes", { acao: "editar_ficha", id, ...mudar });

export const apagarFicha = (id: string) => chamarFuncao("base-dos-agentes", { acao: "apagar_ficha", id });

export const apagarFonte = (id: string) => chamarFuncao("base-dos-agentes", { acao: "apagar_fonte", id });

/** O que a base aprendeu nos últimos 7 dias e as carteiras que travam a pesquisa e a leitura. */
export interface ResumoDaSemana {
  novas: { pesquisa: number; materiais: number; numeros: number; concorrentes: number };
  sairam: number;
  referenciasLidas: number;
  carteirasBaixas: Array<{ cliente: string; saldo: number }>;
  texto: string;
}
export const lerResumoDaSemana = () => chamarFuncao<ResumoDaSemana>("base-dos-agentes", { acao: "resumo_da_semana" });

/** Cruza agora as fichas com as aprovações e os números do Instagram (a rotina de terça faz sozinha). */
export const aprenderComResultados = () => chamarFuncao<{ fichas: number; vencedoras: number }>("base-dos-agentes", { acao: "aprender_com_resultados" });
