import { describe, expect, it, vi } from "vitest";
import { CONCEITOS_DE_VIDEO_ADS, direcaoDoVideoAds, resultadosDoVideoAds } from "@/components/mesa-ads/videoDoAnuncio";
import type { CriativoAds } from "@/components/mesa-ads/adsApi";
import type { ArquivoDeVideo, PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import { corpoDaHiggsfield, enviarNaHiggsfield } from "../../supabase/functions/mesa-videos/modulos/video-provedor-higgsfield";
import { custoDoMotor, motorPorId } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";

describe("Vídeos dos criativos Ads", () => {
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
    const pedidos = [{ id: "p1", client_id: "c1", parametros: { ads_criativo_id: "a1" } }, { id: "p2", client_id: "c1", parametros: { ads_criativo_id: "a2" } }, { id: "p3", client_id: "c2", parametros: { ads_criativo_id: "a1" } }] as PedidoDeVideo[];
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
});
