/**
 * Conselho de agentes, segunda leva (frente BRF2, 30/09/2026): presets por
 * tema (marca, campanha, proposta, site, crise), os modos (rápido, padrão e
 * profundo) e a pauta com anexos.
 *
 * - Preset: um ponto de partida (elenco, critérios, modo e a pergunta
 *   modelo); a pessoa troca o que quiser antes de convocar.
 * - Modo rápido: 1 rodada de propostas e a síntese do moderador, respostas
 *   curtas e sem raciocínio estendido (barato). Profundo: as 4 rodadas, mais
 *   espaço e raciocínio médio quando o modelo aceita. O custo aparece antes
 *   em todos.
 * - Pauta: itens que o conselho precisa cobrir e até 5 arquivos do cliente
 *   (o trecho de texto que o painel já extraiu de cada um).
 *
 * Puro: sem Deno e sem npm. Sem travessão.
 */

export const MODOS_DO_CONSELHO = ["rapido", "padrao", "profundo"] as const;
export type ModoDoConselho = typeof MODOS_DO_CONSELHO[number];

export type DefinicaoDoModo = {
  id: ModoDoConselho;
  rotulo: string;
  /** Rodadas fixas do modo (null = a pessoa escolhe 3 ou 4). */
  rodadas: 2 | 4 | null;
  /** Multiplica o tamanho estimado de cada fala (entrada e saída). */
  fator: number;
  /** Teto de saída por fala (tokens). */
  maxSaida: number;
  /** Raciocínio pedido ao modelo, quando ele aceita. */
  raciocinio: Array<"minimal" | "low" | "medium" | "high">;
  /** Linha que entra no pedido de cada fala. */
  instrucao: string;
};

export const MODOS: Record<ModoDoConselho, DefinicaoDoModo> = {
  rapido: {
    id: "rapido",
    rotulo: "Rápido",
    rodadas: 2,
    fator: 0.45,
    maxSaida: 1_400,
    raciocinio: ["minimal", "low"],
    instrucao: "MODO RÁPIDO: seja direto. Ideia em até 5 frases, até 3 passos e até 2 riscos.",
  },
  padrao: {
    id: "padrao",
    rotulo: "Padrão",
    rodadas: null,
    fator: 1,
    maxSaida: 3_500,
    raciocinio: ["low", "minimal", "medium"],
    instrucao: "",
  },
  profundo: {
    id: "profundo",
    rotulo: "Profundo",
    rodadas: 4,
    fator: 1.35,
    maxSaida: 5_000,
    raciocinio: ["medium", "low"],
    instrucao: "MODO PROFUNDO: vá fundo. Considere alternativas, riscos de segunda ordem e como medir. Seja específico para este cliente.",
  },
};

export const ehModo = (v: unknown): v is ModoDoConselho => typeof v === "string" && (MODOS_DO_CONSELHO as readonly string[]).indexOf(v) >= 0;
export const modoDe = (v: unknown): ModoDoConselho => (ehModo(v) ? v : "padrao");

/** Rodadas que valem para o modo (rápido 2, profundo 4, padrão o pedido). */
export function rodadasDoModo(modo: ModoDoConselho, pedidas: number): number {
  const fixas = MODOS[modo].rodadas;
  return fixas !== null ? fixas : Math.round(Number(pedidas));
}

// ------------------------------------------------------------------ presets por tema

export const PRESETS = ["marca", "campanha", "proposta", "site", "crise"] as const;
export type IdDoPreset = typeof PRESETS[number];

export type PresetDoConselho = {
  id: IdDoPreset;
  nome: string;
  /** A origem que decide quem pode entrar (mesmas regras de especialistasDaOrigem). */
  origem: string;
  especialistas: string[];
  criterios: string[];
  modo: ModoDoConselho;
  rodadas: number;
  tema: string;
  pergunta: string;
};

export const PRESETS_DO_CONSELHO: Record<IdDoPreset, PresetDoConselho> = {
  marca: {
    id: "marca",
    nome: "Marca",
    origem: "mesa-identidade",
    especialistas: ["estrategista_marca", "diretor_arte", "copywriter", "especialista_nicho", "cetico"],
    criterios: ["diferença real diante dos concorrentes", "coerente com o público", "viável com o que o cliente tem", "memorável", "acima da média (nada genérico)"],
    modo: "padrao",
    rodadas: 4,
    tema: "Posicionamento da marca",
    pergunta: "Qual posicionamento deixa esta marca mais dela e menos parecida com os concorrentes, e como isso aparece no visual e no texto?",
  },
  campanha: {
    id: "campanha",
    nome: "Campanha",
    origem: "mesa-publicidade",
    especialistas: ["performance", "copywriter", "diretor_arte", "comercial", "cetico"],
    criterios: ["responde ao objetivo da campanha", "mensagem clara em uma frase", "teste barato antes de escalar", "viável com o material real", "acima da média (nada genérico)"],
    modo: "padrao",
    rodadas: 4,
    tema: "Ideia da campanha",
    pergunta: "Qual ideia de campanha tem mais chance de gerar o resultado pedido, com qual mensagem, quais peças e como medir?",
  },
  proposta: {
    id: "proposta",
    nome: "Proposta",
    origem: "mesa-proposta",
    especialistas: ["comercial", "estrategista_marca", "copywriter", "cetico"],
    criterios: ["resolve a dor do cliente", "escopo claro e verificável", "preço justificável pelo valor", "objeções respondidas", "sem promessa de resultado"],
    modo: "padrao",
    rodadas: 3,
    tema: "Estratégia da proposta",
    pergunta: "Como montar a proposta para este cliente: que escopo, em que ordem, qual argumento principal e quais objeções responder?",
  },
  site: {
    id: "site",
    nome: "Site",
    origem: "mesa-site",
    especialistas: ["ux", "diretor_arte", "copywriter", "performance", "cetico"],
    criterios: ["o visitante entende em 5 segundos", "caminho claro até a ação principal", "rápido e legível no celular", "coerente com a marca", "acima da média (nada genérico)"],
    modo: "padrao",
    rodadas: 4,
    tema: "Estrutura e mensagem do site",
    pergunta: "Qual estrutura de páginas, mensagem da primeira dobra e ação principal o site precisa ter para este cliente?",
  },
  crise: {
    id: "crise",
    nome: "Crise",
    origem: "painel-crise",
    especialistas: ["gestao_crise", "estrategista_marca", "copywriter", "comercial", "cetico"],
    criterios: ["protege a confiança do público", "responde rápido sem se contradizer", "assume o que é da marca e só o que é", "tom humano e respeitoso", "tem plano para as próximas 48 horas"],
    modo: "rapido",
    rodadas: 2,
    tema: "Resposta à crise",
    pergunta: "O que a marca deve fazer e dizer agora sobre o que aconteceu, em quais canais, e o que acompanhar nas próximas 48 horas?",
  },
};

export const ehPreset = (v: unknown): v is IdDoPreset => typeof v === "string" && (PRESETS as readonly string[]).indexOf(v) >= 0;

// ------------------------------------------------------------------ pauta

export type AnexoDaPauta = { file_id: string; nome: string; trecho: string };
export type PautaDoConselho = { itens: string[]; anexos: AnexoDaPauta[] };

export const MAX_ITENS_DA_PAUTA = 8;
export const MAX_ANEXOS_DA_PAUTA = 5;
export const MAX_TRECHO_DO_ANEXO = 2_500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\u2014|\u2013/g, ",").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Pauta que veio da tela: itens curtos e ids de arquivo (o trecho a função lê do banco). */
export function pautaDoPedido(bruto: unknown): { itens: string[]; anexos: string[] } {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const itens = (Array.isArray(o.itens) ? o.itens : []).map((x) => limpo(x, 200)).filter((x) => x.length >= 2).slice(0, MAX_ITENS_DA_PAUTA);
  const anexos: string[] = [];
  (Array.isArray(o.anexos) ? o.anexos : []).forEach((x) => {
    const id = String(x && typeof x === "object" ? (x as Record<string, unknown>).file_id || "" : x || "").trim();
    if (UUID.test(id) && anexos.indexOf(id) < 0 && anexos.length < MAX_ANEXOS_DA_PAUTA) anexos.push(id);
  });
  return { itens, anexos };
}

/** Pauta gravada na sessão (jsonb), lida sem confiar no formato. */
export function pautaDaLinha(bruto: unknown): PautaDoConselho {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const itens = (Array.isArray(o.itens) ? o.itens : []).map((x) => limpo(x, 200)).filter(Boolean).slice(0, MAX_ITENS_DA_PAUTA);
  const anexos: AnexoDaPauta[] = [];
  (Array.isArray(o.anexos) ? o.anexos : []).slice(0, MAX_ANEXOS_DA_PAUTA).forEach((x) => {
    if (!x || typeof x !== "object") return;
    const a = x as Record<string, unknown>;
    const id = String(a.file_id || "");
    if (!UUID.test(id)) return;
    anexos.push({ file_id: id, nome: limpo(a.nome, 160) || "arquivo", trecho: String(a.trecho || "").replace(/\u2014|\u2013/g, ",").slice(0, MAX_TRECHO_DO_ANEXO) });
  });
  return { itens, anexos };
}

/** O bloco da pauta nos DADOS de cada fala (vazio quando não há pauta). */
export function textoDaPauta(p: PautaDoConselho | null | undefined): string {
  if (!p || (!p.itens.length && !p.anexos.length)) return "";
  const partes: string[] = [];
  if (p.itens.length) partes.push(`PAUTA (o conselho precisa cobrir cada item):\n${p.itens.map((x, i) => `${i + 1}. ${x}`).join("\n")}`);
  if (p.anexos.length) {
    partes.push(`ANEXOS DA PAUTA (trechos dos arquivos do cliente):\n${p.anexos.map((a) => `[${a.nome}]\n${a.trecho || "(sem texto extraído; só o nome do arquivo)"}`).join("\n\n")}`);
  }
  return partes.join("\n\n");
}
