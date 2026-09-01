/**
 * Um vínculo de execução ainda espera decisão sua?
 *
 * A regra é simples — `approval_required` E não estar concluído — e por
 * isso mesmo foi repetida à mão em nove lugares, em quatro arquivos. Três
 * delas esqueceram a segunda metade, e o resultado foi o relato do dono:
 * "o botão de aprovação fica preso lá depois de concluir".
 *
 * A contagem dizia zero e o cartão continuava pedindo decisão. A tela
 * discordando dela mesma é pior que a tela errada: quem lê não sabe em
 * qual metade acreditar.
 *
 * Mora aqui para não haver duas formas de dizer a mesma coisa. Concluído
 * encerra o assunto: se o trabalho terminou, não há mais o que autorizar
 * nele — a aprovação que ficou pendurada perdeu o objeto.
 */
export function precisaDecisao(v: {
  approval_required?: boolean | null;
  status?: string | null;
}): boolean {
  return Boolean(v.approval_required) && v.status !== "done";
}

/**
 * O vínculo está parado esperando alguma coisa do humano?
 *
 * Junta a decisão pendente com os estados que, por definição, aguardam
 * gente. `done` fica de fora inteiro: um trabalho concluído não espera
 * nada, mesmo que tenha esperado no passado.
 */
export function esperandoVoce(v: {
  approval_required?: boolean | null;
  status?: string | null;
}): boolean {
  if (v.status === "done") return false;
  return precisaDecisao(v)
    || ["blocked", "awaiting_input", "review"].includes(String(v.status ?? ""));
}
