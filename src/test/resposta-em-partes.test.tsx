import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", async () => {
  const real = await vi.importActual<typeof import("recharts")>("recharts");
  const react = await vi.importActual<typeof import("react")>("react");
  const Fixo = ({ children }: { children: import("react").ReactElement }) => react.cloneElement(children, { width: 400, height: 220 });
  return { ...real, ResponsiveContainer: Fixo };
});
import { baloesDoTexto, MARCA_DOS_BLOCOS, semIntroducaoVazia, separarResposta, textoParcialSemBlocos } from "../../supabase/functions/_shared/resposta-em-partes";
import { apresentarMensagens } from "../../supabase/functions/gestor-aceleriq/modulos/hermes";
import RespostaEmPartes from "@/components/agentes/respostas/RespostaEmPartes";

const quadro = (obj: unknown) => `\`\`\`${MARCA_DOS_BLOCOS}\n${JSON.stringify(obj)}\n\`\`\``;
const grafico = { blocos: [{ tipo: "grafico", titulo: "Execuções", tipo_grafico: "barras", series: [{ nome: "Agentes", pontos: [{ x: "Atlas", y: 4 }, { x: "Augusto", y: 2 }] }], unidade: null, fontes: ["aceleriq_operator_board"] }] };
const fluxo = { blocos: [{ tipo: "fluxo", titulo: "Como coordeno", natureza: "registro", passos: [{ id: "a", rotulo: "Recebo", detalhe: null, estado: "concluido" }, { id: "b", rotulo: "Delego", detalhe: null, estado: null }], ligacoes: [{ de: "a", para: "b", rotulo: null }] }] };

describe("resposta em partes: o mesmo sistema de apresentação para quem responde em texto", () => {
  it("texto longo vira balões curtos, sem quebrar tabela e sem introdução de cortesia", () => {
    const longo = ["Claro! Aqui está o resumo da operação:", "A".repeat(500), "B".repeat(500), "| a | b |\n|---|---|\n| 1 | 2 |"].join("\n\n");
    const b = baloesDoTexto(semIntroducaoVazia(longo));
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect(b.some((x) => x.includes("| a | b |") && x.includes("| 1 | 2 |"))).toBe(true);
    expect(semIntroducaoVazia("Claro! Aqui está o relatório: A semana foi boa.")).toBe("A semana foi boa.");
  });

  it("número em quadro só com a ferramenta do turno; fluxo é sempre Proposta", () => {
    const texto = `A operação está andando.\n\n${quadro(grafico)}\n\n${quadro(fluxo)}`;
    const sem = separarResposta(texto, { fontesConhecidas: [] });
    expect(sem.partes.flatMap((p) => (p.tipo === "blocos" ? p.blocos.map((x) => x.tipo) : []))).toEqual(["fluxo"]);
    expect(sem.recusados.length).toBe(1);
    const com = separarResposta(texto, { fontesConhecidas: ["aceleriq_operator_board"] });
    const tipos = com.partes.flatMap((p) => (p.tipo === "blocos" ? p.blocos : []));
    expect(tipos.map((x) => x.tipo)).toEqual(["grafico", "fluxo"]);
    const f = tipos.find((x) => x.tipo === "fluxo") as { natureza: string; passos: Array<{ estado: string }> };
    expect(f.natureza).toBe("proposta");
    expect(f.passos.every((p) => p.estado === "planejado")).toBe(true);
  });

  it("durante o stream o quadro incompleto não aparece cru", () => {
    const r = textoParcialSemBlocos(`Vou montar.\n\n\`\`\`${MARCA_DOS_BLOCOS}\n{"blocos":[{"tipo":"gra`);
    expect(r.texto).toBe("Vou montar.");
    expect(r.montando).toBe(true);
  });

  it("Hermes: fontes = ferramentas chamadas no turno; entrega com id inexistente sai; evidência é a saída da ferramenta", async () => {
    const msgs = [
      { id: 1, papel: "user", texto: "Me atualize", ferramenta: null, chamadas: [], quando: 1 },
      { id: 2, papel: "assistant", texto: "", ferramenta: null, chamadas: ["aceleriq_operator_board"], quando: 2 },
      { id: 3, papel: "tool", texto: "{\"execucoes\": 6}", ferramenta: "aceleriq_operator_board", chamadas: [], quando: 3 },
      { id: 4, papel: "assistant", texto: `Seis execuções.\n\n${quadro(grafico)}\n\n${quadro({ blocos: [{ tipo: "entrega", nome: "Tarefa X", tipo_objeto: "tarefa", objeto: { tipo: "tarefa", id: "00000000-0000-4000-8000-000000000009", titulo: null, client_id: null }, estado: "todo", cliente: null, proxima: null }] })}`, ferramenta: null, chamadas: [], quando: 4 },
      { id: 5, papel: "user", texto: "E agora?", ferramenta: null, chamadas: [], quando: 5 },
      { id: 6, papel: "assistant", texto: quadro(grafico), ferramenta: null, chamadas: [], quando: 6 },
    ];
    const banco = { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) } as never;
    const r = await apresentarMensagens(msgs, banco);
    const quarta = r.find((m) => m.id === 4)!;
    expect(quarta.partes!.flatMap((p) => (p.tipo === "blocos" ? p.blocos.map((x) => x.tipo) : []))).toEqual(["grafico"]);
    expect(quarta.recusados).toContain("entrega com id que não existe no OS");
    expect(quarta.evidencias).toEqual({ aceleriq_operator_board: "{\"execucoes\": 6}" });
    // Turno novo sem ferramenta: o mesmo gráfico não vale.
    const sexta = r.find((m) => m.id === 6)!;
    expect(sexta.partes!.length).toBe(0);
    expect(sexta.recusados!.length).toBe(1);
  });

  it("na tela: balões, quadro e a fonte abre a evidência real", () => {
    const r = separarResposta(`Seis execuções.\n\n${quadro(grafico)}`, { fontesConhecidas: ["aceleriq_operator_board"] });
    render(<RespostaEmPartes texto="" partes={r.partes} recusados={r.recusados} evidencias={{ aceleriq_operator_board: "{\"execucoes\": 6}" }} />);
    expect(screen.getByText("Seis execuções.")).toBeTruthy();
    expect(screen.getByText("Execuções")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /aceleriq_operator_board/ }));
    expect(screen.getByText(/"execucoes": 6/)).toBeTruthy();
  });
});
