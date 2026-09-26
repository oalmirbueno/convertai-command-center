import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Apoio do editor (frente V-B): URLs assinadas das fontes (uma leitura por
 * lote, relida aos 45 min), o relógio do cursor (fora do estado do React
 * para a linha do tempo não redesenhar 25 vezes por segundo) e a checagem de
 * navegador.
 */

export function useUrlsDasFontes(projeto: ProjetoDeEdicao, extras: { storage_bucket: string | null; storage_path: string | null }[] = []): Record<string, string> {
  const pares = useMemo(() => {
    const lista: { chave: string; bucket: string; caminho: string }[] = [];
    Object.keys(projeto.fontes).forEach((k) => {
      const f = projeto.fontes[k];
      if (f.storage_path) lista.push({ chave: k, bucket: f.storage_bucket || "mesa", caminho: f.storage_path });
    });
    extras.forEach((x) => x.storage_path && lista.push({ chave: `@${x.storage_path}`, bucket: x.storage_bucket || "mesa", caminho: x.storage_path }));
    return lista.sort((a, b) => (a.chave < b.chave ? -1 : 1));
  }, [projeto.fontes, extras]);
  const chave = pares.map((p) => `${p.bucket}:${p.caminho}`).join("|");
  const q = useQuery({
    queryKey: ["mesa-edicao", "editor", "urls", chave],
    enabled: pares.length > 0,
    staleTime: 45 * 60_000,
    gcTime: 55 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const saida: Record<string, string> = {};
      const porBucket: Record<string, { chave: string; caminho: string }[]> = {};
      pares.forEach((p) => (porBucket[p.bucket] = (porBucket[p.bucket] || []).concat([{ chave: p.chave, caminho: p.caminho }])));
      for (const bucket of Object.keys(porBucket)) {
        const lista = porBucket[bucket];
        const { data } = await supabase.storage.from(bucket).createSignedUrls(
          lista.map((x) => x.caminho),
          3600,
        );
        ((data || []) as { path: string | null; signedUrl: string; error: string | null }[]).forEach((d) => {
          if (!d.path || !d.signedUrl || d.error) return;
          lista.filter((x) => x.caminho === d.path).forEach((x) => (saida[x.chave] = d.signedUrl));
        });
      }
      return saida;
    },
  });
  return q.data || {};
}

// ------------------------------------------------------------------ relógio do cursor

export interface Relogio {
  get: () => number;
  set: (s: number) => void;
  ouvir: (f: (s: number) => void) => () => void;
}

export function criarRelogio(inicial = 0): Relogio {
  let valor = inicial;
  const ouvintes = new Set<(s: number) => void>();
  return {
    get: () => valor,
    set(s) {
      if (s === valor) return;
      valor = s;
      ouvintes.forEach((f) => f(s));
    },
    ouvir(f) {
      ouvintes.add(f);
      return () => {
        ouvintes.delete(f);
      };
    },
  };
}

/** Lê o relógio; `passo` arredonda (ex.: 0,1 s) para redesenhar menos. */
export function useTempo(r: Relogio, passo = 0): number {
  const [v, setV] = useState(r.get());
  useEffect(() => r.ouvir((s) => setV(passo > 0 ? Math.round(s / passo) * passo : s)), [r, passo]);
  return v;
}

// ------------------------------------------------------------------ navegador

/**
 * O editor pede navegador de 2020 para cá (Chrome/Edge 88+, Safari 14+,
 * Firefox 85+). O resto do painel continua no piso Safari 11; aqui a tela só
 * avisa com calma e mostra a montagem para ler.
 */
export function navegadorDoEditor(): { ok: boolean; motivo: string | null } {
  try {
    const w = window as unknown as Record<string, unknown>;
    const faltando: string[] = [];
    if (typeof w.IntersectionObserver !== "function") faltando.push("IntersectionObserver");
    if (typeof w.AbortController !== "function") faltando.push("AbortController");
    if (!(typeof CSS !== "undefined" && CSS.supports && CSS.supports("clip-path", "inset(0 0 0 50%)"))) faltando.push("clip-path");
    if (typeof (w.HTMLVideoElement as { prototype?: unknown } | undefined) === "undefined") faltando.push("video");
    if (typeof (Array.prototype as unknown as { flat?: unknown }).flat !== "function") faltando.push("Array.flat");
    return faltando.length ? { ok: false, motivo: faltando.join(", ") } : { ok: true, motivo: null };
  } catch {
    return { ok: false, motivo: "desconhecido" };
  }
}

export const ehCampoDeTexto = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  const t = e.tagName.toLowerCase();
  return t === "input" || t === "textarea" || t === "select" || e.isContentEditable;
};
