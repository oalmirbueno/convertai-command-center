/**
 * Ações do agente sênior de tráfego na conta de anúncios (pedido do dono em
 * 25/09: "poder agêntico de editar uma campanha e melhorar a campanha através
 * do painel, com base no que ele analisa e no que eu falo com ele").
 *
 * Mesmo desenho do agente do Mês (agente-calendario/acoes-agenda.ts):
 * - o agente nunca vê nem devolve id da Meta nem UUID: campanha, conjunto,
 *   anúncio e criativo da Mesa ganham apelido curto (c1, g1, n1, k1) e o
 *   servidor traduz; apelido inventado vira "ignorado", nunca ação;
 * - nada é feito na hora: a resposta leva o anexo "acoes_conta" com a lista
 *   exata, e só o botão Confirmar da equipe executa (conta_acao_executar);
 * - antes de escrever, o estado é relido na Meta: se mudou desde a proposta,
 *   o item recusa e pede nova análise;
 * - orçamento muda no máximo 30% por confirmação, com antes e depois;
 * - cada item responde por si (motivo quando falha) e o reverso existe para
 *   pausar, ativar, orçamento e nome (Desfazer).
 *
 * Aqui só o que é puro (sem Deno, sem banco): testado no Vitest com um grafo
 * da Meta falso. O token nunca passa por aqui em texto de resposta.
 */
import { regraDeCorte } from "./calculos.ts";
import { OBJETIVOS_DE_CAMPANHA } from "../_shared/conhecimento-ads.ts";
import type { CaminhoDoAgente } from "../_shared/acoes-do-agente.ts";
// Frente FS (29/09): leitura ou gravação que falha segue opcional, mas fica no log com o motivo.
import { registrarFalha } from "../_shared/falha-registrada.ts";

export const TIPOS_DE_ACAO = [
  "pausar",
  "ativar",
  "orcamento",
  "renomear",
  "duplicar_anuncio",
  "trocar_criativo",
  "plano_de_teste",
  "tarefa_equipe",
  "vincular_criativo",
  // 27/09 (frente TR): o plano de teste vira campanha na Meta, tudo PAUSADO; ativar é outro Confirmar.
  "montar_campanha_do_plano",
  // 28/09 (frente AD4, "otimizar"): anúncio novo no mesmo conjunto com o criativo do acervo e o antigo pausado.
  "trocar_anuncio",
] as const;
export type TipoDeAcao = (typeof TIPOS_DE_ACAO)[number];

/** Tipos que escrevem na Meta (precisam de ads_management). */
export const TIPOS_NA_META: readonly TipoDeAcao[] = ["pausar", "ativar", "orcamento", "renomear", "duplicar_anuncio", "trocar_criativo", "montar_campanha_do_plano", "trocar_anuncio"];
export const naMeta = (t: TipoDeAcao) => TIPOS_NA_META.indexOf(t) >= 0;

/**
 * "Ele já vai fazendo" (dono, 27/09: "um clique: o agente analisa e já faz o
 * que é seguro, mostrando o que fez; confirmação só para o que aumenta gasto,
 * cria campanha ou ativa algo novo"). Seguro = reversível e sem aumento de
 * gasto: pausar, baixar verba, renomear e ligar anúncio ao criativo da Mesa.
 * Ativar, subir verba, duplicar, subir criativo, montar campanha, plano e
 * tarefa continuam com Confirmar.
 */
export function acaoSemRisco(i: Pick<ItemDaAcaoNaConta, "tipo" | "variacao_pct" | "para" | "de">): boolean {
  if (i.tipo === "pausar" || i.tipo === "renomear" || i.tipo === "vincular_criativo") return true;
  if (i.tipo === "orcamento") {
    const para = i.para && typeof i.para.orcamento_diario_brl === "number" ? i.para.orcamento_diario_brl : null;
    const de = i.de ? i.de.orcamento_diario_brl : null;
    if (para !== null && de !== null) return para < de;
    return typeof i.variacao_pct === "number" && i.variacao_pct < 0;
  }
  return false;
}

/** Teto de variação do orçamento diário por confirmação (30% para cima ou para baixo). */
export const TETO_DE_ORCAMENTO = 0.3;
/** Orçamento diário mínimo aceito aqui (a Meta tem o seu por moeda; abaixo disso nem propomos). */
export const ORCAMENTO_MINIMO_BRL = 5;
export const MAX_ACOES_POR_PEDIDO = 12;
const MAX_ALVOS = { campanha: 30, conjunto: 40, anuncio: 60, criativo: 40 };

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
  montar_campanha_do_plano: "Montar a campanha do plano na Meta (pausada)",
  trocar_anuncio: "Trocar o criativo: anúncio novo no mesmo conjunto e o antigo pausado",
};

export type Nivel = "campanha" | "conjunto" | "anuncio";
const NOME_DO_NIVEL: Record<Nivel, string> = { campanha: "campanha", conjunto: "conjunto", anuncio: "anúncio" };

export type Alvo = {
  ref: string;
  nivel: Nivel;
  meta_id: string;
  nome: string;
  status: string | null;
  /** Orçamento diário em reais quando o painel já sabe (campanha); conjunto só na leitura ao vivo. */
  orcamento_diario_brl: number | null;
  campanha: string | null;
};

export type CriativoDaMesa = { ref: string; id: string; nome: string; formato: string; ad_id: string | null; tem_arte: boolean };

type ContaParaApelidos = {
  campanhas: { campaign_id: string; nome: string | null; status: string | null; orcamento_diario: number | null }[];
  conjuntos: { adset_id: string; nome: string | null; campanha: string | null }[];
  anuncios: { ad_id: string; nome: string | null; status: string | null; campanha: string | null }[];
};

const ID_META = /^[0-9]{3,30}$/;
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/[–—]/g, ",").trim().slice(0, max) : "");

/** Campanhas c1.., conjuntos g1.., anúncios n1.. (na ordem da conta: ativos e maior gasto primeiro). */
export function alvosComApelido(conta: ContaParaApelidos): Alvo[] {
  const alvos: Alvo[] = [];
  conta.campanhas.filter((c) => ID_META.test(String(c.campaign_id))).slice(0, MAX_ALVOS.campanha).forEach((c, i) =>
    alvos.push({ ref: `c${i + 1}`, nivel: "campanha", meta_id: String(c.campaign_id), nome: limpo(c.nome, 160) || `Campanha ${c.campaign_id}`, status: c.status ?? null, orcamento_diario_brl: c.orcamento_diario ?? null, campanha: null }));
  conta.conjuntos.filter((c) => ID_META.test(String(c.adset_id))).slice(0, MAX_ALVOS.conjunto).forEach((c, i) =>
    alvos.push({ ref: `g${i + 1}`, nivel: "conjunto", meta_id: String(c.adset_id), nome: limpo(c.nome, 160) || `Conjunto ${c.adset_id}`, status: null, orcamento_diario_brl: null, campanha: c.campanha ?? null }));
  conta.anuncios.filter((a) => ID_META.test(String(a.ad_id))).slice(0, MAX_ALVOS.anuncio).forEach((a, i) =>
    alvos.push({ ref: `n${i + 1}`, nivel: "anuncio", meta_id: String(a.ad_id), nome: limpo(a.nome, 160) || `Anúncio ${a.ad_id}`, status: a.status ?? null, orcamento_diario_brl: null, campanha: a.campanha ?? null }));
  return alvos;
}

/** Criativos da Mesa Ads com apelido k1.. (os com arte primeiro). */
export function criativosComApelido(lista: { id: string; nome: string | null; formato: string; ad_id: string | null; tem_arte: boolean }[]): CriativoDaMesa[] {
  return lista
    .slice()
    .sort((a, b) => Number(b.tem_arte) - Number(a.tem_arte))
    .slice(0, MAX_ALVOS.criativo)
    .map((c, i) => ({ ref: `k${i + 1}`, id: c.id, nome: limpo(c.nome, 160) || `Criativo ${i + 1}`, formato: c.formato, ad_id: c.ad_id, tem_arte: c.tem_arte }));
}

/** Bloco do prompt: um alvo por linha, só apelido, nível, nome e status (nunca o id). */
export function blocoDosAlvos(alvos: Alvo[], criativos: CriativoDaMesa[]): string {
  const linha = (a: Alvo) => `${a.ref} | ${NOME_DO_NIVEL[a.nivel]} | ${a.nome}${a.campanha ? ` (campanha ${limpo(a.campanha, 80)})` : ""} | ${a.status ?? "status não lido"}${a.orcamento_diario_brl != null ? ` | R$ ${a.orcamento_diario_brl.toFixed(2)} por dia` : ""}`;
  const partes = [
    "\nALVOS_DAS_ACOES (apelido | nível | nome | status | orçamento). Use SÓ estes apelidos em acoes:",
    ...(alvos.length ? alvos.map(linha) : ["nenhum alvo lido da conta"]),
    "\nCRIATIVOS_DA_MESA_PARA_ACOES (apelido | nome | formato | arte pronta | já ligado a anúncio):",
    ...(criativos.length ? criativos.map((c) => `${c.ref} | ${c.nome} | ${c.formato} | ${c.tem_arte ? "com arte" : "sem arte"} | ${c.ad_id ? "ligado" : "sem anúncio"}`) : ["nenhum criativo da Mesa Ads"]),
  ];
  return partes.join("\n") + "\n";
}

/** Texto da regra no pedido do agente sênior. */
export const REGRA_DAS_ACOES_DA_CONTA = `- acoes: o que você FAZ na conta. Quando a equipe pede para fazer ("faz", "resolve", "otimiza", "pausa esse"), o painel já executa sozinho o que é seguro (pausar, baixar verba, renomear, ligar criativo), relendo a Meta antes, com Desfazer; o que aumenta gasto, cria campanha ou ativa algo novo fica para a equipe confirmar num clique. Proponha quando a análise pedir ou quando a equipe pedir. Cada item: tipo, ref (apelido de ALVOS_DAS_ACOES), criativo_ref (apelido de CRIATIVOS_DA_MESA_PARA_ACOES, só em trocar_criativo e vincular_criativo), texto (novo nome em renomear; título em tarefa_equipe), variacao_pct (só em orcamento: de -30 a 30; o painel limita a 30% por vez) e motivo com o número que justifica. Tipos: pausar e ativar (campanha, conjunto ou anúncio); orcamento (campanha ou conjunto); renomear; duplicar_anuncio (anúncio vencedor vai para um conjunto novo pausado); trocar_criativo (sobe o criativo da Mesa como anúncio novo pausado no conjunto do anúncio ref); vincular_criativo (liga o anúncio ao criativo da Mesa); tarefa_equipe (o que só uma pessoa faz, sem ref); plano_de_teste (leva o plano_de_teste preenchido, sem ref); montar_campanha_do_plano (sem ref, só com PLANO_ABERTO: monta na Meta a campanha do plano com os criativos aprovados, tudo pausado). Nunca pause o último anúncio ativo sem motivo forte. Use SÓ apelidos das listas; nunca escreva número de id; na dúvida sobre qual, pergunte e não proponha. No máximo ${MAX_ACOES_POR_PEDIDO} itens. Sem ação a propor, lista vazia.`;

// ------------------------------------------------------------------ normalização

export type Estado = { status: string | null; efetivo: string | null; orcamento_diario_brl: number | null; nome: string | null };
export type Para = { status?: "ACTIVE" | "PAUSED"; orcamento_diario_brl?: number; nome?: string };

export type ResultadoDoItem = {
  ok: boolean;
  motivo?: string;
  feito_em?: string;
  /** O que foi criado na Meta ou no painel (anúncio novo, conjunto novo, plano, tarefa). */
  criado?: Record<string, string>;
  desfeito?: boolean;
  motivo_desfazer?: string;
  /** Prova da escrita: o estado relido na Meta logo depois (sem token). */
  depois?: Estado | null;
  /** Hora da releitura na Meta depois de escrever (frente AD, 28/09: a prova mostra quando foi relido). */
  relido_em?: string;
  /** O que a Meta respondeu à escrita, só os campos sem segredo (ex.: { success: true }). */
  resposta?: Record<string, unknown> | null;
  /** Frente AD4 (trocar_anuncio): o anúncio novo relido na Meta logo depois (o antigo vai em `depois`). */
  depois_novo?: Estado | null;
  /** Campanha montada e depois ativada pelo Confirmar da equipe. */
  ativada_em?: string;
  motivo_ativar?: string;
};

/**
 * A campanha do plano de teste montada pelo agente sênior: o anúncio modelo
 * empresta a página, o público, o destino e o botão; os criativos aprovados
 * da Mesa entram como anúncios novos. Tudo nasce PAUSADO.
 */
export type Montagem = {
  plano_id: string;
  plano_nome: string;
  campanha_nome: string;
  verba_diaria_brl: number | null;
  objetivo: string | null;
  criativos: { id: string; nome: string }[];
  modelo: { ad_id: string; nome: string } | null;
  /** O que impede montar agora (sem modelo, sem criativo com arte, sem verba). */
  faltas: string[];
};

export type ItemDaAcaoNaConta = {
  id: string;
  tipo: TipoDeAcao;
  na_meta: boolean;
  alvo: { ref: string; nivel: Nivel; meta_id: string; nome: string } | null;
  criativo: { ref: string; id: string; nome: string } | null;
  texto: string | null;
  variacao_pct: number | null;
  motivo: string;
  /** Estado lido na Meta quando a proposta foi feita (fotografia). */
  de: Estado | null;
  para: Para | null;
  limitado: boolean;
  /** Por que o item não pode ser feito agora (já pausado, orçamento em outro nível...). */
  indisponivel: string | null;
  /**
   * Modo ensaio: sem permissão de gestão, o agente propõe igual e o cartão
   * mostra "Seria feito assim", sem executar (a execução recusa).
   */
  ensaio?: boolean;
  /** Feito sozinho, sem Confirmar ("ele já vai fazendo"): reversível e sem aumento de gasto. */
  auto?: boolean;
  /** Só em montar_campanha_do_plano. */
  montagem?: Montagem | null;
  /** Frente AD: o que diferencia itens de mesmo nome na pergunta "qual?" (id curto, status, datas, gasto). */
  detalhe?: string | null;
  /** Frente AD4: a prova da troca do "otimizar" (números antes, régua, Jev, candidato e a copy que vai). */
  troca?: ProvaDaTroca | null;
  resultado?: ResultadoDoItem;
};

/** A prova da troca proposta pelo "otimizar" (otimizar-conta.ts): tudo o que o cartão mostra antes do Confirmar. */
export type ProvaDaTroca = {
  numeros: { periodo: { inicio: string; fim: string; dias: number } | null; gasto: number; impressoes: number; resultados: number; resultado_rotulo: string; custo_por_resultado: number | null; ctr_link_pct: number | null; cpc: number | null; frequencia: number | null };
  regua: { ctr_minimo_pct: number; ctr_mediana_pct: number | null; custo_alvo_brl: number | null; fonte_do_alvo: string };
  problemas: string[];
  jev: { saude: number; prob_candidato: number; nota_copy_atual: number | null };
  candidato: { id: string; nome: string; angulo: string | null; formato: string };
  /** "candidato": sobe a copy do acervo; "atual": só a arte muda, a copy do anúncio fica. */
  copy: "candidato" | "atual";
  sincronizado_em: string | null;
};

export type AcoesDaConta = {
  tipo: "acoes_conta";
  resumo: string;
  itens: ItemDaAcaoNaConta[];
  ignorados: string[];
  gestao: { disponivel: boolean; motivo: string | null } | null;
  /** "ensaio" quando algum item da Meta foi proposto sem permissão de gestão. */
  modo?: "real" | "ensaio";
  /** Contrato comum dos agentes (27/09): o botão "Ir para ..." depois de feito (só rota interna). */
  caminho?: CaminhoDoAgente | null;
  /** Frente AD: itens de mesmo nome; a equipe escolhe UM (um clique escolhe e executa). */
  escolher_um?: boolean;
  executada_em?: string;
  executada_por?: string;
  descartada_em?: string;
  desfeita_em?: string;
};

const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Lê o que o modelo devolveu em `acoes` e troca apelido por alvo. Null quando
 * não sobra nada. Apelido desconhecido, repetido, tipo inválido ou ação sem
 * sentido (pausar o que já está pausado) vai para `ignorados`.
 */
export function normalizarAcoesDaConta(bruto: unknown, alvos: Alvo[], criativos: CriativoDaMesa[], resumoBruto?: unknown, plano?: { id: string; nome: string } | null): AcoesDaConta | null {
  const lista = Array.isArray(bruto) ? bruto : [];
  const porRef = new Map(alvos.map((a) => [a.ref.toLowerCase(), a]));
  const criativoPorRef = new Map(criativos.map((c) => [c.ref.toLowerCase(), c]));
  const usados = new Set<string>();
  const ignorados: string[] = [];
  const itens: ItemDaAcaoNaConta[] = [];
  let temPlano = false;
  let temMontagem = false;

  for (const b of lista.slice(0, MAX_ACOES_POR_PEDIDO * 2)) {
    if (itens.length >= MAX_ACOES_POR_PEDIDO) break;
    const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const tipo = TIPOS_DE_ACAO.indexOf(o.tipo as TipoDeAcao) >= 0 ? (o.tipo as TipoDeAcao) : null;
    const ref = limpo(o.ref, 12).toLowerCase();
    const cref = limpo(o.criativo_ref, 12).toLowerCase();
    const recusar = (porque: string) => ignorados.push(`${tipo ?? String(o.tipo ?? "?")}${ref ? ` ${ref}` : ""}: ${porque}`);
    if (!tipo) {
      recusar("tipo desconhecido");
      continue;
    }
    const motivo = limpo(o.motivo, 600);
    const texto = limpo(o.texto, 200) || null;
    const base = { id: `i${itens.length + 1}`, tipo, na_meta: naMeta(tipo), texto: null as string | null, variacao_pct: null as number | null, motivo, de: null, para: null, limitado: false, indisponivel: null, criativo: null as ItemDaAcaoNaConta["criativo"], alvo: null as ItemDaAcaoNaConta["alvo"] };

    if (tipo === "plano_de_teste") {
      if (temPlano) {
        recusar("plano de teste repetido");
        continue;
      }
      temPlano = true;
      itens.push({ ...base });
      continue;
    }
    if (tipo === "tarefa_equipe") {
      if (!texto) {
        recusar("tarefa sem título");
        continue;
      }
      itens.push({ ...base, texto });
      continue;
    }
    if (tipo === "montar_campanha_do_plano") {
      if (!plano || !plano.id) {
        recusar("sem plano de teste aberto para montar");
        continue;
      }
      if (temMontagem) {
        recusar("montagem repetida");
        continue;
      }
      temMontagem = true;
      itens.push({ ...base, montagem: montagemVazia(plano) });
      continue;
    }

    const alvo = porRef.get(ref);
    if (!alvo) {
      recusar("apelido que não está na lista");
      continue;
    }
    const chave = `${tipo}:${alvo.ref}`;
    const conflito = (tipo === "pausar" || tipo === "ativar") && (usados.has(`pausar:${alvo.ref}`) || usados.has(`ativar:${alvo.ref}`));
    if (usados.has(chave) || conflito) {
      recusar("repetido ou em conflito com outro item");
      continue;
    }
    const comAlvo = { ...base, alvo: { ref: alvo.ref, nivel: alvo.nivel, meta_id: alvo.meta_id, nome: alvo.nome } };

    if (tipo === "pausar" || tipo === "ativar") {
      const quer = tipo === "pausar" ? "PAUSED" : "ACTIVE";
      if (alvo.status && alvo.status.toUpperCase() === quer) {
        recusar(tipo === "pausar" ? "já está pausado" : "já está ativo");
        continue;
      }
      usados.add(chave);
      itens.push({ ...comAlvo, para: { status: quer } });
      continue;
    }
    if (tipo === "orcamento") {
      const v = numero(o.variacao_pct);
      if (alvo.nivel === "anuncio" || v === null || v === 0) {
        recusar(alvo.nivel === "anuncio" ? "anúncio não tem orçamento próprio" : "variação de orçamento vazia");
        continue;
      }
      usados.add(chave);
      const conta = calcularOrcamento(alvo.orcamento_diario_brl, v);
      itens.push({ ...comAlvo, variacao_pct: conta ? conta.variacao_pct : Math.max(-30, Math.min(30, v)), limitado: conta ? conta.limitado : Math.abs(v) > 30, para: conta ? { orcamento_diario_brl: conta.para } : null });
      continue;
    }
    if (tipo === "renomear") {
      if (!texto || texto === alvo.nome) {
        recusar("nome novo vazio ou igual");
        continue;
      }
      usados.add(chave);
      itens.push({ ...comAlvo, texto, para: { nome: texto } });
      continue;
    }
    if (tipo === "duplicar_anuncio") {
      if (alvo.nivel !== "anuncio") {
        recusar("só anúncio se duplica aqui");
        continue;
      }
      usados.add(chave);
      itens.push({ ...comAlvo });
      continue;
    }
    // trocar_criativo, trocar_anuncio e vincular_criativo: anúncio + criativo da Mesa
    const c = criativoPorRef.get(cref);
    if (alvo.nivel !== "anuncio" || !c) {
      recusar(alvo.nivel !== "anuncio" ? "precisa ser um anúncio" : "criativo da Mesa fora da lista");
      continue;
    }
    if ((tipo === "trocar_criativo" || tipo === "trocar_anuncio") && !c.tem_arte) {
      recusar("criativo da Mesa ainda sem arte pronta");
      continue;
    }
    if (tipo === "vincular_criativo" && c.ad_id === alvo.meta_id) {
      recusar("já está ligado");
      continue;
    }
    usados.add(chave);
    itens.push({ ...comAlvo, criativo: { ref: c.ref, id: c.id, nome: c.nome } });
  }

  if (!itens.length) return null;
  const resumo = limpo(resumoBruto, 600) || `${itens.length} ${itens.length === 1 ? "ação pronta" : "ações prontas"} para confirmar.`;
  return { tipo: "acoes_conta", resumo, itens, ignorados, gestao: null };
}

// ------------------------------------------------------------------ orçamento

/**
 * Novo orçamento diário a partir do atual e da variação pedida, preso ao teto
 * de 30% por confirmação e ao mínimo. Null sem orçamento atual.
 */
export function calcularOrcamento(atualBrl: number | null, variacaoPct: number, teto = TETO_DE_ORCAMENTO): { para: number; variacao_pct: number; limitado: boolean } | null {
  if (atualBrl === null || !(atualBrl > 0) || !Number.isFinite(variacaoPct) || variacaoPct === 0) return null;
  const maximo = teto * 100;
  const aplicada = Math.max(-maximo, Math.min(maximo, variacaoPct));
  let para = Math.round(atualBrl * (1 + aplicada / 100) * 100) / 100;
  let limitado = aplicada !== variacaoPct;
  if (para < ORCAMENTO_MINIMO_BRL) {
    para = Math.min(atualBrl, ORCAMENTO_MINIMO_BRL);
    limitado = true;
  }
  return { para, variacao_pct: Math.round(((para - atualBrl) / atualBrl) * 1000) / 10, limitado };
}

/** Orçamento que a Meta devolve (centavos, em texto) em reais. */
export function reaisDaMeta(v: unknown): number | null {
  const n = numero(v);
  return n === null || n <= 0 ? null : Math.round(n) / 100;
}

/** O objeto lido na Meta (id, name, status, effective_status, daily_budget) no formato do painel. */
export function estadoLido(bruto: Record<string, unknown> | null): Estado | null {
  if (!bruto || typeof bruto !== "object" || !bruto.id) return null;
  return {
    status: typeof bruto.status === "string" ? bruto.status : null,
    efetivo: typeof bruto.effective_status === "string" ? bruto.effective_status : null,
    orcamento_diario_brl: reaisDaMeta(bruto.daily_budget),
    nome: typeof bruto.name === "string" ? bruto.name : null,
  };
}

export const CAMPOS_DO_ESTADO = (nivel: Nivel) => (nivel === "anuncio" ? "id,name,status,effective_status,account_id" : "id,name,status,effective_status,daily_budget,account_id");

/**
 * O objeto lido é de uma conta de anúncios deste cliente? (a lista de ações
 * fica na conversa, que a equipe pode editar: o id da Meta nunca é confiado
 * sem esta conferência). Null = pode seguir; texto = motivo da recusa.
 */
export function foraDasContas(bruto: Record<string, unknown> | null, contas: Set<string> | null | undefined): string | null {
  if (!contas) return null;
  const conta = String((bruto && bruto.account_id) ?? "").replace(/^act_/, "");
  return conta && contas.has(conta) ? null : "Este item não é de uma conta de anúncios ligada a este cliente. Nada foi feito.";
}

/**
 * Fotografia da proposta: o estado lido na Meta vira o "antes", e o orçamento
 * é recalculado sobre o valor real (com o teto). Sem leitura, o item fica
 * indisponível com o motivo.
 */
export function fotografar(item: ItemDaAcaoNaConta, lido: Estado | null): ItemDaAcaoNaConta {
  if (!item.na_meta || !item.alvo) return item;
  if (!lido) return { ...item, indisponivel: "Não foi possível ler este item na Meta agora." };
  const novo: ItemDaAcaoNaConta = { ...item, de: lido };
  if (item.tipo === "pausar" && lido.status === "PAUSED") return { ...novo, indisponivel: "Já está pausado na Meta." };
  if (item.tipo === "ativar" && lido.status === "ACTIVE") return { ...novo, indisponivel: "Já está ativo na Meta." };
  if (item.tipo === "orcamento") {
    const conta = calcularOrcamento(lido.orcamento_diario_brl, item.variacao_pct ?? 0);
    if (!conta) {
      return { ...novo, para: null, indisponivel: item.alvo.nivel === "campanha" ? "Esta campanha não tem orçamento diário próprio (a verba fica nos conjuntos)." : "Este conjunto não tem orçamento diário próprio (a verba fica na campanha)." };
    }
    return { ...novo, para: { orcamento_diario_brl: conta.para }, variacao_pct: conta.variacao_pct, limitado: item.limitado || conta.limitado };
  }
  if (item.tipo === "renomear" && lido.nome === item.texto) return { ...novo, indisponivel: "O nome já é este." };
  return novo;
}

/**
 * Conferência antes de escrever: o que está na Meta agora é o mesmo da
 * proposta? Devolve o motivo da recusa, ou null quando pode seguir.
 */
export function mudouDesdeAProposta(item: ItemDaAcaoNaConta, agora: Estado | null): string | null {
  if (!item.de) return "A proposta não tem o estado lido na Meta. Peça nova análise ao agente.";
  if (!agora) return "Não foi possível reler este item na Meta agora. Tente de novo em instantes.";
  const diferencas: string[] = [];
  if ((item.de.status ?? "") !== (agora.status ?? "")) diferencas.push(`status era ${item.de.status ?? "sem status"} e agora é ${agora.status ?? "sem status"}`);
  const a = item.de.orcamento_diario_brl;
  const b = agora.orcamento_diario_brl;
  if ((a === null) !== (b === null) || (a !== null && b !== null && Math.abs(a - b) > 0.009)) diferencas.push(`orçamento era ${brl(a)} e agora é ${brl(b)}`);
  if ((item.de.nome ?? "") !== (agora.nome ?? "")) diferencas.push("o nome mudou");
  return diferencas.length ? `Mudou na Meta desde a proposta (${diferencas.join("; ")}). Peça nova análise ao agente.` : null;
}

const brl = (v: number | null) => (v === null ? "sem orçamento" : `R$ ${v.toFixed(2).replace(".", ",")}`);

// ------------------------------------------------------------------ permissão

/** Permissões concedidas (status granted) na resposta de /me/permissions; null quando a resposta não veio. */
export function escoposConcedidos(bruto: unknown): string[] | null {
  const data = bruto && typeof bruto === "object" && Array.isArray((bruto as Record<string, unknown>).data) ? (bruto as { data: Record<string, unknown>[] }).data : null;
  if (!data) return null;
  return [...new Set(data.filter((p) => p && p.status === "granted").map((p) => String(p.permission)))].sort();
}

/** Escopos que a escrita precisa (ads_read para reler o estado, ads_management para mudar). */
export const ESCOPOS_DA_GESTAO = ["ads_read", "ads_management"];

/** Gestão a partir da lista de escopos concedidos: disponível ou exatamente o que falta. */
export function gestaoDosEscopos(escopos: string[] | null): { disponivel: boolean; motivo: string | null; faltam: string[] } {
  if (!escopos) return { disponivel: false, motivo: "Não foi possível conferir as permissões do token na Meta.", faltam: ESCOPOS_DA_GESTAO.slice() };
  const faltam = ESCOPOS_DA_GESTAO.filter((e) => escopos.indexOf(e) < 0);
  if (!faltam.length) return { disponivel: true, motivo: null, faltam };
  return {
    disponivel: false,
    faltam,
    motivo: escopos.indexOf("ads_read") >= 0
      ? "O acesso de anúncios deste cliente só tem leitura (ads_read). Para o agente mexer na campanha, conecte com permissão de gestão (ads_management)."
      : "O token de anúncios não tem permissão de gestão (ads_management).",
  };
}

/** /me/permissions do token: ads_management concedido libera a escrita. */
export function permissaoDeGestao(bruto: unknown): { disponivel: boolean; motivo: string | null } {
  const g = gestaoDosEscopos(escoposConcedidos(bruto));
  return { disponivel: g.disponivel, motivo: g.motivo };
}

/**
 * account_status da Meta que travam a conta (1 = ativa não entra). Com saldo
 * em aberto (3) a Meta para a entrega e recusa mudanças com um "Permissions
 * error" genérico (visto em 27/09 na Conta 01 Aceleriq, código 200).
 */
const SITUACAO_DA_CONTA: Record<number, string> = {
  2: "está desativada na Meta. Veja a Qualidade da conta no Gerenciador de Anúncios.",
  3: "está com pagamento pendente na Meta (saldo em aberto). Enquanto não quitar, a Meta não entrega os anúncios e recusa mudanças. Quite em Cobrança e pagamentos do Gerenciador de Anúncios e clique em Conferir agora.",
  7: "está em análise de risco na Meta. Aguarde a análise ou veja a Qualidade da conta.",
  8: "está com acerto de pagamento pendente na Meta. Confira em Cobrança e pagamentos do Gerenciador de Anúncios.",
  9: "está no prazo de carência de pagamento na Meta. Confira em Cobrança e pagamentos.",
  100: "está em fechamento na Meta.",
  101: "foi fechada na Meta.",
};

/**
 * Onde a gestão vale de fato numa conta de anúncios. O escopo ads_management
 * no token não basta: no Login for Business ele vale só para as contas
 * marcadas na tela da Meta (granular_scopes.target_ids do debug_token), e o
 * perfil precisa poder anunciar nela (user_tasks com MANAGE ou ADVERTISE).
 * Devolve o motivo do bloqueio, ou null quando nada indica bloqueio.
 */
export function bloqueioDaGestaoNaConta(debug: unknown, conta: unknown, contaId: string): string | null {
  const id = String(contaId).replace(/^act_/, "");
  const c = conta && typeof conta === "object" ? (conta as Record<string, unknown>) : {};
  const nome = limpo(c.name, 80) || id;
  const dados = debug && typeof debug === "object" ? ((debug as Record<string, unknown>).data as Record<string, unknown> | undefined) : undefined;
  const granular = dados && Array.isArray(dados.granular_scopes) ? (dados.granular_scopes as Record<string, unknown>[]) : [];
  const gestao = granular.find((s) => s && s.scope === "ads_management");
  const alvos = gestao && Array.isArray(gestao.target_ids) ? (gestao.target_ids as unknown[]).map((x) => String(x).replace(/^act_/, "")) : null;
  if (alvos && alvos.length && alvos.indexOf(id) < 0) {
    return `A conta de anúncios ${nome} não foi marcada para gestão ao conectar. Clique em Conectar pedindo gestão e, na tela da Meta, marque essa conta de anúncios.`;
  }
  const situacao = SITUACAO_DA_CONTA[Number(c.account_status)];
  if (situacao) return `A conta de anúncios ${nome} ${situacao}`;
  const tarefas = Array.isArray(c.user_tasks) ? (c.user_tasks as unknown[]).map(String) : null;
  if (tarefas && tarefas.length && tarefas.indexOf("MANAGE") < 0 && tarefas.indexOf("ADVERTISE") < 0) {
    return `O perfil que conectou só analisa a conta ${nome} (${tarefas.join(", ")}). No Gerenciador de Negócios, dê a ele o papel de anunciante ou administrador dessa conta.`;
  }
  return null;
}

/** debug_token do próprio token (tipo e granular_scopes). O token fica no servidor; nunca volta na resposta. */
export async function lerDebugDoToken(token: string, versao = "v21.0", buscar: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  try {
    const u = new URL(`https://graph.facebook.com/${versao}/debug_token`);
    u.searchParams.set("input_token", token);
    u.searchParams.set("access_token", token);
    const res = await buscar(u, { signal: prazo(12_000) });
    const corpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return res.ok && corpo && !corpo.error ? corpo : null;
  } catch {
    return null;
  }
}

/** A conferência guardada ainda vale? (a tela não pergunta à Meta a cada abertura) */
export function conferenciaValida(conferidoEm: string | null | undefined, agoraMs: number, validadeMs: number): boolean {
  const t = conferidoEm ? Date.parse(conferidoEm) : NaN;
  return Number.isFinite(t) && agoraMs - t >= 0 && agoraMs - t < validadeMs;
}

/**
 * Modo ensaio: sem gestão, os itens da Meta continuam na lista, com o antes
 * e o depois, marcados "ensaio" (a tela mostra "Seria feito assim" e a
 * execução recusa). Os itens do painel (plano, tarefa, vínculo) seguem reais.
 */
export function marcarEnsaio(acoes: AcoesDaConta, gestao: { disponivel: boolean; motivo: string | null }): AcoesDaConta {
  if (gestao.disponivel) return { ...acoes, gestao, modo: "real" };
  const itens = acoes.itens.map((i) => (i.na_meta ? { ...i, ensaio: true } : i));
  return { ...acoes, itens, gestao, modo: itens.some((i) => i.na_meta) ? "ensaio" : "real" };
}

/**
 * Cache curto na memória da função (a mesma instância atende pedidos
 * seguidos): leituras iguais dentro do prazo reaproveitam o resultado, e
 * duas chamadas ao mesmo tempo esperam a mesma leitura.
 */
export class CacheCurto<T> {
  private mapa = new Map<string, { em: number; valor: Promise<T> }>();
  constructor(private prazoMs: number, private maximo = 50, private relogio: () => number = () => Date.now()) {}
  obter(chave: string, ler: () => Promise<T>): Promise<T> {
    const agora = this.relogio();
    const guardado = this.mapa.get(chave);
    if (guardado && agora - guardado.em < this.prazoMs) return guardado.valor;
    const valor = ler();
    this.mapa.set(chave, { em: agora, valor });
    valor.catch(() => this.mapa.delete(chave));
    if (this.mapa.size > this.maximo) {
      const velha = this.mapa.keys().next().value;
      if (velha !== undefined) this.mapa.delete(velha);
    }
    return valor;
  }
  esquecer(prefixo: string) {
    for (const k of [...this.mapa.keys()]) if (k.indexOf(prefixo) === 0) this.mapa.delete(k);
  }
}

// ------------------------------------------------------------------ Meta (grafo injetável)

/** Grafo da Meta: em produção, fetch com o token do cofre; no teste, um falso. */
export interface GrafoMeta {
  ler(caminho: string, campos: string): Promise<Record<string, unknown> | null>;
  escrever(caminho: string, params: Record<string, string>): Promise<Record<string, unknown>>;
}

export class ErroDaMeta extends Error {
  constructor(public codigo: number, mensagem: string) {
    super(mensagem);
  }
}

/** Mensagem curta e sem token a partir do erro da Graph API. */
export function motivoDoErroDaMeta(corpo: unknown, status: number): string {
  const e = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>).error as Record<string, unknown> | undefined : undefined;
  const codigo = Number(e?.code ?? 0);
  if (codigo === 200 || codigo === 10 || codigo === 294) {
    // O motivo exato da Meta separa "conta não marcada no login" de "perfil sem papel de anunciante".
    const original = e && typeof e.message === "string" ? limpo(e.message.replace(/access_token=[^&\s]+/gi, ""), 200) : "";
    const sub = e && e.error_subcode ? ` · subcódigo ${Number(e.error_subcode)}` : "";
    return `A Meta recusou a gestão nesta conta (código ${codigo}${sub})${original ? `: ${original}` : ""}. Confira se esta conta de anúncios foi marcada ao conectar e se o seu perfil é administrador ou anunciante dela.`;
  }
  if (codigo === 190) return "O acesso à Meta venceu. Conecte a conta de anúncios de novo.";
  if (codigo === 17 || codigo === 4 || codigo === 80004) return "A Meta pediu uma pausa (limite de chamadas). Tente de novo em alguns minutos.";
  if (codigo === 100 && e && typeof e.error_user_msg === "string") return `A Meta recusou: ${limpo(e.error_user_msg, 240)}`;
  const msg = e && typeof e.message === "string" ? limpo(e.message.replace(/access_token=[^&\s]+/gi, ""), 240) : "";
  return msg ? `A Meta recusou: ${msg}` : `A Meta não respondeu como esperado (${status}).`;
}

/** Prazo da chamada (AbortSignal.timeout onde existe; sem ele, sem prazo). */
const prazo = (ms: number): AbortSignal | undefined => (typeof AbortSignal !== "undefined" && typeof (AbortSignal as unknown as { timeout?: unknown }).timeout === "function" ? AbortSignal.timeout(ms) : undefined);

/** Grafo real (fetch). O token vai no corpo do POST e na consulta do GET, nunca volta na resposta. */
export function grafoDaMeta(token: string, versao = "v21.0", buscar: typeof fetch = fetch): GrafoMeta {
  const base = `https://graph.facebook.com/${versao}/`;
  const tratar = async (res: Response) => {
    const corpo = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok || !corpo || corpo.error) {
      const e = corpo && typeof corpo.error === "object" ? corpo.error as Record<string, unknown> : null;
      throw new ErroDaMeta(Number(e?.code ?? res.status), motivoDoErroDaMeta(corpo, res.status));
    }
    return corpo;
  };
  return {
    async ler(caminho, campos) {
      const u = new URL(base + caminho.replace(/^\/+/, ""));
      u.searchParams.set("fields", campos);
      u.searchParams.set("access_token", token);
      try {
        return await tratar(await buscar(u, { signal: prazo(12_000) }));
      } catch (e) {
        if (e instanceof ErroDaMeta && e.codigo !== 100) throw e;
        return null;
      }
    },
    async escrever(caminho, params) {
      const corpo = new URLSearchParams(params);
      corpo.set("access_token", token);
      return await tratar(await buscar(base + caminho.replace(/^\/+/, ""), { method: "POST", body: corpo, signal: prazo(20_000) }));
    },
  };
}

/** A resposta da Meta a uma escrita, sem nada que possa carregar segredo: só sucesso e ids. */
export function respostaCurta(r: unknown): Record<string, unknown> | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  if (typeof o.success === "boolean") saida.success = o.success;
  if (typeof o.id === "string" && ID_META.test(o.id)) saida.id = o.id;
  return Object.keys(saida).length ? saida : null;
}

/** Apoio para trocar o criativo: a arte em base64 e a copy do criativo da Mesa. */
export type ApoioDoCriativo = {
  imagemBase64: () => Promise<string | null>;
  copy: { texto_principal?: string | null; titulo?: string | null; descricao?: string | null };
  nome: string;
};

const agoraIso = () => new Date().toISOString();

/**
 * Executa um item na Meta: relê, confere se mudou, escreve. Nunca lança:
 * devolve o resultado do item com o motivo quando falha.
 */
export async function executarNaMeta(item: ItemDaAcaoNaConta, grafo: GrafoMeta, apoio?: ApoioDoCriativo | null, contas?: Set<string> | null): Promise<ResultadoDoItem> {
  if (!item.na_meta || !item.alvo) return { ok: false, motivo: "Este item não é da Meta." };
  if (item.indisponivel) return { ok: false, motivo: item.indisponivel };
  const alvo = item.alvo;
  try {
    const extra = item.tipo === "duplicar_anuncio" ? ",adset_id" : item.tipo === "trocar_criativo" || item.tipo === "trocar_anuncio" ? ",adset_id,creative{id,object_story_spec}" : "";
    const bruto = await grafo.ler(alvo.meta_id, CAMPOS_DO_ESTADO(alvo.nivel) + extra);
    const fora = foraDasContas(bruto, contas);
    if (fora) return { ok: false, motivo: fora };
    const mudou = mudouDesdeAProposta(item, estadoLido(bruto));
    if (mudou) return { ok: false, motivo: mudou };

    // Prova da escrita: o estado relido logo depois (sem token; falha na releitura não desfaz nada),
    // a hora da releitura e o que a Meta respondeu (frente AD: "a prova lida da Meta depois de escrever").
    const relerDepois = async () => estadoLido(await grafo.ler(alvo.meta_id, CAMPOS_DO_ESTADO(alvo.nivel)).catch((e) => (registrarFalha("mesa-ads: leitura na Meta falhou", e), null)));
    const provado = async (resposta: Record<string, unknown>): Promise<ResultadoDoItem> => {
      const feito = agoraIso();
      const depois = await relerDepois();
      return { ok: true, feito_em: feito, depois, relido_em: agoraIso(), resposta: respostaCurta(resposta) };
    };
    if (item.tipo === "pausar" || item.tipo === "ativar") {
      return await provado(await grafo.escrever(alvo.meta_id, { status: item.tipo === "pausar" ? "PAUSED" : "ACTIVE" }));
    }
    if (item.tipo === "orcamento") {
      const para = item.para?.orcamento_diario_brl;
      const de = item.de?.orcamento_diario_brl ?? null;
      if (!para || !de) return { ok: false, motivo: "Sem orçamento para mudar." };
      if (Math.abs(para - de) / de > TETO_DE_ORCAMENTO + 0.0001 && para > ORCAMENTO_MINIMO_BRL) return { ok: false, motivo: "A mudança passa do teto de 30% por confirmação." };
      return await provado(await grafo.escrever(alvo.meta_id, { daily_budget: String(Math.round(para * 100)) }));
    }
    if (item.tipo === "renomear") {
      if (!item.texto) return { ok: false, motivo: "Nome novo vazio." };
      return await provado(await grafo.escrever(alvo.meta_id, { name: item.texto }));
    }
    if (item.tipo === "duplicar_anuncio") {
      const conjunto = bruto && typeof bruto.adset_id === "string" ? bruto.adset_id : null;
      if (!conjunto) return { ok: false, motivo: "Não achei o conjunto deste anúncio na Meta." };
      const copia = await grafo.escrever(`${conjunto}/copies`, { deep_copy: "false", status_option: "PAUSED", rename_options: JSON.stringify({ rename_suffix: " (cópia Mesa Ads)" }) });
      const novoConjunto = String(copia.copied_adset_id ?? "");
      if (!ID_META.test(novoConjunto)) return { ok: false, motivo: "A Meta não devolveu o conjunto copiado." };
      try {
        const ad = await grafo.escrever(`${alvo.meta_id}/copies`, { adset_id: novoConjunto, status_option: "PAUSED" });
        const novoAd = String(ad.copied_ad_id ?? "");
        return { ok: true, feito_em: agoraIso(), criado: { conjunto_id: novoConjunto, anuncio_id: novoAd } };
      } catch (e) {
        return { ok: false, motivo: `O conjunto novo foi criado pausado (${novoConjunto}), mas o anúncio não foi copiado: ${e instanceof Error ? e.message : "erro da Meta"}`, criado: { conjunto_id: novoConjunto } };
      }
    }
    if (item.tipo === "trocar_criativo" || item.tipo === "trocar_anuncio") {
      if (!apoio) return { ok: false, motivo: "O criativo da Mesa não foi encontrado." };
      if (item.tipo === "trocar_anuncio") {
        // Troca de verdade: o anúncio precisa estar entregando (nunca ativa campanha ou conjunto parado).
        const lido = estadoLido(bruto);
        if (!lido || lido.status !== "ACTIVE" || (lido.efetivo && lido.efetivo !== "ACTIVE")) {
          return { ok: false, motivo: "O anúncio não está entregando agora (ele, o conjunto ou a campanha está pausado). Não subi nada e não ativei nada parado." };
        }
      }
      const subido = await subirCriativoNovo(bruto, grafo, apoio, item.tipo === "trocar_anuncio" && !!item.troca && item.troca.copy === "atual");
      if ("motivo" in subido) return { ok: false, motivo: subido.motivo };
      const { conjunto, conta, creativeId } = subido;
      if (item.tipo === "trocar_criativo") {
        const ad = await grafo.escrever(`act_${conta}/ads`, { name: `${alvo.nome} (criativo da Mesa)`.slice(0, 200), adset_id: conjunto, creative: JSON.stringify({ creative_id: creativeId }), status: "PAUSED" });
        const adId = String(ad.id ?? "");
        if (!ID_META.test(adId)) return { ok: false, motivo: "O criativo subiu, mas o anúncio novo não foi criado.", criado: { creative_id: creativeId } };
        return { ok: true, feito_em: agoraIso(), criado: { anuncio_id: adId, creative_id: creativeId } };
      }
      // trocar_anuncio: o novo entra no mesmo conjunto (mesmo público e verba) e o antigo pausa.
      const ad = await grafo.escrever(`act_${conta}/ads`, { name: `${apoio.nome} | Mesa Ads (no lugar de ${alvo.nome})`.slice(0, 200), adset_id: conjunto, creative: JSON.stringify({ creative_id: creativeId }), status: "ACTIVE" });
      const adId = String(ad.id ?? "");
      if (!ID_META.test(adId)) return { ok: false, motivo: "O criativo subiu, mas o anúncio novo não foi criado. O antigo segue como estava.", criado: { creative_id: creativeId } };
      try {
        await grafo.escrever(alvo.meta_id, { status: "PAUSED" });
      } catch (e) {
        // Não deixa os dois rodando: o novo volta a pausado e a equipe decide.
        const voltou = await grafo.escrever(adId, { status: "PAUSED" }).then(() => true, () => false);
        return {
          ok: false,
          motivo: `O anúncio novo foi criado, mas o antigo não pausou (${e instanceof Error ? e.message : "erro da Meta"}). ${voltou ? "Pausei o novo para não rodarem os dois." : "O novo também não pausou: confira na Meta."}`,
          criado: { anuncio_id: adId, creative_id: creativeId },
        };
      }
      const feito = agoraIso();
      const [antigo, novo] = await Promise.all([
        grafo.ler(alvo.meta_id, CAMPOS_DO_ESTADO("anuncio")).catch((e) => (registrarFalha("mesa-ads: leitura na Meta falhou", e), null)),
        grafo.ler(adId, CAMPOS_DO_ESTADO("anuncio")).catch((e) => (registrarFalha("mesa-ads: leitura na Meta falhou", e), null)),
      ]);
      return {
        ok: true,
        feito_em: feito,
        criado: { anuncio_id: adId, creative_id: creativeId, anuncio_antigo_id: alvo.meta_id },
        depois: estadoLido(antigo),
        depois_novo: estadoLido(novo),
        relido_em: agoraIso(),
        resposta: respostaCurta(ad),
      };
    }
    return { ok: false, motivo: "Ação desconhecida." };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "Não foi possível fazer na Meta." };
  }
}

/** Itens que têm reverso na Meta (o que foi criado pausado fica, a equipe decide). */
export const temReverso = (i: ItemDaAcaoNaConta) =>
  !!(i.resultado && i.resultado.ok && !i.resultado.desfeito) &&
  (i.tipo === "pausar" || i.tipo === "ativar" || i.tipo === "orcamento" || i.tipo === "renomear" || i.tipo === "vincular_criativo" ||
    // Troca: o Desfazer pausa o novo e volta o antigo (só se ninguém mexeu depois).
    (i.tipo === "trocar_anuncio" && !!(i.resultado.criado && i.resultado.criado.anuncio_id)) ||
    // Montagem: o Desfazer arquiva o que foi criado (deletar = arquivar).
    (i.tipo === "montar_campanha_do_plano" && !!(i.resultado.criado && i.resultado.criado.campanha_id)));

/**
 * Desfaz um item da Meta: só se o estado atual ainda é o que o painel deixou
 * (ninguém mexeu depois). Nunca lança.
 */
export async function desfazerNaMeta(item: ItemDaAcaoNaConta, grafo: GrafoMeta, contas?: Set<string> | null): Promise<{ ok: boolean; motivo?: string }> {
  if (item.tipo === "montar_campanha_do_plano" && temReverso(item)) return await arquivarMontagem(item, grafo, contas);
  if (item.tipo === "trocar_anuncio" && temReverso(item)) return await desfazerTroca(item, grafo, contas);
  if (!item.alvo || !item.de || !temReverso(item)) return { ok: false, motivo: "Este item não tem como desfazer." };
  try {
    const bruto = await grafo.ler(item.alvo.meta_id, CAMPOS_DO_ESTADO(item.alvo.nivel));
    const fora = foraDasContas(bruto, contas);
    if (fora) return { ok: false, motivo: fora };
    const agora = estadoLido(bruto);
    if (!agora) return { ok: false, motivo: "Não foi possível reler na Meta." };
    if (item.tipo === "pausar" || item.tipo === "ativar") {
      const deixado = item.tipo === "pausar" ? "PAUSED" : "ACTIVE";
      if (agora.status !== deixado) return { ok: false, motivo: "Mudou na Meta depois da ação: não mexi." };
      await grafo.escrever(item.alvo.meta_id, { status: item.de.status === "ACTIVE" ? "ACTIVE" : "PAUSED" });
      return { ok: true };
    }
    if (item.tipo === "orcamento") {
      const deixado = item.para?.orcamento_diario_brl ?? null;
      if (deixado === null || agora.orcamento_diario_brl === null || Math.abs(agora.orcamento_diario_brl - deixado) > 0.009 || item.de.orcamento_diario_brl === null) return { ok: false, motivo: "O orçamento mudou depois da ação: não mexi." };
      await grafo.escrever(item.alvo.meta_id, { daily_budget: String(Math.round(item.de.orcamento_diario_brl * 100)) });
      return { ok: true };
    }
    if (item.tipo === "renomear") {
      if (agora.nome !== item.texto || !item.de.nome) return { ok: false, motivo: "O nome mudou depois da ação: não mexi." };
      await grafo.escrever(item.alvo.meta_id, { name: item.de.nome });
      return { ok: true };
    }
    return { ok: false, motivo: "Este item não tem como desfazer na Meta." };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "Não foi possível desfazer." };
  }
}

/**
 * Sobe a arte do criativo da Mesa como criativo novo na conta do anúncio lido
 * (mesma página, link, botão e Instagram). `manterCopy`: a copy do anúncio
 * fica (só a arte muda). Nunca devolve id sem conferir; o motivo vem em texto.
 */
async function subirCriativoNovo(bruto: Record<string, unknown> | null, grafo: GrafoMeta, apoio: ApoioDoCriativo, manterCopy: boolean): Promise<{ conjunto: string; conta: string; creativeId: string } | { motivo: string }> {
  const conjunto = bruto && typeof bruto.adset_id === "string" ? bruto.adset_id : null;
  const conta = bruto && typeof bruto.account_id === "string" ? bruto.account_id.replace(/^act_/, "") : null;
  const criativo = bruto && bruto.creative && typeof bruto.creative === "object" ? bruto.creative as Record<string, unknown> : null;
  const spec = criativo && criativo.object_story_spec && typeof criativo.object_story_spec === "object" ? criativo.object_story_spec as Record<string, unknown> : null;
  const link = spec && spec.link_data && typeof spec.link_data === "object" ? spec.link_data as Record<string, unknown> : null;
  if (!conjunto || !conta) return { motivo: "Não achei o conjunto ou a conta deste anúncio na Meta." };
  if (!spec || !link || Array.isArray(link.child_attachments)) return { motivo: "Só anúncio de imagem única com link pode trocar o criativo por aqui. Vídeo e carrossel: troque pela Meta." };
  const bytes = await apoio.imagemBase64();
  if (!bytes) return { motivo: "A arte do criativo da Mesa não pôde ser lida." };
  const up = await grafo.escrever(`act_${conta}/adimages`, { bytes });
  const hash = hashDaImagem(up);
  if (!hash) return { motivo: "A Meta não devolveu a imagem enviada." };
  const novoSpec = specComNovaArte(spec, hash, manterCopy ? {} : apoio.copy);
  const cr = await grafo.escrever(`act_${conta}/adcreatives`, { name: `${apoio.nome} (Mesa Ads)`.slice(0, 100), object_story_spec: JSON.stringify(novoSpec) });
  const creativeId = String(cr.id ?? "");
  if (!ID_META.test(creativeId)) return { motivo: "A Meta não devolveu o criativo novo." };
  return { conjunto, conta, creativeId };
}

/**
 * Desfaz a troca: só se o novo segue ativo e o antigo segue pausado como o
 * painel deixou. Pausa o novo e volta o antigo; se o antigo não voltar,
 * reativa o novo (a conta não fica sem nenhum dos dois). Nunca lança.
 */
async function desfazerTroca(item: ItemDaAcaoNaConta, grafo: GrafoMeta, contas?: Set<string> | null): Promise<{ ok: boolean; motivo?: string }> {
  const novoId = item.resultado && item.resultado.criado ? item.resultado.criado.anuncio_id : null;
  if (!item.alvo || !novoId || !ID_META.test(novoId)) return { ok: false, motivo: "Este item não tem como desfazer." };
  try {
    const [antigoBruto, novoBruto] = await Promise.all([
      grafo.ler(item.alvo.meta_id, CAMPOS_DO_ESTADO("anuncio")),
      grafo.ler(novoId, CAMPOS_DO_ESTADO("anuncio")),
    ]);
    const fora = foraDasContas(antigoBruto, contas) || foraDasContas(novoBruto, contas);
    if (fora) return { ok: false, motivo: fora };
    const antigo = estadoLido(antigoBruto);
    const novo = estadoLido(novoBruto);
    if (!antigo || !novo) return { ok: false, motivo: "Não foi possível reler os dois anúncios na Meta." };
    if (antigo.status !== "PAUSED" || novo.status !== "ACTIVE") return { ok: false, motivo: "Mudou na Meta depois da troca: não mexi." };
    await grafo.escrever(novoId, { status: "PAUSED" });
    try {
      await grafo.escrever(item.alvo.meta_id, { status: "ACTIVE" });
    } catch (e) {
      const voltou = await grafo.escrever(novoId, { status: "ACTIVE" }).then(() => true, () => false);
      return { ok: false, motivo: `O antigo não voltou (${e instanceof Error ? e.message : "erro da Meta"}). ${voltou ? "Deixei o novo rodando como estava." : "O novo ficou pausado: confira na Meta."}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "Não foi possível desfazer." };
  }
}

function hashDaImagem(r: Record<string, unknown>): string | null {
  const imagens = r && typeof r.images === "object" && r.images ? Object.values(r.images as Record<string, Record<string, unknown>>) : [];
  const h = imagens.length && imagens[0] && typeof imagens[0].hash === "string" ? imagens[0].hash : null;
  return h;
}

/** O object_story_spec do anúncio original com a arte e a copy do criativo da Mesa (mesma página, link e botão). */
export function specComNovaArte(spec: Record<string, unknown>, hash: string, copy: ApoioDoCriativo["copy"]): Record<string, unknown> {
  const link = { ...(spec.link_data as Record<string, unknown>) };
  delete link.picture;
  delete link.image_url;
  delete link.image_crops;
  link.image_hash = hash;
  if (copy.texto_principal) link.message = copy.texto_principal;
  if (copy.titulo) link.name = copy.titulo;
  if (copy.descricao) link.description = copy.descricao;
  const novo: Record<string, unknown> = { page_id: spec.page_id, link_data: link };
  if (spec.instagram_user_id) novo.instagram_user_id = spec.instagram_user_id;
  else if (spec.instagram_actor_id) novo.instagram_actor_id = spec.instagram_actor_id;
  return novo;
}

// ------------------------------------------------------------------ montar a campanha do plano

export function montagemVazia(plano: { id: string; nome: string }): Montagem {
  return { plano_id: plano.id, plano_nome: limpo(plano.nome, 160) || "Plano de teste", campanha_nome: "", verba_diaria_brl: null, objetivo: null, criativos: [], modelo: null, faltas: [] };
}

/** O item de montagem já pronto (o botão "Enviar ao agente sênior" pede; não depende do agente propor). */
export function itemDeMontagem(plano: { id: string; nome: string }, motivo: string, id: string): ItemDaAcaoNaConta {
  return {
    id, tipo: "montar_campanha_do_plano", na_meta: true, alvo: null, criativo: null, texto: null, variacao_pct: null,
    motivo: limpo(motivo, 600), de: null, para: null, limitado: false, indisponivel: null, montagem: montagemVazia(plano),
  };
}

/**
 * Completa a montagem com o que o servidor leu: criativos do plano com arte
 * pronta (até 6), o anúncio modelo da conta e a verba do plano. O que falta
 * vira `faltas` (e o item fica indisponível com o motivo), nunca inventado.
 */
export function completarMontagem(m: Montagem, e: {
  criativos: { id: string; nome: string | null; tem_arte: boolean }[];
  modelo: { ad_id: string; nome: string | null } | null;
  verba_diaria_brl: number | null;
  objetivo: string | null;
  hoje: string;
  teto_diario_brl?: number | null;
}): Montagem {
  const criativos = e.criativos.filter((c) => c.tem_arte).slice(0, 6).map((c) => ({ id: c.id, nome: limpo(c.nome, 160) || "Criativo da Mesa" }));
  const verba = typeof e.verba_diaria_brl === "number" && e.verba_diaria_brl > 0 ? Math.round(e.verba_diaria_brl * 100) / 100 : null;
  const faltas: string[] = [];
  if (!criativos.length) faltas.push("Nenhum criativo deste plano está com arte pronta. Gere as artes no Estúdio Ads e mande de novo.");
  if (!e.modelo) faltas.push("A conta não tem anúncio ativo de imagem para servir de modelo (página, público, destino e botão). Monte a primeira campanha pela Meta; as próximas o agente monta.");
  if (verba === null) faltas.push("O plano está sem verba diária. Defina a verba no Plano de teste e mande de novo.");
  else if (verba < ORCAMENTO_MINIMO_BRL) faltas.push(`A verba diária do plano (R$ ${verba.toFixed(2).replace(".", ",")}) está abaixo do mínimo de R$ ${ORCAMENTO_MINIMO_BRL},00.`);
  else if (typeof e.teto_diario_brl === "number" && e.teto_diario_brl > 0 && verba > e.teto_diario_brl) faltas.push(`A verba diária do plano (R$ ${verba.toFixed(2).replace(".", ",")}) passa do teto diário da rotina (R$ ${e.teto_diario_brl.toFixed(2).replace(".", ",")}).`);
  const data = e.hoje.split("-").reverse().slice(0, 2).join("/");
  return {
    ...m,
    campanha_nome: limpo(`${m.plano_nome} | Mesa Ads | ${data}`, 200),
    verba_diaria_brl: verba,
    objetivo: e.objetivo,
    criativos,
    modelo: e.modelo ? { ad_id: e.modelo.ad_id, nome: limpo(e.modelo.nome, 160) || `Anúncio ${e.modelo.ad_id}` } : null,
    faltas,
  };
}

const idMeta = (v: unknown) => {
  const s = String(v ?? "");
  return ID_META.test(s) ? s : null;
};

/**
 * Monta a campanha do plano na Meta, tudo PAUSADO: campanha nova com o
 * objetivo do anúncio modelo, cópia do conjunto do modelo (público, local e
 * destino) e um anúncio novo por criativo aprovado (arte e copy da Mesa,
 * página e botão do modelo). A verba do plano vai no orçamento da campanha.
 * Se parar no meio, arquiva o que criou. Nunca lança.
 */
export async function montarCampanhaNaMeta(item: ItemDaAcaoNaConta, grafo: GrafoMeta, apoios: ApoioDoCriativo[], contas?: Set<string> | null): Promise<ResultadoDoItem> {
  const m = item.montagem;
  if (item.tipo !== "montar_campanha_do_plano" || !m) return { ok: false, motivo: "Montagem sem os dados do plano." };
  if (item.indisponivel) return { ok: false, motivo: item.indisponivel };
  if (m.faltas.length) return { ok: false, motivo: m.faltas.join(" ") };
  if (!m.modelo || m.verba_diaria_brl === null) return { ok: false, motivo: "Montagem sem anúncio modelo ou sem verba." };
  if (!apoios.length) return { ok: false, motivo: "Os criativos do plano não foram encontrados." };
  try {
    const modelo = await grafo.ler(m.modelo.ad_id, "id,name,account_id,adset_id,campaign_id,creative{id,object_story_spec}");
    const fora = foraDasContas(modelo, contas);
    if (fora) return { ok: false, motivo: fora };
    const conta = modelo && typeof modelo.account_id === "string" ? modelo.account_id.replace(/^act_/, "") : null;
    const conjuntoModelo = modelo ? idMeta(modelo.adset_id) : null;
    const campanhaModelo = modelo ? idMeta(modelo.campaign_id) : null;
    const criativo = modelo && modelo.creative && typeof modelo.creative === "object" ? modelo.creative as Record<string, unknown> : null;
    const spec = criativo && criativo.object_story_spec && typeof criativo.object_story_spec === "object" ? criativo.object_story_spec as Record<string, unknown> : null;
    const link = spec && spec.link_data && typeof spec.link_data === "object" ? spec.link_data as Record<string, unknown> : null;
    if (!conta || !conjuntoModelo || !campanhaModelo) return { ok: false, motivo: "Não achei a conta, o conjunto ou a campanha do anúncio modelo na Meta." };
    if (!spec || !link || Array.isArray(link.child_attachments)) return { ok: false, motivo: "O anúncio modelo precisa ser de imagem única com link ou WhatsApp. Vídeo e carrossel: monte pela Meta." };
    const campModelo = await grafo.ler(campanhaModelo, "id,objective,special_ad_categories,bid_strategy");
    if (!campModelo || typeof campModelo.objective !== "string") return { ok: false, motivo: "Não consegui ler o objetivo da campanha modelo na Meta." };
    // Sempre orçamento de campanha (Advantage): 1 campanha, 1 conjunto consolidado (estrutura para
    // negócio local) e a cópia do conjunto herda o orçamento da campanha de destino. Evita também o
    // is_adset_budget_sharing_enabled que a v24 passou a exigir em campanha sem orçamento de campanha.
    const params: Record<string, string> = {
      name: m.campanha_nome || `${m.plano_nome} | Mesa Ads`,
      objective: campModelo.objective,
      status: "PAUSED",
      buying_type: "AUCTION",
      daily_budget: String(Math.round(m.verba_diaria_brl * 100)),
      special_ad_categories: JSON.stringify(Array.isArray(campModelo.special_ad_categories) ? campModelo.special_ad_categories : []),
    };
    if (typeof campModelo.bid_strategy === "string") params.bid_strategy = campModelo.bid_strategy;
    const nova = await grafo.escrever(`act_${conta}/campaigns`, params);
    const campanhaId = idMeta(nova.id);
    if (!campanhaId) return { ok: false, motivo: "A Meta não devolveu a campanha nova." };
    const criado: Record<string, string> = { campanha_id: campanhaId };
    try {
      const copia = await grafo.escrever(`${conjuntoModelo}/copies`, { campaign_id: campanhaId, deep_copy: "false", status_option: "PAUSED", rename_options: JSON.stringify({ rename_suffix: " (Mesa Ads)" }) });
      const conjunto = idMeta(copia.copied_adset_id);
      if (!conjunto) throw new Error("A Meta não devolveu o conjunto copiado.");
      criado.conjunto_id = conjunto;
      const anuncios: string[] = [];
      const falhas: string[] = [];
      for (const apoio of apoios) {
        try {
          const bytes = await apoio.imagemBase64();
          if (!bytes) {
            falhas.push(`${apoio.nome}: a arte não pôde ser lida.`);
            continue;
          }
          const hash = hashDaImagem(await grafo.escrever(`act_${conta}/adimages`, { bytes }));
          if (!hash) {
            falhas.push(`${apoio.nome}: a Meta não devolveu a imagem.`);
            continue;
          }
          const cr = await grafo.escrever(`act_${conta}/adcreatives`, { name: `${apoio.nome} (Mesa Ads)`.slice(0, 100), object_story_spec: JSON.stringify(specComNovaArte(spec, hash, apoio.copy)) });
          const creativeId = idMeta(cr.id);
          if (!creativeId) {
            falhas.push(`${apoio.nome}: a Meta não devolveu o criativo.`);
            continue;
          }
          const ad = await grafo.escrever(`act_${conta}/ads`, { name: `${apoio.nome}`.slice(0, 200), adset_id: conjunto, creative: JSON.stringify({ creative_id: creativeId }), status: "PAUSED" });
          const adId = idMeta(ad.id);
          if (adId) anuncios.push(adId);
          else falhas.push(`${apoio.nome}: o anúncio não foi criado.`);
        } catch (e) {
          falhas.push(`${apoio.nome}: ${e instanceof Error ? e.message : "erro da Meta"}`);
        }
      }
      if (!anuncios.length) throw new Error(`Nenhum anúncio subiu. ${falhas.join(" ")}`.trim());
      criado.anuncio_ids = anuncios.join(",");
      const depois = estadoLido(await grafo.ler(campanhaId, "id,name,status,effective_status,daily_budget,account_id").catch((e) => (registrarFalha("mesa-ads: leitura na Meta falhou", e), null)));
      return {
        ok: true,
        feito_em: agoraIso(),
        criado,
        depois,
        motivo: falhas.length ? `Subiram ${anuncios.length} de ${apoios.length} anúncios. ${falhas.join(" ")}` : undefined,
      };
    } catch (e) {
      // Nada pela metade: a campanha criada é arquivada (deletar = arquivar).
      await grafo.escrever(campanhaId, { status: "ARCHIVED" }).catch((e) => (registrarFalha("mesa-ads: escrever falhou", e), null));
      return { ok: false, motivo: `A montagem parou no meio e a campanha criada foi arquivada: ${e instanceof Error ? e.message : "erro da Meta"}`, criado };
    }
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "Não foi possível montar na Meta." };
  }
}

/** Desfazer da montagem: arquiva a campanha criada (para a entrega e tira da lista; nada é apagado). */
export async function arquivarMontagem(item: ItemDaAcaoNaConta, grafo: GrafoMeta, contas?: Set<string> | null): Promise<{ ok: boolean; motivo?: string }> {
  const id = item.resultado && item.resultado.criado ? idMeta(item.resultado.criado.campanha_id) : null;
  if (!id) return { ok: false, motivo: "Não há campanha criada para arquivar." };
  try {
    const lido = await grafo.ler(id, "id,status,account_id");
    const fora = foraDasContas(lido, contas);
    if (fora) return { ok: false, motivo: fora };
    if (!lido) return { ok: false, motivo: "Não foi possível reler a campanha na Meta." };
    if (lido.status === "ARCHIVED" || lido.status === "DELETED") return { ok: true };
    await grafo.escrever(id, { status: "ARCHIVED" });
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "Não foi possível arquivar." };
  }
}

/**
 * Ativa a campanha montada (Confirmar da equipe: começa a gastar). Relê cada
 * parte: só ativa se ainda estiver pausada como o painel deixou. Anúncios,
 * conjunto e por último a campanha. Nunca lança.
 */
export async function ativarMontagem(item: ItemDaAcaoNaConta, grafo: GrafoMeta, contas?: Set<string> | null): Promise<{ ok: boolean; motivo?: string; depois?: Estado | null }> {
  const r = item.resultado;
  const criado = r && r.criado ? r.criado : null;
  const campanha = criado ? idMeta(criado.campanha_id) : null;
  if (item.tipo !== "montar_campanha_do_plano" || !r || !r.ok || r.desfeito || !campanha) return { ok: false, motivo: "Não há campanha montada para ativar." };
  if (r.ativada_em) return { ok: false, motivo: "Esta campanha já foi ativada." };
  try {
    const lida = await grafo.ler(campanha, "id,status,account_id");
    const fora = foraDasContas(lida, contas);
    if (fora) return { ok: false, motivo: fora };
    if (!lida || lida.status !== "PAUSED") return { ok: false, motivo: "A campanha não está mais pausada como o painel deixou (mudou na Meta). Nada foi ativado." };
    const anuncios = String(criado?.anuncio_ids ?? "").split(",").map(idMeta).filter((x): x is string => !!x);
    for (const ad of anuncios) {
      const a = await grafo.ler(ad, "id,status");
      if (a && a.status === "PAUSED") await grafo.escrever(ad, { status: "ACTIVE" });
    }
    const conjunto = idMeta(criado?.conjunto_id);
    if (conjunto) await grafo.escrever(conjunto, { status: "ACTIVE" });
    await grafo.escrever(campanha, { status: "ACTIVE" });
    return { ok: true, depois: estadoLido(await grafo.ler(campanha, "id,name,status,effective_status,daily_budget,account_id").catch((e) => (registrarFalha("mesa-ads: leitura na Meta falhou", e), null))) };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "Não foi possível ativar na Meta." };
  }
}

// ------------------------------------------------------------------ plano de teste preenchido

export type PlanoDeTesteDoAgente = {
  hipotese: string;
  variavel: string;
  publico: string;
  orcamento_diario_brl: number | null;
  duracao_dias: number;
  metrica_decisao: string;
  criterio_vitoria: string;
};

type ProximoCriativo = { titulo: string; angulo: string; gancho_verbal: string; gancho_visual: string; formato: string; estilo_visual: string | null; objetivo: string | null; cta_meta: string; porque: string };
type EstrategiaParaPlano = {
  resposta?: string;
  reestruturacao: { objetivo: string | null; campanhas: { conjuntos: { publico: string; orcamento_diario_brl: number | null }[]; orcamento_diario_brl: number | null }[]; verba_total_diaria_brl: number | null };
  proximos_criativos: ProximoCriativo[];
  plano_de_teste?: Partial<PlanoDeTesteDoAgente> | null;
};

export type ContextoDoPlano = {
  objetivoDoBriefing: string | null;
  publicoDoBriefing: string | null;
  custoToleravel: number | null;
  custoMedioConta: number | null;
  /** Gasto médio por dia no período (para a verba do teste quando o agente não deu uma). */
  gastoMedioDiario: number | null;
  hoje: string;
};

const FORMATOS_VALIDOS = ["feed_4x5", "quadrado_1x1", "stories_9x16", "carrossel"];

/**
 * O plano de teste já preenchido a partir da análise do agente (item 4 do
 * pedido do dono: "quando eu clicar, ele já tem que mandar preenchendo").
 * Sem IA: o que o agente disse entra; o que faltou vem da conta e do
 * briefing, calculado aqui; o que não tem base vai para `lacunas` (a tela
 * mostra para a equipe revisar), nunca inventado.
 */
export function planoDeTesteDaEstrategia(e: EstrategiaParaPlano, ctx: ContextoDoPlano) {
  const lacunas: string[] = [];
  const pt = e.plano_de_teste ?? {};
  const criativos = e.proximos_criativos.slice(0, 6);
  const objetivo = e.reestruturacao.objetivo || (criativos[0] && criativos[0].objetivo) || ctx.objetivoDoBriefing || null;
  const doObjetivo = OBJETIVOS_DE_CAMPANHA.find((o) => o.id === objetivo) ?? null;
  const conjunto = e.reestruturacao.campanhas.flatMap((c) => c.conjuntos)[0] ?? null;
  const duracao = Math.min(14, Math.max(3, Math.round(numero(pt.duracao_dias) ?? 7)));
  const verbaDoAgente = numero(pt.orcamento_diario_brl);
  const orcamento = verbaDoAgente && verbaDoAgente > 0
    ? Math.round(verbaDoAgente * 100) / 100
    : conjunto && conjunto.orcamento_diario_brl
    ? conjunto.orcamento_diario_brl
    : e.reestruturacao.verba_total_diaria_brl
    ? e.reestruturacao.verba_total_diaria_brl
    : ctx.gastoMedioDiario && ctx.gastoMedioDiario > 0
    ? Math.round(ctx.gastoMedioDiario * 100) / 100
    : null;
  if (orcamento === null) lacunas.push("Verba diária do teste: sem gasto no período nem verba no briefing. Defina antes de subir.");
  const publico = limpo(pt.publico, 600) || (conjunto ? limpo(conjunto.publico, 600) : "") || limpo(ctx.publicoDoBriefing, 600);
  if (!publico) lacunas.push("Público do teste: o briefing não tem público definido.");
  const metrica = limpo(pt.metrica_decisao, 200) || (doObjetivo ? doObjetivo.metrica_que_decide : "") || "custo por resultado";
  const corte = regraDeCorte({ metrica, custoToleravel: ctx.custoToleravel, custoMedioConta: ctx.custoMedioConta, janelaDias: duracao });
  const criterio = limpo(pt.criterio_vitoria, 600) ||
    (corte.limite_brl !== null
      ? `Vence o ângulo com ${metrica} abaixo de R$ ${corte.limite_brl.toFixed(2).replace(".", ",")} depois de ${corte.impressoes_minimas.toLocaleString("pt-BR")} impressões e ${duracao} dias; empate, fica o de mais resultados. ${corte.texto}`
      : `Vence o ângulo com o menor ${metrica} depois de ${corte.impressoes_minimas.toLocaleString("pt-BR")} impressões e ${duracao} dias. ${corte.texto}`);
  const hipotese = limpo(pt.hipotese, 1200) || (criativos[0] ? limpo(`${criativos[0].angulo}. ${criativos[0].porque}`, 1200) : "");
  if (!hipotese) lacunas.push("Hipótese: o agente não deixou uma. Escreva numa frase o que o teste quer provar.");
  if (!criativos.length) lacunas.push("Criativos do teste: o agente não sugeriu próximos criativos. Gere os ângulos pelo botão Gerar plano.");
  const variavel = limpo(pt.variavel, 300) || "O ângulo (gancho verbal e visual). Público, verba, formato e botão iguais entre os anúncios.";

  const angulos = criativos.map((c, i) => ({
    id: `a${i + 1}`,
    nome: limpo(c.titulo, 120),
    situacao: limpo(c.angulo, 800),
    mecanismo: "",
    tecnica: "",
    referencia_ids: [] as string[],
    prova: "",
    gancho_visual: limpo(c.gancho_visual, 600),
    gancho_verbal: limpo(c.gancho_verbal, 300),
    hipotese: limpo(c.porque, 1200) || hipotese,
    metrica,
    janela_dias: duracao,
    formatos: [FORMATOS_VALIDOS.indexOf(c.formato) >= 0 ? c.formato : "feed_4x5"],
    variacoes: 1,
    estagio_consciencia: null,
    estilo_visual: c.estilo_visual || null,
    objetivo: c.objetivo || objetivo,
    jev: null,
    pontuacao: null,
    rodadas: 0,
    aprovado: true,
    motivos: [] as string[],
    tom: null,
    porque_testar_primeiro: limpo(c.porque, 600),
    ordem_teste: i + 1,
    corte,
    cta_meta: c.cta_meta,
  }));

  const teste: PlanoDeTesteDoAgente = { hipotese, variavel, publico, orcamento_diario_brl: orcamento, duracao_dias: duracao, metrica_decisao: metrica, criterio_vitoria: criterio };
  return {
    nome: `Teste do agente sênior ${ctx.hoje.split("-").reverse().join("/")}`,
    objetivo,
    angulos,
    estrutura: {
      resumo: hipotese,
      objetivo,
      origem: "agente_senior",
      teste,
      lacunas,
      conjuntos: [{ nome: "Teste de ângulos", angulo_ids: angulos.map((a) => a.id), verba_diaria_brl: orcamento, observacao: publico }],
      verba_diaria_total_brl: orcamento,
      janela_dias: duracao,
      observacoes: variavel,
      qualidade: { rodadas: 0, do_agente: true },
    },
    lacunas,
  };
}
