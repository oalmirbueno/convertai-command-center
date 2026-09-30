/**
 * Falha registrada (frente FS, 29/09/2026): nenhuma ação termina "com sucesso"
 * quando a parte importante falhou.
 *
 * Regras que este módulo sustenta:
 * - Todo erro engolido vai para o log com o motivo (`registrarFalha`).
 * - Saldo, cota e chave nunca são engolidos (`erroQueSobe`): quem chama deixa
 *   subir e a função responde no padrão STATUS_MOTOR / MENSAGEM_MOTOR.
 * - O motivo que vai para a tela é curto e legível (`motivoDaFalha`).
 *
 * Módulo puro (sem Deno nem Supabase): roda no vitest e nas funções. Não
 * importa o motor: reconhece o erro pelo `codigo` (IaMotorErro e parecidos).
 */

/** Códigos do motor que dizem "sem dinheiro ou sem chave": param a ação, nunca viram "não havia nada". */
export const CODIGOS_QUE_SOBEM: ReadonlySet<string> = new Set([
  "saldo_insuficiente",
  "cota_da_chave_esgotada",
  "cliente_sem_chave",
  "provedor_sem_chave",
  "chave_indisponivel",
  "provedor_sem_credito",
  "openrouter_sem_credito",
]);

function codigoDe(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const c = (e as { codigo?: unknown }).codigo;
  return typeof c === "string" && c ? c : null;
}

/** Saldo, cota ou chave do motor de IA: quem pegou o erro deixa subir. O Jev (JevErro) tem os códigos dele e não entra. */
export function erroQueSobe(e: unknown): boolean {
  const c = codigoDe(e);
  if (!c || !CODIGOS_QUE_SOBEM.has(c)) return false;
  return (e as { name?: unknown }).name !== "JevErro";
}

/** Motivo curto e legível de qualquer erro (Error, erro do banco em objeto, texto). */
export function motivoDaFalha(e: unknown, max = 300): string {
  let texto = "";
  if (e instanceof Error) {
    texto = e.message || e.name;
  } else if (typeof e === "string") {
    texto = e;
  } else if (e && typeof e === "object") {
    const o = e as { message?: unknown; mensagem?: unknown; code?: unknown };
    texto = typeof o.message === "string" ? o.message : typeof o.mensagem === "string" ? o.mensagem : "";
    if (!texto && typeof o.code === "string") texto = o.code;
  }
  const c = codigoDe(e);
  if (c && texto.indexOf(c) < 0) texto = texto ? `${c}: ${texto}` : c;
  texto = texto.replace(/\s+/g, " ").trim();
  return (texto || "falha desconhecida").slice(0, max);
}

/** Log da falha (console.error) com o motivo; devolve o motivo para ir na resposta. */
export function registrarFalha(onde: string, e: unknown, extra: Record<string, unknown> = {}): string {
  const motivo = motivoDaFalha(e);
  const codigo = codigoDe(e);
  console.error(onde, { ...extra, ...(codigo ? { codigo } : {}), motivo });
  return motivo;
}

/** Para `.catch(...)` de passo opcional: registra e devolve null. */
export function nuloComLog(onde: string, extra: Record<string, unknown> = {}): (e: unknown) => null {
  return (e: unknown) => {
    registrarFalha(onde, e, extra);
    return null;
  };
}

/** Para `.catch(...)` de passo opcional que cobra IA: saldo, cota e chave sobem; o resto é registrado e vira null. */
export function nuloComLogOuSobe(onde: string, extra: Record<string, unknown> = {}): (e: unknown) => null {
  return (e: unknown) => {
    if (erroQueSobe(e)) throw e;
    registrarFalha(onde, e, extra);
    return null;
  };
}

/**
 * Para a escrita no banco que não bloqueia a resposta (mensagem de sistema na
 * conversa, soltar trava, zerar um campo derivado). O supabase-js não rejeita
 * em erro de banco: devolve `{ error }`. Quem usa `.then(() => undefined, () => undefined)`
 * perde a falha sem rastro. Estes dois callbacks leem o `{ error }` e a
 * rejeição, registram com `registrarFalha` e nunca lançam.
 *
 * Uso: `await Promise.resolve(db.from("t").update(x).eq("id", id)).then(...registrarSeFalhar("onde", { client_id }))`.
 * Tolerante: resposta sem `error` (banco falso dos testes) passa calada.
 */
export function registrarSeFalhar(onde: string, extra: Record<string, unknown> = {}): [(r: unknown) => void, (e: unknown) => void] {
  return [
    (r: unknown) => {
      const erro = r && typeof r === "object" ? (r as { error?: unknown }).error : null;
      if (erro) registrarFalha(onde, erro, extra);
    },
    (e: unknown) => {
      registrarFalha(onde, e, extra);
    },
  ];
}
