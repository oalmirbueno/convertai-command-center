/**
 * Partes puras da função mesa-mockups (testadas em src/test/mockups-sugestao.test.ts):
 * - as perguntas de Score ao Jev ("quanto este mockup combina com o negócio do cliente");
 * - a leitura das notas e o ranking;
 * - o texto das cenas pedidas ao gerador (fachada e redes sociais), sempre com a área lisa e
 *   sem nenhum texto ou logo: a logo entra depois, pelo código.
 */
import type { PerguntaScore, RespostaJev } from "../_shared/jev.ts";

export type CandidatoDeMockup = { id: string; nome: string; categoria: string; tags: string[] };

export type ClienteParaSugestao = {
  nome: string;
  negocio: string | null;
  publico: string | null;
  oferta: string | null;
  estilo: string | null;
};

export const MAX_CANDIDATOS = 40;
export const POR_CHAMADA = 20;

/** Do pior para o melhor (Score: lista ordenada). */
export const NIVEIS_DE_ADEQUACAO = [
  "Não combina: o cliente não usaria esta peça nem faz sentido mostrar a marca nela.",
  "Combina pouco: peça genérica, pouco ligada ao dia a dia do negócio.",
  "Combina: peça que o cliente usa ou que ajuda a vender a identidade dele.",
  "É a cara do negócio: peça que o público do cliente vê de verdade e que mostra melhor a marca.",
];

export function limparCandidatos(v: unknown): CandidatoDeMockup[] {
  const lista = Array.isArray(v) ? v : [];
  const vistos = new Set<string>();
  const out: CandidatoDeMockup[] = [];
  for (const c of lista) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    out.push({
      id,
      nome: String(o.nome || id).slice(0, 120),
      categoria: String(o.categoria || "").slice(0, 40),
      tags: Array.isArray(o.tags) ? o.tags.map((t) => String(t).slice(0, 40)).slice(0, 10) : [],
    });
    if (out.length >= MAX_CANDIDATOS) break;
  }
  return out;
}

/** Estado e perguntas de um lote (até POR_CHAMADA candidatos). A pergunta aponta mockups[i]. */
export function perguntasDeAdequacao(cliente: ClienteParaSugestao, lote: CandidatoDeMockup[]): { state: unknown; questions: Record<string, PerguntaScore> } {
  const questions: Record<string, PerguntaScore> = {};
  lote.forEach((m, i) => {
    questions[`m${i}`] = {
      type: "score",
      instructions: `Quanto o mockup mockups[${i}] combina com o negócio do cliente para apresentar a identidade visual dele?`,
      criteria: NIVEIS_DE_ADEQUACAO,
    };
  });
  return {
    state: {
      cliente,
      mockups: lote.map((m) => ({ nome: m.nome, categoria: m.categoria, tags: m.tags })),
    },
    questions,
  };
}

export type NotaDoMockup = { mockup_id: string; nota: number; confianca: number | null };

/** Lê as respostas do lote (score de 0 a 3, pode ser fracionado). Sem nota: fica fora. */
export function notasDoLote(lote: CandidatoDeMockup[], answers: Record<string, RespostaJev>): NotaDoMockup[] {
  const out: NotaDoMockup[] = [];
  lote.forEach((m, i) => {
    const r = answers[`m${i}`];
    const s = r && typeof r.score === "number" && Number.isFinite(r.score) ? r.score : null;
    if (s === null) return;
    out.push({ mockup_id: m.id, nota: Math.round(s * 1000) / 1000, confianca: typeof r.confidence === "number" ? r.confidence : null });
  });
  return out;
}

/**
 * Ranking pela nota (esperança do Score, não pela contagem por nível). Empate: mantém a ordem
 * da sequência que veio da tela (papelaria, digital, produto, exterior).
 */
export function ranquear(candidatos: CandidatoDeMockup[], notas: NotaDoMockup[]): NotaDoMockup[] {
  const pos = new Map(candidatos.map((c, i) => [c.id, i]));
  return notas.slice().sort((a, b) => b.nota - a.nota || (pos.get(a.mockup_id) ?? 0) - (pos.get(b.mockup_id) ?? 0));
}

// ------------------------------------------------------------------ cenas

export type TipoDeCena = "fachada" | "social" | "papelaria" | "embalagem" | "veiculo" | "vestuario" | "sinalizacao" | "digital";

export const TIPOS_DE_CENA: TipoDeCena[] = ["fachada", "social", "papelaria", "embalagem", "veiculo", "vestuario", "sinalizacao", "digital"];

export const TAMANHO_DA_CENA: Record<TipoDeCena, string> = {
  fachada: "1536x1024",
  social: "1024x1536",
  papelaria: "1536x1024",
  embalagem: "1536x1024",
  veiculo: "1536x1024",
  vestuario: "1024x1536",
  sinalizacao: "1024x1536",
  digital: "1536x1024",
};

const SEM_TEXTO = "Nenhum texto, letra, número, logo, marca ou símbolo em lugar nenhum da imagem.";
const LISA = "totalmente branca e lisa, fosca, plana, sem nada escrito, sem estampa, com bordas retas e nítidas, bem iluminada e sem reflexos fortes";

/**
 * O que a IA desenha em cada tipo: o objeto real do negócio e UMA superfície grande, lisa e branca,
 * de frente ou em perspectiva suave, que o código acha e onde aplica a marca (homografia).
 */
const CENAS: Record<TipoDeCena, (negocio: string) => string> = {
  fachada: (n) =>
    `Fotografia realista, de dia, da fachada de ${n}, vista de frente e um pouco de baixo, luz natural suave. ` +
    `Acima da entrada há uma placa retangular grande, plana, ${LISA}, de frente para a câmera, ocupando cerca de um terço da largura da imagem.`,
  social:
    (n) =>
      `Fotografia realista de uma mão segurando um smartphone moderno na vertical, a tela de frente para a câmera, ` +
      `tela totalmente branca e lisa, acesa, sem interface, sem ícones e sem reflexo forte, ocupando boa parte da imagem. ` +
      `Fundo desfocado de um ambiente ligado a ${n}.`,
  papelaria: (n) =>
    `Fotografia realista vista de cima de uma mesa de trabalho de ${n}, com uma folha A4 e um cartão de visita apoiados na mesa, ` +
    `a folha ${LISA}, o cartão também branco e liso, uma caneta ao lado, luz natural suave.`,
  embalagem: (n) =>
    `Fotografia realista de produto: uma caixa de embalagem de ${n} em pé sobre um balcão, a face da frente virada para a câmera em ângulo suave, ` +
    `a face da frente ${LISA}, fundo do ambiente desfocado.`,
  veiculo: (n) =>
    `Fotografia realista, de dia, de uma van de entrega branca estacionada numa rua limpa, vista de lado, a van inteira na imagem, ` +
    `a lateral de carga plana ${LISA}, sem janelas na área de carga, ligada ao dia a dia de ${n}.`,
  vestuario: (n) =>
    `Fotografia realista de uma camiseta branca lisa de uniforme dobrada com cuidado sobre uma superfície clara, vista de cima, ` +
    `a camiseta inteira aparecendo, tecido branco sem estampa, no ambiente de ${n}.`,
  sinalizacao: (n) =>
    `Fotografia realista de um totem de sinalização retangular em pé na entrada de ${n}, a face da frente virada para a câmera, ` +
    `a face da frente ${LISA}, ocupando boa parte da altura da imagem.`,
  digital: (n) =>
    `Fotografia realista de uma TV de parede grande sobre o balcão de ${n}, vista de frente em ângulo suave, ` +
    `a tela acesa ${LISA}, sem interface.`,
};

/** O texto pedido ao gerador. A área lisa é o que o código depois acha e preenche com a marca. */
export function promptDaCena(tipo: TipoDeCena, cliente: ClienteParaSugestao, cores: string[], pedido: string): string {
  const negocio = cliente.negocio ? cliente.negocio.slice(0, 240) : "um pequeno negócio local";
  const paleta = cores.length ? ` Detalhes discretos do ambiente nas cores ${cores.slice(0, 3).join(", ")}.` : "";
  const extra = pedido.trim() ? ` Pedido da equipe: ${pedido.trim().slice(0, 300)}.` : "";
  return `${CENAS[tipo](negocio)}${paleta} ${SEM_TEXTO}${extra}`;
}
