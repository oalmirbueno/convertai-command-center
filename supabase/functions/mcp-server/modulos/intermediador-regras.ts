/**
 * MCP 2.39.0 (25/11/2026): regras puras do Intermediador dos grupos de cliente.
 *
 * Tudo que decide o que o assistente diz e quando fica aqui, sem banco e sem rede, para ser testado.
 * O texto que vai ao cliente é sempre um destes modelos fixos (nada de texto livre de IA); o julgamento
 * de cada mensagem ouvida é do Jev (Choice + Nouls), e quem transforma as notas em ação é o código.
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

export const TEXTO_FECHAMENTO = 'Perfeito, obrigado! Já passei pro time. 🙌';
export const TEXTO_HUMANO = 'Boa! Vou levar isso pro Almir e ele te responde por aqui.';
export const TEXTO_QUEM_E = 'Sou o assistente da Aceleriq, ajudo o time a organizar essas confirmações. Qualquer coisa, o Almir está por aqui também.';

export type Relacao = 'responde' | 'responde_parte' | 'pergunta_ao_assistente' | 'vai_ver' | 'reacao' | 'outro_assunto';
export interface Notas { relacao: Relacao; itens: number[]; humano: number; quem_e: number }
export type Acao = 'fechar' | 'fechar_parcial' | 'de_volta' | 'humano' | 'quem_e' | 'esperar';

const primeiroNome = (nome: string | null | undefined) => {
  const n = String(nome ?? '').trim().split(/\s+/)[0];
  return n && !/^\+?\d+$/.test(n) ? n : 'pessoa marcada';
};
const jid = (numero: string) => `${numero}@s.whatsapp.net`;

export interface Texto { texto: string; texto_previa: string; mencoes: string[] }

/** No grupo a menção vai pelo número (o WhatsApp mostra o nome do contato); na prévia, pelo nome. */
function comMencao(montar: (quem: string) => string, numero: string, nome: string | null): Texto {
  return { texto: montar(`@${numero}`), texto_previa: montar(`@${primeiroNome(nome)}`), mencoes: [jid(numero)] };
}

export function textoPergunta(p: { numero: string; nome: string | null; tema: string; pergunta: string }): Texto {
  return comMencao((q) => `Oi, ${q}! Tudo bem? Uma dúvida rápida sobre *${p.tema.trim()}*:\n\n${p.pergunta.trim()}\n\nPode responder por aqui mesmo, em texto ou áudio. 🙂`, p.numero, p.nome);
}
export function textoDeVolta(p: { numero: string; nome: string | null; item: string }): Texto {
  return comMencao((q) => `Obrigado, ${q}! Só faltou uma coisa: ${p.item.trim().replace(/[?.!]+$/, '')}?`, p.numero, p.nome);
}
export function textoLembrete(p: { numero: string; nome: string | null; tema: string }): Texto {
  return comMencao((q) => `Oi, ${q}, passando só pra lembrar da dúvida sobre *${p.tema.trim()}* aqui em cima. Quando der! 🙂`, p.numero, p.nome);
}
export const semMencao = (texto: string): Texto => ({ texto, texto_previa: texto, mencoes: [] });

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
  a: { marcar_numero: string },
  nossos: Set<string>,
): 'marcada' | 'citou' | null {
  if (!String(m.papel ?? '').startsWith('cliente')) return null;
  if (m.resposta_a && nossos.has(m.resposta_a)) return 'citou';
  if (m.remetente === a.marcar_numero) return 'marcada';
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
      instructions: { pergunta: 'Somando todas as mensagens do cliente neste assunto, elas deixam claro este ponto da pergunta?', ponto: item },
      criteria: { true: 'O cliente disse isso de forma clara (sim, não, um valor, uma data ou uma escolha)', false: 'O cliente não falou desse ponto ou ficou vago' },
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
