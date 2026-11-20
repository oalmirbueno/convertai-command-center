// MCP 2.38.0 (20/11/2026): a ordem do carrossel que o MCP confere é a MESMA do painel.
import { describe, expect, it } from "vitest";
import {
  editorialMediaOrderIndex,
  inferEditorialMediaContentType,
  orderEditorialCarouselFiles,
} from "@/lib/editorialMedia";
import {
  indiceDaOrdem,
  nomeDoCard,
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
});
