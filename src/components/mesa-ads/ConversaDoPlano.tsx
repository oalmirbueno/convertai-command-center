import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "@/components/mesa/AnexosDoPedido";
import { Ditado } from "@/components/mesa/Ditado";
import { Cronometro } from "@/components/mesa/Cronometro";
import { chamarAds, chavesAds, lerConversaDoPlano, partesDaConversaDoPlano, type PlanoAds } from "./adsApi";

/**
 * Conversa com o estrategista de ads ao lado do plano (plano_conversar). A
 * equipe pede em português, fala pelo microfone ou anexa prints; o plano
 * muda na tela quando a resposta chega.
 */

const ATALHOS = [
  { rotulo: "Troque o ângulo…", texto: "Troque o ângulo " },
  { rotulo: "Mais um ângulo de prova", texto: "Acrescente um ângulo que use a prova " },
  { rotulo: "Menos risco de política", texto: "Reduza o risco de política do ângulo " },
  { rotulo: "Janela mais curta", texto: "Encurte a janela de teste para " },
];

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

export default function ConversaDoPlano({ plano, className = "" }: { plano: PlanoAds; className?: string }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  const [texto, setTexto] = useState("");
  const [envio, setEnvio] = useState<{ mensagem: string; desde: number } | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(plano.conversa_id);
  const enviados = useRef<string[]>([]);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setConversaId(plano.conversa_id);
  }, [plano.id, plano.conversa_id]);

  const conversa = useQuery({
    queryKey: chavesAds.conversa(plano.id).concat([conversaId || ""]),
    queryFn: () => lerConversaDoPlano(conversaId),
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
      const data = await chamarAds<any>("plano_conversar", { plano_id: plano.id, mensagem, anexos: caminhos.length ? caminhos : undefined });
      if (data && data.conversa_id) setConversaId(String(data.conversa_id));
      await queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
      await queryClient.invalidateQueries({ queryKey: chavesAds.conversa(plano.id) });
      return data;
    } catch (e) {
      setTexto((t) => t || mensagem);
      throw e;
    } finally {
      setEnvio(null);
    }
  };

  const podeEnviar = !!texto.trim() && !anexos.subindo && !envio;

  return (
    <div className={`flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-card ${className}`}>
      <div className="flex shrink-0 items-center border-b border-border px-4 py-3">
        <span className="mr-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">Estrategista de ads</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{plano.nome}</span>
        </span>
      </div>

      <div ref={listaRef} className="min-h-[200px] flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3" aria-live="polite" aria-label="Conversa com o estrategista de ads">
        {conversa.isLoading && (
          <p className="text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Lendo a conversa…
          </p>
        )}
        {conversa.isError && <AvisoDeErro erro={conversa.error} />}
        {conversa.data && mensagens.length === 0 && !envio && (
          <div className="px-1 py-6 text-center">
            <p className="text-[12.5px] font-medium">Ajuste o plano conversando</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Peça outro ângulo, uma prova diferente, menos risco de política ou outra janela. O plano muda na tela.
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
                  {imagens.map((c: string) => <ImagemDaMesa key={c} caminho={c} alt="Imagem anexada" className="mb-1 ml-1 h-12 w-12 rounded-md border border-border" />)}
                </div>
              )}
            </div>
          );
        })}
        {envio && (
          <div className="min-w-0 space-y-2">
            {envio.mensagem && <Bolha papel="usuario"><p className="whitespace-pre-wrap">{envio.mensagem}</p></Bolha>}
            <div className="mr-6 rounded-2xl rounded-bl-md bg-muted px-3 py-2">
              <Cronometro desde={envio.desde} rotulo="Ajustando o plano" />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border px-3 pb-3 pt-2.5">
        <div className="flex flex-wrap" role="group" aria-label="Atalhos para o estrategista">
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
              aria-label="Pedido ao estrategista de ads"
              placeholder="Peça ao estrategista. Arraste ou cole prints."
              className="max-h-40 min-h-[64px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="mt-1 flex min-w-0 items-center">
              <BotaoDeAnexar anexos={anexos} className="mr-1.5" />
              <Ditado valor={texto} onChange={setTexto} disabled={!!envio} className="mr-1.5 min-w-0" />
              <span ref={botaoRef} className="ml-auto shrink-0">
                <BotaoComCusto
                  rotulo="Enviar"
                  titulo="Pedido ao estrategista de ads"
                  descricao="Uma chamada do estrategista com o briefing, as referências em destaque e o plano."
                  partes={() => partesDaConversaDoPlano(catalogo, anexos.caminhos.length)}
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
