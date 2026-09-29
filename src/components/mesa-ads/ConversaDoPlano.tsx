import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { esquecerRegraAprendida, guardarRegraAprendida } from "@/lib/agentes/aprendizadoDoLancador";
import { Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "@/components/mesa/AnexosDoPedido";
import { Ditado } from "@/components/mesa/Ditado";
import { Cronometro } from "@/components/mesa/Cronometro";
import PainelDoAgente, { BalaoDaConversa } from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { chamarAds, chavesAds, lerConversaDoPlano, partesDaConversaDoPlano, type PlanoAds } from "./adsApi";

/**
 * Conversa com o estrategista de ads ao lado do plano (plano_conversar). A
 * equipe pede em português, fala pelo microfone ou anexa prints; o plano
 * muda na tela quando a resposta chega.
 *
 * 26/09 (sistema de design): é a lateral fixa do Plano de teste
 * (AreaDeTrabalho + PainelDoAgente): cabeçalho e campo sempre à vista, só a
 * conversa rola. O rascunho fica lembrado por plano.
 */

const ATALHOS = [
  { rotulo: "Troque o ângulo…", texto: "Troque o ângulo " },
  { rotulo: "Mais um ângulo de prova", texto: "Acrescente um ângulo que use a prova " },
  { rotulo: "Menos risco de política", texto: "Reduza o risco de política do ângulo " },
  { rotulo: "Janela mais curta", texto: "Encurte a janela de teste para " },
];

/** Balão da conversa: o do sistema (14 px, linha 1,6), sem balão feito à mão. */
function Bolha({ papel, children }: { papel: "usuario" | "agente"; children: ReactNode }) {
  return <BalaoDaConversa de={papel}>{children}</BalaoDaConversa>;
}

export default function ConversaDoPlano({ plano, className = "" }: { plano: PlanoAds; className?: string }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  const [texto, setTexto] = useEstadoDaTela(`mesa-ads:plano:conversa:rascunho:${clientId}:${plano.id}`, "");
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
    <PainelDoAgente
      className={className}
      titulo="Estrategista de ads"
      descricao={plano.nome}
      icone={<Sparkles className="h-4 w-4" />}
      acoes={
        <AjudaRecolhida rotulo="Como ajustar o plano conversando">
          Peça outro ângulo, uma prova diferente, menos risco de política ou outra janela. O plano muda na tela quando a resposta chega.
        </AjudaRecolhida>
      }
      refDasMensagens={listaRef}
      rotuloDasMensagens="Conversa com o estrategista de ads"
      compositor={
        <>
          <div className="flex min-w-0 flex-wrap" role="group" aria-label="Atalhos para o estrategista">
            {ATALHOS.map((a) => (
              <button
                key={a.rotulo}
                type="button"
                onClick={() => setTexto(a.texto)}
                className={juntar("mb-1 mr-1 max-w-full truncate rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground", foco)}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          <ZonaDeAnexos anexos={anexos}>
            <div className="rounded-md border border-input bg-background p-2 focus-within:border-primary/60">
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
      {conversa.data && mensagens.length === 0 && !envio && (
        <div className="px-1 py-6 text-center">
          <p className="text-[13px] font-medium">Ajuste o plano conversando</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Outro ângulo, outra prova, menos risco ou outra janela.</p>
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
            {/* Frente AG3: "Aprendi" (com Esquecer) e "Segui" do agente de tráfego. */}
            {m.papel === "agente" && (
              <div className="ml-8">
                <AprendizadoDoAgente
                  anexos={m.anexos}
                  onEsquecer={(id) => esquecerRegraAprendida("mesa-ads", id, { client_id: clientId })}
                  onGuardar={(texto, tipo) => guardarRegraAprendida("mesa-ads", { texto, categoria: tipo }, { client_id: clientId })}
                />
              </div>
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
          <BalaoDaConversa de="agente">
            <Cronometro desde={envio.desde} rotulo="Ajustando o plano" />
          </BalaoDaConversa>
        </div>
      )}
    </PainelDoAgente>
  );
}
