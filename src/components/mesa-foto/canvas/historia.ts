import type { FotoDoAcervo } from "../fotoApi";
import {
  entradasDoGerar,
  fotoDaLigacao,
  ligar,
  mudarDados,
  nomeDoResultado,
  novoId,
  renumerar,
  TAMANHO_DA_SAIDA,
  type Canvas,
  type CenaDoResultado,
  type Ligacao,
  type NoDoCanvas,
  type ResultadoDoCanvas,
} from "../canvasApi";

/**
 * História do Canvas (dono, 25/09 à noite): "vou montando os templates, toda
 * essa base, para me contar uma história". Regras fixas, sem IA e sem React:
 * a lista das cenas pela ordem, arrastar para ordenar, duplicar a cena para
 * mudar o contexto, a próxima cena com a mesma personagem (o Resultado entra
 * no outro como personagem) e o pacote que a Mesa Vídeos vai ler
 * (docs/mesa-videos/CONTRATO.md). Mesma ordem da função (canvas-regras.ts,
 * historiaDoCanvas).
 */

export interface CenaNaHistoria {
  no: NoDoCanvas;
  cena: CenaDoResultado;
  /** Posição na história (1, 2, 3...), sem buraco. */
  numero: number;
}

/** Cena vazia (a ordem é dada por quem marca). */
export const cenaNova = (ordem: number, dados: Partial<CenaDoResultado> = {}): CenaDoResultado => ({
  ordem,
  titulo: "",
  acao: "",
  enquadramento: "livre",
  cenario: "",
  narrativa: "",
  seed: null,
  imagem_id: null,
  animacao: null,
  ...dados,
});

/** As cenas pela ordem (empate: de cima para baixo, da esquerda para a direita, id). */
export function cenasDaHistoria(c: Pick<Canvas, "nos">): CenaNaHistoria[] {
  return c.nos
    .filter((n) => n.tipo === "gerar" && !!n.dados.cena)
    .map((n) => ({ no: n, cena: n.dados.cena as CenaDoResultado }))
    .sort((a, b) => a.cena.ordem - b.cena.ordem || a.no.y - b.no.y || a.no.x - b.no.x || (a.no.id < b.no.id ? -1 : a.no.id > b.no.id ? 1 : 0))
    .map((x, i) => ({ ...x, numero: i + 1 }));
}

/** Reescreve a ordem 1, 2, 3... na sequência pedida (ids de Resultado); o que não veio na lista vai para o fim. */
export function reordenarCenas<T extends Pick<Canvas, "nos">>(c: T, ids: string[]): T {
  const atuais = cenasDaHistoria(c).map((x) => x.no.id);
  const sequencia = ids.filter((id, i) => atuais.indexOf(id) >= 0 && ids.indexOf(id) === i).concat(atuais.filter((id) => ids.indexOf(id) < 0));
  return {
    ...c,
    nos: c.nos.map((n) => {
      const i = sequencia.indexOf(n.id);
      return i >= 0 && n.dados.cena ? { ...n, dados: { ...n.dados, cena: { ...n.dados.cena, ordem: i + 1 } } } : n;
    }),
  };
}

/** Move a cena para a posição (1 = primeira). Fora da faixa, vai para a ponta. */
export function moverCena<T extends Pick<Canvas, "nos">>(c: T, gerarId: string, posicao: number): T {
  const ids = cenasDaHistoria(c).map((x) => x.no.id);
  const de = ids.indexOf(gerarId);
  if (de < 0) return c;
  ids.splice(de, 1);
  const para = Math.max(0, Math.min(ids.length, Math.floor(posicao) - 1));
  ids.splice(para, 0, gerarId);
  return reordenarCenas(c, ids);
}

/** Marca o Resultado como cena (entra no fim da história). Já cena: fica como está. */
export function marcarComoCena<T extends Pick<Canvas, "nos">>(c: T, gerarId: string, dados: Partial<CenaDoResultado> = {}): T {
  const no = c.nos.find((n) => n.id === gerarId);
  if (!no || no.tipo !== "gerar" || no.dados.cena) return c;
  const total = cenasDaHistoria(c).length;
  return mudarDados(c, gerarId, { cena: cenaNova(total + 1, dados) });
}

/** Tira da história (o Resultado continua no quadro) e refaz a ordem sem buraco. */
export function tirarDaHistoria<T extends Pick<Canvas, "nos">>(c: T, gerarId: string): T {
  const sem = mudarDados(c, gerarId, { cena: null });
  return reordenarCenas(sem, cenasDaHistoria(sem).map((x) => x.no.id));
}

/** Muda campos da cena (título, ação, enquadramento, lugar, narrativa, foto). */
export function mudarCena<T extends Pick<Canvas, "nos">>(c: T, gerarId: string, mudanca: Partial<CenaDoResultado>): T {
  const no = c.nos.find((n) => n.id === gerarId);
  if (!no || !no.dados.cena) return c;
  return mudarDados(c, gerarId, { cena: { ...no.dados.cena, ...mudanca } });
}

/** Posição de um Resultado novo: à direita do de origem, na primeira vaga livre. */
function vagaAoLado(c: Pick<Canvas, "nos">, origem: NoDoCanvas): { x: number; y: number } {
  const passo = TAMANHO_DA_SAIDA.largura + 120;
  for (let i = 1; i < 40; i++) {
    const x = origem.x + i * passo;
    const livre = !c.nos.some((n) => Math.abs(n.x - x) < TAMANHO_DA_SAIDA.largura && Math.abs(n.y - origem.y) < TAMANHO_DA_SAIDA.altura);
    if (livre) return { x, y: origem.y };
  }
  return { x: origem.x, y: origem.y + TAMANHO_DA_SAIDA.altura + 120 };
}

/** Põe uma cena nova logo depois de outra na história (as seguintes andam uma casa). */
function depoisDe<T extends Pick<Canvas, "nos">>(c: T, anteriorId: string, novoIdDaCena: string): T {
  const ids = cenasDaHistoria(c).map((x) => x.no.id).filter((id) => id !== novoIdDaCena);
  const i = ids.indexOf(anteriorId);
  ids.splice(i >= 0 ? i + 1 : ids.length, 0, novoIdDaCena);
  return reordenarCenas(c, ids);
}

/**
 * Duplica a cena para mudar o contexto: o Resultado novo recebe as mesmas
 * entradas (mesmos cartões e mesmas cenas anteriores), os mesmos ajustes e a
 * cena copiada, sem as fotos. Entra logo depois da original. O id vem de fora
 * (a tela seleciona o novo).
 */
export function duplicarCena(c: Canvas, gerarId: string, idNovo: string): Canvas {
  const origem = c.nos.find((n) => n.id === gerarId);
  if (!origem || origem.tipo !== "gerar") return c;
  const cenaDaOrigem = origem.dados.cena || cenaNova(1);
  const p = vagaAoLado(c, origem);
  const copia: NoDoCanvas = {
    id: idNovo,
    tipo: "gerar",
    x: Math.round(p.x),
    y: Math.round(p.y),
    dados: {
      ...origem.dados,
      resultados: [],
      cena: { ...cenaDaOrigem, titulo: cenaDaOrigem.titulo ? `${cenaDaOrigem.titulo} (outro contexto)` : "", imagem_id: null, animacao: null },
    },
  };
  let novo: Canvas = { ...c, nos: c.nos.concat([copia]) };
  const entradas = c.ligacoes.filter((l) => l.para === gerarId);
  const copiadas: Ligacao[] = entradas.map((l) => ({ ...l, id: novoId("lig"), para: idNovo }));
  novo = { ...novo, ligacoes: renumerar(novo.ligacoes.concat(copiadas)) };
  if (!origem.dados.cena) novo = marcarComoCena(novo, gerarId);
  return depoisDe(novo, gerarId, idNovo);
}

/**
 * Próxima cena com a mesma personagem (o fluxo do dono: "pego aquela pessoa
 * gerada e conecto em outro gerador"): um Resultado novo à direita, ligado a
 * este como personagem, com os mesmos produtos ligados e os mesmos ajustes.
 * Entra logo depois na história.
 */
export function proximaCena(c: Canvas, gerarId: string, idNovo: string, dados: Partial<CenaDoResultado> = {}): Canvas {
  const origem = c.nos.find((n) => n.id === gerarId);
  if (!origem || origem.tipo !== "gerar") return c;
  const p = vagaAoLado(c, origem);
  let novo: Canvas = c;
  if (!origem.dados.cena) novo = marcarComoCena(novo, gerarId);
  const nova: NoDoCanvas = {
    id: idNovo,
    tipo: "gerar",
    x: Math.round(p.x),
    y: Math.round(p.y),
    dados: {
      motores: (origem.dados.motores || []).slice(),
      formato: origem.dados.formato || "4:5",
      qualidade: origem.dados.qualidade || "alta",
      resolucao: origem.dados.resolucao || null,
      acao: "livre",
      pose: "nenhuma",
      carrossel: 0,
      resultados: [],
      cena: cenaNova(999, { enquadramento: origem.dados.cena ? origem.dados.cena.enquadramento : "livre", ...dados }),
    },
  };
  novo = { ...novo, nos: novo.nos.concat([nova]) };
  novo = ligar(novo, gerarId, idNovo, "personagem");
  // Os produtos ligados à cena de origem seguem na próxima (o produto não muda na história).
  entradasDoGerar(c, gerarId)
    .filter((e) => e.entrada === "produto" && e.no.tipo === "produto")
    .forEach((e) => {
      novo = ligar(novo, e.no.id, idNovo);
    });
  return depoisDe(novo, gerarId, idNovo);
}

/** Foto da cena na história: a escolhida (cena.imagem_id), senão a mais nova. */
export function fotoDaCena(no: Pick<NoDoCanvas, "dados">, aprovadas: string[] = []): ResultadoDoCanvas | null {
  return fotoDaLigacao(no, null, aprovadas);
}

// ------------------------------------------------------------------ pacote para a Mesa Vídeos

export interface CenaDoPacote {
  numero: number;
  no_id: string;
  titulo: string;
  acao: string;
  enquadramento: string;
  cenario: string;
  narrativa: string;
  /** A foto da cena (1º quadro do vídeo); null = ainda sem foto. */
  imagem_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  /** Quem e o que entra na cena (pelos cartões e cenas ligadas). */
  personagens: { no_id: string; tipo: "persona" | "pessoa_real" | "cena_anterior"; modelo_id: string | null; imagem_id: string | null }[];
  produtos: { no_id: string; kit_id: string | null; da_cena: boolean }[];
  animacao: CenaDoResultado["animacao"];
}

export interface PacoteDaHistoria {
  canvas_id: string | null;
  client_id: string;
  nome: string;
  sinopse: string;
  formato: string | null;
  cenas: CenaDoPacote[];
  /** Cenas sem foto ainda (a Mesa Vídeos só anima cena com foto). */
  sem_foto: number;
}

/**
 * O que a Mesa Vídeos lê do Canvas (contrato): a história com as cenas na
 * ordem, a foto de cada uma, quem entra e a animação reservada. Sem IA.
 */
export function pacoteDaHistoria(c: Canvas, aprovadas: string[] = []): PacoteDaHistoria {
  const cenas = cenasDaHistoria(c).map((h): CenaDoPacote => {
    const foto = fotoDaCena(h.no, aprovadas);
    const entradas = entradasDoGerar(c, h.no.id);
    return {
      numero: h.numero,
      no_id: h.no.id,
      titulo: h.cena.titulo.trim() || nomeDoResultado(c, h.no),
      acao: h.cena.acao,
      enquadramento: h.cena.enquadramento,
      cenario: h.cena.cenario,
      narrativa: h.cena.narrativa,
      imagem_id: foto ? foto.imagem_id : null,
      storage_bucket: foto ? foto.storage_bucket : null,
      storage_path: foto ? foto.storage_path : null,
      personagens: entradas
        .filter((e) => e.entrada === "pessoa")
        .map((e) => ({
          no_id: e.no.id,
          tipo: e.no.tipo === "gerar" ? ("cena_anterior" as const) : e.no.dados.modelo_id ? ("persona" as const) : ("pessoa_real" as const),
          modelo_id: e.no.tipo === "modelo" ? e.no.dados.modelo_id || null : null,
          imagem_id: e.no.tipo === "gerar" ? (fotoDaLigacao(e.no, e.ligacao.imagem_id, aprovadas) || { imagem_id: null }).imagem_id : e.no.dados.imagem_id || null,
        })),
      produtos: entradas.filter((e) => e.entrada === "produto").map((e) => ({ no_id: e.no.id, kit_id: e.no.tipo === "produto" ? e.no.dados.kit_id || null : null, da_cena: e.no.tipo === "gerar" })),
      animacao: h.cena.animacao,
    };
  });
  return {
    canvas_id: c.id,
    client_id: c.client_id,
    nome: c.nome,
    sinopse: c.historia ? c.historia.sinopse : "",
    formato: c.historia ? c.historia.formato : null,
    cenas,
    sem_foto: cenas.filter((x) => !x.imagem_id).length,
  };
}

// ------------------------------------------------------------------ acervo da Mesa Vídeos

export type GrupoDoAcervoDeVideo = "cena" | "clone" | "personagem" | "produto";

/**
 * O que do acervo serve à Mesa Vídeos: fotos de personagem, clones, produtos
 * e cenas. Artes, logos, antes e depois e carrosséis ficam fora (pedido do
 * dono); pessoa real sem autorização também. Mesma regra da função
 * (canvas-regras.ts, grupoNaMesaDeVideos).
 */
export function grupoNaMesaDeVideos(f: Pick<FotoDoAcervo, "tags" | "kit_id"> & { categoria?: string | null; modo?: string | null; ativa?: boolean | null }): GrupoDoAcervoDeVideo | null {
  const tags = f.tags || [];
  const comeca = (prefixo: string) => tags.some((t) => t.indexOf(prefixo) === 0);
  if (f.ativa === false) return null;
  if (["arte", "logo", "antes_depois"].indexOf(String(f.categoria || "")) >= 0) return null;
  if (tags.indexOf("carrossel") >= 0 || tags.indexOf("arte") >= 0 || comeca("carrossel:") || comeca("arte:")) return null;
  if (tags.indexOf("cena") >= 0 || comeca("cena:")) return "cena";
  if (f.modo === "clone" || tags.indexOf("pessoa_real_autorizada") >= 0 || comeca("clone:")) return "clone";
  if (comeca("personagem:") || comeca("persona:") || tags.indexOf("pessoa_sintetica") >= 0) return "personagem";
  if (f.kit_id || ["produto", "detalhe", "embalagem"].indexOf(String(f.categoria || "")) >= 0) return "produto";
  return null;
}

/** O acervo da Mesa Vídeos, em grupos (a ordem de cada grupo é a do acervo). */
export function acervoDaMesaDeVideos<T extends Parameters<typeof grupoNaMesaDeVideos>[0]>(fotos: T[]): Record<GrupoDoAcervoDeVideo, T[]> {
  const g: Record<GrupoDoAcervoDeVideo, T[]> = { cena: [], personagem: [], clone: [], produto: [] };
  fotos.forEach((f) => {
    const grupo = grupoNaMesaDeVideos(f);
    if (grupo) g[grupo].push(f);
  });
  return g;
}
