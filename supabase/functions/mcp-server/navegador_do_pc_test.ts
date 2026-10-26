// MCP 2.20 (26/10/2026): aceleriq_navegador_do_pc com banco falso (sem rede).
// PC desligado responde "indisponível" sem criar tarefa; passo que muda a conta só com aprovação;
// pedido parado na fila vira indisponível; só credencial da equipe pede.
//
//   deno test --allow-env supabase/functions/mcp-server/navegador_do_pc_test.ts

import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { AuthContext } from '../_shared/mcp-auth.ts';
import { executarNavegadorDoPc } from './modulos/mcp-navegador-do-pc.ts';
import { CODIGO_PC_INDISPONIVEL, MENSAGEM_PC_INDISPONIVEL } from '../computador-do-agente/modulos/navegador-do-pc.ts';

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
