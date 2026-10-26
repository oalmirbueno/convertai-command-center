// MCP 2.20 (26/10/2026): aceleriq_navegador_do_pc com banco falso (sem rede).
// PC desligado responde "indisponível" sem criar tarefa; passo que muda a conta só com aprovação;
// pedido parado na fila vira indisponível; só credencial da equipe pede.
//
//   deno test --allow-env supabase/functions/mcp-server/navegador_do_pc_test.ts

import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../_shared/mcp-auth.ts';
import { executarNavegadorDoPc } from './modulos/mcp-navegador-do-pc.ts';
import {
  CODIGO_FORA_DO_HORARIO,
  CODIGO_PC_INDISPONIVEL,
  dentroDaJanelaDoEgo,
  fimDaJanelaDoDia,
  JANELA_PADRAO_DO_EGO,
  lerJanelaDoEgo,
  MENSAGEM_AGENDADO_NAO_RODOU,
  MENSAGEM_PC_INDISPONIVEL,
  proximaAberturaDoEgo,
  rotuloLocal,
} from '../computador-do-agente/modulos/navegador-do-pc.ts';

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const inseridos: Linha[] = [];
  const atualizados: Array<{ tabela: string; valores: Linha }> = [];
  const consulta = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let modo: 'select' | 'update' | 'insert' = 'select';
    let valores: Linha = {};
    const linhas = () => (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
    const q: Record<string, unknown> = {
      select: () => q,
      contains: (c: string, v: unknown[]) => (filtros.push((l) => v.every((x) => ((l[c] as unknown[]) ?? []).includes(x))), q),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.includes(l[c])), q),
      gt: (c: string, v: string) => (filtros.push((l) => String(l[c]) > v), q),
      limit: () => q,
      update: (v: Linha) => ((modo = 'update'), (valores = v), q),
      insert: (v: Linha) => ((modo = 'insert'), (valores = v), q),
      maybeSingle: () => Promise.resolve({ data: linhas()[0] ?? null }),
      single: () => {
        const nova = { id: 'bbbbbbbb-0000-4000-8000-000000000002', ...valores };
        inseridos.push(nova);
        return Promise.resolve({ data: nova, error: null });
      },
      then: (ok: (r: unknown) => unknown) => {
        if (modo === 'update') {
          const alvo = linhas();
          alvo.forEach((l) => Object.assign(l, valores));
          atualizados.push({ tabela, valores });
          return Promise.resolve({ data: alvo }).then(ok);
        }
        return Promise.resolve({ data: linhas() }).then(ok);
      },
    };
    return q;
  };
  return {
    banco: { from: consulta, storage: { from: () => ({ createSignedUrl: (p: string) => Promise.resolve({ data: { signedUrl: `https://x/${p}` } }) }) } },
    inseridos,
    atualizados,
  };
}

const equipe: AuthContext = { keyId: 'k', keyName: 'Hermes', scopes: ['aceleriq:write'], origin: null, dataScope: { unrestricted: true, clientIds: [], principalUserId: '99999999-9999-4999-8999-999999999999', source: 'api_key' } };
const restrita: AuthContext = { ...equipe, dataScope: { unrestricted: false, clientIds: ['c'], principalUserId: null, source: 'api_key' } };
const AGORA = Date.parse('2026-10-26T15:00:00Z');
const recente = new Date(AGORA - 20_000).toISOString();
const velho = new Date(AGORA - 3_600_000).toISOString();
const LER = { acao: 'pedir', url: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1', passos: [{ acao: 'ler' }] };

Deno.test('PC desligado: indisponível na hora, sem criar tarefa e com nao_insistir', async () => {
  const f = bancoFalso({ computador_executores: [{ nome: 'pc', visto_em: velho, casos: ['pc_ego'] }], agente_computador_tarefas: [] });
  const r = await executarNavegadorDoPc(f.banco, equipe, LER, AGORA) as Record<string, unknown>;
  assertEquals(r.disponivel, false);
  assertEquals(r.codigo, CODIGO_PC_INDISPONIVEL);
  assertEquals(r.nao_insistir, true);
  assertEquals(f.inseridos.length, 0);
  const e = await executarNavegadorDoPc(f.banco, equipe, { acao: 'estado' }, AGORA) as Record<string, unknown>;
  assertEquals(e.mensagem, MENSAGEM_PC_INDISPONIVEL);
});

Deno.test('PC ligado: pedido de leitura vira tarefa pc_ego autorizada pela credencial da equipe', async () => {
  const f = bancoFalso({ computador_executores: [{ nome: 'pc', visto_em: recente, casos: ['captura_site', 'pc_ego'] }], agente_computador_tarefas: [] });
  const r = await executarNavegadorDoPc(f.banco, equipe, LER, AGORA) as Record<string, unknown>;
  assertEquals(r.estado, 'na_fila');
  assert(r.pedido_id);
  const t = f.inseridos[0];
  assertEquals(t.caso, 'pc_ego');
  assertEquals(t.estado, 'aprovada');
  assertEquals(t.aprovado_por, equipe.dataScope.principalUserId);
  assertEquals((t.passos as unknown[]).length, 2);
  assertEquals(t.dominios, ['facebook.com']);
});

Deno.test('passo que muda a conta sem aprovação é recusado antes de ir ao PC', async () => {
  const f = bancoFalso({ computador_executores: [{ nome: 'pc', visto_em: recente, casos: ['pc_ego'] }], agente_computador_tarefas: [], operator_approvals: [] });
  await assertRejects(
    () => executarNavegadorDoPc(f.banco, equipe, { ...LER, passos: [{ acao: 'clicar', texto: 'Publicar' }] }, AGORA),
    Error,
    'precisa_aprovacao',
  );
  assertEquals(f.inseridos.length, 0);
});

Deno.test('com aprovação aprovada, o passo sensível vai marcado como autorizado', async () => {
  const ap = 'cccccccc-0000-4000-8000-000000000003';
  const f = bancoFalso({ computador_executores: [{ nome: 'pc', visto_em: recente, casos: ['pc_ego'] }], agente_computador_tarefas: [], operator_approvals: [{ id: ap, status: 'aprovado', valid_until: null }] });
  await executarNavegadorDoPc(f.banco, equipe, { ...LER, passos: [{ acao: 'clicar', texto: 'Publicar' }], aprovacao_id: ap }, AGORA);
  const passos = f.inseridos[0].passos as Array<Record<string, unknown>>;
  assertEquals(passos[1].autorizado, true);
  assertEquals(passos[0].autorizado, undefined);
});

Deno.test('site fora da lista ou e-mail do dono: entrada inválida', async () => {
  const f = bancoFalso({ computador_executores: [{ nome: 'pc', visto_em: recente, casos: ['pc_ego'] }] });
  await assertRejects(() => executarNavegadorDoPc(f.banco, equipe, { acao: 'pedir', url: 'https://mail.google.com/' }, AGORA), Error, 'entrada_invalida');
});

Deno.test('só a equipe (chave irrestrita) usa o navegador do PC', async () => {
  const f = bancoFalso({});
  await assertRejects(() => executarNavegadorDoPc(f.banco, restrita, { acao: 'estado' }, AGORA), Error, 'somente_equipe');
});

Deno.test('resultado: pedido parado na fila com o PC sem sinal é cancelado como indisponível', async () => {
  const id = 'dddddddd-0000-4000-8000-000000000004';
  const f = bancoFalso({
    computador_executores: [{ nome: 'pc', visto_em: velho, casos: ['pc_ego'] }],
    agente_computador_tarefas: [{ id, caso: 'pc_ego', estado: 'aprovada', criado_em: new Date(AGORA - 60_000).toISOString(), provas: [] }],
  });
  const r = await executarNavegadorDoPc(f.banco, equipe, { acao: 'resultado', pedido_id: id }, AGORA) as Record<string, unknown>;
  assertEquals(r.codigo, CODIGO_PC_INDISPONIVEL);
  assertEquals(r.nao_insistir, true);
  assertEquals(f.atualizados[0].valores.estado, 'cancelada');
});

Deno.test('resultado: tarefa feita devolve texto, URL e prints assinados', async () => {
  const id = 'eeeeeeee-0000-4000-8000-000000000005';
  const f = bancoFalso({
    agente_computador_tarefas: [{ id, caso: 'pc_ego', estado: 'feita', motivo: null, criado_em: velho, provas: [{ storage_path: 'agencia/computador/x/passo-01-ego.png', legenda: 'Abri' }], resultado: { motor: 'ego', texto: 'Conta: Aceleriq', url_final: 'https://adsmanager.facebook.com/', passos_feitos: [] } }],
  });
  const r = await executarNavegadorDoPc(f.banco, equipe, { acao: 'resultado', pedido_id: id }, AGORA) as Record<string, unknown>;
  assertEquals(r.estado, 'feita');
  assertEquals(r.texto, 'Conta: Aceleriq');
  assertEquals((r.prints as Array<{ url: string }>)[0].url, 'https://x/agencia/computador/x/passo-01-ego.png');
});

// ------------------------------------------------------------------ horário comercial do Ego (MCP 2.21.0)

const J = JANELA_PADRAO_DO_EGO;
// 26/10/2026 é segunda-feira; São Paulo = UTC-3 (sem horário de verão).
const SEG_0859 = Date.parse('2026-10-26T11:59:00Z');
const SEG_0900 = Date.parse('2026-10-26T12:00:00Z');
const SEG_1759 = Date.parse('2026-10-26T20:59:00Z');
const SEG_1800 = Date.parse('2026-10-26T21:00:00Z');
const SEX_1830 = Date.parse('2026-10-30T21:30:00Z');
const SAB_1000 = Date.parse('2026-10-31T13:00:00Z');
const SEG_SEGUINTE_0900 = Date.parse('2026-11-02T12:00:00Z');

Deno.test('janela: 9h abre, 18h fecha, 8h59 ainda fora (fuso de São Paulo)', () => {
  assertEquals(dentroDaJanelaDoEgo(SEG_0859, J), false);
  assertEquals(dentroDaJanelaDoEgo(SEG_0900, J), true);
  assertEquals(dentroDaJanelaDoEgo(SEG_1759, J), true);
  assertEquals(dentroDaJanelaDoEgo(SEG_1800, J), false);
  // 23h em São Paulo já é terça em UTC: continua fora.
  assertEquals(dentroDaJanelaDoEgo(Date.parse('2026-10-27T02:00:00Z'), J), false);
});

Deno.test('janela: sábado e domingo fora; sexta 18h30 agenda para segunda 9h', () => {
  assertEquals(dentroDaJanelaDoEgo(SAB_1000, J), false);
  assertEquals(dentroDaJanelaDoEgo(Date.parse('2026-11-01T15:00:00Z'), J), false);
  assertEquals(proximaAberturaDoEgo(SEX_1830, J), SEG_SEGUINTE_0900);
  assertEquals(proximaAberturaDoEgo(SAB_1000, J), SEG_SEGUINTE_0900);
  assertEquals(proximaAberturaDoEgo(SEG_0859, J), SEG_0900);
  assertEquals(proximaAberturaDoEgo(SEG_1800, J), Date.parse('2026-10-27T12:00:00Z'));
  assertEquals(proximaAberturaDoEgo(SEG_0900 + 60_000, J), SEG_0900 + 60_000);
  assertEquals(fimDaJanelaDoDia(SEG_0900, J), SEG_1800);
  assertEquals(rotuloLocal(SEG_SEGUINTE_0900, J), 'seg 02/11 às 09:00');
});

Deno.test('janela configurável: EGO_HORARIO, EGO_DIAS e EGO_FUSO (com horário de verão)', () => {
  const sab = lerJanelaDoEgo((n) => ({ EGO_HORARIO: '08:30-12:00', EGO_DIAS: '1-6' } as Record<string, string>)[n]);
  assertEquals(sab.inicio_min, 510);
  assertEquals(sab.dias, [1, 2, 3, 4, 5, 6]);
  assertEquals(dentroDaJanelaDoEgo(SAB_1000, sab), true);
  // Valor inválido fica no padrão.
  const ruim = lerJanelaDoEgo((n) => ({ EGO_HORARIO: '18-9', EGO_DIAS: 'x', EGO_FUSO: 'Lua/Base' } as Record<string, string>)[n]);
  assertEquals(ruim, J);
  // Lisboa saiu do horário de verão em 25/10/2026: 9h de segunda 26/10 = 09:00Z.
  const lis = lerJanelaDoEgo((n) => (n === 'EGO_FUSO' ? 'Europe/Lisbon' : undefined));
  assertEquals(proximaAberturaDoEgo(Date.parse('2026-10-26T02:00:00Z'), lis), Date.parse('2026-10-26T09:00:00Z'));
});

Deno.test('fora do horário: estado diz agendável e não consulta o PC', async () => {
  const f = bancoFalso({ computador_executores: [], agente_computador_tarefas: [] });
  const r = await executarNavegadorDoPc(f.banco, equipe, { acao: 'estado' }, SEX_1830, J) as Record<string, unknown>;
  assertEquals(r.fora_do_horario, true);
  assertEquals(r.agendavel, true);
  assertEquals(r.codigo, CODIGO_FORA_DO_HORARIO);
  assertEquals(r.proxima_abertura, new Date(SEG_SEGUINTE_0900).toISOString());
});

Deno.test('fora do horário: pedir agenda para a abertura, com PC desligado, prioridade e nao_insistir', async () => {
  const f = bancoFalso({ computador_executores: [{ nome: 'pc', visto_em: velho, casos: [] }], agente_computador_tarefas: [] });
  const r = await executarNavegadorDoPc(f.banco, equipe, { ...LER, prioridade: 'alta' }, SEX_1830, J) as Record<string, unknown>;
  assertEquals(r.estado, 'agendada');
  assertEquals(r.nao_insistir, true);
  assertEquals(r.agendado_para, new Date(SEG_SEGUINTE_0900).toISOString());
  assert(r.pedido_id);
  const t = f.inseridos[0];
  assertEquals(t.estado, 'aprovada');
  assertEquals(t.executar_a_partir_de, new Date(SEG_SEGUINTE_0900).toISOString());
  assertEquals(t.prioridade, 1);
});

Deno.test('fora do horário: ação com efeito ainda exige aprovação (que pode vir de noite)', async () => {
  const f = bancoFalso({ agente_computador_tarefas: [], operator_approvals: [] });
  await assertRejects(() => executarNavegadorDoPc(f.banco, equipe, { ...LER, passos: [{ acao: 'clicar', texto: 'Publicar' }] }, SEX_1830, J), Error, 'precisa_aprovacao');
  const ap = 'cccccccc-0000-4000-8000-000000000009';
  const g = bancoFalso({ agente_computador_tarefas: [], operator_approvals: [{ id: ap, status: 'aprovado', valid_until: null }] });
  const r = await executarNavegadorDoPc(g.banco, equipe, { ...LER, passos: [{ acao: 'clicar', texto: 'Publicar' }], aprovacao_id: ap }, SEX_1830, J) as Record<string, unknown>;
  assertEquals(r.estado, 'agendada');
  assertEquals((g.inseridos[0].passos as Array<Record<string, unknown>>)[1].autorizado, true);
});

Deno.test('dentro do horário: pedido sai com prioridade normal e sem agendamento', async () => {
  const f = bancoFalso({ computador_executores: [{ nome: 'pc', visto_em: new Date(SEG_0900 - 10_000).toISOString(), casos: ['pc_ego'] }], agente_computador_tarefas: [] });
  const r = await executarNavegadorDoPc(f.banco, equipe, LER, SEG_0900, J) as Record<string, unknown>;
  assertEquals(r.estado, 'na_fila');
  assertEquals(f.inseridos[0].prioridade, 2);
  assertEquals(f.inseridos[0].executar_a_partir_de, undefined);
});

const AG = 'abababab-0000-4000-8000-00000000000a';
const agendado = (extra: Record<string, unknown> = {}) => ({
  id: AG,
  caso: 'pc_ego',
  estado: 'aprovada',
  criado_em: new Date(SEX_1830).toISOString(),
  executar_a_partir_de: new Date(SEG_SEGUINTE_0900).toISOString(),
  provas: [],
  ...extra,
});

Deno.test('agendado antes da hora: resultado diz agendada e não cancela', async () => {
  const f = bancoFalso({ computador_executores: [], agente_computador_tarefas: [agendado()] });
  const r = await executarNavegadorDoPc(f.banco, equipe, { acao: 'resultado', pedido_id: AG }, SAB_1000, J) as Record<string, unknown>;
  assertEquals(r.estado, 'agendada');
  assertEquals(r.nao_insistir, true);
  assertEquals(f.atualizados.length, 0);
});

Deno.test('agendado depois da hora: sem o corte dos 3 min, mesmo com o PC sem sinal', async () => {
  const f = bancoFalso({ computador_executores: [{ nome: 'pc', visto_em: velho, casos: [] }], agente_computador_tarefas: [agendado()] });
  const r = await executarNavegadorDoPc(f.banco, equipe, { acao: 'resultado', pedido_id: AG }, SEG_SEGUINTE_0900 + 30 * 60_000, J) as Record<string, unknown>;
  assertEquals(r.estado, 'na_fila');
  assertEquals(r.agendado, true);
  assertEquals(f.atualizados.length, 0);
});

Deno.test('agendado e a janela do dia fechou sem o PC pegar: encerra com motivo claro', async () => {
  const f = bancoFalso({ computador_executores: [], agente_computador_tarefas: [agendado()] });
  const r = await executarNavegadorDoPc(f.banco, equipe, { acao: 'resultado', pedido_id: AG }, Date.parse('2026-11-02T21:00:00Z'), J) as Record<string, unknown>;
  assertEquals(r.estado, 'cancelada');
  assertEquals(r.motivo, MENSAGEM_AGENDADO_NAO_RODOU);
  assertEquals(f.atualizados[0].valores.estado, 'cancelada');
});

Deno.test('pedido do fim da janela que o PC não pegou até as 18h passa para a próxima abertura', async () => {
  const f = bancoFalso({ computador_executores: [], agente_computador_tarefas: [agendado({ criado_em: new Date(SEG_1759).toISOString(), executar_a_partir_de: null })] });
  const r = await executarNavegadorDoPc(f.banco, equipe, { acao: 'resultado', pedido_id: AG }, SEG_1800 + 60_000, J) as Record<string, unknown>;
  assertEquals(r.estado, 'agendada');
  assertEquals(f.atualizados[0].valores.executar_a_partir_de, '2026-10-27T12:00:00.000Z');
  assertEquals(f.atualizados[0].valores.estado, undefined);
});
