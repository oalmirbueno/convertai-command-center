import type { CampoParaPreencher } from "@/components/sistema";
import { ehTipoDeSite, mapaDoSite, mapaPadrao, TIPOS_DE_SITE, type TipoDeSite } from "../../../supabase/functions/_shared/site-biblioteca";
import { NICHOS as NICHOS_DO_SITE } from "../../../supabase/functions/_shared/site-metodo";
import type { LinhaDoSite } from "./siteApi";

/**
 * "Preencher tudo" da Mesa Site (SIT2): os campos de texto do site inteiro
 * (briefing, tipo, observação da direção, SEO, dados do negócio e a mensagem
 * do WhatsApp) numa chamada só do Preencher com IA, a partir do contexto, do
 * briefing e do dossiê. A peça mostra a prévia; aqui só a montagem dos
 * campos e a volta para as ações da função mesa-site.
 */

export const PERGUNTAS_DO_BRIEFING_NA_TELA = [
  { id: "objetivo", rotulo: "O que o site precisa fazer acontecer", dica: "uma frase de resultado para o negócio" },
  { id: "publico", rotulo: "Para quem é", dica: "quem compra e o que procura" },
  { id: "oferta", rotulo: "O que o cliente vende ou oferece", dica: "serviços ou produtos principais, sem preço inventado" },
  { id: "diferenciais", rotulo: "Por que escolher o cliente", dica: "diferenciais concretos das fontes" },
  { id: "acao", rotulo: "Qual o próximo passo do visitante (WhatsApp, formulário, agenda)", dica: "o CTA principal" },
  { id: "referencias", rotulo: "Sites que o cliente admira", dica: "só endereços que aparecem nas fontes" },
  { id: "evitar", rotulo: "O que evitar", dica: "o que o cliente não quer ver" },
  { id: "dominio", rotulo: "Domínio (se já tiver)", dica: "só se estiver nas fontes; nunca inventar" },
];

const txt = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));

export function camposDoBriefing(perguntas: Array<{ id: string; rotulo: string }>, respostas: Record<string, string>): CampoParaPreencher[] {
  return perguntas.map((p) => {
    const conhecida = PERGUNTAS_DO_BRIEFING_NA_TELA.find((x) => x.id === p.id);
    return { chave: `briefing.${p.id}`, rotulo: p.rotulo, tipo: "texto_longo", valorAtual: respostas[p.id] || "", dica: conhecida ? conhecida.dica : undefined, maximo: 1500 };
  });
}

/** Os campos do site inteiro (Preencher tudo do site). */
export function camposDoSiteInteiro(site: LinhaDoSite, respostas: Record<string, string>): CampoParaPreencher[] {
  const seo = (site.seo || {}) as Record<string, any>;
  const negocio = (seo.negocio || {}) as Record<string, any>;
  const integracoes = (site.integracoes || {}) as Record<string, any>;
  const whatsapp = (integracoes.whatsapp || {}) as Record<string, any>;
  return [
    ...camposDoBriefing(PERGUNTAS_DO_BRIEFING_NA_TELA, respostas),
    { chave: "tipo", rotulo: "Tipo de site", tipo: "escolha", opcoes: TIPOS_DE_SITE.map((t) => t.id), valorAtual: site.tipo || "", dica: TIPOS_DE_SITE.map((t) => `${t.id}: ${t.descricao}`).join("; ") },
    { chave: "direcao.nicho", rotulo: "Nicho", tipo: "escolha", opcoes: NICHOS_DO_SITE.map((n) => n.id), valorAtual: (site.direcao && site.direcao.nicho) || "" },
    { chave: "direcao.observacao", rotulo: "Observação para o site", tipo: "texto_longo", valorAtual: (site.direcao && site.direcao.observacao) || "", dica: "o que o site deve priorizar ou evitar, em 1 a 3 frases", maximo: 1500 },
    { chave: "seo.titulo", rotulo: "Título de SEO", tipo: "texto", valorAtual: seo.titulo || "", dica: "até 60 caracteres, com o serviço e a cidade quando for negócio local", maximo: 60 },
    { chave: "seo.descricao", rotulo: "Descrição de SEO", tipo: "texto_longo", valorAtual: seo.descricao || "", dica: "de 120 a 155 caracteres, com o benefício e o próximo passo", maximo: 155 },
    { chave: "seo.negocio.nome", rotulo: "Nome do negócio", tipo: "texto", valorAtual: negocio.nome || "", maximo: 120 },
    { chave: "seo.negocio.telefone", rotulo: "Telefone do negócio", tipo: "texto", valorAtual: negocio.telefone || "", dica: "só se estiver nas fontes; nunca inventar número" },
    { chave: "seo.negocio.email", rotulo: "E-mail do negócio", tipo: "texto", valorAtual: negocio.email || "", dica: "só se estiver nas fontes" },
    { chave: "seo.negocio.cidade", rotulo: "Cidade", tipo: "texto", valorAtual: negocio.cidade || "", dica: "só se estiver nas fontes" },
    { chave: "integracoes.whatsapp.mensagem", rotulo: "Mensagem do WhatsApp", tipo: "texto", valorAtual: whatsapp.mensagem || "", dica: "a primeira mensagem que o visitante manda, até 120 caracteres", maximo: 120 },
  ];
}

/** Separa os valores aplicados por destino (cada um vira uma ação da função). */
export function destinosDosValores(valores: Record<string, unknown>) {
  const briefing: Record<string, string> = {};
  const direcao: Record<string, string> = {};
  const seo: Record<string, any> = {};
  const negocio: Record<string, any> = {};
  let whatsappMensagem: string | null = null;
  let tipo: TipoDeSite | null = null;
  Object.keys(valores).forEach((k) => {
    const v = valores[k];
    if (k.indexOf("briefing.") === 0) briefing[k.slice(9)] = txt(v);
    else if (k === "tipo" && ehTipoDeSite(v)) tipo = v;
    else if (k.indexOf("direcao.") === 0) direcao[k.slice(8)] = txt(v);
    else if (k.indexOf("seo.negocio.") === 0) negocio[k.slice(12)] = txt(v);
    else if (k.indexOf("seo.") === 0) seo[k.slice(4)] = txt(v);
    else if (k === "integracoes.whatsapp.mensagem") whatsappMensagem = txt(v);
  });
  if (Object.keys(negocio).length) seo.negocio = negocio;
  return { briefing, direcao, seo, tipo: tipo as TipoDeSite | null, whatsappMensagem: whatsappMensagem as string | null };
}

/** O mapa que o tipo aplicado leva: o padrão do tipo só quando o site ainda não tem mapa salvo. */
export function mapaDoTipoAplicado(site: LinhaDoSite, tipo: TipoDeSite) {
  const salvo = site.mapa && Array.isArray((site.mapa as { paginas?: unknown }).paginas) && (site.mapa as { paginas: unknown[] }).paginas.length > 0;
  return salvo ? { ...mapaDoSite(site), tipo } : mapaPadrao(tipo);
}
