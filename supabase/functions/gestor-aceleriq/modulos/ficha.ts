/**
 * Gestor Aceleriq (Central de Autonomia, 08/10/2026): as regras em código.
 *
 * Tudo aqui é puro (sem banco, sem rede) para a tela e os testes usarem a
 * mesma régua da função:
 * - o PERÍODO sai da pergunta ("nesta semana", "ontem", "últimos 10 dias"),
 *   no fuso de São Paulo, com o período anterior do mesmo tamanho ao lado;
 * - o CLIENTE sai por nome exato (sem acento, palavra inteira); dúvida entre
 *   dois vira pergunta de volta, nunca palpite;
 * - a FICHA reúne os fatos do recorte com apelidos curtos (F1, F2...). O
 *   modelo cita apelidos, nunca UUID: copiar UUID é onde o agente erra;
 * - ESTADO de cada fonte é decidido aqui, não pelo modelo. Tarefa e execução
 *   são coisas separadas: execução concluída com a tarefa em revisão é
 *   "entrega em revisão", e revisão NUNCA conta como feito;
 * - a resposta sem IA (motor) sai só da ficha, e é a reserva de sempre.
 */

export type Periodo = {
  desde: string; // ISO (inclusivo)
  ate: string; // ISO (exclusivo)
  rotulo: string;
  anterior: { desde: string; ate: string; rotulo: string };
};

const DIA = 86_400_000;
const FUSO_SP = -3; // São Paulo sem horário de verão desde 2019

/** Meia-noite de São Paulo do dia de `agora`, em UTC. */
function inicioDoDiaSP(agora: Date): Date {
  const local = new Date(agora.getTime() + FUSO_SP * 3_600_000);
  const meia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(meia - FUSO_SP * 3_600_000);
}

export function semAcento(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const fmtDia = (d: Date) => {
  const l = new Date(d.getTime() + FUSO_SP * 3_600_000);
  return `${String(l.getUTCDate()).padStart(2, "0")}/${String(l.getUTCMonth() + 1).padStart(2, "0")}`;
};

function montar(desde: Date, ate: Date, rotulo: string, anteriorDesde?: Date, anteriorAte?: Date): Periodo {
  const tam = ate.getTime() - desde.getTime();
  const aDesde = anteriorDesde ?? new Date(desde.getTime() - tam);
  const aAte = anteriorAte ?? desde;
  return {
    desde: desde.toISOString(),
    ate: ate.toISOString(),
    rotulo,
    anterior: { desde: aDesde.toISOString(), ate: aAte.toISOString(), rotulo: `${fmtDia(aDesde)} a ${fmtDia(new Date(aAte.getTime() - 1))}` },
  };
}

/**
 * O período que a pergunta pede. Sem período na frase: últimos 7 dias.
 * `chave` vale também como escolha direta da tela ("semana", "7d", "30d", "mes", "hoje").
 */
export function periodoDaPergunta(pergunta: string, agora: Date = new Date(), chave?: string | null): Periodo {
  const t = semAcento(pergunta);
  const hoje = inicioDoDiaSP(agora);
  const amanha = new Date(hoje.getTime() + DIA);
  const local = new Date(agora.getTime() + FUSO_SP * 3_600_000);
  const diaDaSemana = (local.getUTCDay() + 6) % 7; // segunda = 0
  const segunda = new Date(hoje.getTime() - diaDaSemana * DIA);
  const inicioMes = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - FUSO_SP * 3_600_000);

  const k = chave || (
    /\bhoje\b/.test(t) ? "hoje"
    : /\bontem\b/.test(t) ? "ontem"
    : /semana passada|ultima semana/.test(t) ? "semana_passada"
    : /(nesta|nessa|esta|essa|desta|dessa|da) semana|\bsemana\b/.test(t) ? "semana"
    : /mes passado|ultimo mes/.test(t) ? "mes_passado"
    : /(neste|nesse|este|esse|deste|desse|do) mes|\bmes\b/.test(t) ? "mes"
    : null
  );
  const n = t.match(/ultim[oa]s?\s+(\d{1,3})\s+dias?/);
  if (!k && n) {
    const dias = Math.min(Math.max(Number(n[1]) || 7, 1), 120);
    return montar(new Date(amanha.getTime() - dias * DIA), amanha, `últimos ${dias} dias`);
  }
  switch (k) {
    case "hoje": return montar(hoje, amanha, `hoje (${fmtDia(hoje)})`);
    case "ontem": return montar(new Date(hoje.getTime() - DIA), hoje, `ontem (${fmtDia(new Date(hoje.getTime() - DIA))})`);
    case "semana": return montar(segunda, amanha, `esta semana (${fmtDia(segunda)} a ${fmtDia(hoje)})`, new Date(segunda.getTime() - 7 * DIA), new Date(segunda.getTime() - 7 * DIA + (amanha.getTime() - segunda.getTime())));
    case "semana_passada": {
      const ini = new Date(segunda.getTime() - 7 * DIA);
      return montar(ini, segunda, `semana passada (${fmtDia(ini)} a ${fmtDia(new Date(segunda.getTime() - DIA))})`);
    }
    case "mes": return montar(inicioMes, amanha, `este mês (desde ${fmtDia(inicioMes)})`);
    case "mes_passado": {
      const ini = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - FUSO_SP * 3_600_000);
      return montar(ini, inicioMes, `mês passado (${fmtDia(ini)} a ${fmtDia(new Date(inicioMes.getTime() - DIA))})`);
    }
    case "30d": return montar(new Date(amanha.getTime() - 30 * DIA), amanha, "últimos 30 dias");
    default: return montar(new Date(amanha.getTime() - 7 * DIA), amanha, "últimos 7 dias");
  }
}

/** Um cliente, ou uma marca secundária dele (CME da Acerbi): aí `projetoId` restringe o recorte ao projeto da marca. */
export type ClienteBase = { id: string; nome: string; apelidos?: string[]; projetoId?: string | null; marca?: string | null };

export type ClienteEscolhido =
  | { tipo: "um"; cliente: ClienteBase }
  | { tipo: "nenhum" }
  | { tipo: "ambiguo"; opcoes: ClienteBase[] };

const PALAVRAS_GENERICAS = new Set(["cliente", "clientes", "empresa", "agencia", "aceleriq", "loja", "o", "a", "de", "da", "do"]);

/** Cliente citado pelo nome (palavra inteira, sem acento). Dois nomes diferentes: pergunta de volta. */
export function clienteDaPergunta(pergunta: string, clientes: ClienteBase[]): ClienteEscolhido {
  const t = ` ${semAcento(pergunta).replace(/[^a-z0-9]+/g, " ")} `;
  const achados: Array<{ c: ClienteBase; tam: number }> = [];
  for (const c of clientes) {
    const nomes = [c.nome, ...(c.apelidos || [])].map((x) => semAcento(x).replace(/[^a-z0-9]+/g, " ").trim()).filter((x) => x.length >= 3 && !PALAVRAS_GENERICAS.has(x));
    let melhor = 0;
    for (const nome of nomes) {
      if (t.includes(` ${nome} `)) melhor = Math.max(melhor, nome.length);
      else {
        // "Para Si Ótica" citado só como "Para Si": vale o primeiro trecho com 2+ palavras ou 5+ letras.
        const partes = nome.split(" ");
        for (let k = partes.length - 1; k >= 1; k--) {
          const pedaco = partes.slice(0, k).join(" ");
          if ((k >= 2 || pedaco.length >= 5) && !PALAVRAS_GENERICAS.has(pedaco) && t.includes(` ${pedaco} `)) { melhor = Math.max(melhor, pedaco.length); break; }
        }
      }
    }
    if (melhor) achados.push({ c, tam: melhor });
  }
  if (!achados.length) return { tipo: "nenhum" };
  achados.sort((a, b) => b.tam - a.tam);
  const topo = achados.filter((a) => a.tam === achados[0].tam);
  if (topo.length === 1) return { tipo: "um", cliente: topo[0].c };
  // O mesmo cliente achado duas vezes (pelo nome e por uma marca): vale a marca, que é mais específica.
  if (new Set(topo.map((a) => a.c.id)).size === 1) return { tipo: "um", cliente: topo.find((a) => a.c.projetoId)?.c || topo[0].c };
  return { tipo: "ambiguo", opcoes: topo.map((a) => a.c) };
}

// ------------------------------------------------------------------ fontes e estados

export type EstadoDaFonte =
  | "feito_com_prova" // tarefa concluída E prova registrada; ou publicação com link; ou entrega registrada
  | "concluido_sem_prova" // marcada como concluída no Kanban, mas sem prova anexada no OS
  | "execucao_feita_entrega_em_revisao" // a execução terminou, a tarefa espera revisão humana
  | "em_revisao"
  | "em_andamento"
  | "bloqueado"
  | "aguardando_insumo"
  | "na_fila"
  | "pendente" // tarefa aberta sem execução
  | "decisao_pendente"
  | "agendado"
  | "falhou"
  | "divergente"; // execução e tarefa contam histórias diferentes

export type TipoDaFonte = "tarefa" | "execucao" | "diario" | "publicacao" | "entrega" | "aprovacao";

export type Fonte = {
  apelido: string; // F1, F2...
  tipo: TipoDaFonte;
  estado: EstadoDaFonte;
  titulo: string;
  quando: string | null;
  /** O texto que prova (ação, evidência, corpo do diário). Vai inteiro à conferência. */
  texto: string;
  cliente: string | null;
  agente: string | null;
  ids: { tarefa?: string; vinculo?: string; execucao?: string; diario?: string; publicacao?: string; entrega?: string; aprovacao?: string };
  link?: string | null;
};

export const ROTULO_DO_ESTADO: Record<EstadoDaFonte, string> = {
  feito_com_prova: "Feito com prova",
  concluido_sem_prova: "Concluída no Kanban, sem prova anexada",
  execucao_feita_entrega_em_revisao: "Execução terminou, entrega em revisão",
  em_revisao: "Em revisão (não concluído)",
  em_andamento: "Em andamento",
  bloqueado: "Bloqueado",
  aguardando_insumo: "Aguardando insumo",
  na_fila: "Na fila do agente",
  pendente: "Pendente",
  decisao_pendente: "Precisa da sua decisão",
  agendado: "Agendado (ainda não publicado)",
  falhou: "Falhou",
  divergente: "Execução e tarefa divergem",
};

export type TarefaBruta = { id: string; title: string; status: string; updated_at: string; due_date?: string | null; cliente?: string | null; description?: string | null };
export type VinculoBruto = { id: string; status: string; operator_id: string; kanban_task_id: string | null; painel_task_id: string | null; last_action: string | null; last_evidence: string | null; next_step: string | null; block_reason: string | null; updated_at: string };
export type RunBruto = { id: string; operator_id: string; run_key: string; task_link_id: string | null; status: string; started_at: string | null; finished_at: string | null; heartbeat_at: string | null; error: string | null; detail?: Record<string, unknown> | null };
export type DiarioBruto = { id: string; task_link_id: string; entry_type: string; title: string | null; body: string; author_kind: string; operator_id: string | null; created_at: string };
export type PublicacaoBruta = { id: string; post_id: string | null; status: string; published_at: string | null; scheduled_at: string | null; permalink: string | null; platform: string | null; titulo?: string | null; cliente?: string | null };
export type EntregaBruta = { id: string; o_que: string; como: string | null; onde_acessar: string | null; onde_documentado: string | null; occurred_at: string; kanban_task_id: string | null; operator_id: string; cliente?: string | null };
export type AprovacaoBruta = { id: string; o_que: string; por_que: string | null; status: string; created_at: string; task_link_id: string | null; kanban_task_id: string | null; operator_id: string; cliente?: string | null };

const temTexto = (s: string | null | undefined) => !!s && s.trim().length > 0;

/**
 * Estado da TAREFA lida junto da execução dela. A régua do dono:
 * - "done" com prova da execução = feito; "done" sem prova anexada = concluída sem prova (não é "feito
 *   com prova": a limpeza de 09/09, por exemplo, encerrou cards sem entrega);
 * - execução concluída + tarefa em revisão = execução feita, entrega em revisão;
 * - execução bloqueada com a tarefa em andamento = divergente (o card não andou junto).
 */
export function estadoDaTarefa(t: Pick<TarefaBruta, "status">, v: Pick<VinculoBruto, "status" | "last_evidence"> | null): EstadoDaFonte {
  const s = t.status;
  if (s === "done") return v && temTexto(v.last_evidence) ? "feito_com_prova" : "concluido_sem_prova";
  if (!v) return s === "review" ? "em_revisao" : s === "doing" ? "em_andamento" : "pendente";
  if (v.status === "done") return s === "review" ? "execucao_feita_entrega_em_revisao" : "divergente";
  if (v.status === "blocked") return s === "doing" ? "divergente" : "bloqueado";
  if (v.status === "awaiting_input") return "aguardando_insumo";
  if (v.status === "review" || s === "review") return "em_revisao";
  if (v.status === "in_progress") return "em_andamento";
  if (v.status === "queued") return "na_fila";
  return s === "doing" ? "em_andamento" : "pendente";
}

export function estadoDaExecucao(r: Pick<RunBruto, "status">): EstadoDaFonte {
  switch (r.status) {
    case "done": return "feito_com_prova";
    case "review": return "em_revisao";
    case "blocked": return "bloqueado";
    case "awaiting_input": return "aguardando_insumo";
    case "failed": case "timeout": return "falhou";
    default: return "em_andamento";
  }
}

const dentro = (iso: string | null | undefined, p: { desde: string; ate: string }) => !!iso && iso >= p.desde && iso < p.ate;
/** Data e hora de São Paulo ("08/10 16:00"), para o modelo e a tela não falarem em UTC. */
export function horaSP(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const l = new Date(d.getTime() + FUSO_SP * 3_600_000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(l.getUTCDate())}/${p2(l.getUTCMonth() + 1)} ${p2(l.getUTCHours())}:${p2(l.getUTCMinutes())} (horário de Brasília)`;
}
const corta = (s: string | null | undefined, n: number) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export type EntradaDaFicha = {
  periodo: Periodo;
  tarefas: TarefaBruta[];
  vinculos: VinculoBruto[];
  runs: RunBruto[];
  diario: DiarioBruto[];
  publicacoes: PublicacaoBruta[];
  entregas: EntregaBruta[];
  aprovacoes: AprovacaoBruta[];
  nomeDoAgente: (id: string | null | undefined) => string | null;
};

export type Ficha = { fontes: Fonte[]; cortadas: number };

/**
 * A ficha do recorte. Entram: tarefas que mudaram no período ou seguem abertas
 * com execução; execuções do período; diário com prova do período; publicações
 * e entregas do período; aprovações pendentes. Teto de fontes para caber no
 * modelo (o que sobra é contado, nunca escondido em silêncio).
 */
export function montarFicha(e: EntradaDaFicha, teto = 80): Ficha {
  const p = e.periodo;
  const vinculoDaTarefa = new Map<string, VinculoBruto>();
  for (const v of [...e.vinculos].sort((a, b) => a.updated_at.localeCompare(b.updated_at))) {
    const id = v.kanban_task_id || v.painel_task_id;
    if (id) vinculoDaTarefa.set(id, v);
  }
  const tarefaPorId = new Map(e.tarefas.map((t) => [t.id, t]));
  const vinculoPorId = new Map(e.vinculos.map((v) => [v.id, v]));
  const brutas: Array<Omit<Fonte, "apelido"> & { peso: number }> = [];

  for (const t of e.tarefas) {
    const v = vinculoDaTarefa.get(t.id) || null;
    const mexeu = dentro(t.updated_at, p) || (v && dentro(v.updated_at, p));
    // Fora do período só entra o que segue aberto e em curso (com execução, ou em andamento/revisão no Kanban).
    const emCurso = t.status === "doing" || t.status === "review" || (t.status !== "done" && !!v);
    if (!mexeu && !emCurso) continue;
    const estado = estadoDaTarefa(t, v);
    const partes = [
      `Tarefa "${corta(t.title, 160)}" com status ${t.status} no Kanban.`,
      v ? `Execução do agente: ${v.status}.` : "Sem execução de agente vinculada.",
      v?.last_action ? `Última ação: ${corta(v.last_action, 300)}` : "",
      v?.last_evidence ? `Prova: ${corta(v.last_evidence, 300)}` : "",
      v?.block_reason ? `Bloqueio: ${corta(v.block_reason, 200)}` : "",
      v?.next_step ? `Próximo passo: ${corta(v.next_step, 200)}` : "",
      t.description && /video|edicao|edição/i.test(t.title + t.description) ? `Descrição: ${corta(t.description, 240)}` : "",
    ].filter(Boolean);
    brutas.push({
      tipo: "tarefa", estado, titulo: corta(t.title, 160), quando: v && v.updated_at > t.updated_at ? v.updated_at : t.updated_at,
      texto: partes.join(" "), cliente: t.cliente ?? null, agente: v ? e.nomeDoAgente(v.operator_id) : null,
      ids: { tarefa: t.id, vinculo: v?.id }, peso: mexeu ? 3 : v ? 2 : 1,
    });
  }

  for (const r of e.runs) {
    if (!dentro(r.started_at, p) && !dentro(r.finished_at, p) && !dentro(r.heartbeat_at, p)) continue;
    const v = r.task_link_id ? vinculoPorId.get(r.task_link_id) : undefined;
    const t = v ? tarefaPorId.get(v.kanban_task_id || v.painel_task_id || "") : undefined;
    const titulo = corta((r.detail?.title as string) || (r.detail?.action as string) || t?.title || r.run_key, 160);
    brutas.push({
      tipo: "execucao", estado: estadoDaExecucao(r), titulo, quando: r.finished_at || r.heartbeat_at || r.started_at,
      texto: [`Execução ${r.run_key} do agente ${e.nomeDoAgente(r.operator_id) || "?"}: status ${r.status}.`, r.started_at ? `Início ${horaSP(r.started_at)}.` : "", r.finished_at ? `Fim ${horaSP(r.finished_at)}.` : "", r.error ? `Erro: ${corta(r.error, 200)}` : "", t ? `Tarefa: ${corta(t.title, 140)} (Kanban: ${t.status}).` : ""].filter(Boolean).join(" "),
      cliente: t?.cliente ?? null, agente: e.nomeDoAgente(r.operator_id), ids: { execucao: r.id, vinculo: v?.id, tarefa: t?.id }, peso: 1,
    });
  }

  for (const d of e.diario) {
    if (!dentro(d.created_at, p)) continue;
    if (!["evidencia", "pedido_revisao", "pedido_insumo", "decisao"].includes(d.entry_type)) continue;
    const v = vinculoPorId.get(d.task_link_id);
    const t = v ? tarefaPorId.get(v.kanban_task_id || v.painel_task_id || "") : undefined;
    brutas.push({
      tipo: "diario", estado: t ? estadoDaTarefa(t, v || null) : "em_andamento", titulo: corta(d.title || d.entry_type, 160), quando: d.created_at,
      texto: `Diário (${d.entry_type}, ${d.author_kind}): ${corta(d.body, 1200)}`,
      cliente: t?.cliente ?? null, agente: e.nomeDoAgente(d.operator_id), ids: { diario: d.id, vinculo: d.task_link_id, tarefa: t?.id }, peso: 2,
    });
  }

  for (const pub of e.publicacoes) {
    const publicada = pub.status === "published" && temTexto(pub.permalink);
    if (publicada ? !dentro(pub.published_at, p) : !dentro(pub.scheduled_at, p)) continue;
    brutas.push({
      tipo: "publicacao", estado: publicada ? "feito_com_prova" : pub.status === "failed" ? "falhou" : "agendado",
      titulo: corta(pub.titulo || "Publicação", 160), quando: pub.published_at || pub.scheduled_at,
      texto: publicada ? `Publicado em ${pub.platform || "rede"} em ${horaSP(pub.published_at)}. Link: ${pub.permalink}` : `Publicação com status ${pub.status}${pub.scheduled_at ? `, agendada para ${horaSP(pub.scheduled_at)}` : ""}. Sem link de publicação.`,
      cliente: pub.cliente ?? null, agente: null, ids: { publicacao: pub.id }, link: pub.permalink, peso: 2,
    });
  }

  for (const en of e.entregas) {
    if (!dentro(en.occurred_at, p)) continue;
    brutas.push({
      tipo: "entrega", estado: "feito_com_prova", titulo: corta(en.o_que, 160), quando: en.occurred_at,
      texto: [`Entrega registrada: ${corta(en.o_que, 300)}`, en.como ? `Como: ${corta(en.como, 200)}` : "", en.onde_acessar ? `Onde acessar: ${corta(en.onde_acessar, 200)}` : "", en.onde_documentado ? `Documentado em: ${corta(en.onde_documentado, 200)}` : ""].filter(Boolean).join(" "),
      cliente: en.cliente ?? null, agente: e.nomeDoAgente(en.operator_id), ids: { entrega: en.id, tarefa: en.kanban_task_id || undefined }, peso: 3,
    });
  }

  for (const a of e.aprovacoes) {
    if (!["pendente", "adiado"].includes(a.status)) continue;
    brutas.push({
      tipo: "aprovacao", estado: "decisao_pendente", titulo: corta(a.o_que, 160), quando: a.created_at,
      texto: `Pedido de aprovação (${a.status}): ${corta(a.o_que, 300)}${a.por_que ? `. Por quê: ${corta(a.por_que, 200)}` : ""}`,
      cliente: a.cliente ?? null, agente: e.nomeDoAgente(a.operator_id), ids: { aprovacao: a.id, vinculo: a.task_link_id || undefined, tarefa: a.kanban_task_id || undefined }, peso: 3,
    });
  }

  // Tarefa concluída sem prova no vínculo + publicação com link do mesmo título: o link é a prova.
  // Vira uma fonte só (feita com prova), em vez de aparecer duas vezes com estados diferentes.
  const titulo = (s: string) => semAcento(s).replace(/\s+/g, " ").trim();
  const publicadas = new Map<string, number>();
  brutas.forEach((b, i) => { if (b.tipo === "publicacao" && b.estado === "feito_com_prova") publicadas.set(titulo(b.titulo), i); });
  const absorvidas = new Set<number>();
  for (const b of brutas) {
    if (b.tipo !== "tarefa" || b.estado !== "concluido_sem_prova") continue;
    const i = publicadas.get(titulo(b.titulo));
    if (i === undefined || absorvidas.has(i)) continue;
    const pub = brutas[i];
    b.estado = "feito_com_prova";
    b.texto = `${b.texto} Publicação: ${pub.texto}`;
    b.link = pub.link;
    b.ids = { ...b.ids, publicacao: pub.ids.publicacao };
    absorvidas.add(i);
  }
  if (absorvidas.size) for (const i of [...absorvidas].sort((a, b) => b - a)) brutas.splice(i, 1);

  brutas.sort((a, b) => b.peso - a.peso || String(b.quando || "").localeCompare(String(a.quando || "")));
  const ficam = brutas.slice(0, teto);
  return {
    fontes: ficam.map(({ peso: _peso, ...f }, i) => ({ ...f, apelido: `F${i + 1}` })),
    cortadas: Math.max(0, brutas.length - ficam.length),
  };
}

// ------------------------------------------------------------------ resposta

export type SecaoDaResposta = "feito" | "concluido_sem_prova" | "em_revisao" | "em_andamento" | "bloqueado" | "decisao" | "proximo" | "lacuna";

export const ORDEM_DAS_SECOES: SecaoDaResposta[] = ["feito", "concluido_sem_prova", "em_revisao", "em_andamento", "bloqueado", "decisao", "lacuna", "proximo"];

export const ROTULO_DA_SECAO: Record<SecaoDaResposta, string> = {
  feito: "Feito com prova",
  concluido_sem_prova: "Marcado como concluído, sem prova anexada",
  em_revisao: "Em revisão (ainda não concluído)",
  em_andamento: "Em andamento",
  bloqueado: "Bloqueado ou com divergência",
  decisao: "Precisa da sua decisão",
  lacuna: "Pendências e lacunas",
  proximo: "Próximas ações",
};

export type ItemDaResposta = { secao: SecaoDaResposta; texto: string; fontes: string[]; conferido?: "fonte" | "jev" | "motor" };

/** Em que seção cada estado pode aparecer. É isto que impede "revisão" de virar "feito". */
const SECOES_DO_ESTADO: Record<EstadoDaFonte, SecaoDaResposta[]> = {
  feito_com_prova: ["feito", "proximo", "lacuna"],
  concluido_sem_prova: ["concluido_sem_prova", "lacuna"],
  execucao_feita_entrega_em_revisao: ["em_revisao", "proximo"],
  em_revisao: ["em_revisao", "proximo", "lacuna"],
  em_andamento: ["em_andamento", "lacuna", "proximo"],
  bloqueado: ["bloqueado", "lacuna", "proximo"],
  aguardando_insumo: ["bloqueado", "lacuna", "proximo"],
  na_fila: ["em_andamento", "lacuna", "proximo"],
  pendente: ["lacuna", "proximo", "em_andamento"],
  decisao_pendente: ["decisao", "proximo"],
  agendado: ["lacuna", "proximo", "em_andamento"],
  falhou: ["bloqueado", "lacuna", "proximo"],
  divergente: ["bloqueado", "lacuna", "proximo"],
};

export function secaoDoEstado(estado: EstadoDaFonte): SecaoDaResposta {
  return SECOES_DO_ESTADO[estado][0];
}

export type ItemRecusado = { item: ItemDaResposta; motivo: "sem_fonte" | "fonte_inexistente" | "estado_incompativel" | "secao_invalida" };

/**
 * Primeira barreira (código, sem modelo): todo item cita ao menos uma fonte da
 * ficha, e a seção tem de caber no estado de TODAS as fontes citadas. Um item
 * "feito" citando uma tarefa em revisão é recusado, não "corrigido".
 */
export function conferirContraAFicha(itens: ItemDaResposta[], fontes: Fonte[]): { aceitos: ItemDaResposta[]; recusados: ItemRecusado[] } {
  const porApelido = new Map(fontes.map((f) => [f.apelido.toUpperCase(), f]));
  const aceitos: ItemDaResposta[] = [];
  const recusados: ItemRecusado[] = [];
  for (const bruto of itens) {
    const item = { ...bruto, fontes: [...new Set((bruto.fontes || []).map((x) => String(x).trim().toUpperCase()))] };
    if (!ORDEM_DAS_SECOES.includes(item.secao)) { recusados.push({ item, motivo: "secao_invalida" }); continue; }
    if (!item.fontes.length) { recusados.push({ item, motivo: "sem_fonte" }); continue; }
    const citadas = item.fontes.map((a) => porApelido.get(a));
    if (citadas.some((f) => !f)) { recusados.push({ item, motivo: "fonte_inexistente" }); continue; }
    if (citadas.some((f) => !SECOES_DO_ESTADO[f!.estado].includes(item.secao))) { recusados.push({ item, motivo: "estado_incompativel" }); continue; }
    aceitos.push({ ...item, conferido: "fonte" });
  }
  return { aceitos, recusados };
}

/** A resposta sem IA: cada fonte vira uma linha na seção do seu estado. */
export function respostaDoMotor(fontes: Fonte[], limitePorSecao = 8): ItemDaResposta[] {
  const itens: ItemDaResposta[] = [];
  for (const secao of ORDEM_DAS_SECOES) {
    if (secao === "proximo") continue;
    const daSecao = fontes.filter((f) => secaoDoEstado(f.estado) === secao && f.tipo !== "diario" && f.tipo !== "execucao");
    for (const f of daSecao.slice(0, limitePorSecao)) {
      const extra = f.estado === "execucao_feita_entrega_em_revisao" ? " (execução concluída; a tarefa espera revisão)" : f.estado === "divergente" ? " (execução e tarefa em estados diferentes)" : "";
      itens.push({ secao, texto: `${f.titulo}${extra}`, fontes: [f.apelido], conferido: "motor" });
    }
    if (daSecao.length > limitePorSecao) itens.push({ secao, texto: `e mais ${daSecao.length - limitePorSecao} no período`, fontes: daSecao.slice(limitePorSecao).map((f) => f.apelido), conferido: "motor" });
  }
  for (const f of fontes.filter((x) => x.tipo === "tarefa" && /Próximo passo: /.test(x.texto)).slice(0, 4)) {
    const passo = f.texto.split("Próximo passo: ")[1]?.split(/ (?:Descrição|Bloqueio): /)[0] || "";
    if (passo) itens.push({ secao: "proximo", texto: `${f.titulo}: ${corta(passo, 200)}`, fontes: [f.apelido], conferido: "motor" });
  }
  return itens;
}

export type ContagemDoRecorte = Record<SecaoDaResposta, number>;

export function contagemDoRecorte(fontes: Fonte[]): ContagemDoRecorte {
  const c = { feito: 0, concluido_sem_prova: 0, em_revisao: 0, em_andamento: 0, bloqueado: 0, decisao: 0, proximo: 0, lacuna: 0 } as ContagemDoRecorte;
  for (const f of fontes) if (f.tipo !== "diario" && f.tipo !== "execucao") c[secaoDoEstado(f.estado)]++;
  return c;
}

/** O texto corrido da resposta (o que fica gravado na conversa e vai ao Hermes). */
export function respostaEmTexto(cabecalho: string, itens: ItemDaResposta[]): string {
  const linhas = [cabecalho];
  for (const secao of ORDEM_DAS_SECOES) {
    const daSecao = itens.filter((i) => i.secao === secao);
    if (!daSecao.length) continue;
    linhas.push("", `${ROTULO_DA_SECAO[secao]}:`);
    for (const i of daSecao) linhas.push(`- ${i.texto} [${i.fontes.join(", ")}]`);
  }
  return linhas.join("\n");
}

/**
 * A abertura, o fechamento e as próximas perguntas da conversa: montados em
 * código a partir das contagens (sem fato novo, nada a conferir).
 */
export function conversaDoRecorte(e: { nome: string; periodo: string; contagem: ContagemDoRecorte; totalDeFontes: number; temCliente: boolean }): { abertura: string; fechamento: string | null; sugestoes: string[] } {
  const c = e.contagem;
  const alvo = e.temCliente ? e.nome : "toda a operação";
  const abertura = e.totalDeFontes
    ? `Dei uma olhada em ${alvo} (${e.periodo}). Achei ${e.totalDeFontes} ${e.totalDeFontes === 1 ? "registro" : "registros"} no OS; vou te contar o que importa.`
    : `Dei uma olhada em ${alvo} (${e.periodo}) e não achei nada registrado no OS.`;
  let fechamento: string | null = null;
  if (c.decisao) fechamento = c.decisao === 1 ? "Tem 1 decisão esperando você. Quer ver agora?" : `Tem ${c.decisao} decisões esperando você. Quer ver agora?`;
  else if (c.bloqueado) fechamento = "Quer que eu mande os bloqueios para o Hermes resolver?";
  else if (c.em_revisao) fechamento = "Quer que eu separe o que está em revisão para você aprovar?";
  const sugestoes: string[] = [];
  if (c.bloqueado) sugestoes.push("O que está bloqueado e por quê?");
  if (c.decisao) sugestoes.push("O que espera a minha decisão?");
  if (c.em_revisao) sugestoes.push("O que está em revisão?");
  if (c.concluido_sem_prova) sugestoes.push("O que foi concluído sem prova?");
  sugestoes.push(e.temCliente ? `E ${e.nome} nos últimos 30 dias?` : "Qual cliente precisa de atenção agora?");
  return { abertura, fechamento, sugestoes: sugestoes.slice(0, 4) };
}

