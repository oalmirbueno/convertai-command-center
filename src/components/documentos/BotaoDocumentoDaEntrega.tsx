import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirmDialog";
import { botao, juntar } from "@/components/sistema/estilos";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { estimarDocumento, gerarDocumento, type PedidoDoDocumento, type ResultadoDaGeracao } from "@/lib/documentos/registrarEntrega";

/**
 * "Documento da entrega" (Frente DOC, 29/09/2026). Gerar usa IA, então o
 * custo aparece antes, no Confirmar. O PDF vai para Arquivos (pasta
 * Entregas) só para a equipe; mandar ao cliente é outro Confirmar, na lista
 * de documentos. Erro volta para a tela com o motivo.
 */
export default function BotaoDocumentoDaEntrega({
  pedido,
  rotulo = "Documento da entrega",
  variante = "secundario",
  className,
  onGerado,
}: {
  pedido: PedidoDoDocumento | null;
  rotulo?: string;
  variante?: "secundario" | "discreto" | "primario";
  className?: string;
  onGerado?: (r: ResultadoDaGeracao) => void;
}) {
  const confirmar = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState<"" | "estimando" | "gerando">("");

  const gerar = async () => {
    if (!pedido || ocupado) return;
    setOcupado("estimando");
    let estimativa: number | null = null;
    try {
      estimativa = (await estimarDocumento(pedido.clientId)).estimativa_usd;
    } catch (e) {
      setOcupado("");
      toast.error(textoDoErro(e, "Não foi possível calcular o custo do documento."));
      return;
    }
    setOcupado("");
    const ok = await confirmar({
      title: "Gerar o documento da entrega?",
      description: `O PDF sai só com o que está registrado no painel (publicações, aprovações, artes, relatórios), com as provas. Fica em Arquivos, na pasta Entregas, e nada vai ao cliente agora. Custo estimado: ${usd(estimativa)}.`,
      confirmLabel: "Confirmar",
    });
    if (!ok) return;
    setOcupado("gerando");
    try {
      const r = await gerarDocumento(pedido);
      void queryClient.invalidateQueries({ queryKey: ["documentos-da-entrega", pedido.clientId] });
      toast.success(`Documento nº ${r.documento.numero ?? ""} pronto: ${r.eventos} ${r.eventos === 1 ? "item" : "itens"} e ${r.provas} ${r.provas === 1 ? "prova" : "provas"}.`, {
        description: r.avisos.length ? `${r.avisos.length} ${r.avisos.length === 1 ? "aviso" : "avisos"} para conferir na lista de documentos.` : undefined,
        action: { label: "Abrir", onClick: () => navigate(`/arquivos?client=${encodeURIComponent(pedido.clientId)}&folder=entregas`) },
      });
      if (onGerado) onGerado(r);
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível gerar o documento da entrega."));
    } finally {
      setOcupado("");
    }
  };

  return (
    <button
      type="button"
      className={juntar(botao[variante], className)}
      onClick={() => void gerar()}
      disabled={!pedido || !!ocupado}
      aria-busy={!!ocupado}
      title={pedido ? "Gera o PDF com o que foi feito e as provas" : "Escolha o cliente"}
    >
      {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <FileCheck2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
      {ocupado === "gerando" ? "Gerando..." : rotulo}
    </button>
  );
}
