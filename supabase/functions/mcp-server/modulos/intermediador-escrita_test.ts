import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { comPessoa, limparTexto, MARCA, pedidoAoEscritor, perguntasDoTexto, problemaDoTexto } from './intermediador-escrita.ts';

const base = {
  cliente: 'Verzelo Jardins', primeiro_nome: 'Thiélo', tema: 'atendimento no fim de ano',
  pergunta: 'Vocês vão atender nos dias 24 e 31? Até que horas?', o_que_conta: ['atende dia 24', 'atende dia 31', 'horário'],
  ja_disse: [], conversa_recente: ['Almir (agência): Os anúncios estão bons ontem foram 4 mensagens'], contexto: 'Verzelo presta serviço de jardinagem e poda em Curitiba.',
};

Deno.test('pedido ao escritor leva o ramo do cliente, a conversa recente e a regra de não explicar como responder', () => {
  const { sistema, usuario } = pedidoAoEscritor({ ...base, tipo: 'pergunta', para_que: 'para o post de fim de ano' });
  assert(usuario.includes('Para quê: para o post de fim de ano'));
  assert(sistema.includes('do jeito que o Almir fala'));
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
  assertEquals(limparTexto('@pessoa oi! @{pessoa} tudo bem?', 'pergunta').texto, '@{pessoa} oi! Tudo bem?');
  assert(limparTexto('@{pessoa} atendem dia 24? Pode responder por aqui mesmo, em texto ou áudio.', 'pergunta').problema?.includes('como responder'));
});

Deno.test('limparTexto: fechamento sem menção e sem pergunta; termo interno e cobrança barrados', () => {
  assertEquals(limparTexto('Valeu, meu querido , entendi: chegou pelo post novo. anotado!', 'fechamento').texto, 'Valeu, meu querido, entendi: chegou pelo post novo. Anotado!');
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

Deno.test('limparTexto: nome escrito à mão e marcador com o nome dentro viram uma menção só (caso real de 25/11)', () => {
  assertEquals(limparTexto('@Marialex, @{Marialex}, pra colocar o horário certinho, vocês abrem sábado às 9h?', 'pergunta', 'Marialex Souza').texto,
    '@{pessoa}, pra colocar o horário certinho, vocês abrem sábado às 9h?');
  assertEquals(limparTexto('@Preserva, @{Preserva}, como vai funcionar a lavanderia dia 24?', 'pergunta', 'Preserva').texto,
    '@{pessoa}, como vai funcionar a lavanderia dia 24?');
  assertEquals(limparTexto('@{Thiélo} pode dar uma olhada no vídeo?', 'pergunta', 'Thiélo').texto, '@{pessoa} pode dar uma olhada no vídeo?');
  // Outro nome com @ que não é a pessoa marcada fica como está.
  assertEquals(limparTexto('@{pessoa}, o @Rui já viu?', 'pergunta', 'Thiélo').texto, '@{pessoa}, o @Rui já viu?');
});

Deno.test('conferência de promessa sabe que o pedido do time é fonte', () => {
  const q = perguntasDoTexto('pergunta', ['a']);
  assert(JSON.stringify(q.promete).includes('o para_que do time'));
});

Deno.test('comPessoa com várias pessoas: todas marcadas no grupo, nomes na prévia', () => {
  const t = comPessoa('@{pessoa}, vocês vão ter recesso?', ['554711110000', '554722220000'], ['Andreus Lima', 'Marcos']);
  assertEquals(t.texto, '@554711110000 @554722220000, vocês vão ter recesso?');
  assertEquals(t.texto_previa, '@Andreus @Marcos, vocês vão ter recesso?');
  assertEquals(t.mencoes, ['554711110000@s.whatsapp.net', '554722220000@s.whatsapp.net']);
  // O escritor às vezes escreve os dois nomes à mão: vira um marcador só (que depois marca os dois).
  assertEquals(limparTexto('@Andreus e @Marcos, vocês vão ter recesso?', 'pergunta', ['Andreus Lima', 'Marcos']).texto, '@{pessoa}, vocês vão ter recesso?');
});

Deno.test('promessa: na pergunta o para quê do pedido (com prazo) passa; no fechamento, prazo e ação do time não', () => {
  const naPergunta = JSON.stringify(perguntasDoTexto('pergunta', ['a']).promete);
  assert(naPergunta.includes('inclusive datas') && !naPergunta.includes('ação do time'));
  const noFechamento = JSON.stringify(perguntasDoTexto('fechamento', ['a']).promete);
  assert(noFechamento.includes('ação do time') && noFechamento.includes('prazo'));
});
