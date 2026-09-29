import { useRef, useState } from "react";
import { AudioWaveform, Clapperboard, Download, Film, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import MenuMais from "@/components/sistema/MenuMais";
import { botao, juntar } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarEditorVideo, emPreparacao } from "@/lib/editor/api";
import { cancelarRender, fontesSemOnda, lerFilaAgora, opsDaOnda, pedirRender, rotuloDoPedido, uidDoClique, useFilaDeRender } from "@/lib/editor/render";
import type { Operacao } from "@/lib/editor/operacoes";
import { janelaDaAmostra, ROTULO_DO_TIPO, type TipoDeRender } from "../../../../supabase/functions/_shared/render-do-editor";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Renderizar pela fila (frente EDT, F1): o botão que troca o ZIP (o ZIP
 * continua no cartão Exportar do agente). O pedido vai para render_pedidos e o
 * worker da máquina da agência renderiza; a barra mostra o andamento (lido a
 * cada 15 s, só com pedido ativo), o link do MP4 pronto e o Cancelar. A onda
 * medida volta sozinha para o projeto (um passo do desfazer).
 */

export default function Renderizar({ clientId, versaoId, projeto, salvo, cursor, onOps }: { clientId: string; versaoId: string; projeto: ProjetoDeEdicao; salvo: boolean; cursor: () => number; onOps: (ops: Operacao[], rotulo: string) => void }) {
  const projetoRef = useRef(projeto);
  projetoRef.current = projeto;
  const fila = useFilaDeRender(clientId, versaoId, chamarEditorVideo, (p) => {
    if (p.estado === "erro") {
      toast.error(`${ROTULO_DO_TIPO[p.tipo]} não saiu`, { description: p.erro_mensagem || undefined, duration: 9000 });
      return;
    }
    if (p.tipo === "onda") {
      const ops = opsDaOnda(projetoRef.current, p, new Date().toISOString());
      if (ops.length) onOps(ops, "Onda medida");
      toast.success("Onda do áudio medida", { description: "O corte pela onda já pode rodar." });
    } else toast.success(`${ROTULO_DO_TIPO[p.tipo]} pronto`, { description: "O MP4 está na barra do editor e na Mídia." });
  });
  const [pedindo, setPedindo] = useState<TipoDeRender | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const semOnda = fontesSemOnda(projeto);

  const pedir = async (tipo: TipoDeRender) => {
    if (!salvo) return toast.info("Espere o editor salvar (aparece \"Salvo\") e peça de novo.");
    setPedindo(tipo);
    setErro(null);
    try {
      const t = cursor();
      const janela = tipo === "amostra" ? janelaDaAmostra(t, t + 12, projeto.duracao_s) : null;
      const r = await pedirRender(chamarEditorVideo, { clientId, versaoId, tipo, uid: uidDoClique(), inicio_s: janela ? janela.inicio_s : undefined, fim_s: janela ? janela.fim_s : undefined, fontes: tipo === "onda" ? semOnda : undefined });
      if (r.ja_existia) toast.info(`${ROTULO_DO_TIPO[tipo]} já está na fila.`);
    } catch (e) {
      const t = emPreparacao(e) ? "A fila de render está em preparação: falta publicar a função editor-video." : textoDoErro(e);
      setErro(t);
      console.error("[editor] render não pedido", e);
    } finally {
      setPedindo(null);
    }
  };

  const ativo = fila.pedidos.find((p) => p.estado === "fila" || p.estado === "rodando") || null;
  const ultimoPronto = fila.pedidos.find((p) => p.estado === "pronto" && p.tipo !== "onda" && p.url) || null;
  const falhou = !ativo && fila.pedidos[0] && fila.pedidos[0].estado === "erro" ? fila.pedidos[0] : null;
  const semFila = fila.codigo === "banco_sem_fila";
  const mensagem = erro || (semFila ? "A fila de render ainda não foi ativada no banco. Use o ZIP pelo agente." : null);

  return (
    <div className="flex min-w-0 items-center" data-renderizar="">
      {ativo ? (
        <span className="mr-1 flex min-w-0 items-center text-[12px] text-muted-foreground" data-render-andamento={ativo.estado} title={`${ROTULO_DO_TIPO[ativo.tipo]}: ${rotuloDoPedido(ativo, Date.now(), fila.worker)}`}>
          <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" />
          <span className="truncate">
            {ROTULO_DO_TIPO[ativo.tipo]}: {rotuloDoPedido(ativo, Date.now(), fila.worker)}
          </span>
          <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => void cancelarRender(chamarEditorVideo, clientId, versaoId, ativo.id).catch((e) => toast.error("Não cancelou", { description: textoDoErro(e) }))} aria-label="Cancelar o render">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : ultimoPronto ? (
        <a className={juntar(botao.barra, "mr-1")} href={ultimoPronto.url || undefined} target="_blank" rel="noreferrer" data-render-pronto="" title={`${ROTULO_DO_TIPO[ultimoPronto.tipo]} pronto: abrir o MP4`}>
          <Download className="mr-1 h-3.5 w-3.5" />
          <span className="hidden lg:inline">{ultimoPronto.tipo === "amostra" ? "Amostra" : "MP4"}</span>
        </a>
      ) : null}
      {(mensagem || falhou) && (
        <span className="mr-1 max-w-[220px] truncate text-[12px] text-destructive" role="alert" title={mensagem || (falhou && falhou.erro_mensagem) || undefined}>
          {mensagem || (falhou && falhou.erro_mensagem) || "O render não saiu."}
        </span>
      )}
      <button type="button" className={juntar(botao.primario, "h-8 px-2.5 text-[12px]")} onClick={() => void pedir("render_final")} disabled={!!pedindo || !salvo || !!(ativo && ativo.tipo === "render_final")} data-botao-renderizar="" title="Renderiza o vídeo inteiro na máquina da agência (sem custo). O MP4 volta para a Mídia.">
        {pedindo === "render_final" ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1" /> : <Film className="h-3.5 w-3.5 sm:mr-1" />}
        <span className="hidden sm:inline">Renderizar</span>
      </button>
      <MenuMais
        rotulo="Mais do render"
        itens={[
          { rotulo: "Amostra de 12 s no cursor", icone: <Clapperboard className="h-4 w-4" />, aoEscolher: () => void pedir("amostra"), desativado: !!pedindo || !salvo, dica: "8 a 15 s com legenda, animação e som, antes do vídeo inteiro." },
          { rotulo: "Ver o andamento", icone: <RefreshCw className="h-4 w-4" />, aoEscolher: () => lerFilaAgora(clientId, versaoId, chamarEditorVideo), dica: "Lê a fila de render desta versão (o último MP4 pronto aparece na barra)." },
          semOnda.length > 0 && { rotulo: `Medir a onda (${semOnda.length})`, icone: <AudioWaveform className="h-4 w-4" />, aoEscolher: () => void pedir("onda"), desativado: !!pedindo || !salvo, dica: "O worker lê o áudio em janelas de 10 ms: base do corte pela onda." },
        ]}
      />
    </div>
  );
}
