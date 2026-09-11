import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { escolherIdentidadePrincipal, type IdentidadeCandidata } from "@/lib/identidadePrincipal";
import { escolherArquivoDeLogo, fotoDoCliente, type ArquivoDeLogo, type FotoDoCliente } from "@/lib/fotoDoCliente";
import { resolveFileUrl } from "@/lib/fileUrls";

export interface ClienteComFoto {
  id: string;
  nome?: string | null;
  avatar_url?: string | null;
}

/**
 * Uma foto por cliente para a carteira inteira, em duas consultas: a
 * identidade do Instagram (a mesma de /metricas) e as logos dos arquivos.
 * So procura logo para quem nao tem foto de cadastro nem de Instagram.
 */
export function useFotosDosClientes(clientes: readonly ClienteComFoto[]) {
  const { user } = useAuth();
  const ids = useMemo(() => clientes.map((c) => c.id).sort().join(","), [clientes]);
  const semFotoPropria = useMemo(() => clientes.filter((c) => !(c.avatar_url && c.avatar_url.trim())), [clientes]);

  const { data } = useQuery({
    queryKey: ["fotos-dos-clientes", user?.id, ids],
    enabled: !!user && semFotoPropria.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const alvo = semFotoPropria.map((c) => c.id);
      const nomePorId = new Map(semFotoPropria.map((c) => [c.id, c.nome ?? null]));
      const instagram = new Map<string, string>();
      const logos = new Map<string, string>();

      const { data: identidades } = await (supabase as any)
        .from("social_client_identity")
        .select("client_id, external_account_id, username, profile_picture_url, captured_at")
        .in("client_id", alvo)
        .not("profile_picture_url", "is", null);
      const porCliente = new Map<string, IdentidadeCandidata[]>();
      for (const i of (identidades ?? []) as IdentidadeCandidata[]) {
        porCliente.set(i.client_id, [...(porCliente.get(i.client_id) ?? []), i]);
      }
      for (const [clientId, lista] of porCliente) {
        const principal = escolherIdentidadePrincipal(lista, nomePorId.get(clientId));
        if (principal?.profile_picture_url) instagram.set(clientId, principal.profile_picture_url);
      }

      const semInstagram = alvo.filter((id) => !instagram.has(id));
      if (semInstagram.length > 0) {
        const { data: arquivos } = await (supabase as any)
          .from("files")
          .select("id, client_id, file_name, file_url, storage_bucket, storage_path, mime_type, created_at")
          .in("client_id", semInstagram)
          .is("archived_at", null)
          .ilike("mime_type", "image/%")
          .or("file_name.ilike.%logo%,file_name.ilike.%marca%")
          .limit(400);
        const porClienteArq = new Map<string, ArquivoDeLogo[]>();
        for (const a of (arquivos ?? []) as ArquivoDeLogo[]) {
          porClienteArq.set(a.client_id, [...(porClienteArq.get(a.client_id) ?? []), a]);
        }
        await Promise.all([...porClienteArq.entries()].map(async ([clientId, lista]) => {
          const escolhido = escolherArquivoDeLogo(lista);
          if (!escolhido) return;
          try {
            const url = await resolveFileUrl({ fileUrl: escolhido.file_url, storageBucket: escolhido.storage_bucket, storagePath: escolhido.storage_path, expiresIn: 3600 });
            if (url && url !== "#") logos.set(clientId, url);
          } catch { /* sem logo legivel: fica nas iniciais */ }
        }));
      }
      return { instagram, logos };
    },
  });

  const fotoDe = useCallback((cliente: ClienteComFoto): FotoDoCliente | null => {
    return fotoDoCliente({
      avatarUrl: cliente.avatar_url,
      instagramUrl: data?.instagram.get(cliente.id) ?? null,
      logoUrl: data?.logos.get(cliente.id) ?? null,
    });
  }, [data]);

  return { fotoDe };
}
