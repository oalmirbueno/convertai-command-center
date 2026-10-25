/**
 * Ponte Laboratório ↔ Campanhas (25/10/2026): as regras puras. Contrato: docs/laboratorio/PONTE-CAMPANHAS.md.
 *
 * Pedido do dono: "lê e vê o funil e tudo e já puxa pra campanha com base naquilo e já monta, e vice-versa;
 * atualizações e movimento de ambos os lados já atualiza as duas frentes, sempre complementando e nunca
 * substituindo". As regras:
 * - Cada nó ligado à campanha leva dados.sinc = { campanha_id, chave, origem, hash, base }. `base` guarda o que a
 *   campanha valia na última projeção, campo a campo: é assim que a ponte sabe quem mudou o quê.
 * - Campanha → canvas: projeta cliente, marca, produtos, oferta, público, funil, anúncio, uma peça por nó e os
 *   stories por fase. Nó novo entra; nó que a pessoa não mexeu acompanha a campanha; campo que os dois lados
 *   mudaram vira sugestão para o canvas. Nunca apaga nó da pessoa (nem o que ela apagou volta).
 * - Canvas → campanha: o que a pessoa mudou num nó ligado vai para a campanha (campo vazio preenche; com valor,
 *   vira sugestão). Nó de conteúdo sem marca vira peça nova na série. Oferta, público e funil que a pessoa pôs no
 *   canvas são adotados (ganham a marca) e complementam o briefing. Peça protegida (na agenda ou aprovada) não muda.
 * - Idempotente: rodar de novo sem mudança nos dois lados não muda nada (o eco do gatilho termina aqui).
 *
 * Puro (sem Deno, sem banco): a função e as telas importam o mesmo arquivo. Safari 11 (sem lookbehind, classe
 * Unicode nem grupo nomeado). Sem travessão nos textos.
 */

import { MAX_NOS, motivoParaNaoLigar, type TipoDeNo } from "../../laboratorio/modulos/regras.ts";
import { faseNaData, normalizarLinhaDoTempo, type FaseNaLinha, type LinhaDoTempo } from "../../agente-calendario/modulos/linha-do-tempo.ts";

// ------------------------------------------------------------------ tipos

export interface NoDaPonte {
  id: string;
  tipo: string;
  x: number;
  y: number;
  dados: Record<string, unknown>;
  [k: string]: unknown;
}

export interface LigacaoDaPonte {
  id: string;
  de: string;
  para: string;
  gatilho?: string;
  [k: string]: unknown;
}

export interface CanvasDaPonte {
  nos: NoDaPonte[];
  ligacoes: LigacaoDaPonte[];
  viewport?: { x: number; y: number; zoom: number };
  [k: string]: unknown;
}

export interface SincDoNo {
  campanha_id: string;
  chave: string;
  origem: "campanha" | "canvas";
  hash: string;
  /** O valor que a campanha tinha em cada campo na última projeção. */
  base: Record<string, unknown>;
  /** A peça saiu da campanha (o nó fica; a pessoa decide). */
  fora?: boolean;
}

export interface ProdutoDaCampanha {
  nome?: string;
  preco?: string | number | null;
  link?: string | null;
  [k: string]: unknown;
}

export interface CampanhaDaPonte {
  id: string;
  client_id: string;
  nome: string;
  objetivo: string | null;
  conceito: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  identidade: Record<string, unknown> | null;
  briefing: Record<string, unknown> | null;
  sincronia?: Record<string, unknown> | null;
}

export interface ItemDaPonte {
  tema_id: string;
  data: string;
  formato: string;
  etapa?: string;
  tema: string;
  gancho?: string;
  cta?: string;
  cards?: Array<{ ordem: number; texto?: string; funcao?: string; [k: string]: unknown }>;
  task_id?: string | null;
  status?: string;
  stories?: boolean;
  roteiro_video?: { gancho?: string } | null;
  video?: { prompt?: string } | null;
  [k: string]: unknown;
}

export type DestinoDaSugestao = "campanha" | "canvas";

export interface SugestaoDaPonte {
  destino: DestinoDaSugestao;
  /** campanha: "campanha:<caminho>"; canvas: "no:<chave do nó>:<campo>". */
  chave: string;
  rotulo: string;
  valor_atual: unknown;
  valor_sugerido: unknown;
}

export interface ResumoDaSincronia {
  nos_novos: number;
  nos_atualizados: number;
  pecas_novas: number;
  campos_preenchidos: number;
  sugestoes: number;
}

/** A última saída de cada nó (lab_execucoes), para ler o que o nó produziu. */
export type SaidasDosNos = Record<string, { saida: Record<string, unknown> | null; da_ponte?: boolean }>;

// ------------------------------------------------------------------ utilidades

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const txt = (v: unknown, max = 2000): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, max) : typeof v === "number" ? String(v) : "");
const vazio = (v: unknown) => v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

/** JSON estável (chaves em ordem) para comparar e assinar. */
export function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

export const iguais = (a: unknown, b: unknown) => estavel(normalizarValor(a)) === estavel(normalizarValor(b));

/** "" e null contam como iguais; número e texto do mesmo número também. */
function normalizarValor(v: unknown): unknown {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.trim();
  return v;
}

/** Assinatura curta (djb2 em hexadecimal). */
export function assinar(v: unknown): string {
  const s = estavel(v);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function sincDoNo(no: NoDaPonte | null | undefined): SincDoNo | null {
  const s = no ? obj(no.dados.sinc) : {};
  if (typeof s.campanha_id !== "string" || typeof s.chave !== "string") return null;
  return {
    campanha_id: s.campanha_id,
    chave: s.chave,
    origem: s.origem === "canvas" ? "canvas" : "campanha",
    hash: typeof s.hash === "string" ? s.hash : "",
    base: obj(s.base),
    ...(s.fora === true ? { fora: true } : {}),
  };
}

const idDaChave = (chave: string) => `sinc_${chave.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(0, 60);

export function rotuloDaChave(chave: string): string {
  if (chave === "cliente") return "Cliente";
  if (chave === "marca") return "Marca";
  if (chave === "oferta") return "Oferta";
  if (chave === "publico") return "Público";
  if (chave === "funil") return "Funil";
  if (chave === "anuncio") return "Anúncio";
  if (chave.indexOf("produto:") === 0) return "Produto";
  if (chave.indexOf("peca:") === 0) return "Peça";
  if (chave.indexOf("stories:") === 0) return "Stories";
  if (chave.indexOf("fase:") === 0) return "Peças da fase";
  return "Campanha";
}

const ROTULO_DO_CAMPO: Record<string, string> = {
  titulo: "título",
  produto: "produto",
  preco: "preço",
  instrucao: "oferta",
  publico: "público",
  objetivo: "objetivo",
  nome: "nome",
  link_externo: "link",
  tema: "tema",
  ideia: "ideia",
  laminas: "lâminas",
  formato_arte: "formato",
  oferta: "oferta",
};

// ------------------------------------------------------------------ projeção da campanha

export interface NoProjetado {
  chave: string;
  tipo: TipoDeNo;
  dados: Record<string, unknown>;
  /** Coluna do layout (0 entradas, 1 oferta, 2 funil e anúncio, 3+ as fases) e a ordem na coluna. */
  coluna: number;
  ordem: number;
  /** As chaves dos nós que entram neste (ligações da ponte). */
  de: string[];
}

export const COLUNA_X0 = 80;
export const COLUNA_DX = 340;
export const LINHA_Y0 = 80;
export const LINHA_DY = 230;
const PRIMEIRA_COLUNA_DE_FASE = 3;

const PROTEGIDO = /aprov|public|agend|postad/i;
export const pecaProtegida = (i: ItemDaPonte) => !!i.task_id || PROTEGIDO.test(String(i.status || ""));

export function linhaDaCampanha(c: CampanhaDaPonte): LinhaDoTempo | null {
  return normalizarLinhaDoTempo(obj(c.briefing).linha_do_tempo);
}

function produtosDe(c: CampanhaDaPonte): ProdutoDaCampanha[] {
  const p = obj(c.briefing).produtos;
  return (Array.isArray(p) ? p : []).map((x) => obj(x) as ProdutoDaCampanha).filter((x) => txt(x.nome));
}

/** Os campos que a projeção escreve para uma peça da série. */
export function dadosDaPeca(i: ItemDaPonte): { tipo: TipoDeNo; dados: Record<string, unknown> } {
  const tema = txt(i.tema, 300) || "Peça";
  if (i.formato === "video") {
    const ideia = txt((i.roteiro_video && i.roteiro_video.gancho) || (i.video && i.video.prompt) || i.gancho || i.tema, 600);
    return { tipo: "filme", dados: { titulo: tema.slice(0, 120), ideia, formato: "9:16" } };
  }
  if (i.formato === "carrossel" && !i.stories) {
    const n = Array.isArray(i.cards) && i.cards.length ? i.cards.length : 5;
    return { tipo: "carrossel", dados: { titulo: tema.slice(0, 120), tema, laminas: n } };
  }
  return { tipo: "template_designer", dados: { titulo: tema.slice(0, 120), formato_arte: i.stories ? "story_9_16" : "feed_4_5" } };
}

/** A fase (índice na linha do tempo) de uma data; sem linha, 0. */
function indiceDaFase(linha: LinhaDoTempo | null, data: string): number {
  if (!linha || !linha.fases.length) return 0;
  const f = faseNaData(linha, data);
  if (f) return Math.max(0, linha.fases.indexOf(f));
  if (data < linha.fases[0].inicio) return 0;
  return linha.fases.length - 1;
}

/** Tudo o que a campanha é, em nós (sem posição: a mescla põe na coluna e na ordem). */
export function projetarCampanha(c: CampanhaDaPonte, itens: ItemDaPonte[]): NoProjetado[] {
  const b = obj(c.briefing);
  const id = obj(c.identidade);
  const linha = linhaDaCampanha(c);
  const produtos = produtosDe(c);
  const saida: NoProjetado[] = [];
  saida.push({ chave: "cliente", tipo: "cliente", dados: { titulo: "Cliente", client_id: c.client_id }, coluna: 0, ordem: 0, de: [] });
  if (typeof id.marca_id === "string" && id.marca_id) {
    saida.push({ chave: "marca", tipo: "marca", dados: { titulo: "Marca", marca_id: id.marca_id }, coluna: 0, ordem: 1, de: [] });
  }
  produtos.slice(0, 6).forEach((p, k) => {
    saida.push({
      chave: `produto:${k}`,
      tipo: "produto",
      dados: { titulo: txt(p.nome, 120), nome: txt(p.nome, 200), preco: txt(p.preco, 60), link_externo: txt(p.link, 400) },
      coluna: 0,
      ordem: 2 + k,
      de: [],
    });
  });
  const publico = txt(b.publico, 1500);
  if (publico) saida.push({ chave: "publico", tipo: "avatar", dados: { titulo: "Público", publico }, coluna: 0, ordem: 2 + Math.min(6, produtos.length), de: [] });
  const instrucao = [txt(b.oferta, 1500), txt(b.mensagem_central, 800), (Array.isArray(b.provas) ? b.provas : []).map((x) => txt(x, 200)).filter(Boolean).join("; ")]
    .filter(Boolean)
    .join("\n");
  saida.push({
    chave: "oferta",
    tipo: "oferta",
    dados: { titulo: txt(c.nome, 120) || "Oferta", produto: produtos[0] ? txt(produtos[0].nome, 200) : "", preco: produtos[0] ? txt(produtos[0].preco, 60) : "", instrucao },
    coluna: 1,
    ordem: 0,
    de: ["cliente", "marca", "publico"].concat(produtos.slice(0, 6).map((_p, k) => `produto:${k}`)),
  });
  saida.push({ chave: "funil", tipo: "funil", dados: { titulo: "Funil da campanha", objetivo: txt(c.objetivo || c.conceito, 600) }, coluna: 2, ordem: 0, de: ["oferta", "publico"] });
  const ads = obj(b.ads);
  if (ads.campaign_id) {
    saida.push({ chave: "anuncio", tipo: "anuncio", dados: { titulo: txt(ads.nome, 120) || "Anúncio", objetivo: txt(c.objetivo, 300), publico, oferta: txt(b.oferta, 600) }, coluna: 2, ordem: 1, de: ["funil", "publico", "marca", "cliente"] });
  }
  // Uma peça por nó, na coluna da fase; os stories da campanha, um nó por fase.
  const porFase: Record<number, number> = {};
  itens
    .slice()
    .sort((x, y) => String(x.data).localeCompare(String(y.data)))
    .forEach((i) => {
      const f = indiceDaFase(linha, String(i.data || ""));
      const ordem = porFase[f] || 0;
      porFase[f] = ordem + 1;
      const p = dadosDaPeca(i);
      saida.push({ chave: `peca:${i.tema_id}`, tipo: p.tipo, dados: p.dados, coluna: PRIMEIRA_COLUNA_DE_FASE + f, ordem, de: p.tipo === "carrossel" ? ["funil", "marca"] : p.tipo === "filme" ? ["oferta", "marca"] : ["marca", "cliente"] });
    });
  const stories = (Array.isArray(b.stories) ? b.stories : []).map(obj);
  const fasesDosStories: string[] = [];
  stories.forEach((s) => {
    const etapa = txt(s.etapa, 60) || "campanha";
    if (fasesDosStories.indexOf(etapa) < 0) fasesDosStories.push(etapa);
  });
  fasesDosStories.forEach((etapa) => {
    const daFase = stories.filter((s) => (txt(s.etapa, 60) || "campanha") === etapa);
    const f = indiceDaFase(linha, txt(daFase[0].data, 10));
    const ordem = porFase[f] || 0;
    porFase[f] = ordem + 1;
    saida.push({
      chave: `stories:${etapa}`,
      tipo: "template_designer",
      dados: { titulo: `Stories: ${etapa} (${daFase.length})`, formato_arte: "story_9_16" },
      coluna: PRIMEIRA_COLUNA_DE_FASE + f,
      ordem,
      de: ["marca", "cliente"],
    });
  });
  return saida;
}

/** As fases da linha do tempo no formato da saída do nó Funil (gravada sem custo pela ponte). */
export function etapasDoFunil(c: CampanhaDaPonte): Array<{ nome: string; objetivo: string; pagina_ou_canal: string; mensagem: string; metrica_alvo: string }> {
  const linha = linhaDaCampanha(c);
  if (!linha) return [];
  return linha.fases.map((f: FaseNaLinha) => ({
    nome: `${f.nome} (${f.inicio.slice(8, 10)}/${f.inicio.slice(5, 7)} a ${f.fim.slice(8, 10)}/${f.fim.slice(5, 7)})`,
    objetivo: f.papel,
    pagina_ou_canal: "",
    mensagem: "",
    metrica_alvo: "",
  }));
}

// ------------------------------------------------------------------ campanha → canvas

export interface ResultadoDaMescla {
  canvas: CanvasDaPonte;
  mudou: boolean;
  sugestoes: SugestaoDaPonte[];
  resumo: ResumoDaSincronia;
  avisos: string[];
  /** As chaves que a campanha tem hoje no canvas (para saber, na próxima vez, o que a pessoa apagou). */
  chaves: string[];
}

const resumoVazio = (): ResumoDaSincronia => ({ nos_novos: 0, nos_atualizados: 0, pecas_novas: 0, campos_preenchidos: 0, sugestoes: 0 });

function posicaoLivre(canvas: CanvasDaPonte, coluna: number, ordem: number): { x: number; y: number } {
  const x = COLUNA_X0 + coluna * COLUNA_DX;
  let y = LINHA_Y0 + ordem * LINHA_DY;
  // Desce até achar um lugar sem nó (a pessoa pode ter posto coisa ali).
  for (let i = 0; i < 40 && canvas.nos.some((n) => Math.abs(n.x - x) < 200 && Math.abs(n.y - y) < 150); i++) y += LINHA_DY;
  return { x, y };
}

function clonar(c: CanvasDaPonte): CanvasDaPonte {
  return JSON.parse(JSON.stringify({ ...c, nos: Array.isArray(c.nos) ? c.nos : [], ligacoes: Array.isArray(c.ligacoes) ? c.ligacoes : [] })) as CanvasDaPonte;
}

function sincNovo(campanhaId: string, chave: string, origem: "campanha" | "canvas", base: Record<string, unknown>): SincDoNo {
  return { campanha_id: campanhaId, chave, origem, hash: assinar(base), base };
}

/**
 * Mescla a projeção da campanha no canvas. `removidas`: chaves que a ponte já tinha posto e a pessoa apagou
 * (não voltam). Devolve o canvas novo, as sugestões para o canvas e o resumo.
 */
export function mesclarNoCanvas(
  canvasAntes: CanvasDaPonte,
  campanha: CampanhaDaPonte,
  itens: ItemDaPonte[],
  opcoes: { removidas?: string[] } = {},
): ResultadoDaMescla {
  const canvas = clonar(canvasAntes);
  const removidas = opcoes.removidas || [];
  const resumo = resumoVazio();
  const sugestoes: SugestaoDaPonte[] = [];
  const avisos: string[] = [];
  const projetados = projetarCampanha(campanha, itens);
  const daCampanha = (n: NoDaPonte) => {
    const s = sincDoNo(n);
    return s && s.campanha_id === campanha.id ? s : null;
  };
  const noDaChave = (chave: string) => canvas.nos.filter((n) => {
    const s = daCampanha(n);
    return !!s && s.chave === chave;
  })[0];

  // Teto de nós: as peças que não cabem ficam agrupadas num nó por fase.
  const faltam = projetados.filter((p) => !noDaChave(p.chave) && removidas.indexOf(p.chave) < 0);
  let vagas = MAX_NOS - canvas.nos.length;
  const agrupar: Record<number, NoProjetado[]> = {};
  const criar: NoProjetado[] = [];
  faltam.forEach((p) => {
    const ehPeca = p.chave.indexOf("peca:") === 0;
    if (!ehPeca) {
      if (vagas > 0) {
        criar.push(p);
        vagas--;
      }
      return;
    }
    // Reserva uma vaga por fase para o grupo, se for preciso.
    const reservaDeGrupo = Object.keys(agrupar).length + 1;
    if (vagas > reservaDeGrupo) {
      criar.push(p);
      vagas--;
    } else {
      (agrupar[p.coluna] = agrupar[p.coluna] || []).push(p);
    }
  });
  Object.keys(agrupar).forEach((k) => {
    const lista = agrupar[Number(k)];
    const chave = `fase:${Number(k) - PRIMEIRA_COLUNA_DE_FASE}`;
    if (noDaChave(chave) || vagas <= 0) return;
    criar.push({ chave, tipo: "template_designer", dados: { titulo: `${lista.length} peças desta fase (o canvas está cheio)`, formato_arte: "feed_4_5" }, coluna: Number(k), ordem: 99, de: ["marca"] });
    vagas--;
  });
  if (Object.keys(agrupar).length) avisos.push(`O canvas chegou a ${MAX_NOS} nós: ${Object.keys(agrupar).reduce((s, k) => s + agrupar[Number(k)].length, 0)} peças ficaram agrupadas por fase.`);

  criar.forEach((p) => {
    const pos = posicaoLivre(canvas, p.coluna, p.ordem);
    let id = idDaChave(p.chave);
    for (let i = 2; canvas.nos.some((n) => n.id === id); i++) id = `${idDaChave(p.chave)}_${i}`;
    canvas.nos.push({ id, tipo: p.tipo, x: pos.x, y: pos.y, dados: { ...p.dados, sinc: sincNovo(campanha.id, p.chave, "campanha", p.dados) } });
    resumo.nos_novos++;
  });

  // Nós que já existem: acompanham a campanha onde a pessoa não mexeu.
  projetados.forEach((p) => {
    const no = noDaChave(p.chave);
    if (!no || criar.indexOf(p) >= 0) return;
    const s = daCampanha(no) as SincDoNo;
    const dados = { ...no.dados };
    const base = { ...s.base };
    let mexeu = false;
    Object.keys(p.dados).forEach((campo) => {
      const atual = dados[campo];
      const novo = p.dados[campo];
      const anterior = Object.prototype.hasOwnProperty.call(s.base, campo) ? s.base[campo] : undefined;
      if (!iguais(anterior, novo)) {
        base[campo] = novo;
        mexeu = true;
      }
      if (iguais(atual, novo)) return;
      const intocado = anterior === undefined ? vazio(atual) : iguais(atual, anterior);
      if (intocado) {
        dados[campo] = novo;
        mexeu = true;
        return;
      }
      // A pessoa mudou no canvas. Se a campanha também mudou desde a última vez, a campanha sugere ao canvas.
      if (anterior !== undefined && !iguais(anterior, novo)) {
        sugestoes.push({
          destino: "canvas",
          chave: `no:${p.chave}:${campo}`,
          rotulo: `${rotuloDaChave(p.chave)}: ${ROTULO_DO_CAMPO[campo] || campo} (a campanha mudou)`,
          valor_atual: atual,
          valor_sugerido: novo,
        });
      }
    });
    const fora = s.fora === true;
    if (mexeu || fora) {
      dados.sinc = { ...s, base, hash: assinar(base) };
      delete (dados.sinc as Record<string, unknown>).fora;
      no.dados = dados;
      resumo.nos_atualizados++;
    }
  });

  // Peça que saiu da campanha: o nó fica (é trabalho da pessoa), só marcado.
  const chavesDaCampanha = projetados.map((p) => p.chave);
  canvas.nos.forEach((n) => {
    const s = daCampanha(n);
    if (!s || s.chave.indexOf("peca:") !== 0 || chavesDaCampanha.indexOf(s.chave) >= 0 || s.fora) return;
    n.dados = { ...n.dados, sinc: { ...s, fora: true } };
    avisos.push(`A peça "${txt(n.dados.titulo, 80) || s.chave}" saiu da campanha; o nó ficou no canvas.`);
    resumo.nos_atualizados++;
  });

  // Ligações da ponte (só as que o Laboratório aceita; nunca tira ligação da pessoa).
  projetados.forEach((p) => {
    const para = noDaChave(p.chave);
    if (!para) return;
    p.de.forEach((chaveDe) => {
      const de = noDaChave(chaveDe);
      if (!de || canvas.ligacoes.some((l) => l.de === de.id && l.para === para.id)) return;
      if (motivoParaNaoLigar(canvas as never, de.id, para.id)) return;
      canvas.ligacoes.push({ id: `sinc_${de.id}_${para.id}`.slice(0, 120), de: de.id, para: para.id });
    });
  });

  resumo.sugestoes = sugestoes.length;
  const chaves = canvas.nos.map((n) => daCampanha(n)).filter((s): s is SincDoNo => !!s).map((s) => s.chave);
  return { canvas, mudou: estavel(canvas) !== estavel(canvasAntes), sugestoes, resumo, avisos, chaves };
}

// ------------------------------------------------------------------ canvas → campanha

/** O caminho da campanha que cada campo de um nó ligado alimenta (só o que tem volta). */
export function caminhoNaCampanha(chave: string, campo: string): string | null {
  if (chave === "oferta") {
    if (campo === "titulo") return "nome";
    if (campo === "instrucao") return "briefing.oferta";
    if (campo === "produto") return "briefing.produtos.0.nome";
    if (campo === "preco") return "briefing.produtos.0.preco";
    return null;
  }
  if (chave === "publico" && campo === "publico") return "briefing.publico";
  if (chave === "funil" && campo === "objetivo") return "objetivo";
  if (chave.indexOf("produto:") === 0) {
    const n = chave.slice(8);
    if (campo === "nome" || campo === "titulo") return `briefing.produtos.${n}.nome`;
    if (campo === "preco") return `briefing.produtos.${n}.preco`;
    if (campo === "link_externo") return `briefing.produtos.${n}.link`;
    return null;
  }
  if (chave.indexOf("peca:") === 0) {
    const t = chave.slice(5);
    if (campo === "titulo" || campo === "tema") return `itens.${t}.tema`;
    if (campo === "ideia") return `itens.${t}.gancho`;
    return null;
  }
  return null;
}

/** Lê um caminho da campanha (nome, objetivo, briefing.x, briefing.produtos.N.campo, itens.<tema_id>.campo). */
export function lerCaminho(c: CampanhaDaPonte, itens: ItemDaPonte[], caminho: string): unknown {
  const partes = caminho.split(".");
  if (partes[0] === "nome") return c.nome;
  if (partes[0] === "objetivo") return c.objetivo;
  if (partes[0] === "briefing") {
    const b = obj(c.briefing);
    if (partes[1] === "produtos") {
      const p = Array.isArray(b.produtos) ? obj(b.produtos[Number(partes[2])]) : {};
      return p[partes[3]];
    }
    return b[partes[1]];
  }
  if (partes[0] === "itens") {
    const i = itens.filter((x) => x.tema_id === partes[1])[0];
    return i ? (i as Record<string, unknown>)[partes[2]] : undefined;
  }
  return undefined;
}

/** Escreve um caminho numa cópia (campanha e itens). Peça protegida não muda (devolve false). */
export function escreverCaminho(c: CampanhaDaPonte, itens: ItemDaPonte[], caminho: string, valor: unknown): { campanha: CampanhaDaPonte; itens: ItemDaPonte[]; ok: boolean } {
  const partes = caminho.split(".");
  const campanha: CampanhaDaPonte = { ...c, briefing: { ...obj(c.briefing) } };
  let lista = itens;
  if (partes[0] === "nome") campanha.nome = txt(valor, 120) || c.nome;
  else if (partes[0] === "objetivo") campanha.objetivo = txt(valor, 600);
  else if (partes[0] === "briefing") {
    const b = campanha.briefing as Record<string, unknown>;
    if (partes[1] === "produtos") {
      const prods = (Array.isArray(b.produtos) ? b.produtos : []).map((x) => ({ ...obj(x) }));
      const n = Number(partes[2]);
      while (prods.length <= n) prods.push({ nome: "" });
      prods[n][partes[3]] = partes[3] === "preco" ? txt(valor, 60) : txt(valor, 400);
      b.produtos = prods;
    } else {
      b[partes[1]] = Array.isArray(valor) ? valor : txt(valor, 2000);
    }
  } else if (partes[0] === "itens") {
    const alvo = itens.filter((x) => x.tema_id === partes[1])[0];
    if (!alvo || pecaProtegida(alvo)) return { campanha: c, itens, ok: false };
    lista = itens.map((x) => (x.tema_id === partes[1] ? { ...x, [partes[2]]: txt(valor, 600) } : x));
  } else {
    return { campanha: c, itens, ok: false };
  }
  return { campanha, itens: lista, ok: true };
}

const TIPOS_DE_CONTEUDO = ["carrossel", "imagem", "template_designer", "filme", "ugc", "video"];

/** O formato da peça de um nó de conteúdo do canvas. */
export function formatoDoNo(no: NoDaPonte): { formato: string; stories: boolean } {
  if (no.tipo === "carrossel") return { formato: "carrossel", stories: false };
  if (no.tipo === "filme" || no.tipo === "ugc" || no.tipo === "video") return { formato: "video", stories: false };
  const stories = no.tipo === "template_designer" && no.dados.formato_arte === "story_9_16";
  return { formato: "estatico", stories };
}

/** O tema de um nó de conteúdo (o que a pessoa escreveu nele). */
function temaDoNo(no: NoDaPonte): string {
  const d = no.dados;
  return txt(d.tema, 300) || txt(d.ideia, 300) || txt(d.prompt, 300) || txt(d.titulo, 300) || "Peça do canvas";
}

/** A fase pela coluna do canvas (a mais perto de onde o nó está). */
export function faseDaPosicao(linha: LinhaDoTempo | null, x: number): FaseNaLinha | null {
  if (!linha || !linha.fases.length) return null;
  const col = Math.round((x - COLUNA_X0) / COLUNA_DX) - PRIMEIRA_COLUNA_DE_FASE;
  return linha.fases[Math.max(0, Math.min(linha.fases.length - 1, col))];
}

const seqDosItens = (itens: ItemDaPonte[]) => Math.max(itens.length, ...itens.map((i) => Number(String(i.tema_id).replace(/^c/, "")) || 0));

/** Item novo da série a partir de um nó de conteúdo (mínimo que o agente-calendario lê). */
export function itemDoNo(no: NoDaPonte, campanha: CampanhaDaPonte, itens: ItemDaPonte[], saidas: SaidasDosNos, seq: number): ItemDaPonte {
  const linha = linhaDaCampanha(campanha);
  const fase = faseDaPosicao(linha, no.x);
  const inicio = campanha.periodo_inicio || (linha ? linha.inicio : "");
  const data = fase ? fase.inicio : inicio;
  const f = formatoDoNo(no);
  const tema = temaDoNo(no);
  const saida = obj(saidas[no.id] && saidas[no.id].saida);
  const laminasDaSaida = (Array.isArray(saida.laminas) ? saida.laminas : []).map(obj);
  const n = Number(no.dados.laminas) || 0;
  const cards = f.formato === "carrossel"
    ? (laminasDaSaida.length
      ? laminasDaSaida.slice(0, 10).map((l, k) => ({ ordem: k + 1, texto: [txt(l.titulo, 200), txt(l.texto, 600)].filter(Boolean).join(": ") || tema, funcao: k === 0 ? "capa" : "conteudo" }))
      : Array.from({ length: Math.max(1, Math.min(10, n || 5)) }, (_x, k) => ({ ordem: k + 1, texto: k === 0 ? tema : "", funcao: k === 0 ? "capa" : "conteudo" })))
    : f.formato === "video"
      ? []
      : [{ ordem: 1, texto: tema, funcao: "capa" }];
  return {
    tema_id: `c${seq}`,
    data,
    formato: f.formato,
    ...(fase ? { etapa: fase.etapa } : {}),
    tema,
    gancho: f.formato === "video" ? txt(no.dados.ideia, 300) || tema : tema,
    cta: txt(obj(campanha.briefing).cta, 200),
    cards,
    ...(f.stories ? { stories: true } : {}),
    pilar: "",
    fase: "",
    publico: "",
    resumo: "",
    copy: "",
    objetivo: "",
    metrica_principal: "",
    palavra_chave: "",
    termo_regional: null,
    status: "planejado",
    tipo_conteudo: "principal",
    carrossel_infinito: false,
    campanha_id: campanha.id,
    mesa: f.formato === "video" ? "video" : "arte",
  };
}

export interface ResultadoDoComplemento {
  campanha: CampanhaDaPonte;
  itens: ItemDaPonte[];
  canvas: CanvasDaPonte;
  campanhaMudou: boolean;
  itensMudaram: boolean;
  canvasMudou: boolean;
  sugestoes: SugestaoDaPonte[];
  resumo: ResumoDaSincronia;
  avisos: string[];
}

const CANAIS_DO_TIPO: Record<string, string> = {
  pagina: "site",
  landing: "site",
  checkout: "site",
  quiz: "site",
  whatsapp: "whatsapp",
  sequencia_mensagens: "whatsapp",
  email: "email",
  anuncio: "anuncios",
  webinar: "webinar",
};

/** Os nós avulsos que a ponte adota como a oferta, o público e o funil da campanha (um de cada). */
const ADOTAVEIS: Array<{ chave: string; tipo: string }> = [
  { chave: "oferta", tipo: "oferta" },
  { chave: "publico", tipo: "avatar" },
  { chave: "funil", tipo: "funil" },
];

/**
 * O que o canvas tem e a campanha não: complementa (campo vazio preenche; diferente vira sugestão para a
 * campanha) e leva os nós de conteúdo novos para a série. Devolve também o canvas com as marcas novas.
 */
export function complementarCampanha(
  canvasAntes: CanvasDaPonte,
  campanhaAntes: CampanhaDaPonte,
  itensAntes: ItemDaPonte[],
  saidas: SaidasDosNos,
): ResultadoDoComplemento {
  const canvas = clonar(canvasAntes);
  let campanha: CampanhaDaPonte = { ...campanhaAntes, briefing: { ...obj(campanhaAntes.briefing) } };
  let itens = itensAntes.slice();
  const sugestoes: SugestaoDaPonte[] = [];
  const avisos: string[] = [];
  const resumo = resumoVazio();
  const daCampanha = (n: NoDaPonte) => {
    const s = sincDoNo(n);
    return s && s.campanha_id === campanha.id ? s : null;
  };

  // 1) Adota a oferta, o público e o funil que a pessoa pôs no canvas (sem duplicar com a projeção).
  ADOTAVEIS.forEach((a) => {
    if (canvas.nos.some((n) => {
      const s = daCampanha(n);
      return !!s && s.chave === a.chave;
    })) return;
    const avulso = canvas.nos.filter((n) => n.tipo === a.tipo && !sincDoNo(n))[0];
    if (avulso) avulso.dados = { ...avulso.dados, sinc: sincNovo(campanha.id, a.chave, "canvas", {}) };
  });

  // 2) Campo mudado no canvas (diferente do que a campanha tinha na base) vai para a campanha.
  const aplicar = (caminho: string, valor: unknown, rotulo: string) => {
    if (vazio(valor)) return;
    const atual = lerCaminho(campanha, itens, caminho);
    if (iguais(atual, valor)) return;
    if (vazio(atual)) {
      const r = escreverCaminho(campanha, itens, caminho, valor);
      if (r.ok) {
        campanha = r.campanha;
        itens = r.itens;
        resumo.campos_preenchidos++;
      } else {
        avisos.push(`${rotulo}: a peça está na agenda ou aprovada; não mudei.`);
      }
      return;
    }
    if (caminho.indexOf("itens.") === 0) {
      const alvo = itens.filter((x) => x.tema_id === caminho.split(".")[1])[0];
      if (alvo && pecaProtegida(alvo)) {
        avisos.push(`${rotulo}: a peça está na agenda ou aprovada; a mudança do canvas ficou só no canvas.`);
        return;
      }
    }
    sugestoes.push({ destino: "campanha", chave: `campanha:${caminho}`, rotulo, valor_atual: atual, valor_sugerido: valor });
  };
  canvas.nos.forEach((n) => {
    const s = daCampanha(n);
    if (!s) return;
    Object.keys(n.dados).forEach((campo) => {
      if (campo === "sinc") return;
      const caminho = caminhoNaCampanha(s.chave, campo);
      if (!caminho) return;
      const valor = n.dados[campo];
      const anterior = Object.prototype.hasOwnProperty.call(s.base, campo) ? s.base[campo] : undefined;
      // A pessoa só "mudou" se difere do que a campanha tinha na última projeção.
      if (anterior !== undefined && iguais(valor, anterior)) return;
      aplicar(caminho, valor, `${rotuloDaChave(s.chave)}: ${ROTULO_DO_CAMPO[campo] || campo}`);
    });
  });

  // 3) O que os nós produziram (saídas) complementa o briefing.
  const primeiro = (tipo: string) => canvas.nos.filter((n) => n.tipo === tipo)[0];
  const saidaJson = (n: NoDaPonte | undefined) => {
    if (!n || !saidas[n.id] || saidas[n.id].da_ponte) return {};
    const s = obj(saidas[n.id].saida);
    return obj(s.json);
  };
  const oferta = primeiro("oferta");
  const jo = saidaJson(oferta);
  if (txt(jo.promessa)) aplicar("briefing.mensagem_central", txt(jo.promessa, 800), "Promessa da oferta");
  if (txt(jo.publico)) aplicar("briefing.publico", txt(jo.publico, 1500), "Público da oferta");
  const funil = primeiro("funil");
  const jf = saidaJson(funil);
  if (txt(jf.resumo)) aplicar("briefing.conducao", txt(jf.resumo, 1500), "Condução do funil");
  const ja = saidaJson(primeiro("anuncio"));
  if (txt(ja.cta)) aplicar("briefing.cta", txt(ja.cta, 200), "Chamada do anúncio");

  // 4) Produtos avulsos do canvas que a campanha não tem entram na lista.
  const b = campanha.briefing as Record<string, unknown>;
  const produtos = (Array.isArray(b.produtos) ? b.produtos : []).map((x) => ({ ...obj(x) }));
  const nomes = produtos.map((p) => txt(p.nome).toLowerCase());
  let produtosMudaram = false;
  canvas.nos.forEach((n) => {
    if (n.tipo !== "produto" || sincDoNo(n)) return;
    const nome = txt(n.dados.nome, 200) || txt(n.dados.titulo, 200);
    if (!nome || nomes.indexOf(nome.toLowerCase()) >= 0 || produtos.length >= 6) return;
    produtos.push({ nome, preco: txt(n.dados.preco, 60), link: txt(n.dados.link_externo, 400), por_que: "" });
    nomes.push(nome.toLowerCase());
    n.dados = { ...n.dados, sinc: sincNovo(campanha.id, `produto:${produtos.length - 1}`, "canvas", { titulo: nome.slice(0, 120), nome, preco: txt(n.dados.preco, 60), link_externo: txt(n.dados.link_externo, 400) }) };
    produtosMudaram = true;
    resumo.campos_preenchidos++;
  });
  if (produtosMudaram) campanha = { ...campanha, briefing: { ...b, produtos } };

  // 5) Canais pelos nós do funil (só soma).
  const canais = (Array.isArray(obj(campanha.briefing).canais) ? (obj(campanha.briefing).canais as unknown[]) : []).map((x) => txt(x, 40)).filter(Boolean);
  const antes = canais.length;
  canvas.nos.forEach((n) => {
    const canal = CANAIS_DO_TIPO[n.tipo];
    if (canal && canais.map((x) => x.toLowerCase()).indexOf(canal) < 0) canais.push(canal);
  });
  if (canais.length !== antes) {
    campanha = { ...campanha, briefing: { ...obj(campanha.briefing), canais: canais.slice(0, 12) } };
    resumo.campos_preenchidos++;
  }

  // 6) Nós de conteúdo sem marca viram peças novas da série.
  let seq = seqDosItens(itens);
  canvas.nos.forEach((n) => {
    if (TIPOS_DE_CONTEUDO.indexOf(n.tipo) < 0 || sincDoNo(n)) return;
    seq++;
    const item = itemDoNo(n, campanha, itens, saidas, seq);
    itens = itens.concat([item]);
    const p = dadosDaPeca(item);
    n.dados = { ...n.dados, sinc: sincNovo(campanha.id, `peca:${item.tema_id}`, "canvas", p.dados) };
    resumo.pecas_novas++;
  });
  itens.sort((x, y) => String(x.data).localeCompare(String(y.data)));

  resumo.sugestoes = sugestoes.length;
  return {
    campanha,
    itens,
    canvas,
    campanhaMudou: estavel({ n: campanha.nome, o: campanha.objetivo, b: campanha.briefing }) !== estavel({ n: campanhaAntes.nome, o: campanhaAntes.objetivo, b: obj(campanhaAntes.briefing) }),
    itensMudaram: estavel(itens) !== estavel(itensAntes),
    canvasMudou: estavel(canvas) !== estavel(canvasAntes),
    sugestoes,
    resumo,
    avisos,
  };
}

// ------------------------------------------------------------------ as duas passadas

export interface ResultadoDaPonte {
  campanha: CampanhaDaPonte;
  itens: ItemDaPonte[];
  canvas: CanvasDaPonte;
  campanhaMudou: boolean;
  itensMudaram: boolean;
  canvasMudou: boolean;
  sugestoes: SugestaoDaPonte[];
  resumo: ResumoDaSincronia;
  avisos: string[];
  chaves: string[];
}

/**
 * Uma passada completa: primeiro o canvas complementa a campanha, depois a campanha (já complementada) é
 * projetada no canvas. As chaves que estavam no canvas da última vez e sumiram foram apagadas pela pessoa.
 */
export function sincronizar(canvas: CanvasDaPonte, campanha: CampanhaDaPonte, itens: ItemDaPonte[], saidas: SaidasDosNos): ResultadoDaPonte {
  const sincronia = obj(campanha.sincronia);
  const chavesAntes = (Array.isArray(sincronia.chaves) ? sincronia.chaves : []).map((x) => String(x));
  const removidasAntes = (Array.isArray(sincronia.removidas) ? sincronia.removidas : []).map((x) => String(x));
  const presentes = canvas.nos.map((n) => sincDoNo(n)).filter((s): s is SincDoNo => !!s && s.campanha_id === campanha.id).map((s) => s.chave);
  const removidas = removidasAntes.concat(chavesAntes.filter((k) => presentes.indexOf(k) < 0 && removidasAntes.indexOf(k) < 0));

  const c1 = complementarCampanha(canvas, campanha, itens, saidas);
  const c2 = mesclarNoCanvas(c1.canvas, c1.campanha, c1.itens, { removidas });
  const resumo: ResumoDaSincronia = {
    nos_novos: c2.resumo.nos_novos,
    nos_atualizados: c2.resumo.nos_atualizados,
    pecas_novas: c1.resumo.pecas_novas,
    campos_preenchidos: c1.resumo.campos_preenchidos,
    sugestoes: c1.sugestoes.length + c2.sugestoes.length,
  };
  return {
    campanha: { ...c1.campanha, sincronia: { ...sincronia, chaves: c2.chaves, removidas: removidas.slice(-200) } },
    itens: c1.itens,
    canvas: c2.canvas,
    campanhaMudou: c1.campanhaMudou,
    itensMudaram: c1.itensMudaram,
    canvasMudou: estavel(c2.canvas) !== estavel(canvas),
    sugestoes: c1.sugestoes.concat(c2.sugestoes),
    resumo,
    avisos: c1.avisos.concat(c2.avisos),
    chaves: c2.chaves,
  };
}

// ------------------------------------------------------------------ montar a campanha pelo canvas

/** O pedido para o agente-calendario criar a campanha a partir do canvas. */
export function pedidoDoCanvas(canvas: CanvasDaPonte, saidas: SaidasDosNos, nomeDoProjeto: string): {
  pedido: string;
  nome: string;
  briefing: Record<string, unknown>;
  formatos: { posts: number; carrosseis: number; stories: number; videos: number };
  quantidade: number;
} {
  const nos = Array.isArray(canvas.nos) ? canvas.nos : [];
  const primeiro = (tipo: string) => nos.filter((n) => n.tipo === tipo)[0];
  const json = (n: NoDaPonte | undefined) => obj(obj(n && saidas[n.id] ? saidas[n.id].saida : null).json);
  const oferta = primeiro("oferta");
  const jo = json(oferta);
  const avatar = primeiro("avatar");
  const funil = primeiro("funil");
  const jf = json(funil);
  const produtos = nos.filter((n) => n.tipo === "produto").slice(0, 6).map((n) => ({ nome: txt(n.dados.nome, 200) || txt(n.dados.titulo, 200), preco: txt(n.dados.preco, 60), link: txt(n.dados.link_externo, 400), por_que: "" })).filter((p) => p.nome);
  const etapas = (Array.isArray(jf.etapas) ? jf.etapas : []).map(obj).map((e) => txt(e.nome, 80)).filter(Boolean);
  const formatos = { posts: 0, carrosseis: 0, stories: 0, videos: 0 };
  nos.forEach((n) => {
    if (TIPOS_DE_CONTEUDO.indexOf(n.tipo) < 0) return;
    const f = formatoDoNo(n);
    if (f.formato === "carrossel") formatos.carrosseis++;
    else if (f.formato === "video") formatos.videos++;
    else if (f.stories) formatos.stories++;
    else formatos.posts++;
  });
  const quantidade = formatos.posts + formatos.carrosseis + formatos.videos;
  if (!quantidade) {
    formatos.posts = 3;
    formatos.carrosseis = 2;
    formatos.videos = 1;
  }
  const ofertaTexto = txt(jo.texto_completo, 1500) || txt(oferta && oferta.dados.instrucao, 1500) || txt(oferta && oferta.dados.produto, 300);
  const publico = txt(avatar && avatar.dados.publico, 1200) || txt(jo.publico, 1200);
  const partes = [
    `Campanha montada a partir do canvas do Laboratório "${nomeDoProjeto}".`,
    ofertaTexto ? `Oferta: ${ofertaTexto}` : "",
    txt(jo.promessa) ? `Promessa: ${txt(jo.promessa, 400)}` : "",
    publico ? `Público: ${publico}` : "",
    funil && txt(funil.dados.objetivo) ? `Objetivo do funil: ${txt(funil.dados.objetivo, 400)}` : "",
    etapas.length ? `Etapas do funil: ${etapas.join(" → ")}.` : "",
    produtos.length ? `Produtos: ${produtos.map((p) => `${p.nome}${p.preco ? ` (${p.preco})` : ""}`).join("; ")}.` : "",
    "Use o funil e as peças do canvas como base; complemente o que faltar.",
  ].filter(Boolean);
  const briefing: Record<string, unknown> = {};
  if (ofertaTexto) briefing.oferta = ofertaTexto;
  if (publico) briefing.publico = publico;
  if (txt(jo.promessa)) briefing.mensagem_central = txt(jo.promessa, 800);
  if (produtos.length) briefing.produtos = produtos;
  return {
    pedido: partes.join("\n").replace(/→/g, ">").slice(0, 4000),
    nome: txt(oferta && oferta.dados.titulo, 120) || txt(nomeDoProjeto, 120) || "Campanha do Laboratório",
    briefing,
    formatos,
    quantidade: quantidade || 6,
  };
}

// ------------------------------------------------------------------ sugestões aceitas

/** Aplica no canvas uma sugestão aceita (destino canvas): o campo do nó e a base da marca. */
export function aplicarSugestaoNoCanvas(canvas: CanvasDaPonte, campanhaId: string, chave: string, valor: unknown): { canvas: CanvasDaPonte; ok: boolean } {
  const m = /^no:(.+):([a-z_]+)$/.exec(chave);
  if (!m) return { canvas, ok: false };
  const novo = clonar(canvas);
  const no = novo.nos.filter((n) => {
    const s = sincDoNo(n);
    return !!s && s.campanha_id === campanhaId && s.chave === m[1];
  })[0];
  if (!no) return { canvas, ok: false };
  const s = sincDoNo(no) as SincDoNo;
  const base = { ...s.base, [m[2]]: valor };
  no.dados = { ...no.dados, [m[2]]: valor, sinc: { ...s, base, hash: assinar(base) } };
  return { canvas: novo, ok: true };
}

/** Normaliza o canvas lido do banco (as duas formas que o Laboratório aceita). */
export function canvasDoBanco(v: unknown): CanvasDaPonte {
  const o = obj(v);
  const nos = (Array.isArray(o.nos) ? o.nos : []).map((x) => {
    const n = obj(x);
    return { ...n, id: String(n.id || ""), tipo: String(n.tipo || ""), x: Number(n.x) || 0, y: Number(n.y) || 0, dados: obj(n.dados) } as NoDaPonte;
  });
  const ligacoes = (Array.isArray(o.ligacoes) ? o.ligacoes : []).map((x) => {
    const l = obj(x);
    return { ...l, id: String(l.id || ""), de: String(l.de || ""), para: String(l.para || "") } as LigacaoDaPonte;
  });
  const vp = obj(o.viewport);
  return { ...o, nos, ligacoes, viewport: { x: Number(vp.x) || 0, y: Number(vp.y) || 0, zoom: Number(vp.zoom) || 1 } };
}
