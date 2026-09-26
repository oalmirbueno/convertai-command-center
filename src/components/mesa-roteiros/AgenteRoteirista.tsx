import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { chamarFuncao, padraoPara, usd } from "@/lib/mesa/api";
import { TAMANHO_DA_CONVERSA } from "../../../supabase/functions/_shared/roteiro-modelo";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { CHAVES } from "./roteirosApi";

/**
 * O agente da Mesa Roteiros, à mão em todas as etapas. Conversa sobre os
 * roteiros do cliente e, quando a equipe pede, propõe ações com o contrato
 * comum (apelidos, cartão Confirmar/Cancelar com o custo antes, item a item,
 * Desfazer): "refaça o gancho", "gere os roteiros das 4 peças de vídeo da
 * semana", "mude o tom", "arquive este roteiro". Nada acontece sem confirmar.
 */

export const ATALHOS_DO_AGENTE = [
  { rotulo: "Refaça o gancho", texto: "Refaça o gancho deste roteiro." },
  { rotulo: "Roteiros da semana", texto: "Gere os roteiros das peças de vídeo da semana." },
  { rotulo: "Mude o tom", texto: "Mude o tom deste roteiro para mais leve e próximo." },
  { rotulo: "Arquive este roteiro", texto: "Arquive este roteiro." },
];

const CAPACIDADES = ["gerar roteiros das peças da agenda", "refazer gancho", "mudar o tom", "arquivar roteiro"];

export interface MensagemDoAgente {
  id: string | null;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: unknown[];
  custo_usd: number | null;
}

export function normalizarHistorico(data: any): { conversaId: string | null; mensagens: MensagemDoAgente[] } {
  const lista = data && Array.isArray(data.mensagens) ? data.mensagens : [];
  return {
    conversaId: data && typeof data.conversa_id === "string" ? data.conversa_id : null,
    mensagens: lista
      .filter((m: any) => m && (m.papel === "usuario" || m.papel === "agente" || m.papel === "sistema"))
      .map((m: any) => ({ id: m.id ? String(m.id) : null, papel: m.papel, conteudo: String(m.conteudo || ""), anexos: Array.isArray(m.anexos) ? m.anexos : [], custo_usd: null })),
  };
}

export default function AgenteRoteirista({
  aberto,
  onAberto,
  roteiroId,
  onAbrirRoteiro,
}: {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  roteiroId: string | null;
  onAbrirRoteiro?: (id: string) => void;
}) {
  const { clientId, atualizarCusto, catalogo } = useMesa();
  const modelo = padraoPara(catalogo, "estrategista");
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [mensagens, setMensagens] = useState<MensagemDoAgente[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const lista = useRef<HTMLDivElement | null>(null);

  // Abre na última conversa do cliente, sem custo.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    chamarFuncao<any>("mesa-roteiros", { acao: "agente_historico", client_id: clientId })
      .then((d) => {
        if (!vivo) return;
        const h = normalizarHistorico(d);
        setConversaId(h.conversaId);
        setMensagens(h.mensagens);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [aberto, clientId]);

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
      const d = await chamarFuncao<any>("mesa-roteiros", {
        acao: "agente_conversar",
        client_id: clientId,
        mensagem: m,
        conversa_id: conversaId || undefined,
        roteiro_id: roteiroId || undefined,
        nova_conversa: nova || undefined,
      });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      setMensagens((l) =>
        l.concat([
          {
            id: d && d.mensagem_id ? String(d.mensagem_id) : null,
            papel: "agente",
            conteudo: String((d && d.resposta) || ""),
            anexos: d && Array.isArray(d.anexos) ? d.anexos : [],
            custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null,
          },
        ]),
      );
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
        <div className="pointer-events-none fixed inset-x-0 bottom-[72px] z-40 flex justify-center px-4 md:bottom-6" data-agente-roteiros="">
          <button
            type="button"
            onClick={() => onAberto(true)}
            className="pointer-events-auto inline-flex h-12 max-w-full items-center rounded-full bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground shadow-xl ring-4 ring-background transition-transform hover:scale-[1.02]"
            aria-label="Abrir o agente da Mesa Roteiros"
          >
            <Clapperboard className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">Agente de roteiros</span>
          </button>
        </div>
      )}
      <Dialog open={aberto} onOpenChange={onAberto}>
        <DialogContent className="flex h-[92vh] w-[calc(100vw-16px)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:h-[86vh] sm:w-[calc(100vw-48px)]">
          <DialogTitle className="sr-only">Agente da Mesa Roteiros</DialogTitle>
          <DialogDescription className="sr-only">Converse com o agente sobre os roteiros e confirme as ações que ele propõe.</DialogDescription>
          <div className="flex min-w-0 items-center border-b border-border px-4 py-3 pr-12">
            <Clapperboard className="mr-2 h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">Agente de roteiros</p>
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
                Peça o que precisa. Quando for uma ação (gerar, refazer gancho, mudar tom, arquivar), eu mostro a lista com o custo e você confirma.
              </p>
            )}
            {mensagens.map((m, i) => {
              const acoes = acoesDaMensagem(m.anexos);
              return (
                <div key={m.id || `m-${i}`} className={m.papel === "usuario" ? "ml-8 flex justify-end" : "mr-2"}>
                  <div
                    className={`max-w-full rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] ${
                      m.papel === "usuario" ? "bg-primary/10" : m.papel === "sistema" ? "bg-muted text-muted-foreground" : "bg-card"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.conteudo}</p>
                    {m.custo_usd !== null && <p className="mt-1 text-[10.5px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
                  </div>
                  {m.id &&
                    acoes.map((a) => (
                      <div key={a.id} className="mt-2">
                        <CartaoDeAcao
                          acao={a}
                          titulo="O agente vai fazer nos roteiros"
                          observacao={
                            a.custo_estimado_usd
                              ? `Custo estimado: ${usd(a.custo_estimado_usd)} da carteira. Desfazer volta a versão anterior; o gasto não volta.`
                              : "Sem custo. Dá para desfazer."
                          }
                          onPedido={(p) => chamarAcaoDoAgente("mesa-roteiros", String(m.id), a.id, p)}
                          onFeito={(p, resposta) => {
                            if (p === "descartar") return;
                            void queryClient.invalidateQueries({ queryKey: CHAVES.roteiros(clientId) });
                            void queryClient.invalidateQueries({ queryKey: CHAVES.pecas(clientId) });
                            atualizarCusto();
                            const r = resposta && (resposta as any).anexo;
                            const unico = r && Array.isArray(r.resultados) && r.resultados.length === 1 && r.resultados[0].ok ? r.resultados[0] : null;
                            if (unico && unico.operacao !== "arquivar_roteiro" && unico.operacao !== "gerar_roteiro" && onAbrirRoteiro) onAbrirRoteiro(unico.alvo_id);
                          }}
                        />
                      </div>
                    ))}
                </div>
              );
            })}
            {enviando && (
              <p className="flex items-center text-[12px] text-muted-foreground">
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Pensando nos roteiros...
              </p>
            )}
          </div>
          <div className="border-t border-border px-4 py-3">
            <OQuePossoFazer capacidades={CAPACIDADES} atalhos={ATALHOS_DO_AGENTE} onAtalho={(t) => setTexto(t)} className="mb-2" />
            <p className="mb-1 text-right">
              <EstimativaInline partes={modelo ? [{ modeloId: modelo.id, tipo: "texto", tokensEntrada: TAMANHO_DA_CONVERSA.entrada, tokensSaida: TAMANHO_DA_CONVERSA.saida }] : null} />
            </p>
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
                placeholder="Ex.: gere os roteiros das 4 peças de vídeo da semana"
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
