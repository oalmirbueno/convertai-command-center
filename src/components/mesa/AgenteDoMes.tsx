import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Sparkles, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import { BlocoDaProposta } from "./ConteudosPropostos";
import { Cronometro } from "./Cronometro";
import { Ditado } from "./Ditado";
import {
  ajustarProposta,
  chaves,
  lerCampanhas,
  lerConversaDoAgente,
  lerHypes,
  lerPropostas,
  pedidoLivre,
  type MensagemDoAgente,
  type PropostaV4,
  partesDoAjuste,
  partesDoPedido,
} from "./mesaV4Api";

/**
 * Agente do mês (pedido do dono em 23/09): a conversa com o estrategista
 * dentro da aba Mês, sempre à mão. A equipe pede em português ("prepare três
 * conteúdos para a campanha X", "a agenda de hoje", "arte de depoimentos com
 * estes prints"), anexa imagens e recebe os conteúdos prontos para gravar.
 * Uma conversa por cliente (agente_conversas, referencia_tipo agente_do_mes),
 * lida direto do banco.
 */

export interface PedidoEmAndamento {
  mensagem: string;
  desde: number;
}

const SEM_CAMPANHA = "nenhuma";

const chaveDasEscondidas = (clientId: string) => `mesa:agente:escondidas:${clientId}`;

function lerEscondidas(clientId: string): string[] {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(chaveDasEscondidas(clientId)) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function gravarEscondidas(clientId: string, lista: string[]) {
  try {
    window.sessionStorage.setItem(chaveDasEscondidas(clientId), JSON.stringify(lista.slice(-200)));
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

const propostasDaMensagem = (m: MensagemDoAgente) =>
  (m.anexos || []).map((a) => (a && a.proposta_id ? String(a.proposta_id) : "")).filter(Boolean);

const imagensDaMensagem = (m: MensagemDoAgente) =>
  (m.anexos || []).map((a) => (a && a.caminho ? String(a.caminho) : "")).filter(Boolean);

function Bolha({ papel, children }: { papel: "usuario" | "agente"; children: ReactNode }) {
  return (
    <div
      className={`min-w-0 rounded-xl px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] ${
        papel === "usuario" ? "ml-8 bg-primary text-primary-foreground" : "mr-4 bg-muted text-foreground"
      }`}
    >
      {children}
    </div>
  );
}

export default function AgenteDoMes({
  onAbrirNoEstudio,
  pendenteExterno = null,
  className = "",
  acaoDoCabecalho = null,
}: {
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
  /** Pedido que outra parte da tela mandou (ex.: "Criar conteúdo" de um hype). */
  pendenteExterno?: PedidoEmAndamento | null;
  className?: string;
  /** Botão extra no cabeçalho (ex.: recolher ou fixar a coluna ao lado). */
  acaoDoCabecalho?: ReactNode;
}) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  const [texto, setTexto] = useState("");
  const [campanhaId, setCampanhaId] = useState(SEM_CAMPANHA);
  const [ajustando, setAjustando] = useState<PropostaV4 | null>(null);
  const [envio, setEnvio] = useState<PedidoEmAndamento | null>(null);
  const [escondidas, setEscondidas] = useState<string[]>(() => lerEscondidas(clientId));
  const [projetoDaResposta, setProjetoDaResposta] = useState<Record<string, string>>({});
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const enviados = useRef<string[]>([]);

  const conversa = useQuery({ queryKey: chaves.conversa(clientId), queryFn: () => lerConversaDoAgente(clientId) });
  const mensagens = conversa.data ? conversa.data.mensagens : [];
  const ids = useMemo(() => {
    const todos: string[] = [];
    mensagens.forEach((m) => propostasDaMensagem(m).forEach((id) => { if (todos.indexOf(id) < 0) todos.push(id); }));
    return todos.sort();
  }, [mensagens]);
  const propostas = useQuery({
    queryKey: chaves.propostas(clientId, ids),
    enabled: ids.length > 0,
    // A chave cresce a cada mensagem nova: as propostas já na tela ficam
    // enquanto a lista nova chega (sem piscar para o esqueleto).
    placeholderData: keepPreviousData,
    queryFn: () => lerPropostas(ids),
  });
  const campanhas = useQuery({ queryKey: chaves.campanhas(clientId), queryFn: () => lerCampanhas(clientId) });
  const hypes = useQuery({ queryKey: chaves.hypes(clientId), queryFn: () => lerHypes(clientId) });

  const porId: Record<string, PropostaV4> = {};
  (propostas.data || []).forEach((p) => { porId[p.id] = p; });
  const campanhasAtivas = (campanhas.data || []).filter((c) => c.status !== "encerrada");
  const campanhaEscolhida = campanhasAtivas.find((c) => c.id === campanhaId) || null;

  const andamento = envio || pendenteExterno;

  // Mensagem nova ou pedido em andamento: desce até o fim da conversa.
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, !!andamento, propostas.data]);

  const esconder = (id: string) => {
    const nova = escondidas.concat([id]);
    setEscondidas(nova);
    gravarEscondidas(clientId, nova);
  };
  const mostrar = (id: string) => {
    const nova = escondidas.filter((x) => x !== id);
    setEscondidas(nova);
    gravarEscondidas(clientId, nova);
  };

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

  const topoDosHypes = hypes.data && hypes.data.itens.length ? hypes.data.itens[0] : null;
  const atalhos = [
    { rotulo: "Prepare a agenda de hoje", texto: "Prepare a agenda de hoje." },
    {
      rotulo: "3 conteúdos para a campanha…",
      texto: campanhaEscolhida ? `Prepare 3 conteúdos para a campanha ${campanhaEscolhida.nome}.` : "Prepare 3 conteúdos para a campanha ",
    },
    { rotulo: "Arte de depoimentos com estes prints", texto: "Faça uma arte de depoimentos de clientes com estes prints das avaliações do Google, transcrevendo as falas como estão." },
    {
      rotulo: "Um conteúdo sobre o hype da semana",
      texto: topoDosHypes ? `Um conteúdo sobre o hype da semana "${topoDosHypes.titulo}".${topoDosHypes.como_usar ? ` ${topoDosHypes.como_usar}` : ""}` : "Um conteúdo sobre o hype da semana que mais combina com este cliente.",
    },
  ];

  const partes = () => (ajustando ? partesDoAjuste(catalogo) : partesDoPedido(catalogo, anexos.caminhos.length));

  const enviar = async () => {
    const mensagem = texto.trim();
    const caminhos = anexos.caminhos.slice();
    enviados.current = caminhos;
    setEnvio({ mensagem, desde: Date.now() });
    setTexto("");
    try {
      const data = ajustando
        ? await ajustarProposta(ajustando.id, mensagem)
        : await pedidoLivre({ clientId, mensagem, anexos: caminhos, campanhaId: campanhaEscolhida ? campanhaEscolhida.id : null });
      // A resposta entra na conversa antes de o "Preparando" sair da tela.
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return data;
    } catch (e) {
      setTexto((t) => t || mensagem);
      throw e;
    } finally {
      setEnvio(null);
    }
  };

  const concluir = (data: any) => {
    anexos.tirarEnviados(enviados.current);
    setAjustando(null);
    const p = data && data.proposta;
    if (p && p.id) {
      queryClient.setQueryData(chaves.proposta(p.id), p);
      if (data.project_id) setProjetoDaResposta((m) => ({ ...m, [p.id]: String(data.project_id) }));
    }
  };

  const lista = mensagens.filter((m) => m.conteudo || propostasDaMensagem(m).length || imagensDaMensagem(m).length);

  return (
    <div className={`flex min-h-0 min-w-0 flex-col bg-card ${className}`}>
      <div className="flex shrink-0 items-center border-b border-border px-4 py-3">
        <Sparkles className="mr-2 h-4 w-4 shrink-0 text-primary" />
        <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold" title="Peça em português o que preparar; os conteúdos chegam prontos para gravar na agenda.">
          Agente do mês
        </h2>
        {acaoDoCabecalho}
      </div>

      <div ref={listaRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {conversa.isLoading && <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Lendo a conversa…</p>}
        {conversa.isError && <AvisoDeErro erro={conversa.error} />}
        {conversa.data && lista.length === 0 && !andamento && (
          <p className="py-6 text-center text-[12.5px] leading-relaxed text-muted-foreground">
            Peça o que o mês precisa. Os conteúdos chegam prontos para gravar na agenda.
          </p>
        )}
        {lista.map((m) => {
          if (m.papel === "sistema") {
            return <p key={m.id} className="text-center text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{m.conteudo}</p>;
          }
          const imagens = imagensDaMensagem(m);
          const idsDaMsg = propostasDaMensagem(m);
          return (
            <div key={m.id} className="min-w-0 space-y-2">
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
              {idsDaMsg.map((id) => {
                const p = porId[id];
                if (!p) {
                  return propostas.isLoading ? <div key={id} className="h-20 animate-pulse rounded-lg bg-muted" /> : null;
                }
                if (p.status === "descartada") return null;
                if (escondidas.indexOf(id) >= 0) {
                  return (
                    <button key={id} type="button" onClick={() => mostrar(id)} className="inline-flex items-center text-[11.5px] text-muted-foreground hover:text-foreground">
                      <Eye className="mr-1 h-3 w-3" /> Proposta escondida · mostrar
                    </button>
                  );
                }
                return (
                  <BlocoDaProposta
                    key={id}
                    proposta={p}
                    projetoSugerido={projetoDaResposta[id] || null}
                    onAjustar={() => {
                      setAjustando(p);
                      window.setTimeout(() => campoRef.current && campoRef.current.focus(), 0);
                    }}
                    onDescartar={() => esconder(id)}
                    onAbrirNoEstudio={onAbrirNoEstudio}
                  />
                );
              })}
            </div>
          );
        })}
        {andamento && (
          <div className="min-w-0 space-y-2">
            {andamento.mensagem && (
              <Bolha papel="usuario"><p className="whitespace-pre-wrap">{andamento.mensagem}</p></Bolha>
            )}
            <div className="mr-4 rounded-xl bg-muted px-3 py-2">
              <Cronometro desde={andamento.desde} rotulo="Preparando" />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border px-3 pb-3 pt-2.5">
        {!ajustando && (
          <div className="flex flex-wrap" role="group" aria-label="Atalhos de pedido">
            {atalhos.map((a) => (
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
        )}
        <ZonaDeAnexos anexos={anexos}>
          <div className="rounded-xl border border-border bg-background p-2 focus-within:border-primary/60">
            {ajustando && (
              <div className="mb-1.5 flex min-w-0 items-center rounded-md bg-muted px-2 py-1 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate">
                  Ajustando: {(ajustando.itens || []).map((i) => i.tema).filter(Boolean).join(", ") || "a proposta"}
                </span>
                <button type="button" onClick={() => setAjustando(null)} aria-label="Cancelar ajuste" className="ml-1 shrink-0 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {!ajustando && <MiniaturasDosAnexos anexos={anexos} />}
            <Textarea
              ref={campoRef}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={3}
              aria-label="Pedido ao agente do mês"
              placeholder={ajustando ? "O que mudar nestes conteúdos?" : "Peça ao agente. Arraste ou cole imagens e prints."}
              className="min-h-[64px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="mt-1 flex min-w-0 items-center">
              {!ajustando && <BotaoDeAnexar anexos={anexos} className="mr-1.5" />}
              {!ajustando && campanhasAtivas.length > 0 && (
                <Select value={campanhaEscolhida ? campanhaEscolhida.id : SEM_CAMPANHA} onValueChange={setCampanhaId}>
                  <SelectTrigger className="mr-1.5 h-8 min-w-0 flex-1 text-[11.5px]" aria-label="Campanha do pedido">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CAMPANHA}>Sem campanha</SelectItem>
                    {campanhasAtivas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <div className="ml-auto flex shrink-0 items-center">
                {/* Falar em vez de digitar: o texto vai aparecendo no campo enquanto a pessoa fala. */}
                <Ditado valor={texto} onChange={setTexto} disabled={!!envio} className="mr-1.5" />
                <BotaoComCusto
                  rotulo={ajustando ? "Ajustar" : "Enviar"}
                  titulo={ajustando ? "Ajuste dos conteúdos" : "Pedido ao agente do mês"}
                  descricao="Uma chamada do estrategista com o contexto do cliente."
                  partes={partes}
                  executar={enviar}
                  aoConcluir={concluir}
                  disabled={!texto.trim() || anexos.subindo || !!envio}
                  className="h-8"
                />
              </div>
            </div>
          </div>
        </ZonaDeAnexos>
      </div>
    </div>
  );
}
