/**
 * Navegador do agente (frente MOD, 30/09/2026): computer use pela API, só leitura e coleta, num
 * Chromium isolado do worker da agência (workers/computador). Desenho em
 * docs/motores/COMPUTADOR-DO-AGENTE.md, seção 8. Travas conferidas aqui, na função e de novo no worker:
 * Confirmar do dono, lista de domínios, nada de senha/cartão/login/pagamento, só leitura (POST
 * bloqueado), rede interna bloqueada, print de cada passo, teto de passos e de custo, Parar.
 *
 * Usado só pela função computador-do-agente, pela tela e pelo worker (fora do _shared, que tem teto
 * de 4 MB na publicação do Lovable). A parte antiga (fila de desktop) fica em mesa-videos/modulos.
 */

import { type EstadoDaTarefa, pareceCredencial } from "../../mesa-videos/modulos/computador-do-agente.ts";

export { type EstadoDaTarefa, podeMudarEstado, ROTULO_DA_TAREFA } from "../../mesa-videos/modulos/computador-do-agente.ts";

export const CASOS_DO_NAVEGADOR = ["captura_site", "conferir_post", "coleta_publica"] as const;
export type CasoDoNavegador = (typeof CASOS_DO_NAVEGADOR)[number];

export interface DefinicaoDoCaso {
  valor: CasoDoNavegador;
  rotulo: string;
  /** Um modelo (computer use) decide os passos; sem modelo, o roteiro é fixo no worker. */
  usaModelo: boolean;
  /** Ligado no código. Caso com modelo também exige COMPUTADOR_COM_MODELO_LIGADO=1 no servidor e no worker. */
  ligado: boolean;
  motivoDesligado: string | null;
  tetoPassos: number;
  tetoCustoUsd: number;
}

export const DEFINICOES_DOS_CASOS: Record<CasoDoNavegador, DefinicaoDoCaso> = {
  captura_site: {
    valor: "captura_site",
    rotulo: "Capturar a tela inteira de um site de referência",
    usaModelo: false,
    ligado: true,
    motivoDesligado: null,
    tetoPassos: 6,
    tetoCustoUsd: 0,
  },
  conferir_post: {
    valor: "conferir_post",
    rotulo: "Conferir se um post publicado está no ar",
    usaModelo: false,
    ligado: true,
    motivoDesligado: null,
    tetoPassos: 4,
    tetoCustoUsd: 0,
  },
  coleta_publica: {
    valor: "coleta_publica",
    rotulo: "Coletar dados públicos de concorrentes",
    usaModelo: true,
    ligado: false,
    motivoDesligado:
      "Pronto e desligado: aqui um modelo (computer use do Claude) escolhe os cliques sozinho e ainda não foi provado contra a API real (falta a ANTHROPIC_API_KEY na máquina da agência; a prova é npm run prova-real em workers/computador, com teto de US$ 0,20). Página de terceiro pode tentar mandar no agente (prompt injection). Depois da prova, liga com COMPUTADOR_COM_MODELO_LIGADO=1 na função e no worker.",
    tetoPassos: 25,
    tetoCustoUsd: 1,
  },
};

export const TETO_MAXIMO_DE_PASSOS = 60;
export const TETO_MAXIMO_DE_CUSTO_USD = 5;
export const MAX_DOMINIOS = 10;

/** Caso com modelo só liga com a variável no servidor (e no worker). */
export function casoLigado(caso: CasoDoNavegador, comModelo: boolean): boolean {
  const d = DEFINICOES_DOS_CASOS[caso];
  if (!d) return false;
  if (d.usaModelo) return comModelo;
  return d.ligado;
}

/** Motivo de o caso estar desligado agora (null = ligado). */
export function motivoDoCasoDesligado(caso: CasoDoNavegador, comModelo: boolean): string | null {
  if (casoLigado(caso, comModelo)) return null;
  const d = DEFINICOES_DOS_CASOS[caso];
  return (d && d.motivoDesligado) || "Este caso está desligado.";
}

const HOST_PRIVADO = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const DOMINIO = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * URL pública e segura para o navegador do agente: http(s), sem usuário e
 * senha na URL, sem IP, sem localhost nem rede interna. null = recusada.
 */
export function normalizarUrlPublica(bruto: unknown): string | null {
  const texto = String(bruto ?? "").trim();
  if (!texto || texto.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || IPV4.test(host) || host.indexOf(":") >= 0 || host.charAt(0) === "[" || HOST_PRIVADO.test(host)) return null;
  if (!DOMINIO.test(host)) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  u.hash = "";
  return u.toString();
}

/** Domínio de uma URL ou texto ("https://www.x.com.br/a" e "www.x.com.br" viram "x.com.br"). */
export function dominioDe(bruto: unknown): string | null {
  const texto = String(bruto ?? "").trim().toLowerCase();
  if (!texto) return null;
  let host = texto;
  if (/[/:]/.test(texto)) {
    try {
      host = new URL(/^[a-z]+:\/\//.test(texto) ? texto : `https://${texto}`).hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  if (IPV4.test(host) || HOST_PRIVADO.test(host) || !DOMINIO.test(host)) return null;
  return host;
}

/** Lista de domínios: o da URL inicial primeiro, depois os extras válidos, sem repetir, no máximo 10. */
export function montarDominios(urlInicial: string, extras: unknown): string[] {
  const lista: string[] = [];
  const somar = (d: string | null) => {
    if (d && lista.indexOf(d) < 0 && lista.length < MAX_DOMINIOS) lista.push(d);
  };
  somar(dominioDe(urlInicial));
  const brutos = Array.isArray(extras) ? extras : String(extras ?? "").split(/[\s,;]+/);
  for (const b of brutos) somar(dominioDe(b));
  return lista;
}

/** A URL está na lista (o próprio domínio ou um subdomínio dele). */
export function dominioPermitido(url: string, dominios: string[]): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  if (!host) return false;
  return dominios.some((d) => {
    const alvo = String(d || "").toLowerCase();
    return !!alvo && (host === alvo || host.slice(-(alvo.length + 1)) === `.${alvo}`);
  });
}

const CAMINHO_DE_LOGIN_OU_PAGAMENTO =
  /(^|[/.?&=_-])(login|logon|signin|sign-in|signup|sign-up|entrar|cadastro|cadastrar|auth|oauth|oauth2|sso|senha|password|account|accounts|conta|minha-conta|checkout|pagamento|payment|pagar|carrinho|cart|billing|cobranca|wallet|carteira)([/.?&=_-]|$)/i;

/** Endereço de login, cadastro, conta ou pagamento: o navegador do agente não entra. */
export function urlDeLoginOuPagamento(url: string): boolean {
  try {
    const u = new URL(url);
    return CAMINHO_DE_LOGIN_OU_PAGAMENTO.test(`${u.hostname.split(".")[0]}/${u.pathname}${u.search}`);
  } catch {
    return true;
  }
}

const PEDE_LOGIN_OU_PAGAMENTO =
  /(fa[cç]a login|fazer login|fazer o login|logar|logue|entre na conta|entrar na conta|entrar com|log ?in\b|sign ?in\b|autenti|senha|password|c[oó]digo de verifica|2fa|cart[aã]o|pagar|pagamento|comprar|compre|assinar|inscrever|preencher o formul|preencha o formul|enviar mensagem|comentar|curtir|seguir o perfil)/i;

/** Objetivo que pede login, senha, pagamento ou ação que não é só leitura. */
export function objetivoPedeAcaoProibida(texto: string): boolean {
  return PEDE_LOGIN_OU_PAGAMENTO.test(String(texto || "")) || pareceCredencial(String(texto || ""));
}

export interface PedidoDoNavegador {
  caso: CasoDoNavegador | null;
  url: string | null;
  dominios: string[];
  objetivo: string;
  origem: string;
  client_id: string | null;
  titulo: string;
}

export const ORIGENS_DO_NAVEGADOR = ["mesa_site", "agenda", "proposta", "mesa_videos", "painel"];

export function normalizarPedidoDoNavegador(bruto: unknown): PedidoDoNavegador {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const caso = (CASOS_DO_NAVEGADOR as readonly string[]).indexOf(String(o.caso)) >= 0 ? (String(o.caso) as CasoDoNavegador) : null;
  const url = normalizarUrlPublica(o.url);
  const dominios = url ? montarDominios(url, o.dominios) : [];
  const objetivo = String(o.objetivo ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const origem = ORIGENS_DO_NAVEGADOR.indexOf(String(o.origem)) >= 0 ? String(o.origem) : "painel";
  const client_id = typeof o.client_id === "string" && /^[0-9a-f-]{36}$/i.test(o.client_id) ? o.client_id : null;
  const rotulo = caso ? DEFINICOES_DOS_CASOS[caso].rotulo : "Tarefa do navegador";
  const alvo = url ? dominioDe(url) || url : "";
  const titulo = `${rotulo}${alvo ? `: ${alvo}` : ""}`.slice(0, 140);
  return { caso, url, dominios, objetivo, origem, client_id, titulo };
}

/** Motivo para recusar o pedido do navegador já na entrada (null = vai para o Confirmar do dono). */
export function motivoParaRecusarNoNavegador(p: PedidoDoNavegador, comModelo: boolean): string | null {
  if (!p.caso) return "Escolha o que o navegador do agente vai fazer.";
  const desligado = motivoDoCasoDesligado(p.caso, comModelo);
  if (desligado) return desligado;
  if (!p.url) return "O endereço precisa ser um site público (https), sem IP, sem rede interna e sem usuário ou senha na URL.";
  if (urlDeLoginOuPagamento(p.url)) return "O navegador do agente não entra em página de login, conta, cadastro ou pagamento. Esse passo é do dono.";
  if (/[?&#](token|access_token|api_?key|key|senha|password|sig|signature|code|session)=/i.test(p.url) || pareceCredencial(p.url)) {
    return "O endereço leva um token, chave ou código de acesso. Credencial nunca passa pelo navegador do agente.";
  }
  if (!p.dominios.length || !dominioPermitido(p.url, p.dominios)) return "O endereço precisa estar na lista de domínios permitidos.";
  if (p.objetivo && objetivoPedeAcaoProibida(p.objetivo)) {
    return "O pedido fala em login, senha, pagamento ou em agir no site. O navegador do agente só lê e coleta dados públicos.";
  }
  if (p.caso === "coleta_publica" && p.objetivo.length < 10) return "Diga em uma frase o que coletar (ex.: preços e serviços da página inicial).";
  return null;
}

/**
 * O worker só roda tarefa com o Confirmar do dono (quem e quando). A RPC de
 * pegar já devolve a tarefa como "executando"; antes disso ela é "aprovada".
 */
export function podeExecutar(t: { estado: string; aprovado_por: string | null; aprovado_em: string | null }): boolean {
  return (t.estado === "aprovada" || t.estado === "executando") && !!t.aprovado_por && !!t.aprovado_em;
}

/** Parar: o dono ou quem pediu, enquanto a tarefa espera, está na fila ou está rodando. */
export function podeParar(atual: EstadoDaTarefa, papel: string, ehQuemPediu: boolean): boolean {
  return (atual === "aguardando_dono" || atual === "aprovada" || atual === "executando") && (papel === "admin" || ehQuemPediu);
}

/** Dentro do teto: ainda cabe mais um passo e o custo não passou do teto. */
export function dentroDoTeto(uso: { passos: number; custoUsd: number }, teto: { passos: number; custoUsd: number }): boolean {
  if (uso.passos >= Math.min(teto.passos, TETO_MAXIMO_DE_PASSOS)) return false;
  if (uso.custoUsd > Math.min(teto.custoUsd, TETO_MAXIMO_DE_CUSTO_USD) + 1e-9) return false;
  return true;
}

/** Texto que o modelo quer digitar: nada de credencial nem e-mail, no máximo 120 caracteres (busca no site). */
export function podeDigitar(texto: string): boolean {
  const t = String(texto ?? "");
  return t.length > 0 && t.length <= 120 && !pareceCredencial(t) && !/\S+@\S+\.\S+/.test(t);
}
