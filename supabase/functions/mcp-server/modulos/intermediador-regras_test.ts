import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  combinarNotas,
  decidir,
  emHorario,
  escolherPessoa,
  type Notas,
  ouvida,
  perguntaProibida,
  perguntasAoJev,
  textoDeVolta,
  textoLembrete,
  textoPergunta,
} from './intermediador-regras.ts';

const SP = (iso: string) => Date.parse(iso); // horários escritos já em UTC (SP = UTC-3)

Deno.test('textoPergunta: menciona pelo número no grupo e pelo nome na prévia', () => {
  const t = textoPergunta({ numero: '554799990000', nome: 'Carla Souza', tema: 'horário de fim de ano', pergunta: 'Vocês abrem dia 24 e 31?' });
  assert(t.texto.startsWith('Oi, @554799990000! Tudo bem?'));
  assert(t.texto.includes('*horário de fim de ano*'));
  assert(t.texto.includes('\n\nVocês abrem dia 24 e 31?\n\n'));
  assert(t.texto.endsWith('Pode responder por aqui mesmo, em texto ou áudio. 🙂'));
  assert(t.texto_previa.startsWith('Oi, @Carla! Tudo bem?'));
  assertEquals(t.mencoes, ['554799990000@s.whatsapp.net']);
  assert(!t.texto.includes('—'));
});

Deno.test('textoDeVolta e lembrete também marcam a pessoa', () => {
  const v = textoDeVolta({ numero: '554799990000', nome: null, item: 'o horário do dia 24' });
  assertEquals(v.texto, 'Obrigado, @554799990000! Só faltou uma coisa: o horário do dia 24?');
  assertEquals(v.texto_previa, 'Obrigado, @pessoa marcada! Só faltou uma coisa: o horário do dia 24?');
  const l = textoLembrete({ numero: '554799990000', nome: 'Rui', tema: 'fotos da loja' });
  assert(l.texto.includes('@554799990000') && l.texto.includes('*fotos da loja*'));
});

Deno.test('perguntaProibida: termo interno, cobrança e travessão não saem; preço de produto pode', () => {
  assertEquals(perguntaProibida('Qual o preço do kit para a arte?'), null);
  assertEquals(perguntaProibida('O Hermes precisa saber o horário'), 'termo_interno');
  assertEquals(perguntaProibida('Podemos mandar o boleto da mensalidade?'), 'assunto_do_almir');
  assertEquals(perguntaProibida('Confirma o horário — por favor?'), 'travessao');
  assertEquals(perguntaProibida('Dá uma olhada em https://x.y'), 'link');
});

Deno.test('ouvida: só cliente marcado ou quem citou a nossa mensagem; agência e bot nunca', () => {
  const a = { marcar_numero: '554799990000' };
  const nossos = new Set(['3EB0AAA']);
  assertEquals(ouvida({ papel: 'cliente_equipe', remetente: '554799990000', resposta_a: null }, a, nossos), 'marcada');
  assertEquals(ouvida({ papel: 'cliente_equipe', remetente: '554711112222', resposta_a: '3EB0AAA' }, a, nossos), 'citou');
  assertEquals(ouvida({ papel: 'cliente_equipe', remetente: '554711112222', resposta_a: null }, a, nossos), null);
  assertEquals(ouvida({ papel: 'agencia', remetente: '554799990000', resposta_a: '3EB0AAA' }, a, nossos), null);
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
  assertEquals(decidir(base, notas({ relacao: 'pergunta_ao_assistente', itens: [0.1, 0.1, 0.1], humano: 0.3 })).acao, 'humano');
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
