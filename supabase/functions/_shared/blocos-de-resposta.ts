/**
 * Blocos de resposta dos agentes (Gestor, Hermes, agentes das Mesas).
 *
 * O modelo nunca escreve HTML: ele devolve blocos tipados (tabela, métricas,
 * gráfico, fluxo, entrega, arquivo, progresso, texto). Este arquivo valida os
 * blocos com regra fixa e o painel desenha com os componentes de
 * src/components/agentes/respostas/BlocosDeResposta.tsx. Nada é inventado: o
 * componente só mostra o que passou por `validarBlocos`.
 *
 * TS puro, sem React, sem DOM e sem import "@/...": o mesmo arquivo pode ser
 * importado por uma função Deno (supabase/functions) para validar no servidor.
 * Regex só com o básico: nada de lookbehind, classe Unicode ou grupo com nome
 * (Safari 11 / Chrome 64; src/test/compatibilidade-iphone-antigo.test.ts).
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export const ESTADOS_DE_ETAPA = ["planejado", "em_execucao", "aguardando_aprovacao", "bloqueado", "concluido"] as const;
export type EstadoDeEtapa = (typeof ESTADOS_DE_ETAPA)[number];

export const TONS_DE_METRICA = ["neutro", "bom", "alerta", "perigo"] as const;
export type TomDeMetrica = (typeof TONS_DE_METRICA)[number];

export const TIPOS_DE_GRAFICO = ["barras", "linhas", "pizza"] as const;
export type TipoDeGrafico = (typeof TIPOS_DE_GRAFICO)[number];

export const NATUREZAS_DE_FLUXO = ["proposta", "registro"] as const;
export type NaturezaDoFluxo = (typeof NATUREZAS_DE_FLUXO)[number];

export const TIPOS_DE_BLOCO = ["texto", "tabela", "metricas", "grafico", "fluxo", "entrega", "arquivo", "progresso"] as const;
export type TipoDeBloco = (typeof TIPOS_DE_BLOCO)[number];

export type CelulaDaTabela = string | number | null;

/** Referência a um objeto do painel (tarefa, post, arquivo...). */
export interface ObjetoDoPainel {
  tipo: string;
  id: string;
  titulo?: string;
  client_id?: string;
}

export interface BlocoTexto {
  tipo: "texto";
  texto: string;
}

export interface BlocoTabela {
  tipo: "tabela";
  titulo?: string;
  colunas: string[];
  linhas: CelulaDaTabela[][];
  fontes?: string[];
}

export interface ItemDeMetrica {
  rotulo: string;
  valor: number | string;
  variacao?: string;
  tom?: TomDeMetrica;
}

export interface BlocoMetricas {
  tipo: "metricas";
  titulo?: string;
  itens: ItemDeMetrica[];
  fontes?: string[];
}

export interface PontoDoGrafico {
  x: string;
  y: number;
}

export interface SerieDoGrafico {
  nome: string;
  pontos: PontoDoGrafico[];
}

export interface BlocoGrafico {
  tipo: "grafico";
  titulo?: string;
  tipo_grafico: TipoDeGrafico;
  series: SerieDoGrafico[];
  unidade?: string;
  fontes?: string[];
}

export interface PassoDoFluxo {
  id: string;
  rotulo: string;
  detalhe?: string;
  estado?: EstadoDeEtapa;
}

export interface LigacaoDoFluxo {
  de: string;
  para: string;
  rotulo?: string;
}

export interface BlocoFluxo {
  tipo: "fluxo";
  titulo?: string;
  passos: PassoDoFluxo[];
  ligacoes?: LigacaoDoFluxo[];
  /** proposta = plano que o agente desenhou; registro = estado vindo do sistema. */
  natureza: NaturezaDoFluxo;
}

export interface BlocoEntrega {
  tipo: "entrega";
  nome: string;
  tipo_objeto: string;
  objeto?: ObjetoDoPainel;
  estado: string;
  cliente?: string;
  proxima?: string;
}

export interface BlocoArquivo {
  tipo: "arquivo";
  nome: string;
  mime?: string;
  /** Só https. */
  url?: string;
  objeto?: { tipo: "arquivo"; id: string };
}

export interface EtapaDoProgresso {
  rotulo: string;
  estado: EstadoDeEtapa;
  quando?: string;
  evidencia?: string;
}

export interface BlocoProgresso {
  tipo: "progresso";
  titulo: string;
  etapas: EtapaDoProgresso[];
}

export type BlocoDeResposta =
  | BlocoTexto
  | BlocoTabela
  | BlocoMetricas
  | BlocoGrafico
  | BlocoFluxo
  | BlocoEntrega
  | BlocoArquivo
  | BlocoProgresso;

export interface BlocoRecusado {
  indice: number;
  motivo: string;
}

export interface ResultadoDosBlocos {
  blocos: BlocoDeResposta[];
  recusados: BlocoRecusado[];
}

export interface OpcoesDeValidacao {
  /**
   * Apelidos das fontes que o servidor de fato leu nesta resposta. Quando
   * vem, tabela, métricas e gráfico precisam citar ao menos uma fonte, e só
   * fontes desta lista (número tem que vir de fonte).
   */
  fontesConhecidas?: string[];
  /**
   * Hosts aceitos para `arquivo.url` (ex.: ["supabase.co"], vale subdomínio).
   * Sem a lista, qualquer https passa.
   */
  hostsPermitidos?: string[];
}

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------

export const LIMITES_DOS_BLOCOS = {
  blocos: 12,
  texto: 2000,
  titulo: 120,
  rotulo: 80,
  detalhe: 280,
  celula: 200,
  id: 120,
  nome: 160,
  fonte: 80,
  fontes: 10,
  colunas: 8,
  linhas: 50,
  metricas: 12,
  series: 4,
  pontos: 60,
  fatiasDaPizza: 12,
  passos: 20,
  ligacoes: 40,
  etapas: 20,
  url: 2048,
} as const;

const L = LIMITES_DOS_BLOCOS;

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

class Recusa extends Error {}

function recusar(motivo: string): never {
  throw new Recusa(motivo);
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Corta o texto no limite (com reticências) e tira espaço das pontas. */
export function cortarTexto(valor: string, max: number): string {
  const limpo = valor.replace(/\u0000/g, "").trim();
  if (limpo.length <= max) return limpo;
  return limpo.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Texto obrigatório: string não vazia (depois de tirar espaços). */
function textoObrigatorio(v: unknown, campo: string, max: number): string {
  if (typeof v !== "string") recusar(`${campo} precisa ser texto`);
  const t = cortarTexto(v as string, max);
  if (!t) recusar(`${campo} vazio`);
  return t;
}

/** Texto opcional: null, undefined ou vazio viram undefined. */
function textoOpcional(v: unknown, campo: string, max: number): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "string") recusar(`${campo} precisa ser texto`);
  const t = cortarTexto(v as string, max);
  return t || undefined;
}

function numeroFinito(v: unknown, campo: string): number {
  if (typeof v !== "number" || !isFinite(v)) recusar(`${campo} precisa ser número finito`);
  return v as number;
}

function lista(v: unknown, campo: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v)) recusar(`${campo} precisa ser lista`);
  const a = v as unknown[];
  if (a.length < min) recusar(`${campo} precisa de ao menos ${min} item`);
  if (a.length > max) recusar(`${campo} passa do limite de ${max}`);
  return a;
}

function escolha<T extends string>(v: unknown, campo: string, opcoes: readonly T[]): T {
  if (typeof v !== "string" || opcoes.indexOf(v as T) < 0) recusar(`${campo} fora das opções`);
  return v as T;
}

function escolhaOpcional<T extends string>(v: unknown, campo: string, opcoes: readonly T[]): T | undefined {
  if (v === null || v === undefined) return undefined;
  return escolha(v, campo, opcoes);
}

/** Só https, sem credencial embutida e, se houver lista, só hosts permitidos. */
export function urlSegura(v: unknown, hostsPermitidos?: string[]): string | null {
  if (typeof v !== "string") return null;
  const bruta = v.trim();
  if (!bruta || bruta.length > L.url || /\s/.test(bruta)) return null;
  if (bruta.slice(0, 8).toLowerCase() !== "https://") return null;
  let u: URL;
  try {
    u = new URL(bruta);
  } catch (_erro) {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
  if (hostsPermitidos && hostsPermitidos.length) {
    const host = u.hostname.toLowerCase();
    const ok = hostsPermitidos.some((h) => {
      const alvo = String(h).toLowerCase().replace(/^\.+/, "");
      return !!alvo && (host === alvo || host.slice(-(alvo.length + 1)) === "." + alvo);
    });
    if (!ok) return null;
  }
  return u.toString();
}

function fontesDoBloco(v: unknown, opcoes: OpcoesDeValidacao): string[] | undefined {
  let fontes: string[] = [];
  if (v !== null && v !== undefined) {
    const brutas = lista(v, "fontes", 0, L.fontes);
    const vistas: Record<string, true> = {};
    for (let i = 0; i < brutas.length; i += 1) {
      const f = textoObrigatorio(brutas[i], `fontes[${i}]`, L.fonte);
      if (!vistas[f]) {
        vistas[f] = true;
        fontes.push(f);
      }
    }
  }
  const conhecidas = opcoes.fontesConhecidas;
  if (conhecidas) {
    if (!fontes.length) recusar("número sem fonte: cite ao menos uma fonte lida");
    const desconhecidas = fontes.filter((f) => conhecidas.indexOf(f) < 0);
    if (desconhecidas.length) recusar(`fonte desconhecida: ${desconhecidas.join(", ")}`);
  }
  return fontes.length ? fontes : undefined;
}

function objetoDoPainel(v: unknown, campo: string): ObjetoDoPainel | undefined {
  if (v === null || v === undefined) return undefined;
  if (!ehObjeto(v)) recusar(`${campo} precisa ser objeto`);
  const o = v as Record<string, unknown>;
  const saida: ObjetoDoPainel = {
    tipo: textoObrigatorio(o.tipo, `${campo}.tipo`, L.rotulo),
    id: textoObrigatorio(o.id, `${campo}.id`, L.id),
  };
  const titulo = textoOpcional(o.titulo, `${campo}.titulo`, L.titulo);
  const client = textoOpcional(o.client_id, `${campo}.client_id`, L.id);
  if (titulo) saida.titulo = titulo;
  if (client) saida.client_id = client;
  return saida;
}

// ---------------------------------------------------------------------------
// Um validador por tipo
// ---------------------------------------------------------------------------

function validarTexto(b: Record<string, unknown>): BlocoTexto {
  return { tipo: "texto", texto: textoObrigatorio(b.texto, "texto", L.texto) };
}

function validarTabela(b: Record<string, unknown>, opcoes: OpcoesDeValidacao): BlocoTabela {
  const colunas = lista(b.colunas, "colunas", 1, L.colunas).map((c, i) => textoObrigatorio(c, `colunas[${i}]`, L.rotulo));
  const linhas = lista(b.linhas, "linhas", 1, L.linhas).map((linha, i) => {
    const celulas = lista(linha, `linhas[${i}]`, 0, L.colunas);
    if (celulas.length !== colunas.length) recusar(`linhas[${i}] tem ${celulas.length} células, esperado ${colunas.length}`);
    return celulas.map((c, j): CelulaDaTabela => {
      if (c === null || c === undefined) return null;
      if (typeof c === "number") return numeroFinito(c, `linhas[${i}][${j}]`);
      if (typeof c === "string") return cortarTexto(c, L.celula);
      return recusar(`linhas[${i}][${j}] precisa ser texto, número ou vazio`);
    });
  });
  const saida: BlocoTabela = { tipo: "tabela", colunas, linhas };
  const titulo = textoOpcional(b.titulo, "titulo", L.titulo);
  if (titulo) saida.titulo = titulo;
  const fontes = fontesDoBloco(b.fontes, opcoes);
  if (fontes) saida.fontes = fontes;
  return saida;
}

function validarMetricas(b: Record<string, unknown>, opcoes: OpcoesDeValidacao): BlocoMetricas {
  const itens = lista(b.itens, "itens", 1, L.metricas).map((bruto, i): ItemDeMetrica => {
    if (!ehObjeto(bruto)) recusar(`itens[${i}] precisa ser objeto`);
    const it = bruto as Record<string, unknown>;
    let valor: number | string;
    if (typeof it.valor === "number") valor = numeroFinito(it.valor, `itens[${i}].valor`);
    else valor = textoObrigatorio(it.valor, `itens[${i}].valor`, L.rotulo);
    const item: ItemDeMetrica = { rotulo: textoObrigatorio(it.rotulo, `itens[${i}].rotulo`, L.rotulo), valor };
    const variacao = textoOpcional(it.variacao, `itens[${i}].variacao`, L.rotulo);
    const tom = escolhaOpcional(it.tom, `itens[${i}].tom`, TONS_DE_METRICA);
    if (variacao) item.variacao = variacao;
    if (tom) item.tom = tom;
    return item;
  });
  const saida: BlocoMetricas = { tipo: "metricas", itens };
  const titulo = textoOpcional(b.titulo, "titulo", L.titulo);
  if (titulo) saida.titulo = titulo;
  const fontes = fontesDoBloco(b.fontes, opcoes);
  if (fontes) saida.fontes = fontes;
  return saida;
}

function validarGrafico(b: Record<string, unknown>, opcoes: OpcoesDeValidacao): BlocoGrafico {
  const tipoGrafico = escolha(b.tipo_grafico, "tipo_grafico", TIPOS_DE_GRAFICO);
  const series = lista(b.series, "series", 1, L.series).map((bruta, i): SerieDoGrafico => {
    if (!ehObjeto(bruta)) recusar(`series[${i}] precisa ser objeto`);
    const s = bruta as Record<string, unknown>;
    const pontos = lista(s.pontos, `series[${i}].pontos`, 1, L.pontos).map((p, j): PontoDoGrafico => {
      if (!ehObjeto(p)) recusar(`series[${i}].pontos[${j}] precisa ser objeto`);
      const pt = p as Record<string, unknown>;
      return {
        x: textoObrigatorio(pt.x, `series[${i}].pontos[${j}].x`, L.rotulo),
        y: numeroFinito(pt.y, `series[${i}].pontos[${j}].y`),
      };
    });
    // x repetido na mesma série: o desenho teria que somar ou escolher (inventar).
    const vistos: Record<string, true> = {};
    for (const p of pontos) {
      if (vistos[p.x]) recusar(`series[${i}] repete o x "${p.x}"`);
      vistos[p.x] = true;
    }
    return { nome: textoObrigatorio(s.nome, `series[${i}].nome`, L.rotulo), pontos };
  });
  if (tipoGrafico === "pizza") {
    if (series.length !== 1) recusar("pizza aceita uma série só");
    if (series[0].pontos.length > L.fatiasDaPizza) recusar(`pizza passa do limite de ${L.fatiasDaPizza} fatias`);
    if (series[0].pontos.some((p) => p.y < 0)) recusar("pizza não aceita valor negativo");
  }
  const saida: BlocoGrafico = { tipo: "grafico", tipo_grafico: tipoGrafico, series };
  const titulo = textoOpcional(b.titulo, "titulo", L.titulo);
  const unidade = textoOpcional(b.unidade, "unidade", 20);
  if (titulo) saida.titulo = titulo;
  if (unidade) saida.unidade = unidade;
  const fontes = fontesDoBloco(b.fontes, opcoes);
  if (fontes) saida.fontes = fontes;
  return saida;
}

function validarFluxo(b: Record<string, unknown>): BlocoFluxo {
  const natureza = escolha(b.natureza, "natureza", NATUREZAS_DE_FLUXO);
  const ids: Record<string, true> = {};
  const passos = lista(b.passos, "passos", 1, L.passos).map((bruto, i): PassoDoFluxo => {
    if (!ehObjeto(bruto)) recusar(`passos[${i}] precisa ser objeto`);
    const p = bruto as Record<string, unknown>;
    const id = textoObrigatorio(p.id, `passos[${i}].id`, L.id);
    if (ids[id]) recusar(`passos[${i}].id repetido: ${id}`);
    ids[id] = true;
    const passo: PassoDoFluxo = { id, rotulo: textoObrigatorio(p.rotulo, `passos[${i}].rotulo`, L.rotulo) };
    const detalhe = textoOpcional(p.detalhe, `passos[${i}].detalhe`, L.detalhe);
    const estado = escolhaOpcional(p.estado, `passos[${i}].estado`, ESTADOS_DE_ETAPA);
    if (detalhe) passo.detalhe = detalhe;
    // Proposta é plano: não carrega estado de execução que ninguém registrou.
    if (estado && (natureza === "registro" || estado === "planejado")) passo.estado = estado;
    return passo;
  });
  const saida: BlocoFluxo = { tipo: "fluxo", passos, natureza };
  if (b.ligacoes !== null && b.ligacoes !== undefined) {
    const ligacoes = lista(b.ligacoes, "ligacoes", 0, L.ligacoes).map((bruta, i): LigacaoDoFluxo => {
      if (!ehObjeto(bruta)) recusar(`ligacoes[${i}] precisa ser objeto`);
      const l = bruta as Record<string, unknown>;
      const de = textoObrigatorio(l.de, `ligacoes[${i}].de`, L.id);
      const para = textoObrigatorio(l.para, `ligacoes[${i}].para`, L.id);
      if (!ids[de] || !ids[para]) recusar(`ligacoes[${i}] liga passo que não existe`);
      if (de === para) recusar(`ligacoes[${i}] liga o passo a ele mesmo`);
      const ligacao: LigacaoDoFluxo = { de, para };
      const rotulo = textoOpcional(l.rotulo, `ligacoes[${i}].rotulo`, L.rotulo);
      if (rotulo) ligacao.rotulo = rotulo;
      return ligacao;
    });
    if (ligacoes.length) saida.ligacoes = ligacoes;
  }
  const titulo = textoOpcional(b.titulo, "titulo", L.titulo);
  if (titulo) saida.titulo = titulo;
  return saida;
}

function validarEntrega(b: Record<string, unknown>): BlocoEntrega {
  const saida: BlocoEntrega = {
    tipo: "entrega",
    nome: textoObrigatorio(b.nome, "nome", L.nome),
    tipo_objeto: textoObrigatorio(b.tipo_objeto, "tipo_objeto", L.rotulo),
    estado: textoObrigatorio(b.estado, "estado", L.rotulo),
  };
  const objeto = objetoDoPainel(b.objeto, "objeto");
  const cliente = textoOpcional(b.cliente, "cliente", L.nome);
  const proxima = textoOpcional(b.proxima, "proxima", L.detalhe);
  if (objeto) saida.objeto = objeto;
  if (cliente) saida.cliente = cliente;
  if (proxima) saida.proxima = proxima;
  return saida;
}

function validarArquivo(b: Record<string, unknown>, opcoes: OpcoesDeValidacao): BlocoArquivo {
  const saida: BlocoArquivo = { tipo: "arquivo", nome: textoObrigatorio(b.nome, "nome", L.nome) };
  const mime = textoOpcional(b.mime, "mime", L.rotulo);
  if (mime) {
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) recusar("mime inválido");
    saida.mime = mime.toLowerCase();
  }
  if (b.url !== null && b.url !== undefined && b.url !== "") {
    const url = urlSegura(b.url, opcoes.hostsPermitidos);
    if (!url) recusar("url precisa ser https (e de host permitido)");
    saida.url = url as string;
  }
  if (b.objeto !== null && b.objeto !== undefined) {
    if (!ehObjeto(b.objeto)) recusar("objeto precisa ser objeto");
    const o = b.objeto as Record<string, unknown>;
    if (o.tipo !== "arquivo") recusar("objeto.tipo precisa ser arquivo");
    saida.objeto = { tipo: "arquivo", id: textoObrigatorio(o.id, "objeto.id", L.id) };
  }
  return saida;
}

function validarProgresso(b: Record<string, unknown>): BlocoProgresso {
  const etapas = lista(b.etapas, "etapas", 1, L.etapas).map((bruta, i): EtapaDoProgresso => {
    if (!ehObjeto(bruta)) recusar(`etapas[${i}] precisa ser objeto`);
    const e = bruta as Record<string, unknown>;
    const etapa: EtapaDoProgresso = {
      rotulo: textoObrigatorio(e.rotulo, `etapas[${i}].rotulo`, L.rotulo),
      estado: escolha(e.estado, `etapas[${i}].estado`, ESTADOS_DE_ETAPA),
    };
    const quando = textoOpcional(e.quando, `etapas[${i}].quando`, L.rotulo);
    const evidencia = textoOpcional(e.evidencia, `etapas[${i}].evidencia`, L.detalhe);
    if (quando) etapa.quando = quando;
    if (evidencia) etapa.evidencia = evidencia;
    return etapa;
  });
  return { tipo: "progresso", titulo: textoObrigatorio(b.titulo, "titulo", L.titulo), etapas };
}

function validarUm(bruto: unknown, opcoes: OpcoesDeValidacao): BlocoDeResposta {
  if (!ehObjeto(bruto)) recusar("bloco precisa ser objeto");
  const b = bruto as Record<string, unknown>;
  switch (b.tipo) {
    case "texto":
      return validarTexto(b);
    case "tabela":
      return validarTabela(b, opcoes);
    case "metricas":
      return validarMetricas(b, opcoes);
    case "grafico":
      return validarGrafico(b, opcoes);
    case "fluxo":
      return validarFluxo(b);
    case "entrega":
      return validarEntrega(b);
    case "arquivo":
      return validarArquivo(b, opcoes);
    case "progresso":
      return validarProgresso(b);
    default:
      return recusar(`tipo desconhecido: ${typeof b.tipo === "string" ? cortarTexto(b.tipo, 40) : String(b.tipo)}`);
  }
}

/**
 * Valida a saída do modelo. Aceita a lista de blocos, o objeto `{ blocos }`
 * (formato de ESQUEMA_DOS_BLOCOS) ou o JSON em texto. Bloco com forma errada,
 * acima do limite, número não finito, url que não é https ou (com
 * `fontesConhecidas`) número sem fonte lida é recusado inteiro; os outros
 * seguem. Os blocos devolvidos são objetos novos só com os campos conhecidos.
 */
export function validarBlocos(bruto: unknown, opcoes: OpcoesDeValidacao = {}): ResultadoDosBlocos {
  const recusados: BlocoRecusado[] = [];
  let entrada: unknown = bruto;
  if (typeof entrada === "string") {
    try {
      entrada = JSON.parse(entrada);
    } catch (_erro) {
      return { blocos: [], recusados: [{ indice: -1, motivo: "resposta não é JSON" }] };
    }
  }
  if (ehObjeto(entrada) && Array.isArray(entrada.blocos)) entrada = entrada.blocos;
  if (!Array.isArray(entrada)) return { blocos: [], recusados: [{ indice: -1, motivo: "esperava uma lista de blocos" }] };

  const blocos: BlocoDeResposta[] = [];
  for (let i = 0; i < entrada.length; i += 1) {
    if (blocos.length >= L.blocos) {
      recusados.push({ indice: i, motivo: `passa do limite de ${L.blocos} blocos` });
      continue;
    }
    try {
      blocos.push(validarUm(entrada[i], opcoes));
    } catch (e) {
      if (e instanceof Recusa) recusados.push({ indice: i, motivo: e.message });
      else recusados.push({ indice: i, motivo: "bloco inválido" });
    }
  }
  return { blocos, recusados };
}

// ---------------------------------------------------------------------------
// Esquema JSON (saída estruturada da OpenAI, modo strict)
// ---------------------------------------------------------------------------
// Regras do modo strict: todo objeto com additionalProperties:false e TODAS
// as propriedades em `required`; o opcional vira tipo com null. A raiz é um
// objeto ({ blocos: [...] }) porque a raiz não pode ser anyOf.

const textoOuNulo = { type: ["string", "null"] } as const;

function objetoEstrito(properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) } as const;
}

function constante(valor: string) {
  return { type: "string", enum: [valor] } as const;
}

function enumOuNulo(valores: readonly string[]) {
  return { type: ["string", "null"], enum: [...valores, null] } as const;
}

const fontesOuNulo = { type: ["array", "null"], items: { type: "string" }, maxItems: L.fontes } as const;

const ESQUEMA_TEXTO = objetoEstrito({ tipo: constante("texto"), texto: { type: "string" } });

export const ESQUEMA_TABELA = objetoEstrito({
  tipo: constante("tabela"),
  titulo: textoOuNulo,
  colunas: { type: "array", items: { type: "string" }, minItems: 1, maxItems: L.colunas },
  linhas: {
    type: "array",
    minItems: 1,
    maxItems: L.linhas,
    items: { type: "array", maxItems: L.colunas, items: { type: ["string", "number", "null"] } },
  },
  fontes: fontesOuNulo,
});

const ESQUEMA_METRICAS = objetoEstrito({
  tipo: constante("metricas"),
  titulo: textoOuNulo,
  itens: {
    type: "array",
    minItems: 1,
    maxItems: L.metricas,
    items: objetoEstrito({
      rotulo: { type: "string" },
      valor: { type: ["number", "string"] },
      variacao: textoOuNulo,
      tom: enumOuNulo(TONS_DE_METRICA),
    }),
  },
  fontes: fontesOuNulo,
});

export const ESQUEMA_GRAFICO = objetoEstrito({
  tipo: constante("grafico"),
  titulo: textoOuNulo,
  tipo_grafico: { type: "string", enum: [...TIPOS_DE_GRAFICO] },
  series: {
    type: "array",
    minItems: 1,
    maxItems: L.series,
    items: objetoEstrito({
      nome: { type: "string" },
      pontos: {
        type: "array",
        minItems: 1,
        maxItems: L.pontos,
        items: objetoEstrito({ x: { type: "string" }, y: { type: "number" } }),
      },
    }),
  },
  unidade: textoOuNulo,
  fontes: fontesOuNulo,
});

export const ESQUEMA_FLUXO = objetoEstrito({
  tipo: constante("fluxo"),
  titulo: textoOuNulo,
  passos: {
    type: "array",
    minItems: 1,
    maxItems: L.passos,
    items: objetoEstrito({
      id: { type: "string" },
      rotulo: { type: "string" },
      detalhe: textoOuNulo,
      estado: enumOuNulo(ESTADOS_DE_ETAPA),
    }),
  },
  ligacoes: {
    type: ["array", "null"],
    maxItems: L.ligacoes,
    items: objetoEstrito({ de: { type: "string" }, para: { type: "string" }, rotulo: textoOuNulo }),
  },
  natureza: { type: "string", enum: [...NATUREZAS_DE_FLUXO] },
});

const ESQUEMA_ENTREGA = objetoEstrito({
  tipo: constante("entrega"),
  nome: { type: "string" },
  tipo_objeto: { type: "string" },
  objeto: {
    anyOf: [
      objetoEstrito({ tipo: { type: "string" }, id: { type: "string" }, titulo: textoOuNulo, client_id: textoOuNulo }),
      { type: "null" },
    ],
  },
  estado: { type: "string" },
  cliente: textoOuNulo,
  proxima: textoOuNulo,
});

const ESQUEMA_ARQUIVO = objetoEstrito({
  tipo: constante("arquivo"),
  nome: { type: "string" },
  mime: textoOuNulo,
  url: textoOuNulo,
  objeto: { anyOf: [objetoEstrito({ tipo: constante("arquivo"), id: { type: "string" } }), { type: "null" }] },
});

const ESQUEMA_PROGRESSO = objetoEstrito({
  tipo: constante("progresso"),
  titulo: { type: "string" },
  etapas: {
    type: "array",
    minItems: 1,
    maxItems: L.etapas,
    items: objetoEstrito({
      rotulo: { type: "string" },
      estado: { type: "string", enum: [...ESTADOS_DE_ETAPA] },
      quando: textoOuNulo,
      evidencia: textoOuNulo,
    }),
  },
});

/**
 * Esquema da resposta em blocos: `{ blocos: BlocoDeResposta[] }`. Para a
 * OpenAI: `response_format: { type: "json_schema", json_schema: { name:
 * "blocos_de_resposta", strict: true, schema: ESQUEMA_DOS_BLOCOS } }`. A saída
 * ainda passa por `validarBlocos` (limites de texto, https, fontes).
 */
export const ESQUEMA_DOS_BLOCOS = objetoEstrito({
  blocos: {
    type: "array",
    maxItems: L.blocos,
    items: {
      anyOf: [
        ESQUEMA_TEXTO,
        ESQUEMA_TABELA,
        ESQUEMA_METRICAS,
        ESQUEMA_GRAFICO,
        ESQUEMA_FLUXO,
        ESQUEMA_ENTREGA,
        ESQUEMA_ARQUIVO,
        ESQUEMA_PROGRESSO,
      ],
    },
  },
});

// ---------------------------------------------------------------------------
// Rótulos (os componentes e quem monta texto para o modelo usam os mesmos)
// ---------------------------------------------------------------------------

export const ROTULO_DO_ESTADO: Record<EstadoDeEtapa, string> = {
  planejado: "Planejado",
  em_execucao: "Em execução",
  aguardando_aprovacao: "Aguardando aprovação",
  bloqueado: "Bloqueado",
  concluido: "Concluído",
};
