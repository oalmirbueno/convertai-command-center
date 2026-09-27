import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Loader2, Send } from "lucide-react";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { chamarFuncao, padraoPara, usd } from "@/lib/mesa/api";
import { TAMANHO_DA_CONVERSA } from "../../../supabase/functions/_shared/roteiro-modelo";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { botao, campoTexto, juntar } from "@/components/sistema/estilos";
import { CHAVES } from "./roteirosApi";

/**
 * O agente da Mesa Roteiros, fixo ao lado das etapas (lateral da
 * AreaDeTrabalho; no celular, a gaveta do botão de baixo). Conversa sobre os
 * roteiros do cliente e, quando a equipe pede, propõe ações com o contrato
 * comum (apelidos, cartão Confirmar/Cancelar com o custo antes, item a item,
 * Desfazer): "refaça o gancho", "gere os roteiros das 4 peças de vídeo da
 * semana", "mude o tom", "arquive este roteiro". Nada acontece sem confirmar.
 *
 * Sempre montado: lê a última conversa do cliente ao montar (sem custo). O
 * rascunho do campo mora na página (useEstadoDaTela por cliente), para
 * "pedir ao agente" de qualquer etapa cair nele.
 */

export const ATALHOS_DO_AGENTE = [
  { rotulo: "Refaça o gancho", texto: "Refaça o gancho deste roteiro." },
  { rotulo: "Roteiros da semana", texto: "Gere os roteiros das peças de vídeo da semana." },
  { rotulo: "Mude o tom", texto: "Mude o tom deste roteiro para mais leve e próximo." },
  { rotulo: "Arquive este roteiro", texto: "Arquive este roteiro." },
];

const CAPACIDADES = ["gerar roteiros das peças da agenda", "refazer gancho", "mudar o tom", "trocar título, gancho, CTA ou legenda (na hora)", "aprovar e marcar gravado", "arquivar roteiro"];

export interface MensagemDoAgente {
  id: string | null;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: unknown[];
  custo_usd: number | null;
  /** Chegou agora nesta tela (não veio do histórico): o "faz e me leva" pode abrir sozinho. */
  nova?: boolean;
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
  roteiroId,
  onAbrirRoteiro,
  rascunho,
  onRascunho,
}: {
  roteiroId: string | null;
  onAbrirRoteiro?: (id: string) => void;
  rascunho: string;
  onRascunho: (v: string) => void;
}) {
  const { clientId, atualizarCusto, catalogo } = useMesa();
  const modelo = padraoPara(catalogo, "estrategista");
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [mensagens, setMensagens] = useState<MensagemDoAgente[]>([]);
  const [lida, setLida] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const lista = useRef<HTMLDivElement | null>(null);
  const texto = rascunho;

  // Lê a última conversa do cliente ao montar, sem custo.
  useEffect(() => {
    let vivo = true;
    chamarFuncao<any>("mesa-roteiros", { acao: "agente_historico", client_id: clientId })
      .then((d) => {
        if (!vivo) return;
        const h = normalizarHistorico(d);
        setConversaId(h.conversaId);
        setMensagens(h.mensagens);
        setLida(true);
      })
      .catch(() => {
        if (vivo) setLida(true);
      });
    return () => {
      vivo = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const enviar = async () => {
    const m = texto.trim();
    if (!m || enviando) return;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: m, anexos: [], custo_usd: null }]));
    onRascunho("");
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
      // Pedido claro sem custo (editar texto, aprovar, marcar gravado) já vem feito: a lista relê.
      if (d && acoesDaMensagem(Array.isArray(d.anexos) ? d.anexos : []).some((a) => !!a.executada_em)) {
        void queryClient.invalidateQueries({ queryKey: CHAVES.roteiros(clientId) });
        void queryClient.invalidateQueries({ queryKey: CHAVES.pecas(clientId) });
      }
      setMensagens((l) =>
        l.concat([
          {
            id: d && d.mensagem_id ? String(d.mensagem_id) : null,
            papel: "agente",
            conteudo: String((d && d.resposta) || ""),
            anexos: d && Array.isArray(d.anexos) ? d.anexos : [],
            custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null,
            nova: true,
          },
        ]),
      );
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "O agente não respondeu");
      onRascunho(m);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-agente-roteiros="">
      <PainelDoAgente
        titulo="Agente de roteiros"
        icone={<Clapperboard className="h-4 w-4" />}
        descricao={roteiroId ? "Conversa sobre o roteiro aberto" : "Conversa sobre os roteiros do cliente"}
        acoes={
          <>
            {mensagens.length > 0 && (
              <button
                type="button"
                className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}
                onClick={() => {
                  setMensagens([]);
                  setConversaId(null);
                  setNova(true);
                }}
              >
                Nova conversa
              </button>
            )}
            <AjudaRecolhida rotulo="Como o agente de roteiros funciona">
              Peça o que precisa. Quando for uma ação (gerar, refazer gancho, mudar tom, arquivar), o agente mostra a lista com o custo e você confirma. Desfazer volta a versão anterior; o gasto não volta.
            </AjudaRecolhida>
          </>
        }
        rotuloDasMensagens="Conversa com o agente de roteiros"
        refDasMensagens={lista}
        compositor={
          <>
            <OQuePossoFazer capacidades={CAPACIDADES} atalhos={ATALHOS_DO_AGENTE} onAtalho={(t) => onRascunho(t)} />
            <textarea
              value={texto}
              onChange={(e) => onRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder="Ex.: gere os roteiros das 4 peças de vídeo da semana"
              className={juntar(campoTexto, "min-h-[60px] resize-none")}
              aria-label="Mensagem ao agente"
            />
            <div className="flex min-w-0 items-center justify-between">
              <div className="mr-2 min-w-0 truncate">
                <EstimativaInline partes={modelo ? [{ modeloId: modelo.id, tipo: "texto", tokensEntrada: TAMANHO_DA_CONVERSA.entrada, tokensSaida: TAMANHO_DA_CONVERSA.saida }] : null} />
              </div>
              <div className="ml-auto flex min-w-0 items-center">
                <Ditado valor={texto} onChange={onRascunho} disabled={enviando} className="mr-1.5 min-w-0" />
                <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={enviando || !texto.trim()} aria-label="Enviar ao agente">
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        }
      >
        {!mensagens.length && !lida && (
          <div className="space-y-2" aria-label="Lendo a conversa">
            <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" />
            <div className="ml-6 h-8 animate-pulse rounded-lg bg-muted" />
          </div>
        )}
        {!mensagens.length && lida && <p className="text-[12.5px] leading-relaxed text-muted-foreground">Peça o que precisa. Quando for uma ação, eu mostro a lista com o custo e você confirma.</p>}
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
              {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.nova} />}
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2">
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
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
      </PainelDoAgente>
    </div>
  );
}
