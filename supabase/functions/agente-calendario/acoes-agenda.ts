/**
 * Ações do agente do mês sobre a agenda já gravada (dono, 25/09: "se eu pedir
 * para o agente, ele confirma comigo, vai lá e apaga tudo certinho").
 *
 * O agente nunca vê nem devolve o id da tarefa: cada peça da agenda ganha um
 * apelido curto (a1, a2...) e o servidor traduz. Agente que transcreve UUID
 * troca caracteres (memória "agente transpõe UUID"); apelido inventado é
 * simplesmente ignorado. Nada é feito na hora: a resposta leva um anexo
 * "acao_agenda" com a lista exata, e só executar_acao_agenda (o botão de
 * confirmar da equipe) mexe na agenda.
 *
 * 25/09 à noite ("todos os agentes agênticos"): além de apagar e mudar a data,
 * o agente do mês muda o formato, refaz peças (apaga e gera de novo pelo
 * pedido livre, com custo mostrado antes), edita campanhas (c1, c2...) e
 * propõe gerar os conteúdos de meses inteiros pelo gerador de meses (anexo
 * "gerar_conteudos", com custo antes de confirmar).
 */

/** Formatos de peça (arte ou vídeo), iguais a FORMATOS_DE_PECA da tela (useAgendaDoMes.ts). */
export const FORMATOS_DE_PECA = ["carousel", "static", "design", "reel", "story", "video", "short", "google_post"];

export const ehPeca = (tipo?: string | null) => FORMATOS_DE_PECA.indexOf(String(tipo || "").toLowerCase()) >= 0;

/** Máximo de peças listadas para o agente e de ações num pedido só. */
export const MAX_PECAS_PARA_O_AGENTE = 150;
/**
 * Agente do Mês v2 (26/09, contexto de 1M do GPT-6 Sol): a agenda inteira dos
 * próximos 12 meses vai para o modelo, até este teto (o orçamento de tokens
 * corta o detalhe antes de cortar peça).
 */
export const MAX_PECAS_NA_AGENDA_LONGA = 600;
/** Ações num pedido só ("revise todos os meses" cabe inteiro). */
export const MAX_ACOES_POR_PEDIDO = 300;
/**
 * Refazer gera de novo com IA em lotes deste tamanho (uma geração por lote). A
 * lista do pedido pode ter mais: o painel refaz lote atrás de lote até acabar
 * (dono, 26/09: "era para ser para todos os meses", e o agente parava em 12).
 */
export const MAX_REFAZER_POR_PEDIDO = 12;
/** Teto de peças num pedido de refazer (a agenda de vários meses cabe inteira). */
export const MAX_REFAZER_NA_LISTA = 120;
/** Reescrever textos de peças já gravadas (sem gerar do zero): barato, vale para a agenda toda. */
export const MAX_EDITAR_TEXTOS = 300;

export type PecaDaAgenda = {
  id: string;
  title: string;
  due_date: string | null;
  delivery_type: string | null;
  status: string | null;
  campanha?: string | null;
  /** Público, gancho, lâminas e copy da peça (do item da proposta gravada), para o agente achar o que casa com o pedido. */
  detalhe?: string | null;
};
export type PecaComApelido = PecaDaAgenda & { ref: string };

export type CampanhaDaAgenda = { id: string; nome: string; status: string; periodo_inicio: string | null; periodo_fim: string | null };
export type CampanhaComApelido = CampanhaDaAgenda & { ref: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

const NOME_DO_FORMATO: Record<string, string> = {
  carousel: "carrossel", static: "estático", design: "design", reel: "reels", story: "story", video: "vídeo", short: "short", google_post: "post do Google",
};

export const nomeDoFormato = (tipo?: string | null) => NOME_DO_FORMATO[String(tipo || "").toLowerCase()] || "peça";

/** Nome que o modelo escreve (em português ou inglês) para o formato da tarefa. Null quando não é formato de peça. */
export function formatoDoPedido(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
  if (!s) return null;
  if (FORMATOS_DE_PECA.indexOf(s) >= 0) return s;
  const sinonimos: Record<string, string> = {
    carrossel: "carousel", carrosel: "carousel", estatico: "static", post: "static", post_estatico: "static", imagem: "static",
    reels: "reel", stories: "story", storie: "story", video: "video", shorts: "short", post_do_google: "google_post", google: "google_post",
  };
  return sinonimos[s] || null;
}

/** Só as peças, em ordem de data, com apelido a1..aN. */
export function pecasComApelido(tarefas: PecaDaAgenda[], max = MAX_PECAS_PARA_O_AGENTE): PecaComApelido[] {
  return tarefas
    .filter((t) => ehPeca(t.delivery_type))
    .slice()
    .sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")) || String(a.title).localeCompare(String(b.title)))
    .slice(0, Math.max(1, max))
    .map((t, i) => ({ ...t, ref: `a${i + 1}` }));
}

/** Campanhas do cliente com apelido c1..cN (as encerradas por último). */
export function campanhasComApelido(campanhas: CampanhaDaAgenda[]): CampanhaComApelido[] {
  return campanhas
    .slice()
    .sort((a, b) => Number(a.status === "encerrada") - Number(b.status === "encerrada"))
    .slice(0, 30)
    .map((c, i) => ({ ...c, ref: `c${i + 1}` }));
}

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Bloco do prompt com a agenda gravada, uma peça por linha. */
export function blocoDaAgendaParaAcoes(
  pecas: PecaComApelido[],
  campanhas: CampanhaComApelido[] = [],
  periodo = "deste mês e dos 3 seguintes",
): string {
  const blocoDasCampanhas = campanhas.length
    ? `\nCAMPANHAS DO CLIENTE (apelido | nome | estado | período). Use só estes apelidos em editar_campanhas:\n${campanhas
      .map((c) => `${c.ref} | ${umaLinha(c.nome, 100)} | ${c.status} | ${c.periodo_inicio ?? "sem início"} a ${c.periodo_fim ?? "sem fim"}`)
      .join("\n")}\n`
    : "";
  if (!pecas.length) return `\nAGENDA GRAVADA (peças de arte e vídeo): nenhuma peça gravada neste período.\n${blocoDasCampanhas}`;
  const linhas = pecas.map((p) =>
    `${p.ref} | ${p.due_date ?? "sem data"} | ${nomeDoFormato(p.delivery_type)} | ${umaLinha(p.title || "sem título", 140)}${p.campanha ? ` | campanha: ${umaLinha(p.campanha, 80)}` : ""}${p.detalhe ? ` | ${umaLinha(p.detalhe, 1400)}` : ""}`
  );
  const comDetalhe = pecas.some((p) => p.detalhe);
  return `\nAGENDA GRAVADA (peças de arte e vídeo ${periodo}; apelido | data | formato | título | campanha, quando a peça é de uma${comDetalhe ? " | público, gancho, lâminas e legenda, quando a peça tem roteiro" : ""}). Use só estes apelidos em acoes_na_agenda:\n${linhas.join("\n")}\n${blocoDasCampanhas}`;
}

export type ItemDaAcao = { task_id: string; titulo: string; data: string | null; formato: string };
export type MudancaDeData = ItemDaAcao & { para: string };
export type MudancaDeFormato = ItemDaAcao & { formato_de: string; formato_para: string; formato_para_nome: string };
export type EdicaoDeCampanha = {
  campanha_id: string;
  nome_atual: string;
  campos: { nome?: string; status?: string; periodo_inicio?: string; periodo_fim?: string };
};
/** Campos de texto que editar_textos troca numa peça gravada (vazio = fica como está). */
export type CamposDeTexto = {
  titulo?: string;
  tema?: string;
  gancho?: string;
  copy?: string;
  cta?: string;
  publico?: string;
  /** Texto novo de lâminas (pela ordem); lâmina que não existe é ignorada na execução. */
  cards?: Array<{ ordem: number; texto: string }>;
};
export type EdicaoDeTexto = ItemDaAcao & { campos: CamposDeTexto };
export type AcaoNaAgenda = {
  tipo: "acao_agenda";
  resumo: string;
  apagar: ItemDaAcao[];
  mudar_data: MudancaDeData[];
  mudar_formato: MudancaDeFormato[];
  /** Apaga da agenda e gera de novo, nas mesmas datas e formatos (pedido livre, com custo). */
  refazer: ItemDaAcao[];
  editar_campanhas: EdicaoDeCampanha[];
  /** Reescreve título, tema, gancho, copy, CTA, público e lâminas de peças gravadas, sem gerar do zero (sem custo na confirmação). */
  editar_textos: EdicaoDeTexto[];
  ignorados: string[];
};

const LIMITES_DOS_TEXTOS: Record<string, number> = { titulo: 200, tema: 200, gancho: 400, copy: 2200, cta: 300, publico: 400 };

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Lê os campos de um editar_textos; null quando nada muda. */
export function camposDeTexto(bruto: unknown): CamposDeTexto | null {
  const m = (bruto ?? {}) as Record<string, unknown>;
  const campos: CamposDeTexto = {};
  for (const k of Object.keys(LIMITES_DOS_TEXTOS)) {
    const v = texto(m[k], LIMITES_DOS_TEXTOS[k]);
    if (v) (campos as Record<string, unknown>)[k] = v;
  }
  const cards: Array<{ ordem: number; texto: string }> = [];
  const vistas = new Set<number>();
  for (const c of Array.isArray(m.cards) ? m.cards.slice(0, 20) : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const ordem = Math.round(Number(o.ordem));
    const t = texto(o.texto, 1200);
    if (!Number.isFinite(ordem) || ordem < 1 || ordem > 20 || !t || vistas.has(ordem)) continue;
    vistas.add(ordem);
    cards.push({ ordem, texto: t });
  }
  if (cards.length) campos.cards = cards.sort((a, b) => a.ordem - b.ordem);
  return Object.keys(campos).length ? campos : null;
}

const ESTADOS_DA_CAMPANHA = ["planejada", "gravada", "encerrada"];

/**
 * Lê o que o modelo devolveu em acoes_na_agenda e troca apelido por tarefa.
 * Null quando não há nada para fazer. Apelido desconhecido ou repetido vai para
 * `ignorados` (a tela mostra), nunca vira ação.
 */
export function normalizarAcoesNaAgenda(bruto: unknown, pecas: PecaComApelido[], campanhas: CampanhaComApelido[] = []): AcaoNaAgenda | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const porRef = new Map(pecas.map((p) => [p.ref.toLowerCase(), p]));
  const usados = new Set<string>();
  const ignorados: string[] = [];
  const item = (p: PecaComApelido): ItemDaAcao => ({
    task_id: p.id,
    titulo: String(p.title || "sem título").slice(0, 200),
    data: p.due_date,
    formato: nomeDoFormato(p.delivery_type),
  });

  const apagar: ItemDaAcao[] = [];
  for (const r of (Array.isArray(o.apagar) ? o.apagar : []).slice(0, MAX_ACOES_POR_PEDIDO)) {
    const ref = texto(r, 12).toLowerCase();
    const p = porRef.get(ref);
    if (!p || usados.has(ref)) {
      if (ref) ignorados.push(ref);
      continue;
    }
    usados.add(ref);
    apagar.push(item(p));
  }

  // Refazer = apagar e gerar de novo: a peça não pode estar em outra ação.
  const refazer: ItemDaAcao[] = [];
  for (const r of (Array.isArray(o.refazer) ? o.refazer : []).slice(0, MAX_ACOES_POR_PEDIDO)) {
    const ref = texto(r, 12).toLowerCase();
    const p = porRef.get(ref);
    if (!p || usados.has(ref) || refazer.length >= MAX_REFAZER_NA_LISTA) {
      if (ref) ignorados.push(ref);
      continue;
    }
    usados.add(ref);
    refazer.push(item(p));
  }

  const mudar: MudancaDeData[] = [];
  const formatos: MudancaDeFormato[] = [];
  const mexidos = new Set<string>();
  for (const b of (Array.isArray(o.mudar_data) ? o.mudar_data : []).slice(0, MAX_ACOES_POR_PEDIDO)) {
    const m = (b ?? {}) as Record<string, unknown>;
    const ref = texto(m.ref, 12).toLowerCase();
    const para = texto(m.data, 10);
    const p = porRef.get(ref);
    if (!p || usados.has(ref) || mexidos.has(`d:${ref}`) || !DATA.test(para) || para === p.due_date) {
      if (ref) ignorados.push(ref);
      continue;
    }
    mexidos.add(`d:${ref}`);
    mudar.push({ ...item(p), para });
  }

  // Mudar o formato combina com mudar a data (a mesma peça pode ter as duas).
  for (const b of (Array.isArray(o.mudar_formato) ? o.mudar_formato : []).slice(0, MAX_ACOES_POR_PEDIDO)) {
    const m = (b ?? {}) as Record<string, unknown>;
    const ref = texto(m.ref, 12).toLowerCase();
    const para = formatoDoPedido(m.formato);
    const p = porRef.get(ref);
    const atual = String(p?.delivery_type || "").toLowerCase();
    if (!p || usados.has(ref) || mexidos.has(`f:${ref}`) || !para || para === atual) {
      if (ref) ignorados.push(ref);
      continue;
    }
    mexidos.add(`f:${ref}`);
    formatos.push({ ...item(p), formato_de: atual, formato_para: para, formato_para_nome: nomeDoFormato(para) });
  }
  // Reescrever textos combina com mudar data e formato; não com apagar nem refazer.
  const textos: EdicaoDeTexto[] = [];
  for (const b of (Array.isArray(o.editar_textos) ? o.editar_textos : []).slice(0, MAX_EDITAR_TEXTOS)) {
    const m = (b ?? {}) as Record<string, unknown>;
    const ref = texto(m.ref, 12).toLowerCase();
    const p = porRef.get(ref);
    const campos = p ? camposDeTexto(m) : null;
    if (!p || !campos || usados.has(ref) || mexidos.has(`t:${ref}`)) {
      if (ref) ignorados.push(ref);
      continue;
    }
    mexidos.add(`t:${ref}`);
    textos.push({ ...item(p), campos });
  }
  const porRefC = new Map(campanhas.map((c) => [c.ref.toLowerCase(), c]));
  const edicoes: EdicaoDeCampanha[] = [];
  const campanhasUsadas = new Set<string>();
  for (const b of (Array.isArray(o.editar_campanhas) ? o.editar_campanhas : []).slice(0, 30)) {
    const m = (b ?? {}) as Record<string, unknown>;
    const ref = texto(m.ref, 12).toLowerCase();
    const c = porRefC.get(ref);
    if (!c || campanhasUsadas.has(ref)) {
      if (ref) ignorados.push(ref);
      continue;
    }
    const campos: EdicaoDeCampanha["campos"] = {};
    const nome = texto(m.nome, 120);
    if (nome && nome !== c.nome) campos.nome = nome;
    const status = texto(m.status, 20).toLowerCase();
    if (status && ESTADOS_DA_CAMPANHA.indexOf(status) >= 0 && status !== c.status) campos.status = status;
    const ini = texto(m.periodo_inicio, 10);
    const fim = texto(m.periodo_fim, 10);
    if (DATA.test(ini) && ini !== c.periodo_inicio) campos.periodo_inicio = ini;
    if (DATA.test(fim) && fim !== c.periodo_fim) campos.periodo_fim = fim;
    const iniFinal = campos.periodo_inicio ?? c.periodo_inicio;
    const fimFinal = campos.periodo_fim ?? c.periodo_fim;
    if (iniFinal && fimFinal && fimFinal < iniFinal) {
      delete campos.periodo_inicio;
      delete campos.periodo_fim;
    }
    if (!Object.keys(campos).length) {
      ignorados.push(ref);
      continue;
    }
    campanhasUsadas.add(ref);
    edicoes.push({ campanha_id: c.id, nome_atual: c.nome, campos });
  }

  if (!apagar.length && !mudar.length && !formatos.length && !refazer.length && !edicoes.length && !textos.length) return null;
  const partes: string[] = [];
  if (apagar.length) partes.push(`apagar ${apagar.length} ${apagar.length === 1 ? "peça" : "peças"}`);
  if (refazer.length) partes.push(`refazer ${refazer.length} ${refazer.length === 1 ? "peça" : "peças"}`);
  if (mudar.length) partes.push(`mudar a data de ${mudar.length} ${mudar.length === 1 ? "peça" : "peças"}`);
  if (formatos.length) partes.push(`mudar o formato de ${formatos.length} ${formatos.length === 1 ? "peça" : "peças"}`);
  if (textos.length) partes.push(`reescrever os textos de ${textos.length} ${textos.length === 1 ? "peça" : "peças"}`);
  if (edicoes.length) partes.push(`editar ${edicoes.length} ${edicoes.length === 1 ? "campanha" : "campanhas"}`);
  return {
    tipo: "acao_agenda",
    resumo: texto(o.resumo, 600) || `Vou ${partes.join(" e ")}.`,
    apagar,
    mudar_data: mudar,
    mudar_formato: formatos,
    refazer,
    editar_campanhas: edicoes,
    editar_textos: textos,
    ignorados,
  };
}

/** Pedido de gerar os conteúdos de meses inteiros pelo gerador de meses (a tela roda e mostra o custo antes). */
export type GeracaoDeConteudos = {
  tipo: "gerar_conteudos";
  resumo: string;
  meses: string[];
  frequencia_semanal: number;
  project_id: string | null;
  projeto_nome: string | null;
};

/**
 * Lê gerar_conteudos da resposta. Só meses de agora em diante (até 12 à
 * frente), frequência de 1 a 14 por semana. O projeto vem do servidor (projeto
 * de social da marca aberta), nunca do modelo.
 */
export function normalizarGeracao(
  bruto: unknown,
  mesAtual: string,
  projeto: { id: string; nome: string } | null,
  frequenciaPadrao = 3,
): GeracaoDeConteudos | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const limite = somarMeses(mesAtual, 12);
  const meses: string[] = [];
  for (const m of Array.isArray(o.meses) ? o.meses : []) {
    const s = texto(m, 10).slice(0, 7);
    if (!MES.test(s) || s < mesAtual || s > limite || meses.indexOf(s) >= 0) continue;
    const n = Number(s.slice(5, 7));
    if (n < 1 || n > 12) continue;
    meses.push(s);
  }
  if (!meses.length) return null;
  meses.sort();
  const f = Math.round(Number(o.frequencia_semanal));
  const frequencia = Number.isFinite(f) && f >= 1 && f <= 14 ? f : Math.max(1, Math.min(14, Math.round(frequenciaPadrao) || 3));
  return {
    tipo: "gerar_conteudos",
    resumo: texto(o.resumo, 600) || `Vou gerar os conteúdos de ${meses.length} ${meses.length === 1 ? "mês" : "meses"}, ${frequencia} por semana.`,
    meses: meses.slice(0, 12),
    frequencia_semanal: frequencia,
    project_id: projeto ? projeto.id : null,
    projeto_nome: projeto ? projeto.nome : null,
  };
}

function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Texto do pedido livre que gera de novo as peças refeitas (mesmas datas e formatos, abordagem nova). */
export function pedidoParaRefazer(itens: Array<Pick<ItemDaAcao, "titulo" | "data" | "formato">>, orientacao?: string | null): string {
  const linhas = itens.map((i) => `- ${i.data ?? "sem data"} · ${i.formato} · no lugar de "${umaLinha(i.titulo, 140)}"`);
  const base = `Refaça estes conteúdos que saíram da agenda, um para cada linha, na mesma data e no mesmo formato, com tema e abordagem novos (não repita o que saiu):\n${linhas.join("\n")}`;
  // O motivo do pedido (ex.: falar com o público real, não com agências) vale para todas as linhas.
  const o = umaLinha(orientacao || "", 400);
  return o ? `${base}\nOrientação da equipe para todas: ${o}` : base;
}

const somarDiasIso = (data: string, n: number) => {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const ehDiaUtilIso = (data: string) => {
  const s = new Date(`${data}T12:00:00.000Z`).getUTCDay();
  return s >= 1 && s <= 5;
};

/**
 * Janela de datas do pedido livre: 30 dias a partir do início, esticada até a
 * última data AAAA-MM-DD que o pedido cita (até 12 meses). Sem isso, refazer
 * peças de novembro e dezembro jogava todas para o último dia útil dos 30 dias
 * (26/09: 12 peças de novembro caíram em 26/10). Datas citadas que não são dia
 * útil (uma peça de sábado que já estava na agenda) também valem.
 */
export function janelaDoPedidoLivre(inicio: string, mensagem: string): { fim: string; uteis: string[] } {
  let fim = somarDiasIso(inicio, 30);
  const teto = somarDiasIso(inicio, 366);
  const citadas = (String(mensagem || "").match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).filter((d) => DATA.test(d) && d >= inicio && d <= teto);
  for (const d of citadas) if (d > fim) fim = d;
  const uteis: string[] = [];
  for (let d = inicio; d <= fim && uteis.length < 400; d = somarDiasIso(d, 1)) if (ehDiaUtilIso(d)) uteis.push(d);
  for (const d of citadas) if (uteis.indexOf(d) < 0) uteis.push(d);
  uteis.sort();
  return { fim, uteis };
}

/** Texto da regra no prompt do agente do mês. */
export const REGRA_DAS_ACOES_NA_AGENDA = `- acoes_na_agenda: só quando a equipe PEDIR para mexer em peças que JÁ ESTÃO na agenda gravada ou nas campanhas. apagar: apelidos das peças que saem (apagar, limpar, tirar). refazer: apelidos das peças que saem e são geradas de novo na mesma data e formato ("refaça", "gere de novo", "troque por outro", "revise"), TODAS as que casam com o pedido, até ${MAX_REFAZER_NA_LISTA} (o painel refaz em lotes de ${MAX_REFAZER_POR_PEDIDO}, um atrás do outro; nunca diga que o resto fica para depois). editar_textos: { ref, titulo, tema, gancho, copy, cta, publico, cards: [{ ordem, texto }] } para REESCREVER peças que já estão boas na estrutura mas erram no texto (público errado, falar com agência em vez do cliente final, tom, CTA): mais barato e fiel que refazer; vazio no campo que não muda; cards só com as lâminas que mudam, seguindo a regra de menos texto. Pedido amplo ("revise todos os meses", "tudo que fala com agência") vale para TODAS as peças que casam, lendo público, gancho, lâminas e legenda de cada uma: use editar_textos quando a peça só precisa de texto novo e refazer quando o tema inteiro não serve. mudar_data: { ref, data AAAA-MM-DD } para cada peça que muda de dia. mudar_formato: { ref, formato } com formato carrossel, estatico, reels, story ou video. editar_campanhas: { ref (apelido c1, c2...), nome, status (planejada, gravada ou encerrada), periodo_inicio, periodo_fim } com vazio no que não muda. "Apague os conteúdos da campanha X" = apagar das peças com "campanha: X". resumo: 1 a 2 frases dizendo o que vai acontecer. Use SÓ apelidos das listas AGENDA GRAVADA e CAMPANHAS; nunca invente apelido. Pedido amplo ("apague tudo de outubro", "limpe a agenda") vale para todas as peças que casam com o pedido; na dúvida sobre quais peças, pergunte na resposta e devolva null. Nada é feito agora: a equipe vê a lista e confirma. Na resposta, diga que a lista está pronta para confirmar. Sem pedido desse tipo, null.
- gerar_conteudos: só quando a equipe PEDIR para criar ou gerar os conteúdos de um mês inteiro ou de vários ("crie todos os conteúdos de outubro", "preencha os próximos 3 meses"). meses: lista AAAA-MM; frequencia_semanal: a do plano combinado, ou a que a equipe pediu. resumo: 1 frase. A equipe vê o custo e confirma; o gerador de meses segue o plano combinado de cada mês. Sem pedido desse tipo, null.`;
