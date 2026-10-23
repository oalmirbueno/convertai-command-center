import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RotateCcw, Send } from "lucide-react";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDoModeloDoEscopo, useModeloDoEscopo } from "@/components/mesa/ModeloDaCopyDoConteudo";
import { chamarFuncao, usd } from "@/lib/mesa/api";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import CampoDoAgente, { focarNoFim } from "@/components/sistema/CampoDoAgente";
import { botao, conversa, juntar, rolagem, texto } from "@/components/sistema/estilos";
import { normalizarHistorico, observacaoDosRoteiros, type MensagemDoAgente } from "./AgenteRoteirista";
import { CHAVES, estimarDaPeca } from "./roteirosApi";

/**
 * O agente de roteiro ao lado do roteiro da peça de vídeo (frente B, 23/10/2026; dono: "o agente de roteiro
 * para eu editar, melhorar o roteiro, dar ideias; ele é agêntico, eu posso escolher o modelo, ele faz as
 * coisas de fato e altera conforme eu peço").
 *
 * Conversa só sobre ESTE roteiro (mesa-roteiros, agente_conversar com escopo "peca": conversa própria do
 * roteiro). Pedido de mudança ("encurta o gancho", "troca a cena 2", "mais engraçado", "versão de 15 s")
 * volta como cartão com o custo; Confirmar grava a versão nova do roteiro (reescrever_roteiro) e Desfazer
 * volta a anterior. Trocar só título, CTA ou legenda vai na hora, com Desfazer. Ideias são resposta.
 * O seletor é o do escopo "roteiro" (lembrado por cliente, mesa_cliente_config.modelo_roteiro_id); a
 * conversa e o Confirmar usam o modelo escolhido.
 *
 * Interface (reaproveitável; o Gravar da peça da campanha liga assim):
 *   <AgenteDoRoteiroDaPeca roteiroId={linha.id} titulo={linha.titulo} aoMudarRoteiro={() => ...} />
 * Precisa do MesaProvider (cliente, catálogo e custo) e do QueryClientProvider. Ao mudar o roteiro, relê a
 * lista de roteiros do cliente (CHAVES.roteiros), e quem mostra o roteiro já vê a versão nova.
 */

export const ATALHOS_DA_PECA = [
  { rotulo: "Encurta o gancho", texto: "Encurta o gancho deste roteiro." },
  { rotulo: "Troca a cena 2", texto: "Troca a cena 2 por " },
  { rotulo: "Versão de 15 s", texto: "Faz uma versão de 15 s deste roteiro." },
  { rotulo: "Me dá ideias", texto: "Me dá 3 ideias para melhorar este roteiro." },
];

const CAPACIDADES_DA_PECA = [
  "reescrever o roteiro pelo seu pedido (gancho, cena, tom, duração)",
  "trocar título, CTA ou legenda na hora",
  "dar ideias para este roteiro",
  "aprender o que você ensinar",
];

export default function AgenteDoRoteiroDaPeca({ roteiroId, titulo, aoMudarRoteiro }: { roteiroId: string; titulo?: string; aoMudarRoteiro?: () => void }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const modelo = useModeloDoEscopo("roteiro");
  const [mensagens, setMensagens] = useState<MensagemDoAgente[]>([]);
  const [lida, setLida] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const lista = useRef<HTMLDivElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  // Custo de uma conversa com o modelo escolhido, antes de enviar (ação estimar, sem IA).
  const estimativa = useQuery({
    queryKey: ["mesa-roteiros", "estimar", "conversa", clientId, modelo.modeloId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => estimarDaPeca(clientId, "conversa", modelo.modeloId || null),
  });

  // A conversa deste roteiro, sem custo, ao abrir.
  useEffect(() => {
    let vivo = true;
    setLida(false);
    chamarFuncao<unknown>("mesa-roteiros", { acao: "agente_historico", client_id: clientId, escopo: "peca", roteiro_id: roteiroId })
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
        avisarErro(e, "A conversa deste roteiro não foi lida");
      });
    return () => {
      vivo = false;
    };
  }, [clientId, roteiroId]);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const roteiroMudou = () => {
    void queryClient.invalidateQueries({ queryKey: CHAVES.roteiros(clientId) });
    atualizarCusto();
    aoMudarRoteiro?.();
  };

  const enviar = async () => {
    const m = rascunho.trim();
    if (!m || enviando) return;
    const local = `local-${Date.now()}`;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: m, anexos: [], custo_usd: null, local }]));
    setRascunho("");
    try {
      const d = await chamarFuncao<any>("mesa-roteiros", {
        acao: "agente_conversar",
        escopo: "peca",
        client_id: clientId,
        roteiro_id: roteiroId,
        mensagem: m,
        conversa_id: conversaId || undefined,
        nova_conversa: nova || undefined,
        ...(modelo.modeloId ? { modelo_id: modelo.modeloId } : {}),
      });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      const anexos = d && Array.isArray(d.anexos) ? d.anexos : [];
      // Troca de texto sem custo já vem feita: o roteiro relê.
      if (acoesDaMensagem(anexos).some((a) => !!a.executada_em)) roteiroMudou();
      setMensagens((l) =>
        l.concat([
          {
            id: d && d.mensagem_id ? String(d.mensagem_id) : null,
            papel: "agente",
            conteudo: String((d && d.resposta) || ""),
            anexos,
            custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null,
            nova: true,
            aviso: d && typeof d.aviso_registro === "string" && d.aviso_registro ? d.aviso_registro : null,
          },
        ]),
      );
      atualizarCusto();
    } catch (e) {
      setMensagens((l) => l.filter((x) => x.local !== local));
      setRascunho(m);
      avisarErro(e, "O agente de roteiro não respondeu");
    } finally {
      setEnviando(false);
    }
  };

  const novaConversa = () => {
    setMensagens([]);
    setConversaId(null);
    setNova(true);
  };

  const custo = estimativa.data && typeof estimativa.data.estimativa_usd === "number" ? estimativa.data.estimativa_usd : null;

  return (
    <section className="min-w-0" aria-label={`Agente de roteiro${titulo ? ` de ${titulo}` : ""}`} data-agente-do-roteiro-da-peca={roteiroId}>
      <div className="flex min-w-0 items-center">
        <h4 className={juntar(texto.rotulo, "mr-auto truncate")}>Agente de roteiro</h4>
        {mensagens.length > 0 && (
          <button type="button" className={botao.icone} onClick={novaConversa} disabled={enviando} aria-label="Nova conversa sobre este roteiro" title="Nova conversa">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-2 min-w-0">
        <SeletorDoModeloDoEscopo estado={modelo} />
      </div>
      <div ref={lista} className={juntar("mt-3 min-w-0 space-y-2", rolagem.lista)} aria-label="Conversa com o agente de roteiro" aria-live="polite">
        {!lida && <p className={conversa.apoio}>Lendo a conversa…</p>}
        {lida && !mensagens.length && <p className={conversa.apoio}>Peça uma mudança e eu reescrevo o roteiro. Você confirma e pode desfazer.</p>}
        {mensagens.map((m, i) => {
          const acoes = acoesDaMensagem(m.anexos);
          return (
            <div key={m.id || m.local || `m-${i}`} className="min-w-0">
              <div className={juntar(conversa.balao, m.papel === "usuario" ? conversa.doUsuario : m.papel === "sistema" ? "bg-muted text-muted-foreground" : conversa.doAgente)}>
                <TextoDoAgente texto={m.conteudo} clientId={clientId} />
                {m.custo_usd !== null && <p className={juntar(texto.auxiliar, "mt-1")}>Custo: {usd(m.custo_usd)}</p>}
              </div>
              {m.papel === "agente" && m.aviso && (
                <p className="mr-2 mt-1 flex min-w-0 items-start text-[12px] text-warning" role="alert">
                  <AlertTriangle className="mr-1.5 mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{m.aviso}</span>
                </p>
              )}
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2 min-w-0">
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
                      titulo="O agente vai mudar o roteiro"
                      observacao={observacaoDosRoteiros(a)}
                      onPedido={(p) => chamarAcaoDoAgente("mesa-roteiros", String(m.id), a.id, p)}
                      onFeito={(p) => {
                        if (p !== "descartar") roteiroMudou();
                      }}
                    />
                  </div>
                ))}
            </div>
          );
        })}
        {enviando && (
          <p className={juntar(conversa.apoio, "flex items-center")}>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Pensando no roteiro…
          </p>
        )}
      </div>
      {/* Atalhos à vista (o pedido mais comum em um toque); o que mais ele faz fica no title do grupo. */}
      <div className="mt-3 flex min-w-0 flex-wrap items-center" role="group" aria-label="Atalhos do agente de roteiro" title={`Posso: ${CAPACIDADES_DA_PECA.join(", ")}.`}>
        {ATALHOS_DA_PECA.map((a) => (
          <button
            key={a.rotulo}
            type="button"
            title={a.texto.trim()}
            onClick={() => {
              setRascunho(a.texto);
              focarNoFim(campo, a.texto);
            }}
            className="toque-compacto mb-1.5 mr-1.5 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      <div className="mt-2 flex min-w-0 items-end">
        <CampoDoAgente
          ref={campo}
          valor={rascunho}
          aoMudar={setRascunho}
          aoEnviar={() => void enviar()}
          maxLength={4000}
          placeholder="Ex.: deixa mais engraçado, sem perder o CTA"
          aria-label="Pedido ao agente de roteiro"
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          className={juntar(botao.primario, "ml-2 h-9 shrink-0")}
          onClick={() => void enviar()}
          disabled={enviando || !rascunho.trim()}
          aria-label="Enviar ao agente de roteiro"
          title={custo !== null ? `Enviar (conversa ~${usd(custo)})` : "Enviar"}
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {custo !== null && <p className={juntar(texto.auxiliar, "mt-1")}>Conversa ~{usd(custo)}; mudar o roteiro mostra o custo no cartão.</p>}
    </section>
  );
}
