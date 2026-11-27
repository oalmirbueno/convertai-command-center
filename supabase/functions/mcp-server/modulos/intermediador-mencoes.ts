/**
 * MCP 2.43.0 (27/11/2026): o assistente entende quando é marcado no grupo.
 *
 * Pedido do Almir: "ele entender quando eu marco ou o cliente marca e poder falar com o cliente e atualizar a base
 * conforme marcação". Casos reais da Casa dos Assados: "48991668819 @assistente esse é o número ok já atualiza na
 * base" e "Ótimo deixa com a gente @assistente já alinhe isso" (logo depois de a cliente pedir os valores no post da
 * Black e reclamar das imagens).
 *
 * O Jev decide o que a marcação pede; o planejador (motor de escrita do painel) monta o plano em JSON; o Jev confere
 * cada fato contra a conversa antes de entrar na base; o texto ao grupo passa pela mesma limpeza e conferência das
 * outras mensagens. Regras puras aqui; banco e rede em intermediador.ts.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { PerguntaJev, ResultadoJev } from '../../_shared/jev.ts';
import { probabilidadeNoul } from '../../_shared/jev.ts';

/** Como o 3429 aparece numa menção: telefone ou id interno do WhatsApp (LID, lido da sessão do leitor em 27/11). */
export const MARCAS_DO_ASSISTENTE = ['554197483429', '251990663757916'] as const;
/** Resposta no grupo só para marcação recente; anotar na base vale para marcação de até 3 dias. */
export const JANELA_DE_RESPOSTA_MS = 2 * 3_600_000;
export const JANELA_DE_ANOTAR_MS = 3 * 86_400_000;
/** Espera quem marcou terminar de escrever (às vezes a marcação vem antes do resto). */
export const ESPERA_DEPOIS_DA_MARCACAO_MS = 90_000;
export const CORTE_DO_FATO = 0.7;

export type Intencao = 'anotar' | 'alinhar' | 'perguntar' | 'responder' | 'nada';

export function marcaOAssistente(texto: string | null | undefined): boolean {
  const t = String(texto ?? '');
  return MARCAS_DO_ASSISTENTE.some((m) => t.includes(`@${m}`));
}
export const semMarca = (texto: string | null | undefined) =>
  String(texto ?? '').replace(new RegExp(`@(${MARCAS_DO_ASSISTENTE.join('|')})`, 'g'), '@assistente').replace(/@\d{10,16}/g, '@alguém');

export const INTENCOES_DA_AGENCIA: Record<Intencao, string> = {
  anotar: 'O Almir pede ao assistente para anotar ou atualizar na base um dado (telefone, endereço, horário, preferência, informação do cliente).',
  alinhar: 'O Almir pede ao assistente para cuidar de um pedido, ajuste ou reclamação que o cliente acabou de fazer (alinhar, resolver, passar pro time, ajustar).',
  perguntar: 'O Almir pede ao assistente para perguntar, confirmar ou pedir algo ao cliente.',
  responder: 'O Almir pede ao assistente para responder, explicar ou dar um retorno ao cliente sobre o que já está na conversa.',
  nada: 'Marcação sem pedido: agradecimento, brincadeira, apresentação, ou não dá para saber o que fazer.',
};
export const INTENCOES_DO_CLIENTE: Partial<Record<Intencao, string>> = {
  responder: 'O cliente fala com o assistente: pergunta, pede, comenta ou responde algo e espera retorno.',
  anotar: 'O cliente passa ao assistente um dado ou preferência para guardar, sem esperar outra coisa além de um ok.',
  nada: 'Marcação sem pedido: agradecimento, emoji, brincadeira.',
};

export function perguntasDaMencao(daAgencia: boolean): Record<string, PerguntaJev> {
  return {
    intencao: {
      type: 'choice',
      instructions: 'Alguém marcou o assistente da agência na mensagem "mensagem_que_marcou" (o assistente aparece como @assistente). Leia "conversa" para entender a que ela se refere. O que essa marcação pede ao assistente?',
      criteria: daAgencia ? INTENCOES_DA_AGENCIA : (INTENCOES_DO_CLIENTE as Record<string, string>),
    },
    humano: {
      type: 'noul',
      instructions: 'O que foi pedido envolve preço, valor, desconto, prazo de entrega, contrato, cobrança ou uma decisão que só o dono da agência pode tomar, ou é uma reclamação?',
    },
  };
}

export function lerIntencao(r: ResultadoJev, daAgencia: boolean): { intencao: Intencao; confianca: number; humano: number } {
  const validas = Object.keys(daAgencia ? INTENCOES_DA_AGENCIA : INTENCOES_DO_CLIENTE);
  const c = r.answers.intencao?.choice;
  return {
    intencao: c && validas.includes(c) ? c as Intencao : 'nada',
    confianca: r.answers.intencao?.confidence ?? 0,
    humano: probabilidadeNoul(r.answers.humano) ?? 0,
  };
}

const AREAS = ['geral', 'calendario', 'campanha', 'arte', 'foto', 'ads', 'copy', 'conta'] as const;
const CATEGORIAS = ['preferencia', 'evitar', 'ajuste', 'aprendizado'] as const;

export const planoSchema = z.object({
  fatos: z.array(z.object({
    texto: z.string().trim().min(5).max(400),
    area: z.enum(AREAS).catch('geral'),
    categoria: z.enum(CATEGORIAS).catch('aprendizado'),
  })).max(4).catch([]),
  resposta: z.string().trim().max(600).nullable().catch(null),
  recado_ao_time: z.string().trim().max(800).nullable().catch(null),
  pergunta: z.object({
    tema: z.string().trim().min(3).max(120),
    pergunta: z.string().trim().min(8).max(400),
    para_que: z.string().trim().min(3).max(160).nullable().optional(),
    o_que_conta: z.array(z.string().trim().min(2).max(120)).min(1).max(4),
    marcar: z.string().trim().max(80).nullable().optional(),
  }).nullable().catch(null),
});
export type Plano = z.infer<typeof planoSchema>;

const O_QUE_FAZER: Record<Intencao, string> = {
  anotar: 'Monte em "fatos" o que deve entrar na base do cliente (só o que está escrito na conversa, como instrução prática: "Telefone e WhatsApp da Casa: (48) 99166-8819"). Em "resposta", um ok curto e natural no grupo (ex.: "Anotado! ✅"). Sem "pergunta" e sem "recado_ao_time".',
  alinhar: 'O cliente pediu algo e o Almir passou para você cuidar. Em "fatos", o que o cliente pediu e que vale para os próximos trabalhos (preferência, ajuste, o que evitar). Em "recado_ao_time", o que o time precisa fazer, claro e com o pedido do cliente nas palavras dele. Em "resposta", uma mensagem curta e natural para o cliente dizendo que já passou pro time, sem prometer prazo nem resultado.',
  perguntar: 'O Almir quer que você pergunte algo ao cliente. Preencha "pergunta" (tema, a pergunta do jeito que o time precisa saber, para_que, os pontos em o_que_conta e, se o Almir disse quem, "marcar" com o primeiro nome). Deixe "resposta" nula: a pergunta sai pelo fluxo normal.',
  responder: 'Escreva em "resposta" o retorno para a pessoa, no contexto da conversa, usando só o que está na conversa e no contexto do cliente. Se não houver como responder sem inventar, diga que o Almir já vai responder. Se a pessoa passou um dado ou preferência, ponha em "fatos".',
  nada: 'Nada a fazer: tudo vazio.',
};

export const SISTEMA_DO_PLANEJADOR = [
  'Você é o assistente da Aceleriq (agência de marketing) no grupo de WhatsApp de um cliente. Alguém marcou você.',
  'Responda SÓ com um JSON neste formato, sem texto antes ou depois:',
  '{"fatos":[{"texto":"...","area":"geral|calendario|campanha|arte|foto|ads|copy|conta","categoria":"preferencia|evitar|ajuste|aprendizado"}],"resposta":"..." ou null,"recado_ao_time":"..." ou null,"pergunta":{"tema":"...","pergunta":"...","para_que":"...","o_que_conta":["..."],"marcar":"..."} ou null}',
  'Regras da "resposta" (vai para o grupo): soa como gente da agência, curta (1 a 3 frases), no tom da conversa; se ficar mais natural, quebre em até 3 mensagens com uma linha só com ///; sem travessão; não marque ninguém; não prometa preço, prazo, desconto nem resultado; não cite ferramenta, sistema, IA ou agente; não presuma gênero.',
  'Regras dos "fatos": só o que alguém disse na conversa, nunca palpite; nada de senha, cobrança ou valor de mensalidade.',
].join('\n');

export function pedidoAoPlanejador(p: {
  intencao: Intencao; cliente: string; contexto: string | null; conversa: string[]; quem_marcou: string; mensagem: string; pode_responder: boolean;
}) {
  const usuario = [
    `Cliente: ${p.cliente}`,
    p.contexto ? `Contexto do cliente (dossiê, não cite):\n${p.contexto}` : '',
    `Conversa recente do grupo (mais antigas primeiro; você aparece como @assistente):\n${p.conversa.join('\n')}`,
    `Quem marcou: ${p.quem_marcou}`,
    `Mensagem que marcou: ${p.mensagem}`,
    `O que fazer: ${O_QUE_FAZER[p.intencao]}`,
    p.pode_responder ? '' : 'A marcação é antiga: deixe "resposta" nula (não responda no grupo), só registre o que valer.',
  ].filter(Boolean);
  return { sistema: SISTEMA_DO_PLANEJADOR, usuario: usuario.join('\n\n') };
}

/** Lê o JSON do planejador (tolera bloco de código em volta). null quando não dá para confiar. */
export function lerPlano(bruto: string | null | undefined): Plano | null {
  const t = String(bruto ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    const p = planoSchema.safeParse(JSON.parse(t.slice(i, j + 1)));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** Cada fato só entra na base se a conversa disser isso (Noul por fato). */
export function perguntasDosFatos(fatos: { texto: string }[]): Record<string, PerguntaJev> {
  return Object.fromEntries(fatos.map((f, i) => [`fato_${i}`, {
    type: 'noul' as const,
    instructions: { pergunta: 'A conversa (incluindo a mensagem que marcou) diz claramente isto? Conta só o que alguém escreveu ou falou, não suposição.', fato: f.texto },
    criteria: { true: 'Alguém na conversa disse isso', false: 'Ninguém disse isso, ou é suposição' },
  }]));
}
