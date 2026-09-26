import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd } from "@/lib/mesa/api";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { useMesaPublicidade } from "./Comuns";
import { chaveDaCampanha, conversarComOAgente, lerHistorico, normalizarCampanha, type MensagemDoAgente } from "./publicidadeApi";

/**
 * O agente da Mesa Publicidade, à mão em todas as etapas. Conversa sobre a
 * campanha aberta e propõe ações com o contrato comum (apelidos, cartão
 * Confirmar/Cancelar, item a item, Desfazer quando há reverso):
 * "proponha 3 territórios", "peça as 6 tomadas", "reprove as fotos que
 * mudaram o produto", "mande as aprovadas para a Mesa Ads". Nada é feito sem
 * a confirmação da equipe.
 */

export const ATALHOS_DO_AGENTE = [
  { rotulo: "Proponha 3 territórios", texto: "Proponha 3 territórios para esta campanha." },
  { rotulo: "Peça as 6 tomadas", texto: "Peça as 6 tomadas à Mesa Foto com o território aprovado." },
  { rotulo: "Reprove as que mudaram o produto", texto: "Reprove as fotos que mudaram o produto." },
  { rotulo: "Mande as aprovadas para a Mesa Ads", texto: "Mande as aprovadas para a Mesa Ads." },
];

const CAPACIDADES = ["propor territórios", "pedir as tomadas", "reprovar fotos que mudaram o produto", "mandar aprovadas para a Mesa e a Mesa Ads"];

export default function AgenteDaPublicidade({ aberto, onAberto, pedido }: { aberto: boolean; onAberto: (v: boolean) => void; pedido: { mensagem: string; em: number } | null }) {
  const { clientId, atualizarCusto } = useMesa();
  const { campanha, aplicar } = useMesaPublicidade();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [mensagens, setMensagens] = useState<MensagemDoAgente[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const campanhaId = campanha ? campanha.id : null;
  const lista = useRef<HTMLDivElement | null>(null);

  // Abre na conversa da campanha (a última), sem custo.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    lerHistorico(clientId, campanhaId)
      .then((h) => {
        if (!vivo) return;
        setConversaId(h.conversaId);
        setMensagens(h.mensagens.filter((m) => m.papel !== "sistema" || !!m.conteudo));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [aberto, clientId, campanhaId]);

  useEffect(() => {
    if (pedido && pedido.mensagem) setTexto(pedido.mensagem);
  }, [pedido]);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length]);

  const enviar = async () => {
    const m = texto.trim();
    if (!m || enviando) return;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: m, anexos: [], custo_usd: null }]));
    setTexto("");
    try {
      const r = await conversarComOAgente({ clientId, campanha, mensagem: m, conversaId, nova });
      setNova(false);
      setConversaId(r.conversaId);
      setMensagens((l) => l.concat([r.mensagem]));
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "O agente não respondeu");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {!aberto && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[72px] z-40 flex justify-center px-4 md:bottom-6" data-agente-publicidade="">
          <button
            type="button"
            onClick={() => onAberto(true)}
            className="pointer-events-auto inline-flex h-12 max-w-full items-center rounded-full bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground shadow-xl ring-4 ring-background transition-transform hover:scale-[1.02]"
            aria-label="Abrir o agente da Mesa Publicidade"
          >
            <Megaphone className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">Agente da campanha</span>
          </button>
        </div>
      )}
      <Dialog open={aberto} onOpenChange={onAberto}>
        <DialogContent className="flex h-[92vh] w-[calc(100vw-16px)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:h-[86vh] sm:w-[calc(100vw-48px)]">
          <DialogTitle className="sr-only">Agente da Mesa Publicidade</DialogTitle>
          <DialogDescription className="sr-only">Converse com o agente sobre a campanha e confirme as ações que ele propõe.</DialogDescription>
          <div className="flex min-w-0 items-center border-b border-border px-4 py-3 pr-12">
            <Megaphone className="mr-2 h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">Agente da campanha{campanha && campanha.nome ? `: ${campanha.nome}` : ""}</p>
            {mensagens.length > 0 && (
              <button
                type="button"
                className="shrink-0 text-[11.5px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMensagens([]);
                  setConversaId(null);
                  setNova(true);
                }}
              >
                Nova conversa
              </button>
            )}
          </div>
          <div ref={lista} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-mensagens-do-agente="">
            {!mensagens.length && (
              <p className="text-[12.5px] text-muted-foreground">
                {campanha ? "Peça o que precisa. Quando for uma ação, eu mostro a lista e você confirma." : "Abra uma campanha para eu agir nela. Posso orientar a escolha do produto."}
              </p>
            )}
            {mensagens.map((m, i) => {
              const acoes = acoesDaMensagem(m.anexos);
              return (
                <div key={m.id || `m-${i}`} className={m.papel === "usuario" ? "ml-8 flex justify-end" : "mr-2"}>
                  <div className={`max-w-full rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] ${m.papel === "usuario" ? "bg-primary/10" : m.papel === "sistema" ? "bg-muted text-muted-foreground" : "bg-card"}`}>
                    <p className="whitespace-pre-wrap">{m.conteudo}</p>
                    {m.custo_usd !== null && <p className="mt-1 text-[10.5px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
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
          </div>
          <div className="border-t border-border px-4 py-3">
            <OQuePossoFazer capacidades={CAPACIDADES} atalhos={campanha && campanha.id ? ATALHOS_DO_AGENTE : []} onAtalho={(t) => setTexto(t)} className="mb-2" />
            <div className="flex items-end">
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder="Ex.: proponha 3 territórios"
                className="mr-2 min-w-0 flex-1 text-[12.5px]"
                aria-label="Mensagem ao agente"
              />
              <Button type="button" size="sm" className="h-10" onClick={() => void enviar()} disabled={enviando || !texto.trim()} aria-label="Enviar ao agente">
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
