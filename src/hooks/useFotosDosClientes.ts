import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { escolherIdentidadePrincipal, type IdentidadeCandidata } from "@/lib/identidadePrincipal";
import { contarPostsDasContas, contasEmpatadas } from "@/lib/postsDasContas";
import { candidatasDaFoto, escolherArquivoDeLogo, type ArquivoDeLogo, type FotoDoCliente } from "@/lib/fotoDoCliente";
import { isDirectFileUrl, storageRefFromFile } from "@/lib/fileUrls";
import { urlsLevesEmLote } from "@/lib/miniaturas";

export interface ClienteComFoto {
  id: string;
  nome?: string | null;
  avatar_url?: string | null;
}

export interface FotosDaCarteira {
  avatar: Map<string, string>;
  instagram: Map<string, string>;
  logos: Map<string, string>;
}

/** A URL assinada da logo vale 2 h: folga larga sobre os 30 min em que a consulta fica fresca. */
const VALIDADE_DA_LOGO_S = 7200;

/**
 * As fotos da carteira inteira, numa leva so (todas em paralelo): a foto de
 * cadastro, a identidade do Instagram (a mesma de /metricas) e as logos dos
 * arquivos de TODOS os clientes, porque o link do Instagram vence e a logo e
 * o que sobra. As logos sao assinadas em lote por bucket, pedindo a
 * miniatura (.mini.jpg) antes do original; nunca a transformacao de imagem
 * do Storage (cota estourada em 26/09/2026).
 */
export async function carregarFotosDaCarteira(): Promise<FotosDaCarteira> {
  const avatar = new Map<string, string>();
  const instagram = new Map<string, string>();
  const logos = new Map<string, string>();
  const db = supabase as any;

  const [perfis, identidades, arquivos] = await Promise.all([
    db.from("profiles").select("id, avatar_url").not("avatar_url", "is", null),
    db.from("social_client_identity")
      .select("client_id, external_account_id, username, profile_picture_url, captured_at")
      .not("profile_picture_url", "is", null),
    db.from("files")
      .select("id, client_id, file_name, file_url, storage_bucket, storage_path, mime_type, created_at")
      .not("client_id", "is", null)
      .is("archived_at", null)
      .ilike("mime_type", "image/%")
      .or("file_name.ilike.%logo%,file_name.ilike.%marca%")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  for (const p of (perfis?.data ?? []) as Array<{ id: string; avatar_url: string | null }>) {
    if (p.avatar_url && p.avatar_url.trim()) avatar.set(p.id, p.avatar_url);
  }

  const porCliente = new Map<string, IdentidadeCandidata[]>();
  for (const i of (identidades?.data ?? []) as IdentidadeCandidata[]) {
    porCliente.set(i.client_id, [...(porCliente.get(i.client_id) ?? []), i]);
  }
  // O nome so decide entre duas contas do mesmo cliente: le so esses.
  const comVarias = [...porCliente.entries()].filter(([, lista]) => lista.length > 1).map(([id]) => id);
  const nomePorId = new Map<string, string | null>();
  if (comVarias.length > 0) {
    const { data: nomes } = await db.from("profiles").select("id, full_name, company_name").in("id", comVarias);
    for (const p of (nomes ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null }>) {
      nomePorId.set(p.id, (p.company_name || "").trim() || p.full_name);
    }
  }
  const contas = new Set<string>();
  for (const [clientId, lista] of porCliente) {
    for (const id of contasEmpatadas(lista, nomePorId.get(clientId))) contas.add(id);
  }
  const posts = await contarPostsDasContas([...contas]);
  for (const [clientId, lista] of porCliente) {
    const principal = escolherIdentidadePrincipal(
      lista.map((c) => ({ ...c, posts: posts.get(String(c.external_account_id)) ?? 0 })),
      nomePorId.get(clientId),
    );
    if (principal?.profile_picture_url) instagram.set(clientId, principal.profile_picture_url);
  }

  const porClienteArq = new Map<string, ArquivoDeLogo[]>();
  for (const a of (arquivos?.data ?? []) as ArquivoDeLogo[]) {
    porClienteArq.set(a.client_id, [...(porClienteArq.get(a.client_id) ?? []), a]);
  }
  const porBucket = new Map<string, Array<{ clientId: string; path: string }>>();
  for (const [clientId, lista] of porClienteArq) {
    const escolhido = escolherArquivoDeLogo(lista);
    if (!escolhido) continue;
    const ref = storageRefFromFile({ fileUrl: escolhido.file_url, storageBucket: escolhido.storage_bucket, storagePath: escolhido.storage_path });
    if (ref) porBucket.set(ref.bucket, [...(porBucket.get(ref.bucket) ?? []), { clientId, path: ref.path }]);
    else if (isDirectFileUrl(escolhido.file_url)) logos.set(clientId, escolhido.file_url);
  }
  await Promise.all([...porBucket.entries()].map(async ([bucket, itens]) => {
    try {
      const urls = await urlsLevesEmLote(bucket, itens.map((i) => i.path), VALIDADE_DA_LOGO_S);
      for (const i of itens) if (urls[i.path]) logos.set(i.clientId, urls[i.path]);
    } catch { /* bucket ilegivel: esses clientes ficam com o que sobrar */ }
  }));

  return { avatar, instagram, logos };
}

/**
 * Fotos de todos os clientes, numa consulta para a carteira toda com chave
 * estavel (sem a lista de ids): toda tela que mostra cliente divide o mesmo
 * cache, inclusive o FotoDoCliente que busca sozinho por `clienteId`.
 *
 * `clientes` e opcional: serve so para a foto de cadastro que a tela ja tem
 * em maos vencer a do banco.
 */
export function useFotosDosClientes(clientes: readonly ClienteComFoto[] = []) {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["fotos-dos-clientes", user?.id],
    enabled: !!user,
    staleTime: 30 * 60_000,
    queryFn: carregarFotosDaCarteira,
  });

  const avatarDaTela = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes) if (c.avatar_url && c.avatar_url.trim()) m.set(c.id, c.avatar_url);
    return m;
  }, [clientes]);

  /** Todas as candidatas do cliente, em ordem (cadastro, logo, Instagram valido). */
  const fotosDe = useCallback((cliente: ClienteComFoto | string): FotoDoCliente[] => {
    const id = typeof cliente === "string" ? cliente : cliente.id;
    const avatarProprio = typeof cliente === "string" ? null : cliente.avatar_url;
    return candidatasDaFoto({
      avatarUrl: (avatarProprio && avatarProprio.trim()) || avatarDaTela.get(id) || data?.avatar.get(id) || null,
      logoUrl: data?.logos.get(id) ?? null,
      instagramUrl: data?.instagram.get(id) ?? null,
    });
  }, [data, avatarDaTela]);

  /** So a primeira (para quem guarda uma foto). */
  const fotoDe = useCallback((cliente: ClienteComFoto | string): FotoDoCliente | null => fotosDe(cliente)[0] ?? null, [fotosDe]);

  return { fotoDe, fotosDe };
}
