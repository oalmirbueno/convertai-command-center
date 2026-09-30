import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { chamarFuncao } from "@/lib/mesa/api";
import { ETAPAS_DO_MOTION, type EtapaDoMotion, type LinhaDoFilme, normalizarFilme } from "../../../supabase/functions/_shared/motion-metodo";
import { CONSULTA_MINIMA_MS } from "../../../supabase/functions/_shared/render-do-editor";

/**
 * Ponte da Mesa Motion com a função mesa-motion (frente MOT). Nenhuma chave
 * passa por aqui: a tela manda ordens, lê o filme (com links de 1 h para os
 * stills, amostras e cenas prontas) e a fila. A fila é lida no máximo a cada
 * 15 s e só enquanto há pedido ativo (sem laço).
 */

export type Filme = LinhaDoFilme;

export const ETAPAS_DA_MESA_MOTION = ETAPAS_DO_MOTION.map((e) => ({ valor: e.valor as string, rotulo: e.rotulo, dica: e.dica }));
export const etapaValidaDoMotion = (v: string | null): string => (v && ETAPAS_DO_MOTION.some((e) => e.valor === v) ? v : "insumos");
export type { EtapaDoMotion };

export const CHAVES = {
  filmes: (clientId: string, marcaId: string | null) => ["mesa-motion", "filmes", clientId, marcaId || "todas"],
  filme: (filmeId: string) => ["mesa-motion", "filme", filmeId],
  fila: (filmeId: string) => ["mesa-motion", "fila", filmeId],
  insumos: (filmeId: string) => ["mesa-motion", "insumos", filmeId],
};

export const chamarMotion = <T = any>(acao: string, corpo: Record<string, unknown>) => chamarFuncao<T>("mesa-motion", { acao, ...corpo });

export const uidDoClique = (prefixo = "mot") => `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function useFilmes(clientId: string, marcaId: string | null) {
  return useQuery({
    queryKey: CHAVES.filmes(clientId, marcaId),
    enabled: !!clientId,
    queryFn: async () => {
      const d = await chamarMotion<{ filmes: unknown[]; indisponivel?: boolean; aviso?: string }>("filmes_listar", { client_id: clientId, marca_id: marcaId || undefined });
      return { lista: (d.filmes || []).map(normalizarFilme).filter((f): f is Filme => !!f), indisponivel: !!d.indisponivel, aviso: d.aviso || null };
    },
  });
}

/** O filme aberto (?filme=) com os links assinados dos arquivos prontos. */
export function useFilme(filmeId: string | null) {
  return useQuery({
    queryKey: CHAVES.filme(filmeId || "nenhum"),
    enabled: !!filmeId,
    queryFn: async () => {
      const d = await chamarMotion<{ filme: unknown; links: Record<string, string> }>("filme_ler", { filme_id: filmeId });
      return { filme: normalizarFilme(d.filme) as Filme, links: d.links || {} };
    },
    staleTime: 30_000,
  });
}

/** Troca o filme no cache (salvar devolve a linha nova). */
export function useGuardarFilme() {
  const qc = useQueryClient();
  return (filme: unknown, links?: Record<string, string>) => {
    const f = normalizarFilme(filme);
    if (!f) return;
    qc.setQueryData(CHAVES.filme(f.id), (d: any) => ({ filme: f, links: { ...((d && d.links) || {}), ...(links || {}) } }));
    qc.setQueriesData({ queryKey: ["mesa-motion", "filmes", f.client_id] }, (d: any) => (d && Array.isArray(d.lista) ? { ...d, lista: d.lista.map((x: Filme) => (x.id === f.id ? f : x)) } : d));
  };
}

export function useFilmeDaUrl(): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const v = params.get("filme");
  const id = v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  return [
    id,
    (novo) => {
      const p = new URLSearchParams(params);
      if (novo) p.set("filme", novo);
      else p.delete("filme");
      setParams(p, { replace: true });
    },
  ];
}

export interface PedidoDoMotion {
  id: string;
  tipo: string;
  estado: "fila" | "rodando" | "pronto" | "erro" | "cancelado";
  etapa: string | null;
  progresso: number;
  entrada: { chave?: string; modo?: string; formato?: string; cena_id?: string | null };
  resultado: Record<string, any> | null;
  saida_path: string | null;
  erro_mensagem: string | null;
  criado_em: string;
}

export interface FilaDoFilme {
  pedidos: PedidoDoMotion[];
  finais: PedidoDoMotion[];
  links: Record<string, string>;
  worker: { visto_em: string | null; situacao: "ligado" | "desligado" | "nunca" };
}

const ativo = (p: PedidoDoMotion) => p.estado === "fila" || p.estado === "rodando";

/**
 * Fila do filme: uma leitura ao abrir; enquanto houver pedido ativo, outra a
 * cada 15 s (nunca menos); quando um termina, o filme é relido (o still ou a
 * cena aparece sozinho).
 */
export function useFilaDoFilme(filmeId: string | null) {
  const qc = useQueryClient();
  const antes = useRef<Set<string>>(new Set());
  const q = useQuery({
    queryKey: CHAVES.fila(filmeId || "nenhum"),
    enabled: !!filmeId,
    queryFn: () => chamarMotion<FilaDoFilme>("render_status", { filme_id: filmeId }),
    refetchInterval: (query) => {
      const d = query.state.data as FilaDoFilme | undefined;
      return d && (d.pedidos.some(ativo) || d.finais.some(ativo)) ? CONSULTA_MINIMA_MS : false;
    },
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const d = q.data;
    if (!d || !filmeId) return;
    const ativos = new Set(d.pedidos.concat(d.finais).filter(ativo).map((p) => p.id));
    let terminou = false;
    antes.current.forEach((id) => {
      if (!ativos.has(id)) terminou = true;
    });
    antes.current = ativos;
    if (terminou) void qc.invalidateQueries({ queryKey: CHAVES.filme(filmeId) });
  }, [q.data, filmeId, qc]);
  return q;
}

export function pedidoAtivoDaChave(fila: FilaDoFilme | undefined, chave: string): PedidoDoMotion | null {
  if (!fila) return null;
  return fila.pedidos.find((p) => ativo(p) && p.entrada && p.entrada.chave === chave) || null;
}

export function erroDaChave(fila: FilaDoFilme | undefined, chave: string): PedidoDoMotion | null {
  if (!fila) return null;
  const ultimo = fila.pedidos.find((p) => p.entrada && p.entrada.chave === chave);
  return ultimo && ultimo.estado === "erro" ? ultimo : null;
}
