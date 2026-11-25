import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { comPessoa, limparTexto, MARCA, pedidoAoEscritor, perguntasDoTexto, problemaDoTexto } from './intermediador-escrita.ts';

const base = {
  cliente: 'Verzelo Jardins', primeiro_nome: 'Thiélo', tema: 'atendimento no fim de ano',
  pergunta: 'Vocês vão atender nos dias 24 e 31? Até que horas?', o_que_conta: ['atende dia 24', 'atende dia 31', 'horário'],
  ja_disse: [], conversa_recente: ['Almir (agência): Os anúncios estão bons ontem foram 4 mensagens'], contexto: 'Verzelo presta serviço de jardinagem e poda em Curitiba.',
};

Deno.test('pedido ao escritor leva o ramo do cliente, a conversa recente e a regra de não explicar como responder', () => {
  const { sistema, usuario } = pedidoAoEscritor({ ...base, tipo: 'pergunta' });
  assert(sistema.includes('prestador de serviço não é loja'));
  assert(sistema.includes('Nunca explique como responder'));
  assert(sistema.includes(MARCA));
  assert(usuario.includes('jardinagem e poda'));
  assert(usuario.includes('Os anúncios estão bons'));
  assert(usuario.includes('atende dia 24; atende dia 31; horário'));
  assert(!usuario.includes('Ponto que faltou'));
  const volta = pedidoAoEscritor({ ...base, tipo: 'de_volta', falta: 'horário', ja_disse: ['dia 24 sim, dia 31 não'], corrigir: 'ficou com cara de texto pronto' });
  assert(volta.usuario.includes('Ponto que faltou: horário'));
  assert(volta.usuario.includes('dia 24 sim, dia 31 não'));
  assert(volta.usuario.includes('A versão anterior foi recusada por isto, corrija: ficou com cara de texto pronto'));
});

Deno.test('limparTexto: tira aspas e travessão, garante uma menção e recusa "texto ou áudio"', () => {
  assertEquals(limparTexto('"@{pessoa}, vocês atendem dia 24 — e dia 31?"', 'pergunta'), { texto: '@{pessoa}, vocês atendem dia 24, e dia 31?', problema: null });
  assertEquals(limparTexto('Vocês atendem dia 24?', 'pergunta').texto, '@{pessoa}, vocês atendem dia 24?');
  assertEquals(limparTexto('@pessoa oi! @{pessoa} tudo bem?', 'pergunta').texto, '@{pessoa} oi! tudo bem?');
  assert(limparTexto('@{pessoa} atendem dia 24? Pode responder por aqui mesmo, em texto ou áudio.', 'pergunta').problema?.includes('como responder'));
});

Deno.test('limparTexto: fechamento sem menção e sem pergunta; termo interno e cobrança barrados', () => {
  assertEquals(limparTexto('@{pessoa} perfeito, anotado!', 'fechamento'), { texto: 'perfeito, anotado!', problema: null });
  assert(limparTexto('Perfeito! Mais alguma coisa?', 'fechamento').problema?.includes('pergunta'));
  assert(limparTexto('@{pessoa} o Hermes precisa saber se vocês atendem dia 24', 'pergunta').problema?.includes('termo interno'));
  assert(limparTexto('@{pessoa} e o boleto, conseguiu pagar?', 'pergunta').problema?.includes('cobrança'));
  assertEquals(limparTexto('Boa, o Almir te responde sobre o pagamento por aqui.', 'humano').problema, null);
});

Deno.test('conferência do texto: cobre cada ponto na pergunta, só o que faltou na de volta', () => {
  assertEquals(Object.keys(perguntasDoTexto('pergunta', ['a', 'b'])).sort(), ['cobre_0', 'cobre_1', 'natural', 'promete']);
  assertEquals(Object.keys(perguntasDoTexto('de_volta', ['a', 'b'], 'b')).sort(), ['cobre_0', 'natural', 'promete']);
  assertEquals(Object.keys(perguntasDoTexto('fechamento', ['a'])).sort(), ['natural', 'promete']);
  assertEquals(problemaDoTexto({ promete: 0.05, natural: 0.8, cobre_0: 0.9 }), null);
  assert(problemaDoTexto({ promete: 0.7, natural: 0.8 })?.includes('prometeu'));
  assert(problemaDoTexto({ promete: 0.1, natural: 0.8, cobre_0: 0.3 })?.includes('pontos'));
  assert(problemaDoTexto({ promete: 0.1, natural: 0.2 })?.includes('texto pronto'));
});

Deno.test('comPessoa: número no grupo, primeiro nome na prévia', () => {
  const t = comPessoa('Oi @{pessoa}, tudo certo?', '554799990000', 'Thiélo Ramos');
  assertEquals(t, { texto: 'Oi @554799990000, tudo certo?', texto_previa: 'Oi @Thiélo, tudo certo?', mencoes: ['554799990000@s.whatsapp.net'] });
  assertEquals(comPessoa('Perfeito, anotado!', '554799990000', null).mencoes, []);
});
