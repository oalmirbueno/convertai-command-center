/**
 * Composição do vídeo de IA da pauta (27/10/2026). Dono: "ele tem que puxar o contexto e gerar a base, puxar
 * automaticamente as imagens, criar a composição do vídeo e criar; aí tem a opção de referências, antes e depois
 * etc. Deixar mais simples de mexer e mais fácil com cliques."
 *
 * Regras puras (a tela e os testes leem daqui):
 * - montarComposicao: o contexto da pauta (mídia pensada pelo nicho, direção do vídeo, gancho) vira cenas; as
 *   fotos REAIS do acervo entram primeiro, uma por cena, na ordem da nota do Jev; cena sem foto fica com a base
 *   criada pela IA a partir do texto (o motor de vídeo gera o primeiro quadro).
 * - referências com papel: antes e depois viram uma cena de transformação (primeiro e último quadro); produto
 *   preenche cena sem imagem; estilo de movimento entra no prompt e no pedido.
 * - composicaoDaReferenciaViral: a estrutura de um vídeo viral (batidas, movimento, segundos) vira as cenas,
 *   com as imagens do próprio cliente; nunca o conteúdo do vídeo de fora.
 * - pedidosDaComposicao: cada cena vira um gerar_video da Mesa Vídeos (modo, motor do nível, custo) com a
 *   composição e os papéis das referências no pedido.
 * - estadoDasCenas e roteiroDaComposicao: o andamento de cada cena e o roteiro que a montagem (Mesa Edição)
 *   junta quando todas ficam prontas.
 * Sem travessão.
 */
import { ESTILOS_DE_VIDEO_DA_PAUTA, type DirecaoDeVideoDaPauta } from "../../../supabase/functions/_shared/video-da-pauta";
import type { MidiaDaPeca } from "../../../supabase/functions/agente-calendario/modulos/midia-da-peca-regras";
import type { RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import type { ReferenciaViral } from "../../../supabase/functions/agente-calendario/modulos/referencias-virais-de-video";
import { MOVIMENTOS_DA_CENA, movimentoDoTexto, type MovimentoDaCena, type PapelDaReferencia } from "../../../supabase/functions/mesa-videos/modulos/composicao-no-pedido";
import { atende, custoDoMotor, duracaoNoMotor, motorDoNivel, motorPorId, resolucaoNoMotor, type CustoDoMotor, type MotorDeVideo, type NivelDoMotor } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import type { ArquivoDeVideo, PedidoDeVideo } from "@/components/mesa-videos/videosApi";

export { MOVIMENTOS_DA_CENA };
export type { MovimentoDaCena, PapelDaReferencia };

export const MAX_CENAS_DA_COMPOSICAO = 6;
export const DURACOES_DA_CENA = [5, 10] as const;

export interface ImagemDaCena {
  origem: "acervo" | "referencia" | "enviada";
  /** Id da foto no acervo (cliente_imagens) quando veio de lá. */
  id?: string | null;
  nome: string;
  bucket: string;
  caminho: string;
}

export interface CenaDaComposicao {
  id: string;
  descricao: string;
  movimento: MovimentoDaCena;
  duracao_s: number;
  /** Texto na tela (entra na montagem, nunca dentro da cena gerada). */
  texto: string;
  /** Primeiro quadro; null = a IA cria a base pelo texto. */
  imagem: ImagemDaCena | null;
  /** Último quadro (antes e depois). */
  final: ImagemDaCena | null;
  /** Cena de transformação montada pelas referências antes e depois. */
  transformacao?: boolean;
  /** Sobe a cada "Refazer esta cena" (vai na chave do pedido). */
  rodada: number;
}

export interface ReferenciaDoVideo {
  id: string;
  papel: PapelDaReferencia;
  tipo: "imagem" | "video";
  nome: string;
  bucket: string;
  caminho: string;
}

export interface ComposicaoDoVideo {
  id: string;
  task_id: string;
  gancho: string;
  estilo: string;
  cenas: CenaDaComposicao[];
  referencias: ReferenciaDoVideo[];
  origem: "contexto" | "viral";
  viral: { titulo: string; link: string } | null;
  /** A versão da Mesa Edição que juntou as cenas (e a assinatura dos arquivos dela). */
  montagem: { versao_id: string; assinatura: string } | null;
  criada_em: string;
}

/** O que a montagem lê das fotos do acervo (o FotoDoAcervo da Mesa Foto cabe aqui). */
export interface FotoParaComposicao {
  id: string;
  client_id: string;
  nome: string;
  storage_bucket: string;
  storage_path: string;
  ativa: boolean;
  referencia_web?: boolean;
  workspace_node_id?: string | null;
}

export interface ItemParaComposicao {
  id: string;
  title: string;
  gancho?: string | null;
  video?: DirecaoDeVideoDaPauta;
  midia?: MidiaDaPeca | null;
}

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, max);

export function idCurto(prefixo = ""): string {
  const aleatorio = Math.random().toString(36).slice(2, 8);
  return `${prefixo}${Date.now().toString(36).slice(-4)}${aleatorio}`.slice(0, 16);
}

/** Movimentos em rodízio quando o texto da cena não diz nenhum (variedade sem repetir o mesmo plano). */
const RODIZIO: MovimentoDaCena[] = ["Aproximação lenta", "Deslocamento lateral suave", "Órbita lenta", "Revelação do ambiente"];

// ------------------------------------------------------------------ imagens do contexto

/** A foto do acervo pelo id, pelo nó do Workspace ou pelo caminho; só do cliente, ativa e não referência da internet. */
export function acharFoto<T extends FotoParaComposicao>(fotos: T[], clientId: string, chave: string): T | null {
  return fotos.find((f) => f.client_id === clientId && f.ativa && !f.referencia_web && (f.id === chave || f.workspace_node_id === chave || f.storage_path === chave)) || null;
}

/**
 * As fotos reais da pauta, na ordem de força: as que a mídia pensada escolheu (nota do Jev, a melhor primeiro),
 * as referências da direção do vídeo e a foto real que o Estúdio achou. Sem repetir.
 */
export function fotosDaPauta<T extends FotoParaComposicao>(item: ItemParaComposicao, fotos: T[], clientId: string, fotoReal: string[] = []): T[] {
  const chaves = [
    ...((item.midia && item.midia.acervo) || []).map((a) => a.id),
    ...((item.video && item.video.referencias) || []),
    ...fotoReal,
  ];
  const saida: T[] = [];
  for (const c of chaves) {
    const f = acharFoto(fotos, clientId, c);
    if (f && saida.indexOf(f) < 0) saida.push(f);
  }
  return saida;
}

const imagemDaFoto = (f: FotoParaComposicao): ImagemDaCena => ({ origem: "acervo", id: f.id, nome: f.nome, bucket: f.storage_bucket || "mesa", caminho: f.storage_path });

/** As cenas em texto: as da mídia pensada; sem ela, as da direção ("Cenas: a | b"); sem nada, as do estilo. */
export function cenasDoContexto(item: ItemParaComposicao): string[] {
  const daMidia = ((item.midia && item.midia.cenas) || []).map((c) => umaLinha(c, 240)).filter(Boolean);
  if (daMidia.length) return daMidia.slice(0, MAX_CENAS_DA_COMPOSICAO);
  const prompt = String((item.video && item.video.prompt) || "");
  const m = /Cenas:\s*([^\n]+)/i.exec(prompt);
  if (m) {
    const partes = m[1].split("|").map((c) => umaLinha(c, 240)).filter(Boolean);
    if (partes.length) return partes.slice(0, MAX_CENAS_DA_COMPOSICAO);
  }
  const tema = umaLinha(item.title, 120);
  return [`Abertura que prende: ${tema}, o detalhe mais bonito em close`, `${tema} mostrado no ambiente real, com luz natural`, `Fechamento com o resultado final de ${tema}`];
}

/** O gancho da pauta: o da mídia pensada, o da pauta ou o título. */
export function ganchoDoContexto(item: ItemParaComposicao): string {
  return umaLinha((item.midia && item.midia.gancho) || item.gancho || item.title, 120);
}

export interface EntradaDaComposicao {
  item: ItemParaComposicao;
  clientId: string;
  fotos: FotoParaComposicao[];
  /** Ids das fotos reais que o Estúdio achou (foto real primeiro). */
  fotoReal?: string[];
  referencias?: ReferenciaDoVideo[];
  estilo?: string;
  id?: string;
  agora?: string;
}

/**
 * Monta a composição pelo contexto: uma cena por batida, a foto real mais forte na abertura e as próximas nas
 * cenas seguintes; cena sem foto fica com a base criada pela IA. O gancho vira o texto da abertura.
 */
export function montarComposicao(e: EntradaDaComposicao): ComposicaoDoVideo {
  const textos = cenasDoContexto(e.item);
  const fotos = fotosDaPauta(e.item, e.fotos, e.clientId, e.fotoReal || []);
  const gancho = ganchoDoContexto(e.item);
  const cenas: CenaDaComposicao[] = textos.map((t, k) => ({
    id: idCurto("c"),
    descricao: t,
    movimento: movimentoDoTexto(t, RODIZIO[k % RODIZIO.length]),
    duracao_s: 5,
    texto: k === 0 ? gancho : "",
    imagem: fotos[k] ? imagemDaFoto(fotos[k]) : null,
    final: null,
    rodada: 0,
  }));
  const estilo = (ESTILOS_DE_VIDEO_DA_PAUTA.find((x) => x.id === (e.estilo || (e.item.video && e.item.video.estilo))) || ESTILOS_DE_VIDEO_DA_PAUTA[0]).id;
  return aplicarReferencias({
    id: e.id || idCurto("v"),
    task_id: e.item.id,
    gancho,
    estilo,
    cenas,
    referencias: e.referencias || [],
    origem: "contexto",
    viral: null,
    montagem: null,
    criada_em: e.agora || new Date().toISOString(),
  });
}

// ------------------------------------------------------------------ referências com papel

const imagemDaReferencia = (r: ReferenciaDoVideo): ImagemDaCena => ({ origem: "referencia", id: r.id, nome: r.nome, bucket: r.bucket, caminho: r.caminho });

/**
 * As referências mandam nas cenas: antes (e depois) viram a cena de transformação na abertura, do primeiro ao
 * último quadro, câmera fixa no mesmo ponto de vista; sem as duas, a cena sai. Produto preenche a cena sem
 * imagem (a base da IA vira o produto real). Estilo de movimento não mexe nas cenas: vai no prompt.
 */
export function aplicarReferencias(c: ComposicaoDoVideo): ComposicaoDoVideo {
  const imagens = c.referencias.filter((r) => r.tipo === "imagem");
  const antes = imagens.find((r) => r.papel === "antes") || null;
  const depois = imagens.find((r) => r.papel === "depois") || null;
  let cenas = c.cenas.slice();
  const k = cenas.findIndex((x) => x.transformacao);
  if (antes) {
    const descricao = depois ? "Transformação: do antes ao depois, no mesmo ponto de vista" : "Transformação: do antes ao resultado, no mesmo ponto de vista";
    const trans: CenaDaComposicao = k >= 0
      ? { ...cenas[k], imagem: imagemDaReferencia(antes), final: depois ? imagemDaReferencia(depois) : null }
      : { id: idCurto("c"), descricao, movimento: "Câmera fixa", duracao_s: 5, texto: c.gancho, imagem: imagemDaReferencia(antes), final: depois ? imagemDaReferencia(depois) : null, transformacao: true, rodada: 0 };
    if (k >= 0) cenas[k] = trans;
    else {
      // A transformação abre o vídeo (é o gancho): o texto da abertura passa para ela.
      cenas = [trans, ...cenas.map((x, i) => (i === 0 && x.texto === c.gancho ? { ...x, texto: "" } : x))].slice(0, MAX_CENAS_DA_COMPOSICAO);
    }
  } else if (k >= 0) {
    cenas = cenas.filter((_x, i) => i !== k);
    if (cenas[0] && !cenas[0].texto) cenas[0] = { ...cenas[0], texto: c.gancho };
  }
  const produtos = imagens.filter((r) => r.papel === "produto");
  // Tira da cena o produto que saiu das referências; preenche com o que ficou.
  const ids = new Set(c.referencias.map((r) => r.id));
  let p = 0;
  cenas = cenas.map((x) => {
    let imagem = x.imagem;
    if (imagem && imagem.origem === "referencia" && !x.transformacao && !ids.has(String(imagem.id))) imagem = null;
    if (!imagem && !x.transformacao && produtos.length) imagem = imagemDaReferencia(produtos[p++ % produtos.length]);
    return imagem === x.imagem ? x : { ...x, imagem };
  });
  return { ...c, cenas };
}

export function comReferencias(c: ComposicaoDoVideo, referencias: ReferenciaDoVideo[]): ComposicaoDoVideo {
  return aplicarReferencias({ ...c, referencias: referencias.slice(0, 8) });
}

// ------------------------------------------------------------------ edição com cliques

export function mudarCena(c: ComposicaoDoVideo, id: string, m: Partial<CenaDaComposicao>): ComposicaoDoVideo {
  return { ...c, cenas: c.cenas.map((x) => (x.id === id ? { ...x, ...m } : x)) };
}

export function moverCena(c: ComposicaoDoVideo, id: string, direcao: -1 | 1): ComposicaoDoVideo {
  const i = c.cenas.findIndex((x) => x.id === id);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= c.cenas.length) return c;
  const cenas = c.cenas.slice();
  [cenas[i], cenas[j]] = [cenas[j], cenas[i]];
  return { ...c, cenas };
}

export function tirarCena(c: ComposicaoDoVideo, id: string): ComposicaoDoVideo {
  if (c.cenas.length <= 1) return c;
  return { ...c, cenas: c.cenas.filter((x) => x.id !== id) };
}

export function acrescentarCena(c: ComposicaoDoVideo, tema: string): ComposicaoDoVideo {
  if (c.cenas.length >= MAX_CENAS_DA_COMPOSICAO) return c;
  const k = c.cenas.length;
  return { ...c, cenas: c.cenas.concat([{ id: idCurto("c"), descricao: `Detalhe de ${umaLinha(tema, 100)}`, movimento: RODIZIO[k % RODIZIO.length], duracao_s: 5, texto: "", imagem: null, final: null, rodada: 0 }]) };
}

export function trocarImagem(c: ComposicaoDoVideo, id: string, imagem: ImagemDaCena | null): ComposicaoDoVideo {
  return mudarCena(c, id, { imagem });
}

/**
 * "Usar como referência" de um vídeo viral: as batidas dele viram as cenas (a forma e o movimento), o assunto
 * é o da pauta e as imagens são as do cliente, na mesma ordem em que já estavam. O gancho do cliente fica; sem
 * gancho, o do viral (pela forma).
 */
export function composicaoDaReferenciaViral(c: ComposicaoDoVideo, ref: ReferenciaViral, tema: string): ComposicaoDoVideo {
  const imagens = c.cenas.filter((x) => !x.transformacao).map((x) => x.imagem).filter((x): x is ImagemDaCena => !!x);
  const assunto = umaLinha(tema, 120);
  const gancho = c.gancho || umaLinha(ref.gancho, 120);
  const cenas: CenaDaComposicao[] = ref.estrutura.slice(0, MAX_CENAS_DA_COMPOSICAO).map((b, k) => ({
    id: idCurto("c"),
    descricao: `${umaLinha(b.o_que, 200)}. Assunto: ${assunto}`,
    movimento: b.movimento,
    duracao_s: b.segundos > 7 ? 10 : 5,
    texto: k === 0 ? gancho : "",
    imagem: imagens[k] || null,
    final: null,
    rodada: 0,
  }));
  return aplicarReferencias({ ...c, gancho, cenas: cenas.length ? cenas : c.cenas, origem: "viral", viral: { titulo: ref.titulo, link: ref.link }, montagem: null });
}

// ------------------------------------------------------------------ pedidos

export interface PedidoDaCena {
  cena: CenaDaComposicao;
  ordem: number;
  motor: MotorDeVideo;
  custo: CustoDoMotor;
  corpo: Record<string, unknown>;
}

export interface PedidosDaComposicao {
  itens: PedidoDaCena[];
  custo: CustoDoMotor;
  /** Por que não dá para gerar (o botão fica desligado e mostra). */
  motivo: string | null;
}

/** O modo da cena: antes e depois = primeiro e último quadro; com imagem = primeiro quadro; sem nada = texto. */
export function modoDaCena(cena: CenaDaComposicao): "primeiro_ultimo" | "primeiro_quadro" | "texto" {
  if (cena.imagem && cena.final) return "primeiro_ultimo";
  if (cena.imagem) return "primeiro_quadro";
  return "texto";
}

/** O prompt da cena: o estilo, a cena, o movimento, a transformação e o estilo de movimento das referências. */
export function promptDaCena(c: ComposicaoDoVideo, cena: CenaDaComposicao, ordem: number, tema: string): string {
  const estilo = ESTILOS_DE_VIDEO_DA_PAUTA.find((x) => x.id === c.estilo) || ESTILOS_DE_VIDEO_DA_PAUTA[0];
  const movimento = c.referencias.filter((r) => r.papel === "movimento");
  const partes = [
    `Cena ${ordem} de ${c.cenas.length} de um Reels vertical sobre ${umaLinha(tema, 120)}.`,
    cena.descricao,
    `Movimento de câmera: ${cena.movimento}.`,
    cena.imagem && cena.final ? "Transformação contínua do primeiro quadro (antes) ao último (depois), mesmo ponto de vista, sem cortes." : cena.imagem ? "Comece exatamente na imagem enviada; preserve o produto, o lugar e as cores reais." : "",
    movimento.length ? `Ritmo e movimento de câmera no estilo da referência ${movimento.map((r) => `"${r.nome}"`).join(", ")}.` : "",
    estilo.texto,
    "Sem texto, legenda ou logotipo dentro da imagem.",
  ];
  return partes.filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 2400);
}

/** As referências que vão no pedido (só as da pasta do cliente). */
function papeisNoPedido(c: ComposicaoDoVideo, clientId: string) {
  return c.referencias.filter((r) => r.caminho.indexOf(`${clientId}/`) === 0).map((r) => ({ papel: r.papel, nome: r.nome, caminho: r.caminho, tipo: r.tipo }));
}

/** Imagem fora da Mesa (Workspace, Arquivos) precisa ser copiada para a pasta do cliente antes de gerar. */
export const imagemNaMesa = (img: ImagemDaCena | null, clientId: string) => !img || (img.bucket === "mesa" && img.caminho.indexOf(`${clientId}/`) === 0);

/**
 * Cada cena que precisa de vídeo vira um gerar_video: o motor escolhido (se atende) ou o do nível, a duração e a
 * resolução que ele aceita, o custo e a chave do pedido (composição, cena, rodada e tentativa: o mesmo clique
 * nunca gera duas vezes; refazer e tentar de novo geram outra).
 */
export function pedidosDaComposicao(c: ComposicaoDoVideo, o: {
  clientId: string;
  tema: string;
  motores: MotorDeVideo[];
  prontos?: string[];
  nivel: NivelDoMotor;
  motorId?: string | null;
  /** Só estas cenas (as que faltam); sem a lista, todas. */
  cenas?: string[];
  /** Quantos pedidos cada cena já teve (vai na chave). */
  tentativas?: Record<string, number>;
}): PedidosDaComposicao {
  const itens: PedidoDaCena[] = [];
  const escolhidas = c.cenas.filter((x) => !o.cenas || o.cenas.indexOf(x.id) >= 0);
  if (!escolhidas.length) return { itens, custo: { usd: 0, detalhe: "nada a gerar", incerto: false }, motivo: "Todas as cenas já têm vídeo. Use Refazer na cena que quer trocar." };
  let motivo: string | null = null;
  for (const cena of escolhidas) {
    const ordem = c.cenas.indexOf(cena) + 1;
    const modo = modoDaCena(cena);
    const requisito = { modo, formato: "9:16" } as const;
    const pedido = o.motorId ? motorPorId(o.motorId, o.motores) : null;
    const motor = pedido && atende(pedido, requisito) ? pedido : motorDoNivel(o.nivel, requisito, o.motores, o.prontos);
    if (!motor) {
      motivo = motivo || `Nenhum motor pronto faz a cena ${ordem} (${modo === "primeiro_ultimo" ? "antes e depois" : modo === "primeiro_quadro" ? "a partir da foto" : "pelo texto"}) neste nível.`;
      continue;
    }
    // Imagem fora da Mesa (Workspace, Arquivos): a tela copia para a pasta do cliente antes de enviar (imagemNaMesa).
    const duracao = duracaoNoMotor(motor, cena.duracao_s);
    const resolucao = resolucaoNoMotor(motor, "");
    const custo = custoDoMotor(motor, { duracao_s: duracao, resolucao, audio: false, variacoes: 1 });
    const tentativa = (o.tentativas && o.tentativas[cena.id]) || 0;
    const corpo: Record<string, unknown> = {
      acao: "gerar_video",
      tipo: "gerar_livre",
      client_id: o.clientId,
      motor: motor.id,
      modo,
      prompt: promptDaCena(c, cena, ordem, o.tema),
      task_id: c.task_id,
      titulo: `${umaLinha(o.tema, 90)} · cena ${ordem}`.slice(0, 120),
      negativo: "texto na imagem, legenda, marca d'água, logotipo inventado, rosto deformado",
      duracao_s: duracao,
      formato: "9:16",
      resolucao,
      audio: false,
      variacoes: 1,
      quadro_inicial_path: cena.imagem ? cena.imagem.caminho : null,
      quadro_final_path: cena.imagem && cena.final ? cena.final.caminho : null,
      referencias_paths: [],
      composicao: { id: c.id, cena_id: cena.id, ordem, total: c.cenas.length },
      referencias_papeis: papeisNoPedido(c, o.clientId),
      uid: `${c.id}:${cena.id}:${cena.rodada}:${tentativa}`.slice(0, 64),
    };
    itens.push({ cena, ordem, motor, custo, corpo });
  }
  const semPreco = itens.some((i) => i.custo.usd === null);
  const usd = semPreco ? null : Math.round(itens.reduce((s, i) => s + (i.custo.usd as number), 0) * 10000) / 10000;
  const motores = Array.from(new Set(itens.map((i) => i.motor.rotulo)));
  const custo: CustoDoMotor = { usd, detalhe: `${itens.length} ${itens.length === 1 ? "cena" : "cenas"} · ${motores.join(", ")}`, incerto: itens.some((i) => i.custo.incerto) };
  if (semPreco) motivo = motivo || "Um dos motores está sem preço conferido.";
  return { itens, custo, motivo };
}

// ------------------------------------------------------------------ andamento das cenas e montagem

export type EstadoDaCenaNaComposicao =
  | { tipo: "sem_pedido" }
  | { tipo: "andando"; pedido: PedidoDeVideo }
  | { tipo: "pronta"; pedido: PedidoDeVideo; arquivo: ArquivoDeVideo | null }
  | { tipo: "falhou"; pedido: PedidoDeVideo; motivo: string };

const daComposicao = (p: PedidoDeVideo) => (p.parametros && (p.parametros as { composicao?: { id?: string; cena_id?: string } }).composicao) || null;

/** Os pedidos de cada cena (o mais novo primeiro). */
export function pedidosDaCena(c: ComposicaoDoVideo, cenaId: string, pedidos: PedidoDeVideo[]): PedidoDeVideo[] {
  return pedidos
    .filter((p) => {
      const k = daComposicao(p);
      return !!k && k.id === c.id && k.cena_id === cenaId;
    })
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

/** O pedido mais novo de cada cena manda: pronto (com o arquivo), andando ou falhou (com o motivo). */
export function estadoDasCenas(c: ComposicaoDoVideo, pedidos: PedidoDeVideo[], arquivos: ArquivoDeVideo[]): EstadoDaCenaNaComposicao[] {
  return c.cenas.map((cena) => {
    const p = pedidosDaCena(c, cena.id, pedidos)[0];
    if (!p) return { tipo: "sem_pedido" };
    const estado = String(p.estado);
    const envios = ((p.resultado && p.resultado.envios) || []) as Array<{ arquivo_id?: string | null; erro?: string | null }>;
    const arquivoId = envios.map((e) => e && e.arquivo_id).filter((x): x is string => !!x)[0];
    if ((estado === "pronto" || estado === "parcial") && arquivoId) return { tipo: "pronta", pedido: p, arquivo: arquivos.find((a) => a.id === arquivoId) || null };
    if (estado === "erro" || estado === "cancelado" || estado === "parcial") {
      const motivo = envios.map((e) => e && e.erro).filter(Boolean)[0];
      return { tipo: "falhou", pedido: p, motivo: estado === "cancelado" ? "Cancelado." : motivo ? String(motivo) : "O motor não entregou esta cena." };
    }
    return { tipo: "andando", pedido: p };
  });
}

/** As cenas que precisam de pedido agora: sem pedido, que falharam ou marcadas para refazer (rodada nova). */
export function cenasQueFaltam(c: ComposicaoDoVideo, estados: EstadoDaCenaNaComposicao[], rodadasPedidas: Record<string, number> = {}): string[] {
  return c.cenas.filter((cena, k) => {
    const e = estados[k];
    if (!e || e.tipo === "sem_pedido" || e.tipo === "falhou") return true;
    return cena.rodada > (rodadasPedidas[cena.id] ?? cena.rodada);
  }).map((x) => x.id);
}

/** A rodada do pedido mais novo de cada cena (lida da chave composicao:cena:rodada:tentativa). */
export function rodadasPedidas(c: ComposicaoDoVideo, pedidos: PedidoDeVideo[]): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const cena of c.cenas) {
    const p = pedidosDaCena(c, cena.id, pedidos)[0];
    const chave = String((p as unknown as { chave?: string } | undefined)?.chave || "");
    const m = /:(\d+):(\d+)$/.exec(chave);
    if (m) saida[cena.id] = Number(m[1]);
  }
  return saida;
}

/** Quantos pedidos cada cena já teve (vai na chave do próximo). */
export function tentativasDasCenas(c: ComposicaoDoVideo, pedidos: PedidoDeVideo[]): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const cena of c.cenas) saida[cena.id] = pedidosDaCena(c, cena.id, pedidos).length;
  return saida;
}

/** Os arquivos de cena (pedidos desta composição): ficam na prancheta, mas não viram o vídeo da peça sozinhos. */
export function arquivosDeCena(pedidos: PedidoDeVideo[], arquivos: ArquivoDeVideo[]): Set<string> {
  const ids = new Set(pedidos.filter((p) => !!daComposicao(p)).map((p) => p.id));
  const saida = new Set<string>();
  for (const p of pedidos) if (ids.has(p.id)) for (const e of ((p.resultado && p.resultado.envios) || [])) if (e && e.arquivo_id) saida.add(e.arquivo_id);
  for (const a of arquivos) if ((a.pedido_id && ids.has(a.pedido_id)) || (typeof a.origem?.pedido === "string" && ids.has(a.origem.pedido))) saida.add(a.id);
  return saida;
}

/** Assinatura dos arquivos prontos (muda quando uma cena é refeita): a montagem refaz só quando muda. */
export const assinaturaDaMontagem = (estados: EstadoDaCenaNaComposicao[]) =>
  estados.map((e) => (e.tipo === "pronta" && e.arquivo ? e.arquivo.id : "-")).join("|");

/** Todas as cenas prontas, com o arquivo na lista? */
export const todasProntas = (estados: EstadoDaCenaNaComposicao[]) => estados.length > 0 && estados.every((e) => e.tipo === "pronta" && !!e.arquivo);

/** O roteiro que a montagem da Mesa Edição junta: cenas em ordem, o texto na tela e os segundos; sem fala. */
export function roteiroDaComposicao(c: ComposicaoDoVideo, estados: EstadoDaCenaNaComposicao[]): RoteiroDeVideo {
  const cenas = c.cenas.map((cena, k) => {
    const e = estados[k];
    const medido = e && e.tipo === "pronta" && e.arquivo && e.arquivo.duracao_s ? e.arquivo.duracao_s : 0;
    const pedido = e && e.tipo === "pronta" ? Number(e.pedido.parametros && e.pedido.parametros.duracao_s) || 0 : 0;
    return { ordem: k + 1, descricao: cena.descricao, fala: "", texto_na_tela: cena.texto, segundos: Math.max(1, Math.round((medido || pedido || cena.duracao_s) * 100) / 100) };
  });
  return { gancho: c.gancho, cenas, duracao: cenas.reduce((s, x) => s + x.segundos, 0), trilha: "", cta: "" };
}
