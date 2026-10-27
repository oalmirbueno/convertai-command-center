/**
 * Rascunho de proposta a partir do lead (Mercúrio, MCP 2.23, 28/10/2026).
 *
 * O agente comercial conta o que ouviu (negócio, dor, plano sugerido,
 * avulsos, verba e moeda) e escolhe os itens do catálogo; este módulo monta o
 * rascunho nos blocos da proposta (proposta-modelo.ts) sem escrever texto de
 * venda: o estrategista da Mesa Proposta gera o texto depois, com o Almir.
 *
 * Regras que não se negociam:
 *  - O preço sai do catálogo (planos do Financeiro e biblioteca de serviços).
 *    Valor que o agente informa (tabela do exterior, avulso combinado) entra
 *    como item manual e vira pendência para o Almir conferir.
 *  - Catálogo é em reais: proposta em US$ ou € só com itens manuais.
 *  - A verba do lead é informação interna: vai para as notas, nunca para a
 *    página pública.
 *  - Moeda que não é real fica em conteudo → investimento → dados.moeda.
 *
 * Sem import de Deno nem de npm: roda na função e nos testes (vitest).
 * Nada de lookbehind nem classe de propriedade Unicode (a tela roda no Safari 11).
 */

import {
  blocoDoTipo,
  comBloco,
  conteudoDoModelo,
  type ConteudoDaProposta,
  type ItemDaProposta,
  type ModeloDeProposta,
  type MoedaDaProposta,
  normalizarDados,
  normalizarItens,
  textoDoTotal,
  textoLimpo,
  totaisDosItens,
} from "./proposta-modelo.ts";

export const MOEDAS_DO_PEDIDO = ["BRL", "USD", "EUR"] as const;
export const NOME_DA_MOEDA: Record<MoedaDaProposta, string> = { BRL: "real (R$)", USD: "dólar (US$)", EUR: "euro (€)" };

export type PedidoDoAgente = {
  negocio: string;
  dor: string;
  plano_sugerido?: string;
  avulsos?: string[];
  verba?: string;
  moeda?: MoedaDaProposta;
  palavras_do_cliente?: string[];
  observacoes?: string;
};

export type PlanoDoCatalogo = { id: string; name: string; description?: string | null };
export type VersaoDoPlano = { final_amount: number | string | null; billing_period?: string | null; setup_fee?: number | string | null };
export type ServicoDoCatalogo = { id: string; nome: string; descricao?: string | null; preco: number | string; recorrencia?: string | null; horas?: number | string | null };
export type ItemManual = { nome: string; valor: number; recorrencia?: "unico" | "mensal"; descricao?: string; quantidade?: number };

const numero = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};

/** O plano vira o item mensal (ou único) e, se houver, a implantação: o mesmo que o botão da Mesa faz. */
export function itensDoPlano(plano: PlanoDoCatalogo, versao: VersaoDoPlano): ItemDaProposta[] {
  const brutos: Array<Record<string, unknown>> = [
    { nome: plano.name, descricao: plano.description || "", valor_unitario: numero(versao.final_amount), recorrencia: versao.billing_period === "monthly" ? "mensal" : "unico", origem: "plano", plano_id: plano.id },
  ];
  if (numero(versao.setup_fee) > 0) brutos.push({ nome: `Implantação ${plano.name}`, valor_unitario: numero(versao.setup_fee), recorrencia: "unico", origem: "plano", plano_id: plano.id });
  return normalizarItens(brutos);
}

export function itemDoServico(s: ServicoDoCatalogo): ItemDaProposta[] {
  return normalizarItens([{ nome: s.nome, descricao: s.descricao || "", valor_unitario: numero(s.preco), recorrencia: s.recorrencia === "mensal" ? "mensal" : "unico", origem: "servico", biblioteca_id: s.id, horas: s.horas ?? undefined }]);
}

export function itemManual(m: ItemManual): ItemDaProposta[] {
  return normalizarItens([{ nome: m.nome, descricao: m.descricao || "", valor_unitario: m.valor, quantidade: m.quantidade ?? 1, recorrencia: m.recorrencia === "mensal" ? "mensal" : "unico", origem: "manual" }]);
}

/** Junta as listas na ordem (plano, serviços, manuais), com ids únicos e o teto de itens. */
export function juntarItens(...listas: ItemDaProposta[][]): ItemDaProposta[] {
  return normalizarItens(listas.reduce((todos, l) => todos.concat(l.map((it, i) => ({ ...it, id: `${it.origem}-${todos.length + i + 1}` }))), [] as ItemDaProposta[]));
}

/** Notas da proposta: o que o agente ouviu, para o estrategista e o Almir. A verba fica só aqui. */
export function notasDoPedido(p: PedidoDoAgente, ctx: { operador: string; hoje: string; manuais: ItemDaProposta[] }): string {
  const moeda: MoedaDaProposta = p.moeda || "BRL";
  const linhas = [
    `Pedido do ${ctx.operador} (${ctx.hoje}), a partir da conversa com o lead:`,
    `Negócio: ${textoLimpo(p.negocio, 600)}`,
    `Dor: ${textoLimpo(p.dor, 800)}`,
    p.plano_sugerido ? `Plano sugerido: ${textoLimpo(p.plano_sugerido, 200)}` : "",
    p.avulsos && p.avulsos.length ? `Avulsos pedidos: ${p.avulsos.map((a) => textoLimpo(a, 120)).filter(Boolean).join("; ")}` : "",
    p.verba ? `Verba que o lead disse (interno, não vai na página): ${textoLimpo(p.verba, 200)}` : "",
    `Moeda: ${NOME_DA_MOEDA[moeda]}`,
    p.observacoes ? `Observações: ${textoLimpo(p.observacoes, 1200)}` : "",
    ctx.manuais.length ? `Valores informados pelo agente (conferir na tabela antes de enviar): ${ctx.manuais.map((m) => `${m.nome} ${m.valor_unitario}${m.recorrencia === "mensal" ? "/mês" : ""}`).join("; ")}` : "",
  ];
  return linhas.filter(Boolean).join("\n").slice(0, 6000);
}

export type RascunhoDoLead = {
  titulo: string;
  conteudo: ConteudoDaProposta;
  itens: ItemDaProposta[];
  notas: string;
  pendencias: string[];
  total: string;
};

/**
 * O rascunho: o modelo da casa, o desafio com a dor nas palavras do lead, a
 * moeda no investimento, provas e quem somos da agência (quando vierem) e os
 * itens. Capa, solução e o resto ficam para o estrategista gerar na Mesa.
 */
export function montarRascunhoDoLead(a: {
  modelo: ModeloDeProposta;
  lead: { name?: string | null; company?: string | null };
  pedido: PedidoDoAgente;
  itens: ItemDaProposta[];
  operador: string;
  hoje: string;
  agencia?: { provas: Record<string, unknown>; quem_somos: Record<string, unknown> } | null;
}): RascunhoDoLead {
  const moeda: MoedaDaProposta = a.pedido.moeda || "BRL";
  const quem = textoLimpo(a.lead.company || a.lead.name || "", 100) || "o lead";
  let conteudo = conteudoDoModelo(a.modelo);
  const capa = blocoDoTipo(conteudo, "capa");
  conteudo = comBloco(conteudo, "capa", { dados: normalizarDados("capa", { ...capa.dados, projeto: textoLimpo(a.pedido.negocio, 120) }) });
  const desafio = blocoDoTipo(conteudo, "desafio");
  conteudo = comBloco(conteudo, "desafio", {
    dados: normalizarDados("desafio", { ...desafio.dados, texto: a.pedido.dor, palavras_do_cliente: a.pedido.palavras_do_cliente || [] }),
  });
  const inv = blocoDoTipo(conteudo, "investimento");
  const { moeda: _antiga, ...semMoeda } = inv.dados;
  conteudo = comBloco(conteudo, "investimento", { dados: normalizarDados("investimento", moeda === "BRL" ? semMoeda : { ...semMoeda, moeda }) });
  if (a.agencia) {
    conteudo = comBloco(conteudo, "provas", { dados: normalizarDados("provas", a.agencia.provas) });
    conteudo = comBloco(conteudo, "quem_somos", { dados: normalizarDados("quem_somos", a.agencia.quem_somos) });
  }
  const manuais = a.itens.filter((i) => i.origem === "manual");
  const pendencias: string[] = [];
  if (!a.itens.length) pendencias.push("Sem itens: escolha o plano e os avulsos na Mesa antes de enviar.");
  if (manuais.length) pendencias.push(`Conferir ${manuais.length === 1 ? "o valor informado" : "os valores informados"} pelo agente: ${manuais.map((m) => m.nome).join(", ")}.`);
  if (moeda !== "BRL") pendencias.push(`Proposta em ${NOME_DA_MOEDA[moeda]}: confira a tabela do exterior e as condições de pagamento.`);
  pendencias.push("Gerar o texto com o estrategista (capa, solução, entregáveis) e revisar antes de enviar.");
  return {
    titulo: textoLimpo(`Proposta para ${quem}`, 120),
    conteudo,
    itens: a.itens,
    notas: notasDoPedido(a.pedido, { operador: a.operador, hoje: a.hoje, manuais }),
    pendencias,
    total: textoDoTotal(totaisDosItens(a.itens), moeda),
  };
}

/**
 * Mesa Proposta: proposta nova de um lead que tinha um pedido do agente
 * esperando o cliente. Leva o desafio, a capa, a moeda e os itens do pedido
 * para o conteúdo recém-criado do modelo (provas e quem somos ficam os da
 * agência, lidos na hora).
 */
export function aplicarPedidoNaProposta(atual: ConteudoDaProposta, pedido: { conteudo: unknown }): ConteudoDaProposta {
  const doPedido = pedido.conteudo && typeof pedido.conteudo === "object" ? (pedido.conteudo as ConteudoDaProposta) : null;
  if (!doPedido || !Array.isArray(doPedido.blocos)) return atual;
  let conteudo = atual;
  for (const tipo of ["capa", "desafio", "investimento"] as const) {
    const b = doPedido.blocos.find((x) => x && x.tipo === tipo);
    if (b) conteudo = comBloco(conteudo, tipo, { dados: normalizarDados(tipo, b.dados) });
  }
  return conteudo;
}
