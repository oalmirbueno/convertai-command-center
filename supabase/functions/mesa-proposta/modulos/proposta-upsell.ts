/**
 * Proposta de upsell (frente PRO3, 30/09/2026): o que o cliente já tem com a
 * Aceleriq (serviços do cadastro e plano do Financeiro) e os resultados reais
 * dele (métricas do Instagram, anúncios e entregas, lidos do painel), no
 * formato que a proposta usa.
 *
 * Regra do dono: nenhum número inventado. Cada número daqui sai de uma linha
 * do banco (EstadoReal, termo do Financeiro, cadastro); o que não tem base não
 * entra. O resumo vai para a proposta de três jeitos:
 * - o bloco "O que você já tem" (ja_tem), que a IA não reescreve;
 * - um material da proposta ("Cliente hoje"), que o estrategista lê e que
 *   vira origem dos números (a régua semNumeroInventado aceita o que está nele);
 * - o contexto curto do "Preencher com IA" do próximo passo.
 *
 * Puro (sem Deno, sem npm): roda na função mesa-proposta, na tela e no vitest.
 * Sem lookbehind, grupo nomeado, \p{} nem .at(): a tela roda no Safari 11.
 */

import { dataCurta, reais, textoLimpo, type DadosDoBloco, type TituloETexto } from "../../_shared/proposta-modelo.ts";

/** Os serviços vendidos (as mesmas chaves de SERVICE_LABELS em src/lib/cycleDefs.ts), com o nome que o cliente lê. */
export const SERVICOS_DA_CASA: Record<string, string> = {
  social: "Social media",
  trafego: "Tráfego pago",
  design: "Design",
  copywriting: "Copywriting",
  edicao_video: "Edição de vídeo",
  videos_ia: "Vídeos com IA",
  site: "Site",
  seo: "SEO",
  automacao: "Automação",
  email_marketing: "E-mail marketing",
  relatorios: "Relatórios",
};

export const NOME_DO_MATERIAL_DO_UPSELL = "Cliente hoje (serviços, plano e resultados)";
export const TITULO_DO_PROXIMO_PASSO = "Próximo passo";

/** Só o que é serviço vendido (bandeira de controle do cadastro fica de fora). */
export function servicosDoCadastro(config: unknown): string[] {
  if (!config || typeof config !== "object") return [];
  const c = config as Record<string, unknown>;
  return Object.keys(SERVICOS_DA_CASA).filter((k) => c[k] === true).map((k) => SERVICOS_DA_CASA[k]);
}

export type PlanoAtual = {
  nome: string;
  /** Valor cobrado do cliente no período (o final do termo; sem termo, o do cadastro). */
  valor: number | null;
  /** monthly, quarterly... (Financeiro v2). */
  periodo: string | null;
  desde: string | null;
  origem: "financeiro" | "cadastro";
};

const POR_PERIODO: Record<string, string> = {
  monthly: "por mês",
  bimonthly: "a cada 2 meses",
  quarterly: "por trimestre",
  semiannual: "por semestre",
  annual: "por ano",
};

export function textoDoPlano(p: PlanoAtual | null): string {
  if (!p || !p.nome) return "";
  const valor = p.valor && p.valor > 0 ? `, ${reais(p.valor)} ${POR_PERIODO[p.periodo || "monthly"] || "por mês"}` : "";
  const desde = p.desde ? `, desde ${dataCurta(p.desde)}` : "";
  return textoLimpo(`${p.nome}${valor}${desde}`, 200);
}

/** O pedaço do EstadoReal (estado-real-do-cliente.ts) que o upsell usa: estrutural, para o teste montar à mão. */
export type EstadoParaUpsell = {
  periodos: { mes: { de: string; ate: string }; mesAnterior: { de: string; ate: string }; desde: string | null };
  organico: {
    semanas: Array<{ de: string; ate: string; seguidores: number | null; alcance: number | null; interacoes: number | null }>;
    publicadosNoMes: number;
    publicadosNoMesAnterior: number;
  };
  pago: { mes: { gasto: number; contatos: number; vendas: number; receita: number } };
  operacao: { tarefasConcluidas: Array<{ id: string; titulo: string; quando: string }> };
};

const milhar = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const dm = (iso: string | null | undefined) => {
  const d = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "";
};
const ok = (v: unknown): v is number => typeof v === "number" && isFinite(v);

/**
 * Os resultados reais em até 5 linhas, cada uma com o período. Sem base, a
 * linha não existe (nada de "sem dado" na página do cliente).
 */
export function resultadosDoEstado(e: EstadoParaUpsell | null | undefined): TituloETexto[] {
  if (!e) return [];
  const saida: TituloETexto[] = [];
  const semanas = (e.organico && e.organico.semanas) || [];
  const s0 = semanas[0];
  const antiga = semanas.length > 1 ? semanas[semanas.length - 1] : null;
  if (s0 && ok(s0.seguidores) && s0.seguidores > 0) {
    const ganho = antiga && ok(antiga.seguidores) ? s0.seguidores - antiga.seguidores : null;
    saida.push({
      titulo: "Seguidores",
      texto: `${milhar(s0.seguidores)} seguidores na semana de ${dm(s0.de)} a ${dm(s0.ate)}${ganho !== null && antiga ? ` (${ganho >= 0 ? "+" : ""}${milhar(ganho)} desde ${dm(antiga.de)})` : ""}.`,
    });
  }
  if (s0 && ok(s0.alcance) && s0.alcance > 0) {
    saida.push({ titulo: "Alcance", texto: `${milhar(s0.alcance)} pessoas alcançadas de ${dm(s0.de)} a ${dm(s0.ate)}${ok(s0.interacoes) && s0.interacoes > 0 ? `, com ${milhar(s0.interacoes)} interações` : ""}.` });
  }
  const P = e.periodos;
  const noMes = e.organico ? Number(e.organico.publicadosNoMes) || 0 : 0;
  const antes = e.organico ? Number(e.organico.publicadosNoMesAnterior) || 0 : 0;
  if (noMes > 0 || antes > 0) {
    saida.push({ titulo: "Conteúdo publicado", texto: `${noMes} posts de ${dm(P.mes.de)} a ${dm(P.mes.ate)} (${antes} de ${dm(P.mesAnterior.de)} a ${dm(P.mesAnterior.ate)}).` });
  }
  const mes = e.pago && e.pago.mes;
  if (mes && ok(mes.gasto) && mes.gasto > 0) {
    const partes = [`${reais(mes.gasto)} investidos em anúncios de ${dm(P.mes.de)} a ${dm(P.mes.ate)}`];
    if (mes.contatos > 0) partes.push(`${milhar(mes.contatos)} contatos`);
    if (mes.vendas > 0) partes.push(`${milhar(mes.vendas)} vendas registradas`);
    saida.push({ titulo: "Anúncios", texto: `${partes.join(", ")}.` });
  }
  const feitas = (e.operacao && e.operacao.tarefasConcluidas) || [];
  if (feitas.length) {
    const desde = P.desde ? ` desde ${dm(P.desde)}` : "";
    saida.push({ titulo: "Entregas", texto: `${feitas.length} entregas concluídas${desde}: ${feitas.slice(0, 3).map((t) => textoLimpo(t.titulo, 60)).join("; ")}.` });
  }
  return saida.slice(0, 5).map((r) => ({ titulo: textoLimpo(r.titulo, 120), texto: textoLimpo(r.texto, 700) }));
}

/** O retrato do cliente guardado na proposta (contexto.upsell): marca o tipo e alimenta o bloco e a IA. */
export type UpsellDaProposta = {
  lido_em: string;
  cliente: string;
  servicos: string[];
  plano: PlanoAtual | null;
  resultados: TituloETexto[];
  /** Fontes que falharam na leitura (vão para a tela como aviso, nunca somem). */
  avisos: string[];
};

export function montarUpsell(p: { cliente: string; servicos: string[]; plano: PlanoAtual | null; resultados: TituloETexto[]; avisos?: string[]; lidoEm?: string }): UpsellDaProposta {
  return {
    lido_em: p.lidoEm || new Date().toISOString(),
    cliente: textoLimpo(p.cliente, 120) || "Cliente",
    servicos: (p.servicos || []).map((s) => textoLimpo(s, 80)).filter(Boolean).slice(0, 12),
    plano: p.plano && p.plano.nome ? p.plano : null,
    resultados: (p.resultados || []).slice(0, 6),
    avisos: (p.avisos || []).map((a) => textoLimpo(a, 200)).filter(Boolean).slice(0, 8),
  };
}

/** Lê o retrato guardado (qualquer formato vira o seguro; sem retrato, null = proposta de cliente novo). */
export function lerUpsell(contexto: unknown): UpsellDaProposta | null {
  const c = contexto && typeof contexto === "object" ? (contexto as Record<string, unknown>) : null;
  const u = c && c.upsell && typeof c.upsell === "object" ? (c.upsell as Record<string, unknown>) : null;
  if (!u) return null;
  const pl = u.plano && typeof u.plano === "object" ? (u.plano as Record<string, unknown>) : null;
  const plano: PlanoAtual | null =
    pl && textoLimpo(pl.nome, 120)
      ? {
          nome: textoLimpo(pl.nome, 120),
          valor: ok(pl.valor) ? pl.valor : null,
          periodo: typeof pl.periodo === "string" ? pl.periodo : null,
          desde: typeof pl.desde === "string" ? pl.desde.slice(0, 10) : null,
          origem: pl.origem === "cadastro" ? "cadastro" : "financeiro",
        }
      : null;
  const lista = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    lido_em: typeof u.lido_em === "string" ? u.lido_em : "",
    cliente: textoLimpo(u.cliente, 120),
    servicos: lista(u.servicos).map((s) => textoLimpo(s, 80)).filter(Boolean).slice(0, 12),
    plano,
    resultados: lista(u.resultados)
      .map((r) => (r && typeof r === "object" ? { titulo: textoLimpo((r as Record<string, unknown>).titulo, 120), texto: textoLimpo((r as Record<string, unknown>).texto, 700) } : null))
      .filter((r): r is TituloETexto => !!r && !!(r.titulo || r.texto))
      .slice(0, 6),
    avisos: lista(u.avisos).map((a) => textoLimpo(a, 200)).filter(Boolean).slice(0, 8),
  };
}

/** Os dados do bloco "O que você já tem" (o texto de abertura fica para a pessoa ou o Preencher com IA). */
export function blocoJaTem(u: UpsellDaProposta, textoAtual = ""): DadosDoBloco["ja_tem"] {
  return { texto: textoLimpo(textoAtual, 900), servicos: u.servicos.slice(), plano: textoDoPlano(u.plano), resultados: u.resultados.slice() };
}

/** O retrato em texto: vira material da proposta (o estrategista lê e os números ganham origem). */
export function textoDoUpsell(u: UpsellDaProposta): string {
  const linhas = [
    `PROPOSTA DE UPSELL para ${u.cliente}: o cliente já trabalha com a Aceleriq. A proposta mostra o que ele já tem e o próximo passo (o que somar), sem repetir o que já está contratado.`,
    `Lido do painel em ${dm(u.lido_em) || "hoje"}.`,
    `Serviços contratados hoje: ${u.servicos.length ? u.servicos.join(", ") : "nenhum marcado no cadastro"}.`,
    `Plano atual: ${textoDoPlano(u.plano) || "sem plano no Financeiro"}.`,
  ];
  if (u.resultados.length) {
    linhas.push("Resultados reais registrados no painel:");
    for (const r of u.resultados) linhas.push(`- ${r.titulo}: ${r.texto}`);
  } else {
    linhas.push("Resultados: nada medido no painel no período. Não cite número de resultado.");
  }
  return linhas.join("\n");
}

export function materialDoUpsell(u: UpsellDaProposta): { nome: string; tipo: string; texto: string; em: string } {
  return { nome: NOME_DO_MATERIAL_DO_UPSELL, tipo: "texto", texto: textoDoUpsell(u), em: u.lido_em || new Date().toISOString() };
}

/** O contexto curto do "Preencher com IA" (teto do servidor: 3000 caracteres). */
export function contextoDoUpsell(u: UpsellDaProposta, max = 2500): string {
  const t = `${textoDoUpsell(u)}\nPedido: sugerir o próximo passo (upsell) a partir do que ele já tem e destes resultados. Use só os números acima; o preço sai dos itens.`;
  return t.length > max ? t.slice(0, max) : t;
}
