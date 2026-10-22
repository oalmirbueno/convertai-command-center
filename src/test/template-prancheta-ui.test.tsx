import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ desenhar: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({
  useUrlDaMesa: (caminho?: string) => ({ data: caminho ? `https://arquivos.exemplo.com/${caminho}` : undefined, isError: false }),
  ImagemDaMesa: ({ caminho, alt }: { caminho: string; alt: string }) => <img src={caminho} alt={alt} data-arte-do-carrossel="" />,
}));
vi.mock("@/components/mesa/profile/renderProfile", () => ({ carregarImagemProfile: vi.fn(async () => ({ naturalWidth: 400, naturalHeight: 300 })), desenharProfile: (...args: unknown[]) => estado.desenhar(...args) }));
import PranchetaDoEstudio from "@/components/mesa/PranchetaDoEstudio";
import MiniaturaDoPostX from "@/components/mesa/profile/MiniaturaDoPostX";
import { publicarBaseDoTemplate } from "@/components/mesa/profile/rascunhoDoTemplate";
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
