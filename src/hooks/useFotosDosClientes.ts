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

export interface LogoAssinada {
  ref: string;
  url: string;
  ate: number;
}

export interface FotosDaCarteira {
  avatar: Map<string, string>;
  instagram: Map<string, string>;
  logos: Map<string, string>;
  assinadas?: Map<string, LogoAssinada>;
}

/**
 * 09/11/2026 (dono: "demora muito para carregar a logo"): cada abertura assinava um link novo, então o navegador nunca
 * aproveitava o que já tinha baixado. A logo agora vale 7 dias, o link é reaproveitado enquanto o arquivo for o mesmo e a
 * última carteira fica guardada neste aparelho: a tela abre com as logos e confere o banco por trás.
 */
const VALIDADE_DA_LOGO_S = 7 * 24 * 3600;
const FOLGA_DO_LINK_MS = 24 * 3600_000;
const chaveGuardada = (userId: string) => `fotos-dos-clientes:v1:${userId}`;

export function lerCarteiraGuardada(userId?: string | null, agora = Date.now()): { fotos: FotosDaCarteira; salvoEm: number } | null {
  if (!userId) return null;
  try {
    const bruto = window.localStorage.getItem(chaveGuardada(userId));
    if (!bruto) return null;
    const g = JSON.parse(bruto) as { salvoEm: number; avatar: [string, string][]; instagram: [string, string][]; logos: [string, LogoAssinada][] };
    const validas = g.logos.filter(([, l]) => l.ate > agora);
    return {
      salvoEm: g.salvoEm,
      fotos: {
        avatar: new Map(g.avatar),
        instagram: new Map(g.instagram),
        logos: new Map(validas.map(([id, l]) => [id, l.url])),
        assinadas: new Map(validas),
      },
    };
  } catch {
    return null;
  }
}

function guardarCarteira(userId: string | null | undefined, fotos: FotosDaCarteira) {
  if (!userId) return;
  try {
    window.localStorage.setItem(chaveGuardada(userId), JSON.stringify({
      salvoEm: Date.now(),
      avatar: [...fotos.avatar],
      instagram: [...fotos.instagram],
      logos: [...(fotos.assinadas ?? new Map())],
    }));
  } catch { /* sem espaço ou modo privado: só perde o atalho */ }
}

/**
 * As fotos da carteira inteira, numa leva so (todas em paralelo): a foto de
 * cadastro, a identidade do Instagram (a mesma de /metricas) e a logo de cada
 * cliente. A logo oficial do Kit de Marca vem primeiro; sem ela, a dos
 * arquivos pelo nome, porque o link do Instagram vence e a logo e o que
 * sobra. As logos sao assinadas em lote por bucket, pedindo a miniatura
 * (.mini.jpg) antes do original; nunca a transformacao de imagem do Storage
 * (cota estourada em 26/09/2026).
 */
export async function carregarFotosDaCarteira(userId?: string | null): Promise<FotosDaCarteira> {
  const avatar = new Map<string, string>();
  const instagram = new Map<string, string>();
  const logos = new Map<string, string>();
  const assinadas = new Map<string, LogoAssinada>();
  const db = supabase as any;
  const anteriores = lerCarteiraGuardada(userId)?.fotos.assinadas;

  const [perfis, identidades, arquivos, kits] = await Promise.all([
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
    db.from("cliente_kit_marca").select("client_id, logo_path, logo_file_id"),
  ]);

  for (const p of (perfis?.data ?? []) as Array<{ id: string; avatar_url: string | null }>) {
    if (p.avatar_url && p.avatar_url.trim()) avatar.set(p.id, p.avatar_url);
  }

  // A logo: primeiro a do Kit de Marca, que alguém escolheu; o nome do arquivo é só o plano B.
  const linhasDoKit = (kits?.data ?? []) as Array<{ client_id: string; logo_path: string | null; logo_file_id: string | null }>;
  const idsDoKit = linhasDoKit.filter((k) => !k.logo_path && k.logo_file_id).map((k) => k.logo_file_id as string);
  const arquivosDoKit = new Map<string, ArquivoDeLogo>();
  if (idsDoKit.length > 0) {
    const { data } = await db.from("files").select("id, client_id, file_name, file_url, storage_bucket, storage_path, mime_type, created_at").in("id", idsDoKit);
    for (const a of (data ?? []) as ArquivoDeLogo[]) arquivosDoKit.set(a.id, a);
  }
  const porClienteArq = new Map<string, ArquivoDeLogo[]>();
  for (const a of (arquivos?.data ?? []) as ArquivoDeLogo[]) {
    porClienteArq.set(a.client_id, [...(porClienteArq.get(a.client_id) ?? []), a]);
  }
  const doKit = new Map(linhasDoKit.map((k) => [k.client_id, k]));
  const porBucket = new Map<string, Array<{ clientId: string; path: string }>>();
  const validoAte = Date.now() + VALIDADE_DA_LOGO_S * 1000;
  const incluir = (clientId: string, bucket: string, path: string) => {
    const ref = `${bucket}/${path}`;
    const antes = anteriores?.get(clientId);
    if (antes && antes.ref === ref && antes.ate - Date.now() > FOLGA_DO_LINK_MS) {
      logos.set(clientId, antes.url);
      assinadas.set(clientId, antes);
      return;
    }
    porBucket.set(bucket, [...(porBucket.get(bucket) ?? []), { clientId, path }]);
  };
  for (const clientId of new Set([...doKit.keys(), ...porClienteArq.keys()])) {
    const kit = doKit.get(clientId);
    if (kit?.logo_path) {
      incluir(clientId, "mesa", kit.logo_path);
      continue;
    }
    const escolhido = (kit?.logo_file_id ? arquivosDoKit.get(kit.logo_file_id) : null) ?? escolherArquivoDeLogo(porClienteArq.get(clientId) ?? []);
    if (!escolhido) continue;
    const ref = storageRefFromFile({ fileUrl: escolhido.file_url, storageBucket: escolhido.storage_bucket, storagePath: escolhido.storage_path });
    if (ref) incluir(clientId, ref.bucket, ref.path);
    else if (isDirectFileUrl(escolhido.file_url)) logos.set(clientId, escolhido.file_url);
  }
  // Em paralelo com a escolha do Instagram: a logo não espera a contagem de posts.
  const assinando = Promise.all([...porBucket.entries()].map(async ([bucket, itens]) => {
    try {
      const urls = await urlsLevesEmLote(bucket, itens.map((i) => i.path), VALIDADE_DA_LOGO_S);
      for (const i of itens) {
        const url = urls[i.path];
        if (!url) continue;
        logos.set(i.clientId, url);
        assinadas.set(i.clientId, { ref: `${bucket}/${i.path}`, url, ate: validoAte });
      }
    } catch { /* bucket ilegivel: esses clientes ficam com o que sobrar */ }
  }));

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
  await assinando;

  const fotos = { avatar, instagram, logos, assinadas };
  guardarCarteira(userId, fotos);
  return fotos;
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
  const guardada = useMemo(() => lerCarteiraGuardada(user?.id), [user?.id]);
  const { data } = useQuery({
    queryKey: ["fotos-dos-clientes", user?.id],
    enabled: !!user,
    staleTime: 30 * 60_000,
    queryFn: () => carregarFotosDaCarteira(user?.id),
    initialData: guardada?.fotos,
    initialDataUpdatedAt: guardada?.salvoEm,
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
