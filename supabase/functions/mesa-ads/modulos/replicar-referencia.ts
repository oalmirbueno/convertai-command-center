/**
 * Replicar uma referência de anúncio com Fidelidade (pedido do dono em
 * 02/10/2026: "um ajuste de idêntico, próximo e criativo quando replicar a
 * referência"). Puro: sem Deno, sem banco; a leitura do texto da imagem
 * recebe quem chama o modelo (o servidor passa chamarTexto, o teste passa um
 * falso). Sem travessão.
 *
 * Três níveis para a COPY do anúncio (a arte segue a fidelidade do Estúdio):
 *   - identico: mantém a estrutura, o modelo do gancho e a sequência dos
 *     blocos da referência (mesma quantidade de linhas, mesma ordem, mesmo
 *     tipo de CTA); troca só os fatos pelos da oferta do cliente;
 *   - proximo: mantém a estrutura e o modelo do gancho, com a voz do cliente
 *     (palavras, tratamento e ritmo dele);
 *   - criativo: mantém a ideia central (o mecanismo) e cria um ângulo e um
 *     gancho novos.
 * Em todos: nunca copia marca, número, prova ou promessa da referência.
 *
 * Leitura do texto da imagem (visão, modelo barato de leitura): transcreve os
 * textos na ordem em que aparecem, com o papel de cada um (gancho, apoio,
 * prova, oferta, cta), e devolve o gancho e a sequência. Fica gravada na
 * ficha da referência (texto_lido), para a próxima vez não cobrar de novo.
 */

export type FidelidadeAds = "identico" | "proximo" | "criativo";
export const FIDELIDADES_ADS: FidelidadeAds[] = ["identico", "proximo", "criativo"];
export const ROTULO_DA_FIDELIDADE_ADS: Record<FidelidadeAds, string> = { identico: "Idêntico", proximo: "Próximo", criativo: "Criativo" };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Nível lido com cuidado (aceita também os nomes do Estúdio: identica, proxima, inspirada, criativa). */
export function fidelidadeAds(v: unknown): FidelidadeAds | null {
  const s = semAcento(String(v == null ? "" : v)).replace(/[^a-z]/g, "");
  if (s === "identico" || s === "identica") return "identico";
  if (s === "proximo" || s === "proxima") return "proximo";
  if (s === "criativo" || s === "criativa" || s === "inspirada" || s === "inspirado") return "criativo";
  return null;
}

export type PapelDoTexto = "gancho" | "apoio" | "prova" | "oferta" | "cta" | "outro";
const PAPEIS: PapelDoTexto[] = ["gancho", "apoio", "prova", "oferta", "cta", "outro"];

export type TextoLido = {
  textos: { ordem: number; texto: string; papel: PapelDoTexto }[];
  gancho: string | null;
  /** O modelo do gancho em palavras ("pergunta com número", "afirmação contra o senso comum"...). */
  modelo_do_gancho: string | null;
  /** Os papéis na ordem em que aparecem (a sequência que Idêntico repete). */
  estrutura: PapelDoTexto[];
  cta: string | null;
  lido_em: string;
  modelo: string | null;
};

export const ESQUEMA_TEXTO_DA_REFERENCIA = {
  nome: "texto_da_referencia",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["textos", "gancho", "modelo_do_gancho", "cta"],
    properties: {
      textos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "texto", "papel"],
          properties: { ordem: { type: "integer" }, texto: { type: "string" }, papel: { type: "string", enum: PAPEIS } },
        },
      },
      gancho: { type: ["string", "null"] },
      modelo_do_gancho: { type: ["string", "null"] },
      cta: { type: ["string", "null"] },
    },
  },
};

export const SISTEMA_DO_LEITOR_DE_TEXTO = [
  "Você lê o TEXTO escrito dentro da imagem de um anúncio (ou print de anúncio) para a agência Aceleriq replicar a estrutura dele.",
  "- textos: cada bloco de texto que aparece na imagem, transcrito exatamente como está, na ordem de leitura (de cima para baixo, da esquerda para a direita), com o papel: gancho (a frase que para a rolagem), apoio, prova (número, depoimento, selo), oferta (preço, condição, o que leva), cta (a chamada para agir) ou outro (marca, rodapé, aviso legal).",
  "- gancho: o texto do gancho, igual ao da imagem. modelo_do_gancho: o molde dele em poucas palavras, sem a marca (ex.: \"pergunta com número\", \"afirmação contra o senso comum\", \"lista de 3\", \"antes e depois em duas linhas\").",
  "- cta: a chamada escrita na peça, igual à da imagem; null se não houver.",
  "- Não invente texto que não está na imagem. Imagem sem texto: textos vazio e o resto null.",
  "- Responda só com o JSON pedido.",
].join("\n");

/** Normaliza a resposta do leitor (só papéis conhecidos, ordem crescente, nada vazio). */
export function normalizarTextoLido(bruto: unknown, modelo: string | null, agora = new Date().toISOString()): TextoLido {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const lista = Array.isArray(o.textos) ? o.textos as Record<string, unknown>[] : [];
  const textos = lista
    .map((t, i) => ({
      ordem: Number.isFinite(Number(t && t.ordem)) ? Number(t.ordem) : i + 1,
      texto: String((t && t.texto) || "").replace(/\s+/g, " ").trim().slice(0, 400),
      papel: (PAPEIS.indexOf(String((t && t.papel) || "") as PapelDoTexto) >= 0 ? t.papel : "outro") as PapelDoTexto,
    }))
    .filter((t) => t.texto)
    .sort((a, b) => a.ordem - b.ordem)
    .slice(0, 20)
    .map((t, i) => ({ ...t, ordem: i + 1 }));
  const linha = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
  const estrutura: PapelDoTexto[] = [];
  for (const t of textos) if (t.papel !== "outro" && estrutura[estrutura.length - 1] !== t.papel) estrutura.push(t.papel);
  const ganchoDaLista = textos.filter((t) => t.papel === "gancho")[0];
  return {
    textos,
    gancho: linha(o.gancho, 300) || (ganchoDaLista ? ganchoDaLista.texto : null),
    modelo_do_gancho: linha(o.modelo_do_gancho, 160),
    estrutura,
    cta: linha(o.cta, 120),
    lido_em: agora,
    modelo,
  };
}

/** Texto lido guardado na ficha (ficha.texto_lido), ou null quando não há ou está inválido. */
export function textoLidoDaFicha(ficha: Record<string, unknown> | null | undefined): TextoLido | null {
  const t = ficha ? ficha.texto_lido : null;
  if (!t || typeof t !== "object") return null;
  const lido = normalizarTextoLido(t, typeof (t as Record<string, unknown>).modelo === "string" ? String((t as Record<string, unknown>).modelo) : null, String((t as Record<string, unknown>).lido_em || ""));
  return lido.textos.length || lido.gancho ? lido : null;
}

export type ChamarLeitor = (p: { sistema: string; texto: string; imagens: { bytes: Uint8Array; mime: string; nome?: string }[]; esquema: typeof ESQUEMA_TEXTO_DA_REFERENCIA }) => Promise<{ json: unknown; custoUsd: number; saldoUsd: number | null; modeloId: string | null }>;

/**
 * Lê o texto da imagem da referência com o leitor barato. Sem imagem, não
 * chama nada (custo zero, null). A falha sobe: quem chama decide se segue.
 */
export async function lerTextoDaReferencia(
  chamar: ChamarLeitor,
  imagens: { bytes: Uint8Array; mime: string; nome?: string }[],
  contexto: { titulo?: string | null; copyDoAnuncio?: string | null },
): Promise<{ lido: TextoLido | null; custoUsd: number; saldoUsd: number | null }> {
  if (!imagens.length) return { lido: null, custoUsd: 0, saldoUsd: null };
  const texto = [
    `Referência: "${String(contexto.titulo || "sem título").slice(0, 200)}".`,
    contexto.copyDoAnuncio ? `Copy do anúncio fora da imagem (só para contexto, não transcreva): ${String(contexto.copyDoAnuncio).slice(0, 800)}` : "",
    `Transcreva o texto das ${imagens.length} imagem(ns) anexa(s).`,
  ].filter(Boolean).join("\n");
  const r = await chamar({ sistema: SISTEMA_DO_LEITOR_DE_TEXTO, texto, imagens: imagens.slice(0, 3), esquema: ESQUEMA_TEXTO_DA_REFERENCIA });
  return { lido: normalizarTextoLido(r.json, r.modeloId), custoUsd: r.custoUsd, saldoUsd: r.saldoUsd };
}

const ROTULO_DO_PAPEL: Record<PapelDoTexto, string> = { gancho: "gancho", apoio: "apoio", prova: "prova", oferta: "oferta", cta: "CTA", outro: "outro" };

/** O que a ficha da referência já sabe (gancho, argumento, prova, CTA, mecanismo), só o que existe. */
function fichaEmLinhas(ficha: Record<string, unknown> | null | undefined): string[] {
  const f = ficha || {};
  const pares: Array<[string, unknown]> = [
    ["Gancho verbal", f.gancho_verbal],
    ["Texto de apoio", f.texto_apoio],
    ["Argumento", f.argumento],
    ["Prova usada", f.prova],
    ["Objeção tratada", f.objecao],
    ["CTA", f.cta],
    ["Mecanismo", f.mecanismo],
    ["O que transportar", f.o_que_transportar],
    ["O que substituir", f.o_que_substituir],
  ];
  return pares.filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, " ").trim().slice(0, 300)}`);
}

const REGRA_DO_NIVEL: Record<FidelidadeAds, string> = {
  identico: "IDÊNTICO: repita a estrutura da referência bloco a bloco (mesma quantidade de blocos, mesma ordem de papéis, mesmo modelo de gancho, mesmo tipo de CTA e tamanho parecido de cada linha). Troque só os fatos pelos da oferta do cliente. A frase da arte (headline_arte) segue o molde do gancho da referência.",
  proximo: "PRÓXIMO: mantenha a estrutura e o modelo do gancho da referência, mas com a voz do cliente (as palavras, o tratamento e o ritmo dele). A ordem dos blocos pode ajustar uma posição; o gancho segue o mesmo molde com outras palavras.",
  criativo: "CRIATIVO: mantenha só a ideia central (o mecanismo) da referência e crie um ângulo e um gancho novos, que a referência não usou. Estrutura livre.",
};

/**
 * Bloco do prompt da replicação: o nível, o que foi lido na imagem (gancho,
 * molde e sequência) e a ficha. Nunca copia marca, número, prova ou promessa
 * da referência.
 */
export function blocoDaReplicacao(e: { fidelidade: FidelidadeAds; titulo?: string | null; lido: TextoLido | null; ficha?: Record<string, unknown> | null }): string {
  const lido = e.lido;
  const linhasLidas = lido && lido.textos.length
    ? lido.textos.map((t) => `${t.ordem}. [${ROTULO_DO_PAPEL[t.papel]}] ${t.texto}`).join("\n")
    : "(sem texto lido na imagem)";
  return [
    `REFERÊNCIA PARA REPLICAR: "${String(e.titulo || "referência").slice(0, 160)}" (fidelidade ${ROTULO_DA_FIDELIDADE_ADS[e.fidelidade]})`,
    REGRA_DO_NIVEL[e.fidelidade],
    lido && lido.gancho ? `Gancho da referência: "${lido.gancho}"${lido.modelo_do_gancho ? ` (molde: ${lido.modelo_do_gancho})` : ""}.` : "",
    lido && lido.estrutura.length ? `Sequência da referência: ${lido.estrutura.map((p) => ROTULO_DO_PAPEL[p]).join(" > ")}.` : "",
    "Texto lido na imagem da referência:",
    linhasLidas,
    ...fichaEmLinhas(e.ficha).map((l) => `- ${l}`),
    "Nunca copie da referência: marca, nome de produto, número, preço, prova, depoimento ou promessa. Esses vêm só dos FATOS do cliente.",
  ].filter(Boolean).join("\n");
}

/** Linhas não vazias de um texto. */
const linhasDe = (t: string) => String(t || "").split("\n").map((l) => l.trim()).filter(Boolean);
const ehPergunta = (t: string) => /\?\s*$/.test(String(t || "").trim());
const comecaComNumero = (t: string) => /^\s*\d/.test(String(t || ""));

/**
 * Conferência em código da fidelidade (aviso, sem reescrever): em Idêntico, o
 * gancho mantém o molde (pergunta continua pergunta; número no começo continua
 * número) e o texto da arte tem a mesma quantidade de blocos, com folga de um.
 */
export function avisosDaFidelidade(e: { fidelidade: FidelidadeAds; lido: TextoLido | null; headline: string; textoNaArte: string[]; textoPrincipal: string }): string[] {
  if (!e.lido || e.fidelidade === "criativo") return [];
  const avisos: string[] = [];
  const gancho = e.lido.gancho || "";
  const novo = e.headline || linhasDe(e.textoPrincipal)[0] || "";
  if (gancho && ehPergunta(gancho) !== ehPergunta(novo)) avisos.push(ehPergunta(gancho) ? "A referência abre com pergunta; esta não." : "A referência abre com afirmação; esta abre com pergunta.");
  if (gancho && comecaComNumero(gancho) && !comecaComNumero(novo)) avisos.push("A referência abre com número; esta não.");
  if (e.fidelidade === "identico") {
    const blocosRef = e.lido.textos.filter((t) => t.papel !== "outro").length;
    const blocosNovos = e.textoNaArte.filter(Boolean).length;
    if (blocosRef && Math.abs(blocosRef - blocosNovos) > 1) avisos.push(`A referência tem ${blocosRef} blocos de texto na arte; esta tem ${blocosNovos}.`);
  }
  return avisos;
}
