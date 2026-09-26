/**
 * Ações dos TEMPLATES que o agente de estilo propõe e a equipe confirma
 * (frente T, 26/09/2026; contrato comum: _shared/acoes-do-agente.ts). Ficam
 * num cartão próprio, ao lado do cartão do estilo (S2), na mesma mensagem.
 *
 * Apelidos: n1 é "template novo"; t1..tN são os templates e as referências de
 * carrossel ativos (do cliente e da agência); r1..rN são as mesmas imagens que
 * o estilo já lista (anexadas agora, artes aprovadas, referências do cliente);
 * m1 é o carrossel anexado nesta mensagem (imagens na ordem).
 *
 * - criar_template (n1): grava a proposta_de_template como template novo.
 * - atualizar_template (t*): a proposta vira versão nova do template.
 * - arquivar_template (t*): apagar é arquivar (volta com Desfazer).
 * - registrar_gosto_template (t*): "cliente gostou: ..." ou "dono não gostou: ...".
 * - ancora_no_template (r*): para "t2" ou "t2:capa" (papel da âncora).
 * - gerar_teste_template (t*): 1 a 4 imagens, custo antes, sem desfazer.
 * - guardar_referencia_carrossel (m1): guarda as imagens desta mensagem, na
 *   ordem, como referência de carrossel; para: o nome.
 *
 * Puro (a tela e o vitest leem). Sem travessão.
 */

import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  comApelido,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import {
  corpoAtual,
  type FormatoDoTemplate,
  formatoValido,
  lerGosto,
  normalizarProposta,
  type PropostaDeTemplate,
  ROTULOS_DOS_FORMATOS,
  type TemplateDeDesign,
  ESQUEMA_DA_PROPOSTA_DE_TEMPLATE,
} from "../_shared/templates-de-design.ts";
import { OPERACOES_DO_ESTILO } from "./acoes-do-estilo.ts";

export const AGENTE_DOS_TEMPLATES = "estilo";

export const OPERACOES_DOS_TEMPLATES = [
  "criar_template",
  "atualizar_template",
  "arquivar_template",
  "registrar_gosto_template",
  "ancora_no_template",
  "gerar_teste_template",
  "guardar_referencia_carrossel",
] as const;
export type OperacaoDosTemplates = (typeof OPERACOES_DOS_TEMPLATES)[number];

export const ehOperacaoDeTemplate = (op: unknown): op is OperacaoDosTemplates => (OPERACOES_DOS_TEMPLATES as readonly string[]).indexOf(String(op)) >= 0;

export const DESCRICOES_DOS_TEMPLATES: Record<OperacaoDosTemplates, string> = {
  criar_template: "n1. Grava a sua proposta_de_template como template novo. Só com proposta_de_template preenchida. para: o nome do template.",
  atualizar_template: "t*. A proposta_de_template vira versão nova deste template. para: uma frase do que muda.",
  arquivar_template: "t*. Arquiva o template (apagar é arquivar). para vazio.",
  registrar_gosto_template: "t*. Registra quem gostou ou não deste template. para: \"cliente gostou: ...\", \"dono gostou: ...\", \"cliente não gostou: ...\" (várias separadas por |).",
  ancora_no_template: "r*. Põe a imagem como âncora de um template. para: o apelido do template e, opcional, o papel (\"t2\" ou \"t2:capa\", papéis capa, miolo, fechamento, geral).",
  gerar_teste_template: "t*. Gera imagens de teste deste template com o gerador do Estúdio. para: quantas (1 a 4) e, depois de dois pontos, o tema.",
  guardar_referencia_carrossel: "m1. Guarda as imagens anexadas nesta mensagem, na ordem, como referência de carrossel. para: o nome.",
};

export const ORDEM_DOS_TEMPLATES: OperacaoDosTemplates[] = [
  "guardar_referencia_carrossel",
  "criar_template",
  "atualizar_template",
  "ancora_no_template",
  "registrar_gosto_template",
  "arquivar_template",
  "gerar_teste_template",
];

export type AlvosDosTemplates = {
  novo: Array<AlvoComApelido>;
  templates: Array<AlvoComApelido>;
  carrossel: Array<AlvoComApelido>;
  todos: Array<AlvoComApelido>;
};

/** Apelidos: n1 (novo), t1..tN (ativos), m1 (carrossel anexado agora, com 2 imagens ou mais). */
export function alvosDosTemplates(templates: TemplateDeDesign[], candidatas: Array<AlvoComApelido>, carrosselNaMensagem: number): AlvosDosTemplates {
  const novo = comApelido([{ id: "novo", titulo: "Template novo", detalhe: "grava a proposta_de_template" }], "n");
  const t = comApelido(
    templates.filter((x) => x.status === "ativo").map((x) => ({
      id: x.id,
      titulo: x.nome,
      detalhe: `${x.tipo === "referencia_carrossel" ? "referência de carrossel" : ROTULOS_DOS_FORMATOS[x.formato]}${x.escopo === "agencia" ? ", da agência" : ""}, versão ${x.versao_atual}`,
      dados: { tipo: x.tipo, escopo: x.escopo, formato: x.formato },
    })),
    "t",
  );
  const m = carrosselNaMensagem >= 2 ? comApelido([{ id: "mensagem", titulo: `Carrossel anexado (${carrosselNaMensagem} lâminas)`, detalhe: "na ordem em que foram anexadas" }], "m") : [];
  return { novo, templates: t, carrossel: m, todos: [...novo, ...t, ...m, ...candidatas] };
}

export function blocoDosAlvosDosTemplates(a: AlvosDosTemplates, templates: TemplateDeDesign[]): string {
  const descricoes = templates
    .filter((x) => x.status === "ativo")
    .slice(0, 12)
    .map((x) => {
      const ref = a.templates.find((y) => y.id === x.id);
      const c = corpoAtual(x);
      const resumo = c && c.resumo ? c.resumo.slice(0, 200) : "";
      return ref ? `${ref.ref}: ${x.nome}${resumo ? `. ${resumo}` : ""}` : "";
    })
    .filter(Boolean);
  return [
    blocoDosAlvos("TEMPLATES E REFERÊNCIAS DE CARROSSEL", a.templates, "nenhum ainda."),
    descricoes.length ? `\nO QUE CADA TEMPLATE DIZ:\n${descricoes.join("\n")}\n` : "",
    blocoDosAlvos("TEMPLATE NOVO", a.novo),
    a.carrossel.length ? blocoDosAlvos("CARROSSEL ANEXADO NESTA MENSAGEM", a.carrossel) : "",
    `\nOPERAÇÕES DE TEMPLATE (use em acoes, junto com as do estilo):\n${Object.keys(DESCRICOES_DOS_TEMPLATES).map((k) => `  - ${k}: ${DESCRICOES_DOS_TEMPLATES[k as OperacaoDosTemplates]}`).join("\n")}\n`,
  ].join("");
}

export const INSTRUCOES_DOS_TEMPLATES = `TEMPLATES (frente T):
- Um template é um molde reaproveitável (post 4:5, carrossel com o papel de cada lâmina, story, anúncio): grade e áreas (título, apoio, imagem, logo, CTA, área segura), hierarquia tipográfica, cor com função, tratamento de imagem, elementos gráficos, regras de capa, miolo e CTA, o que evitar e, no carrossel, a continuidade (lâminas, papéis, o que cruza cada borda, ritmo).
- proposta_de_template: quando a equipe pedir um template (ou "quero carrossel nessa pegada"), o template COMPLETO em regras curtas e concretas; formato é post, carrossel, story ou anuncio. Sem pedido, null.
- MARCA TRAVADA: nunca escreva nome de fonte, nome de cor nem hex da referência; a letra, as cores e o logo são sempre os do kit do cliente. Diga a função (dominante, destaque, neutro) e o peso ou tamanho relativo.
- Carrossel anexado (m1) e LEITURA DO CARROSSEL em DADOS: use a leitura para a continuidade do template. Para guardar as lâminas como referência de carrossel, guardar_referencia_carrossel (m1).
- pedido_de_combinacao: quando a equipe pedir para juntar templates ou referências ("usar este template com esta referência"), diga as fontes pelos apelidos (t* e r*, 2 ou 3) e o objetivo; o sistema escolhe o melhor de cada dimensão e traz a proposta pronta para confirmar. Sem pedido, null.`;

/** Esquema da conversa com os campos dos templates acrescentados (o do estilo continua igual por dentro). */
export function esquemaComTemplates(base: { nome: string; schema: { properties: Record<string, unknown>; required: string[] } & Record<string, unknown> }) {
  const operacoes = [...OPERACOES_DO_ESTILO, ...OPERACOES_DOS_TEMPLATES];
  return {
    nome: base.nome,
    schema: {
      ...base.schema,
      required: [...base.schema.required, "formato_da_proposta", "proposta_de_template", "pedido_de_combinacao"],
      properties: {
        ...base.schema.properties,
        acoes: esquemaDasAcoes(operacoes),
        formato_da_proposta: { type: "string", enum: ["post", "carrossel", "story", "anuncio"] },
        proposta_de_template: ESQUEMA_DA_PROPOSTA_DE_TEMPLATE,
        pedido_de_combinacao: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["fontes", "objetivo"],
          properties: { fontes: { type: "array", items: { type: "string" } }, objetivo: { type: "string" } },
        },
      },
    },
  };
}

/** Separa o que o modelo pediu em acoes: as do estilo vão para o cartão do estilo, as de template para o cartão dos templates. */
export function separarAcoes(bruto: unknown): { doEstilo: unknown; dosTemplates: unknown } {
  if (!bruto || typeof bruto !== "object") return { doEstilo: bruto, dosTemplates: null };
  const o = bruto as Record<string, unknown>;
  const itens = Array.isArray(o.itens) ? o.itens : [];
  const deTemplate = itens.filter((i) => i && typeof i === "object" && ehOperacaoDeTemplate((i as Record<string, unknown>).operacao));
  const doEstilo = itens.filter((i) => deTemplate.indexOf(i) < 0);
  return {
    doEstilo: doEstilo.length ? { ...o, itens: doEstilo } : null,
    dosTemplates: deTemplate.length ? { ...o, itens: deTemplate } : null,
  };
}

/** "2: promoção" -> { n: 2, tema }. Fora de 1..4: null. */
export function lerPedidoDeTesteDoTemplate(bruto: unknown): { n: number; tema: string } | null {
  const s = String(bruto ?? "").trim();
  const m = /^(\d+)\s*(?::\s*(.*))?$/.exec(s);
  const n = m ? Number(m[1]) : 1;
  if (!Number.isInteger(n) || n < 1 || n > 4) return null;
  return { n, tema: (m ? m[2] || "" : s).replace(/\s+/g, " ").trim().slice(0, 200) };
}

/** "t2" ou "t2:capa" -> { ref, papel }. Papel desconhecido: geral. */
export function lerDestinoDaAncora(bruto: unknown): { ref: string; papel: "capa" | "miolo" | "fechamento" | "geral" } | null {
  const m = /^\s*(t\d+)\s*(?::\s*([a-z]+))?\s*$/i.exec(String(bruto ?? ""));
  if (!m) return null;
  const p = String(m[2] || "").toLowerCase();
  return { ref: m[1].toLowerCase(), papel: p === "capa" || p === "miolo" || p === "fechamento" ? p : "geral" };
}

export function gostosDoPara(bruto: unknown) {
  return String(bruto ?? "")
    .split("|")
    .map(lerGosto)
    .filter((x): x is NonNullable<ReturnType<typeof lerGosto>> => !!x)
    .slice(0, 6);
}

/**
 * Lê as ações de template do modelo. A proposta (quando houver e disser algo)
 * vai no contexto; o destino das âncoras vira id no contexto (o executor não
 * depende do modelo); custo dos testes antes de confirmar.
 */
export function normalizarAcoesDosTemplates(
  bruto: unknown,
  alvos: AlvosDosTemplates,
  opcoes: {
    proposta: unknown;
    formato: unknown;
    clientId: string;
    marcaId: string | null;
    custoPorImagem: number;
    /** Imagens anexadas nesta mensagem (m1), na ordem. */
    carrossel?: Array<{ bucket: string; caminho: string; nome: string }>;
    /** Dados das candidatas r* (bucket, caminho). */
    candidatas?: Record<string, { bucket: string; caminho: string; nome: string; origem: string; leitura?: string | null }>;
    id?: string;
  },
): AcaoDoAgente | null {
  const formato: FormatoDoTemplate = formatoValido(opcoes.formato);
  const proposta: PropostaDeTemplate | null = normalizarProposta(opcoes.proposta, formato);
  const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/[\u2014\u2013]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);
  const templatePorRef = new Map(alvos.templates.map((t) => [t.ref, t]));
  const regras: Record<OperacaoDosTemplates, RegraDaOperacao> = {
    criar_template: { rotulo: "criar o template", alvos: ["n"], para: (v) => (proposta ? umaLinha(v, 80) || proposta.nome : null) },
    atualizar_template: {
      rotulo: "gravar versão nova do template",
      alvos: ["t"],
      combina: true,
      para: (v) => (proposta ? umaLinha(v, 200) || "proposta da conversa" : null),
      trava: (a) => (a.dados && (a.dados as Record<string, unknown>).tipo === "referencia_carrossel" ? "Referência de carrossel muda pela ordem das lâminas, não por proposta." : null),
    },
    arquivar_template: { rotulo: "arquivar o template", alvos: ["t"] },
    registrar_gosto_template: {
      rotulo: "registrar quem gostou",
      alvos: ["t"],
      combina: true,
      para: (v) => {
        const l = gostosDoPara(v);
        return l.length ? l.map((g) => `${g.quem} ${g.tipo === "gostou" ? "gostou" : "não gostou"}: ${g.texto}`).join(" | ") : null;
      },
    },
    ancora_no_template: {
      rotulo: "pôr como âncora do template",
      alvos: ["r"],
      para: (v) => {
        const d = lerDestinoDaAncora(v);
        return d && templatePorRef.has(d.ref) ? `${d.ref}:${d.papel}` : null;
      },
    },
    gerar_teste_template: {
      rotulo: "gerar imagens de teste do template",
      alvos: ["t"],
      combina: true,
      para: (v) => {
        const p = lerPedidoDeTesteDoTemplate(v);
        return p ? (p.tema ? `${p.n}: ${p.tema}` : String(p.n)) : null;
      },
    },
    guardar_referencia_carrossel: { rotulo: "guardar como referência de carrossel", alvos: ["m"], para: (v) => umaLinha(v, 80) || "Carrossel de referência" },
  };
  const acao = normalizarAcaoDoAgente(bruto, alvos.todos, regras as Record<string, RegraDaOperacao>, {
    agente: AGENTE_DOS_TEMPLATES,
    id: opcoes.id,
    contexto: { client_id: opcoes.clientId, marca_id: opcoes.marcaId, templates: true },
    semDesfazer: (itens) => itens.every((i) => i.operacao === "gerar_teste_template"),
    rotuloDoPara: (op, para) => {
      if (op !== "ancora_no_template" || typeof para !== "string") return null;
      const [ref, papel] = para.split(":");
      const t = templatePorRef.get(ref);
      return t ? `${t.titulo}${papel && papel !== "geral" ? ` (${papel})` : ""}` : null;
    },
  });
  if (!acao) return null;
  const ordem = (op: string) => ORDEM_DOS_TEMPLATES.indexOf(op as OperacaoDosTemplates);
  acao.itens.sort((a, b) => ordem(a.operacao) - ordem(b.operacao));
  const ctx: Record<string, unknown> = { ...(acao.contexto || {}) };
  if (proposta && acao.itens.some((i) => i.operacao === "criar_template" || i.operacao === "atualizar_template")) ctx.proposta_de_template = proposta;
  // Destino das âncoras: apelido -> id do template (o executor não confia no modelo).
  const destinos: Record<string, string> = {};
  const ancoras: Record<string, unknown> = {};
  for (const i of acao.itens) {
    if (i.operacao !== "ancora_no_template" || typeof i.para !== "string") continue;
    const t = templatePorRef.get(i.para.split(":")[0]);
    if (t) destinos[i.para.split(":")[0]] = t.id;
    const c = opcoes.candidatas ? opcoes.candidatas[i.alvo_id] : null;
    if (c) ancoras[i.alvo_id] = c;
  }
  if (Object.keys(destinos).length) ctx.destinos = destinos;
  if (Object.keys(ancoras).length) ctx.ancoras = ancoras;
  if (acao.itens.some((i) => i.operacao === "guardar_referencia_carrossel") && opcoes.carrossel && opcoes.carrossel.length) ctx.carrossel = opcoes.carrossel.slice(0, 20);
  acao.contexto = ctx;
  const imagens = acao.itens.filter((i) => i.operacao === "gerar_teste_template").reduce((s, i) => s + (lerPedidoDeTesteDoTemplate(String(i.para || "1").split(":")[0])?.n || 1), 0);
  if (imagens > 0 && opcoes.custoPorImagem > 0) acao.custo_estimado_usd = Math.round(imagens * opcoes.custoPorImagem * 1e4) / 1e4;
  return acao;
}

/** Proposta de template vinda da combinação: um cartão com criar_template (n1), por variação (1 ou 2). */
export function acaoDaCombinacao(
  propostas: PropostaDeTemplate[],
  e: { clientId: string; marcaId: string | null; fontes: string[]; escopo: "cliente" | "agencia"; id?: string; coerencia: number | null },
): AcaoDoAgente | null {
  if (!propostas.length) return null;
  const alvos: Alvo[] = propostas.map((p, i) => ({ id: `variacao-${i + 1}`, titulo: propostas.length > 1 ? `Variação ${i + 1}: ${p.nome}` : p.nome, detalhe: p.corpo.resumo.slice(0, 140) || null }));
  const comRef = comApelido(alvos, "n");
  const acao = normalizarAcaoDoAgente(
    { resumo: propostas.length > 1 ? "Duas variações do template combinado. Escolha uma (ou as duas)." : "Template combinado pronto para gravar.", itens: comRef.map((a) => ({ operacao: "criar_template", ref: a.ref, para: "" })) },
    comRef,
    { criar_template: { rotulo: "criar o template", alvos: ["n"] } },
    { agente: AGENTE_DOS_TEMPLATES, id: e.id, contexto: { client_id: e.clientId, marca_id: e.marcaId, templates: true, combinacao: true, escopo: e.escopo, fontes: e.fontes, coerencia: e.coerencia } },
  );
  if (!acao) return null;
  const porVariacao: Record<string, PropostaDeTemplate> = {};
  propostas.forEach((p, i) => (porVariacao[`variacao-${i + 1}`] = p));
  acao.contexto = { ...(acao.contexto || {}), propostas: porVariacao };
  return acao;
}
