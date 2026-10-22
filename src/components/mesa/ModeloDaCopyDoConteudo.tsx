import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMesa } from "@/components/mesa/MesaContexto";
import { nomeDoModelo, precoDoModelo, type ModeloIa } from "@/lib/mesa/api";
import { escolherModeloDaCopy } from "../../../supabase/functions/estudio-arte/modulos/copy-viral";
import { SeletorDeModelo } from "./Seletores";

/**
 * Modelo da copy dos conteúdos (frente COPY-V, 23/10/2026; dono: "poder também
 * escolher o modelo de preparação do conteúdo e colocar um modelo mais
 * inteligente e melhor para copy"). Um seletor só, no Mês e no Estúdio, com o
 * preço de cada modelo. Sem escolha vale "o melhor para copy" (o marcado
 * "copy" no catálogo: Claude Opus 5.5). A escolha fica lembrada por cliente no
 * banco (mesa_cliente_config.modelo_copy_id, pela RPC definir_modelo_da_copy),
 * e o servidor lê a mesma escolha em toda escrita de texto, mesmo sem a tela
 * mandar o id. Sem a migration publicada, a escolha vale só nesta sessão.
 */

export const chaveDoModeloDaCopy = (clientId: string) => ["mesa", "modelo-da-copy", clientId];

async function lerModeloGuardado(clientId: string): Promise<string> {
  const { data, error } = await (supabase as any).from("mesa_cliente_config").select("modelo_copy_id").eq("client_id", clientId).maybeSingle();
  // Coluna ainda não publicada: sem escolha guardada (vale o padrão).
  if (error) return "";
  return data && typeof data.modelo_copy_id === "string" ? data.modelo_copy_id : "";
}

export function useModeloDaCopyDoConteudo() {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const guardado = useQuery({ queryKey: chaveDoModeloDaCopy(clientId), queryFn: () => lerModeloGuardado(clientId), enabled: !!clientId, staleTime: 60_000 });
  const [daSessao, setDaSessao] = useState<string | null>(null);
  const escolhidoId = daSessao != null ? daSessao : guardado.data || "";
  const escolha = escolherModeloDaCopy<ModeloIa>(catalogo, escolhidoId);
  const padrao = escolherModeloDaCopy<ModeloIa>(catalogo, "");

  const trocar = async (id: string) => {
    setDaSessao(id);
    const { error } = await (supabase as any).rpc("definir_modelo_da_copy", { _client_id: clientId, _modelo_id: id || null });
    if (error) {
      toast.warning("A escolha vale só nesta sessão", { description: "O modelo da copy ainda não pode ser lembrado para este cliente (banco sem a atualização)." });
      return;
    }
    setDaSessao(null);
    await queryClient.invalidateQueries({ queryKey: chaveDoModeloDaCopy(clientId) });
  };

  return {
    modelo: escolha.modelo,
    modeloId: escolha.modelo ? escolha.modelo.id : "",
    motivo: escolha.motivo,
    padrao: padrao.modelo,
    /** Para mandar na chamada (o servidor também lê o lembrado). */
    corpo: escolha.modelo ? { modelo_copy_id: escolha.modelo.id } : {},
    trocar,
  };
}

export type EstadoDoModeloDaCopy = ReturnType<typeof useModeloDaCopyDoConteudo>;

/** O seletor com o preço e a linha do padrão. */
export function SeletorDoModeloDaCopyDoConteudo({ estado }: { estado: EstadoDoModeloDaCopy }) {
  const { catalogo } = useMesa();
  const { modelo, motivo, padrao } = estado;
  return (
    <div className="min-w-0">
      <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modelo ? modelo.id : ""} onChange={(id) => void estado.trocar(id)} rotulo="Modelo da copy" />
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
        {motivo === "escolhido"
          ? `Escolhido para este cliente: ${modelo ? `${nomeDoModelo(modelo)} (${precoDoModelo(modelo)})` : ""}.`
          : padrao
            ? `Padrão: o melhor para copy, ${nomeDoModelo(padrao)} (${precoDoModelo(padrao)}).`
            : "Sem modelo marcado para copy: escreve o modelo do estrategista."}
        {motivo === "escolhido" && padrao && modelo && padrao.id !== modelo.id && (
          <button type="button" className="ml-1 underline underline-offset-2" onClick={() => void estado.trocar("")}>
            Voltar ao padrão
          </button>
        )}
      </p>
    </div>
  );
}
