import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquarePlus, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "@/components/mesa/AnexosDoPedido";
import { Ditado } from "@/components/mesa/Ditado";
import { Cronometro } from "@/components/mesa/Cronometro";
import { chamarAds, chavesAds, lerConversa, normalizarRespostaDaOferta, partesDaOferta, type RespostaDaOferta } from "./adsApi";

/**
 * Agente de oferta (oferta_conversar): a equipe conta o que o cliente vende,
 * fala pelo microfone ou anexa prints, e o agente devolve ofertas
 * específicas (gravadas em ads_ofertas e conferidas pelo Jev), ideias de
 * criativo e, quando fizer sentido, uma sugestão de briefing. A conversa
 * fica no banco; o id da conversa em andamento fica no navegador.
 */

const ATALHOS = [
  { rotulo: "Oferta de entrada", texto: "Monte uma oferta de entrada com risco baixo para quem nunca comprou: " },
  { rotulo: "Mais agressiva", texto: "Deixe a oferta mais agressiva e vendedora, sem promessa de resultado: " },
  { rotulo: "Com bônus e garantia", texto: "Acrescente bônus reais e uma garantia que o cliente consiga cumprir: " },
  { rotulo: "Ideias de criativo", texto: "Traga ideias de criativo que parem a rolagem para a oferta " },
];

const chaveDaConversa = (clientId: string) => `mesa-ads:oferta-conversa:${clientId}`;

function lerConversaGuardada(clientId: string): string | null {
  try {
    const v = window.localStorage.getItem(chaveDaConversa(clientId));
    return v && /^[0-9a-f-]{16,}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

function guardarConversa(clientId: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(chaveDaConversa(clientId), id);
    else window.localStorage.removeItem(chaveDaConversa(clientId));
  } catch {
    /* armazenamento indisponível: a conversa recomeça ao recarregar */
  }
}

function Bolha({ papel, children }: { papel: "usuario" | "agente"; children: ReactNode }) {
  return (
    <div
      className={`min-w-0 rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] ${
        papel === "usuario" ? "ml-8 rounded-br-md bg-primary text-primary-foreground" : "mr-6 rounded-bl-md bg-muted text-foreground"
      }`}
    >
      {children}
    </div>
  );
}

export default function AgenteDaOferta({
  conversaInicial,
  onResposta,
  className = "",
}: {
  /** Conversa da oferta mais recente, quando o navegador não guardou nenhuma. */
  conversaInicial: string | null;
  onResposta: (r: RespostaDaOferta) => void;
  className?: string;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  const [texto, setTexto] = useState("");
  const [envio, setEnvio] = useState<{ mensagem: string; desde: number } | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(() => lerConversaGuardada(clientId));
  const [recomecou, setRecomecou] = useState(false);
  const enviados = useRef<string[]>([]);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLSpanElement>(null);
  const atual = conversaId || (recomecou ? null : conversaInicial);

  const conversa = useQuery({
    queryKey: ["mesa", "ads", "conversa-oferta", clientId, atual || ""],
    enabled: !!atual,
    queryFn: () => lerConversa(atual),
  });
  const mensagens = (conversa.data || []).filter((m) => m.conteudo || m.anexos.length);

  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, !!envio]);

  const enviar = async () => {
    const mensagem = texto.trim();
    const caminhos = anexos.caminhos.slice();
    enviados.current = caminhos;
    setEnvio({ mensagem, desde: Date.now() });
    setTexto("");
    try {
      const bruto = await chamarAds<any>("oferta_conversar", {
        client_id: clientId,
        mensagem,
        conversa_id: atual || undefined,
        anexos: caminhos.length ? caminhos : undefined,
      });
      const r = normalizarRespostaDaOferta(bruto);
      if (r.conversa_id) {
        setConversaId(r.conversa_id);
        guardarConversa(clientId, r.conversa_id);
      }
      onResposta(r);
      await queryClient.invalidateQueries({ queryKey: ["mesa", "ads", "conversa-oferta", clientId] });
      void queryClient.invalidateQueries({ queryKey: chavesAds.ofertas(clientId) });
      return bruto;
    } catch (e) {
      setTexto((t) => t || mensagem);
      throw e;
    } finally {
      setEnvio(null);
    }
  };

  const novaConversa = () => {
    setConversaId(null);
    setRecomecou(true);
    guardarConversa(clientId, null);
  };

  const podeEnviar = !!texto.trim() && !anexos.subindo && !envio;
  const vazia = !atual || (conversa.data && mensagens.length === 0);

  return (
    <div className={`flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-card ${className}`} aria-label="Agente de oferta">
      <div className="flex shrink-0 items-center border-b border-border px-4 py-3">
        <span className="mr-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">Agente de oferta</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">Ofertas específicas, conferidas pelo Jev</span>
        </span>
        {atual && (
          <button type="button" onClick={novaConversa} disabled={!!envio} className="ml-2 inline-flex h-8 shrink-0 items-center rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50" title="Começar uma conversa nova">
            <MessageSquarePlus className="mr-1 h-3.5 w-3.5" /> Nova
          </button>
        )}
      </div>

      <div ref={listaRef} className="min-h-[220px] flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3" aria-live="polite" aria-label="Conversa com o agente de oferta">
        {conversa.isLoading && (
          <p className="text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Lendo a conversa…
          </p>
        )}
        {conversa.isError && <AvisoDeErro erro={conversa.error} />}
        {vazia && !envio && !conversa.isLoading && (
          <div className="px-1 py-6 text-center">
            <p className="text-[12.5px] font-medium">Conte o que o cliente vende</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Produto, preço confirmado, para quem, o que já funcionou e o que trava a venda. O agente monta ofertas com promessa, mecanismo, bônus, garantia e CTA, sem inventar prova nem urgência.
            </p>
          </div>
        )}
        {mensagens.map((m) => {
          if (m.papel === "sistema") return <p key={m.id} className="text-center text-[11px] text-muted-foreground">{m.conteudo}</p>;
          const imagens = m.anexos.map((a: any) => (a && a.caminho ? String(a.caminho) : typeof a === "string" ? a : "")).filter(Boolean);
          return (
            <div key={m.id} className="min-w-0 space-y-1.5">
              {m.conteudo && (
                <Bolha papel={m.papel === "usuario" ? "usuario" : "agente"}>
                  <p className="whitespace-pre-wrap">{m.conteudo}</p>
                </Bolha>
              )}
              {imagens.length > 0 && (
                <div className="ml-8 flex flex-wrap justify-end">
                  {imagens.map((c: string) => (
                    <ImagemDaMesa key={c} caminho={c} alt="Imagem anexada" className="mb-1 ml-1 h-12 w-12 rounded-md border border-border" />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {envio && (
          <div className="min-w-0 space-y-2">
            {envio.mensagem && (
              <Bolha papel="usuario">
                <p className="whitespace-pre-wrap">{envio.mensagem}</p>
              </Bolha>
            )}
            <div className="mr-6 rounded-2xl rounded-bl-md bg-muted px-3 py-2">
              <Cronometro desde={envio.desde} rotulo="Montando e conferindo as ofertas" />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border px-3 pb-3 pt-2.5">
        <div className="flex flex-wrap" role="group" aria-label="Atalhos para o agente de oferta">
          {ATALHOS.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => setTexto(a.texto)}
              className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <ZonaDeAnexos anexos={anexos}>
          <div className="rounded-xl border border-border bg-background p-2 focus-within:border-primary/60">
            <MiniaturasDosAnexos anexos={anexos} />
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && podeEnviar) {
                  e.preventDefault();
                  const b = botaoRef.current ? botaoRef.current.querySelector("button") : null;
                  if (b) b.click();
                }
              }}
              rows={3}
              aria-label="Mensagem ao agente de oferta"
              placeholder="Fale ou escreva. Arraste ou cole prints do cardápio, da tabela de preços, de um anúncio."
              className="max-h-40 min-h-[64px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="mt-1 flex min-w-0 items-center">
              <BotaoDeAnexar anexos={anexos} className="mr-1.5" />
              <Ditado valor={texto} onChange={setTexto} disabled={!!envio} className="mr-1.5 min-w-0" />
              <span ref={botaoRef} className="ml-auto shrink-0">
                <BotaoComCusto
                  rotulo="Enviar"
                  titulo="Mensagem ao agente de oferta"
                  descricao="Uma chamada do estrategista com o briefing, o contexto do cliente e os aprendizados; as ofertas voltam conferidas pelo Jev."
                  partes={() => partesDaOferta(catalogo, anexos.caminhos.length)}
                  executar={enviar}
                  aoConcluir={() => anexos.tirarEnviados(enviados.current)}
                  disabled={!podeEnviar}
                  className="h-8"
                />
              </span>
            </div>
          </div>
        </ZonaDeAnexos>
      </div>
    </div>
  );
}
