/**
 * Contrato do RETORNO do agente externo (pacote de otimização da Mesa Ads,
 * pedido do dono em 26/09/2026): o agente externo lê o pacote e devolve os
 * criativos neste formato; a Mesa Ads valida, mostra o que entendeu e cria os
 * criativos num plano para o Estúdio Ads produzir.
 *
 * Puro (sem Deno), testado no Vitest. O LEIA-ME do pacote (front,
 * src/components/mesa-ads/pacoteOtimizacao.ts) documenta o mesmo contrato.
 * O que não se entende é recusado com o motivo; nada é inventado.
 */
import { CTAS_META, ESTILOS_VISUAIS_IDS } from "../_shared/conhecimento-ads.ts";
import { cortarNaPalavra, semTravessao } from "./calculos.ts";

export const FORMATO_DO_RETORNO = "mesa-ads-retorno";
export const VERSAO_DO_RETORNO = 1;
export const MAX_CRIATIVOS_IMPORTADOS = 12;

const OBJETIVOS = ["vendas", "mensagens", "leads", "seguidores", "agendamento", "trafego", "reconhecimento"] as const;
const FORMATOS = ["feed_4x5", "quadrado_1x1", "stories_9x16", "carrossel"] as const;
type Formato = (typeof FORMATOS)[number];

/** Apelidos que o agente externo costuma usar para o formato. */
const APELIDOS_DO_FORMATO: Record<string, Formato> = {
  feed_4x5: "feed_4x5", "4x5": "feed_4x5", "4:5": "feed_4x5", feed: "feed_4x5", retrato: "feed_4x5",
  quadrado_1x1: "quadrado_1x1", "1x1": "quadrado_1x1", "1:1": "quadrado_1x1", quadrado: "quadrado_1x1",
  stories_9x16: "stories_9x16", "9x16": "stories_9x16", "9:16": "stories_9x16", stories: "stories_9x16", story: "stories_9x16", reels: "stories_9x16",
  carrossel: "carrossel", carousel: "carrossel",
};

/** Botão padrão quando o retorno não traz um válido, pelo objetivo. */
const CTA_DO_OBJETIVO: Record<string, string> = {
  mensagens: "Enviar mensagem", vendas: "Comprar agora", leads: "Cadastre-se", agendamento: "Agendar", trafego: "Saiba mais", reconhecimento: "Saiba mais", seguidores: "Saiba mais",
};

export type CriativoImportado = {
  titulo: string;
  angulo: string;
  hipotese: string;
  objetivo: string | null;
  formato: Formato;
  estilo_visual: string | null;
  gancho_visual: string;
  headline_arte: string;
  apoio_arte: string | null;
  cta_arte: string;
  texto_principal: string;
  texto_principal_longo: string;
  titulo_anuncio: string;
  descricao: string | null;
  cta_meta: string;
  carrossel: { texto: string; ilustracao: string }[] | null;
  base_ad_id: string | null;
  avisos: string[];
};

export type RetornoValidado = {
  plano: { nome: string; objetivo: string | null; resumo: string };
  aceitos: CriativoImportado[];
  recusados: { indice: number; titulo: string; motivos: string[] }[];
  avisos: string[];
};

const t = (v: unknown, max = 2000) => (typeof v === "string" ? semTravessao(v.replace(/\r\n/g, "\n").trim()).slice(0, max) : typeof v === "number" ? String(v) : "");
const primeiro = (o: Record<string, unknown>, chaves: string[], max = 2000) => {
  for (const k of chaves) {
    const v = t(o[k], max);
    if (v) return v;
  }
  return "";
};

/** Normaliza texto para comparar enum (minúsculo, sem acento). */
const chave = (v: unknown) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function objetivoDe(v: unknown): string | null {
  const k = chave(v).replace(/\s+/g, "_");
  if ((OBJETIVOS as readonly string[]).indexOf(k) >= 0) return k;
  const apelidos: Record<string, string> = { mensagem: "mensagens", whatsapp: "mensagens", conversas: "mensagens", venda: "vendas", compras: "vendas", cadastro: "leads", cadastros: "leads", lead: "leads", trafego_no_site: "trafego", alcance: "reconhecimento" };
  return apelidos[k] ?? null;
}

function ctaDe(v: unknown): string | null {
  const k = chave(v);
  const achado = (CTAS_META as readonly string[]).find((c) => chave(c) === k);
  return achado ?? null;
}

/**
 * Valida o retorno do agente externo. Aceita o objeto do contrato ou uma
 * lista de criativos direto. Cada criativo precisa de: título, ângulo, gancho
 * visual, frase da arte, texto principal, título do anúncio e formato
 * conhecido. O resto é opcional com padrão honesto (sem inventar prova).
 */
export function validarRetorno(bruto: unknown, adsConhecidos: Set<string> = new Set()): RetornoValidado {
  const raiz = (Array.isArray(bruto) ? { criativos: bruto } : bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const avisos: string[] = [];
  if (raiz.formato && raiz.formato !== FORMATO_DO_RETORNO) avisos.push(`O campo formato diz "${t(raiz.formato, 60)}"; o esperado é "${FORMATO_DO_RETORNO}". Li mesmo assim.`);
  if (raiz.versao != null && Number(raiz.versao) !== VERSAO_DO_RETORNO) avisos.push(`Versão ${t(raiz.versao, 10)} do contrato; esta Mesa Ads lê a versão ${VERSAO_DO_RETORNO}.`);
  const p = (raiz.plano && typeof raiz.plano === "object" ? raiz.plano : {}) as Record<string, unknown>;
  const plano = { nome: t(p.nome, 120), objetivo: objetivoDe(p.objetivo), resumo: t(p.resumo, 3000) };
  const lista = Array.isArray(raiz.criativos) ? raiz.criativos : [];
  if (!lista.length) avisos.push("Nenhum criativo encontrado. O retorno precisa de uma lista em \"criativos\".");
  const aceitos: CriativoImportado[] = [];
  const recusados: RetornoValidado["recusados"] = [];
  lista.forEach((item, i) => {
    const o = (item && typeof item === "object" && !Array.isArray(item) ? item : {}) as Record<string, unknown>;
    const titulo = primeiro(o, ["titulo", "nome", "title"], 160);
    const motivos: string[] = [];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      recusados.push({ indice: i + 1, titulo: "", motivos: ["não é um objeto com os campos do criativo"] });
      return;
    }
    const formatoBruto = chave(o.formato);
    const formato = APELIDOS_DO_FORMATO[formatoBruto] ?? null;
    const angulo = primeiro(o, ["angulo", "ângulo", "ideia"], 800);
    const ganchoVisual = primeiro(o, ["gancho_visual", "brief_da_arte", "brief", "imagem"], 900);
    const headline = primeiro(o, ["headline_arte", "frase_da_arte", "headline"], 160);
    const textoPrincipal = primeiro(o, ["texto_principal", "copy", "texto"], 400);
    const tituloAnuncio = primeiro(o, ["titulo_anuncio", "titulo_do_anuncio", "headline_meta"], 200);
    if (!titulo) motivos.push("sem título");
    if (!angulo) motivos.push("sem ângulo");
    if (!ganchoVisual) motivos.push("sem gancho visual (o que a imagem mostra)");
    if (!headline) motivos.push("sem frase da arte (headline_arte)");
    if (!textoPrincipal) motivos.push("sem texto principal");
    if (!tituloAnuncio) motivos.push("sem título do anúncio (titulo_anuncio)");
    if (!formato) motivos.push(formatoBruto ? `formato "${t(o.formato, 30)}" desconhecido (use feed_4x5, quadrado_1x1, stories_9x16 ou carrossel)` : "sem formato");
    if (motivos.length) {
      recusados.push({ indice: i + 1, titulo, motivos });
      return;
    }
    if (aceitos.length >= MAX_CRIATIVOS_IMPORTADOS) {
      recusados.push({ indice: i + 1, titulo, motivos: [`passou do limite de ${MAX_CRIATIVOS_IMPORTADOS} criativos por importação`] });
      return;
    }
    const av: string[] = [];
    const objetivo = objetivoDe(o.objetivo) ?? plano.objetivo;
    if (o.objetivo && !objetivoDe(o.objetivo)) av.push(`objetivo "${t(o.objetivo, 40)}" desconhecido: ficou o do plano`);
    const estilo = (ESTILOS_VISUAIS_IDS as readonly string[]).indexOf(chave(o.estilo_visual)) >= 0 ? chave(o.estilo_visual) : null;
    if (o.estilo_visual && !estilo) av.push(`estilo visual "${t(o.estilo_visual, 40)}" desconhecido: o Estúdio escolhe pela direção`);
    const cta = ctaDe(o.cta_meta);
    if (o.cta_meta && !cta) av.push(`botão "${t(o.cta_meta, 40)}" não existe na Meta: usei o do objetivo`);
    const tituloCortado = cortarNaPalavra(tituloAnuncio, 40);
    if (tituloCortado.length < tituloAnuncio.length) av.push("título do anúncio cortado em 40 caracteres");
    if (textoPrincipal.length > 125) av.push(`texto principal com ${textoPrincipal.length} caracteres: só cerca de 125 aparecem antes do "ver mais"`);
    const descricao = t(o.descricao, 120) || null;
    const cartoes = (Array.isArray(o.carrossel) ? o.carrossel : [])
      .map((c) => {
        const x = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
        return { texto: primeiro(x, ["texto", "texto_exato"], 400), ilustracao: primeiro(x, ["ilustracao", "imagem"], 500) };
      })
      .filter((c) => c.texto)
      .slice(0, 5);
    if (formato === "carrossel" && cartoes.length < 3) av.push("carrossel com menos de 3 cartões: a sequência mínima sai da própria copy");
    const base = t(o.base_ad_id, 40);
    aceitos.push({
      titulo,
      angulo,
      hipotese: primeiro(o, ["hipotese", "porque", "por_que"], 1200),
      objetivo,
      formato: formato as Formato,
      estilo_visual: estilo,
      gancho_visual: ganchoVisual,
      headline_arte: headline,
      apoio_arte: t(o.apoio_arte, 160) || null,
      cta_arte: t(o.cta_arte, 60) || (cta ?? (objetivo ? CTA_DO_OBJETIVO[objetivo] : "") ?? ""),
      texto_principal: textoPrincipal,
      texto_principal_longo: t(o.texto_principal_longo, 2200) || textoPrincipal,
      titulo_anuncio: tituloCortado,
      descricao,
      cta_meta: cta ?? (objetivo ? CTA_DO_OBJETIVO[objetivo] ?? "Saiba mais" : "Saiba mais"),
      carrossel: formato === "carrossel" ? cartoes : null,
      base_ad_id: base && adsConhecidos.has(base) ? base : null,
      avisos: av,
    });
  });
  return { plano, aceitos, recusados, avisos };
}
