import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";
import { novoUid } from "@/lib/mesa-videos/api";
import { quadroDoVideoNoStorage } from "@/lib/mesa-videos/quadros";
import {
  fotoDaLigacao,
  ligar,
  mudarDados,
  novoNo,
  TAMANHO_DA_SAIDA,
  TAMANHO_DO_QUADRO,
  TAMANHO_DO_VIDEO,
  type Canvas,
  type Ligacao,
  type NoDoCanvas,
  type ResultadoDoCanvas,
} from "../canvasApi";
import { cenasDaHistoria } from "./historia";
import { duracaoNoMotor, duracoesDoMotor, motorPorId, type MotorDeVideo } from "../../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import {
  DURACOES_DO_VIDEO,
  EM_ANDAMENTO,
  lerDadosDoVideo,
  pedidoAtualizado,
  pedidoDoVideo,
  refDoPlano,
  ultimoVideo,
  type CenaParaOVideo,
  type DadosDoVideo,
  type PedidoDoVideoNoCanvas,
} from "../../../../supabase/functions/mesa-foto/modulos/video-do-canvas";
import type { MidiaDaCamada, QuadroAnimado } from "../../../../supabase/functions/mesa-foto/modulos/quadro-animado";

/**
 * Cartão Vídeo do Canvas na tela (frente CNV, 30/09). Sem React e sem React
 * Flow: o que entra no cartão (foto do 1º quadro, último quadro, vídeo a
 * continuar), o que falta para gerar, o pedido à Mesa Vídeos (mesmo motor,
 * mesmo custo confirmado, mesma carteira) e a consulta do andamento.
 *
 * Consulta do andamento sem laço de correção: ao abrir (se há pedido em
 * andamento), no botão "Conferir" e, enquanto o canvas está aberto, com
 * intervalo crescente (45 s, 90 s, depois 3 min) até o fim ou o prazo do
 * motor. O servidor ainda trava 15 s por pedido.
 */

export interface EntradasDoVideo {
  inicio: { ligacao: Ligacao; no: NoDoCanvas; foto: ResultadoDoCanvas | null } | null;
  final: { ligacao: Ligacao; no: NoDoCanvas; foto: ResultadoDoCanvas | null } | null;
  continuar: { ligacao: Ligacao; no: NoDoCanvas; video: ReturnType<typeof ultimoVideo> } | null;
}

export function entradasDoVideo(c: Pick<Canvas, "nos" | "ligacoes">, videoId: string, aprovadas: string[] = []): EntradasDoVideo {
  const saida: EntradasDoVideo = { inicio: null, final: null, continuar: null };
  c.ligacoes
    .filter((l) => l.para === videoId)
    .forEach((l) => {
      const no = c.nos.find((n) => n.id === l.de);
      if (!no) return;
      if (l.entrada === "continuar" && no.tipo === "video") saida.continuar = { ligacao: l, no, video: ultimoVideo(no.dados.video || lerDadosDoVideo({})) };
      if ((l.entrada === "inicio" || l.entrada === "final") && no.tipo === "gerar") saida[l.entrada] = { ligacao: l, no, foto: fotoDaLigacao(no, l.imagem_id, aprovadas) };
    });
  return saida;
}

/** Modo da geração pelo que está ligado. */
export function modoDoVideo(e: EntradasDoVideo): PedidoDoVideoNoCanvas["modo"] {
  if (e.continuar) return "continuar";
  if (e.inicio && e.final) return "primeiro_ultimo";
  return "primeiro_quadro";
}

/** Requisito para o seletor de motor (mesma regra da Mesa Vídeos). */
export function requisitoDoVideo(e: EntradasDoVideo, d: DadosDoVideo): { modo: "primeiro_quadro" | "primeiro_ultimo"; audio: boolean; formato: string } {
  return { modo: modoDoVideo(e) === "primeiro_ultimo" ? "primeiro_ultimo" : "primeiro_quadro", audio: d.audio, formato: d.formato };
}

/** A cena do Resultado de onde a foto vem (para o pedido e o plano_ref). */
export function cenaParaOVideo(c: Pick<Canvas, "nos">, no: NoDoCanvas | null): CenaParaOVideo | null {
  if (!no || !no.dados.cena) return null;
  const h = cenasDaHistoria(c).find((x) => x.no.id === no.id);
  const cena = no.dados.cena;
  return { numero: h ? h.numero : null, titulo: cena.titulo, acao: cena.acao, narrativa: cena.narrativa, cenario: cena.cenario, enquadramento: cena.enquadramento };
}

/** Por que ainda não dá para gerar (dito antes, igual às recusas da função). */
export function bloqueiosDoVideo(e: EntradasDoVideo, d: DadosDoVideo): string[] {
  const b: string[] = [];
  if (e.continuar && (e.inicio || e.final)) b.push("Este Vídeo continua outro E parte de uma foto: desligue uma das duas entradas.");
  if (!e.inicio && !e.continuar) b.push("Ligue a foto de um Resultado na alça 1º quadro (ou outro Vídeo para continuar).");
  if (e.inicio && !e.inicio.foto) b.push("Gere a foto do Resultado ligado antes: ela é o 1º quadro.");
  if (e.inicio && e.inicio.foto && (e.inicio.foto.storage_bucket || "mesa") !== "mesa") b.push("A foto do 1º quadro precisa estar no acervo do cliente.");
  if (e.final && !e.final.foto) b.push("Gere a foto do Resultado do último quadro, ou desligue.");
  if (e.continuar && !e.continuar.video) b.push("O Vídeo ligado ainda não tem vídeo pronto para continuar.");
  if (!d.motor) b.push("Escolha o motor de vídeo.");
  if (DURACOES_DO_VIDEO.indexOf(d.duracao_s) < 0 && (d.duracao_s < 2 || d.duracao_s > 15)) b.push("Duração fora do que os motores fazem.");
  return b;
}

/**
 * Durações oferecidas para o motor: a lista dele quando é curta; numa faixa
 * longa (2 a 15 s), as usuais da casa mais a mínima e a máxima do motor, para
 * 10, 12 e 15 s sempre aparecerem. A atual entra se o motor a aceita.
 */
export function duracoesNaTela(motor: MotorDeVideo | null, atual?: number): number[] {
  if (!motor) return DURACOES_DO_VIDEO.slice();
  const l = duracoesDoMotor(motor);
  if (l.length <= 8) return l;
  const min = l[0];
  const max = l[l.length - 1];
  const escolhidas = l.filter((x) => x === min || x === max || DURACOES_DO_VIDEO.indexOf(x) >= 0 || x === atual);
  return escolhidas.filter((x, i) => escolhidas.indexOf(x) === i).sort((a, b) => a - b);
}

/** Trocar de motor leva a duração para a mais próxima que ele aceita (o custo da tela sai da que será usada). */
export function dadosComMotor(d: DadosDoVideo, id: string | null, motores?: MotorDeVideo[]): DadosDoVideo {
  const m = id ? motorPorId(id, motores && motores.length ? motores : undefined) : null;
  return { ...d, motor: id, duracao_s: m ? duracaoNoMotor(m, d.duracao_s) : d.duracao_s };
}

/** O pedido escrito pelo código, quando a pessoa ainda não escreveu o dela. */
export function pedidoPadraoDoVideo(c: Pick<Canvas, "nos">, e: EntradasDoVideo, d: DadosDoVideo): string {
  const origem = e.inicio ? e.inicio.no : null;
  return pedidoDoVideo({ cena: cenaParaOVideo(c, origem), movimento: d.movimento, audio: d.audio, final: !!e.final, continuar: !!e.continuar });
}

/** Corpo do pedido à função mesa-videos (cena_gerar ou continuar_video). */
export function corpoDoGerarVideo(p: {
  clientId: string;
  canvas: Pick<Canvas, "nos">;
  entradas: EntradasDoVideo;
  dados: DadosDoVideo;
  titulo: string;
  uid: string;
  custoConfirmado: number;
  quadroDoContinuar?: string | null;
}): Record<string, unknown> {
  const d = p.dados;
  const e = p.entradas;
  const prompt = (d.prompt || "").trim() || pedidoPadraoDoVideo(p.canvas, e, d);
  const cena = cenaParaOVideo(p.canvas, e.inicio ? e.inicio.no : null);
  const comum: Record<string, unknown> = {
    client_id: p.clientId,
    motor: d.motor,
    prompt,
    duracao_s: d.duracao_s,
    formato: d.formato,
    audio: d.audio,
    variacoes: d.variacoes,
    titulo: p.titulo.slice(0, 120),
    uid: p.uid,
    custo_confirmado_usd: p.custoConfirmado,
  };
  if (d.negativo.trim()) comum.negativo = d.negativo.trim();
  if (d.resolucao) comum.resolucao = d.resolucao;
  if (d.camera) comum.camera = d.camera;
  const plano = refDoPlano(cena ? cena.numero : null);
  if (plano) comum.plano_ref = plano;
  if (e.continuar && e.continuar.video) {
    return { ...comum, acao: "continuar_video", arquivo_id: e.continuar.video.arquivo_id, quadro_path: p.quadroDoContinuar || null };
  }
  const corpo: Record<string, unknown> = {
    ...comum,
    acao: "cena_gerar",
    tipo: plano ? "gerar_plano" : "gerar_livre",
    modo: e.final ? "primeiro_ultimo" : "primeiro_quadro",
    quadro_inicial_path: e.inicio && e.inicio.foto ? e.inicio.foto.storage_path : null,
  };
  if (e.final && e.final.foto) corpo.quadro_final_path = e.final.foto.storage_path;
  return corpo;
}

export const ERRO_DO_ULTIMO_QUADRO =
  "Não deu para tirar o último quadro do vídeo para continuar. Nada foi gerado nem cobrado. Tente de novo ou escolha um motor com extensão nativa (Veo, Kling, Seedance).";

/**
 * Continuar pela extensão nativa do motor (o servidor manda o vídeo inteiro
 * ao provedor e não precisa do último quadro). Só quando o motor estende e o
 * vídeo anterior está no acervo (arquivo_id).
 */
export function continuaPelaExtensao(e: EntradasDoVideo, d: Pick<DadosDoVideo, "motor">, motores?: MotorDeVideo[]): boolean {
  if (!e.continuar || !e.continuar.video || !e.continuar.video.arquivo_id) return false;
  const m = motorPorId(d.motor, motores && motores.length ? motores : undefined);
  return !!(m && m.cap.estender);
}

/**
 * Gera o clipe (uma chamada, sem nova tentativa): continuar tira o último
 * quadro no navegador quando o motor não estende. Devolve o pedido na forma
 * do cartão, para gravar em dados.video.pedidos.
 */
export async function gerarVideoDoCartao(p: {
  clientId: string;
  canvas: Pick<Canvas, "nos" | "ligacoes">;
  videoId: string;
  dados: DadosDoVideo;
  titulo: string;
  custoConfirmado: number;
  aprovadas?: string[];
  /** Catálogo de motores que a mesa-videos devolveu (para saber se o motor estende sozinho). */
  motores?: MotorDeVideo[];
}): Promise<PedidoDoVideoNoCanvas> {
  const e = entradasDoVideo(p.canvas, p.videoId, p.aprovadas || []);
  const bloqueios = bloqueiosDoVideo(e, p.dados);
  if (bloqueios.length) throw new Error(bloqueios[0]);
  let quadroDoContinuar: string | null = null;
  if (e.continuar && e.continuar.video && !continuaPelaExtensao(e, p.dados, p.motores)) {
    // Motor sem extensão nativa: o último quadro vira o 1º do clipe novo (tirado aqui, como na Mesa Vídeos).
    // Sem o último quadro não gera: nunca recomeçar do 1º quadro do clipe anterior (seria cobrado e sairia errado).
    try {
      quadroDoContinuar = await quadroDoVideoNoStorage(p.clientId, "mesa", e.continuar.video.storage_path, "ultimo");
    } catch {
      quadroDoContinuar = null;
    }
    if (!quadroDoContinuar) throw new Error(ERRO_DO_ULTIMO_QUADRO);
  }
  const uid = novoUid();
  const corpo = corpoDoGerarVideo({ clientId: p.clientId, canvas: p.canvas, entradas: e, dados: p.dados, titulo: p.titulo, uid, custoConfirmado: p.custoConfirmado, quadroDoContinuar });
  const r = await chamarMesaVideos<{ pedido_id?: string; custo_estimado?: { usd?: number | null } }>(corpo);
  if (!r || !r.pedido_id) throw new Error("A Mesa Vídeos não devolveu o pedido. Confira em Mesa Vídeos, Gerações.");
  return {
    pedido_id: r.pedido_id,
    uid,
    motor: String(p.dados.motor || ""),
    modo: modoDoVideo(e),
    criado_em: new Date().toISOString(),
    estado: "enviado",
    erro: null,
    custo_usd: r.custo_estimado && typeof r.custo_estimado.usd === "number" ? r.custo_estimado.usd : null,
    quadro_path: (corpo.quadro_inicial_path as string | null) || quadroDoContinuar,
    videos: [],
  };
}

/** Consulta os pedidos em andamento do cartão (um gerar_status por pedido). Devolve só os que mudaram. */
export async function conferirPedidosDoVideo(d: DadosDoVideo): Promise<PedidoDoVideoNoCanvas[]> {
  const mudaram: PedidoDoVideoNoCanvas[] = [];
  for (const p of d.pedidos.filter((x) => EM_ANDAMENTO.indexOf(x.estado) >= 0)) {
    const r = await chamarMesaVideos<{ pedidos?: unknown[] }>({ acao: "gerar_status", pedido_id: p.pedido_id });
    const linha = r && Array.isArray(r.pedidos) ? r.pedidos[0] : null;
    const novo = pedidoAtualizado(p, linha);
    if (JSON.stringify(novo) !== JSON.stringify(p)) mudaram.push(novo);
  }
  return mudaram;
}

/**
 * Vigia do andamento enquanto o canvas está aberto: intervalo crescente
 * (45 s, 90 s e depois a cada 3 min) até o estado final ou o prazo do motor.
 * Não é laço de correção: só lê o andamento, uma consulta por vez.
 */
export const ESPERAS_DO_VIGIA_MS = [45_000, 90_000, 180_000];
export const PRAZO_PADRAO_MIN = 40;

export function esperaDoVigia(passo: number): number {
  return ESPERAS_DO_VIGIA_MS[Math.max(0, Math.min(passo, ESPERAS_DO_VIGIA_MS.length - 1))];
}

/** Se ainda vale conferir: há pedido em andamento dentro do prazo do motor (com 2 min de folga). */
export function vigiarAinda(d: Pick<DadosDoVideo, "pedidos">, agora: number, motores?: MotorDeVideo[]): boolean {
  return d.pedidos.some((p) => {
    if (EM_ANDAMENTO.indexOf(p.estado) < 0) return false;
    const inicio = Date.parse(p.criado_em);
    if (!isFinite(inicio)) return true;
    const m = motorPorId(p.motor, motores && motores.length ? motores : undefined);
    const prazo = (m && m.prazo_min > 0 ? m.prazo_min : PRAZO_PADRAO_MIN) + 2;
    return agora - inicio < prazo * 60_000;
  });
}

/** Junta pedidos atualizados nos dados do cartão (pelo id). */
export function juntarPedidos(d: DadosDoVideo, novos: PedidoDoVideoNoCanvas[]): DadosDoVideo {
  const lista = d.pedidos.map((p) => novos.find((n) => n.pedido_id === p.pedido_id) || p);
  novos.forEach((n) => {
    if (!lista.some((p) => p.pedido_id === n.pedido_id)) lista.push(n);
  });
  return { ...d, pedidos: lista.slice(-12) };
}

// ------------------------------------------------------------------ pôr no quadro

/** Onde o cartão Vídeo nasce: à direita do Resultado, na primeira vaga livre. */
export function posicaoAoLado(c: Pick<Canvas, "nos">, de: NoDoCanvas, tamanho: { largura: number; altura: number }): { x: number; y: number } {
  const larguraDe = de.tipo === "gerar" ? TAMANHO_DA_SAIDA.largura : TAMANHO_DO_VIDEO.largura;
  const x = de.x + larguraDe + 90;
  for (let i = 0; i < 12; i++) {
    const y = de.y + i * (tamanho.altura + 30);
    if (!c.nos.some((n) => Math.abs(n.x - x) < 120 && Math.abs(n.y - y) < 120)) return { x: Math.round(x), y: Math.round(y) };
  }
  return { x: Math.round(x), y: Math.round(de.y) };
}

/**
 * "Animar esta foto": cartão Vídeo ligado ao Resultado (1º quadro), com a
 * duração e o movimento pelo tipo da cena. Se já existe um Vídeo ligado a
 * este Resultado, devolve ele (não duplica).
 */
export function animarResultado(c: Canvas, gerarId: string, motorPadrao: string | null): { canvas: Canvas; videoId: string | null; novo: boolean } {
  const g = c.nos.find((n) => n.id === gerarId && n.tipo === "gerar");
  if (!g) return { canvas: c, videoId: null, novo: false };
  const ja = c.ligacoes.find((l) => l.de === gerarId && l.entrada === "inicio");
  if (ja) return { canvas: c, videoId: ja.para, novo: false };
  const cena = g.dados.cena || null;
  const movimento = cena && (cena.enquadramento === "close" || cena.enquadramento === "detalhe") ? "aproximar" : cena && cena.enquadramento === "plano_geral" ? "lateral" : "sutil";
  const formato = g.dados.formato === "9:16" || g.dados.formato === "16:9" || g.dados.formato === "1:1" || g.dados.formato === "4:5" ? g.dados.formato : "9:16";
  const video = lerDadosDoVideo({ motor: motorPadrao, duracao_s: 5, formato, movimento, audio: !!(cena && cena.narrativa.trim()) });
  const no = novoNo("video", 0, 0, { video, titulo: cena && cena.titulo.trim() ? `Vídeo: ${cena.titulo.trim()}`.slice(0, 120) : "" });
  const p = posicaoAoLado(c, g, TAMANHO_DO_VIDEO);
  let novo: Canvas = { ...c, nos: c.nos.concat([{ ...no, x: p.x, y: p.y }]) };
  novo = ligar(novo, gerarId, no.id, null, "inicio");
  return { canvas: novo, videoId: no.id, novo: true };
}

/** Anima todas as cenas da história que têm foto e ainda não têm Vídeo. */
export function animarCenasQueFaltam(c: Canvas, motorPadrao: string | null, aprovadas: string[] = []): { canvas: Canvas; criados: number } {
  let novo = c;
  let criados = 0;
  cenasDaHistoria(c).forEach((h) => {
    if (!fotoDaLigacao(h.no, null, aprovadas)) return;
    const r = animarResultado(novo, h.no.id, motorPadrao);
    if (r.novo) {
      novo = r.canvas;
      criados++;
    }
  });
  return { canvas: novo, criados };
}

/** Vídeos que partem da foto deste Resultado (ele no 1º quadro): quantos cartões, prontos e gerando. */
export function videosDoResultado(c: Pick<Canvas, "nos" | "ligacoes">, gerarId: string): { cartoes: number; prontos: number; andamento: number } {
  const ids = c.ligacoes.filter((l) => l.de === gerarId && l.entrada === "inicio").map((l) => l.para);
  let prontos = 0;
  let andamento = 0;
  c.nos.forEach((n) => {
    if (ids.indexOf(n.id) < 0 || !n.dados.video) return;
    n.dados.video.pedidos.forEach((p) => {
      prontos += p.videos.length;
      if (EM_ANDAMENTO.indexOf(p.estado) >= 0) andamento++;
    });
  });
  return { cartoes: ids.length, prontos, andamento };
}

/** Grava o pedido novo (ou os atualizados) no cartão. */
export function comPedidos(c: Canvas, videoId: string, novos: PedidoDoVideoNoCanvas[]): Canvas {
  const no = c.nos.find((n) => n.id === videoId);
  if (!no || !no.dados.video) return c;
  return mudarDados(c, videoId, { video: juntarPedidos(no.dados.video, novos) });
}

// ------------------------------------------------------------------ quadro: mídias ligadas

/** Cartão Quadro novo, ligado ao cartão de origem (Resultado ou Vídeo), à direita dele. */
export function quadroAoLado(c: Canvas, deId: string | null, dados: { quadro: QuadroAnimado; titulo?: string }): { canvas: Canvas; quadroId: string } {
  const de = deId ? c.nos.find((n) => n.id === deId) || null : null;
  const no = novoNo("quadro", 0, 0, { quadro: dados.quadro, titulo: dados.titulo || "" });
  const p = de ? posicaoAoLado(c, de, TAMANHO_DO_QUADRO) : { x: 900, y: 0 };
  let novo: Canvas = { ...c, nos: c.nos.concat([{ ...no, x: p.x, y: p.y }]) };
  if (de) novo = ligar(novo, de.id, no.id);
  return { canvas: novo, quadroId: no.id };
}

/** Mídias que chegam ao Quadro pelas ligações: a foto do Resultado e o vídeo pronto mais novo do cartão Vídeo. */
export function midiasLigadasAoQuadro(c: Pick<Canvas, "nos" | "ligacoes">, quadroId: string, aprovadas: string[] = []): MidiaDaCamada[] {
  const saida: MidiaDaCamada[] = [];
  c.ligacoes
    .filter((l) => l.para === quadroId)
    .sort((a, b) => a.ordem - b.ordem)
    .forEach((l) => {
      const no = c.nos.find((n) => n.id === l.de);
      if (!no) return;
      if (no.tipo === "gerar") {
        const f = fotoDaLigacao(no, l.imagem_id, aprovadas);
        if (f && f.storage_path && (f.storage_bucket || "mesa") === "mesa") saida.push({ bucket: "mesa", caminho: f.storage_path, nome: "Foto do Resultado", imagem_id: f.imagem_id, arquivo_id: null });
      }
      if (no.tipo === "video" && no.dados.video) {
        const v = ultimoVideo(no.dados.video);
        if (v) saida.push({ bucket: "mesa", caminho: v.storage_path, nome: "Vídeo do cartão", imagem_id: null, arquivo_id: v.arquivo_id });
      }
    });
  return saida;
}
