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

export const CASOS_DO_NAVEGADOR = [
  "captura_site",
  "conferir_post",
  "coleta_publica",
  "conferir_site",
  "capturar_referencia",
  "perfil_publico",
  "concorrentes_visuais",
] as const;
export type CasoDoNavegador = (typeof CASOS_DO_NAVEGADOR)[number];

export interface DefinicaoDoCaso {
  valor: CasoDoNavegador;
  rotulo: string;
  /** Uma frase: o que a ação entrega (lista de Configurações e "?" do botão). */
  descricao: string;
  /** Onde a equipe pede (mesa › parte). */
  onde: string;
  /** Um modelo (computer use) decide os passos; sem modelo, o roteiro é fixo no worker. */
  usaModelo: boolean;
  /** Ligado no código. Caso com modelo também exige COMPUTADOR_COM_MODELO_LIGADO=1 no servidor e no worker. */
  ligado: boolean;
  motivoDesligado: string | null;
  tetoPassos: number;
  tetoCustoUsd: number;
  /** Turnos do modelo numa tarefa típica (estimativa de custo antes do Confirmar). Por site, quando há vários. */
  turnosTipicos: number;
  /** Vários sites numa tarefa só (um endereço por linha). */
  variosSites: boolean;
  /** O que a coleta vira na mesa de origem, com um clique (null = só conferência). */
  insumo: string | null;
  /** O que o modelo procura quando a pessoa não escreve nada. */
  objetivoPadrao: string | null;
}

const MOTIVO_SEM_MODELO =
  "Desligado: esta ação usa um modelo (computer use) e só liga com COMPUTADOR_COM_MODELO_LIGADO=1 na função computador-do-agente e no worker do navegador, mais a chave do provedor (ANTHROPIC_API_KEY ou OPENAI_API_KEY) na máquina da agência.";

export const DEFINICOES_DOS_CASOS: Record<CasoDoNavegador, DefinicaoDoCaso> = {
  captura_site: {
    valor: "captura_site",
    rotulo: "Capturar a tela inteira de um site de referência",
    descricao: "Abre o site, rola até o fim e guarda a página inteira no computador e no celular.",
    onde: "Mesa Site › Referências",
    usaModelo: false,
    ligado: true,
    motivoDesligado: null,
    tetoPassos: 6,
    tetoCustoUsd: 0,
    turnosTipicos: 0,
    variosSites: false,
    insumo: null,
    objetivoPadrao: null,
  },
  conferir_post: {
    valor: "conferir_post",
    rotulo: "Conferir se um post publicado está no ar",
    descricao: "Abre o link do post, lê o status e o aviso de conteúdo indisponível e guarda o print.",
    onde: "Agenda e Entrega › Publicação",
    usaModelo: false,
    ligado: true,
    motivoDesligado: null,
    tetoPassos: 4,
    tetoCustoUsd: 0,
    turnosTipicos: 0,
    variosSites: false,
    insumo: null,
    objetivoPadrao: null,
  },
  coleta_publica: {
    valor: "coleta_publica",
    rotulo: "Coletar dados públicos de concorrentes",
    descricao: "O modelo navega no site do concorrente e traz serviços, preços públicos e diferenciais, cada um com a fonte.",
    onde: "Mesa Proposta › Mercado",
    usaModelo: true,
    ligado: false,
    motivoDesligado: MOTIVO_SEM_MODELO,
    tetoPassos: 25,
    tetoCustoUsd: 1,
    turnosTipicos: 6,
    variosSites: false,
    insumo: "Pôr no bloco Mercado",
    objetivoPadrao: null,
  },
  conferir_site: {
    valor: "conferir_site",
    rotulo: "Conferir o site publicado",
    descricao: "Abre o domínio do cliente, tira prints no computador e no celular, mede a velocidade e aponta links quebrados.",
    onde: "Mesa Site › Publicação",
    usaModelo: false,
    ligado: true,
    motivoDesligado: null,
    tetoPassos: 6,
    tetoCustoUsd: 0,
    turnosTipicos: 0,
    variosSites: false,
    insumo: null,
    objetivoPadrao: null,
  },
  capturar_referencia: {
    valor: "capturar_referencia",
    rotulo: "Capturar referência com notas de estilo",
    descricao: "Guarda a página inteira (computador e celular), lê cores e fontes do código e o modelo escreve as notas de estilo para a Direção.",
    onde: "Mesa Site › Referências",
    usaModelo: true,
    ligado: false,
    motivoDesligado: MOTIVO_SEM_MODELO,
    tetoPassos: 14,
    tetoCustoUsd: 0.6,
    turnosTipicos: 4,
    variosSites: false,
    insumo: "Levar para a Direção",
    objetivoPadrao: "Notas de estilo para o site: paleta, tipografia, ritmo das seções, botões, fotos e o que vale levar (e o que evitar).",
  },
  perfil_publico: {
    valor: "perfil_publico",
    rotulo: "Analisar perfil público de concorrente",
    descricao: "Abre o perfil público (Instagram, TikTok ou site), lê o que aparece sem login e o modelo resume bio, números, posts visíveis e tom.",
    onde: "Mesa Ads › Referências",
    usaModelo: true,
    ligado: false,
    motivoDesligado: MOTIVO_SEM_MODELO,
    tetoPassos: 15,
    tetoCustoUsd: 0.6,
    turnosTipicos: 5,
    variosSites: false,
    insumo: "Guardar na biblioteca de referências",
    objetivoPadrao: "O que o perfil mostra em público: bio, números, últimos posts visíveis, formatos, tom e frequência.",
  },
  concorrentes_visuais: {
    valor: "concorrentes_visuais",
    rotulo: "Pesquisar concorrentes visuais",
    descricao: "Visita o site de cada concorrente do nicho, lê logo, cores e fontes do código e o modelo diz o que cada identidade comunica.",
    onde: "Mesa Identidade › Pesquisa",
    usaModelo: true,
    ligado: false,
    motivoDesligado: MOTIVO_SEM_MODELO,
    tetoPassos: 30,
    tetoCustoUsd: 1.5,
    turnosTipicos: 3,
    variosSites: true,
    insumo: "Guardar como concorrentes",
    objetivoPadrao: "Logo, cores, tipografia e o que a identidade visual comunica.",
  },
};

export const TETO_MAXIMO_DE_PASSOS = 60;
export const TETO_MAXIMO_DE_CUSTO_USD = 5;
export const MAX_DOMINIOS = 10;
/** Sites numa pesquisa de concorrentes visuais. */
export const MAX_SITES = 5;

// ------------------------------------------------------------------ modelos do computer use

/** Padrão do computer use: Claude Sonnet 5.5 (prova real de 01/10: 3 passos, US$ 0,025). */
export const MODELO_PADRAO_DO_COMPUTADOR = "anthropic:claude-sonnet-5-5";
export type ProvedorDoComputador = "anthropic" | "openai";
export const PROVEDORES_DO_COMPUTADOR: ProvedorDoComputador[] = ["anthropic", "openai"];
export const CHAVE_DO_COMPUTADOR: Record<ProvedorDoComputador, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

/**
 * Por que o seletor do navegador mostra só alguns modelos (vai no "?").
 * O computer use é uma ferramenta própria de cada provedor e só existe na API direta.
 */
export const POR_QUE_SO_ESTES_MODELOS =
  "Só aparecem os modelos marcados com computer use no catálogo (recursos.computer_use): Claude Sonnet 5.5 e Opus 5.5 (ferramenta computer_toolset_20260801 da Anthropic), GPT-6.1 Sol e GPT-6 Astra (ferramenta computer da Responses API da OpenAI). " +
  "O computer use é uma ferramenta de cada provedor e só existe na API direta: pelo OpenRouter, e nos modelos sem essa ferramenta, o modelo não consegue ver a tela nem clicar. " +
  "A chave fica na máquina do navegador (não no servidor), por isso o modelo não precisa estar ligado em Modelos de IA. O padrão é o Claude Sonnet 5.5: vê bem e custa metade do Opus.";

/** Provedor da API direta pelo id do catálogo ("anthropic:..." ou "openai:..."); o resto não faz computer use. */
export function provedorDoComputador(id: unknown): ProvedorDoComputador | null {
  const p = String(id || "").split(":")[0];
  return p === "anthropic" || p === "openai" ? p : null;
}

export interface ModeloDoCatalogoParaComputador {
  id: string;
  provedor?: string;
  modelo_api: string;
  rotulo?: string | null;
  tipo?: string;
  preco_entrada_1m: number | string | null;
  preco_saida_1m: number | string | null;
  preco_cache_1m?: number | string | null;
  disponivel?: boolean | null;
  recursos?: Record<string, unknown> | null;
}

/** Modelo que faz computer use: marcado no catálogo, de texto, disponível e de um provedor direto. */
export function fazComputerUse(m: ModeloDoCatalogoParaComputador | null | undefined): boolean {
  if (!m || !provedorDoComputador(m.id)) return false;
  if (m.tipo && m.tipo !== "texto") return false;
  if (m.disponivel === false) return false;
  return !!m.recursos && (m.recursos as { computer_use?: unknown }).computer_use === true;
}

/** Os modelos do seletor do navegador: o padrão primeiro, depois do mais barato ao mais caro. */
export function modelosDoComputador<T extends ModeloDoCatalogoParaComputador>(catalogo: T[]): T[] {
  return (catalogo || [])
    .filter(fazComputerUse)
    .slice()
    .sort((a, b) =>
      a.id === MODELO_PADRAO_DO_COMPUTADOR ? -1 : b.id === MODELO_PADRAO_DO_COMPUTADOR ? 1 : (Number(a.preco_saida_1m) || 0) - (Number(b.preco_saida_1m) || 0) || a.id.localeCompare(b.id),
    );
}

/**
 * Tokens de um turno típico do computer use (prova real de 01/10 com o Sonnet 5.5: 2 turnos, 13.976 de
 * entrada com 6.268 de cache e 435 de saída, US$ 0,025): o system, a ferramenta e o histórico vão em cache,
 * o print novo (1.334 tokens a 1280 x 800) e o texto entram cheios.
 */
export const TOKENS_DO_TURNO = { entrada: 3500, cache: 6000, saida: 300 };

type PrecoDoModelo = Pick<ModeloDoCatalogoParaComputador, "preco_entrada_1m" | "preco_saida_1m" | "preco_cache_1m">;

/** Custo de um turno típico pelo preço do modelo (US$). */
export function custoDoTurnoTipico(m: PrecoDoModelo): number {
  const entrada = Number(m.preco_entrada_1m) || 0;
  const saida = Number(m.preco_saida_1m) || 0;
  const cache = m.preco_cache_1m === null || m.preco_cache_1m === undefined ? entrada * 0.1 : Number(m.preco_cache_1m) || 0;
  return (TOKENS_DO_TURNO.entrada * entrada + TOKENS_DO_TURNO.cache * cache + TOKENS_DO_TURNO.saida * saida) / 1_000_000;
}

/**
 * Custo estimado de uma tarefa, antes do Confirmar: turnos típicos do caso (por site, quando há vários)
 * vezes o turno típico do modelo, nunca acima do teto. Caso sem modelo: zero.
 */
export function custoEstimadoDoCaso(caso: CasoDoNavegador, m: PrecoDoModelo | null, sites = 1): { estimado: number; teto: number } {
  const d = DEFINICOES_DOS_CASOS[caso];
  if (!d || !d.usaModelo || !m) return { estimado: 0, teto: d ? d.tetoCustoUsd : 0 };
  const turnos = d.turnosTipicos * (d.variosSites ? Math.max(1, Math.min(MAX_SITES, sites)) : 1);
  const estimado = Math.min(d.tetoCustoUsd, turnos * custoDoTurnoTipico(m));
  return { estimado: Math.round(estimado * 10000) / 10000, teto: d.tetoCustoUsd };
}

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
  /** Concorrentes visuais: todos os sites da pesquisa (o primeiro é a URL inicial). Outros casos: só a URL. */
  urls: string[];
  /** Sites que a pessoa mandou e não valem (IP, rede interna, login): a recusa diz quais. */
  urlsRecusadas: string[];
  /** Modelo do computer use (só nos casos com modelo; vazio = o padrão). */
  modelo_id: string | null;
  dominios: string[];
  objetivo: string;
  origem: string;
  client_id: string | null;
  titulo: string;
}

export const ORIGENS_DO_NAVEGADOR = ["mesa_site", "agenda", "proposta", "mesa_videos", "mesa_ads", "mesa_identidade", "painel"];

const ID_DE_MODELO = /^(anthropic|openai):[a-z0-9][a-z0-9._-]{1,80}$/;

/** Lista de endereços (array ou texto, um por linha ou separado por vírgula). */
function listaDeEnderecos(v: unknown): string[] {
  const brutos = Array.isArray(v) ? v.map((x) => String(x ?? "")) : String(v ?? "").split(/[\s,;]+/);
  return brutos.map((x) => x.trim()).filter(Boolean).slice(0, 20);
}

export function normalizarPedidoDoNavegador(bruto: unknown): PedidoDoNavegador {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const caso = (CASOS_DO_NAVEGADOR as readonly string[]).indexOf(String(o.caso)) >= 0 ? (String(o.caso) as CasoDoNavegador) : null;
  const def = caso ? DEFINICOES_DOS_CASOS[caso] : null;
  const urls: string[] = [];
  const urlsRecusadas: string[] = [];
  const primeira = normalizarUrlPublica(o.url);
  if (primeira) urls.push(primeira);
  else if (String(o.url ?? "").trim()) urlsRecusadas.push(String(o.url).trim().slice(0, 200));
  if (def && def.variosSites) {
    for (const b of listaDeEnderecos(o.urls)) {
      const u = normalizarUrlPublica(b);
      if (!u) {
        urlsRecusadas.push(b.slice(0, 200));
        continue;
      }
      if (urls.some((x) => dominioDe(x) === dominioDe(u))) continue;
      if (urls.length < MAX_SITES) urls.push(u);
    }
  }
  const url = urls.length ? urls[0] : null;
  // Os sites da pesquisa entram na lista de domínios antes dos extras.
  const dominios = url ? montarDominios(url, urls.slice(1).concat(listaDeEnderecos(o.dominios))) : [];
  const objetivoDaPessoa = String(o.objetivo ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const objetivo = objetivoDaPessoa || (def && def.objetivoPadrao) || "";
  const origem = ORIGENS_DO_NAVEGADOR.indexOf(String(o.origem)) >= 0 ? String(o.origem) : "painel";
  const client_id = typeof o.client_id === "string" && /^[0-9a-f-]{36}$/i.test(o.client_id) ? o.client_id : null;
  const idDoModelo = String(o.modelo_id ?? "").trim();
  // Caso com modelo: o escolhido (precisa ser de um provedor direto) ou, vazio, o padrão. Caso fixo: nenhum.
  const modelo_id = def && def.usaModelo ? (idDoModelo ? (ID_DE_MODELO.test(idDoModelo) ? idDoModelo : null) : MODELO_PADRAO_DO_COMPUTADOR) : null;
  const rotulo = caso ? DEFINICOES_DOS_CASOS[caso].rotulo : "Tarefa do navegador";
  const alvo = url ? dominioDe(url) || url : "";
  const titulo = `${rotulo}${alvo ? `: ${alvo}` : ""}${urls.length > 1 ? ` e mais ${urls.length - 1}` : ""}`.slice(0, 140);
  return { caso, url, urls, urlsRecusadas, modelo_id, dominios, objetivo, origem, client_id, titulo };
}

/** Motivo para recusar o pedido do navegador já na entrada (null = vai para o Confirmar do dono). */
export function motivoParaRecusarNoNavegador(p: PedidoDoNavegador, comModelo: boolean): string | null {
  if (!p.caso) return "Escolha o que o navegador do agente vai fazer.";
  const def = DEFINICOES_DOS_CASOS[p.caso];
  const desligado = motivoDoCasoDesligado(p.caso, comModelo);
  if (desligado) return desligado;
  if (!p.url) return "O endereço precisa ser um site público (https), sem IP, sem rede interna e sem usuário ou senha na URL.";
  if (def.variosSites && p.urlsRecusadas.length) return `Estes endereços não são sites públicos: ${p.urlsRecusadas.slice(0, 3).join(", ")}. Tire da lista ou corrija.`;
  for (const u of p.urls.length ? p.urls : [p.url]) {
    if (urlDeLoginOuPagamento(u)) return "O navegador do agente não entra em página de login, conta, cadastro ou pagamento. Esse passo é do dono.";
    if (/[?&#](token|access_token|api_?key|key|senha|password|sig|signature|code|session)=/i.test(u) || pareceCredencial(u)) {
      return "O endereço leva um token, chave ou código de acesso. Credencial nunca passa pelo navegador do agente.";
    }
    if (!p.dominios.length || !dominioPermitido(u, p.dominios)) return "O endereço precisa estar na lista de domínios permitidos.";
  }
  if (p.objetivo && objetivoPedeAcaoProibida(p.objetivo)) {
    return "O pedido fala em login, senha, pagamento ou em agir no site. O navegador do agente só lê e coleta dados públicos.";
  }
  if (p.caso === "coleta_publica" && p.objetivo.length < 10) return "Diga em uma frase o que coletar (ex.: preços e serviços da página inicial).";
  if (def.usaModelo && !p.modelo_id) return "Escolha um modelo com computer use (Claude Sonnet 5.5, Opus 5.5, GPT-6.1 Sol ou GPT-6 Astra).";
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
