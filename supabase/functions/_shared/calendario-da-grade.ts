/**
 * Calendário e simulador da grade (frente IG, rodada 3, 28/09/2026).
 *
 * Pedido do dono: "abrir o calendário, selecionar o post e mudar as datas,
 * trocar datas de forma automática; só os que ainda vão ser publicados";
 * "liberdade para mover um post, mudar a data, agendar"; o que se move no
 * calendário aparece na grade simulada na hora, e vice-versa.
 *
 * Um rascunho só de datas (id do post -> data ISO proposta) é a fonte das
 * duas telas. Nada vai ao banco até o Confirmar, que aplica cada mudança pelo
 * mesmo caminho do "Publicar em" (confirmarPublicacao): publica só com
 * aprovação do cliente e data confirmada.
 *
 * Travado (não se move): o que já está agendado na Meta ou publicado, com o
 * motivo. Move mas não agenda por aqui: post da Agenda sem peça do Estúdio ou
 * da Mesa Foto e post só da simulação (arte do acervo ou dos arquivos).
 *
 * Dias e horas no fuso da Agenda (America/Sao_Paulo). Puro: a tela e o Vitest
 * leem o mesmo arquivo. Sem regex moderna, sem travessão.
 */

import { localParaIso, partesNoFuso } from "../estudio-arte/modulos/entrega-na-agenda.ts";

export type ItemDoCalendario = {
  id: string;
  titulo: string;
  formato: string;
  origem: string;
  data: string | null;
  estado?: string | null;
  peca?: { entrega_status?: unknown; id?: unknown } | Record<string, unknown> | null;
  publicacao?: { status?: unknown } | Record<string, unknown> | null;
};

export type Rascunho = Record<string, string>;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Dia (AAAA-MM-DD) e hora (HH:MM) no fuso da Agenda. */
export function noFuso(iso: string): { dia: string; hora: string } {
  return partesNoFuso(new Date(iso));
}

export function statusDaPublicacao(i: ItemDoCalendario): string {
  return String((i.publicacao && (i.publicacao as Record<string, unknown>).status) || "");
}

/** Motivo de não poder mover (null = pode mover). */
export function travaDoItem(i: ItemDoCalendario): string | null {
  const pub = statusDaPublicacao(i);
  if (pub === "published") return "Já publicado no Instagram.";
  const entrega = String((i.peca && (i.peca as Record<string, unknown>).entrega_status) || "");
  if (pub === "scheduled" || entrega === "agendado") return "Já agendado na Meta. Para mudar, desfaça em Publicar em.";
  return null;
}

/** Motivo de não poder agendar por aqui (null = agenda pelo Confirmar). */
export function semAgendamento(i: ItemDoCalendario): string | null {
  const trava = travaDoItem(i);
  if (trava) return trava;
  if (i.origem === "simulado") return "Post só da simulação: crie o post na Mesa Foto ou no Estúdio para agendar.";
  if (!i.peca) return "Post da Agenda sem peça do Estúdio: a data deste muda na Agenda.";
  return null;
}

export type EstadoNoCalendario = { rotulo: string; tom: "ok" | "andamento" | "alerta" | "neutro" | "erro" | "trava" };

export function estadoNoCalendario(i: ItemDoCalendario): EstadoNoCalendario {
  const pub = statusDaPublicacao(i);
  if (pub === "published") return { rotulo: "Publicado", tom: "trava" };
  const entrega = String((i.peca && (i.peca as Record<string, unknown>).entrega_status) || i.estado || "");
  if (pub === "scheduled" || entrega === "agendado") return { rotulo: "Agendado", tom: "trava" };
  if (pub === "failed") return { rotulo: "Falhou", tom: "erro" };
  if (i.origem === "simulado") return { rotulo: "Simulação", tom: "neutro" };
  if (entrega === "aprovado") return { rotulo: "Aprovado", tom: "ok" };
  if (entrega === "aguardando_cliente") return { rotulo: "Aguardando cliente", tom: "andamento" };
  if (entrega === "aguardando_agencia") return { rotulo: "Aguardando agência", tom: "andamento" };
  if (entrega === "reprovado") return { rotulo: "Ajuste pedido", tom: "alerta" };
  if (entrega === "precisa_de_atencao") return { rotulo: "Precisa de atenção", tom: "alerta" };
  return { rotulo: "Em produção", tom: "neutro" };
}

/** A data que vale na simulação: a do rascunho, senão a de hoje do post. */
export function dataEfetiva(i: ItemDoCalendario, r: Rascunho): string | null {
  if (!travaDoItem(i) && r[i.id]) return r[i.id];
  return i.data;
}

/** Ordem de ir ao ar: por data efetiva; sem data no fim, na ordem dada. */
export function ordemPorData<T extends ItemDoCalendario>(itens: T[], r: Rascunho): T[] {
  const indice: Record<string, number> = {};
  itens.forEach((i, k) => (indice[i.id] = k));
  return itens.slice().sort((a, b) => {
    const da = dataEfetiva(a, r);
    const db = dataEfetiva(b, r);
    if (da && db) return Date.parse(da) - Date.parse(db) || indice[a.id] - indice[b.id];
    if (da) return -1;
    if (db) return 1;
    return indice[a.id] - indice[b.id];
  });
}

/** Intervalo (múltiplo de 1 dia) entre posts: a mediana das datas, senão 2 dias. */
export function ritmo(datas: string[]): number {
  const ms = datas.map((d) => Date.parse(d)).filter((x) => isFinite(x)).sort((a, b) => a - b);
  const passos: number[] = [];
  for (let k = 1; k < ms.length; k++) if (ms[k] > ms[k - 1]) passos.push(ms[k] - ms[k - 1]);
  passos.sort((a, b) => a - b);
  const m = passos.length ? passos[Math.floor(passos.length / 2)] : 2 * DIA_MS;
  return Math.max(DIA_MS, Math.round(m / DIA_MS) * DIA_MS);
}

/**
 * Nova ordem (ids) -> rascunho. As datas que existem entre os que se movem
 * trocam de lugar na nova ordem; quem não tem data ganha uma depois da
 * última, no mesmo ritmo. Travados ficam onde estão.
 */
export function rascunhoDaOrdem<T extends ItemDoCalendario>(itens: T[], ordem: string[], r: Rascunho, inicio: string): Rascunho {
  const porId: Record<string, T> = {};
  for (const i of itens) porId[i.id] = i;
  const moveis = ordem.map((id) => porId[id]).filter((i): i is T => !!i && !travaDoItem(i));
  const datas = moveis.map((i) => dataEfetiva(i, r)).filter((d): d is string => !!d).sort();
  const passo = ritmo(datas);
  const slots = datas.slice();
  let ultima = slots.length ? Date.parse(slots[slots.length - 1]) : Date.parse(inicio) - passo;
  while (slots.length < moveis.length) {
    ultima += passo;
    slots.push(new Date(ultima).toISOString());
  }
  const novo: Rascunho = { ...r };
  moveis.forEach((i, k) => {
    if (i.data && Date.parse(i.data) === Date.parse(slots[k])) delete novo[i.id];
    else novo[i.id] = slots[k];
  });
  return novo;
}

/** Move na ordem (de -> para, índices da ordem por data) e devolve o rascunho novo. */
export function moverNaOrdem<T extends ItemDoCalendario>(itens: T[], de: number, para: number, r: Rascunho, inicio: string): Rascunho {
  const ordem = ordemPorData(itens, r);
  if (de === para || de < 0 || para < 0 || de >= ordem.length || para >= ordem.length) return r;
  if (travaDoItem(ordem[de])) return r;
  const ids = ordem.map((i) => i.id);
  const [id] = ids.splice(de, 1);
  ids.splice(para, 0, id);
  return rascunhoDaOrdem(itens, ids, r, inicio);
}

/** Leva o post para o dia (AAAA-MM-DD), na hora dele ou na hora padrão. */
export function moverParaDia(i: ItemDoCalendario, dia: string, r: Rascunho, horaPadrao: string): Rascunho {
  if (travaDoItem(i)) return r;
  const atual = dataEfetiva(i, r);
  const hora = atual ? noFuso(atual).hora : horaPadrao;
  const iso = localParaIso(dia, hora);
  if (!iso) return r;
  const novo: Rascunho = { ...r };
  if (i.data && Date.parse(i.data) === Date.parse(iso)) delete novo[i.id];
  else novo[i.id] = iso;
  return novo;
}

/** Data escolhida à mão (ISO). */
export function mudarData(i: ItemDoCalendario, iso: string, r: Rascunho): Rascunho {
  if (travaDoItem(i) || !isFinite(Date.parse(iso))) return r;
  const novo: Rascunho = { ...r };
  if (i.data && Date.parse(i.data) === Date.parse(iso)) delete novo[i.id];
  else novo[i.id] = new Date(Date.parse(iso)).toISOString();
  return novo;
}

/**
 * Trocar datas automaticamente: os que podem mover ganham uma ordem
 * intercalada (formato diferente do post anterior na linha do tempo, contando
 * os travados) e datas no ritmo do cliente, a partir do começo, pulando os
 * dias em que já sai um post travado, no melhor horário de cada formato.
 */
export function distribuirAutomatico<T extends ItemDoCalendario>(
  itens: T[],
  r: Rascunho,
  opcoes: { inicio: string; horaDoFormato: (formato: string) => string; agora?: Date },
): Rascunho {
  const moveis = ordemPorData(itens.filter((i) => !travaDoItem(i)), r);
  if (!moveis.length) return r;
  const travados = itens.filter((i) => !!travaDoItem(i) && !!i.data);
  const diasTravados: Record<string, string> = {};
  for (const t of travados) diasTravados[noFuso(t.data as string).dia] = t.formato;
  const datas = moveis.map((i) => dataEfetiva(i, r)).filter((d): d is string => !!d);
  const passoDias = Math.round(ritmo(datas) / DIA_MS);
  const agora = opcoes.agora || new Date();
  const futuras = datas.filter((d) => Date.parse(d) > agora.getTime()).sort();
  let dia = noFuso(futuras.length && Date.parse(futuras[0]) > Date.parse(opcoes.inicio) ? futuras[0] : opcoes.inicio).dia;
  const somarDias = (d: string, n: number) => {
    const [a, m, x] = d.split("-").map(Number);
    const t = new Date(Date.UTC(a, m - 1, x + n));
    return t.toISOString().slice(0, 10);
  };
  // Formato do último post antes do começo (travado ou já publicado na linha).
  let anterior = "";
  for (const t of travados.slice().sort((a, b) => Date.parse(a.data as string) - Date.parse(b.data as string))) {
    if (noFuso(t.data as string).dia < dia) anterior = t.formato;
  }
  const resto = moveis.slice();
  const novo: Rascunho = { ...r };
  let guarda = 0;
  while (resto.length && guarda++ < 400) {
    if (diasTravados[dia]) {
      anterior = diasTravados[dia];
      dia = somarDias(dia, 1);
      continue;
    }
    let k = resto.findIndex((i) => i.formato !== anterior);
    if (k < 0) k = 0;
    const [i] = resto.splice(k, 1);
    const iso = localParaIso(dia, opcoes.horaDoFormato(i.formato));
    if (iso) {
      if (i.data && Date.parse(i.data) === Date.parse(iso)) delete novo[i.id];
      else novo[i.id] = iso;
    }
    anterior = i.formato;
    dia = somarDias(dia, Math.max(1, passoDias));
  }
  return novo;
}

export type MudancaDeData = { id: string; titulo: string; de: string | null; para: string; agenda: boolean; motivo: string | null };

/** Antes e depois de cada post que muda; `agenda` diz se o Confirmar aplica (peça do Estúdio ou da Mesa Foto). */
export function mudancasDoRascunho<T extends ItemDoCalendario>(itens: T[], r: Rascunho): MudancaDeData[] {
  const saida: MudancaDeData[] = [];
  for (const i of ordemPorData(itens, r)) {
    const para = r[i.id];
    if (!para || travaDoItem(i)) continue;
    if (i.data && Date.parse(i.data) === Date.parse(para)) continue;
    const motivo = semAgendamento(i);
    saida.push({ id: i.id, titulo: i.titulo, de: i.data, para, agenda: !motivo, motivo });
  }
  return saida;
}

/** Tira do rascunho o que não existe mais ou ficou travado (post que saiu ou foi agendado). */
export function rascunhoValido<T extends ItemDoCalendario>(itens: T[], r: Rascunho): Rascunho {
  const saida: Rascunho = {};
  for (const i of itens) if (r[i.id] && !travaDoItem(i)) saida[i.id] = r[i.id];
  return saida;
}

/** Semana (segunda a domingo) que contém o dia. */
export function semanaDe(dia: string): string[] {
  const [a, m, d] = dia.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1, d));
  const recuo = (base.getUTCDay() + 6) % 7;
  const dias: string[] = [];
  for (let k = 0; k < 7; k++) dias.push(new Date(Date.UTC(a, m - 1, d - recuo + k)).toISOString().slice(0, 10));
  return dias;
}

/** Formato do post no "melhor horário" do cliente (chaves da Agenda). */
export const tipoDoFormato = (formato: string): "carousel" | "static" => (formato === "carrossel" ? "carousel" : "static");
