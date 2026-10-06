type Foto = { id: string; client_id: string; derivada_de: string | null; aprovada: boolean | null; ativa: boolean; criado_em: string };

/** Uma aprovação promove a versão mais recente da mesma linhagem, nunca outra composição. */
export function referenciaAprovadaMaisRecente<T extends Foto>(fotos: T[], atualId: string, clientId: string): T | null {
  const doCliente = fotos.filter((f) => f.client_id === clientId);
  const porId = new Map(doCliente.map((f) => [f.id, f]));
  const raiz = (id: string) => {
    let f = porId.get(id);
    const vistos = new Set<string>();
    while (f?.derivada_de && porId.has(f.derivada_de) && !vistos.has(f.id)) {
      vistos.add(f.id); f = porId.get(f.derivada_de);
    }
    return f?.id;
  };
  const origem = raiz(atualId);
  if (!origem) return null;
  return doCliente.filter((f) => f.ativa && f.aprovada && raiz(f.id) === origem)
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em) || b.id.localeCompare(a.id))[0] || null;
}
