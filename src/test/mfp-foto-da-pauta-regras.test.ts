import { describe, expect, it } from "vitest";
import {
  contextoParaFoto, etiquetasDaFotoDaPauta, lerReferenciasComPapel, ordenarReferencias, paresDeTransformacao, promptDaFotoDaPauta,
} from "../../supabase/functions/mesa-foto/foto-da-pauta-regras";
import { acervoDaPauta, etiquetasOrganizadas, moverNaOrdem, usoDaFoto } from "@/components/mesa-foto/fotoDaPautaApi";
import type { FotoDoAcervo } from "@/components/mesa-foto/fotoApi";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("Foto da pauta: antes e depois chegam ao motor", () => {
  it("lê papéis, recusa papel desconhecido e não repete a mesma foto", () => {
    expect(lerReferenciasComPapel([{ imagem_id: id(1), papel: "antes" }, { imagem_id: id(1), papel: "depois" }, { imagem_id: id(2), papel: "depois" }]))
      .toEqual([{ imagem_id: id(1), papel: "antes" }, { imagem_id: id(2), papel: "depois" }]);
    expect(() => lerReferenciasComPapel([{ imagem_id: id(1), papel: "logo" }])).toThrow(/Papel/);
    expect(() => lerReferenciasComPapel([{ imagem_id: "x", papel: "antes" }])).toThrow();
    expect(() => lerReferenciasComPapel(Array.from({ length: 7 }, (_, i) => ({ imagem_id: `00000000-0000-4000-8000-0000000000${10 + i}`, papel: "estilo" })))).toThrow(/no máximo 6/);
  });

  it("põe antes e depois primeiro e monta a comparação fiel com os números certos", () => {
    const ordem = ordenarReferencias([{ papel: "estilo" as const, n: "e" }, { papel: "depois" as const, n: "d" }, { papel: "produto" as const, n: "p" }, { papel: "antes" as const, n: "a" }]);
    expect(ordem.map((r) => r.n)).toEqual(["a", "d", "p", "e"]);
    expect(paresDeTransformacao(ordem)).toEqual([{ antes: 0, depois: 1 }]);
    const prompt = promptDaFotoDaPauta({ pedido: "Sala reformada", titulo: "Reforma da sala", referencias: ordem, estiloTexto: "Luz suave de janela.", estilosDaBiblioteca: 1, formato: "4:5" });
    expect(prompt).toMatch(/a Imagem 1 é o ANTES e a Imagem 2 é o DEPOIS/);
    expect(prompt).toMatch(/não exagere nem invente o resultado do depois/);
    expect(prompt).toMatch(/Imagem 3: O PRODUTO/);
    expect(prompt).toMatch(/Imagens 4, 5: SÓ ESTILO/);
    expect(prompt).toMatch(/ESTILO VISUAL ESCOLHIDO: Luz suave de janela\./);
    expect(prompt).not.toMatch(/[—–]/);
  });

  it("só o antes não inventa resultado; contexto do cliente entra curto", () => {
    const prompt = promptDaFotoDaPauta({ pedido: "", referencias: [{ papel: "antes" }], contexto: contextoParaFoto({ nicho: "estética", marca: { estilo: "clean", paleta: [{ hex: "#aa00cc" }, { hex: "x" }] }, campanha_do_mes: { nome: "Outubro Rosa" }, cerebro_do_cliente: "Nada de foto escura." }, "Clínica Ana") });
    expect(prompt).toMatch(/Imagem 1: ESTADO ANTES \(real\)/);
    expect(prompt).not.toMatch(/TRANSFORMAÇÃO/);
    expect(prompt).toMatch(/marca Clínica Ana; segmento estética; cara da marca: clean; no clima da campanha Outubro Rosa/);
    expect(prompt).toMatch(/paleta de apoio #AA00CC/);
    expect(prompt).toMatch(/Nada de foto escura\./);
  });

  it("etiqueta a foto com a pauta e o par antes/depois", () => {
    expect(etiquetasDaFotoDaPauta({ taskId: "t1", referencias: [{ imagem_id: id(1), papel: "antes" }, { imagem_id: id(2), papel: "depois" }], estiloId: "e1" }))
      .toEqual(expect.arrayContaining(["pauta", "task:t1", "ref:antes", "ref:depois", "antes_e_depois", "estilo:e1"]));
  });
});

describe("Acervo da pauta: organizar e consultar", () => {
  const foto = (p: Partial<FotoDoAcervo>): FotoDoAcervo => ({ id: "f", client_id: "c1", nome: "Foto", storage_bucket: "mesa", storage_path: "c1/x.jpg", origem: "mesa", pasta: null, categoria: null, tags: [], descricao: null, ativa: true, derivada_de: null, gerada: false, modo: null, kit_id: null, aprovada: true, largura: 1080, altura: 1350, criado_em: "2026-10-01T00:00:00Z", referencia_web: false, ...p });
  it("favorita e uso viram etiquetas (um uso por foto)", () => {
    const t = etiquetasOrganizadas(["x", "uso:feed"], { favorita: true, uso: "stories" });
    expect(t).toEqual(["x", "favorita", "uso:stories"]);
    expect(etiquetasOrganizadas(t, { favorita: false, uso: null })).toEqual(["x"]);
    expect(usoDaFoto(foto({ tags: ["uso:anuncio"] }))).toBe("anuncio");
  });
  it("filtra, busca e ordena sem mostrar referência da internet nem outro cliente", () => {
    const fotos = [
      foto({ id: "a", nome: "Antes sala", criado_em: "2026-10-01T00:00:00Z" }),
      foto({ id: "b", nome: "Gerada", gerada: true, modo: "canvas", tags: ["favorita", "task:t1"], criado_em: "2026-10-03T00:00:00Z" }),
      foto({ id: "c", nome: "Web", referencia_web: true }),
      foto({ id: "d", nome: "Outro", client_id: "c2" }),
    ];
    expect(acervoDaPauta(fotos, { clientId: "c1" }).map((f) => f.id)).toEqual(["b", "a"]);
    expect(acervoDaPauta(fotos, { clientId: "c1", filtro: "reais" }).map((f) => f.id)).toEqual(["a"]);
    expect(acervoDaPauta(fotos, { clientId: "c1", filtro: "favoritas" }).map((f) => f.id)).toEqual(["b"]);
    expect(acervoDaPauta(fotos, { clientId: "c1", filtro: "desta_pauta", taskId: "t1" }).map((f) => f.id)).toEqual(["b"]);
    expect(acervoDaPauta(fotos, { clientId: "c1", busca: "sala", ordem: "antigas" }).map((f) => f.id)).toEqual(["a"]);
  });
  it("move na ordem do carrossel", () => {
    expect(moverNaOrdem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moverNaOrdem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});
