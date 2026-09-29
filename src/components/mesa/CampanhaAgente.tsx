import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import { Ditado } from "./Ditado";
import { Cronometro } from "./Cronometro";
import type { Campanha, MensagemDoAgente } from "./mesaV4Api";
import {
  aplicarRespostaDaCampanha,
  campanhaConversar,
  chavesDaCampanha,
  lerConversaDaCampanha,
  marcarPedidoDaCampanha,
  partesDaConversaDaCampanha,
  usePedidoDaCampanha,
} from "./campanhasApi";
import { conversa as estiloDaConversa, juntar } from "@/components/sistema/estilos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import AprendizadoNaConversa from "@/components/agentes/AprendizadoNaConversa";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";

/**
 * Agente da campanha (pedido do dono em 23/09, noite): a conversa com o
 * estrategista ao lado da campanha aberta. A equipe pede em português ("mude
 * o tom para mais divertido", "acrescente um conteúdo de depoimento"), anexa
 * imagens ou fala pelo microfone; o agente muda a campanha e os conteúdos e a
 * tela atualiza na hora. Uma conversa por campanha (agente_conversas,
 * referencia_tipo mesa_campanha), lida direto do banco.
 */

export interface RascunhoParaOAgente {
  texto: string;
  /** Sobe a cada pedido novo, para o mesmo texto preencher de novo. */
  vez: number;
}

const ATALHOS = [
  { rotulo: "Mude o período…", texto: "A campanha vai de " },
  { rotulo: "Mude a oferta…", texto: "A oferta agora é " },
  { rotulo: "Mude o tom para…", texto: "Mude o tom para " },
  { rotulo: "Acrescente um conteúdo de…", texto: "Acrescente um conteúdo de " },
  { rotulo: "Troque as cores de apoio", texto: "Troque as cores de apoio por " },
  { rotulo: "Deixe o selo mais…", texto: "Deixe o selo mais " },
];

const imagensDaMensagem = (m: MensagemDoAgente) =>
  (m.anexos || []).map((a) => (a && a.caminho ? String(a.caminho) : "")).filter(Boolean);

const mexeuNosConteudos = (m: MensagemDoAgente) => (m.anexos || []).some((a) => !!(a && a.proposta_id));

function Bolha({ papel, children }: { papel: "usuario" | "agente"; children: ReactNode }) {
  return (
    // Balão do sistema (SISTEMA.md seção 9): 14 px, o mesmo em todo agente.
    <div className={juntar(estiloDaConversa.balao, papel === "usuario" ? estiloDaConversa.doUsuario : estiloDaConversa.doAgente)}>
      {children}
    </div>
  );
}

export default function CampanhaAgente({
  campanha,
  rascunho = null,
  naGaveta = false,
  className = "",
  onAndamento,
}: {
  campanha: Campanha;
  /** Texto que outra parte da tela manda para o campo (ex.: "Ajustar conteúdos"). */
  rascunho?: RascunhoParaOAgente | null;
  /** Dentro da gaveta: o cabeçalho deixa lugar para o botão de fechar. */
  naGaveta?: boolean;
  className?: string;
  /** Avisa quando um pedido começa e termina (o botão da gaveta mostra o andamento). */
  onAndamento?: (andando: boolean) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  // 29/09: o rascunho fica guardado por campanha (fechar a gaveta ou trocar de campanha não apaga o que foi escrito).
  const [texto, setTexto] = useEstadoDaTela(`mesa:campanha:agente:rascunho:${campanha.id}`, "");
  // Fora do componente: remontar (gaveta fechada, outra campanha e volta) não
  // libera um segundo pedido pago enquanto o primeiro trabalha.
  const envio = usePedidoDaCampanha(campanha.id);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLSpanElement>(null);
  const enviados = useRef<string[]>([]);
  const chave = chavesDaCampanha.conversa(clientId, campanha.id);

  const conversa = useQuery({ queryKey: chave, queryFn: () => lerConversaDaCampanha(campanha.id) });
  const mensagens = conversa.data ? conversa.data.mensagens : [];
  const lista = mensagens.filter((m) => m.conteudo || imagensDaMensagem(m).length);

  const preencher = (t: string) => {
    setTexto(t);
    window.setTimeout(() => {
      const el = campoRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(t.length, t.length);
      }
    }, 0);
  };

  useEffect(() => {
    if (rascunho && rascunho.texto) preencher(rascunho.texto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho ? rascunho.vez : 0]);

  // Mensagem nova ou pedido em andamento: desce até o fim da conversa.
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lista.length, !!envio]);

  const enviar = async () => {
    const mensagem = texto.trim();
    const caminhos = anexos.caminhos.slice();
    enviados.current = caminhos;
    const campanhaId = campanha.id;
    marcarPedidoDaCampanha(campanhaId, { mensagem, desde: Date.now() });
    if (onAndamento) onAndamento(true);
    setTexto("");
    try {
      const data = await campanhaConversar({ campanhaId: campanha.id, mensagem, anexos: caminhos });
      // A campanha e os conteúdos mudam na tela antes de o "Trabalhando" sair.
      aplicarRespostaDaCampanha(queryClient, clientId, data);
      await queryClient.invalidateQueries({ queryKey: chave });
      return data;
    } catch (e) {
      setTexto((t) => t || mensagem);
      throw e;
    } finally {
      marcarPedidoDaCampanha(campanhaId, null);
      if (onAndamento) onAndamento(false);
    }
  };

  const concluir = () => {
    anexos.tirarEnviados(enviados.current);
  };

  const podeEnviar = !!texto.trim() && !anexos.subindo && !envio;

  return (
    <div className={`flex min-h-0 min-w-0 flex-col bg-card ${className}`}>
      <div className={`flex shrink-0 items-center border-b border-border py-3 pl-4 ${naGaveta ? "pr-14" : "pr-4"}`}>
        <span className="mr-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">Agente da campanha</span>
          <span className="block truncate text-[11px] text-muted-foreground">{campanha.nome}</span>
        </span>
      </div>

      <div ref={listaRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3" aria-live="polite" aria-label="Conversa com o agente da campanha">
        {conversa.isLoading && (
          <p className="text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
            Lendo a conversa…
          </p>
        )}
        {conversa.isError && <AvisoDeErro erro={conversa.error} />}
        {conversa.data && lista.length === 0 && !envio && (
          <div className="px-1 py-6 text-center">
            <p className="inline-flex items-center text-[13px] font-medium">
              Converse para ajustar a campanha
              <AjudaRecolhida className="ml-1" rotulo="O que dá para pedir">
                Peça mudanças no nome, no conceito, na identidade e nos conteúdos: mudar, acrescentar ou tirar. A tela atualiza na hora.
              </AjudaRecolhida>
            </p>
          </div>
        )}
        {lista.map((m) => {
          if (m.papel === "sistema") {
            return <p key={m.id} className="text-center text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{m.conteudo}</p>;
          }
          const imagens = imagensDaMensagem(m);
          return (
            <div key={m.id} className="min-w-0 space-y-1.5">
              {m.conteudo && (
                <Bolha papel={m.papel === "usuario" ? "usuario" : "agente"}>
                  <p className="whitespace-pre-wrap">{m.conteudo}</p>
                </Bolha>
              )}
              {imagens.length > 0 && (
                <div className="ml-8 flex flex-wrap justify-end">
                  {imagens.map((c) => (
                    <ImagemDaMesa key={c} caminho={c} alt="Imagem anexada" className="mb-1 ml-1 h-12 w-12 rounded-md border border-border" />
                  ))}
                </div>
              )}
              {m.papel === "agente" && mexeuNosConteudos(m) && !acoesDaMensagem(m.anexos).length && (
                <p className="mr-6 text-[11px] text-muted-foreground">Conteúdos atualizados na campanha.</p>
              )}
              {m.papel === "agente" && (
                <div className="mr-6 space-y-1.5">
                  {/* 29/09: o que mudou na campanha, com o antes e o depois e o Desfazer (antes mudava calado). */}
                  {acoesDaMensagem(m.anexos).map((a) => (
                    <CartaoDeAcao
                      key={a.id}
                      acao={a}
                      titulo={a.executada_direto ? "O agente mudou" : "O agente vai mudar"}
                      observacao="Sem custo. Dá para desfazer."
                      onPedido={(p) => chamarAcaoDoAgente("agente-calendario", m.id, a.id, p)}
                      onFeito={() => {
                        void queryClient.invalidateQueries({ queryKey: chave });
                        void queryClient.invalidateQueries({ queryKey: ["mesa", "campanhas", clientId] });
                        if (campanha.proposta_id) void queryClient.invalidateQueries({ queryKey: ["mesa", "proposta-v4", campanha.proposta_id] });
                      }}
                    />
                  ))}
                  <AprendizadoNaConversa anexos={m.anexos} clientId={clientId} />
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
            <div className={juntar(estiloDaConversa.balao, estiloDaConversa.doAgente)}>
              <Cronometro desde={envio.desde} rotulo="Trabalhando na campanha" />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border px-3 pb-3 pt-2.5">
        <div className="flex flex-wrap" role="group" aria-label="Atalhos para o agente">
          {ATALHOS.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => preencher(a.texto)}
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
              ref={campoRef}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl+Enter (ou Cmd+Enter) envia.
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && podeEnviar) {
                  e.preventDefault();
                  const b = botaoRef.current ? botaoRef.current.querySelector("button") : null;
                  if (b) b.click();
                }
              }}
              rows={3}
              aria-label="Pedido ao agente da campanha"
              placeholder="Peça ao agente. Arraste ou cole imagens."
              className="max-h-40 min-h-[64px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="mt-1 flex min-w-0 items-center">
              <BotaoDeAnexar anexos={anexos} className="mr-1.5" />
              <Ditado valor={texto} onChange={setTexto} disabled={!!envio} className="mr-1.5 min-w-0" />
              <span ref={botaoRef} className="ml-auto shrink-0">
                <BotaoComCusto
                  rotulo="Enviar"
                  titulo="Pedido ao agente da campanha"
                  descricao="Uma chamada do estrategista com o contexto do cliente e da campanha."
                  partes={() => partesDaConversaDaCampanha(catalogo, anexos.caminhos.length)}
                  executar={enviar}
                  aoConcluir={concluir}
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
