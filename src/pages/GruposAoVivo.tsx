import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, FileText, Image as ImageIcon, MessageCircle, Mic, RefreshCw, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import {
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  FaixaDeNumeros,
  JanelaCentral,
  botao,
  espaco,
  etiqueta,
  juntar,
  larguraDaMesa,
  lista,
  texto,
} from "@/components/sistema";
import {
  ROTULO_DO_ITEM,
  ROTULO_DO_PAPEL,
  duracao,
  haQuanto,
  itensPorTipo,
  linhaDaMensagem,
  normalizarGrupos,
  numerosDosGrupos,
  ordenarGrupos,
  tomDaEspera,
  type GrupoDoCliente,
  type GruposAoVivo as Leitura,
  type MensagemDoGrupo,
  type TomDaEspera,
} from "@/lib/gruposAoVivo";

/*
 * Grupos dos clientes (18/11/2026). Dono: "quero ver os grupos sempre
 * atualizados, entender o que eu envio e como eu respondo".
 * - Topo: quem espera resposta, mensagens de hoje, o tempo de resposta da
 *   agência na semana e a saúde do resumo.
 * - Uma linha por grupo: quem espera resposta vem primeiro, com o que o
 *   cliente disse e há quanto tempo.
 * - Clicar abre a janela do grupo: o resumo do dia (pedidos, promessas,
 *   decisões) e a conversa dos últimos 3 dias, com áudio transcrito e imagem
 *   descrita.
 * A tela só lê. A leitura se refaz sozinha a cada minuto.
 */

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaCurto = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
const diaDoResumo = (dia: string) => { const [, m, d] = dia.split("-"); return `${d}/${m}`; };

const TOM: Record<TomDaEspera, string> = {
  calmo: "bg-muted text-muted-foreground",
  atencao: "bg-warning-soft text-warning",
  urgente: "bg-danger-soft text-destructive",
};

function useGrupos() {
  return useQuery({
    queryKey: ["grupos-ao-vivo"],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Leitura> => {
      const { data, error } = await (supabase as any).rpc("grupos_ao_vivo");
      if (error) throw new Error(error.message);
      return normalizarGrupos(data);
    },
  });
}

/** O relógio da tela: as esperas ("há 12 min") andam sem esperar a próxima leitura. */
function useAgora() {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

function IconeDoTipo({ tipo }: { tipo: string }) {
  const classe = "mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground";
  if (tipo === "audio") return <Mic className={classe} aria-label="Áudio transcrito" />;
  if (tipo === "imagem") return <ImageIcon className={classe} aria-label="Imagem" />;
  if (tipo === "video") return <Video className={classe} aria-label="Vídeo" />;
  if (tipo === "documento") return <FileText className={classe} aria-label="Documento" />;
  return null;
}

function Conversa({ mensagens }: { mensagens: MensagemDoGrupo[] }) {
  // Da mais nova para a mais antiga: o que interessa é o agora, e a janela abre no topo.
  const visiveis = mensagens.filter((m) => m.papel !== "automatico").reverse();
  if (visiveis.length === 0) return <EstadoVazio compacto titulo="Sem conversa nos últimos 3 dias." />;
  let diaAnterior = "";
  return (
    <ol className="space-y-2.5" aria-label="Conversa dos últimos 3 dias" title="Da mensagem mais nova para a mais antiga">
      {visiveis.map((m) => {
        const dia = diaCurto(m.quando);
        const mudouODia = dia !== diaAnterior;
        diaAnterior = dia;
        const daAgencia = m.papel === "agencia";
        return (
          <li key={m.id}>
            {mudouODia && <p className={juntar(texto.auxiliar, "mb-2 mt-4 text-center first:mt-0")}>{dia}</p>}
            <div className={juntar("flex min-w-0", daAgencia ? "justify-end" : "justify-start")}>
              <div className={juntar("min-w-0 max-w-[86%] rounded-2xl px-3.5 py-2", daAgencia ? "bg-primary/10" : "bg-muted/70", m.ruido && "opacity-60")}>
                <p className={juntar(texto.etiqueta, "text-muted-foreground")}>
                  {daAgencia ? ROTULO_DO_PAPEL.agencia : m.nome || ROTULO_DO_PAPEL[m.papel]} · {hora(m.quando)}
                </p>
                <p className={juntar(texto.corpo, "whitespace-pre-wrap [overflow-wrap:anywhere]")}>
                  <IconeDoTipo tipo={m.tipo} />
                  {m.texto || (m.descricao ? "" : linhaDaMensagem(m))}
                </p>
                {m.descricao && (
                  <p className={juntar(texto.auxiliar, "mt-1 leading-5 [overflow-wrap:anywhere]")} title="Leitura automática do arquivo: confira preço, data e nome">
                    {m.descricao}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ResumoDoDia({ g }: { g: GrupoDoCliente }) {
  const r = g.resumo;
  if (!r) {
    return <EstadoVazio compacto titulo={g.resumoFalhouHoje ? "O resumo de hoje não pôde ser escrito." : "Sem resumo nos últimos dias."} descricao={g.resumoFalhouHoje ? "A conversa está na outra aba; o resumo se refaz sozinho na próxima rodada." : undefined} />;
  }
  const grupos = itensPorTipo(r.itens);
  return (
    <div className="space-y-5">
      {g.resumoFalhouHoje && (
        <p className={juntar(texto.auxiliar, "flex items-center text-warning")}>
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />O resumo de hoje ainda não saiu; este é o de {diaDoResumo(r.dia)}.
        </p>
      )}
      {r.resumo && <p className={juntar(texto.corpo, "leading-6")}>{r.resumo}</p>}
      {grupos.map((grupo) => (
        <section key={grupo.tipo} aria-label={ROTULO_DO_ITEM[grupo.tipo]}>
          <h3 className={texto.rotulo}>{ROTULO_DO_ITEM[grupo.tipo]}</h3>
          <ul className="mt-1.5 space-y-1.5">
            {grupo.itens.map((i, n) => (
              <li key={n} className={juntar(texto.corpo, "flex min-w-0")}>
                <span aria-hidden="true" className="mr-2 mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {i.texto}
                  {i.veioDeAudio && <Mic className="ml-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" aria-label="Veio de áudio transcrito: confira nomes e valores" />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {r.sugestoes.length > 0 && (
        <section aria-label="Sugestões">
          <h3 className={texto.rotulo}>Sugestões</h3>
          <ul className="mt-1.5 space-y-1.5">
            {r.sugestoes.map((s, n) => <li key={n} className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{s}</li>)}
          </ul>
        </section>
      )}
      {grupos.length === 0 && !r.resumo && <p className={texto.auxiliar}>O dia {diaDoResumo(r.dia)} não trouxe pedido, promessa nem decisão.</p>}
    </div>
  );
}

type Aba = "resumo" | "conversa";

export default function GruposAoVivo() {
  const q = useGrupos();
  const agora = useAgora();
  const identidades = useIdentidadesDosClientes();
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("resumo");

  const grupos = useMemo(() => ordenarGrupos(q.data?.clientes ?? []), [q.data]);
  const numeros = useMemo(() => numerosDosGrupos(grupos), [grupos]);
  const aberto = grupos.find((g) => g.clientId === abertoId) ?? null;
  const saude = q.data?.saude;
  const abrir = (g: GrupoDoCliente) => { setAba(g.esperandoDesde ? "conversa" : "resumo"); setAbertoId(g.clientId); };

  const estado = q.isLoading
    ? " "
    : `Atualizado ${q.dataUpdatedAt ? hora(new Date(q.dataUpdatedAt).toISOString()) : ""} · ${numeros.esperando === 0 ? "ninguém esperando resposta" : numeros.esperando === 1 ? "1 grupo esperando resposta" : `${numeros.esperando} grupos esperando resposta`}`;

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-grupos-ao-vivo="">
      <CabecalhoDePagina
        titulo="Grupos dos clientes"
        descricao={estado}
        ajuda="Os grupos de WhatsApp dos clientes, lidos pelo número da equipe (só leitura). Espera resposta o grupo em que a última palavra é do cliente e ninguém da agência respondeu; bom dia e emoji não contam. O tempo de resposta é o tempo entre o cliente falar e a agência responder, nos últimos 7 dias. Áudio vem transcrito e imagem e vídeo vêm descritos por leitura automática: confira preço, data e nome antes de usar. A tela se atualiza sozinha a cada minuto."
        acoes={
          <button type="button" className={botao.icone} onClick={() => void q.refetch()} aria-label="Atualizar agora" title="Atualizar agora">
            <RefreshCw className={juntar("h-4 w-4", q.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          </button>
        }
      />

      {q.isLoading ? <Carregando rotulo="Lendo os grupos" linhas={6} />
        : q.error ? <EstadoDeErro titulo="Não foi possível ler os grupos." descricao={(q.error as Error).message} />
        : !q.data?.disponivel ? <EstadoVazio icone={<MessageCircle className="h-5 w-5" />} titulo="A leitura dos grupos não está ligada neste ambiente." />
        : (
          <>
            <FaixaDeNumeros
              rotulo="Os grupos agora"
              itens={[
                { rotulo: "Esperando resposta", valor: numeros.esperando, ponto: numeros.esperando ? "alerta" : "verde", apoio: numeros.esperando ? "a última palavra é do cliente" : "tudo respondido" },
                { rotulo: "Mensagens hoje", valor: numeros.mensagensHoje, apoio: saude?.ultimaMensagem ? `última ${haQuanto(saude.ultimaMensagem, agora)}` : "nenhuma ainda" },
                { rotulo: "Você responde em", valor: duracao(numeros.respostaMin), apoio: `${numeros.respondidas} de ${numeros.conversas} conversas na semana` },
                {
                  rotulo: "Resumo do dia",
                  valor: saude && saude.resumosComFalha > 0 ? "Parado" : "Em dia",
                  ponto: saude && saude.resumosComFalha > 0 ? "perigo" : "verde",
                  corDoValor: saude && saude.resumosComFalha > 0 ? "text-destructive" : undefined,
                  apoio: saude?.ultimoResumo ? `último ${haQuanto(saude.ultimoResumo, agora)}` : "ainda sem resumo",
                  dica: saude && saude.resumosComFalha > 0 ? "O modelo que escreve o resumo não respondeu (quase sempre é falta de crédito). A leitura das mensagens continua." : undefined,
                },
              ]}
            />

            {grupos.length === 0 ? <EstadoVazio titulo="Nenhum grupo com leitura ligada." />
              : (
                <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Grupos dos clientes">
                  {grupos.map((g) => {
                    const tom = tomDaEspera(g.esperandoDesde, agora);
                    const ultima = [g.ultimaDoCliente, g.ultimaDaAgencia].filter(Boolean).sort().pop() ?? null;
                    return (
                      <li key={g.clientId}>
                        <button type="button" onClick={() => abrir(g)} className={juntar(lista.linha, "w-full text-left")} title={`Abrir o grupo de ${g.cliente}`}>
                          <LogoDoCliente url={identidades.data?.get(g.clientId)?.profile_picture_url ?? null} clienteId={g.clientId} nome={g.cliente} tamanho={36} className="mr-3" />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center">
                              <span className={juntar(texto.corpo, "truncate font-medium")}>{g.cliente}</span>
                              {g.esperandoDesde && (
                                <span className={juntar(etiqueta, TOM[tom], "ml-2")}>
                                  <Clock className="mr-1 h-3 w-3" aria-hidden="true" />espera {haQuanto(g.esperandoDesde, agora)}
                                </span>
                              )}
                            </span>
                            <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                              {g.esperandoDesde
                                ? `${g.esperandoQuem || "Cliente"}: ${g.esperandoTexto || "mensagem sem texto"}`
                                : ultima ? `Respondido · última conversa ${haQuanto(ultima, agora)}` : "Sem conversa na semana"}
                            </span>
                          </span>
                          <span className={juntar(texto.auxiliar, "ml-3 hidden shrink-0 text-right tabular-nums sm:block")}>
                            <span className="block">{g.mensagensHoje} hoje</span>
                            <span className="block">{g.medianaRespostaMin === null ? "sem conversa" : `resposta em ${duracao(g.medianaRespostaMin)}`}</span>
                          </span>
                          {!g.esperandoDesde && <CheckCircle2 className="ml-3 h-4 w-4 shrink-0 text-success" aria-label="Respondido" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
          </>
        )}

      <JanelaCentral
        aberta={aberto !== null}
        onMudar={(v) => { if (!v) setAbertoId(null); }}
        titulo={aberto?.cliente ?? "Grupo"}
        icone={<MessageCircle className="h-4 w-4" />}
        descricao={aberto ? (aberto.esperandoDesde ? `Esperando resposta ${haQuanto(aberto.esperandoDesde, agora)}` : `Respondido · ${aberto.tarefasAbertas} ${aberto.tarefasAbertas === 1 ? "tarefa aberta" : "tarefas abertas"} vindas do grupo`) : undefined}
        largura="lg"
        abaixoDoTitulo={
          <div className="flex gap-1.5" role="tablist" aria-label="O que ver do grupo">
            {(["resumo", "conversa"] as Aba[]).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={juntar(aba === id ? botao.primario : botao.discreto, "h-8")}>
                {id === "resumo" ? "Resumo" : "Conversa"}
              </button>
            ))}
          </div>
        }
      >
        {aberto && (aba === "resumo" ? <ResumoDoDia g={aberto} /> : <Conversa mensagens={aberto.mensagens} />)}
      </JanelaCentral>
    </div>
  );
}
