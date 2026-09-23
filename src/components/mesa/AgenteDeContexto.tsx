import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { chamarFuncao, padraoDoContexto, TAMANHOS, type ParteDaEstimativa } from "@/lib/mesa/api";
import { AvisoDeErro, EstimativaInline, avisarCustoReal } from "./Custo";
import { useMesa } from "./MesaContexto";
import {
  chaveDoHistorico,
  ROTULOS_DO_QUE_MUDOU,
  useHistoricoDoContexto,
  useInvalidarContexto,
  type MensagemDoContexto,
  type RespostaDaConversa,
} from "./contextoDoCliente";

/**
 * Conversa com o agente de contexto: a equipe conta o que sabe da marca e o
 * agente grava no kit (estilo, regras, paleta, contexto) e na memória do
 * estrategista e do diretor de arte.
 *
 * Com `preencher`, ocupa a altura toda da coluna (fixa ao lado do contexto):
 * a conversa rola sozinha e a caixa de mensagem fica sempre embaixo.
 */
export default function AgenteDeContexto({ preencher = false }: { preencher?: boolean } = {}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const historico = useHistoricoDoContexto(clientId);
  const invalidar = useInvalidarContexto();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState<{ clientId: string; mensagem: string } | null>(null);
  const [erro, setErro] = useState<{ clientId: string; erro: unknown } | null>(null);
  const [ultimo, setUltimo] = useState<{ clientId: string; mudou: string[]; memorias: number } | null>(null);
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTexto("");
  }, [clientId]);

  // Papel próprio no catálogo (contexto); sem padrão, vale o do estrategista.
  const modelo = padraoDoContexto(catalogo);
  const partes: ParteDaEstimativa[] = [
    { modeloId: modelo?.id, tipo: "texto", tokensEntrada: TAMANHOS.conversarContexto.entrada, tokensSaida: TAMANHOS.conversarContexto.saida },
  ];

  const mensagens = historico.data || [];
  const pendente = enviando && enviando.clientId === clientId ? enviando.mensagem : null;

  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, pendente]);

  const enviar = async () => {
    const msg = texto.trim();
    if (!msg || enviando) return;
    const alvo = clientId;
    setEnviando({ clientId: alvo, mensagem: msg });
    setErro(null);
    setTexto("");
    try {
      const data = await chamarFuncao<RespostaDaConversa>("agente-contexto", { acao: "conversar", client_id: alvo, mensagem: msg });
      const agora = new Date().toISOString();
      const resposta = String((data && data.resposta) || "Pronto.");
      queryClient.setQueryData<MensagemDoContexto[]>(chaveDoHistorico(alvo), (antes) =>
        (antes || []).concat([
          { papel: "usuario", conteudo: msg, criado_em: agora },
          { papel: "agente", conteudo: resposta, criado_em: agora },
        ]),
      );
      setUltimo({ clientId: alvo, mudou: Array.isArray(data?.mudou) ? data.mudou : [], memorias: Number(data?.memorias || 0) });
      avisarCustoReal("Agente de contexto respondeu", data, atualizarCusto);
      invalidar(alvo, { historico: true });
    } catch (e) {
      setErro({ clientId: alvo, erro: e });
      setTexto((t) => t || msg);
    } finally {
      setEnviando(null);
    }
  };

  const mudanca = ultimo && ultimo.clientId === clientId ? ultimo : null;
  const nomesDoQueMudou = mudanca ? mudanca.mudou.map((m) => ROTULOS_DO_QUE_MUDOU[m] || m) : [];

  return (
    <section className={`flex min-w-0 flex-col rounded-xl border border-border bg-card p-3 ${preencher ? "lg:h-full" : ""}`}>
      <div className="mb-3 min-w-0 shrink-0">
        <p className="flex items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Agente de contexto
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          Conte o que sabe da marca ou corrija o que estiver errado. O agente grava no kit e ensina o estrategista e o diretor de arte.
        </p>
      </div>

      <div
        ref={lista}
        className={`min-w-0 space-y-2 overflow-y-auto overscroll-contain ${preencher ? "max-h-[420px] min-h-[120px] lg:max-h-none lg:min-h-0 lg:flex-1" : "max-h-[420px]"}`}
      >
        {historico.isLoading && (
          <div className="space-y-2" aria-label="Lendo a conversa">
            <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" />
            <div className="ml-6 h-8 animate-pulse rounded-lg bg-muted" />
            <div className="mr-6 h-12 animate-pulse rounded-lg bg-muted" />
          </div>
        )}
        {historico.isError && <AvisoDeErro erro={historico.error} />}
        {historico.data && mensagens.length === 0 && !pendente && (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Nenhuma conversa ainda. Exemplos: "a cor principal é o verde da fachada", "o público são mães de 30 a 45 anos", "nunca usar fundo preto".
          </p>
        )}
        {mensagens.map((m, i) => (
          <div
            key={`${m.criado_em}-${i}`}
            className={`rounded-lg px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] ${m.papel === "usuario" ? "ml-6 bg-primary/10" : "mr-6 bg-secondary/60"}`}
          >
            <p className="whitespace-pre-wrap">{m.conteudo}</p>
          </div>
        ))}
        {pendente && (
          <>
            <div className="ml-6 rounded-lg bg-primary/10 px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
              <p className="whitespace-pre-wrap">{pendente}</p>
            </div>
            <p className="mr-6 flex items-center px-1 text-[12px] text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> O agente está lendo o contexto...
            </p>
          </>
        )}
      </div>

      {mudanca && (
        <p className="mt-3 shrink-0 rounded-lg border border-border px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {nomesDoQueMudou.length ? `Mudou no kit: ${nomesDoQueMudou.join(", ")}.` : "Nada mudou no kit."}
          {mudanca.memorias > 0 && ` ${mudanca.memorias === 1 ? "1 memória guardada" : `${mudanca.memorias} memórias guardadas`} para os agentes.`}
        </p>
      )}

      {erro && erro.clientId === clientId && <AvisoDeErro erro={erro.erro} className="mt-3 shrink-0" />}

      <Textarea
        className="mt-3 shrink-0 resize-none"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void enviar();
          }
        }}
        rows={3}
        placeholder="O que o agente precisa saber?"
        disabled={!!pendente}
      />
      <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between">
        <EstimativaInline partes={partes} />
        <Button type="button" size="sm" className="ml-2" onClick={() => void enviar()} disabled={!!enviando || !texto.trim()}>
          {pendente ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
          Enviar
        </Button>
      </div>
    </section>
  );
}
