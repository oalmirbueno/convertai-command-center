/**
 * Movimentos do cliente: tudo o que aconteceu, com a data certa.
 *
 * Regra do dono (2026-09-18): a Central reconhece sozinha qualquer movimento
 * (material novo e o que ele e: carrossel, arte, documento; enviado para
 * aprovacao; aprovado ou com ajustes; agendado; publicado; tarefa, marco,
 * pedido, mensagem) e isso aparece no dossie, no historico do cliente e na
 * geracao dos rituais, com o dia certo. Antigos entram tambem.
 *
 * A fonte e UMA so, no banco: public.movimentos_do_cliente(...). Aqui so a
 * leitura e as formas de texto que o painel e a IA usam.
 */

import { supabase } from "@/integrations/supabase/client";

export interface Movimento {
  quando: string;
  tipo: string;
  /** Voz neutra, para a equipe e o dossie ("Cliente aprovou: ..."). */
  titulo: string;
  /** Voz para o cliente ("Voce aprovou: ..."). Igual ao titulo quando nao ha versao propria. */
  titulo_cliente: string;
  detalhe: string | null;
  visivel_ao_cliente: boolean;
  origem: string;
  ref_id: string | null;
  link: string | null;
}

export interface LerMovimentosOpcoes {
  /** Janela para tras, em dias (padrao 14). */
  dias?: number;
  /** So o que o cliente pode ver (padrao false). */
  somenteVisiveis?: boolean;
}

export async function lerMovimentos(clientId: string, opcoes: LerMovimentosOpcoes = {}): Promise<Movimento[]> {
  const dias = Math.max(1, Math.min(365, opcoes.dias ?? 14));
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const { data, error } = await (supabase as any).rpc("movimentos_do_cliente", {
    _client_id: clientId,
    _desde: desde,
    _ate: new Date().toISOString(),
    _somente_visiveis: opcoes.somenteVisiveis === true,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as Movimento[];
}

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function partesDaData(iso: string): { dia: string; hora: string; chave: string; semana: string } {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const chave = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const semana = DIAS[new Date(`${chave}T12:00:00-03:00`).getDay()] ?? "";
  return { dia, hora, chave, semana };
}

/** "18/09 12:39" no fuso do Brasil. */
export function quandoCurto(iso: string): string {
  const { dia, hora } = partesDaData(iso);
  return `${dia} ${hora}`;
}

export interface DiaDeMovimentos {
  chave: string;
  rotulo: string;
  itens: Movimento[];
}

/** Agrupa por dia (fuso do Brasil), do mais recente para o mais antigo. */
export function agruparPorDia(lista: readonly Movimento[]): DiaDeMovimentos[] {
  const mapa = new Map<string, DiaDeMovimentos>();
  for (const m of [...lista].sort((a, b) => (a.quando < b.quando ? 1 : -1))) {
    const { chave, dia, semana } = partesDaData(m.quando);
    const grupo = mapa.get(chave) ?? { chave, rotulo: `${semana}, ${dia}`, itens: [] };
    grupo.itens.push(m);
    mapa.set(chave, grupo);
  }
  return [...mapa.values()];
}

/**
 * Bloco de fatos para a IA do ritual: cada movimento com data e hora reais.
 * A IA e obrigada a usar ESTAS datas ("na quarta 16/09 aprovamos..."), em vez
 * de inventar "esta semana" para tudo.
 */
export function movimentosComoFatos(lista: readonly Movimento[], opcoes: { max?: number; dias?: number } = {}): string {
  const max = opcoes.max ?? 40;
  const dias = opcoes.dias ?? 14;
  if (!lista.length) return "";
  const grupos = agruparPorDia(lista);
  const linhas: string[] = [];
  let usados = 0;
  for (const g of grupos) {
    if (usados >= max) break;
    linhas.push(`${g.rotulo}:`);
    for (const m of g.itens) {
      if (usados >= max) break;
      const { hora } = partesDaData(m.quando);
      const detalhe = m.detalhe ? ` — ${m.detalhe}` : "";
      linhas.push(`- ${hora} · ${m.titulo}${detalhe}${m.visivel_ao_cliente ? "" : " [interno: não citar ao cliente]"}`);
      usados += 1;
    }
  }
  const resto = lista.length - usados;
  return [
    `MOVIMENTOS DOS ÚLTIMOS ${dias} DIAS, DIA A DIA (datas e horas reais do painel; cite o dia certo quando falar de cada um, nunca invente data nem junte tudo em "esta semana"):`,
    ...linhas,
    resto > 0 ? `(+${resto} movimentos anteriores no histórico.)` : "",
  ].filter(Boolean).join("\n");
}

/** Icone do diario do portal por tipo de movimento. */
export function iconeDoMovimento(tipo: string): "file" | "approved" | "publication" | "report" | "note" {
  switch (tipo) {
    case "aprovado":
    case "marco":
    case "acao":
    case "tarefa_feita":
      return "approved";
    case "agendado":
    case "reagendado":
    case "publicado":
    case "cancelado":
      return "publication";
    case "mensagem":
      return "report";
    case "pedido":
      return "note";
    default:
      return "file";
  }
}

/** Frase curta que explica o momento, na voz para o cliente. */
export function explicacaoDoMovimento(m: Movimento, paraEquipe: boolean): string | null {
  switch (m.tipo) {
    case "agendado":
      return paraEquipe ? "Entrou no calendário com data e hora." : "Já está no calendário: vai ao ar sozinho na data marcada, sem você precisar fazer nada.";
    case "reagendado":
      return paraEquipe ? "Data de publicação alterada." : "A data de publicação mudou; a nova data está acima.";
    case "ajustes_pedidos":
      return paraEquipe ? (m.detalhe || "Ajustes pedidos pelo cliente.") : "Recebemos seu pedido de ajuste. A equipe revisa e reenvia para sua aprovação.";
    case "compartilhado":
      return paraEquipe ? "Liberado na área do cliente." : "Disponível para você na área de Documentos.";
    case "mensagem":
      return paraEquipe ? "Atualização enviada ao cliente." : "A leitura completa está em Atualizações da Aceleriq.";
    case "pedido":
      return paraEquipe ? (m.detalhe || "Pedido aberto pelo cliente.") : "Seu pedido foi registrado e entrou na fila da equipe.";
    case "acao":
      return paraEquipe ? (m.detalhe || null) : "Mais um passo do plano vencido.";
    default:
      return m.detalhe || null;
  }
}
