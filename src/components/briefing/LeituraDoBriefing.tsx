import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, BellRing, CalendarPlus, Check, Copy, FileDown, FolderPlus, Loader2, MessageCircle, PenLine, RefreshCw, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { appPublicUrl } from "@/lib/publicUrl";
import {
  BotaoComIcone,
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
  type ItemDoMenu,
} from "@/components/sistema";
import RespostasEmLeitura from "./RespostasEmLeitura";
import PreencherBriefingComIA from "./PreencherBriefingComIA";
import PerguntasExtras from "./PerguntasExtras";
import LembreteDoBriefing from "./LembreteDoBriefing";
import ExportarParaContexto from "./ExportarParaContexto";
import { extrasDoModelo, precisaDeLembrete } from "../../../supabase/functions/briefing-agente/modulos/briefing-editor";
import { tamanhoLegivel } from "./CamposDoBriefing";
import { copiarTexto } from "./GerarLinkDoBriefing";
import { type LinhaDaDecupagem, ROTULO_DO_MODO_DA_SUGESTAO, chamarAgenteDoBriefing, consultaSolta, ehErroDeColuna, textoDoErroDoBriefing } from "@/lib/briefing/api";
import {
  type AnexoDoBriefing,
  type CampoDoBriefing,
  camposDoModelo,
  estadoDoLink,
  linkDoWhatsApp,
  mensagemDoLink,
  modeloDoLink,
  pastaDosAnexos,
  progressoDoBriefing,
} from "../../../supabase/functions/_shared/briefing-modelos";
import { ROTULO_DO_CAMPO_SUGERIDO, porCategoria } from "../../../supabase/functions/_shared/briefing-decupagem";

/**
 * Leitura do briefing respondido (frente BRF, 30/09/2026), no lugar do
 * window.print: respostas por bloco com os trechos lidos pela IA grifados, os
 * pontos principais (palavras-chave, dores, público, objetivos, restrições,
 * referências, tom), o que levar para o contexto do cliente ou da marca
 * (Confirmar e Desfazer), os anexos e as ações do link.
 *
 * Frente UXS: as ações seguem o estado do link, com um primário por estado
 * (aberto: Copiar link; expirado: Mais 30 dias; recebido: Reabrir ou Gerar
 * projeto; arquivado: Desarquivar), e o resto no "...". As seções também
 * seguem o estado: com o link aberto, preparar vem primeiro; recebido, os
 * pontos e o contexto vêm antes das respostas.
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

/**
 * Colunas da frente BRF2 que só a leitura usa (último salvar do cliente,
 * lembretes e o último preenchimento com IA), numa consulta só com o resto.
 * Sem a migração, a leitura repete com CAMPOS_DA_LEITURA e trata como vazias.
 */
const CAMPOS_EXTRAS_DA_LEITURA = ", rascunho_salvo_em, lembretes, ultimo_lembrete_em, preenchido_ia";

type LinhaDaLeitura = LinhaDoBriefingNoPainel & {
  rascunho_salvo_em?: string | null;
  lembretes?: number | null;
  ultimo_lembrete_em?: string | null;
  preenchido_ia?: { desfeito_em?: string | null } | null;
  /** As colunas da BRF2 vieram (a migração está aplicada). */
  temExtras: boolean;
};

const dataHora = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

export function nomeDoBriefing(b: Pick<LinhaDoBriefingNoPainel, "client" | "responses">): string {
  const r = (b.responses || {}) as Record<string, any>;
  return b.client?.company_name || b.client?.full_name || r.empresa || r.companyName || r?.contato?.nome || "Sem vínculo";
}

async function lerLeitura(briefingId: string): Promise<LinhaDaLeitura | null> {
  const ler = (campos: string) => consultaSolta<LinhaDoBriefingNoPainel>("briefings").select(campos).eq("id", briefingId).maybeSingle();
  let r = await ler(CAMPOS_DA_LEITURA + CAMPOS_EXTRAS_DA_LEITURA);
  let temExtras = true;
  if (r.error && ehErroDeColuna(r.error)) {
    console.warn("[briefing] colunas da frente BRF2 indisponíveis:", r.error.message);
    temExtras = false;
    r = await ler(CAMPOS_DA_LEITURA);
  }
  if (r.error) throw r.error;
  return r.data ? { ...(r.data as LinhaDoBriefingNoPainel), temExtras } : null;
}

export default function LeituraDoBriefing({ briefingId, onGerarProjeto, abrirLembrete = false }: { briefingId: string; onGerarProjeto?: (b: LinhaDoBriefingNoPainel) => void; abrirLembrete?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [lembreteAberto, setLembreteAberto] = useState(abrirLembrete);
  const [extras, setExtras] = useState<CampoDoBriefing[] | null>(null);

  const briefing = useQuery({
    queryKey: ["briefing-leitura", briefingId],
    queryFn: () => lerLeitura(briefingId),
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
    // Os dois blocos de "Levar para o contexto" gravam no mesmo contexto: o "Hoje:" do outro relê.
    void qc.invalidateQueries({ queryKey: ["briefing-exportar", briefingId] });
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
      if (r.motivo === "processando") toast.info("A leitura já está rodando. Em instantes aparece aqui.");
      else if (r.decupagem?.erro) toast.warning(r.decupagem.erro);
      recarregar();
    });

  // Leitura que ficou na fila (o cliente fechou antes de a página pedir): o painel pede uma vez.
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
  const arquivado = !!b.arquivado_em;
  const extrasAtuais = extras ?? extrasDoModelo(modelo);
  const url = appPublicUrl(`/briefing/${b.token}`);
  const nome = nomeDoBriefing(b);
  const mensagem = mensagemDoLink({ cliente: nome, modelo, url, expiraEm: b.submitted ? null : b.expira_em });
  const progresso = progressoDoBriefing(modelo, respostas, listaDeAnexos);
  const grifos = dec && (dec.status === "pronta" || dec.status === "aplicada" || dec.status === "desfeita") ? (dec.itens || []).map((i) => i.texto) : [];
  const estadoDoTexto = arquivado
    ? "arquivado"
    : estado === "enviado"
      ? `recebido em ${dataHora(b.enviado_em)}`
      : estado === "expirado"
        ? `link expirou em ${dataHora(b.expira_em)}`
        : `aguardando${b.expira_em ? `, vale até ${dataHora(b.expira_em)}` : ""}`;
  // Lembrar só existe com o link aberto e com cliente; fica à vista quando o link pede lembrete hoje.
  const podeLembrar = !arquivado && estado === "aberto" && !!b.client_id;
  const lembrarNaBarra = podeLembrar && b.temExtras && precisaDeLembrete(b);
  const temDesfazerDaIa = !!(b.preenchido_ia && !b.preenchido_ia.desfeito_em);

  const copiarLink = () => void copiarTexto(url).then((ok) => (ok ? toast.success("Link copiado.") : toast.error("Não foi possível copiar.")));
  const reabrir = () =>
    executar("reabrir", async () => {
      await chamarAgenteDoBriefing("reabrir", { briefing_id: b.id });
      toast.success("Link reaberto. O cliente já pode editar.");
      recarregar();
    });
  const maisTrintaDias = () =>
    void executar("validade", async () => {
      await chamarAgenteDoBriefing("validade", { briefing_id: b.id, dias: 30 });
      toast.success("Validade estendida por 30 dias.");
      recarregar();
    });
  const salvarPdf = () =>
    void executar("pdf", async () => {
      const r = await chamarAgenteDoBriefing<{ file_id: string; ja_existia: boolean }>("exportar_pdf", { briefing_id: b.id });
      const clienteDoPdf = b.client_id || "";
      toast.success(r.ja_existia ? "Este PDF já estava em Arquivos." : "PDF salvo em Arquivos, Documentos operacionais.", {
        action: { label: "Abrir", onClick: () => navigate(`/arquivos?client=${encodeURIComponent(clienteDoPdf)}&folder=operacionais`) },
      });
      recarregar();
    });
  const arquivar = (sim: boolean): void =>
    void executar("arquivar", async () => {
      await chamarAgenteDoBriefing("arquivar", { briefing_id: b.id, arquivar: sim });
      if (sim) toast.success("Briefing arquivado. O link deixa de abrir.", { action: { label: "Desfazer", onClick: () => arquivar(false) } });
      else toast.success("Briefing de volta à lista.");
      recarregar();
    });

  // Itens do "...": montados aqui e escolhidos por estado.
  const itemCopiar: ItemDoMenu = { rotulo: "Copiar link", icone: <Copy className="h-4 w-4" />, aoEscolher: copiarLink };
  const itemPdf: ItemDoMenu = {
    rotulo: b.client_id ? "PDF em Arquivos" : "PDF em Arquivos (precisa de cliente)",
    icone: <FileDown className="h-4 w-4" />,
    aoEscolher: salvarPdf,
    desativado: !b.client_id || !!ocupado,
  };
  const itemArquivar: ItemDoMenu = { rotulo: "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => arquivar(true), perigo: true, desativado: !!ocupado };
  const itemGerarProjeto: ItemDoMenu | false = !!onGerarProjeto && estado === "enviado" && { rotulo: "Gerar projeto", icone: <FolderPlus className="h-4 w-4" />, aoEscolher: () => onGerarProjeto!(b) };
  const girando = (qual: string, icone: ReactNode) => (ocupado === qual ? <Loader2 className="h-4 w-4 animate-spin" /> : icone);

  let barra: ReactNode = null;
  let mais: Array<ItemDoMenu | false> = [];
  if (arquivado) {
    barra = <BotaoComIcone icone={girando("arquivar", <ArchiveRestore className="h-4 w-4" />)} rotulo="Desarquivar" variante="primario" onClick={() => arquivar(false)} disabled={!!ocupado} />;
    mais = [itemCopiar, itemPdf, itemGerarProjeto];
  } else if (estado === "aberto") {
    barra = (
      <>
        <BotaoComIcone icone={<Copy className="h-4 w-4" />} rotulo="Copiar link" variante="primario" onClick={copiarLink} />
        <a href={linkDoWhatsApp(mensagem, b.client?.phone)} target="_blank" rel="noopener noreferrer" className={botao.barra} aria-label="Enviar pelo WhatsApp">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          <span className="ml-1.5 hidden sm:inline">WhatsApp</span>
        </a>
        {lembrarNaBarra && (
          <button type="button" onClick={() => setLembreteAberto(true)} className={botao.barra} aria-label="Lembrar o cliente">
            <BellRing className="h-4 w-4" aria-hidden="true" />
            <span className="ml-1.5 hidden sm:inline">Lembrar</span>
          </button>
        )}
      </>
    );
    mais = [
      { rotulo: "Preencher junto", icone: <PenLine className="h-4 w-4" />, aoEscolher: () => void window.open(url, "_blank", "noopener,noreferrer"), dica: "Abre o mesmo link para responder na reunião" },
      { rotulo: "Mais 30 dias de validade", icone: <CalendarPlus className="h-4 w-4" />, aoEscolher: maisTrintaDias, desativado: !!ocupado },
      podeLembrar && !lembrarNaBarra && { rotulo: "Lembrar o cliente", icone: <BellRing className="h-4 w-4" />, aoEscolher: () => setLembreteAberto(true) },
      itemPdf,
      itemArquivar,
    ];
  } else if (estado === "expirado") {
    // O link vencido não vai por WhatsApp: primeiro a validade nova; depois o WhatsApp volta com a data certa.
    barra = <BotaoComIcone icone={girando("validade", <CalendarPlus className="h-4 w-4" />)} rotulo="Mais 30 dias" variante="primario" onClick={maisTrintaDias} disabled={!!ocupado} aria-label="Mais 30 dias de validade" />;
    mais = [itemCopiar, itemPdf, itemArquivar];
  } else {
    const pedido = !!b.reabertura_pedida_em;
    barra = (
      <>
        <BotaoComIcone icone={girando("reabrir", <RotateCcw className="h-4 w-4" />)} rotulo="Reabrir" variante={pedido ? "primario" : "secundario"} onClick={() => void reabrir()} disabled={!!ocupado} />
        {onGerarProjeto && <BotaoComIcone icone={<FolderPlus className="h-4 w-4" />} rotulo="Gerar projeto" variante={pedido ? "secundario" : "primario"} onClick={() => onGerarProjeto(b)} />}
        {b.client_id && <BotaoComIcone icone={girando("pdf", <FileDown className="h-4 w-4" />)} rotulo="PDF em Arquivos" variante="secundario" onClick={salvarPdf} disabled={!!ocupado} />}
      </>
    );
    mais = [itemCopiar, !b.client_id && itemPdf, itemArquivar];
  }

  const podePreparar = estado === "aberto" && !arquivado;
  const temSugestoes = !!b.submitted && !!dec && (dec.status === "pronta" || dec.status === "aplicada" || dec.status === "desfeita") && (dec.sugestoes || []).length > 0;
  const podeExportar = !!b.client_id && Object.keys(respostas).length > 0;

  const respostasEArquivos = (
    <>
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
            <Link to={`/arquivos?client=${encodeURIComponent(b.client_id)}&folder=${pastaDosAnexos(listaDeAnexos)}`} className={juntar(botao.discreto, "-ml-2 mt-2 h-8 px-2 text-[12px]")}>
              Abrir em Arquivos
            </Link>
          )}
        </Secao>
      )}
    </>
  );

  const levarParaOContexto =
    temSugestoes || podeExportar ? (
      <Secao
        titulo="Levar para o contexto"
        divisoria
        ajuda="Os dois blocos gravam no mesmo contexto do cliente (ou da marca) e um completa o outro. Pontos sugeridos leva o que a IA separou das respostas (a decupagem, feita pelo Jev); Respostas e cérebro leva os campos que o modelo liga ao contexto e guarda o briefing inteiro no cérebro. Cada um tem o seu Confirmar e o seu Desfazer."
      >
        <div className="min-w-0 space-y-5">
          {temSugestoes && dec && <PontosSugeridos dec={dec} ocupado={ocupado} onMudou={recarregar} executar={executar} briefingId={b.id} />}
          {podeExportar && <ExportarParaContexto briefingId={b.id} onMudou={recarregar} />}
        </div>
      </Secao>
    ) : null;

  return (
    <div className="min-w-0 space-y-6">
      <CabecalhoDePagina
        nivel={2}
        titulo={b.titulo || modelo.titulo}
        descricao={`${nome} · ${estadoDoTexto} · ${progresso.respondidos} de ${progresso.total}`}
        ajuda={
          'As respostas do cliente, com os pontos principais grifados. As ações seguem o estado do link. Aberto: Copiar link é o principal, com WhatsApp e Lembrar (quando o link pede lembrete) ao lado; Preencher junto (abre o mesmo link para responder na reunião), Mais 30 dias, PDF em Arquivos e Arquivar ficam no "...". Expirado: Mais 30 dias vem primeiro, e o WhatsApp volta com a data nova. Recebido: o link trava; Reabrir (quando o cliente pede), Gerar projeto e PDF em Arquivos ficam à vista. Arquivado: o link não abre; use Desarquivar. Sem cliente, o PDF não vai para Arquivos.'
        }
        acoes={
          <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:m-0.5">
            {barra}
            <MenuMais itens={mais} />
          </div>
        }
      />

      {b.reabertura_pedida_em && estado === "enviado" && !arquivado && (
        <p className={juntar(superficie.poco, texto.corpo, "flex items-start px-3 py-2")}>
          <RotateCcw className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            O cliente pediu para reabrir em {dataHora(b.reabertura_pedida_em)}.{b.reabertura_motivo ? ` Motivo: ${b.reabertura_motivo}` : ""}
          </span>
        </p>
      )}

      {b.submitted ? (
        <>
          <PontosDoBriefing dec={dec ?? null} carregando={decupagem.isLoading} ocupado={ocupado} onDecupar={(forcar) => void decupar(forcar)} />
          {levarParaOContexto}
          {respostasEArquivos}
        </>
      ) : (
        <>
          {/* Com o link aberto, a equipe vem preparar: as ferramentas antes das respostas. */}
          {podePreparar && b.client_id && <PreencherBriefingComIA briefingId={b.id} temDesfazer={temDesfazerDaIa} onMudou={recarregar} />}
          {podePreparar && (
            <PerguntasExtras
              extras={extrasAtuais}
              onMudar={setExtras}
              briefingId={b.id}
              chavesDoModelo={camposDoModelo(modelo).filter((c) => c.key.indexOf("extra_") !== 0).map((c) => c.key)}
              aoSalvar={recarregar}
            />
          )}
          {respostasEArquivos}
          {levarParaOContexto}
        </>
      )}

      {b.client_id && (
        <LembreteDoBriefing
          aberto={lembreteAberto && podeLembrar}
          onFechar={() => setLembreteAberto(false)}
          briefingId={b.id}
          token={b.token}
          cliente={nome}
          telefone={b.client?.phone}
          modelo={modelo}
          expiraEm={b.expira_em}
          respondidos={progresso.respondidos}
          total={progresso.total}
          lembretes={Number(b.lembretes) || 0}
          onRegistrado={recarregar}
        />
      )}
    </div>
  );
}

function valorCurto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(String).join("; ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const n = ["palavras_chave", "dores", "publico", "objetivos", "restricoes", "referencias", "tom"].reduce((s, k) => s + (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0), 0);
    return n ? `${n} pontos lidos deste briefing` : "Pontos do briefing";
  }
  return String(v);
}

/** Os pontos principais que a IA separou das respostas, com "Ler de novo". */
function PontosDoBriefing({
  dec,
  carregando,
  ocupado,
  onDecupar,
}: {
  dec: LinhaDaDecupagem | null;
  carregando: boolean;
  ocupado: string | null;
  onDecupar: (forcar: boolean) => void;
}) {
  if (carregando) return <Carregando linhas={3} rotulo="Lendo os pontos" />;

  const pronta = dec && (dec.status === "pronta" || dec.status === "aplicada" || dec.status === "desfeita");
  const grupos = pronta ? porCategoria(dec!.itens || []) : [];
  const descricao = !dec
    ? "na fila"
    : dec.status === "pendente" || dec.status === "processando"
      ? "lendo"
      : dec.status === "falhou"
        ? "falhou"
        : `${(dec.itens || []).length} pontos`;

  return (
    <Secao
      titulo="Pontos do briefing"
      descricao={descricao}
      ajuda="O Jev (a IA de julgamento) separa das respostas as palavras-chave, as dores, o público, os objetivos, as restrições, as referências e o tom: é a decupagem. As sugestões para o contexto ficam em Levar para o contexto, com Confirmar e Desfazer. Ler de novo refaz a leitura (custo de centavos)."
      acao={
        pronta || dec?.status === "falhou" || !dec ? (
          <button type="button" onClick={() => onDecupar(true)} disabled={!!ocupado || dec?.status === "aplicada"} className={botao.barra} title={dec?.status === "aplicada" ? "Desfaça a confirmação antes de ler de novo." : "Usa IA (custo de centavos)."}>
            {ocupado === "decupar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            <span className="ml-1.5">{dec ? "Ler de novo" : "Ler as respostas"}</span>
          </button>
        ) : undefined
      }
    >
      {!dec || dec.status === "pendente" || dec.status === "processando" ? (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          A IA está lendo as respostas.
        </p>
      ) : dec.status === "falhou" ? (
        <p className={juntar(texto.corpo, "text-destructive")}>{dec.erro || "A leitura falhou."} Use Ler de novo.</p>
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
                      <span key={i.id} className={juntar(etiqueta, "m-0.5 max-w-full whitespace-normal bg-muted text-left text-foreground [overflow-wrap:anywhere]")} title={i.fonte === "jev" && i.confianca != null ? `IA, ${Math.round(i.confianca * 100)}%` : "Do modelo do briefing"}>
                        {i.texto}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </Secao>
  );
}

/** "Pontos sugeridos", o bloco de "Levar para o contexto" que vem da leitura da IA: Confirmar grava, Desfazer volta. */
function PontosSugeridos({
  dec,
  ocupado,
  onMudou,
  executar,
  briefingId,
}: {
  dec: LinhaDaDecupagem;
  ocupado: string | null;
  onMudou: () => void;
  executar: (nome: string, fn: () => Promise<void>) => Promise<void>;
  briefingId: string;
}) {
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  useEffect(() => {
    setEscolhidas((dec.sugestoes || []).filter((s) => s.padrao).map((s) => s.id));
  }, [dec.id, dec.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const destino = dec.destino ? (dec.destino.tipo === "marca" ? `contexto da marca ${dec.destino.marca_nome}` : "contexto do cliente") : "contexto do cliente";
  const travada = dec.status === "aplicada";

  return (
    <Secao
      titulo="Pontos sugeridos"
      nivel={3}
      recolher={`briefing:pontos-sugeridos:${briefingId}`}
      descricao={travada ? `confirmado em ${dataHora(dec.aplicada_em)}` : `${(dec.sugestoes || []).length} ${(dec.sugestoes || []).length === 1 ? "sugestão" : "sugestões"} · ${destino}`}
    >
      <ul className={juntar(lista.aberta, lista.divisoria)}>
        {dec.sugestoes.map((s) => {
          const marcada = escolhidas.indexOf(s.id) >= 0;
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
                  <span className={juntar(etiqueta, "ml-2 shrink-0 bg-muted text-muted-foreground")}>{ROTULO_DO_MODO_DA_SUGESTAO[s.modo]}</span>
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
        {travada ? (
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
    </Secao>
  );
}
