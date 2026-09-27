import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { MessageSquarePlus, Sparkles, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "@/components/mesa/AnexosDoPedido";
import { Ditado } from "@/components/mesa/Ditado";
import { Cronometro } from "@/components/mesa/Cronometro";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, foco as focoVisivel, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { abrirLateralDaArea } from "@/components/mesa-foto/lateralDaArea";
import { chamarAds, chavesAds, lerConversa, normalizarRespostaDaOferta, partesDaOferta, type RespostaDaOferta } from "./adsApi";

/**
 * Agente de oferta (oferta_conversar): a equipe conta o que o cliente vende,
 * fala pelo microfone ou anexa prints, e o agente devolve ofertas
 * específicas (gravadas em ads_ofertas e conferidas pelo Jev), ideias de
 * criativo e, quando fizer sentido, uma sugestão de briefing. A conversa
 * fica no banco; o id da conversa em andamento fica no navegador.
 *
 * 26/09 (sistema de design): é a lateral fixa da etapa Oferta
 * (AreaDeTrabalho + PainelDoAgente). O rascunho do campo fica lembrado por
 * cliente; "Lapidar com o agente" põe o pedido no campo e abre a lateral.
 */

const ATALHOS = [
  { rotulo: "Oferta de entrada", texto: "Monte uma oferta de entrada com risco baixo para quem nunca comprou: " },
  { rotulo: "Mais agressiva", texto: "Deixe a oferta mais agressiva e vendedora: promessa concreta com número real, urgência real e CTA imperativo, sem promessa de resultado garantido: " },
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

/** Pedido que chega de fora (Lapidar com o agente): texto pronto e a oferta em foco. */
export interface PedidoAoAgente {
  texto: string;
  ofertaId: string | null;
  nome: string;
  /** Muda a cada clique, para o mesmo pedido poder chegar de novo. */
  chave: number;
}

/** Texto pronto para lapidar uma oferta (a do contexto chega crua, com lacunas). */
export function pedidoParaLapidar(nome: string, doContexto: boolean, lacunas: string[] = []): string {
  const faltas = lacunas.length ? ` O que falta no contexto: ${lacunas.slice(0, 4).join(" ")}` : "";
  return doContexto
    ? `Lapide a oferta "${nome}" que veio do contexto do cliente: deixe a promessa específica e vendedora, complete o que entra, proponha bônus e reversão de risco (marcados para confirmar) e um CTA direto. Mantenha os fatos (preço, garantia, datas).${faltas}`
    : `Lapide a oferta "${nome}": mais vendedora e específica, com bônus, reversão de risco e CTA direto, mantendo os fatos.`;
}

export default function AgenteDaOferta({
  conversaInicial,
  onResposta,
  className = "",
  pedido = null,
}: {
  /** Conversa da oferta mais recente, quando o navegador não guardou nenhuma. */
  conversaInicial: string | null;
  onResposta: (r: RespostaDaOferta) => void;
  className?: string;
  /** v3: pedido pronto vindo da oferta (Lapidar com o agente). */
  pedido?: PedidoAoAgente | null;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  // Rascunho do campo lembrado por cliente (sair e voltar não perde o que foi escrito).
  const [texto, setTexto] = useEstadoDaTela(`mesa-ads:oferta:agente:rascunho:${clientId}`, "");
  const [envio, setEnvio] = useState<{ mensagem: string; desde: number } | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(() => lerConversaGuardada(clientId));
  const [recomecou, setRecomecou] = useState(false);
  const [foco, setFoco] = useState<{ id: string; nome: string } | null>(null);
  const entradaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!pedido) return;
    setTexto(pedido.texto);
    setFoco(pedido.ofertaId ? { id: pedido.ofertaId, nome: pedido.nome } : null);
    // O agente é a lateral fixa: no celular abre a gaveta; no computador reabre se estava recolhido.
    abrirLateralDaArea();
    const t = window.setTimeout(() => {
      const el = entradaRef.current;
      if (el) el.focus();
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido ? pedido.chave : 0]);
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
        oferta_id: foco ? foco.id : undefined,
      });
      setFoco(null);
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

  // Casca fixa de agente (src/components/sistema/PainelDoAgente.tsx): cabeçalho e
  // campo sempre à vista; só a conversa rola, por dentro.
  return (
    <PainelDoAgente
      className={className}
      titulo="Agente de oferta"
      descricao="Ofertas conferidas pelo Jev"
      icone={<Sparkles className="h-4 w-4" />}
      acoes={
        <>
          {atual && (
            <button type="button" onClick={novaConversa} disabled={!!envio} className={juntar(botao.icone, "disabled:opacity-50")} aria-label="Começar uma conversa nova" title="Começar uma conversa nova">
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <AjudaRecolhida rotulo="Como o agente de oferta funciona">
            Conte o que o cliente vende, fale pelo microfone ou anexe prints. O agente devolve ofertas específicas (promessa, mecanismo, bônus, garantia e CTA), conferidas pelo Jev, sem inventar prova nem urgência.
          </AjudaRecolhida>
        </>
      }
      refDasMensagens={listaRef}
      rotuloDasMensagens="Conversa com o agente de oferta"
      compositor={
        <>
          <div className="flex min-w-0 flex-wrap" role="group" aria-label="Atalhos para o agente de oferta">
            {ATALHOS.map((a) => (
              <button
                key={a.rotulo}
                type="button"
                onClick={() => setTexto(a.texto)}
                className={juntar("mb-1 mr-1 max-w-full truncate rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground", focoVisivel)}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          {foco && (
            <div className="flex min-w-0 items-center rounded-md bg-primary/10 px-2.5 py-1.5 text-[11.5px]" role="note">
              <span className="min-w-0 flex-1 truncate">
                Lapidando: <span className="font-medium">{foco.nome}</span>
              </span>
              <button type="button" onClick={() => setFoco(null)} className={juntar("ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted", focoVisivel)} aria-label="Tirar a oferta em foco">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <ZonaDeAnexos anexos={anexos}>
            <div className="rounded-md border border-input bg-background p-2 focus-within:border-primary/60">
              <MiniaturasDosAnexos anexos={anexos} />
              <Textarea
                ref={entradaRef}
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
        </>
      }
    >
      {conversa.isLoading && (
        <div className="space-y-2" aria-label="Lendo a conversa">
          <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" />
          <div className="ml-8 h-8 animate-pulse rounded-lg bg-muted" />
        </div>
      )}
      {conversa.isError && <AvisoDeErro erro={conversa.error} />}
      {vazia && !envio && !conversa.isLoading && (
        <div className="px-1 py-6 text-center">
          <p className="text-[12.5px] font-medium">Conte o que o cliente vende</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Produto, preço confirmado, para quem e o que trava a venda.</p>
        </div>
      )}
      {mensagens.map((m) => {
        if (m.papel === "sistema") return <p key={m.id} className="text-center text-[11px] text-muted-foreground">{m.conteudo}</p>;
        const imagens = m.anexos.map((a: any) => (a && a.caminho ? String(a.caminho) : typeof a === "string" ? a : "")).filter(Boolean);
        return (
          <div key={m.id} className="min-w-0 space-y-1.5">
            {m.conteudo && (
              <Bolha papel={m.papel === "usuario" ? "usuario" : "agente"}>
                <TextoDoAgente texto={m.conteudo} />
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
    </PainelDoAgente>
  );
}
