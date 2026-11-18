// MCP 2.34.0 (18/11/2026): regras permanentes do dono, sem banco.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { FERRAMENTAS_DAS_REGRAS, montarRegras, PAYLOAD_POR_REGRA, type RegraPermanente, SEMPRE_SOBE } from './regras-permanentes.ts';

const REGRAS: RegraPermanente[] = [
  { chave: 'conteudo_revisado', nome: 'Conteúdo revisado segue sem o dono', area: 'Conteúdo', descricao: 'd', ligada: true, acoes: ['publicar', 'agendar'], operadores: [], limites: { max_rejeicoes: 1 } },
  { chave: 'trafego_ate_o_teto', nome: 'Tráfego até o teto da semana', area: 'Tráfego', descricao: 'd', ligada: true, acoes: ['alterar_orcamento'], operadores: ['trafe'], limites: { teto_semana_brl: 120 } },
  { chave: 'mensagens_de_rotina', nome: 'Mensagens de rotina a clientes', area: 'Clientes', descricao: 'd', ligada: false, acoes: ['enviar_mensagem'], operadores: [], limites: {} },
];

Deno.test('regras permanentes: cada agente vê o que vale para ele; regra desligada não vale para ninguém', () => {
  const trafe = montarRegras(REGRAS, 'trafe');
  assertEquals(trafe.regras.map((r) => [r.chave, r.vale_para_voce]), [['conteudo_revisado', true], ['trafego_ate_o_teto', true], ['mensagens_de_rotina', false]]);
  const vela = montarRegras(REGRAS, 'vela');
  assertEquals(vela.regras.find((r) => r.chave === 'trafego_ate_o_teto')!.vale_para_voce, false, 'tráfego é só do Trafe');
  assertEquals(vela.regras.find((r) => r.chave === 'trafego_ate_o_teto')!.quem_pode, ['trafe']);
  assertEquals(montarRegras(REGRAS).regras[0].quem_pode, 'qualquer agente');
  assert(!('vale_para_voce' in montarRegras(REGRAS).regras[0]));
  assertEquals(montarRegras(REGRAS, 'trafe', true).regras.length, 2, 'so_ligadas tira a desligada');
});

Deno.test('regras permanentes: ensina o payload de cada regra e o que sempre sobe', () => {
  const r = montarRegras(REGRAS);
  for (const regra of r.regras) assertEquals(regra.como_pedir, PAYLOAD_POR_REGRA[regra.chave]);
  assert(PAYLOAD_POR_REGRA.trafego_ate_o_teto.includes('recarga:true'));
  assert(PAYLOAD_POR_REGRA.mensagens_de_rotina.includes('grupo_do_cliente'));
  assertEquals(r.sempre_sobe_para_o_dono, SEMPRE_SOBE);
  assert(SEMPRE_SOBE.some((s) => s.includes('recarga')) && SEMPRE_SOBE.some((s) => s.includes('Cliente novo')));
  assert(r.como_usar.includes('autorizado_por_regra') && r.como_usar.includes('pendente'));
});

Deno.test('regras permanentes: a ferramenta é só leitura e sem travessão', () => {
  const [t] = FERRAMENTAS_DAS_REGRAS;
  assertEquals(t.name, 'aceleriq_regras_permanentes');
  assertEquals(t.annotations?.readOnlyHint, true);
  assertEquals([...t.scopes], ['aceleriq:read']);
  assert(!/[—–]/.test(t.description + JSON.stringify(PAYLOAD_POR_REGRA) + SEMPRE_SOBE.join('')));
});
