import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { chamarFuncao } from "@/lib/mesa/api";
import { type CenaDaLinha, chaveDoPedido, ETAPAS_DO_MOTION, type EtapaDoMotion, type LinhaDoFilme, normalizarFilme, renderDaCena } from "../../../supabase/functions/_shared/motion-metodo";
import type { FormatoDoMotion, NumeroReal } from "../../../supabase/functions/_shared/cena-hf";
import type { TipoDeFilme } from "../../../supabase/functions/_shared/motion-metodo";
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
    // Cada etapa monta a barra do filme de novo: a lista não é relida a cada troca de etapa (criar e arquivar invalidam).
    staleTime: 30_000,
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
  entrada: { chave?: string; modo?: string; formato?: string; cena_id?: string | null; caminho?: string | null };
  resultado: Record<string, any> | null;
  saida_path: string | null;
  erro_mensagem: string | null;
  criado_em: string;
  /** Render final do filme: a versão da Mesa Edição que o Motion montou. */
  versao_id?: string | null;
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
    // Trocar de etapa não relê a fila antes dos 15 s (pedir e cancelar releem na hora).
    staleTime: CONSULTA_MINIMA_MS,
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

/** Um pedido que o lote resolve: a cena em código, o número dela no filme e os formatos da final que faltam. */
export interface FinalQueFalta {
  cena: CenaDaLinha;
  numero: number;
  formatos: FormatoDoMotion[];
}

/**
 * Finais que faltam por cena em código: formato sem render, ou com render
 * desatualizado (a cena mudou), e sem pedido na fila. `soDesatualizadas`:
 * só as que já tinham render e ficaram velhas (o que o casar do Som muda).
 */
export function finaisQueFaltam(filme: Filme, fila: FilaDoFilme | undefined, soDesatualizadas = false): FinalQueFalta[] {
  const saida: FinalQueFalta[] = [];
  filme.cenas.forEach((c, i) => {
    if (c.tipo_plano !== "hf") return;
    const formatos = filme.formatos.filter((f) => {
      if (pedidoAtivoDaChave(fila, chaveDoPedido(c.id, "final", f))) return false;
      const r = renderDaCena(filme, c, "final", f);
      if (soDesatualizadas) return !!r && !!r.saida_path && !r.em_dia;
      return !r || !r.saida_path || !r.em_dia;
    });
    if (formatos.length) saida.push({ cena: c, numero: i + 1, formatos });
  });
  return saida;
}

/** "3 cenas × 2 formatos" (ou "5 renders em 3 cenas" quando os formatos variam por cena). */
export function resumoDasFinais(faltas: FinalQueFalta[]): string {
  const n = faltas.length;
  const total = faltas.reduce((s, x) => s + x.formatos.length, 0);
  const uniao: string[] = [];
  faltas.forEach((x) => x.formatos.forEach((f) => uniao.indexOf(f) < 0 && uniao.push(f)));
  const cenas = `${n} ${n === 1 ? "cena" : "cenas"}`;
  if (total === n * uniao.length) return `${cenas} × ${uniao.length} ${uniao.length === 1 ? "formato" : "formatos"}`;
  return `${total} renders em ${cenas}`;
}

// ------------------------------------------------------------------ textos e listas da tela (puros)

/** Nome já preenchido do filme novo, sem repetir o de outro filme da lista. */
export function nomePadraoDoFilme(tipo: TipoDeFilme, cliente: string, marca: string | null, nomes: string[]): string {
  const quem = tipo === "filme_marca" ? (marca || cliente).trim() : cliente.trim();
  const base = (quem ? (tipo === "filme_marca" ? `Filme da marca ${quem}` : `Apresentação ${quem}`) : tipo === "filme_marca" ? "Filme da marca" : "Apresentação em motion").slice(0, 112);
  if (nomes.indexOf(base) < 0) return base;
  for (let n = 2; n < 500; n++) if (nomes.indexOf(`${base} ${n}`) < 0) return `${base} ${n}`;
  return base;
}

/** O que a troca de storyboard tirou (o servidor devolve em storyboard_escolher.anterior). */
export type ResumoDaTroca = { cenas: number; stills_aprovados: number; sob_medida: number; pode_desfazer?: boolean };

/** "8 cenas, 5 stills aprovados, 2 sob medida" (só o que existia). */
export function textoDaTroca(r: ResumoDaTroca): string {
  const partes = [`${r.cenas} ${r.cenas === 1 ? "cena" : "cenas"}`];
  if (r.stills_aprovados) partes.push(`${r.stills_aprovados} ${r.stills_aprovados === 1 ? "still aprovado" : "stills aprovados"}`);
  if (r.sob_medida) partes.push(`${r.sob_medida} sob medida`);
  return partes.join(", ");
}

/** O que falta para montar, por cena, tirado do filme: o motivo e os formatos. */
export function faltantesDoFilme(filme: Filme): Array<{ numero: number; motivo: string; formatos: string[] }> {
  const saida: Array<{ numero: number; motivo: string; formatos: string[] }> = [];
  filme.cenas.forEach((c, i) => {
    if (c.tipo_plano !== "hf") {
      if (!c.arquivo) saida.push({ numero: i + 1, motivo: "plano sem vídeo", formatos: [] });
      return;
    }
    const sem: string[] = [];
    const velhas: string[] = [];
    filme.formatos.forEach((f) => {
      const r = renderDaCena(filme, c, "final", f);
      if (!r || !r.saida_path) sem.push(f);
      else if (!r.em_dia) velhas.push(f);
    });
    if (sem.length) saida.push({ numero: i + 1, motivo: "sem a cena final", formatos: sem });
    if (velhas.length) saida.push({ numero: i + 1, motivo: "a cena mudou depois do render", formatos: velhas });
  });
  return saida;
}

/** Valor do parâmetro no campo de texto (número com vírgula decimal: 4,8 volta 4,8). */
export function paraTexto(v: unknown, tipo: string): string {
  if (tipo === "lista" || tipo === "imagens") return Array.isArray(v) ? (v as unknown[]).map(String).join("\n") : "";
  if (tipo === "numeros") return Array.isArray(v) ? (v as NumeroReal[]).map((n) => `${String(n.valor).replace(".", ",")};${n.rotulo};${n.fonte}`).join("\n") : "";
  return typeof v === "string" ? v : "";
}

export function deTexto(t: string, tipo: string): unknown {
  if (tipo === "lista" || tipo === "imagens") return t.split("\n").map((x) => x.trim()).filter(Boolean);
  if (tipo === "numeros")
    return t
      .split("\n")
      .map((l) => l.split(";").map((x) => x.trim()))
      .filter((l) => l[0])
      .map((l) => ({ valor: Number(String(l[0]).replace(/\./g, "").replace(",", ".")), rotulo: l[1] || "", fonte: l[2] || "" }));
  return t;
}
