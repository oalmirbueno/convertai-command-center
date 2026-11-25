/**
 * MCP 2.39.0 (25/11/2026): regras puras do Intermediador dos grupos de cliente.
 *
 * O que decide quando o assistente fala, quem é ouvido e o que fazer com cada resposta fica aqui, sem banco e
 * sem rede. O texto em si é escrito na hora (intermediador-escrita.ts); o julgamento de cada mensagem ouvida é do
 * Jev (Choice + Nouls), e quem transforma as notas em ação é o código.
 */

import type { PerguntaJev, ResultadoJev } from '../../_shared/jev.ts';
import { probabilidadeNoul } from '../../_shared/jev.ts';

export const CORTE = 0.6;
export const FAIXA_DE_DUVIDA: [number, number] = [0.5, 0.7];
export const MAXIMO_AO_CLIENTE = 3; // pergunta, uma de volta ou lembrete, fechamento
export const ASSUNTOS_POR_CLIENTE_POR_DIA = 2;
export const INTERVALO_ENTRE_ASSUNTOS_MIN = 30;
export const ESTADOS_ABERTOS = ['perguntando', 'esperando', 'lembrado'] as const;
export const ESTADOS_FINAIS = ['respondido', 'respondido_em_parte', 'vencido', 'precisa_do_almir', 'cancelado', 'previa'] as const;

export type Relacao = 'responde' | 'responde_parte' | 'pergunta_ao_assistente' | 'vai_ver' | 'reacao' | 'outro_assunto';
export interface Notas { relacao: Relacao; itens: number[]; humano: number; quem_e: number }
export type Acao = 'fechar' | 'fechar_parcial' | 'de_volta' | 'humano' | 'quem_e' | 'esperar';

/** O que nunca sai na pergunta de um agente (o motivo volta ao agente). */
export function perguntaProibida(t: string): string | null {
  const s = String(t ?? '');
  if (/(?<!\p{L})(ritua(l|is)|dossi[êe]s?|hermes|n8n|jev|mcp|clio|grok|bot|openbot|payload|idempot\p{L}*|dry.?run|prompt|agente)(?!\p{L})/iu.test(s)) return 'termo_interno';
  if (/(?<!\p{L})(mensalidade|boleto|pix|fatura|cobran[çc]a|desconto|or[çc]amento|contrato|reajuste|pagamento)(?!\p{L})/iu.test(s)) return 'assunto_do_almir';
  if (/[—–]/.test(s)) return 'travessao';
  if (/https?:\/\/|www\./i.test(s)) return 'link';
  return null;
}

/** Quem é ouvido: só gente do cliente, e só a pessoa marcada ou quem citou uma mensagem nossa. */
export function ouvida(
  m: { papel: string | null; remetente: string | null; resposta_a: string | null },
  a: { marcar_numero: string; marcar_numeros?: string[] },
  nossos: Set<string>,
): 'marcada' | 'citou' | null {
  if (!String(m.papel ?? '').startsWith('cliente')) return null;
  if (m.resposta_a && nossos.has(m.resposta_a)) return 'citou';
  const marcados = a.marcar_numeros?.length ? a.marcar_numeros : [a.marcar_numero];
  if (m.remetente && marcados.includes(m.remetente)) return 'marcada';
  return null;
}

function horaSP(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const dia = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[p.weekday];
  return { dia, hora: Number(p.hour) % 24 };
}

/** Pergunta nova e lembrete: dia útil, 8h às 19h. Resposta a quem falou: todo dia, 8h às 21h. */
export function emHorario(tipo: string, ms: number): boolean {
  const { dia, hora } = horaSP(ms);
  if (tipo === 'pergunta' || tipo === 'lembrete') return dia >= 1 && dia <= 5 && hora >= 8 && hora < 19;
  return hora >= 8 && hora < 21;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export const MAXIMO_MARCADOS = 6;
/** Fatia das mensagens do cliente acima da qual uma pessoa só é "quem responde" (sem nome no pedido). */
export const QUEM_RESPONDE_SOZINHO = 0.8;

/**
 * Quem marcar (pedido do Almir: "sempre marcar o membro do grupo referente ou todos").
 * Nome: essa pessoa. "dono": quem mais fala. "todos": todo mundo do cliente. Sem nada: a pessoa que responde
 * quase sempre (80% ou mais das mensagens do cliente) ou, se não houver, todos. Nome desconhecido: [].
 */
export function escolherPessoas<P extends { numero: string; nome: string | null; mensagens: number }>(pessoas: P[], marcar: string | null | undefined): P[] {
  const ordem = [...pessoas].sort((a, b) => b.mensagens - a.mensagens);
  if (!ordem.length) return [];
  const alvo = semAcento(String(marcar ?? ''));
  const todos = ordem.slice(0, MAXIMO_MARCADOS);
  if (['todos', 'todas', 'todo mundo', 'pessoal', 'equipe', 'grupo'].includes(alvo)) return todos;
  if (!alvo) {
    const total = ordem.reduce((s, p) => s + p.mensagens, 0);
    return ordem.length === 1 || ordem[0].mensagens / Math.max(total, 1) >= QUEM_RESPONDE_SOZINHO ? [ordem[0]] : todos;
  }
  const um = escolherPessoa(ordem, marcar);
  return um ? [um] : [];
}

/** "dono" ou vazio: quem do cliente mais fala no grupo. Nome: casa pelo nome (sem acento). */
export function escolherPessoa<P extends { numero: string; nome: string | null; mensagens: number }>(pessoas: P[], marcar: string | null | undefined): P | null {
  const alvo = semAcento(String(marcar ?? ''));
  const ordem = [...pessoas].sort((a, b) => b.mensagens - a.mensagens);
  if (!alvo || ['dono', 'dona', 'responsavel', 'cliente', 'quem decide'].includes(alvo)) return ordem[0] ?? null;
  return ordem.find((p) => semAcento(p.nome ?? '').split(/\s+/).some((n) => n === alvo) || semAcento(p.nome ?? '') === alvo || semAcento(p.nome ?? '').startsWith(alvo)) ?? null;
}

export const RELACOES: Record<Relacao, string> = {
  responde: 'As mensagens novas do cliente respondem à pergunta feita (no todo ou na maior parte).',
  responde_parte: 'Respondem só uma parte da pergunta; falta algum dos itens pedidos.',
  pergunta_ao_assistente: 'O cliente faz uma pergunta ou pede algo de volta, sobre esse mesmo tema, em vez de responder.',
  vai_ver: 'O cliente avisa que vai ver, conferir ou responder depois, sem responder ainda.',
  reacao: 'Só uma reação curta (ok, joinha, obrigado, emoji) sem conteúdo.',
  outro_assunto: 'Fala de outro assunto, que não é a pergunta feita.',
};

/** Uma chamada só: relação das mensagens novas, um Noul por item, humano e quem_e. */
export function perguntasAoJev(itens: string[]): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {
    relacao: {
      type: 'choice',
      instructions: 'O assistente da agência fez a pergunta em "pergunta_feita" ao cliente no grupo. Olhe as mensagens marcadas como novas em "mensagens_do_cliente" (as anteriores são contexto). Qual destas descreve melhor as mensagens novas?',
      criteria: RELACOES,
    },
    humano: {
      type: 'noul',
      instructions: 'As mensagens novas do cliente pedem algo que só o dono da agência pode decidir ou responder: preço, valor, prazo de entrega, desconto, contrato, reclamação, insatisfação ou uma decisão?',
      criteria: { true: 'Pede preço, prazo, desconto, decisão, ou reclama', false: 'Só responde ou comenta o tema, sem pedir decisão nem reclamar' },
    },
    quem_e: {
      type: 'noul',
      instructions: 'O cliente pergunta quem está falando, se é um robô, uma pessoa ou um assistente?',
    },
  };
  itens.forEach((item, i) => {
    q[`item_${i}`] = {
      type: 'noul',
      instructions: { pergunta: 'Somando todas as mensagens do cliente neste assunto, este ponto da pergunta está resolvido? Conta como resolvido quando o cliente respondeu o ponto ou quando a resposta dele torna o ponto desnecessário (ex.: disse que não vai ter recesso, então as datas do recesso não se aplicam).', ponto: item },
      criteria: { true: 'O cliente respondeu o ponto (sim, não, valor, data, escolha) ou a resposta dele já torna o ponto desnecessário', false: 'O ponto ainda faz sentido e o cliente não falou dele, ou ficou vago' },
    };
  });
  return q;
}

export function lerNotas(r: ResultadoJev, n: number): Notas {
  const rel = r.answers.relacao?.choice as Relacao | undefined;
  return {
    relacao: rel && rel in RELACOES ? rel : 'outro_assunto',
    itens: Array.from({ length: n }, (_, i) => probabilidadeNoul(r.answers[`item_${i}`]) ?? 0),
    humano: probabilidadeNoul(r.answers.humano) ?? 0,
    quem_e: probabilidadeNoul(r.answers.quem_e) ?? 0,
  };
}

const dentro = (x: number) => x >= FAIXA_DE_DUVIDA[0] && x <= FAIXA_DE_DUVIDA[1];
/** Alguma nota que decide ficou perto do corte: vale pedir mais duas e usar a mediana. */
export const precisaDeMediana = (n: Notas) => n.itens.some(dentro) || dentro(n.humano) || dentro(n.quem_e);

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
export function combinarNotas(lista: Notas[]): Notas {
  const conta = new Map<Relacao, number>();
  for (const n of lista) conta.set(n.relacao, (conta.get(n.relacao) ?? 0) + 1);
  const relacao = [...conta.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    relacao,
    itens: lista[0].itens.map((_, i) => mediana(lista.map((n) => n.itens[i]))),
    humano: mediana(lista.map((n) => n.humano)),
    quem_e: mediana(lista.map((n) => n.quem_e)),
  };
}

export function decidir(
  a: { o_que_conta: string[]; pode_perguntar_de_volta: boolean; perguntou_de_volta: boolean; envios_ao_cliente: number },
  n: Notas,
): { acao: Acao; item?: string; faltam: string[] } {
  const faltam = a.o_que_conta.filter((_, i) => (n.itens[i] ?? 0) < CORTE);
  const cobriuAlgum = faltam.length < a.o_que_conta.length;
  if (n.humano >= CORTE || n.relacao === 'pergunta_ao_assistente') return { acao: 'humano', faltam };
  if (faltam.length === 0) return { acao: 'fechar', faltam };
  if (n.quem_e >= CORTE) return { acao: 'quem_e', faltam };
  const respondeu = (n.relacao === 'responde' || n.relacao === 'responde_parte') && cobriuAlgum;
  if (!respondeu) return { acao: 'esperar', faltam };
  // Precisa sobrar espaço para a de volta E para o fechamento depois dela.
  const cabeDeVolta = a.pode_perguntar_de_volta && !a.perguntou_de_volta && a.envios_ao_cliente + 2 <= MAXIMO_AO_CLIENTE;
  return cabeDeVolta ? { acao: 'de_volta', item: faltam[0], faltam } : { acao: 'fechar_parcial', faltam };
}

/** O texto efetivo de uma mensagem ouvida (áudio pela transcrição, imagem pela descrição). */
export function conteudoDe(m: { tipo: string | null; texto: string | null; transcricao: string | null; transcricao_status: string | null; descricao_midia: string | null }): string {
  const partes: string[] = [];
  if (m.tipo === 'audio') partes.push(m.transcricao_status === 'ok' && m.transcricao ? `[áudio] ${m.transcricao}` : '[áudio sem transcrição]');
  else if (m.texto) partes.push(m.texto);
  if (m.descricao_midia) partes.push(`[${m.tipo ?? 'mídia'}: ${m.descricao_midia}]`);
  if (!partes.length && m.tipo && m.tipo !== 'texto') partes.push(`[${m.tipo} sem legenda]`);
  return partes.join(' ').slice(0, 2000);
}
