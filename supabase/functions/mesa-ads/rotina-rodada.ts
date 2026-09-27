/**
 * Uma rodada da rotina de tráfego de um cliente (frente TR, 27/09/2026).
 *
 * O fio da rodada, com o banco, a Meta e o Jev injetados (deps): quem chama
 * (index.ts, pelo cron com x-cron-secret ou pelo botão "Rodar agora") monta
 * as dependências reais; o teste monta falsas. Nada aqui lê segredo, e o
 * token da Meta só existe dentro do grafo que chega pronto.
 *
 * Ordem da rodada:
 * 1. a rotina ainda está ligada? (o dono pode pausar a qualquer hora; a flag
 *    é relida antes de CADA escrita, então vale também para a rodada em curso);
 * 2. gestão: conta travada ou só leitura = um aviso só, e não age;
 * 3. retrato da conta (7 dias, código) e as regras fixas de cada item;
 * 4. fora do normal (dado velho, gasto disparado, resultado zerado, pausa em
 *    massa) = para e avisa uma vez;
 * 5. o Jev julga os candidatos (uma chamada: uma Choice por caso e um Noul de
 *    "fora do normal");
 * 6. travas duras (regras do dono, limite por rodada e por dia, mesmo item em
 *    24 h, verba a cada 72 h, última coisa ativa, teto);
 * 7. para cada ação: relê na Meta (estado e, com coleta velha, os números),
 *    confere a prova, escreve, relê depois, registra em "O que foi feito",
 *    avisa (um aviso por ação feita) e manda para o dossiê;
 * 8. propostas (criativo novo) ficam como cartão com Confirmar;
 * 9. grava o que viu, o que fez e o que pretende fazer na próxima rodada.
 */
import {
  CAMPOS_DO_ESTADO,
  estadoLido,
  executarNaMeta,
  foraDasContas,
  type GrafoMeta,
  type ItemDaAcaoNaConta,
  reaisDaMeta,
} from "./acoes-conta.ts";
import {
  type AcaoRecente,
  aplicarTravas,
  avaliarItem,
  candidatosDaRodada,
  decidirComJev,
  type EstadoLidoNaMeta,
  foraDoNormal,
  type ItemDaConta,
  type Limites,
  limitesDoDono,
  limitesEfetivos,
  novaVerba,
  normalizarRegras,
  numerosDaMeta,
  numerosDaProva,
  PADROES_DA_ROTINA,
  perguntasDaRodada,
  propostaDeCriativo,
  type Prova,
  provaSuficiente,
  reavaliarComMeta,
  type ReferenciaDoNicho,
  type RegraDoDono,
  regrasQueValem,
  type RetratoDaConta,
} from "./rotina-trafego.ts";

/** Linha de public.ads_rotina (SQL TR-01). */
export type LinhaDaRotina = {
  client_id: string;
  ligada: boolean;
  teto_diario_brl: number | string | null;
  subida_max_pct: number | string | null;
  max_acoes_rodada: number | null;
  max_acoes_dia: number | null;
  limites: unknown;
  regras: unknown;
  estado: unknown;
  ultima_rodada_em: string | null;
  ligada_por: string | null;
  pausada_em?: string | null;
};

export type ConfigDaRotina = {
  ligada: boolean;
  teto_diario_brl: number | null;
  subida_max_pct: number;
  max_acoes_rodada: number;
  max_acoes_dia: number;
  limites: Partial<Limites>;
  regras: RegraDoDono[];
};

const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const inteiroEntre = (v: unknown, min: number, max: number, padrao: number) => {
  const n = numero(v);
  return n === null ? padrao : Math.max(min, Math.min(max, Math.round(n)));
};

/** Configuração da rotina a partir da linha, sempre dentro das travas. */
export function configDaLinha(l: Partial<LinhaDaRotina> | null | undefined): ConfigDaRotina {
  const P = PADROES_DA_ROTINA;
  const teto = numero(l?.teto_diario_brl);
  const subida = numero(l?.subida_max_pct);
  return {
    ligada: !!l?.ligada,
    teto_diario_brl: teto !== null && teto > 0 ? Math.round(teto * 100) / 100 : null,
    subida_max_pct: subida !== null ? Math.max(5, Math.min(P.subida_teto_pct, subida)) : P.subida_padrao_pct,
    max_acoes_rodada: inteiroEntre(l?.max_acoes_rodada, 1, 10, P.max_acoes_rodada),
    max_acoes_dia: inteiroEntre(l?.max_acoes_dia, 1, 30, P.max_acoes_dia),
    limites: limitesDoDono(l?.limites),
    regras: normalizarRegras(l?.regras),
  };
}

/** O que a faixa "O agente está cuidando desta conta" mostra (ads_rotina.estado). */
export type EstadoDaRotina = {
  rodada_em: string;
  olhando: string;
  fez: string[];
  planeja: string[];
  parou_por: string | null;
  bloqueio: string | null;
  sincronizado_em: string | null;
  proxima_rodada_em: string;
  /** Motivo de aviso já dado, com a hora (um aviso só por motivo a cada 24 h). */
  avisos: Record<string, string>;
};

/** Linha de "O que foi feito" (public.ads_rotina_acoes). */
export type RegistroDaRotina = {
  rodada_id: string | null;
  origem: "rotina" | "agente";
  tipo: "pausar" | "orcamento" | "proposta" | "parada";
  estado: "feita" | "falhou" | "proposta";
  alvo: { nivel: string; meta_id: string; nome: string } | null;
  resumo: string;
  porque: string;
  prova: Prova | Record<string, unknown>;
  desfazer: Record<string, unknown> | null;
  mensagem_id?: string | null;
};

export type DadosDoRetrato = {
  retrato: RetratoDaConta;
  nicho: { id: string; nome: string } | null;
  objetivo: string | null;
  estrategia: string | null;
  custoDoPlano: number | null;
  custoDoBriefing: number | null;
  referencia: ReferenciaDoNicho | null;
  /** Tipos de ação da Meta que contam como resultado, por tipo de resultado (evolucao.ts). */
  tiposDeAcao: (tipo: string | null) => string[];
};

export type DepsDaRodada = {
  agoraMs: () => number;
  hoje: string;
  novoId: () => string;
  lerRotina: () => Promise<LinhaDaRotina | null>;
  lerRetrato: () => Promise<DadosDoRetrato>;
  acesso: () => Promise<{ grafo: GrafoMeta | null; disponivel: boolean; motivo: string | null }>;
  contas: () => Promise<Set<string>>;
  recentes: () => Promise<AcaoRecente[]>;
  /** Propostas abertas por item (não repete a mesma proposta em 72 h). */
  propostasAbertas: () => Promise<Set<string>>;
  jev: (state: unknown, questions: Record<string, unknown>) => Promise<{ answers: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }> }>;
  registrar: (r: RegistroDaRotina) => Promise<string | null>;
  avisar: (mensagem: string) => Promise<void>;
  dossie: (titulo: string, conteudo: string, metadata: Record<string, unknown>) => Promise<void>;
  salvarEstado: (e: EstadoDaRotina) => Promise<void>;
  auditar: (ferramenta: string, entrada: Record<string, unknown>, ok: boolean, motivo: string | null, ref: string | null) => Promise<void>;
  /** Resultado depois das ações de 24 h ou mais sem ele (preenche com os números de agora). */
  resultadoDepois?: (totais: RetratoDaConta["totais"], periodo: RetratoDaConta["periodo"]) => Promise<void>;
  nomeDoCliente: string;
};

export type ResumoDaRodada = {
  rodou: boolean;
  motivo: string | null;
  feitas: number;
  propostas: number;
  barradas: number;
  estado: EstadoDaRotina | null;
};

const reais = (v: number | null | undefined) => (v == null ? "sem valor" : `R$ ${v.toFixed(2).replace(".", ",")}`);
const hora = (iso: string | null) => (iso ? new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(11, 16) : "hora desconhecida");
const NIVEL: Record<string, string> = { campanha: "a campanha", conjunto: "o conjunto", anuncio: "o anúncio" };

function estadoLidoComAprendizado(bruto: Record<string, unknown> | null): EstadoLidoNaMeta | null {
  const e = estadoLido(bruto);
  if (!e) return null;
  const info = bruto && bruto.learning_stage_info && typeof bruto.learning_stage_info === "object" ? bruto.learning_stage_info as Record<string, unknown> : null;
  return { ...e, aprendizado: info && typeof info.status === "string" ? info.status : null };
}

/** Uma chave curta por motivo (um aviso só por motivo a cada 24 h). */
const chaveDoMotivo = (m: string) => m.replace(/[0-9]+([,.][0-9]+)?/g, "#").slice(0, 80);

async function avisarUmaVez(deps: DepsDaRodada, avisos: Record<string, string>, motivo: string, mensagem: string) {
  const chave = chaveDoMotivo(motivo);
  const antes = avisos[chave] ? Date.parse(avisos[chave]) : NaN;
  if (Number.isFinite(antes) && deps.agoraMs() - antes < 24 * 3600_000) return;
  await deps.avisar(mensagem);
  avisos[chave] = new Date(deps.agoraMs()).toISOString();
}

/**
 * Soma dos orçamentos diários ativos lida agora na Meta (campanhas com
 * orçamento de campanha + conjuntos com orçamento próprio): o teto é sobre
 * ela, nunca sobre um número velho.
 */
export async function orcamentoAtivoNaMeta(grafo: GrafoMeta, conta: string): Promise<number | null> {
  const filtro = encodeURIComponent('[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]');
  const [c, g] = await Promise.all([
    grafo.ler(`act_${conta}/campaigns?limit=200&filtering=${filtro}`, "id,daily_budget").catch(() => null),
    grafo.ler(`act_${conta}/adsets?limit=500&filtering=${filtro}`, "id,daily_budget").catch(() => null),
  ]);
  const lista = (b: Record<string, unknown> | null) => (b && Array.isArray(b.data) ? (b.data as Record<string, unknown>[]) : null);
  const lc = lista(c);
  const lg = lista(g);
  if (!lc || !lg) return null;
  const soma = [...lc, ...lg].reduce((s, x) => s + (reaisDaMeta(x.daily_budget) ?? 0), 0);
  return Math.round(soma * 100) / 100;
}

export async function rodarRotina(deps: DepsDaRodada, opcoes: { manual?: boolean } = {}): Promise<ResumoDaRodada> {
  const P = PADROES_DA_ROTINA;
  const agora = deps.agoraMs();
  const rodadaId = deps.novoId();
  const linha = await deps.lerRotina();
  if (!linha || !linha.ligada) return { rodou: false, motivo: "A rotina está desligada.", feitas: 0, propostas: 0, barradas: 0, estado: null };
  const config = configDaLinha(linha);
  const anterior = (linha.estado && typeof linha.estado === "object" ? linha.estado : {}) as Partial<EstadoDaRotina>;
  const avisos: Record<string, string> = { ...(anterior.avisos ?? {}) };
  const proxima = new Date(agora + 60 * 60_000).toISOString();
  const estado: EstadoDaRotina = {
    rodada_em: new Date(agora).toISOString(),
    olhando: "",
    fez: [],
    planeja: [],
    parou_por: null,
    bloqueio: null,
    sincronizado_em: null,
    proxima_rodada_em: proxima,
    avisos,
  };
  const terminar = async (motivo: string | null, feitas = 0, propostas = 0, barradas = 0): Promise<ResumoDaRodada> => {
    estado.parou_por = estado.parou_por ?? null;
    await deps.salvarEstado(estado);
    return { rodou: true, motivo, feitas, propostas, barradas, estado };
  };

  const [acesso, dados] = await Promise.all([deps.acesso(), deps.lerRetrato()]);
  const r = dados.retrato;
  estado.sincronizado_em = r.sincronizado_em;
  const ativosAnuncios = r.itens.filter((i) => i.nivel === "anuncio" && String(i.status).toUpperCase() === "ACTIVE");
  const campanhasAtivas = new Set(ativosAnuncios.map((i) => i.campanha_id).filter(Boolean));
  estado.olhando = `${ativosAnuncios.length} ${ativosAnuncios.length === 1 ? "anúncio ativo" : "anúncios ativos"} em ${campanhasAtivas.size} ${campanhasAtivas.size === 1 ? "campanha" : "campanhas"}, últimos ${r.periodo.dias} dias, números de ${hora(r.sincronizado_em)}.`;

  const { limites, fontes } = limitesEfetivos({
    dono: config.limites,
    custoDoPlano: dados.custoDoPlano,
    custoDoBriefing: dados.custoDoBriefing,
    custoMedioDaConta: r.totais.custo_por_resultado,
    resultadosDaConta: r.totais.resultados,
    referencia: dados.referencia,
  });
  const avaliacoes = r.itens.map((i) => avaliarItem(i, limites));
  if (deps.resultadoDepois) await deps.resultadoDepois(r.totais, r.periodo).catch(() => undefined);

  // 2. Gestão: sem ela, um aviso só (por motivo, a cada 24 h), e não age.
  if (!acesso.disponivel || !acesso.grafo) {
    estado.bloqueio = acesso.motivo || "Sem permissão de gestão na Meta.";
    estado.planeja = avaliacoes.filter((a) => a.acao).slice(0, 5).map((a) => `Quando a conta voltar: ${a.acao === "pausar" ? "pausar" : a.acao === "subir_verba" ? "subir a verba de" : "trocar o criativo de"} ${a.item.nome}. ${a.regra}`);
    await avisarUmaVez(deps, avisos, estado.bloqueio, `Rotina de tráfego de ${deps.nomeDoCliente}: não posso agir na conta. ${estado.bloqueio}`);
    return terminar(estado.bloqueio);
  }

  // 4. Fora do normal: para e avisa.
  const anomalia = foraDoNormal(r, avaliacoes, agora, config.teto_diario_brl);
  if (anomalia.parar.length) {
    estado.parou_por = anomalia.parar.join(" ");
    await avisarUmaVez(deps, avisos, anomalia.parar[0], `Rotina de tráfego de ${deps.nomeDoCliente} parou sem mexer: ${anomalia.parar[0]}`);
    await deps.registrar({ rodada_id: rodadaId, origem: "rotina", tipo: "parada", estado: "feita", alvo: null, resumo: "Parei a rodada sem mexer na conta.", porque: estado.parou_por, prova: { sincronizado_em: r.sincronizado_em, periodo: r.periodo, totais: r.totais, serie: r.serie.slice(-7) }, desfazer: null });
    return terminar(estado.parou_por);
  }

  const candidatos = candidatosDaRodada(avaliacoes);
  if (!candidatos.length) {
    estado.planeja = [`Nada para mexer agora. Volto a olhar às ${hora(proxima)}.`];
    return terminar(null);
  }

  // 5. Jev: o caso de julgamento (sem Jev, não age).
  const regrasAtivas = regrasQueValem(config.regras, deps.hoje);
  let respostas: Awaited<ReturnType<DepsDaRodada["jev"]>> | null = null;
  try {
    const q = perguntasDaRodada(candidatos, {
      nicho: dados.nicho ? dados.nicho.nome : null,
      objetivo: dados.objetivo,
      estrategia: dados.estrategia,
      limites,
      regras_do_dono: regrasAtivas.map((x) => x.texto),
      conta: { gasto_7d: r.totais.gasto, resultados_7d: r.totais.resultados, custo_por_resultado: r.totais.custo_por_resultado, anuncios_ativos: ativosAnuncios.length },
    });
    respostas = await deps.jev(q.state, q.questions as Record<string, unknown>);
  } catch {
    respostas = null;
  }
  const { decisoes, fora_do_normal } = decidirComJev(candidatos, respostas ? respostas.answers : null);
  if (!respostas) {
    estado.planeja = ["O Jev não respondeu: sem julgamento, não mexi. Tento de novo na próxima rodada."];
    return terminar("jev_indisponivel");
  }
  if (fora_do_normal !== null && fora_do_normal >= P.limiar_fora_do_normal) {
    estado.parou_por = `O Jev achou os números fora do normal (${Math.round(fora_do_normal * 100)}%). Prefiro que você olhe antes de eu mexer.`;
    await avisarUmaVez(deps, avisos, "jev_fora_do_normal", `Rotina de tráfego de ${deps.nomeDoCliente} parou sem mexer: ${estado.parou_por}`);
    return terminar(estado.parou_por);
  }

  // 6. Travas duras.
  const recentes = await deps.recentes();
  const semSubir = anomalia.sem_subir.length > 0;
  const { fazer, barrados } = aplicarTravas(
    decisoes.filter((d) => !(semSubir && d.candidato.avaliacao.acao === "subir_verba")),
    { agoraMs: agora, hoje: deps.hoje, regras: config.regras, recentes, max_rodada: config.max_acoes_rodada, max_dia: config.max_acoes_dia, anuncios_ativos: ativosAnuncios.length, teto_diario_brl: config.teto_diario_brl },
  );
  if (semSubir) estado.planeja.push(anomalia.sem_subir[0]);

  // 7. Cada ação: relê, confere a prova, escreve, relê depois, registra, avisa, dossiê.
  const grafo = acesso.grafo;
  const contas = await deps.contas();
  const velha = !r.sincronizado_em || agora - Date.parse(r.sincronizado_em) > P.sincronia_para_reler_min * 60_000;
  let feitas = 0;
  for (const d of fazer) {
    const i = d.candidato.avaliacao.item;
    const acao = d.candidato.avaliacao.acao;
    const conferida = await deps.lerRotina();
    if (!conferida || !conferida.ligada) {
      estado.parou_por = "Você pausou a rotina durante a rodada: parei antes da próxima ação.";
      break;
    }
    const alvoId = acao === "subir_verba" ? i.meta_id : i.meta_id;
    const campos = CAMPOS_DO_ESTADO(i.nivel) + (i.nivel === "conjunto" ? ",learning_stage_info" : "");
    const bruto = await grafo.ler(alvoId, campos).catch(() => null);
    const fora = foraDasContas(bruto, contas);
    const antes = estadoLidoComAprendizado(bruto);
    if (fora || !antes) {
      estado.planeja.push(`Não mexi em ${i.nome}: ${fora ?? "não consegui ler na Meta agora."}`);
      continue;
    }
    if (String(antes.status).toUpperCase() !== "ACTIVE") {
      estado.planeja.push(`Não mexi em ${i.nome}: já não está ativo na Meta.`);
      continue;
    }
    // Coleta velha: relê os números na Meta e confere se a regra ainda vale.
    let relidoEm: string | null = null;
    let numeros = numerosDaProva(i, r.periodo);
    if (velha) {
      const faixa = encodeURIComponent(JSON.stringify({ since: r.periodo.inicio, until: r.periodo.fim }));
      const insights = await grafo.ler(`${alvoId}/insights?time_range=${faixa}`, "spend,impressions,inline_link_clicks,frequency,actions").catch(() => null);
      const relido = numerosDaMeta(insights, dados.tiposDeAcao(i.resultado_tipo));
      if (!relido) {
        estado.planeja.push(`Não mexi em ${i.nome}: a coleta está velha e não consegui reler os números na Meta.`);
        continue;
      }
      const reavaliada = reavaliarComMeta(i, relido, limites);
      if (reavaliada.acao !== acao) {
        estado.planeja.push(`Não mexi em ${i.nome}: com os números relidos agora na Meta, a regra não pede mais isso.`);
        continue;
      }
      relidoEm = new Date(deps.agoraMs()).toISOString();
      numeros = { ...numeros, gasto: relido.gasto, impressoes: relido.impressoes, resultados: relido.resultados, custo_por_resultado: relido.resultados > 0 ? Math.round((relido.gasto / relido.resultados) * 100) / 100 : null, ctr_link_pct: relido.ctr_link_pct, frequencia: relido.frequencia };
    }
    const prova: Prova = {
      numeros,
      fonte: relidoEm ? "Meta Ads, relido agora na Meta" : "Meta Ads, coletado pelo painel",
      sincronizado_em: r.sincronizado_em,
      relido_na_meta_em: relidoEm,
      regra: d.candidato.avaliacao.regra,
      limites: { custo_alvo_brl: limites.custo_alvo_brl, fonte_do_alvo: fontes.custo_alvo_brl, gasto_minimo_brl: limites.gasto_minimo_brl },
      antes,
      depois: null,
      jev: { escolha: d.veredito.escolha, probabilidade: d.veredito.probabilidade, confianca: d.veredito.confianca, probabilidades: d.veredito.probabilidades },
    };
    const semProva = provaSuficiente(prova);
    if (semProva) {
      estado.planeja.push(`Não mexi em ${i.nome}: ${semProva}`);
      continue;
    }
    let item: ItemDaAcaoNaConta;
    let resumo: string;
    if (acao === "pausar") {
      item = { id: `r${feitas + 1}`, tipo: "pausar", na_meta: true, alvo: { ref: "-", nivel: i.nivel, meta_id: i.meta_id, nome: i.nome }, criativo: null, texto: null, variacao_pct: null, motivo: prova.regra, de: antes, para: { status: "PAUSED" }, limitado: false, indisponivel: null };
      resumo = `Pausei ${NIVEL[i.nivel]} ${i.nome}.`;
    } else if (acao === "subir_verba") {
      if (antes.aprendizado === "LEARNING") {
        estado.planeja.push(`Não subi a verba de ${i.nome}: a Meta diz que ainda está em fase de aprendizado.`);
        continue;
      }
      const conta = bruto && typeof bruto.account_id === "string" ? bruto.account_id.replace(/^act_/, "") : [...contas][0] ?? null;
      const soma = conta ? await orcamentoAtivoNaMeta(grafo, conta) : null;
      if (soma === null) {
        estado.planeja.push(`Não subi a verba de ${i.nome}: não consegui somar os orçamentos ativos na Meta para respeitar o teto.`);
        continue;
      }
      const verba = novaVerba(antes.orcamento_diario_brl, config.subida_max_pct, config.teto_diario_brl, soma);
      if (!verba) {
        estado.planeja.push(`Não subi a verba de ${i.nome}: ${antes.orcamento_diario_brl ? `sem espaço no teto diário (${reais(config.teto_diario_brl)}, hoje ${reais(soma)} ativos).` : "a verba não fica neste nível."}`);
        continue;
      }
      item = { id: `r${feitas + 1}`, tipo: "orcamento", na_meta: true, alvo: { ref: "-", nivel: i.nivel, meta_id: i.meta_id, nome: i.nome }, criativo: null, texto: null, variacao_pct: verba.variacao_pct, motivo: prova.regra, de: antes, para: { orcamento_diario_brl: verba.para }, limitado: false, indisponivel: null };
      resumo = `Subi a verba ${i.nivel === "campanha" ? "da campanha" : "do conjunto"} ${i.nome} de ${reais(antes.orcamento_diario_brl)} para ${reais(verba.para)} por dia. ${verba.motivo}`;
    } else {
      continue;
    }
    const inicio = deps.agoraMs();
    const resultado = await executarNaMeta(item, grafo, null, contas);
    await deps.auditar(`mesa_ads_rotina_${item.tipo}`, { item: item.tipo, alvo: item.alvo, de: item.de, para: item.para, rodada_id: rodadaId }, resultado.ok, resultado.ok ? null : resultado.motivo ?? null, i.meta_id);
    if (!resultado.ok) {
      estado.planeja.push(`Tentei em ${i.nome} e a Meta não deixou: ${resultado.motivo}`);
      await deps.registrar({ rodada_id: rodadaId, origem: "rotina", tipo: item.tipo === "orcamento" ? "orcamento" : "pausar", estado: "falhou", alvo: { nivel: i.nivel, meta_id: i.meta_id, nome: i.nome }, resumo: `Não consegui: ${resumo}`, porque: resultado.motivo ?? "A Meta recusou.", prova, desfazer: null });
      continue;
    }
    prova.depois = resultado.depois ?? null;
    const porque = `${prova.regra} ${d.motivo}`;
    // Contrato comum dos agentes: o caminho para a campanha na aba Conta (só rota interna).
    const caminho = i.campanha_id ? { rotulo: "Ver a campanha", destino: `/mesa-ads?client=${linha.client_id}&etapa=conta&campanha=${i.campanha_id}` } : null;
    await deps.registrar({ rodada_id: rodadaId, origem: "rotina", tipo: item.tipo === "orcamento" ? "orcamento" : "pausar", estado: "feita", alvo: { nivel: i.nivel, meta_id: i.meta_id, nome: i.nome }, resumo, porque, prova: { ...prova, caminho }, desfazer: { item: { ...item, resultado } } });
    await deps.avisar(`Rotina de tráfego de ${deps.nomeDoCliente}: ${resumo} ${prova.regra} Dá para desfazer em "O que foi feito", na aba Conta da Mesa Ads.`);
    await deps.dossie(`Agente de tráfego: ${resumo}`.slice(0, 200), `${porque} Números de ${prova.numeros.periodo.inicio} a ${prova.numeros.periodo.fim} (${prova.fonte}). Levou ${Math.round((deps.agoraMs() - inicio) / 100) / 10} s.`, { origem: "mesa_ads_rotina", rodada_id: rodadaId, meta_id: i.meta_id, tipo: item.tipo });
    estado.fez.push(resumo);
    feitas++;
  }

  // 8. Propostas de estratégia (criativo novo): cartão com Confirmar, sem repetir em 72 h.
  const abertas = await deps.propostasAbertas();
  let propostas = 0;
  const vencedores = r.itens.filter((x) => x.nivel === "anuncio" && x.resultados > 0).sort((a, b) => (a.custo_por_resultado ?? 1e9) - (b.custo_por_resultado ?? 1e9));
  for (const d of decisoes.filter((x) => x.proposta).slice(0, 2)) {
    const i = d.candidato.avaliacao.item;
    if (abertas.has(i.meta_id)) continue;
    const p = propostaDeCriativo(i, vencedores);
    await deps.registrar({
      rodada_id: rodadaId,
      origem: "rotina",
      tipo: "proposta",
      estado: "proposta",
      alvo: { nivel: i.nivel, meta_id: i.meta_id, nome: i.nome },
      resumo: p.titulo,
      porque: `${d.candidato.avaliacao.regra} ${p.texto}`,
      prova: { numeros: numerosDaProva(i, r.periodo), fonte: "Meta Ads, coletado pelo painel", sincronizado_em: r.sincronizado_em, jev: d.veredito, pedido_ao_agente: p.pedido_ao_agente },
      desfazer: null,
    });
    propostas++;
  }

  for (const b of barrados.slice(0, 4)) estado.planeja.push(`${b.decisao.candidato.avaliacao.item.nome}: ${b.motivo}`);
  for (const d of decisoes.filter((x) => !x.agir && !x.proposta).slice(0, 4)) estado.planeja.push(`${d.candidato.avaliacao.item.nome}: ${d.motivo}`);
  if (!estado.planeja.length) estado.planeja.push(`Volto a olhar às ${hora(proxima)}.`);
  return terminar(null, feitas, propostas, barrados.length);
}

/**
 * Retrato da conta a partir da leitura da conta ao vivo (o mesmo formato que
 * lerContaAoVivo devolve, só os campos usados). Anúncios, conjuntos e
 * campanhas com os números da janela; a série diária da conta; a soma dos
 * orçamentos diários das campanhas ativas que o painel conhece.
 */
export function retratoDaContaAoVivo(conta: {
  atualizado_em: string | null;
  periodo: { inicio: string; fim: string; dias: number };
  totais: { gasto: number; resultados: number; custo_por_resultado: number | null; resultado_tipo?: string | null; resultado_rotulo?: string };
  serie: { dia: string; gasto: number; resultados: number }[];
  campanhas: { campaign_id: string; nome: string | null; status: string | null; orcamento_diario: number | null; metricas: MetricasDoRetrato }[];
  conjuntos: { adset_id: string; nome: string | null; campaign_id: string | null; campanha: string | null; metricas: MetricasDoRetrato }[];
  anuncios: { ad_id: string; nome: string | null; status: string | null; campaign_id: string | null; campanha: string | null; conjunto: string | null; conjunto_id?: string | null; metricas: MetricasDoRetrato; tendencia: { ctr_var_pct: number | null; custo_resultado_var_pct: number | null; frequencia: number | null } }[];
}): RetratoDaConta {
  const ativoDoConjunto = new Set(conta.anuncios.filter((a) => String(a.status).toUpperCase() === "ACTIVE").map((a) => a.conjunto_id).filter(Boolean) as string[]);
  const item = (nivel: ItemDaConta["nivel"], x: { id: string; nome: string | null; status: string | null; campanha_id: string | null; campanha: string | null; conjunto_id: string | null; conjunto: string | null; orcamento: number | null; m: MetricasDoRetrato; ctrVar?: number | null; custoVar?: number | null; freq?: number | null }): ItemDaConta => ({
    nivel,
    meta_id: x.id,
    nome: x.nome || `${nivel === "campanha" ? "Campanha" : nivel === "conjunto" ? "Conjunto" : "Anúncio"} ${x.id}`,
    status: x.status,
    campanha_id: x.campanha_id,
    campanha: x.campanha,
    conjunto_id: x.conjunto_id,
    conjunto: x.conjunto,
    resultado_tipo: x.m.resultado_tipo ?? null,
    resultado_rotulo: x.m.resultado_rotulo || "Resultados",
    orcamento_diario_brl: x.orcamento,
    gasto: x.m.gasto,
    impressoes: x.m.impressoes,
    resultados: x.m.resultados,
    custo_por_resultado: x.m.custo_por_resultado,
    ctr_link_pct: x.m.ctr_saida_pct,
    cpm: x.m.cpm,
    frequencia: x.freq ?? x.m.frequencia_media,
    dias_com_gasto: x.m.dias,
    primeiro_dia: x.m.inicio,
    ctr_var_pct: x.ctrVar ?? null,
    custo_var_pct: x.custoVar ?? null,
  });
  const itens: ItemDaConta[] = [
    ...conta.campanhas.map((c) => item("campanha", { id: c.campaign_id, nome: c.nome, status: c.status, campanha_id: c.campaign_id, campanha: c.nome, conjunto_id: null, conjunto: null, orcamento: c.orcamento_diario, m: c.metricas })),
    ...conta.conjuntos.map((g) => item("conjunto", { id: g.adset_id, nome: g.nome, status: ativoDoConjunto.has(g.adset_id) ? "ACTIVE" : "PAUSED", campanha_id: g.campaign_id, campanha: g.campanha, conjunto_id: g.adset_id, conjunto: g.nome, orcamento: null, m: g.metricas })),
    ...conta.anuncios.map((a) => item("anuncio", { id: a.ad_id, nome: a.nome, status: a.status, campanha_id: a.campaign_id, campanha: a.campanha, conjunto_id: a.conjunto_id ?? null, conjunto: a.conjunto, orcamento: null, m: a.metricas, ctrVar: a.tendencia.ctr_var_pct, custoVar: a.tendencia.custo_resultado_var_pct, freq: a.tendencia.frequencia })),
  ];
  const orcamentos = conta.campanhas.filter((c) => String(c.status).toUpperCase() === "ACTIVE" && typeof c.orcamento_diario === "number" && c.orcamento_diario > 0).map((c) => c.orcamento_diario as number);
  return {
    periodo: conta.periodo,
    sincronizado_em: conta.atualizado_em,
    objetivo_tipo: conta.totais.resultado_tipo ?? null,
    resultado_rotulo: conta.totais.resultado_rotulo || "Resultados",
    itens,
    serie: conta.serie.map((p) => ({ dia: p.dia, gasto: p.gasto, resultados: p.resultados })),
    totais: { gasto: conta.totais.gasto, resultados: conta.totais.resultados, custo_por_resultado: conta.totais.custo_por_resultado },
    orcamento_ativo_brl: orcamentos.length ? Math.round(orcamentos.reduce((s, v) => s + v, 0) * 100) / 100 : null,
  };
}

export type MetricasDoRetrato = {
  gasto: number;
  impressoes: number;
  resultados: number;
  custo_por_resultado: number | null;
  ctr_saida_pct: number | null;
  cpm: number | null;
  frequencia_media: number | null;
  dias: number;
  inicio: string | null;
  resultado_tipo?: string | null;
  resultado_rotulo?: string;
};
