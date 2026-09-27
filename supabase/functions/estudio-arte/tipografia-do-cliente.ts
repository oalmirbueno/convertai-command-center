/**
 * Tipografia do cliente na geração (frente T2, 26/09/2026).
 *
 * Pedido do dono: "tem que seguir a tipografia correta de cada cliente, e cada
 * cliente sem misturar, e não inventar, e seguir a consistência das fontes no
 * carrossel."
 *
 * Regras, em código (puro, testado em src/test/tipografia-do-cliente.test.ts):
 * - A fonte vem SEMPRE do kit do trabalho: cliente_fontes do client_id do
 *   trabalho, filtradas pela marca dele (fontesDaMarca, _shared/marca.ts).
 *   Nada da biblioteca global entra sem estar gravado no kit do cliente, e a
 *   amostra só vale se estiver na pasta do cliente ou na da biblioteca.
 * - Kit sem fonte: não gera (409 sem_tipografia). Nem a letra da referência,
 *   nem uma "parecida", nem a citada em documento sem estar no kit.
 * - Amostra anexada com papel nomeado ("TIPOGRAFIA DO CLIENTE"): o gerador
 *   copia letra de imagem muito melhor que de nome. Título e texto (quando a
 *   família do texto é outra), cada uma com teto de uma imagem.
 * - Prioridade no limite de imagens: lâmina > rosto > TIPOGRAFIA > referência
 *   automática > estilo e template. A referência automática cede primeiro; a
 *   amostra do texto e depois a do título cedem ao rosto (tipografiaQueCede).
 * - Série: família, peso e caixa fixos por papel (título, apoio, CTA) em todas
 *   as lâminas. A primeira lâmina gerada (a capa, de preferência) vira a
 *   âncora tipográfica: a versão guarda o registro (registroDaLamina) e as
 *   lâminas 2+ repetem peso e caixa dela; com a capa anexada, o bloco cita a
 *   imagem dela. A âncora só vale com a mesma chave (cliente, marca e fontes):
 *   trabalho que mudou de marca ou de fonte não herda a letra antiga.
 *
 * Sem travessão nos textos.
 */

export type FonteDoKit = {
  id?: string | null;
  nome: string;
  papel: string;
  amostra_path?: string | null;
  marca_id?: string | null;
};

export type TipografiaDoKit = {
  titulo: FonteDoKit;
  texto: FonteDoKit;
  /** Lista para o prompt (marca.fontes): a do kit, com título e texto sempre presentes. */
  fontes: { nome: string; papel: string }[];
};

export const SEM_TIPOGRAFIA = {
  status: 409,
  codigo: "sem_tipografia",
  mensagem: "Defina a tipografia do cliente antes de gerar: use Sugerir da biblioteca no Estúdio ou defina a fonte no Contexto, em Fontes.",
} as const;

/** Lâmina 2+ pedida junto com a capa: espera a capa (âncora tipográfica) na fila. */
export const CAPA_PENDENTE = {
  status: 409,
  codigo: "capa_pendente",
  mensagem: "A capa ainda está sendo gerada. Esta lâmina espera por ela para seguir a mesma tipografia.",
} as const;

const limpo = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function validas(fontes: FonteDoKit[] | null | undefined): FonteDoKit[] {
  return (Array.isArray(fontes) ? fontes : []).filter((f) => !!f && limpo(f.nome) !== "");
}

/**
 * Título e texto do kit. Título: a fonte de título, senão a de destaque,
 * senão a de texto. Texto: a de texto, senão a do título. Kit sem nenhuma
 * fonte com nome: null (a geração é recusada).
 */
export function tipografiaDoKit(fontes: FonteDoKit[] | null | undefined): TipografiaDoKit | null {
  const lista = validas(fontes);
  if (!lista.length) return null;
  const doPapel = (p: string) => lista.find((f) => limpo(f.papel).toLowerCase() === p) || null;
  const titulo = doPapel("titulo") || doPapel("destaque") || doPapel("texto") || lista[0];
  const texto = doPapel("texto") || titulo;
  const saida = lista.map((f) => ({ nome: limpo(f.nome), papel: limpo(f.papel) }));
  // Quem faltar entra no fim: o kit com título e texto fica igual, byte a byte.
  if (!saida.some((f) => f.papel === "titulo")) saida.push({ nome: limpo(titulo.nome), papel: "titulo" });
  if (!saida.some((f) => f.papel === "texto")) saida.push({ nome: limpo(texto.nome), papel: "texto" });
  return { titulo, texto, fontes: saida };
}

export const temTipografia = (fontes: FonteDoKit[] | null | undefined) => tipografiaDoKit(fontes) !== null;

/**
 * A amostra só vale se for do próprio cliente (pasta dele) ou da biblioteca
 * da agência (a mesma família para todos). Caminho de outro cliente nunca vai.
 */
export function amostraDoCliente(caminho: unknown, clientId: string): boolean {
  const c = limpo(caminho);
  if (!c || !clientId || c.indexOf("..") >= 0) return false;
  return c.indexOf(`${clientId}/`) === 0 || c.indexOf("biblioteca/") === 0;
}

export type AnexoDaTipografia = {
  tipo: "fonte" | "fonte_texto";
  papel: "titulo" | "texto";
  caminho: string;
  nome: string;
  rotulo: string;
};

export function rotuloDaTipografia(papel: "titulo" | "texto", nome: string): string {
  return papel === "titulo"
    ? `TIPOGRAFIA DO CLIENTE, fonte do título (${nome}): use exatamente estas letras (desenho, peso, proporção) no título; não use outra fonte`
    : `TIPOGRAFIA DO CLIENTE, fonte do texto (${nome}): use exatamente estas letras (desenho, peso, proporção) no texto de apoio e no CTA; não use outra fonte`;
}

/** Amostras a anexar: a do título e, quando a família do texto é outra, a do texto. */
export function anexosDaTipografia(tip: TipografiaDoKit | null, clientId: string): AnexoDaTipografia[] {
  if (!tip) return [];
  const saida: AnexoDaTipografia[] = [];
  const titulo = limpo(tip.titulo.nome);
  if (amostraDoCliente(tip.titulo.amostra_path, clientId)) {
    saida.push({ tipo: "fonte", papel: "titulo", caminho: limpo(tip.titulo.amostra_path), nome: `tipografia-titulo`, rotulo: rotuloDaTipografia("titulo", titulo) });
  }
  const texto = limpo(tip.texto.nome);
  if (!igual(texto, titulo) && amostraDoCliente(tip.texto.amostra_path, clientId)) {
    saida.push({ tipo: "fonte_texto", papel: "texto", caminho: limpo(tip.texto.amostra_path), nome: `tipografia-texto`, rotulo: rotuloDaTipografia("texto", texto) });
  }
  return saida;
}

/**
 * Quantas amostras cedem ao rosto (prioridade lâmina > rosto > tipografia):
 * o que falta de vaga sai primeiro da amostra do texto, depois da do título.
 * Chame depois de a referência automática ceder.
 */
export function tipografiaQueCede(e: { anexos: number; limiteDoModelo: number; pedidas: number; tipos: string[] }): Array<"fonte" | "fonte_texto"> {
  const falta = e.pedidas - (Math.floor(e.limiteDoModelo) - e.anexos);
  if (!(e.pedidas > 0) || falta <= 0) return [];
  const saem: Array<"fonte" | "fonte_texto"> = [];
  for (const t of ["fonte_texto", "fonte"] as const) {
    if (saem.length >= falta) break;
    if (e.tipos.indexOf(t) >= 0) saem.push(t);
  }
  return saem;
}

// ------------------------------------------------------------ série e âncora

export type CaixaDoTitulo = "alta" | "como_escrito";

/** O que a versão guarda da tipografia (a âncora das próximas lâminas). */
export type RegistroDaTipografia = {
  chave: string;
  titulo: string;
  texto: string;
  peso_titulo: string;
  caixa_titulo: CaixaDoTitulo;
  amostras: number;
  /** Ordem da lâmina que serviu de âncora (null: esta é a âncora). */
  ancora: number | null;
};

/** Chave do isolamento: cliente, marca e as famílias do kit. */
export function chaveDaTipografia(clientId: string, marcaId: string | null | undefined, tip: TipografiaDoKit): string {
  return [clientId, marcaId || "geral", limpo(tip.titulo.nome).toLowerCase(), limpo(tip.texto.nome).toLowerCase()].join("|");
}

function registroValido(v: unknown): RegistroDaTipografia | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.chave !== "string" || !r.chave) return null;
  return {
    chave: r.chave,
    titulo: limpo(r.titulo),
    texto: limpo(r.texto),
    peso_titulo: limpo(r.peso_titulo) || "amostra",
    caixa_titulo: r.caixa_titulo === "alta" ? "alta" : "como_escrito",
    amostras: typeof r.amostras === "number" && isFinite(r.amostras) ? r.amostras : 0,
    ancora: typeof r.ancora === "number" && isFinite(r.ancora) ? r.ancora : null,
  };
}

/**
 * A âncora da série para esta lâmina: a versão atual de outra lâmina, com
 * registro da MESMA chave (cliente, marca, fontes); a capa primeiro, senão a
 * de menor ordem. Sem nenhuma: null (esta lâmina vira a âncora).
 */
export function ancoraDaSerie(
  versoes: Array<{ ordem: number; versao: number; tipografia?: unknown }>,
  ordem: number,
  chave: string,
): { ordem: number; registro: RegistroDaTipografia } | null {
  const atuais = new Map<number, { versao: number; tipografia?: unknown }>();
  for (const v of Array.isArray(versoes) ? versoes : []) {
    if (!v || v.ordem === ordem) continue;
    const a = atuais.get(v.ordem);
    if (!a || v.versao > a.versao) atuais.set(v.ordem, v);
  }
  const ordens = Array.from(atuais.keys()).sort((a, b) => a - b);
  for (const o of ordens) {
    const r = registroValido(atuais.get(o)!.tipografia);
    if (r && r.chave === chave) return { ordem: o, registro: r };
  }
  return null;
}

/** Bloco do título no molde da referência desta lâmina (peso e caixa), quando há. */
export type TituloDoMolde = { caixa_alta?: boolean; peso?: string | null } | null | undefined;

/**
 * Registro da tipografia desta lâmina. Com âncora: peso e caixa dela (a série
 * não varia). Sem âncora: os do título da referência desta lâmina (quando há
 * molde) ou o peso da amostra e a caixa como está no texto exato.
 */
export function registroDaLamina(e: {
  tip: TipografiaDoKit;
  chave: string;
  ancora: { ordem: number; registro: RegistroDaTipografia } | null;
  tituloDoMolde?: TituloDoMolde;
  amostras: number;
}): RegistroDaTipografia {
  const base = { chave: e.chave, titulo: limpo(e.tip.titulo.nome), texto: limpo(e.tip.texto.nome), amostras: e.amostras };
  if (e.ancora) return { ...base, peso_titulo: e.ancora.registro.peso_titulo, caixa_titulo: e.ancora.registro.caixa_titulo, ancora: e.ancora.ordem };
  const m = e.tituloDoMolde;
  return {
    ...base,
    peso_titulo: m && limpo(m.peso) ? limpo(m.peso) : e.amostras > 0 ? "amostra" : "negrito",
    caixa_titulo: m && m.caixa_alta === true ? "alta" : "como_escrito",
    ancora: null,
  };
}

const textoDoPeso = (p: string) => (p === "amostra" ? "no peso da amostra" : `peso ${p} (se a fonte não tiver, o mais perto)`);
const textoDaCaixa = (c: CaixaDoTitulo) => (c === "alta" ? "caixa alta (todas as letras maiúsculas)" : "caixa como está no texto exato");

/**
 * Bloco curto do prompt: família, peso e caixa por papel, as imagens das
 * amostras e a âncora da série. Igual em todas as lâminas do trabalho (muda
 * só a linha da âncora e os números das imagens).
 */
export function blocoDaTipografia(e: {
  registro: RegistroDaTipografia;
  indices: { titulo?: number | null; texto?: number | null };
  /** Número da imagem da capa anexada (âncora visual), quando vai. */
  indiceDaCapa?: number | null;
  ordem: number;
  total: number;
}): string {
  const r = e.registro;
  const linhas = [
    "TIPOGRAFIA DO CLIENTE (a mesma em todas as lâminas deste trabalho; vale sobre o desenho de letra de qualquer referência):",
    `- Título (headline e número): fonte ${r.titulo}, ${textoDoPeso(r.peso_titulo)}, ${textoDaCaixa(r.caixa_titulo)}.`,
    `- Apoio (subtítulo e texto): fonte ${r.texto}, peso regular, caixa como está no texto exato.`,
    `- CTA: fonte ${r.texto}, negrito, caixa como está no texto exato.`,
  ];
  const amostras: string[] = [];
  if (e.indices.titulo) amostras.push(`a imagem ${e.indices.titulo} é a amostra da fonte do título`);
  if (e.indices.texto) amostras.push(`a imagem ${e.indices.texto} é a amostra da fonte do texto`);
  if (amostras.length) linhas.push(`- Letras: ${amostras.join(" e ")}; copie o desenho, o peso e a proporção dessas letras.`);
  if (e.total > 1) {
    if (e.ordem > 1 && e.indiceDaCapa) {
      // A capa anexada é a âncora visual (vale também para a capa gerada antes deste registro existir).
      linhas.push(`- Âncora da série: o título desta lâmina tem a mesma fonte, o mesmo peso e a mesma caixa do título da capa (imagem ${e.indiceDaCapa}).`);
    } else if (r.ancora !== null) {
      linhas.push(`- Âncora da série: o título desta lâmina tem a mesma fonte, o mesmo peso e a mesma caixa do título da lâmina ${r.ancora}, já gerada.`);
    } else {
      linhas.push("- Esta lâmina é a âncora tipográfica da série: as outras repetem esta fonte, este peso e esta caixa.");
    }
  }
  linhas.push("- Não use outra fonte: nem a da referência, nem uma parecida, nem uma escolhida por conta própria.");
  return linhas.join("\n");
}

/**
 * Lâmina 2+ espera a capa? Só quando a capa ainda não tem versão e está na
 * fila (gerando ou prestes a gerar). A capa que não foi pedida não segura
 * ninguém: a lâmina segue sem âncora (ou com a de outra lâmina já gerada).
 */
export function esperaACapa(e: { ordem: number; total: number; capaTemVersao: boolean; capaNaFila: boolean }): boolean {
  return e.ordem > 1 && e.total > 1 && !e.capaTemVersao && e.capaNaFila;
}
