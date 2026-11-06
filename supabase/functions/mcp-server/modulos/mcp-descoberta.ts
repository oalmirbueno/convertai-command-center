/**
 * O GET do mcp-server (Streamable HTTP).
 *
 * A especificação deixa o GET para um único uso: o cliente abrir um stream
 * SSE, e para isso ele PRECISA listar `text/event-stream` no Accept. Quem
 * não tem stream responde 405 a esse pedido. Nada impede o mesmo endereço de
 * responder outra coisa a um GET que não pede stream, e era disso que o
 * painel precisava: o cartão "Servidor MCP" faz um GET com Bearer para ler
 * nome, versão e protocolo, e recebia 405 ("HTTP 405" na tela).
 *
 * As três respostas, sem mexer no POST:
 * - sem Authorization: 401 com o desafio OAuth (RFC 9728). O ChatGPT depende
 *   disso para descobrir o OAuth; um 200 aqui quebra a conexão dele;
 * - pedindo stream (Accept com text/event-stream explícito): 405, como antes;
 * - o resto (o fetch do navegador manda `*∕*`): a descoberta pública, com o
 *   mesmo que o `initialize` já conta a qualquer um. Nada de dono, repositório
 *   ou branch do Segundo Cérebro: só se está configurado ou não.
 */

export type RespostaDoGet = "desafio_oauth" | "sem_stream" | "descoberta";

/** O Accept lista `text/event-stream` com todas as letras? `*∕*` e `text/*` não contam. */
export function getPedeStream(accept: string | null | undefined): boolean {
  return (accept ?? "")
    .toLowerCase()
    .split(",")
    .map((parte) => parte.split(";", 1)[0].trim())
    .indexOf("text/event-stream") >= 0;
}

export function decidirGet(cabecalhos: {
  authorization: string | null | undefined;
  accept: string | null | undefined;
}): RespostaDoGet {
  if (!(cabecalhos.authorization ?? "").trim()) return "desafio_oauth";
  if (getPedeStream(cabecalhos.accept)) return "sem_stream";
  return "descoberta";
}

export interface DescobertaDoMcp {
  name: string;
  title: string | null;
  version: string;
  status: "ok";
  protocolVersion: string;
  transport: "streamable-http";
  toolCount: number;
  endpoint: string | null;
  serverTime: string;
  secondBrain: { configured: boolean };
}

export function descobertaDoMcp(dados: {
  servidor: { name: string; version: string; title?: string };
  protocolVersion: string;
  toolCount: number;
  endpoint?: string | null;
  segundoCerebroConfigurado: boolean;
  agora?: Date;
}): DescobertaDoMcp {
  return {
    name: dados.servidor.name,
    title: dados.servidor.title ?? null,
    version: dados.servidor.version,
    status: "ok",
    protocolVersion: dados.protocolVersion,
    transport: "streamable-http",
    toolCount: dados.toolCount,
    endpoint: dados.endpoint ?? null,
    serverTime: (dados.agora ?? new Date()).toISOString(),
    secondBrain: { configured: dados.segundoCerebroConfigurado === true },
  };
}
