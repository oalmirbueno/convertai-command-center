import { useEffect, useRef, useState } from "react";
import { Bot, Link2, Loader2, Send, Sparkles } from "lucide-react";
import { BotaoComCusto, EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { partesDaConversa } from "../fotoApi";
import {
  aplicarRespostaDoAgente,
  bloqueiosDoGerar,
  conversarNoCanvas,
  entradasDoGerar,
  mudarDados,
  partesDoResultado,
  resultadoAlvo,
  ligar,
  type Canvas,
  type NoDoCanvas,
} from "../canvasApi";
import { BOTAO, CAMPO, ROTULO, type Fontes } from "./comum";
import { AjudaRecolhida, CompositorDoAgente, MensagensDoAgente } from "@/components/sistema";

/**
 * Conversa com o Agente (a bolinha do quadro). Dono, 25/09: "uma bolinha onde
 * clico e converso com uma inteligência; ligo ela direto, e quando gero ela
 * puxa todos os contextos, a foto, e a imagem aparece bonitinha embaixo".
 *
 * Cada mensagem é uma chamada de canvas_agente (texto, custo à vista ao lado
 * do Enviar): o agente lê o contexto do cliente, o que está ligado no
 * Resultado e a última foto dele, responde e reescreve o pedido. O pedido
 * fica no cartão do agente e vai ao gerador como PEDIDO; a ação e a pose que
 * ele sugerir entram no Resultado ligado. Gerar daqui usa o mesmo botão do
 * Resultado, e a foto aparece embaixo da conversa.
 */

const ATALHOS = [
  "Escreva o pedido pelo contexto do cliente",
  "Deixe mais realista, com ângulo diferente",
  "Quero pegada UGC, selfie segurando o produto",
  "Sugira um ambiente com a cara da marca",
];

export function ChatDoAgente({
  canvas,
  no,
  fontes,
  onMudarCanvas,
  garantirSalvo,
  onGerar,
}: {
  canvas: Canvas;
  no: NoDoCanvas;
  fontes: Fontes;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  garantirSalvo: () => Promise<Canvas | null>;
  onGerar: (gerarId: string) => Promise<Record<string, never>>;
}) {
  const { catalogo, atualizarCusto } = useMesa();
  const avisarErro = useAvisarErro();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const conversa = useRef<HTMLDivElement>(null);
  const mensagens = no.dados.mensagens || [];
  const ligacao = canvas.ligacoes.find((l) => l.de === no.id) || null;
  const resultado = ligacao ? canvas.nos.find((n) => n.id === ligacao.para) || null : null;
  const prontas = resultado ? (resultado.dados.resultados || []).filter((r) => r.status === "gerada" && !!(r.storage_path || r.url)) : [];
  const ultima = prontas.length ? prontas[prontas.length - 1] : null;
  const bloqueios = resultado ? bloqueiosDoGerar(canvas, resultado.id, fontes.personas) : [];

  // Mensagem nova: desce só a caixa da conversa. (scrollIntoView rolava também o painel e a página, e o quadro inteiro pulava.)
  useEffect(() => {
    const caixa = conversa.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens.length, enviando]);

  const enviar = async (mensagem: string) => {
    const m = mensagem.trim();
    if (!m || enviando) return;
    setEnviando(true);
    try {
      const salvo = await garantirSalvo();
      if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de conversar com o agente.");
      const r = await conversarNoCanvas({ canvasId: salvo.id, gerarId: resultado ? resultado.id : null, mensagem: m, tarefa: "conversar", historico: mensagens });
      onMudarCanvas((c) => aplicarRespostaDoAgente(c, no.id, m, r));
      setTexto("");
    } catch (e) {
      avisarErro(e, "O agente não respondeu");
    } finally {
      setEnviando(false);
      atualizarCusto();
    }
  };

  return (
    <div className="flex min-w-0 flex-col space-y-2.5" data-chat-do-agente={no.id}>
      <div className="flex min-w-0 items-center">
        <span className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
          <Bot className="h-4 w-4 text-violet-300" aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-100">Agente do Resultado</p>
        <AjudaRecolhida className="ml-1">Lê o contexto do cliente, o que está ligado e a última foto, e escreve o pedido do Resultado. Cada mensagem tem o custo à vista ao lado do Enviar.</AjudaRecolhida>
      </div>
      {!resultado && (
        <button
          type="button"
          className={BOTAO}
          onClick={() => {
            const alvo = resultadoAlvo(canvas, null);
            if (alvo) onMudarCanvas((c) => ligar(c, no.id, alvo));
          }}
        >
          <Link2 className="mr-1 h-3.5 w-3.5" /> Ligar ao Resultado
        </button>
      )}
      {/* Casca do sistema (PainelDoAgente em peças): a conversa rola por dentro, numa caixa de altura fixa; o campo fica logo abaixo, sempre à vista. */}
      <div className="flex h-[30vh] min-h-[120px] min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-900/60" data-caixa-da-conversa="">
      <MensagensDoAgente ref={conversa} rotulo="Conversa com o agente" className="nowheel nopan nodrag !space-y-2 !p-2.5">
        {mensagens.length === 0 && <p className="text-[12.5px] leading-snug text-zinc-500">Diga o que você quer: "ela segurando o produto na praia, pegada natural".</p>}
        {mensagens.map((msg, i) => (
          <p
            key={i}
            className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-[1.5] [overflow-wrap:anywhere] ${msg.papel === "usuario" ? "ml-auto bg-emerald-500/20 text-emerald-50" : "bg-white/[0.07] text-zinc-100"}`}
            data-mensagem={msg.papel}
          >
            {msg.texto}
          </p>
        ))}
        {enviando && (
          <p className="inline-flex items-center rounded-2xl bg-white/[0.07] px-3 py-2 text-[13px] text-zinc-300">
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> pensando
          </p>
        )}
      </MensagensDoAgente>
      </div>
      <CompositorDoAgente className="!border-t-0 !px-0 !pb-0 !pt-0 [&_textarea]:text-[13px]">
      <div className="flex min-w-0 flex-wrap">
        {ATALHOS.map((a) => (
          <button key={a} type="button" disabled={enviando} onClick={() => void enviar(a)} className="mb-1 mr-1 rounded-full border border-white/10 px-2 py-0.5 text-[11.5px] text-zinc-400 hover:text-white disabled:opacity-50">
            {a}
          </button>
        ))}
      </div>
      <div className="min-w-0">
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
          placeholder="Converse com o agente"
          aria-label="Mensagem para o agente"
          className={CAMPO}
        />
        <div className="mt-1.5 flex items-center">
          <EstimativaInline partes={partesDaConversa(catalogo)} />
          <span className="flex-1" />
          <button type="button" className={`${BOTAO} h-8 border-violet-400/40 bg-violet-500/20`} disabled={enviando || !texto.trim()} onClick={() => void enviar(texto)}>
            {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />} Enviar
          </button>
        </div>
      </div>
      </CompositorDoAgente>

      <div className="min-w-0">
        <p className={ROTULO}>Pedido que vai ao gerador</p>
        <textarea value={no.dados.pedido || ""} onChange={(e) => onMudarCanvas((c) => mudarDados(c, no.id, { pedido: e.target.value }))} rows={3} placeholder="O agente escreve aqui. Dá para ajustar à mão." aria-label="Pedido do agente" className={CAMPO} />
      </div>
      {resultado && (
        <div className="min-w-0 space-y-1.5" data-foto-do-agente="">
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {resultado.dados.carrossel ? `Gerar carrossel de ${resultado.dados.carrossel}` : "Gerar com este pedido"}
              </>
            }
            titulo="Geração do Canvas"
            descricao="Salva, junta tudo o que está ligado (com o pedido do agente) e gera no Resultado."
            className="h-9 w-full text-[12.5px]"
            disabled={bloqueios.length > 0}
            fecharAoConfirmar
            partes={() => partesDoResultado(resultado, entradasDoGerar(canvas, resultado.id).length)}
            executar={() => onGerar(resultado.id)}
          />
          {bloqueios.length > 0 && <p className="text-[11px] text-amber-300">{bloqueios[0]}</p>}
          {ultima && (
            <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900" style={{ height: 180 }}>
              <ImagemDaMesa caminho={ultima.storage_path || ultima.url} bucket={ultima.storage_bucket} alt="Última foto do Resultado" className="h-full w-full !object-contain" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
