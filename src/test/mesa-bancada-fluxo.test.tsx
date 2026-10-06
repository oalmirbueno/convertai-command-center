import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PenLine, Send } from "lucide-react";
import Bancada, { PainelDaBancada, SelecaoDaBancada } from "@/components/mesa/BancadaDaPauta";
import { prepararPautaPlanejada } from "@/components/mesa/PautaPlanejada";
import type { ItemDoMes } from "@/components/mesa/useItensDoMes";

const chamar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mesa/api", async (original) => ({ ...await original<object>(), chamarFuncao: chamar }));
vi.mock("@/components/mesa/LogoNaFoto", () => ({ default: () => null }));
vi.mock("@/components/mesa-foto/AcoesProDaFoto", () => ({ default: () => null }));

function Exemplo() {
  const [aba, setAba] = useState("gerar"); const [aberto, abrir] = useState(false);
  return <Bancada tipo="video" titulo="Pauta" ativa={aba} onAba={setAba}
    abas={[{ id: "gerar", nome: "Gerar", icone: PenLine }, { id: "entrega", nome: "Aprovação", icone: Send }]}
    prancheta={<p>Vídeo pronto</p>} previa={<p>Prévia</p>}
    ferramentas={<><PainelDaBancada id="gerar"><input aria-label="Direção" defaultValue="Loja real" /><button onClick={() => abrir(true)}>Escolher referências</button>{aberto && <SelecaoDaBancada><p>Fotos do cliente</p><button onClick={() => abrir(false)}>Usar fotos</button></SelecaoDaBancada>}</PainelDaBancada><PainelDaBancada id="entrega"><p>Legenda e aprovação</p></PainelDaBancada></>} />;
}
describe("Bancada: continuidade real entre ferramentas", () => {
  it("troca pelo ícone e preserva o rascunho", () => {
    render(<Exemplo />); fireEvent.change(screen.getByLabelText("Direção"), { target: { value: "Óculos na loja" } });
    fireEvent.click(screen.getByRole("button", { name: "Aprovação", exact: true }));
    expect(screen.getByText("Legenda e aprovação")).toBeVisible(); expect(screen.getByLabelText("Direção")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Gerar", exact: true })); expect(screen.getByLabelText("Direção")).toHaveValue("Óculos na loja");
  });
  it("escolhe fotos à esquerda e devolve a prancheta ao concluir", () => {
    render(<Exemplo />); fireEvent.click(screen.getByText("Escolher referências"));
    const prancheta = screen.getByRole("complementary", { name: "Prancheta" });
    expect(within(prancheta).getByText("Fotos do cliente")).toBeVisible(); expect(screen.getByText("Vídeo pronto")).not.toBeVisible();
    fireEvent.click(screen.getByText("Usar fotos")); expect(screen.getByText("Vídeo pronto")).toBeVisible(); expect(screen.queryByText("Fotos do cliente")).not.toBeInTheDocument();
  });
});
const pauta = (id: string): ItemDoMes => ({ id, title: "Fotos", delivery_type: "static", project_id: "projeto", due_date: "2026-10-09", status: "todo", planejamento: { proposta_id: "plano", tema_id: id } });
describe("Preparar pauta oficial", () => {
  it("coalesce chamadas concorrentes e usa o vínculo confirmado pelo servidor", async () => {
    chamar.mockResolvedValueOnce({ proposta: { itens: [{ tema_id: "tema-a", task_id: "tarefa-real" }] } });
    const item = pauta("tema-a"); const a = prepararPautaPlanejada(item); const b = prepararPautaPlanejada(item);
    expect(a).toBe(b); expect(await a).toBe("tarefa-real");
    expect(chamar).toHaveBeenLastCalledWith("agente-calendario", { acao: "gravar", proposta_id: "plano", tema_ids: ["tema-a"], project_id: "projeto" });
  });
  it("resposta sem tarefa não anuncia sucesso e permite tentar novamente", async () => {
    chamar.mockResolvedValueOnce({}); await expect(prepararPautaPlanejada(pauta("tema-b"))).rejects.toThrow("confirmar");
    chamar.mockResolvedValueOnce({ itens: [{ task_id: "recuperada" }] }); expect(await prepararPautaPlanejada(pauta("tema-b"))).toBe("recuperada");
  });
});
