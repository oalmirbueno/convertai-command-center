import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { caminhoDaFonteValido, chaveDaFonteDaMarca, type ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Apoio do editor (frente V-B): URLs assinadas das fontes (uma leitura por
 * lote, relida aos 45 min), o relógio do cursor (fora do estado do React
 * para a linha do tempo não redesenhar 25 vezes por segundo) e a checagem de
 * navegador.
 */

// ------------------------------------------------------------------ URLs das fontes
//
// Cada fonte tem a própria consulta (bucket:caminho). Antes, uma chave só
// juntava todas: somar, tirar ou desfazer uma fonte reassinava todas, todas as
// URLs mudavam, o Player recarregava os vídeos e o cache de quadros não servia
// mais. Os pedidos que chegam juntos continuam indo numa chamada por bucket.

type Espera = { resolver: (url: string | null) => void };
const lotes = new Map<string, Map<string, Espera[]>>();
let loteAgendado = false;

async function assinarLote(bucket: string, pedidos: Map<string, Espera[]>) {
  const caminhos = Array.from(pedidos.keys());
  const achadas: Record<string, string> = {};
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(caminhos, 3600);
    ((data || []) as { path: string | null; signedUrl: string; error: string | null }[]).forEach((d) => {
      if (!d.path || !d.signedUrl || d.error) return;
      achadas[d.path] = d.signedUrl;
    });
  } catch {
    /* sem URL: a fonte fica sem prévia, como antes */
  }
  pedidos.forEach((esperas, caminho) => esperas.forEach((e) => e.resolver(Object.prototype.hasOwnProperty.call(achadas, caminho) ? achadas[caminho] : null)));
}

function enviarLotes() {
  loteAgendado = false;
  const agora = Array.from(lotes.entries());
  lotes.clear();
  agora.forEach(([bucket, pedidos]) => void assinarLote(bucket, pedidos));
}

/** Uma URL assinada; os pedidos do mesmo instante vão juntos, um por bucket. */
export function assinarFonte(bucket: string, caminho: string): Promise<string | null> {
  return new Promise((resolver) => {
    let doBucket = lotes.get(bucket);
    if (!doBucket) {
      doBucket = new Map();
      lotes.set(bucket, doBucket);
    }
    const esperas = doBucket.get(caminho) || [];
    esperas.push({ resolver });
    doBucket.set(caminho, esperas);
    if (!loteAgendado) {
      loteAgendado = true;
      void Promise.resolve().then(enviarLotes);
    }
  });
}

export function useUrlsDasFontes(projeto: ProjetoDeEdicao, extras: { storage_bucket: string | null; storage_path: string | null }[] = []): Record<string, string> {
  const pares = useMemo(() => {
    const lista: { chave: string; bucket: string; caminho: string }[] = [];
    Object.keys(projeto.fontes).forEach((k) => {
      const f = projeto.fontes[k];
      if (f.storage_path && f.storage_bucket !== BUCKET_PUBLICO) lista.push({ chave: k, bucket: f.storage_bucket || "mesa", caminho: f.storage_path });
    });
    extras.forEach((x) => x.storage_path && lista.push({ chave: `@${x.storage_path}`, bucket: x.storage_bucket || "mesa", caminho: x.storage_path }));
    // A letra da marca (arquivo no bucket mesa) entra no mesmo mapa: a composição carrega pela chave "@caminho".
    const id = projeto.identidade;
    if (id && id.fonte && id.fonte_path && caminhoDaFonteValido(id.fonte_path) && !lista.some((x) => x.chave === chaveDaFonteDaMarca(id.fonte_path as string))) {
      lista.push({ chave: chaveDaFonteDaMarca(id.fonte_path), bucket: "mesa", caminho: id.fonte_path });
    }
    return lista.sort((a, b) => (a.chave < b.chave ? -1 : 1));
  }, [projeto.fontes, projeto.identidade, extras]);
  // Uma consulta por arquivo (duas fontes no mesmo arquivo dividem a mesma).
  const arquivos = useMemo(() => {
    const vistos: Record<string, true> = {};
    const lista: { bucket: string; caminho: string; id: string }[] = [];
    pares.forEach((p) => {
      const id = `${p.bucket}:${p.caminho}`;
      if (vistos[id]) return;
      vistos[id] = true;
      lista.push({ bucket: p.bucket, caminho: p.caminho, id });
    });
    return lista;
  }, [pares]);
  const consultas = useQueries({
    queries: arquivos.map((a) => ({
      queryKey: ["mesa-edicao", "editor", "url", a.bucket, a.caminho],
      staleTime: 45 * 60_000,
      gcTime: 55 * 60_000,
      refetchOnWindowFocus: false,
      queryFn: () => assinarFonte(a.bucket, a.caminho),
    })),
  });
  const porArquivo: Record<string, string> = {};
  arquivos.forEach((a, i) => {
    const url = consultas[i] && consultas[i].data;
    if (url) porArquivo[a.id] = url;
  });
  // Frente EDT: sons e letras da biblioteca moram no próprio painel (bucket "publico"), sem assinatura.
  const publicas = useMemo(() => {
    const saida: Record<string, string> = {};
    Object.keys(projeto.fontes).forEach((k) => {
      const f = projeto.fontes[k];
      if (f.storage_bucket === BUCKET_PUBLICO && f.storage_path && /^editor\/[a-z0-9/_.-]+$/i.test(f.storage_path)) saida[k] = `/${f.storage_path}`;
    });
    return saida;
  }, [projeto.fontes]);
  const saida: Record<string, string> = {};
  pares.forEach((p) => {
    const url = porArquivo[`${p.bucket}:${p.caminho}`];
    if (url) saida[p.chave] = url;
  });
  Object.keys(publicas).forEach((k) => (saida[k] = publicas[k]));
  // Mesmo objeto enquanto nenhuma URL mudar de fato: quem depende dele
  // (Player, linha do tempo, painéis) não redesenha nem recarrega à toa.
  const anterior = useRef<Record<string, string>>(saida);
  if (!mesmasUrls(anterior.current, saida)) anterior.current = saida;
  return anterior.current;
}

function mesmasUrls(a: Record<string, string>, b: Record<string, string>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (let i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
  return true;
}

/** Fonte que mora no próprio painel (public/editor): sons da biblioteca. */
export const BUCKET_PUBLICO = "publico";

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

/** A janela tem pelo menos `px` de largura? Atualiza ao redimensionar. */
export function useLarguraMinima(px: number): boolean {
  const medir = () => (typeof window === "undefined" ? false : (window.innerWidth || 0) >= px);
  const [ok, setOk] = useState(medir);
  useEffect(() => {
    const f = () => setOk(medir());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px]);
  return ok;
}
