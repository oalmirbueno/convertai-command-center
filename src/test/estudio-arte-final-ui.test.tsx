import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Enviar arte final pronta" no Estúdio (12/11/2026): controle separado da
 * referência; o arquivo vai para estudio-arte importar_arte_final (o caminho de
 * gravação da arte) e nunca para o upload de referência; lâmina travada recusa.
 */

const estado = vi.hoisted(() => ({ chamar: vi.fn(), subirReferencia: vi.fn(), toastOk: vi.fn(), toastErro: vi.fn() }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: (...a: unknown[]) => estado.chamar(...a), textoDoErro: (e: Error) => e.message }));
vi.mock("@/lib/mesa/referencias", () => ({ subirReferencia: (...a: unknown[]) => estado.subirReferencia(...a), chaveDasReferenciasComDestaque: () => ["refs"] }));
vi.mock("@/lib/mesa/marcas", () => ({ marcaParaGravarAgora: () => null }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "cliente-a" }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => estado.toastOk(...a), error: (...a: unknown[]) => estado.toastErro(...a) } }));

import EstudioArteFinalPronta, { arteFinalTravada } from "@/components/mesa/EstudioArteFinalPronta";
import EstudioReferenciaNaHora from "@/components/mesa/EstudioReferenciaNaHora";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const arquivo = (tipo = "image/png", nome = "arte.png") => new File([new Uint8Array(64).fill(7)], nome, { type: tipo });

function montar(props: Partial<Parameters<typeof EstudioArteFinalPronta>[0]> = {}) {
  const onGravado = vi.fn();
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <EstudioReferenciaNaHora escolhidas={[]} onGravar={vi.fn()} alvoRotulo="lâmina 1" />
      <EstudioArteFinalPronta trabalhoId="trabalho-a" ordem={1} versaoAtual={0} onGravado={onGravado} {...props} />
    </QueryClientProvider>,
  );
  return { onGravado };
}

beforeEach(() => {
  estado.chamar.mockReset().mockResolvedValue({ trabalho: { id: "trabalho-a" }, versao: 1 });
  estado.subirReferencia.mockReset();
  estado.toastOk.mockReset();
  estado.toastErro.mockReset();
});

describe("Estúdio: arte final pronta", () => {
  it("aparece numa seção própria, separada da referência, e deixa claro que não é referência", () => {
    montar();
    const secao = screen.getByRole("region", { name: "Arte final da lâmina" });
    expect(within(secao).getByRole("button", { name: "Enviar arte final pronta" })).toBeInTheDocument();
    expect(within(secao).getByText("Use quando a arte já está pronta. Ela entra direto na lâmina, sem gastar Gerar.")).toBeInTheDocument();
    expect(within(secao).getByText("(não é referência)")).toBeInTheDocument();
    // A referência continua no seu bloco, fora da seção da arte final.
    expect(within(secao).queryByText(/Arquivo/)).not.toBeInTheDocument();
    expect(within(secao).queryByPlaceholderText(/Cole/i)).not.toBeInTheDocument();
  });

  it("o arquivo vai para importar_arte_final (gravação da arte) e não para a referência", async () => {
    const { onGravado } = montar();
    fireEvent.change(screen.getByTestId("arquivo-arte-final"), { target: { files: [arquivo()] } });
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    const [funcao, corpo] = estado.chamar.mock.calls[0];
    expect(funcao).toBe("estudio-arte");
    expect(corpo).toMatchObject({ acao: "importar_arte_final", trabalho_id: "trabalho-a", ordem: 1, versao_esperada: 0 });
    expect(typeof corpo.imagem_base64).toBe("string");
    expect(corpo.pedido_id).toMatch(/^[0-9a-f-]{36}$/);
    // Nada de Gerar, Preparar direção, referência ou modelo neste caminho.
    expect(estado.chamar.mock.calls.map((c) => c[1].acao)).toEqual(["importar_arte_final"]);
    expect(estado.subirReferencia).not.toHaveBeenCalled();
    await waitFor(() => expect(onGravado).toHaveBeenCalledWith(expect.objectContaining({ versao: 1 })));
    expect(estado.toastOk).toHaveBeenCalled();
  });

  it("já com arte: pede confirmação antes de substituir; cancelar não envia", async () => {
    montar({ versaoAtual: 2 });
    expect(screen.getByRole("button", { name: "Substituir arte final" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("arquivo-arte-final"), { target: { files: [arquivo()] } });
    expect(screen.getByRole("alertdialog", { name: "Confirmar troca da arte final" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(estado.chamar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("arquivo-arte-final"), { target: { files: [arquivo()] } });
    fireEvent.click(screen.getByRole("button", { name: "Sim, substituir" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1]).toMatchObject({ acao: "importar_arte_final", versao_esperada: 2 });
  });

  it("lâmina travada: botão desligado com o motivo e o arquivo é recusado sem chamar o servidor", () => {
    montar({ versaoAtual: 1, bloqueado: true, motivoDoBloqueio: "Trabalho entregue ou em aprovação: reabra para corrigir antes de trocar a arte." });
    expect(screen.getByRole("button", { name: "Substituir arte final" })).toBeDisabled();
    expect(screen.getByText(/reabra para corrigir/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("arquivo-arte-final"), { target: { files: [arquivo()] } });
    expect(estado.chamar).not.toHaveBeenCalled();
    expect(estado.toastErro).toHaveBeenCalled();
  });

  it("a recusa do servidor (trava) aparece em português, legível", async () => {
    estado.chamar.mockRejectedValueOnce(new Error("Esta lâmina está travada: o trabalho já foi entregue."));
    montar();
    fireEvent.change(screen.getByTestId("arquivo-arte-final"), { target: { files: [arquivo()] } });
    await waitFor(() => expect(estado.toastErro).toHaveBeenCalledWith("A arte final não entrou na lâmina", { description: "Esta lâmina está travada: o trabalho já foi entregue." }));
  });

  it("aceita só PNG; recusa JPEG, WEBP e outro tipo antes de enviar", async () => {
    montar();
    for (const [tipo, nome] of [["image/gif", "a.gif"], ["image/webp", "a.webp"], ["image/jpeg", "a.jpg"]]) {
      fireEvent.change(screen.getByTestId("arquivo-arte-final"), { target: { files: [arquivo(tipo, nome)] } });
    }
    expect(estado.chamar).not.toHaveBeenCalled();
    expect(estado.toastErro).toHaveBeenCalledTimes(3);
    expect(estado.toastErro).toHaveBeenCalledWith("Arquivo não aceito", { description: "Use uma imagem PNG." });
    expect(screen.getByTestId("arquivo-arte-final").getAttribute("accept")).toBe("image/png");
  });

  it("a trava da tela é a mesma do servidor", () => {
    expect(arteFinalTravada({ status: "dirigido" })).toBe(false);
    expect(arteFinalTravada({ status: "pronto", entrega_status: "reprovado" })).toBe(false);
    for (const t of [{ status: "entregue" }, { status: "pronto", entrega_status: "agendado" }, { status: "pronto", entrega_status: "aguardando_agencia" }, { status: "pronto", entrega_status: "aprovado" }]) {
      expect(arteFinalTravada(t)).toBe(true);
    }
  });

  it("no Estúdio, a arte final fica na ferramenta Lâmina, fora da faixa de referência", () => {
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    const card = ler("src/components/mesa/CardDoEstudio.tsx");
    expect(aba).toMatch(/arteFinal=\{\s*<EstudioArteFinalPronta/);
    expect(aba).toMatch(/bloqueado=\{arteFinalTravada\(trabalho\)/);
    // A referência na hora segue igual (só configurar referencias_ids da lâmina).
    expect(aba).toMatch(/<EstudioReferenciaNaHora[\s\S]{0,200}onGravar=\{\(ids\) => configurar\(\{ card: \{ ordem: cardSelecionado\.ordem, referencias_ids: ids \} \}\)\}/);
    expect(card).toMatch(/\{arteFinal\}/);
  });
});
