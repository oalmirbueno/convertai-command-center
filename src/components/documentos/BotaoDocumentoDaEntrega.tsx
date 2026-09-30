import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirmDialog";
import { botao, juntar } from "@/components/sistema/estilos";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { estimarDocumento, gerarDocumento, type DocumentoDaEntrega, type PedidoDoDocumento, type ResultadoDaGeracao } from "@/lib/documentos/registrarEntrega";

/**
 * "Documento da entrega" (Frente DOC, 29/09/2026). Gerar usa IA, então o
 * custo aparece antes, no Confirmar. O PDF vai para Arquivos (pasta
 * Entregas) só para a equipe; mandar ao cliente é outro Confirmar, na lista
 * de documentos. Erro volta para a tela com o motivo.
 *
 * Frente UXS (regra do dono: "sem custo, faz na hora"): com o rascunho da
 * equipe, texto escrito e custo zero, num documento que ainda não foi ao
 * cliente, gera sem o Confirmar. Qualquer custo, texto que a IA ainda vai
 * escrever ou documento já mandado ao cliente continuam com o Confirmar.
 */
export default function BotaoDocumentoDaEntrega({
  pedido,
  rotulo = "Documento da entrega",
  variante = "secundario",
  className,
  onGerado,
  antesDeGerar,
  statusDoDocumento,
}: {
  pedido: PedidoDoDocumento | null;
  rotulo?: string;
  variante?: "secundario" | "discreto" | "primario";
  className?: string;
  onGerado?: (r: ResultadoDaGeracao) => void;
  /** Antes de estimar (ex.: salvar o rascunho); false para. */
  antesDeGerar?: () => Promise<boolean>;
  /** Estado do documento que vai ser gerado de novo (sem ele, o Confirmar fica sempre). */
  statusDoDocumento?: DocumentoDaEntrega["status"];
}) {
  const confirmar = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState<"" | "estimando" | "gerando">("");

  const gerar = async () => {
    if (!pedido || ocupado) return;
    if (antesDeGerar && !(await antesDeGerar())) return;
    setOcupado("estimando");
    let estimativa: number | null = null;
    let textoDaEquipe = false;
    try {
      const est = await estimarDocumento(pedido.clientId, { documentoId: pedido.documentoId, usarRascunho: pedido.usarRascunho });
      estimativa = typeof est.estimativa_usd === "number" ? est.estimativa_usd : null;
      textoDaEquipe = est.texto_da_equipe === true;
    } catch (e) {
      setOcupado("");
      toast.error(textoDoErro(e, "Não foi possível calcular o custo do documento."));
      return;
    }
    setOcupado("");
    const jaFoiAoCliente = statusDoDocumento === "em_aprovacao" || statusDoDocumento === "no_portal";
    // Sem custo e sem nada ao cliente: faz na hora. As quatro condições juntas; null nunca conta como zero.
    const naHora = pedido.usarRascunho === true && textoDaEquipe && estimativa === 0 && (statusDoDocumento === "pendente" || statusDoDocumento === "gerado");
    if (!naHora) {
      const custo = estimativa === 0 ? "Sem custo de IA." : typeof estimativa === "number" ? `Custo estimado: ${usd(estimativa)}.` : "Custo não calculado.";
      const aviso = jaFoiAoCliente ? " Este documento já foi mandado ao cliente: a versão nova volta para só a equipe ver e precisa ser mandada de novo." : "";
      const ok = await confirmar({
        title: "Gerar o documento da entrega?",
        description: pedido.usarRascunho
          ? `O PDF sai com o texto, as provas e os números do rascunho da equipe, só com o que está registrado no painel. Fica em Arquivos, na pasta Entregas, e nada vai ao cliente agora. ${custo}${aviso}`
          : `O PDF sai só com o que está registrado no painel (publicações, aprovações, artes, relatórios), com as provas. Fica em Arquivos, na pasta Entregas, e nada vai ao cliente agora. ${custo}${aviso}`,
        confirmLabel: "Confirmar",
      });
      if (!ok) return;
    }
    setOcupado("gerando");
    try {
      const r = await gerarDocumento(pedido);
      void queryClient.invalidateQueries({ queryKey: ["documentos-da-entrega", pedido.clientId] });
      const resumo = `${r.eventos} ${r.eventos === 1 ? "item" : "itens"} e ${r.provas} ${r.provas === 1 ? "prova" : "provas"}`;
      toast.success(naHora ? `PDF gerado, só a equipe vê. Documento nº ${r.documento.numero ?? ""}: ${resumo}.` : `Documento nº ${r.documento.numero ?? ""} pronto: ${resumo}.`, {
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
