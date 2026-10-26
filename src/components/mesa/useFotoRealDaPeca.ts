import { useQuery } from "@tanstack/react-query";
import type { DirecaoDeVideoDaPauta } from "../../../supabase/functions/_shared/video-da-pauta";
import { normalizarVideoDaPauta } from "../../../supabase/functions/_shared/video-da-pauta";
import { fotoRealDaPeca, type FotoRealDaPeca } from "./planoDoMes";
import type { ItemDoMes } from "./useItensDoMes";

/**
 * Foto real primeiro no vídeo da pauta (26/10, dono: "o Estúdio tem que ler as fotos e achar interessante
 * colocar de forma inteligente imagens reais quando tem"). A peça que ainda não tem imagem de partida (nem
 * mídia pensada, nem referência na direção) pergunta uma vez se há foto REAL do acervo que combina (o Jev, em
 * centavos). Com uma acima do corte, ela abre pré-selecionada como imagem de partida (dá para trocar); sem
 * nenhuma, a geração por IA segue e a tela diz isso numa linha.
 */

/** A peça precisa perguntar? Só quando nada escolheu a imagem de partida antes. */
export function precisaDeFotoReal(item: Pick<ItemDoMes, "midia" | "video">): boolean {
  if (item.midia && item.midia.acervo && item.midia.acervo.length) return false;
  return !(item.video && item.video.referencias && item.video.referencias.length);
}

/** A direção que o gerador recebe: a da pauta e, sem referência, a foto real escolhida como imagem de partida. */
export function direcaoComFotoReal(video: DirecaoDeVideoDaPauta | undefined, resposta: FotoRealDaPeca | null | undefined): DirecaoDeVideoDaPauta | undefined {
  const ids = resposta && resposta.modo === "real" ? resposta.fotos.map((f) => f.id).slice(0, 1) : [];
  if (!ids.length) return video;
  if (video && video.referencias.length) return video;
  return { ...(video || normalizarVideoDaPauta(null)), referencias: ids };
}

export function useFotoRealDaPeca(clientId: string, taskId: string, uso: "arte" | "video", ativo: boolean) {
  return useQuery({
    queryKey: ["mesa", "foto-real-da-peca", clientId, taskId, uso],
    enabled: ativo && !!clientId && !!taskId,
    queryFn: () => fotoRealDaPeca(clientId, taskId, uso),
    // Uma pergunta por peça na sessão: o acervo não muda a cada abertura e cada pergunta custa o Jev.
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
