/**
 * Instagram do cliente na Mesa (frente IG, 28/09/2026): a parte que não é IA.
 *
 * - O que cada rede permite pela API ligada hoje no painel (REDES_SOCIAIS),
 *   para a aba dizer a verdade ao dono antes de ele pedir algo impossível.
 * - Planejar a grade: a ordem dos posts que vão ao ar, a troca de datas quando
 *   a equipe reordena (as datas trocam entre os posts que já têm data; o post
 *   sem data ganha a dele pelo "Publicar em") e os avisos de sequência.
 *
 * - Contas do cliente (@ limpo, a conta principal), a capa de um trabalho do
 *   Estúdio e o caminho que o agente da aba sempre deixa ("Ir para ...").
 *
 * Puro: sem Deno, sem rede e sem banco, sem regex moderna (a tela, a função
 * mesa-instagram e o Vitest leem o mesmo arquivo). Sem travessão.
 */

import type { CaminhoDoAgente } from "./acoes-do-agente.ts";
import { caminhoDaResposta, caminhoNaArea } from "./mapa-do-painel.ts";
import { contasDaMarcaAberta } from "./heranca-da-marca.ts";

// ------------------------------------------------------------------ contas

export type ContaDoInstagram = { id: string; username: string; igUserId: string | null; nome: string | null };

/** @ sem arroba, minúsculo; aceita link do perfil. Inválido: vazio. */
export function usernameDe(handle: unknown): string {
  let s = String(handle || "").trim().toLowerCase();
  const i = s.indexOf("instagram.com/");
  if (i >= 0) s = s.slice(i + "instagram.com/".length);
  s = s.replace(/^@/, "").split("/")[0].split("?")[0];
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : "";
}

const soLetras = (t: string) => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A conta pedida, ou a principal: a que tem o nome do cliente no @ (a
 * AcelerIQ tem @aceleriq e @sitebolt), depois a primeira (as conectadas vêm
 * antes das cadastradas à mão).
 */
export function escolherConta(contas: ContaDoInstagram[], pedida: unknown, nomeDoCliente: string): ContaDoInstagram | null {
  const id = String(pedida || "");
  const achada = contas.find((c) => c.id === id);
  if (achada) return achada;
  const base = soLetras(nomeDoCliente);
  const peloNome = base ? contas.find((c) => {
    const u = soLetras(c.username);
    return !!u && (u.indexOf(base) >= 0 || base.indexOf(u) >= 0);
  }) : null;
  return peloNome || contas[0] || null;
}

/** Capa de um trabalho do Estúdio ou da Mesa Foto: a última versão da primeira lâmina. */
export function capaDoTrabalho(cards: unknown): string | null {
  const lista = Array.isArray(cards) ? (cards as Array<{ ordem?: number; versao?: number; storage_path?: string }>) : [];
  let melhor: { versao: number; caminho: string } | null = null;
  const menorOrdem = lista.reduce((m, c) => (typeof c.ordem === "number" && c.ordem < m ? c.ordem : m), 9999);
  for (const c of lista) {
    if (c.ordem !== menorOrdem || !c.storage_path) continue;
    const v = Number(c.versao || 0);
    if (!melhor || v > melhor.versao) melhor = { versao: v, caminho: c.storage_path };
  }
  return melhor ? melhor.caminho : null;
}

// ------------------------------------------------------------------ marcas (rodada 3, 28/09)

export type MarcaDasContas = { id: string; project_id: string | null; principal: boolean; nome?: string };
export type LigacaoDaConta = { external_account_id: string; project_id: string };

/**
 * Contas (Instagram e páginas) de cada marca, pelas ligações conta-projeto
 * (project_external_accounts). Pedido do dono, 28/09: "na Acerbi não está
 * separando os perfis". Regras:
 * - cliente sem marca: todas as contas;
 * - outra marca (não principal): só as ligadas ao projeto dela;
 * - principal: as que não são de outra marca (ligadas a ela ou a nenhuma).
 * Conta ligada a duas marcas vale para as duas.
 */
export function contasDaMarca<C extends { id: string }>(contas: C[], ligacoes: LigacaoDaConta[], marca: MarcaDasContas | null, marcas: MarcaDasContas[]): C[] {
  // Frente MC (29/09): a regra mora em heranca-da-marca.ts (a mesma da tela e das outras funções).
  return contasDaMarcaAberta(contas, ligacoes, marca, marcas);
}

/** A marca dona de uma conta (para agrupar na tela e recusar conta de outra marca). */
export function marcaDaConta(contaId: string, ligacoes: LigacaoDaConta[], marcas: MarcaDasContas[]): MarcaDasContas | null {
  const ps = ligacoes.filter((l) => l.external_account_id === contaId).map((l) => l.project_id);
  const dela = marcas.find((m) => !m.principal && !!m.project_id && ps.indexOf(m.project_id) >= 0);
  return dela || marcas.find((m) => m.principal) || null;
}

/** Lâminas do trabalho na ordem, cada uma na última versão (para ver o post inteiro). */
export function laminasDoTrabalho(cards: unknown, maximo = 10): string[] {
  const lista = Array.isArray(cards) ? (cards as Array<{ ordem?: number; versao?: number; storage_path?: string }>) : [];
  const porOrdem: Record<string, { versao: number; caminho: string; ordem: number }> = {};
  for (const c of lista) {
    if (typeof c.ordem !== "number" || !c.storage_path) continue;
    const v = Number(c.versao || 0);
    const atual = porOrdem[String(c.ordem)];
    if (!atual || v > atual.versao) porOrdem[String(c.ordem)] = { versao: v, caminho: c.storage_path, ordem: c.ordem };
  }
  return Object.keys(porOrdem).map((k) => porOrdem[k]).sort((a, b) => a.ordem - b.ordem).slice(0, maximo).map((x) => x.caminho);
}

// ------------------------------------------------------------------ caminho do agente

/** Blocos da aba (o endereço leva ?bloco= e a aba abre e rola até ele). */
export const BLOCOS_DA_ABA = ["perfil", "bio", "destaques", "grade", "metricas", "redes"] as const;
export type BlocoDaAba = (typeof BLOCOS_DA_ABA)[number];

export const ROTULO_DO_BLOCO: Record<BlocoDaAba, string> = {
  perfil: "Prévia do perfil",
  bio: "Bio e nome",
  destaques: "Destaques",
  grade: "Planejar a grade",
  metricas: "Métricas",
  redes: "Outras redes",
};

export const ehBloco = (v: unknown): v is BlocoDaAba => BLOCOS_DA_ABA.indexOf(v as BlocoDaAba) >= 0;

/**
 * O caminho que o agente da aba sempre deixa (contrato `caminho`): o bloco
 * onde a equipe continua; sem bloco, a área que a resposta citou; sem
 * nada, a própria aba Redes (a antiga aba Instagram; o endereço segue
 * aba=instagram para os links já dados valerem). Nunca volta vazio.
 */
export function caminhoDoAgente(clientId: string, bloco: string, texto: string): CaminhoDoAgente | null {
  if (ehBloco(bloco)) {
    return caminhoNaArea("mesa", { clientId, etapa: "instagram", estado: { bloco }, rotulo: `Ir para ${ROTULO_DO_BLOCO[bloco]}` });
  }
  const citado = caminhoDaResposta(texto, clientId);
  if (citado && citado.destino.indexOf("aba=instagram") < 0) return citado;
  return caminhoNaArea("mesa", { clientId, etapa: "instagram", rotulo: "Ir para a aba Redes" });
}

// ------------------------------------------------------------------ simulador da grade (rodada 2, 28/09)

const DIA_MS = 24 * 60 * 60 * 1000;
/** Intervalo padrão entre posts quando não há dois com data para medir. */
export const INTERVALO_PADRAO_DIAS = 2;

/**
 * Datas da simulação. O dono escolhe os posts e a ordem; só a data muda, para
 * a grade sair na ordem escolhida:
 * - as datas que já existem entre os escolhidos são redistribuídas em ordem;
 * - quem não tem data ganha uma depois da última, no mesmo horário, com o
 *   intervalo mediano entre as datas que existem (sem duas, 2 dias);
 * - sem nenhuma data, começa em `inicio` (amanhã no horário padrão).
 * Devolve a data de cada id, na ordem.
 */
export function datasDaSimulacao(escolhidos: ItemPlanejado[], inicio: string): Array<{ id: string; data: string }> {
  const datas = escolhidos.filter((i) => !!i.data).map((i) => i.data as string).sort();
  const intervalos: number[] = [];
  for (let k = 1; k < datas.length; k++) {
    const d = Date.parse(datas[k]) - Date.parse(datas[k - 1]);
    if (d > 0) intervalos.push(d);
  }
  intervalos.sort((a, b) => a - b);
  const mediana = intervalos.length ? intervalos[Math.floor(intervalos.length / 2)] : INTERVALO_PADRAO_DIAS * DIA_MS;
  const passo = Math.max(DIA_MS, Math.round(mediana / DIA_MS) * DIA_MS);
  const slots = datas.slice();
  let ultima = slots.length ? Date.parse(slots[slots.length - 1]) : Date.parse(inicio) - passo;
  while (slots.length < escolhidos.length) {
    ultima += passo;
    slots.push(new Date(ultima).toISOString());
  }
  return escolhidos.map((i, k) => ({ id: i.id, data: slots[k] }));
}

/** O que muda (de e para) na simulação; quem não tinha data aparece com `de` null. */
export function mudancasDaSimulacao(escolhidos: ItemPlanejado[], inicio: string): Array<{ id: string; titulo: string; de: string | null; para: string }> {
  const novas = datasDaSimulacao(escolhidos, inicio);
  const saida: Array<{ id: string; titulo: string; de: string | null; para: string }> = [];
  escolhidos.forEach((i, k) => {
    const para = novas[k].data;
    if (!i.data || Date.parse(i.data) !== Date.parse(para)) saida.push({ id: i.id, titulo: i.titulo, de: i.data, para });
  });
  return saida;
}

/** Amanhã às `hora` (HH:MM) no fuso do navegador, em ISO: o começo quando ninguém tem data. */
export function amanhaAs(hora: string, agora = new Date()): string {
  const [h, m] = (/^\d{2}:\d{2}$/.test(hora) ? hora : "11:30").split(":").map(Number);
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1, h, m, 0, 0);
  return d.toISOString();
}

// ------------------------------------------------------------------ Facebook (rodada 2, 28/09)

export type PostDaPagina = { id: string; texto: string; imagem: string | null; data: string | null; link: string | null };

export type PaginaNaPrevia = {
  id: string;
  nome: string;
  categoria: string;
  sobre: string;
  site: string;
  link: string | null;
  seguidores: number | null;
  curtidas: number | null;
  foto_url: string | null;
  capa_url: string | null;
  posts: PostDaPagina[];
  lido_em: string | null;
  aviso: string | null;
};

/** Página lida pela Graph API (campos públicos da página e os últimos posts). */
export function paginaDaApi(corpo: Record<string, unknown>, posts: unknown, agora = new Date()): PaginaNaPrevia {
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(new RegExp("[" + String.fromCharCode(8212, 8211) + "]", "g"), ",").trim().slice(0, max) : "");
  const foto = corpo.picture && typeof corpo.picture === "object" ? ((corpo.picture as Record<string, unknown>).data as Record<string, unknown> | undefined) : undefined;
  const capa = corpo.cover && typeof corpo.cover === "object" ? (corpo.cover as Record<string, unknown>) : undefined;
  const lista = posts && typeof posts === "object" && Array.isArray((posts as Record<string, unknown>).data) ? ((posts as Record<string, unknown>).data as Array<Record<string, unknown>>) : [];
  return {
    id: String(corpo.id || ""),
    nome: s(corpo.name, 120),
    categoria: s(corpo.category, 80),
    sobre: s(corpo.about, 600) || s(corpo.description, 600),
    site: s(corpo.website, 200),
    link: typeof corpo.link === "string" ? corpo.link : null,
    seguidores: n(corpo.followers_count),
    curtidas: n(corpo.fan_count),
    foto_url: foto && typeof foto.url === "string" ? foto.url : null,
    capa_url: capa && typeof capa.source === "string" ? capa.source : null,
    posts: lista.filter((p) => p && p.id).slice(0, 12).map((p) => ({
      id: String(p.id),
      texto: s(p.message, 300),
      imagem: typeof p.full_picture === "string" ? p.full_picture : null,
      data: typeof p.created_time === "string" ? p.created_time : null,
      link: typeof p.permalink_url === "string" ? p.permalink_url : null,
    })),
    lido_em: agora.toISOString(),
    aviso: null,
  };
}

// ------------------------------------------------------------------ redes

export type ChaveDaRede = "instagram" | "facebook" | "tiktok" | "linkedin" | "youtube" | "threads" | "google";

export type RedeSocial = {
  valor: ChaveDaRede;
  rotulo: string;
  /** O painel já conecta esta rede (login da Meta em Integrações). */
  conectaHoje: boolean;
  /** O que dá para fazer hoje pela API ligada no painel. */
  permite: string[];
  /** O que a API não faz (ou o painel ainda não faz), dito sem rodeio. */
  naoPermite: string[];
  /** Documentação oficial (conferida em 28/09/2026). */
  fonte: string;
};

/**
 * Escopos pedidos hoje no login da Meta (social-meta-oauth/meta.ts):
 * pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic,
 * instagram_content_publish (+ insights e comentários do Instagram, ads_read
 * opcional). A publicação automática do painel (ciclo do banco) só publica no
 * Instagram; a página do Facebook está conectada, mas o painel não publica nela.
 */
export const REDES_SOCIAIS: RedeSocial[] = [
  {
    valor: "instagram",
    rotulo: "Instagram",
    conectaHoje: true,
    permite: [
      "Ler o perfil: foto, nome, @, bio, link, seguidores, seguindo e total de posts",
      "Ler os posts (imagem, legenda, data, curtidas e comentários) e as métricas da conta e dos posts",
      "Publicar e agendar post, carrossel e reels pela Agenda (só com aprovação do cliente e data confirmada)",
      "Ler outro perfil profissional público (referências e concorrentes)",
    ],
    naoPermite: [
      "Editar bio, nome, foto ou link: a troca é no app, copiando e colando",
      "Ler, criar ou editar destaques: suba as capas pelo app",
      "Fixar posts no topo da grade",
    ],
    fonte: "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user",
  },
  {
    valor: "facebook",
    rotulo: "Facebook",
    conectaHoje: true,
    permite: [
      "Ler a página conectada: nome, categoria, sobre, site, seguidores, curtidas, foto, capa e os últimos posts (aqui na aba)",
      "A permissão de publicar na página já vem no login (pages_manage_posts), com agendamento de 10 minutos a 30 dias pela API",
    ],
    naoPermite: [
      "O painel ainda não publica no Facebook: a Agenda publica só no Instagram hoje",
      "Editar a descrição da página por aqui",
    ],
    fonte: "https://developers.facebook.com/docs/pages-api/posts",
  },
  {
    valor: "tiktok",
    rotulo: "TikTok",
    conectaHoje: false,
    permite: ["Guardar o @ do cliente aqui para a equipe e os agentes saberem que a conta existe"],
    naoPermite: [
      "Conectar: exige app aprovado no TikTok (Login Kit e Content Posting API)",
      "Publicar de verdade: app sem auditoria do TikTok só publica como privado",
      "Ler números: a Display API (perfil, vídeos) também depende do app aprovado",
    ],
    fonte: "https://developers.tiktok.com/doc/content-posting-api-get-started",
  },
  {
    valor: "linkedin",
    rotulo: "LinkedIn",
    conectaHoje: false,
    permite: ["Guardar a página do cliente aqui"],
    naoPermite: [
      "Conectar e publicar: exige app com w_organization_social e a pessoa como admin da página",
      "Carrossel orgânico não é aceito pela API",
    ],
    fonte: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api",
  },
  {
    valor: "youtube",
    rotulo: "YouTube",
    conectaHoje: false,
    permite: ["Guardar o canal do cliente aqui"],
    naoPermite: ["Conectar e publicar: projeto do Google sem auditoria sobe vídeo só como privado"],
    fonte: "https://developers.google.com/youtube/v3/docs/videos/insert",
  },
  {
    valor: "threads",
    rotulo: "Threads",
    conectaHoje: false,
    permite: ["Guardar o @ do cliente aqui"],
    naoPermite: ["Conectar e publicar: a Threads API usa outro login (threads_basic, threads_content_publish), ainda não ligado no painel"],
    fonte: "https://developers.facebook.com/docs/threads/overview",
  },
  {
    valor: "google",
    rotulo: "Perfil da Empresa (Google)",
    conectaHoje: false,
    permite: ["Guardar o link do perfil do cliente no Google aqui"],
    naoPermite: ["Conectar e postar: o acesso à API é por pedido ao Google, com projeto e motivo comercial"],
    fonte: "https://developers.google.com/my-business/content/overview",
  },
];

export const ehRede = (v: unknown): v is ChaveDaRede => REDES_SOCIAIS.some((r) => r.valor === v);
export const redePorChave = (v: string): RedeSocial => REDES_SOCIAIS.find((r) => r.valor === v) || REDES_SOCIAIS[0];

/** @ ou link da rede, limpo (sem espaço, até 200). */
export function enderecoDaRede(v: unknown): string {
  return String(v || "").replace(/\s+/g, "").slice(0, 200);
}

// ------------------------------------------------------------------ grade

export type ItemPlanejado = {
  id: string;
  /** Data e hora (ISO) em que vai ao ar; null quando ainda não tem. */
  data: string | null;
  /** carrossel, estatico, foto, reel ou outro. */
  formato: string;
  /** Estúdio de design ou Mesa Foto (post de fotos). */
  origem: "arte" | "foto" | "agenda";
  titulo: string;
};

/**
 * Ordem de ir ao ar: a salva pela equipe primeiro (só os ids que ainda estão
 * no plano) e, depois, os que não estavam nela, por data (sem data no fim).
 */
export function ordemDoPlano<T extends ItemPlanejado>(itens: T[], ordemSalva: string[] | null | undefined): T[] {
  const porId: Record<string, T> = {};
  for (const i of itens) porId[i.id] = i;
  const saida: T[] = [];
  const usados: Record<string, true> = {};
  for (const id of ordemSalva || []) {
    if (porId[id] && !usados[id]) {
      saida.push(porId[id]);
      usados[id] = true;
    }
  }
  const resto = itens.filter((i) => !usados[i.id]).sort((a, b) => {
    if (a.data && b.data) return a.data < b.data ? -1 : a.data > b.data ? 1 : 0;
    if (a.data) return -1;
    if (b.data) return 1;
    return 0;
  });
  return saida.concat(resto);
}

/** Move o item de `de` para `para` (índices na ordem de ir ao ar). */
export function mover<T>(lista: T[], de: number, para: number): T[] {
  if (de === para || de < 0 || para < 0 || de >= lista.length || para >= lista.length) return lista.slice();
  const copia = lista.slice();
  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item);
  return copia;
}

export type TrocaDeData = { id: string; titulo: string; de: string; para: string };

/**
 * Datas na nova ordem: as datas que já existem, em ordem, vão para os posts
 * que já tinham data, na ordem nova. Post sem data continua sem data (ganha a
 * dele pelo "Publicar em"). Devolve só o que muda.
 */
export function trocasDeData(novaOrdem: ItemPlanejado[]): TrocaDeData[] {
  const datas = novaOrdem.filter((i) => !!i.data).map((i) => i.data as string).sort();
  const trocas: TrocaDeData[] = [];
  let k = 0;
  for (const i of novaOrdem) {
    if (!i.data) continue;
    const nova = datas[k++];
    if (nova !== i.data) trocas.push({ id: i.id, titulo: i.titulo, de: i.data, para: nova });
  }
  return trocas;
}

/** Avisos da sequência (na ordem de ir ao ar): o mesmo formato três vezes seguidas. */
export function avisosDaSequencia(itens: Array<Pick<ItemPlanejado, "formato" | "titulo">>): string[] {
  const avisos: string[] = [];
  let igual = 1;
  for (let k = 1; k < itens.length; k++) {
    igual = itens[k].formato === itens[k - 1].formato ? igual + 1 : 1;
    if (igual === 3) avisos.push(`Três ${ROTULO_DO_FORMATO_NA_GRADE[itens[k].formato] || itens[k].formato} seguidos, até "${itens[k].titulo}": intercale outro tipo.`);
  }
  return avisos;
}

export const ROTULO_DO_FORMATO_NA_GRADE: Record<string, string> = {
  carrossel: "carrosséis",
  estatico: "estáticos",
  foto: "posts de foto",
  reel: "reels",
  outro: "posts",
};

/** Formato do post publicado pela API (media_type e media_product_type). */
export function formatoDaMidia(tipo: unknown, produto: unknown): string {
  const t = String(tipo || "").toUpperCase();
  const p = String(produto || "").toUpperCase();
  if (p === "REELS" || t === "VIDEO") return "reel";
  if (t === "CAROUSEL_ALBUM") return "carrossel";
  if (t === "IMAGE") return "estatico";
  return "outro";
}
