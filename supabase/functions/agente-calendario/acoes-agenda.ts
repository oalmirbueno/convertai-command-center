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
 */

/** Formatos de peça (arte ou vídeo), iguais a FORMATOS_DE_PECA da tela (useAgendaDoMes.ts). */
export const FORMATOS_DE_PECA = ["carousel", "static", "design", "reel", "story", "video", "short", "google_post"];

export const ehPeca = (tipo?: string | null) => FORMATOS_DE_PECA.indexOf(String(tipo || "").toLowerCase()) >= 0;

/** Máximo de peças listadas para o agente e de ações num pedido só. */
export const MAX_PECAS_PARA_O_AGENTE = 150;
export const MAX_ACOES_POR_PEDIDO = 120;

export type PecaDaAgenda = { id: string; title: string; due_date: string | null; delivery_type: string | null; status: string | null };
export type PecaComApelido = PecaDaAgenda & { ref: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

const NOME_DO_FORMATO: Record<string, string> = {
  carousel: "carrossel", static: "estático", design: "design", reel: "reels", story: "story", video: "vídeo", short: "short", google_post: "post do Google",
};

export const nomeDoFormato = (tipo?: string | null) => NOME_DO_FORMATO[String(tipo || "").toLowerCase()] || "peça";

/** Só as peças, em ordem de data, com apelido a1..aN. */
export function pecasComApelido(tarefas: PecaDaAgenda[]): PecaComApelido[] {
  return tarefas
    .filter((t) => ehPeca(t.delivery_type))
    .slice()
    .sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")) || String(a.title).localeCompare(String(b.title)))
    .slice(0, MAX_PECAS_PARA_O_AGENTE)
    .map((t, i) => ({ ...t, ref: `a${i + 1}` }));
}

/** Bloco do prompt com a agenda gravada, uma peça por linha. */
export function blocoDaAgendaParaAcoes(pecas: PecaComApelido[]): string {
  if (!pecas.length) return "\nAGENDA GRAVADA (peças de arte e vídeo): nenhuma peça gravada neste período.\n";
  const linhas = pecas.map((p) => `${p.ref} | ${p.due_date ?? "sem data"} | ${nomeDoFormato(p.delivery_type)} | ${String(p.title || "sem título").replace(/\s+/g, " ").slice(0, 140)}`);
  return `\nAGENDA GRAVADA (peças de arte e vídeo deste mês e dos 3 seguintes; apelido | data | formato | título). Use só estes apelidos em acoes_na_agenda:\n${linhas.join("\n")}\n`;
}

export type ItemDaAcao = { task_id: string; titulo: string; data: string | null; formato: string };
export type MudancaDeData = ItemDaAcao & { para: string };
export type AcaoNaAgenda = {
  tipo: "acao_agenda";
  resumo: string;
  apagar: ItemDaAcao[];
  mudar_data: MudancaDeData[];
  ignorados: string[];
};

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Lê o que o modelo devolveu em acoes_na_agenda e troca apelido por tarefa.
 * Null quando não há nada para fazer. Apelido desconhecido ou repetido vai para
 * `ignorados` (a tela mostra), nunca vira ação.
 */
export function normalizarAcoesNaAgenda(bruto: unknown, pecas: PecaComApelido[]): AcaoNaAgenda | null {
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

  const mudar: MudancaDeData[] = [];
  for (const b of (Array.isArray(o.mudar_data) ? o.mudar_data : []).slice(0, MAX_ACOES_POR_PEDIDO)) {
    const m = (b ?? {}) as Record<string, unknown>;
    const ref = texto(m.ref, 12).toLowerCase();
    const para = texto(m.data, 10);
    const p = porRef.get(ref);
    if (!p || usados.has(ref) || !DATA.test(para) || para === p.due_date) {
      if (ref) ignorados.push(ref);
      continue;
    }
    usados.add(ref);
    mudar.push({ ...item(p), para });
  }

  if (!apagar.length && !mudar.length) return null;
  const partes: string[] = [];
  if (apagar.length) partes.push(`apagar ${apagar.length} ${apagar.length === 1 ? "peça" : "peças"}`);
  if (mudar.length) partes.push(`mudar a data de ${mudar.length} ${mudar.length === 1 ? "peça" : "peças"}`);
  return {
    tipo: "acao_agenda",
    resumo: texto(o.resumo, 600) || `Vou ${partes.join(" e ")} da agenda.`,
    apagar,
    mudar_data: mudar,
    ignorados,
  };
}

/** Texto da regra no prompt do agente do mês. */
export const REGRA_DAS_ACOES_NA_AGENDA = `- acoes_na_agenda: só quando a equipe PEDIR para apagar, limpar, tirar, refazer (apagar para gerar de novo) ou mudar a data de peças que JÁ ESTÃO na agenda gravada. apagar: apelidos das peças que saem. mudar_data: { ref, data AAAA-MM-DD } para cada peça que muda de dia. resumo: 1 a 2 frases dizendo o que vai acontecer. Use SÓ apelidos da lista AGENDA GRAVADA; nunca invente apelido. Pedido amplo ("apague tudo de outubro", "limpe a agenda") vale para todas as peças que casam com o pedido; na dúvida sobre quais peças, pergunte na resposta e devolva null. Nada é feito agora: a equipe vê a lista e confirma. Na resposta, diga que a lista está pronta para confirmar. Sem pedido desse tipo, null.`;
