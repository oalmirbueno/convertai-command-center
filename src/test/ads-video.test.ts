import { describe, expect, it, vi } from "vitest";
import { CONCEITOS_DE_VIDEO_ADS, direcaoDoVideoAds, resultadosDoVideoAds, resumoVideoAds, nomeBaseVideo } from "@/components/mesa-ads/videoDoAnuncio";
import { FORMATOS_VIDEO_ADS, CONHECIMENTO_FORMATOS_VIDEO_ADS } from "../../supabase/functions/mesa-ads/modulos/formatos-video-ads";
import { formatosParaOPlano, copyQueConverteParaOPrompt } from "../../supabase/functions/mesa-ads/modulos/conhecimento-criativo";
import type { CriativoAds } from "@/components/mesa-ads/adsApi";
import type { ArquivoDeVideo, PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import { corpoDaHiggsfield, enviarNaHiggsfield } from "../../supabase/functions/mesa-videos/modulos/video-provedor-higgsfield";
import { custoDoMotor, motorPorId } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";

describe("Vídeos dos criativos Ads", () => {
  it("separa a situação do vídeo da arte e de outro cliente", () => {
    const pedido = { id: "p1", client_id: "c1", estado: "pronto", criado_em: "2026-10-05", parametros: { ads_criativo_id: "a1", formato: "9:16" } } as unknown as PedidoDeVideo;
    const arquivo = { id: "v1", client_id: "c1", pedido_id: "p1", estado: "ativo", mime: "video/mp4", criado_em: "2026-10-05" } as ArquivoDeVideo;
    expect(resumoVideoAds("c1", "a2", [arquivo], [pedido]).estado).toBe("sem_video");
    expect(resumoVideoAds("c2", "a1", [arquivo], [pedido]).estado).toBe("sem_video");
    expect(resumoVideoAds("c1", "a1", [arquivo], [pedido])).toMatchObject({ estado: "gerado", quantidade: 1, nome: "Para revisar" });
    const novo = { ...pedido, id: "p2", criado_em: "2026-10-06", estado: "gerando" } as unknown as PedidoDeVideo;
    expect(resumoVideoAds("c1", "a1", [arquivo], [pedido, novo]).estado).toBe("gerando");
    expect(resumoVideoAds("c1", "a1", [arquivo], [pedido, { ...novo, estado: "erro" } as unknown as PedidoDeVideo]).estado).toBe("erro");
  });
  it("leva gancho, prova e objetivo do plano para a direção em português", () => {
    const c = { nome: "Origem | feed_4x5", copy: { titulo: "Instalação", texto_principal: "Peça orçamento no Direct" } } as CriativoAds;
    const direcao = direcaoDoVideoAds(c, "RD Ar", "bastidores", { formatoId: "passos", angulo: { id: "a", nome: "Instalação", objetivo: "Pedidos qualificados", gancho_visual: "Caixa e aparelho", prova: "Referência enviada", mecanismo: "Próximo passo" } });
    expect(direcao).toContain("Pedidos qualificados"); expect(direcao).toContain("Caixa e aparelho"); expect(direcao).toContain("Referência enviada");
    expect(direcao).toContain("português brasileiro"); expect(direcao).toContain("Passo a passo"); expect(direcao.length).toBeLessThan(2400);
    expect(nomeBaseVideo(c)).toBe("Instalação");
  });
  it("compartilha a curadoria de referência com plano e copy, sem alegar conversão validada", () => {
    expect(FORMATOS_VIDEO_ADS).toHaveLength(10);
    expect(CONHECIMENTO_FORMATOS_VIDEO_ADS).toContain("sem resultados de conversão auditados");
    expect(formatosParaOPlano()).toContain(CONHECIMENTO_FORMATOS_VIDEO_ADS);
    expect(copyQueConverteParaOPrompt()).toContain(CONHECIMENTO_FORMATOS_VIDEO_ADS);
  });
  it("prepara conceitos distintos com a oferta real, sem inventar preço", () => {
    const c = { nome: "Filtro lavável", copy: { texto_principal: "Higienização com visita técnica", titulo: "Respire melhor", angulo_de_venda: "Manutenção preventiva", cta_meta: "WHATSAPP_MESSAGE" } } as CriativoAds;
    const prompts = CONCEITOS_DE_VIDEO_ADS.map((x) => direcaoDoVideoAds(c, "RD Ar", x.id));
    expect(new Set(prompts).size).toBe(8);
    for (const p of prompts) {
      expect(p).toContain("Higienização com visita técnica");
      expect(p).toContain("Manutenção preventiva");
      expect(p).toContain("RD Ar");
      expect(p).not.toMatch(/R\$|50%/);
    }
  });
  it("isola resultados por cliente e criativo, exclui imagens e arquivos arquivados", () => {
    const pedidos = [{ id: "p1", client_id: "c1", parametros: { ads_criativo_id: "a1" } }, { id: "p2", client_id: "c1", parametros: { ads_criativo_id: "a2" } }, { id: "p3", client_id: "c2", parametros: { ads_criativo_id: "a1" } }] as unknown as PedidoDeVideo[];
    const base = { client_id: "c1", pedido_id: "p1", estado: "pronto", mime: "video/mp4", criado_em: "2026-10-06" };
    const arquivos = [{ ...base, id: "ok" }, { ...base, id: "other", pedido_id: "p2" }, { ...base, id: "tenant", pedido_id: "p3", client_id: "c2" }, { ...base, id: "image", mime: "image/png" }, { ...base, id: "deleted", estado: "arquivado" }] as ArquivoDeVideo[];
    expect(resultadosDoVideoAds("c1", "a1", arquivos, pedidos).map((a) => a.id)).toEqual(["ok"]);
  });
  it("estima a resolução correta e respeita o teto de 30 segundos documentado", () => {
    const motor = motorPorId("higgsfield-cinema-4")!;
    expect(custoDoMotor(motor, { duracao_s: 6, resolucao: "720p" }).usd).toBeCloseTo(2.7738, 3);
    expect(custoDoMotor(motor, { duracao_s: 6, resolucao: "480p" }).usd).toBeCloseTo(1.2342, 3);
    expect(corpoDaHiggsfield(motor, { modo: "texto", prompt: "Produto", duracao_s: 40, formato: "3:4", audio: true, camera: "tracking" })).toMatchObject({ duration: 30, aspect_ratio: "3:4", generate_audio: true, camera_movement: "tracking" });
  });
  it("envia idempotência sem duplicar o pedido e mantém a autenticação no servidor", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ request_id: "req-123", status: "queued" }), { status: 200 }));
    await enviarNaHiggsfield("higgsfield/cinema-studio/4.0", { prompt: "Produto" }, { chave: "fixture-id", segredo: "fixture-secret", fetchImpl }, { idempotencia: "pedido-1-0" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ "Idempotency-Key": "pedido-1-0", Authorization: "Key fixture-id:fixture-secret" });
  });
  it("aceita a chave copiada inteira, sem exigir ou anexar um segundo segredo", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ request_id: "req-full", status: "queued" }), { status: 200 }));
    await enviarNaHiggsfield("higgsfield/cinema-studio/4.0", { prompt: "Produto" }, { chave: "fixture-id:fixture-secret", segredo: "legacy", fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Key fixture-id:fixture-secret");
  });

});
