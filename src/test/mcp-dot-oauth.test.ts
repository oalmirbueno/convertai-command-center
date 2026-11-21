import { describe, expect, it } from 'vitest';
import {
  DOT_OFFICE_OPERATOR,
  dotOAuthDecision,
  isDotOfficeTool,
  parseDotOAuthBinding,
} from '../../supabase/functions/_shared/mcp-dot-oauth';
import { CredencialEmCache } from '../../supabase/functions/mcp-server/modulos/credencial-em-cache';

const clientId = '12345678-1234-4abc-8abd-123456789abc';
const subjectId = '23456789-2345-4abc-8abd-23456789abcd';
const otherId = '3456789a-3456-4abc-8abd-3456789abcde';
const raw = `${clientId}:${subjectId}`;
const binding = parseDotOAuthBinding(raw);
const attempt = {
  clientId,
  subjectId,
  verifiedClaims: true,
  staff: false,
  admin: false,
  legacyBinding: false,
};

describe('vínculo OAuth exclusivo da Dot', () => {
  it('aceita exatamente um par de UUIDs e normaliza maiúsculas', () => {
    expect(binding).toEqual({ clientId, subjectId });
    expect(parseDotOAuthBinding(raw.toUpperCase())).toEqual(binding);
  });

  it.each([
    undefined, '', clientId, `${clientId}:`, `:${subjectId}`,
    `${raw}:`, `${raw},${raw}`, ` ${raw}`, `dot:${subjectId}`,
  ])('mantém o vínculo desativado com configuração ausente ou inválida (%s)', value => {
    expect(parseDotOAuthBinding(value)).toBeNull();
    expect(dotOAuthDecision(parseDotOAuthBinding(value), attempt)).toBe('unrelated');
  });

  it('aceita apenas o par reservado de uma credencial validada e sem sobreposição', () => {
    expect(dotOAuthDecision(binding, attempt)).toBe('allowed');
    expect(dotOAuthDecision(binding, {
      ...attempt,
      clientId: clientId.toUpperCase(),
      subjectId: subjectId.toUpperCase(),
    })).toBe('allowed');
  });

  it('recusa a conta da Dot em outro cliente e preserva o fluxo de outros sujeitos', () => {
    expect(dotOAuthDecision(binding, { ...attempt, clientId: otherId })).toBe('denied');
    expect(dotOAuthDecision(binding, { ...attempt, subjectId: otherId })).toBe('unrelated');
    expect(dotOAuthDecision(binding, { ...attempt, clientId: otherId, subjectId: otherId })).toBe('unrelated');
  });

  it.each([
    { verifiedClaims: false },
    { staff: true },
    { admin: true },
    { legacyBinding: true },
  ])('recusa o par quando uma condição de segurança falha (%o)', guard => {
    expect(dotOAuthDecision(binding, { ...attempt, ...guard })).toBe('denied');
  });

  it('revalida a credencial da Dot na chamada seguinte e respeita a revogação', async () => {
    const cache = new CredencialEmCache<{ ok: boolean; officeOperator?: 'dot' }>();
    const request = new Request('https://example.test/mcp', { headers: { Authorization: 'Bearer fake-for-test' } });
    const guardar = (result: { officeOperator?: 'dot' }) => !result.officeOperator;
    expect(await cache.autenticar(request, async () => ({ ok: true, officeOperator: 'dot' }), guardar)).toEqual({
      ok: true, officeOperator: 'dot',
    });
    expect(await cache.autenticar(request, async () => ({ ok: false }), guardar)).toEqual({ ok: false });
    expect(cache.tamanho).toBe(0);
  });

  it('reconhece a Dot e libera apenas a entrada e a própria caixa', () => {
    expect(DOT_OFFICE_OPERATOR).toBe('dot');
    expect(isDotOfficeTool('aceleriq_escritorio_entrar')).toBe(true);
    expect(isDotOfficeTool('aceleriq_escritorio_caixa')).toBe(true);
    for (const tool of [
      'aceleriq_escritorio_caixa_v2',
      'aceleriq_escritorio_enviar',
      'aceleriq_escritorio_diretorio',
      'aceleriq_escritorio_presenca',
      'aceleriq_escritorio_dono',
      'aceleriq_escritorio_automacao',
      'aceleriq_list_clients',
    ]) {
      expect(isDotOfficeTool(tool)).toBe(false);
    }
  });
});
