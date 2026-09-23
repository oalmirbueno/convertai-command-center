import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { resolverReferencia, type ReferenciaDoCliente } from "@/components/mesa/contextoDoCliente";

/**
 * Referências da Mesa, versão 5 (CONTRATOS-V5.md): papel com nome claro,
 * destaque (cliente_referencias.destaque, gravado direto pela RLS da
 * equipe), banco da agência e Pinterest. Consultas só com JSON puro.
 */

// ------------------------------------------------------------------ papéis

export type PapelDaReferencia = "identidade" | "tecnica";

/** Como a tela chama cada papel (o dono não entendia "identidade" e "técnica"). */
export const PAPEIS: Record<PapelDaReferencia, { rotulo: string; curto: string; dica: string }> = {
  identidade: {
    rotulo: "Artes da marca",
    curto: "Arte da marca",
    dica: "Artes já aprovadas do próprio cliente. Mostram o estilo que a marca já usa, e o diretor de arte mantém esse estilo.",
  },
  tecnica: {
    rotulo: "Referências de composição",
    curto: "Composição",
    dica: "Peças de fora (Workspace, Pinterest, link). O diretor de arte copia a composição e a técnica, com as cores e a identidade da marca.",
  },
};

export const rotuloDoPapel = (papel: string | null | undefined): string => PAPEIS[papel === "identidade" ? "identidade" : "tecnica"].curto;

// ------------------------------------------------------------------ imagem

/**
 * De onde a imagem vem: arquivo no Storage (bucket e caminho) e, quando há,
 * uma URL pública da própria imagem para cair nela se a assinatura falhar.
 */
export interface FonteDaImagem {
  bucket: string;
  caminho: string | null;
  externa?: string | null;
}

/** URL externa que é a própria imagem (pinimg ou arquivo de imagem), só https. */
export function urlDeImagemExterna(url: string | null | undefined): string | null {
  const u = String(url || "").trim();
  if (u.indexOf("https://") !== 0) return null;
  const semBusca = u.split("?")[0].split("#")[0].toLowerCase();
  const host = semBusca.slice(8).split("/")[0];
  if (host === "i.pinimg.com" || /\.pinimg\.com$/.test(host)) return u;
  if (/\.(png|jpe?g|webp|gif)$/.test(semBusca)) return u;
  return null;
}

/**
 * O banco da agência mora no bucket mesa em "globais/...". A política do
 * bucket só libera caminho que começa pelo id de um cliente, então a URL
 * assinada dessas imagens falha para a equipe (era o "sem imagem" das
 * Campanhas). Todas as 1.386 têm a imagem original do Pinterest em
 * url_origem: a tela usa essa primeiro e o Storage fica de reserva.
 */
export function precisaDaExterna(fonte: FonteDaImagem | null | undefined): boolean {
  if (!fonte || !fonte.externa) return false;
  return !fonte.caminho || (fonte.bucket === "mesa" && fonte.caminho.indexOf("globais/") === 0);
}

/** Item para o Ampliar (caminho no Storage ou URL pronta). */
export function ampliavelDaFonte(fonte: FonteDaImagem | null | undefined): { caminho: string; bucket?: string } | null {
  if (!fonte) return null;
  if (precisaDaExterna(fonte)) return { caminho: fonte.externa as string };
  if (fonte.caminho) return { caminho: fonte.caminho, bucket: fonte.bucket };
  if (fonte.externa) return { caminho: fonte.externa };
  return null;
}

// ------------------------------------------------------------------ do cliente

export interface ReferenciaComDestaque extends ReferenciaDoCliente {
  destaque: boolean;
}

/** Mesma família de ["mesa", "referencias", clientId]: invalidar a família relê esta também. */
export const chaveDasReferenciasComDestaque = (clientId: string) => ["mesa", "referencias", clientId, "v5"];

export function fonteDaReferencia(r: Pick<ReferenciaDoCliente, "imagem" | "url_origem">): FonteDaImagem | null {
  if (r.imagem) return { bucket: r.imagem.bucket, caminho: r.imagem.caminho, externa: urlDeImagemExterna(r.url_origem) };
  const externa = urlDeImagemExterna(r.url_origem);
  return externa ? { bucket: "mesa", caminho: null, externa } : null;
}

/** Destaque primeiro; dentro de cada grupo, a ordem que veio. */
export function ordenarPorDestaque<T extends { destaque: boolean }>(lista: T[]): T[] {
  return lista
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.destaque === b.item.destaque ? a.i - b.i : a.item.destaque ? -1 : 1))
    .map((x) => x.item);
}

type LinhaComDestaque = Omit<ReferenciaDoCliente, "nome" | "imagem"> & { destaque?: boolean | null };
type NoDaReferencia = { id: string; name: string; storage_path: string | null };
type ArquivoDaReferencia = { id: string; file_name: string; file_url: string | null; storage_bucket: string | null; storage_path: string | null };

async function emLotes<T>(ids: string[], ler: (lote: string[]) => Promise<T[]>): Promise<T[]> {
  const saida: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const parte = await ler(ids.slice(i, i + 150));
    for (const x of parte) saida.push(x);
  }
  return saida;
}

/** Todas as referências do cliente com a imagem resolvida e o destaque, destaque primeiro. */
export function useReferenciasComDestaque(clientId: string, ativo = true) {
  return useQuery({
    queryKey: chaveDasReferenciasComDestaque(clientId),
    enabled: ativo && !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<ReferenciaComDestaque[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_referencias")
        .select("id, origem, papel, url_origem, storage_path, workspace_node_id, file_id, leitura, tags, ativa, criado_em, destaque")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const linhas = (data || []) as LinhaComDestaque[];
      const idsDeNos: string[] = [];
      const idsDeArquivos: string[] = [];
      for (const r of linhas) {
        if (r.storage_path) continue;
        if (r.workspace_node_id && idsDeNos.indexOf(r.workspace_node_id) < 0) idsDeNos.push(r.workspace_node_id);
        if (r.file_id && idsDeArquivos.indexOf(r.file_id) < 0) idsDeArquivos.push(r.file_id);
      }
      const [nos, arquivos] = await Promise.all([
        emLotes<NoDaReferencia>(idsDeNos, async (lote) => {
          const { data: d, error: e } = await (supabase as any).from("workspace_nodes").select("id, name, storage_path").in("id", lote);
          if (e) throw e;
          return (d || []) as NoDaReferencia[];
        }),
        emLotes<ArquivoDaReferencia>(idsDeArquivos, async (lote) => {
          const { data: d, error: e } = await (supabase as any)
            .from("files")
            .select("id, file_name, file_url, storage_bucket, storage_path")
            .in("id", lote);
          if (e) throw e;
          return (d || []) as ArquivoDaReferencia[];
        }),
      ]);
      const noPorId: Record<string, NoDaReferencia> = {};
      for (const n of nos) noPorId[n.id] = n;
      const arquivoPorId: Record<string, ArquivoDaReferencia> = {};
      for (const a of arquivos) arquivoPorId[a.id] = a;
      return ordenarPorDestaque(
        linhas.map((r) => {
          const { destaque, ...resto } = r;
          return { ...resolverReferencia(resto, noPorId, arquivoPorId), destaque: destaque === true };
        }),
      );
    },
  });
}

/** Marca ou desmarca o destaque (update direto; a RLS da equipe permite). */
export async function gravarDestaque(id: string, destaque: boolean): Promise<void> {
  const { error } = await (supabase as any).from("cliente_referencias").update({ destaque }).eq("id", id);
  if (error) throw error;
}

/** Link de pin aceito pela função (pinterest.* ou pin.it, https). */
export function ehLinkDePin(texto: string): boolean {
  const u = String(texto || "").trim();
  const m = /^https:\/\/([^/?#]+)/i.exec(u);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return host === "pin.it" || /(^|\.)pinterest\.[a-z.]{2,8}$/.test(host);
}

/**
 * Cola um pin como referência de composição. A função estudio-arte baixa a
 * imagem para o bucket mesa e cria a linha (origem pinterest); a leitura por
 * IA fica para o "Ler as pendentes" do Contexto. Se a linha já existia com
 * outro papel ou desligada, volta como composição e em uso.
 */
export async function adicionarPin(clientId: string, url: string): Promise<{ id: string; jaExistia: boolean }> {
  const d = await chamarFuncao<{ referencia?: { id?: string; papel?: string; ativa?: boolean }; ja_existia?: boolean }>("estudio-arte", {
    acao: "referencias",
    subacao: "importar_pinterest",
    client_id: clientId,
    url: url.trim(),
  });
  const ref = d && d.referencia;
  if (!ref || !ref.id) throw new Error("O pin não voltou como referência. Tente de novo.");
  if (ref.papel !== "tecnica" || ref.ativa === false) {
    const { error } = await (supabase as any).from("cliente_referencias").update({ papel: "tecnica", ativa: true }).eq("id", ref.id);
    if (error) throw error;
  }
  return { id: ref.id, jaExistia: !!(d && d.ja_existia) };
}

/**
 * Liga uma imagem do Workspace como referência do cliente (a imagem continua
 * morando no Workspace, como no sincronizar). Já ligada: só volta a ficar em uso.
 */
export async function ligarImagemDoWorkspace(clientId: string, nodeId: string, papel: PapelDaReferencia = "tecnica"): Promise<string> {
  const { data: ja, error: erroLeitura } = await (supabase as any)
    .from("cliente_referencias")
    .select("id, ativa")
    .eq("client_id", clientId)
    .eq("workspace_node_id", nodeId)
    .maybeSingle();
  if (erroLeitura) throw erroLeitura;
  if (ja && ja.id) {
    if (ja.ativa === false) {
      const { error } = await (supabase as any).from("cliente_referencias").update({ ativa: true }).eq("id", ja.id);
      if (error) throw error;
    }
    return String(ja.id);
  }
  const { data, error } = await (supabase as any)
    .from("cliente_referencias")
    .insert({ client_id: clientId, origem: "workspace", workspace_node_id: nodeId, papel, ativa: true })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

// ------------------------------------------------------------------ banco da agência

export const PREFIXO_GLOBAL = "g:";

export interface ReferenciaGlobal {
  id: string;
  titulo: string | null;
  leitura: string | null;
  tags: string[] | null;
  storage_path: string | null;
  url_origem: string | null;
}

export function fonteDaGlobal(g: Pick<ReferenciaGlobal, "storage_path" | "url_origem">): FonteDaImagem {
  return { bucket: "mesa", caminho: g.storage_path, externa: urlDeImagemExterna(g.url_origem) };
}

/** Tira da busca o que quebra o filtro do PostgREST (vírgula, parênteses, curingas). */
export function limparBusca(t: string): string {
  let saida = "";
  const proibidos = ",()*%{}\"\\:";
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    saida += proibidos.indexOf(c) >= 0 ? " " : c;
  }
  return saida.split(" ").filter(Boolean).join(" ").trim();
}

export function useAtraso<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const id = window.setTimeout(() => setV(valor), ms);
    return () => window.clearTimeout(id);
  }, [valor, ms]);
  return v;
}

const CAMPOS_GLOBAL = "id, titulo, leitura, tags, storage_path, url_origem";

/** Uma página do banco da agência, com busca no título, na leitura e nas tags. */
export function useBancoDaAgencia(opcoes: { busca: string; tag: string | null; pagina: number; porPagina: number; ativo: boolean }) {
  const { busca, tag, pagina, porPagina, ativo } = opcoes;
  return useQuery({
    queryKey: ["mesa", "refs-globais", "pagina-v5", busca, tag || "", pagina, porPagina],
    enabled: ativo,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ lista: ReferenciaGlobal[]; total: number }> => {
      let q = (supabase as any).from("referencias_globais").select(CAMPOS_GLOBAL, { count: "exact" }).eq("ativa", true);
      if (busca) {
        const termo = `*${busca}*`;
        const partes = [`titulo.ilike.${termo}`, `leitura.ilike.${termo}`];
        if (busca.indexOf(" ") < 0) partes.push(`tags.cs.{${busca}}`);
        q = q.or(partes.join(","));
      }
      if (tag) q = q.contains("tags", [tag]);
      const { data, error, count } = await q.order("criado_em", { ascending: false }).range(pagina * porPagina, pagina * porPagina + porPagina - 1);
      if (error) throw error;
      return { lista: (data || []) as ReferenciaGlobal[], total: Number(count || 0) };
    },
  });
}

/** As tags mais usadas no banco da agência (mesma chave e formato do Estúdio). */
export function useTagsDoBanco(ativo: boolean) {
  return useQuery({
    queryKey: ["mesa", "refs-globais", "tags"],
    enabled: ativo,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as any).from("referencias_globais").select("tags").eq("ativa", true).limit(2000);
      if (error) throw error;
      const conta: Record<string, number> = {};
      for (const r of (data || []) as { tags: string[] | null }[]) {
        for (const t of r.tags || []) {
          const k = String(t || "").trim();
          if (k) conta[k] = (conta[k] || 0) + 1;
        }
      }
      return Object.keys(conta).sort((a, b) => conta[b] - conta[a]).slice(0, 18);
    },
  });
}

/** As do banco da agência entre as escolhidas (ids com "g:"). */
export function useGlobaisPorIds(ids: string[]) {
  const globais = ids.filter((id) => id.indexOf(PREFIXO_GLOBAL) === 0).map((id) => id.slice(PREFIXO_GLOBAL.length));
  return useQuery({
    queryKey: ["mesa", "refs-globais", "escolhidas-v5", globais.slice().sort().join(",")],
    enabled: globais.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ReferenciaGlobal[]> => {
      const { data, error } = await (supabase as any).from("referencias_globais").select(CAMPOS_GLOBAL).in("id", globais);
      if (error) throw error;
      return (data || []) as ReferenciaGlobal[];
    },
  });
}
