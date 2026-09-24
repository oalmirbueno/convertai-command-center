import { useSyncExternalStore } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, modelosAtivos, nomeDoModelo, type ModeloIa, type ParteDaEstimativa, type Qualidade } from "@/lib/mesa/api";

/**
 * Modelos (personas sintéticas) da Mesa Foto: a ponte da tela com as ações
 * novas da função mesa-foto e as tabelas foto_modelos e foto_modelo_imagens
 * (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 6 e 8.2).
 *
 * Nomes de ação e de campo de entrada são os da função (modelos.ts); o teste
 * de contrato confere que cada campo mandado daqui é lido lá. Os
 * normalizadores das respostas aceitam campo faltando, nome parecido e forma
 * diferente (lista ou objeto). O que vai para o cache do TanStack é JSON puro.
 *
 * Regras duras da área: pessoa sintética, adulta (idade aparente mínima 21),
 * nunca parecida com pessoa real (referência do dono entra só como estilo,
 * pose, luz ou roupa), toda imagem marcada como gerada. "Qual é a mais real"
 * é decisão do dono; a conferência é só aviso.
 */

// ------------------------------------------------------------------ tipos

export type StatusDaPersona = "rascunho" | "candidatos" | "ancora" | "folha" | "pronta" | "arquivada";
export type PapelDaImagemDaPersona = "referencia_dono" | "candidata" | "ancora" | "vista" | "detalhe";
export type UsoDaReferencia = "estilo" | "pose" | "luz" | "roupa";
export type Resolucao = "1K" | "2K" | "4K";

export interface FichaDaPersona {
  idade_aparente: number | null;
  genero_apresentado: string;
  tom_de_pele: string;
  rosto: string;
  olhos: string;
  cabelo: string;
  marcas: string;
  corpo: string;
  estilo: string;
  notas: string;
}

export interface Persona {
  id: string;
  /** null: persona da agência (serve para qualquer cliente). */
  client_id: string | null;
  nome: string;
  ficha: FichaDaPersona;
  invariantes: string[];
  status: StatusDaPersona;
  ancora_imagem_id: string | null;
  motor_preferido_id: string | null;
  versao: number;
  etica_marcada: boolean;
  custo_usd: number;
  atualizado_em: string;
}

export interface PontoDaConferenciaDaPersona {
  criterio: string;
  ok: boolean | null;
  nota: string;
}

export interface ConferenciaDaPersona {
  /** O que a visão viu (pele, olhos, mãos, cabelo, luz...), em frases curtas. */
  observado: string[];
  /** Notas do Jev (0 a 1), só como aviso. */
  notas: { criterio: string; valor: number }[];
  pontos: PontoDaConferenciaDaPersona[];
  alertas: string[];
}

export interface ImagemDaPersona {
  id: string;
  modelo_id: string;
  papel: PapelDaImagemDaPersona;
  vista: string | null;
  uso_da_referencia: UsoDaReferencia | null;
  storage_bucket: string;
  storage_path: string;
  /** URL pronta (assinada) quando a função devolve só ela. */
  url: string;
  largura: number | null;
  altura: number | null;
  motor_id: string | null;
  resolucao: string | null;
  derivada_de: string | null;
  conferencia: ConferenciaDaPersona | null;
  aprovada: boolean | null;
  custo_usd: number;
  criado_em: string;
}

// ------------------------------------------------------------------ constantes

export const IDADE_MINIMA = 21;

export const STATUS_DA_PERSONA: Record<StatusDaPersona, { rotulo: string; cor: string }> = {
  rascunho: { rotulo: "Ficha", cor: "bg-muted text-muted-foreground" },
  candidatos: { rotulo: "Escolhendo", cor: "bg-primary/10 text-primary" },
  ancora: { rotulo: "Âncora escolhida", cor: "bg-primary/10 text-primary" },
  folha: { rotulo: "Folha em andamento", cor: "bg-primary/10 text-primary" },
  pronta: { rotulo: "Pronta", cor: "bg-success/15 text-success" },
  arquivada: { rotulo: "Arquivada", cor: "bg-muted text-muted-foreground" },
};

export const USOS_DA_REFERENCIA: { valor: UsoDaReferencia; rotulo: string }[] = [
  { valor: "estilo", rotulo: "Estilo" },
  { valor: "pose", rotulo: "Pose" },
  { valor: "luz", rotulo: "Luz" },
  { valor: "roupa", rotulo: "Roupa" },
];

export const GENEROS: { valor: string; rotulo: string }[] = [
  { valor: "feminino", rotulo: "Feminino" },
  { valor: "masculino", rotulo: "Masculino" },
  { valor: "neutro", rotulo: "Neutro" },
];

/** A folha da persona: 6 vistas, uma imagem por chamada (as mesmas da FOLHA_PADRAO da função). */
export const VISTAS_DA_FOLHA: { valor: string; rotulo: string }[] = [
  { valor: "frente", rotulo: "Frente" },
  { valor: "tres_quartos_esq", rotulo: "3/4 esquerda" },
  { valor: "tres_quartos_dir", rotulo: "3/4 direita" },
  { valor: "perfil_esq", rotulo: "Perfil" },
  { valor: "meio_corpo", rotulo: "Meio corpo" },
  { valor: "corpo_inteiro", rotulo: "Corpo inteiro" },
];

/** Vistas que a função aceita além da folha padrão. */
const OUTRAS_VISTAS: { valor: string; rotulo: string }[] = [
  { valor: "perfil_dir", rotulo: "Perfil direito" },
  { valor: "maos", rotulo: "Mãos" },
];

export const rotuloDaVista = (v?: string | null) =>
  (VISTAS_DA_FOLHA.concat(OUTRAS_VISTAS).find((x) => x.valor === v) || { rotulo: v ? String(v).replace(/_/g, " ") : "" }).rotulo;

/**
 * Os motores da rodada lado a lado (pesquisa de 2026-09-24). O id do catálogo
 * é achado pelo trecho do nome no OpenRouter; a ordem de "procura" é a
 * preferência (Sunburst antes de Flare). Resolução só onde o motor aceita.
 * Padrão e resolução iguais aos da RODADA_PADRAO da função (personas.ts): o
 * teste de contrato confere.
 */
export interface MotorDaRodada {
  chave: string;
  rotulo: string;
  procura: string[];
  resolucao: Resolucao | null;
  padrao: boolean;
}

export const MOTORES_DA_RODADA: MotorDaRodada[] = [
  { chave: "gpt-image-2.5", rotulo: "GPT Image 2.5", procura: ["gpt-image-2.5-sunburst", "gpt-image-2.5"], resolucao: null, padrao: true },
  { chave: "nano-banana-pro", rotulo: "Nano Banana Pro", procura: ["gemini-3-pro-image", "nano-banana-pro"], resolucao: "2K", padrao: true },
  { chave: "seedream-5-pro", rotulo: "Seedream 5.0 Pro", procura: ["seedream-5-0-pro", "seedream-5.0-pro"], resolucao: "2K", padrao: true },
  { chave: "mai-image-2.6", rotulo: "MAI-Image-2.6", procura: ["mai-image-2.6", "mai-image-2-6"], resolucao: null, padrao: true },
  { chave: "flux-2-max", rotulo: "FLUX.2 Max", procura: ["flux.2-max", "flux-2-max"], resolucao: null, padrao: false },
  { chave: "grok-imagine-2", rotulo: "Grok Imagine 2.0", procura: ["grok-imagine-image-2"], resolucao: "2K", padrao: false },
  { chave: "krea-2-large", rotulo: "Krea 2 Large", procura: ["krea-2-large"], resolucao: "1K", padrao: false },
  { chave: "nano-banana-2", rotulo: "Nano Banana 2", procura: ["gemini-3.1-flash-image", "nano-banana-2"], resolucao: "1K", padrao: false },
];

/** Motor que detalha em 4K (re-render, não ampliação fiel). */
export const MOTOR_DO_DETALHE = { rotulo: "Nano Banana Pro 4K", procura: ["gemini-3-pro-image", "nano-banana-pro"] };

const contem = (m: ModeloIa, trecho: string) => {
  const t = trecho.toLowerCase();
  return String(m.modelo_api || "").toLowerCase().indexOf(t) >= 0 || String(m.id || "").toLowerCase().indexOf(t) >= 0;
};

export function acharNoCatalogo(catalogo: ModeloIa[], procura: string[]): ModeloIa | null {
  const ativos = modelosAtivos(catalogo, "imagem");
  for (const p of procura) {
    const m = ativos.find((x) => contem(x, p));
    if (m) return m;
  }
  return null;
}

export interface OpcaoDeMotor {
  /** Id no catálogo (vai para a função como modelo_imagem_id). */
  id: string;
  rotulo: string;
  resolucao: Resolucao | null;
  padrao: boolean;
  /** Veio da lista da pesquisa (e não só do catálogo). */
  conhecido: boolean;
}

/**
 * Motores que a tela oferece: os da pesquisa que estão ativos no catálogo
 * (na ordem da pesquisa) e depois os outros geradores ativos. Os da pesquisa
 * que ainda não estão no catálogo voltam em "faltando", para a tela avisar.
 */
export function motoresDaRodada(catalogo: ModeloIa[]): { opcoes: OpcaoDeMotor[]; faltando: string[] } {
  const opcoes: OpcaoDeMotor[] = [];
  const faltando: string[] = [];
  MOTORES_DA_RODADA.forEach((d) => {
    const m = acharNoCatalogo(catalogo, d.procura);
    if (m && !opcoes.some((o) => o.id === m.id)) opcoes.push({ id: m.id, rotulo: d.rotulo, resolucao: d.resolucao, padrao: d.padrao, conhecido: true });
    else if (!m && d.padrao) faltando.push(d.rotulo);
  });
  modelosAtivos(catalogo, "imagem").forEach((m) => {
    if (!opcoes.some((o) => o.id === m.id)) opcoes.push({ id: m.id, rotulo: nomeDoModelo(m), resolucao: null, padrao: false, conhecido: false });
  });
  // Catálogo sem nenhum dos padrões: liga o primeiro gerador ativo, para a rodada não nascer vazia.
  if (opcoes.length && !opcoes.some((o) => o.padrao)) opcoes[0] = { ...opcoes[0], padrao: true };
  return { opcoes, faltando };
}

/** Nome curto do motor para a tela (rótulo da pesquisa, do catálogo ou o id). */
export function rotuloDoMotor(catalogo: ModeloIa[], id: string | null | undefined): string {
  if (!id) return "Motor";
  const conhecido = MOTORES_DA_RODADA.find((d) => {
    const m = catalogo.find((x) => x.id === id);
    return m ? d.procura.some((p) => contem(m, p)) : d.procura.some((p) => id.toLowerCase().indexOf(p) >= 0);
  });
  if (conhecido) return conhecido.rotulo;
  const m = catalogo.find((x) => x.id === id);
  return m ? nomeDoModelo(m) : id.split("/").pop() || id;
}

/** Pedido de semelhança com pessoa real ("parecido com", "sósia", "idêntica a"): recusado já na tela. */
const PEDIDOS_DE_SEMELHANCA = [/parecid[oa]s? com/i, /s[oó]sia/i, /look ?alike/i, /id[eê]ntic[oa]s? (a|ao|à) /i];

export function pedeSemelhanca(texto: string): boolean {
  const t = String(texto || "");
  return PEDIDOS_DE_SEMELHANCA.some((re) => re.test(t));
}

export interface RascunhoDaPersona {
  nome: string;
  ficha: FichaDaPersona;
  invariantes: string;
  daAgencia: boolean;
  etica: boolean;
  referencias: { imagem_id: string; uso: UsoDaReferencia }[];
}

export const fichaVazia = (): FichaDaPersona => ({
  idade_aparente: 28,
  genero_apresentado: "feminino",
  tom_de_pele: "",
  rosto: "",
  olhos: "",
  cabelo: "",
  marcas: "",
  corpo: "",
  estilo: "",
  notas: "",
});

export const rascunhoVazio = (): RascunhoDaPersona => ({ nome: "", ficha: fichaVazia(), invariantes: "", daAgencia: false, etica: false, referencias: [] });

/** O que impede de criar a persona (lista vazia: pode criar). */
export function problemasDaPersona(r: RascunhoDaPersona): string[] {
  const p: string[] = [];
  if (!r.nome.trim()) p.push("Dê um nome fictício.");
  const idade = r.ficha.idade_aparente;
  if (idade === null || !isFinite(idade)) p.push("Informe a idade aparente.");
  else if (idade < IDADE_MINIMA) p.push(`Idade aparente mínima: ${IDADE_MINIMA} anos.`);
  const textos = [r.nome, r.ficha.rosto, r.ficha.estilo, r.ficha.notas, r.ficha.cabelo, r.invariantes].join(" ");
  if (pedeSemelhanca(textos)) p.push("Não peça semelhança com pessoa real. Descreva traços, sem citar ninguém.");
  if (!r.etica) p.push("Confirme a declaração: pessoa sintética, adulta e sem semelhança com pessoa real.");
  return p;
}

// ------------------------------------------------------------------ normalizadores

const texto = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const textoOuNulo = (v: unknown): string | null => {
  const t = texto(v).trim();
  return t ? t : null;
};
const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};
const booleanoOuNulo = (v: unknown): boolean | null => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);

export function listaDeTextos(v: unknown): string[] {
  if (Array.isArray(v)) {
    const saida: string[] = [];
    v.forEach((x) => {
      const t = typeof x === "string" ? x : x && typeof x === "object" ? texto((x as any).texto || (x as any).nome || (x as any).valor) : texto(x);
      if (t.trim()) saida.push(t.trim());
    });
    return saida;
  }
  if (typeof v === "string" && v.trim()) return v.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  return [];
}

/** Campo da ficha que pode vir como texto, lista ou objeto ({ cor, comprimento, textura }). */
function campoDaFicha(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return listaDeTextos(v).join(", ");
  if (v && typeof v === "object") {
    return Object.keys(v as any)
      .map((k) => texto((v as any)[k]))
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

export function normalizarFicha(v: any): FichaDaPersona {
  const f = v && typeof v === "object" ? v : {};
  return {
    idade_aparente: numeroOuNulo(f.idade_aparente ?? f.idade),
    genero_apresentado: texto(f.genero_apresentado || f.genero),
    tom_de_pele: campoDaFicha(f.tom_de_pele),
    rosto: campoDaFicha(f.rosto || f.tracos),
    olhos: campoDaFicha(f.olhos),
    cabelo: campoDaFicha(f.cabelo),
    marcas: campoDaFicha(f.marcas),
    corpo: campoDaFicha(f.corpo),
    estilo: campoDaFicha(f.estilo),
    notas: campoDaFicha(f.notas),
  };
}

const STATUS_VALIDOS = Object.keys(STATUS_DA_PERSONA) as StatusDaPersona[];

export function normalizarPersona(v: any): Persona | null {
  if (!v || typeof v !== "object" || !v.id) return null;
  const status = texto(v.status) as StatusDaPersona;
  const etica = v.etica && typeof v.etica === "object" ? v.etica : null;
  return {
    id: String(v.id),
    client_id: textoOuNulo(v.client_id),
    nome: texto(v.nome) || "Persona sem nome",
    ficha: normalizarFicha(v.ficha),
    invariantes: listaDeTextos(v.invariantes),
    status: STATUS_VALIDOS.indexOf(status) >= 0 ? status : "rascunho",
    ancora_imagem_id: textoOuNulo(v.ancora_imagem_id),
    motor_preferido_id: textoOuNulo(v.motor_preferido_id),
    versao: numeroOuNulo(v.versao) || 1,
    etica_marcada: !!(etica && (etica.sintetica === true || etica.marcado_em)),
    custo_usd: numeroOuNulo(v.custo_usd) || 0,
    atualizado_em: texto(v.atualizado_em || v.criado_em),
  };
}

const PAPEIS_VALIDOS: PapelDaImagemDaPersona[] = ["referencia_dono", "candidata", "ancora", "vista", "detalhe"];
const USOS_VALIDOS = USOS_DA_REFERENCIA.map((u) => u.valor);

/**
 * Escala de cada Score do Jev na função (0 até o último nível de NIVEIS_PELE,
 * NIVEIS_ANATOMIA e NIVEIS_LUZ): na tela a nota vira 0 a 1. Noul já é 0 a 1.
 */
const ESCALA_DAS_NOTAS: Record<string, number> = { realismo_pele: 3, anatomia: 2, luz: 2 };

/** Ordem e nome do que a visão leu (leitura da persona em modelo_conferir; pele e resumo no Canvas). */
const CAMPOS_DA_LEITURA: { campo: string; rotulo: string }[] = [
  { campo: "resumo", rotulo: "" },
  { campo: "pele", rotulo: "pele" },
  { campo: "olhos", rotulo: "olhos" },
  { campo: "maos", rotulo: "mãos" },
  { campo: "cabelo", rotulo: "cabelo" },
  { campo: "dentes", rotulo: "dentes" },
  { campo: "luz", rotulo: "luz" },
  { campo: "fundo", rotulo: "fundo" },
  { campo: "artefatos", rotulo: "artefatos" },
  { campo: "lembra_alguem", rotulo: "lembra alguém" },
  { campo: "consistencia_com_ancora", rotulo: "comparada à âncora" },
  { campo: "idade_aparente_estimada", rotulo: "idade aparente estimada" },
];

function lidoDaLeitura(fonte: any, observado: string[]) {
  if (!fonte || typeof fonte !== "object" || Array.isArray(fonte)) return;
  CAMPOS_DA_LEITURA.forEach(({ campo, rotulo }) => {
    const t = campoDaFicha(fonte[campo]).trim();
    if (!t) return;
    const linha = rotulo ? `${rotulo}: ${t}` : t;
    if (observado.indexOf(linha) < 0) observado.push(linha);
  });
}

function notasDoJev(brutas: any, notas: { criterio: string; valor: number }[]) {
  if (Array.isArray(brutas)) {
    // Forma já normalizada (guardada no resultado do Canvas): [{ criterio, valor }].
    brutas.forEach((b: any) => {
      const n = b && typeof b === "object" ? numeroOuNulo(b.valor) : null;
      if (n !== null && texto(b.criterio)) notas.push({ criterio: texto(b.criterio), valor: n });
    });
    return;
  }
  if (!brutas || typeof brutas !== "object") return;
  Object.keys(brutas).forEach((k) => {
    const bruto = brutas[k] && typeof brutas[k] === "object" ? brutas[k].valor ?? brutas[k].nota : brutas[k];
    // Só número: o Jev do Canvas também manda aviso (sim ou não) e erro (texto).
    if (typeof bruto !== "number" && typeof bruto !== "string") return;
    const n = numeroOuNulo(bruto);
    if (n === null) return;
    const escala = ESCALA_DAS_NOTAS[k];
    notas.push({ criterio: k.replace(/_/g, " "), valor: escala ? Math.max(0, Math.min(1, n / escala)) : n });
  });
}

export function normalizarConferenciaDaPersona(v: any): ConferenciaDaPersona | null {
  if (!v || typeof v !== "object") return null;
  const c = v.conferencia && typeof v.conferencia === "object" ? v.conferencia : v;
  const observado: string[] = [];
  const obs = c.observado;
  if (obs && typeof obs === "object" && !Array.isArray(obs)) {
    Object.keys(obs).forEach((k) => {
      const t = campoDaFicha(obs[k]);
      if (t) observado.push(`${k.replace(/_/g, " ")}: ${t}`);
    });
  } else listaDeTextos(obs).forEach((t) => observado.push(t));
  // Forma da função: { leitura: { pele, olhos, maos... } } na persona; resumo, pele e lembra_alguem soltos no Canvas.
  lidoDaLeitura(c.leitura, observado);
  lidoDaLeitura({ resumo: c.resumo, pele: c.pele, lembra_alguem: c.lembra_alguem }, observado);
  const notas: { criterio: string; valor: number }[] = [];
  const realismo = typeof c.nota_realismo === "number" || typeof c.nota_realismo === "string" ? numeroOuNulo(c.nota_realismo) : null;
  if (realismo !== null) notas.push({ criterio: "realismo", valor: realismo });
  notasDoJev(c.notas_jev || c.notas, notas);
  notasDoJev(c.jev, notas);
  const pontos: PontoDaConferenciaDaPersona[] = [];
  if (Array.isArray(c.pontos)) {
    c.pontos.forEach((p: any) => {
      if (p && typeof p === "object" && texto(p.criterio)) pontos.push({ criterio: texto(p.criterio), ok: booleanoOuNulo(p.ok), nota: texto(p.nota) });
    });
  }
  const alertas = listaDeTextos(c.alertas);
  if (!observado.length && !notas.length && !pontos.length && !alertas.length) return null;
  return { observado, notas, pontos, alertas };
}

export function normalizarImagemDaPersona(v: any, modeloId = ""): ImagemDaPersona | null {
  if (!v || typeof v !== "object" || !v.id) return null;
  const papel = texto(v.papel) as PapelDaImagemDaPersona;
  const uso = texto(v.uso_da_referencia || v.uso) as UsoDaReferencia;
  return {
    id: String(v.id),
    modelo_id: texto(v.modelo_id) || modeloId,
    papel: PAPEIS_VALIDOS.indexOf(papel) >= 0 ? papel : "candidata",
    vista: textoOuNulo(v.vista),
    uso_da_referencia: USOS_VALIDOS.indexOf(uso) >= 0 ? uso : null,
    storage_bucket: texto(v.storage_bucket) || "mesa",
    storage_path: texto(v.storage_path),
    url: texto(v.url || v.signed_url),
    largura: numeroOuNulo(v.largura),
    altura: numeroOuNulo(v.altura),
    motor_id: textoOuNulo(v.motor_id || v.modelo_imagem_id),
    resolucao: textoOuNulo(v.resolucao),
    derivada_de: textoOuNulo(v.derivada_de),
    conferencia: normalizarConferenciaDaPersona(v.conferencia),
    aprovada: booleanoOuNulo(v.aprovada),
    custo_usd: numeroOuNulo(v.custo_usd) || 0,
    criado_em: texto(v.criado_em),
  };
}

/** Caminho para mostrar a imagem: o do Storage ou, sem ele, a URL pronta. */
export const caminhoDaImagem = (i: Pick<ImagemDaPersona, "storage_path" | "url">) => i.storage_path || i.url || "";

export const proporcaoDaImagem = (i: Pick<ImagemDaPersona, "largura" | "altura"> | null | undefined) =>
  i && i.largura && i.altura && i.largura > 0 && i.altura > 0 ? i.largura / i.altura : 0.8;

/** A imagem da resposta, em qualquer das formas combinadas ({ imagem }, { imagens: [..] } ou a própria). */
export function imagemDaResposta(data: any, modeloId = ""): ImagemDaPersona | null {
  if (!data || typeof data !== "object") return null;
  const bruta = data.imagem || (Array.isArray(data.imagens) ? data.imagens[0] : null) || (data.id && data.storage_path ? data : null);
  const img = normalizarImagemDaPersona(bruta, modeloId);
  if (img && !img.url && texto(data.url)) img.url = texto(data.url);
  return img;
}

// ------------------------------------------------------------------ leituras

export const chaveDasPersonas = (clientId: string) => ["mesa-foto", "personas", clientId];
export const chaveDasImagensDaPersona = (modeloId: string) => ["mesa-foto", "persona-imagens", modeloId];

function erroDeTabela(error: any, tabela: string): Error {
  const msg = String((error && error.message) || "");
  const codigo = String((error && error.code) || "");
  if (codigo === "42P01" || codigo === "PGRST205" || msg.indexOf("does not exist") >= 0 || msg.indexOf("Could not find the table") >= 0) {
    return new Error(`O banco dos Modelos ainda não foi publicado (tabela ${tabela}). As outras etapas seguem funcionando.`);
  }
  return error instanceof Error ? error : new Error(msg || "Não foi possível ler o banco.");
}

/** Personas do cliente e as da agência (client_id nulo), sem as arquivadas no fim da lista. */
export function usePersonas(clientId: string, ativo = true) {
  return useQuery({
    queryKey: chaveDasPersonas(clientId),
    enabled: ativo && !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<Persona[]> => {
      const { data, error } = await (supabase as any)
        .from("foto_modelos")
        .select("*")
        .or(`client_id.is.null,client_id.eq.${clientId}`)
        .order("atualizado_em", { ascending: false })
        .limit(200);
      if (error) throw erroDeTabela(error, "foto_modelos");
      const saida: Persona[] = [];
      for (const b of (data || []) as any[]) {
        const p = normalizarPersona(b);
        if (p) saida.push(p);
      }
      return saida;
    },
  });
}

export function useImagensDaPersona(modeloId: string | null) {
  return useQuery({
    queryKey: chaveDasImagensDaPersona(modeloId || ""),
    enabled: !!modeloId,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<ImagemDaPersona[]> => {
      const { data, error } = await (supabase as any)
        .from("foto_modelo_imagens")
        .select("*")
        .eq("modelo_id", modeloId)
        .order("criado_em", { ascending: true })
        .limit(400);
      if (error) throw erroDeTabela(error, "foto_modelo_imagens");
      const saida: ImagemDaPersona[] = [];
      for (const b of (data || []) as any[]) {
        const i = normalizarImagemDaPersona(b, String(modeloId));
        if (i) saida.push(i);
      }
      return saida;
    },
  });
}

/** Põe uma imagem nova (ou trocada) no cache da persona, antes da releitura. */
export function guardarImagemDaPersona(queryClient: QueryClient, img: ImagemDaPersona) {
  queryClient.setQueryData<ImagemDaPersona[]>(chaveDasImagensDaPersona(img.modelo_id), (lista) => {
    const atual = lista || [];
    return atual.some((i) => i.id === img.id) ? atual.map((i) => (i.id === img.id ? img : i)) : atual.concat([img]);
  });
}

export function guardarPersona(queryClient: QueryClient, clientId: string, p: Persona) {
  queryClient.setQueryData<Persona[]>(chaveDasPersonas(clientId), (lista) => {
    const atual = lista || [];
    return atual.some((x) => x.id === p.id) ? atual.map((x) => (x.id === p.id ? p : x)) : [p].concat(atual);
  });
}

// ------------------------------------------------------------------ utilidades

export interface ResumoDaPersona {
  candidatas: ImagemDaPersona[];
  ancora: ImagemDaPersona | null;
  /** Última imagem de cada vista da folha (a mais nova). */
  vistas: Record<string, ImagemDaPersona | null>;
  vistasProntas: number;
  detalhes: ImagemDaPersona[];
  referencias: ImagemDaPersona[];
}

export function resumoDaPersona(p: Persona | null, imagens: ImagemDaPersona[]): ResumoDaPersona {
  const ancora = p && p.ancora_imagem_id ? imagens.find((i) => i.id === p.ancora_imagem_id) || null : imagens.filter((i) => i.papel === "ancora").pop() || null;
  const vistas: Record<string, ImagemDaPersona | null> = {};
  VISTAS_DA_FOLHA.forEach((v) => {
    const daVista = imagens.filter((i) => i.papel === "vista" && i.vista === v.valor && i.aprovada !== false);
    vistas[v.valor] = daVista.length ? daVista[daVista.length - 1] : null;
  });
  return {
    candidatas: imagens.filter((i) => i.papel === "candidata" || (i.papel === "ancora" && !i.vista)),
    ancora,
    vistas,
    vistasProntas: VISTAS_DA_FOLHA.filter((v) => !!vistas[v.valor]).length,
    detalhes: imagens.filter((i) => i.papel === "detalhe"),
    referencias: imagens.filter((i) => i.papel === "referencia_dono"),
  };
}

/** Candidatas agrupadas por motor, na ordem dos motores da tela (os de fora vão para o fim). */
export function candidatasPorMotor(candidatas: ImagemDaPersona[], ordem: string[]): { motor_id: string; imagens: ImagemDaPersona[] }[] {
  const grupos: { motor_id: string; imagens: ImagemDaPersona[] }[] = [];
  candidatas.forEach((c) => {
    const id = c.motor_id || "sem-motor";
    let g = grupos.find((x) => x.motor_id === id);
    if (!g) {
      g = { motor_id: id, imagens: [] };
      grupos.push(g);
    }
    g.imagens.push(c);
  });
  const pos = (id: string) => {
    const i = ordem.indexOf(id);
    return i < 0 ? 999 : i;
  };
  return grupos.sort((a, b) => pos(a.motor_id) - pos(b.motor_id));
}

/** Letra da comparação às cegas (A, B, C...). */
export const letraDoMotor = (i: number) => String.fromCharCode(65 + (i % 26));

// ------------------------------------------------------------------ estimativas

export const TAMANHOS_DA_PERSONA = { entradaPorReferencia: 1600, prompt: 2500, conferir: { entrada: 5000, saida: 900 } };

/** Uma imagem por motor ligado (a rodada é uma chamada por motor). */
export function partesDaRodada(motores: string[], qualidade: Qualidade, referencias = 0): ParteDaEstimativa[] {
  return motores.map((id) => ({
    modeloId: id,
    tipo: "imagem" as const,
    imagens: 1,
    qualidade,
    tokensEntrada: TAMANHOS_DA_PERSONA.prompt + referencias * TAMANHOS_DA_PERSONA.entradaPorReferencia,
  }));
}

export function partesDaVista(motorId: string | null, qualidade: Qualidade, referencias: number, vezes = 1): ParteDaEstimativa[] {
  return [{ modeloId: motorId, tipo: "imagem", imagens: 1, qualidade, tokensEntrada: TAMANHOS_DA_PERSONA.prompt + referencias * TAMANHOS_DA_PERSONA.entradaPorReferencia, vezes }];
}

export function partesDaConferenciaDaPersona(leitura: ModeloIa | null): ParteDaEstimativa[] {
  return [{ modeloId: leitura ? leitura.id : null, tipo: "texto", tokensEntrada: TAMANHOS_DA_PERSONA.conferir.entrada, tokensSaida: TAMANHOS_DA_PERSONA.conferir.saida }];
}

/**
 * Estimativa pela função (ação estimar com os alvos novos: preço por variante
 * de resolução, que o catálogo local ainda não tem). Sem resposta, null: a
 * tela fica com a conta local.
 */
export async function estimarNoServidor(clientId: string, alvo: string, extras: Record<string, unknown>): Promise<number | null> {
  try {
    const data = await chamarFuncao<any>("mesa-foto", { acao: "estimar", client_id: clientId, acao_alvo: alvo, ...extras });
    return numeroOuNulo(data && (data.estimativa_usd ?? data.total_usd));
  } catch {
    return null;
  }
}

/** Preço por motor que a função calcula (resolução certa); null enquanto não chega. */
export function usePrecoNoServidor(clientId: string, alvo: string, extras: Record<string, unknown>, ativo = true) {
  return useQuery({
    queryKey: ["mesa-foto", "estimar", clientId, alvo, JSON.stringify(extras)],
    enabled: ativo && !!clientId,
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => estimarNoServidor(clientId, alvo, extras),
  });
}

// ------------------------------------------------------------------ ações

/**
 * Cabelo da tela (um texto só) na forma da ficha da função ({ cor,
 * comprimento, textura }, 80 letras cada): as partes separadas por vírgula
 * vão na ordem, e o prompt junta de novo com vírgula.
 */
export function cabeloDaFicha(texto: string): { cor: string; comprimento: string; textura: string } {
  const partes = String(texto || "").split(",").map((x) => x.trim()).filter(Boolean);
  return { cor: partes[0] || "", comprimento: partes[1] || "", textura: partes.slice(2).join(", ") };
}

/** Corpo de modelo_criar, com os campos que a função lê (modelos.ts, modeloCriar). */
export function corpoDaPersona(clientId: string, r: RascunhoDaPersona) {
  const ficha = r.ficha;
  return {
    client_id: clientId,
    nome: r.nome.trim(),
    ficha: {
      idade_aparente: ficha.idade_aparente,
      genero_apresentado: ficha.genero_apresentado || "",
      tom_de_pele: ficha.tom_de_pele.trim(),
      rosto: ficha.rosto.trim(),
      olhos: ficha.olhos.trim(),
      cabelo: cabeloDaFicha(ficha.cabelo),
      marcas: listaDeTextos(ficha.marcas.split(",").join("\n")),
      corpo: ficha.corpo.trim(),
      estilo: ficha.estilo.trim(),
      notas: ficha.notas.trim(),
    },
    invariantes: listaDeTextos(r.invariantes),
    // Referência do dono entra só como estilo, pose, luz ou roupa (nunca identidade).
    referencias: r.referencias.map((x) => ({ imagem_id: x.imagem_id, uso: x.uso })),
    escopo: r.daAgencia ? "agencia" : "cliente",
    // Declaração ética: sintética, adulta e sem semelhança com pessoa real (a função recusa sem ela).
    etica_confirmada: r.etica === true,
  };
}

export async function criarPersona(clientId: string, r: RascunhoDaPersona): Promise<Persona | null> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "modelo_criar", ...corpoDaPersona(clientId, r) });
  return normalizarPersona(data && (data.modelo || data.persona));
}

/**
 * Id da rodada (as candidatas da mesma rodada ficam juntas no banco). UUID v4
 * feito aqui: crypto.randomUUID não existe no Safari 11.
 */
export function novoIdDeRodada(): string {
  const hex: string[] = [];
  const bytes: number[] = [];
  const c = typeof window !== "undefined" ? (window as any).crypto : null;
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    for (let i = 0; i < 16; i++) bytes.push(b[i]);
  } else {
    for (let i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256));
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  bytes.forEach((b) => hex.push((b + 0x100).toString(16).slice(1)));
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Corpo de modelo_candidata_gerar (modelos.ts, modeloCandidataGerar): UMA candidata por gerador. */
export function corpoDaCandidata(p: {
  clientId: string;
  modeloId: string;
  motorId: string;
  resolucao: Resolucao | null;
  qualidade: Qualidade;
  pedido?: string;
  rodadaId?: string | null;
}): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "modelo_candidata_gerar", client_id: p.clientId, modelo_id: p.modeloId, modelo_imagem_id: p.motorId, qualidade: p.qualidade };
  if (p.resolucao) corpo.resolucao = p.resolucao;
  if (p.pedido && p.pedido.trim()) corpo.pedido = p.pedido.trim();
  if (p.rodadaId) corpo.rodada_id = p.rodadaId;
  return corpo;
}

export async function gerarCandidata(p: {
  clientId: string;
  modeloId: string;
  motorId: string;
  resolucao: Resolucao | null;
  qualidade: Qualidade;
  pedido?: string;
  rodadaId?: string | null;
}): Promise<{ imagem: ImagemDaPersona | null; rodada_id: string | null; custo_usd?: number; saldo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", corpoDaCandidata(p));
  const bruta = data && data.imagem && typeof data.imagem === "object" ? data.imagem : null;
  return {
    imagem: imagemDaResposta(data, p.modeloId),
    rodada_id: textoOuNulo(data && (data.rodada_id || (bruta && bruta.rodada_id))) || p.rodadaId || null,
    custo_usd: data && data.custo_usd,
    saldo_usd: data && data.saldo_usd,
  };
}

/** Âncora (modelos.ts, modeloAncoraEscolher): o acesso vem da persona, sem client_id. */
export async function escolherAncora(modeloId: string, imagemId: string): Promise<{ persona: Persona | null; imagem: ImagemDaPersona | null }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "modelo_ancora_escolher", modelo_id: modeloId, imagem_id: imagemId });
  return { persona: normalizarPersona(data && (data.modelo || data.persona)), imagem: imagemDaResposta(data, modeloId) };
}

/**
 * Vista da folha (modelos.ts, modeloVistaGerar). O gerador é sempre o da
 * âncora (a função recusa outro com motor_da_ancora): a tela não manda motor.
 */
export async function gerarVista(p: { clientId: string; modeloId: string; vista: string; qualidade: Qualidade }): Promise<{ imagem: ImagemDaPersona | null; persona: Persona | null; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "modelo_vista_gerar", client_id: p.clientId, modelo_id: p.modeloId, vista: p.vista, qualidade: p.qualidade };
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { imagem: imagemDaResposta(data, p.modeloId), persona: normalizarPersona(data && data.modelo), custo_usd: data && data.custo_usd };
}

/**
 * Detalhar em 4K (modelos.ts, modeloDetalhar): geração nova derivada da
 * imagem escolhida. Sem gerador escolhido, a função usa o padrão do alvo
 * (Nano Banana Pro para pessoa); gerador sem 4K é recusado lá.
 */
export async function detalharImagem(p: { clientId: string; modeloId: string; imagemId: string; motorId?: string | null }): Promise<{ imagem: ImagemDaPersona | null; antes: string | null; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "modelo_detalhar", client_id: p.clientId, modelo_id: p.modeloId, imagem_id: p.imagemId, alvo: "pessoa" };
  if (p.motorId) corpo.modelo_imagem_id = p.motorId;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const imagem = imagemDaResposta(data, p.modeloId);
  const antes = data && data.antes && typeof data.antes === "object" ? textoOuNulo(data.antes.imagem_id) : null;
  if (imagem && !imagem.derivada_de && antes) imagem.derivada_de = antes;
  if (imagem && !imagem.url && data && data.depois && typeof data.depois === "object") imagem.url = texto(data.depois.url);
  return { imagem, antes, custo_usd: data && data.custo_usd };
}

/** Aprovar ou rejeitar uma imagem da persona (vista da folha): 3 vistas aprovadas deixam a persona pronta. */
export async function decidirImagemDaPersona(imagemId: string, decisao: "aprovar" | "rejeitar", motivo?: string): Promise<{ imagem: ImagemDaPersona | null; persona: Persona | null }> {
  const corpo: Record<string, unknown> = { acao: "modelo_imagem_decidir", imagem_id: imagemId, decisao };
  if (motivo && motivo.trim()) corpo.motivo = motivo.trim();
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { imagem: imagemDaResposta(data), persona: normalizarPersona(data && data.modelo) };
}

/** Extras da estimativa de uma candidata (estimar, acao_alvo modelo_candidata). */
export const extrasDaEstimativaDaCandidata = (motorId: string, resolucao: Resolucao | null, qualidade: Qualidade, modeloId?: string | null): Record<string, unknown> => {
  const e: Record<string, unknown> = { modelo_imagem_id: motorId, qualidade };
  if (resolucao) e.resolucao = resolucao;
  if (modeloId) e.modelo_id = modeloId;
  return e;
};

/** Extras da estimativa do 4K (estimar, acao_alvo modelo_detalhar). */
export const extrasDaEstimativaDoDetalhe = (motorId: string | null): Record<string, unknown> => (motorId ? { alvo: "pessoa", modelo_imagem_id: motorId } : { alvo: "pessoa" });

export async function conferirImagemDaPersona(clientId: string, modeloId: string, imagemId: string): Promise<{ conferencia: ConferenciaDaPersona | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "modelo_conferir", client_id: clientId, modelo_id: modeloId, imagem_id: imagemId });
  return { conferencia: normalizarConferenciaDaPersona(data), custo_usd: data && data.custo_usd };
}

/**
 * Roda uma chamada por motor, no máximo `aoMesmoTempo` juntas. Falha de um
 * motor não derruba os outros: cada um avisa o próprio fim.
 */
export async function emParalelo<T>(itens: T[], aoMesmoTempo: number, fazer: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      try {
        await fazer(itens[i]);
      } catch {
        /* cada item trata o próprio erro */
      }
    }
  };
  const n = Math.max(1, Math.min(aoMesmoTempo, itens.length));
  const lista: Promise<void>[] = [];
  for (let i = 0; i < n; i++) lista.push(trabalhador());
  await Promise.all(lista);
}

/** As âncoras das personas da galeria, numa ida só ao banco. */
export function useAncoras(ids: string[]) {
  const lista = ids.filter(Boolean).slice().sort();
  return useQuery({
    queryKey: ["mesa-foto", "persona-ancoras", lista.join(",")],
    enabled: lista.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<ImagemDaPersona[]> => {
      const { data, error } = await (supabase as any).from("foto_modelo_imagens").select("*").in("id", lista);
      if (error) throw erroDeTabela(error, "foto_modelo_imagens");
      const saida: ImagemDaPersona[] = [];
      for (const b of (data || []) as any[]) {
        const i = normalizarImagemDaPersona(b);
        if (i) saida.push(i);
      }
      return saida;
    },
  });
}

// ------------------------------------------------------------------ andamento fora da tela

/**
 * Andamento das gerações (um por motor, por vista ou por Saída do Canvas).
 * Vive neste módulo, fora da tela: dá para trocar de aba e voltar, que a
 * geração segue e a tela reencontra o estado. O que fica pronto já está
 * gravado pela função.
 */
export interface Andamento {
  estado: "gerando" | "falhou";
  erro: string;
}

let andamentos: Record<string, Andamento> = {};
const ouvintes: (() => void)[] = [];

function inscrever(f: () => void) {
  ouvintes.push(f);
  return () => {
    const i = ouvintes.indexOf(f);
    if (i >= 0) ouvintes.splice(i, 1);
  };
}

export const chaveDoAndamento = (...partes: string[]) => partes.join("|");

export function marcarAndamento(chave: string, a: Andamento | null) {
  const copia: Record<string, Andamento> = {};
  Object.keys(andamentos).forEach((k) => {
    if (k !== chave) copia[k] = andamentos[k];
  });
  if (a) copia[chave] = a;
  andamentos = copia;
  ouvintes.slice().forEach((f) => f());
}

export function esquecerAndamentos() {
  andamentos = {};
  ouvintes.slice().forEach((f) => f());
}

export function useAndamentos(): Record<string, Andamento> {
  return useSyncExternalStore(inscrever, () => andamentos, () => andamentos);
}

/** Pedido guardado para o Canvas abrir já com a persona ("Usar no Canvas"). */
export const chaveDoPedidoAoCanvas = (clientId: string) => `mesa-foto:canvas:pedido:${clientId}`;

export function pedirAoCanvas(clientId: string, modeloId: string) {
  try {
    window.sessionStorage.setItem(chaveDoPedidoAoCanvas(clientId), JSON.stringify({ modelo_id: modeloId, em: Date.now() }));
  } catch {
    /* sem armazenamento: o dono escolhe a persona no cartão */
  }
}

export function lerPedidoAoCanvas(clientId: string): string | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(chaveDoPedidoAoCanvas(clientId)) || "null");
    window.sessionStorage.removeItem(chaveDoPedidoAoCanvas(clientId));
    return v && typeof v.modelo_id === "string" && Date.now() - Number(v.em || 0) < 10 * 60_000 ? v.modelo_id : null;
  } catch {
    return null;
  }
}
