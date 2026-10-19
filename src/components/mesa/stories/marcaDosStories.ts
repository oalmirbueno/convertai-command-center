import { useMemo } from "react";
import { useKitDaMesa } from "../kitDaMesa";
import { useFonteDaMarca } from "../instagram/fonteDaMarca";
import { useAcervo, type ImagemDoAcervo } from "../SeletorDoAcervo";
import { hexValido } from "./layoutDoStory";

/**
 * O que a arte do story usa da marca aberta na Mesa: as cores do kit, a fonte
 * de título (a mesma das capas tipográficas) e o acervo de fotos reais do
 * cliente (cliente_imagens, já filtrado pela marca).
 */
export function useMarcaDosStories(clientId: string) {
  const kit = useKitDaMesa(clientId);
  const fonte = useFonteDaMarca(clientId);
  const acervo = useAcervo();
  const paleta = useMemo(() => {
    const cores = (kit.data && Array.isArray(kit.data.paleta) ? kit.data.paleta : []) as Array<{ hex?: string }>;
    const saida: string[] = [];
    for (const c of cores) {
      const h = hexValido(c && c.hex);
      if (h && saida.indexOf(h) < 0) saida.push(h);
    }
    return saida;
  }, [kit.data]);
  const fotos = useMemo(() => (acervo.data || []).filter((i) => (i.categoria || "") !== "logo"), [acervo.data]);
  const fotoPorId = useMemo(() => {
    const m: Record<string, ImagemDoAcervo> = {};
    for (const i of acervo.data || []) m[i.id] = i;
    return m;
  }, [acervo.data]);
  return {
    paleta,
    familia: fonte.familia,
    nomeDaFonte: fonte.nome,
    fotos,
    carregandoFotos: acervo.isLoading,
    foto: (id: string | null | undefined): ImagemDoAcervo | null => (id && fotoPorId[id]) || null,
  };
}

export type MarcaDosStories = ReturnType<typeof useMarcaDosStories>;
