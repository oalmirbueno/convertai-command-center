import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Aperture, Check, Loader2, Paperclip, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { custoDaResposta, usd } from "@/lib/mesa/api";
import { useMesaFoto } from "./Comuns";
import {
  aplicarSugestao,
  chaveDaBiblioteca,
  conversarComDiretor,
  guardarEnsaio,
  MAX_ANEXOS_DO_DIRETOR,
  partesDaConversa,
  sugestaoPedeEnsaio,
  type MensagemDoDiretor,
  type SugestaoDoAgente,
} from "./fotoApi";

/**
 * O diretor de fotografia, à mão em qualquer etapa: botão flutuante no
 * centro da base da tela (acima da barra do celular) que abre a conversa num
 * pop-up grande e centralizado, como o Agente do mês. Ele conhece o cliente,
 * o kit e o ensaio abertos; as fotos marcadas no Acervo podem ir junto. As
 * sugestões chegam em cartões e só mudam o ensaio quando a equipe clica em
 * Aplicar. Microfone e custo estimado antes de mandar.
 */

const chaveDaConversa = (clientId: string) => `mesa-foto:conversa:${clientId}`;

function lerConversa(clientId: string): string | null {
  try {
    return window.sessionStorage.getItem(chaveDaConversa(clientId));
  } catch {
    return null;
  }
}

function gravarConversa(clientId: string, id: string) {
  try {
    window.sessionStorage.setItem(chaveDaConversa(clientId), id);
  } catch {
    /* sem armazenamento: a conversa vale só nesta tela */
  }
}

let contador = 0;
const idLocal = () => `m-${Date.now()}-${++contador}`;

function CartaoDaSugestao({ sugestao }: { sugestao: SugestaoDoAgente }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { ensaioId, irPara } = useMesaFoto();
  const [aplicando, setAplicando] = useState(false);
  const [aplicada, setAplicada] = useState(false);
  // Tomada nova ou ajuste só com ensaio aberto; prompt e busca de referência valem sem ensaio.
  const precisaDeEnsaio = sugestaoPedeEnsaio(sugestao);
  const bloqueada = precisaDeEnsaio && !ensaioId;
  const aplicar = async () => {
    if (bloqueada) return;
    setAplicando(true);
    try {
      const r = await aplicarSugestao({ clientId, ensaioId }, sugestao);
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      if (custoDaResposta(r) !== null) atualizarCusto();
      setAplicada(true);
      if (r.item) {
        void queryClient.invalidateQueries({ queryKey: chaveDaBiblioteca(clientId) });
        toast.success("Prompt guardado na biblioteca do cliente", { description: r.item.titulo });
      } else if (sugestao.tipo === "busca_referencia") {
        toast.success(`${r.referencias.length} ${r.referencias.length === 1 ? "referência achada" : "referências achadas"}`, {
          description: `Busque "${r.busca || "o termo"}" na Biblioteca para ver licença e autor e importar.`,
          duration: 9000,
        });
        irPara("biblioteca");
      } else toast.success("Sugestão aplicada ao ensaio");
    } catch (e) {
      avisarErro(e, "Sugestão não aplicada");
    } finally {
      setAplicando(false);
    }
  };
  return (
    <li className="min-w-0 rounded-xl border border-primary/30 bg-card p-2.5" data-sugestao={sugestao.chave}>
      <p className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
      {sugestao.descricao && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
      <div className="mt-2 flex items-center">
        <Button type="button" size="sm" variant={aplicada ? "ghost" : "outline"} className="h-7 text-[11.5px]" disabled={bloqueada || aplicando || aplicada} onClick={() => void aplicar()}>
          {aplicando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : aplicada ? <Check className="mr-1 h-3.5 w-3.5" /> : null}
          {aplicada ? "Aplicada" : "Aplicar"}
        </Button>
        {bloqueada && <span className="ml-2 text-[11px] text-muted-foreground">Abra um ensaio para aplicar.</span>}
      </div>
    </li>
  );
}

function Conversa({ mensagens, pendente }: { mensagens: MensagemDoDiretor[]; pendente: string | null }) {
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fim.current;
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "end" });
      } catch {
        /* navegador antigo */
      }
    }
  }, [mensagens.length, pendente]);
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
      {mensagens.length === 0 && !pendente && (
        <div className="mx-auto max-w-md py-8 text-center">
          <Aperture className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-2 text-[14px] font-semibold">Diretor de fotografia</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Pergunte que tomadas fazer, que luz combina com a marca, o que falta fotografar ou por que uma versão não ficou fiel. Ele conhece o cliente, o kit e o ensaio abertos.
          </p>
        </div>
      )}
      {mensagens.map((m) => (
        <div key={m.id} className={`min-w-0 ${m.papel === "usuario" ? "ml-10" : "mr-6"}`}>
          <div
            className={`min-w-0 whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere] ${
              m.papel === "usuario" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground"
            }`}
          >
            {m.texto}
            {m.papel === "usuario" && m.anexos > 0 && (
              <span className="mt-1 block text-[11px] opacity-80">
                {m.anexos} {m.anexos === 1 ? "foto junto" : "fotos junto"}
              </span>
            )}
          </div>
          {m.papel === "agente" && m.sugestoes.length > 0 && (
            <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              {m.sugestoes.map((s) => (
                <CartaoDaSugestao key={s.chave} sugestao={s} />
              ))}
            </ul>
          )}
          {m.papel === "agente" && m.custo_usd !== null && <p className="mt-1 text-[10.5px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
        </div>
      ))}
      {pendente && (
        <p role="status" className="mr-6 inline-flex items-center rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> O diretor está pensando...
        </p>
      )}
      <div ref={fim} />
    </div>
  );
}

export default function AgenteDiretor({ aberto, onAberto }: { aberto: boolean; onAberto: (v: boolean) => void }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { kitId, ensaioId, selecionadas } = useMesaFoto();
  const [mensagens, setMensagens] = useState<MensagemDoDiretor[]>([]);
  const [texto, setTexto] = useState("");
  const [pendente, setPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [comFotos, setComFotos] = useState(true);
  const [conversaId, setConversaId] = useState<string | null>(() => lerConversa(clientId));

  // A função lê até 4 anexos por mensagem.
  const anexos = comFotos ? selecionadas.slice(0, MAX_ANEXOS_DO_DIRETOR) : [];

  const mandar = async () => {
    const msg = texto.trim();
    if (!msg || pendente) return;
    setErro(null);
    setTexto("");
    setPendente(msg);
    setMensagens((l) => l.concat([{ id: idLocal(), papel: "usuario", texto: msg, sugestoes: [], custo_usd: null, anexos: anexos.length }]));
    try {
      const r = await conversarComDiretor({ clientId, mensagem: msg, conversaId, kitId, ensaioId, anexos });
      if (r.conversa_id) {
        setConversaId(r.conversa_id);
        gravarConversa(clientId, r.conversa_id);
      }
      setMensagens((l) => l.concat([{ id: idLocal(), papel: "agente", texto: r.resposta || "Sem resposta.", sugestoes: r.sugestoes, custo_usd: r.custo_usd, anexos: 0 }]));
    } catch (e) {
      setErro(e);
      setTexto(msg);
    } finally {
      setPendente(null);
      atualizarCusto();
    }
  };

  return (
    <>
      {!aberto && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[72px] z-40 flex justify-center px-4 md:bottom-6" data-agente-diretor="">
          <button
            type="button"
            onClick={() => onAberto(true)}
            className="pointer-events-auto inline-flex h-12 max-w-full items-center rounded-full bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground shadow-xl ring-4 ring-background transition-transform hover:scale-[1.02]"
            aria-label="Abrir o diretor de fotografia"
          >
            {pendente ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <Aperture className="mr-2 h-4 w-4 shrink-0" />}
            <span className="truncate">Diretor de fotografia</span>
            <span className="ml-2 hidden rounded-full bg-primary-foreground/15 px-2 py-0.5 text-[11px] font-medium sm:inline">conversar</span>
          </button>
        </div>
      )}
      <Dialog open={aberto} onOpenChange={onAberto}>
        <DialogContent className="flex h-[92vh] w-[calc(100vw-16px)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:h-[86vh] sm:w-[calc(100vw-48px)]">
          <DialogTitle className="sr-only">Diretor de fotografia</DialogTitle>
          <DialogDescription className="sr-only">Converse com o diretor de fotografia sobre o kit, o ensaio e as fotos do cliente.</DialogDescription>
          <div className="flex min-w-0 items-center border-b border-border px-4 py-3 pr-12">
            <Aperture className="mr-2 h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">Diretor de fotografia</p>
            {mensagens.length > 0 && (
              <button
                type="button"
                className="shrink-0 text-[11.5px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMensagens([]);
                  setConversaId(null);
                  try {
                    window.sessionStorage.removeItem(chaveDaConversa(clientId));
                  } catch {
                    /* nada guardado */
                  }
                }}
              >
                Nova conversa
              </button>
            )}
          </div>
          <Conversa mensagens={mensagens} pendente={pendente} />
          <div className="border-t border-border p-3">
            {!!erro && <AvisoDeErro erro={erro} className="mb-2" />}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mandar();
              }}
              className="relative"
            >
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void mandar();
                  }
                }}
                rows={2}
                placeholder="Ex.: que tomadas fazer para o anúncio do mouse? O que falta fotografar?"
                aria-label="Mensagem ao diretor"
                className="pr-24 text-[13px]"
              />
              <div className="absolute bottom-1.5 right-1.5 flex items-center">
                <Ditado valor={texto} onChange={setTexto} disabled={!!pendente} />
                <Button type="submit" size="sm" className="ml-1 h-8 w-8 p-0" disabled={!texto.trim() || !!pendente} aria-label="Mandar">
                  {pendente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </form>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
              {selecionadas.length > 0 && (
                <label className="mr-3 inline-flex items-center">
                  <input type="checkbox" checked={comFotos} onChange={(e) => setComFotos(e.target.checked)} className="mr-1 h-3 w-3" />
                  <Paperclip className="mr-0.5 h-3 w-3" /> mandar {Math.min(selecionadas.length, MAX_ANEXOS_DO_DIRETOR) === 1 ? "a foto marcada" : `as ${Math.min(selecionadas.length, MAX_ANEXOS_DO_DIRETOR)} primeiras fotos marcadas`} no Acervo
                </label>
              )}
              <span className="mr-3 inline-flex items-center">
                <Sparkles className="mr-1 h-3 w-3" />
                {kitId || ensaioId ? "Com o kit e o ensaio abertos" : "Com o contexto do cliente"}
              </span>
              <EstimativaInline partes={partesDaConversa(catalogo)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
