/**
 * Estilo do cliente (frente S2, 26/09/2026): o guia de estilo de design de um
 * cliente (e da marca, quando o cliente tem mais de uma), versionado, com
 * aprendizados e imagens de teste. Pesquisa e regras em
 * docs/estudio/ESTILO-DO-CLIENTE.md.
 *
 * É COMPLEMENTO: não troca o kit (paleta, logo, fontes ficam no kit da marca),
 * não é obrigatório e, desligado, não muda nada na geração. Ligado no trabalho
 * (direcao.usar_estilo_do_cliente) e com o estilo ativo, o Estúdio acrescenta
 * no fim do prompt o bloco curto de blocoDoEstiloParaOGerador e as referências
 * do estilo depois das da lâmina, como guia de acabamento.
 *
 * Onde mora: tabela cliente_estilos (SQL S2 no scratchpad). Sem a tabela, um
 * JSON no bucket mesa (<cliente>/estilo/estilo-<marca|cliente>.json), com o
 * mesmo formato; nada quebra.
 *
 * Puro: sem Deno. O banco entra por parâmetro (o cliente de verdade serve; o
 * dos testes também). Sem travessão.
 */

// ------------------------------------------------------------------ tipos

export const CAMPOS_DAS_REGRAS = ["layout", "tipografia", "cor", "foto", "elementos", "capa", "miolo", "cta", "evitar"] as const;
export type CampoDaRegra = (typeof CAMPOS_DAS_REGRAS)[number];
export type RegrasDoEstilo = Record<CampoDaRegra, string[]>;

export const ROTULOS_DAS_REGRAS: Record<CampoDaRegra, string> = {
  layout: "Layout e grade",
  tipografia: "Tipografia",
  cor: "Cor",
  foto: "Foto",
  elementos: "Elementos gráficos",
  capa: "Capa",
  miolo: "Miolo",
  cta: "CTA",
  evitar: "Evitar",
};

/** "entrega" (frente AP, 27/09): arte entregue pelo Estúdio, sugerida pelas entregas e confirmada pela equipe. */
export type OrigemDaReferenciaDoEstilo = "referencia" | "acervo" | "teste" | "entrega";

/** Imagem que o estilo usa como guia de acabamento (nunca conteúdo a copiar). */
export type ReferenciaDoEstilo = {
  /** id da linha de origem (cliente_referencias ou cliente_imagens). */
  id: string;
  origem: OrigemDaReferenciaDoEstilo;
  bucket: string;
  caminho: string;
  nome: string;
  /** Leitura curta do que ela ensina (quando lida). */
  leitura?: string | null;
};

export type GuiaDoEstilo = {
  resumo: string;
  regras: RegrasDoEstilo;
  referencias: ReferenciaDoEstilo[];
};

export type OrigemDaVersao = "agente" | "equipe" | "voltou" | "teste_aprovado" | "referencias";

export type VersaoDoEstilo = {
  numero: number;
  guia: GuiaDoEstilo;
  origem: OrigemDaVersao;
  nota: string;
  criado_em: string;
  criado_por: string | null;
};

export type TipoDoAprendizado = "gostou" | "nao_gostou";
export type Aprendizado = { id: string; tipo: TipoDoAprendizado; texto: string; em: string; por: string | null };

export type StatusDoTeste = "novo" | "aprovado" | "descartado";
export type TesteDoEstilo = {
  id: string;
  /** Caminho no bucket mesa. */
  caminho: string;
  tema: string;
  versao: number;
  custo_usd: number;
  criado_em: string;
  status: StatusDoTeste;
  arquivo_id?: string | null;
  imagem_id?: string | null;
  referencia_id?: string | null;
};

export type GuardadoEm = "tabela" | "arquivo" | "nenhum";

export type EstiloDoCliente = {
  id: string | null;
  client_id: string;
  marca_id: string | null;
  ativo: boolean;
  versao_atual: number;
  versoes: VersaoDoEstilo[];
  aprendizados: Aprendizado[];
  testes: TesteDoEstilo[];
  atualizado_em: string | null;
  guardado_em: GuardadoEm;
};

// ------------------------------------------------------------------ limites

export const MAX_ITENS_POR_REGRA = 6;
export const MAX_TEXTO_DA_REGRA = 220;
export const MAX_RESUMO = 600;
export const MAX_REFERENCIAS_DO_ESTILO = 12;
/** Referências do estilo que vão ao gerador (depois das da lâmina). */
export const MAX_REFERENCIAS_NO_GERADOR = 2;
export const MAX_VERSOES = 30;
export const MAX_APRENDIZADOS = 60;
export const MAX_TESTES = 24;
export const MAX_TESTES_POR_VEZ = 4;
/** Teto do bloco que vai ao gerador de imagem (curto de propósito). */
export const TETO_DO_BLOCO_DO_ESTILO = 1_100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ------------------------------------------------------------------ normalização

const umaLinha = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u2014\u2013]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);

function listaDeFrases(v: unknown): string[] {
  const bruta = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|;/) : [];
  const saida: string[] = [];
  for (const item of bruta) {
    const f = umaLinha(item, MAX_TEXTO_DA_REGRA).replace(/^[-*\u2022]\s*/, "");
    if (f && saida.indexOf(f) < 0) saida.push(f);
    if (saida.length >= MAX_ITENS_POR_REGRA) break;
  }
  return saida;
}

export function regrasVazias(): RegrasDoEstilo {
  const r = {} as RegrasDoEstilo;
  for (const c of CAMPOS_DAS_REGRAS) r[c] = [];
  return r;
}

export function normalizarRegras(v: unknown): RegrasDoEstilo {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const r = regrasVazias();
  for (const c of CAMPOS_DAS_REGRAS) r[c] = listaDeFrases(o[c]);
  return r;
}

export function normalizarReferencia(v: unknown): ReferenciaDoEstilo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const origem = o.origem === "acervo" || o.origem === "teste" || o.origem === "entrega" ? o.origem : o.origem === "referencia" ? "referencia" : null;
  const bucket = umaLinha(o.bucket, 40);
  const caminho = String(o.caminho ?? "").trim().slice(0, 500);
  if (!ehUuid(o.id) || !origem || !bucket || !caminho || caminho.indexOf("..") >= 0) return null;
  const leitura = umaLinha(o.leitura, 600);
  return { id: String(o.id), origem, bucket, caminho, nome: umaLinha(o.nome, 120) || "referência", leitura: leitura || null };
}

export function normalizarGuia(v: unknown): GuiaDoEstilo {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const refs: ReferenciaDoEstilo[] = [];
  for (const r of Array.isArray(o.referencias) ? o.referencias : []) {
    const n = normalizarReferencia(r);
    if (n && !refs.some((x) => x.id === n.id)) refs.push(n);
    if (refs.length >= MAX_REFERENCIAS_DO_ESTILO) break;
  }
  return { resumo: umaLinha(o.resumo, MAX_RESUMO), regras: normalizarRegras(o.regras), referencias: refs };
}

/** O guia diz alguma coisa (resumo ou pelo menos uma regra)? */
export function guiaTemConteudo(g: GuiaDoEstilo | null | undefined): boolean {
  if (!g) return false;
  return !!g.resumo || CAMPOS_DAS_REGRAS.some((c) => g.regras[c].length > 0);
}

const ORIGENS_DA_VERSAO: OrigemDaVersao[] = ["agente", "equipe", "voltou", "teste_aprovado", "referencias"];

function normalizarVersao(v: unknown): VersaoDoEstilo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const numero = Number(o.numero);
  if (!Number.isInteger(numero) || numero < 1) return null;
  const origem = ORIGENS_DA_VERSAO.indexOf(o.origem as OrigemDaVersao) >= 0 ? (o.origem as OrigemDaVersao) : "equipe";
  return {
    numero,
    guia: normalizarGuia(o.guia),
    origem,
    nota: umaLinha(o.nota, 300),
    criado_em: String(o.criado_em || ""),
    criado_por: ehUuid(o.criado_por) ? String(o.criado_por) : null,
  };
}

function normalizarAprendizado(v: unknown): Aprendizado | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const textoA = umaLinha(o.texto, 300);
  if (!textoA) return null;
  return {
    id: umaLinha(o.id, 40) || `a${textoA.length}`,
    tipo: o.tipo === "nao_gostou" ? "nao_gostou" : "gostou",
    texto: textoA,
    em: String(o.em || ""),
    por: ehUuid(o.por) ? String(o.por) : null,
  };
}

function normalizarTeste(v: unknown): TesteDoEstilo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const caminho = String(o.caminho ?? "").trim();
  if (!umaLinha(o.id, 60) || !caminho) return null;
  const status: StatusDoTeste = o.status === "aprovado" || o.status === "descartado" ? o.status : "novo";
  return {
    id: umaLinha(o.id, 60),
    caminho,
    tema: umaLinha(o.tema, 200),
    versao: Number.isInteger(Number(o.versao)) ? Number(o.versao) : 0,
    custo_usd: typeof o.custo_usd === "number" && isFinite(o.custo_usd) ? o.custo_usd : 0,
    criado_em: String(o.criado_em || ""),
    status,
    arquivo_id: ehUuid(o.arquivo_id) ? String(o.arquivo_id) : null,
    imagem_id: ehUuid(o.imagem_id) ? String(o.imagem_id) : null,
    referencia_id: ehUuid(o.referencia_id) ? String(o.referencia_id) : null,
  };
}

const lista = <T>(v: unknown, f: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(f).filter((x): x is T => !!x) : []);

export function estiloVazio(clientId: string, marcaId: string | null, guardadoEm: GuardadoEm = "nenhum"): EstiloDoCliente {
  return { id: null, client_id: clientId, marca_id: marcaId, ativo: false, versao_atual: 0, versoes: [], aprendizados: [], testes: [], atualizado_em: null, guardado_em: guardadoEm };
}

export function normalizarEstilo(linha: unknown, clientId: string, marcaId: string | null, guardadoEm: GuardadoEm): EstiloDoCliente {
  if (!linha || typeof linha !== "object") return estiloVazio(clientId, marcaId, guardadoEm);
  const o = linha as Record<string, unknown>;
  const versoes = lista(o.versoes, normalizarVersao).sort((a, b) => a.numero - b.numero);
  const atual = Number(o.versao_atual);
  const versaoAtual = versoes.some((v) => v.numero === atual) ? atual : versoes.length ? versoes[versoes.length - 1].numero : 0;
  return {
    id: ehUuid(o.id) ? String(o.id) : null,
    client_id: clientId,
    marca_id: marcaId,
    ativo: o.ativo === true && versaoAtual > 0,
    versao_atual: versaoAtual,
    versoes,
    aprendizados: lista(o.aprendizados, normalizarAprendizado),
    testes: lista(o.testes, normalizarTeste),
    atualizado_em: o.atualizado_em ? String(o.atualizado_em) : null,
    guardado_em: guardadoEm,
  };
}

// ------------------------------------------------------------------ versões e mudanças (puras, sem mutar)

export function guiaAtual(e: EstiloDoCliente | null | undefined): GuiaDoEstilo | null {
  if (!e) return null;
  const v = e.versoes.find((x) => x.numero === e.versao_atual);
  return v ? v.guia : null;
}

/** Nova versão com o guia dado (a atual passa a ser ela). Guarda as últimas MAX_VERSOES. */
export function comNovaVersao(e: EstiloDoCliente, guia: GuiaDoEstilo, origem: OrigemDaVersao, nota: string, por: string | null, agora: string): EstiloDoCliente {
  const numero = e.versoes.reduce((m, v) => Math.max(m, v.numero), 0) + 1;
  const versao: VersaoDoEstilo = { numero, guia: normalizarGuia(guia), origem, nota: umaLinha(nota, 300), criado_em: agora, criado_por: por };
  const versoes = e.versoes.concat([versao]).slice(-MAX_VERSOES);
  return { ...e, versoes, versao_atual: numero };
}

/** Voltar para uma versão anterior: vira uma versão nova igual a ela (o histórico fica linear). */
export function voltandoPara(e: EstiloDoCliente, numero: number, por: string | null, agora: string): EstiloDoCliente {
  const alvo = e.versoes.find((v) => v.numero === numero);
  if (!alvo) throw new Error("Versão não encontrada.");
  return comNovaVersao(e, alvo.guia, "voltou", `Voltou para a versão ${numero}.`, por, agora);
}

/** Guia atual com as referências trocadas (acrescenta ou tira), para uma versão nova. */
export function guiaComReferencias(g: GuiaDoEstilo | null, entra: ReferenciaDoEstilo[], sai: string[]): GuiaDoEstilo {
  const base = g ? g : { resumo: "", regras: regrasVazias(), referencias: [] };
  const refs = base.referencias.filter((r) => sai.indexOf(r.id) < 0);
  for (const r of entra) if (!refs.some((x) => x.id === r.id)) refs.push(r);
  return { ...base, referencias: refs.slice(-MAX_REFERENCIAS_DO_ESTILO) };
}

/** "gostou: fundo claro" ou "não gostou: letra fina" -> aprendizado. Sem prefixo: gostou. */
export function lerAprendizado(bruto: unknown): { tipo: TipoDoAprendizado; texto: string } | null {
  const s = umaLinha(bruto, 320);
  if (!s) return null;
  const m = /^(n[aã]o[\s_]?gostou|gostou)\s*[:\-]\s*(.+)$/i.exec(s);
  if (m) {
    const t = umaLinha(m[2], 300);
    return t ? { tipo: /^n/i.test(m[1]) ? "nao_gostou" : "gostou", texto: t } : null;
  }
  return { tipo: "gostou", texto: s.slice(0, 300) };
}

export function comAprendizado(e: EstiloDoCliente, tipo: TipoDoAprendizado, textoA: string, por: string | null, agora: string, id: string): EstiloDoCliente {
  const a: Aprendizado = { id, tipo, texto: umaLinha(textoA, 300), em: agora, por };
  return { ...e, aprendizados: e.aprendizados.concat([a]).slice(-MAX_APRENDIZADOS) };
}

export function semAprendizado(e: EstiloDoCliente, id: string): EstiloDoCliente {
  return { ...e, aprendizados: e.aprendizados.filter((a) => a.id !== id) };
}

export function comTestes(e: EstiloDoCliente, novos: TesteDoEstilo[]): EstiloDoCliente {
  // Os aprovados ficam; os outros saem primeiro quando passa do teto.
  let testes = e.testes.concat(novos);
  while (testes.length > MAX_TESTES) {
    const i = testes.findIndex((t) => t.status !== "aprovado");
    testes = testes.filter((_, k) => k !== (i >= 0 ? i : 0));
  }
  return { ...e, testes };
}

export function comTesteMudado(e: EstiloDoCliente, id: string, mudar: (t: TesteDoEstilo) => TesteDoEstilo): EstiloDoCliente {
  return { ...e, testes: e.testes.map((t) => (t.id === id ? mudar(t) : t)) };
}

// ------------------------------------------------------------------ texto

/** O guia legível (prompt do agente e tela). */
export function guiaEmTexto(g: GuiaDoEstilo | null | undefined): string {
  if (!guiaTemConteudo(g)) return "ainda sem estilo definido.";
  const linhas: string[] = [];
  if (g!.resumo) linhas.push(`Resumo: ${g!.resumo}`);
  for (const c of CAMPOS_DAS_REGRAS) {
    const r = g!.regras[c];
    if (r.length) linhas.push(`${ROTULOS_DAS_REGRAS[c]}: ${r.join("; ")}`);
  }
  if (g!.referencias.length) linhas.push(`Referências do estilo: ${g!.referencias.length}`);
  return linhas.join("\n");
}

/** O trabalho pediu o estilo do cliente? Só true liga (ausente, null ou outro valor: desligado). */
export function usarEstiloNoTrabalho(direcao: unknown): boolean {
  return !!direcao && typeof direcao === "object" && (direcao as Record<string, unknown>).usar_estilo_do_cliente === true;
}

/** Chave da marca no estilo: marca que não é a principal; a principal e o cliente sem marca usam o estilo do cliente. */
export function chaveDaMarca(marca: { id: string; principal?: boolean } | null | undefined): string | null {
  return marca && ehUuid(marca.id) && marca.principal !== true ? marca.id : null;
}

export const ROTULO_DA_REFERENCIA_DO_ESTILO =
  "referência do ESTILO DO CLIENTE, só para acabamento (tipografia, tratamento de foto, composição e elementos); não copie texto, pessoa, produto nem marca dela";

const corta = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trim()}.` : s);

/**
 * O bloco curto que vai ao gerador de imagem, no fim do prompt, quando o
 * estilo está ligado no trabalho e ativo. As regras mais fortes primeiro; a
 * capa só na lâmina 1, o miolo nas do meio e o CTA na última. Nunca passa de
 * TETO_DO_BLOCO_DO_ESTILO. Guia vazio: "".
 */
export function blocoDoEstiloParaOGerador(g: GuiaDoEstilo | null | undefined, opcoes: { ordem: number; total: number; indices?: number[] }): string {
  if (!guiaTemConteudo(g)) return "";
  const guia = g!;
  const { ordem, total } = opcoes;
  const campos: CampoDaRegra[] = ["layout", "tipografia", "cor", "foto", "elementos"];
  if (ordem <= 1) campos.push("capa");
  if (total > 1 && ordem > 1 && ordem < total) campos.push("miolo");
  if (total > 1 && ordem === total) campos.push("miolo", "cta");
  if (total <= 1) campos.push("cta");
  const cabeca = "ESTILO DO CLIENTE (ponto de partida de acabamento para não ficar genérico; o pedido desta lâmina, o texto exato, a logo e as referências da lâmina valem sobre ele):";
  const linhas: string[] = [];
  if (guia.resumo) linhas.push(`- ${corta(guia.resumo, 240)}`);
  for (const c of campos) {
    const r = guia.regras[c].slice(0, 2).map((x) => corta(x, 140));
    if (r.length) linhas.push(`- ${ROTULOS_DAS_REGRAS[c].toUpperCase()}: ${r.join("; ")}`);
  }
  const evitar = guia.regras.evitar.slice(0, 3).map((x) => corta(x, 120));
  const fim: string[] = [];
  if (evitar.length) fim.push(`- EVITAR: ${evitar.join("; ")}`);
  const idx = (opcoes.indices || []).filter((n) => Number.isInteger(n) && n > 0);
  if (idx.length) {
    fim.push(`- ${idx.length === 1 ? `Imagem ${idx[0]}` : `Imagens ${idx.join(" e ")}`}: referência do estilo do cliente, só para acabamento; não copie texto, pessoa nem produto dela.`);
  }
  // Cabe no teto: corta as linhas do meio (as últimas regras) antes do EVITAR e das imagens.
  const montar = (meio: string[]) => [cabeca, ...meio, ...fim].join("\n");
  let meio = linhas.slice();
  while (meio.length && montar(meio).length > TETO_DO_BLOCO_DO_ESTILO) meio = meio.slice(0, -1);
  const saida = montar(meio);
  return saida.length > TETO_DO_BLOCO_DO_ESTILO ? saida.slice(0, TETO_DO_BLOCO_DO_ESTILO) : saida;
}

/**
 * Prompt das imagens de teste do estilo (agente de estilo, "gerar teste").
 * Montado em código, sem marketing: tema, formato e o guia.
 */
export function promptDoTeste(g: GuiaDoEstilo, opcoes: { cliente: string; tema: string; paleta: string[]; indices: number[]; variacao: number; total: number }): string {
  const tema = umaLinha(opcoes.tema, 200) || "post de apresentação do negócio";
  const bloco = blocoDoEstiloParaOGerador(g, { ordem: 1, total: 1, indices: opcoes.indices });
  const paleta = opcoes.paleta.filter((h) => /^#[0-9a-f]{6}$/i.test(h)).slice(0, 6);
  const variacoes = ["composição com o título no terço superior", "composição com o título na base", "composição com foto dominante e texto curto", "composição tipográfica, sem foto"];
  return [
    `Arte de TESTE de post de Instagram (4:5) para ${umaLinha(opcoes.cliente, 80) || "o cliente"}, para a equipe ver se o estilo abaixo está certo.`,
    `Tema: ${tema}. Um título curto em português do Brasil, legível na miniatura, e no máximo uma linha de apoio.`,
    paleta.length ? `Paleta da marca (use com a função descrita no estilo): ${paleta.join(", ")}.` : "",
    opcoes.total > 1 ? `Variação ${opcoes.variacao} de ${opcoes.total}: ${variacoes[(opcoes.variacao - 1) % variacoes.length]}.` : "",
    bloco,
    "Sem logo inventada, sem marca d'água, sem texto de outra marca. Foto nunca escurecida para caber texto.",
  ].filter(Boolean).join("\n\n");
}

// ------------------------------------------------------------------ banco

/** Cliente mínimo do Supabase (o de verdade serve; o dos testes também). */
// deno-lint-ignore no-explicit-any
export type BancoDoEstilo = { from: (tabela: string) => any; storage: { from: (bucket: string) => any } };

export const TABELA_DO_ESTILO = "cliente_estilos";
export const BUCKET_DO_ESTILO = "mesa";
const CAMPOS = "id, client_id, marca_id, ativo, versao_atual, versoes, aprendizados, testes, atualizado_em";

export const caminhoDoArquivoDoEstilo = (clientId: string, marcaId: string | null) => `${clientId}/estilo/estilo-${marcaId || "cliente"}.json`;

/** A tabela ainda não existe (SQL S2 pendente)? */
export function semTabelaDoEstilo(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = String(error.message || "");
  return error.code === "42P01" || error.code === "PGRST205" || /cliente_estilos.*(does not exist|schema cache)|relation .*cliente_estilos/i.test(m);
}

async function lerDoArquivo(db: BancoDoEstilo, clientId: string, marcaId: string | null): Promise<EstiloDoCliente> {
  try {
    const { data, error } = await db.storage.from(BUCKET_DO_ESTILO).download(caminhoDoArquivoDoEstilo(clientId, marcaId));
    if (error || !data) return estiloVazio(clientId, marcaId, "arquivo");
    const bruto = JSON.parse(await (data as Blob).text());
    return normalizarEstilo(bruto, clientId, marcaId, "arquivo");
  } catch {
    return estiloVazio(clientId, marcaId, "arquivo");
  }
}

/** O estilo do cliente (e da marca). Sem linha: estilo vazio. Sem tabela: o JSON do bucket. */
export async function lerEstilo(db: BancoDoEstilo, clientId: string, marcaId: string | null): Promise<EstiloDoCliente> {
  let q = db.from(TABELA_DO_ESTILO).select(CAMPOS).eq("client_id", clientId);
  q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
  const { data, error } = await q.maybeSingle();
  if (error) {
    if (semTabelaDoEstilo(error)) return await lerDoArquivo(db, clientId, marcaId);
    throw new Error("Não foi possível ler o estilo do cliente agora.");
  }
  return data ? normalizarEstilo(data, clientId, marcaId, "tabela") : estiloVazio(clientId, marcaId, "tabela");
}

function linhaDoEstilo(e: EstiloDoCliente, agora: string, por: string | null) {
  return {
    client_id: e.client_id,
    marca_id: e.marca_id,
    ativo: e.ativo,
    versao_atual: e.versao_atual,
    versoes: e.versoes,
    aprendizados: e.aprendizados,
    testes: e.testes,
    atualizado_em: agora,
    atualizado_por: por,
  };
}

/**
 * Lê, muda e grava com trava otimista (atualizado_em). Quem perde a corrida
 * relê e tenta de novo. Sem tabela: grava o JSON no bucket (sem trava).
 */
export async function mudarEstilo(
  db: BancoDoEstilo,
  clientId: string,
  marcaId: string | null,
  mudar: (e: EstiloDoCliente) => EstiloDoCliente,
  por: string | null,
): Promise<EstiloDoCliente> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const antes = await lerEstilo(db, clientId, marcaId);
    const depois = mudar(antes);
    const agora = new Date(Date.now() + tentativa).toISOString();
    if (antes.guardado_em === "arquivo") {
      const corpo = JSON.stringify({ ...linhaDoEstilo(depois, agora, por), id: null });
      const { error } = await db.storage.from(BUCKET_DO_ESTILO).upload(caminhoDoArquivoDoEstilo(clientId, marcaId), new Blob([corpo], { type: "application/json" }), {
        upsert: true,
        contentType: "application/json",
      });
      if (error) throw new Error("Não foi possível guardar o estilo agora.");
      return { ...depois, atualizado_em: agora, guardado_em: "arquivo" };
    }
    const linha = linhaDoEstilo(depois, agora, por);
    if (!antes.id) {
      const { data, error } = await db.from(TABELA_DO_ESTILO).insert({ ...linha, criado_por: por }).select(CAMPOS).maybeSingle();
      if (!error && data) return normalizarEstilo(data, clientId, marcaId, "tabela");
      if (error && error.code === "23505") continue; // outro criou ao mesmo tempo: relê
      throw new Error("Não foi possível guardar o estilo agora.");
    }
    const { data, error } = await db.from(TABELA_DO_ESTILO).update(linha).eq("id", antes.id).eq("atualizado_em", antes.atualizado_em).select(CAMPOS).maybeSingle();
    if (error) throw new Error("Não foi possível guardar o estilo agora.");
    if (data) return normalizarEstilo(data, clientId, marcaId, "tabela");
  }
  throw new Error("O estilo mudou várias vezes ao mesmo tempo. Tente de novo.");
}
