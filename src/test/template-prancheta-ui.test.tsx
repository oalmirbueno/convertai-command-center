import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ desenhar: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({
  useUrlDaMesa: (caminho?: string) => ({ data: caminho ? `https://arquivos.exemplo.com/${caminho}` : undefined, isError: false }),
  useMarcaDaMesa: () => ({ marca: null }),
  ImagemDaMesa: ({ caminho, alt }: { caminho: string; alt: string }) => <img src={caminho} alt={alt} data-arte-do-carrossel="" />,
}));
vi.mock("@/components/mesa/profile/renderProfile", () => ({ carregarImagemProfile: vi.fn(async () => ({ naturalWidth: 400, naturalHeight: 300 })), desenharProfile: (...args: unknown[]) => estado.desenhar(...args) }));
vi.mock("@/components/mesa/profile/blocoDaLamina", async (original) => ({ ...(await original<object>()), carregarMidiaDoBloco: vi.fn(async () => ({ fonte: {}, largura: 1600, altura: 900 })) }));
import PranchetaDoEstudio from "@/components/mesa/PranchetaDoEstudio";
import MiniaturaDoPostX, { EstadoDaLaminaNoTemplate } from "@/components/mesa/profile/MiniaturaDoPostX";
import { chaveDoRascunho, gravarRascunho, publicarBaseDoTemplate } from "@/components/mesa/profile/rascunhoDoTemplate";
import type { CardDaDirecao, CardGerado } from "@/components/mesa/useItensDoMes";

const cards: CardDaDirecao[] = [{ ordem: 1, texto_exato: "Organize os documentos antes do pedido" }, { ordem: 2, texto_exato: "Segundo post do fio" }];
const ultimas = new Map<number, CardGerado>([[1, { ordem: 1, versao: 3, storage_path: "cliente/arte-do-carrossel.png" } as CardGerado]]);
const base = { versao: 1 as const, estilo: "twitter" as const, nome: "Thainá Rosa", username: "thainarosa", verificado: false, texto: "", tamanho_texto: 34, cor_fundo: "#ffffff", tema: "claro" as const, tamanho_foto: 88, espacamento: 48, arredondamento: 24 };
beforeEach(() => { estado.desenhar.mockReset(); });

function prancheta(comTemplate: boolean, acoes?: (c: CardDaDirecao) => JSX.Element) {
  return render(<PranchetaDoEstudio cards={cards} ultimas={ultimas} selecionado={1} onSelecionar={vi.fn()} andamento={{}} infinito={false} largura={112} podeReordenar onReordenar={vi.fn()} onVersoes={vi.fn()} onAjustar={vi.fn()}
    acoes={acoes}
    miniatura={comTemplate ? (c, v) => <MiniaturaDoPostX trabalhoId="t-1" clientId="cliente" card={c} versao={v} posicao={{ atual: c.ordem, total: 2 }} /> : undefined} />);
}

describe("Template · X na prancheta do Estúdio", () => {
  it("no modo Template, o card mostra o post do X da lâmina e não a arte do carrossel", async () => {
    publicarBaseDoTemplate("t-1", { template: base, avatarUrl: null, formato: "feed_4x5" });
    prancheta(true);
    expect(document.querySelector("[data-arte-do-carrossel]")).toBeNull();
    await waitFor(() => expect(estado.desenhar).toHaveBeenCalledTimes(2));
    const textos = estado.desenhar.mock.calls.map((c) => (c[1] as { texto: string }).texto);
    expect(textos).toEqual(expect.arrayContaining(["Organize os documentos antes do pedido", "Segundo post do fio"]));
    expect(estado.desenhar.mock.calls[0][1]).toMatchObject({ nome: "Thainá Rosa", username: "thainarosa" });
  });
  it("fora do Template, a mesma prancheta mostra a arte como sempre", () => {
    prancheta(false);
    expect(document.querySelector("[data-arte-do-carrossel]")).not.toBeNull();
  });
  it("mantém só os controles do card (versão, ajuste e alça), sem fileira extra", () => {
    prancheta(true);
    expect(screen.getByRole("button", { name: "Versões da lâmina 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajustar lâmina 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Adicionar post|Duplicar post|Tirar post/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Post \d do fio/ })).not.toBeInTheDocument();
  });
});

describe("miniatura acompanha o rascunho da lâmina (23/10: o meio mostrava a imagem e a lateral não)", () => {
  const carrossel = { ...base, estilo: "carrossel" as const, seta: true, bloco: { tipo: "nenhum" as const, posicao: "abaixo" as const, altura: 100, largura: 100, sangrar: false, cantos: 18, borda: false, sombra: false, enquadramento: "inteira" as const, foco_x: 0.5, foco_y: 0.5 } };
  const rascunhoDaLamina2 = { ...carrossel, cor_fundo: "#7a1f3d", tema: "escuro", verificado: true, bloco: { ...carrossel.bloco, tipo: "imagem", midia: { bucket: "mesa", caminho: "cliente/estudio/fontes-reais/mulher-documentos.jpg", origem: "internet" } } };
  beforeEach(() => { sessionStorage.clear(); });
  it("lâmina 2 sem versão, com imagem no rascunho: a miniatura desenha a imagem e o fundo dela e não diz 'sem arte'", async () => {
    publicarBaseDoTemplate("t-2", { template: carrossel, avatarUrl: null, formato: "feed_4x5" });
    sessionStorage.setItem(chaveDoRascunho("cliente", null, "t-2", 2), JSON.stringify(rascunhoDaLamina2));
    render(<PranchetaDoEstudio cards={cards} ultimas={ultimas} selecionado={1} onSelecionar={vi.fn()} andamento={{}} infinito={false} largura={112} podeReordenar onReordenar={vi.fn()}
      miniatura={(c, v) => <MiniaturaDoPostX trabalhoId="t-2" clientId="cliente" card={c} versao={v} posicao={{ atual: c.ordem, total: 2 }} />}
      estadoSemVersao={(c) => <EstadoDaLaminaNoTemplate trabalhoId="t-2" clientId="cliente" card={c} />} />);
    await waitFor(() => expect(estado.desenhar.mock.calls.some((c) => (c[1] as { texto: string }).texto === "Segundo post do fio")).toBe(true));
    const daLamina2 = estado.desenhar.mock.calls.filter((c) => (c[1] as { texto: string }).texto === "Segundo post do fio").pop()!;
    expect(daLamina2[1]).toMatchObject({ estilo: "carrossel", cor_fundo: "#7a1f3d", verificado: true, bloco: { tipo: "imagem", midia: { caminho: "cliente/estudio/fontes-reais/mulher-documentos.jpg" } } });
    expect(daLamina2[3].midia).toBeTruthy();
    expect(screen.queryByText("sem arte")).not.toBeInTheDocument();
    expect(document.querySelector("[data-estado-no-template='imagem']")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lâmina 2, .*ainda não guardada/ })).toBeInTheDocument();
  });
  it("mudar o rascunho (fora da miniatura) redesenha na hora, sem guardar", async () => {
    publicarBaseDoTemplate("t-3", { template: carrossel, avatarUrl: null, formato: "feed_4x5" });
    render(<MiniaturaDoPostX trabalhoId="t-3" clientId="cliente" card={cards[1]} posicao={{ atual: 2, total: 2 }} />);
    await waitFor(() => expect(estado.desenhar).toHaveBeenCalled());
    expect(estado.desenhar.mock.calls[estado.desenhar.mock.calls.length - 1][1]).toMatchObject({ cor_fundo: "#ffffff" });
    act(() => gravarRascunho(chaveDoRascunho("cliente", null, "t-3", 2), { ...carrossel, cor_fundo: "#15202b", tema: "dim" }));
    await waitFor(() => expect(estado.desenhar.mock.calls[estado.desenhar.mock.calls.length - 1][1]).toMatchObject({ cor_fundo: "#15202b" }));
  });
});
