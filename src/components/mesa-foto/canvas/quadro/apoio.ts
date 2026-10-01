import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MidiaDaCamada, QuadroAnimado } from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";

/**
 * Apoio do editor de Quadro (frente CNV, 30/09): desfazer e refazer, links
 * assinados das mídias e as fontes livres do motion no navegador. Sem React
 * Flow e sem a composição do render.
 */

export const MAX_PASSOS_DO_DESFAZER = 60;

export interface Historico {
  passado: QuadroAnimado[];
  futuro: QuadroAnimado[];
}

/** Grava o estado de antes (para o Desfazer) e limpa o Refazer. */
export function empilhar(h: Historico, antes: QuadroAnimado): Historico {
  const passado = h.passado.concat([antes]);
  return { passado: passado.slice(Math.max(0, passado.length - MAX_PASSOS_DO_DESFAZER)), futuro: [] };
}

export function desfazer(h: Historico, atual: QuadroAnimado): { historico: Historico; quadro: QuadroAnimado } | null {
  if (!h.passado.length) return null;
  const quadro = h.passado[h.passado.length - 1];
  return { quadro, historico: { passado: h.passado.slice(0, -1), futuro: [atual].concat(h.futuro).slice(0, MAX_PASSOS_DO_DESFAZER) } };
}

export function refazer(h: Historico, atual: QuadroAnimado): { historico: Historico; quadro: QuadroAnimado } | null {
  if (!h.futuro.length) return null;
  const quadro = h.futuro[0];
  return { quadro, historico: { passado: h.passado.concat([atual]).slice(-MAX_PASSOS_DO_DESFAZER), futuro: h.futuro.slice(1) } };
}

/**
 * Quadro com desfazer: `mudar(fn, juntar?)` grava um passo; com `juntar`
 * (arrastar, digitar), mudanças seguidas da mesma chave viram UM passo.
 */
export function useQuadroComDesfazer(inicial: QuadroAnimado) {
  const [estado, setEstado] = useState<{ quadro: QuadroAnimado; historico: Historico }>({ quadro: inicial, historico: { passado: [], futuro: [] } });
  const atual = useRef(estado);
  atual.current = estado;
  const ultimaJuncao = useRef<{ chave: string; em: number } | null>(null);
  const por = (novo: { quadro: QuadroAnimado; historico: Historico }) => {
    atual.current = novo;
    setEstado(novo);
  };

  const mudar = useCallback((fn: (q: QuadroAnimado) => QuadroAnimado, juntar?: string) => {
    const antes = atual.current;
    const depois = fn(antes.quadro);
    if (depois === antes.quadro) return;
    const agora = Date.now();
    const j = ultimaJuncao.current;
    const mesmoPasso = !!juntar && !!j && j.chave === juntar && agora - j.em < 1200;
    ultimaJuncao.current = juntar ? { chave: juntar, em: agora } : null;
    por({ quadro: depois, historico: mesmoPasso ? antes.historico : empilhar(antes.historico, antes.quadro) });
  }, []);

  const trocar = useCallback((q: QuadroAnimado) => {
    ultimaJuncao.current = null;
    por({ quadro: q, historico: empilhar(atual.current.historico, atual.current.quadro) });
  }, []);

  const voltar = useCallback(() => {
    ultimaJuncao.current = null;
    const r = desfazer(atual.current.historico, atual.current.quadro);
    if (r) por({ quadro: r.quadro, historico: r.historico });
  }, []);

  const avancar = useCallback(() => {
    ultimaJuncao.current = null;
    const r = refazer(atual.current.historico, atual.current.quadro);
    if (r) por({ quadro: r.quadro, historico: r.historico });
  }, []);

  return {
    quadro: estado.quadro,
    mudar,
    trocar,
    desfazer: voltar,
    refazer: avancar,
    podeDesfazer: estado.historico.passado.length > 0,
    podeRefazer: estado.historico.futuro.length > 0,
  };
}

/** Links assinados (1 hora) das mídias do quadro, por caminho. Relê só quando a lista muda. */
export function useUrlsDasMidias(midias: (MidiaDaCamada | null | undefined)[]): Record<string, string> {
  const caminhos = midias
    .filter((m): m is MidiaDaCamada => !!m)
    .map((m) => `${m.bucket}|${m.caminho}`)
    .filter((x, i, l) => l.indexOf(x) === i)
    .sort();
  const chave = caminhos.join("\n");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!caminhos.length) return;
    let vivo = true;
    const porBucket: Record<string, string[]> = {};
    caminhos.forEach((x) => {
      const [b, c] = x.split("|");
      if (urls[c]) return;
      (porBucket[b] = porBucket[b] || []).push(c);
    });
    Object.keys(porBucket).forEach((b) => {
      void supabase.storage
        .from(b)
        .createSignedUrls(porBucket[b], 3600)
        .then((r) => {
          if (!vivo || !r || !r.data) return;
          const novas: Record<string, string> = {};
          r.data.forEach((x) => {
            if (x.path && x.signedUrl && !x.error) novas[x.path] = x.signedUrl;
          });
          setUrls((u) => ({ ...u, ...novas }));
        })
        .catch(() => undefined);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return urls;
}

/** Fontes livres do motion (as mesmas do render) carregadas uma vez no navegador. */
const FONTES = [
  { familia: "Montserrat", arquivo: "/editor/fontes/Montserrat-Variable.woff2", peso: "100 900" },
  { familia: "Anton", arquivo: "/editor/fontes/Anton-Regular.woff2", peso: "400" },
  { familia: "Caveat", arquivo: "/editor/fontes/Caveat-Variable.woff2", peso: "400 700" },
  { familia: "Figtree", arquivo: "/editor/fontes/Figtree-Variable.woff2", peso: "300 900" },
];
let fontesPedidas: Promise<void> | null = null;
export function carregarFontesDoQuadro(): Promise<void> {
  if (fontesPedidas) return fontesPedidas;
  const F = typeof window !== "undefined" ? (window as unknown as { FontFace?: new (f: string, s: string, d?: Record<string, string>) => { load: () => Promise<unknown> } }).FontFace : undefined;
  if (!F || typeof document === "undefined" || !(document as unknown as { fonts?: unknown }).fonts) {
    fontesPedidas = Promise.resolve();
    return fontesPedidas;
  }
  fontesPedidas = Promise.all(
    FONTES.map((f) =>
      new F(f.familia, `url(${f.arquivo}) format('woff2')`, { weight: f.peso })
        .load()
        .then((ff) => (document as unknown as { fonts: { add: (x: unknown) => void } }).fonts.add(ff))
        .catch(() => null),
    ),
  ).then(() => undefined);
  return fontesPedidas;
}

export function useFontesDoQuadro() {
  const [prontas, setProntas] = useState(false);
  useEffect(() => {
    let vivo = true;
    void carregarFontesDoQuadro().then(() => vivo && setProntas(true));
    return () => {
      vivo = false;
    };
  }, []);
  return prontas;
}

/** Nome de arquivo seguro para baixar. */
export const nomeDeArquivo = (t: string, ext: string) =>
  `${(t || "quadro")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "quadro"}.${ext}`;
