import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  combinarNotas,
  decidir,
  emHorario,
  escolherPessoa,
  escolherPessoas,
  type Notas,
  ouvida,
  perguntaProibida,
  perguntasAoJev,
} from './intermediador-regras.ts';

const SP = (iso: string) => Date.parse(iso); // horários escritos já em UTC (SP = UTC-3)

Deno.test('perguntaProibida: termo interno, cobrança e travessão não saem; preço de produto pode', () => {
  assertEquals(perguntaProibida('Qual o preço do kit para a arte?'), null);
  assertEquals(perguntaProibida('O Hermes precisa saber o horário'), 'termo_interno');
  assertEquals(perguntaProibida('Podemos mandar o boleto da mensalidade?'), 'assunto_do_almir');
  assertEquals(perguntaProibida('Confirma o horário — por favor?'), 'travessao');
  assertEquals(perguntaProibida('Dá uma olhada em https://x.y'), 'link');
});

Deno.test('ouvida: cliente marcado, quem citou, outra pessoa do cliente ou o Almir; bot nunca', () => {
  const a = { marcar_numero: '554799990000' };
  const nossos = new Set(['3EB0AAA']);
  assertEquals(ouvida({ papel: 'cliente_equipe', remetente: '554799990000', resposta_a: null }, a, nossos), 'marcada');
  assertEquals(ouvida({ papel: 'cliente_equipe', remetente: '554711112222', resposta_a: '3EB0AAA' }, a, nossos), 'citou');
  assertEquals(ouvida({ papel: 'cliente_equipe', remetente: '554711112222', resposta_a: null }, a, nossos), 'outra_pessoa');
  assertEquals(ouvida({ papel: 'agencia', remetente: '554799990000', resposta_a: '3EB0AAA' }, a, nossos), 'agencia'); // o Almir também resolve
  assertEquals(ouvida({ papel: 'bot', remetente: '554197483429', resposta_a: null }, a, nossos), null);
});

Deno.test('emHorario: pergunta e lembrete seg a sex 8h-19h; resposta todo dia 8h-21h (São Paulo)', () => {
  assert(emHorario('pergunta', SP('2026-11-25T11:00:00Z'))); // qua 8h
  assert(!emHorario('pergunta', SP('2026-11-25T10:59:00Z'))); // qua 7h59
  assert(!emHorario('pergunta', SP('2026-11-25T22:00:00Z'))); // qua 19h
  assert(!emHorario('lembrete', SP('2026-11-28T14:00:00Z'))); // sáb
  assert(emHorario('fechamento', SP('2026-11-28T14:00:00Z')));
  assert(!emHorario('fechamento', SP('2026-11-29T00:30:00Z'))); // sáb 21h30
});

Deno.test('escolherPessoa: "dono"/vazio = quem mais fala; nome casa sem acento; nome desconhecido = null', () => {
  const pessoas = [
    { numero: '554711110000', nome: 'João Pereira', mensagens: 40 },
    { numero: '554722220000', nome: 'Mônica', mensagens: 10 },
  ];
  assertEquals(escolherPessoa(pessoas, 'dono')?.numero, '554711110000');
  assertEquals(escolherPessoa(pessoas, '')?.numero, '554711110000');
  assertEquals(escolherPessoa(pessoas, 'monica')?.numero, '554722220000');
  assertEquals(escolherPessoa(pessoas, 'Fulano'), null);
  assertEquals(escolherPessoa([], 'dono'), null);
});

Deno.test('perguntasAoJev: uma Choice, um Noul por item, humano e quem_e', () => {
  const q = perguntasAoJev(['abre dia 24', 'horário']);
  assertEquals(Object.keys(q).sort(), ['humano', 'item_0', 'item_1', 'quem_e', 'relacao']);
  assertEquals(q.relacao.type, 'choice');
  assertEquals(q.item_0.type, 'noul');
});

const base = { o_que_conta: ['abre dia 24', 'abre dia 31', 'horário'], pode_perguntar_de_volta: true, perguntou_de_volta: false, envios_ao_cliente: 1 };
const notas = (n: Partial<Notas>): Notas => ({ relacao: 'responde', itens: [0.9, 0.9, 0.9], humano: 0.05, quem_e: 0.02, ...n });

Deno.test('decidir: tudo coberto fecha; faltou um item pergunta de volta só ele', () => {
  assertEquals(decidir(base, notas({})).acao, 'fechar');
  const d = decidir(base, notas({ relacao: 'responde_parte', itens: [0.9, 0.85, 0.3] }));
  assertEquals(d.acao, 'de_volta');
  assertEquals(d.item, 'horário');
});

Deno.test('decidir: sem pergunta de volta disponível fecha em parte', () => {
  assertEquals(decidir({ ...base, perguntou_de_volta: true }, notas({ relacao: 'responde_parte', itens: [0.9, 0.2, 0.2] })).acao, 'fechar_parcial');
  assertEquals(decidir({ ...base, pode_perguntar_de_volta: false }, notas({ relacao: 'responde_parte', itens: [0.9, 0.2, 0.2] })).acao, 'fechar_parcial');
  // Já foram 2 mensagens (pergunta + lembrete): a de volta não cabe, só o fechamento.
  assertEquals(decidir({ ...base, envios_ao_cliente: 2 }, notas({ relacao: 'responde_parte', itens: [0.9, 0.2, 0.2] })).acao, 'fechar_parcial');
});

Deno.test('decidir: humano tem prioridade; quem_e responde; vai ver, reação e outro assunto esperam', () => {
  assertEquals(decidir(base, notas({ humano: 0.8 })).acao, 'humano');
  assertEquals(decidir(base, notas({ relacao: 'pergunta_ao_assistente', itens: [0.1, 0.1, 0.1], humano: 0.3 })).acao, 'responder');
  assertEquals(decidir(base, notas({ relacao: 'pergunta_ao_assistente', itens: [0.1, 0.1, 0.1], humano: 0.8 })).acao, 'humano');
  assertEquals(decidir(base, notas({ relacao: 'outro_assunto', itens: [0.1, 0.1, 0.1], quem_e: 0.9 })).acao, 'quem_e');
  for (const relacao of ['vai_ver', 'reacao', 'outro_assunto'] as const) {
    assertEquals(decidir(base, notas({ relacao, itens: [0.1, 0.1, 0.1] })).acao, 'esperar');
  }
});

Deno.test('combinarNotas: mediana dos nouls e maioria da choice', () => {
  const c = combinarNotas([
    notas({ itens: [0.55, 0.9, 0.9], humano: 0.1, relacao: 'responde' }),
    notas({ itens: [0.65, 0.9, 0.8], humano: 0.2, relacao: 'responde_parte' }),
    notas({ itens: [0.62, 0.7, 0.9], humano: 0.0, relacao: 'responde' }),
  ]);
  assertEquals(c.itens, [0.62, 0.9, 0.9]);
  assertEquals(c.humano, 0.1);
  assertEquals(c.relacao, 'responde');
});

Deno.test('escolherPessoas: nome = essa pessoa; todos = todo mundo; sem nada = quem responde quase sempre ou todos', () => {
  const dois = [{ numero: '554711110000', nome: 'Andreus', mensagens: 20 }, { numero: '554722220000', nome: 'Marcos', mensagens: 11 }];
  assertEquals(escolherPessoas(dois, 'Marcos').map((p) => p.nome), ['Marcos']);
  assertEquals(escolherPessoas(dois, 'todos').map((p) => p.nome), ['Andreus', 'Marcos']);
  assertEquals(escolherPessoas(dois, '').map((p) => p.nome), ['Andreus', 'Marcos']); // 20 de 31 não chega a 80%
  assertEquals(escolherPessoas(dois, 'dono').map((p) => p.nome), ['Andreus']);
  const quaseSo = [{ numero: '554711110000', nome: 'Thainá', mensagens: 95 }, { numero: '554722220000', nome: 'Ju', mensagens: 4 }];
  assertEquals(escolherPessoas(quaseSo, undefined).map((p) => p.nome), ['Thainá']);
  assertEquals(escolherPessoas(dois, 'Fulano'), []);
  assertEquals(escolherPessoas([], 'todos'), []);
});

Deno.test('ouvida: com várias pessoas marcadas, qualquer uma delas é ouvida', () => {
  const a = { marcar_numero: '554711110000', marcar_numeros: ['554711110000', '554722220000'] };
  assertEquals(ouvida({ papel: 'cliente_equipe', remetente: '554722220000', resposta_a: null }, a, new Set()), 'marcada');
  assertEquals(ouvida({ papel: 'cliente_equipe', remetente: '554733330000', resposta_a: null }, a, new Set()), 'outra_pessoa');
});

Deno.test('ponto que a resposta torna desnecessário conta como resolvido (caso real SKC, 25/11)', () => {
  const q = perguntasAoJev(['tem recesso ou não', 'data de início e de volta']);
  assert(JSON.stringify(q.item_1).includes('torna o ponto desnecessário'));
});

Deno.test('decidir: "é robô?" lido como pergunta ao assistente ainda responde quem é; joinha só fecha com nota alta', () => {
  const b = { o_que_conta: ['mandou as fotos'], pode_perguntar_de_volta: true, perguntou_de_volta: false, envios_ao_cliente: 1 };
  assertEquals(decidir(b, { relacao: 'pergunta_ao_assistente', itens: [0.04], humano: 0.12, quem_e: 0.95 }).acao, 'quem_e');
  assertEquals(decidir(b, { relacao: 'reacao', itens: [0.6], humano: 0.03, quem_e: 0.02 }).acao, 'esperar');
  assertEquals(decidir(b, { relacao: 'reacao', itens: [0.85], humano: 0.03, quem_e: 0.02 }).acao, 'fechar');
  assertEquals(decidir(b, { relacao: 'responde', itens: [0.6], humano: 0.03, quem_e: 0.02 }).acao, 'fechar');
});
