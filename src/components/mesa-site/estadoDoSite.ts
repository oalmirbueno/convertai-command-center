import { mapaDoSite, type MapaDoSite, normalizarEstilo, secaoDaBiblioteca, secoesDoMapa, slotsDoMapa, slotsVazios } from "../../../supabase/functions/_shared/site-biblioteca";
import { checklistDeLancamento, type EstadoParaChecklist, type ItemDoChecklist, normalizarIntegracoes, normalizarSeo } from "../../../supabase/functions/_shared/site-lancamento";
import type { OpcaoDeCopy } from "../../../supabase/functions/_shared/site-metodo";
import type { LinhaDoSite } from "./siteApi";

/**
 * O estado do site só pela linha (UXS 30/09), sem chamada nova: a barra das
 * etapas e o checklist da Revisão usam a mesma montagem, então nunca
 * discordam. Puro (o vitest lê sem tela).
 */

/** A opção de conteúdo escolhida (conteudo.escolhida = índice em conteudo.opcoes). */
export function copyDaLinha(site: Pick<LinhaDoSite, "conteudo">): OpcaoDeCopy | null {
  const c = site.conteudo || {};
  const opcoes = Array.isArray(c.opcoes) ? (c.opcoes as OpcaoDeCopy[]) : [];
  const i = Number(c.escolhida);
  return typeof c.escolhida === "number" && Number.isInteger(i) && i >= 0 && i < opcoes.length ? opcoes[i] : null;
}

/** O mapa pede formulário ou mapa do Google em alguma seção (regra da biblioteca). */
export function usaNoMapa(mapa: MapaDoSite, t: "formulario" | "mapa"): boolean {
  return mapa.paginas.some((p) =>
    p.secoes.some((s) => {
      const lib = secaoDaBiblioteca(s.tipo);
      return !!(lib && lib.integra && lib.integra.indexOf(t) >= 0);
    }),
  );
}

/**
 * O estado do checklist a partir da linha. O que depende de trabalhos, kit ou
 * publicação vem em `extra`; sem ele, valores neutros (a barra descarta esses
 * itens pelo id).
 */
export function estadoDaLinha(site: LinhaDoSite, extra: Partial<EstadoParaChecklist> = {}): EstadoParaChecklist {
  const mapa = mapaDoSite(site);
  const secoes = secoesDoMapa(mapa);
  const seo = normalizarSeo(site.seo || {});
  const imagens = (site.imagens || []) as Array<{ slot: string; secao?: string | null; escolhida?: boolean; origem?: string }>;
  const copy = copyDaLinha(site);
  return {
    briefingSalvo: !!(site.briefing && (site.briefing.salvo_em || site.briefing.fonte === "brf")),
    temMapa: secoes.length > 0,
    secoes,
    construidas: [],
    preset: !!normalizarEstilo(site.estilo || {}).preset,
    copyEscolhida: typeof (site.conteudo || {}).escolhida === "number",
    slotsVazios: slotsVazios(slotsDoMapa(mapa, imagens)),
    buildOk: null,
    avisosDeQa: 0,
    seo,
    temOgImagem: !!seo.og_imagem || imagens.some((i) => i.slot === "hero" && i.escolhida !== false),
    temLogo: false,
    integracoes: normalizarIntegracoes(site.integracoes || {}),
    secoesComFormulario: usaNoMapa(mapa, "formulario"),
    secoesComMapa: usaNoMapa(mapa, "mapa"),
    dominio: null,
    dominioVerificado: false,
    construidoDepoisDasMudancas: true,
    seoDoConteudo: copy ? copy.seo : null,
    ...extra,
  };
}

/** Etapas da barra que levam contador (as outras dependem de trabalhos ou publicação). */
export const ETAPAS_COM_CONTADOR = ["briefing", "direcao", "conteudo", "imagens", "integracoes"];
/** Itens que dependem de trabalhos, kit ou publicação: fora da barra. */
const FORA_DA_BARRA = ["construido", "atualizado", "build", "qa", "logo", "dominio", "dns"];
/** O que leva o destaque de "próximo passo": o obrigatório e o briefing (estilo e imagens podem ficar de propósito). */
const PEDE_DESTAQUE = ["briefing", "mapa", "copy", "seo_titulo", "contato", "lgpd"];

export type PendenciasDasEtapas = {
  /** Itens não ok por etapa (só as etapas com contador). */
  contador: Record<string, number>;
  /** "Falta: ..." por etapa, com o detalhe do checklist. */
  dica: Record<string, string>;
  /** A primeira etapa, na ordem, com pendência que pede destaque (ou nenhuma). */
  destaque: string | null;
};

/** Pendências por etapa, com a mesma regra do checklist de lançamento. */
export function pendenciasDasEtapas(site: LinhaDoSite, ordem: string[]): PendenciasDasEtapas {
  const itens: ItemDoChecklist[] = checklistDeLancamento(estadoDaLinha(site)).filter((i) => FORA_DA_BARRA.indexOf(i.id) < 0);
  const contador: Record<string, number> = {};
  const dica: Record<string, string> = {};
  ETAPAS_COM_CONTADOR.forEach((e) => {
    const faltam = itens.filter((i) => i.etapa === e && !i.ok);
    if (!faltam.length) return;
    contador[e] = faltam.length;
    dica[e] = `Falta: ${faltam.map((i) => (i.detalhe ? `${i.rotulo} (${i.detalhe})` : i.rotulo)).join("; ")}`;
  });
  const destaque = ordem.find((e) => itens.some((i) => i.etapa === e && !i.ok && PEDE_DESTAQUE.indexOf(i.id) >= 0)) || null;
  return { contador, dica, destaque };
}
