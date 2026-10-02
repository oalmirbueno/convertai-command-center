/**
 * Agente do Mês v2 (dono, 26/09): "entender e aplicar o que eu mandar; dá pra
 * enviar zip e ele lê, e arquivos; mais de 1 milhão de tokens e o Sol 6 alto;
 * se eu copiar vários conteúdos de outro lugar ele entende e faz exatamente,
 * adaptando; o mês se baseia também no MCP; se o prompt tiver outro público e
 * ele identificar que de fato tem, já adapta".
 *
 * Aqui só a parte pura (sem Deno nem npm): a tela e os testes (vitest) leem o
 * mesmo arquivo. O index.ts usa tudo daqui.
 *
 * - Modelo: GPT-6 Sol pelo OpenRouter, raciocínio alto, só neste agente (as
 *   outras telas seguem o padrão "estrategista" do catálogo). Um modelo marcado
 *   no catálogo com o papel "agente_mes" vale por cima desta constante.
 * - Contexto grande: tetos altos e um orçamento de tokens que corta primeiro o
 *   que menos importa (nunca a mensagem do dono).
 * - Arquivos lidos no navegador (texto, PDF, Word, planilha, ZIP) chegam como
 *   texto; ficam guardados e voltam nos pedidos seguintes.
 * - Colagem estruturada vira criar_conteudos (datas, formatos, temas e a
 *   referência de cada linha) ou ações na agenda gravada.
 * - Público do prompt: o Jev julga se é real para o cliente (Noul); alto
 *   adapta e propõe atualizar o contexto, baixo mantém, meio pergunta.
 */

import { TIPO_DA_ACAO, type AcaoDoAgente } from "../_shared/acoes-do-agente.ts";
import type { PerguntaNoul, RespostaJev } from "../_shared/jev.ts";
// 02/10: peça de foto (Mesa Foto) e as regras de conteúdo do dono no Mês.
import { type DirecaoDeFoto, formatoDoMes, normalizarDirecaoDeFoto, resumoDaDirecaoDeFoto } from "./modulos/peca-de-foto.ts";
import { REGRAS_DE_CONTEUDO_DO_MES } from "./modulos/cadencia-do-mes.ts";

// ------------------------------------------------------------------ modelo

/** GPT-6 Sol no catálogo (ia_modelos, ativo, contexto de 1.050.000 tokens). */
export const MODELO_DO_AGENTE_DO_MES = "openrouter:openai/gpt-6-sol";
export const RACIOCINIO_DO_AGENTE_DO_MES = "high";
/** Papel próprio no catálogo (padrao_para): o dono pode trocar o modelo deste agente sem mexer no estrategista. */
export const PAPEL_DO_AGENTE_DO_MES = "agente_mes";
/** Contexto do GPT-6 Sol. */
export const CONTEXTO_DO_MODELO_DO_MES = 1_050_000;

const ORDEM_DO_RACIOCINIO = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Raciocínio do agente do Mês: o que a chamada pediu (se o modelo aceita), senão
 * alto; modelo sem "high" fica no nível aceito mais perto, de baixo para cima.
 */
export function raciocinioDoMes(aceitos: string[] | null | undefined, explicito?: unknown): string | undefined {
  const lista = Array.isArray(aceitos) ? aceitos.map(String) : [];
  const pedido = typeof explicito === "string" ? explicito.trim() : "";
  if (pedido && (!lista.length || lista.indexOf(pedido) >= 0)) return pedido;
  if (!lista.length) return undefined;
  if (lista.indexOf(RACIOCINIO_DO_AGENTE_DO_MES) >= 0) return RACIOCINIO_DO_AGENTE_DO_MES;
  const alvo = ORDEM_DO_RACIOCINIO.indexOf(RACIOCINIO_DO_AGENTE_DO_MES);
  const acima = lista.filter((n) => ORDEM_DO_RACIOCINIO.indexOf(n) >= alvo).sort((a, b) => ORDEM_DO_RACIOCINIO.indexOf(a) - ORDEM_DO_RACIOCINIO.indexOf(b));
  return acima[0] || lista[lista.length - 1];
}

type LinhaDoCatalogo = { id: string; ativo?: boolean | null; disponivel?: boolean | null; padrao_para?: string[] | null; tipo?: string | null };

/**
 * Modelo do agente do Mês no catálogo: o marcado com o papel "agente_mes"; sem
 * ele, o GPT-6 Sol (se ativo). Null quando nenhum dos dois está ativo (quem
 * chama cai no padrão do estrategista e avisa).
 */
export function modeloDoMesNoCatalogo<T extends LinhaDoCatalogo>(catalogo: T[] | null | undefined): T | null {
  const ativos = (catalogo || []).filter((m) => m && m.ativo !== false && m.disponivel !== false && (!m.tipo || m.tipo === "texto"));
  const doPapel = ativos.find((m) => Array.isArray(m.padrao_para) && m.padrao_para.indexOf(PAPEL_DO_AGENTE_DO_MES) >= 0);
  if (doPapel) return doPapel;
  return ativos.find((m) => m.id === MODELO_DO_AGENTE_DO_MES) || null;
}

// ------------------------------------------------------------------ tetos

/** Mensagem do dono: cabe uma agenda inteira colada de outra agência. */
export const MAX_CHARS_MENSAGEM_DO_MES = 200_000;
/** Conversa recente que volta ao modelo. */
export const MAX_MENSAGENS_DO_HISTORICO = 24;
export const MAX_CHARS_POR_MENSAGEM_DO_HISTORICO = 40_000;
/** Arquivos lidos no navegador, por pedido. */
export const MAX_ARQUIVOS_LIDOS = 200;
export const MAX_CHARS_POR_ARQUIVO = 400_000;
export const MAX_CHARS_DOS_ARQUIVOS = 1_200_000;
/** Pedidos anteriores cujos arquivos continuam no contexto. */
export const TURNOS_COM_ARQUIVOS = 3;
/** Contexto do MCP (itens ativos) no agente do Mês; nos outros geradores o teto é menor. */
export const MAX_CHARS_DO_MCP_NO_MES = 400_000;
export const MAX_CHARS_DO_MCP_NOS_GERADORES = 60_000;
/** Agenda longa: do mês em conversa (ou do atual, o que vier antes) até 12 meses à frente. */
export const MESES_DA_AGENDA_LONGA = 12;
/**
 * Teto de entrada do pedido (tokens estimados). O GPT-6 Sol aceita 1.050.000;
 * a folga fica para o raciocínio alto, a resposta e o erro da estimativa. A
 * Edge Function tem ~256 MB: 700 mil tokens são ~2,3 milhões de caracteres
 * (poucos MB), longe do limite.
 */
export const TETO_TOKENS_DO_PEDIDO = 700_000;
/** Estimativa conservadora (português tem ~3,5 a 4 caracteres por token). */
export const CHARS_POR_TOKEN = 3.2;

export function estimarTokens(t: string | null | undefined): number {
  return Math.ceil(String(t || "").length / CHARS_POR_TOKEN);
}

export type ParteDoPedido = {
  chave: string;
  texto: string;
  /** Maior = mais importante (cortada por último). A mensagem do dono não entra aqui: nunca é cortada. */
  prioridade: number;
  /** Caracteres que ficam mesmo no corte. */
  minimo?: number;
};

export type CorteDoOrcamento = { chave: string; de: number; para: number };

/**
 * Faz o pedido caber no teto de tokens: corta primeiro a parte de menor
 * prioridade (do fim para o começo, deixando o mínimo), depois a seguinte.
 * `fixo` são os tokens que não se cortam (sistema, mensagem do dono).
 */
export function caberNoOrcamento(
  partes: ParteDoPedido[],
  tetoTokens = TETO_TOKENS_DO_PEDIDO,
  fixo = 0,
): { partes: Array<{ chave: string; texto: string }>; cortes: CorteDoOrcamento[]; tokens: number } {
  const saida = partes.map((p) => ({ ...p }));
  let total = fixo + saida.reduce((s, p) => s + estimarTokens(p.texto), 0);
  const cortes: CorteDoOrcamento[] = [];
  const ordem = saida.map((_, i) => i).sort((a, b) => saida[a].prioridade - saida[b].prioridade);
  for (const i of ordem) {
    if (total <= tetoTokens) break;
    const p = saida[i];
    const minimo = Math.max(0, p.minimo ?? 0);
    const sobra = p.texto.length - minimo;
    if (sobra <= 0) continue;
    const excessoChars = Math.ceil((total - tetoTokens) * CHARS_POR_TOKEN) + 400;
    const corte = Math.min(sobra, excessoChars);
    const antes = p.texto.length;
    const aviso = `\n[cortado para caber no contexto: ${corte} caracteres a menos]`;
    p.texto = `${p.texto.slice(0, antes - corte)}${aviso}`;
    total = fixo + saida.reduce((s, x) => s + estimarTokens(x.texto), 0);
    cortes.push({ chave: p.chave, de: antes, para: p.texto.length });
  }
  return { partes: saida.map((p) => ({ chave: p.chave, texto: p.texto })), cortes, tokens: total };
}

// ------------------------------------------------------------------ arquivos lidos no navegador

export type ArquivoLido = {
  nome: string;
  /** texto, pdf, word, planilha, apresentacao, zip... (o que a tela leu). */
  tipo: string;
  tamanho: number;
  caracteres: number;
  /** Arquivo de dentro de um ZIP: o nome do ZIP. */
  origem: string | null;
  texto: string;
};
export type ArquivoNaoLido = { nome: string; motivo: string; tamanho: number | null; origem: string | null };

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const numero = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);

/**
 * Lê os arquivos que a tela mandou (corpo.arquivos = { lidos, nao_lidos }).
 * Tetos: 200 arquivos, 400 mil caracteres por arquivo e 1,2 milhão no total;
 * o que passa é cortado com aviso e entra em `cortados`.
 */
export function normalizarArquivos(bruto: unknown): { lidos: ArquivoLido[]; nao_lidos: ArquivoNaoLido[]; cortados: string[] } {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const lidos: ArquivoLido[] = [];
  const cortados: string[] = [];
  let total = 0;
  for (const a of (Array.isArray(o.lidos) ? o.lidos : []).slice(0, MAX_ARQUIVOS_LIDOS)) {
    const x = (a ?? {}) as Record<string, unknown>;
    const nome = umaLinha(x.nome, 200) || "arquivo";
    let t = typeof x.texto === "string" ? x.texto.replace(/\u0000/g, "") : "";
    if (!t.trim()) continue;
    const cabe = Math.min(MAX_CHARS_POR_ARQUIVO, MAX_CHARS_DOS_ARQUIVOS - total);
    if (cabe <= 0) {
      cortados.push(nome);
      continue;
    }
    if (t.length > cabe) {
      t = t.slice(0, cabe);
      cortados.push(nome);
    }
    total += t.length;
    lidos.push({ nome, tipo: umaLinha(x.tipo, 30) || "texto", tamanho: numero(x.tamanho), caracteres: t.length, origem: umaLinha(x.origem, 200) || null, texto: t });
  }
  const nao_lidos: ArquivoNaoLido[] = (Array.isArray(o.nao_lidos) ? o.nao_lidos : []).slice(0, MAX_ARQUIVOS_LIDOS).map((a) => {
    const x = (a ?? {}) as Record<string, unknown>;
    return { nome: umaLinha(x.nome, 200) || "arquivo", motivo: umaLinha(x.motivo, 200) || "Não deu para ler.", tamanho: x.tamanho == null ? null : numero(x.tamanho), origem: umaLinha(x.origem, 200) || null };
  });
  return { lidos, nao_lidos, cortados };
}

/** Bloco do prompt com o texto dos arquivos, um por seção. Vazio quando não há. */
export function blocoDosArquivos(lidos: Array<Pick<ArquivoLido, "nome" | "tipo" | "origem" | "texto">>, titulo = "ARQUIVOS ANEXADOS NESTE PEDIDO"): string {
  if (!lidos.length) return "";
  const partes = lidos.map((a) => `=== ${a.origem ? `${a.origem} / ` : ""}${a.nome} (${a.tipo}) ===\n${a.texto}`);
  return `\n${titulo} (lidos no painel; conteúdo fiel, use como fonte):\n${partes.join("\n\n")}\n`;
}

/** O que fica na mensagem da conversa (sem o texto): nome, tipo, tamanho e caracteres. */
export function resumoDosArquivos(lidos: ArquivoLido[], naoLidos: ArquivoNaoLido[], caminhoDoTexto: string | null) {
  return {
    tipo: "arquivos_lidos",
    caminho_texto: caminhoDoTexto,
    lidos: lidos.map((a) => ({ nome: a.nome, tipo: a.tipo, tamanho: a.tamanho, caracteres: a.caracteres, origem: a.origem })),
    nao_lidos: naoLidos,
  };
}

// ------------------------------------------------------------------ criar conteúdos (colagem estruturada)

export const FORMATOS_DA_CRIACAO = ["carrossel", "estatico", "foto"] as const;
export type FormatoDaCriacao = typeof FORMATOS_DA_CRIACAO[number];
export const MAX_ITENS_DA_CRIACAO = 180;
/** Uma geração do pedido livre por lote (igual ao refazer). */
export const LOTE_DA_CRIACAO = 12;

export type ItemParaCriar = {
  data: string;
  formato: FormatoDaCriacao;
  /** Como veio no material (reels, vídeo, story...), quando diferente. */
  formato_pedido: string | null;
  tema: string;
  /** O que o material colado diz desta linha (copy, roteiro, legenda), adaptado ao cliente pelo gerador. */
  referencia: string;
  /** Peça de foto (formato "foto"): a direção para a Mesa Foto (contrato em modulos/peca-de-foto.ts). */
  foto?: DirecaoDeFoto | null;
};

export type CriacaoDeConteudos = {
  tipo: "criar_conteudos";
  resumo: string;
  /** O porquê do pedido, que vale para todas as linhas (ex.: falar com o cliente final). */
  orientacao: string;
  itens: ItemParaCriar[];
  ignorados: number;
  /**
   * 02/10: a conferência da cadência pedida (por semana ISO) depois do ajuste:
   * { ok, frase: "12 posts: 8 fotos e 4 carrosséis, 3 por semana.", semanas, problemas, cadencia }.
   */
  conferencia?: Record<string, unknown> | null;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatoDaCriacao(v: unknown): { formato: FormatoDaCriacao; pedido: string | null } {
  // 02/10: "foto", "fotos", "ensaio", "foto de produto" são peça de foto (antes viravam estático).
  const f = formatoDoMes(v);
  if (f) return { formato: f, pedido: null };
  if (!String(v ?? "").trim()) return { formato: "carrossel", pedido: null };
  // Vídeo, reels e story viram carrossel (a Mesa produz arte); o formato pedido fica anotado.
  return { formato: "carrossel", pedido: String(v).trim().slice(0, 40) };
}

/**
 * Lê criar_conteudos da resposta: datas AAAA-MM-DD de hoje até 13 meses à
 * frente, formato carrossel, estático ou foto (o resto vira carrossel,
 * anotado), tema obrigatório; foto leva a direção do contrato. Null quando não
 * sobra linha.
 */
export function normalizarCriacao(bruto: unknown, hoje: string): CriacaoDeConteudos | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const teto = somarDias(hoje, 400);
  const itens: ItemParaCriar[] = [];
  let ignorados = 0;
  for (const b of (Array.isArray(o.itens) ? o.itens : []).slice(0, MAX_ITENS_DA_CRIACAO * 2)) {
    const m = (b ?? {}) as Record<string, unknown>;
    const data = String(m.data ?? "").trim().slice(0, 10);
    const tema = umaLinha(m.tema, 200);
    if (!DATA.test(data) || data < hoje || data > teto || !tema || itens.length >= MAX_ITENS_DA_CRIACAO) {
      ignorados++;
      continue;
    }
    const f = formatoDaCriacao(m.formato);
    const item: ItemParaCriar = { data, formato: f.formato, formato_pedido: f.pedido, tema, referencia: String(m.referencia ?? "").trim().slice(0, 1500) };
    if (f.formato === "foto") item.foto = normalizarDirecaoDeFoto(m.foto, { tema });
    itens.push(item);
  }
  if (!itens.length) return null;
  itens.sort((a, b) => a.data.localeCompare(b.data));
  const n = itens.length;
  return {
    tipo: "criar_conteudos",
    resumo: umaLinha(o.resumo, 600) || `Vou criar ${n} ${n === 1 ? "conteúdo" : "conteúdos"} nas datas e formatos do material, adaptados ao cliente.`,
    orientacao: umaLinha(o.orientacao, 600),
    itens,
    ignorados,
  };
}

/** Divide em lotes de LOTE_DA_CRIACAO, na ordem. */
export function lotesDaCriacao<T>(itens: T[], tamanho = LOTE_DA_CRIACAO): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Texto do pedido livre de um lote: cada linha com a data AAAA-MM-DD (o pedido
 * livre estica a janela até a última data citada), o formato, o tema e a
 * referência do material. Espelho em src/components/mesa/planoDoMes.ts.
 */
export function pedidoParaCriar(itens: Array<Pick<ItemParaCriar, "data" | "formato" | "tema" | "referencia" | "foto">>, orientacao?: string | null): string {
  const linhas = itens.map((i) => {
    const ref = String(i.referencia || "").replace(/\s+/g, " ").trim();
    const foto = i.formato === "foto" && i.foto ? `\n  Direção da foto: ${resumoDaDirecaoDeFoto(i.foto)}` : "";
    return `- ${i.data} · ${ROTULO_DA_LINHA[i.formato] || "carrossel"} · ${String(i.tema || "").replace(/\s+/g, " ").trim()}${ref ? `\n  Referência do material: ${ref}` : ""}${foto}`;
  });
  const base = `Crie estes conteúdos, um para cada linha, exatamente na data e no formato indicados. Siga o tema e a referência do material de cada linha, adaptando ao cliente (negócio, oferta, público e tom de voz do contexto):\n${linhas.join("\n")}`;
  const o = String(orientacao || "").replace(/\s+/g, " ").trim().slice(0, 600);
  return o ? `${base}\nOrientação da equipe para todos: ${o}` : base;
}

/** Como o formato aparece na linha do pedido (foto: peça de foto da Mesa Foto). */
const ROTULO_DA_LINHA: Record<string, string> = { carrossel: "carrossel", estatico: "estático", foto: "foto" };

// ------------------------------------------------------------------ público do prompt (Jev)

export type EstadoDoPublico = {
  negocio: string;
  oferta: string;
  publico_registrado: string;
  publico_do_prompt: string;
  evidencias: string[];
};

/** Limites do estado enviado ao Jev (o prompt pode ser enorme; o público aparece cedo). */
export const MAX_CHARS_DO_PROMPT_NO_JEV = 12_000;

export function estadoDoPublico(e: { negocio?: unknown; oferta?: unknown; publico?: unknown; prompt: string; evidencias?: unknown[] }): EstadoDoPublico {
  const txt = (v: unknown, max: number) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v)).trim().slice(0, max);
  return {
    negocio: txt(e.negocio, 3000),
    oferta: txt(e.oferta, 3000),
    publico_registrado: txt(e.publico, 3000),
    publico_do_prompt: String(e.prompt || "").trim().slice(0, MAX_CHARS_DO_PROMPT_NO_JEV),
    evidencias: (e.evidencias || []).map((x) => txt(x, 1500)).filter(Boolean).slice(0, 12),
  };
}

/**
 * Duas perguntas Noul sobre o mesmo estado, juntas (rodam em paralelo):
 * - traz_publico: o prompt descreve um público diferente do registrado?
 * - publico_coerente: esse público é coerente com o negócio, a oferta e os
 *   clientes reais? (premissa especulativa: só vale quando traz_publico).
 */
export const PERGUNTAS_DO_PUBLICO: Record<"traz_publico" | "publico_coerente", PerguntaNoul> = {
  traz_publico: {
    type: "noul",
    instructions:
      "O texto em `publico_do_prompt` descreve para quem os conteúdos devem falar (um público-alvo) que é diferente do público em `publico_registrado`?",
    criteria: {
      true: "O texto nomeia ou descreve um público-alvo (quem compra, perfil, segmento, momento de vida) diferente do registrado, ou pede para mudar o público.",
      false: "O texto não fala de público, repete o registrado, ou só cita pessoas sem pedir que o conteúdo fale com elas.",
    },
  },
  publico_coerente: {
    type: "noul",
    instructions:
      "Supondo que `publico_do_prompt` descreva um público-alvo para os conteúdos: esse público é coerente com o negócio (`negocio`), a oferta (`oferta`) e os clientes reais deste cliente (`publico_registrado` e `evidencias`), ou seja, são pessoas que de fato compram ou podem comprar dele?",
    criteria: {
      true: "O público descrito compra ou pode comprar a oferta deste negócio; as evidências não contradizem.",
      false: "O público descrito não combina com o negócio ou a oferta (outro segmento, outro nicho, outro tipo de comprador), ou as evidências mostram outro comprador.",
    },
  },
};

export const LIMIAR_TRAZ_PUBLICO = 0.5;
export const LIMIAR_ADAPTAR = 0.7;
export const LIMIAR_MANTER = 0.3;

export type DecisaoDoPublico = {
  decisao: "sem_publico_novo" | "adaptar" | "manter" | "perguntar" | "indisponivel";
  traz: number | null;
  coerente: number | null;
  frase: string;
};

const prob = (r: RespostaJev | undefined) => (r && typeof r.noul === "number" && Number.isFinite(r.noul) ? r.noul : null);

/**
 * Política explícita sobre as respostas do Jev. Sem resposta (Jev fora ou sem
 * chave): "indisponivel", e o agente segue o público registrado.
 */
export function decidirPublico(respostas: Record<string, RespostaJev> | null | undefined): DecisaoDoPublico {
  const traz = prob(respostas ? respostas.traz_publico : undefined);
  const coerente = prob(respostas ? respostas.publico_coerente : undefined);
  if (traz === null) return { decisao: "indisponivel", traz: null, coerente, frase: "" };
  if (traz < LIMIAR_TRAZ_PUBLICO) return { decisao: "sem_publico_novo", traz, coerente, frase: "" };
  if (coerente === null) return { decisao: "perguntar", traz, coerente, frase: "O pedido traz outro público; confirme se ele compra deste cliente." };
  if (coerente >= LIMIAR_ADAPTAR) return { decisao: "adaptar", traz, coerente, frase: "Público novo do pedido confere com o negócio: os conteúdos seguem esse público." };
  if (coerente <= LIMIAR_MANTER) return { decisao: "manter", traz, coerente, frase: "O público do pedido não combina com o negócio: mantive o público registrado." };
  return { decisao: "perguntar", traz, coerente, frase: "Não ficou claro se o público do pedido compra deste cliente: preciso da sua confirmação." };
}

/** Instrução ao modelo conforme a decisão (vazio quando não há público novo). */
export function blocoDaDecisaoDoPublico(d: DecisaoDoPublico): string {
  if (d.decisao === "adaptar") {
    return "\nDECISÃO SOBRE O PÚBLICO (Jev, com os dados do cliente): o público descrito no pedido é real para este cliente. Adapte os conteúdos a esse público e preencha atualizar_publico com o texto do público novo para o contexto (a equipe confirma antes). Diga isso em uma frase.\n";
  }
  if (d.decisao === "manter") {
    return "\nDECISÃO SOBRE O PÚBLICO (Jev, com os dados do cliente): o público descrito no pedido NÃO combina com o negócio e a oferta. Mantenha o público registrado nos conteúdos, avise em uma frase e devolva atualizar_publico null.\n";
  }
  if (d.decisao === "perguntar") {
    return "\nDECISÃO SOBRE O PÚBLICO (Jev, com os dados do cliente): não dá para ter certeza de que o público do pedido compra deste cliente. Antes de adaptar, pergunte em uma frase se é esse público mesmo; não proponha ações que dependem do público novo e devolva atualizar_publico null.\n";
  }
  return "";
}

/**
 * Proposta de atualizar o público do contexto (contrato comum acao_agente, com
 * Confirmar e Desfazer). Só quando a decisão foi adaptar e o texto é novo.
 */
export function acaoDeAtualizarPublico(
  bruto: unknown,
  publicoAtual: string,
  decisao: DecisaoDoPublico,
  clientId: string,
  agora = Date.now(),
): AcaoDoAgente | null {
  if (decisao.decisao !== "adaptar" || !bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const novo = String(o.publico ?? "").trim().slice(0, 1200);
  if (!novo || novo === String(publicoAtual || "").trim()) return null;
  const motivo = umaLinha(o.motivo, 400);
  return {
    tipo: TIPO_DA_ACAO,
    agente: "mes",
    id: `mes-publico-${agora.toString(36)}`,
    resumo: motivo ? `Atualizar o público do contexto. ${motivo}` : "Atualizar o público do contexto para o público do pedido.",
    itens: [
      {
        ref: "p1",
        alvo_id: clientId,
        titulo: "Público do contexto",
        detalhe: publicoAtual ? umaLinha(`Hoje: ${publicoAtual}`, 160) : "Hoje: sem público registrado",
        operacao: "atualizar_publico",
        rotulo: "atualizar",
        para: novo,
      },
    ],
    ignorados: [],
    recusados: [],
  };
}

// ------------------------------------------------------------------ regras da conversa

/** O jeito de responder e de agir do agente do Mês v2 (vai no pedido de planejar_mes). */
export const REGRAS_DO_AGENTE_DO_MES = `COMO VOCÊ TRABALHA (agente do mês):
- Entenda o pedido e FAÇA: responda curto (1 a 4 frases), dizendo o que vai acontecer, e devolva o cartão certo (acoes_na_agenda, criar_conteudos, gerar_conteudos, mudancas). Nada de explicação longa nem de repetir o pedido.
- Material colado ou anexado (pautas, calendário de outra agência, legendas, planilha, roteiro): reconheça a estrutura (datas, formatos, temas, copy) e reproduza EXATAMENTE aquilo, adaptado ao cliente. Linha com data vira um item de criar_conteudos com a mesma data, o mesmo formato, o tema e a referência (o texto daquela linha). Sem data no material, distribua nos dias úteis do mês em conversa, na ordem do material. Se o material pede para trocar peças que já estão na agenda gravada, use acoes_na_agenda (refazer ou editar_textos) nas peças que casam.
- Pedido amplo ("revise todos os meses", "tudo que fala com agência", "troque o público de tudo"): aplique a TODAS as peças que casam na AGENDA GRAVADA (leia público, gancho, lâminas e legenda de cada uma). Nunca diga que faz uma parte agora e o resto depois: ou a lista tem tudo (o painel executa em lotes) ou você pergunta.
- Na dúvida de verdade sobre o que o dono quer, faça UMA pergunta objetiva e devolva as ações null.
- Use o CONTEXTO VINDO DO MCP (orientações, dossiê, memórias e arquivos ativos) como parte do contexto do cliente.
- Cadência e mistura pedidas pelo dono ("3 por semana", "2 fotos e 1 carrossel") são exatas: o painel confere semana a semana e devolve o que faltar para você completar.
${REGRAS_DE_CONTEUDO_DO_MES}`;
