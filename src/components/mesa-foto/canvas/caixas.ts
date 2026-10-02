import {
  ligar,
  mudarLigacao,
  novoId,
  novoNo,
  podeLigar,
  porCartao,
  posicaoParaResultado,
  removerNo,
  renumerar,
  TAMANHO_DA_SAIDA,
  type Canvas,
  type DadosDoNo,
  type Ligacao,
  type NoDoCanvas,
  type PapelDaLigacao,
  type ResultadoDoCanvas,
} from "../canvasApi";
import { duplicarCena } from "./historia";
import { lerVariacoes, proximaCamera } from "../../../../supabase/functions/mesa-foto/modulos/opcoes-do-resultado";

/**
 * Caixas de resultado no mesmo quadro (02/10/2026). O dono pediu: "abrir
 * várias caixas de resultado na mesma tela, sem precisar abrir muitos
 * lugares; ligar uma na outra e fazer várias variações".
 *
 * Cada caixa é um Resultado (cartão "gerar"): o pedido, as entradas ligadas
 * e as fotos que saíram. Aqui ficam as operações do quadro, puras e sem
 * React Flow (a barra do quadro chama, os testes leem): caixa nova, duplicar,
 * variar numa caixa nova ligada, ligar a foto de uma caixa noutra e apagar.
 * Apagar tira a caixa do quadro; as fotos que ela gerou continuam no acervo.
 */

/** Ajustes que passam de uma caixa para a cópia (sem as fotos e sem a cena). */
export function ajustesDaCaixa(d: DadosDoNo): DadosDoNo {
  return {
    motores: (d.motores || []).slice(),
    formato: d.formato || "4:5",
    qualidade: d.qualidade || "alta",
    resolucao: d.resolucao || null,
    acao: d.acao || "livre",
    pose: d.pose || "nenhuma",
    camera: d.camera || "livre",
    luz: d.luz || "livre",
    fundo: d.fundo || "livre",
    variacoes: lerVariacoes(d.variacoes),
    carrossel: d.carrossel || 0,
    resultados: [],
  };
}

/** Vaga livre à direita de uma caixa (na mesma altura; sem vaga, embaixo). */
export function vagaAoLadoDaCaixa(c: Pick<Canvas, "nos">, origem: Pick<NoDoCanvas, "x" | "y">): { x: number; y: number } {
  const passo = TAMANHO_DA_SAIDA.largura + 120;
  for (let i = 1; i < 40; i++) {
    const x = origem.x + i * passo;
    const livre = !c.nos.some((n) => Math.abs(n.x - x) < TAMANHO_DA_SAIDA.largura && Math.abs(n.y - origem.y) < TAMANHO_DA_SAIDA.altura);
    if (livre) return { x: Math.round(x), y: Math.round(origem.y) };
  }
  return { x: Math.round(origem.x), y: Math.round(origem.y + TAMANHO_DA_SAIDA.altura + 120) };
}

/** As caixas (Resultados) do quadro, na ordem em que estão. */
export const caixasDoQuadro = (c: Pick<Canvas, "nos">) => c.nos.filter((n) => n.tipo === "gerar");

/** A foto pronta de uma caixa: a pedida (imagem_id) ou a mais nova. */
export function fotoDaCaixa(no: Pick<NoDoCanvas, "dados">, imagemId?: string | null): ResultadoDoCanvas | null {
  const prontas = (no.dados.resultados || []).filter((r) => r.status === "gerada" && !!r.imagem_id);
  if (imagemId) {
    const pedida = prontas.find((r) => r.imagem_id === imagemId);
    if (pedida) return pedida;
  }
  return prontas.length ? prontas[prontas.length - 1] : null;
}

/** Caixa nova (vazia, com os motores padrão), embaixo do que já está no quadro. */
export function novaCaixa(c: Canvas, idNovo: string, dados: DadosDoNo = {}, posicao: { x: number; y: number } | null = null): Canvas {
  const no = { ...novoNo("gerar", 0, 0, dados), id: idNovo };
  return porCartao(c, no, { posicao: posicao || posicaoParaResultado(c) });
}

/**
 * Duplicar a caixa: os mesmos ajustes e as mesmas entradas (mesmos cartões e
 * mesmas fotos de outras caixas), sem as fotos. Caixa que é cena da história
 * duplica como cena (entra logo depois dela).
 */
export function duplicarCaixa(c: Canvas, gerarId: string, idNovo: string): Canvas {
  const origem = c.nos.find((n) => n.id === gerarId);
  if (!origem || origem.tipo !== "gerar") return c;
  if (origem.dados.cena) return duplicarCena(c, gerarId, idNovo);
  const p = vagaAoLadoDaCaixa(c, origem);
  const copia: NoDoCanvas = { id: idNovo, tipo: "gerar", x: p.x, y: p.y, dados: ajustesDaCaixa(origem.dados) };
  const copiadas: Ligacao[] = c.ligacoes.filter((l) => l.para === gerarId).map((l) => ({ ...l, id: novoId("lig"), para: idNovo }));
  return { ...c, nos: c.nos.concat([copia]), ligacoes: renumerar(c.ligacoes.concat(copiadas)) };
}

/**
 * Variar numa caixa nova: a caixa nova recebe as mesmas entradas da origem
 * (o produto e a pessoa não mudam), a foto escolhida da origem como estilo
 * (mesma luz e paleta) e o próximo ângulo de câmera. A linha entre as duas
 * mostra de onde a variação saiu. Sem foto pronta na origem, nada muda.
 */
export function variarEmCaixaNova(c: Canvas, gerarId: string, idNovo: string, imagemId?: string | null): Canvas {
  const origem = c.nos.find((n) => n.id === gerarId);
  if (!origem || origem.tipo !== "gerar") return c;
  const foto = fotoDaCaixa(origem, imagemId);
  if (!foto) return c;
  const p = vagaAoLadoDaCaixa(c, origem);
  const dados: DadosDoNo = { ...ajustesDaCaixa(origem.dados), camera: proximaCamera(origem.dados.camera), carrossel: 0 };
  const nova: NoDoCanvas = { id: idNovo, tipo: "gerar", x: p.x, y: p.y, dados };
  const copiadas: Ligacao[] = c.ligacoes.filter((l) => l.para === gerarId).map((l) => ({ ...l, id: novoId("lig"), para: idNovo }));
  let novo: Canvas = { ...c, nos: c.nos.concat([nova]), ligacoes: renumerar(c.ligacoes.concat(copiadas)) };
  novo = ligar(novo, gerarId, idNovo, "estilo");
  const l = novo.ligacoes.find((x) => x.de === gerarId && x.para === idNovo);
  return l ? mudarLigacao(novo, l.id, { imagem_id: foto.imagem_id }) : novo;
}

/** Dá para ligar a foto da caixa `de` na caixa `para`? (sem laço, sem repetir) */
export function podeConectarCaixas(c: Pick<Canvas, "nos" | "ligacoes">, de: string, para: string): boolean {
  const a = c.nos.find((n) => n.id === de);
  const b = c.nos.find((n) => n.id === para);
  if (!a || !b || a.tipo !== "gerar" || b.tipo !== "gerar") return false;
  return !!podeLigar(c, de, para, "personagem");
}

/**
 * Liga a foto escolhida da caixa `de` como entrada da caixa `para`, com o
 * papel (personagem, produto, cenário ou estilo). Sem foto escolhida, vale a
 * mais nova (a mesma regra da função).
 */
export function conectarCaixas(c: Canvas, de: string, para: string, papel: PapelDaLigacao = "personagem", imagemId: string | null = null): Canvas {
  if (!podeConectarCaixas(c, de, para)) return c;
  const novo = ligar(c, de, para, papel);
  const l = novo.ligacoes.find((x) => x.de === de && x.para === para);
  return l && imagemId ? mudarLigacao(novo, l.id, { imagem_id: imagemId }) : novo;
}

/** Apagar a caixa: sai do quadro com as linhas dela (as fotos ficam no acervo). */
export const apagarCaixa = (c: Canvas, gerarId: string): Canvas => removerNo(c, gerarId);

// ------------------------------------------------------------------ peça do mês no quadro

/** O que a peça do mês leva para o quadro (montado pela esteira, ./pecasDeFoto.ts). */
export interface DirecaoParaACaixa {
  /** O pedido em palavras (assunto, objetivo, ângulos, pessoa, texto na foto). */
  pedido: string;
  /** O cenário em palavras (vira cartão Ambiente). */
  cenario: string;
  camera: string;
  luz: string;
  variacoes: number;
  /** Produto do cliente, quando ele tem um só. */
  kit_id: string | null;
  titulo: string;
}

/**
 * Uma caixa nova com a direção da peça: o cartão Pedido, o Ambiente (quando
 * há cenário) e o Produto (quando o cliente tem um só), tudo já ligado, e os
 * presets de câmera e luz. A pessoa revisa e gera.
 */
export function caixaDaPeca(c: Canvas, d: DirecaoParaACaixa, ids: { caixa: string; pedido: string; ambiente: string; produto: string }, motores: string[]): Canvas {
  let novo = novaCaixa(c, ids.caixa, { motores: motores.slice(), camera: d.camera, luz: d.luz, variacoes: lerVariacoes(d.variacoes) });
  const pedido = { ...novoNo("texto", 0, 0, { texto: d.pedido.slice(0, 2900), papel: "pedido" }), id: ids.pedido };
  novo = porCartao(novo, pedido, { gerarId: ids.caixa });
  if (d.cenario.trim()) {
    const ambiente = { ...novoNo("ambiente", 0, 0, { texto: d.cenario.trim().slice(0, 1400), modo: "descrever" }), id: ids.ambiente };
    novo = porCartao(novo, ambiente, { gerarId: ids.caixa });
  }
  if (d.kit_id) {
    const produto = { ...novoNo("produto", 0, 0, { kit_id: d.kit_id, titulo: "" }), id: ids.produto };
    novo = porCartao(novo, produto, { gerarId: ids.caixa });
  }
  return novo;
}
