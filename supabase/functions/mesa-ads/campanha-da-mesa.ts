/**
 * Peças prontas de uma campanha da Mesa como criativos da Mesa Ads (22/10/2026). Regras puras, sem banco
 * e sem IA: a action criativos_da_campanha_mesa (index.ts) lê, confere o vínculo e grava; aqui só a forma
 * do criativo e da copy de partida. O criativo aponta para o MESMO trabalho do Estúdio (nenhum arquivo é
 * copiado) e guarda copy.campanha_mesa_id e copy.campanha_mesa (nome, fase, data, oferta, CTA e a copy da
 * peça) para a etiqueta "Da campanha X" e para o copy_variar partir da peça e do briefing.
 */
import { CTAS_META } from "../_shared/conhecimento-ads.ts";

export const FORMATOS_DA_PECA = ["feed_4x5", "quadrado_1x1", "stories_9x16", "carrossel"] as const;
export type FormatoDaPeca = (typeof FORMATOS_DA_PECA)[number];

export const MAX_PECAS_POR_VEZ = 20;

const limpo = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").replace(/\s*[—–]\s*/g, ", ").trim().slice(0, max) : "";

/** Corta na última palavra inteira que cabe (sem reticências: a equipe ajusta na tela). */
export function cortarNaPalavra(t: string, max: number): string {
  const s = t.trim();
  if (s.length <= max) return s;
  const corte = s.slice(0, max + 1);
  const i = corte.lastIndexOf(" ");
  return (i > max * 0.5 ? corte.slice(0, i) : s.slice(0, max)).replace(/[\s,;:.-]+$/, "");
}

/** A primeira frase (ou o começo) que cabe nos 125 caracteres visíveis. */
export function textoVisivel(legenda: string): string {
  const s = legenda.replace(/\s+/g, " ").trim();
  if (s.length <= 125) return s;
  const frases = (s.match(/[^.!?]+[.!?]*/g) || [s]).map((f) => f.trim()).filter(Boolean);
  let saida = "";
  for (const f of frases) {
    const junto = saida ? `${saida} ${f}` : f;
    if (junto.length > 125) break;
    saida = junto;
  }
  return saida || cortarNaPalavra(s, 125);
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O CTA do briefing da campanha ("Chama no WhatsApp", "Compre agora") no botão da Meta (lista da casa). */
export function ctaDoBriefing(cta: string): (typeof CTAS_META)[number] {
  const c = semAcento(cta || "");
  if (/whats|zap|direct|mensag|chama|conversa|dm\b/.test(c)) return "Enviar mensagem";
  if (/compr|garant|adquir|loja|carrinho/.test(c)) return "Comprar agora";
  if (/agend|marc|reserv|horario/.test(c)) return "Agendar";
  if (/orcament|cotac/.test(c)) return "Solicitar orçamento";
  if (/cadastr|inscrev|lista|grupo|vip/.test(c)) return "Cadastre-se";
  if (/lig(ue|ar)|telefon/.test(c)) return "Ligar agora";
  if (/cardapio|menu/.test(c)) return "Ver menu";
  if (/cupom|desconto|oferta|promo/.test(c)) return "Obter oferta";
  if (/fale|contato/.test(c)) return "Fale conosco";
  return "Saiba mais";
}

export interface PecaPedida {
  trabalho_id: string;
  formato: FormatoDaPeca;
  titulo: string;
  tema_id: string | null;
  sequencia_id: string | null;
  fase: string | null;
  data: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FASES = ["aquecimento", "lancamento", "urgencia", "encerramento"];

/** As peças do corpo, em forma fixa (sem repetição de trabalho, no máximo 20). */
export function pecasDoCorpo(v: unknown): PecaPedida[] {
  const saida: PecaPedida[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.trabalho_id === "string" && UUID.test(o.trabalho_id) ? o.trabalho_id : "";
    if (!id || saida.some((p) => p.trabalho_id === id)) continue;
    const formato = (FORMATOS_DA_PECA as readonly string[]).indexOf(String(o.formato)) >= 0 ? (o.formato as FormatoDaPeca) : "feed_4x5";
    saida.push({
      trabalho_id: id,
      formato,
      titulo: limpo(o.titulo, 120),
      tema_id: limpo(o.tema_id, 40) || null,
      sequencia_id: typeof o.sequencia_id === "string" && UUID.test(o.sequencia_id) ? o.sequencia_id : null,
      fase: FASES.indexOf(String(o.fase)) >= 0 ? String(o.fase) : null,
      data: typeof o.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.data) ? o.data : null,
    });
    if (saida.length >= MAX_PECAS_POR_VEZ) break;
  }
  return saida;
}

export interface CampanhaDaMesa {
  id: string;
  nome: string;
  briefing: Record<string, unknown> | null;
}

/** O formato que vale: stories só para a peça de sequência; carrossel só com mais de uma lâmina. */
export function formatoDaPeca(p: PecaPedida, laminas: number): FormatoDaPeca {
  if (p.sequencia_id) return "stories_9x16";
  if (p.formato === "stories_9x16") return "feed_4x5";
  if (p.formato === "carrossel" && laminas < 2) return "feed_4x5";
  if (p.formato !== "carrossel" && laminas > 1) return "carrossel";
  return p.formato;
}

/** O criativo a gravar (ads_criativos) para a peça: copy de partida da legenda e do briefing, sem IA. */
export function criativoDaPeca(
  campanha: CampanhaDaMesa,
  p: PecaPedida,
  trabalho: { legenda: string | null; titulo: string | null; laminas: number },
  clientId: string,
  criadoPor: string,
): Record<string, unknown> {
  const b = campanha.briefing && typeof campanha.briefing === "object" ? campanha.briefing : {};
  const oferta = limpo(b.oferta, 400);
  const cta = limpo(b.cta, 200);
  const legenda = typeof trabalho.legenda === "string" ? trabalho.legenda.trim().slice(0, 2200) : "";
  const tituloDaPeca = p.titulo || limpo(trabalho.titulo, 120) || "Peça";
  const visivel = textoVisivel(legenda || [limpo(b.mensagem_central, 300), oferta].filter(Boolean).join(". "));
  return {
    client_id: clientId,
    plano_id: null,
    angulo_id: null,
    trabalho_id: p.trabalho_id,
    nome: cortarNaPalavra(`${campanha.nome} · ${tituloDaPeca}`, 140),
    formato: formatoDaPeca(p, trabalho.laminas),
    status: "rascunho",
    evidencia: "E0",
    criado_por: criadoPor,
    copy: {
      texto_principal: visivel,
      texto_principal_longo: legenda && legenda !== visivel ? legenda : "",
      titulo: cortarNaPalavra(limpo(trabalho.titulo, 200) || tituloDaPeca, 40),
      descricao: oferta && oferta.length <= 30 ? oferta : "",
      cta_meta: ctaDoBriefing(cta),
      campanha_mesa_id: campanha.id,
      campanha_mesa: {
        id: campanha.id,
        nome: limpo(campanha.nome, 120) || "Campanha",
        tema_id: p.tema_id,
        sequencia_id: p.sequencia_id,
        fase: p.fase,
        data: p.data,
        oferta,
        cta,
        copy_da_peca: legenda.slice(0, 1500),
        usado_em: new Date().toISOString(),
      },
    },
  };
}

/** O bloco do prompt do copy_variar quando o criativo veio de uma campanha da Mesa. */
export function blocoDaCampanhaDaMesa(copy: Record<string, unknown>, briefingAtual: Record<string, unknown> | null): string {
  const v = copy.campanha_mesa && typeof copy.campanha_mesa === "object" ? (copy.campanha_mesa as Record<string, unknown>) : null;
  if (!v) return "";
  const b = briefingAtual ?? {};
  const linha = (rotulo: string, valor: unknown, max = 600) => {
    const t = limpo(valor, max);
    return t ? `- ${rotulo}: ${t}` : "";
  };
  const partes = [
    `PEÇA DA CAMPANHA DA MESA "${limpo(v.nome, 120)}" (o anúncio parte desta peça e do briefing da campanha; mantenha a oferta e o CTA):`,
    linha("Fase", v.fase, 40),
    linha("Oferta", b.oferta ?? v.oferta),
    linha("CTA da campanha", b.cta ?? v.cta, 200),
    linha("Mensagem central", b.mensagem_central),
    linha("Público", b.publico, 400),
    linha("Copy da peça", v.copy_da_peca, 1500),
  ].filter(Boolean);
  return partes.length > 1 ? partes.join("\n") : "";
}
