import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Send } from "lucide-react";
import { useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd } from "@/lib/mesa/api";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { botao, campoTexto, juntar } from "@/components/sistema/estilos";
import { useMesaPublicidade } from "./Comuns";
import { chaveDaCampanha, conversarComOAgente, lerHistorico, normalizarCampanha, type MensagemDoAgente } from "./publicidadeApi";

/**
 * O agente da Mesa Publicidade, fixo ao lado das etapas (lateral da
 * AreaDeTrabalho; no celular, a gaveta do botão de baixo). Conversa sobre a
 * campanha aberta e propõe ações com o contrato comum (apelidos, cartão
 * Confirmar/Cancelar, item a item, Desfazer quando há reverso):
 * "proponha 3 territórios", "peça as 6 tomadas", "reprove as fotos que
 * mudaram o produto", "mande as aprovadas para a Mesa Ads". Nada é feito sem
 * a confirmação da equipe.
 *
 * Sempre montado: lê o histórico da campanha ao montar (sem custo) e, ao
 * trocar de campanha, mantém a conversa anterior na tela até a nova chegar
 * (nada pisca). O rascunho do campo mora na página (useEstadoDaTela por
 * cliente), para "pedir ao agente" das etapas cair nele.
 */

export const ATALHOS_DO_AGENTE = [
  { rotulo: "Proponha 3 territórios", texto: "Proponha 3 territórios para esta campanha." },
  { rotulo: "Peça as 6 tomadas", texto: "Peça as 6 tomadas à Mesa Foto com o território aprovado." },
  { rotulo: "Reprove as que mudaram o produto", texto: "Reprove as fotos que mudaram o produto." },
  { rotulo: "Mande as aprovadas para a Mesa Ads", texto: "Mande as aprovadas para a Mesa Ads." },
];

const CAPACIDADES = ["mudar o briefing e o nome (na hora, com Desfazer)", "propor e aprovar territórios", "pedir as tomadas", "reprovar fotos que mudaram o produto", "mandar aprovadas para a Mesa e a Mesa Ads"];

interface Conversa {
  /** De qual campanha é a conversa na tela. */
  chave: string;
  conversaId: string | null;
  mensagens: MensagemDoAgente[];
  lida: boolean;
}

export default function AgenteDaPublicidade({ rascunho, onRascunho }: { rascunho: string; onRascunho: (v: string) => void }) {
  const { clientId, atualizarCusto } = useMesa();
  const { campanha, aplicar } = useMesaPublicidade();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const campanhaId = campanha ? campanha.id : null;
  const chave = `${clientId}:${campanhaId || ""}`;
  const [conversa, setConversa] = useState<Conversa>({ chave, conversaId: null, mensagens: [], lida: false });
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const lista = useRef<HTMLDivElement | null>(null);

  // Lê a conversa da campanha (a última) ao montar e ao trocar de campanha, sem custo.
  // A anterior fica na tela até a nova chegar: nada pisca.
  useEffect(() => {
    let vivo = true;
    lerHistorico(clientId, campanhaId)
      .then((h) => {
        if (!vivo) return;
        setConversa({ chave, conversaId: h.conversaId, mensagens: h.mensagens.filter((m) => m.papel !== "sistema" || !!m.conteudo), lida: true });
        setNova(false);
      })
      .catch(() => {
        if (vivo) setConversa((c) => (c.chave === chave ? { ...c, lida: true } : c));
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, campanhaId]);

  const mensagens = conversa.mensagens;
  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const enviar = async () => {
    const m = rascunho.trim();
    if (!m || enviando) return;
    const alvo = chave;
    setEnviando(true);
    setConversa((c) => ({ ...c, mensagens: c.mensagens.concat([{ id: null, papel: "usuario", conteudo: m, anexos: [], custo_usd: null }]) }));
    onRascunho("");
    try {
      const r = await conversarComOAgente({ clientId, campanha, mensagem: m, conversaId: conversa.chave === alvo ? conversa.conversaId : null, nova });
      setNova(false);
      // Trocou de campanha no meio: a resposta fica na conversa dela (lida de novo ao voltar).
      setConversa((c) => (c.chave === alvo ? { ...c, conversaId: r.conversaId, mensagens: c.mensagens.concat([r.mensagem]) } : c));
      // Pedido claro sem custo (briefing, nome) já vem feito: a campanha na tela relê.
      if (campanhaId && acoesDaMensagem(r.mensagem.anexos).some((a) => !!a.executada_em)) {
        void queryClient.invalidateQueries({ queryKey: chaveDaCampanha(campanhaId) });
      }
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "O agente não respondeu");
      onRascunho(m);
    } finally {
      setEnviando(false);
    }
  };

  const comAcao = !!(campanha && campanha.id);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-agente-publicidade="">
      <PainelDoAgente
        titulo="Agente da campanha"
        icone={<Megaphone className="h-4 w-4" />}
        descricao={campanha ? campanha.nome || campanha.kit_nome || "Campanha sem nome" : "Nenhuma campanha aberta"}
        acoes={
          <>
            {mensagens.length > 0 && (
              <button
                type="button"
                className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}
                onClick={() => {
                  setConversa((c) => ({ ...c, conversaId: null, mensagens: [] }));
                  setNova(true);
                }}
              >
                Nova conversa
              </button>
            )}
            <AjudaRecolhida rotulo="Como o agente da campanha funciona">
              Converse sobre a campanha aberta. Quando o pedido for uma ação (propor territórios, pedir tomadas, reprovar, mandar para as mesas), o agente mostra a lista e você confirma. Propor e pedir gastam IA da carteira.
            </AjudaRecolhida>
          </>
        }
        rotuloDasMensagens="Conversa com o agente da campanha"
        refDasMensagens={lista}
        compositor={
          <>
            <OQuePossoFazer capacidades={CAPACIDADES} atalhos={comAcao ? ATALHOS_DO_AGENTE : []} onAtalho={(t) => onRascunho(t)} />
            <textarea
              value={rascunho}
              onChange={(e) => onRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder="Ex.: proponha 3 territórios"
              className={juntar(campoTexto, "min-h-[60px] resize-none")}
              aria-label="Mensagem ao agente"
            />
            <div className="flex min-w-0 items-center justify-between">
              <p className="mr-2 hidden min-w-0 truncate text-[11px] text-muted-foreground sm:block">Enter envia; Shift+Enter quebra a linha</p>
              <div className="ml-auto flex min-w-0 items-center">
                <Ditado valor={rascunho} onChange={onRascunho} disabled={enviando} className="mr-1.5 min-w-0" />
                <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={enviando || !rascunho.trim()} aria-label="Enviar ao agente">
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        }
      >
        {!mensagens.length && !conversa.lida && (
          <div className="space-y-2" aria-label="Lendo a conversa">
            <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" />
            <div className="ml-6 h-8 animate-pulse rounded-lg bg-muted" />
          </div>
        )}
        {!mensagens.length && conversa.lida && (
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {campanha ? "Peça o que precisa. Quando for uma ação, eu mostro a lista e você confirma." : "Abra uma campanha para eu agir nela. Posso orientar a escolha do produto."}
          </p>
        )}
        {mensagens.map((m, i) => {
          const acoes = acoesDaMensagem(m.anexos);
          return (
            <div key={m.id || `m-${i}`} className="min-w-0">
              <div
                className={juntar(
                  "rounded-lg px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]",
                  m.papel === "usuario" ? "ml-6 bg-primary/10" : m.papel === "sistema" ? "bg-muted text-muted-foreground" : "mr-6 bg-secondary/60",
                )}
              >
                <TextoDoAgente texto={m.conteudo} clientId={clientId} />
                {m.custo_usd !== null && <p className="mt-1 text-[11px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
              </div>
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2">
                    <CartaoDeAcao
                      acao={a}
                      titulo="O agente vai fazer na campanha"
                      observacao={a.sem_desfazer ? "Propor e pedir gastam IA da carteira. Reprovar não tem volta." : "Nada muda até confirmar. Envio dá para desfazer."}
                      onPedido={(p) => chamarAcaoDoAgente("mesa-publicidade", String(m.id), a.id, p)}
                      onFeito={(p, resposta) => {
                        if (p === "descartar") return;
                        const nova = resposta && (resposta as any).campanha ? normalizarCampanha((resposta as any).campanha, clientId) : null;
                        if (nova && nova.id) aplicar(nova);
                        else if (campanhaId) void queryClient.invalidateQueries({ queryKey: chaveDaCampanha(campanhaId) });
                        void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "ensaios", clientId] });
                        atualizarCusto();
                      }}
                    />
                  </div>
                ))}
            </div>
          );
        })}
        {enviando && (
          <p className="flex items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Pensando na campanha...
          </p>
        )}
      </PainelDoAgente>
    </div>
  );
}
