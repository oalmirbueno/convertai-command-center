import { ROTULOS_DAS_AREAS, areaDaRota } from "@/lib/cronometro/motor";

/**
 * Lugares por onde a pessoa passou no painel (29/09, dono: "estou na Mesa, vou
 * ao Workspace e quero voltar direto para onde eu estava, sem procurar").
 * Um "lugar" é a tela com o que a torna aquela tela: rota, cliente e a aba ou
 * etapa. Trocar de filtro dentro do mesmo lugar só atualiza o endereço
 * guardado; não cria outro lugar.
 */

export interface Lugar {
  /** Endereço completo para voltar (rota + busca), como estava da última vez. */
  url: string;
  /** Identidade do lugar: rota + cliente + aba/etapa. */
  chave: string;
  /** Nome curto: "Mesa · Estúdio", "Workspace", "Agenda". */
  rotulo: string;
  /** Cliente do lugar, quando há (da URL ou do foco do cronômetro). */
  cliente: string | null;
  /** Quando a pessoa esteve lá pela última vez (ms). */
  em: number;
}

/** Telas que não viram "lugar" (entrada, públicas, raiz). */
const FORA = /^\/(login|redefinir-senha|primeiro-acesso|oauth|\.lovable|briefing\/|contrato\/|inbox\/|quiz\/|unsubscribe|conectar-mcp)/;

const OUTRAS_AREAS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/financeiro": "Financeiro",
  "/financeiro/projecao": "Projeção",
  "/comercial": "Comercial",
  "/horas": "Horas e custos",
  "/config": "Configurações",
  "/equipe": "Equipe",
  "/perfil": "Perfil",
  "/novidades": "Novidades",
  "/cofre": "Cofre",
  "/documentos": "Documentos",
  "/onde-estamos": "Onde estamos",
  "/api-docs": "API e integrações",
};

const ABAS_DA_MESA: Record<string, string> = {
  contexto: "Contexto",
  instagram: "Redes",
  redes: "Redes",
  mes: "Mês",
  campanhas: "Campanhas",
  estudio: "Estúdio",
  entrega: "Entrega",
};

const ETAPAS_DA_MESA_ADS: Record<string, string> = {
  oferta: "Oferta",
  referencias: "Referências",
  plano: "Plano de teste",
  estudio: "Estúdio Ads",
  conta: "Conta",
  resultados: "Resultados",
};

function capitalizar(s: string): string {
  const t = s.replace(/[-_]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function limparRota(pathname: string): string {
  return (pathname || "").replace(/\/+$/, "") || "/";
}

function lerBusca(search: string): URLSearchParams {
  try {
    return new URLSearchParams(search || "");
  } catch {
    return new URLSearchParams();
  }
}

/** Cliente pela URL (?client=, ?cliente= ou /clientes/<id>). */
export function clienteDaUrl(pathname: string, search: string): string | null {
  const q = lerBusca(search);
  const direto = q.get("client") || q.get("cliente");
  if (direto) return direto;
  const m = /^\/clientes\/([0-9a-f-]{36})/i.exec(pathname || "");
  return m ? m[1] : null;
}

/** Aba ou etapa que muda o lugar (a Mesa por aba, a Mesa Ads e as outras mesas por etapa). */
function subDoLugar(rota: string, q: URLSearchParams): string | null {
  if (rota === "/mesa") return q.get("aba");
  if (rota.indexOf("/mesa-") === 0) return q.get("etapa");
  if (rota === "/comercial") return null;
  return null;
}

/** Nome curto do lugar para o botão. */
export function rotuloDoLugar(pathname: string, search: string): string | null {
  const rota = limparRota(pathname);
  if (rota === "/" || FORA.test(rota)) return null;
  const area = areaDaRota(rota);
  let base = (area && ROTULOS_DAS_AREAS[area]) || OUTRAS_AREAS[rota] || null;
  if (!base) {
    if (rota.indexOf("/comercial/") === 0) base = "Comercial";
    else if (rota.indexOf("/relatorios/") === 0) base = "Relatório";
    else {
      const primeiro = rota.split("/")[1] || "";
      base = primeiro ? capitalizar(primeiro) : null;
    }
  }
  if (!base) return null;
  const q = lerBusca(search);
  const sub = subDoLugar(rota, q);
  if (!sub) return base;
  const nomeSub = rota === "/mesa" ? ABAS_DA_MESA[sub] : rota === "/mesa-ads" ? ETAPAS_DA_MESA_ADS[sub] : null;
  return `${base} · ${nomeSub || capitalizar(sub)}`;
}

/**
 * Identidade do lugar: rota + cliente DA URL + aba/etapa. O cliente em foco
 * (Central, Workspace) não entra: ele chega depois da tela carregar e o
 * endereço é o mesmo, então só serve para o nome (visto no teste de 29/09:
 * o Workspace virava dois lugares e o "anterior" apontava para ele mesmo).
 */
export function chaveDoLugar(pathname: string, search: string): string {
  const rota = limparRota(pathname);
  const q = lerBusca(search);
  const cliente = clienteDaUrl(pathname, search) || "";
  const sub = subDoLugar(rota, q) || "";
  return `${rota}|${cliente}|${sub}`;
}

/** Monta o lugar atual; null para telas que não contam (login, públicas, raiz). */
export function lugarAtual(pathname: string, search: string, clienteEmFoco: string | null, agora: number): Lugar | null {
  const rotulo = rotuloDoLugar(pathname, search);
  if (!rotulo) return null;
  const cliente = clienteDaUrl(pathname, search) || clienteEmFoco || null;
  return { url: `${limparRota(pathname)}${search || ""}`, chave: chaveDoLugar(pathname, search), rotulo, cliente, em: agora };
}

export const MAX_LUGARES = 8;

/**
 * Registra o lugar no topo da lista (o mais recente primeiro). O mesmo lugar
 * sobe e fica com o endereço novo (filtro, item aberto); a lista não repete.
 */
export function registrarLugar(lista: Lugar[], lugar: Lugar, max = MAX_LUGARES): Lugar[] {
  const antes = (lista || []).find((l) => l && l.chave === lugar.chave);
  // O cliente em foco que já se sabia do lugar fica, se o novo ainda não tem.
  const junto = antes && !lugar.cliente && antes.cliente ? { ...lugar, cliente: antes.cliente } : lugar;
  const resto = (lista || []).filter((l) => l && l.chave !== lugar.chave);
  return [junto].concat(resto).slice(0, max);
}

/** O cliente em foco chegou depois (Central, Workspace): só atualiza o lugar atual. */
export function comClienteNoLugar(lista: Lugar[], chave: string, cliente: string | null): Lugar[] {
  if (!cliente) return lista;
  return (lista || []).map((l) => (l.chave === chave && l.cliente !== cliente ? { ...l, cliente } : l));
}

/** Onde a pessoa estava antes do lugar atual (o primeiro diferente). */
export function lugarAnterior(lista: Lugar[], chaveAtual: string | null): Lugar | null {
  for (const l of lista || []) if (l && l.chave !== chaveAtual) return l;
  return null;
}

/** Leitura segura do que ficou guardado (formato velho ou quebrado vira lista vazia). */
export function lerLugares(bruto: string | null): Lugar[] {
  if (!bruto) return [];
  try {
    const v = JSON.parse(bruto);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (l) => l && typeof l.url === "string" && typeof l.chave === "string" && typeof l.rotulo === "string" && l.url.charAt(0) === "/" && l.url.charAt(1) !== "/",
    ).slice(0, MAX_LUGARES);
  } catch {
    return [];
  }
}
