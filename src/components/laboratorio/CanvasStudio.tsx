import { useEffect, useRef, useState } from "react";
import { Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { botao, juntar, texto } from "@/components/sistema";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { planejar, type MensagemDoPlanejar, type PerguntaGuiada } from "@/lib/laboratorio/api";
import { MODELO_PADRAO_DO_LAB, ROTULOS_DAS_PERGUNTAS, ehProjetoCompleto, preencherComExemplo, type CanvasDoLab, type OperacaoDoAgente } from "@/lib/laboratorio/nos";
import { tirarPedidoPendente } from "@/lib/laboratorio/pedidoPendente";
import CaixaDoPedido, { ATALHOS_DO_CANVAS, type AtalhoDoPedido } from "./CaixaDoPedido";
import PerguntasGuiadas from "./PerguntasGuiadas";
import type { ClienteDoLab } from "./Seletores";

/**
 * Canvas Studio (v2, 20/10/2026, pedido do dono): a caixa de pedido da
 * Início, fixa no topo do canvas. "Quero montar uma empresa / um produto low
 * ticket / um funil de vendas": manda o `planejar` em modo projeto_completo
 * (o agente pesquisa, monta de Pesquisa a Pôr no ar, nó ligado a nó) e as
 * operações entram no quadro na hora, com a animação de construção e
 * organizadas em colunas; "Desfazer" volta o quadro de antes. Pedido de
 * ajuste num quadro montado vai no modo normal. Nada é gerado aqui: rodar
 * continua sendo o "Rodar" com o custo antes; o agente ao lado segue para
 * conversar e ajustar.
 *
 * v3: projeto completo sem o essencial volta com até 4 perguntas guiadas; os
 * exemplos só preenchem a caixa, o dono responde e manda (vai em `respostas`)
 * ou pula e o agente monta assim mesmo (`pular_perguntas`).
 */

interface PerguntasPendentes {
  pedido: string;
  lista: PerguntaGuiada[];
  modelo: string;
}

export interface ResultadoDaConstrucao {
  feitas: number;
  falhas: Array<{ recibo: string; motivo: string }>;
  novos: number;
}

interface Ultima {
  resposta: string;
  feitas: number;
  novos: number;
  falhas: number;
  recusadas: string[];
  custo: number | null;
  completo: boolean;
}

export default function CanvasStudio({
  projetoId,
  nosNoQuadro,
  clienteId,
  clientes,
  onCliente,
  antesDePlanejar,
  onConstruir,
  onDesfazer,
  onConversa,
}: {
  projetoId: string;
  nosNoQuadro: number;
  clienteId: string | null;
  clientes: ClienteDoLab[];
  onCliente: (id: string | null) => void;
  /** A função planeja sobre o canvas salvo: salva o pendente antes. */
  antesDePlanejar: () => Promise<void>;
  /** Aplica as operações no quadro (com a animação de construção e organizando). */
  onConstruir: (ops: OperacaoDoAgente[], completo: boolean, previsto: CanvasDoLab | null) => ResultadoDaConstrucao;
  /** Volta o quadro de antes da última construção (null: nada a desfazer). */
  onDesfazer: (() => void) | null;
  /** O que foi pedido e respondido aqui também entra na conversa do agente ao lado. */
  onConversa?: (pedido: string, resposta: string) => void;
}) {
  const [pedido, setPedido] = useState("");
  const [modelo, setModelo] = useState(MODELO_PADRAO_DO_LAB);
  const [atalho, setAtalho] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ultima, setUltima] = useState<Ultima | null>(null);
  const [perguntas, setPerguntas] = useState<PerguntasPendentes | null>(null);
  const historico = useRef<MensagemDoPlanejar[]>([]);
  const campo = useRef<HTMLTextAreaElement>(null);
  const nos = useRef(nosNoQuadro);
  nos.current = nosNoQuadro;

  const enviar = async (texto0: string, atalhoUsado: string | null, modeloUsado: string, forcarCompleto = false, extra: { respostas?: string; pularPerguntas?: boolean } = {}) => {
    const msg = texto0.trim();
    if (!msg || enviando) return;
    const completo = forcarCompleto || ehProjetoCompleto(msg, atalhoUsado, nos.current);
    setEnviando(true);
    setUltima(null);
    try {
      await antesDePlanejar();
      const r = await planejar({ projetoId, mensagem: msg, historico: historico.current, modelo: modeloUsado, ...(completo ? { modo: "projeto_completo" as const } : {}), ...extra });
      if (r.perguntas.length && !r.operacoes.length) {
        // Faltou o essencial: nada montado; as perguntas aparecem e a caixa fica para as respostas.
        setPerguntas({ pedido: msg, lista: r.perguntas, modelo: modeloUsado });
        setPedido("");
        setAtalho(null);
        return;
      }
      setPerguntas(null);
      const montouCompleto = completo || r.modo === "projeto_completo";
      const feito = r.operacoes.length ? onConstruir(r.operacoes, montouCompleto, r.canvas_previsto) : { feitas: 0, falhas: [], novos: 0 };
      const resposta = r.resposta || (feito.feitas ? "Montei no quadro." : "Sem mudança no quadro.");
      historico.current = historico.current.concat({ papel: "usuario", texto: msg }, { papel: "agente", texto: resposta }).slice(-12);
      if (onConversa) onConversa(msg, resposta);
      setUltima({ resposta, feitas: feito.feitas, novos: feito.novos, falhas: feito.falhas.length, recusadas: r.recusadas, custo: r.custo_usd, completo: montouCompleto });
      setPedido("");
      setAtalho(null);
      if (feito.falhas.length) toast.warning(`${feito.feitas} de ${r.operacoes.length} operações entraram`, { description: feito.falhas.slice(0, 3).map((f) => `${f.recibo}: ${f.motivo}`).join(" ") });
    } catch (e) {
      toast.error("O Canvas Studio não montou", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  // Pedido de projeto completo que veio da Início: vai uma vez, assim que o canvas abre.
  useEffect(() => {
    const p = tirarPedidoPendente(projetoId);
    if (!p) return;
    setPedido(p.pedido);
    setModelo(p.modelo || MODELO_PADRAO_DO_LAB);
    void enviar(p.pedido, null, p.modelo || MODELO_PADRAO_DO_LAB, p.modo === "projeto_completo", { respostas: p.respostas, pularPerguntas: p.pularPerguntas });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projetoId]);

  const escolherAtalho = (a: AtalhoDoPedido) => {
    setPedido(a.pedido);
    setAtalho(a.id);
    if (campo.current) campo.current.focus();
  };

  return (
    <div className="mx-auto mb-2 w-full min-w-0 max-w-[880px]" data-canvas-studio="">
      <CaixaDoPedido
        ref={campo}
        compacta
        valor={pedido}
        onMudar={(v) => {
          setPedido(v);
          if (!v.trim()) setAtalho(null);
        }}
        onEnviar={() => void (perguntas ? enviar(perguntas.pedido, null, perguntas.modelo, true, { respostas: pedido }) : enviar(pedido, atalho, modelo))}
        enviando={enviando}
        modelo={modelo}
        onModelo={setModelo}
        clienteId={clienteId}
        onCliente={onCliente}
        clientes={clientes}
        atalhos={ATALHOS_DO_CANVAS}
        onAtalho={escolherAtalho}
        rotulo="Pedido para o Canvas Studio"
        placeholder={perguntas ? "Responda aqui (ou toque num exemplo) e mande…" : nosNoQuadro ? "Canvas Studio: peça um ajuste ou um projeto inteiro…" : "Canvas Studio: quero montar uma empresa, um produto low ticket, um funil de vendas…"}
        tituloDoEnviar="Montar no canvas (o agente pesquisa e liga os nós; nada é gerado ainda)"
        extra={
          onDesfazer ? (
            <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => { onDesfazer(); setUltima(null); }} aria-label="Desfazer a construção" title="Desfazer a construção (volta o quadro de antes)" data-desfazer-construcao="">
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null
        }
      />
      {perguntas && !enviando ? (
        <PerguntasGuiadas
          perguntas={perguntas.lista}
          onExemplo={(p, ex) => {
            setPedido((v) => preencherComExemplo(v, ROTULOS_DAS_PERGUNTAS[p.id] || p.pergunta.replace(/[?].*$/, ""), ex));
            if (campo.current) campo.current.focus();
          }}
          onPular={() => void enviar(perguntas.pedido, null, perguntas.modelo, true, { pularPerguntas: true })}
          onFechar={() => setPerguntas(null)}
        />
      ) : null}
      {enviando ? (
        <p className={juntar(texto.auxiliar, "mt-1 px-1")} role="status" data-studio-pensando="">
          O agente está pesquisando e montando o projeto no quadro…
        </p>
      ) : ultima ? (
        <div className="mt-1 flex min-w-0 items-start px-1" role="status" data-resposta-do-studio="">
          <p className={juntar(texto.auxiliar, "min-w-0 flex-1 line-clamp-2")} title={ultima.resposta}>
            <span className="font-medium text-foreground">{ultima.novos ? `${ultima.novos} nó(s) no quadro${ultima.completo ? " · projeto completo" : ""}. ` : ""}</span>
            {ultima.resposta}
            {ultima.recusadas.length ? ` · ${ultima.recusadas.length} proposta(s) recusada(s)` : ""}
            {typeof ultima.custo === "number" && ultima.custo > 0 ? ` · ${usd(ultima.custo)}` : ""}
          </p>
          <button type="button" className={juntar(botao.icone, "ml-1 h-6 w-6 shrink-0")} onClick={() => setUltima(null)} aria-label="Fechar a resposta" title="Fechar">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
