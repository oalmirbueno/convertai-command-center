/**
 * Uma tarefa do navegador do agente, do começo ao fim (frente MOD).
 *
 * Ordem fixa, sem laço de correção (uma tentativa por Confirmar do dono):
 * 1. confere de novo as travas da tarefa (aprovada pelo dono, caso ligado,
 *    URL pública fora de login e pagamento, domínio na lista);
 * 2. abre um Chromium isolado com a lista de domínios;
 * 3. roda o roteiro do caso: captura_site e conferir_post são fixos (sem
 *    modelo); coleta_publica usa o computer use do Claude (modelo.ts);
 * 4. cada passo sobe um print para o Storage e passa pela RPC
 *    computador_tarefa_passo, que diz se segue, se o dono parou ou se bateu
 *    no teto de passos ou de custo;
 * 5. fecha a tarefa com o resultado (ou com o motivo da parada).
 */

import { randomUUID } from "node:crypto";
import {
  casoLigado,
  type CasoDoNavegador,
  dominioPermitido,
  CASOS_DO_NAVEGADOR,
  motivoParaRecusarNoNavegador,
  normalizarPedidoDoNavegador,
  podeExecutar,
} from "../../supabase/functions/computador-do-agente/modulos/navegador.ts";
import { type Armazem, caminhoDaProva, type Fila, type RespostaDoPasso, type TarefaDoNavegador } from "./fila.ts";
import { type NavegadorDoAgente, type OpcoesDoNavegador, rolarAteOFim, TELA, TELA_DO_CELULAR } from "./navegador.ts";
import { coletarComModelo, type ClienteDoModelo, type ModeloDoComputador } from "./modelo.ts";

/** Altura máxima da captura de página inteira (px): página infinita não vira PNG gigante. */
export const ALTURA_MAXIMA_DA_CAPTURA = 16_000;

export interface Ambiente {
  fila: Fila;
  armazem: Armazem;
  abrir: (op: OpcoesDoNavegador) => Promise<NavegadorDoAgente>;
  /** Caso com modelo só com COMPUTADOR_COM_MODELO_LIGADO=1 E um cliente de modelo com chave. */
  comModelo: boolean;
  modelo: ClienteDoModelo | null;
  /** Qual Claude faz o computer use (padrão Sonnet 5.5; COMPUTADOR_MODELO=opus-5-5 troca). */
  qualModelo?: ModeloDoComputador;
  executor: string;
  versao: string;
  log?: (msg: string) => void;
}

/** Os casos que este worker aceita pegar agora. */
export function casosDoWorker(amb: Pick<Ambiente, "comModelo" | "modelo">): CasoDoNavegador[] {
  return CASOS_DO_NAVEGADOR.filter((c) => casoLigado(c, amb.comModelo && !!amb.modelo));
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
  provar(png: Uint8Array, legenda: string, custoUsd?: number, sufixo?: string): Promise<RespostaDoPasso>;
}

function criarPassos(amb: Ambiente, t: TarefaDoNavegador, token: string): Passos {
  const p: Passos = {
    feitos: 0,
    async provar(png, legenda, custoUsd = 0, sufixo = "") {
      const numero = p.feitos + 1;
      const caminho = await amb.armazem.guardar(caminhoDaProva(t, numero, sufixo), png);
      const r = await amb.fila.passo(t.id, token, { passo: numero, storage_path: caminho, legenda: legenda.slice(0, 200), em: new Date().toISOString() }, custoUsd);
      p.feitos = numero;
      if (r === "parar") throw new Parada("parar", `Parada pelo dono no passo ${numero}.`);
      return r;
    },
  };
  return p;
}

/** Confere de novo, no worker, tudo o que a função conferiu (defesa em profundidade). */
export function motivoParaNaoRodar(t: TarefaDoNavegador, amb: Pick<Ambiente, "comModelo" | "modelo">): string | null {
  if (!podeExecutar(t)) return "A tarefa não tem o Confirmar do dono.";
  if ((CASOS_DO_NAVEGADOR as readonly string[]).indexOf(t.caso) < 0) return "Caso desconhecido.";
  if (!(t.dominios || []).length || !dominioPermitido(t.url_inicial, t.dominios)) return "O endereço inicial está fora da lista de domínios.";
  const motivo = motivoParaRecusarNoNavegador(
    normalizarPedidoDoNavegador({ caso: t.caso, url: t.url_inicial, dominios: t.dominios, objetivo: t.objetivo, origem: t.origem, client_id: t.client_id }),
    amb.comModelo && !!amb.modelo,
  );
  return motivo;
}

async function pararSeProibida(nav: NavegadorDoAgente) {
  const motivo = await nav.paginaProibida();
  if (motivo) throw new Parada("proibida", motivo);
}

// ------------------------------------------------------------------ casos fixos

async function capturaSite(nav: NavegadorDoAgente, t: TarefaDoNavegador, passos: Passos): Promise<Record<string, unknown>> {
  const status = await nav.ir(t.url_inicial);
  await pararSeProibida(nav);
  const titulo = await nav.pagina.title().catch(() => "");
  if ((await passos.provar(await nav.pagina.screenshot({ type: "png" }), `Página aberta (${status ?? "sem status"})`)) === "teto") return { titulo, url_final: nav.pagina.url(), status, parcial: true };

  const altura = await rolarAteOFim(nav.pagina);
  await pararSeProibida(nav);
  const alturaDaCaptura = Math.min(altura || TELA.altura, ALTURA_MAXIMA_DA_CAPTURA);
  const inteira = await nav.pagina.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: TELA.largura, height: alturaDaCaptura } });
  const capturas: Array<{ tela: string; largura: number; altura: number }> = [{ tela: "computador", largura: TELA.largura, altura: alturaDaCaptura }];
  if ((await passos.provar(inteira, `Tela inteira no computador (${TELA.largura} x ${alturaDaCaptura} px)`, 0, "inteira")) === "teto") {
    return { titulo, url_final: nav.pagina.url(), status, altura, capturas, parcial: true };
  }

  await nav.pagina.setViewportSize({ width: TELA_DO_CELULAR.largura, height: TELA_DO_CELULAR.altura });
  await nav.pagina.reload({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined);
  await pararSeProibida(nav);
  const alturaCel = Math.min(await rolarAteOFim(nav.pagina), ALTURA_MAXIMA_DA_CAPTURA);
  const celular = await nav.pagina.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: TELA_DO_CELULAR.largura, height: Math.max(alturaCel, TELA_DO_CELULAR.altura) } });
  capturas.push({ tela: "celular", largura: TELA_DO_CELULAR.largura, altura: Math.max(alturaCel, TELA_DO_CELULAR.altura) });
  await passos.provar(celular, `Tela inteira no celular (${TELA_DO_CELULAR.largura} px)`, 0, "celular");
  return { titulo, url_final: nav.pagina.url(), status, altura, capturas };
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
  const og = await nav.pagina
    .evaluate(() => {
      const m = (p: string) => {
        const el = document.querySelector(`meta[property="${p}"]`);
        return el ? String(el.getAttribute("content") || "") : "";
      };
      return { titulo: m("og:title"), imagem: m("og:image"), url: m("og:url") };
    })
    .catch(() => ({ titulo: "", imagem: "", url: "" }));
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
  return { no_ar, motivo, status, url_final, titulo, og };
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
  let nav: NavegadorDoAgente | null = null;
  let resultado: Record<string, unknown> = {};
  try {
    nav = await amb.abrir({ dominios: t.dominios });
    log(`[navegador] ${t.id} ${t.caso} ${t.url_inicial}`);
    if (t.caso === "captura_site") resultado = await capturaSite(nav, t, passos);
    else if (t.caso === "conferir_post") resultado = await conferirPost(nav, t, passos);
    else resultado = await coletarComModelo(nav, t, passos, amb.modelo as ClienteDoModelo, amb.fila, amb.qualModelo);
    resultado.bloqueios = nav.bloqueios.slice(0, 50);
    resultado.passos = passos.feitos;
    const ok = await amb.fila.concluir(t.id, token, "feita", resultado, resultado.parcial ? "Parou no teto de passos ou de custo, com o que já tinha." : null);
    return ok ? { estado: "feita", motivo: null, resultado } : { estado: "parada", motivo: "Parada pelo dono.", resultado };
  } catch (err) {
    const bloqueios = nav ? nav.bloqueios.slice(0, 50) : [];
    if (err instanceof Parada && err.tipo === "parar") return { estado: "parada", motivo: err.message, resultado: { bloqueios, passos: passos.feitos } };
    const motivo = err instanceof Parada ? err.message : `Falhou: ${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`;
    // Página proibida ainda deixa a prova do que o agente viu.
    if (err instanceof Parada && err.tipo === "proibida" && nav) {
      try {
        await passos.provar(await nav.pagina.screenshot({ type: "png" }), "Onde parei");
      } catch (e) {
        // A parada vale mesmo sem o print; o motivo fica no log.
        console.error(`[navegador] print de onde parei falhou (tarefa ${t.id}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await amb.fila.concluir(t.id, token, "falhou", { ...resultado, bloqueios, passos: passos.feitos }, motivo).catch((e) => {
      console.error(`[navegador] não consegui fechar a tarefa ${t.id} como falhou: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    });
    return { estado: "falhou", motivo, resultado: { bloqueios, passos: passos.feitos } };
  } finally {
    if (nav) await nav.fechar();
  }
}

/** Pega uma tarefa e roda. false = fila vazia. */
export async function pegarERodar(amb: Ambiente): Promise<boolean> {
  const casos = casosDoWorker(amb);
  if (!casos.length) return false;
  const token = randomUUID();
  const t = await amb.fila.pegar(token, amb.executor, casos, amb.versao);
  if (!t) return false;
  await umaTarefa(amb, t, token);
  return true;
}
