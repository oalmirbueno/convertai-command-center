import { useEffect, useRef, useState } from "react";
import { Loader2, PanelTopClose, PanelTopOpen, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { botao, juntar, superficie, texto } from "@/components/sistema";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { planejar, type MensagemDoPlanejar, type PerguntaGuiada } from "@/lib/laboratorio/api";
import { ATALHOS_DE_PROJETO_COMPLETO, MODELO_PADRAO_DO_LAB, ehProjetoCompleto, type CanvasDoLab, type OperacaoDoAgente } from "@/lib/laboratorio/nos";
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
 *
 * v4 (21/10/2026, pedido do dono: "o canvas fica muito pequenininho"):
 * - perguntas primeiro: quando a função pergunta, abre SÓ a etapa das
 *   perguntas, grande, no lugar do canvas (o editor esconde o quadro pelo
 *   `onEtapa`). Cada pergunta tem opções e campo próprios, mais a conversa
 *   livre; "Seguir" manda tudo em `respostas`, "Pular" manda
 *   `pular_perguntas`. Montado, o canvas volta inteiro, com a construção.
 *   Projeto completo pedido num quadro vazio mostra "pesquisando" no mesmo
 *   lugar enquanto a função trabalha (nada de canvas vazio esperando).
 * - recolhível: `recolhido` vira uma linha fina (o editor lembra a escolha).
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
  recolhido = false,
  onRecolher,
  onEtapa,
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
  /** Recolhido: só uma linha fina (status e o botão de abrir). */
  recolhido?: boolean;
  onRecolher?: (v: boolean) => void;
  /** A etapa grande (pesquisando ou perguntas) está no lugar do canvas. */
  onEtapa?: (aberta: boolean) => void;
}) {
  const [pedido, setPedido] = useState("");
  const [modelo, setModelo] = useState(MODELO_PADRAO_DO_LAB);
  const [atalho, setAtalho] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ultima, setUltima] = useState<Ultima | null>(null);
  const [perguntas, setPerguntas] = useState<PerguntasPendentes | null>(null);
  /** Projeto completo pedido num quadro vazio: a etapa "pesquisando" fica no lugar do canvas. */
  const [pesquisando, setPesquisando] = useState(false);
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
    // Atalho de projeto completo (ou pedido grande num quadro vazio): a etapa "pesquisando" toma o lugar do canvas.
    const deProjeto = !!atalhoUsado && ATALHOS_DE_PROJETO_COMPLETO.indexOf(atalhoUsado) >= 0;
    if (completo && (!nos.current || deProjeto) && !perguntas) setPesquisando(true);
    try {
      await antesDePlanejar();
      const r = await planejar({ projetoId, mensagem: msg, historico: historico.current, modelo: modeloUsado, ...(completo ? { modo: "projeto_completo" as const } : {}), ...extra });
      if (r.perguntas.length && !r.operacoes.length) {
        // Faltou o essencial: nada montado; abre a etapa das perguntas no lugar do canvas.
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
      setPesquisando(false);
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
    // 21/10 (dono: "quando ele escolhe [o projeto pronto], ele só abre essa parte aqui das perguntas"):
    // atalho de projeto completo já manda o planejar em projeto_completo e abre a etapa das perguntas.
    if (ATALHOS_DE_PROJETO_COMPLETO.indexOf(a.id) >= 0) {
      setAtalho(null);
      void enviar(a.pedido, a.id, modelo, true);
      return;
    }
    // Os outros atalhos só preenchem a caixa.
    setAtalho(a.id);
    if (campo.current) campo.current.focus();
  };

  // A etapa grande (pesquisando ou perguntas) toma o lugar do canvas: o editor esconde o quadro.
  const etapaAberta = pesquisando || !!perguntas;
  const avisarEtapa = useRef(onEtapa);
  avisarEtapa.current = onEtapa;
  useEffect(() => {
    if (avisarEtapa.current) avisarEtapa.current(etapaAberta);
  }, [etapaAberta]);
  useEffect(
    () => () => {
      if (avisarEtapa.current) avisarEtapa.current(false);
    },
    [],
  );

  const desfazer = onDesfazer ? (
    <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => { onDesfazer(); setUltima(null); }} aria-label="Desfazer a construção" title="Desfazer a construção (volta o quadro de antes)" data-desfazer-construcao="">
      <Undo2 className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : null;

  if (perguntas) {
    return (
      <div className="mb-2 w-full min-w-0" data-canvas-studio="">
        <PerguntasGuiadas
          perguntas={perguntas.lista}
          pedido={perguntas.pedido}
          ocupado={enviando}
          onSeguir={(respostas) => void enviar(perguntas.pedido, null, perguntas.modelo, true, { respostas })}
          onPular={() => void enviar(perguntas.pedido, null, perguntas.modelo, true, { pularPerguntas: true })}
          onFechar={() => {
            // Volta ao canvas com o pedido de antes na caixa (para mudar e mandar de novo).
            setPedido(perguntas.pedido);
            setPerguntas(null);
          }}
        />
      </div>
    );
  }

  if (pesquisando) {
    return (
      <div className="mb-2 w-full min-w-0" data-canvas-studio="">
        <section className={juntar(superficie.painel, "flex min-h-[70vh] min-w-0 flex-col items-center justify-center px-4 text-center")} role="status" data-studio-pesquisando="">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className={juntar(texto.tituloSecao, "mt-3")}>O agente está pesquisando</p>
          <p className={juntar(texto.auxiliar, "mt-1 max-w-[420px]")}>Ele confere o pedido e, se faltar o essencial, pergunta antes de montar.</p>
        </section>
      </div>
    );
  }

  const status = enviando ? (
    <p className={juntar(texto.auxiliar, recolhido ? "min-w-0 flex-1 truncate" : "mt-1 px-1")} role="status" data-studio-pensando="">
      O agente está pesquisando e montando o projeto no quadro…
    </p>
  ) : ultima ? (
    <div className={juntar("flex min-w-0 items-start", recolhido ? "flex-1" : "mt-1 px-1")} role="status" data-resposta-do-studio="">
      <p className={juntar(texto.auxiliar, "min-w-0 flex-1", recolhido ? "truncate" : "line-clamp-2")} title={ultima.resposta}>
        <span className="font-medium text-foreground">{ultima.novos ? `${ultima.novos} nó(s) no quadro${ultima.completo ? " · projeto completo" : ""}. ` : ""}</span>
        {ultima.resposta}
        {ultima.recusadas.length ? ` · ${ultima.recusadas.length} proposta(s) recusada(s)` : ""}
        {typeof ultima.custo === "number" && ultima.custo > 0 ? ` · ${usd(ultima.custo)}` : ""}
      </p>
      <button type="button" className={juntar(botao.icone, "ml-1 h-6 w-6 shrink-0")} onClick={() => setUltima(null)} aria-label="Fechar a resposta" title="Fechar">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  ) : null;

  if (recolhido) {
    // Recolhido: uma linha fina (abrir, o que está acontecendo e o Desfazer); o canvas ganha a altura.
    return (
      <div className="mx-auto mb-1 flex w-full min-w-0 max-w-[880px] items-center" data-canvas-studio="" data-studio-recolhido="">
        <button type="button" className={juntar(botao.icone, "mr-1 h-7 w-7")} onClick={() => onRecolher && onRecolher(false)} aria-label="Abrir o Canvas Studio" title="Abrir o Canvas Studio (a caixa de pedido)" aria-expanded={false} data-abrir-studio="">
          <PanelTopOpen className="h-4 w-4" aria-hidden="true" />
        </button>
        {status || <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>Canvas Studio</span>}
        {desfazer}
      </div>
    );
  }

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
        onEnviar={() => void enviar(pedido, atalho, modelo)}
        enviando={enviando}
        modelo={modelo}
        onModelo={setModelo}
        clienteId={clienteId}
        onCliente={onCliente}
        clientes={clientes}
        atalhos={ATALHOS_DO_CANVAS}
        onAtalho={escolherAtalho}
        rotulo="Pedido para o Canvas Studio"
        placeholder={nosNoQuadro ? "Canvas Studio: peça um ajuste ou um projeto inteiro…" : "Canvas Studio: quero montar uma empresa, um produto low ticket, um funil de vendas…"}
        tituloDoEnviar="Montar no canvas (o agente pesquisa e liga os nós; nada é gerado ainda)"
        extra={
          <>
            {desfazer}
            {onRecolher ? (
              <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => onRecolher(true)} aria-label="Recolher o Canvas Studio" title="Recolher o Canvas Studio (o canvas ganha a altura)" aria-expanded data-recolher-studio="">
                <PanelTopClose className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </>
        }
      />
      {status}
    </div>
  );
}
