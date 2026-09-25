/**
 * Fotos do plano de imagens da campanha (mesa_campanhas.plano_imagens) nas
 * lâminas do Estúdio. Lógica pura, sem rede e sem banco: o agente-calendario
 * (direção pronta no gravar) e o estudio-arte (preparar pelo roteiro e pelo
 * diretor) usam o mesmo código, e os testes também.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (v: unknown, max = 4000) => (v == null ? "" : String(v)).slice(0, max).trim();

/** Uma peça do plano já gravado: a foto (id do acervo) de uma lâmina de um conteúdo. */
export type PecaGravada = { tema_id: string; ordem: number; imagem_id: string; uso: "fundo" | "elemento"; por_que: string };

/** Foto do acervo que a peça usa (o mínimo para virar imagens_ids ou fotos_livres). */
export type FotoDaPeca = { id: string; storage_bucket: string; storage_path: string; nome: string };

/** Referência baixada da internet (Mesa Foto) não é publicável: não entra na campanha nem na lâmina. */
export const fotoNaoPublicavel = (f: { tags?: string[] | null }) => (f.tags ?? []).some((t) => t === "nao_publicar" || t === "referencia_web");

/** Peças do plano gravado na campanha (só as com foto), lidas com cuidado: o JSON veio do banco. */
export function pecasDoPlanoGravado(bruto: unknown): PecaGravada[] {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  return (Array.isArray(o.pecas) ? o.pecas : [])
    .map((p) => {
      const x = (p ?? {}) as Record<string, unknown>;
      return {
        tema_id: texto(x.tema_id, 40),
        ordem: Number(x.ordem),
        imagem_id: String(x.imagem_id ?? ""),
        uso: x.uso === "elemento" ? "elemento" as const : "fundo" as const,
        por_que: texto(x.por_que, 500),
      };
    })
    .filter((p) => p.tema_id && Number.isInteger(p.ordem) && p.ordem >= 1 && UUID.test(p.imagem_id));
}

/**
 * Foto do plano de imagens da campanha em cada lâmina da direção pronta:
 * uso "fundo" vira imagens_ids (a foto do acervo é a base e fica como está;
 * nunca a mesma foto em duas lâminas); uso "elemento" vira fotos_livres
 * (papel elemento) quando a foto está no bucket mesa. Carrossel contínuo não
 * recebe foto: a lâmina com foto sai do panorama e quebra a cena.
 */
export function aplicarFotosDoPlano(
  direcao: {
    carrossel_infinito: boolean;
    cards: { ordem: number; imagens_ids?: string[]; fotos_livres?: { caminho: string; papel: "fundo" | "elemento"; nota?: string }[] }[];
  },
  temaId: string,
  pecas: PecaGravada[],
  fotos: Map<string, FotoDaPeca>,
): number {
  if (direcao.carrossel_infinito) return 0;
  const usadas = new Set<string>();
  let n = 0;
  for (const card of direcao.cards) {
    const peca = pecas.find((p) => p.tema_id === temaId && p.ordem === card.ordem);
    const foto = peca ? fotos.get(peca.imagem_id) : undefined;
    if (!peca || !foto) continue;
    if (peca.uso === "fundo") {
      if (usadas.has(foto.id)) continue;
      usadas.add(foto.id);
      card.imagens_ids = [foto.id];
      n++;
    } else if ((foto.storage_bucket || "mesa") === "mesa") {
      card.fotos_livres = [{ caminho: foto.storage_path, papel: "elemento", nota: texto(`${foto.nome}: ${peca.por_que}`, 300) }];
      n++;
    }
  }
  return n;
}
