import { chamarFuncao } from "@/lib/mesa/api";
import {
  emPorcentagem,
  FORMATOS_DO_POST,
  LIMITE_POR_PAPEL,
  MAX_PAUTAS,
  MAX_POSTS_NO_ESTILO,
  MIN_PAUTAS,
  normalizarHandle,
  normalizarLinkDePost,
  type PapelDoPerfil,
  ROTULO_DO_FORMATO,
  ROTULO_DO_FORMATO_EDITORIAL,
  ROTULO_DO_PAPEL,
} from "../../../supabase/functions/_shared/perfis-instagram";

/**
 * Tela dos Perfis do Instagram (frente P): tipos do que a função
 * perfis-instagram devolve e as chamadas. Limites, rótulos e a leitura do @
 * vêm do módulo puro do servidor (_shared/perfis-instagram.ts), o mesmo que
 * a função usa.
 */

export {
  emPorcentagem,
  FORMATOS_DO_POST,
  LIMITE_POR_PAPEL,
  MAX_PAUTAS,
  MAX_POSTS_NO_ESTILO,
  MIN_PAUTAS,
  normalizarHandle,
  normalizarLinkDePost,
  ROTULO_DO_FORMATO,
  ROTULO_DO_FORMATO_EDITORIAL,
  ROTULO_DO_PAPEL,
};
export type { PapelDoPerfil };

export interface ResumoDoPerfil {
  padrao_visual?: string;
  padrao_editorial?: string;
  o_que_funciona?: string;
  o_que_evitar?: string;
  gerado_em?: string;
}

export interface MetricasDoPerfil {
  posts?: number;
  por_semana?: number | null;
  mix?: Record<string, number>;
  horas_mais_usadas?: number[];
  dias_mais_usados?: string[];
  engajamento_mediano?: number | null;
  fora_da_curva?: number;
}

export interface PerfilNaLista {
  id: string;
  papel: PapelDoPerfil;
  handle: string;
  nome: string | null;
  seguidores: number | null;
  posts_total: number | null;
  foto_caminho: string | null;
  origem: "api" | "manual";
  capturado_em: string | null;
  monitorar: boolean;
  proxima_rodada_em: string | null;
  ultima_rodada_em: string | null;
  ultimo_erro: string | null;
  resumo: ResumoDoPerfil | null;
  metricas: MetricasDoPerfil | null;
  contagem: { posts: number; sem_leitura: number; fora: number };
}

export interface MudancaNosConcorrentes {
  id: string;
  perfil_id: string | null;
  handle: string | null;
  tipo: string;
  status: string;
  novos: number;
  fora_da_curva: number;
  ideias: Array<{ tema?: string; gancho?: string; por_que?: string }>;
  resumo: string | null;
  iniciada_em: string;
  erro: string | null;
}

export interface ListaDePerfis {
  sql_pendente: boolean;
  aviso?: string;
  limite_por_papel: number;
  captura_api: { disponivel: boolean; origem: "cliente" | "agencia" | null; motivo: string | null };
  perfis: PerfilNaLista[];
  mudancas: MudancaNosConcorrentes[];
}

export interface PostDoPerfil {
  id: string;
  ref: string;
  formato: string;
  legenda: string | null;
  curtidas: number | null;
  comentarios: number | null;
  publicado_em: string | null;
  permalink: string | null;
  midia_caminho: string | null;
  engajamento: number | null;
  vezes_a_mediana: number | null;
  fora_da_curva: boolean;
  formato_editorial: string | null;
  pilar: string | null;
  combina: number | null;
  leitura: string | null;
  lido_em: string | null;
  origem: "api" | "manual";
}

export interface MensagemDoPerfil {
  id: string | null;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: any[];
  criado_em?: string;
}

export interface PerfilAbertoDados {
  perfil: PerfilNaLista & { biografia?: string | null };
  posts: PostDoPerfil[];
  mensagens: MensagemDoPerfil[];
}

export const chaveDaLista = (clientId: string) => ["perfis-instagram", clientId];
export const chaveDoPerfil = (clientId: string, perfilId: string) => ["perfis-instagram", clientId, perfilId];

/** Chamada à função, com a marca aberta quando não é a principal (o agendar e o estilo respeitam a marca). */
export function chamarPerfis<T = any>(acao: string, clientId: string, marcaId: string | null, extra: Record<string, unknown> = {}): Promise<T> {
  const corpo: Record<string, unknown> = { ...extra, acao, client_id: clientId };
  if (marcaId) corpo.marca_id = marcaId;
  return chamarFuncao<T>("perfis-instagram", corpo);
}

export function normalizarLista(d: any): ListaDePerfis {
  const o = d && typeof d === "object" ? d : {};
  return {
    sql_pendente: !!o.sql_pendente,
    aviso: typeof o.aviso === "string" ? o.aviso : undefined,
    limite_por_papel: Number(o.limite_por_papel) || LIMITE_POR_PAPEL,
    captura_api: {
      disponivel: !!(o.captura_api && o.captura_api.disponivel),
      origem: o.captura_api && (o.captura_api.origem === "cliente" || o.captura_api.origem === "agencia") ? o.captura_api.origem : null,
      motivo: o.captura_api && typeof o.captura_api.motivo === "string" ? o.captura_api.motivo : null,
    },
    perfis: Array.isArray(o.perfis) ? o.perfis : [],
    mudancas: Array.isArray(o.mudancas) ? o.mudancas : [],
  };
}

/** "12,3 mil" para seguidores. */
export function numeroCurto(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "sem número";
  if (v >= 1000000) return `${(v / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 10000) return `${Math.round(v / 1000).toLocaleString("pt-BR")} mil`;
  if (v >= 1000) return `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR");
}

export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Nome de arquivo sem crypto.randomUUID (Safari 11). */
export function nomeUnico(ext: string): string {
  const aleatorio = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${aleatorio}.${ext}`;
}

/** Mês YYYY-MM de hoje e do próximo (para o plano igual). */
export function mesesDoPlano(hoje: Date = new Date()): { atual: string; proximo: string } {
  const a = hoje.getFullYear();
  const m = hoje.getMonth() + 1;
  const atual = `${a}-${String(m).padStart(2, "0")}`;
  const proximo = `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  return { atual, proximo };
}

/** Filtro de formato da grade: "todos" ou um formato do post. */
export const FILTROS_DE_FORMATO = ["todos"].concat(FORMATOS_DO_POST as unknown as string[]);
