import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Arquivos ao vivo (frente AP, 28/09). Pedido do dono: "quando eu envio para
 * aprovação, já tem que aparecer instantaneamente para o cliente na tela de
 * aprovação, e em Arquivos também".
 *
 * Antes, a tela do cliente só relia `files` a cada 20 s (média de 10 s, até
 * 20 s depois do envio). Agora ela escuta o canal do banco (Realtime) só das
 * linhas do cliente (ou do projeto) aberto, INSERT e UPDATE, e relê em
 * 300 ms. Quem decide o que chega é a RLS de quem escuta (can_read_file) e
 * os privilégios de coluna: o cliente só recebe o que já pode ler. DELETE não
 * é escutado (o Realtime não filtra DELETE por RLS; arquivar é UPDATE).
 *
 * Um canal por filtro, dividido entre as telas abertas (a aprovação e os
 * documentos usam o mesmo). O intervalo de 20 s do useFiles fica como rede.
 * Precisa de public.files na publicação supabase_realtime (SQL AP-01); sem
 * isso o canal só não recebe nada e a tela segue com o intervalo.
 */

export const ESPERA_AO_VIVO_MS = 300;

/** Chaves que mostram arquivos ao cliente (aprovações, documentos, dashboard). */
export const CHAVES_DOS_ARQUIVOS = [["files"], ["client-pending-approvals"], ["client-delivered-files"]] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtro do canal: pelo cliente quando há; senão pelo projeto; sem nenhum, não escuta. */
export function filtroDosArquivos(clientId?: string | null, projectId?: string | null): string | null {
  if (clientId && UUID.test(clientId)) return `client_id=eq.${clientId}`;
  if (projectId && UUID.test(projectId)) return `project_id=eq.${projectId}`;
  return null;
}

type Canal = ReturnType<typeof supabase.channel>;
const abertos = new Map<string, { usos: number; canal: Canal | null; clientes: Set<QueryClient>; espera: ReturnType<typeof setTimeout> | null }>();

function reler(filtro: string) {
  const a = abertos.get(filtro);
  if (!a) return;
  if (a.espera) clearTimeout(a.espera);
  a.espera = setTimeout(() => {
    a.espera = null;
    a.clientes.forEach((qc) => {
      for (const chave of CHAVES_DOS_ARQUIVOS) void qc.invalidateQueries({ queryKey: chave as unknown as string[] });
    });
  }, ESPERA_AO_VIVO_MS);
}

function abrir(filtro: string, qc: QueryClient) {
  const existente = abertos.get(filtro);
  if (existente) {
    existente.usos += 1;
    existente.clientes.add(qc);
    return;
  }
  const a = { usos: 1, canal: null as Canal | null, clientes: new Set<QueryClient>([qc]), espera: null as ReturnType<typeof setTimeout> | null };
  abertos.set(filtro, a);
  try {
    let primeira = true;
    a.canal = supabase
      .channel(`arquivos:${filtro}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "files", filter: filtro }, () => reler(filtro))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "files", filter: filtro }, () => reler(filtro))
      .subscribe((status) => {
        // Reconectou depois de cair: o que mudou no meio tempo entra agora.
        if (status === "SUBSCRIBED") {
          if (!primeira) reler(filtro);
          primeira = false;
        }
      });
  } catch {
    a.canal = null;
  }
}

function fechar(filtro: string, qc: QueryClient) {
  const a = abertos.get(filtro);
  if (!a) return;
  a.usos -= 1;
  if (a.usos > 0) return;
  if (a.espera) clearTimeout(a.espera);
  abertos.delete(filtro);
  a.clientes.delete(qc);
  if (a.canal) void supabase.removeChannel(a.canal);
}

/** Liga o tempo real dos arquivos do cliente (ou do projeto) enquanto a tela está aberta. */
export function useArquivosAoVivo(clientId?: string | null, projectId?: string | null, ligado = true) {
  const queryClient = useQueryClient();
  const filtro = ligado ? filtroDosArquivos(clientId, projectId) : null;
  useEffect(() => {
    if (!filtro) return;
    abrir(filtro, queryClient);
    return () => fechar(filtro, queryClient);
  }, [filtro, queryClient]);
}

/** Só para teste: quantos canais estão abertos. */
export function canaisAbertosDosArquivos(): number {
  return abertos.size;
}
