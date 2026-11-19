// Central de Automações (19/11/2026): regras puras, sem banco e sem rede.
import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  chaveConfere,
  efeitoNoCliente,
  montarConfirmacao,
  separarFluxos,
  validarRetrato,
} from '../_shared/automacoes.ts';

const RETRATO = {
  coletado_em: '2026-11-19T10:05:00-03:00',
  fluxos: [
    { id: 'Acq11MensagemSem', nome: 'Clientes: mensagem da semana no grupo (seg, qua, sex)', ativo: true, grupo: 'Clientes', gatilhos: [], desenho: { nos: [], ligacoes: [] } },
    { id: 'AcqF00Ferramenta', nome: 'Apoio: ponte com o painel', ativo: true, grupo: 'Apoio', gatilhos: [] },
  ],
  execucoes: [{ id: 44222, fluxo_id: 'Acq14InstagramCD', status: 'success', caminho: [{ no: 'A cada 5 minutos', estado: 'success', vezes: 1 }] }],
  saude: [{ chave: 'n8n', nome: 'n8n no ar', estado: 'ok', detalhe: 'respondeu em 45 ms', info: {} }],
};

Deno.test('automações: quem mexe com cliente', () => {
  assertEquals(efeitoNoCliente('Clientes', 'Clientes: aviso de post no ar no grupo'), true);
  assertEquals(efeitoNoCliente('Comercial', 'Comercial: respostas no WhatsApp'), true);
  assertEquals(efeitoNoCliente('Instagram', 'Instagram: comentários e Direct da Aceleriq'), true);
  assertEquals(efeitoNoCliente('Apoio', 'Apoio: registro de falhas'), false);
  assertEquals(efeitoNoCliente('Outros', 'Envio das mensagens aprovadas para o grupo'), true, 'nome com grupo pesa');
});

Deno.test('automações: a confirmação diz o efeito no cliente e o caso da ponte', () => {
  const cliente = montarConfirmacao({ nome: 'Clientes: mensagem da semana no grupo', grupo: 'Clientes', ativo: true }, 'desligar');
  assert(cliente.efeito_no_cliente);
  assert(cliente.aviso.includes('cliente'));
  const apoio = montarConfirmacao({ nome: 'Apoio: ponte com o painel', grupo: 'Apoio', ativo: true }, 'desligar');
  assertEquals(apoio.efeito_no_cliente, false);
  assert(apoio.aviso.includes('outros fluxos'), 'apoio derruba os que dependem dele');
  const ligar = montarConfirmacao({ nome: 'Comercial: repasse', grupo: 'Comercial', ativo: false }, 'ligar');
  assert(ligar.aviso.includes('começa a'));
});

Deno.test('automações: retrato válido passa e o desenho só vai quando veio', () => {
  const r = validarRetrato(RETRATO);
  assertEquals(r.fluxos.length, 2);
  const { comDesenho, semDesenho } = separarFluxos(r.fluxos);
  assertEquals(comDesenho.map((f) => f.id), ['Acq11MensagemSem']);
  assertEquals(semDesenho.map((f) => f.id), ['AcqF00Ferramenta']);
  assert(!('desenho' in semDesenho[0]), 'sem desenho não apaga o que já está gravado');
});

Deno.test('automações: retrato estranho é recusado', () => {
  assertThrows(() => validarRetrato({}), Error, 'fluxos');
  assertThrows(() => validarRetrato({ ...RETRATO, fluxos: [{ id: '', nome: 'x', ativo: true }] }), Error);
  assertThrows(() => validarRetrato({ ...RETRATO, saude: [{ chave: 'n8n', nome: 'n8n', estado: 'talvez' }] }), Error);
  assertThrows(() => validarRetrato({ ...RETRATO, execucoes: [{ id: 'abc', fluxo_id: 'x', status: 'success' }] }), Error);
});

Deno.test('automações: texto com cara de segredo não passa no erro da execução', () => {
  const r = validarRetrato({ ...RETRATO, execucoes: [{ id: 1, fluxo_id: 'x', status: 'error', erro: 'falhou com Bearer abc.def.ghi e chave sk-or-v1-0123456789abcdef0123456789abcdef' }] });
  const erro = r.execucoes[0].erro!;
  assert(!erro.includes('abc.def.ghi'));
  assert(!erro.includes('0123456789abcdef0123456789abcdef'));
});

Deno.test('automações: a chave do coletor confere pelo sha256, nunca pelo texto', async () => {
  const sha = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'; // sha256("123")
  assertEquals(await chaveConfere('123', sha), true);
  assertEquals(await chaveConfere('124', sha), false);
  assertEquals(await chaveConfere('', sha), false);
  assertEquals(await chaveConfere('123', ''), false, 'sem segredo configurado ninguém entra');
});
