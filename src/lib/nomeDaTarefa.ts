/**
 * Nome de tarefa para gente (26/10/2026, dono: "o nome ACE com número é
 * confuso: marcação por departamento, por cliente, um registro mais claro").
 *
 * Toda tarefa aparece como "Cliente · Área · assunto". O código do Paperclip
 * (ACE-275), id e hash saem do nome e ficam em `codigo`, para o detalhe.
 *
 * Os títulos reais chegam assim (medido no banco em 26/10):
 *   "ACE-275 | Meta: arquivar anúncio com erro 2016153"
 *   "Softy — retomar mensagens e continuidade sem término"
 *   "Doces em Ordem | Copy de landing page e checkout"
 *   "Diagnosticar e corrigir os erros recorrentes"
 * e a área do agente é "Paperclip" ou "Core" (plataforma, não departamento),
 * por isso a área sai do tipo de entrega, do assunto ou do nome do agente.
 *
 * Puro, sem lookbehind nem \p{} (Safari 11).
 */

export interface EntradaDoNome {
  titulo?: string | null;
  /** Nome do cliente (projeto → cliente). */
  cliente?: string | null;
  /** tasks.delivery_type */
  tipoDeEntrega?: string | null;
  /** Área do agente (só vale quando é departamento de verdade). */
  areaDoAgente?: string | null;
  /** Nome do agente (ex.: "Gestor de Tráfego Sênior") ajuda a achar a área. */
  agente?: string | null;
}

export interface NomeDaTarefa {
  cliente: string;
  area: string;
  assunto: string;
  /** Código técnico tirado do título (ACE-275), para o detalhe. */
  codigo: string | null;
  /** "Cliente · Área · assunto" */
  texto: string;
  /** "Área · assunto" (onde o cliente já aparece ao lado, como na mesa). */
  semCliente: string;
}

export const AREAS = ["Tráfego", "Conteúdo", "Design", "Vídeo", "Site", "Atendimento", "Relatório", "Comercial", "Operação"] as const;
export type AreaDaTarefa = (typeof AREAS)[number];

const CLIENTE_DA_CASA = "Aceleriq";

/** Áreas de agente que são plataforma, não departamento. */
const AREA_DE_PLATAFORMA = /^(paperclip|core|hermes|sem [aá]rea|sem [aá]rea definida|geral|agentes?)$/i;

const POR_TIPO_DE_ENTREGA: Record<string, AreaDaTarefa> = {
  traffic: "Tráfego",
  ads: "Tráfego",
  trafego: "Tráfego",
  copywriting: "Conteúdo",
  copy: "Conteúdo",
  content: "Conteúdo",
  social: "Conteúdo",
  post: "Conteúdo",
  carousel: "Conteúdo",
  design: "Design",
  art: "Design",
  video: "Vídeo",
  reels: "Vídeo",
  site: "Site",
  website: "Site",
  landing: "Site",
  report: "Relatório",
  relatorio: "Relatório",
  support: "Atendimento",
  commercial: "Comercial",
};

/** Palavras do assunto → área. A primeira que casar vence (tráfego antes: "Meta" decide). */
const POR_ASSUNTO: Array<[AreaDaTarefa, RegExp]> = [
  ["Tráfego", /\b(meta|ads|an[uú]ncios?|campanhas?|tr[aá]fego|bm|pixel|verba|boletins?|eventos?|conjuntos?|google ads|cpa|cpm|roas|saldo)\b/i],
  ["Site", /\b(site|landing|checkout|dom[ií]nio|wordpress|p[aá]gina de vendas)\b/i],
  ["Vídeo", /\b(v[ií]deos?|reels?|edi[cç][aã]o|roteiros?)\b/i],
  ["Design", /\b(arte|artes|logo|identidade|mockups?|design)\b/i],
  ["Conteúdo", /\b(posts?|carross[eé]is|carrossel|stories|story|legendas?|criativos?|copy|conte[uú]do|calend[aá]rio|pautas?)\b/i],
  ["Atendimento", /\b(whatsapp|grupo do cliente|rituais?|atendimento|onboarding)\b/i],
  ["Relatório", /\b(relat[oó]rios?|m[eé]tricas)\b|\bdossi[eê]/i],
  ["Comercial", /\b(leads?|proposta|comercial|crm|prospec[cç][aã]o)\b/i],
];

const POR_AGENTE: Array<[AreaDaTarefa, RegExp]> = [
  ["Tráfego", /tr[aá]fego|m[ií]dia|ads/i],
  ["Conteúdo", /conte[uú]do|copy|roteir|social/i],
  ["Design", /design|arte/i],
  ["Vídeo", /v[ií]deo|edi[cç]/i],
  ["Relatório", /dados|analista|relat/i],
  ["Comercial", /comercial|vendas|merc[uú]rio/i],
];

/** Código do Paperclip e parecidos: ACE-275, ACQ-12. */
const CODIGO = /\b[A-Z]{2,5}-\d{1,6}\b/;
const CODIGO_GLOBAL = /\[?\(?\b[A-Z]{2,5}-\d{1,6}\b\)?\]?/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HASH_SOLTO = /\b[0-9a-f]{12,}\b/gi;
const SEPARADORES = /^[\s|·:—–\-]+|[\s|·:—–\-]+$/g;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function mesmoCliente(prefixo: string, cliente: string): boolean {
  const a = semAcento(prefixo);
  const b = semAcento(cliente);
  if (!a || !b) return false;
  if (a === b || b.indexOf(a) === 0 || a.indexOf(b) === 0) return true;
  // "Casa" de "Casa dos Assados", "Softy" de "Softy Móveis": a primeira palavra basta.
  return a.split(/\s+/)[0] === b.split(/\s+/)[0] && a.split(/\s+/)[0].length >= 3;
}

function maiuscula(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function areaDoAssunto(texto: string): AreaDaTarefa | null {
  for (const [area, re] of POR_ASSUNTO) if (re.test(texto)) return area;
  return null;
}

/** Nome do cliente para a tela: a própria agência vira "Aceleriq"; sem cliente, também. */
export function nomeDoCliente(cliente?: string | null): string {
  const c = String(cliente || "").trim();
  if (!c || /^acelerI?q$/i.test(c.replace(/\s+/g, ""))) return CLIENTE_DA_CASA;
  return c;
}

export function nomeDaTarefa(e: EntradaDoNome): NomeDaTarefa {
  const bruto = String(e.titulo || "").trim();
  const achado = bruto.match(CODIGO);
  const codigo = achado ? achado[0] : null;
  let resto = bruto.replace(CODIGO_GLOBAL, " ").replace(UUID, " ").replace(HASH_SOLTO, " ").replace(/\s{2,}/g, " ").replace(SEPARADORES, "");

  const cliente = nomeDoCliente(e.cliente);
  let dicaDeArea: AreaDaTarefa | null = null;

  // Prefixo "X — resto" / "X | resto" / "X: resto": se X é o cliente, sai; se X diz a área ("Meta"), vira dica.
  for (let i = 0; i < 2; i += 1) {
    const m = resto.match(/^([^|:—–·]{1,40}?)\s*(?:\||:|—|–|·|\s-\s)\s*(.+)$/);
    if (!m) break;
    const prefixo = m[1].trim();
    const depois = m[2].trim();
    if (!depois || prefixo.split(/\s+/).length > 4) break;
    if (mesmoCliente(prefixo, cliente) || (e.cliente && mesmoCliente(prefixo, e.cliente))) { resto = depois; continue; }
    // Já vem no formato novo ("Cliente · Operação · assunto"): a área nomeada vale como está.
    const nomeada = AREAS.find((a) => semAcento(a) === semAcento(prefixo)) || null;
    const area = nomeada || areaDoAssunto(prefixo);
    if (area && prefixo.split(/\s+/).length <= 2) { dicaDeArea = area; resto = depois; continue; }
    break;
  }
  resto = resto.replace(SEPARADORES, "").trim();

  const tipo = semAcento(String(e.tipoDeEntrega || ""));
  const areaDoAgente = String(e.areaDoAgente || "").trim();
  let area: string | null = POR_TIPO_DE_ENTREGA[tipo] || dicaDeArea || areaDoAssunto(resto);
  if (!area && areaDoAgente && !AREA_DE_PLATAFORMA.test(areaDoAgente)) area = areaDoAgente;
  if (!area && e.agente) for (const [a, re] of POR_AGENTE) if (re.test(e.agente)) { area = a; break; }
  if (!area) area = "Operação";

  const assunto = maiuscula(resto) || (codigo ? "Tarefa sem título" : "Sem título");
  return {
    cliente,
    area,
    assunto,
    codigo,
    texto: `${cliente} · ${area} · ${assunto}`,
    semCliente: `${area} · ${assunto}`,
  };
}

/** Atalho para a tarefa do banco (tasks + projects + cliente), como as telas leem. */
export function nomeDaTarefaDoBanco(
  t: { title?: string | null; delivery_type?: string | null; project?: { client?: { company_name?: string | null; full_name?: string | null } | null } | null } | null | undefined,
  extra?: { textoSemTarefa?: string | null; agente?: string | null; areaDoAgente?: string | null },
): NomeDaTarefa {
  const c = t?.project?.client;
  return nomeDaTarefa({
    titulo: t?.title || extra?.textoSemTarefa || "",
    cliente: c ? c.company_name || c.full_name : null,
    tipoDeEntrega: t?.delivery_type,
    agente: extra?.agente,
    areaDoAgente: extra?.areaDoAgente,
  });
}
