import { describe, expect, it } from 'vitest';
import { lerCarteira, gravarCarteira, blocoDaCampanha, contextoDoPedido } from '@/lib/carteiraOperacao';
const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
describe('Carteira compartilhada com a operação', () => {
  it('preserva escopo e troca somente a seleção', () => {
    const s = gravarCarteira('Escopo original.', [a, a]);
    expect(lerCarteira(s)?.client_ids).toEqual([a]);
    const novo = gravarCarteira(s + '\nOutro contexto.', [b]);
    expect(novo).toContain('Escopo original.'); expect(novo).toContain('Outro contexto.');
    expect(lerCarteira(novo)?.client_ids).toEqual([b]);
  });
  it('carteira vazia não volta ao padrão de todos', () => { expect(lerCarteira(null)).toBeNull(); expect(lerCarteira(gravarCarteira('', []))?.client_ids).toEqual([]); });
  it('recusa registros incompletos e IDs inventados', () => { expect(() => lerCarteira('<!-- operacao_carteira_v1 -->{}')).toThrow(); expect(() => gravarCarteira(null, ['nome'])).toThrow(); });
  it('cadastro ativo não vira entrega e dados velhos pedem trabalho', () => {
    expect(blocoDaCampanha({ situacao: 'sem_entrega', campanha: {status: 'ACTIVE'}, divergencia: true })).toBe('trabalhar');
    expect(blocoDaCampanha({ situacao: 'desatualizada', campanha: {status: 'PAUSED'}, divergencia: false })).toBe('trabalhar');
    expect(blocoDaCampanha({ situacao: 'entrega', campanha: {status: 'ACTIVE'}, divergencia: false })).toBe('ativo');
  });
  it('pedido criativo carrega nome e identidade do cliente', () => { expect(contextoDoPedido({ id: a, nome: 'Cliente A' }, '  Fazer vídeo  ')).toBe(`Cliente: Cliente A\nReferência do cliente: ${a}\n\nFazer vídeo`); });
});
