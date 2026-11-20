// MCP 2.38.0: banco de mentira para os testes de Arquivos (select/update com eq, is, in, maybeSingle).
// Não é teste (sem Deno.test): só apoio dos *_test.ts de carrossel, post da Agenda e envio.

export type Linha = Record<string, unknown>;
export type Tabelas = Record<string, Linha[]>;

export interface OpcoesDoBanco {
  /** UPDATE nestes ids não casa nenhuma linha (como se o estado tivesse mudado). */
  updateNaoCasa?: Set<string>;
  /** Erro de leitura nesta tabela. */
  leituraFalha?: string;
}

export interface BancoFalso {
  from(tabela: string): unknown;
  updates: Array<{ tabela: string; patch: Linha; ids: string[] }>;
}

export function bancoFalso(tabelas: Tabelas, opcoes: OpcoesDoBanco = {}): BancoFalso {
  const updates: BancoFalso['updates'] = [];
  return {
    updates,
    from(tabela: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let patch: Linha | null = null;
      let limite: number | null = null;
      const q: Record<string, unknown> = {};
      const executar = () => {
        if (opcoes.leituraFalha === tabela && !patch) return { data: null, error: { message: 'falha simulada' } };
        const linhas = tabelas[tabela] ?? (tabelas[tabela] = []);
        let casadas = linhas.filter((l) => filtros.every((f) => f(l)));
        if (patch) {
          casadas = casadas.filter((l) => !opcoes.updateNaoCasa?.has(String(l.id)));
          for (const l of casadas) Object.assign(l, patch);
          updates.push({ tabela, patch: { ...patch }, ids: casadas.map((l) => String(l.id)) });
        }
        if (limite != null) casadas = casadas.slice(0, limite);
        return { data: casadas.map((l) => ({ ...l })), error: null };
      };
      q.select = () => q;
      q.update = (p: Linha) => { patch = p; return q; };
      q.eq = (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; };
      q.neq = (c: string, v: unknown) => { filtros.push((l) => l[c] !== v); return q; };
      q.is = (c: string, v: unknown) => { filtros.push((l) => (l[c] ?? null) === v); return q; };
      q.in = (c: string, vs: unknown[]) => { filtros.push((l) => vs.includes(l[c])); return q; };
      q.order = () => q;
      q.limit = (n: number) => { limite = n; return q; };
      q.maybeSingle = () => Promise.resolve(executar()).then((r) => ({ data: (r.data as Linha[] | null)?.[0] ?? null, error: r.error }));
      q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, falha);
      return q;
    },
  };
}

/** umaVez igual ao real: a mesma chave (com o escopo) não refaz. */
export function umaVezFalso() {
  const chaves = new Set<string>();
  return (async (
    ferramenta: string,
    _ctx: unknown,
    chave: string,
    fazer: () => Promise<{ ref: string | null; resultado: Record<string, unknown> }>,
    escopo?: Record<string, string>,
  ) => {
    const k = `${ferramenta}|${chave}|${JSON.stringify(escopo ?? {})}`;
    if (chaves.has(k)) return { ok: true, replay: true };
    const { resultado } = await fazer();
    chaves.add(k);
    return { ok: true, ...resultado };
  }) as never;
}
