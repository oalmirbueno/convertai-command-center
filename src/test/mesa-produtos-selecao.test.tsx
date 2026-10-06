import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MarcarProdutos from "@/components/mesa-foto/MarcarProdutos";
import ExcluirModelo from "@/components/mesa-foto/ExcluirModelo";
import SeletorDeFotos from "@/components/mesa-foto/SeletorDeFotos";
import { normalizarKit, normalizarFoto, chaveDosKits, chaveDasFotos } from "@/components/mesa-foto/fotoApi";
import { chaveDasPersonas, type Persona } from "@/components/mesa-foto/modelosApi";
import { guardarProdutoConfirmado, fotosJaCadastradas } from "@/components/mesa-foto/cacheProdutos";
import { normalizarPublicoProduto, pastaOrganizadaDoProduto } from "../../supabase/functions/mesa-foto/modulos/pastas-produtos";

const m = vi.hoisted(() => ({ salvar: vi.fn(), arquivar: vi.fn(), erro: vi.fn(), publico: vi.fn(), admin: true }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "c1", catalogo: [], isAdmin: m.admin }) }));
vi.mock("@/components/mesa-foto/Comuns", () => ({ MiniaturaDaFoto: ({ foto }: any) => <img alt={foto.nome} />, Pilulas: () => null }));
vi.mock("@/components/mesa-foto/EtapaAcervo", () => ({ FILTROS_DA_CLASSE: [], filtrarFotos: (f: any[]) => f }));
vi.mock("@/components/mesa-foto/useOrganizacaoDeProdutos", () => ({ useOrganizacaoDeProdutos: () => ({ organizadas: [] }) }));
vi.mock("@/lib/mesa/pastas", () => ({ useArvoreDoWorkspace: () => ({ data: [] }), pastasDoAcervo: () => ({ pastas: [], pastaDoNo: {} }), montarArvore: () => [], trilhaAte: () => [] }));
vi.mock("@/components/mesa-foto/fotoApi", async (o) => ({ ...await o<any>(), salvarKit: m.salvar }));
vi.mock("@/components/mesa-foto/modelosApi", async (o) => ({ ...await o<any>(), arquivarPersona: m.arquivar }));
vi.mock("@/components/mesa-foto/produtoPublicoApi", async (o) => ({ ...await o<any>(), atualizarPublicoProduto: m.publico }));
vi.mock("@/components/mesa/Custo", () => ({ useAvisarErro: () => m.erro, BotaoComCusto: ({ rotulo, executar, disabled }: any) => <button disabled={disabled} onClick={() => void executar().catch(m.erro)}>{rotulo}</button> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
const f = (id: string) => normalizarFoto({ id, nome: id, client_id: "c1", ativa: true, storage_path: `c1/${id}.jpg` })!;
const k = (id: string, foto = "a") => normalizarKit({ id, client_id: "c1", nome: id, tipo: "produto", frente_imagem_id: foto, refs: [{ imagem_id: foto, papel: "identidade" }] })!;
const montar = (elemento: React.ReactNode, cache = new QueryClient()) => ({ ...render(<QueryClientProvider client={cache}>{elemento}</QueryClientProvider>), cache });
const persona = { id: "m1", client_id: "c1", nome: "Lia", status: "pronta" } as Persona;
beforeEach(() => { vi.clearAllMocks(); m.admin = true; m.salvar.mockImplementation(async (_c, kit) => ({ ...kit, id: `p-${kit.frente_imagem_id}` })); m.publico.mockResolvedValue({ custo_usd: 0.001 }); });

describe("seleção e confirmação dos produtos", () => {
  it("mostra cadastradas marcadas e não as inclui em selecionar todas", () => {
    const usar = vi.fn(); montar(<SeletorDeFotos fotos={[f("a"), f("b"), f("c")]} titulo="Produtos" produtosMarcados={fotosJaCadastradas([k("p1")])} limiteSelecao={1} onUsar={usar} onFechar={() => {}} />);
    expect(screen.getByRole("button", { name: "Já é produto: a" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Já é produto: a" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("Selecionar as 1 fotos disponíveis"));
    fireEvent.click(screen.getByRole("button", { name: "Usar 1 foto" })); expect(usar).toHaveBeenCalledWith(["b"]);
  });
  it("põe a resposta no cache imediatamente, sem duplicar nem misturar clientes", async () => {
    const cache = new QueryClient(); cache.setQueryData(chaveDosKits("c1"), [k("p1")]); cache.setQueryData(chaveDasFotos("c1"), [f("a")]);
    await guardarProdutoConfirmado(cache, "c1", { ...k("p1"), nome: "Confirmado" });
    expect(cache.getQueryData<any[]>(chaveDosKits("c1"))).toEqual([expect.objectContaining({ nome: "Confirmado" })]);
    expect(cache.getQueryData<any[]>(chaveDasFotos("c1"))?.[0].categoria).toBe("produto");
    await expect(guardarProdutoConfirmado(cache, "c2", k("p1"))).rejects.toThrow();
  });
  it("cadastra duas fotos como produtos distintos e atualiza a seleção sem recarregar", async () => {
    const salvo = vi.fn(); const fechar = vi.fn(); const { cache } = montar(<MarcarProdutos fotos={[f("a"), f("b")]} kits={[]} onSalvo={salvo} onFechar={fechar} />);
    fireEvent.click(screen.getByText("Selecionar as 2 fotos disponíveis")); fireEvent.click(screen.getByRole("button", { name: "Usar 2 fotos" }));
    fireEvent.change(screen.getByLabelText("Público dos produtos selecionados"), { target: { value: "unissex" } }); fireEvent.click(screen.getByText("Marcar 2 como produto"));
    await waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(m.salvar).toHaveBeenCalledTimes(2); expect(m.publico).not.toHaveBeenCalled();
    expect(cache.getQueryData<any[]>(chaveDosKits("c1"))).toHaveLength(2);
    expect(m.salvar.mock.calls[0][1].atributos.organizacao.publico.valor).toBe("unissex"); expect(salvo).toHaveBeenCalled();
  });
  it("falha de IA preserva o cadastro confirmado e não repete registro existente", async () => {
    const cache = new QueryClient(); const fechar = vi.fn(); m.publico.mockRejectedValue(new Error("indisponível"));
    montar(<MarcarProdutos fotos={[f("a")]} kits={[]} onSalvo={() => {}} onFechar={fechar} />, cache);
    fireEvent.click(screen.getByRole("button", { name: "a" })); fireEvent.click(screen.getByRole("button", { name: "Usar 1 foto" }));
    // Outra ação já salvou o mesmo produto enquanto a seleção estava aberta.
    cache.setQueryData(chaveDosKits("c1"), [k("p1")]);
    fireEvent.click(screen.getByText("Marcar 1 e identificar")); await waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(m.salvar).not.toHaveBeenCalled(); expect(cache.getQueryData<any[]>(chaveDosKits("c1"))).toHaveLength(1);
  });
  it("não anuncia sucesso nem fecha se o servidor não confirmar nenhum cadastro", async () => {
    m.salvar.mockResolvedValue({ ...k(""), id: null }); const fechar = vi.fn(); montar(<MarcarProdutos fotos={[f("a")]} kits={[]} onSalvo={() => {}} onFechar={fechar} />);
    fireEvent.click(screen.getByRole("button", { name: "a" })); fireEvent.click(screen.getByRole("button", { name: "Usar 1 foto" })); fireEvent.click(screen.getByText("Marcar 1 e identificar"));
    await waitFor(() => expect(m.erro).toHaveBeenCalled()); expect(fechar).not.toHaveBeenCalled(); expect(m.publico).not.toHaveBeenCalled();
  });
});
describe("público comercial e pastas", () => {
  it("não transforma baixa confiança ou falta de evidência em gênero", () => {
    expect(normalizarPublicoProduto({ valor: "feminino", confianca: 0.65, evidencia: "rosa" })?.valor).toBe("nao_identificado");
    expect(normalizarPublicoProduto({ valor: "masculino", confianca: 0.99 })?.valor).toBe("nao_identificado");
    expect(normalizarPublicoProduto({ valor: "inventado", origem: "equipe" })).toBeUndefined();
  });
  it("escolha manual vale e mantém a pasta original ao mudar o público", () => {
    const publico = normalizarPublicoProduto({ valor: "feminino", origem: "equipe" })!;
    expect(pastaOrganizadaDoProduto({ pasta: "Óculos / Sol", publico })).toBe("Óculos / Sol / Feminino");
    expect(pastaOrganizadaDoProduto({ pasta: "Feminino", publico })).toBe("Feminino");
    expect(pastaOrganizadaDoProduto({ pasta: "Óculos", publico: { ...publico, valor: "nao_identificado" } })).toBe("Óculos / A identificar");
  });
});
describe("excluir modelos com retorno confirmado", () => {
  it("cancelar preserva; confirmar retira de todos os seletores com cache", async () => {
    const cache = new QueryClient(); cache.setQueryData(chaveDasPersonas("c1"), [persona]); cache.setQueryData(chaveDasPersonas("c2"), [persona]);
    m.arquivar.mockResolvedValue({ ...persona, status: "arquivada" }); montar(<ExcluirModelo persona={persona} />, cache);
    fireEvent.click(screen.getByRole("button", { name: "Excluir modelo Lia" })); fireEvent.click(screen.getByText("Cancelar")); expect(m.arquivar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Excluir modelo Lia" })); fireEvent.click(screen.getByRole("button", { name: "Excluir modelo" }));
    await waitFor(() => expect(cache.getQueryData<any[]>(chaveDasPersonas("c1"))?.[0].status).toBe("arquivada"));
    expect(cache.getQueryData<any[]>(chaveDasPersonas("c2"))?.[0].status).toBe("arquivada"); expect(m.arquivar).toHaveBeenCalledWith("m1", true);
  });
  it("falha não inventa exclusão; restaurar usa o status devolvido", async () => {
    const cache = new QueryClient(); cache.setQueryData(chaveDasPersonas("c1"), [persona]); m.arquivar.mockResolvedValue(null);
    const view = montar(<ExcluirModelo persona={persona} />, cache); fireEvent.click(screen.getByRole("button", { name: "Excluir modelo Lia" })); fireEvent.click(screen.getByRole("button", { name: "Excluir modelo" }));
    await waitFor(() => expect(m.erro).toHaveBeenCalled()); expect(cache.getQueryData<any[]>(chaveDasPersonas("c1"))?.[0].status).toBe("pronta"); view.unmount();
    m.arquivar.mockResolvedValue({ ...persona, status: "rascunho" }); montar(<ExcluirModelo persona={{ ...persona, status: "arquivada" }} />, cache); fireEvent.click(screen.getByRole("button", { name: "Restaurar modelo Lia" }));
    await waitFor(() => expect(cache.getQueryData<any[]>(chaveDasPersonas("c1"))?.[0].status).toBe("rascunho")); expect(m.arquivar).toHaveBeenLastCalledWith("m1", false);
  });
  it("não oferece exclusão de modelo da agência para quem não é administrador", () => { m.admin = false; montar(<ExcluirModelo persona={{ ...persona, client_id: null }} />); expect(screen.queryByRole("button")).toBeNull(); });
});
