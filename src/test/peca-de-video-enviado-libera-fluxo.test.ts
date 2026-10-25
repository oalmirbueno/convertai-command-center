import { describe, expect, it } from "vitest";
import { videoEnviadoDaPeca } from "@/components/mesa/resultadosDeVideoDaPauta";
import { normalizarVideoPronto } from "../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import type { ArquivoDeVideo } from "@/components/mesa-videos/videosApi";

const C = "11111111-1111-4111-8111-111111111111";
const arq = (p: Partial<ArquivoDeVideo>): ArquivoDeVideo => ({
  id: "a", client_id: C, nome: "x.mp4", nome_original: "x.mp4", storage_bucket: "mesa", storage_path: `${C}/x.mp4`, tipo: "bruto",
  mime: "video/mp4", bytes: 1, duracao_s: 55, largura: 1080, altura: 1920, sha256: null, gravado_em: null, roteiro_id: null,
  cena_ref: null, grupo: null, melhor: false, nota: null, estado: "ativo", criado_em: "2026-10-25T10:00:00Z", ...p,
} as ArquivoDeVideo);

describe("vídeo enviado para a peça libera legendar, trilha e entrega (25/10)", () => {
  const pronto = { bucket: "workspace", caminho: `${C}/videos/chilli.mp4`, nome: "Chilli beans edit.mp4", duracao_s: 55 };

  it("acha pelo arquivo_id guardado na peça", () => {
    const alvo = arq({ id: "22222222-2222-4222-8222-222222222222", nome: "outro.mp4" });
    expect(videoEnviadoDaPeca(C, { ...pronto, arquivo_id: alvo.id }, [arq({ id: "b" }), alvo])?.id).toBe(alvo.id);
  });

  it("envio antigo sem id: acha pelo nome e duração, o mais recente, só do mesmo cliente e ativo", () => {
    const lista = [
      arq({ id: "velho", nome_original: "Chilli beans edit.mp4", criado_em: "2026-10-24T10:00:00Z" }),
      arq({ id: "novo", nome_original: "Chilli beans edit.mp4", criado_em: "2026-10-25T10:00:00Z" }),
      arq({ id: "arquivado", nome_original: "Chilli beans edit.mp4", estado: "arquivado", criado_em: "2026-10-26T10:00:00Z" }),
      arq({ id: "outro-cliente", client_id: "x", nome_original: "Chilli beans edit.mp4", criado_em: "2026-10-27T10:00:00Z" }),
      arq({ id: "outra-duracao", nome_original: "Chilli beans edit.mp4", duracao_s: 12, criado_em: "2026-10-28T10:00:00Z" }),
    ];
    expect(videoEnviadoDaPeca(C, pronto, lista)?.id).toBe("novo");
  });

  it("sem registro no acervo, não inventa (vídeo escolhido só do Workspace)", () => {
    expect(videoEnviadoDaPeca(C, pronto, [arq({ id: "z", nome_original: "outro.mp4" })])).toBeNull();
    expect(videoEnviadoDaPeca(C, null, [arq({})])).toBeNull();
  });

  it("o servidor guarda o arquivo_id válido e descarta o inválido", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(normalizarVideoPronto({ ...pronto, arquivo_id: id, em: "x" }, C)?.arquivo_id).toBe(id);
    expect(normalizarVideoPronto({ ...pronto, arquivo_id: "1; drop", em: "x" }, C)?.arquivo_id).toBeUndefined();
  });
});
