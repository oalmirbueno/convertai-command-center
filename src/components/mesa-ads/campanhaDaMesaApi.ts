import { supabase } from "@/integrations/supabase/client";
import { arteRapidaDa } from "../../../supabase/functions/estudio-arte/modulos/arte-rapida";
import { faseDaPeca, rotuloDaFase, type FaseDaCampanha } from "@/components/mesa/regrasDaCampanha";
import { lerStoriesDaCampanha, type Sequencia, type Story } from "@/components/mesa/stories/storiesApi";
import { chamarAds, type CriativoAds, type FormatoAds } from "./adsApi";

/**
 * Peças prontas de uma campanha da Mesa como criativos da Mesa Ads (22/10/2026). O atalho da campanha
 * (`?etapa=estudio&campanha_mesa=<id>`) ou o seletor "Puxar de uma campanha" abre, no Estúdio Ads, as artes
 * prontas da campanha: posts e carrosséis (artes rápidas com direcao.arte_rapida.campanha_id) e as
 * sequências de stories (escolha.campanha). "Usar como criativo" chama a ação criativos_da_campanha_mesa da
 * mesa-ads, que só registra o criativo apontando para o MESMO trabalho do Estúdio (nenhum arquivo copiado).
 * O criativo guarda copy.campanha_mesa_id e copy.campanha_mesa (nome, fase, data, oferta e CTA) e o
 * "Refinar copy" parte da copy da peça e do briefing da campanha. Subir para a Meta segue o fluxo de sempre:
 * pausado e só com aprovação.
 */

export type TipoDaPeca = "post" | "carrossel" | "stories";

export const ROTULO_DO_TIPO: Record<TipoDaPeca, string> = { post: "Post", carrossel: "Carrossel", stories: "Stories" };

export interface CampanhaDaMesaAds {
  id: string;
  nome: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  proposta_id: string | null;
  oferta: string;
  cta: string;
}

export interface PecaDaCampanhaAds {
  /** Chave da peça na tela: o trabalho (e a sequência, nos stories). */
  chave: string;
  trabalho_id: string;
  tipo: TipoDaPeca;
  formato: FormatoAds;
  titulo: string;
  tema_id: string | null;
  sequencia_id: string | null;
  fase: FaseDaCampanha;
  data: string | null;
  capa: string | null;
  laminas: number;
  legenda: string;
  /** Já é criativo da Mesa Ads (o id do criativo). */
  criativo_id: string | null;
}

export interface CampanhaComPecas {
  id: string;
  nome: string;
  prontas: number;
}

export const chavesDaCampanhaMesa = {
  pecas: (clientId: string, campanhaId: string) => ["mesa", "ads", "campanha-mesa", clientId, campanhaId] as const,
  lista: (clientId: string) => ["mesa", "ads", "campanhas-mesa", clientId] as const,
};

const sb = () => supabase as any;
const txt = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

interface TrabalhoLido {
  id: string;
  status?: string | null;
  direcao?: unknown;
  cards?: unknown;
  legenda?: string | null;
  atualizado_em?: string | null;
}

/** Última versão de cada lâmina: { ordem: caminho }. */
function ultimasLaminas(cards: unknown): Record<number, { versao: number; caminho: string }> {
  const m: Record<number, { versao: number; caminho: string }> = {};
  (Array.isArray(cards) ? cards : []).forEach((c: any) => {
    if (!c || typeof c.storage_path !== "string" || !c.storage_path) return;
    const ordem = Number(c.ordem);
    const versao = Number(c.versao) || 0;
    if (!isFinite(ordem)) return;
    if (!m[ordem] || m[ordem].versao < versao) m[ordem] = { versao, caminho: c.storage_path };
  });
  return m;
}

/** A arte rápida da campanha com todas as lâminas geradas (ou já na agenda): a peça pronta. Função pura. */
export function artePronta(t: TrabalhoLido, campanhaId?: string): { titulo: string; tema_id: string | null; laminas: number; capa: string | null; carrossel: boolean } | null {
  const a = arteRapidaDa(t.direcao);
  if (!a || !a.campanha_id || a.arquivada_em) return null;
  if (campanhaId && a.campanha_id.toLowerCase() !== campanhaId.toLowerCase()) return null;
  const ordens = ((obj(t.direcao).cards as { ordem: number }[] | undefined) || []).map((c) => Number(c.ordem)).filter((o) => isFinite(o)).sort((x, y) => x - y);
  const feitas = ultimasLaminas(t.cards);
  if (!ordens.length || !ordens.every((o) => !!feitas[o])) return null;
  const capa = feitas[ordens[0]] ? feitas[ordens[0]].caminho : null;
  return {
    titulo: a.titulo || "Peça",
    tema_id: a.peca_da_campanha ? a.peca_da_campanha.tema_id : null,
    laminas: ordens.length,
    capa,
    carrossel: a.peca === "carrossel" || ordens.length > 1,
  };
}

/** O item da série (data e etapa) pelo tema_id. */
type ItemDaSerie = { tema_id?: string; data?: string; etapa?: string; tema?: string; copy?: string; formato?: string };

/**
 * As peças prontas da campanha (artes e stories), na ordem da data. Função pura: recebe o que foi lido.
 * Stories: uma peça por trabalho de imagem da sequência, pronta quando todas as telas geradas têm arte.
 */
export function montarPecas(
  campanha: Pick<CampanhaDaMesaAds, "id" | "periodo_inicio" | "periodo_fim">,
  trabalhos: TrabalhoLido[],
  itens: ItemDaSerie[],
  sequencias: Sequencia[],
  stories: Story[],
  criativos: Pick<CriativoAds, "id" | "trabalho_id">[],
): PecaDaCampanhaAds[] {
  const criativoDe = (trabalhoId: string) => {
    const c = criativos.filter((x) => x.trabalho_id === trabalhoId)[0];
    return c ? c.id : null;
  };
  const pecas: PecaDaCampanhaAds[] = [];
  trabalhos.forEach((t) => {
    const p = artePronta(t, campanha.id);
    if (!p) return;
    const item = (p.tema_id ? itens.filter((i) => i.tema_id === p.tema_id)[0] : null) || null;
    const data = (item && item.data) || null;
    pecas.push({
      chave: t.id,
      trabalho_id: t.id,
      tipo: p.carrossel ? "carrossel" : "post",
      formato: p.carrossel ? "carrossel" : "feed_4x5",
      titulo: (item && item.tema) || p.titulo,
      tema_id: p.tema_id,
      sequencia_id: null,
      fase: faseDaPeca({ etapa: item ? item.etapa : undefined, data: data || undefined }, campanha.periodo_inicio, campanha.periodo_fim),
      data,
      capa: p.capa,
      laminas: p.laminas,
      legenda: txt(t.legenda) || (item ? txt(item.copy) : ""),
      criativo_id: criativoDe(t.id),
    });
  });
  sequencias.forEach((s) => {
    const daSequencia = stories.filter((x) => x.sequencia_id === s.id).sort((a, b) => a.ordem - b.ordem);
    const gerados = daSequencia.filter((x) => x.fundo && x.fundo.tipo === "gerada" && !!x.fundo.trabalho_id);
    const ids = gerados.map((x) => String(x.fundo.trabalho_id)).filter((id, i, l) => l.indexOf(id) === i);
    ids.forEach((trabalhoId) => {
      const telas = gerados.filter((x) => x.fundo.trabalho_id === trabalhoId);
      if (!telas.length || !telas.every((x) => !!x.fundo.caminho)) return;
      const vinculo = s.campanha || null;
      const data = s.data || null;
      pecas.push({
        chave: `${s.id}:${trabalhoId}`,
        trabalho_id: trabalhoId,
        tipo: "stories",
        formato: "stories_9x16",
        titulo: s.titulo || "Sequência de stories",
        tema_id: vinculo ? vinculo.tema_id : null,
        sequencia_id: s.id,
        fase: (vinculo && vinculo.fase) || faseDaPeca({ data: data || undefined }, campanha.periodo_inicio, campanha.periodo_fim),
        data,
        capa: telas[0].fundo.caminho || null,
        laminas: telas.length,
        legenda: telas.map((x) => x.texto_na_tela).filter(Boolean).join("\n"),
        criativo_id: criativoDe(trabalhoId),
      });
    });
  });
  return pecas.sort((a, b) => (a.data || "9999").localeCompare(b.data || "9999"));
}

export function normalizarCampanha(c: Record<string, any>): CampanhaDaMesaAds {
  const b = obj(c.briefing);
  return {
    id: String(c.id),
    nome: txt(c.nome) || "Campanha",
    periodo_inicio: txt(c.periodo_inicio) || null,
    periodo_fim: txt(c.periodo_fim) || null,
    proposta_id: txt(c.proposta_id) || null,
    oferta: txt(b.oferta),
    cta: txt(b.cta),
  };
}

/** A campanha, as peças prontas e quais já são criativos. Leituras diretas (RLS da equipe) e os stories pela função deles. */
export async function lerPecasDaCampanhaMesa(clientId: string, campanhaId: string): Promise<{ campanha: CampanhaDaMesaAds | null; pecas: PecaDaCampanhaAds[]; avisoDosStories: string | null }> {
  const { data: linha, error } = await sb().from("mesa_campanhas").select("id, nome, periodo_inicio, periodo_fim, proposta_id, briefing").eq("client_id", clientId).eq("id", campanhaId).maybeSingle();
  if (error) throw error;
  if (!linha) return { campanha: null, pecas: [], avisoDosStories: null };
  const campanha = normalizarCampanha(linha);
  const [trabalhos, proposta, criativos, stories] = await Promise.all([
    sb()
      .from("estudio_trabalhos")
      .select("id, status, direcao, cards, legenda, atualizado_em")
      .eq("client_id", clientId)
      .eq("direcao->arte_rapida->>campanha_id", campanhaId)
      .order("atualizado_em", { ascending: true })
      .limit(60),
    campanha.proposta_id ? sb().from("calendario_propostas").select("id, itens").eq("id", campanha.proposta_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sb().from("ads_criativos").select("id, trabalho_id").eq("client_id", clientId).not("trabalho_id", "is", null).limit(300),
    // Sem a aba Stories no ar (ou sem tabela): as artes seguem, com aviso.
    lerStoriesDaCampanha(clientId, campanhaId).then(
      (r) => ({ ...r, aviso: null as string | null }),
      () => ({ sequencias: [] as Sequencia[], stories: [] as Story[], aviso: "Os stories da campanha não foram lidos agora." }),
    ),
  ]);
  if (trabalhos.error) throw trabalhos.error;
  if (criativos.error) throw criativos.error;
  const itens = proposta && proposta.data && Array.isArray(proposta.data.itens) ? (proposta.data.itens as ItemDaSerie[]) : [];
  const pecas = montarPecas(campanha, (trabalhos.data || []) as TrabalhoLido[], itens, stories.sequencias, stories.stories, (criativos.data || []) as Pick<CriativoAds, "id" | "trabalho_id">[]);
  return { campanha, pecas, avisoDosStories: stories.aviso };
}

/** As campanhas do cliente com peças de arte prontas (o seletor "Puxar de uma campanha"). */
export async function lerCampanhasComPecas(clientId: string): Promise<CampanhaComPecas[]> {
  const [campanhas, trabalhos] = await Promise.all([
    sb().from("mesa_campanhas").select("id, nome, criado_em").eq("client_id", clientId).order("criado_em", { ascending: false }).limit(60),
    sb()
      .from("estudio_trabalhos")
      .select("id, direcao, cards")
      .eq("client_id", clientId)
      .not("direcao->arte_rapida->>campanha_id", "is", null)
      .order("atualizado_em", { ascending: false })
      .limit(300),
  ]);
  if (campanhas.error) throw campanhas.error;
  if (trabalhos.error) throw trabalhos.error;
  return contarProntasPorCampanha((campanhas.data || []) as { id: string; nome: string }[], (trabalhos.data || []) as TrabalhoLido[]);
}

/** Função pura: as campanhas com ao menos uma peça pronta e quantas. */
export function contarProntasPorCampanha(campanhas: { id: string; nome: string }[], trabalhos: TrabalhoLido[]): CampanhaComPecas[] {
  const prontas: Record<string, number> = {};
  trabalhos.forEach((t) => {
    const a = arteRapidaDa(t.direcao);
    if (!a || !a.campanha_id || !artePronta(t)) return;
    const id = a.campanha_id.toLowerCase();
    prontas[id] = (prontas[id] || 0) + 1;
  });
  return campanhas
    .map((c) => ({ id: String(c.id), nome: txt(c.nome) || "Campanha", prontas: prontas[String(c.id).toLowerCase()] || 0 }))
    .filter((c) => c.prontas > 0);
}

/** Pedido de "Usar como criativo": o servidor confere o vínculo de cada peça com a campanha e não duplica. */
export function corpoDoUsar(clientId: string, campanhaId: string, pecas: PecaDaCampanhaAds[]): Record<string, unknown> {
  return {
    client_id: clientId,
    campanha_id: campanhaId,
    pecas: pecas.slice(0, 20).map((p) => ({
      trabalho_id: p.trabalho_id,
      formato: p.formato,
      titulo: p.titulo.slice(0, 120),
      tema_id: p.tema_id,
      sequencia_id: p.sequencia_id,
      fase: p.fase,
      data: p.data,
    })),
  };
}

export interface RespostaDoUsar {
  criativos: CriativoAds[];
  ja_existiam: string[];
  custo_usd: number;
}

export const usarComoCriativos = (clientId: string, campanhaId: string, pecas: PecaDaCampanhaAds[]) =>
  chamarAds<RespostaDoUsar>("criativos_da_campanha_mesa", corpoDoUsar(clientId, campanhaId, pecas));

/** A campanha da Mesa de onde o criativo veio (copy.campanha_mesa), ou null. */
export function campanhaDoCriativo(c: Pick<CriativoAds, "copy">): { id: string; nome: string; fase: string | null; data: string | null } | null {
  const copy = obj(c.copy);
  const v = obj(copy.campanha_mesa);
  const id = txt(copy.campanha_mesa_id) || txt(v.id);
  if (!id) return null;
  return { id, nome: txt(v.nome) || "Campanha", fase: txt(v.fase) || null, data: txt(v.data) || null };
}

/** "Lançamento · 24/11". */
export function faseEData(fase: FaseDaCampanha | string | null, data: string | null): string {
  const f = fase ? rotuloDaFase(fase as FaseDaCampanha) : "";
  const d = data && /^\d{4}-\d{2}-\d{2}/.test(data) ? `${data.slice(8, 10)}/${data.slice(5, 7)}` : "";
  return [f, d].filter(Boolean).join(" · ");
}
