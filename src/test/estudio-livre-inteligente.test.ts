import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  criteriosDosPares,
  fontesDoPar,
  fontesGravadasDoLivre,
  paresDaBiblioteca,
  paresParaOPedido,
  type FonteDaBiblioteca,
} from "../../supabase/functions/estudio-arte/modulos/fontes-do-livre";

/**
 * 20/10/2026 (dono, com o print "Lâmina 1 não foi gerada: defina a tipografia do cliente"): "está muito
 * burro, sendo que ele é avulso; tem que ser mais inteligente e não dar esse erro; já tem que entender,
 * pesquisar e gerar, buscar referências também online".
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

const fonte = (id: string, familia: string, extra: Partial<FonteDaBiblioteca> = {}): FonteDaBiblioteca => ({
  id, familia, categoria: "sans", personalidade: [], usos: [], nichos: [], pareamentos: [], amostra_path: `biblioteca/fontes/${id}/amostra.png`, ...extra,
});

const biblioteca: FonteDaBiblioteca[] = [
  fonte("a", "Abril Fatface", { nichos: ["moda", "revista"], pareamentos: [{ com: "Lato", papel_desta: "título", porque: "drama elegante" }] }),
  fonte("b", "Lato"),
  fonte("c", "Bebas Neue", { nichos: ["churrasco", "evento", "esporte"], personalidade: ["forte", "masculina"], pareamentos: [{ com: "Lato", papel_desta: "título", porque: "impacto" }] }),
  fonte("d", "Lora", { pareamentos: [{ com: "Abril Fatface", papel_desta: "texto", porque: "serifada de leitura" }] }),
];

describe("fontes da arte livre", () => {
  it("monta os pares recomendados pela biblioteca, título e texto no papel certo, sem repetir", () => {
    const pares = paresDaBiblioteca(biblioteca);
    expect(pares.map((p) => `${p.titulo.familia}+${p.texto.familia}`)).toEqual(["Abril Fatface+Lato", "Bebas Neue+Lato", "Abril Fatface+Lora"]);
  });

  it("os pares mais ligados ao pedido vêm primeiro", () => {
    const pares = paresParaOPedido(paresDaBiblioteca(biblioteca), "Chá de bebê dos homens com churrasco: evento de sábado");
    expect(pares[0].titulo.familia).toBe("Bebas Neue");
    expect(Object.keys(criteriosDosPares(pares))).toEqual(["par_0", "par_1", "par_2"]);
  });

  it("o par vira as fontes do gerador com a amostra da biblioteca, e o gravado volta igual", () => {
    const fontes = fontesDoPar(paresDaBiblioteca(biblioteca)[1]);
    expect(fontes).toEqual([
      { id: "c", nome: "Bebas Neue", papel: "titulo", amostra_path: "biblioteca/fontes/c/amostra.png" },
      { id: "b", nome: "Lato", papel: "texto", amostra_path: "biblioteca/fontes/b/amostra.png" },
    ]);
    expect(fontesGravadasDoLivre(JSON.parse(JSON.stringify(fontes)))).toEqual(fontes);
    expect(fontesGravadasDoLivre(null)).toEqual([]);
  });

  it("amostra fora da pasta da biblioteca não entra", () => {
    const [titulo] = fontesDoPar({ titulo: fonte("x", "X", { amostra_path: "outro-cliente/x.png" }), texto: fonte("y", "Y"), porque: "" });
    expect(titulo.amostra_path).toBeNull();
  });
});

describe("o servidor da arte livre", () => {
  const srv = ler("supabase/functions/estudio-arte/index.ts");

  it("sem fonte gravada, escolhe o par da biblioteca em vez de recusar", () => {
    expect(srv).toContain("const fontes = !fontesLidas.length && livre ? await escolherFontesDoLivre(t, ch.userId) : fontesLidas;");
    expect(srv).toContain('from("estudio_livre_trabalhos").update({ fontes })');
    expect(ler("supabase/migrations/20261020005142_estudio_livre_fontes.sql")).toContain("ADD COLUMN IF NOT EXISTS fontes jsonb");
  });

  it("o diretor pesquisa na web em toda arte livre", () => {
    expect(srv).toContain("pesquisaWeb: mundoReal || semMarca || undefined,");
    expect(srv).toContain("pesquise na web (a pesquisa está ligada)");
  });

  it("nada da marca do cliente interno entra: referências, artes publicadas e regras aprendidas", () => {
    expect(srv).toContain("const { data: emDestaque } = livre ? { data: [] as Referencia[] } : await filtrarReferenciasDaMarca(");
    expect(srv).toContain("livre ? Promise.resolve({ data: [] as Referencia[] }) : filtrarReferenciasDaMarca(");
    expect(srv).toContain("livre ? null : await artePublicadaMaisRecente(t.client_id, marcaDoTrabalho)");
    expect(srv).toContain('livre ? Promise.resolve("") : preferenciasDaArte(t.client_id)');
  });
});
