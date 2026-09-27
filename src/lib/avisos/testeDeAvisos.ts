import type { EstadoDoAviso } from "@/lib/avisosDoNavegador";

/**
 * Teste de avisos do admin (frente N): um aviso para ele mesmo, e o que
 * aconteceu em cada canal. Lê o que as funções do banco
 * notificacoes_teste_disparar / notificacoes_teste_resultado devolvem.
 * Puro, para o teste.
 */

export interface DisparoDoTeste {
  notification_id: string | null;
  criado: boolean;
  email_pedido: boolean;
  request_id?: number | null;
  email_destino?: string | null;
  motivo_sem_email?: string | null;
}

export interface ResultadoDoTeste {
  sino?: { criado: boolean; lida?: boolean };
  email?: {
    pedido: boolean;
    http_status?: number | null;
    http_erro?: string | null;
    http_resposta?: string | null;
    envio_status?: string | null;
    envio_erro?: string | null;
  };
}

export type EstadoDaEtapa = "ok" | "esperando" | "falhou" | "desligado";

export interface EtapaDoTeste {
  canal: "Sino" | "E-mail" | "Navegador";
  estado: EstadoDaEtapa;
  texto: string;
}

export interface SinaisDaTela {
  /** O aviso de teste já apareceu na lista do sino (tempo real ou recarga). */
  chegouNoSino: boolean;
  navegador: EstadoDoAviso;
}

function etapaDoSino(disparo: DisparoDoTeste, tela: SinaisDaTela): EtapaDoTeste {
  if (!disparo.criado) {
    return { canal: "Sino", estado: "falhou", texto: disparo.motivo_sem_email || "O aviso não foi gravado." };
  }
  if (tela.chegouNoSino) return { canal: "Sino", estado: "ok", texto: "Chegou no sino." };
  return { canal: "Sino", estado: "esperando", texto: "Gravado. Esperando o sino atualizar." };
}

function etapaDoEmail(disparo: DisparoDoTeste, resultado: ResultadoDoTeste | null): EtapaDoTeste {
  if (!disparo.criado) return { canal: "E-mail", estado: "falhou", texto: "Sem aviso, sem e-mail." };
  if (!disparo.email_pedido) {
    return { canal: "E-mail", estado: "falhou", texto: disparo.motivo_sem_email || "O banco não pediu o e-mail." };
  }
  const email = resultado?.email;
  const destino = disparo.email_destino ? ` para ${disparo.email_destino}` : "";
  const envio = email?.envio_status || null;
  if (envio === "sent") return { canal: "E-mail", estado: "ok", texto: `Enviado${destino}.` };
  if (envio === "suppressed") {
    return { canal: "E-mail", estado: "falhou", texto: "Este endereço está descadastrado dos e-mails." };
  }
  if (envio === "dlq" || envio === "failed") {
    return { canal: "E-mail", estado: "falhou", texto: `O envio falhou: ${email?.envio_erro || "sem detalhe"}.` };
  }
  const status = email?.http_status ?? null;
  if (status !== null && status >= 300) {
    const dica = status === 401
      ? " O portão recusou: confira a chave email_queue_service_role_key no cofre."
      : "";
    return { canal: "E-mail", estado: "falhou", texto: `A função de e-mail respondeu ${status}.${dica}` };
  }
  if (email?.http_erro) {
    return { canal: "E-mail", estado: "falhou", texto: `A chamada da função de e-mail falhou: ${email.http_erro}.` };
  }
  if (envio === "pending") return { canal: "E-mail", estado: "esperando", texto: "Na fila de envio." };
  return { canal: "E-mail", estado: "esperando", texto: "Pedido feito. Esperando a função de e-mail." };
}

function etapaDoNavegador(tela: SinaisDaTela): EtapaDoTeste {
  switch (tela.navegador) {
    case "indisponivel":
      return { canal: "Navegador", estado: "desligado", texto: "Este navegador não mostra avisos do painel." };
    case "bloqueado":
      return { canal: "Navegador", estado: "desligado", texto: "Bloqueado neste site. Libere nas configurações do navegador." };
    case "pedir":
      return { canal: "Navegador", estado: "desligado", texto: "Desligado. Use Ativar avisos no navegador." };
    default:
      return tela.chegouNoSino
        ? { canal: "Navegador", estado: "ok", texto: "Mostrado no canto da tela. Se não viu, confira o modo Não perturbe." }
        : { canal: "Navegador", estado: "esperando", texto: "Ligado. Aparece quando o sino atualizar." };
  }
}

export function etapasDoTeste(
  disparo: DisparoDoTeste,
  resultado: ResultadoDoTeste | null,
  tela: SinaisDaTela,
): EtapaDoTeste[] {
  return [etapaDoSino(disparo, tela), etapaDoEmail(disparo, resultado), etapaDoNavegador(tela)];
}

export function testeTerminou(etapas: readonly EtapaDoTeste[]): boolean {
  return etapas.every((etapa) => etapa.estado !== "esperando");
}
