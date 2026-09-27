/**
 * Entrega do Estúdio em partes (AB2, 26/09). Para não passar do limite de CPU,
 * o estudio-arte abre no máximo 3 lâminas por chamada na entrega e, se faltar,
 * responde 409 "entrega_em_partes" com o que já foi para Arquivos. A entrega é
 * idempotente: chamar de novo continua de onde parou. Aqui a tela chama de novo
 * sozinha, até `maxRodadas` vezes, e só mostra o erro se ainda faltar.
 */
export const CODIGO_ENTREGA_EM_PARTES = "entrega_em_partes";

export async function repetirEntregaEmPartes<T>(chamar: () => Promise<T>, maxRodadas = 6): Promise<T> {
  for (let rodada = 1; ; rodada++) {
    try {
      return await chamar();
    } catch (e) {
      const codigo = e && typeof e === "object" ? (e as { codigo?: unknown }).codigo : null;
      if (codigo !== CODIGO_ENTREGA_EM_PARTES || rodada >= maxRodadas) throw e;
    }
  }
}
