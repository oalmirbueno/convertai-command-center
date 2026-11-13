/**
 * A porta MCP do CRM da empresa (13/11/2026): é por ela que o Claude e o
 * ChatGPT leem e mexem no funil. JSON-RPC 2.0 sobre HTTP (uma resposta JSON
 * por pedido). As ferramentas chamam as mesmas operações da API REST.
 */
import { ErroDaApi, type Operacoes } from "./operacoes.ts";

type Esquema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
interface Ferramenta {
  name: string;
  title: string;
  description: string;
  inputSchema: Esquema;
  /** Só lê: o assistente pode chamar sem pedir confirmação. */
  leitura: boolean;
  rodar: (o: Operacoes, a: Record<string, unknown>) => Promise<unknown>;
}

const t = (description: string) => ({ type: "string", description });
const n = (description: string) => ({ type: "number", description });
const objeto = (properties: Record<string, unknown>, required: string[] = []): Esquema => ({ type: "object", properties, required, additionalProperties: false });

const CAMPOS_DO_NEGOCIO = {
  nome: t("Nome da pessoa de contato (ou da empresa, se não houver pessoa)."),
  empresa: t("Nome da empresa."),
  email: t("E-mail do contato."),
  whatsapp: t("WhatsApp ou telefone, com DDD."),
  etapa: t("Etapa do funil: novo, contato, diagnostico, proposta, negociacao, ganho ou perdido. Aceita também o nome que a empresa deu à etapa."),
  valor_mensal: n("Valor mensal do negócio, em reais."),
  valor_entrada: n("Valor pago uma vez (entrada ou projeto), em reais."),
  proximo_passo: t("O próximo passo combinado, em uma frase."),
  notas: t("Contexto livre sobre o negócio."),
  previsao: t("Data prevista de fechamento, AAAA-MM-DD."),
  responsavel_email: t("E-mail de quem da equipe fica responsável."),
};

export const FERRAMENTAS: Ferramenta[] = [
  { name: "crm_resumo", title: "Resumo do CRM", leitura: true, description: "A empresa, o plano, quantos negócios existem e os nomes das etapas do funil. Comece por aqui.", inputSchema: objeto({}), rodar: (o) => o.eu() },
  { name: "crm_funil", title: "Funil por etapa", leitura: true, description: "Quantos negócios e quanto dinheiro há em cada etapa do funil.", inputSchema: objeto({}), rodar: (o) => o.resumoDoFunil() },
  {
    name: "crm_listar_negocios", title: "Listar negócios", leitura: true,
    description: "Lista os negócios do funil, do mais recente para o mais antigo. Filtra por etapa ou por texto (nome, empresa ou e-mail).",
    inputSchema: objeto({ etapa: CAMPOS_DO_NEGOCIO.etapa, busca: t("Texto para procurar no nome, na empresa ou no e-mail."), abertos: { type: "boolean", description: "true para trazer só o que não foi ganho nem perdido." }, limite: n("Quantos por página, até 100. Padrão 25."), pagina: n("Página, começando em 1.") }),
    rodar: (o, a) => o.listarNegocios(a),
  },
  { name: "crm_ver_negocio", title: "Ver um negócio", leitura: true, description: "Os dados de um negócio e a história recente dele (mudanças de etapa e anotações).", inputSchema: objeto({ id: t("Id do negócio.") }, ["id"]), rodar: (o, a) => o.lerNegocio(a) },
  {
    name: "crm_criar_negocio", title: "Criar negócio", leitura: false,
    description: "Cadastra um negócio novo no funil. Se já houver um negócio aberto com o mesmo e-mail ou WhatsApp, devolve o que existe em vez de duplicar.",
    inputSchema: objeto({ ...CAMPOS_DO_NEGOCIO, origem: t("De onde veio: indicacao, instagram, prospeccao, evento, site ou manual.") }, ["nome"]),
    rodar: (o, a) => o.criarNegocio(a),
  },
  {
    name: "crm_atualizar_negocio", title: "Atualizar ou mover negócio", leitura: false,
    description: "Muda dados de um negócio ou move de etapa. Só o que for enviado muda. Para marcar como perdido, envie também o motivo.",
    inputSchema: objeto({ id: t("Id do negócio."), ...CAMPOS_DO_NEGOCIO, motivo: t("Motivo da perda (obrigatório ao mover para perdido).") }, ["id"]),
    rodar: (o, a) => o.atualizarNegocio(a),
  },
  { name: "crm_anotar", title: "Anotar no negócio", leitura: false, description: "Registra uma anotação na história do negócio (o que foi conversado, o que ficou combinado).", inputSchema: objeto({ id: t("Id do negócio."), texto: t("A anotação.") }, ["id", "texto"]), rodar: (o, a) => o.anotar(a) },
  { name: "crm_listar_empresas", title: "Listar empresas", leitura: true, description: "As fichas de empresa cadastradas no CRM.", inputSchema: objeto({ busca: t("Parte do nome."), limite: n("Até 100. Padrão 50.") }), rodar: (o, a) => o.listarEmpresas(a) },
  {
    name: "crm_listar_compromissos", title: "Listar compromissos", leitura: true,
    description: "Os compromissos em aberto (ligações, reuniões, tarefas), do mais próximo para o mais distante.",
    inputSchema: objeto({ negocio_id: t("Só os de um negócio."), todos: { type: "boolean", description: "true inclui os já concluídos." }, limite: n("Até 100. Padrão 30.") }),
    rodar: (o, a) => o.listarCompromissos(a),
  },
  {
    name: "crm_criar_compromisso", title: "Marcar compromisso", leitura: false,
    description: "Marca um compromisso num negócio: ligação, reunião ou tarefa, com data e hora.",
    inputSchema: objeto({ negocio_id: t("Id do negócio."), titulo: t("O que é."), quando: t("Data e hora em ISO 8601, com fuso. Ex.: 2026-11-20T14:00:00-03:00."), tipo: t("ligacao, reuniao, tarefa, email ou whatsapp. Padrão tarefa."), notas: t("Detalhes.") }, ["negocio_id", "titulo", "quando"]),
    rodar: (o, a) => o.criarCompromisso(a),
  },
  { name: "crm_concluir_compromisso", title: "Concluir compromisso", leitura: false, description: "Marca um compromisso como feito.", inputSchema: objeto({ id: t("Id do compromisso.") }, ["id"]), rodar: (o, a) => o.concluirCompromisso(a) },
];

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface Pedido {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const resposta = (id: Pedido["id"], result: unknown) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, result });
const erro = (id: Pedido["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });

/**
 * Responde um pedido MCP. Devolve null para notificação (sem id): o HTTP
 * responde 202 sem corpo. Erro de ferramenta volta como resultado com
 * isError, para o assistente ler a frase e se corrigir.
 */
export async function responderMcp(pedido: Pedido, operacoes: Operacoes, empresa: string): Promise<Record<string, unknown> | null> {
  if (!pedido || pedido.jsonrpc !== "2.0" || typeof pedido.method !== "string") return erro(pedido && pedido.id, -32600, "Pedido inválido.");
  const semResposta = pedido.id === undefined || pedido.id === null;
  if (pedido.method.indexOf("notifications/") === 0) return null;
  const params = pedido.params || {};

  if (pedido.method === "initialize") {
    const pedida = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    return resposta(pedido.id, {
      protocolVersion: VERSOES.indexOf(pedida) >= 0 ? pedida : VERSOES[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "aceleriq-crm", title: `CRM de ${empresa}`, version: "1.0.0" },
      instructions: `Este é o CRM da empresa ${empresa}. Use crm_resumo para conhecer as etapas do funil antes de criar ou mover negócios. Valores são em reais. Antes de criar, atualizar, mover ou anotar, confirme com a pessoa o que vai ser gravado.`,
    });
  }
  if (pedido.method === "ping") return resposta(pedido.id, {});
  if (pedido.method === "tools/list") {
    return resposta(pedido.id, {
      tools: FERRAMENTAS.map((f) => ({ name: f.name, title: f.title, description: f.description, inputSchema: f.inputSchema, annotations: { title: f.title, readOnlyHint: f.leitura, destructiveHint: false, openWorldHint: false } })),
    });
  }
  if (pedido.method === "tools/call") {
    const nome = typeof params.name === "string" ? params.name : "";
    const ferramenta = FERRAMENTAS.filter((f) => f.name === nome)[0];
    if (!ferramenta) return erro(pedido.id, -32602, `Ferramenta desconhecida: ${nome}.`);
    const argumentos = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
    try {
      const resultado = await ferramenta.rodar(operacoes, argumentos);
      return resposta(pedido.id, { content: [{ type: "text", text: JSON.stringify(resultado) }], structuredContent: resultado, isError: false });
    } catch (e) {
      const frase = e instanceof ErroDaApi ? e.message : "Falha inesperada no CRM. Tente de novo.";
      return resposta(pedido.id, { content: [{ type: "text", text: frase }], isError: true });
    }
  }
  if (semResposta) return null;
  return erro(pedido.id, -32601, `Método desconhecido: ${pedido.method}.`);
}
