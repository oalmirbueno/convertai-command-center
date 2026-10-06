import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { normalizarCriacao, pedidoParaCriar } from "../../supabase/functions/agente-calendario/agente-mes-v2";
import { conferirPlano, formatosDaSemana, gradeDoMes, lerCadencia, normalizarCadencia } from "../../supabase/functions/agente-calendario/modulos/cadencia-do-mes";
import { normalizarVideoDaPauta } from "../../supabase/functions/_shared/video-da-pauta";
import { modoDaPauta } from "@/components/mesa/modoDaPauta";
import { lerDetalhesDosItens, type ItemDoMes } from "@/components/mesa/useItensDoMes";
import { BancadaDeFotos, AcoesDaBancada } from "@/components/mesa/BancadaDaPauta";

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useUrlDaMesa: () => ({ data: "https://example.test/foto.jpg" }), ImagemDaMesa: ({ alt }: { alt: string }) => <img alt={alt} />, useMarcaDaMesa: () => ({ marca: null, marcas: [] }) }));
vi.mock("@/components/mesa/ImagemComZoom", () => ({ default: ({ alt }: { alt: string }) => <div role="img" aria-label={`Prévia: ${alt}`} /> }));
const item: ItemDoMes = { id: "t1", project_id: "p1", title: "Produto da pauta", due_date: "2026-10-12", delivery_type: "carousel", status: "pending" };
function banco(tabelas: Record<string, unknown[]>) {
  mock.from.mockImplementation((tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const nome of ["select", "eq", "in", "is", "neq", "order", "overlaps"]) q[nome] = vi.fn(() => q);
    q.then = (resolve: (v: unknown) => void) => Promise.resolve({ data: tabelas[tabela] || [], error: null }).then(resolve);
    return q;
  });
}
beforeEach(() => { mock.from.mockReset(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });

describe("Agenda e estúdio preservam o formato e a direção", () => {
  it("foto planejada como carousel abre fotos antes de ter trabalho", async () => {
    banco({ calendario_propostas: [{ task_ids: [item.id], itens: [{ task_id: item.id, formato: "foto", foto: { assunto: "Armação", referencias: ["f1"] } }] }] });
    const dados = await lerDetalhesDosItens("cliente", [item], true);
    expect(modoDaPauta(dados.itens[0])).toBe("fotos");
    expect(dados.roteiros[item.id].direcao_foto?.referencias).toEqual(["f1"]);
  });
  it("o arquivo de vídeo na Agenda identifica inclusive um story e evita uma peça duplicada", async () => {
    banco({ editorial_post_internal: [{ post_id: "post", task_id: item.id }], editorial_posts: [{ id: "post", primary_file_id: "v1", title: "Vídeo pronto" }], staff_files_secure: [{ id: "v1", file_name: "jardim.mp4", mime_type: "video/mp4", storage_bucket: "mesa", storage_path: "cliente/jardim.mp4" }] });
    const dados = await lerDetalhesDosItens("cliente", [{ ...item, delivery_type: "story" }], true);
    expect(dados.artes[item.id].capa?.tipo_midia).toBe("video");
    expect(modoDaPauta(dados.itens[0])).toBe("video");
  });
  it("a leitura antiga de Entrega continua excluindo MP4 de lâminas", async () => {
    banco({ editorial_post_internal: [{ post_id: "post", task_id: item.id }], editorial_posts: [{ id: "post", primary_file_id: "v1" }], staff_files_secure: [{ id: "v1", mime_type: "video/mp4" }] });
    expect((await lerDetalhesDosItens("cliente", [item])).artes[item.id]).toBeUndefined();
  });
  it("protege arte persistida mesmo quando a proposta mudou para fotos", () => expect(modoDaPauta({ ...item, modo_estudio: "fotos" }, { direcao: { cards: [{}] } })).toBe("arte"));
  it("reconhece somente o prefixo formal legado, não palavras soltas no título", () => {
    expect(modoDaPauta({ ...item, title: "Peça de foto: Armação" })).toBe("fotos");
    expect(modoDaPauta({ ...item, title: "Fotos e vídeos: dicas para escolher" })).toBe("arte");
  });
  it("preserva estilo, narração e referências no pedido da Agenda", () => {
    const video = normalizarVideoDaPauta({ estilo: "jardim", referencias: ["antes", "depois"], narracao: "Veja a transformação.", formato: "9:16" });
    const plano = normalizarCriacao({ itens: [{ data: "2026-10-12", formato: "vídeo rápido", tema: "Jardim pronto", video }] }, "2026-10-05")!;
    expect(plano.itens[0].formato).toBe("video");
    expect(plano.itens[0].video).toEqual(video);
    expect(pedidoParaCriar(plano.itens)).toContain('"estilo":"jardim"');
    expect(pedidoParaCriar(plano.itens)).toContain("vídeo rápido");
  });
  it("mistura semanal conta vídeo sem convertê-lo em arte", () => {
    const cad = lerCadencia("3 posts por semana: 1 foto, 1 carrossel e 1 vídeo")!;
    expect(cad.mix?.video).toBe(1);
    expect(normalizarCadencia(cad)?.mix?.video).toBe(1);
    expect(formatosDaSemana(cad.mix, 3, 3).sort()).toEqual(["carrossel", "foto", "video"]);
    expect(conferirPlano([{ data: "2026-10-12", formato: "video" }], null, null).formatos.video).toBe(1);
  });
});

describe("Bancada de fotos mantém prancheta, prévia e ferramentas", () => {
  it("seleciona a foto na prancheta e muda a prévia central sem sair do estúdio", () => {
    const mover = vi.fn();
    render(<BancadaDeFotos titulo="Fotos da pauta" fotos={[{ id: "a", nome: "Antes", caminho: "a.jpg" }, { id: "b", nome: "Depois", caminho: "b.jpg" }]} onMover={mover}><AcoesDaBancada><button>Gerar fotos</button></AcoesDaBancada></BancadaDeFotos>);
    expect(screen.getByRole("button", { name: "Gerar fotos" }).closest("header")).not.toBeNull();
    expect(screen.getByRole("complementary", { name: "Prancheta" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Ferramentas de fotos" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver foto 2: Depois" }));
    expect(screen.getByRole("img", { name: "Prévia: Depois" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mover foto 2 para antes" }));
    expect(mover).toHaveBeenCalledWith(1, -1);
  });
});
