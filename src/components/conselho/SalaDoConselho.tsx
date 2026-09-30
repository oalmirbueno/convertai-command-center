import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Download, FileText, Loader2, MessageSquare, Plus, Send, Square, Undo2, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BalaoDaConversa, CabecalhoDoAgente, CompositorDoAgente, MensagensDoAgente } from "@/components/sistema/PainelDoAgente";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import Secao from "@/components/sistema/Secao";
import Etapas from "@/components/sistema/Etapas";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, conversa, juntar, lista, superficie, texto } from "@/components/sistema/estilos";
import { useCatalogo } from "@/components/mesa/MesaContexto";
import { dataEHora, ErroDaMesa, nomeDoModelo, textoDoErro, usd } from "@/lib/mesa/api";
import {
  ataEmPdf,
  chamarConselho,
  type FalaDoConselho,
  mediasRecebidas,
  NOME_DA_ETAPA,
  NOME_DO_NIVEL,
  NOME_DO_STATUS,
  nomeDe,
  planoDasEtapas,
  type SessaoDoConselho,
  sessaoAtiva,
  useSessaoDoConselho,
} from "@/lib/conselho/api";

const ConvocarConselho = lazy(() => import("./ConvocarConselho"));

/**
 * Sala do Conselho (frente CNS, 30/09). Abre de qualquer mesa pelo
 * BotaoDoConselho, com o tema pré-preenchido pelo contexto da tela.
 *
 * - Mesa redonda: cada especialista numa cadeira, com o modelo dele, quem
 *   está falando agora, a nota média que a proposta recebeu e a preferida.
 * - Rodadas: propostas independentes, crítica cruzada (notas 1 a 10),
 *   revisão e consolidação; cada rodada abre para ler quem disse o quê.
 * - Resultado: consenso medido pelo Jev, ranking, divergências SEMPRE à
 *   vista, recomendação com o porquê e o que ficou em aberto.
 * - O dono decide (Confirmar grava a ata no cérebro do cliente; Desfazer
 *   marca como desfeita). Quando a recomendação tem ação, vira cartão com
 *   Confirmar para levar à mesa de origem.
 * - Conversa: pergunta direta a um especialista, com o custo antes; a
 *   mensagem que falha volta ao campo.
 * - Nova rodada: só com o custo antes e Confirmar (no máximo 2 por sessão).
 */
export default function SalaDoConselho({
  aberto,
  onFechar,
  clientId,
  origem,
  tema,
  contexto,
  referencia,
  onUsar,
  rotuloDoUsar = "Levar para a mesa",
}: {
  aberto: boolean;
  onFechar: () => void;
  clientId: string;
  /** De onde abriu: mesa-contexto, mesa-mes, mesa-roteiros... (escolhe o elenco sugerido). */
  origem: string;
  tema: string;
  contexto?: string;
  referencia?: Record<string, unknown> | null;
  /** A mesa de origem recebe o pedido pronto da recomendação (ex.: vai para o campo do agente dela). */
  onUsar?: (texto: string) => void;
  rotuloDoUsar?: string;
}) {
  const [sessaoId, setSessaoId, esquecerSessao] = useEstadoDaTela<string>(`conselho:${origem}:${clientId}:sessao`, "", {
    validar: (v) => typeof v === "string",
  });
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent
        className="flex h-[92vh] w-[calc(100vw-16px)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:h-[86vh] sm:w-[calc(100vw-48px)]"
        // Sem o anel de foco na região inteira ao abrir: quem usa teclado segue pelo Tab.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          const alvo = e.target as HTMLElement | null;
          if (alvo && typeof alvo.closest === "function" && alvo.closest("[data-sonner-toaster]")) e.preventDefault();
        }}
        data-sala-do-conselho=""
      >
        <style>{"[data-sonner-toaster]{pointer-events:auto}"}</style>
        <DialogTitle className="sr-only">Conselho de agentes</DialogTitle>
        <DialogDescription className="sr-only">Especialistas debatem em rodadas e chegam a uma recomendação com consenso medido.</DialogDescription>
        {sessaoId ? (
          <SessaoAberta
            key={sessaoId}
            sessaoId={sessaoId}
            onVoltar={esquecerSessao}
            onUsar={onUsar ? (t) => {
              onUsar(t);
              onFechar();
            } : undefined}
            rotuloDoUsar={rotuloDoUsar}
          />
        ) : (
          <>
            {/* pr-12: o botão de fechar da janela fica no canto de cima, à direita. */}
            <CabecalhoDoAgente titulo="Conselho" descricao={tema || "Nova sessão"} icone={<Users className="h-4 w-4" />} className="pr-12" />
            <RegiaoRolavel modo="sempre" rotulo="Convocar o conselho" className="px-4 py-4 sm:px-5">
              <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo o conselho" />}>
                <ConvocarConselho clientId={clientId} origem={origem} temaInicial={tema} contextoInicial={contexto} referencia={referencia} onAbrir={setSessaoId} />
              </Suspense>
            </RegiaoRolavel>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ sessão aberta

function SessaoAberta({
  sessaoId,
  onVoltar,
  onUsar,
  rotuloDoUsar,
}: {
  sessaoId: string;
  onVoltar: () => void;
  onUsar?: (texto: string) => void;
  rotuloDoUsar: string;
}) {
  const qc = useQueryClient();
  const { sessao: consulta, falas: consultaFalas } = useSessaoDoConselho(sessaoId);
  const catalogo = useCatalogo();
  const [parando, setParando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [conversaCom, setConversaCom] = useState<string>("");

  const s = consulta.data;
  const falas = consultaFalas.data || [];
  const reler = () => {
    void qc.invalidateQueries({ queryKey: ["conselho", "sessao", sessaoId] });
    void qc.invalidateQueries({ queryKey: ["conselho", "falas", sessaoId] });
    void qc.invalidateQueries({ queryKey: ["conselho", "sessoes"] });
    void qc.invalidateQueries({ queryKey: ["mesa", "consumo"] });
  };

  if (consulta.isLoading) return <Carregando forma="aba" rotulo="Abrindo a sessão" className="p-5" />;
  if (consulta.isError || !s) {
    return (
      <div className="p-5">
        <EstadoDeErro
          titulo="A sessão não abriu."
          descricao={consulta.isError ? textoDoErro(consulta.error) : "Ela não existe mais ou você não tem acesso."}
          acao={<button type="button" className={botao.secundario} onClick={onVoltar}>Voltar</button>}
        />
      </div>
    );
  }

  const rotuloDoModelo = (id: string) => {
    const m = (catalogo.data || []).find((x) => x.id === id);
    return m ? nomeDoModelo(m) : id;
  };

  const parar = async () => {
    setParando(true);
    try {
      await chamarConselho({ acao: "parar", sessao_id: s.id });
      toast.success("Conselho parado. O que já foi dito ficou guardado.");
      reler();
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setParando(false);
    }
  };

  const baixarAta = async () => {
    setBaixando(true);
    try {
      const r = await chamarConselho<{ ata: string; nome_do_arquivo: string }>({ acao: "ata", sessao_id: s.id });
      const url = URL.createObjectURL(new Blob([r.ata], { type: "text/markdown;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.nome_do_arquivo || "ata-do-conselho.md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setBaixando(false);
    }
  };

  // Frente BRF2: a ata em PDF (pdf-base), guardada em Arquivos; o link abre no clique do aviso.
  const pdfDaAta = async () => {
    setGerandoPdf(true);
    try {
      const r = await ataEmPdf(s.id);
      toast.success(r.ja_existia ? "Esta ata já estava em Arquivos." : "Ata em PDF salva em Arquivos, Documentos operacionais.", {
        action: r.url ? { label: "Abrir", onClick: () => window.open(r.url as string, "_blank", "noopener") } : undefined,
      });
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível gerar o PDF da ata."));
    } finally {
      setGerandoPdf(false);
    }
  };

  const etapas = planoDasEtapas(s.rodadas, s.rodadas_extras);
  const ativo = sessaoAtiva(s);
  const linha = `${NOME_DO_STATUS[s.status]} · rodada ${Math.min(s.rodada_atual, etapas.length)} de ${etapas.length} · ${usd(s.custo_usd)} de ${usd(s.teto_usd)}`;

  return (
    <JanelaDaSessao>
      <CabecalhoDoAgente
        titulo={s.tema}
        descricao={linha}
        icone={<Users className="h-4 w-4" />}
        className="pr-12"
        acoes={
          <>
            <button type="button" className={botao.icone} onClick={onVoltar} aria-label="Outras sessões e nova sessão" title="Outras sessões">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={botao.icone} onClick={() => void baixarAta()} disabled={baixando} aria-label="Baixar a ata" title="Baixar a ata">
              {baixando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" className={botao.icone} onClick={() => void pdfDaAta()} disabled={gerandoPdf} aria-label="Ata em PDF" title="Ata em PDF (vai para Arquivos)">
              {gerandoPdf ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
            </button>
            {ativo && (
              <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => void parar()} disabled={parando} aria-label="Parar o conselho">
                {parando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                Parar
              </button>
            )}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden">
        <RegiaoRolavel modo="lg" rotulo="Rodadas do conselho" className="space-y-6 px-4 py-4 sm:px-5">
          <MesaRedonda sessao={s} falas={falas} rotuloDoModelo={rotuloDoModelo} onConversar={setConversaCom} />
          <Rodadas sessao={s} falas={falas} />
          {s.status === "erro" && (
            <EstadoDeErro titulo="O conselho parou." descricao={s.erro_mensagem || "Erro no servidor."} />
          )}
          {s.status === "teto" && <p className="text-[13px] text-amber-600 dark:text-amber-400" role="status">{s.aviso || "O conselho parou no teto de custo."}</p>}
          {s.resultado && <Resultado sessao={s} falas={falas} onRelido={reler} onUsar={onUsar} rotuloDoUsar={rotuloDoUsar} />}
        </RegiaoRolavel>
        <ConversaComOConselho sessao={s} falas={falas} com={conversaCom} onCom={setConversaCom} onRelido={reler} />
      </div>
    </JanelaDaSessao>
  );
}

/**
 * O corpo da janela do conselho (vive dentro do DialogContent da Sala): no
 * celular a janela inteira rola numa região só; do notebook para cima, as
 * rodadas e a conversa rolam cada uma por dentro, lado a lado.
 */
function JanelaDaSessao({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ------------------------------------------------------------------ mesa redonda

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter((p) => p.length > 2 || p === nome)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("") || nome.charAt(0).toUpperCase();

function MesaRedonda({
  sessao,
  falas,
  rotuloDoModelo,
  onConversar,
}: {
  sessao: SessaoDoConselho;
  falas: FalaDoConselho[];
  rotuloDoModelo: (id: string) => string;
  onConversar: (id: string) => void;
}) {
  const etapas = planoDasEtapas(sessao.rodadas, sessao.rodadas_extras);
  const etapaAtual = etapas[sessao.rodada_atual - 1] || "consolidacao";
  const ultimaCritica = falas.filter((f) => f.etapa === "critica" && f.status === "feita").reduce((m, f) => Math.max(m, f.rodada), 0);
  const medias = ultimaCritica ? mediasRecebidas(falas, ultimaCritica) : {};
  const vencedor = sessao.resultado ? sessao.resultado.vencedor : null;
  return (
    <section aria-label="Mesa redonda" className="min-w-0" data-mesa-redonda="">
      <div className="mb-3 flex min-w-0 items-center">
        <h3 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>
          {sessaoAtiva(sessao) ? `Rodada ${sessao.rodada_atual}: ${NOME_DA_ETAPA[etapaAtual]}` : "Mesa"}
        </h3>
        {sessao.resultado && (
          <span className={juntar(texto.etiqueta, "ml-3 shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-primary")} data-consenso={sessao.resultado.nivel}>
            {NOME_DO_NIVEL[sessao.resultado.nivel]}
            {sessao.resultado.consenso != null ? ` ${Math.round(sessao.resultado.consenso * 100)}%` : ""}
          </span>
        )}
      </div>
      <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sessao.especialistas.map((m) => {
          const agora = falas.find((f) => f.especialista === m.id && f.rodada === sessao.rodada_atual && f.etapa !== "conversa");
          const falando = !!agora && agora.status === "falando";
          const estado = !sessaoAtiva(sessao)
            ? m.id === vencedor ? "Vencedora" : "Na mesa"
            : !agora ? (etapaAtual === "consolidacao" ? "Aguardando o moderador" : "Aguardando") : agora.status === "falando" ? "Falando" : agora.status === "feita" ? "Falou" : agora.status === "fila" ? "Na vez" : agora.status === "erro" ? "Não conseguiu falar" : "Pulado";
          return (
            <li key={m.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onConversar(m.id)}
                className={juntar(superficie.painel, "toque-compacto flex w-full min-w-0 items-start p-3 text-left transition-colors hover:bg-muted/40", m.id === vencedor ? "border-primary" : "")}
                aria-label={`${m.nome}: ${estado}. Conversar`}
                data-cadeira={m.id}
                data-falando={falando ? "sim" : "nao"}
              >
                <span
                  className={juntar(
                    "mr-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                    falando ? "animate-pulse bg-primary text-primary-foreground" : m.id === vencedor ? "bg-primary/20 text-primary" : "bg-muted text-foreground",
                  )}
                  aria-hidden="true"
                >
                  {iniciais(m.nome)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{m.nome}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{rotuloDoModelo(m.modelo_id)}</span>
                  <span className="mt-1 block truncate text-[12px] text-foreground">
                    {estado}
                    {typeof medias[m.id] === "number" ? ` · nota ${String(medias[m.id]).replace(".", ",")}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ rodadas

function Rodadas({ sessao, falas }: { sessao: SessaoDoConselho; falas: FalaDoConselho[] }) {
  const etapas = planoDasEtapas(sessao.rodadas, sessao.rodadas_extras);
  const [vista, setVista] = useState<string>(String(Math.min(sessao.rodada_atual, etapas.length)));
  // Rodada nova começou: a vista acompanha.
  const rodadaAnterior = useRef(sessao.rodada_atual);
  useEffect(() => {
    if (sessao.rodada_atual !== rodadaAnterior.current) {
      rodadaAnterior.current = sessao.rodada_atual;
      setVista(String(Math.min(sessao.rodada_atual, etapas.length)));
    }
  }, [sessao.rodada_atual, etapas.length]);
  const rodada = Number(vista) || 1;
  const etapa = etapas[rodada - 1];
  const daRodada = falas.filter((f) => f.rodada === rodada && f.etapa !== "conversa");
  return (
    <Secao titulo="Rodadas" recolher={`conselho:rodadas:${sessao.id}`} resumo={`${etapas.length} rodadas`}>
      <Etapas
        rotulo="Rodadas do conselho"
        numerar
        itens={etapas.map((e, i) => ({ valor: String(i + 1), rotulo: NOME_DA_ETAPA[e], contador: falas.filter((f) => f.rodada === i + 1 && f.etapa !== "conversa" && f.status === "feita").length || null }))}
        valor={vista}
        onEscolher={setVista}
      />
      <div className="mt-3 min-w-0">
        {!daRodada.length ? (
          <EstadoVazio compacto titulo={rodada > sessao.rodada_atual ? "Esta rodada ainda não começou." : "Nenhuma fala nesta rodada."} />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {daRodada.map((f) => (
              <FalaNaLista key={f.id} fala={f} sessao={sessao} etapa={etapa || "propostas"} />
            ))}
          </ul>
        )}
      </div>
    </Secao>
  );
}

function FalaNaLista({ fala, sessao, etapa }: { fala: FalaDoConselho; sessao: SessaoDoConselho; etapa: string }) {
  const [inteira, setInteira] = useState(false);
  const c = (fala.conteudo || {}) as { titulo?: unknown; riscos?: unknown; mantenho_discordancia?: unknown };
  const riscos = Array.isArray(c.riscos) ? c.riscos.map(String) : [];
  const corpo = fala.status === "feita" ? String(fala.texto || "") : fala.status === "falando" ? "Falando..." : fala.status === "fila" ? "Na vez." : fala.erro_mensagem || "Não falou.";
  const longo = corpo.length > 420;
  const notasPorAlvo: Record<string, string[]> = {};
  (fala.notas || []).forEach((n) => (notasPorAlvo[n.alvo] || (notasPorAlvo[n.alvo] = [])).push(`${n.criterio} ${n.nota}`));
  return (
    <li className="min-w-0 px-2 py-3" data-fala={fala.especialista} data-status={fala.status}>
      <div className="flex min-w-0 items-center">
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{nomeDe(fala.especialista, sessao)}</span>
        {fala.status === "falando" && <Loader2 className="ml-2 h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />}
        {fala.custo_usd > 0 && <span className={juntar(texto.auxiliar, "ml-auto shrink-0 pl-2 tabular-nums")}>{usd(fala.custo_usd)}</span>}
      </div>
      {(etapa === "propostas" || etapa === "revisao") && !!c.titulo && <p className="mt-1 text-[13px] font-medium text-foreground">{String(c.titulo)}</p>}
      <p className={juntar("mt-1 whitespace-pre-line text-[13px] leading-5", fala.status === "feita" ? "text-foreground" : "text-muted-foreground")}>
        {longo && !inteira ? `${corpo.slice(0, 420)}...` : corpo}
      </p>
      {Object.keys(notasPorAlvo).length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Notas dadas">
          {Object.keys(notasPorAlvo).map((alvo) => (
            <li key={alvo} className="text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">{nomeDe(alvo, sessao)}</span>: {notasPorAlvo[alvo].join(" · ")}
            </li>
          ))}
        </ul>
      )}
      {inteira && riscos.length > 0 && <p className="mt-2 text-[12px] text-muted-foreground">Riscos: {riscos.join("; ")}</p>}
      {inteira && !!c.mantenho_discordancia && <p className="mt-1 text-[12px] text-muted-foreground">Mantém: {String(c.mantenho_discordancia)}</p>}
      {(longo || riscos.length > 0 || !!c.mantenho_discordancia) && fala.status === "feita" && (
        <button type="button" className={juntar(botao.discreto, "mt-1 h-7 px-2 text-[12px]")} onClick={() => setInteira((v) => !v)}>
          {inteira ? "Mostrar menos" : "Mostrar tudo"}
        </button>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ resultado e decisão

function Resultado({
  sessao,
  falas,
  onRelido,
  onUsar,
  rotuloDoUsar,
}: {
  sessao: SessaoDoConselho;
  falas: FalaDoConselho[];
  onRelido: () => void;
  onUsar?: (texto: string) => void;
  rotuloDoUsar: string;
}) {
  const r = sessao.resultado!;
  const finais = useMemo(() => {
    const ids: string[] = [];
    falas.forEach((f) => {
      if ((f.etapa === "propostas" || f.etapa === "revisao") && f.status === "feita" && ids.indexOf(f.especialista) < 0) ids.push(f.especialista);
    });
    return ids;
  }, [falas]);
  return (
    <div className="min-w-0 space-y-6" data-resultado-do-conselho="">
      <Secao
        titulo="Recomendação"
        recolher={false}
        descricao={`${NOME_DO_NIVEL[r.nivel]}${r.consenso != null ? ` (${Math.round(r.consenso * 100)}%)` : ""}${r.vencedor ? ` · vencedora: ${nomeDe(r.vencedor, sessao)}` : ""}`}
        ajuda="O Jev dá nota a cada proposta final e escolhe a melhor; o consenso junta a certeza dele com quantos especialistas preferiram a mesma. O moderador escreve a recomendação a partir disso."
        acao={<NovaRodada sessao={sessao} onRelido={onRelido} />}
      >
        <p className="whitespace-pre-line text-[14px] leading-[1.6] text-foreground" data-recomendacao="">{r.recomendacao || "O moderador não escreveu a recomendação."}</p>
        {r.porque && <p className="mt-3 whitespace-pre-line text-[13px] leading-5 text-muted-foreground"><span className="font-medium text-foreground">Por quê. </span>{r.porque}</p>}
        {r.em_aberto.length > 0 && (
          <div className="mt-3">
            <span className={texto.rotulo}>Em aberto</span>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-foreground" data-em-aberto="">
              {r.em_aberto.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        )}
        {r.proximos_passos.length > 0 && (
          <div className="mt-3">
            <span className={texto.rotulo}>Próximos passos</span>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-foreground">
              {r.proximos_passos.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        )}
        {r.aviso && <p className="mt-3 text-[12px] text-amber-600 dark:text-amber-400">{r.aviso}</p>}
      </Secao>

      <Secao titulo="Divergências" recolher={false} descricao={r.divergencias.length ? `${r.divergencias.length} registradas` : "nenhuma"}>
        {r.divergencias.length ? (
          <ul className="space-y-1.5" data-divergencias="">
            {r.divergencias.map((d, i) => (
              <li key={i} className="text-[13px] leading-5 text-foreground" data-divergencia={d.tipo}>{d.texto}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">O conselho não registrou divergência.</p>
        )}
      </Secao>

      <Secao titulo="Ranking" recolher={`conselho:ranking:${sessao.id}`} resumo={r.ranking.length ? `1º ${r.ranking[0].nome}` : undefined}>
        <table className="w-full min-w-0 text-[13px]" data-ranking="">
          <thead>
            <tr className="text-left">
              <th className={juntar(texto.rotulo, "py-1 pr-2")}>Especialista</th>
              <th className={juntar(texto.rotulo, "py-1 pr-2 text-right")}>Jev</th>
              <th className={juntar(texto.rotulo, "py-1 pr-2 text-right")}>Crítica</th>
              <th className={juntar(texto.rotulo, "py-1 text-right")}>Escolha</th>
            </tr>
          </thead>
          <tbody>
            {r.ranking.map((l) => (
              <tr key={l.especialista} className="border-t border-border/50">
                <td className="py-1.5 pr-2">
                  <span className="block truncate font-medium text-foreground">{l.nome}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{l.titulo}</span>
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{l.nota_jev != null ? String(l.nota_jev).replace(".", ",") : "sem"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{l.nota_media != null ? String(l.nota_media).replace(".", ",") : "sem"}</td>
                <td className="py-1.5 text-right tabular-nums">{l.probabilidade != null ? `${Math.round(l.probabilidade * 100)}%` : "sem"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>

      <Decisao sessao={sessao} finais={finais} onRelido={onRelido} />
      {r.acao.tipo === "usar_na_mesa" && r.acao.texto && <CartaoDoUsar sessao={sessao} onUsar={onUsar} rotuloDoUsar={rotuloDoUsar} />}
    </div>
  );
}

function Decisao({ sessao, finais, onRelido }: { sessao: SessaoDoConselho; finais: string[]; onRelido: () => void }) {
  const [escolha, setEscolha] = useState<"recomendacao" | "proposta" | "nenhuma">("recomendacao");
  const [especialista, setEspecialista] = useState<string>(finais[0] || "");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const d = sessao.decisao && !sessao.decisao.desfeita_em ? sessao.decisao : null;
  const ativo = sessaoAtiva(sessao);

  const confirmar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await chamarConselho<{ prova?: string }>({ acao: "decidir", sessao_id: sessao.id, escolha, especialista: escolha === "proposta" ? especialista : null, nota });
      toast.success(r.prova || "Decisão guardada no cérebro do cliente.", {
        action: { label: "Desfazer", onClick: () => void desfazer() },
      });
      onRelido();
    } catch (e) {
      setErro(textoDoErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const desfazer = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await chamarConselho({ acao: "desfazer_decisao", sessao_id: sessao.id });
      toast.success("Decisão desfeita. A ata fica guardada, marcada como desfeita.");
      onRelido();
    } catch (e) {
      setErro(textoDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section aria-label="Decisão do dono" className={juntar(superficie.painel, "min-w-0 p-4")} data-decisao="">
      <div className="flex min-w-0 items-center">
        <h3 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>Decisão</h3>
        {d && (
          <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => void desfazer()} disabled={ocupado}>
            <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Desfazer
          </button>
        )}
      </div>
      {d ? (
        <p className="mt-2 text-[13px] text-foreground" data-decidido="">
          <Check className="mr-1.5 inline h-4 w-4 text-primary" aria-hidden="true" />
          {d.por_nome || "A equipe"} decidiu {d.escolha === "recomendacao" ? "seguir a recomendação" : d.escolha === "proposta" ? `seguir a proposta de ${nomeDe(String(d.especialista), sessao)}` : "não seguir nenhuma proposta"} em {dataEHora(d.em)}.
          {d.nota ? ` ${d.nota}` : ""}
        </p>
      ) : (
        <div className="mt-3 min-w-0 space-y-3">
          <div className="min-w-0 space-y-2" role="radiogroup" aria-label="O que decidir">
            {(["recomendacao", "proposta", "nenhuma"] as const).map((v) => (
              <label key={v} className="flex min-w-0 cursor-pointer items-center text-[13px] text-foreground">
                <input type="radio" name={`decisao-${sessao.id}`} className="mr-2 h-4 w-4 shrink-0 accent-primary" checked={escolha === v} onChange={() => setEscolha(v)} />
                <span className="truncate">{v === "recomendacao" ? "Seguir a recomendação" : v === "proposta" ? "Seguir outra proposta" : "Não seguir nenhuma"}</span>
              </label>
            ))}
          </div>
          {escolha === "proposta" && (
            <select className={campo} value={especialista} onChange={(e) => setEspecialista(e.target.value)} aria-label="Qual proposta">
              {finais.map((id) => <option key={id} value={id}>{nomeDe(id, sessao)}</option>)}
            </select>
          )}
          <textarea className={campoTexto} rows={2} value={nota} maxLength={1500} onChange={(e) => setNota(e.target.value)} placeholder="Nota da decisão (opcional)" aria-label="Nota da decisão" />
          {erro && <p className="text-[13px] text-destructive" role="alert">{erro}</p>}
          <div className="flex min-w-0 items-center justify-end">
            <span className={juntar(texto.auxiliar, "mr-3")}>Sem custo · vai para o cérebro</span>
            <button type="button" className={botao.primario} onClick={() => void confirmar()} disabled={ocupado || ativo || (escolha === "proposta" && !especialista)}>
              {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
              Confirmar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** A recomendação vira pedido pronto para a mesa de origem: só com Confirmar. */
function CartaoDoUsar({ sessao, onUsar, rotuloDoUsar }: { sessao: SessaoDoConselho; onUsar?: (texto: string) => void; rotuloDoUsar: string }) {
  const acao = sessao.resultado!.acao;
  const [descartado, setDescartado] = useState(false);
  if (descartado) return null;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(acao.texto);
      toast.success("Pedido copiado.");
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível copiar."));
    }
  };
  return (
    <section aria-label="Ação da recomendação" className={juntar(superficie.painel, "min-w-0 p-4")} data-acao-do-conselho="">
      <h3 className={juntar(texto.tituloSecao, "truncate")}>{acao.rotulo || rotuloDoUsar}</h3>
      <p className="mt-2 whitespace-pre-line text-[13px] leading-5 text-foreground">{acao.texto}</p>
      <div className="mt-3 flex min-w-0 flex-wrap items-center justify-end [&>*+*]:ml-2">
        <button type="button" className={botao.discreto} onClick={() => setDescartado(true)}>Descartar</button>
        {onUsar ? (
          <button type="button" className={botao.primario} onClick={() => onUsar(acao.texto)}>
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            Confirmar
          </button>
        ) : (
          <button type="button" className={botao.secundario} onClick={() => void copiar()}>Copiar o pedido</button>
        )}
      </div>
    </section>
  );
}

function NovaRodada({ sessao, onRelido }: { sessao: SessaoDoConselho; onRelido: () => void }) {
  const [plano, setPlano] = useState<{ total: number; cabe: boolean; sugerido: number } | null>(null);
  const [teto, setTeto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (sessao.status !== "concluida" || sessao.rodadas_extras >= 2) return null;
  const pedir = async () => {
    setOcupado(true);
    try {
      const r = await chamarConselho<{ estimativa: { total_usd: number }; cabe_no_teto: boolean; teto_sugerido_usd: number }>({ acao: "nova_rodada", sessao_id: sessao.id });
      setPlano({ total: r.estimativa.total_usd, cabe: r.cabe_no_teto, sugerido: r.teto_sugerido_usd });
      setTeto(String(r.teto_sugerido_usd));
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const confirmar = async () => {
    setOcupado(true);
    try {
      await chamarConselho({ acao: "nova_rodada", sessao_id: sessao.id, confirmar: true, novo_teto_usd: plano && !plano.cabe ? Number(String(teto).replace(",", ".")) : undefined });
      setPlano(null);
      onRelido();
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setOcupado(false);
    }
  };
  if (!plano) {
    return (
      <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void pedir()} disabled={ocupado}>
        {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
        Nova rodada
      </button>
    );
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center justify-end [&>*+*]:ml-2" data-nova-rodada="">
      <span className={texto.auxiliar}>Crítica, revisão e consolidação · {usd(plano.total)}</span>
      {!plano.cabe && (
        <input className={juntar(campo, "h-8 w-24")} inputMode="decimal" value={teto} onChange={(e) => setTeto(e.target.value)} aria-label="Novo teto em dólares" title="Novo teto (US$)" />
      )}
      <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setPlano(null)}>Cancelar</button>
      <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void confirmar()} disabled={ocupado}>
        {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Confirmar
      </button>
    </span>
  );
}

// ------------------------------------------------------------------ conversa

function ConversaComOConselho({
  sessao,
  falas,
  com,
  onCom,
  onRelido,
}: {
  sessao: SessaoDoConselho;
  falas: FalaDoConselho[];
  com: string;
  onCom: (id: string) => void;
  onRelido: () => void;
}) {
  const [textoDoCampo, setTextoDoCampo] = useEstadoDaTela<string>(`conselho:conversa:${sessao.id}`, "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ mensagem: string; teto?: number } | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const conversa_ = falas.filter((f) => f.etapa === "conversa");
  const quem = com || (sessao.resultado ? "moderador" : sessao.especialistas[0] ? sessao.especialistas[0].id : "moderador");
  const ativo = sessaoAtiva(sessao);

  useEffect(() => {
    const el = fim.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversa_.length]);

  const enviar = async (novoTeto?: number) => {
    const pergunta = textoDoCampo.trim();
    if (!pergunta || enviando) return;
    setEnviando(true);
    setErro(null);
    setTextoDoCampo("");
    try {
      const r = await chamarConselho<{ aviso?: string | null; aprendido?: { id?: string | null; texto?: string } | null }>({ acao: "perguntar", sessao_id: sessao.id, especialista: quem, pergunta, novo_teto_usd: novoTeto });
      if (r && r.aviso) toast.warning(r.aviso);
      // Frente SYNC: o conselho aprende como as mesas; a regra fica em Contexto, O que o painel aprendeu (com Esquecer).
      if (r && r.aprendido && r.aprendido.id && r.aprendido.texto) toast.success("Aprendi", { description: r.aprendido.texto });
      onRelido();
    } catch (e) {
      // A mensagem que falhou volta ao campo.
      setTextoDoCampo(pergunta);
      const detalhes: Record<string, unknown> = e instanceof ErroDaMesa ? e.detalhes : {};
      const precisa = Number(detalhes.custo_usd || 0) + Number(detalhes.estimativa_usd || 0);
      setErro({ mensagem: textoDoErro(e), teto: e instanceof ErroDaMesa && e.codigo === "teto_da_sessao" && precisa > 0 ? Math.ceil(precisa * 1.2 * 100) / 100 : undefined });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section aria-label="Conversa com o conselho" className="flex h-[70vh] min-h-0 min-w-0 flex-col border-t border-border lg:h-full lg:border-l lg:border-t-0" data-conversa-do-conselho="">
      <div className="flex shrink-0 items-center border-b border-border px-3.5 py-2.5">
        <MessageSquare className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">Conversar</h3>
      </div>
      <MensagensDoAgente ref={fim} rotulo="Conversa com o conselho">
        {!conversa_.length && <p className={conversa.apoio}>{ativo ? "Quando as rodadas terminarem, pergunte a qualquer especialista." : "Pergunte a um especialista ou ao moderador."}</p>}
        {conversa_.map((f) => (
          <div key={f.id} className="space-y-2">
            <BalaoDaConversa de="usuario">
              <span className="block text-[12px] text-muted-foreground">Para {nomeDe(f.especialista, sessao)}</span>
              {f.pedido}
            </BalaoDaConversa>
            <BalaoDaConversa de="agente" data-resposta={f.status}>
              <span className="block text-[12px] font-medium text-foreground">{nomeDe(f.especialista, sessao)}</span>
              <span className="whitespace-pre-line">{f.status === "feita" ? f.texto : f.status === "falando" ? "Pensando..." : f.erro_mensagem || "Não respondeu."}</span>
            </BalaoDaConversa>
          </div>
        ))}
      </MensagensDoAgente>
      {erro && (
        <div className="shrink-0 px-3.5 pb-1">
          <p className="text-[13px] text-destructive" role="alert">{erro.mensagem}</p>
          {erro.teto && (
            <button type="button" className={juntar(botao.secundario, "mt-1 h-8")} onClick={() => void enviar(erro.teto)} disabled={enviando}>
              Subir o teto para {usd(erro.teto)} e enviar
            </button>
          )}
        </div>
      )}
      <CompositorDoAgente>
        <select className={juntar(campo, "h-8")} value={quem} onChange={(e) => onCom(e.target.value)} aria-label="Com quem conversar" disabled={ativo}>
          {sessao.resultado && <option value="moderador">Moderador</option>}
          {sessao.especialistas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <div className="flex min-w-0 items-end">
          <textarea
            className={juntar(campoTexto, "min-h-[44px] flex-1")}
            rows={2}
            value={textoDoCampo}
            maxLength={2000}
            disabled={ativo}
            onChange={(e) => setTextoDoCampo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder={ativo ? "Esperando as rodadas" : `Pergunte a ${nomeDe(quem, sessao)}`}
            aria-label="Pergunta ao conselho"
          />
          <button type="button" className={juntar(botao.primario, "ml-2 h-11 w-11 px-0")} onClick={() => void enviar()} disabled={ativo || enviando || !textoDoCampo.trim()} aria-label="Enviar pergunta">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        <p className={texto.auxiliar}>Gasto {usd(sessao.custo_usd)} de {usd(sessao.teto_usd)}</p>
      </CompositorDoAgente>
    </section>
  );
}
