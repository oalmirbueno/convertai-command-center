import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clapperboard, Loader2, Send } from "lucide-react";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { chamarFuncao, padraoPara, usd } from "@/lib/mesa/api";
import { TAMANHO_DA_CONVERSA } from "../../../supabase/functions/_shared/roteiro-modelo";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import CampoDoAgente, { focarNoFim } from "@/components/sistema/CampoDoAgente";
import { BotaoNovaConversa, useNovaConversa } from "@/components/sistema/NovaConversa";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { botao, conversa, juntar } from "@/components/sistema/estilos";
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
  { rotulo: "Resolva os comentários", texto: "Ajuste o roteiro pelos comentários abertos e marque como resolvidos." },
  { rotulo: "PDF dos aprovados", texto: "Gere o PDF de gravação dos roteiros aprovados." },
];

const CAPACIDADES = [
  "gerar roteiros das peças da agenda",
  "refazer gancho e mudar o tom",
  "trocar título, gancho, CTA ou legenda (na hora)",
  "resolver comentários",
  "aprovar, marcar gravado, arquivar e desarquivar",
  "gerar o PDF de gravação dos aprovados",
  "aprender o que você ensinar (\"nunca\", \"sempre\", \"não gostei\")",
];

/** Observação do cartão: custo quando usa IA, e o que não volta (frente AG2). */
export function observacaoDosRoteiros(a: { itens: Array<{ operacao: string }>; custo_estimado_usd?: number | null; sem_desfazer?: boolean }): string {
  const pdf = a.itens.some((i) => i.operacao === "gerar_pdf");
  const custo = typeof a.custo_estimado_usd === "number" && a.custo_estimado_usd > 0 ? `Custo estimado: ${usd(a.custo_estimado_usd)} da carteira.` : "Sem custo.";
  const volta = a.custo_estimado_usd ? "Desfazer volta a versão anterior; o gasto não volta." : "Dá para desfazer.";
  if (pdf) return `${custo} O PDF vai para Arquivos com a revisão da agência pedida e não volta pelo Desfazer.${a.sem_desfazer ? "" : ` ${volta}`}`;
  return `${custo} ${volta}`;
}

/** O roteiro de um resultado (o comentário leva "roteiro:comentário"; o PDF não abre um roteiro só). */
export function roteiroDoResultado(r: { operacao: string; alvo_id: string } | null | undefined): string | null {
  if (!r || r.operacao === "arquivar_roteiro" || r.operacao === "gerar_roteiro" || r.operacao === "gerar_pdf") return null;
  const id = String(r.alvo_id || "");
  const i = id.indexOf(":");
  return i > 0 ? id.slice(0, i) : id || null;
}

export interface MensagemDoAgente {
  id: string | null;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: unknown[];
  custo_usd: number | null;
  /** Chegou agora nesta tela (não veio do histórico): o "faz e me leva" pode abrir sozinho. */
  nova?: boolean;
  /** Aviso da resposta que não ficou guardada (aviso_registro): o cartão não pode ser confirmado. */
  aviso?: string | null;
  /** Marca da mensagem otimista do usuário (sai da lista quando o envio falha). */
  local?: string;
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
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const texto = rascunho;
  const novaConversa = useNovaConversa<MensagemDoAgente>({
    chave: clientId,
    enviando,
    mensagens,
    conversaId,
    limpar: () => {
      setMensagens([]);
      setConversaId(null);
      setNova(true);
    },
    restaurar: (c) => {
      setMensagens(c.mensagens);
      setConversaId(c.conversaId);
      setNova(false);
    },
  });

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
      .catch((e) => {
        if (!vivo) return;
        setLida(true);
        avisarErro(e, "A conversa anterior não foi lida");
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
    // Frente AG2: a bolha otimista leva uma marca; se o envio falhar, ela sai e o texto volta ao campo (reenviar não duplica).
    const local = `local-${Date.now()}`;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: m, anexos: [], custo_usd: null, local }]));
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
            aviso: d && typeof d.aviso_registro === "string" && d.aviso_registro ? d.aviso_registro : null,
          },
        ]),
      );
      atualizarCusto();
    } catch (e) {
      setMensagens((l) => l.filter((x) => x.local !== local));
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
            {mensagens.length > 0 && <BotaoNovaConversa onClick={novaConversa} desativado={enviando} />}
            <AjudaRecolhida rotulo="Como o agente de roteiros funciona">
              Peça o que precisa. Trocar texto, aprovar, arquivar e resolver comentário ele faz na hora, com Desfazer. Gerar, refazer gancho e mudar o tom usam IA e vêm num cartão com o custo; o PDF vai para Arquivos e também pede Confirmar. O que você ensinar ("nunca", "não gostei") vira regra; dá para esquecer.
            </AjudaRecolhida>
          </>
        }
        rotuloDasMensagens="Conversa com o agente de roteiros"
        refDasMensagens={lista}
        compositor={
          <>
            <OQuePossoFazer
              capacidades={CAPACIDADES}
              atalhos={ATALHOS_DO_AGENTE}
              onAtalho={(t) => {
                onRascunho(t);
                focarNoFim(campo, t);
              }}
            />
            <CampoDoAgente
              ref={campo}
              valor={texto}
              aoMudar={onRascunho}
              aoEnviar={() => void enviar()}
              maxLength={4000}
              placeholder="Ex.: gere os roteiros das 4 peças de vídeo da semana"
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
        {!mensagens.length && lida && <p className={juntar(conversa.apoio, "leading-relaxed")}>Peça o que precisa. Quando for uma ação, eu mostro a lista com o custo e você confirma.</p>}
        {mensagens.map((m, i) => {
          const acoes = acoesDaMensagem(m.anexos);
          return (
            <div key={m.id || m.local || `m-${i}`} className="min-w-0">
              <div
                className={juntar(
                  conversa.balao,
                  m.papel === "usuario" ? conversa.doUsuario : m.papel === "sistema" ? "bg-muted text-muted-foreground" : conversa.doAgente,
                )}
              >
                <TextoDoAgente texto={m.conteudo} clientId={clientId} />
                {m.custo_usd !== null && <p className="mt-1 text-[12px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
              </div>
              {m.papel === "agente" && m.aviso && (
                <p className="mr-6 mt-1 flex min-w-0 items-start text-[12px] text-warning" role="alert" data-aviso-registro="">
                  <AlertTriangle className="mr-1.5 mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{m.aviso}</span>
                </p>
              )}
              {m.papel === "agente" && (
                <AprendizadoDoAgente
                  anexos={m.anexos}
                  onEsquecer={(id) => chamarFuncao("mesa-roteiros", { acao: "aprendizado_esquecer", client_id: clientId, id, mensagem_id: m.id || undefined })}
                  onGuardar={(texto, tipo) => chamarFuncao("mesa-roteiros", { acao: "aprendizado_guardar", client_id: clientId, texto, tipo, mensagem_id: m.id || undefined })}
                />
              )}
              {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.nova} />}
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2">
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
                      titulo="O agente vai fazer nos roteiros"
                      observacao={observacaoDosRoteiros(a)}
                      onPedido={(p) => chamarAcaoDoAgente("mesa-roteiros", String(m.id), a.id, p)}
                      onFeito={(p, resposta) => {
                        if (p === "descartar") return;
                        void queryClient.invalidateQueries({ queryKey: CHAVES.roteiros(clientId) });
                        void queryClient.invalidateQueries({ queryKey: CHAVES.pecas(clientId) });
                        atualizarCusto();
                        const r = resposta && (resposta as any).anexo;
                        const unico = r && Array.isArray(r.resultados) && r.resultados.length === 1 && r.resultados[0].ok ? r.resultados[0] : null;
                        const abrir = roteiroDoResultado(unico);
                        if (abrir && onAbrirRoteiro) onAbrirRoteiro(abrir);
                      }}
                    />
                  </div>
                ))}
            </div>
          );
        })}
        {enviando && (
          <p className={juntar(conversa.apoio, "flex items-center")}>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Pensando nos roteiros...
          </p>
        )}
      </PainelDoAgente>
    </div>
  );
}
