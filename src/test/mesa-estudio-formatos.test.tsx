import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modoDaPauta, chaveDoEstudioDaPauta } from "@/components/mesa/modoDaPauta";
import EstudioDaPauta from "@/components/mesa/EstudioDaPauta";
import type { ItemDoMes, Trabalho } from "@/components/mesa/useItensDoMes";
import { pastasCitadas, resolverPastasCitadas, fotosSelecionadas } from "../../supabase/functions/mesa-foto/modulos/selecao-do-workspace";
import { baseDoVideoRapido } from "../../supabase/functions/mesa-videos/modulos/video-rapido-legendado";
vi.mock("@/components/mesa/EstudioDeFotosDaPauta", () => ({ default: ({ item }: { item: ItemDoMes }) => <div>Fotos da pauta {item.id}</div> }));
vi.mock("@/components/mesa/EstudioDeVideoDaPauta", () => ({ default: ({ item }: { item: ItemDoMes }) => <div>Vídeo da pauta {item.id}</div> }));
const item: ItemDoMes = { id: "pauta-1", delivery_type: "static", title: "Foto ou vídeo no título não define o formato", project_id: "projeto", due_date: "2026-10-10", status: "pending" };
const renderStudio = (extra: Partial<{ item: ItemDoMes; trabalho: Trabalho | null }> = {}) => render(<EstudioDaPauta item={item} trabalho={null} foco={false} onFoco={vi.fn()} {...extra}><button>Arte existente</button></EstudioDaPauta>);

beforeEach(() => localStorage.clear());

describe("Estúdio adapta o formato sem substituir a peça", () => {
  it.each(["reel", "short", "video"])("reconhece o delivery_type canônico %s", (delivery_type) => expect(modoDaPauta({ delivery_type })).toBe("video"));
  it("usa so_fotos e mantém carrossel de arte intacto", () => {
    expect(modoDaPauta({ delivery_type: "carousel" }, { direcao: { so_fotos: true } })).toBe("fotos");
    expect(modoDaPauta(item)).toBe("arte");
  });
  it("separa rascunhos por cliente, pauta e ferramenta", () => {
    const keys = [chaveDoEstudioDaPauta("a","1","fotos"),chaveDoEstudioDaPauta("a","2","fotos"),chaveDoEstudioDaPauta("b","1","fotos"),chaveDoEstudioDaPauta("a","1","video")];
    expect(new Set(keys).size).toBe(4);
  });
  it("permite selecionar fotos numa pauta ainda vazia", async () => {
    renderStudio(); fireEvent.click(screen.getByRole("button", { name: "Fotos" }));
    expect(await screen.findByText("Fotos da pauta pauta-1")).toBeInTheDocument();
    expect(screen.queryByText("Arte existente")).not.toBeInTheDocument();
  });
  it("bloqueia conversão de arte persistida", () => {
    renderStudio({ trabalho: { id: "trabalho", direcao: {} } as Trabalho });
    expect(screen.getByRole("button", { name: "Fotos" })).toBeDisabled();
    expect(screen.getByText("Arte existente")).toBeInTheDocument();
  });
  it("depois da leitura remota, o formato persistido prevalece sobre a escolha local", async () => {
    const view = renderStudio(); fireEvent.click(screen.getByRole("button", { name: "Vídeo rápido" }));
    await screen.findByText("Vídeo da pauta pauta-1");
    view.rerender(<EstudioDaPauta item={item} trabalho={{ id:"t", direcao:{ so_fotos:true } } as unknown as Trabalho} foco={false} onFoco={vi.fn()}>Arte</EstudioDaPauta>);
    expect(await screen.findByText("Fotos da pauta pauta-1")).toBeInTheDocument();
    expect(screen.queryByText("Vídeo da pauta pauta-1")).not.toBeInTheDocument();
  });
});
describe("Workspace: referências comprovadas", () => {
  const pastas = [{ id:"a", name:"Obras", parent_id:null }, { id:"b", name:"Jardins", parent_id:"a" }, { id:"c", name:"Depois", parent_id:"b" }];
  it("recupera a pasta citada e descendentes", () => expect(pastasCitadas("Use a pasta Jardins",pastas)).toEqual(["b","c"]));
  it("resolve o caminho mais profundo sem confundir seus ancestrais", () => expect(pastasCitadas("Use Obras/Jardins/Depois",pastas)).toEqual(["c"]));
  it("não confunde um nome com parte de outra palavra", () => expect(pastasCitadas("jardinsnovos",pastas)).toEqual([]));
  it("pede o caminho completo quando nomes são ambíguos", () => {
    const duplicadas = [...pastas, { id:"d", name:"Jardins",parent_id:null }];
    expect(pastasCitadas("use Jardins",duplicadas)).toEqual([]);
    expect(resolverPastasCitadas("use Jardins",duplicadas).estado).toBe("ambigua");
    expect(pastasCitadas("use Obras/Jardins",duplicadas)).toEqual(["b","c"]);
  });
  it("recusa IDs inventados, fotos arquivadas e referências web", () => {
    const fotos = [{ref:"i1",id:"foto",dados:{}},{ref:"i2",id:"web",dados:{tags:["referencia_web"]}},{ref:"i3",id:"arquivada",dados:{ativa:false}}];
    expect(fotosSelecionadas(["i1","uuid-inventado","i2","i3","i1"],fotos)).toEqual(["foto"]);
  });
});
describe("Legenda do vídeo rápido", () => {
  const video = {id:"v1",client_id:"c1",nome:"Jardim",tipo:"gerado",storage_bucket:"mesa",storage_path:"c1/video.mp4",duracao_s:8,largura:1080,altura:1350};
  it("usa o vídeo inteiro com áudio e proporção originais", () => {
    const projeto = baseDoVideoRapido(video);
    const clipe = projeto.trilhas.find((t) => t.tipo === "video")!.clipes[0];
    expect(projeto.formato).toBe("4:5"); expect(projeto.duracao_s).toBe(8);
    expect(clipe.volume).toBe(1); expect(clipe.entrada_s).toBe(0); expect(clipe.saida_s).toBe(8);
    expect(Object.values(projeto.fontes)[0].arquivo_id).toBe("v1");
  });
  it("não inventa duração ou lê arquivo de outro cliente", () => {
    expect(() => baseDoVideoRapido({...video,duracao_s:null})).toThrow("duração");
    expect(() => baseDoVideoRapido({...video,storage_path:"outro/video.mp4"})).toThrow();
    expect(() => baseDoVideoRapido({...video,tipo:"amostra"})).toThrow();
  });
});
