import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DocumentoDoContrato from "@/components/contratos/DocumentoDoContrato";
import { PartesDoDiff } from "@/components/contratos/DiffDeTexto";
import ContractPublic from "@/pages/ContractPublic";
import { diffDeTexto, montarContrato, valoresComPadrao, variaveisDoContrato } from "../../supabase/functions/_shared/contrato-modelo";
import { MODELOS_V1 } from "../../supabase/functions/contratos/modulos/contrato-modelo-v1";

/**
 * Frente CON (30/09): a prévia HTML desenha o mesmo texto que é congelado,
 * marca o que falta, mostra o código; a diferença aparece antes de a cláusula
 * mudar; o link público assina o contrato de modelo com nome, e-mail, aceite e
 * o hash que o cliente viu.
 */

const AGENCIA = { razao_social: "Aceleriq Ltda", nome_fantasia: "Aceleriq", cnpj: "1", endereco: "Rua A", cidade: "Londrina", uf: "PR", representante: "Almir", representante_cpf: "", email: "", foro: "Londrina/PR" };

function texto(valores: Record<string, string> = {}) {
  const vars = variaveisDoContrato(MODELOS_V1, ["design"]);
  return montarContrato({ modelos: MODELOS_V1, servicos: ["design"], valores: valoresComPadrao(vars, valores), agencia: AGENCIA, numero: "CT-2026-0003", versao: 1, data: "2026-09-30" }).texto;
}

afterEach(() => vi.unstubAllGlobals());

describe("contratos: prévia e diferença", () => {
  it("desenha o documento com quadro, cláusulas e o que falta marcado", () => {
    const { container } = render(<DocumentoDoContrato texto={texto()} alteradas={["A.2"]} />);
    expect(screen.getByRole("heading", { name: "Contrato de prestação de serviços" })).toBeTruthy();
    expect(screen.getByText("Quadro-resumo")).toBeTruthy();
    expect(screen.getByText("Contratada")).toBeTruthy();
    expect(container.querySelectorAll("[data-falta]").length).toBeGreaterThan(0);
    expect(screen.getByText("Prévia")).toBeTruthy();
    expect(screen.getByText("alterada")).toBeTruthy();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("congelado mostra o código e nenhuma marca de falta", () => {
    const completo = texto({ cliente_nome: "Padaria", cliente_documento: "11.222.333/0001-44", cliente_endereco: "Av. B", cliente_email: "a@b.com", inicio: "2026-10-01", valor_hora_extra: "150", valor_total: "900", design_pecas: "1 folder", design_finalidade: "loja", design_prazo_dias: "5" });
    const { container } = render(<DocumentoDoContrato texto={completo} hash={"ab12".repeat(16)} />);
    expect(container.querySelectorAll("[data-falta]").length).toBe(0);
    expect(screen.getByTitle(`SHA-256 ${"ab12".repeat(16)}`)).toBeTruthy();
  });

  it("a diferença mostra o que sai e o que entra", () => {
    const { container } = render(<PartesDoDiff partes={diffDeTexto("inclui 2 rodadas", "inclui 3 rodadas")} />);
    expect(container.querySelector("[data-saiu]")!.textContent).toContain("2");
    expect(container.querySelector("[data-entrou]")!.textContent).toContain("3");
  });
});

describe("contratos: link público do contrato de modelo", () => {
  it("mostra o texto congelado e assina com nome, e-mail, aceite e o hash visto", async () => {
    const hash = "c".repeat(64);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init && init.method === "POST") return new Response(JSON.stringify({ ok: true, pdf_url: "https://x/assinado.pdf" }), { status: 200 });
      return new Response(JSON.stringify({
        contract: { title: "Contrato de design", status: "sent", origem: "modelo", numero: "CT-2026-0003", versao: 1, documento_texto: texto(), documento_hash: hash, admin_signature_name: "Almir", admin_signed_at: "2026-09-30T12:00:00Z", client_signed_at: null, original_file_name: "c.pdf", pdf_url: null },
        client: { full_name: "Maria", company_name: "Padaria", email: "maria@padaria.com" },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/contrato/tok123"]}>
        <Routes>
          <Route path="/contrato/:token" element={<ContractPublic />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByDisplayValue("maria@padaria.com")).toBeTruthy());
    await waitFor(() => expect(document.querySelector("[data-documento-do-contrato]")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Assinar contrato/ }));
    await waitFor(() => expect(screen.getByText("Contrato assinado")).toBeTruthy());
    const post = fetchMock.mock.calls.find((c) => c[1] && (c[1] as RequestInit).method === "POST")!;
    const corpo = JSON.parse(String((post[1] as RequestInit).body));
    expect(corpo).toEqual({ token: "tok123", signature_name: "Maria", email: "maria@padaria.com", accept: true, hash });
  });

  it("link substituído por versão nova avisa e não deixa assinar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "substituido" }), { status: 410 })));
    render(
      <MemoryRouter initialEntries={["/contrato/velho"]}>
        <Routes>
          <Route path="/contrato/:token" element={<ContractPublic />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Este link foi substituído")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Assinar contrato/ })).toBeNull();
  });
});
