/**
 * MCP 2.39.1 (25/11/2026): a mensagem do Intermediador é escrita na hora, no contexto do cliente e da conversa.
 *
 * Pedido do Almir: "a mensagem tem que fluir natural com base no contexto e assunto", sem modelo pronto, sem
 * explicar o óbvio ("pode responder em texto ou áudio") e sem errar o ramo do cliente (a Verzelo presta serviço,
 * não é loja). Aqui ficam o pedido ao escritor (sistema + usuário), a limpeza do texto e as perguntas do Jev que
 * conferem o texto antes de sair. Quem escreve é o motor do painel (escreverComModeloDaCentral); quem decide se sai
 * é o código, com a nota do Jev.
 */

import type { PerguntaJev } from '../../_shared/jev.ts';
import { perguntaProibida } from './intermediador-regras.ts';

/** O escritor põe este marcador onde vai a menção; o código troca por @numero (grupo) ou @Nome (prévia). */
export const MARCA = '@{pessoa}';
export type TipoDeTexto = 'pergunta' | 'de_volta' | 'lembrete' | 'fechamento' | 'humano' | 'quem_e';
export const COM_MENCAO: ReadonlySet<TipoDeTexto> = new Set(['pergunta', 'de_volta', 'lembrete']);

export interface PedidoDoTexto {
  tipo: TipoDeTexto;
  cliente: string;
  primeiro_nome: string | null;
  tema: string;
  pergunta: string;
  /** Para que o time precisa do dado (opcional). */
  para_que?: string | null;
  o_que_conta: string[];
  /** Ponto que faltou (só na de volta). */
  falta?: string | null;
  /** O que a pessoa já respondeu neste assunto (texto, transcrição, descrição). */
  ja_disse: string[];
  /** As últimas mensagens do grupo, mais antigas primeiro, já com quem falou. */
  conversa_recente: string[];
  /** Dossiê do cliente, recortado. */
  contexto: string | null;
  /** Na segunda tentativa: o que estava errado na primeira. */
  corrigir?: string | null;
}

const O_QUE_ESCREVER: Record<TipoDeTexto, string> = {
  pergunta: 'Escreva a mensagem que abre este assunto: chame a pessoa e faça a pergunta, cobrindo todos os pontos pedidos, do jeito que alguém da agência que já conversa com ela perguntaria. Pode reescrever a pergunta com as suas palavras, adaptada ao ramo do cliente.',
  de_volta: 'A pessoa já respondeu uma parte. Agradeça de leve pelo que ela disse (sem repetir tudo) e pergunte só o ponto que faltou.',
  lembrete: 'A pessoa ainda não respondeu a pergunta feita. Escreva um lembrete leve e curto, sem cobrar, retomando o assunto em poucas palavras.',
  fechamento: 'A pessoa respondeu tudo. Feche agradecendo, curto, mostrando que entendeu o que ela disse (uma referência rápida, sem repetir a resposta inteira). Não faça pergunta nova e não diga o que o time vai fazer com a resposta (no máximo "anotado" ou "já passei pro time").',
  humano: 'A pessoa pediu algo que só o Almir pode responder (preço, prazo, decisão) ou reclamou. Responda curto, com respeito, dizendo que o Almir vai responder por aqui. Não responda o pedido, não prometa nada e não peça desculpas exageradas.',
  quem_e: 'A pessoa perguntou quem está falando. Diga, curto e simpático, que é o assistente da Aceleriq que ajuda o time a organizar essas confirmações e que o Almir está no grupo também. Não diga que é uma pessoa e não use a palavra robô.',
};

export const SISTEMA_DO_INTERMEDIADOR = [
  'Você escreve UMA mensagem de WhatsApp que o assistente da Aceleriq (agência de marketing) manda no grupo de um cliente.',
  'Regras:',
  '1. Soa como gente da agência que já conversa com o cliente todo dia: natural, direto, educado, leve. Português do Brasil falado, sem formalidade de e-mail.',
  '2. Continue a conversa: olhe as mensagens recentes do grupo e fale do jeito que o Almir fala ali (tom, intimidade, expressões). Não repita cumprimento se já cumprimentaram hoje; se a conversa já está no meio, entre no assunto sem cerimônia.',
  '2b. Quando abrir um assunto, diga em poucas palavras para que é (o "para quê" do pedido; sem ele, pelo assunto, sem inventar). Ninguém pergunta do nada.',
  '3. Respeite o ramo do cliente pelo contexto (prestador de serviço não é loja; não invente produto, endereço, horário ou fato que não esteja no contexto).',
  `4. Quando for chamar a pessoa, escreva exatamente ${MARCA} (o sistema troca pelo nome). Use ${MARCA} uma vez só, perto do começo.`,
  '5. Curta: de 1 a 3 frases. Nada de lista, título, negrito ou assinatura. No máximo um emoji, e só se couber.',
  '6. Nunca explique como responder (texto, áudio, "por aqui mesmo"): é óbvio.',
  '7. Nunca prometa preço, valor, prazo de entrega, desconto ou resultado, nem diga o que o time vai fazer depois (ajustar, mudar, investir). Nunca fale de cobrança, verba, pagamento ou contrato.',
  '8. Nunca cite ferramenta, sistema, agente, IA, painel ou nome de pessoa da equipe além do Almir.',
  '9. Sem travessão. Responda só com o texto da mensagem, sem aspas e sem explicação.',
].join('\n');

export function pedidoAoEscritor(p: PedidoDoTexto): { sistema: string; usuario: string } {
  const partes = [
    `Cliente: ${p.cliente}`,
    p.contexto ? `Contexto do cliente (dossiê, só para entender o ramo e o momento; não cite):\n${p.contexto}` : 'Contexto do cliente: sem dossiê.',
    p.conversa_recente.length ? `Últimas mensagens do grupo (mais antigas primeiro):\n${p.conversa_recente.join('\n')}` : 'Últimas mensagens do grupo: nenhuma recente.',
    `Pessoa marcada: ${p.primeiro_nome ?? 'sem nome conhecido'}`,
    `Assunto: ${p.tema}`,
    `O que o time precisa saber: ${p.pergunta}`,
    p.para_que ? `Para quê: ${p.para_que}` : '',
    `Pontos que a resposta precisa trazer: ${p.o_que_conta.join('; ')}`,
    p.ja_disse.length ? `O que a pessoa já disse sobre isso:\n${p.ja_disse.map((t) => `- ${t}`).join('\n')}` : '',
    p.falta ? `Ponto que faltou: ${p.falta}` : '',
    `Tarefa: ${O_QUE_ESCREVER[p.tipo]}`,
    p.corrigir ? `A versão anterior foi recusada por isto, corrija: ${p.corrigir}` : '',
  ].filter(Boolean);
  return { sistema: SISTEMA_DO_INTERMEDIADOR, usuario: partes.join('\n\n') };
}

const EXPLICA_COMO_RESPONDER = /(texto ou (em )?[áa]udio|[áa]udio ou (em )?texto|por aqui mesmo|pode responder (aqui|por aqui))/i;

/** Limpa o que o escritor devolveu e diz o que impede de sair (null = pode seguir para o Jev). */
export function limparTexto(bruto: string, tipo: TipoDeTexto): { texto: string; problema: string | null } {
  let t = String(bruto ?? '').trim().replace(/^["“”']+|["“”']+$/g, '').trim();
  t = t.replace(/\s*[—–]\s*/g, ', ').replace(/\*\*/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  // Variações do marcador que o modelo às vezes escreve.
  t = t.replace(/@\s*\{\s*pessoa\s*\}|@pessoa\b|\{pessoa\}/gi, MARCA);
  if (COM_MENCAO.has(tipo)) {
    const vezes = t.split(MARCA).length - 1;
    if (vezes === 0) t = `${MARCA}, ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
    else if (vezes > 1) {
      const i = t.indexOf(MARCA) + MARCA.length;
      t = t.slice(0, i) + t.slice(i).split(MARCA).join('');
    }
    t = t.replace(/ {2,}/g, ' ');
  } else {
    t = t.split(MARCA).join('').replace(/^[,\s]+/, '').replace(/\s{2,}/g, ' ').trim();
  }
  // Pontuação: sem espaço antes de vírgula ou ponto, maiúscula depois de ponto final, exclamação ou interrogação.
  t = t.replace(/\s+([,.!?;:])/g, '$1').replace(/([.!?]\s+)(\p{Ll})/gu, (_m, sep: string, letra: string) => sep + letra.toUpperCase());
  if (t.length < 12) return { texto: t, problema: 'curto demais' };
  if (t.length > 600) return { texto: t, problema: 'longo demais (máximo 3 frases curtas)' };
  if (EXPLICA_COMO_RESPONDER.test(t)) return { texto: t, problema: 'explicou como responder (texto, áudio, por aqui); tire isso' };
  const proibido = perguntaProibida(t);
  if (proibido === 'termo_interno') return { texto: t, problema: 'citou termo interno, ferramenta ou agente' };
  if (proibido === 'assunto_do_almir' && tipo !== 'humano') return { texto: t, problema: 'falou de cobrança, pagamento, contrato ou desconto' };
  if (proibido === 'link') return { texto: t, problema: 'pôs link' };
  if (/\?/.test(t) && tipo === 'fechamento') return { texto: t, problema: 'o fechamento não pode fazer pergunta' };
  return { texto: t, problema: null };
}

/** O Jev confere o texto escrito: cobre os pontos, não promete, não inventa, soa natural. */
export function perguntasDoTexto(tipo: TipoDeTexto, itens: string[], falta?: string | null): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {
    promete: {
      type: 'noul',
      instructions: 'A mensagem em "mensagem" promete preço, valor, prazo, desconto, resultado ou uma ação do time (ajustar, mudar, investir, verba), ou afirma algo sobre o cliente que não está em "contexto" nem na conversa?',
      criteria: { true: 'Promete algo, diz o que o time vai fazer, ou afirma fato que não está no contexto', false: 'Só pergunta, agradece ou avisa, sem prometer nem inventar' },
    },
    natural: {
      type: 'noul',
      instructions: 'A mensagem soa como uma pessoa da agência falando naturalmente com o cliente no WhatsApp, em continuidade com a conversa recente (não parece texto pronto, formulário ou robô)?',
    },
  };
  const pontos = tipo === 'pergunta' ? itens : tipo === 'de_volta' && falta ? [falta] : [];
  pontos.forEach((item, i) => {
    q[`cobre_${i}`] = { type: 'noul', instructions: { pergunta: 'A mensagem pede claramente este ponto à pessoa?', ponto: item } };
  });
  return q;
}

export const CORTE_DO_TEXTO = { promete: 0.4, natural: 0.6, cobre: 0.6 } as const;

/** Lê as notas do Jev sobre o texto. Devolve o problema (para a segunda tentativa) ou null. */
export function problemaDoTexto(notas: Record<string, number>): string | null {
  if ((notas.promete ?? 1) >= CORTE_DO_TEXTO.promete) return 'prometeu algo ou afirmou fato que não está no contexto';
  const falta = Object.entries(notas).filter(([k, v]) => k.startsWith('cobre_') && v < CORTE_DO_TEXTO.cobre);
  if (falta.length) return 'não perguntou todos os pontos pedidos';
  if ((notas.natural ?? 0) < CORTE_DO_TEXTO.natural) return 'ficou com cara de texto pronto; escreva como gente, continuando a conversa';
  return null;
}

/** Troca o marcador pela menção. */
export function comPessoa(texto: string, numero: string, nome: string | null) {
  const primeiro = String(nome ?? '').trim().split(/\s+/)[0];
  return {
    texto: texto.split(MARCA).join(`@${numero}`),
    texto_previa: texto.split(MARCA).join(`@${primeiro && !/^\+?\d+$/.test(primeiro) ? primeiro : 'pessoa marcada'}`),
    mencoes: texto.includes(MARCA) ? [`${numero}@s.whatsapp.net`] : [],
  };
}
