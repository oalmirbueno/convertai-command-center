import { supabase } from "@/integrations/supabase/client";
import type { ResumoDaMensagem } from "./email-central";

/**
 * Correio: a caixa por prioridade, o quadro e o dia (tarefas e compromissos). Contrato do banco:
 * supabase/migrations/20261118210000_produto_correio_meu_dia.sql.
 *
 * A separação da caixa é regra fixa, sem adivinhar pelo texto: quem está esperando quem. O provedor
 * diz se a conversa espera você, espera o outro, ou se é envio automático. Leitura do conteúdo por IA
 * (resumo, resposta sugerida) é do copiloto, que entra com o plano e não muda estas regras.
 */

export type GrupoDaCaixa = "responder" | "acompanhar" | "esperar";
export type ColunaDoQuadro = "chegou" | "responder" | "aguardando" | "concluido";

export interface MensagemDaCaixa extends ResumoDaMensagem {
  /** Quem deve o próximo passo, pelo provedor: "voce", "outro" ou nada. */
  aguardando?: "voce" | "outro" | null;
  /** Boletim, aviso de sistema ou lista: ninguém espera resposta. */
  automatica?: boolean;
  arquivada?: boolean;
}

export const GRUPOS: Array<{ id: GrupoDaCaixa; nome: string; porque: string; ponto: string }> = [
  { id: "responder", nome: "Responder hoje", porque: "Pessoas esperando você", ponto: "bg-destructive" },
  { id: "acompanhar", nome: "Acompanhar", porque: "Você espera alguém", ponto: "bg-info" },
  { id: "esperar", nome: "Pode esperar", porque: "Avisos e boletins", ponto: "bg-muted-foreground" },
];

/** Em que grupo a mensagem cai. Automática nunca pede resposta; não lida de gente pede. */
export function grupoDaMensagem(m: MensagemDaCaixa): GrupoDaCaixa {
  if (m.automatica) return "esperar";
  if (m.aguardando === "outro") return "acompanhar";
  if (m.aguardando === "voce" || !m.lida) return "responder";
  return "esperar";
}

export function agruparCaixa(mensagens: MensagemDaCaixa[]): Record<GrupoDaCaixa, MensagemDaCaixa[]> {
  const g: Record<GrupoDaCaixa, MensagemDaCaixa[]> = { responder: [], acompanhar: [], esperar: [] };
  for (const m of mensagens) if (!m.arquivada) g[grupoDaMensagem(m)].push(m);
  // Em "Responder", quem espera há mais tempo vem primeiro; nos outros, o mais novo.
  const data = (m: MensagemDaCaixa) => (m.recebida_em ? Date.parse(m.recebida_em) : 0);
  g.responder.sort((a, b) => data(a) - data(b));
  g.acompanhar.sort((a, b) => data(a) - data(b));
  g.esperar.sort((a, b) => data(b) - data(a));
  return g;
}

export const COLUNAS: Array<{ id: ColunaDoQuadro; nome: string; ponto: string }> = [
  { id: "chegou", nome: "Chegou", ponto: "bg-muted-foreground" },
  { id: "responder", nome: "Responder", ponto: "bg-destructive" },
  { id: "aguardando", nome: "Aguardando resposta", ponto: "bg-info" },
  { id: "concluido", nome: "Concluído", ponto: "bg-success" },
];

/** A coluna do quadro sai do mesmo estado da conversa: o cartão anda sozinho. */
export function colunaDaMensagem(m: MensagemDaCaixa): ColunaDoQuadro {
  if (m.arquivada) return "concluido";
  if (m.automatica) return "chegou";
  if (m.aguardando === "outro") return "aguardando";
  if (m.aguardando === "voce") return "responder";
  return m.lida ? "concluido" : "chegou";
}

/** "MA" para "Marcos Andrade" ou para "marcos@exemplo.com.br". */
export function iniciais(nomeOuEmail: string): string {
  const limpo = String(nomeOuEmail || "").replace(/<[^>]*>/g, "").split("@")[0].trim();
  const partes = limpo.split(/[\s._-]+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : partes[0][1] || "")).toUpperCase();
}

// ------------------------------------------------------------------ tarefas e compromissos

export interface TarefaDoCorreio {
  id: string;
  titulo: string;
  origem: string | null;
  prazo: string | null;
  feita_em: string | null;
  criado_em: string;
}

export interface CompromissoDoCorreio {
  id: string;
  titulo: string;
  detalhe: string | null;
  inicio: string;
  fim: string | null;
}

export interface EuNoCorreio {
  membro_id: string;
  conta_id: string;
  nome: string;
}

const db = supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }> };

export async function quemSouNoCorreio(): Promise<EuNoCorreio | null> {
  const { data, error } = await db.rpc("produto_correio_eu");
  if (error) throw error;
  return data && data.membro_id ? (data as EuNoCorreio) : null;
}

export async function listarTarefas(): Promise<TarefaDoCorreio[]> {
  const { data, error } = await db.from("produto_correio_tarefas").select("id, titulo, origem, prazo, feita_em, criado_em").order("criado_em", { ascending: true }).limit(200);
  if (error) throw error;
  return (data || []) as TarefaDoCorreio[];
}

export async function criarTarefa(eu: EuNoCorreio, p: { titulo: string; origem?: string | null; prazo?: string | null; caixa_id?: string | null; mensagem_ref?: string | null }): Promise<void> {
  const titulo = p.titulo.trim().slice(0, 200);
  if (!titulo) throw new Error("Escreva a tarefa.");
  const { error } = await db.from("produto_correio_tarefas").insert({ conta_id: eu.conta_id, membro_id: eu.membro_id, titulo, origem: p.origem || null, prazo: p.prazo || null, caixa_id: p.caixa_id || null, mensagem_ref: p.mensagem_ref || null });
  if (error) throw error;
}

export async function marcarTarefa(id: string, feita: boolean): Promise<void> {
  const { error } = await db.from("produto_correio_tarefas").update({ feita_em: feita ? new Date().toISOString() : null }).eq("id", id);
  if (error) throw error;
}

export async function apagarTarefa(id: string): Promise<void> {
  const { error } = await db.from("produto_correio_tarefas").delete().eq("id", id);
  if (error) throw error;
}

/** Os compromissos de um dia (AAAA-MM-DD, horário de Brasília). */
export async function listarCompromissos(dia: string): Promise<CompromissoDoCorreio[]> {
  const { data, error } = await db.from("produto_correio_compromissos").select("id, titulo, detalhe, inicio, fim").gte("inicio", `${dia}T00:00:00-03:00`).lte("inicio", `${dia}T23:59:59-03:00`).order("inicio", { ascending: true });
  if (error) throw error;
  return (data || []) as CompromissoDoCorreio[];
}

export async function criarCompromisso(eu: EuNoCorreio, p: { titulo: string; detalhe?: string; dia: string; hora: string; caixa_id?: string | null; mensagem_ref?: string | null }): Promise<void> {
  const titulo = p.titulo.trim().slice(0, 200);
  if (!titulo) throw new Error("Diga o que é o compromisso.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dia) || !/^\d{2}:\d{2}$/.test(p.hora)) throw new Error("Diga o dia e a hora.");
  const { error } = await db.from("produto_correio_compromissos").insert({ conta_id: eu.conta_id, membro_id: eu.membro_id, titulo, detalhe: (p.detalhe || "").trim().slice(0, 300) || null, inicio: `${p.dia}T${p.hora}:00-03:00`, caixa_id: p.caixa_id || null, mensagem_ref: p.mensagem_ref || null });
  if (error) throw error;
}

export async function apagarCompromisso(id: string): Promise<void> {
  const { error } = await db.from("produto_correio_compromissos").delete().eq("id", id);
  if (error) throw error;
}

/** "10:30" no horário de Brasília. */
export function horaDoCompromisso(iso: string): string {
  const d = new Date(Date.parse(iso) - 3 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export const hojeEmBrasilia = (agora = Date.now()) => new Date(agora - 3 * 3600 * 1000).toISOString().slice(0, 10);

/** O resumo do dia, em uma frase: o que a pessoa lê ao abrir. */
export function fraseDoDia(p: { responder: number; compromissos: number; tarefasAbertas: number }): string {
  const partes: string[] = [];
  const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  if (p.responder) partes.push(`${pl(p.responder, "e-mail pede", "e-mails pedem")} resposta`);
  if (p.compromissos) partes.push(pl(p.compromissos, "compromisso", "compromissos"));
  if (p.tarefasAbertas) partes.push(pl(p.tarefasAbertas, "tarefa aberta", "tarefas abertas"));
  if (!partes.length) return "Dia livre: nada pendente por aqui.";
  const texto = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
  return `${texto[0].toUpperCase()}${texto.slice(1)}.`;
}

/**
 * A hora da mensagem como no Gmail, sempre em Brasília: hoje só a hora ("14:32"), ontem "Ontem 09:10",
 * este ano "18/11 14:32" e antes disso "18/11/2025". `completo` traz dia, mês, ano e hora (a mensagem aberta).
 */
export function horaDaMensagem(iso: string | null | undefined, agora = new Date(), completo = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const fuso = { timeZone: "America/Sao_Paulo" } as const;
  const dia = (x: Date) => x.toLocaleDateString("pt-BR", { ...fuso, day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = d.toLocaleTimeString("pt-BR", { ...fuso, hour: "2-digit", minute: "2-digit" });
  if (completo) return `${dia(d)} às ${hora}`;
  if (dia(d) === dia(agora)) return hora;
  if (dia(d) === dia(new Date(agora.getTime() - 86400000))) return `Ontem ${hora}`;
  const ano = (x: Date) => x.toLocaleDateString("pt-BR", { ...fuso, year: "numeric" });
  if (ano(d) === ano(agora)) return `${d.toLocaleDateString("pt-BR", { ...fuso, day: "2-digit", month: "2-digit" })} ${hora}`;
  return dia(d);
}
