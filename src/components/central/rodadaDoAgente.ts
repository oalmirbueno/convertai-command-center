import type { Aplicado, ClienteDoAgente, Preparo } from "./agenteCentralApi";

/**
 * A rodada do "Atualizar todos" (Agente da Central): o que fica guardado no
 * navegador e as leituras que o botão da Central e o pop-up usam para dizer
 * em que pé ela está.
 */

export type Situacao = "fila" | "lendo" | "perguntas" | "aplicando" | "publicando" | "pronto" | "erro" | "pulado";

export interface ItemDaRodada {
  cliente: ClienteDoAgente;
  incluir: boolean;
  situacao: Situacao;
  preparo: Preparo | null;
  respostas: string[];
  contexto: string;
  aplicado: Aplicado | null;
  aplicadoPara?: string;
  reportId: string | null;
  publicado: boolean;
  tarefasCriadas: number[];
  erro: string | null;
  /** Frente AG3: "Aprendi"/"Segui" do agente para este cliente (leitura, respostas, reescrita). */
  aprendizado?: unknown[];
  /** Frente AG3: canal em que o ritual saiu ("portal" ou "grupo", o "Enviei no grupo"). */
  canal?: "portal" | "grupo" | null;
}

export interface Rodada {
  pesquisar?: boolean;
  ritual: string;
  publicar: boolean;
  contextoGeral: string;
  itens: ItemDaRodada[];
  iniciadaEm: string;
}

export type Rodando = "lendo" | "aplicando" | null;

export type EtapaDoAgente = "ler" | "responder" | "aplicar" | "copiar";

export const CHAVE_LOCAL = "agente-central:rodada:v1";

export function lerLocal(): Rodada | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE_LOCAL);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rodada;
    return r && Array.isArray(r.itens) ? r : null;
  } catch {
    return null;
  }
}

export function gravarLocal(r: Rodada | null) {
  try {
    if (r) window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(r));
    else window.localStorage.removeItem(CHAVE_LOCAL);
  } catch {
    /* navegador sem armazenamento: a rodada só vive nesta aba */
  }
}

/** Perguntas de um cliente ainda sem resposta. */
export function perguntasSemResposta(item: ItemDaRodada): number {
  const perguntas = item.preparo?.perguntas ?? [];
  return perguntas.filter((_, k) => !(item.respostas[k] ?? "").trim()).length;
}

/** Quem já foi lido e ainda espera ser aplicado. */
const esperandoAplicar = (i: ItemDaRodada) => i.incluir && !!i.preparo && i.situacao !== "pronto";

export interface SeloDaRodada {
  texto: string;
  /** Versão curta para o celular. */
  curto: string;
  tom: "andamento" | "atencao" | "erro" | "ok" | "neutro";
}

/**
 * O selo pequeno ao lado do botão "Atualizar todos". Sem rodada guardada, não
 * há selo. A ordem diz o que importa primeiro: o que está rodando agora, as
 * perguntas que esperam o dono, o que deu erro, quem falta ler e, por fim,
 * os rituais prontos para copiar.
 */
export function seloDaRodada(rodada: Rodada | null, rodando: Rodando): SeloDaRodada | null {
  if (!rodada) return null;
  const dentro = rodada.itens.filter((i) => i.incluir);
  if (rodando === "lendo") {
    const lidos = dentro.filter((i) => i.preparo).length;
    return { texto: `Lendo ${lidos} de ${dentro.length}`, curto: `${lidos}/${dentro.length}`, tom: "andamento" };
  }
  if (rodando === "aplicando") {
    const alvo = dentro.filter((i) => i.preparo);
    const feitos = alvo.filter((i) => i.situacao === "pronto" || i.situacao === "erro").length;
    return { texto: `Aplicando ${feitos} de ${alvo.length}`, curto: `${feitos}/${alvo.length}`, tom: "andamento" };
  }
  const pendentes = dentro.filter((i) => i.situacao === "perguntas").reduce((soma, i) => soma + perguntasSemResposta(i), 0);
  if (pendentes > 0) {
    return { texto: `${pendentes} ${pendentes === 1 ? "pergunta esperando" : "perguntas esperando"}`, curto: `${pendentes} ${pendentes === 1 ? "pergunta" : "perguntas"}`, tom: "atencao" };
  }
  const erros = dentro.filter((i) => i.situacao === "erro").length;
  if (erros > 0) return { texto: `${erros} com erro`, curto: `${erros} com erro`, tom: "erro" };
  if (dentro.some((i) => i.situacao === "perguntas")) return { texto: "Pronto para aplicar", curto: "Aplicar", tom: "atencao" };
  const faltam = dentro.filter((i) => !i.preparo).length;
  if (faltam > 0 && faltam < dentro.length) return { texto: `${faltam} para ler`, curto: `${faltam} para ler`, tom: "atencao" };
  const prontos = dentro.filter((i) => i.situacao === "pronto" && i.aplicado?.ritual).length;
  if (prontos > 0 && !dentro.some(esperandoAplicar)) {
    return { texto: `${prontos} ${prontos === 1 ? "ritual pronto" : "rituais prontos"}`, curto: `${prontos} ${prontos === 1 ? "pronto" : "prontos"}`, tom: "ok" };
  }
  return { texto: "Rodada aberta", curto: "Aberta", tom: "neutro" };
}

/** A etapa em que o pop-up abre: onde está o próximo passo da rodada. */
export function etapaSugerida(rodada: Rodada | null, rodando: Rodando): EtapaDoAgente {
  if (rodando === "lendo") return "ler";
  if (rodando === "aplicando") return "aplicar";
  if (!rodada) return "ler";
  const dentro = rodada.itens.filter((i) => i.incluir);
  const lidos = dentro.filter((i) => i.preparo);
  if (lidos.length === 0) return "ler";
  if (lidos.some((i) => i.situacao !== "pronto")) return "responder";
  if (dentro.some((i) => !i.preparo)) return "ler";
  return "copiar";
}
