import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMesa } from "@/components/mesa/MesaContexto";
import { nomeDoModelo, precoDoModelo, type ModeloIa } from "@/lib/mesa/api";
import { escolherModeloDoEscopo, type EscopoDoModelo } from "../../../supabase/functions/estudio-arte/modulos/copy-viral";
import { SeletorDeModelo } from "./Seletores";

/**
 * Seletores de modelo por escopo (23/10/2026; dono: "o seletor tem que ser no
 * gerar a copy do conteúdo e não da legenda; adicione um seletor no motor que
 * faz a copy do conteúdo, no refinar copy e no estrategista"). Três escopos,
 * cada um com o seu seletor, o preço de cada modelo e a escolha lembrada por
 * cliente em coluna própria (mesa_cliente_config.modelo_copy_id,
 * modelo_refino_id e modelo_estrategista_id, pela RPC definir_modelo_do_cliente):
 * - copy: o texto das lâminas e da peça (direção do Estúdio e arte rápida) e o
 *   detalhar e os conteúdos do Mês. Padrão: o melhor para copy (Opus 5.5);
 * - refino: o refinar copy. Padrão: o melhor para copy;
 * - estrategista: temas, plano e conversa do Mês. Padrão: o de hoje.
 * - roteiro (frente B, 23/10): o motor e o agente de roteiro da peça de vídeo
 *   (mesa-roteiros, modelo_roteiro_id). Padrão: o do estrategista, como hoje.
 * A legenda não usa nenhum deles (fica no modelo do diretor). Sem a migration
 * publicada, a escolha vale só nesta sessão.
 */

export const ROTULO_DO_ESCOPO: Record<EscopoDoModelo, string> = {
  copy: "Modelo da copy do conteúdo",
  refino: "Modelo do refinar copy",
  estrategista: "Modelo do estrategista",
  roteiro: "Modelo do roteiro",
};

/** O campo que vai na chamada de cada escopo (o servidor também lê o lembrado). */
export const CAMPO_DO_ESCOPO: Record<EscopoDoModelo, string> = {
  copy: "modelo_copy_id",
  refino: "modelo_refino_id",
  estrategista: "modelo_id",
  roteiro: "modelo_id",
};

const COLUNA_DO_ESCOPO: Record<EscopoDoModelo, string> = {
  copy: "modelo_copy_id",
  refino: "modelo_refino_id",
  estrategista: "modelo_estrategista_id",
  roteiro: "modelo_roteiro_id",
};

export const chaveDoModeloDoEscopo = (clientId: string, escopo: EscopoDoModelo) => ["mesa", "modelo-do-escopo", escopo, clientId];

async function lerModeloGuardado(clientId: string, escopo: EscopoDoModelo): Promise<string> {
  const coluna = COLUNA_DO_ESCOPO[escopo];
  const { data, error } = await (supabase as any).from("mesa_cliente_config").select(coluna).eq("client_id", clientId).maybeSingle();
  // Coluna ainda não publicada: sem escolha guardada (vale o padrão).
  if (error || !data) return "";
  return typeof data[coluna] === "string" ? data[coluna] : "";
}

export function useModeloDoEscopo(escopo: EscopoDoModelo) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const guardado = useQuery({ queryKey: chaveDoModeloDoEscopo(clientId, escopo), queryFn: () => lerModeloGuardado(clientId, escopo), enabled: !!clientId, staleTime: 60_000 });
  const [daSessao, setDaSessao] = useState<string | null>(null);
  const escolhidoId = daSessao != null ? daSessao : guardado.data || "";
  const escolha = escolherModeloDoEscopo<ModeloIa>(catalogo, escolhidoId, escopo);
  const padrao = escolherModeloDoEscopo<ModeloIa>(catalogo, "", escopo);

  const trocar = async (id: string) => {
    setDaSessao(id);
    const { error } = await (supabase as any).rpc("definir_modelo_do_cliente", { _client_id: clientId, _escopo: escopo, _modelo_id: id || null });
    if (error) {
      toast.warning("A escolha vale só nesta sessão", { description: "O modelo ainda não pode ser lembrado para este cliente (banco sem a atualização)." });
      return;
    }
    setDaSessao(null);
    await queryClient.invalidateQueries({ queryKey: chaveDoModeloDoEscopo(clientId, escopo) });
  };

  return {
    escopo,
    modelo: escolha.modelo,
    modeloId: escolha.modelo ? escolha.modelo.id : "",
    motivo: escolha.motivo,
    padrao: padrao.modelo,
    /** O id guardado para o cliente (vazio: sem escolha). */
    guardadoId: guardado.data || "",
    /** Para mandar na chamada (o servidor também lê o lembrado). */
    corpo: escolha.modelo ? { [CAMPO_DO_ESCOPO[escopo]]: escolha.modelo.id } : {},
    /** Há escolha explícita (da tela ou lembrada do cliente). */
    escolhido: escolha.motivo === "escolhido",
    /** Só a escolha explícita (a direção do Estúdio sem escolha segue no diretor de arte). */
    corpoEscolhido: escolha.motivo === "escolhido" && escolha.modelo ? { [CAMPO_DO_ESCOPO[escopo]]: escolha.modelo.id } : {},
    trocar,
  };
}

export type EstadoDoModeloDoEscopo = ReturnType<typeof useModeloDoEscopo>;

/** Compatível com a rodada anterior: o escopo da copy do conteúdo. */
export const useModeloDaCopyDoConteudo = () => useModeloDoEscopo("copy");
export type EstadoDoModeloDaCopy = EstadoDoModeloDoEscopo;

/**
 * O seletor com o preço e a linha do padrão. `valor`/`aoTrocar` deixam a tela
 * controlar o valor (o estrategista do Mês segue o modelo gravado na proposta).
 */
export function SeletorDoModeloDoEscopo({
  estado,
  valor,
  aoTrocar,
  padraoDoLugar,
}: {
  estado: EstadoDoModeloDoEscopo;
  valor?: string;
  aoTrocar?: (id: string) => void;
  /** 23/10: o padrão deste lugar quando não há escolha (a direção do Estúdio: o diretor de arte). */
  padraoDoLugar?: { rotulo: string; modelo: ModeloIa | null };
}) {
  const { catalogo } = useMesa();
  const { motivo } = estado;
  const doLugar = padraoDoLugar && motivo !== "escolhido";
  const padrao = padraoDoLugar ? padraoDoLugar.modelo : estado.padrao;
  const modelo = doLugar ? padraoDoLugar!.modelo : estado.modelo;
  const atual = valor != null ? valor : modelo ? modelo.id : "";
  const trocar = (id: string) => {
    if (aoTrocar) aoTrocar(id);
    void estado.trocar(id);
  };
  const doPadrao = padrao ? `${nomeDoModelo(padrao)} (${precoDoModelo(padrao)})` : "";
  return (
    <div className="min-w-0" data-escopo-do-modelo={estado.escopo}>
      <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={atual} onChange={trocar} rotulo={ROTULO_DO_ESCOPO[estado.escopo]} />
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
        {motivo === "escolhido"
          ? `Lembrado para este cliente${modelo ? `: ${nomeDoModelo(modelo)} (${precoDoModelo(modelo)})` : ""}.`
          : doLugar
            ? `Padrão (${padraoDoLugar!.rotulo})${doPadrao ? `: ${doPadrao}` : ""}.`
            : padrao
              ? estado.escopo === "estrategista" || estado.escopo === "roteiro" ? `Padrão: ${doPadrao}.` : `Padrão: o melhor para copy, ${doPadrao}.`
              : "Sem modelo padrão no catálogo."}
        {motivo === "escolhido" && padrao && modelo && padrao.id !== modelo.id && (
          <button type="button" className="ml-1 underline underline-offset-2" onClick={() => trocar("")}>
            Voltar ao padrão
          </button>
        )}
      </p>
    </div>
  );
}

/** Compatível com a rodada anterior. */
export function SeletorDoModeloDaCopyDoConteudo({ estado }: { estado: EstadoDoModeloDoEscopo }) {
  return <SeletorDoModeloDoEscopo estado={estado} />;
}
