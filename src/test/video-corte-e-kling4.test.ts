import { describe, expect, it } from "vitest";
import { lerCorte, projetoDoCorte, ErroDoCorte } from "../../supabase/functions/mesa-videos/modulos/corte-do-final";
import { corpoDaGeracao, endpointDaGeracao } from "../../supabase/functions/mesa-videos/modulos/video-executor";
import { MOTORES_DE_VIDEO } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { trechoValido } from "@/components/mesa/CortarVideoDaPauta";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const arquivo = { id: "22222222-2222-4222-8222-222222222222", client_id: CLIENTE, nome: "Caminho de folhas", tipo: "gerado", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/gerados/a.mp4`, duracao_s: 5, largura: 720, altura: 1280 };

describe("corte simples do vídeo pronto (27/10)", () => {
  it("prende o trecho ao vídeo e recusa o que não corta nada ou fica curto", () => {
    expect(lerCorte(0.5, 4.2, 5)).toEqual({ entrada_s: 0.5, saida_s: 4.2 });
    expect(lerCorte(1, 99, 10.5)).toEqual({ entrada_s: 1, saida_s: 10.5 });
  });
  it("vídeo inteiro, trecho curto e duração desconhecida viram erro claro", () => {
    expect(() => lerCorte(0, 5, 5)).toThrow(/vídeo inteiro/);
    expect(() => lerCorte(2, 2.5, 5)).toThrow(/pelo menos 1 s/);
    expect(() => lerCorte(0, 3, null)).toThrow(ErroDoCorte);
  });
  it("monta uma trilha só, do início ao fim marcados, começando no zero", () => {
    const p = projetoDoCorte(arquivo, { entrada_s: 1, saida_s: 4 });
    const video = p.trilhas.find((t) => t.tipo === "video")!;
    expect(video.clipes).toHaveLength(1);
    expect(video.clipes[0]).toMatchObject({ inicio_s: 0, entrada_s: 1, saida_s: 4 });
    expect(p.duracao_s).toBe(3);
    expect(Object.values(p.fontes)[0]).toMatchObject({ arquivo_id: arquivo.id, storage_path: arquivo.storage_path });
    expect(p.formato).toBe("9:16");
  });
  it("vídeo de fora do acervo da Mesa não é cortado", () => {
    expect(() => projetoDoCorte({ ...arquivo, storage_bucket: "workspace" }, { entrada_s: 1, saida_s: 4 })).toThrow(/acervo da Mesa/);
  });
  it("a tela só libera Cortar com trecho válido", () => {
    expect(trechoValido(0, 5, 5).ok).toBe(false);
    expect(trechoValido(1, 1.5, 5).ok).toBe(false);
    expect(trechoValido(1, 4, 5)).toEqual({ entrada: 1, saida: 4, ok: true });
    expect(trechoValido(-1, 9, 5)).toMatchObject({ entrada: 0, saida: 5, ok: false });
  });
});

describe("Kling 4.0 (27/10)", () => {
  const m = MOTORES_DE_VIDEO.find((x) => x.id === "kling-4")!;
  const base = { prompt: "Caminho de folhas no outono", duracao_s: 5, formato: "9:16", resolucao: "1080p", audio: true } as const;
  it("está no catálogo com o preço conferido e linha própria (não troca o Kling sugerido)", () => {
    expect(m).toBeTruthy();
    expect(m.linha).toBe("kling-4");
    expect(m.preco?.por_segundo).toEqual({ "720p": 0.157, "1080p": 0.235 });
    expect(m.cap.audio).toBe(false);
  });
  it("primeiro quadro vai como start_image_url e duração inteira", () => {
    const e = { ...base, modo: "primeiro_quadro", quadro_inicial_url: "https://x/a.jpg" } as never;
    expect(endpointDaGeracao(m, e)).toBe("kling/v4/image-to-video");
    expect(corpoDaGeracao(m, e)).toEqual({ prompt: base.prompt, start_image_url: "https://x/a.jpg", duration: 5, resolution: "1080p" });
  });
  it("referências reais entram como @Image1..N no prompt", () => {
    const e = { ...base, modo: "referencia", referencias_urls: ["https://x/1.jpg", "https://x/2.jpg"] } as never;
    const c = corpoDaGeracao(m, e) as Record<string, unknown>;
    expect(endpointDaGeracao(m, e)).toBe("kling/v4/reference-to-video");
    expect(c.image_urls).toEqual(["https://x/1.jpg", "https://x/2.jpg"]);
    expect(String(c.prompt)).toContain("@Image1, @Image2");
    expect(c).not.toHaveProperty("generate_audio");
  });
});
