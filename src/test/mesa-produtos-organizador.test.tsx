import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganizadorDeProdutos from "@/components/mesa-foto/OrganizadorDeProdutos";
import { normalizarFoto, normalizarKit } from "@/components/mesa-foto/fotoApi";
import { organizarFotosPorProduto } from "@/components/mesa-foto/pastasDosProdutos";

const m = vi.hoisted(() => ({ fotos: [] as any[], kits: [] as any[], org: [] as any[], mover: vi.fn(), salvar: vi.fn(), escolher: vi.fn(), navegar: vi.fn(), refetch: vi.fn(), erro: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "c1", catalogo: {} }) }));
vi.mock("@/components/mesa-foto/Comuns", () => ({ useMesaFoto: () => ({ escolherKit: m.escolher, irPara: m.navegar }), MiniaturaDaFoto: ({ foto }: any) => <img alt={foto.nome} /> }));
vi.mock("@/components/mesa-foto/EscolhaDoProduto", () => ({ nomeDoKit: (k: any) => k.nome, capaDoKit: (k: any, f: any[]) => f.find((x) => x.id === k.frente_imagem_id) }));
vi.mock("@/components/mesa-foto/fotoApi", async (original) => ({ ...await original<any>(), useFotos: () => ({ data: m.fotos }), salvarKit: m.salvar, invalidarFotos: vi.fn() }));
vi.mock("@/components/mesa-foto/useOrganizacaoDeProdutos", () => ({ moverProdutoParaPasta: m.mover, useOrganizacaoDeProdutos: () => ({ kits: { data: m.kits }, organizadas: m.org, pessoas: [], recarregar: m.refetch }) }));
vi.mock("@/components/mesa/Custo", () => ({ useAvisarErro: () => m.erro, BotaoComCusto: ({ rotulo, disabled }: any) => <button disabled={disabled}>{rotulo}</button> }));
vi.mock("@/components/sistema/AreaDeTrabalho", () => ({ useAlturaQueCabe: () => ({ ref: { current: null }, altura: 600 }) }));
vi.mock("@/components/mesa-foto/SeletorDeFotos", () => ({ default: ({ fotos, onUsar }: any) => <div>{fotos.map((f: any) => <span key={f.id}>{`Elegível: ${f.id}`}</span>)}<button onClick={() => onUsar(["f1", "f2"])}>Escolher duas fotos</button></div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const montar = () => render(<QueryClientProvider client={new QueryClient()}><OrganizadorDeProdutos /></QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  m.fotos = [normalizarFoto({ id: "f1", client_id: "c1", nome: "Óculos solar", ativa: true, storage_path: "c1/f1.png" })!, normalizarFoto({ id: "f2", client_id: "c1", nome: "Caixa", ativa: true, storage_path: "c1/f2.png" })!];
  m.kits = [normalizarKit({ id: "p1", client_id: "c1", nome: "Óculos solar", tipo: "produto", frente_imagem_id: "f1", atributos: { organizacao: { pasta: "Ótica / Sol" } }, refs: [{ imagem_id: "f1", papel: "identidade" }] })!];
  m.org = organizarFotosPorProduto("c1", m.fotos, m.kits, [], []);
  m.mover.mockResolvedValue({ pasta: "Coleção" }); m.salvar.mockResolvedValue({ ...m.kits[0] });
});
describe("organizador de produtos", () => {
  it("seleciona o produto da pasta e leva o ID à ferramenta existente", () => {
    montar(); fireEvent.click(screen.getByRole("button", { name: "Usar produto" }));
    expect(m.escolher).toHaveBeenCalledWith("p1");
    expect(m.navegar).toHaveBeenCalledWith("combinar", { kit: "p1" });
  });
  it("move para pasta com confirmação do servidor", async () => {
    montar(); fireEvent.click(screen.getByRole("button", { name: "Selecionar Óculos solar para mover" }));
    fireEvent.change(screen.getByLabelText("Pasta de destino"), { target: { value: "Coleção / Verão" } });
    fireEvent.click(screen.getByRole("button", { name: "Mover para pasta" }));
    await waitFor(() => expect(m.mover).toHaveBeenCalledWith("c1", "p1", "Coleção / Verão"));
    await waitFor(() => expect(m.refetch).toHaveBeenCalled());
  });
  it("não esconde falha nem perde seleção quando a pasta não foi salva", async () => {
    m.mover.mockRejectedValueOnce(new Error("indisponível"));
    montar(); fireEvent.click(screen.getByRole("button", { name: "Selecionar Óculos solar para mover" }));
    fireEvent.change(screen.getByLabelText("Pasta de destino"), { target: { value: "Coleção" } });
    fireEvent.click(screen.getByRole("button", { name: "Mover para pasta" }));
    await waitFor(() => expect(m.erro).toHaveBeenCalled());
    expect(screen.getByText("1 selecionados")).toBeTruthy();
  });
  it("acrescenta fotos ao mesmo produto sem duplicar sua referência", async () => {
    montar(); fireEvent.click(screen.getByRole("button", { name: "Marcar fotos como produto" }));
    fireEvent.click(screen.getByRole("button", { name: "Escolher duas fotos" }));
    fireEvent.click(screen.getByRole("button", { name: "Marcar e salvar produto" }));
    await waitFor(() => expect(m.salvar).toHaveBeenCalled());
    const [cliente, salvo, marcar] = m.salvar.mock.calls[0];
    expect(cliente).toBe("c1"); expect(salvo.id).toBe("p1"); expect(marcar).toBe(true);
    expect(salvo.refs.map((r: any) => r.imagem_id)).toEqual(["f1", "f2"]);
  });
  it("permite marcar embalagem manualmente sem depender de IA", async () => {
    m.kits = []; montar(); fireEvent.click(screen.getByRole("button", { name: "Marcar fotos como produto" }));
    fireEvent.click(screen.getByRole("button", { name: "Escolher duas fotos" }));
    fireEvent.change(screen.getByLabelText("O que aparece nas fotos"), { target: { value: "embalagem" } });
    fireEvent.change(screen.getByLabelText("Pasta"), { target: { value: "Ótica / Caixas" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar e salvar produto" }));
    await waitFor(() => expect(m.salvar).toHaveBeenCalled());
    expect(m.salvar.mock.calls[0][1].refs.every((r: any) => r.papel === "embalagem")).toBe(true);
    expect(m.salvar.mock.calls[0][1].atributos.organizacao.pasta).toBe("Ótica / Caixas");
  });
  it("não oferece mídia de outro cliente, referência web ou gerada sem aprovação como produto real", () => {
    m.fotos.push(normalizarFoto({ id: "estrangeira", client_id: "c2", ativa: true })!, normalizarFoto({ id: "nao-aprovada", client_id: "c1", ativa: true, gerada: true })!);
    montar(); fireEvent.click(screen.getByRole("button", { name: "Marcar fotos como produto" }));
    expect(screen.queryByText("Elegível: estrangeira")).toBeNull();
    expect(screen.queryByText("Elegível: nao-aprovada")).toBeNull();
  });
});
