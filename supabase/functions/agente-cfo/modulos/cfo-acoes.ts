/**
 * O que o CFO propõe (frente CFO): lançar despesa, cortar custo fixo, criar
 * meta do plano de crescimento e definir a meta mensal. Contrato comum de
 * _shared/acoes-do-agente.ts: o cartão mostra a lista, nada muda antes do
 * Confirmar, cada item volta com ok/motivo e há Desfazer.
 *
 * Quem monta a proposta é o CÓDIGO, a partir da intenção e do retrato (os
 * números): a IA nunca escolhe o que cortar nem quanto lançar. Nenhuma
 * operação do CFO vai direto (financeiro pede o olho do dono sempre).
 *
 * A TRAVA: lançar despesa acima do limite do mês só passa com
 * `confirmar_acima_do_limite` (o dono marca "entendi" no cartão) e o limite é
 * conferido de novo, com os números da hora, no Confirmar.
 * Puro: sem Deno, sem npm.
 */

import { TIPO_DA_ACAO, type AcaoDoAgente, type ItemDaAcaoDoAgente, type RegraDaOperacao } from "../../_shared/acoes-do-agente.ts";
import { avaliarGasto, centavos, dataCurta, reais, type AvaliacaoDoGasto, type IntencaoDoCFO, type Retrato } from "./cfo-calculos.ts";

export const AGENTE_CFO = "cfo";

/** Regras das operações (rótulo do cartão). Nenhuma é `direta`. */
export const REGRAS_DO_CFO: Record<string, RegraDaOperacao> = {
  lancar_despesa: { rotulo: "Lançar" },
  cortar_custo: { rotulo: "Encerrar recorrência" },
  criar_meta: { rotulo: "Criar meta" },
  definir_meta_mensal: { rotulo: "Definir meta mensal" },
};

export type TravaDaProposta = {
  nivel: AvaliacaoDoGasto["nivel"];
  limite: number;
  excesso: number;
  motivo: string;
  mes: string;
};

const id = (prefixo: string) => `${AGENTE_CFO}-${prefixo}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

function nova(resumo: string, itens: ItemDaAcaoDoAgente[], contexto: Record<string, unknown>): AcaoDoAgente {
  return { tipo: TIPO_DA_ACAO, agente: AGENTE_CFO, id: id("acao"), resumo, itens, ignorados: [], recusados: [], contexto, custo_estimado_usd: 0 };
}

/** Vencimento do lançamento: hoje para gasto de uma vez; dia 10 do mês seguinte para recorrente. */
export function vencimentoDoLancamento(hoje: string, recorrente: boolean): string {
  if (!recorrente) return hoje;
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  const a = mes === 12 ? ano + 1 : ano;
  const m = mes === 12 ? 1 : mes + 1;
  return `${a}-${String(m).padStart(2, "0")}-10`;
}

export function propostaDeLancamento(r: Retrato, g: { valor: number; recorrente: boolean; descricao: string; categoria?: string | null }): { acao: AcaoDoAgente; avaliacao: AvaliacaoDoGasto } {
  const avaliacao = avaliarGasto(r, { valor: g.valor, recorrente: g.recorrente, categoria: g.categoria || "outros", descricao: g.descricao });
  const vencimento = vencimentoDoLancamento(r.hoje, g.recorrente);
  const trava: TravaDaProposta = { nivel: avaliacao.nivel, limite: avaliacao.limite, excesso: avaliacao.excesso, motivo: avaliacao.motivo, mes: avaliacao.mes };
  const item: ItemDaAcaoDoAgente = {
    ref: "n1",
    alvo_id: "nova-despesa",
    titulo: g.descricao.slice(0, 120),
    detalhe: `${reais(avaliacao.valor)}${g.recorrente ? " por mês" : " de uma vez"} · vence ${dataCurta(vencimento)} · a pagar`,
    operacao: "lancar_despesa",
    rotulo: REGRAS_DO_CFO.lancar_despesa.rotulo,
    para: avaliacao.valor,
  };
  const resumo = avaliacao.nivel === "bloqueado"
    ? `Passa do limite: ${avaliacao.motivo} Só lanço com a sua confirmação explícita.`
    : `Lanço ${g.descricao.toLowerCase()} de ${reais(avaliacao.valor)}${g.recorrente ? " por mês" : ""} como conta a pagar. ${avaliacao.motivo}`;
  const acao = nova(resumo, [item], {
    descricao: g.descricao.slice(0, 120),
    valor: avaliacao.valor,
    recorrente: g.recorrente,
    categoria: g.categoria || "outros",
    vencimento,
    trava,
  });
  if (avaliacao.nivel === "bloqueado") (acao.contexto as Record<string, unknown>).exige_confirmacao_explicita = true;
  return { acao, avaliacao };
}

export function propostaDeCortes(r: Retrato, max = 3): AcaoDoAgente | null {
  const cortaveis = r.cortes.filter((c) => !c.essencial).slice(0, max);
  if (!cortaveis.length) return null;
  const itens: ItemDaAcaoDoAgente[] = cortaveis.map((c, i) => ({
    ref: `c${i + 1}`,
    alvo_id: c.id,
    titulo: c.descricao,
    detalhe: `${reais(c.mensal)}/mês · ${reais(c.anual)}/ano`,
    operacao: "cortar_custo",
    rotulo: REGRAS_DO_CFO.cortar_custo.rotulo,
    para: c.mensal,
  }));
  const poupa = cortaveis.reduce((s, c) => s + c.mensal, 0);
  return nova(
    `Encerro a recorrência de ${cortaveis.length} custo(s): ${reais(poupa)}/mês a menos na projeção. A conta já lançada do mês continua; cancele também no fornecedor.`,
    itens,
    { poupanca_mensal: centavos(poupa) },
  );
}

export function propostaDoPlano(r: Retrato): AcaoDoAgente | null {
  const jaTem: Record<string, boolean> = {};
  for (const m of r.metas) jaTem[m.tipo] = true;
  const novas = r.plano.filter((m) => m.falta > 0 && !jaTem[m.chave]);
  if (!novas.length) return null;
  const itens: ItemDaAcaoDoAgente[] = novas.map((m, i) => ({
    ref: `m${i + 1}`,
    alvo_id: `meta-${m.chave}`,
    titulo: m.titulo,
    detalhe: `alvo ${reais(m.alvo)}${m.prazoMeses ? ` em ~${m.prazoMeses} ${m.prazoMeses === 1 ? "mês" : "meses"}` : ""} · ${m.porMes}`,
    operacao: "criar_meta",
    rotulo: REGRAS_DO_CFO.criar_meta.rotulo,
    para: m.alvo,
  }));
  const metas: Record<string, unknown> = {};
  for (const m of novas) metas[`meta-${m.chave}`] = { tipo: m.chave, titulo: m.titulo, alvo: m.alvo, atual: m.atual, prazo_meses: m.prazoMeses, como: m.como.join(" ") };
  return nova(`Guardo ${novas.length} meta(s) do plano de crescimento para acompanhar mês a mês em Financeiro › CFO.`, itens, { metas });
}

export function propostaDeMetaMensal(r: Retrato, valor: number, anterior: number | null): AcaoDoAgente {
  return nova(
    `Meta mensal passa de ${anterior ? reais(anterior) : "nenhuma"} para ${reais(valor)}. A carteira hoje é ${reais(r.carteira.mrr)}.`,
    [{ ref: "g1", alvo_id: "meta-mensal", titulo: "Meta mensal de receita", detalhe: `de ${anterior ? reais(anterior) : "nenhuma"} para ${reais(valor)}`, operacao: "definir_meta_mensal", rotulo: REGRAS_DO_CFO.definir_meta_mensal.rotulo, para: centavos(valor) }],
    { anterior },
  );
}

/** O pedido fala com todas as letras da meta mensal de receita? (editar só nesse caso; regra fixa, sem julgamento) */
export function falaDaMetaMensal(pedido: string): boolean {
  const t = String(pedido || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /meta (mensal|do mes)|receita mensal|meta de receita/.test(t);
}

/** Título da meta nova: o que vier entre aspas no pedido; sem aspas, o próprio pedido curto. */
export function tituloDaNovaMeta(pedido: string): string {
  const m = /["'“‘]([^"'”’]{3,80})["'”’]/.exec(String(pedido || ""));
  if (m) return m[1].trim();
  return String(pedido || "").replace(/\s+/g, " ").trim().slice(0, 80) || "Meta nova";
}

/** Meta NOVA (não substitui nada): vai para cfo_metas com o tipo "outra"; Desfazer arquiva. */
export function propostaDeNovaMeta(r: Retrato, e: { titulo: string; valor: number; prazoMeses?: number | null }): AcaoDoAgente {
  const alvoId = "meta-nova";
  const prazo = e.prazoMeses && e.prazoMeses > 0 ? e.prazoMeses : null;
  return nova(
    `Crio a meta nova "${e.titulo}" de ${reais(e.valor)}${prazo ? ` em ${prazo} ${prazo === 1 ? "mês" : "meses"}` : ""}. A meta mensal de receita${r.carteira ? "" : ""} não muda.`,
    [{ ref: "m1", alvo_id: alvoId, titulo: e.titulo.slice(0, 120), detalhe: `alvo ${reais(e.valor)}${prazo ? ` · ${prazo} ${prazo === 1 ? "mês" : "meses"}` : ""} · meta nova`, operacao: "criar_meta", rotulo: REGRAS_DO_CFO.criar_meta.rotulo, para: centavos(e.valor) }],
    { metas: { [alvoId]: { tipo: "outra", titulo: e.titulo.slice(0, 200), alvo: centavos(e.valor), atual: 0, prazo_meses: prazo, como: "" } } },
  );
}

/** A proposta certa para a intenção (null quando a pergunta é só de leitura). */
export function propostaDaIntencao(
  r: Retrato,
  intencao: IntencaoDoCFO,
  e: { valor: number | null; recorrente: boolean; descricao: string; metaAnterior: number | null; pedido?: string },
): { acao: AcaoDoAgente | null; avaliacao: AvaliacaoDoGasto | null } {
  if ((intencao === "posso_gastar" || intencao === "lancar") && e.valor && e.valor > 0) {
    const p = propostaDeLancamento(r, { valor: e.valor, recorrente: e.recorrente, descricao: e.descricao });
    return { acao: p.acao, avaliacao: p.avaliacao };
  }
  if (intencao === "onde_cortar") return { acao: propostaDeCortes(r), avaliacao: null };
  if (intencao === "plano") return { acao: propostaDoPlano(r), avaliacao: null };
  // Editar a meta mensal (substitui a atual) só quando o pedido fala dela; senão nada vira cartão.
  if (intencao === "meta" && e.valor && e.valor > 0 && falaDaMetaMensal(e.pedido || e.descricao)) return { acao: propostaDeMetaMensal(r, e.valor, e.metaAnterior), avaliacao: null };
  if (intencao === "nova_meta" && e.valor && e.valor > 0) return { acao: propostaDeNovaMeta(r, { titulo: tituloDaNovaMeta(e.pedido || e.descricao), valor: e.valor }), avaliacao: null };
  // Simular: a avaliação do gasto sem cartão (nada é gravado).
  if (intencao === "simular" && e.valor && e.valor > 0) return { acao: null, avaliacao: propostaDeLancamento(r, { valor: e.valor, recorrente: e.recorrente, descricao: e.descricao }).avaliacao };
  return { acao: null, avaliacao: null };
}

/**
 * No Confirmar: o lançamento acima do limite só passa com o "entendi" do dono.
 * O limite é recalculado com os números da hora (retratoAgora); se o gasto
 * agora cabe, passa sem pedir.
 */
export function conferirTrava(acao: AcaoDoAgente, retratoAgora: Retrato, confirmouAcimaDoLimite: boolean): { pode: boolean; avaliacao: AvaliacaoDoGasto | null; motivo: string } {
  const lancamentos = acao.itens.filter((i) => i.operacao === "lancar_despesa");
  if (!lancamentos.length) return { pode: true, avaliacao: null, motivo: "" };
  const ctx = (acao.contexto || {}) as Record<string, unknown>;
  const avaliacao = avaliarGasto(retratoAgora, { valor: Number(ctx.valor) || 0, recorrente: ctx.recorrente === true, categoria: String(ctx.categoria || "outros") });
  if (avaliacao.nivel !== "bloqueado" || confirmouAcimaDoLimite) return { pode: true, avaliacao, motivo: avaliacao.motivo };
  return { pode: false, avaliacao, motivo: `${avaliacao.titulo}. ${avaliacao.motivo} Marque que entendeu o risco para lançar mesmo assim.` };
}
