// Erros do Estúdio (16/11/2026): regras puras, leitura com banco falso e a ferramenta do MCP.

import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  inicioDaJanela,
  lerErrosDoEstudio,
  limitarDias,
  limitarQuantos,
  limparMensagem,
  montarErrosDoEstudio,
  resumirErros,
  tituloDaPeca,
  traduzirErroDoEstudio,
} from './estudio-erros-regras.ts';
import { errosDoEstudio, panoramaDaCasa, semConferirClienteNoTeste, usarBancoDeTeste } from './painel-leituras.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { TOOL_MAP } from '../../_shared/mcp-tools.ts';
import { FERRAMENTAS_POR_AREA } from './guia-do-painel.ts';

const C1 = '00000000-0000-0000-0000-0000000000c1';
const C2 = '00000000-0000-0000-0000-0000000000c2';
const T1 = '00000000-0000-0000-0000-0000000000a1';
const T2 = '00000000-0000-0000-0000-0000000000a2';
const T_SUMIU = '00000000-0000-0000-0000-0000000000a9';

const adminCtx: AuthContext = {
  keyId: 'oauth:00000000-0000-0000-0000-000000000001',
  keyName: 'teste',
  scopes: ['admin'],
  origin: 'teste',
  dataScope: { unrestricted: true, clientIds: [], principalUserId: '00000000-0000-0000-0000-000000000001', source: 'oauth' },
};
const restritoCtx: AuthContext = { ...adminCtx, scopes: ['aceleriq:read'], dataScope: { ...adminCtx.dataScope, unrestricted: false, clientIds: [C1] } };

interface Chamada { tabela: string; select: string; filtros: Array<[string, unknown[]]> }
function bancoFalso(responder: (c: Chamada) => unknown[]) {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    from(tabela: string) {
      const c: Chamada = { tabela, select: '', filtros: [] };
      chamadas.push(c);
      const q: Record<string, unknown> = {};
      for (const m of ['eq', 'is', 'not', 'in', 'gte', 'lte', 'lt', 'order', 'limit', 'or', 'range']) {
        q[m] = (...args: unknown[]) => {
          c.filtros.push([m, args]);
          return q;
        };
      }
      q.select = (cols: string) => {
        c.select = cols;
        return q;
      };
      q.then = (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: responder(c), error: null, count: null }).then(ok, erro);
      return q;
    },
  };
}
const filtro = (c: Chamada, nome: string, campo: string) => c.filtros.find(([n, a]) => n === nome && a[0] === campo)?.[1][1];

const ERROS = [
  { id: 'e1', client_id: C1, trabalho_id: T1, ordem: 2, etapa: 'gerar', tentativas: 3, max_tentativas: 3, erro_codigo: 'tentativas_esgotadas', erro_mensagem: 'x', criado_em: '2026-11-15T10:00:00Z' },
  { id: 'e2', client_id: C1, trabalho_id: T1, ordem: 3, etapa: 'gerar', tentativas: 0, max_tentativas: 3, erro_codigo: 'erro_interno', erro_mensagem: 'Request timed out after 150s', criado_em: '2026-11-15T12:00:00Z' },
  { id: 'e3', client_id: C2, trabalho_id: T_SUMIU, ordem: 1, etapa: 'gerar', tentativas: 0, max_tentativas: 3, erro_codigo: 'xyz_novo', erro_mensagem: 'Bearer abcdefghijklmnop falhou', criado_em: '2026-11-14T09:00:00Z' },
];
const FEITOS = [
  { trabalho_id: T1, criado_em: '2026-11-15T11:00:00Z' }, // depois do e1, antes do e2
  { trabalho_id: T2, criado_em: '2026-11-16T11:00:00Z' },
];
const TRABALHOS = [{ id: T1, client_id: C1, tipo: 'carrossel', legenda: '\nPromoção de verão chegou com tudo\nsegunda linha', conceito: 'Verão' }];
const CLIENTES = [{ id: C1, company_name: 'Loja Um', full_name: null }];

Deno.test('erros do Estúdio: tradução por código, por padrão da mensagem e mensagem limpa', () => {
  assertStringIncludes(traduzirErroDoEstudio('saldo_insuficiente', null), 'sem saldo');
  assertStringIncludes(traduzirErroDoEstudio('erro_interno', 'qualquer'), 'falhou no meio');
  assertStringIncludes(traduzirErroDoEstudio('desconhecido', 'Request timed out'), 'demorou demais');
  assertStringIncludes(traduzirErroDoEstudio('desconhecido', 'HTTP 429 Too Many Requests'), 'excesso de pedidos');
  assertEquals(traduzirErroDoEstudio('desconhecido', 'A logo sumiu da pasta.'), 'A logo sumiu da pasta.');
  assertEquals(traduzirErroDoEstudio('codigo_x', ''), 'Falhou sem motivo registrado (código codigo_x).');
  assertEquals(traduzirErroDoEstudio(null, null), 'Falhou sem motivo registrado.');
  const limpa = limparMensagem('Authorization: Bearer abcdefghijklmnop e sk-ABCDEFGHIJKLMNOP e https://x.io/a?token=segredo123&b=1') ?? '';
  assert(!limpa.includes('abcdefghijklmnop') && !limpa.includes('ABCDEFGHIJKLMNOP') && !limpa.includes('segredo123'), limpa);
  assertEquals(limparMensagem('a'.repeat(400))?.length, 300);
});

Deno.test('erros do Estúdio: título da peça, limites e janela igual à do panorama', () => {
  assertEquals(tituloDaPeca({ legenda: '\n  Primeira linha \n resto', conceito: 'C' }), 'Primeira linha');
  assertEquals(tituloDaPeca({ legenda: '', conceito: 'Conceito da direção' }), 'Conceito da direção');
  assertEquals(tituloDaPeca({ legenda: 'x'.repeat(200) })?.length, 80);
  assertEquals(tituloDaPeca(null), null);
  assertEquals([limitarDias(undefined), limitarDias(0), limitarDias(3), limitarDias(90)], [7, 7, 3, 30]);
  assertEquals([limitarQuantos(undefined), limitarQuantos(10), limitarQuantos(1000)], [50, 10, 100]);
  // 16/11 às 01:00 UTC ainda é 15/11 em São Paulo.
  assertEquals(inicioDaJanela(7, new Date('2026-11-16T01:00:00Z')), '2026-11-08T00:00:00Z');
  assertEquals(inicioDaJanela(1, new Date('2026-11-16T15:00:00Z')), '2026-11-15T00:00:00Z');
});

Deno.test('erros do Estúdio: resolvido_depois só com feito posterior do mesmo trabalho; órfão sem trabalho', () => {
  const itens = montarErrosDoEstudio({ erros: ERROS, feitos: FEITOS, trabalhos: TRABALHOS, clientes: CLIENTES });
  const [e1, e2, e3] = itens;
  assertEquals(e1.resolvido_depois, true);
  assertEquals(e1.resolvido_em, '2026-11-15T11:00:00.000Z');
  assertEquals(e2.resolvido_depois, false, 'o feito veio antes deste erro');
  assertEquals(e1.titulo, 'Promoção de verão chegou com tudo');
  assertEquals(e1.cliente, 'Loja Um');
  assertEquals(e1.orfao, false);
  assertStringIncludes(e2.erro_mensagem, 'falhou no meio');
  assertEquals(e2.erro_original, 'Request timed out after 150s');
  assertEquals(e3.orfao, true);
  assertEquals(e3.motivo_orfao, 'trabalho inexistente');
  assert(!(e3.erro_original ?? '').includes('abcdefghijklmnop'));
  const semCliente = montarErrosDoEstudio({ erros: [{ ...ERROS[0], client_id: null }], feitos: [], trabalhos: TRABALHOS, clientes: CLIENTES })[0];
  assertEquals(semCliente.motivo_orfao, 'sem cliente');
  const outro = montarErrosDoEstudio({ erros: [{ ...ERROS[0], client_id: C2 }], feitos: [], trabalhos: TRABALHOS, clientes: [{ id: C2, full_name: 'Dois' }] })[0];
  assertEquals(outro.motivo_orfao, 'trabalho de outro cliente');
  assertEquals([outro.titulo, outro.tipo], [null, null], 'nada do trabalho de outro cliente sai');
  assertEquals(resumirErros(itens), { total: 3, pendentes: 2, resolvidos: 1, orfaos: 1, por_codigo: { tentativas_esgotadas: 1, erro_interno: 1, xyz_novo: 1 } });
});

function bancoDosErros() {
  return bancoFalso((c) => {
    if (c.tabela === 'estudio_fila') return filtro(c, 'eq', 'status') === 'erro' ? ERROS : FEITOS;
    if (c.tabela === 'estudio_trabalhos') return TRABALHOS;
    if (c.tabela === 'profiles') return CLIENTES;
    return [];
  });
}

Deno.test('erros do Estúdio: leitura filtra status, janela e cliente, e busca só os trabalhos dos erros', async () => {
  const b = bancoDosErros();
  const r = await lerErrosDoEstudio(b, { clientId: C1, dias: 7, limite: 2, agora: new Date('2026-11-16T15:00:00Z') });
  const [erros, feitos, trabalhos] = b.chamadas;
  assertEquals(filtro(erros, 'eq', 'status'), 'erro');
  assertEquals(filtro(erros, 'eq', 'client_id'), C1);
  assertEquals(filtro(erros, 'gte', 'criado_em'), '2026-11-09T00:00:00Z');
  assertEquals(erros.filtros.find(([n]) => n === 'limit')?.[1][0], 3, 'pede um a mais para saber se há mais');
  assertEquals(r.mais, true);
  assertEquals(r.itens.length, 2);
  assertEquals(filtro(feitos, 'eq', 'status'), 'feito');
  assertEquals(filtro(feitos, 'in', 'trabalho_id'), [T1]);
  assertStringIncludes(trabalhos.select, 'conceito:direcao->>conceito');
  assertEquals(filtro(trabalhos, 'eq', 'client_id'), C1, 'com cliente, só lê trabalho dele');
  const vazio = await lerErrosDoEstudio(bancoFalso(() => []), {});
  assertEquals(vazio.itens, []);
  assertEquals(vazio.resumo.total, 0);
});

Deno.test('aceleriq_estudio_erros: casa inteira só sem restrição; por cliente, enxuto e só pendentes', async () => {
  usarBancoDeTeste(() => bancoDosErros());
  semConferirClienteNoTeste(true);
  try {
    const casa = await errosDoEstudio({}, adminCtx) as { itens: Record<string, unknown>[]; resumo: { total: number } };
    assertEquals(casa.resumo.total, 3);
    assert(!('erro_original' in casa.itens[0]), 'enxuto não traz o texto original');
    await assertRejects(() => errosDoEstudio({}, restritoCtx), Error, 'casa inteira');
    const pend = await errosDoEstudio({ client_id: C1, so_pendentes: true, detalhe: 'completo' }, restritoCtx) as { itens: Record<string, unknown>[] };
    assertEquals(pend.itens.map((i) => i.id), ['e2', 'e3']);
    assert('erro_original' in pend.itens[0]);
    await assertRejects(() => errosDoEstudio({ client_id: C2 }, restritoCtx));
  } finally {
    usarBancoDeTeste(null);
    semConferirClienteNoTeste(false);
  }
});

Deno.test('aceleriq_estudio_erros: no catálogo, só leitura, no guia e com a dica no panorama da casa', async () => {
  const t = TOOL_MAP.get('aceleriq_estudio_erros');
  assert(t);
  assertEquals(t.annotations?.readOnlyHint, true);
  assert(t.scopes.includes('aceleriq:read'));
  const props = (t.inputSchema as { properties: Record<string, { maximum?: number }> }).properties;
  assertEquals(props.dias.maximum, 30);
  assertEquals(props.limite.maximum, 100);
  assert(FERRAMENTAS_POR_AREA.mesa.includes('aceleriq_estudio_erros'));
  assert(FERRAMENTAS_POR_AREA.dashboard.includes('aceleriq_estudio_erros'));
  usarBancoDeTeste(() => bancoFalso((c) => (c.tabela === 'estudio_fila' ? [{ status: 'erro' }, { status: 'feito' }] : [])));
  try {
    const p = await panoramaDaCasa({}, adminCtx) as Record<string, unknown>;
    assertEquals(p.estudio_fila, { erro: 1, feito: 1 });
    assertStringIncludes(String(p.estudio_fila_detalhe), 'detalhe: aceleriq_estudio_erros');
  } finally {
    usarBancoDeTeste(null);
  }
});

Deno.test('aceleriq_estudio_erros: dias e limite acima do teto acomodam, não recusam', async () => {
  usarBancoDeTeste(() => bancoDosErros());
  try {
    const r = await TOOL_MAP.get('aceleriq_estudio_erros')!.handler({ dias: 90, limite: 1000 }, adminCtx) as { dias: number };
    assertEquals(r.dias, 30);
    await assertRejects(() => TOOL_MAP.get('aceleriq_estudio_erros')!.handler({ dias: 'muitos' }, adminCtx), Error, 'Invalid input');
  } finally {
    usarBancoDeTeste(null);
  }
});
