// MCP 2.38.0 (20/11/2026), 2.38.1 (nomes com extensão): a ordem do carrossel que o MCP confere é a MESMA do painel.
import { describe, expect, it } from "vitest";
import {
  editorialMediaOrderIndex,
  inferEditorialMediaContentType,
  orderEditorialCarouselFiles,
} from "@/lib/editorialMedia";
import {
  indiceDaOrdem,
  nomeDoCard,
  ordemSemDesempate,
  ordenarComoOPainel,
  planoDoAgrupamento,
  tipoDoPostDoArquivo,
} from "../../supabase/functions/mcp-server/modulos/carrossel-de-arquivos";

const casos = [
  { file_name: "x", storage_path: "c/r/v1/3-card-03.png" },
  { file_name: "Post (4/5)", storage_path: "c/r/v1/card.png" },
  { file_name: "slide 7", storage_path: null },
  { file_name: "Página 2", storage_path: undefined },
  { file_name: "Post (2/5)", storage_path: "c/r/v1/9_x.png" },
  { file_name: "10 capa.png", storage_path: "c/r/v1/capa.png" },
  { file_name: "sem número", storage_path: "c/r/v1/sem.png" },
  { file_name: "card-01.png", storage_path: "c\\r\\v1\\12.x.png" },
];

describe("MCP 2.38 carrossel de Arquivos", () => {
  it("índice da ordem igual a editorialMediaOrderIndex", () => {
    for (const c of casos) {
      expect(indiceDaOrdem(c)).toBe(editorialMediaOrderIndex({ id: "a", ...c }));
    }
  });

  it("ordenação igual a orderEditorialCarouselFiles (inclusive empate por created_at e id)", () => {
    const raiz = { id: "r", file_name: "capa", storage_path: "c/r/v1/capa.png" };
    const filhos = casos.map((c, i) => ({
      id: `f${i}`,
      ...c,
      created_at: i % 2 ? "2026-11-19T10:00:00Z" : null,
    }));
    const doPainel = orderEditorialCarouselFiles(raiz, filhos).map((f) => f.id);
    const doMcp = ordenarComoOPainel(raiz, filhos).map((f) => f.id);
    expect(doMcp).toEqual(doPainel);
  });

  it("depois de agrupar, o painel mostra a ordem pedida", () => {
    const base = {
      client_id: "c", project_id: "p", parent_file_id: null, file_type: null, folder: "entregas",
      mime_type: "image/png", status: "ready", archived_at: null, visibility: "internal",
      agency_approval_status: "not_requested", approval_status: "none", locked_at: null,
    };
    const lidos = ["a", "b", "c", "d"].map((id, i) => ({
      ...base, id, file_name: `card-0${i + 1}.png`, storage_path: `c/${id}/v1/card-0${i + 1}.png`,
      created_at: `2026-11-19T10:0${4 - i}:00Z`,
    }));
    const plano = planoDoAgrupamento(["a", "b", "c", "d"], lidos, new Set(), () => true);
    expect(plano.problemas).toEqual([]);
    const [raiz, ...filhos] = lidos.map((f, i) => ({ ...f, file_name: plano.cards[i].nome_depois }));
    expect(orderEditorialCarouselFiles(raiz, filhos).map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
    expect(nomeDoCard("card-01.png", 3, 4)).toBe("card-01 (3/4)");
  });

  it("content_type do post igual a inferEditorialMediaContentType", () => {
    const img = { id: "i", file_name: "a.png", mime_type: "image/png" };
    const vid = { id: "v", file_name: "a.mp4", mime_type: "video/mp4" };
    const pdf = { id: "p", file_name: "a.pdf", mime_type: "application/pdf" };
    for (const [raiz, filhos] of [[img, []], [img, [img]], [vid, [img]], [pdf, []], [img, [vid]]] as const) {
      expect(tipoDoPostDoArquivo(raiz, filhos)).toBe(inferEditorialMediaContentType(raiz, filhos));
    }
  });
  it("2.38.1: nomes com extensão viram \"<base> (i/N)\" e o painel lê a ordem pelo nome, sem desempate", () => {
    const base = {
      client_id: "c", project_id: "p", parent_file_id: null, file_type: null, folder: "entregas",
      mime_type: "image/png", status: "ready", archived_at: null, visibility: "internal",
      agency_approval_status: "not_requested", approval_status: "none", locked_at: null,
    };
    const casosDeNome = [
      ["[teste] carrossel (1/3).png", "[teste] carrossel (2/3).png", "[teste] carrossel (3/3).png"],
      ["[teste] carrossel (1/3)", "[teste] carrossel (2/3)", "[teste] carrossel (3/3)"],
      ["Stop Thainá (carrossel) (1/5)", "Stop Thainá (carrossel) (2/5)", "Stop Thainá (carrossel) (3/5)"],
      ["[teste] carrossel (1/3) (1/3).png", "[teste] carrossel (1/3) (2/3)", "[teste] carrossel (1/3) (3/3)"],
      ["Promo (1/3).jpg", "Promo (2/3).webp", "Promo (3/3).jpeg"],
    ];
    for (const nomes of casosDeNome) {
      // created_at ao contrário: se a ordem dependesse do desempate, sairia invertida.
      const lidos = nomes.map((file_name, i) => ({
        ...base, id: `f${i}`, file_name, storage_path: `c/f${i}/v1/carrossel.png`, created_at: `2026-11-20T10:0${5 - i}:00Z`,
      }));
      const plano = planoDoAgrupamento(["f0", "f1", "f2"], lidos, new Set(), () => true);
      expect(plano.problemas).toEqual([]);
      expect(plano.ordem_confere).toBe(true);
      const depois = lidos.map((f, i) => ({ ...f, file_name: plano.cards[i].nome_depois }));
      for (const f of depois) expect(f.file_name).not.toMatch(/\.(png|jpe?g|webp)$/i);
      expect(depois[2].file_name).toMatch(/ \(3\/[35]\)$/);
      expect(depois[2].file_name.match(/\(\d+\s*\/\s*\d+\)/g)).toHaveLength(1);
      const [raiz, ...filhos] = depois;
      expect(orderEditorialCarouselFiles(raiz, filhos).map((f) => f.id)).toEqual(["f0", "f1", "f2"]);
      expect(filhos.map((f) => editorialMediaOrderIndex(f))).toEqual([2, 3]);
      expect(ordemSemDesempate(filhos)).toBe(true);
    }
    // O nome que a 2.38.0 gravava: o painel lê a primeira "(a/b)" -> 1 e 1 (empate, created_at decide).
    const velhos = [{ id: "b", file_name: "[teste] carrossel (1/3) (2/3)" }, { id: "c", file_name: "[teste] carrossel (1/3) (3/3)" }];
    expect(velhos.map((f) => editorialMediaOrderIndex(f))).toEqual([1, 1]);
    expect(ordemSemDesempate(velhos)).toBe(false);
  });
});
