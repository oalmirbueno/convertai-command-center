import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import PropostaPublica from "@/pages/PropostaPublica";
import { conteudoDoModelo, MODELO_PADRAO_ACELERIQ } from "../../supabase/functions/_shared/proposta-modelo";

/**
 * 12. Link público da proposta: a data do aceite e a do envio são o dia de
 * São Paulo. Com o `slice(0, 10)` do texto UTC, aceita em 31/10 às 22h
 * aparecia "em 01/11/2026". Molde de mesa-proposta-publica.
 */

const TOKEN = "b".repeat(64);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("12. a proposta pública mostra o dia de São Paulo", () => {
  it("aceita e enviada em 31/10 às 22h aparecem como 31/10/2026", async () => {
    const proposta = {
      proposta: {
        id: "p1",
        numero: "2026-077",
        titulo: "Redes sociais",
        status: "aceita",
        validade_ate: "2026-12-31",
        enviada_em: "2026-11-01T01:00:00Z",
        conteudo: conteudoDoModelo(MODELO_PADRAO_ACELERIQ),
        itens: [{ id: "i1", nome: "Gestão de redes", valor_unitario: 1800, quantidade: 1, recorrencia: "mensal" }],
        total_unico: 0,
        total_mensal: 1800,
        cliente: "Loja da Joana",
        aceite: { nome: "Joana Lima", em: "2026-11-01T01:00:00Z" },
      },
      agencia: { nome: "Aceleriq" },
      logo_cliente_url: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => proposta }) as Response));
    render(
      <MemoryRouter initialEntries={[`/proposta/${TOKEN}`]}>
        <Routes>
          <Route path="/proposta/:token" element={<PropostaPublica />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Proposta aceita por Joana Lima em 31/10/2026.")).toBeTruthy();
    expect(screen.queryAllByText(/01\/11\/2026/)).toHaveLength(0);
    expect(screen.getAllByText(/31\/10\/2026/).length).toBeGreaterThan(1);
  });
});
