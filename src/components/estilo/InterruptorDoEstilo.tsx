import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { AjudaRecolhida } from "@/components/sistema";
import { useAvisarErro } from "@/components/mesa/Custo";
import { chamarEstilo } from "./estiloApi";

/**
 * "Usar estilo do cliente nesta geração" (frente S2). Liga ou desliga
 * direcao.usar_estilo_do_cliente nos trabalhos dados (o do Estúdio, ou todos os
 * criativos da tela no Estúdio Ads). Desligado é o padrão e deixa a geração
 * exatamente como hoje. Sem estilo ativo, o interruptor aparece desativado.
 */
export default function InterruptorDoEstilo({
  clientId,
  marcaId,
  trabalhoIds,
  estiloAtivo,
  rotulo = "Usar estilo do cliente",
  className = "",
}: {
  clientId: string;
  marcaId?: string | null;
  trabalhoIds: string[];
  /** O estilo do cliente está ativo (sem ele o interruptor não liga). */
  estiloAtivo: boolean;
  /** Texto ao lado da chave (frente AE-3: o Estúdio usa o curto "Estilo do cliente"). */
  rotulo?: string;
  className?: string;
}) {
  const avisarErro = useAvisarErro();
  const queryClient = useQueryClient();
  const ids = trabalhoIds.filter(Boolean).slice().sort();
  const chave = ["estilo-interruptor", clientId, ids.join(",")];
  const lido = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const d = await chamarEstilo<{ ligados?: string[] }>("interruptor_ler", clientId, marcaId, { trabalho_ids: ids });
      return Array.isArray(d && d.ligados) ? d.ligados! : [];
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
  const ligadoNoBanco = ids.length > 0 && !!lido.data && ids.every((id) => lido.data!.indexOf(id) >= 0);
  const [ligado, setLigado] = useState(ligadoNoBanco);
  const [gravando, setGravando] = useState(false);
  useEffect(() => setLigado(ligadoNoBanco), [ligadoNoBanco]);

  const mudar = async (v: boolean) => {
    setLigado(v);
    setGravando(true);
    try {
      await chamarEstilo("interruptor", clientId, marcaId, { trabalho_ids: ids, ligado: v });
      queryClient.setQueryData(chave, v ? ids : []);
    } catch (e) {
      setLigado(!v);
      avisarErro(e, "Não foi possível mudar o estilo desta geração");
    } finally {
      setGravando(false);
    }
  };

  if (!ids.length) return null;
  const desativado = gravando || lido.isLoading || (!estiloAtivo && !ligado);
  return (
    <div className={`inline-flex min-w-0 items-center ${className}`} data-interruptor-do-estilo={ligado ? "ligado" : "desligado"}>
      <Switch
        id={`estilo-${ids[0]}`}
        checked={ligado}
        disabled={desativado}
        onCheckedChange={(v) => void mudar(v === true)}
        aria-label="Usar estilo do cliente nesta geração"
        data-compacto=""
      />
      <label htmlFor={`estilo-${ids[0]}`} className="ml-2 mr-1 truncate text-[12px] text-muted-foreground">
        {rotulo}
      </label>
      <AjudaRecolhida rotulo="O que faz o estilo do cliente">
        {estiloAtivo
          ? "Ligado, a geração parte do estilo do cliente e usa as referências dele como acabamento. O pedido da lâmina e as referências dela continuam valendo. Desligado, nada muda."
          : "O cliente ainda não tem estilo ativo. Abra Estilo, converse com o agente e ligue o estilo."}
      </AjudaRecolhida>
    </div>
  );
}
