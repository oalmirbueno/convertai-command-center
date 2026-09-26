/**
 * Agente sênior que age (pedido do dono em 25/09 à noite): tipos e chamadas
 * das ações na conta (conta_acao_executar / conta_acao_desfazer), do plano de
 * teste já preenchido (plano_do_agente), do que o agente viu (números com a
 * fonte) e do kit de recepção do ângulo (kit_recepcao_gerar / kit_agenda).
 * O servidor traduz apelido em id e confere o estado na Meta; a tela só
 * mostra a lista, a confirmação e o resultado de cada item.
 */
import { chamarFuncao, padraoPara, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { chamarAds } from "./adsApi";

export type TipoDeAcao =
  | "pausar"
  | "ativar"
  | "orcamento"
  | "renomear"
  | "duplicar_anuncio"
  | "trocar_criativo"
  | "plano_de_teste"
  | "tarefa_equipe"
  | "vincular_criativo";

export const ROTULO_DA_ACAO: Record<TipoDeAcao, string> = {
  pausar: "Pausar",
  ativar: "Ativar",
  orcamento: "Mudar orçamento diário",
  renomear: "Renomear",
  duplicar_anuncio: "Duplicar em conjunto novo pausado",
  trocar_criativo: "Subir criativo da Mesa como anúncio novo pausado",
  plano_de_teste: "Levar ao Plano de teste já preenchido",
  tarefa_equipe: "Criar tarefa para a equipe",
  vincular_criativo: "Ligar anúncio ao criativo da Mesa",
};

const NIVEL: Record<string, string> = { campanha: "Campanha", conjunto: "Conjunto", anuncio: "Anúncio" };
export const nomeDoNivel = (n: string) => NIVEL[n] || "Item";

export interface EstadoNaMeta {
  status: string | null;
  orcamento_diario_brl: number | null;
  nome: string | null;
}

export interface ItemDaAcao {
  id: string;
  tipo: TipoDeAcao;
  na_meta: boolean;
  alvo: { nivel: string; nome: string } | null;
  criativo: { nome: string } | null;
  texto: string | null;
  variacao_pct: number | null;
  motivo: string;
  de: EstadoNaMeta | null;
  para: { status?: string; orcamento_diario_brl?: number; nome?: string } | null;
  limitado: boolean;
  indisponivel: string | null;
  resultado: { ok: boolean; motivo: string; criado: Record<string, string>; desfeito: boolean; motivo_desfazer: string } | null;
}

export interface AcoesDaConta {
  resumo: string;
  itens: ItemDaAcao[];
  ignorados: string[];
  gestao: { disponivel: boolean; motivo: string | null } | null;
  executada_em: string | null;
  descartada_em: string | null;
  desfeita_em: string | null;
}

export interface NumerosVistos {
  fonte: string;
  periodo: { inicio: string; fim: string; dias: number } | null;
  atualizado_em: string | null;
  gasto: number | null;
  resultados: number | null;
  resultado_rotulo: string;
  custo_por_resultado: number | null;
  ctr_link_pct: number | null;
  cpm: number | null;
  frequencia: number | null;
  comparacao: { gasto_pct: number | null; resultados_pct: number | null; custo_por_resultado_pct: number | null } | null;
  mix: { rotulo: string; pct: number; gasto: number; resultados: number }[];
  alertas: string[];
  anuncios_ativos: number | null;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
const TIPOS: TipoDeAcao[] = ["pausar", "ativar", "orcamento", "renomear", "duplicar_anuncio", "trocar_criativo", "plano_de_teste", "tarefa_equipe", "vincular_criativo"];

function estado(v: unknown): EstadoNaMeta | null {
  const o = obj(v);
  if (!Object.keys(o).length) return null;
  return { status: txt(o.status) || null, orcamento_diario_brl: num(o.orcamento_diario_brl), nome: txt(o.nome) || null };
}

/** Anexo acoes_conta tolerante (mensagem antiga, campo faltando). Null sem itens. */
export function normalizarAcoesDaConta(bruto: unknown): AcoesDaConta | null {
  const o = obj(bruto);
  const itens: ItemDaAcao[] = lista(o.itens)
    .map((x) => {
      const i = obj(x);
      const tipo = TIPOS.indexOf(i.tipo) >= 0 ? (i.tipo as TipoDeAcao) : null;
      if (!tipo || !txt(i.id)) return null;
      const alvo = obj(i.alvo);
      const r = i.resultado ? obj(i.resultado) : null;
      const para = obj(i.para);
      return {
        id: txt(i.id),
        tipo,
        na_meta: !!i.na_meta,
        alvo: alvo.nome ? { nivel: txt(alvo.nivel), nome: txt(alvo.nome) } : null,
        criativo: obj(i.criativo).nome ? { nome: txt(obj(i.criativo).nome) } : null,
        texto: txt(i.texto) || null,
        variacao_pct: num(i.variacao_pct),
        motivo: txt(i.motivo),
        de: estado(i.de),
        para: Object.keys(para).length ? { status: txt(para.status) || undefined, orcamento_diario_brl: num(para.orcamento_diario_brl) ?? undefined, nome: txt(para.nome) || undefined } : null,
        limitado: !!i.limitado,
        indisponivel: txt(i.indisponivel) || null,
        resultado: r
          ? { ok: !!r.ok, motivo: txt(r.motivo), criado: obj(r.criado) as Record<string, string>, desfeito: !!r.desfeito, motivo_desfazer: txt(r.motivo_desfazer) }
          : null,
      } as ItemDaAcao;
    })
    .filter((x): x is ItemDaAcao => !!x);
  if (!itens.length) return null;
  const g = o.gestao ? obj(o.gestao) : null;
  return {
    resumo: txt(o.resumo),
    itens,
    ignorados: lista(o.ignorados).map(txt).filter(Boolean),
    gestao: g ? { disponivel: !!g.disponivel, motivo: txt(g.motivo) || null } : null,
    executada_em: txt(o.executada_em) || null,
    descartada_em: txt(o.descartada_em) || null,
    desfeita_em: txt(o.desfeita_em) || null,
  };
}

export function normalizarNumerosVistos(bruto: unknown): NumerosVistos | null {
  const o = obj(bruto);
  if (!Object.keys(o).length) return null;
  const p = obj(o.periodo);
  const c = o.comparacao ? obj(o.comparacao) : null;
  return {
    fonte: txt(o.fonte) || "Meta Ads",
    periodo: p.inicio ? { inicio: txt(p.inicio), fim: txt(p.fim), dias: Number(p.dias) || 0 } : null,
    atualizado_em: txt(o.atualizado_em) || null,
    gasto: num(o.gasto),
    resultados: num(o.resultados),
    resultado_rotulo: txt(o.resultado_rotulo) || "resultados",
    custo_por_resultado: num(o.custo_por_resultado),
    ctr_link_pct: num(o.ctr_link_pct),
    cpm: num(o.cpm),
    frequencia: num(o.frequencia),
    comparacao: c ? { gasto_pct: num(c.gasto_pct), resultados_pct: num(c.resultados_pct), custo_por_resultado_pct: num(c.custo_por_resultado_pct) } : null,
    mix: lista(o.mix).map((m) => ({ rotulo: txt(obj(m).rotulo), pct: Number(obj(m).pct) || 0, gasto: Number(obj(m).gasto) || 0, resultados: Number(obj(m).resultados) || 0 })).filter((m) => !!m.rotulo),
    alertas: lista(o.alertas).map(txt).filter(Boolean),
    anuncios_ativos: num(o.anuncios_ativos),
  };
}

/** Estado do cartão: aberto (espera confirmação), feito, cancelado ou desfeito. */
export function estadoDasAcoes(a: AcoesDaConta): "aberta" | "feita" | "descartada" | "desfeita" {
  return a.desfeita_em ? "desfeita" : a.executada_em ? "feita" : a.descartada_em ? "descartada" : "aberta";
}

/** Itens que dá para marcar agora (os indisponíveis ficam de fora, com o motivo à vista). */
export const itensDisponiveis = (a: AcoesDaConta) => a.itens.filter((i) => !i.indisponivel);

export const temDesfazer = (a: AcoesDaConta) =>
  a.itens.some((i) => i.resultado && i.resultado.ok && !i.resultado.desfeito && ["pausar", "ativar", "orcamento", "renomear", "vincular_criativo"].indexOf(i.tipo) >= 0);

export async function executarAcoesDaConta(mensagemId: string, itens: string[] | null, descartar = false) {
  const corpo: Record<string, unknown> = { mensagem_id: mensagemId };
  if (descartar) corpo.descartar = true;
  else if (itens) corpo.itens = itens;
  return chamarAds<any>("conta_acao_executar", corpo);
}

export async function desfazerAcoesDaConta(mensagemId: string) {
  return chamarAds<any>("conta_acao_desfazer", { mensagem_id: mensagemId });
}

/** Cria o Plano de teste já preenchido com a análise desta mensagem (grátis, sem IA). */
export async function criarPlanoDoAgente(mensagemId: string): Promise<{ planoId: string; lacunas: string[]; jaExistia: boolean }> {
  const data = await chamarAds<any>("plano_do_agente", { mensagem_id: mensagemId });
  const plano = obj(data && data.plano);
  return { planoId: txt(plano.id), lacunas: lista(data && data.lacunas).map(txt).filter(Boolean), jaExistia: !!(data && data.ja_existia) };
}

// ------------------------------------------------------------------ plano de teste do agente

export interface TesteDoAgente {
  hipotese: string;
  variavel: string;
  publico: string;
  orcamento_diario_brl: number | null;
  duracao_dias: number | null;
  metrica_decisao: string;
  criterio_vitoria: string;
  lacunas: string[];
}

/** O teste gravado em ads_planos.estrutura.teste (plano criado pelo agente sênior). Null nos outros planos. */
export function testeDoPlano(estrutura: Record<string, unknown> | null | undefined): TesteDoAgente | null {
  const e = obj(estrutura);
  const t = obj(e.teste);
  if (!Object.keys(t).length) return null;
  return {
    hipotese: txt(t.hipotese),
    variavel: txt(t.variavel),
    publico: txt(t.publico),
    orcamento_diario_brl: num(t.orcamento_diario_brl),
    duracao_dias: num(t.duracao_dias),
    metrica_decisao: txt(t.metrica_decisao),
    criterio_vitoria: txt(t.criterio_vitoria),
    lacunas: lista(e.lacunas).map(txt).filter(Boolean),
  };
}

// ------------------------------------------------------------------ kit de recepção

export interface KitDeRecepcao {
  promessa_do_anuncio: string;
  post: { formato: string; titulo: string; gancho: string; roteiro: { ordem: number; texto: string; visual: string }[]; legenda: string; cta: string; por_que_recebe: string };
  perfil: string[];
  comercial: {
    canal: string;
    primeira_resposta: string;
    perguntas_qualificacao: string[];
    objecoes: { objecao: string; resposta: string; fonte: string }[];
    oferta_e_fechamento: string;
    follow_up: { quando: string; mensagem: string }[];
  };
  lacunas: string[];
  conferencia: { post_confirma: number | null; roteiro_fiel: number | null; risco_politica: number | null; alerta: boolean; jev_erro: string | null } | null;
  gerado_em: string | null;
  agenda: { task_id: string; data: string } | null;
}

export function normalizarKit(bruto: unknown): KitDeRecepcao | null {
  const r = obj(bruto);
  if (!Object.keys(r).length) return null;
  const p = obj(r.post);
  const c = obj(r.comercial);
  const conf = r.conferencia ? obj(r.conferencia) : null;
  const ag = r.agenda ? obj(r.agenda) : null;
  return {
    promessa_do_anuncio: txt(r.promessa_do_anuncio),
    post: {
      formato: txt(p.formato) || "carrossel",
      titulo: txt(p.titulo),
      gancho: txt(p.gancho),
      roteiro: lista(p.roteiro).map((x, i) => ({ ordem: Number(obj(x).ordem) || i + 1, texto: txt(obj(x).texto), visual: txt(obj(x).visual) })).filter((x) => !!x.texto),
      legenda: txt(p.legenda),
      cta: txt(p.cta),
      por_que_recebe: txt(p.por_que_recebe),
    },
    perfil: lista(r.perfil).map(txt).filter(Boolean),
    comercial: {
      canal: txt(c.canal) || "WhatsApp",
      primeira_resposta: txt(c.primeira_resposta),
      perguntas_qualificacao: lista(c.perguntas_qualificacao).map(txt).filter(Boolean),
      objecoes: lista(c.objecoes).map((o) => ({ objecao: txt(obj(o).objecao), resposta: txt(obj(o).resposta), fonte: txt(obj(o).fonte) })).filter((o) => !!o.objecao),
      oferta_e_fechamento: txt(c.oferta_e_fechamento),
      follow_up: lista(c.follow_up).map((f) => ({ quando: txt(obj(f).quando), mensagem: txt(obj(f).mensagem) })).filter((f) => !!f.mensagem),
    },
    lacunas: lista(r.lacunas).map(txt).filter(Boolean),
    conferencia: conf ? { post_confirma: num(conf.post_confirma), roteiro_fiel: num(conf.roteiro_fiel), risco_politica: num(conf.risco_politica), alerta: !!conf.alerta, jev_erro: txt(conf.jev_erro) || null } : null,
    gerado_em: txt(r.gerado_em) || null,
    agenda: ag && txt(ag.task_id) ? { task_id: txt(ag.task_id), data: txt(ag.data) } : null,
  };
}

/** O kit guardado no ângulo do plano. */
export const kitDoAngulo = (angulo: unknown): KitDeRecepcao | null => normalizarKit(obj(angulo).kit_recepcao);

/** Roteiro comercial em texto corrido, para colar no WhatsApp Business ou mandar à equipe de atendimento. */
export function roteiroComercialEmTexto(k: KitDeRecepcao): string {
  const c = k.comercial;
  const L: string[] = [`Roteiro de atendimento (${c.canal})`, "", `Promessa do anúncio: ${k.promessa_do_anuncio}`, "", "1. Primeira resposta", c.primeira_resposta, ""];
  if (c.perguntas_qualificacao.length) L.push("2. Perguntas para qualificar (uma por vez)", ...c.perguntas_qualificacao.map((p) => `- ${p}`), "");
  if (c.objecoes.length) L.push("3. Objeções", ...c.objecoes.map((o) => `- ${o.objecao}\n  Resposta: ${o.resposta}`), "");
  if (c.oferta_e_fechamento) L.push("4. Oferta e fechamento", c.oferta_e_fechamento, "");
  if (c.follow_up.length) L.push("5. Follow-up", ...c.follow_up.map((f) => `- ${f.quando}: ${f.mensagem}`));
  return L.join("\n").trim();
}

export async function gerarKit(planoId: string, anguloId: string) {
  return chamarAds<any>("kit_recepcao_gerar", { plano_id: planoId, angulo_id: anguloId });
}

export async function mandarKitParaAgenda(planoId: string, anguloId: string, data: string) {
  return chamarAds<any>("kit_agenda", { plano_id: planoId, angulo_id: anguloId, data });
}

/** Desfaz: arquiva a peça pela Agenda (mesma trava da Mesa) e esquece o vínculo do kit. */
export async function tirarKitDaAgenda(clientId: string, planoId: string, anguloId: string, taskId: string) {
  await chamarFuncao<any>("agente-calendario", { acao: "arquivar_item_agenda", client_id: clientId, task_id: taskId, confirmar_arte: true });
  return chamarAds<any>("kit_agenda", { plano_id: planoId, angulo_id: anguloId, desfazer: true });
}

/** Próximo dia útil (a partir de amanhã), em AAAA-MM-DD, pelo relógio do navegador. */
export function proximoDiaUtil(hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Uma chamada do estrategista (post, perfil e roteiro comercial) + a conferência do Jev. */
export const TAMANHO_DO_KIT = { entrada: 9000, saida: 3500 };

export function partesDoKit(catalogo: ModeloIa[], angulos = 1): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHO_DO_KIT.entrada, tokensSaida: TAMANHO_DO_KIT.saida, vezes: angulos }];
}
