import { useMemo, useRef, useState } from "react";
import { AlertTriangle, AudioWaveform, Clapperboard, Download, Film, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import BotaoComIcone from "@/components/sistema/BotaoComIcone";
import MenuMais from "@/components/sistema/MenuMais";
import { botao, foco, juntar } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarEditorVideo, emPreparacao } from "@/lib/editor/api";
import type { EstadoDoSalvamento } from "@/lib/editor/autosave";
import { cancelarRender, fontesSemOnda, lerFilaAgora, opsDaOnda, pedirRender, rotuloDoPedido, temRenderAtivo, uidDoClique, useFilaDeRender, type PedidoNaFila } from "@/lib/editor/render";
import type { Operacao } from "@/lib/editor/operacoes";
import { janelaDaAmostra, ROTULO_DO_TIPO, type TipoDeRender } from "../../../../supabase/functions/_shared/render-do-editor";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Renderizar pela fila (frente EDT, F1): o botão que troca o ZIP (o ZIP
 * continua no cartão Exportar do agente). O pedido vai para render_pedidos e o
 * worker da máquina da agência renderiza; a barra mostra o andamento (lido a
 * cada 15 s, só com pedido ativo), o link do MP4 pronto e o Cancelar. A onda
 * medida volta sozinha para o projeto (um passo do desfazer).
 *
 * O clique sempre faz o que diz: com o editor "Salvando em instantes", grava
 * na hora e só então pede (o render sai do projeto salvo, com a revisão que o
 * servidor confere). Trava só com o editor em erro ou conflito. O erro vira
 * uma etiqueta que abre a mensagem inteira, com "Tentar de novo" quando
 * repetir resolve e "Dispensar". Um pedido desta versão reaberta (ou depois de
 * recarregar) é lido uma vez ao abrir; sem pedido, abrir não consulta nada.
 */

const CODIGOS_EM_PREPARACAO = ["funcao_indisponivel", "acao_desconhecida", "servico_indisponivel"];

type Problema = { chave: string; texto: string; tentar: (() => void) | null };

export default function Renderizar({
  clientId,
  versaoId,
  projeto,
  salvamento,
  salvarAgora,
  estadoDoSalvamento,
  revisao,
  cursor,
  onOps,
}: {
  clientId: string;
  versaoId: string;
  projeto: ProjetoDeEdicao;
  /** Estado do salvamento nesta pintura (só trava em erro ou conflito). */
  salvamento: EstadoDoSalvamento;
  /** Grava agora o que falta (espera a gravação em andamento). */
  salvarAgora: () => Promise<void>;
  /** Estado verdadeiro do salvador depois do salvarAgora (a prop acima é da pintura anterior). */
  estadoDoSalvamento: () => EstadoDoSalvamento;
  /** Revisão salva: o servidor recusa (projeto_nao_salvo) se não for a dele. */
  revisao: () => number | null;
  cursor: () => number;
  onOps: (ops: Operacao[], rotulo: string) => void;
}) {
  const projetoRef = useRef(projeto);
  projetoRef.current = projeto;
  // Havia pedido desta versão (desta aba, de outra ou do agente): lê a fila uma vez ao abrir.
  const lerAoAbrir = useMemo(() => temRenderAtivo(versaoId), [versaoId]);
  const fila = useFilaDeRender(
    clientId,
    versaoId,
    chamarEditorVideo,
    (p) => {
      if (p.estado === "erro") {
        toast.error(`${ROTULO_DO_TIPO[p.tipo]} não saiu`, { description: p.erro_mensagem || undefined, duration: 9000 });
        return;
      }
      if (p.tipo === "onda") {
        const ops = opsDaOnda(projetoRef.current, p, new Date().toISOString());
        if (ops.length) onOps(ops, "Onda medida");
        toast.success("Onda do áudio medida", { description: "O corte pela onda já pode rodar." });
      } else toast.success(`${ROTULO_DO_TIPO[p.tipo]} pronto`, { description: "O MP4 está na barra do editor e na Mídia." });
    },
    lerAoAbrir,
  );
  const [pedindo, setPedindo] = useState<TipoDeRender | null>(null);
  const [erro, setErro] = useState<Problema | null>(null);
  const [dispensado, setDispensado] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const pedindoRef = useRef(false);
  const semOnda = fontesSemOnda(projeto);
  const bloqueado = salvamento === "erro" || salvamento === "conflito";
  const motivoDoBloqueio = salvamento === "conflito" ? "Mudou em outro lugar: use Recarregar" : salvamento === "erro" ? "O editor não salvou: use Tentar de novo" : null;

  const pedir = async (tipo: TipoDeRender, janelaFixa?: { inicio_s: number; fim_s: number }) => {
    if (pedindoRef.current) return;
    // Antes da espera: o giro aparece na hora, o duplo clique não pede duas vezes e a amostra sai do ponto do clique.
    const t = cursor();
    pedindoRef.current = true;
    setPedindo(tipo);
    setErro(null);
    try {
      await salvarAgora();
      const estado = estadoDoSalvamento();
      if (estado !== "salvo") {
        setErro({ chave: `salvar:${estado}:${Date.now()}`, texto: estado === "conflito" ? "Mudou em outro lugar: use Recarregar." : "O editor não salvou: use Tentar de novo.", tentar: null });
        return;
      }
      const duracao = projetoRef.current.duracao_s;
      const janela = tipo === "amostra" ? janelaFixa || janelaDaAmostra(t, t + 12, duracao) : null;
      const r = await pedirRender(chamarEditorVideo, {
        clientId,
        versaoId,
        tipo,
        uid: uidDoClique(),
        revisao: revisao(),
        inicio_s: janela ? janela.inicio_s : undefined,
        fim_s: janela ? janela.fim_s : undefined,
        fontes: tipo === "onda" ? fontesSemOnda(projetoRef.current) : undefined,
      });
      if (r.ja_existia) toast.info(`${ROTULO_DO_TIPO[tipo]} já está na fila.`);
    } catch (e) {
      const preparacao = emPreparacao(e);
      const texto = preparacao ? "A fila de render está em preparação: falta publicar a função editor-video." : textoDoErro(e);
      setErro({ chave: `pedido:${Date.now()}`, texto, tentar: preparacao ? null : () => void pedir(tipo, janelaFixa) });
      console.error("[editor] render não pedido", e);
    } finally {
      pedindoRef.current = false;
      setPedindo(null);
    }
  };

  const ativo = fila.pedidos.find((p) => p.estado === "fila" || p.estado === "rodando") || null;
  const ultimoPronto = fila.pedidos.find((p) => p.estado === "pronto" && p.tipo !== "onda" && p.url) || null;
  const falhou = !ativo && fila.pedidos[0] && fila.pedidos[0].estado === "erro" ? fila.pedidos[0] : null;
  const semFila = fila.codigo === "banco_sem_fila";

  /** "Tentar de novo" de um pedido que falhou: o mesmo tipo; a amostra na mesma janela; a onda recalcula as fontes. */
  const repetir = (p: PedidoNaFila) => {
    const e = p.entrada || {};
    const inicio = Number(e.inicio_s);
    const fim = Number(e.fim_s);
    void pedir(p.tipo, p.tipo === "amostra" && isFinite(inicio) && isFinite(fim) && fim > inicio ? { inicio_s: inicio, fim_s: fim } : undefined);
  };

  const problema: Problema | null = erro
    ? erro
    : semFila
      ? { chave: "sem-fila", texto: "A fila de render ainda não foi ativada no banco. Use o ZIP pelo agente.", tentar: null }
      : falhou
        ? { chave: `falhou:${falhou.id}`, texto: falhou.erro_mensagem || "O render não saiu.", tentar: () => repetir(falhou) }
        : fila.erro
          ? { chave: `fila:${fila.erro}`, texto: fila.erro, tentar: CODIGOS_EM_PREPARACAO.indexOf(fila.codigo || "") >= 0 ? null : () => lerFilaAgora(clientId, versaoId, chamarEditorVideo) }
          : null;
  const mostrarProblema = !!problema && problema.chave !== dispensado;

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
        <a
          className={juntar(botao.barra, "mr-1")}
          href={ultimoPronto.url || undefined}
          target="_blank"
          rel="noreferrer"
          data-render-pronto=""
          title={`${ROTULO_DO_TIPO[ultimoPronto.tipo]} pronto: abrir o MP4`}
          aria-label={`${ROTULO_DO_TIPO[ultimoPronto.tipo]} pronto: abrir o MP4`}
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          <span className="hidden lg:inline">{ultimoPronto.tipo === "amostra" ? "Amostra" : "MP4"}</span>
        </a>
      ) : null}
      {mostrarProblema && problema && (
        <span className="mr-1 min-w-0" role="alert">
          <Popover open={aberto} onOpenChange={setAberto}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={juntar("toque-compacto inline-flex h-7 max-w-[120px] items-center rounded-md px-1.5 text-[12px] text-destructive transition-colors hover:bg-destructive/10 sm:max-w-[220px]", foco)}
                aria-label={`O render não saiu: ${problema.texto}`}
                data-render-erro=""
              >
                <AlertTriangle className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{problema.texto}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[calc(100vw-24px)] max-w-[320px] p-3" role="alert">
              <p className="text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{problema.texto}</p>
              <div className="mt-3 flex min-w-0 justify-end">
                <button
                  type="button"
                  className={juntar(botao.discreto, "mr-2 h-8")}
                  onClick={() => {
                    setDispensado(problema.chave);
                    setErro(null);
                    setAberto(false);
                  }}
                >
                  Dispensar
                </button>
                {problema.tentar && (
                  <button
                    type="button"
                    className={juntar(botao.secundario, "h-8")}
                    disabled={!!pedindo || bloqueado}
                    onClick={() => {
                      setAberto(false);
                      problema.tentar!();
                    }}
                  >
                    Tentar de novo
                  </button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </span>
      )}
      <BotaoComIcone
        variante="primario"
        className="h-8 px-2.5 text-[12px]"
        icone={pedindo === "render_final" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
        rotulo="Renderizar"
        onClick={() => void pedir("render_final")}
        disabled={!!pedindo || bloqueado || !!(ativo && ativo.tipo === "render_final")}
        title={motivoDoBloqueio || "Renderiza o vídeo inteiro na máquina da agência (sem custo). O MP4 volta para a Mídia."}
        data-botao-renderizar=""
      />
      <MenuMais
        rotulo="Mais do render"
        itens={[
          { rotulo: "Amostra de 12 s no cursor", icone: <Clapperboard className="h-4 w-4" />, aoEscolher: () => void pedir("amostra"), desativado: !!pedindo || bloqueado, dica: motivoDoBloqueio || "8 a 15 s com legenda, animação e som, antes do vídeo inteiro." },
          { rotulo: "Ver o andamento", icone: <RefreshCw className="h-4 w-4" />, aoEscolher: () => lerFilaAgora(clientId, versaoId, chamarEditorVideo), dica: "Lê a fila de render desta versão (o último MP4 pronto aparece na barra)." },
          semOnda.length > 0 && { rotulo: `Medir a onda (${semOnda.length})`, icone: <AudioWaveform className="h-4 w-4" />, aoEscolher: () => void pedir("onda"), desativado: !!pedindo || bloqueado, dica: motivoDoBloqueio || "O worker lê o áudio em janelas de 10 ms: base do corte pela onda." },
        ]}
      />
    </div>
  );
}
