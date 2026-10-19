/**
 * Só trava para o dono o que só o dono resolve (19/10/2026).
 *
 * O dono: "tem muitos bloqueios e a dificuldade para desbloquear... proíbe demais
 * os agentes de trabalhar". Dos 11 vínculos travados, 1 dependia dele. Os outros
 * eram conferência interna, rodada que expirou ou tarefa já excluída.
 *
 * Regra: o agente só para esperando o dono por dinheiro, acesso ou senha que só
 * ele tem, aprovação de algo que vai ao cliente, ou decisão de estratégia. O resto
 * segue: o revisor confere e desempata (até 2 rodadas).
 *
 * Arquivo puro (sem Deno, sem banco): a pergunta ao Jev e a decisão a partir da
 * resposta. Quem chama o Jev é aceleriq-operators-services.ts.
 */

export const MOTIVOS_DO_DONO = ["dinheiro", "acesso_ou_senha", "aprovar_para_cliente", "decisao_de_estrategia"] as const;
export type MotivoDoDono = (typeof MOTIVOS_DO_DONO)[number];

export const ROTULO_DO_MOTIVO: Record<MotivoDoDono, string> = {
  dinheiro: "dinheiro",
  acesso_ou_senha: "acesso ou senha",
  aprovar_para_cliente: "aprovar para o cliente",
  decisao_de_estrategia: "decisão de estratégia",
};

/** Probabilidade mínima de "o time resolve" para não travar. Com dúvida, trava. */
export const CORTE_DO_TIME = 0.75;

export function perguntaDaTrava() {
  return {
    type: "choice" as const,
    instructions:
      "Um agente de uma agência de marketing parou uma tarefa e escreveu o motivo em `trava.motivo` (e o que destravaria em `trava.o_que_destrava`). Decida se SÓ o dono da agência pode resolver isso, e por qual razão, ou se a própria equipe de agentes resolve sozinha (conferindo, refazendo, pesquisando, pedindo a outro agente ou ao revisor, ou tentando de novo).",
    criteria: {
      dinheiro: "Precisa de dinheiro do dono: recarga de saldo, pagamento, aumento de verba, compra.",
      acesso_ou_senha: "Precisa de um acesso, login, senha, código de verificação, convite ou permissão que só o dono tem ou concede.",
      aprovar_para_cliente: "Precisa da aprovação do dono para algo que vai ao cliente ou ao público: publicar, enviar, subir anúncio, mostrar uma peça.",
      decisao_de_estrategia: "Precisa de uma decisão de negócio do dono: escolher entre caminhos, mudar o combinado com o cliente, aceitar um risco, parar ou continuar um trabalho.",
      o_time_resolve: "A equipe resolve sem o dono: conferência interna, divergência de dados, prova faltando, revisão, erro técnico, rodada que caiu, informação que dá para buscar ou pedir a outro agente.",
    },
  };
}

export type RespostaDaTrava = { choice?: string; probabilities?: Record<string, number> };

export type DecisaoDaTrava = {
  trava: boolean;
  motivo: MotivoDoDono | null;
  fonte: "agente" | "jev" | "sem_julgamento";
};

export function decidirTrava(entrada: { precisaDoDono?: string | null; jev?: RespostaDaTrava | null }): DecisaoDaTrava {
  const declarado = entrada.precisaDoDono && (MOTIVOS_DO_DONO as readonly string[]).includes(entrada.precisaDoDono)
    ? (entrada.precisaDoDono as MotivoDoDono)
    : null;
  if (declarado) return { trava: true, motivo: declarado, fonte: "agente" };
  const r = entrada.jev;
  if (!r || typeof r.choice !== "string") return { trava: true, motivo: null, fonte: "sem_julgamento" };
  const pTime = Number(r.probabilities?.o_time_resolve ?? (r.choice === "o_time_resolve" ? 1 : 0));
  if (r.choice === "o_time_resolve" && pTime >= CORTE_DO_TIME) return { trava: false, motivo: null, fonte: "jev" };
  const motivo = (MOTIVOS_DO_DONO as readonly string[]).includes(r.choice) ? (r.choice as MotivoDoDono) : null;
  return { trava: true, motivo, fonte: "jev" };
}
