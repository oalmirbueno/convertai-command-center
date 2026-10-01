/**
 * Uma tarefa do navegador do agente, do começo ao fim (frente MOD, 30/09; frente CUS, 01/10).
 *
 * Ordem fixa, sem laço de correção (uma tentativa por Confirmar do dono):
 * 1. confere de novo as travas da tarefa (aprovada pelo dono, caso ligado,
 *    URL pública fora de login e pagamento, domínio na lista, chave do provedor do modelo);
 * 2. abre um Chromium isolado com a lista de domínios;
 * 3. roda o roteiro do caso:
 *    - fixos (sem modelo): captura_site, conferir_post e conferir_site;
 *    - com modelo (computer use do provedor do modelo escolhido): coleta_publica, capturar_referencia,
 *      perfil_publico e concorrentes_visuais (estes três começam com a parte fixa: prints, cores e fontes
 *      lidas do código, o que aparece sem login);
 * 4. cada passo sobe um print para o Storage e passa pela RPC
 *    computador_tarefa_passo, que diz se segue, se o dono parou ou se bateu
 *    no teto de passos ou de custo;
 * 5. fecha a tarefa com o resultado (resumo, fonte e as imagens do cartão) ou com o motivo da parada;
 *    o que o modelo gastou vai para a carteira do cliente.
 */

import { randomUUID } from "node:crypto";
import {
  casoLigado,
  type CasoDoNavegador,
  CASOS_DO_NAVEGADOR,
  DEFINICOES_DOS_CASOS,
  dominioDe,
  dominioPermitido,
  motivoParaRecusarNoNavegador,
  normalizarPedidoDoNavegador,
  podeExecutar,
  provedorDoComputador,
  type ProvedorDoComputador,
} from "../../supabase/functions/computador-do-agente/modulos/navegador.ts";
import { type Armazem, caminhoDaProva, type Fila, type RespostaDoPasso, type TarefaDoNavegador } from "./fila.ts";
import { type NavegadorDoAgente, type OpcoesDoNavegador, rolarAteOFim, TELA, TELA_DO_CELULAR } from "./navegador.ts";
import {
  abrirSessao,
  type ClienteDoModelo,
  gastoZerado,
  type GastoDoModelo,
  lacoDoModelo,
  MODELO_DO_COMPUTADOR,
  modeloConhecido,
  modeloDoCatalogo,
  type ModeloDoComputador,
  ParadaDoModelo,
  type RespostaDaOpenAI,
  sistemaDoCaso,
} from "./modelo.ts";

/** Altura máxima da captura de página inteira (px): página infinita não vira PNG gigante. */
export const ALTURA_MAXIMA_DA_CAPTURA = 16_000;
/** Links do próprio site conferidos no conferir_site (o resto conta como "não conferido"). */
export const MAX_LINKS_CONFERIDOS = 40;
/** Turnos do modelo por site na pesquisa de concorrentes visuais. */
export const TURNOS_POR_SITE = 5;

export interface Ambiente {
  fila: Fila;
  armazem: Armazem;
  abrir: (op: OpcoesDoNavegador) => Promise<NavegadorDoAgente>;
  /** Caso com modelo só com COMPUTADOR_COM_MODELO_LIGADO=1 E um cliente de modelo com chave. */
  comModelo: boolean;
  /** Cliente da Anthropic (ANTHROPIC_API_KEY da máquina). */
  modelo: ClienteDoModelo | null;
  /** Cliente da OpenAI (OPENAI_API_KEY da máquina). */
  openai?: ClienteDoModelo<RespostaDaOpenAI> | null;
  /** Modelo das tarefas sem modelo escolhido (padrão Sonnet 5.5; COMPUTADOR_MODELO troca). */
  qualModelo?: ModeloDoComputador;
  executor: string;
  versao: string;
  log?: (msg: string) => void;
}

/** Provedores de computer use que este worker pode usar agora (variável ligada e chave na máquina). */
export function provedoresDoWorker(amb: Pick<Ambiente, "comModelo" | "modelo" | "openai">): ProvedorDoComputador[] {
  if (!amb.comModelo) return [];
  const p: ProvedorDoComputador[] = [];
  if (amb.modelo) p.push("anthropic");
  if (amb.openai) p.push("openai");
  return p;
}

/** Os casos que este worker aceita pegar agora. */
export function casosDoWorker(amb: Pick<Ambiente, "comModelo" | "modelo" | "openai">): CasoDoNavegador[] {
  const comModelo = provedoresDoWorker(amb).length > 0;
  return CASOS_DO_NAVEGADOR.filter((c) => casoLigado(c, comModelo));
}

export class Parada extends Error {
  tipo: "parar" | "teto" | "proibida";
  constructor(tipo: "parar" | "teto" | "proibida", mensagem: string) {
    super(mensagem);
    this.tipo = tipo;
  }
}

/** Contexto de um passo: sobe o print, registra na fila e para quando a fila manda. */
export interface Passos {
  feitos: number;
  /** Caminho do último print guardado (para o cartão). */
  ultimo: string | null;
  provar(png: Uint8Array, legenda: string, custoUsd?: number, sufixo?: string): Promise<RespostaDoPasso>;
}

function criarPassos(amb: Ambiente, t: TarefaDoNavegador, token: string): Passos {
  const p: Passos = {
    feitos: 0,
    ultimo: null,
    async provar(png, legenda, custoUsd = 0, sufixo = "") {
      const numero = p.feitos + 1;
      const caminho = await amb.armazem.guardar(caminhoDaProva(t, numero, sufixo), png);
      const r = await amb.fila.passo(t.id, token, { passo: numero, storage_path: caminho, legenda: legenda.slice(0, 200), em: new Date().toISOString() }, custoUsd);
      p.feitos = numero;
      p.ultimo = caminho;
      if (r === "parar") throw new Parada("parar", `Parada pelo dono no passo ${numero}.`);
      return r;
    },
  };
  return p;
}

/** O modelo da tarefa: o do catálogo (preço de lá), senão um conhecido, senão o padrão da máquina. */
export async function modeloDaTarefa(amb: Pick<Ambiente, "fila" | "qualModelo">, t: Pick<TarefaDoNavegador, "modelo_id">): Promise<ModeloDoComputador> {
  const id = String(t.modelo_id || "").trim();
  if (!id) return amb.qualModelo || MODELO_DO_COMPUTADOR;
  if (amb.fila.lerModelo) {
    try {
      const m = modeloDoCatalogo(await amb.fila.lerModelo(id));
      if (m) return m;
    } catch (err) {
      console.error(`[navegador] catálogo indisponível para ${id}; uso a tabela do worker: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const conhecido = modeloConhecido(id);
  if (conhecido) return conhecido;
  throw new ParadaDoModelo(`O modelo ${id} não faz computer use (não está marcado no catálogo).`);
}

/** Confere de novo, no worker, tudo o que a função conferiu (defesa em profundidade). */
export function motivoParaNaoRodar(t: TarefaDoNavegador, amb: Pick<Ambiente, "comModelo" | "modelo" | "openai">): string | null {
  if (!podeExecutar(t)) return "A tarefa não tem o Confirmar do dono.";
  if ((CASOS_DO_NAVEGADOR as readonly string[]).indexOf(t.caso) < 0) return "Caso desconhecido.";
  if (!(t.dominios || []).length || !dominioPermitido(t.url_inicial, t.dominios)) return "O endereço inicial está fora da lista de domínios.";
  const provedores = provedoresDoWorker(amb);
  const p = normalizarPedidoDoNavegador({
    caso: t.caso,
    url: t.url_inicial,
    urls: (t.urls || []).filter((u) => u !== t.url_inicial),
    dominios: t.dominios,
    objetivo: t.objetivo,
    origem: t.origem,
    client_id: t.client_id,
    modelo_id: t.modelo_id,
  });
  const motivo = motivoParaRecusarNoNavegador(p, provedores.length > 0);
  if (motivo) return motivo;
  for (const u of p.urls) if (!dominioPermitido(u, t.dominios)) return "Um dos sites está fora da lista de domínios.";
  if (DEFINICOES_DOS_CASOS[t.caso as CasoDoNavegador].usaModelo && t.modelo_id) {
    const prov = provedorDoComputador(t.modelo_id);
    if (!prov) return "O modelo da tarefa não faz computer use.";
    if (provedores.indexOf(prov) < 0) return `A máquina do navegador não tem a chave ${prov === "openai" ? "da OpenAI (OPENAI_API_KEY)" : "da Anthropic (ANTHROPIC_API_KEY)"}.`;
  }
  return null;
}

async function pararSeProibida(nav: NavegadorDoAgente) {
  const motivo = await nav.paginaProibida();
  if (motivo) throw new Parada("proibida", motivo);
}

type Imagem = { rotulo: string; storage_path: string };

// ------------------------------------------------------------------ partes fixas (sem modelo)

/** Página inteira no computador e no celular (2 prints); com `voltar`, volta para a tela do computador no topo. */
async function paginaInteira(nav: NavegadorDoAgente, passos: Passos, imagens: Imagem[], voltar = false): Promise<{ altura: number; capturas: Array<{ tela: string; largura: number; altura: number }>; parcial: boolean }> {
  const altura = await rolarAteOFim(nav.pagina);
  await pararSeProibida(nav);
  const alturaDaCaptura = Math.min(altura || TELA.altura, ALTURA_MAXIMA_DA_CAPTURA);
  const inteira = await nav.pagina.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: TELA.largura, height: alturaDaCaptura } });
  const capturas: Array<{ tela: string; largura: number; altura: number }> = [{ tela: "computador", largura: TELA.largura, altura: alturaDaCaptura }];
  const r1 = await passos.provar(inteira, `Tela inteira no computador (${TELA.largura} x ${alturaDaCaptura} px)`, 0, "inteira");
  if (passos.ultimo) imagens.push({ rotulo: "Página inteira no computador", storage_path: passos.ultimo });
  if (r1 === "teto") return { altura, capturas, parcial: true };

  await nav.pagina.setViewportSize({ width: TELA_DO_CELULAR.largura, height: TELA_DO_CELULAR.altura });
  await nav.pagina.reload({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined);
  await pararSeProibida(nav);
  const alturaCel = Math.min(await rolarAteOFim(nav.pagina), ALTURA_MAXIMA_DA_CAPTURA);
  const celular = await nav.pagina.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: TELA_DO_CELULAR.largura, height: Math.max(alturaCel, TELA_DO_CELULAR.altura) } });
  capturas.push({ tela: "celular", largura: TELA_DO_CELULAR.largura, altura: Math.max(alturaCel, TELA_DO_CELULAR.altura) });
  const r2 = await passos.provar(celular, `Tela inteira no celular (${TELA_DO_CELULAR.largura} px)`, 0, "celular");
  if (passos.ultimo) imagens.push({ rotulo: "Página inteira no celular", storage_path: passos.ultimo });
  if (voltar) {
    // De volta ao computador, no topo (o modelo trabalha na tela de 1280 x 800).
    await nav.pagina.setViewportSize({ width: TELA.largura, height: TELA.altura });
    await nav.pagina.reload({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined);
    await nav.pagina.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  }
  return { altura, capturas, parcial: r2 === "teto" };
}

async function capturaSite(nav: NavegadorDoAgente, t: TarefaDoNavegador, passos: Passos): Promise<Record<string, unknown>> {
  const status = await nav.ir(t.url_inicial);
  await pararSeProibida(nav);
  const titulo = await nav.pagina.title().catch(() => "");
  if ((await passos.provar(await nav.pagina.screenshot({ type: "png" }), `Página aberta (${status ?? "sem status"})`)) === "teto") return { titulo, url_final: nav.pagina.url(), status, parcial: true };
  const imagens: Imagem[] = [];
  const p = await paginaInteira(nav, passos, imagens);
  return { titulo, url_final: nav.pagina.url(), status, altura: p.altura, capturas: p.capturas, imagens, fontes: [t.url_inicial], ...(p.parcial ? { parcial: true } : {}) };
}

/** og:title, og:description, og:image e og:url da página (o que a rede mostra sem login). */
async function lerOg(nav: NavegadorDoAgente): Promise<{ titulo: string; descricao: string; imagem: string; url: string }> {
  return await nav.pagina
    .evaluate(() => {
      const m = (p: string) => {
        const el = document.querySelector(`meta[property="${p}"]`) || document.querySelector(`meta[name="${p}"]`);
        return el ? String(el.getAttribute("content") || "").slice(0, 600) : "";
      };
      return { titulo: m("og:title"), descricao: m("og:description") || m("description"), imagem: m("og:image"), url: m("og:url") };
    })
    .catch(() => ({ titulo: "", descricao: "", imagem: "", url: "" }));
}

const SINAIS_DE_FORA_DO_AR = [
  /esta p[aá]gina n[aã]o est[aá] dispon[ií]vel/i,
  /p[aá]gina n[aã]o encontrada/i,
  /this page isn.t available/i,
  /page not found/i,
  /sorry, this page/i,
  /post (was )?(removed|deleted)/i,
  /conte[uú]do n[aã]o (est[aá] )?dispon[ií]vel/i,
];

async function conferirPost(nav: NavegadorDoAgente, t: TarefaDoNavegador, passos: Passos): Promise<Record<string, unknown>> {
  const status = await nav.ir(t.url_inicial);
  const url_final = nav.pagina.url();
  const proibida = await nav.paginaProibida();
  const png = await nav.pagina.screenshot({ type: "png" });
  const titulo = await nav.pagina.title().catch(() => "");
  const texto = String(await nav.pagina.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "")).slice(0, 20_000);
  const og = await lerOg(nav);
  let no_ar: boolean | "inconclusivo";
  let motivo: string;
  if (proibida) {
    no_ar = "inconclusivo";
    motivo = "A rede pediu login para mostrar o post; confira pelo painel da Meta ou pelo celular.";
  } else if (status !== null && status >= 400) {
    no_ar = false;
    motivo = `O endereço respondeu ${status}.`;
  } else if (SINAIS_DE_FORA_DO_AR.some((r) => r.test(texto) || r.test(titulo))) {
    no_ar = false;
    motivo = "A página diz que o conteúdo não está disponível.";
  } else if (og.titulo || og.imagem || texto.trim().length > 40) {
    no_ar = true;
    motivo = "A página abriu e mostra o conteúdo.";
  } else {
    no_ar = "inconclusivo";
    motivo = "A página abriu, mas sem conteúdo legível.";
  }
  await passos.provar(png, no_ar === true ? "Post no ar" : no_ar === false ? "Post fora do ar" : "Não deu para conferir");
  const imagens: Imagem[] = passos.ultimo ? [{ rotulo: "Print do post", storage_path: passos.ultimo }] : [];
  return { no_ar, motivo, status, url_final, titulo, og, imagens, fontes: [t.url_inicial] };
}

/** Tempos e peso da navegação (Navigation Timing e Resource Timing do próprio Chromium). */
async function temposDaPagina(nav: NavegadorDoAgente): Promise<{ ttfb_ms: number | null; dom_ms: number | null; load_ms: number | null; peso_kb: number | null; recursos: number; imagens_pesadas: Array<{ url: string; kb: number }> }> {
  return await nav.pagina
    .evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const r = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const ms = (v: number | undefined) => (typeof v === "number" && v > 0 ? Math.round(v) : null);
      const bytes = (n ? n.transferSize || 0 : 0) + r.reduce((s, x) => s + (x.transferSize || 0), 0);
      const pesadas = r
        .filter((x) => x.initiatorType === "img" && (x.transferSize || x.encodedBodySize || 0) > 500_000)
        .slice(0, 8)
        .map((x) => ({ url: x.name.slice(0, 300), kb: Math.round((x.transferSize || x.encodedBodySize || 0) / 1024) }));
      return {
        ttfb_ms: n ? ms(n.responseStart - n.requestStart) : null,
        dom_ms: n ? ms(n.domContentLoadedEventEnd) : null,
        load_ms: n ? ms(n.loadEventEnd) : null,
        peso_kb: bytes > 0 ? Math.round(bytes / 1024) : null,
        recursos: r.length,
        imagens_pesadas: pesadas,
      };
    })
    .catch(() => ({ ttfb_ms: null, dom_ms: null, load_ms: null, peso_kb: null, recursos: 0, imagens_pesadas: [] }));
}

export interface LinkConferido {
  url: string;
  status: number | null;
  erro?: string;
}

/**
 * Links do próprio site (mesma origem da página), conferidos de dentro do Chromium com HEAD (GET quando o
 * servidor recusa HEAD): passam pelas mesmas travas de rede (só leitura, rede interna bloqueada) e redirecionamento
 * não é seguido. Link de outro host fica "não conferido" (o navegador não lê o status entre origens).
 */
export async function conferirLinks(nav: NavegadorDoAgente, maximo = MAX_LINKS_CONFERIDOS): Promise<{ conferidos: LinkConferido[]; quebrados: LinkConferido[]; externos: number; nao_conferidos: number; total: number }> {
  const todos = await nav.pagina
    .evaluate(() => {
      const vistos: Record<string, boolean> = {};
      const lista: string[] = [];
      Array.prototype.slice.call(document.querySelectorAll("a[href]")).forEach((a: HTMLAnchorElement) => {
        const href = String(a.href || "");
        if (!/^https?:/i.test(href)) return;
        const sem = href.split("#")[0];
        if (!sem || vistos[sem]) return;
        vistos[sem] = true;
        lista.push(sem);
      });
      return { origem: location.origin, lista: lista.slice(0, 400) };
    })
    .catch(() => ({ origem: "", lista: [] as string[] }));
  const internos = todos.lista.filter((u) => u.indexOf(`${todos.origem}/`) === 0 || u === todos.origem);
  const externos = todos.lista.length - internos.length;
  const alvo = internos.slice(0, maximo);
  const conferidos = (await nav.pagina
    .evaluate(async (urls: string[]) => {
      const um = async (url: string) => {
        const pedir = async (metodo: string) => {
          const c = new AbortController();
          const prazo = setTimeout(() => c.abort(), 8000);
          try {
            const r = await fetch(url, { method: metodo, redirect: "manual", credentials: "omit", cache: "no-store", signal: c.signal });
            return r.type === "opaqueredirect" ? 300 : r.status;
          } finally {
            clearTimeout(prazo);
          }
        };
        try {
          let s = await pedir("HEAD");
          if (s === 405 || s === 501) s = await pedir("GET");
          return { url, status: s };
        } catch (e) {
          return { url, status: null, erro: String((e && (e as Error).name) || "erro").slice(0, 60) };
        }
      };
      const saida: Array<{ url: string; status: number | null; erro?: string }> = [];
      for (let i = 0; i < urls.length; i += 5) saida.push(...(await Promise.all(urls.slice(i, i + 5).map(um))));
      return saida;
    }, alvo)
    .catch(() => [])) as LinkConferido[];
  const quebrados = conferidos.filter((l) => l.status === null || l.status >= 400);
  return { conferidos, quebrados, externos, nao_conferidos: Math.max(0, internos.length - alvo.length), total: todos.lista.length };
}

const segundos = (ms: number | null) => (ms === null ? "?" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
const peso = (kb: number) => (kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1).replace(".", ",")} MB`);

async function conferirSite(nav: NavegadorDoAgente, t: TarefaDoNavegador, passos: Passos): Promise<Record<string, unknown>> {
  const inicio = Date.now();
  const status = await nav.ir(t.url_inicial, 45_000);
  const total_ms = Date.now() - inicio;
  await pararSeProibida(nav);
  const titulo = await nav.pagina.title().catch(() => "");
  const tempos = await temposDaPagina(nav);
  const imagens: Imagem[] = [];
  const r0 = await passos.provar(await nav.pagina.screenshot({ type: "png" }), `Site aberto (${status ?? "sem status"}, ${segundos(tempos.load_ms || total_ms)})`);
  if (passos.ultimo) imagens.push({ rotulo: "Primeira tela no computador", storage_path: passos.ultimo });
  const links = await conferirLinks(nav);
  const avisos: string[] = [];
  if (status === null) avisos.push("A página não respondeu dentro do prazo.");
  else if (status >= 400) avisos.push(`O endereço respondeu ${status}.`);
  if (tempos.ttfb_ms !== null && tempos.ttfb_ms > 800) avisos.push(`O servidor demora para responder (${tempos.ttfb_ms} ms até o primeiro byte; o bom é abaixo de 800 ms).`);
  const carga = tempos.load_ms || total_ms;
  if (carga > 4000) avisos.push(`A página demora para carregar (${segundos(carga)}; o bom é abaixo de 4 s).`);
  if (tempos.peso_kb !== null && tempos.peso_kb > 3000) avisos.push(`A página está pesada (${peso(tempos.peso_kb)}).`);
  tempos.imagens_pesadas.forEach((i) => avisos.push(`Imagem pesada (${i.kb} KB): ${i.url}`));
  links.quebrados.slice(0, 20).forEach((l) => avisos.push(`Link quebrado (${l.status === null ? l.erro || "sem resposta" : l.status}): ${l.url}`));
  if (links.nao_conferidos) avisos.push(`${links.nao_conferidos} link(s) do site ficaram sem conferir (limite de ${MAX_LINKS_CONFERIDOS} por vez).`);
  const resumo = [
    status === null ? "Não respondeu" : `Respondeu ${status} em ${segundos(carga)}`,
    links.conferidos.length ? `${links.quebrados.length} link(s) quebrado(s) de ${links.conferidos.length} conferido(s)` : "sem links internos",
    tempos.peso_kb !== null ? peso(tempos.peso_kb) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const base = { titulo, url_final: nav.pagina.url(), status, resumo, tempos: { ...tempos, total_ms }, links: { conferidos: links.conferidos.length, quebrados: links.quebrados, externos: links.externos, nao_conferidos: links.nao_conferidos, total: links.total }, avisos, fontes: [t.url_inicial] };
  if (r0 === "teto") return { ...base, imagens, parcial: true };
  const p = await paginaInteira(nav, passos, imagens);
  return { ...base, capturas: p.capturas, imagens, ...(p.parcial ? { parcial: true } : {}) };
}

// ------------------------------------------------------------------ leituras do código da página

export interface EstiloDaPagina {
  cores: Array<{ hex: string; peso: number }>;
  fontes: Array<{ familia: string; peso: number }>;
  tema: string;
  logos: Array<{ src: string; alt: string; x: number; y: number; largura: number; altura: number }>;
  icone: string;
  botao: { fundo: string; texto: string; raio: string } | null;
}

/** Cores (pela área que ocupam), fontes (pelo texto), logo, ícone e botão, lidos do CSS computado. */
export async function estiloDaPagina(nav: NavegadorDoAgente): Promise<EstiloDaPagina> {
  return await nav.pagina
    .evaluate(() => {
      const hex = (c: string) => {
        const m = String(c || "").match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/);
        if (!m) return "";
        if (m[4] !== undefined && Number(m[4]) < 0.5) return "";
        return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
      };
      const cores: Record<string, number> = {};
      const fontes: Record<string, number> = {};
      const els = Array.prototype.slice.call(document.querySelectorAll("body, header, nav, main, section, footer, h1, h2, h3, p, a, button, li, span")).slice(0, 600) as HTMLElement[];
      els.forEach((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const fundo = hex(cs.backgroundColor);
        if (fundo) cores[fundo] = (cores[fundo] || 0) + Math.min(r.width * r.height, 2_000_000) / 10_000;
        const texto = (el.childNodes.length && Array.prototype.some.call(el.childNodes, (n: Node) => n.nodeType === 3 && String(n.textContent || "").trim())) ? String(el.textContent || "").trim().length : 0;
        if (texto) {
          const cor = hex(cs.color);
          if (cor) cores[cor] = (cores[cor] || 0) + Math.min(texto, 400) / 20;
          const fam = String(cs.fontFamily || "").split(",")[0].replace(/["']/g, "").trim();
          if (fam) fontes[fam] = (fontes[fam] || 0) + Math.min(texto, 2000);
        }
      });
      const ordenar = (o: Record<string, number>) => Object.keys(o).map((k) => ({ k, v: o[k] })).sort((a, b) => b.v - a.v);
      const meta = (n: string) => {
        const el = document.querySelector(`meta[name="${n}"]`);
        return el ? String(el.getAttribute("content") || "") : "";
      };
      const logos = (Array.prototype.slice.call(document.querySelectorAll("header img, nav img, header svg, nav svg, img[src*='logo' i], img[alt*='logo' i], img[class*='logo' i], [class*='logo' i] img, [class*='logo' i] svg, [id*='logo' i] img")) as Element[])
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { src: el.tagName === "IMG" ? String((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || "").slice(0, 400) : "svg", alt: String(el.getAttribute("alt") || el.getAttribute("aria-label") || "").slice(0, 120), x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), largura: Math.round(r.width), altura: Math.round(r.height) };
        })
        .filter((l) => l.largura >= 16 && l.altura >= 10 && l.y < 600)
        .slice(0, 3);
      const icone = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
      const b = document.querySelector("button, a[class*='btn' i], a[class*='button' i]") as HTMLElement | null;
      const bcs = b ? getComputedStyle(b) : null;
      return {
        cores: ordenar(cores).slice(0, 8).map((x) => ({ hex: x.k, peso: Math.round(x.v) })),
        fontes: ordenar(fontes).slice(0, 4).map((x) => ({ familia: x.k.slice(0, 60), peso: Math.round(x.v) })),
        tema: meta("theme-color").slice(0, 30),
        logos,
        icone: icone ? String(icone.href || "").slice(0, 400) : "",
        botao: bcs ? { fundo: hex(bcs.backgroundColor), texto: hex(bcs.color), raio: String(bcs.borderTopLeftRadius || "") } : null,
      };
    })
    .catch(() => ({ cores: [], fontes: [], tema: "", logos: [], icone: "", botao: null }));
}

const textoDoEstilo = (e: EstiloDaPagina) =>
  [
    `cores (da mais presente para a menos): ${e.cores.map((c) => c.hex).join(", ") || "nenhuma lida"}`,
    `fontes: ${e.fontes.map((f) => f.familia).join(", ") || "nenhuma lida"}`,
    e.tema ? `theme-color: ${e.tema}` : "",
    e.botao ? `botão: fundo ${e.botao.fundo || "transparente"}, texto ${e.botao.texto}, cantos ${e.botao.raio}` : "",
    e.logos.length ? `logo: ${e.logos[0].alt || e.logos[0].src}` : "logo: não achado no código",
  ]
    .filter(Boolean)
    .join("\n");

/** Print do topo da página e, quando o logo foi achado no código, um recorte dele. */
async function printsDaIdentidade(nav: NavegadorDoAgente, passos: Passos, e: EstiloDaPagina, rotulo: string, imagens: Imagem[]): Promise<RespostaDoPasso> {
  await nav.pagina.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  const topo = await nav.pagina.screenshot({ type: "png" });
  let r = await passos.provar(topo, `Topo de ${rotulo}`, 0, "topo");
  if (passos.ultimo) imagens.push({ rotulo: `Topo de ${rotulo}`, storage_path: passos.ultimo });
  const l = e.logos[0];
  if (r !== "teto" && l && l.y + l.altura <= TELA.altura) {
    const margem = 8;
    const x = Math.max(0, l.x - margem);
    const y = Math.max(0, l.y - margem);
    const largura = Math.min(TELA.largura - x, l.largura + margem * 2);
    const altura = Math.min(TELA.altura - y, l.altura + margem * 2);
    if (largura > 8 && altura > 8) {
      const recorte = await nav.pagina.screenshot({ type: "png", clip: { x, y, width: largura, height: altura } }).catch(() => null);
      if (recorte) {
        r = await passos.provar(recorte, `Logo de ${rotulo}`, 0, "logo");
        if (passos.ultimo) imagens.push({ rotulo: `Logo de ${rotulo}`, storage_path: passos.ultimo });
      }
    }
  }
  return r;
}

// ------------------------------------------------------------------ casos com modelo

interface Modelagem {
  amb: Ambiente;
  qual: ModeloDoComputador;
  gasto: GastoDoModelo;
}

const sessaoDo = (m: Modelagem, caso: CasoDoNavegador) => abrirSessao(m.qual, { anthropic: m.amb.modelo, openai: m.amb.openai || null }, sistemaDoCaso(caso));

async function coletaPublica(nav: NavegadorDoAgente, t: TarefaDoNavegador, passos: Passos, m: Modelagem): Promise<Record<string, unknown>> {
  const status = await nav.ir(t.url_inicial);
  const proibida = await nav.paginaProibida();
  if (proibida) throw new Error(proibida);
  const titulo = await nav.pagina.title().catch(() => "");
  const inicial = await nav.pagina.screenshot({ type: "png" });
  const imagens: Imagem[] = [];
  const r0 = await passos.provar(inicial, `Página aberta (${status ?? "sem status"})`);
  if (passos.ultimo) imagens.push({ rotulo: "Página aberta", storage_path: passos.ultimo });
  if (r0 === "teto") return { parcial: true, dados: [], avisos: ["Teto de passos."], imagens, titulo, fontes: [t.url_inicial] };
  const sessao = sessaoDo(m, "coleta_publica");
  const r = await lacoDoModelo(nav, t, passos, sessao, { objetivo: String(t.objetivo || ""), contexto: titulo ? `título da página: ${titulo}` : "", inicial }, m.gasto);
  return { ...(r.final || { resumo: "Parou no teto antes da resposta final.", dados: [], avisos: ["Teto de passos ou de custo."] }), parcial: r.parcial, titulo, imagens, fontes: [t.url_inicial] };
}

async function capturarReferencia(nav: NavegadorDoAgente, t: TarefaDoNavegador, passos: Passos, m: Modelagem): Promise<Record<string, unknown>> {
  const status = await nav.ir(t.url_inicial);
  await pararSeProibida(nav);
  const titulo = await nav.pagina.title().catch(() => "");
  const imagens: Imagem[] = [];
  const r0 = await passos.provar(await nav.pagina.screenshot({ type: "png" }), `Página aberta (${status ?? "sem status"})`);
  if (r0 === "teto") return { titulo, status, parcial: true, imagens, fontes: [t.url_inicial] };
  const p = await paginaInteira(nav, passos, imagens, true);
  const estilo = await estiloDaPagina(nav);
  const base = { titulo, url_final: nav.pagina.url(), status, capturas: p.capturas, estilo, imagens, fontes: [t.url_inicial] };
  if (p.parcial) return { ...base, resumo: "Parou no teto depois das capturas.", parcial: true };
  const sessao = sessaoDo(m, "capturar_referencia");
  const inicial = await nav.pagina.screenshot({ type: "png" });
  const r = await lacoDoModelo(nav, t, passos, sessao, { objetivo: String(t.objetivo || DEFINICOES_DOS_CASOS.capturar_referencia.objetivoPadrao), contexto: textoDoEstilo(estilo), inicial }, m.gasto);
  return { ...base, ...(r.final || { resumo: "Capturas feitas; o modelo parou no teto antes das notas.", notas: [], avisos: ["Teto de passos ou de custo."] }), parcial: r.parcial };
}

async function perfilPublico(nav: NavegadorDoAgente, t: TarefaDoNavegador, passos: Passos, m: Modelagem): Promise<Record<string, unknown>> {
  const status = await nav.ir(t.url_inicial);
  const titulo = await nav.pagina.title().catch(() => "");
  const og = await lerOg(nav);
  const imagens: Imagem[] = [];
  const inicial = await nav.pagina.screenshot({ type: "png" });
  const r0 = await passos.provar(inicial, `Perfil aberto (${status ?? "sem status"})`);
  if (passos.ultimo) imagens.push({ rotulo: "Perfil como aparece sem login", storage_path: passos.ultimo });
  const publico: Array<{ item: string; valor: string; fonte: string }> = [];
  if (og.titulo) publico.push({ item: "Título público", valor: og.titulo, fonte: t.url_inicial });
  if (og.descricao) publico.push({ item: "Descrição pública", valor: og.descricao, fonte: t.url_inicial });
  const base = { titulo, status, og, imagens, fontes: [t.url_inicial] };
  // Rede que pede login: fica o que já está público (título, descrição, imagem), sem tentar entrar.
  const proibida = await nav.paginaProibida();
  if (proibida || (status !== null && status >= 400)) {
    return {
      ...base,
      resumo: og.titulo || og.descricao ? `Só o que aparece sem login: ${og.titulo || og.descricao}`.slice(0, 300) : "A rede não mostrou o perfil sem login.",
      dados: publico,
      avisos: [proibida ? "A rede pediu login para mostrar o resto do perfil; o navegador do agente não entra. Ficou só o que é público." : `O endereço respondeu ${status}.`],
      sem_login: true,
    };
  }
  if (r0 === "teto") return { ...base, dados: publico, avisos: ["Teto de passos."], parcial: true };
  const sessao = sessaoDo(m, "perfil_publico");
  const contexto = [og.titulo && `og:title: ${og.titulo}`, og.descricao && `og:description: ${og.descricao}`].filter(Boolean).join("\n");
  const r = await lacoDoModelo(nav, t, passos, sessao, { objetivo: String(t.objetivo || DEFINICOES_DOS_CASOS.perfil_publico.objetivoPadrao), contexto, inicial }, m.gasto);
  const final = (r.final || { resumo: "Parou no teto antes da resposta final.", dados: [], avisos: ["Teto de passos ou de custo."] }) as Record<string, unknown>;
  const dados = Array.isArray(final.dados) ? (final.dados as unknown[]) : [];
  return { ...base, ...final, dados: [...publico, ...dados], parcial: r.parcial };
}

async function concorrentesVisuais(nav: NavegadorDoAgente, t: TarefaDoNavegador, passos: Passos, m: Modelagem): Promise<Record<string, unknown>> {
  const sites = [t.url_inicial].concat((t.urls || []).filter((u) => u !== t.url_inicial)).slice(0, 5);
  const imagens: Imagem[] = [];
  const concorrentes: Array<Record<string, unknown>> = [];
  const avisos: string[] = [];
  let parcial = false;
  for (const url of sites) {
    const nome = dominioDe(url) || url;
    if (!dominioPermitido(url, t.dominios)) {
      avisos.push(`${nome}: fora da lista de domínios.`);
      continue;
    }
    let status: number | null = null;
    try {
      status = await nav.ir(url);
    } catch (err) {
      avisos.push(`${nome}: ${err instanceof Error ? err.message.slice(0, 160) : "não abriu"}`);
      continue;
    }
    const proibida = await nav.paginaProibida();
    if (proibida) {
      avisos.push(`${nome}: ${proibida}`);
      continue;
    }
    const estilo = await estiloDaPagina(nav);
    const titulo = await nav.pagina.title().catch(() => "");
    const r1 = await printsDaIdentidade(nav, passos, estilo, nome, imagens);
    const ficha: Record<string, unknown> = { site: url, dominio: nome, titulo, status, cores_do_codigo: estilo.cores.map((c) => c.hex), fontes_do_codigo: estilo.fontes.map((f) => f.familia), tema: estilo.tema, logo_no_codigo: estilo.logos[0] || null, icone: estilo.icone };
    if (r1 === "teto") {
      concorrentes.push(ficha);
      parcial = true;
      break;
    }
    const sessao = sessaoDo(m, "concorrentes_visuais");
    const inicial = await nav.pagina.screenshot({ type: "png" });
    const r = await lacoDoModelo(nav, t, passos, sessao, { objetivo: String(t.objetivo || DEFINICOES_DOS_CASOS.concorrentes_visuais.objetivoPadrao), contexto: `${titulo ? `título: ${titulo}\n` : ""}${textoDoEstilo(estilo)}`, inicial, maxTurnos: TURNOS_POR_SITE }, m.gasto);
    concorrentes.push({ ...ficha, ...(r.final || {}), leitura_completa: !!r.final });
    if (r.parcial && !r.final) {
      // Teto da tarefa (não só os turnos do site): para aqui com o que já tem.
      if (passos.feitos >= Number(t.teto_passos) || m.gasto.custo > Number(t.teto_custo_usd)) {
        parcial = true;
        break;
      }
    }
  }
  const lidos = concorrentes.length;
  const resumo = lidos ? `${lidos} concorrente(s) lido(s): ${concorrentes.map((c) => String(c.nome || c.dominio)).join(", ")}.` : "Nenhum site de concorrente abriu.";
  return { resumo, concorrentes, avisos, imagens, fontes: sites, ...(parcial ? { parcial: true } : {}) };
}

// ------------------------------------------------------------------ principal

export interface Saida {
  estado: "feita" | "falhou" | "parada";
  motivo: string | null;
  resultado: Record<string, unknown>;
}

export async function umaTarefa(amb: Ambiente, t: TarefaDoNavegador, token: string): Promise<Saida> {
  const log = amb.log || (() => undefined);
  const recusa = motivoParaNaoRodar(t, amb);
  if (recusa) {
    await amb.fila.concluir(t.id, token, "falhou", { recusada: true }, recusa);
    return { estado: "falhou", motivo: recusa, resultado: { recusada: true } };
  }
  const passos = criarPassos(amb, t, token);
  const def = DEFINICOES_DOS_CASOS[t.caso as CasoDoNavegador];
  const gasto = gastoZerado();
  let qual: ModeloDoComputador | null = null;
  let nav: NavegadorDoAgente | null = null;
  let resultado: Record<string, unknown> = {};
  try {
    if (def.usaModelo) qual = await modeloDaTarefa(amb, t);
    nav = await amb.abrir({ dominios: t.dominios });
    log(`[navegador] ${t.id} ${t.caso} ${t.url_inicial}${qual ? ` · ${qual.id}` : ""}`);
    const m: Modelagem | null = qual ? { amb, qual, gasto } : null;
    if (t.caso === "captura_site") resultado = await capturaSite(nav, t, passos);
    else if (t.caso === "conferir_post") resultado = await conferirPost(nav, t, passos);
    else if (t.caso === "conferir_site") resultado = await conferirSite(nav, t, passos);
    else if (t.caso === "capturar_referencia") resultado = await capturarReferencia(nav, t, passos, m as Modelagem);
    else if (t.caso === "perfil_publico") resultado = await perfilPublico(nav, t, passos, m as Modelagem);
    else if (t.caso === "concorrentes_visuais") resultado = await concorrentesVisuais(nav, t, passos, m as Modelagem);
    else resultado = await coletaPublica(nav, t, passos, m as Modelagem);
    if (qual) {
      resultado.modelo = qual.id;
      resultado.custo_usd = Math.round(gasto.custo * 10000) / 10000;
    }
    resultado.bloqueios = nav.bloqueios.slice(0, 50);
    resultado.passos = passos.feitos;
    const ok = await amb.fila.concluir(t.id, token, "feita", resultado, resultado.parcial ? "Parou no teto de passos ou de custo, com o que já tinha." : null);
    return ok ? { estado: "feita", motivo: null, resultado } : { estado: "parada", motivo: "Parada pelo dono.", resultado };
  } catch (err) {
    const bloqueios = nav ? nav.bloqueios.slice(0, 50) : [];
    if (err instanceof Parada && err.tipo === "parar") return { estado: "parada", motivo: err.message, resultado: { bloqueios, passos: passos.feitos } };
    const motivo = err instanceof Parada || err instanceof ParadaDoModelo ? err.message : `Falhou: ${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`;
    // Página proibida ainda deixa a prova do que o agente viu.
    if (err instanceof Parada && err.tipo === "proibida" && nav) {
      try {
        await passos.provar(await nav.pagina.screenshot({ type: "png" }), "Onde parei");
      } catch (e) {
        // A parada vale mesmo sem o print; o motivo fica no log.
        console.error(`[navegador] print de onde parei falhou (tarefa ${t.id}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await amb.fila.concluir(t.id, token, "falhou", { ...resultado, bloqueios, passos: passos.feitos, ...(qual ? { modelo: qual.id, custo_usd: Math.round(gasto.custo * 10000) / 10000 } : {}) }, motivo).catch((e) => {
      console.error(`[navegador] não consegui fechar a tarefa ${t.id} como falhou: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    });
    return { estado: "falhou", motivo, resultado: { bloqueios, passos: passos.feitos } };
  } finally {
    // O que o modelo gastou vai para a carteira mesmo quando a tarefa para no meio (recusa, teto, Parar).
    if (qual && t.client_id && gasto.custo > 0) {
      await amb.fila
        .registrarUso({ clientId: t.client_id, tarefaId: t.id, modeloId: qual.id, provedor: qual.provedor, tokensEntrada: gasto.entrada, tokensSaida: gasto.saida, tokensCache: gasto.cache, custoUsd: gasto.custo, criadoPor: t.criado_por })
        .catch((err) => console.error(`[navegador] uso do modelo não registrado na carteira (tarefa ${t.id}): ${err instanceof Error ? err.message : String(err)}`));
    }
    if (nav) await nav.fechar();
  }
}

/** Pega uma tarefa e roda. false = fila vazia. */
export async function pegarERodar(amb: Ambiente): Promise<boolean> {
  const casos = casosDoWorker(amb);
  if (!casos.length) return false;
  const token = randomUUID();
  const t = await amb.fila.pegar(token, amb.executor, casos, amb.versao, provedoresDoWorker(amb));
  if (!t) return false;
  await umaTarefa(amb, t, token);
  return true;
}
