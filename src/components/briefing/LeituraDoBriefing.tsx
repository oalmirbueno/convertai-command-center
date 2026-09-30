import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Copy, FileDown, FolderPlus, Loader2, MessageCircle, PenLine, RefreshCw, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { appPublicUrl } from "@/lib/publicUrl";
import {
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  MenuMais,
  Secao,
  botao,
  etiqueta,
  juntar,
  lista,
  superficie,
  texto,
} from "@/components/sistema";
import RespostasEmLeitura from "./RespostasEmLeitura";
import PreencherBriefingComIA from "./PreencherBriefingComIA";
import PerguntasExtras from "./PerguntasExtras";
import LembreteDoBriefing from "./LembreteDoBriefing";
import ExportarParaContexto from "./ExportarParaContexto";
import { extrasDoModelo } from "../../../supabase/functions/_shared/briefing-editor";
import { tamanhoLegivel } from "./CamposDoBriefing";
import { copiarTexto } from "./GerarLinkDoBriefing";
import { type LinhaDaDecupagem, chamarAgenteDoBriefing, textoDoErroDoBriefing } from "@/lib/briefing/api";
import {
  type AnexoDoBriefing,
  type CampoDoBriefing,
  camposDoModelo,
  estadoDoLink,
  linkDoWhatsApp,
  mensagemDoLink,
  modeloDoLink,
  progressoDoBriefing,
} from "../../../supabase/functions/_shared/briefing-modelos";
import { ROTULO_DO_CAMPO_SUGERIDO, type SugestaoDoContexto, porCategoria } from "../../../supabase/functions/_shared/briefing-decupagem";

/**
 * Leitura do briefing respondido (frente BRF, 30/09/2026), no lugar do
 * window.print: respostas por bloco com os trechos decupados grifados, os
 * pontos principais (palavras-chave, dores, público, objetivos, restrições,
 * referências, tom), as sugestões para o contexto do cliente ou da marca
 * (Confirmar e Desfazer), os anexos e as ações do link (copiar, WhatsApp,
 * preencher junto, reabrir, validade, salvar PDF em Arquivos).
 */

export type LinhaDoBriefingNoPainel = {
  id: string;
  token: string;
  client_id: string | null;
  project_id: string | null;
  marca_id: string | null;
  modelo: string | null;
  modelo_conteudo: unknown;
  prefill: Record<string, string> | null;
  titulo: string | null;
  responses: Record<string, unknown> | null;
  submitted: boolean | null;
  expira_em: string | null;
  enviado_em: string | null;
  envios: number | null;
  reabertura_pedida_em: string | null;
  reabertura_motivo: string | null;
  arquivado_em: string | null;
  arquivo_pdf_id: string | null;
  created_at: string;
  client?: { full_name: string | null; company_name: string | null; phone?: string | null } | null;
};

export const CAMPOS_DA_LEITURA =
  "id, token, client_id, project_id, marca_id, modelo, modelo_conteudo, prefill, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, reabertura_motivo, arquivado_em, arquivo_pdf_id, created_at, client:profiles!briefings_client_id_fkey(full_name, company_name, phone)";

const dataHora = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

export function nomeDoBriefing(b: Pick<LinhaDoBriefingNoPainel, "client" | "responses">): string {
  const r = (b.responses || {}) as Record<string, any>;
  return b.client?.company_name || b.client?.full_name || r.empresa || r.companyName || r?.contato?.nome || "Sem vínculo";
}

export default function LeituraDoBriefing({ briefingId, onGerarProjeto, abrirLembrete = false }: { briefingId: string; onGerarProjeto?: (b: LinhaDoBriefingNoPainel) => void; abrirLembrete?: boolean }) {
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [lembreteAberto, setLembreteAberto] = useState(abrirLembrete);
  const [extras, setExtras] = useState<CampoDoBriefing[] | null>(null);

  // Frente BRF2: lembretes, preenchimento com IA e exportação. Leitura à parte e tolerante (sem a
  // migração 20260930196000 aplicada, a leitura principal segue igual e estas partes ficam vazias).
  const extrasDoLink = useQuery({
    queryKey: ["briefing-leitura-brf2", briefingId],
    queryFn: async () => {
      const { data, error } = await supabase.from("briefings").select("lembretes, ultimo_lembrete_em, preenchido_ia, exportado" as any).eq("id", briefingId).maybeSingle();
      if (error) {
        console.warn("[briefing] colunas da frente BRF2 indisponíveis:", error.message);
        return null;
      }
      return data as unknown as { lembretes: number | null; ultimo_lembrete_em: string | null; preenchido_ia: { desfeito_em?: string | null } | null; exportado: unknown } | null;
    },
  });

  const briefing = useQuery({
    queryKey: ["briefing-leitura", briefingId],
    queryFn: async () => {
      const { data, error } = await supabase.from("briefings").select(CAMPOS_DA_LEITURA).eq("id", briefingId).maybeSingle();
      if (error) throw error;
      return data as unknown as LinhaDoBriefingNoPainel | null;
    },
  });
  const b = briefing.data;

  const anexos = useQuery({
    queryKey: ["briefing-anexos", briefingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefing_anexos" as any)
        .select("id, campo, categoria, nome, tamanho, mime, file_id, criado_em")
        .eq("briefing_id", briefingId)
        .eq("status", "pronto")
        .is("arquivado_em", null)
        .order("criado_em", { ascending: true });
      if (error) throw error;
      return (data as unknown as Array<AnexoDoBriefing & { file_id: string | null }>) || [];
    },
    enabled: !!b,
  });

  const decupagem = useQuery({
    queryKey: ["briefing-decupagem", briefingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefing_decupagens" as any)
        .select("id, briefing_id, client_id, envio, status, itens, tom_de_voz, sugestoes, destino, aplicadas, custo_usd, erro, criado_em, concluido_em, aplicada_em, desfeita_em")
        .eq("briefing_id", briefingId)
        .order("envio", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as LinhaDaDecupagem | null) ?? null;
    },
    enabled: !!b?.submitted,
    refetchInterval: (q) => {
      const d = q.state.data as LinhaDaDecupagem | null | undefined;
      return d && (d.status === "pendente" || d.status === "processando") ? 5000 : false;
    },
  });

  const modelo = useMemo(() => modeloDoLink(b?.modelo, b?.modelo_conteudo), [b?.modelo, b?.modelo_conteudo]);
  const respostas = (b?.responses || {}) as Record<string, unknown>;
  const listaDeAnexos = anexos.data || [];
  const dec = decupagem.data;

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["briefing-leitura", briefingId] });
    void qc.invalidateQueries({ queryKey: ["briefing-decupagem", briefingId] });
    void qc.invalidateQueries({ queryKey: ["briefings-admin"] });
    void qc.invalidateQueries({ queryKey: ["briefing-leitura-brf2", briefingId] });
  };

  const executar = async (nome: string, fn: () => Promise<void>) => {
    setOcupado(nome);
    try {
      await fn();
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e));
    } finally {
      setOcupado(null);
    }
  };

  const decupar = (forcar: boolean) =>
    executar("decupar", async () => {
      const r = await chamarAgenteDoBriefing<{ decupagem: LinhaDaDecupagem | null; motivo: string | null }>("decupar", { briefing_id: briefingId, forcar });
      if (r.motivo === "processando") toast.info("A decupagem já está rodando. Em instantes aparece aqui.");
      else if (r.decupagem?.erro) toast.warning(r.decupagem.erro);
      recarregar();
    });

  // Decupagem que ficou na fila (o cliente fechou antes de a página pedir): o painel pede uma vez.
  const jaPediu = useRef(false);
  useEffect(() => {
    if (!dec || jaPediu.current || dec.status !== "pendente") return;
    if (Date.now() - new Date(dec.criado_em).getTime() < 90_000) return;
    jaPediu.current = true;
    void decupar(false);
  }, [dec]); // eslint-disable-line react-hooks/exhaustive-deps

  if (briefing.isLoading) return <Carregando forma="aba" rotulo="Abrindo o briefing" />;
  if (briefing.isError || !b) {
    return (
      <EstadoDeErro
        titulo={briefing.isError ? "Não foi possível abrir o briefing." : "Briefing não encontrado."}
        acao={<button type="button" onClick={() => void briefing.refetch()} className={juntar(botao.secundario, "h-8 text-[12px]")}>Tentar de novo</button>}
      />
    );
  }

  const estado = estadoDoLink(b);
  const extrasAtuais = extras ?? extrasDoModelo(modelo);
  const url = appPublicUrl(`/briefing/${b.token}`);
  const nome = nomeDoBriefing(b);
  const mensagem = mensagemDoLink({ cliente: nome, modelo, url, expiraEm: b.submitted ? null : b.expira_em });
  const progresso = progressoDoBriefing(modelo, respostas, listaDeAnexos);
  const grifos = dec && (dec.status === "pronta" || dec.status === "aplicada" || dec.status === "desfeita") ? (dec.itens || []).map((i) => i.texto) : [];
  const estadoDoTexto =
    estado === "enviado"
      ? `recebido em ${dataHora(b.enviado_em)}`
      : estado === "expirado"
        ? `link expirou em ${dataHora(b.expira_em)}`
        : `aguardando${b.expira_em ? `, vale até ${dataHora(b.expira_em)}` : ""}`;

  const reabrir = () =>
    executar("reabrir", async () => {
      await chamarAgenteDoBriefing("reabrir", { briefing_id: b.id });
      toast.success("Link reaberto. O cliente já pode editar.");
      recarregar();
    });

  return (
    <div className="min-w-0 space-y-6">
      <CabecalhoDePagina
        nivel={2}
        titulo={b.titulo || modelo.titulo}
        descricao={`${nome} · ${estadoDoTexto} · ${progresso.respondidos} de ${progresso.total}`}
        ajuda="As respostas do cliente, com os pontos principais grifados. Copie o link ou mande pelo WhatsApp; Preencher junto abre o mesmo link para responder na reunião. Depois de enviado, o link trava: reabra quando o cliente pedir."
        acoes={
          <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:m-0.5">
            <button
              type="button"
              onClick={() => void copiarTexto(url).then((ok) => (ok ? toast.success("Link copiado.") : toast.error("Não foi possível copiar.")))}
              className={botao.barra}
              aria-label="Copiar link"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1.5 hidden sm:inline">Copiar link</span>
            </button>
            {estado !== "enviado" && (
              <a href={linkDoWhatsApp(mensagem, b.client?.phone)} target="_blank" rel="noopener noreferrer" className={botao.barra} aria-label="Enviar pelo WhatsApp">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden sm:inline">WhatsApp</span>
              </a>
            )}
            {estado === "aberto" && b.client_id && (
              <button type="button" onClick={() => setLembreteAberto(true)} className={botao.barra} aria-label="Lembrar o cliente">
                <BellRing className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden sm:inline">Lembrar</span>
              </button>
            )}
            {estado === "aberto" && (
              <a href={url} target="_blank" rel="noopener noreferrer" className={botao.barra} aria-label="Preencher junto com o cliente">
                <PenLine className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden sm:inline">Preencher junto</span>
              </a>
            )}
            {estado === "enviado" && (
              <button type="button" onClick={() => void reabrir()} disabled={!!ocupado} className={b.reabertura_pedida_em ? botao.primario : botao.secundario}>
                {ocupado === "reabrir" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Reabrir
              </button>
            )}
            <button
              type="button"
              disabled={!!ocupado || !b.client_id}
              onClick={() =>
                void executar("pdf", async () => {
                  const r = await chamarAgenteDoBriefing<{ file_id: string; ja_existia: boolean }>("exportar_pdf", { briefing_id: b.id });
                  toast.success(r.ja_existia ? "Este PDF já estava em Arquivos." : "PDF salvo em Arquivos, Documentos operacionais.");
                  recarregar();
                })
              }
              className={botao.secundario}
              title={b.client_id ? undefined : "Briefing sem cliente não vai para Arquivos."}
            >
              {ocupado === "pdf" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <FileDown className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              <span>PDF em Arquivos</span>
            </button>
            <MenuMais
              itens={[
                estado !== "enviado" && {
                  rotulo: "Mais 30 dias de validade",
                  aoEscolher: () =>
                    void executar("validade", async () => {
                      await chamarAgenteDoBriefing("validade", { briefing_id: b.id, dias: 30 });
                      toast.success("Validade estendida por 30 dias.");
                      recarregar();
                    }),
                },
                !!onGerarProjeto && estado === "enviado" && { rotulo: "Gerar projeto", icone: <FolderPlus className="h-4 w-4" />, aoEscolher: () => onGerarProjeto!(b) },
                {
                  rotulo: b.arquivado_em ? "Desarquivar" : "Arquivar",
                  perigo: !b.arquivado_em,
                  aoEscolher: () =>
                    void executar("arquivar", async () => {
                      await chamarAgenteDoBriefing("arquivar", { briefing_id: b.id, arquivar: !b.arquivado_em });
                      toast.success(b.arquivado_em ? "Briefing de volta à lista." : "Briefing arquivado. O link deixa de abrir.");
                      recarregar();
                    }),
                },
              ]}
            />
          </div>
        }
      />

      {b.reabertura_pedida_em && estado === "enviado" && (
        <p className={juntar(superficie.poco, texto.corpo, "flex items-start px-3 py-2")}>
          <RotateCcw className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            O cliente pediu para reabrir em {dataHora(b.reabertura_pedida_em)}.{b.reabertura_motivo ? ` Motivo: ${b.reabertura_motivo}` : ""}
          </span>
        </p>
      )}

      {b.submitted && (
        <PontosDoBriefing
          dec={dec ?? null}
          carregando={decupagem.isLoading}
          ocupado={ocupado}
          onDecupar={(forcar) => void decupar(forcar)}
          onMudou={recarregar}
          executar={executar}
        />
      )}

      <Secao titulo="Respostas" divisoria descricao={`${progresso.respondidos} de ${progresso.total} respondidas`}>
        <RespostasEmLeitura modelo={modelo} respostas={respostas} anexos={listaDeAnexos} destacar={grifos} />
      </Secao>

      {listaDeAnexos.length > 0 && (
        <Secao titulo="Arquivos enviados" divisoria descricao={`${listaDeAnexos.length} em Arquivos do cliente`}>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {listaDeAnexos.map((a) => (
              <li key={a.id} className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{a.nome}</span>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{tamanhoLegivel(a.tamanho)}</span>
              </li>
            ))}
          </ul>
          {b.client_id && (
            <a href={`/arquivos?client=${b.client_id}`} className={juntar(botao.discreto, "-ml-2 mt-2 h-8 px-2 text-[12px]")}>Abrir em Arquivos</a>
          )}
        </Secao>
      )}

      {estado === "aberto" && b.client_id && (
        <PreencherBriefingComIA briefingId={b.id} temDesfazer={!!(extrasDoLink.data && extrasDoLink.data.preenchido_ia && !extrasDoLink.data.preenchido_ia.desfeito_em)} onMudou={recarregar} />
      )}
      {estado === "aberto" && (
        <PerguntasExtras
          extras={extrasAtuais}
          onMudar={setExtras}
          briefingId={b.id}
          chavesDoModelo={camposDoModelo(modelo).filter((c) => c.key.indexOf("extra_") !== 0).map((c) => c.key)}
          aoSalvar={recarregar}
        />
      )}
      {b.client_id && Object.keys(respostas).length > 0 && <ExportarParaContexto briefingId={b.id} onMudou={recarregar} />}

      {b.client_id && (
        <LembreteDoBriefing
          aberto={lembreteAberto && estado === "aberto"}
          onFechar={() => setLembreteAberto(false)}
          briefingId={b.id}
          token={b.token}
          cliente={nome}
          telefone={b.client?.phone}
          modelo={modelo}
          expiraEm={b.expira_em}
          respondidos={progresso.respondidos}
          total={progresso.total}
          lembretes={Number(extrasDoLink.data?.lembretes) || 0}
          onRegistrado={recarregar}
        />
      )}
    </div>
  );
}

const ROTULO_DO_MODO: Record<SugestaoDoContexto["modo"], string> = { preencher: "Preencher", juntar: "Somar", substituir: "Trocar" };

function valorCurto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(String).join("; ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const n = ["palavras_chave", "dores", "publico", "objetivos", "restricoes", "referencias", "tom"].reduce((s, k) => s + (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0), 0);
    return n ? `${n} pontos decupados deste briefing` : "Pontos do briefing";
  }
  return String(v);
}

function PontosDoBriefing({
  dec,
  carregando,
  ocupado,
  onDecupar,
  onMudou,
  executar,
}: {
  dec: LinhaDaDecupagem | null;
  carregando: boolean;
  ocupado: string | null;
  onDecupar: (forcar: boolean) => void;
  onMudou: () => void;
  executar: (nome: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  useEffect(() => {
    setEscolhidas((dec?.sugestoes || []).filter((s) => s.padrao).map((s) => s.id));
  }, [dec?.id, dec?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (carregando) return <Carregando linhas={3} rotulo="Lendo a decupagem" />;

  const destino = dec?.destino ? (dec.destino.tipo === "marca" ? `contexto da marca ${dec.destino.marca_nome}` : "contexto do cliente") : "contexto do cliente";
  const pronta = dec && (dec.status === "pronta" || dec.status === "aplicada" || dec.status === "desfeita");
  const grupos = pronta ? porCategoria(dec!.itens || []) : [];
  const descricao = !dec
    ? "na fila"
    : dec.status === "pendente" || dec.status === "processando"
      ? "decupando"
      : dec.status === "falhou"
        ? "falhou"
        : dec.status === "aplicada"
          ? `confirmado em ${dataHora(dec.aplicada_em)}`
          : `${(dec.itens || []).length} pontos`;

  return (
    <Secao
      titulo="Pontos do briefing"
      descricao={descricao}
      ajuda="O Jev separa das respostas as palavras-chave, as dores, o público, os objetivos, as restrições, as referências e o tom. Eles viram sugestões para o contexto: nada é gravado sem Confirmar, e Desfazer volta como estava."
      acao={
        pronta || dec?.status === "falhou" || !dec ? (
          <button type="button" onClick={() => onDecupar(true)} disabled={!!ocupado || dec?.status === "aplicada"} className={botao.barra} title={dec?.status === "aplicada" ? "Desfaça a confirmação antes de decupar de novo." : "Usa o Jev (custo de centavos)."}>
            {ocupado === "decupar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            <span className="ml-1.5">{dec ? "Decupar de novo" : "Decupar"}</span>
          </button>
        ) : undefined
      }
    >
      {!dec || dec.status === "pendente" || dec.status === "processando" ? (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          O Jev está lendo as respostas.
        </p>
      ) : dec.status === "falhou" ? (
        <p className={juntar(texto.corpo, "text-destructive")}>{dec.erro || "A decupagem falhou."} Use Decupar de novo.</p>
      ) : (
        <div className="min-w-0 space-y-5">
          {dec.erro && <p className={juntar(texto.auxiliar, "text-amber-600 dark:text-amber-400")}>{dec.erro}</p>}
          {dec.tom_de_voz && (
            <p className={texto.corpo}>
              <span className={juntar(texto.rotulo, "mr-2")}>Tom de voz</span>
              {dec.tom_de_voz}
            </p>
          )}
          {grupos.length > 0 && (
            <dl className="grid min-w-0 gap-x-8 gap-y-4 sm:grid-cols-2">
              {grupos.map((g) => (
                <div key={g.categoria} className="min-w-0">
                  <dt className={juntar(texto.rotulo, "mb-1.5")}>{g.rotulo}</dt>
                  <dd className="-m-0.5 flex min-w-0 flex-wrap">
                    {g.itens.map((i) => (
                      <span key={i.id} className={juntar(etiqueta, "m-0.5 max-w-full whitespace-normal bg-muted text-left text-foreground [overflow-wrap:anywhere]")} title={i.fonte === "jev" && i.confianca != null ? `Jev, ${Math.round(i.confianca * 100)}%` : "Do modelo do briefing"}>
                        {i.texto}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {(dec.sugestoes || []).length > 0 && (
            <div className="min-w-0">
              <p className={juntar(texto.rotulo, "mb-2")}>Sugestões para o {destino}</p>
              <ul className={juntar(lista.aberta, lista.divisoria)}>
                {dec.sugestoes.map((s) => {
                  const marcada = escolhidas.indexOf(s.id) >= 0;
                  const travada = dec.status === "aplicada";
                  const aplicada = travada && (dec.aplicadas || []).some((a) => a.campo === s.campo);
                  return (
                    <li key={s.id} className={juntar(lista.linha, "items-start")}>
                      <input
                        type="checkbox"
                        id={`sug-${s.id}`}
                        checked={travada ? aplicada : marcada}
                        disabled={travada}
                        onChange={() => setEscolhidas((l) => (marcada ? l.filter((x) => x !== s.id) : l.concat(s.id)))}
                        className="mr-3 mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      />
                      <label htmlFor={`sug-${s.id}`} className="min-w-0 flex-1 cursor-pointer">
                        <span className="flex min-w-0 items-center">
                          <span className="truncate text-[13px] font-medium text-foreground">{ROTULO_DO_CAMPO_SUGERIDO[s.campo] || s.rotulo}</span>
                          <span className={juntar(etiqueta, "ml-2 shrink-0 bg-muted text-muted-foreground")}>{ROTULO_DO_MODO[s.modo]}</span>
                        </span>
                        <span className={juntar(texto.corpo, "mt-0.5 block text-muted-foreground [overflow-wrap:anywhere]")}>{valorCurto(s.valor).slice(0, 400)}</span>
                        {s.modo === "substituir" && s.antes != null && (
                          <span className={juntar(texto.auxiliar, "mt-0.5 block [overflow-wrap:anywhere]")}>Hoje: {valorCurto(s.antes).slice(0, 200)}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex flex-wrap items-center justify-end [&>*]:m-0.5">
                {dec.status === "aplicada" ? (
                  <>
                    <span className={juntar(texto.auxiliar, "mr-2 flex items-center")}>
                      <Check className="mr-1 h-4 w-4 text-primary" aria-hidden="true" />
                      Gravado no {destino}
                    </span>
                    <button
                      type="button"
                      disabled={!!ocupado}
                      onClick={() =>
                        void executar("desfazer", async () => {
                          const r = await chamarAgenteDoBriefing<{ voltaram: string[]; mantidos: Array<{ campo: string; motivo: string }> }>("desfazer", { decupagem_id: dec.id });
                          if (r.mantidos.length) toast.warning(`${r.voltaram.length} voltaram; ${r.mantidos.length} mudaram depois e ficaram como estão.`);
                          else toast.success("Desfeito. O contexto voltou como estava.");
                          onMudou();
                        })
                      }
                      className={botao.secundario}
                    >
                      {ocupado === "desfazer" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                      Desfazer
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!!ocupado || !escolhidas.length}
                    onClick={() =>
                      void executar("aplicar", async () => {
                        await chamarAgenteDoBriefing("aplicar", { decupagem_id: dec.id, sugestoes: escolhidas });
                        toast.success(`Gravado no ${destino}. Desfazer fica aqui.`);
                        onMudou();
                      })
                    }
                    className={botao.primario}
                  >
                    {ocupado === "aplicar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                    Confirmar {escolhidas.length ? `(${escolhidas.length})` : ""}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Secao>
  );
}
