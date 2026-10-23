/**
 * Mistura de formatos pelo nicho (23/10/2026). Dono: "diversificar conteúdos e
 * mesclar, e não ficar somente carrossel e arte, e sim com roteiros, vídeos com
 * IA na pegada do nicho, e fotos também; entender conforme o nicho; ele já dá a
 * sugestão de forma proativa para eu aprovar".
 *
 * - O Jev escolhe (Choice) o perfil de mistura do cliente pelo negócio, o
 *   segmento, a oferta e o público; sem o Jev, a regra por palavras decide.
 * - O código transforma o perfil em números por semana (escalarMix da
 *   cadência), com teto de metade da semana para um formato só, e o Mês
 *   inteiro sai pela grade de datas e formatos que o detalhar já segue.
 * - misturaDoMes e trocasParaMisturar: a leitura de um mês já gravado que
 *   saiu num formato só e quais peças trocar (o Jev dá a nota de cada tema
 *   como vídeo e como foto; a escolha final é do código).
 *
 * Puro (sem Deno, sem banco): a função, a tela e o Vitest leem este arquivo.
 * Sem travessão nos textos.
 */
import type { CadenciaDoMes, MixDaSemana } from "./cadencia-do-mes.ts";

export type FormatoDaMistura = "video" | "foto" | "carrossel" | "estatico";
const FORMATOS: FormatoDaMistura[] = ["video", "foto", "carrossel", "estatico"];

export type PerfilDeMistura = {
  id: string;
  rotulo: string;
  /** O que o Jev lê no critério. */
  descricao: string;
  pesos: Record<FormatoDaMistura, number>;
  /** O que cada vídeo costuma mostrar neste nicho (vai ao prompt). */
  video: string;
  /** O que cada foto costuma mostrar neste nicho. */
  foto: string;
  /** O vídeo em poucas palavras (fala da sugestão). */
  videoCurto: string;
  pistas: RegExp;
};

export const PERFIS_DE_MISTURA: PerfilDeMistura[] = [
  {
    id: "ambiente_e_projeto",
    rotulo: "Ambiente e projeto",
    descricao: "Negócio que vende a transformação de um espaço ou objeto que se vê: paisagismo, jardinagem, móveis planejados, marcenaria, cozinhas, decoração, arquitetura, reforma, imóveis, piscinas.",
    pesos: { video: 3, foto: 3, carrossel: 2, estatico: 1 },
    video: "inspiração e referência do universo do cliente (ambiente pronto, antes e depois, detalhe de acabamento), com gancho visual",
    foto: "projeto real, ambiente e detalhe de material",
    videoCurto: "inspiração e antes e depois do ambiente",
    pistas: /paisag|jardi|planta|movei|marcen|cozinh|decora|arquitet|interior|reform|imove|imobil|piscin|ambiente|marmor|granit|sob medida|plane[jy]ad/,
  },
  {
    id: "produto_na_mao",
    rotulo: "Produto que se escolhe pelo visual",
    descricao: "Produto físico escolhido pela aparência: ótica, moda, joias, cosméticos, gastronomia, doces, bebidas, cafeteria, pet shop, flores, artesanato.",
    pesos: { video: 3, foto: 4, carrossel: 2, estatico: 1 },
    video: "produto em uso e detalhe em movimento, com gancho nos primeiros segundos",
    foto: "produto real em ângulos e em uso",
    videoCurto: "produto em uso com gancho",
    pistas: /otica|oculos|moda|roupa|joia|cosmet|beleza|gastron|restaurant|comida|doce|confeit|bebida|cafe|padar|pet|flor|artesan|calcad|perfum|hambur|pizz|assad/,
  },
  {
    id: "servico_que_explica",
    rotulo: "Serviço que precisa explicar",
    descricao: "Serviço que precisa explicar e gerar confiança: advocacia, contabilidade, saúde, odontologia, psicologia, educação, seguros, finanças, tecnologia, empresa que vende para empresa.",
    pesos: { video: 3, foto: 1, carrossel: 4, estatico: 2 },
    video: "Reels com roteiro para gravar (pessoa falando com gancho) ou vídeo curto que mostra a situação do cliente",
    foto: "bastidor real do atendimento e da equipe",
    videoCurto: "Reels com roteiro para gravar",
    pistas: /advog|juridic|direito|contab|saude|clinic|odont|dentist|psicol|medic|educa|escola|curso|seguro|financ|credito|software|tecnolog|b2b|consultori|inss|previd/,
  },
  {
    id: "pessoa_e_autoridade",
    rotulo: "Marca puxada por uma pessoa",
    descricao: "Marca puxada por uma pessoa ou especialista que aparece: mentoria, agência, marketing, coach, personal trainer, criador de conteúdo, palestrante.",
    pesos: { video: 4, foto: 1, carrossel: 3, estatico: 1 },
    video: "Reels com roteiro para a pessoa gravar, gancho falado nos 2 primeiros segundos",
    foto: "a pessoa em ação e bastidores",
    videoCurto: "Reels com roteiro para a pessoa gravar",
    pistas: /mentor|agencia|marketing|coach|personal|criador|influenc|palestr|treinador|nutricion/,
  },
  {
    id: "varejo_e_oferta",
    rotulo: "Varejo e oferta",
    descricao: "Loja ou varejo que vive de oferta e giro: informática, eletrônicos, celulares, autopeças, mercado, loja de bairro, materiais de construção.",
    pesos: { video: 3, foto: 2, carrossel: 2, estatico: 3 },
    video: "produto e oferta em movimento, com o motivo para comprar agora",
    foto: "produto real na loja",
    videoCurto: "produto e oferta em movimento",
    pistas: /informat|eletron|celular|autope|mercad|loja|varej|material de constru|ferrag|assist[eê]ncia tecnica/,
  },
];

export const PERFIL_PADRAO = "servico_que_explica";
export const perfilDaMistura = (id: string | null | undefined): PerfilDeMistura =>
  PERFIS_DE_MISTURA.find((p) => p.id === id) || PERFIS_DE_MISTURA.find((p) => p.id === PERFIL_PADRAO)!;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Sem o Jev: o perfil pelas palavras do negócio (o primeiro que casa); sem nada, o padrão. */
export function perfilPorRegra(...textos: unknown[]): PerfilDeMistura {
  const t = semAcento(textos.map((x) => (x == null ? "" : String(x))).join(" "));
  return PERFIS_DE_MISTURA.find((p) => p.pistas.test(t)) || perfilDaMistura(PERFIL_PADRAO);
}

/** A pergunta Choice do Jev sobre `cliente` (negócio, segmento, oferta, público). */
export function perguntaDaMistura(): { type: "choice"; instructions: string; criteria: Record<string, string> } {
  const criteria: Record<string, string> = {};
  for (const p of PERFIS_DE_MISTURA) criteria[p.id] = p.descricao;
  return {
    type: "choice",
    instructions: "Que tipo de negócio é o `cliente`, pensando no que ele vende e em como o público dele decide a compra no Instagram? Escolha o perfil que mais combina.",
    criteria,
  };
}

/** Lê a resposta do Jev; sem resposta válida, a regra por palavras. */
export function perfilDaResposta(resposta: { choice?: string } | null | undefined, ...textos: unknown[]): { perfil: PerfilDeMistura; fonte: "jev" | "regra" } {
  const id = resposta && typeof resposta.choice === "string" ? resposta.choice : "";
  const achado = PERFIS_DE_MISTURA.find((p) => p.id === id);
  return achado ? { perfil: achado, fonte: "jev" } : { perfil: perfilPorRegra(...textos), fonte: "regra" };
}

/**
 * Quantos de cada formato por semana para N posts. Maior resto sobre os pesos
 * e, depois, nenhum formato com mais da metade da semana (arredondada para
 * cima) quando N passa de 1: o excesso vai para o formato de maior peso que
 * ainda tem menos. "fotos" no perfil da conta (Mesa Foto) dobra o peso da foto.
 */
export function mixDoPerfil(perfil: PerfilDeMistura, porSemana: number, formatoDoPerfil?: string | null): MixDaSemana {
  const n = Math.max(1, Math.min(5, Math.round(porSemana) || 1));
  const pesos = { ...perfil.pesos };
  if (formatoDoPerfil === "fotos") pesos.foto *= 2;
  const soma = FORMATOS.reduce((a, f) => a + pesos[f], 0);
  const exatos = FORMATOS.map((f) => (pesos[f] * n) / soma);
  const base = exatos.map(Math.floor);
  let resto = n - base.reduce((a, b) => a + b, 0);
  const ordem = exatos.map((x, i) => ({ i, f: x - Math.floor(x), p: pesos[FORMATOS[i]] })).sort((a, b) => b.f - a.f || b.p - a.p || a.i - b.i);
  for (const o of ordem) {
    if (resto <= 0) break;
    base[o.i]++;
    resto--;
  }
  if (n > 1) {
    const teto = Math.ceil(n / 2);
    for (let guarda = 0; guarda < 10; guarda++) {
      const i = base.findIndex((x) => x > teto);
      if (i < 0) break;
      base[i]--;
      const alvo = FORMATOS.map((f, k) => ({ k, p: pesos[f], q: base[k] })).filter((x) => x.k !== i).sort((a, b) => a.q - b.q || b.p - a.p)[0];
      base[alvo.k]++;
    }
  }
  const [video, foto, carrossel, estatico] = base;
  return { foto, carrossel, estatico, ...(video ? { video } : {}), arte: 0 };
}

/** Semanas cheias (3 dias úteis ou mais) do período: a mesma regra da grade do Mês. */
export function semanasDoPeriodo(inicio: string, fim: string): number {
  const d0 = Date.parse(`${inicio}T12:00:00Z`), d1 = Date.parse(`${fim}T12:00:00Z`);
  if (!Number.isFinite(d0) || !Number.isFinite(d1) || d1 < d0) return 0;
  const porSemana = new Map<number, number>();
  for (let t = d0; t <= d1; t += 86_400_000) {
    const dia = new Date(t).getUTCDay();
    if (dia === 0 || dia === 6) continue;
    const segunda = t - (dia - 1) * 86_400_000;
    porSemana.set(segunda, (porSemana.get(segunda) || 0) + 1);
  }
  let n = 0;
  porSemana.forEach((q) => { if (q >= 3) n++; });
  return n;
}

/** A cadência do nicho: a frequência pedida dividida pelas semanas cheias (1 a 5 por semana) e a mistura do perfil. */
export function cadenciaDoNicho(frequenciaNoPeriodo: number, inicio: string, fim: string, perfil: PerfilDeMistura, formatoDoPerfil?: string | null): CadenciaDoMes {
  const semanas = Math.max(1, semanasDoPeriodo(inicio, fim));
  const porSemana = Math.max(1, Math.min(5, Math.round((Number(frequenciaNoPeriodo) || 3 * semanas) / semanas)));
  return { por_semana: porSemana, mix: mixDoPerfil(perfil, porSemana, formatoDoPerfil), dias: [], fonte: `nicho:${perfil.id}` };
}

/** A cadência com a mistura do nicho quando o pedido não disse os formatos (a mistura pedida sempre vale). */
export function comMisturaDoNicho(c: CadenciaDoMes, perfil: PerfilDeMistura, formatoDoPerfil?: string | null): CadenciaDoMes {
  if (c.mix) return c;
  return { ...c, mix: mixDoPerfil(perfil, c.por_semana, formatoDoPerfil), fonte: `${c.fonte}+nicho:${perfil.id}` };
}

/** O bloco do prompt (estrategista e agente do Mês). */
export function blocoDaMistura(perfil: PerfilDeMistura, mix: MixDaSemana | null): string {
  const conta = mix
    ? FORMATOS.map((f) => ({ f, q: f === "video" ? mix.video || 0 : (mix as Record<string, number>)[f] || 0 })).filter((x) => x.q > 0)
      .map((x) => `${x.q} ${x.f === "video" ? "vídeo" : x.f === "foto" ? "foto" : x.f === "carrossel" ? "carrossel" : "estático"}`).join(", ")
    : "";
  return `MISTURA DE FORMATOS PELO NICHO (${perfil.rotulo}): o mês nunca sai num formato só nem com o mesmo formato em sequência.${conta ? ` Por semana: ${conta}.` : ""} Vídeo neste nicho: ${perfil.video}; cada vídeo leva gancho, cenas e fala em video. Foto neste nicho: ${perfil.foto}. A mistura pedida pela equipe sempre vale sobre esta.`;
}

// ------------------------------------------------------------------ o mês gravado

export type PecaParaAMistura = { id: string; title: string; due_date: string | null; delivery_type: string | null; status?: string | null };

/** O formato da peça gravada (título "Peça de foto: " é foto; reel, vídeo e short são vídeo). */
export function formatoDaPeca(p: Pick<PecaParaAMistura, "title" | "delivery_type">): FormatoDaMistura | null {
  if (String(p.title || "").indexOf("Peça de foto: ") === 0) return "foto";
  const t = String(p.delivery_type || "").toLowerCase();
  if (["video", "reel", "short"].indexOf(t) >= 0) return "video";
  if (t === "carousel") return "carrossel";
  if (t === "static" || t === "design") return "estatico";
  return null;
}

export type LeituraDaMistura = {
  total: number;
  por_formato: Record<FormatoDaMistura, number>;
  dominante: FormatoDaMistura | null;
  /** Parte do formato dominante (0 a 1). */
  parte: number;
  /** Sem vídeo nem foto, ou 70% ou mais num formato só (com 4 peças ou mais). */
  repetitivo: boolean;
  frase: string;
};

const NOME: Record<FormatoDaMistura, [string, string]> = { video: ["vídeo", "vídeos"], foto: ["foto", "fotos"], carrossel: ["carrossel", "carrosséis"], estatico: ["estático", "estáticos"] };

export function misturaDoMes(pecas: Array<Pick<PecaParaAMistura, "title" | "delivery_type">>): LeituraDaMistura {
  const por: Record<FormatoDaMistura, number> = { video: 0, foto: 0, carrossel: 0, estatico: 0 };
  for (const p of pecas) {
    const f = formatoDaPeca(p);
    if (f) por[f]++;
  }
  const total = FORMATOS.reduce((a, f) => a + por[f], 0);
  const dominante = total ? FORMATOS.slice().sort((a, b) => por[b] - por[a])[0] : null;
  const parte = total && dominante ? por[dominante] / total : 0;
  const repetitivo = total >= 4 && (parte >= 0.7 || (por.video === 0 && por.foto === 0));
  const frase = dominante && total
    ? `${por[dominante]} de ${total} ${total === 1 ? "peça" : "peças"} em ${NOME[dominante][por[dominante] === 1 ? 0 : 1]}${por.video ? `, ${por.video} ${NOME.video[por.video === 1 ? 0 : 1]}` : ", nenhum vídeo"}${por.foto ? `, ${por.foto} ${NOME.foto[por.foto === 1 ? 0 : 1]}` : ", nenhuma foto"}`
    : "nenhuma peça";
  return { total, por_formato: por, dominante, parte, repetitivo, frase };
}

/** Duas notas por tema (vídeo e foto), numa chamada só, sobre `pecas` e `cliente`. */
export const NIVEIS_DO_FORMATO = [
  "Não rende neste formato",
  "Rende pouco neste formato",
  "Rende bem neste formato",
  "É o formato ideal para este tema",
];
export function perguntasDasTrocas(n: number, perfil: PerfilDeMistura): Record<string, { type: "score"; instructions: string; criteria: string[] }> {
  const q: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {};
  for (let i = 0; i < n; i++) {
    q[`v${i}`] = { type: "score", instructions: `Quanto o tema \`pecas[${i}]\` rende como vídeo curto no Instagram deste \`cliente\` (${perfil.video})?`, criteria: NIVEIS_DO_FORMATO };
    q[`f${i}`] = { type: "score", instructions: `Quanto o tema \`pecas[${i}]\` rende como post de foto real deste \`cliente\` (${perfil.foto})?`, criteria: NIVEIS_DO_FORMATO };
  }
  return q;
}

export type TrocaSugerida = { id: string; titulo: string; data: string | null; de: FormatoDaMistura; para: "video" | "foto"; nota: number | null };

/**
 * Quais peças trocar para o mês ficar misturado: só as do formato dominante,
 * de hoje em diante e ainda não feitas; o alvo vem do perfil (o formato que
 * falta e tem peso). Com as notas do Jev, a peça de melhor nota para o alvo
 * vai primeiro; sem elas, uma sim e uma não na ordem das datas (as trocas
 * ficam espalhadas). Para quando a parte do dominante cai abaixo de metade.
 */
export function trocasParaMisturar(
  pecas: PecaParaAMistura[],
  perfil: PerfilDeMistura,
  hoje: string,
  notas: Record<string, { score?: number } | undefined> | null = null,
  max = 4,
  /** A leitura do mês inteiro (quando `pecas` são só as que ainda podem mudar). */
  doMes: LeituraDaMistura | null = null,
): TrocaSugerida[] {
  const leitura = doMes || misturaDoMes(pecas);
  if (!leitura.repetitivo || !leitura.dominante) return [];
  const dom = leitura.dominante;
  const feitas = ["done", "completed", "cancelled", "archived", "published"];
  const candidatas = pecas
    .filter((p) => formatoDaPeca(p) === dom && (!p.due_date || p.due_date >= hoje) && feitas.indexOf(String(p.status || "")) < 0)
    .sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")));
  if (!candidatas.length) return [];
  const precisa = Math.min(max, Math.max(1, leitura.por_formato[dom] - Math.floor(leitura.total / 2)), candidatas.length);
  // Os alvos alternam vídeo e foto pelo peso do perfil (o de maior peso primeiro), sem o dominante.
  const alvos: Array<"video" | "foto"> = (["video", "foto"] as const).filter((f) => f !== dom).slice().sort((a, b) => perfil.pesos[b] - perfil.pesos[a]);
  if (!alvos.length) return [];
  const nota = (p: PecaParaAMistura, f: "video" | "foto"): number | null => {
    if (!notas) return null;
    const i = pecas.indexOf(p);
    const s = notas[`${f === "video" ? "v" : "f"}${i}`]?.score;
    return typeof s === "number" && Number.isFinite(s) ? s : null;
  };
  const saida: TrocaSugerida[] = [];
  const usadas = new Set<string>();
  const espalhadas = candidatas.filter((_, i) => i % 2 === 0).concat(candidatas.filter((_, i) => i % 2 === 1));
  for (let k = 0; k < precisa; k++) {
    const para = alvos[k % alvos.length];
    const livres = espalhadas.filter((p) => !usadas.has(p.id));
    if (!livres.length) break;
    const escolhida = notas ? livres.slice().sort((a, b) => (nota(b, para) ?? -1) - (nota(a, para) ?? -1))[0] : livres[0];
    usadas.add(escolhida.id);
    saida.push({ id: escolhida.id, titulo: escolhida.title, data: escolhida.due_date, de: dom, para, nota: nota(escolhida, para) });
  }
  return saida;
}

/** A fala do agente com a sugestão ("Este mês está com 9 de 12 em carrossel..."). */
export function falaDaSugestao(leitura: LeituraDaMistura, trocas: TrocaSugerida[], perfil: PerfilDeMistura): string {
  if (!trocas.length) return "";
  const v = trocas.filter((t) => t.para === "video").length;
  const f = trocas.length - v;
  const partes = [v ? `${v} por ${v === 1 ? "vídeo" : "vídeos"} (${perfil.videoCurto})` : "", f ? `${f} por ${f === 1 ? "foto" : "fotos"} (${perfil.foto})` : ""].filter(Boolean);
  return `Este mês está com ${leitura.frase}. Proponho trocar ${partes.join(" e ")}. Ao confirmar, eu já escolho as fotos do Workspace e escrevo o roteiro com gancho de cada vídeo; dá para desfazer.`;
}
