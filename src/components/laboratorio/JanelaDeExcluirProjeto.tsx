import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { JanelaCentral, botao, juntar, texto } from "@/components/sistema";
import { ErroDaMesa, textoDoErro } from "@/lib/mesa/api";
import { chaveDosProjetos, excluirProjeto } from "@/lib/laboratorio/api";

/**
 * Confirmação de "Excluir projeto" (21/10/2026, pedido do dono): no menu do
 * editor e em cada cartão da lista. Mostra o nome e avisa que não volta; os
 * arquivos gerados continuam em Arquivos. Só exclui no confirmar
 * (projeto_excluir apaga as execuções e o projeto).
 */
export default function JanelaDeExcluirProjeto({
  projeto,
  onFechar,
  onExcluido,
}: {
  /** null: fechada. */
  projeto: { id: string; nome: string } | null;
  onFechar: () => void;
  onExcluido?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [excluindo, setExcluindo] = useState(false);
  /** Projeto em uso (409 projeto_em_uso): a frase da função fica na janela. */
  const [emUso, setEmUso] = useState<string | null>(null);
  const fechar = () => {
    setEmUso(null);
    onFechar();
  };

  const confirmar = async () => {
    if (!projeto || excluindo) return;
    setExcluindo(true);
    try {
      await excluirProjeto(projeto.id);
      toast.success("Projeto excluído", { description: "Os arquivos gerados continuam em Arquivos." });
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
      fechar();
      if (onExcluido) onExcluido(projeto.id);
    } catch (e) {
      if (e instanceof ErroDaMesa && e.codigo === "projeto_em_uso") setEmUso(e.message);
      else toast.error("Não deu para excluir o projeto", { description: textoDoErro(e) });
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <JanelaCentral
      aberta={!!projeto}
      onFechar={() => (excluindo ? undefined : fechar())}
      titulo="Excluir projeto"
      icone={<Trash2 className="h-4 w-4" />}
      largura="sm"
      data-excluir-projeto=""
      rodape={
        <>
          <button type="button" className={botao.discreto} onClick={fechar} disabled={excluindo}>
            Cancelar
          </button>
          <button type="button" className={botao.perigo} onClick={() => void confirmar()} disabled={excluindo || !!emUso} data-confirmar-excluir="">
            {excluindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            Excluir de vez
          </button>
        </>
      }
    >
      <p className={juntar(texto.corpo, "truncate font-medium")} title={projeto ? projeto.nome : ""} data-nome-a-excluir="">
        {projeto ? projeto.nome : ""}
      </p>
      <p className={juntar(texto.corpo, "mt-2")}>O canvas, os nós e o histórico de execuções somem e não voltam.</p>
      <p className={juntar(texto.auxiliar, "mt-1")}>Os arquivos gerados continuam em Arquivos.</p>
      {emUso ? (
        <p role="alert" className={juntar(texto.corpo, "mt-3 text-warning")} data-projeto-em-uso="">
          {emUso}
        </p>
      ) : null}
    </JanelaCentral>
  );
}
