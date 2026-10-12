/**
 * MCP 2.8 (12/10/2026): o que as skills trouxeram para o painel, para o Hermes ler.
 *
 * - saudeDaContaDeAds: a última auditoria da conta de anúncios (nota, faixa, cobertura, controles
 *   que falharam e prioridades), a evolução das últimas rodadas e a memória da conta (finanças
 *   calculadas e o que falta preencher). Só leitura; a auditoria em si roda na Mesa Ads ou no robô
 *   semanal, nunca pelo MCP.
 * - diagnosticoDoInstagram: o diagnóstico do perfil em 9 partes guardado na aba Redes.
 *
 * Fica fora de _shared (perto do teto do Lovable): o mcp-tools.ts só declara as ferramentas.
 */

import { db, isUuid } from '../../_shared/aceleriq-read-services.ts';
import { assertClientAccess, type AuthContext } from '../../_shared/mcp-auth.ts';
import { exigirClienteExistente } from '../../_shared/mcp-client-id-guard.ts';
import { type Controle, notaDaAuditoria } from '../../mesa-ads/modulos/auditoria-da-conta.ts';
import { calcularFinancas, normalizarCamadas } from '../../mesa-ads/modulos/memoria-da-conta.ts';
import { blocoDoDiagnostico, type DiagnosticoDoPerfil } from '../../mesa-instagram/modulos/diagnostico-do-perfil.ts';

async function conferir(clientId: string, ctx: AuthContext) {
  if (!isUuid(clientId)) throw new Error('client_id must be a UUID');
  assertClientAccess(ctx, clientId);
  await exigirClienteExistente(db(), clientId);
}

const semTabela = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205');

const controleCurto = (c: Controle) => ({ id: c.id, nome: c.nome, categoria: c.categoria, severidade: c.severidade, resultado: c.resultado, evidencia: c.evidencia, acao: c.acao });

export async function saudeDaContaDeAds(input: { client_id: string }, ctx: AuthContext) {
  const clientId = input.client_id;
  await conferir(clientId, ctx);
  const [aud, mem] = await Promise.all([
    db().from('ads_auditorias').select('nota, cobertura, faixa, categorias, controles, periodo, criado_em').eq('client_id', clientId).order('criado_em', { ascending: false }).limit(6),
    db().from('ads_memoria_da_conta').select('versao, camadas, motivo, criado_em').eq('client_id', clientId).eq('atual', true).maybeSingle(),
  ]);
  const avisos: string[] = [];
  if (aud.error && !semTabela(aud.error)) avisos.push('As auditorias não puderam ser lidas agora.');
  if (mem.error && !semTabela(mem.error)) avisos.push('A memória da conta não pôde ser lida agora.');

  const rodadas = (aud.data ?? []) as Array<{ nota: number | null; cobertura: number | null; faixa: string; categorias: unknown; controles: Controle[] | null; periodo: unknown; criado_em: string }>;
  const ultima = rodadas[0] ?? null;
  let auditoria: Record<string, unknown> | null = null;
  if (ultima) {
    const controles = Array.isArray(ultima.controles) ? ultima.controles : [];
    const nota = notaDaAuditoria(controles);
    auditoria = {
      nota: ultima.nota,
      faixa: ultima.faixa,
      cobertura: ultima.cobertura,
      periodo: ultima.periodo,
      feita_em: ultima.criado_em,
      categorias: ultima.categorias,
      falharam: controles.filter((c) => c.resultado === 'falhou').map(controleCurto),
      prioridades: nota.prioridades.slice(0, 5).map(controleCurto),
      evolucao: rodadas.map((r) => ({ nota: r.nota, faixa: r.faixa, em: r.criado_em })),
    };
  } else avisos.push('Esta conta ainda não tem auditoria. Rode na Mesa Ads, etapa Auditoria, ou espere o robô semanal.');

  let memoria: Record<string, unknown> | null = null;
  if (mem.data) {
    const m = mem.data as { versao: number; camadas: unknown; motivo: string | null; criado_em: string };
    const camadas = normalizarCamadas(m.camadas);
    memoria = { versao: m.versao, atualizada_em: m.criado_em, motivo: m.motivo, financas: calcularFinancas(camadas.financas), camadas };
  } else avisos.push('A memória da conta ainda não foi preenchida (Mesa Ads, aba Conta, Memória da conta).');

  return {
    client_id: clientId,
    auditoria,
    memoria,
    avisos,
    como_ler:
      'Nota de 0 a 100 só vale com a faixa "valendo" (cobertura de 80% ou mais); "provisoria" é indicativa e "dado_insuficiente" não tem nota. As prioridades vêm em ordem: crítico primeiro. O custo máximo e o ROAS de equilíbrio da memória são contas do painel (ticket, margem, fechamento), não opinião. Nenhuma ação na conta sai daqui: proponha e peça aprovação.',
    caminho: `/mesa-ads?client=${clientId}&etapa=auditoria`,
  };
}

export async function diagnosticoDoInstagram(input: { client_id: string }, ctx: AuthContext) {
  const clientId = input.client_id;
  await conferir(clientId, ctx);
  const { data, error } = await db().from('cliente_instagram_planos').select('conta_chave, diagnostico, atualizado_em').eq('client_id', clientId).not('diagnostico', 'is', null).order('atualizado_em', { ascending: false }).limit(5);
  if (error && !semTabela(error)) throw new Error('O diagnóstico do perfil não pôde ser lido agora.');
  const perfis = ((data ?? []) as Array<{ diagnostico: DiagnosticoDoPerfil }>).map((l) => ({
    username: l.diagnostico.username,
    gerado_em: l.diagnostico.gerado_em,
    resumo: l.diagnostico.resumo,
    linhas: l.diagnostico.linhas,
    para_fixar: l.diagnostico.para_fixar,
    texto: blocoDoDiagnostico(l.diagnostico),
  }));
  return {
    client_id: clientId,
    perfis,
    avisos: perfis.length ? [] : ['Nenhum perfil diagnosticado ainda. Rode na Mesa, aba Redes, ferramenta Diagnóstico.'],
    como_ler: 'Cada parte vem com estado (passa, melhorar, falha, nao_lido), o porquê e como corrigir. "nao_lido" é o que a API do Instagram não mostra (destaques, fixados, categoria sem página): confira no app. Bio, nome e @ só mudam pelo app do cliente: proponha o texto, não prometa a troca.',
    caminho: `/mesa?client=${clientId}&aba=instagram&bloco=diagnostico`,
  };
}
