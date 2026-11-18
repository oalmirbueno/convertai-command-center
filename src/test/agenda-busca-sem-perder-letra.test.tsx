import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CampoDeBusca } from "@/components/editorial/EditorialToolbar";

/** Pai com o sinal de reset do "Limpar filtros". */
function PaiComReset({ onPai }: { onPai: (api: { aplicar: (v: string) => void; resetar: () => void }) => void }) {
  const [valor, setValor] = useState("");
  const [reset, setReset] = useState(0);
  onPai({ aplicar: setValor, resetar: () => setReset((r) => r + 1) });
  return <CampoDeBusca valor={valor} onMudar={() => undefined} versaoDoReset={reset} />;
}

/**
 * Busca da Agenda (12/11/2026): "Softy" virou "Sy — criativosy". A busca mora
 * no endereço (?q=) e o React Router 7 aplica o endereço em startTransition,
 * então o valor volta para o campo atrasado. O campo não pode perder letra nem
 * voltar para um valor velho da própria digitação. Em foco, o endereço não
 * volta para o campo; fora de foco (ou ao sair dele), o endereço manda.
 */

/** Pai que só devolve o valor quando "o endereço" atualiza (atrasado, como a transição). */
function PaiComEnderecoAtrasado({ onPai }: { onPai: (api: { aplicar: (v: string) => void; pedidos: string[] }) => void }) {
  const [valor, setValor] = useState("");
  const pedidos: string[] = [];
  onPai({ aplicar: setValor, pedidos });
  return <CampoDeBusca valor={valor} onMudar={(v) => pedidos.push(v)} />;
}

const campo = () => screen.getByRole("searchbox", { name: "Buscar conteúdo, legenda ou conta" }) as HTMLInputElement;

describe("Agenda: busca não perde letra com o endereço atrasado", () => {
  it("digitar com o endereço parado mostra tudo o que foi digitado e manda cada tecla", () => {
    let api!: { aplicar: (v: string) => void; pedidos: string[] };
    render(<PaiComEnderecoAtrasado onPai={(a) => { api = a; }} />);
    const pedidos = api.pedidos;
    campo().focus();
    let digitado = "";
    for (const letra of "Softy — criativos") {
      digitado += letra;
      fireEvent.change(campo(), { target: { value: digitado } });
    }
    expect(campo().value).toBe("Softy — criativos");
    expect(pedidos[pedidos.length - 1]).toBe("Softy — criativos");
  });

  it("o eco atrasado de um valor antigo não volta para o campo", () => {
    let api!: { aplicar: (v: string) => void; pedidos: string[] };
    render(<PaiComEnderecoAtrasado onPai={(a) => { api = a; }} />);
    campo().focus();
    for (const v of ["S", "So", "Sof", "Soft", "Softy"]) fireEvent.change(campo(), { target: { value: v } });
    // A transição entrega valores velhos depois que a pessoa já digitou mais.
    act(() => api.aplicar("S"));
    expect(campo().value).toBe("Softy");
    act(() => api.aplicar("Sof"));
    expect(campo().value).toBe("Softy");
    act(() => api.aplicar("Softy"));
    expect(campo().value).toBe("Softy");
  });

  it("mudança de fora (Limpar filtros) ainda limpa o campo", () => {
    let api!: { aplicar: (v: string) => void; pedidos: string[] };
    render(<PaiComEnderecoAtrasado onPai={(a) => { api = a; }} />);
    campo().focus();
    fireEvent.change(campo(), { target: { value: "Softy" } });
    act(() => api.aplicar("Softy"));
    act(() => campo().blur());
    act(() => api.aplicar(""));
    expect(campo().value).toBe("");
    act(() => api.aplicar("vindo do link"));
    expect(campo().value).toBe("vindo do link");
  });

  it("navegação de fora que volta a um valor já enviado (B, depois C, volta B) vale", () => {
    let api!: { aplicar: (v: string) => void; pedidos: string[] };
    render(<PaiComEnderecoAtrasado onPai={(a) => { api = a; }} />);
    campo().focus();
    fireEvent.change(campo(), { target: { value: "B" } });
    fireEvent.change(campo(), { target: { value: "C" } });
    act(() => api.aplicar("C"));
    act(() => campo().blur());
    act(() => api.aplicar("B"));
    expect(campo().value).toBe("B");
  });

  it("valor de fora que chega em foco entra ao sair do campo", () => {
    let api!: { aplicar: (v: string) => void; pedidos: string[] };
    render(<PaiComEnderecoAtrasado onPai={(a) => { api = a; }} />);
    campo().focus();
    fireEvent.change(campo(), { target: { value: "B" } });
    fireEvent.change(campo(), { target: { value: "C" } });
    act(() => api.aplicar("B"));
    expect(campo().value).toBe("C");
    act(() => campo().blur());
    expect(campo().value).toBe("B");
  });

  it("Limpar filtros com o endereço ainda vazio (digitação pendente) limpa o campo", () => {
    let api!: { aplicar: (v: string) => void; pedidos: string[] };
    render(<PaiComEnderecoAtrasado onPai={(a) => { api = a; }} />);
    campo().focus();
    fireEvent.change(campo(), { target: { value: "S" } });
    expect(campo().value).toBe("S");
    // Clicar no botão tira o foco do campo; o endereço segue vazio ("" -> "").
    act(() => campo().blur());
    act(() => api.aplicar(""));
    expect(campo().value).toBe("");
  });

  it("em foco, depois do eco do último envio, navegação de fora que repete um valor já enviado vale (B, C, volta B)", () => {
    let api!: { aplicar: (v: string) => void; pedidos: string[] };
    render(<PaiComEnderecoAtrasado onPai={(a) => { api = a; }} />);
    campo().focus();
    fireEvent.change(campo(), { target: { value: "B" } });
    fireEvent.change(campo(), { target: { value: "C" } });
    act(() => api.aplicar("B"));
    expect(campo().value).toBe("C");
    act(() => api.aplicar("C"));
    // Nada pendente: o B de agora é navegação, não eco, mesmo com o campo em foco.
    act(() => api.aplicar("B"));
    expect(document.activeElement).toBe(campo());
    expect(campo().value).toBe("B");
  });

  it("Limpar filtros (sinal explícito) com o endereço já vazio e digitação pendente, em foco, limpa o campo", () => {
    let api!: { aplicar: (v: string) => void; resetar: () => void };
    render(<PaiComReset onPai={(a) => { api = a; }} />);
    campo().focus();
    fireEvent.change(campo(), { target: { value: "Sof" } });
    expect(campo().value).toBe("Sof");
    // O endereço continua "" (nunca mudou): sem o sinal, nenhum efeito rodaria.
    act(() => api.resetar());
    expect(campo().value).toBe("");
    // Depois do reset, digitar de novo continua sem perder letra.
    for (const v of ["S", "So", "Sof", "Soft", "Softy"]) fireEvent.change(campo(), { target: { value: v } });
    act(() => api.aplicar("So"));
    expect(campo().value).toBe("Softy");
  });

  it("Limpar filtros com o endereço mudando depois do sinal (transição) termina vazio", () => {
    let api!: { aplicar: (v: string) => void; resetar: () => void };
    render(<PaiComReset onPai={(a) => { api = a; }} />);
    campo().focus();
    fireEvent.change(campo(), { target: { value: "Softy" } });
    act(() => api.aplicar("Softy"));
    act(() => api.resetar());
    act(() => api.aplicar(""));
    expect(campo().value).toBe("");
  });
});
