import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Landmark } from "lucide-react";
import { toast } from "sonner";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { BalaoDaConversa, CompositorDoAgente, PainelDoAgente, AjudaRecolhida, botao, campoTexto, conversa, juntar, toqueCompacto } from "@/components/sistema";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { useCatalogo } from "@/components/mesa/MesaContexto";
import { padraoPara, textoDoErro } from "@/lib/mesa/api";
import { acoesDaMensagem, type AcaoDoAgente, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import {
  CHAVE_DOS_DADOS_DO_CFO,
  conversaDoCfo,
  exigeConfirmacaoExplicita,
  pedidoDaAcaoDoCfo,
  perguntarAoCfo,
  type MensagemDoCFO,
} from "@/lib/cfo/dadosDoCFO";

/**
 * A conversa com o CFO (frente CFO, 30/09). A mesma peça no Assist (serviço
 * "CFO") e em Financeiro › CFO. O dono pergunta ("projeção", "posso gastar
 * 1.500 num curso?", "onde corto?") e o CFO responde com números da conta em
 * código; quando dá para agir, vem o cartão com Confirmar e Desfazer. Gasto
 * acima do limite pede o "entendi" antes do Confirmar (a trava).
 */

export const PERGUNTAS_PRONTAS_DO_CFO: Array<{ rotulo: string; pergunta: string }> = [
  { rotulo: "Como estou?", pergunta: "Como está o financeiro hoje?" },
  { rotulo: "Este mês", pergunta: "O que eu faço neste mês, até quanto posso gastar e o que não posso gastar?" },
  { rotulo: "Projeção", pergunta: "Faça a projeção dos próximos 6 meses." },
  { rotulo: "Onde corto?", pergunta: "Onde eu corto custo?" },
  { rotulo: "Onde estou errando?", pergunta: "Onde eu estou errando nas finanças?" },
  { rotulo: "Plano de crescimento", pergunta: "Monte o meu plano de crescimento com metas." },
];

type Local = { id: string; papel: "usuario" | "agente" | "sistema"; conteudo: string; anexos: unknown[]; carregando?: boolean; aviso?: string | null };

export const CHAVE_DA_CONVERSA_DO_CFO = ["cfo", "conversa"] as const;

export default function ConversaDoCFO({ semMoldura = false, className = "", titulo = "CFO" }: { semMoldura?: boolean; className?: string; titulo?: string }) {
  const qc = useQueryClient();
  const catalogo = useCatalogo();
  const [modeloId, setModeloId] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [locais, setLocais] = useState<Local[]>([]);
  // "Entendi" do dono por proposta (lido na hora do Confirmar).
  const entendi = useRef<Record<string, boolean>>({});
  const [, setVersao] = useState(0);
  const fim = useRef<HTMLDivElement>(null);

  const conversaQ = useQuery({ queryKey: CHAVE_DA_CONVERSA_DO_CFO, queryFn: conversaDoCfo, staleTime: 30_000, retry: false });

  useEffect(() => {
    if (modeloId || !catalogo.data) return;
    const padrao = padraoPara(catalogo.data, "estrategista");
    if (padrao) setModeloId(padrao.id);
  }, [catalogo.data, modeloId]);

  const salvas: Local[] = (conversaQ.data || []).map((m: MensagemDoCFO) => ({ id: m.id, papel: m.papel, conteudo: m.conteudo, anexos: Array.isArray(m.anexos) ? m.anexos : [] }));
  const vistas = new Set(salvas.map((m) => m.id));
  const mensagens = salvas.concat(locais.filter((m) => !vistas.has(m.id)));

  useEffect(() => {
    if (fim.current && typeof fim.current.scrollIntoView === "function") fim.current.scrollIntoView({ block: "end" });
  }, [mensagens.length]);

  async function enviar(pergunta: string) {
    const p = pergunta.trim();
    if (!p || enviando) return;
    setEnviando(true);
    setTexto("");
    const idPedido = `local-${Date.now()}`;
    const idResposta = `${idPedido}-r`;
    setLocais((l) => l.concat([{ id: idPedido, papel: "usuario", conteudo: p, anexos: [] }, { id: idResposta, papel: "agente", conteudo: "", anexos: [], carregando: true }]));
    try {
      const r = await perguntarAoCfo(p, { modeloId: modeloId || null });
      setLocais((l) => l.map((m) => (m.id === idResposta ? { id: r.mensagem_id || idResposta, papel: "agente", conteudo: r.resposta, anexos: r.anexo ? [r.anexo] : [], aviso: r.aviso } : m)));
      if (r.aviso) toast.info(r.aviso);
    } catch (e) {
      // A mensagem que falha volta ao campo (regra dos agentes).
      setTexto(p);
      setLocais((l) => l.filter((m) => m.id !== idPedido && m.id !== idResposta));
      toast.error(`O CFO não respondeu: ${textoDoErro(e)}`);
    } finally {
      setEnviando(false);
    }
  }

  function depoisDaAcao() {
    void qc.invalidateQueries({ queryKey: CHAVE_DOS_DADOS_DO_CFO });
    void qc.invalidateQueries({ queryKey: ["expenses"] });
    // A conversa relida já traz as trocas gravadas: as locais saem para não aparecerem duas vezes.
    void qc.invalidateQueries({ queryKey: CHAVE_DA_CONVERSA_DO_CFO }).then(() => setLocais([]));
  }

  function cartao(mensagemId: string, acao: AcaoDoAgente) {
    const travada = exigeConfirmacaoExplicita(acao);
    const onPedido = (pedido: Parameters<ReturnType<typeof pedidoDaAcaoDoCfo>>[0]): Promise<RespostaDaAcao> =>
      pedidoDaAcaoDoCfo(mensagemId, acao.id, { confirmarAcimaDoLimite: entendi.current[acao.id] === true })(pedido);
    return (
      <CartaoDeAcao
        key={acao.id}
        acao={acao}
        titulo={travada ? "Passa do limite do mês" : "Proposta do CFO"}
        observacao="Sem custo."
        onPedido={onPedido}
        onFeito={depoisDaAcao}
        renderConfirmar={
          travada
            ? (confirmar, ocupado) => (
              <span className="inline-flex min-w-0 flex-wrap items-center">
                <label className="mr-2 inline-flex min-w-0 cursor-pointer items-center text-[12px] leading-4 text-foreground">
                  <input
                    type="checkbox"
                    className="mr-1.5 h-4 w-4 shrink-0"
                    checked={entendi.current[acao.id] === true}
                    onChange={(e) => { entendi.current[acao.id] = e.target.checked; setVersao((v) => v + 1); }}
                    data-entendi-do-cfo=""
                  />
                  Entendi que passa do limite
                </label>
                <button type="button" onClick={() => void confirmar()} disabled={ocupado || entendi.current[acao.id] !== true} className={juntar(botao.perigo, "h-8")}>
                  Lançar mesmo assim
                </button>
              </span>
            )
            : undefined
        }
      />
    );
  }

  return (
    <PainelDoAgente
      titulo={titulo}
      descricao="Números do painel, conta em código"
      icone={<Landmark className="h-4 w-4" />}
      semMoldura={semMoldura}
      className={className}
      rotuloDasMensagens="Conversa com o CFO"
      acoes={
        <AjudaRecolhida rotulo="Como o CFO funciona" lado="left">
          Toda conta (caixa, fôlego, projeção, limite do mês, cortes e metas) é feita em código com os dados do financeiro. A IA só explica e conduz; se ela
          trouxer um número fora da conta, vale a conta. Lançar, cortar e criar meta só acontecem no Confirmar, com Desfazer. Gasto acima do limite pede a sua
          confirmação explícita. Cobrança a cliente é sempre você quem envia.
        </AjudaRecolhida>
      }
      compositor={
        <CompositorDoAgente>
          <div className="-m-0.5 flex min-w-0 flex-wrap">
            {PERGUNTAS_PRONTAS_DO_CFO.map((q) => (
              <button
                key={q.rotulo}
                type="button"
                disabled={enviando}
                onClick={() => void enviar(q.pergunta)}
                className={juntar(toqueCompacto, "m-0.5 inline-flex h-7 items-center rounded-md border border-border px-2 text-[12px] text-foreground hover:bg-muted disabled:opacity-50")}
              >
                {q.rotulo}
              </button>
            ))}
          </div>
          <form
            className="flex min-w-0 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar(texto);
            }}
          >
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar(texto);
                }
              }}
              rows={2}
              placeholder='Ex.: "Posso gastar R$ 1.500 num curso?"'
              aria-label="Pergunta para o CFO"
              className={juntar(campoTexto, "mr-2 min-h-[44px] resize-none", conversa.campo)}
              data-campo-do-cfo=""
            />
            <button type="submit" disabled={enviando || !texto.trim()} className={juntar(botao.primario, "h-10")} aria-label="Enviar ao CFO">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </button>
          </form>
          <div className="min-w-0 max-w-[280px]">
            <SeletorDeModelo catalogo={catalogo.data || []} tipo="texto" valor={modeloId} onChange={setModeloId} rotulo="Modelo que explica" />
          </div>
        </CompositorDoAgente>
      }
    >
      <div className="min-w-0 space-y-3 px-3.5 py-3" data-conversa-do-cfo="">
        {conversaQ.isError && !mensagens.length && (
          <p className={conversa.apoio}>Ainda não consegui abrir a conversa ({textoDoErro(conversaQ.error)}). O painel ao lado já mostra os números.</p>
        )}
        {!mensagens.length && !conversaQ.isError && (
          <p className={conversa.apoio}>{conversaQ.isLoading ? "Abrindo a conversa…" : "Pergunte com as suas palavras ou use um atalho abaixo."}</p>
        )}
        {mensagens.map((m) => {
          if (m.papel === "sistema") return <p key={m.id} className={conversa.apoio}>{m.conteudo}</p>;
          const acoes = acoesDaMensagem(m.anexos);
          return (
            <div key={m.id} className="min-w-0 space-y-1.5">
              <BalaoDaConversa de={m.papel === "usuario" ? "usuario" : "agente"}>
                {m.carregando ? (
                  <span className="inline-flex items-center text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Fazendo a conta…</span>
                ) : (
                  <TextoDoAgente texto={m.conteudo} clientId={null} />
                )}
              </BalaoDaConversa>
              {m.papel === "agente" && !m.id.startsWith("local-") && acoes.map((a) => cartao(m.id, a))}
            </div>
          );
        })}
        <div ref={fim} />
      </div>
    </PainelDoAgente>
  );
}
