import { useQuery, type QueryClient } from "@tanstack/react-query";
import { chamarFuncao } from "@/lib/mesa/api";
import {
  normalizarCampanha,
  type CampanhaDePublicidade,
  type DestinoDoAtivo,
  type Briefing,
  type TomadaDePublicidade,
} from "../../../supabase/functions/mesa-publicidade/regras.ts";

/**
 * Mesa Publicidade: a ponte da tela com a função mesa-publicidade
 * (supabase/functions/mesa-publicidade). As regras (briefing, territórios,
 * tomadas, revisão e linhagem) são as mesmas do servidor: regras.ts é lido
 * dos dois lados.
 *
 * Sem o SQL da mesa (P-01), a campanha vira rascunho: fica na sessão do
 * navegador e vai inteira em cada pedido ({ rascunho }). O ensaio e as fotos
 * continuam salvos na Mesa Foto.
 */

export * from "../../../supabase/functions/mesa-publicidade/regras.ts";

export interface ResumoDaCampanha {
  id: string;
  nome: string;
  kit_id: string | null;
  kit_nome: string;
  categoria: string | null;
  status: string;
  atualizado_em: string | null;
  ensaio_id: string | null;
}

const texto = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

export function normalizarResumos(data: any): { campanhas: ResumoDaCampanha[]; banco: boolean } {
  const lista = data && Array.isArray(data.campanhas) ? data.campanhas : [];
  const campanhas: ResumoDaCampanha[] = [];
  for (const c of lista) {
    if (!c || typeof c !== "object" || !texto(c.id)) continue;
    campanhas.push({
      id: texto(c.id),
      nome: texto(c.nome) || texto(c.kit_nome) || "Campanha",
      kit_id: texto(c.kit_id) || null,
      kit_nome: texto(c.kit_nome),
      categoria: texto(c.categoria) || null,
      status: texto(c.status) || "rascunho",
      atualizado_em: texto(c.atualizado_em) || null,
      ensaio_id: texto(c.ensaio_id) || null,
    });
  }
  return { campanhas, banco: !(data && data.banco === false) };
}

export const chaveDasCampanhas = (clientId: string) => ["mesa-publicidade", "campanhas", clientId];
export const chaveDaCampanha = (campanhaId: string) => ["mesa-publicidade", "campanha", campanhaId];

export function useCampanhas(clientId: string) {
  return useQuery({
    queryKey: chaveDasCampanhas(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => normalizarResumos(await chamarFuncao<any>("mesa-publicidade", { acao: "campanhas_listar", client_id: clientId })),
  });
}

export function useCampanha(campanhaId: string | null, clientId: string) {
  return useQuery({
    queryKey: chaveDaCampanha(campanhaId || ""),
    enabled: !!campanhaId,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<CampanhaDePublicidade> => {
      const data = await chamarFuncao<any>("mesa-publicidade", { acao: "campanha_abrir", campanha_id: campanhaId });
      return normalizarCampanha(data && data.campanha, clientId);
    },
  });
}

// ------------------------------------------------------------------ rascunho (sem o SQL)

export const chaveDoRascunho = (clientId: string) => `mesa-publicidade:rascunho:${clientId}`;

export function lerRascunho(clientId: string): CampanhaDePublicidade | null {
  try {
    const bruto = window.sessionStorage.getItem(chaveDoRascunho(clientId));
    if (!bruto) return null;
    const c = normalizarCampanha(JSON.parse(bruto), clientId);
    return c.client_id === clientId ? { ...c, id: null, persistida: false } : null;
  } catch {
    return null;
  }
}

export function gravarRascunho(clientId: string, c: CampanhaDePublicidade | null) {
  try {
    if (!c) window.sessionStorage.removeItem(chaveDoRascunho(clientId));
    else window.sessionStorage.setItem(chaveDoRascunho(clientId), JSON.stringify(c));
  } catch {
    /* sem armazenamento: o rascunho vale enquanto a tela está aberta */
  }
}

/** Como a campanha vai no pedido: pelo id (banco) ou inteira (rascunho). */
export function alvoDaCampanha(c: CampanhaDePublicidade): Record<string, unknown> {
  return c.id ? { campanha_id: c.id } : { rascunho: c };
}

/** Guarda a campanha que a função devolveu (cache do banco ou rascunho). */
export function guardarCampanha(queryClient: QueryClient, c: CampanhaDePublicidade) {
  if (c.id) {
    queryClient.setQueryData(chaveDaCampanha(c.id), c);
    void queryClient.invalidateQueries({ queryKey: chaveDasCampanhas(c.client_id) });
  } else {
    gravarRascunho(c.client_id, c);
  }
}

// ------------------------------------------------------------------ ações

type Resposta = { campanha: CampanhaDePublicidade; bruto: any };

async function naCampanha(c: CampanhaDePublicidade, acao: string, extras: Record<string, unknown> = {}): Promise<Resposta> {
  const data = await chamarFuncao<any>("mesa-publicidade", { ...extras, ...alvoDaCampanha(c), acao, client_id: c.client_id });
  return { campanha: normalizarCampanha(data && data.campanha, c.client_id), bruto: data };
}

export async function criarCampanha(clientId: string, kitId: string, categoria?: string | null): Promise<{ campanha: CampanhaDePublicidade; banco: boolean; aviso: string }> {
  const corpo: Record<string, unknown> = { acao: "campanha_criar", client_id: clientId, kit_id: kitId };
  if (categoria) corpo.categoria = categoria;
  const data = await chamarFuncao<any>("mesa-publicidade", corpo);
  return { campanha: normalizarCampanha(data && data.campanha, clientId), banco: !(data && data.banco === false), aviso: texto(data && data.aviso) };
}

export const salvarBriefing = (c: CampanhaDePublicidade, briefing: Briefing, nome?: string, categoria?: string | null) =>
  naCampanha(c, "briefing_salvar", { briefing, nome, categoria: categoria === undefined ? undefined : categoria });

export const proporTerritorios = (c: CampanhaDePublicidade, pedido: string) => naCampanha(c, "territorios_propor", { pedido: pedido.trim() || undefined });
export const aprovarTerritorio = (c: CampanhaDePublicidade, territorioId: string) => naCampanha(c, "territorio_aprovar", { territorio_id: territorioId });
export const salvarTomadas = (c: CampanhaDePublicidade, tomadas: TomadaDePublicidade[]) => naCampanha(c, "tomadas_salvar", { tomadas });
export const pedirTomadas = (c: CampanhaDePublicidade) => naCampanha(c, "tomadas_pedir");
export const avaliarRevisoes = (c: CampanhaDePublicidade) => naCampanha(c, "revisao_avaliar");
export const decidirRevisao = (c: CampanhaDePublicidade, p: { foto_tomada_id: string; versao: number; decisao: "aprovar" | "reprovar"; motivo?: string; confirmo_produto?: boolean }) =>
  naCampanha(c, "revisao_decidir", p);
export const encaminhar = (c: CampanhaDePublicidade, destino: DestinoDoAtivo, revisaoIds?: string[]) =>
  naCampanha(c, "encaminhar", { destino, revisao_ids: revisaoIds && revisaoIds.length ? revisaoIds : undefined });

// ------------------------------------------------------------------ agente

export interface MensagemDoAgente {
  id: string | null;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: unknown[];
  custo_usd: number | null;
}

export function normalizarMensagens(data: any): { conversaId: string | null; mensagens: MensagemDoAgente[] } {
  const lista = data && Array.isArray(data.mensagens) ? data.mensagens : [];
  const mensagens: MensagemDoAgente[] = [];
  for (const m of lista) {
    if (!m || typeof m !== "object") continue;
    const papel = m.papel === "usuario" || m.papel === "agente" || m.papel === "sistema" ? m.papel : null;
    if (!papel) continue;
    mensagens.push({ id: texto(m.id) || null, papel, conteudo: texto(m.conteudo), anexos: Array.isArray(m.anexos) ? m.anexos : [], custo_usd: null });
  }
  return { conversaId: texto(data && data.conversa_id) || null, mensagens };
}

export async function lerHistorico(clientId: string, campanhaId: string | null) {
  return normalizarMensagens(await chamarFuncao<any>("mesa-publicidade", { acao: "agente_historico", client_id: clientId, campanha_id: campanhaId || undefined }));
}

export async function conversarComOAgente(p: { clientId: string; campanha: CampanhaDePublicidade | null; mensagem: string; conversaId: string | null; nova?: boolean }) {
  const corpo: Record<string, unknown> = { acao: "agente_conversar", client_id: p.clientId, mensagem: p.mensagem, conversa_id: p.conversaId || undefined, nova: p.nova || undefined };
  if (p.campanha) Object.assign(corpo, alvoDaCampanha(p.campanha));
  const data = await chamarFuncao<any>("mesa-publicidade", corpo);
  return {
    conversaId: texto(data && data.conversa_id) || null,
    mensagem: {
      id: texto(data && data.mensagem_id) || null,
      papel: "agente" as const,
      conteudo: texto(data && data.resposta),
      anexos: data && data.acao ? [data.acao] : [],
      custo_usd: data && typeof data.custo_usd === "number" ? data.custo_usd : null,
    },
    custo_usd: data && data.custo_usd,
  };
}
