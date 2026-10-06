import { describe, expect, it } from "vitest";
import { incluirPautasPlanejadas, type PropostaNaEsteira } from "@/components/mesa/pautasPlanejadas";
import { resultadosDeVideoDaPauta } from "@/components/mesa/resultadosDeVideoDaPauta";
import { videoComTrilha } from "@/components/mesa/videoComTrilha";
import type { DadosDosItens } from "@/components/mesa/useItensDoMes";
import { semPassadoVazio } from "@/components/mesa/useItensDoMes";
import type { ArquivoDeVideo, PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import type { VersaoDeVideo } from "../../supabase/functions/mesa-videos/modulos/memoria-de-video";
import { ESTILOS_DE_VIDEO_DA_PAUTA, normalizarVideoDaPauta } from "../../supabase/functions/_shared/video-da-pauta";

const vazio = (): DadosDosItens => ({ itens: [], trabalhos: {}, roteiros: {}, artes: {}, publicacoes: {} });
const proposta = (extra: Partial<PropostaNaEsteira> = {}): PropostaNaEsteira => ({ id: "plano", project_id: "projeto", status: "pronta", itens: [{ tema_id: "foto", tema: "Produto real", formato: "foto", data: "2026-10-09", foto: { referencias: ["real-1"], quantidade: 3 } }, { tema_id: "arte", tema: "Arte", formato: "estatico", data: "2026-10-10" }], ...extra });
describe("Esteira do planejamento", () => {
  it("foto preparada continua na esteira após a data até concluir o trabalho", () => {
    const d = vazio(); d.itens = [{ id: "foto", project_id: "projeto", title: "Foto", delivery_type: "static", due_date: "2026-10-05", status: "todo", modo_estudio: "fotos" }];
    expect(semPassadoVazio(d, "2026-10-06").itens).toHaveLength(1);
    d.itens[0].status = "done"; expect(semPassadoVazio(d, "2026-10-06").itens).toHaveLength(0);
  });
  it("mostra fotos prontas ainda sem tarefa e conserva suas referências", () => {
    const r = incluirPautasPlanejadas(vazio(), [proposta()], ["projeto"], "2026-10-01", "2026-11-01");
    expect(r.itens).toHaveLength(1); expect(r.itens[0].modo_estudio).toBe("fotos");
    expect(r.roteiros[r.itens[0].id].direcao_foto?.referencias).toEqual(["real-1"]);
    expect(r.itens[0].planejamento).toEqual({ proposta_id: "plano", tema_id: "foto" });
  });
  it("não duplica pautas já vinculadas, arquivadas ou fora da janela/projeto", () => {
    const r = incluirPautasPlanejadas(vazio(), [proposta({ status: "descartada" }), proposta({ project_id: "outro" }), proposta({ itens: [{ tema_id: "vinculado", formato: "foto", data: "2026-10-09", task_id: "real" }, { tema_id: "futuro", formato: "foto", data: "2026-11-01" }] })], ["projeto"], "2026-10-01", "2026-11-01");
    expect(r.itens).toEqual([]);
  });
  it("resolve proposta sem projeto pelo único projeto já usado na agenda, preservando a arte", () => {
    const d = vazio(); const arte = { id: "arte", project_id: "projeto", title: "Arte pronta", delivery_type: "carousel", status: "todo", due_date: "2026-10-09" }; d.itens = [arte];
    incluirPautasPlanejadas(d, [proposta({ project_id: null })], ["projeto", "avulso"], "2026-10-01", "2026-11-01");
    expect(d.itens[0]).toBe(arte); expect(d.itens[1].project_id).toBe("projeto");
    incluirPautasPlanejadas(d, [proposta({ project_id: null })], ["projeto", "avulso"], "2026-10-01", "2026-11-01"); expect(d.itens).toHaveLength(2);
  });
  it("não escolhe projeto arbitrário quando não existe vínculo confiável", () => expect(incluirPautasPlanejadas(vazio(), [proposta({ project_id: null })], ["a", "b"], "2026-10-01", "2026-11-01").itens).toEqual([]));
  it("usa vídeo estruturado sem inferir o formato pelo título", () => {
    const r = incluirPautasPlanejadas(vazio(), [proposta({ itens: [{ tema_id: "v", formato: "video", tema: "Loja", data: "2026-10-08", video: { estilo: "loja", referencias: ["foto-real"] } }] })], ["projeto"], "2026-10-01", "2026-11-01");
    expect(r.itens[0].video?.estilo).toBe("loja"); expect(r.itens[0].video?.referencias).toEqual(["foto-real"]);
  });
});
const arquivo = (id: string, extra: Partial<ArquivoDeVideo> = {}): ArquivoDeVideo => ({ id, client_id: "cliente", nome: id, tipo: "gerado", storage_bucket: "mesa", storage_path: `cliente/${id}.mp4`, duracao_s: 8, largura: 1080, altura: 1350, estado: "ativo", criado_em: "2026-10-05", ...extra } as ArquivoDeVideo);
const pedido = (extra: Partial<PedidoDeVideo> = {}): PedidoDeVideo => ({ id: "pedido", client_id: "cliente", parametros: { task_id: "pauta" }, alvo: {}, resultado: { envios: [{ arquivo_id: "resultado" }] }, ...extra } as PedidoDeVideo);
describe("Resultados de vídeo por pauta", () => {
  it("recupera por pedido_id, origem e resultado, sem misturar clientes ou pautas", () => {
    const files = [arquivo("direto", { pedido_id: "pedido" }), arquivo("origem", { origem: { pedido: "pedido" } }), arquivo("resultado"), arquivo("outro"), arquivo("vazamento", { client_id: "outro", pedido_id: "pedido" }), arquivo("apagado", { estado: "arquivado", pedido_id: "pedido" })];
    expect(resultadosDeVideoDaPauta("cliente", "pauta", files, [pedido()], []).map((a) => a.id)).toEqual(["direto", "origem", "resultado"]);
  });
  it("inclui a cadeia de versões com trilha e legenda", () => {
    const files = [arquivo("resultado"), arquivo("trilha", { origem: { versao_id: "v1" } }), arquivo("legenda", { origem: { versao_id: "v2" } })];
    const v = (id: string, fonte: string) => ({ id, client_id: "cliente", projeto: { fontes: { fonte: { arquivo_id: fonte } } } }) as unknown as VersaoDeVideo;
    expect(resultadosDeVideoDaPauta("cliente", "pauta", files, [pedido()], [v("v1", "resultado"), v("v2", "trilha")])).toHaveLength(3);
  });
  it("aceita vínculo pelo alvo, mas não importa música como resultado", () => {
    expect(resultadosDeVideoDaPauta("cliente", "pauta", [arquivo("resultado"), arquivo("musica", { tipo: "audio", pedido_id: "pedido" })], [pedido({ parametros: {}, alvo: { task_id: "pauta" } })], []).map((a) => a.id)).toEqual(["resultado"]);
  });
});
describe("Trilha sonora", () => {
  const musica = arquivo("musica", { tipo: "audio", mime: "audio/mpeg", storage_path: "cliente/musica.mp3", duracao_s: 30 });
  it("preserva vídeo, proporção, áudio original e corta trilha no fim", () => {
    const video = arquivo("video"); const snapshot = JSON.stringify(video); const p = videoComTrilha(video, musica, 24);
    expect(p.formato).toBe("4:5"); expect(p.duracao_s).toBe(8);
    expect(p.trilhas.find((t) => t.tipo === "video")?.clipes[0].volume).toBe(1);
    expect(p.trilhas.filter((t) => t.tipo === "audio").flatMap((t) => t.clipes)[0]?.saida_s).toBe(8);
    expect(p.mixagem.duck).toBe(true); expect(p.mixagem.trilha_abaixo_da_voz_db).toBe(24); expect(JSON.stringify(video)).toBe(snapshot);
  });
  it("recusa outro cliente, arquivo fora do escopo e duração desconhecida", () => {
    expect(() => videoComTrilha(arquivo("v"), { ...musica, client_id: "outro" })).toThrow("mesmo cliente");
    expect(() => videoComTrilha(arquivo("v"), { ...musica, storage_path: "outro/som.mp3" })).toThrow("fora do acervo");
    expect(() => videoComTrilha(arquivo("v", { duracao_s: null }), musica)).toThrow("duração");
  });
  it("todos os estilos da agenda voltam intactos ao estúdio", () => {
    expect(ESTILOS_DE_VIDEO_DA_PAUTA.length).toBeGreaterThanOrEqual(12);
    for (const e of ESTILOS_DE_VIDEO_DA_PAUTA) expect(normalizarVideoDaPauta({ estilo: e.id }).estilo).toBe(e.id);
  });
});
