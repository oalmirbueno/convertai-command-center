/**
 * Laboratório (19/10/2026): regras puras do canvas de nós.
 * Contrato: Aceleriq-Laboratorio/ESPEC-LABORATORIO.md (tipos de nó, limites e operações do planejar).
 *
 * Sem Deno e sem Supabase: roda no deno test e pode ser importado pelo vitest.
 *
 * Forma do canvas guardado em lab_projetos.canvas (a mesma convenção da Mesa Foto):
 *   { nos: [{ id, tipo, x, y, dados }], ligacoes: [{ id, de, para }], viewport: { x, y, zoom } }
 * A leitura aceita também a forma do React Flow (type, data, position, source, target) e devolve
 * sempre a forma acima.
 */

export const TIPOS_DE_NO = [
  "contexto",
  "midia",
  "config",
  "gravity",
  "agente",
  "copy",
  "imagem",
  "carrossel",
  "logo",
  "landing",
  "anuncio",
  "agente_externo",
] as const;
export type TipoDeNo = typeof TIPOS_DE_NO[number];

export const ehTipoDeNo = (v: unknown): v is TipoDeNo => (TIPOS_DE_NO as readonly string[]).indexOf(String(v)) >= 0;

/** Nós que só guardam dado (sem custo): a saída sai dos próprios dados. */
export const NOS_ESTATICOS: readonly TipoDeNo[] = ["contexto", "midia", "config", "gravity"];
/** Nós que rodam (custo, execução em lab_execucoes). */
export const NOS_EXECUTAVEIS: readonly TipoDeNo[] = ["agente", "copy", "imagem", "carrossel", "logo", "landing", "anuncio", "agente_externo"];
export const ehExecutavel = (t: TipoDeNo) => NOS_EXECUTAVEIS.indexOf(t) >= 0;
/** Nós que podem passar de 150 s: respondem na hora e seguem com EdgeRuntime.waitUntil. */
export const NOS_LONGOS: readonly TipoDeNo[] = ["carrossel", "landing"];

export const MAX_NOS = 80;
export const MAX_LIGACOES = 160;
export const MAX_TEXTO = 8000;

/** O que cada nó entrega para quem está ligado depois dele. */
export type TipoDeSaida = "texto" | "imagens" | "config" | "gravity" | "html" | "json" | "tarefa";
export const SAIDA_DO_TIPO: Record<TipoDeNo, TipoDeSaida> = {
  contexto: "texto",
  midia: "imagens",
  config: "config",
  gravity: "gravity",
  agente: "texto",
  copy: "texto",
  imagem: "imagens",
  carrossel: "imagens",
  logo: "imagens",
  landing: "html",
  anuncio: "json",
  agente_externo: "tarefa",
};

const TEXTOS: TipoDeNo[] = ["contexto", "agente", "copy"];

/**
 * Quem pode entrar em quem (origem → destino). O que não está aqui é recusado com motivo.
 * Logo só aceita texto, config, gravity e mídia (especificação). Contexto, mídia e config não recebem nada.
 */
export const ENTRADAS_ACEITAS: Record<TipoDeNo, readonly TipoDeNo[]> = {
  contexto: [],
  midia: [],
  config: [],
  gravity: [...TEXTOS, "midia", "imagem", "logo"],
  agente: [...TEXTOS, "midia", "imagem", "carrossel", "logo", "landing", "anuncio"],
  copy: [...TEXTOS, "midia", "imagem", "carrossel", "logo", "anuncio"],
  imagem: [...TEXTOS, "midia", "config", "gravity", "imagem", "logo"],
  carrossel: [...TEXTOS, "midia", "config", "gravity", "imagem", "logo"],
  logo: [...TEXTOS, "midia", "config", "gravity"],
  landing: [...TEXTOS, "midia", "gravity", "imagem", "carrossel", "logo"],
  anuncio: [...TEXTOS, "midia", "imagem", "carrossel", "logo"],
  agente_externo: [...TEXTOS, "midia", "imagem", "carrossel", "logo", "landing", "anuncio"],
};

/** Só um por destino: duas configurações ou duas bases comuns se contradiriam. */
const UM_POR_DESTINO: TipoDeNo[] = ["config", "gravity"];

export const ROTULO_DO_TIPO: Record<TipoDeNo, string> = {
  contexto: "Contexto",
  midia: "Mídia",
  config: "Configurações",
  gravity: "Base comum",
  agente: "Agente",
  copy: "Copy",
  imagem: "Resultado",
  carrossel: "Carrossel",
  logo: "Logo",
  landing: "Landing page",
  anuncio: "Anúncio",
  agente_externo: "Agente externo",
};

export type NoDoCanvas = { id: string; tipo: TipoDeNo; x: number; y: number; dados: Record<string, unknown>; [extra: string]: unknown };
export type Ligacao = { id: string; de: string; para: string; [extra: string]: unknown };
export type Canvas = { nos: NoDoCanvas[]; ligacoes: Ligacao[]; viewport: { x: number; y: number; zoom: number } };

export class ErroDoCanvas extends Error {
  codigo: string;
  erros: string[];
  constructor(codigo: string, mensagem: string, erros: string[] = []) {
    super(mensagem);
    this.name = "ErroDoCanvas";
    this.codigo = codigo;
    this.erros = erros;
  }
}

export const canvasVazio = (): Canvas => ({ nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });

const numero = (v: unknown, reserva = 0) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : reserva);
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const texto = (v: unknown, max = MAX_TEXTO) => (typeof v === "string" ? v.slice(0, max) : "");

/** Lê o canvas (forma do painel ou do React Flow) e devolve a forma do painel. Sem validar ligações. */
export function normalizarCanvas(v: unknown): Canvas {
  const o = objeto(v);
  const nosBrutos = Array.isArray(o.nos) ? o.nos : Array.isArray(o.nodes) ? o.nodes : [];
  const ligBrutas = Array.isArray(o.ligacoes) ? o.ligacoes : Array.isArray(o.edges) ? o.edges : [];
  const nos: NoDoCanvas[] = [];
  for (const bruto of nosBrutos) {
    const n = objeto(bruto);
    const pos = objeto(n.position);
    const tipo = n.tipo ?? n.type;
    const resto: Record<string, unknown> = { ...n };
    for (const k of ["type", "data", "position", "tipo", "x", "y", "dados", "selected", "dragging"]) delete resto[k];
    nos.push({
      ...resto,
      id: String(n.id ?? ""),
      tipo: tipo as TipoDeNo,
      x: numero(n.x ?? pos.x),
      y: numero(n.y ?? pos.y),
      dados: objeto(n.dados ?? n.data),
    });
  }
  const ligacoes: Ligacao[] = [];
  for (const bruta of ligBrutas) {
    const l = objeto(bruta);
    const resto: Record<string, unknown> = { ...l };
    for (const k of ["source", "target", "de", "para", "selected"]) delete resto[k];
    const de = String(l.de ?? l.source ?? "");
    const para = String(l.para ?? l.target ?? "");
    ligacoes.push({ ...resto, id: String(l.id || `lig_${de}_${para}`), de, para });
  }
  const vp = objeto(o.viewport);
  return { nos, ligacoes, viewport: { x: numero(vp.x), y: numero(vp.y), zoom: numero(vp.zoom, 1) || 1 } };
}

/**
 * Pode ligar `de` → `para` neste canvas? null = pode; texto = o motivo da recusa (português simples).
 * `ignorar` tira uma ligação da conta (para revalidar o canvas inteiro).
 */
export function motivoParaNaoLigar(c: Pick<Canvas, "nos" | "ligacoes">, de: string, para: string, ignorar?: string): string | null {
  if (!de || !para) return "Ligação sem origem ou sem destino.";
  if (de === para) return "Um nó não pode ligar nele mesmo.";
  const origem = c.nos.find((n) => n.id === de);
  const destino = c.nos.find((n) => n.id === para);
  if (!origem) return `O nó de origem ${de} não existe.`;
  if (!destino) return `O nó de destino ${para} não existe.`;
  const outras = c.ligacoes.filter((l) => l.id !== ignorar);
  if (outras.some((l) => l.de === de && l.para === para)) return "Esses dois nós já estão ligados.";
  const aceitas = ENTRADAS_ACEITAS[destino.tipo] || [];
  if (aceitas.indexOf(origem.tipo) < 0) {
    if (!aceitas.length) return `${ROTULO_DO_TIPO[destino.tipo]} não recebe entrada.`;
    return `${ROTULO_DO_TIPO[origem.tipo]} não entra em ${ROTULO_DO_TIPO[destino.tipo]}.`;
  }
  if (UM_POR_DESTINO.indexOf(origem.tipo) >= 0) {
    const ja = outras.some((l) => l.para === para && c.nos.find((n) => n.id === l.de)?.tipo === origem.tipo);
    if (ja) return `${ROTULO_DO_TIPO[destino.tipo]} já tem ${ROTULO_DO_TIPO[origem.tipo]} ligado; tire o outro antes.`;
  }
  if (alcanca(outras, para, de)) return "Essa ligação faria um laço (o fluxo voltaria para trás).";
  return null;
}

export const podeLigar = (c: Pick<Canvas, "nos" | "ligacoes">, de: string, para: string) => motivoParaNaoLigar(c, de, para) === null;

/** Existe caminho de `de` até `ate` pelas ligações? */
function alcanca(ligacoes: Ligacao[], de: string, ate: string): boolean {
  const vistos = new Set<string>();
  const fila = [de];
  while (fila.length) {
    const atual = fila.shift()!;
    if (atual === ate) return true;
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    for (const l of ligacoes) if (l.de === atual) fila.push(l.para);
  }
  return false;
}

/** Erros do canvas inteiro (vazio = válido). */
export function errosDoCanvas(c: Canvas): string[] {
  const erros: string[] = [];
  if (c.nos.length > MAX_NOS) erros.push(`O canvas passa de ${MAX_NOS} nós.`);
  if (c.ligacoes.length > MAX_LIGACOES) erros.push(`O canvas passa de ${MAX_LIGACOES} ligações.`);
  const ids = new Set<string>();
  for (const n of c.nos) {
    if (!n.id || n.id.length > 80) erros.push("Nó sem id (ou id longo demais).");
    else if (ids.has(n.id)) erros.push(`Id repetido: ${n.id}.`);
    ids.add(n.id);
    if (!ehTipoDeNo(n.tipo)) erros.push(`Tipo de nó desconhecido: ${String(n.tipo)}.`);
  }
  if (erros.length) return erros;
  const aceitas: Ligacao[] = [];
  for (const l of c.ligacoes) {
    const motivo = motivoParaNaoLigar({ nos: c.nos, ligacoes: aceitas }, l.de, l.para);
    if (motivo) erros.push(`Ligação ${l.de} → ${l.para}: ${motivo}`);
    else aceitas.push(l);
  }
  return erros;
}

/** Normaliza e valida; inválido lança ErroDoCanvas com a lista. */
export function canvasValido(v: unknown): Canvas {
  const c = normalizarCanvas(v);
  const erros = errosDoCanvas(c);
  if (erros.length) throw new ErroDoCanvas("canvas_invalido", "O canvas tem ligações ou nós que não valem.", erros);
  return c;
}

/**
 * Ordem topológica dos nós (Kahn). Com `alvos`, só esses nós e tudo o que vem antes deles.
 * Laço lança ErroDoCanvas("ciclo") com os nós presos.
 */
export function ordemTopologica(c: Pick<Canvas, "nos" | "ligacoes">, alvos?: string[] | null): string[] {
  let incluidos = new Set(c.nos.map((n) => n.id));
  if (alvos && alvos.length) {
    incluidos = new Set<string>();
    const fila = alvos.filter((id) => c.nos.some((n) => n.id === id));
    while (fila.length) {
      const id = fila.shift()!;
      if (incluidos.has(id)) continue;
      incluidos.add(id);
      for (const l of c.ligacoes) if (l.para === id) fila.push(l.de);
    }
  }
  const grau = new Map<string, number>();
  for (const id of incluidos) grau.set(id, 0);
  const ligs = c.ligacoes.filter((l) => incluidos.has(l.de) && incluidos.has(l.para));
  for (const l of ligs) grau.set(l.para, (grau.get(l.para) || 0) + 1);
  // Na ordem em que os nós aparecem no canvas (estável para teste e para a tela).
  const fila = c.nos.map((n) => n.id).filter((id) => incluidos.has(id) && grau.get(id) === 0);
  const ordem: string[] = [];
  while (fila.length) {
    const id = fila.shift()!;
    ordem.push(id);
    for (const l of ligs) {
      if (l.de !== id) continue;
      const g = (grau.get(l.para) || 0) - 1;
      grau.set(l.para, g);
      if (g === 0) fila.push(l.para);
    }
  }
  if (ordem.length < incluidos.size) {
    const presos = [...incluidos].filter((id) => ordem.indexOf(id) < 0);
    throw new ErroDoCanvas("ciclo", "O fluxo tem um laço: um nó depende dele mesmo.", presos);
  }
  return ordem;
}

/** Os nós ligados antes de `noId` (na ordem das ligações). */
export function entradasDo(c: Pick<Canvas, "nos" | "ligacoes">, noId: string): NoDoCanvas[] {
  const saida: NoDoCanvas[] = [];
  for (const l of c.ligacoes) {
    if (l.para !== noId) continue;
    const n = c.nos.find((x) => x.id === l.de);
    if (n) saida.push(n);
  }
  return saida;
}

// ------------------------------------------------------------------ dados e prompt

export const PROPORCOES = ["1:1", "4:5", "9:16", "16:9", "3:2", "2:3"] as const;
export type Proporcao = typeof PROPORCOES[number];
/** Mesmos tamanhos da Mesa Foto (receitas.ts): o motor manda a proporção mais perto ao provedor. */
export const TAMANHO_DA_PROPORCAO: Record<Proporcao, string> = {
  "1:1": "1024x1024",
  "4:5": "1088x1360",
  "9:16": "1088x1920",
  "16:9": "1920x1088",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};
export const QUALIDADES = ["baixa", "media", "alta"] as const;
export type QualidadeLab = typeof QUALIDADES[number];

export type ConfigDoNo = { proporcao: Proporcao; quantidade: number; qualidade: QualidadeLab; motor: string | null };
export type GravityDoNo = { prompt_base: string; referencias: Array<{ path: string; bucket?: string }> };

export const MAX_IMAGENS_POR_NO = 4;
export const MAX_LAMINAS = 10;
export const MAX_LOGOS = 8;

export const proporcaoValida = (v: unknown): Proporcao | null => ((PROPORCOES as readonly string[]).indexOf(String(v)) >= 0 ? v as Proporcao : null);
export const qualidadeValida = (v: unknown): QualidadeLab | null => ((QUALIDADES as readonly string[]).indexOf(String(v)) >= 0 ? v as QualidadeLab : null);
export const limitar = (v: unknown, min: number, max: number, reserva: number) => {
  const n = Math.floor(numero(v, reserva));
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : reserva));
};

/** Configuração efetiva de um nó: a do próprio nó vence a do nó Configurações ligado. */
export function configDe(c: Pick<Canvas, "nos" | "ligacoes">, no: NoDoCanvas): ConfigDoNo {
  const ligada = entradasDo(c, no.id).find((n) => n.tipo === "config");
  const base = ligada ? ligada.dados : {};
  const d = no.dados;
  return {
    proporcao: proporcaoValida(d.proporcao) ?? proporcaoValida(base.proporcao) ?? (no.tipo === "logo" ? "1:1" : "4:5"),
    quantidade: limitar(d.quantidade ?? base.quantidade, 1, MAX_IMAGENS_POR_NO, 1),
    qualidade: qualidadeValida(d.qualidade) ?? qualidadeValida(base.qualidade) ?? "media",
    motor: texto(d.motor, 200) || texto(base.motor, 200) || null,
  };
}

export function gravityDe(c: Pick<Canvas, "nos" | "ligacoes">, no: NoDoCanvas): GravityDoNo | null {
  const g = entradasDo(c, no.id).find((n) => n.tipo === "gravity");
  if (!g) return null;
  const refs = Array.isArray(g.dados.referencias) ? g.dados.referencias : [];
  return {
    prompt_base: texto(g.dados.prompt_base),
    referencias: refs
      .map((r) => objeto(r))
      .filter((r) => typeof r.path === "string" && r.path)
      .map((r) => ({ path: String(r.path), ...(typeof r.bucket === "string" ? { bucket: r.bucket } : {}) })),
  };
}

/**
 * Prompt do Resultado (imagem): base comum (gravity) primeiro, depois o pedido do nó, os textos a montante,
 * a marca e o quadro. A base comum vale para todos os Resultados ligados a ela.
 */
export function montarPromptDaImagem(o: {
  pedido?: string | null;
  textos?: string[];
  gravity?: GravityDoNo | null;
  config?: Pick<ConfigDoNo, "proporcao"> | null;
  marca?: string | null;
  variacao?: string | null;
}): string {
  const partes: string[] = [];
  const base = (o.gravity?.prompt_base || "").trim();
  if (base) partes.push(`BASE COMUM (vale para todas as peças deste fluxo):\n${base}`);
  const pedido = (o.pedido || "").trim();
  if (pedido) partes.push(`PEDIDO DESTA PEÇA:\n${pedido}`);
  const textos = (o.textos || []).map((t) => t.trim()).filter(Boolean);
  if (textos.length) partes.push(`CONTEXTO E TEXTOS LIGADOS:\n${textos.map((t) => `- ${t.slice(0, 2500)}`).join("\n")}`);
  if (o.marca && o.marca.trim()) partes.push(`MARCA:\n${o.marca.trim()}`);
  if (o.variacao && o.variacao.trim()) partes.push(`VARIAÇÃO:\n${o.variacao.trim()}`);
  if (o.config?.proporcao) partes.push(`QUADRO: composição pensada para ${o.config.proporcao}.`);
  if (o.gravity?.referencias?.length) partes.push("As imagens enviadas junto são referência visual (estilo, cor, luz); não copie texto delas.");
  partes.push("Texto que aparecer na arte: em português do Brasil, com ortografia correta.");
  return partes.join("\n\n").slice(0, 12000);
}

// ------------------------------------------------------------------ custo (plano puro)

export const MODELO_TEXTO_PADRAO = "openrouter:anthropic/claude-opus-5.5";
export const MODELO_IMAGEM_PADRAO = "openrouter:openai/gpt-image-2.5-sunburst";

export type Chamada = { tipo: "texto" | "imagem"; modelo_id: string; tokens_entrada: number; tokens_saida: number; imagens: number; qualidade: QualidadeLab | null; imagens_entrada?: number };

/** Saída esperada por tipo de nó (tokens), do lado seguro. */
export const SAIDA_ESPERADA: Record<string, number> = {
  agente: 2500,
  copy: 2000,
  carrossel: 3000,
  landing: 14000,
  anuncio: 2000,
  planejar: 3000,
};

const tokensDe = (t: string) => Math.ceil(t.length / 3.5);

/** Textos a montante (só o que já está no canvas; saídas de execução entram na hora de rodar). */
function textosDosDados(c: Pick<Canvas, "nos" | "ligacoes">, no: NoDoCanvas): string {
  return entradasDo(c, no.id)
    .map((n) => [n.dados.texto, n.dados.instrucao, n.dados.prompt_base, n.dados.prompt].filter((x) => typeof x === "string").join(" "))
    .join(" ");
}

/** As chamadas pagas que um nó fará (para estimar sem chamar provedor). Nó estático ou externo: nenhuma. */
export function chamadasDoNo(c: Pick<Canvas, "nos" | "ligacoes">, no: NoDoCanvas): Chamada[] {
  const d = no.dados;
  const base = 3000 + tokensDe(textosDosDados(c, no)) + tokensDe(JSON.stringify(d).slice(0, 8000));
  const modeloTexto = texto(d.modelo_id, 200) || MODELO_TEXTO_PADRAO;
  const cfg = configDe(c, no);
  const motor = cfg.motor || MODELO_IMAGEM_PADRAO;
  const refs = entradasDo(c, no.id).filter((n) => SAIDA_DO_TIPO[n.tipo] === "imagens").length + (gravityDe(c, no)?.referencias.length || 0);
  const img = (n: number): Chamada => ({ tipo: "imagem", modelo_id: motor, tokens_entrada: 800, tokens_saida: 0, imagens: n, qualidade: cfg.qualidade, imagens_entrada: Math.min(refs, 4) });
  switch (no.tipo) {
    case "agente":
    case "copy":
    case "anuncio":
    case "landing":
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA[no.tipo], imagens: 0, qualidade: null }];
    case "imagem":
      return [img(cfg.quantidade)];
    case "carrossel": {
      const laminas = limitar(d.laminas, 2, MAX_LAMINAS, 5);
      return [{ tipo: "texto", modelo_id: modeloTexto, tokens_entrada: base, tokens_saida: SAIDA_ESPERADA.carrossel, imagens: 0, qualidade: null }, img(laminas)];
    }
    case "logo":
      return [img(limitar(d.n, 1, MAX_LOGOS, 4))];
    default:
      return [];
  }
}

export type PrecoDaChamada = (ch: Chamada) => number;
export type CustoDoNo = { no_id: string; tipo: TipoDeNo; custo_usd: number; chamadas: Chamada[] };

/** Soma o custo por nó e o total (preço de cada chamada vem de fora: o catálogo pelo motor). */
export function somarEstimativa(c: Pick<Canvas, "nos" | "ligacoes">, ids: string[], preco: PrecoDaChamada): { por_no: CustoDoNo[]; total_usd: number } {
  const por_no: CustoDoNo[] = [];
  let total = 0;
  for (const id of ids) {
    const no = c.nos.find((n) => n.id === id);
    if (!no || !ehExecutavel(no.tipo)) continue;
    const chamadas = chamadasDoNo(c, no);
    const custo = arred(chamadas.reduce((s, ch) => s + preco(ch), 0));
    total += custo;
    por_no.push({ no_id: id, tipo: no.tipo, custo_usd: custo, chamadas });
  }
  return { por_no, total_usd: arred(total) };
}

export const arred = (v: number) => Math.round((Number(v) || 0) * 1e6) / 1e6;

// ------------------------------------------------------------------ workspace (caminhos)

export const RAIZ_DO_LABORATORIO = "Laboratório";
export const PASTA_DOS_LIVRES = "Livres";

export function nomeLimpo(t: unknown, reserva = "Sem nome"): string {
  const s = String(t ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return s || reserva;
}

/** Laboratório / <Livres | Nome do cliente> / <projeto>. */
export function pastasDoLaboratorio(nomeDoCliente: string | null, nomeDoProjeto: string): string[] {
  return [RAIZ_DO_LABORATORIO, nomeDoCliente ? nomeLimpo(nomeDoCliente, "Cliente") : PASTA_DOS_LIVRES, nomeLimpo(nomeDoProjeto, "Projeto")];
}

const EXTENSAO_DO_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/html": "html", "application/json": "json" };
export const extensaoDe = (mime: string) => EXTENSAO_DO_MIME[String(mime || "").toLowerCase()] || "bin";

/** Caminho no bucket workspace (escopo global; a política deixa a equipe ler global/...). */
export function caminhoNoBucket(projetoId: string, execucaoId: string, indice: number, mime: string): string {
  return `global/laboratorio/${projetoId}/${execucaoId}-${String(indice + 1).padStart(2, "0")}.${extensaoDe(mime)}`;
}

/** "Resultado 01.png", "Logo v2 03.png", "Landing.html". */
export function nomeDoArquivo(rotulo: string, indice: number, total: number, mime: string): string {
  const base = nomeLimpo(rotulo, "Arquivo").slice(0, 80);
  return total > 1 ? `${base} ${String(indice + 1).padStart(2, "0")}.${extensaoDe(mime)}` : `${base}.${extensaoDe(mime)}`;
}

/** Duas pastas são a mesma: nome sem acento e sem caixa. */
export const nomeNormal = (t: string) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ------------------------------------------------------------------ operações do planejar

export const OPERACOES = ["criar", "ligar", "desligar", "definir", "remover", "organizar"] as const;
export type NomeDaOperacao = typeof OPERACOES[number];
export type Operacao = {
  op: string;
  /** criar: apelido do nó novo (o agente usa nas ligações seguintes). */
  ref?: string;
  tipo?: string;
  dados?: Record<string, unknown>;
  x?: number;
  y?: number;
  /** definir, remover: o nó (id ou apelido). */
  no?: string;
  /** ligar, desligar. */
  de?: string;
  para?: string;
};
/** Recibo de cada operação; `operacao` é a operação já com os ids reais (aceita) ou como veio (recusada). */
export type Recibo = { indice: number; op: string; aceita: boolean; recibo: string; no_id?: string; ligacao_id?: string; operacao?: unknown };

/** Campos que cada tipo aceita em `dados` (o resto é ignorado com aviso). */
export const CAMPOS_DO_TIPO: Record<TipoDeNo, readonly string[]> = {
  contexto: ["titulo", "texto"],
  midia: ["titulo", "imagens"],
  config: ["titulo", "proporcao", "quantidade", "qualidade", "motor"],
  gravity: ["titulo", "prompt_base", "referencias"],
  agente: ["titulo", "instrucao", "modelo_id"],
  copy: ["titulo", "formato", "instrucao", "modelo_id"],
  imagem: ["titulo", "prompt", "quantidade", "qualidade", "proporcao", "motor"],
  carrossel: ["titulo", "tema", "laminas", "modelo_id", "motor", "qualidade", "proporcao"],
  logo: ["titulo", "nome", "conceito", "paleta", "estilo", "n", "motor", "qualidade"],
  landing: ["titulo", "objetivo", "secoes", "modelo_id"],
  anuncio: ["titulo", "objetivo", "publico", "oferta", "modelo_id"],
  agente_externo: ["titulo", "operador", "instrucao"],
};

export const FORMATOS_DE_COPY = ["anuncio", "legenda", "landing", "email", "roteiro_curto"] as const;

/** Limpa `dados` para o tipo: campos conhecidos, texto curto, número no intervalo. Devolve também o que foi ignorado. */
export function dadosDoTipo(tipo: TipoDeNo, bruto: unknown): { dados: Record<string, unknown>; ignorados: string[] } {
  const o = objeto(bruto);
  const permitidos = CAMPOS_DO_TIPO[tipo];
  const dados: Record<string, unknown> = {};
  const ignorados: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (permitidos.indexOf(k) < 0) {
      ignorados.push(k);
      continue;
    }
    if (k === "quantidade") dados[k] = limitar(v, 1, MAX_IMAGENS_POR_NO, 1);
    else if (k === "laminas") dados[k] = limitar(v, 2, MAX_LAMINAS, 5);
    else if (k === "n") dados[k] = limitar(v, 1, MAX_LOGOS, 4);
    else if (k === "proporcao") { const p = proporcaoValida(v); if (p) dados[k] = p; else ignorados.push(k); }
    else if (k === "qualidade") { const q = qualidadeValida(v); if (q) dados[k] = q; else ignorados.push(k); }
    else if (k === "formato") { if ((FORMATOS_DE_COPY as readonly string[]).indexOf(String(v)) >= 0) dados[k] = v; else ignorados.push(k); }
    else if (k === "imagens" || k === "referencias") { if (Array.isArray(v)) dados[k] = v.slice(0, 12); else ignorados.push(k); }
    else if (typeof v === "string") dados[k] = v.slice(0, MAX_TEXTO);
    else if (typeof v === "number" && Number.isFinite(v)) dados[k] = v;
    else ignorados.push(k);
  }
  return { dados, ignorados };
}

/** Colunas pela profundidade (maior caminho até o nó), linhas na ordem do canvas. */
export function organizar(c: Canvas): Canvas {
  let ordem: string[];
  try {
    ordem = ordemTopologica(c);
  } catch {
    return c;
  }
  const profundidade = new Map<string, number>();
  for (const id of ordem) {
    const antes = c.ligacoes.filter((l) => l.para === id).map((l) => (profundidade.get(l.de) ?? 0) + 1);
    profundidade.set(id, antes.length ? Math.max(...antes) : 0);
  }
  const linhas = new Map<number, number>();
  const nos = c.nos.map((n) => {
    const col = profundidade.get(n.id) ?? 0;
    const linha = linhas.get(col) ?? 0;
    linhas.set(col, linha + 1);
    return { ...n, x: 80 + col * 320, y: 80 + linha * 180 };
  });
  return { ...c, nos };
}

const RECUSA_DE_EXECUCAO = "Não gero nem publico pelo planejar: monto o fluxo e você confirma o custo antes de rodar.";

/**
 * Aplica as operações do agente numa cópia do canvas, uma a uma, com recibo de cada.
 * Operação inválida não para as outras: vira recibo com o motivo. Nunca gera nem publica.
 */
export function aplicarOperacoes(canvas: Canvas, ops: unknown[]): { canvas: Canvas; recibos: Recibo[]; aceitas: Operacao[] } {
  let c: Canvas = { nos: canvas.nos.map((n) => ({ ...n, dados: { ...n.dados } })), ligacoes: canvas.ligacoes.slice(), viewport: { ...canvas.viewport } };
  const apelidos = new Map<string, string>();
  const recibos: Recibo[] = [];
  const aceitas: Operacao[] = [];
  const idDe = (ref: unknown) => {
    const s = String(ref ?? "");
    return apelidos.get(s) ?? (c.nos.some((n) => n.id === s) ? s : "");
  };
  let contador = c.nos.length;
  const lista = Array.isArray(ops) ? ops.slice(0, 120) : [];
  lista.forEach((bruta, indice) => {
    const op = objeto(bruta) as Operacao;
    const nome = String(op.op || "");
    const recusar = (motivo: string) => recibos.push({ indice, op: nome || "?", aceita: false, recibo: motivo, operacao: bruta });
    const aceitar = (operacao: Operacao, r: Omit<Recibo, "indice" | "op" | "aceita" | "operacao">) => {
      aceitas.push(operacao);
      recibos.push({ indice, op: nome, aceita: true, ...r, operacao });
    };
    if ((OPERACOES as readonly string[]).indexOf(nome) < 0) {
      recusar(nome === "gerar" || nome === "publicar" || nome === "escrever" ? RECUSA_DE_EXECUCAO : `Operação desconhecida: ${nome || "(vazia)"}.`);
      return;
    }
    if (nome === "criar") {
      if (!ehTipoDeNo(op.tipo)) return recusar(`Tipo de nó desconhecido: ${String(op.tipo)}.`);
      if (c.nos.length >= MAX_NOS) return recusar(`O canvas já tem ${MAX_NOS} nós.`);
      const tipo = op.tipo as TipoDeNo;
      let id = "";
      do {
        contador += 1;
        id = `no_${tipo}_${contador}`;
      } while (c.nos.some((n) => n.id === id));
      const { dados, ignorados } = dadosDoTipo(tipo, op.dados);
      c = { ...c, nos: c.nos.concat([{ id, tipo, x: numero(op.x, 80 + (contador % 5) * 320), y: numero(op.y, 80 + Math.floor(contador / 5) * 180), dados }]) };
      if (op.ref) apelidos.set(String(op.ref), id);
      aceitar({ op: nome, ref: id, tipo, dados, x: c.nos[c.nos.length - 1].x, y: c.nos[c.nos.length - 1].y }, { no_id: id, recibo: `Criei ${ROTULO_DO_TIPO[tipo]}${dados.titulo ? ` "${dados.titulo}"` : ""}.${ignorados.length ? ` Ignorei: ${ignorados.join(", ")}.` : ""}` });
      return;
    }
    if (nome === "ligar") {
      const de = idDe(op.de);
      const para = idDe(op.para);
      const motivo = motivoParaNaoLigar(c, de, para);
      if (motivo) return recusar(`Não liguei: ${motivo}`);
      const ligacao: Ligacao = { id: `lig_${de}_${para}`, de, para };
      c = { ...c, ligacoes: c.ligacoes.concat([ligacao]) };
      if (c.ligacoes.length > MAX_LIGACOES) {
        c = { ...c, ligacoes: c.ligacoes.slice(0, -1) };
        return recusar(`O canvas já tem ${MAX_LIGACOES} ligações.`);
      }
      aceitar({ op: nome, de, para }, { ligacao_id: ligacao.id, recibo: `Liguei ${rotulo(c, de)} → ${rotulo(c, para)}.` });
      return;
    }
    if (nome === "desligar") {
      const de = idDe(op.de);
      const para = idDe(op.para);
      const l = c.ligacoes.find((x) => x.de === de && x.para === para);
      if (!l) return recusar("Não desliguei: essa ligação não existe.");
      c = { ...c, ligacoes: c.ligacoes.filter((x) => x !== l) };
      aceitar({ op: nome, de, para }, { ligacao_id: l.id, recibo: `Desliguei ${rotulo(c, de)} → ${rotulo(c, para)}.` });
      return;
    }
    if (nome === "definir") {
      const id = idDe(op.no);
      const no = c.nos.find((n) => n.id === id);
      if (!no) return recusar("Não defini: o nó não existe.");
      const { dados, ignorados } = dadosDoTipo(no.tipo, op.dados);
      if (!Object.keys(dados).length) return recusar(`Não defini: nenhum campo vale para ${ROTULO_DO_TIPO[no.tipo]}.`);
      c = { ...c, nos: c.nos.map((n) => (n.id === id ? { ...n, dados: { ...n.dados, ...dados } } : n)) };
      aceitar({ op: nome, no: id, dados }, { no_id: id, recibo: `Ajustei ${rotulo(c, id)}: ${Object.keys(dados).join(", ")}.${ignorados.length ? ` Ignorei: ${ignorados.join(", ")}.` : ""}` });
      return;
    }
    if (nome === "remover") {
      const id = idDe(op.no);
      if (!id) return recusar("Não removi: o nó não existe.");
      const r = rotulo(c, id);
      c = { ...c, nos: c.nos.filter((n) => n.id !== id), ligacoes: c.ligacoes.filter((l) => l.de !== id && l.para !== id) };
      aceitar({ op: nome, no: id }, { no_id: id, recibo: `Removi ${r} e as ligações dele.` });
      return;
    }
    // organizar
    c = organizar(c);
    aceitar({ op: "organizar" }, { recibo: "Organizei os nós em colunas, na ordem do fluxo." });
  });
  return { canvas: c, recibos, aceitas };
}

function rotulo(c: Canvas, id: string): string {
  const n = c.nos.find((x) => x.id === id);
  if (!n) return id;
  const t = typeof n.dados.titulo === "string" && n.dados.titulo ? ` "${n.dados.titulo}"` : "";
  return `${ROTULO_DO_TIPO[n.tipo] || n.tipo}${t}`;
}

/** Esquema JSON da resposta do planejar (o motor pede ao modelo). */
export const ESQUEMA_DO_PLANEJAR = {
  nome: "plano_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resposta", "operacoes"],
    properties: {
      resposta: { type: "string" },
      operacoes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["op"],
          properties: {
            op: { type: "string", enum: [...OPERACOES] },
            ref: { type: "string" },
            tipo: { type: "string", enum: [...TIPOS_DE_NO] },
            no: { type: "string" },
            de: { type: "string" },
            para: { type: "string" },
            /** Os campos do nó em JSON (texto): objeto livre não passa no esquema estrito da Anthropic. */
            dados_json: { type: "string" },
          },
        },
      },
    },
  },
} as const;

/** Lê a resposta do modelo: { resposta, operacoes[] } com tolerância a campos faltando. */
export function lerPlano(json: unknown, textoBruto: string): { resposta: string; operacoes: unknown[] } {
  const o = objeto(json);
  const resposta = typeof o.resposta === "string" && o.resposta.trim() ? o.resposta.trim() : textoBruto.trim();
  const operacoes = (Array.isArray(o.operacoes) ? o.operacoes : []).map((bruta) => {
    const op = { ...objeto(bruta) };
    if (typeof op.dados_json === "string" && op.dados === undefined) {
      try {
        op.dados = objeto(JSON.parse(op.dados_json));
      } catch {
        op.dados = {};
      }
    }
    delete op.dados_json;
    return op;
  });
  return { resposta: resposta.slice(0, 6000), operacoes };
}

/** Resumo do canvas para o agente (ids, tipos, títulos, ligações): é o que ele pode referenciar. */
export function resumoDoCanvas(c: Canvas): string {
  if (!c.nos.length) return "Canvas vazio.";
  const nos = c.nos.map((n) => `- ${n.id} (${n.tipo})${n.dados.titulo ? ` "${String(n.dados.titulo).slice(0, 60)}"` : ""}: ${JSON.stringify(n.dados).slice(0, 300)}`);
  const ligs = c.ligacoes.map((l) => `- ${l.de} → ${l.para}`);
  return `NÓS:\n${nos.join("\n")}\nLIGAÇÕES:\n${ligs.join("\n") || "(nenhuma)"}`;
}

/** As regras de ligação em texto, para o prompt do planejar. */
export function regrasEmTexto(): string {
  return TIPOS_DE_NO.map((t) => `- ${t} (${ROTULO_DO_TIPO[t]}): recebe ${ENTRADAS_ACEITAS[t].length ? ENTRADAS_ACEITAS[t].join(", ") : "nada"}; campos: ${CAMPOS_DO_TIPO[t].join(", ")}`).join("\n");
}
