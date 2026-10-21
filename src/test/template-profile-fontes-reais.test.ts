import { describe, expect, it, vi } from "vitest";
import { fontesDoProfile, fonteDoProfile, pontoNaImagemProfile, urlDaFonteProfile } from "@/components/mesa/profile/fontesDoProfile";
import { desenharProfile } from "@/components/mesa/profile/renderProfile";
import type { TemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

const template: TemplateProfile = { versao: 1, estilo: "twitter", nome: "Loja A", username: "loja.a", texto: "Abra as configurações do painel.", verificado: false, tema: "claro", cor_fundo: "#ffffff", tamanho_texto: 36, tamanho_foto: 76, espacamento: 30, arredondamento: 16 };
function quadro() {
  const ctx = { font: "", save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arcTo: vi.fn(), arc: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), measureText: (s: string) => ({ width: s.length * 12 }) };
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, ctx };
}
describe("Fontes reais do Profile", () => {
  it("mantém fotos explícitas antes da vitrine e pesquisa, sem aceitar outro cliente", () => {
    const card = { ordem: 1, fotos_livres: [{ caminho: "a/rosto.png", papel: "elemento" as const, uso: "rosto" as const }, { caminho: "a/produto.png", papel: "fundo" as const }], vitrine_tipo: "pagina_real", vitrine_de_logos: [{ caminho: "a/painel.png", nome: "https://exemplo.com/configuracoes" }, { caminho: "b/privado.png", nome: "Outro cliente" }], fontes_reais: [{ caminho: "a/marca.png", nome: "Marca oficial", fonte_url: "https://exemplo.com/marca", licenca: "Uso autorizado", autor: "Marca", tipo: "logo" as const }] };
    const fontes = fontesDoProfile(card, [], "a");
    expect(fontes.map((f) => f.caminho)).toEqual(["a/produto.png", "a/rosto.png", "a/painel.png", "a/marca.png"]);
    expect(fontes[0].exata).toBe(true);
    expect(fontes[1].exata).toBe(false);
    expect(fontes[2]).toMatchObject({ origem: "Captura real da pesquisa", url: "https://exemplo.com/configuracoes", exata: true });
    expect(fontes[3]).toMatchObject({ licenca: "Uso autorizado", autor: "Marca", url: "https://exemplo.com/marca", exata: true });
    expect(fonteDoProfile(card, [], "a/painel.png", "a")).toEqual({ caminho: "a/painel.png", bucket: "mesa" });
    expect(fonteDoProfile(card, [], "b/privado.png", "a")).toEqual({ caminho: "a/produto.png", bucket: "mesa" });
  });
  it("usa captura existente sem anexar uma foto nova e rejeita URLs ativas ou autenticadas", () => {
    expect(fontesDoProfile({ ordem: 1, vitrine_de_logos: [{ caminho: "a/painel.png", nome: "Print real" }] }, [], "a")[0]).toMatchObject({ caminho: "a/painel.png", exata: true });
    expect(urlDaFonteProfile("javascript:alert(1)")).toBeUndefined();
    expect(urlDaFonteProfile("https://user:senha@exemplo.com/")).toBeUndefined();
    expect(fontesDoProfile({ ordem: 1, vitrine_de_logos: [{ caminho: "a/../b/print.png", nome: "Inválido" }] }, [], "a")).toEqual([]);
  });
  it("consulta somente IDs anexados do acervo antes das pesquisas, sem importar o restante", () => {
    const imagem = (id: string) => ({ id, storage_bucket: "mesa", storage_path: `a/${id}.png`, nome: id, pasta: null, categoria: null, tags: null, descricao: null, origem: "https://exemplo.com/foto" });
    const fontes = fontesDoProfile({ ordem: 1, imagens_ids: ["escolhida"], vitrine_de_logos: [{ caminho: "a/captura.png", nome: "Captura" }] }, [imagem("outra"), imagem("escolhida")], "a");
    expect(fontes.map((f) => f.caminho)).toEqual(["a/escolhida.png", "a/captura.png"]);
    expect(fontes[0].url).toBe("https://exemplo.com/foto");
  });
  it("normaliza apenas cliques nos pixels da imagem, excluindo as margens", () => {
    const imagem = { x: 200, y: 400, largura: 400, altura: 500 };
    expect(pontoNaImagemProfile(300, 700, imagem)).toEqual({ x: .25, y: .6 });
    expect(pontoNaImagemProfile(100, 700, imagem)).toBeNull();
    expect(pontoNaImagemProfile(Number.NaN, 700, imagem)).toBeNull();
    expect(pontoNaImagemProfile(300, 700, null)).toBeNull();
  });
});
describe("Anotação determinística sobre a imagem real", () => {
  it.each(["twitter", "instagram"] as const)("preserva imagem inteira e a posição do ponto no PNG %s", (estilo) => {
    const imagem = { naturalWidth: 400, naturalHeight: 1200 } as HTMLImageElement;
    const cfg = { ...template, estilo, arredondamento: 48, destaque: { x: .25, y: .6, rotulo: "Configurações" } };
    const previa = quadro(), salvo = quadro();
    const resultado = desenharProfile(previa.canvas, cfg, "feed_4x5", { imagem, imagemExata: true });
    desenharProfile(salvo.canvas, cfg, "feed_4x5", { imagem, imagemExata: true });
    const rect = resultado.imagem!;
    expect(rect.largura / rect.altura).toBeCloseTo(1 / 3);
    expect(previa.ctx.drawImage.mock.calls[0]).toEqual([imagem, rect.x, rect.y, rect.largura, rect.altura]);
    const circulos = previa.ctx.arc.mock.calls;
    expect(circulos[circulos.length - 1]).toEqual([rect.x + rect.largura * .25, rect.y + rect.altura * .6, 17, 0, Math.PI * 2]);
    expect(salvo.ctx.arc.mock.calls).toEqual(circulos);
    expect(salvo.ctx.drawImage.mock.calls).toEqual(previa.ctx.drawImage.mock.calls);
    // A segunda caixa é a imagem exata: cantos sem recorte; a última é o rótulo.
    expect(previa.ctx.arcTo.mock.calls.slice(4, 8).every((c) => c[4] === 0)).toBe(true);
    expect(imagem).toEqual({ naturalWidth: 400, naturalHeight: 1200 });
  });
  it("não inventa um ponto e rejeita anotação sem imagem ou fora dela", () => {
    const { canvas, ctx } = quadro();
    desenharProfile(canvas, template, "feed_4x5");
    expect(ctx.arc).toHaveBeenCalledTimes(1); // somente o avatar
    expect(() => desenharProfile(canvas, { ...template, destaque: { x: .2, y: .4, rotulo: "Abrir" } }, "feed_4x5")).toThrow("imagem real");
    expect(() => desenharProfile(canvas, { ...template, destaque: { x: 2, y: .4, rotulo: "Abrir" } }, "feed_4x5", { imagem: { naturalWidth: 400, naturalHeight: 400 } as HTMLImageElement })).toThrow("dentro da imagem");
  });
  it("uma captura enviada em Fotos também mantém as bordas quando recebe um ponto", () => {
    const { canvas, ctx } = quadro();
    desenharProfile(canvas, { ...template, arredondamento: 48, destaque: { x: .1, y: .2, rotulo: "Botão" } }, "feed_4x5", { imagem: { naturalWidth: 1600, naturalHeight: 900 } as HTMLImageElement });
    expect(ctx.arcTo.mock.calls.slice(4, 8).every((c) => c[4] === 0)).toBe(true);
  });
});
