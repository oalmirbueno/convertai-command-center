/**
 * Ajudante do Jev (TypeSafe System One).
 *
 * Um unico lugar que fala com https://api.typesafe.ai/v1/systemone. Quem usa
 * monta o estado e as perguntas; aqui ficam a chave, o modelo, o tempo limite
 * e a leitura da resposta.
 *
 * Formato das perguntas (docs vivos em https://docs.typesafe.ai/api.md):
 * - choice: `criteria` e um objeto { opcao: descricao }. Resposta traz
 *   `choice`, `confidence` e `probabilities`.
 * - score: `criteria` e uma LISTA ORDENADA de niveis (2 a 10), do pior para o
 *   melhor. Resposta traz `score` (numero, pode ser fracionado), `legend`,
 *   `probabilities` e `confidence`.
 * - noul: sim ou nao. `criteria` opcional { true, false }. Resposta traz `noul`
 *   (probabilidade de sim, de 0 a 1).
 *
 * A chave fica so no servidor (TYPESAFE_API_KEY). Nunca registrar a chave nem
 * o estado em log: o estado costuma carregar dado de cliente.
 */

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODELO = "jev-latest";
export const JEV_TIMEOUT_MS = 20_000;

export type PerguntaChoice = {
  type: "choice";
  instructions: unknown;
  criteria: Record<string, unknown>;
};

export type PerguntaScore = {
  type: "score";
  instructions: unknown;
  /** Lista ordenada de niveis, do pior para o melhor. Objeto e recusado. */
  criteria: string[];
};

export type PerguntaNoul = {
  type: "noul";
  instructions: unknown;
  criteria?: { true: unknown; false: unknown };
};

export type PerguntaJev = PerguntaChoice | PerguntaScore | PerguntaNoul;

export type RespostaJev = {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  score?: number;
  legend?: Record<string, unknown>;
  noul?: number;
};

export type ResultadoJev = {
  answers: Record<string, RespostaJev>;
  usage: { input_tokens?: number; output_tokens?: number } | null;
  modelo: string;
};

export class JevErro extends Error {
  codigo: "jev_sem_chave" | "jev_pergunta_invalida" | "jev_http" | "jev_timeout" | "jev_resposta_invalida";
  status?: number;
  constructor(codigo: JevErro["codigo"], mensagem: string, status?: number) {
    super(mensagem);
    this.name = "JevErro";
    this.codigo = codigo;
    this.status = status;
  }
}

function validarPerguntas(questions: Record<string, PerguntaJev>) {
  const ids = Object.keys(questions);
  if (ids.length === 0) throw new JevErro("jev_pergunta_invalida", "nenhuma pergunta");
  for (const id of ids) {
    const q = questions[id];
    if (q.type === "score") {
      // Aprendido no uso real: criteria de Score como objeto volta 422.
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10) {
        throw new JevErro("jev_pergunta_invalida", `score ${id}: criteria precisa ser lista ordenada de 2 a 10 niveis`);
      }
    } else if (q.type === "choice") {
      if (!q.criteria || typeof q.criteria !== "object" || Array.isArray(q.criteria) || Object.keys(q.criteria).length < 2) {
        throw new JevErro("jev_pergunta_invalida", `choice ${id}: criteria precisa ser objeto com ao menos 2 opcoes`);
      }
    } else if (q.type !== "noul") {
      throw new JevErro("jev_pergunta_invalida", `tipo desconhecido em ${id}`);
    }
  }
}

/**
 * Faz as perguntas ao Jev sobre o estado dado e devolve as respostas por id.
 * `chave` e `fetchImpl` existem para teste; em producao vem do ambiente.
 */
export async function jevPerguntar(
  { state, questions }: { state: unknown; questions: Record<string, PerguntaJev> },
  opcoes: { chave?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ResultadoJev> {
  const chave = (opcoes.chave ?? Deno.env.get("TYPESAFE_API_KEY") ?? "").trim();
  if (!chave) throw new JevErro("jev_sem_chave", "TYPESAFE_API_KEY ausente");
  validarPerguntas(questions);

  const f = opcoes.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(JEV_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state, model: JEV_MODELO, questions }),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? JEV_TIMEOUT_MS),
    });
  } catch (err) {
    const nome = err instanceof Error ? err.name : "";
    if (nome === "TimeoutError" || nome === "AbortError") throw new JevErro("jev_timeout", "Jev nao respondeu a tempo");
    throw new JevErro("jev_http", "falha de rede ao chamar o Jev");
  }
  if (!res.ok) {
    // 429 e 529 pedem nova tentativa com espera; quem chama decide.
    await res.body?.cancel().catch(() => {});
    throw new JevErro("jev_http", `typesafe_${res.status}`, res.status);
  }
  const data = await res.json().catch(() => null) as { answers?: Record<string, RespostaJev>; usage?: ResultadoJev["usage"]; model?: string } | null;
  if (!data || typeof data.answers !== "object" || data.answers === null) {
    throw new JevErro("jev_resposta_invalida", "resposta do Jev sem answers");
  }
  return { answers: data.answers, usage: data.usage ?? null, modelo: data.model ?? JEV_MODELO };
}

/** Le a nota de um Score como numero (pode ser fracionada) ou null. */
export function notaScore(r: RespostaJev | undefined): number | null {
  return typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : null;
}

/** Le a probabilidade de sim de um Noul ou null. */
export function probabilidadeNoul(r: RespostaJev | undefined): number | null {
  return typeof r?.noul === "number" && Number.isFinite(r.noul) ? r.noul : null;
}
