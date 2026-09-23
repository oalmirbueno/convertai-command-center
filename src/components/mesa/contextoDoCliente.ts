import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarFuncao } from "@/lib/mesa/api";

/**
 * Dados da aba Contexto, vindos da função "agente-contexto".
 * "ler" não gasta IA: sincroniza as referências e devolve o que o painel já
 * tem do cliente. "montar" e "conversar" gastam e devolvem o custo real.
 */

export interface CorDoKit {
  nome: string;
  hex: string;
  papel: string;
}

export interface ContextoConsolidado {
  negocio?: string | null;
  publico?: string | null;
  oferta?: string | null;
  tom_de_voz?: string | null;
  diferenciais?: string[] | null;
  tipografia?: { titulo?: string | null; texto?: string | null; observacao?: string | null } | null;
  logo?: { descricao?: string | null } | null;
  lacunas?: string[] | null;
  fontes_lidas?: string[] | null;
}

export interface KitDoContexto {
  client_id: string;
  paleta: CorDoKit[] | null;
  logo_file_id: string | null;
  estilo: string | null;
  regras: string | null;
  contexto: ContextoConsolidado | null;
  contexto_atualizado_em: string | null;
}

export interface FonteDoCliente {
  nome: string;
  papel: string;
  origem: string;
}

export interface DocumentoEncontrado {
  file_id: string;
  nome: string;
  prioridade: boolean;
  caracteres: number;
}

export interface CandidatoALogo {
  origem: "arquivo" | "workspace";
  id: string;
  nome: string;
}

export interface LeituraDoContexto {
  kit: KitDoContexto | null;
  fontes: FonteDoCliente[];
  encontrado: {
    documentos: DocumentoEncontrado[];
    tem_dossie: boolean;
    artes_aprovadas: number;
    referencias: { total: number; identidade: number; tecnica: number; sem_leitura: number };
    sincronizadas_agora: number;
  };
  candidatos_a_logo: CandidatoALogo[];
  lacunas: string[];
}

export interface SugestoesDoContexto {
  paleta?: CorDoKit[];
  estilo?: string;
  regras?: string;
}

export interface RespostaDoMontar {
  kit: KitDoContexto | null;
  sugestoes: SugestoesDoContexto | null;
  fontes_escolhidas: { titulo: string; texto: string; porque?: string | null } | null;
  referencias_lidas: number;
  custo_usd: number | null;
  saldo_usd: number | null;
  reserva_usada: string | null;
}

export interface RespostaDaConversa {
  resposta: string;
  mudou: string[];
  memorias: number;
  kit: KitDoContexto | null;
  custo_usd: number | null;
  saldo_usd: number | null;
}

export interface MensagemDoContexto {
  papel: "usuario" | "agente";
  conteudo: string;
  criado_em: string;
}

export const chaveDoContexto = (clientId: string) => ["mesa", "contexto", clientId];
export const chaveDoHistorico = (clientId: string) => ["mesa", "contexto-historico", clientId];

/** Normaliza a resposta de "ler" para a tela nunca quebrar com campo faltando. */
function normalizar(d: any): LeituraDoContexto {
  const e = d?.encontrado || {};
  const r = e.referencias || {};
  return {
    kit: d?.kit || null,
    fontes: Array.isArray(d?.fontes) ? d.fontes : [],
    encontrado: {
      documentos: Array.isArray(e.documentos) ? e.documentos : [],
      tem_dossie: !!e.tem_dossie,
      artes_aprovadas: Number(e.artes_aprovadas || 0),
      referencias: {
        total: Number(r.total || 0),
        identidade: Number(r.identidade || 0),
        tecnica: Number(r.tecnica || 0),
        sem_leitura: Number(r.sem_leitura || 0),
      },
      sincronizadas_agora: Number(e.sincronizadas_agora || 0),
    },
    candidatos_a_logo: Array.isArray(d?.candidatos_a_logo) ? d.candidatos_a_logo : [],
    lacunas: Array.isArray(d?.lacunas) ? d.lacunas : [],
  };
}

/** O que a Mesa já encontrou do cliente (sem custo de IA). */
export function useLeituraDoContexto(clientId: string) {
  return useQuery({
    queryKey: chaveDoContexto(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => normalizar(await chamarFuncao("agente-contexto", { acao: "ler", client_id: clientId })),
  });
}

/** Histórico da conversa com o agente de contexto (sem custo de IA). */
export function useHistoricoDoContexto(clientId: string) {
  return useQuery({
    queryKey: chaveDoHistorico(clientId),
    enabled: !!clientId,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<MensagemDoContexto[]> => {
      const d = await chamarFuncao<{ mensagens?: MensagemDoContexto[] }>("agente-contexto", { acao: "historico", client_id: clientId });
      return Array.isArray(d?.mensagens) ? d.mensagens : [];
    },
  });
}

/**
 * Tudo que o agente pode ter mudado: a leitura desta aba e as consultas dos
 * componentes de detalhe (Marca, Fontes, Referências, Prompt e Memória).
 */
export function useInvalidarContexto() {
  const queryClient = useQueryClient();
  return (clientId: string, opcoes: { historico?: boolean } = {}) => {
    const chaves: unknown[][] = [
      chaveDoContexto(clientId),
      ["mesa", "kit", clientId],
      ["mesa", "fontes", clientId],
      ["mesa", "referencias", clientId],
      ["mesa", "memoria", clientId],
      ["mesa", "prompts", clientId],
    ];
    if (opcoes.historico) chaves.push(chaveDoHistorico(clientId));
    for (const queryKey of chaves) void queryClient.invalidateQueries({ queryKey });
  };
}

export const ROTULOS_DO_QUE_MUDOU: Record<string, string> = {
  estilo: "estilo",
  regras: "regras",
  paleta: "paleta",
  negocio: "negócio",
  publico: "público",
  oferta: "oferta",
  tom_de_voz: "tom de voz",
};

export const temTexto = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
