import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { resolverReferencia, type ReferenciaDoCliente } from "@/components/mesa/contextoDoCliente";
import { useMarcaDaMesa } from "@/components/mesa/MesaContexto";
import { marcaParaGravarAgora, referenciaDaMarca } from "@/lib/mesa/marcas";

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
  // Marca por projeto (Acerbi e CME): só as referências da marca aberta; sem marca, todas.
  const { marca } = useMarcaDaMesa();
  return useQuery({
    queryKey: chaveDasReferenciasComDestaque(clientId),
    enabled: ativo && !!clientId,
    ...(marca
      ? { select: (lista: ReferenciaComDestaque[]) => lista.filter((r) => referenciaDaMarca((r as { marca_id?: string | null }).marca_id, marca)) }
      : {}),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<ReferenciaComDestaque[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_referencias")
        // "*": traz marca_id quando o banco já tem marcas (docs/marcas); sem a coluna, o mesmo de antes.
        .select("*")
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

/** Extensão aceita para imagem de referência enviada (jpg, png ou webp) ou null. */
export function extensaoDaReferencia(arquivo: { type?: string; name?: string }): string | null {
  const tipo = String(arquivo.type || "").toLowerCase();
  if (tipo === "image/jpeg" || tipo === "image/jpg") return "jpg";
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  const nome = String(arquivo.name || "").toLowerCase();
  const ponto = nome.lastIndexOf(".");
  const ext = ponto >= 0 ? nome.slice(ponto + 1) : "";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png" || ext === "webp") return ext;
  return null;
}

export const MAX_BYTES_REFERENCIA = 12 * 1024 * 1024;

/** UUID v4 com reserva para navegador antigo (Safari 11 tem getRandomValues, não randomUUID). */
function idNovo(): string {
  const c: any = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  let h = "";
  for (let i = 0; i < 16; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Sobe uma imagem do computador como referência de composição do cliente
 * (pedido do dono em 25/09: "colar link ou subir imagem"). A imagem vai para
 * o bucket mesa em <cliente>/referencias/ e a linha nasce com origem upload.
 * A leitura por IA fica para o "Ler as pendentes" do Contexto.
 */
export async function subirReferencia(clientId: string, arquivo: File): Promise<string> {
  const ext = extensaoDaReferencia(arquivo);
  if (!ext) throw new Error("Envie uma imagem JPG, PNG ou WEBP.");
  if (arquivo.size > MAX_BYTES_REFERENCIA) throw new Error("Imagem acima de 12 MB.");
  const caminho = `${clientId}/referencias/upload-${idNovo()}.${ext}`;
  const tipo = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const { error: erroUpload } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: tipo, upsert: false });
  if (erroUpload) throw erroUpload;
  const { data, error } = await (supabase as any)
    .from("cliente_referencias")
    // Com outra marca aberta no topo (ex.: CME), a referência nasce dela.
    .insert({ client_id: clientId, origem: "upload", storage_path: caminho, papel: "tecnica", ativa: true, ...marcaParaGravarAgora(clientId) })
    .select("id")
    .single();
  if (error) {
    await supabase.storage.from("mesa").remove([caminho]).catch(() => undefined);
    throw error;
  }
  return String(data.id);
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
    .insert({ client_id: clientId, origem: "workspace", workspace_node_id: nodeId, papel, ativa: true, ...marcaParaGravarAgora(clientId) })
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

/**
 * Uma página do banco da agência, com busca no título, na leitura e nas tags.
 * Cada palavra da busca precisa aparecer (em qualquer um dos três), então
 * "tipografia grande" acha peças que têm as duas palavras, não só a frase
 * exata. A ordem tem desempate pelo id: as 1.386 do Pinterest entraram em
 * lotes com o mesmo criado_em, e sem o desempate a mesma imagem aparecia em
 * duas páginas e outras nunca apareciam (25/09).
 */
export function useBancoDaAgencia(opcoes: { busca: string; tag: string | null; pagina: number; porPagina: number; ativo: boolean }) {
  const { busca, tag, pagina, porPagina, ativo } = opcoes;
  return useQuery({
    queryKey: ["mesa", "refs-globais", "pagina-v5", busca, tag || "", pagina, porPagina],
    enabled: ativo,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ lista: ReferenciaGlobal[]; total: number }> => {
      let q = (supabase as any).from("referencias_globais").select(CAMPOS_GLOBAL, { count: "exact" }).eq("ativa", true);
      for (const palavra of palavrasDaBusca(busca)) {
        const termo = `*${palavra}*`;
        q = q.or([`titulo.ilike.${termo}`, `leitura.ilike.${termo}`, `tags.cs.{${palavra}}`].join(","));
      }
      if (tag) q = q.contains("tags", [tag]);
      const { data, error, count } = await q
        .order("criado_em", { ascending: false })
        .order("id", { ascending: true })
        .range(pagina * porPagina, pagina * porPagina + porPagina - 1);
      if (error) throw error;
      return { lista: (data || []) as ReferenciaGlobal[], total: Number(count || 0) };
    },
  });
}

/** Palavras da busca do banco (já limpa), sem repetição, no máximo 6. */
export function palavrasDaBusca(busca: string): string[] {
  const saida: string[] = [];
  for (const p of String(busca || "").split(" ")) {
    const t = p.trim();
    if (t && saida.indexOf(t) < 0) saida.push(t);
  }
  return saida.slice(0, 6);
}

/** As tags mais usadas no banco da agência (mesma chave e formato do Estúdio). */
export function useTagsDoBanco(ativo: boolean) {
  return useQuery({
    queryKey: ["mesa", "refs-globais", "tags"],
    enabled: ativo,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      // Em páginas de 1.000 (o limite de linhas do PostgREST cortava a conta nas primeiras 1.000).
      const linhas: { tags: string[] | null }[] = [];
      for (let pagina = 0; pagina < 3; pagina++) {
        const { data, error } = await (supabase as any)
          .from("referencias_globais")
          .select("tags")
          .eq("ativa", true)
          .order("id", { ascending: true })
          .range(pagina * 1000, pagina * 1000 + 999);
        if (error) throw error;
        const lote = (data || []) as { tags: string[] | null }[];
        for (const l of lote) linhas.push(l);
        if (lote.length < 1000) break;
      }
      const conta: Record<string, number> = {};
      for (const r of linhas) {
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
