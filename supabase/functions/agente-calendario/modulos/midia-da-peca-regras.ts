/**
 * Mídia de cada peça do Mês, pensada pelo nicho (23/10/2026). Regras puras: a
 * função, a tela e os testes (vitest) leem este arquivo, sem Deno nem banco.
 *
 * Dono: "já reconhece fotos lá no Workspace ou busca na internet e completa;
 * no vídeo ele já gera algo com a pegada de ganchos virais". Para qualquer
 * cliente:
 * - foto: primeiro as fotos do acervo do cliente (Workspace e Mesa Foto) que
 *   servem ao tema, com a nota do Jev para cada candidata (gerar a mais e
 *   escolher); sem nenhuma boa, referências livres da internet com licença
 *   comercial (Openverse, o mesmo da Mesa Foto), só como referência;
 * - vídeo: um vídeo de IA que complementa o negócio (referência de paisagismo,
 *   inspiração de cozinha), com a imagem de partida do acervo quando alguma
 *   serve e um roteiro curto com gancho viral (motor de copy viral), 2 versões
 *   e o Jev escolhe. A geração do vídeo continua no Estúdio, com custo antes.
 *
 * Nada aqui gera mídia nem publica. Sem travessão nos textos.
 */
import { ESTILOS_DE_VIDEO_DA_PAUTA, normalizarVideoDaPauta, type DirecaoDeVideoDaPauta, type EstiloDeVideoDaPauta } from "../../_shared/video-da-pauta.ts";

export type TipoDeMidia = "foto" | "video";
export const TIPOS_DE_MIDIA: TipoDeMidia[] = ["foto", "video"];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** O tipo de mídia que o modelo ou a tela pediu ("foto real", "vídeo", "reels"). Null quando não dá para saber. */
export function tipoDeMidia(v: unknown): TipoDeMidia | null {
  const s = semAcento(String(v == null ? "" : v).toLowerCase());
  if (/video|reels?\b|shorts?\b/.test(s)) return "video";
  if (/foto|imagem|photo|ensaio/.test(s)) return "foto";
  return null;
}

/** Formatos de tarefa que já são vídeo (a peça de vídeo não precisa trocar de formato). */
export const ENTREGAS_DE_VIDEO = ["video", "reel", "short"];
/** O formato da tarefa para cada mídia, quando a peça precisa mudar (o mudar_formato do agente). */
export const ENTREGA_DA_MIDIA: Record<TipoDeMidia, string> = { foto: "foto", video: "reel" };

/** A peça já está no formato da mídia pedida? (título "Peça de foto: " marca a peça de foto). */
export function pecaJaE(tipo: TipoDeMidia, peca: { title?: string | null; delivery_type?: string | null }): boolean {
  if (tipo === "foto") return String(peca.title || "").indexOf("Peça de foto: ") === 0;
  return ENTREGAS_DE_VIDEO.indexOf(String(peca.delivery_type || "").toLowerCase()) >= 0;
}

// ------------------------------------------------------------------ acervo

export type FotoDoAcervo = {
  id: string;
  nome: string;
  descricao?: string | null;
  tags?: string[] | null;
  pasta?: string | null;
  categoria?: string | null;
  ativa?: boolean | null;
  gerada?: boolean | null;
};

/** Foto que pode ser a mídia da peça: ativa, não é referência da internet, nem logo ou arte pronta. */
export function fotoUsavel(f: FotoDoAcervo): boolean {
  if (f.ativa === false) return false;
  const tags = f.tags || [];
  if (tags.indexOf("referencia_web") >= 0 || tags.indexOf("nao_publicar") >= 0) return false;
  return ["logo", "arte"].indexOf(String(f.categoria || "")) < 0;
}

const VAZIAS = new Set(
  ("a o as os um uma uns umas de da do das dos e em no na nos nas com sem por para pra que se ao aos sua seu suas seus " +
    "mais muito post peca foto fotos video videos reels imagem imagens real reais faz fazer coloca poe troca trocar " +
    "img jpg jpeg png heic dsc whatsapp image photo copia final versao nova novo").split(" "),
);

/** Palavras que contam no tema (sem acento, sem palavra vazia, 3 letras ou mais). */
export function palavrasDoTexto(...textos: unknown[]): string[] {
  const saida: string[] = [];
  for (const t of textos) {
    for (const p of semAcento(String(t == null ? "" : t).toLowerCase()).split(/[^a-z0-9]+/)) {
      if (p.length < 3 || VAZIAS.has(p) || /^\d+$/.test(p) || saida.indexOf(p) >= 0) continue;
      saida.push(p);
    }
  }
  return saida;
}

// ------------------------------------------------------------------ foto real primeiro (26/10)

/** Categorias do acervo (as que a tela e o leitor de fotos usam). */
export const CATEGORIAS_DO_ACERVO = ["pessoa", "produto", "ambiente", "detalhe", "antes_depois", "arte", "logo", "outro"] as const;
export type CategoriaDoAcervo = (typeof CATEGORIAS_DO_ACERVO)[number];
/** Etiquetas que o leitor de fotos (acervo-ler-fotos) grava: fotografia real ou arte, card e print. */
export const TAG_FOTO_REAL = "foto_real";
export const TAG_ARTE_OU_PRINT = "arte_ou_print";
const TAGS_QUE_NAO_SAO_REAIS = ["gerada", "pessoa_sintetica", "referencia_web", "nao_publicar", TAG_ARTE_OU_PRINT];

/**
 * Foto que conta como REAL do cliente: usável, não gerada por IA (gerada=true
 * ou etiqueta), não é referência da internet nem arte ou print (o leitor de
 * fotos marca). Foto ainda não lida conta; o Jev decide se serve.
 */
export function fotoReal(f: FotoDoAcervo): boolean {
  if (!fotoUsavel(f) || f.gerada === true) return false;
  const tags = f.tags || [];
  return !TAGS_QUE_NAO_SAO_REAIS.some((t) => tags.indexOf(t) >= 0);
}

/** Nota (0 a 3) para a foto real entrar sozinha na peça: "Serve" para cima. Abaixo, gera com IA. */
export const CORTE_DA_FOTO_REAL = 2;
export const LINHA_SEM_FOTO_REAL = "Sem foto real que combine: vai gerar com IA";

export type EscolhaDaFotoReal = {
  modo: "real" | "ia";
  fotos: Array<{ id: string; nome: string; nota: number }>;
  /** A linha que a tela mostra. */
  linha: string;
};

/** Foto real com nota acima do corte (até `max`, a melhor primeiro) ou a geração por IA, com a linha da tela. */
export function escolhaDaFotoReal<T extends { id: string; nome: string }>(candidatas: T[], respostas: Record<string, { score?: number } | undefined>, max = 1): EscolhaDaFotoReal {
  const boas = escolhidasPelasNotas(candidatas, respostas, max, CORTE_DA_FOTO_REAL).map((f) => ({ id: f.id, nome: f.nome, nota: f.nota }));
  if (!boas.length) return { modo: "ia", fotos: [], linha: LINHA_SEM_FOTO_REAL };
  return { modo: "real", fotos: boas, linha: `Foto real do acervo: ${umaLinha(boas[0].nome, 80)} (nota ${boas[0].nota} de 3). Dá para trocar.` };
}

/**
 * A escolha inteira, com o Jev injetado (a mídia da peça e o Estúdio usam a mesma): só fotos reais, as
 * candidatas pelo tema, uma nota por candidata numa chamada, e a melhor acima do corte. Sem candidata, nem
 * pergunta (sem custo). O Jev que falha propaga: quem chama decide (a geração por IA segue).
 */
export async function escolherFotoReal<T extends FotoDoAcervo>(
  fotos: T[],
  tema: string,
  julgar: (state: unknown, questions: Record<string, unknown>) => Promise<Record<string, { score?: number } | undefined>>,
  a: { uso: string; peca: Record<string, unknown>; max?: number },
): Promise<EscolhaDaFotoReal & { julgou: boolean }> {
  const candidatas = candidatasDoAcervo(fotos.filter(fotoReal), tema);
  if (!candidatas.length) return { ...escolhaDaFotoReal([], {}), julgou: false };
  const r = await julgar({ peca: a.peca, candidatas: candidatas.map(textoDaFoto) }, perguntasDaMidia(candidatas.length, a.uso));
  return { ...escolhaDaFotoReal(candidatas, r, Math.max(1, Math.min(2, a.max ?? 1))), julgou: true };
}

// ------------------------------------------------------------------ item a partir da tarefa (26/10)

export type TarefaParaOItem = { id: string; title: string; description?: string | null; delivery_type?: string | null; due_date?: string | null };

/** Rótulos das linhas da descrição da tarefa (descricaoDoItem do Mês, MCP aceleriq_create_editorial_item, Mesa Ads). */
const ROTULOS_DA_DESCRICAO = [
  "Tema", "Formato", "Tipo", "Pilar", "Público", "Objetivo", "Métrica principal", "Palavra-chave", "Termo regional", "Gancho do momento",
  "Tipo e framework", "Etapa da campanha", "Gancho", "Resumo", "Instrução de arte da equipe", "Caminho do vídeo", "Estilo de vídeo",
  "Direção do vídeo", "Narração", "Referências", "Roteiro dos cards", "Roteiro das cenas", "Fotos do post", "Telas", "CTA", "Legenda (copy)", "Origem",
];
const BLOCOS = ["Roteiro dos cards", "Roteiro das cenas", "Fotos do post", "Telas", "Legenda (copy)"];
const UUID_DO_TEXTO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Os campos da descrição da tarefa ("Rótulo: valor"; blocos de várias linhas até o próximo rótulo). */
export function camposDaDescricao(descricao: unknown): Record<string, string> {
  const campos: Record<string, string> = {};
  let bloco: string | null = null;
  for (const linha of String(descricao == null ? "" : descricao).replace(/\r\n/g, "\n").split("\n")) {
    const m = /^([^:\n]{2,40}):\s*(.*)$/.exec(linha.trim());
    const rotulo = m ? ROTULOS_DA_DESCRICAO.find((r) => r.toLowerCase() === m[1].trim().toLowerCase()) : undefined;
    if (m && rotulo) {
      bloco = BLOCOS.indexOf(rotulo) >= 0 ? rotulo : null;
      if (campos[rotulo] === undefined) campos[rotulo] = m[2].trim();
      continue;
    }
    if (bloco && linha.trim()) campos[bloco] = `${campos[bloco] ? `${campos[bloco]}\n` : ""}${linha.trim()}`;
  }
  return campos;
}

/** O formato do item pela tarefa (entrega e linha Formato). */
export function formatoDaTarefa(t: Pick<TarefaParaOItem, "title" | "delivery_type">, formatoEscrito = ""): "video" | "foto" | "carrossel" | "estatico" {
  const entrega = String(t.delivery_type || "").toLowerCase();
  const escrito = semAcento(formatoEscrito.toLowerCase());
  if (String(t.title || "").indexOf("Peça de foto: ") === 0 || /^peca de foto/.test(escrito)) return "foto";
  if (ENTREGAS_DE_VIDEO.indexOf(entrega) >= 0 || /\b(video|reels?)\b/.test(escrito)) return "video";
  if (entrega === "carousel" || /carrossel/.test(escrito)) return "carrossel";
  return "estatico";
}

/**
 * O item do Mês montado a partir da tarefa, para a peça que não nasceu de uma
 * proposta (MCP, Mesa Ads, criada à mão): título e os campos da descrição.
 * Mesmo formato do item da proposta, no que a mídia da peça e o Estúdio leem.
 */
export function itemDaDescricaoDaTarefa(t: TarefaParaOItem): Record<string, unknown> {
  const c = camposDaDescricao(t.description);
  const formato = formatoDaTarefa(t, c["Formato"] || "");
  const tema = umaLinha(c["Tema"] || String(t.title || "").replace(/^Peça de foto: /, ""), 300);
  const roteiro = c["Roteiro dos cards"] || c["Telas"] || "";
  const cards = formato === "carrossel" || formato === "estatico"
    ? roteiro.split("\n")
      .map((l) => /^(?:card|tela)\s*(\d+)(?:\s*\(([^)]*)\))?\s*:\s*(.+)$/i.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ ordem: Number(m[1]), funcao: umaLinha(m[2] || "", 60), texto: umaLinha(m[3], 600) }))
    : [];
  const item: Record<string, unknown> = {
    task_id: t.id,
    tema,
    gancho: umaLinha(c["Gancho"] || "", 300) || null,
    referencia: umaLinha([c["Resumo"], c["Instrução de arte da equipe"], c["Roteiro das cenas"]].filter(Boolean).join(" "), 1500) || null,
    copy: String(c["Legenda (copy)"] || "").trim().slice(0, 2200) || null,
    formato,
    mesa: formato === "foto" ? "foto" : formato === "video" ? "video" : "arte",
    data: t.due_date ? String(t.due_date).slice(0, 10) : null,
    cards,
    origem_do_item: "tarefa",
  };
  if (formato === "video") {
    const caminho = semAcento(String(c["Caminho do vídeo"] || "").toLowerCase());
    if (/gravar/.test(caminho)) item.caminho_video = "gravar";
    else if (/\bia\b|gerar/.test(caminho)) item.caminho_video = "ia";
    item.video = normalizarVideoDaPauta({
      estilo: String(c["Estilo de vídeo"] || "").trim().toLowerCase(),
      prompt: c["Direção do vídeo"] || "",
      narracao: c["Narração"] || "",
      referencias: String(c["Referências"] || "").match(UUID_DO_TEXTO) || [],
    });
  }
  return item;
}

/** Texto da foto para o Jev ler (nome, pasta, categoria, etiquetas e descrição). */
export function textoDaFoto(f: FotoDoAcervo): string {
  const tags = (f.tags || []).filter((t) => t.indexOf(":") < 0 && ["mesa_foto", "gerada"].indexOf(t) < 0);
  return [f.nome, f.pasta ? `pasta ${f.pasta}` : "", f.categoria ? `categoria ${f.categoria}` : "", tags.length ? `etiquetas ${tags.join(", ")}` : "", f.descricao || ""]
    .filter(Boolean)
    .join(". ")
    .slice(0, 500);
}

export const MAX_CANDIDATAS_DO_ACERVO = 12;

/**
 * As candidatas que vão ao Jev: só fotos usáveis; com mais do que o teto, as
 * que dividem palavras com o tema primeiro (na ordem que vieram, a mais nova
 * antes). Foto sem nenhuma palavra em comum ainda entra quando sobra lugar: o
 * nome pode não dizer nada e a descrição sim.
 */
export function candidatasDoAcervo(fotos: FotoDoAcervo[], tema: string, max = MAX_CANDIDATAS_DO_ACERVO): FotoDoAcervo[] {
  const alvo = palavrasDoTexto(tema);
  const usaveis = fotos.filter(fotoUsavel);
  const pontos = usaveis.map((f, i) => {
    const daFoto = palavrasDoTexto(textoDaFoto(f));
    let n = 0;
    for (const p of alvo) if (daFoto.some((q) => q === p || (p.length >= 5 && q.indexOf(p.slice(0, 5)) === 0))) n++;
    return { f, i, n, temTexto: daFoto.length > 0 };
  });
  return pontos
    .filter((x) => x.temTexto)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, Math.max(1, max))
    .map((x) => x.f);
}

/** Níveis do Score do Jev (do pior para o melhor). */
export const NIVEIS_DA_MIDIA = [
  "Não serve: mostra outro assunto, outro produto ou nada que a peça pede",
  "Serve pouco: é do mesmo universo, mas não mostra o que a peça pede",
  "Serve: mostra o assunto da peça e dá para usar",
  "Serve muito: é exatamente o que a peça pede",
];
/** Nota mínima (0 a 3) para a candidata entrar na peça. Abaixo, fica de fora. */
export const NOTA_MINIMA_DA_MIDIA = 1.6;

/** Uma pergunta Score por candidata, no mesmo estado (`peca` e `candidatas`), numa chamada só. */
export function perguntasDaMidia(n: number, uso: string): Record<string, { type: "score"; instructions: string; criteria: string[] }> {
  const q: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {};
  for (let i = 0; i < n; i++) {
    q[`m${i}`] = {
      type: "score",
      instructions: `Quanto a imagem descrita em \`candidatas[${i}]\` serve como ${uso} da peça \`peca\` (tema, gancho e pedido da equipe), pensando no nicho do cliente em \`peca.nicho\`?`,
      criteria: NIVEIS_DA_MIDIA,
    };
  }
  return q;
}

/** As candidatas com nota mínima, da maior para a menor, até `max`. Sem nota (Jev fora), nenhuma entra. */
export function escolhidasPelasNotas<T>(candidatas: T[], respostas: Record<string, { score?: number } | undefined>, max: number, minimo = NOTA_MINIMA_DA_MIDIA): Array<T & { nota: number }> {
  return candidatas
    .map((c, i) => {
      const s = respostas[`m${i}`]?.score;
      return { c, i, nota: typeof s === "number" && Number.isFinite(s) ? s : -1 };
    })
    .filter((x) => x.nota >= minimo)
    .sort((a, b) => b.nota - a.nota || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map((x) => ({ ...(x.c as T), nota: Math.round(x.nota * 100) / 100 }));
}

// ------------------------------------------------------------------ internet

export type ReferenciaDaInternet = {
  titulo: string;
  imagem_url: string;
  miniatura_url: string | null;
  fonte_url: string | null;
  licenca: string;
  autor: string | null;
};

/** Termos da busca no Openverse: as palavras que o modelo deu em inglês; sem elas, nada (a busca em português acha pouco). */
export function termosDaBusca(v: unknown): string {
  return umaLinha(v, 120).replace(/[^A-Za-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
}

// ------------------------------------------------------------------ o roteiro do vídeo

export const MAX_VERSOES_DO_ROTEIRO = 2;

/** Esquema da saída do modelo (estrito: tudo obrigatório). */
export const ESQUEMA_DA_MIDIA_DA_PECA = {
  nome: "midia_da_peca",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      busca_en: { type: "string", description: "3 a 5 palavras em inglês para achar uma foto de referência livre do assunto (ex.: modern garden landscaping)." },
      versoes: {
        type: "array",
        description: "No vídeo, exatamente 2 versões com ideias diferentes; na foto, lista vazia.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            gancho: { type: "string", description: "O que prende nos 2 primeiros segundos: imagem e frase curta na tela." },
            cenas: { type: "array", items: { type: "string" }, description: "3 a 5 cenas curtas, em ordem, com o que se vê e o movimento de câmera." },
            narracao: { type: "string", description: "Fala exata, até 30 palavras, ou vazio quando o vídeo é só imagem e texto." },
            prompt: { type: "string", description: "Direção do vídeo de IA em português, concreta: assunto, ambiente, luz, câmera e movimento, sem texto escrito na cena." },
            estilo: { type: "string", enum: ESTILOS_DE_VIDEO_DA_PAUTA.map((e) => e.id) },
          },
          required: ["gancho", "cenas", "narracao", "prompt", "estilo"],
        },
      },
    },
    required: ["busca_en", "versoes"],
  },
} as const;

export type VersaoDoRoteiro = { gancho: string; cenas: string[]; narracao: string; prompt: string; estilo: EstiloDeVideoDaPauta };

export function versoesDoModelo(bruto: unknown): VersaoDoRoteiro[] {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const saida: VersaoDoRoteiro[] = [];
  for (const x of Array.isArray(o.versoes) ? o.versoes : []) {
    const v = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const gancho = umaLinha(v.gancho, 240);
    const prompt = String(v.prompt == null ? "" : v.prompt).trim().slice(0, 2000);
    if (!gancho || !prompt) continue;
    const cenas = (Array.isArray(v.cenas) ? v.cenas : []).map((c) => umaLinha(c, 240)).filter(Boolean).slice(0, 6);
    const estilo = (ESTILOS_DE_VIDEO_DA_PAUTA.find((e) => e.id === v.estilo) || ESTILOS_DE_VIDEO_DA_PAUTA[0]).id;
    saida.push({ gancho, cenas, narracao: umaLinha(v.narracao, 400), prompt, estilo });
    if (saida.length >= MAX_VERSOES_DO_ROTEIRO) break;
  }
  return saida;
}

/** A versão em texto corrido (o que o Jev confere e o que a tela mostra). */
export function textoDaVersao(v: VersaoDoRoteiro): string {
  return [`Gancho: ${v.gancho}`, ...v.cenas.map((c, i) => `Cena ${i + 1}: ${c}`), v.narracao ? `Fala: ${v.narracao}` : ""].filter(Boolean).join("\n");
}

export type PecaParaAMidia = {
  tipo: TipoDeMidia;
  tema: string;
  gancho?: string | null;
  referencia?: string | null;
  pedido?: string | null;
  data?: string | null;
};

/** O pedido ao modelo (a tarefa; o contexto do nicho e os ganchos vêm do motor de copy viral). */
export function pedidoDaMidia(p: PecaParaAMidia, a: { nicho: string; blocoViral: string; partida: string | null; temReferenciaReal: boolean }): string {
  const linhas = [
    a.blocoViral,
    "",
    `NICHO E NEGÓCIO: ${a.nicho}`,
    `PEÇA: ${umaLinha(p.tema, 300)}${p.data ? ` (data ${p.data})` : ""}`,
    p.gancho ? `GANCHO ATUAL DA PEÇA: ${umaLinha(p.gancho, 300)}` : "",
    p.referencia ? `IDEIA DA PEÇA: ${umaLinha(p.referencia, 800)}` : "",
    p.pedido ? `PEDIDO DA EQUIPE (vale sobre o resto): ${umaLinha(p.pedido, 800)}` : "",
    a.partida ? `IMAGEM DE PARTIDA ESCOLHIDA DO ACERVO DO CLIENTE: ${a.partida}. O vídeo começa nela; não mude o produto nem o lugar real.` : "Sem foto do cliente que sirva: o vídeo é de IA, só a partir do texto.",
    "",
  ];
  if (p.tipo === "video") {
    linhas.push(
      "TAREFA: proponha um vídeo curto (5 a 10 segundos, vertical) para o Instagram que COMPLEMENTE o negócio deste cliente no nicho dele: referência, inspiração ou transformação do universo do cliente (ex.: paisagismo para quem faz jardins, inspiração de cozinha planejada para quem faz móveis), sem prometer o que o cliente não faz e sem inventar produto, preço ou resultado.",
      "Escreva 2 versões com ganchos diferentes (fórmulas diferentes dos exemplos), cada uma com gancho, 3 a 5 cenas, narração (ou vazio), o prompt do vídeo de IA e o estilo.",
      "Sem pessoa famosa, sem marca de terceiros, sem texto escrito dentro da cena (o texto entra depois na edição).",
      a.temReferenciaReal ? "" : "busca_en: 3 a 5 palavras em inglês do assunto visual, para buscar uma foto de referência livre.",
    );
  } else {
    linhas.push(
      "TAREFA: o acervo do cliente não tem foto que sirva a esta peça. Devolva busca_en com 3 a 5 palavras em inglês do assunto visual concreto da foto (o que aparece, sem adjetivo de qualidade), para buscar uma referência livre na internet. versoes: lista vazia.",
    );
  }
  return linhas.filter((l) => l !== "").join("\n");
}

// ------------------------------------------------------------------ o que fica na peça

export type MidiaDaPeca = {
  tipo: TipoDeMidia;
  /** acervo: foto do cliente escolhida; internet: só referência livre; texto: vídeo de IA sem imagem de partida. */
  fonte: "acervo" | "internet" | "texto";
  acervo: Array<{ id: string; nome: string; nota: number }>;
  web: ReferenciaDaInternet[];
  gancho: string | null;
  cenas: string[];
  narracao: string | null;
  porque: string | null;
  resumo: string;
  pedido: string | null;
  gerada_em: string;
};

/** A frase de uma linha da mídia (cartão do agente e tela da pauta). */
export function resumoDaMidia(m: Pick<MidiaDaPeca, "tipo" | "fonte" | "acervo" | "web" | "gancho">): string {
  const partes: string[] = [];
  if (m.acervo.length) partes.push(`${m.acervo.length} ${m.acervo.length === 1 ? "foto do Workspace" : "fotos do Workspace"}${m.tipo === "video" ? " como imagem de partida" : ""}`);
  else if (m.web.length) partes.push(`${m.web.length} ${m.web.length === 1 ? "referência livre" : "referências livres"} da internet (só referência)`);
  else partes.push(m.tipo === "video" ? "vídeo de IA a partir do texto" : "sem foto que sirva: falta foto real");
  if (m.tipo === "video" && m.gancho) partes.push(`gancho: ${umaLinha(m.gancho, 90)}`);
  return partes.join(" · ");
}

/**
 * O item da proposta com a mídia: na foto, as fotos do acervo viram as
 * referências da direção (a pauta de fotos já abre com elas escolhidas); no
 * vídeo, a direção do vídeo ganha prompt, narração, estilo e a imagem de
 * partida (a pauta de vídeo já carrega o primeiro quadro). O resto do item fica.
 */
export function itemComMidia(item: Record<string, unknown>, m: MidiaDaPeca, versao: VersaoDoRoteiro | null): Record<string, unknown> {
  const novo: Record<string, unknown> = { ...item, midia: m };
  const ids = m.acervo.map((a) => a.id);
  if (m.tipo === "foto") {
    const foto = (item.foto && typeof item.foto === "object" ? item.foto : {}) as Record<string, unknown>;
    novo.foto = { ...foto, referencias: ids.length ? ids : Array.isArray(foto.referencias) ? foto.referencias : [] };
  } else {
    const antes = normalizarVideoDaPauta(item.video);
    const direcao: DirecaoDeVideoDaPauta = versao
      ? {
        ...antes,
        estilo: versao.estilo,
        prompt: `${versao.prompt}\nGancho nos 2 primeiros segundos: ${versao.gancho}${versao.cenas.length ? `\nCenas: ${versao.cenas.join(" | ")}` : ""}`.slice(0, 3000),
        narracao: versao.narracao,
        referencias: ids.length ? ids : antes.referencias,
      }
      : { ...antes, referencias: ids.length ? ids : antes.referencias };
    novo.video = direcao;
  }
  return novo;
}

/** Linha das regras do estrategista (todo pedido do Mês): o vídeo já nasce com gancho, cenas e fala. */
export const GANCHO_NO_VIDEO_DA_PAUTA = "- No formato video: video.prompt começa pelo gancho visual dos 2 primeiros segundos e segue com 3 a 5 cenas curtas (o que se vê e a câmera); video.narracao é a fala com gancho (até 30 palavras) ou vazio. No nicho do cliente, o vídeo de IA complementa o negócio (inspiração, referência, antes e depois do universo dele) sem inventar produto, preço ou resultado. O mês mistura formatos (vídeo, foto, carrossel e estático) e não repete o mesmo formato em sequência.";

/**
 * O pedido fala da MÍDIA da peça ("põe foto real", "usa as fotos do Workspace", "troca a imagem",
 * "transforma em vídeo", "faz um Reels com IA")? O tipo pedido, ou null. Serve para a peça citada virar
 * "pensar a mídia" em vez de "refazer" quando o agente não preparou nada nela.
 */
export function midiaDoPedido(mensagem: unknown): TipoDeMidia | null {
  const s = semAcento(String(mensagem == null ? "" : mensagem).toLowerCase());
  if (/\b(video|videos|reels?|shorts?)\b/.test(s) && /\b(faz|faca|fazer|vira|virar|transforma|transformar|troca|trocar|muda|mudar|cria|criar|gera|gerar|quero|coloca|poe|bota)\b/.test(s)) return "video";
  if (/foto(s)? (real|reais|do workspace|do acervo|do cliente|de verdade)|imagem real|(troca|trocar|muda|mudar|coloca|poe|bota|usa|usar) (a |as |uma )?(foto|imagem|fotos|imagens)/.test(s)) return "foto";
  return null;
}
