import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Download, FolderTree, Loader2, Monitor, Pencil, Star, Subtitles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { acaoDoAnexo, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import { Cartao, Vazio } from "@/components/mesa-foto/Comuns";
import { estimarPedido, normalizarParametros, ROTULO_DO_ESTADO_DO_PEDIDO, textoDaEstimativa } from "../../../supabase/functions/_shared/pedidos-de-video";
import { montarPacote, type EntradaDoPacote, type TakeDoPacote } from "../../../supabase/functions/_shared/pacote-de-edicao";
import { FONTE_BRABO } from "../../../supabase/functions/_shared/conhecimento-edicao";
import { ROTULO_DA_TAREFA } from "../../../supabase/functions/_shared/computador-do-agente";
import { AvisoDeAtivacao, SeloDoTipo } from "./Comuns";
import {
  BUCKET_DOS_VIDEOS,
  chamarMesaVideos,
  chaveDosArquivos,
  chaveDosPedidos,
  duracaoCurta,
  useArquivosDeVideo,
  useFilaDoComputador,
  useHistorias,
  usePedidos,
  useRoteirosAprovados,
  type ArquivoDeVideo,
  type PedidoDeVideo,
} from "./videosApi";
import { supabase } from "@/integrations/supabase/client";

/**
 * Edição (por ora uma aba da Mesa Vídeos): organizador de takes (renomear,
 * agrupar por roteiro e cena, marcar melhores; ações confirmadas do contrato
 * comum, com Desfazer), transcrição e legenda como pedido preparado, e o
 * "Pacote para editar" (roteiro, takes, legendas, direção e referências) para
 * um editor humano ou o pipeline Remotion local do dono. A direção do pacote
 * vem de conhecimento-edicao.ts (método Brabo destilado). Nada aqui gasta.
 */

const campo = "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[12px]";

type Desfazer = Record<string, unknown>;

async function editarArquivo(id: string, campos: Record<string, unknown>): Promise<{ arquivo: unknown; desfazer: Desfazer }> {
  return chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: id, campos });
}

// ------------------------------------------------------------------ organizador de takes

function LinhaDoTake({ take, podeEditar, roteiros }: { take: ArquivoDeVideo; podeEditar: boolean; roteiros: { id: string; titulo: string; cenas: { ref: string; ordem: number; titulo: string }[] }[] }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(take.nome);
  const [ocupado, setOcupado] = useState(false);
  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
  const roteiro = roteiros.find((r) => r.id === take.roteiro_id) || null;

  const mudar = async (campos: Record<string, unknown>, titulo: string) => {
    setOcupado(true);
    try {
      const r = await editarArquivo(take.id, campos);
      recarregar();
      toast.success(titulo, {
        action: {
          label: "Desfazer",
          onClick: () => {
            void editarArquivo(take.id, r.desfazer).then(recarregar, (e) => toast.error("Não foi possível desfazer", { description: textoDoErro(e) }));
          },
        },
      });
      return true;
    } catch (e) {
      toast.error("Não foi possível mudar", { description: textoDoErro(e), duration: 9000 });
      return false;
    } finally {
      setOcupado(false);
    }
  };

  return (
    <li className="flex min-w-0 flex-wrap items-center py-1.5" data-take={take.id}>
      <button
        type="button"
        disabled={!podeEditar || ocupado}
        onClick={() => void mudar({ melhor: !take.melhor }, take.melhor ? "Deixou de ser o melhor take" : "Marcado como melhor take")}
        aria-pressed={take.melhor}
        aria-label={take.melhor ? `Desmarcar ${take.nome} como melhor` : `Marcar ${take.nome} como melhor`}
        className={`mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${take.melhor ? "text-warning" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Star className={`h-3.5 w-3.5 ${take.melhor ? "fill-current" : ""}`} />
      </button>
      {editando ? (
        <form
          className="flex min-w-0 flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void mudar({ nome }, "Take renomeado").then((ok) => ok && setEditando(false));
          }}
        >
          <input className={campo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} aria-label="Novo nome do take" autoFocus />
          <button type="submit" className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-primary" aria-label="Salvar nome" disabled={ocupado}>
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground" aria-label="Cancelar" onClick={() => setEditando(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium" title={take.nome_original !== take.nome ? `Original: ${take.nome_original}` : undefined}>
            {take.nome}
          </p>
          <p className="flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
            <SeloDoTipo tipo={take.tipo} />
            {duracaoCurta(take.duracao_s) && <span className="mr-1.5">{duracaoCurta(take.duracao_s)}</span>}
            {roteiro && <span className="mr-1.5 truncate">{roteiro.titulo}</span>}
          </p>
        </div>
      )}
      {!editando && podeEditar && (
        <div className="ml-1 flex shrink-0 items-center">
          {roteiros.length > 0 && (
            <select
              className="mr-1 h-7 max-w-[150px] rounded-md border border-input bg-background px-1 text-[11px]"
              value={take.roteiro_id && take.cena_ref ? `${take.roteiro_id}|${take.cena_ref}` : take.roteiro_id ? `${take.roteiro_id}|` : ""}
              disabled={ocupado}
              aria-label={`Cena do roteiro de ${take.nome}`}
              onChange={(e) => {
                const [r, c] = e.target.value.split("|");
                void mudar({ roteiro_id: r || null, cena_ref: c || null }, "Take ligado ao roteiro");
              }}
            >
              <option value="">Sem cena</option>
              {roteiros.map((r) =>
                r.cenas.map((c) => (
                  <option key={`${r.id}|${c.ref}`} value={`${r.id}|${c.ref}`}>
                    {r.titulo.slice(0, 18)} · cena {c.ordem}
                  </option>
                )),
              )}
            </select>
          )}
          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" aria-label={`Renomear ${take.nome}`} onClick={() => setEditando(true)} disabled={ocupado}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            aria-label={`Arquivar ${take.nome}`}
            title="Arquivar (não apaga o arquivo)"
            onClick={() => void mudar({ estado: "arquivado" }, "Take arquivado")}
            disabled={ocupado || take.melhor}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

function OrganizadorDeTakes() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const roteirosQ = useRoteirosAprovados(clientId);
  const [proposta, setProposta] = useState<{ mensagemId: string; acao: AcaoDoAgente } | null>(null);
  const [propondo, setPropondo] = useState(false);
  const arquivos = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter((a) => a.estado !== "arquivado" && a.tipo !== "entrega");
  const degradado = !!(arquivosQ.data && arquivosQ.data.degradado);
  const roteiros = (roteirosQ.data && roteirosQ.data.roteiros) || [];
  const grupos = useMemo(() => {
    const m: Record<string, ArquivoDeVideo[]> = {};
    const ordem: string[] = [];
    arquivos.forEach((a) => {
      const g = a.grupo || "Sem grupo";
      if (!m[g]) {
        m[g] = [];
        ordem.push(g);
      }
      m[g].push(a);
    });
    ordem.sort((a, b) => (a === "Sem grupo" ? 1 : b === "Sem grupo" ? -1 : a.localeCompare(b, "pt-BR")));
    return ordem.map((g) => ({ grupo: g, takes: m[g].slice().sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")) }));
  }, [arquivos]);

  const propor = async () => {
    setPropondo(true);
    try {
      const r = await chamarMesaVideos<{ mensagem_id: string | null; acao: unknown }>({ acao: "takes_organizar_propor", client_id: clientId });
      const acao = acaoDoAnexo(r.acao);
      if (!r.mensagem_id || !acao) {
        setProposta(null);
        toast.success("Já está organizado", { description: "Nomes e grupos seguem o padrão por roteiro e cena." });
      } else setProposta({ mensagemId: r.mensagem_id, acao });
    } catch (e) {
      toast.error("Não foi possível propor", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setPropondo(false);
    }
  };

  const onPedido = (pedido: PedidoDaAcao): Promise<RespostaDaAcao> => {
    if (!proposta) return Promise.resolve({});
    const corpo: Record<string, unknown> = {
      acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente",
      mensagem_id: proposta.mensagemId,
      acao_id: proposta.acao.id,
    };
    if (pedido === "descartar") corpo.descartar = true;
    return chamarMesaVideos<RespostaDaAcao>(corpo);
  };

  return (
    <Cartao
      titulo="Organizador de takes"
      dica="Agrupa por roteiro e cena e propõe nomes no padrão roteiro_c01_t01. Você confere a lista e confirma; dá para desfazer. O arquivo original nunca muda."
      acao={
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void propor()} disabled={propondo || degradado || !arquivos.length}>
          {propondo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FolderTree className="mr-1.5 h-3.5 w-3.5" />}
          Organizar por roteiro e cena
        </Button>
      }
    >
      {degradado && <AvisoDeAtivacao>O organizador precisa do acervo de vídeo no banco (SQL V2-01) e da função mesa-videos publicada.</AvisoDeAtivacao>}
      {proposta && (
        <div className="mb-3">
          <CartaoDeAcao
            acao={proposta.acao}
            titulo="Organizar os takes"
            onPedido={onPedido}
            onFeito={() => void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) })}
            observacao="Sem custo. Nada muda até confirmar, e dá para desfazer."
          />
        </div>
      )}
      {arquivosQ.isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      ) : !arquivos.length ? (
        <Vazio titulo="Nenhum take ainda">Suba as gravações na etapa Acervo.</Vazio>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {grupos.map((g) => (
            <section key={g.grupo} aria-label={g.grupo}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {g.grupo} <span className="font-normal normal-case">({g.takes.length})</span>
              </p>
              <ul className="divide-y divide-border">
                {g.takes.map((t) => (
                  <LinhaDoTake key={t.id} take={t} podeEditar={!t.so_no_storage} roteiros={roteiros} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Cartao>
  );
}

// ------------------------------------------------------------------ transcrição e legenda

function TranscricaoELegenda() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const pedidosQ = usePedidos(clientId);
  const [vocabulario, setVocabulario] = useState("");
  const [preparando, setPreparando] = useState<string | null>(null);
  const takes = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter((a) => a.estado !== "arquivado" && a.tipo !== "gerado" && !a.so_no_storage);
  const pedidos = ((pedidosQ.data && pedidosQ.data.itens) || []).filter((p) => (p.tipo === "transcrever" || p.tipo === "legendar") && p.estado !== "cancelado");

  const preparar = async (take: ArquivoDeVideo) => {
    setPreparando(take.id);
    try {
      const r = await chamarMesaVideos<{ ja_existia: boolean }>({
        acao: "pedido_preparar",
        client_id: clientId,
        tipo: "legendar",
        alvo: { arquivo_id: take.id },
        parametros: { duracao_s: take.duracao_s, idioma: "pt-BR", vocabulario },
      });
      void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
      toast.success(r.ja_existia ? "Este pedido já estava preparado" : "Legenda preparada", { description: "Nada foi transcrito nem cobrado. A transcrição chega em breve." });
    } catch (e) {
      toast.error("Não foi possível preparar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setPreparando(null);
    }
  };

  return (
    <Cartao titulo="Transcrição e legenda" dica="Pedido preparado por take: transcrição com tempos e legenda revisada. Nomes, marcas e valores da lista são conferidos no áudio.">
      <label className="mb-2 block text-[11px] text-muted-foreground">
        Nomes, marcas e valores que a legenda precisa acertar (separe por vírgula)
        <input className={campo} value={vocabulario} maxLength={600} onChange={(e) => setVocabulario(e.target.value)} placeholder="Ex.: nome da loja, produto, preço" />
      </label>
      {!takes.length ? (
        <p className="text-[12px] text-muted-foreground">Sem gravação registrada para legendar.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {takes.map((t) => {
            const doTake = pedidos.filter((p) => p.alvo && p.alvo.arquivo_id === t.id);
            const est = estimarPedido("legendar", normalizarParametros("legendar", { duracao_s: t.duracao_s, vocabulario }));
            return (
              <li key={t.id} className="flex min-w-0 flex-wrap items-center py-1.5" data-legenda-do-take={t.id}>
                <span className="mr-2 min-w-0 flex-1 truncate text-[12px]">{t.nome}</span>
                {doTake.length ? (
                  <span className="rounded bg-muted px-1.5 py-px text-[10.5px]">{ROTULO_DO_ESTADO_DO_PEDIDO[doTake[0].estado] || doTake[0].estado}</span>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-[11.5px]" onClick={() => void preparar(t)} disabled={preparando === t.id}>
                    {preparando === t.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Subtitles className="mr-1 h-3 w-3" />}
                    Preparar legenda
                    <span className="ml-1 text-[10px] text-muted-foreground">{textoDaEstimativa(est)}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

// ------------------------------------------------------------------ pacote para editar

function salvarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function entradaDoPacote(p: {
  clienteId: string;
  clienteNome: string;
  titulo: string;
  arquivos: ArquivoDeVideo[];
  quais: "melhores" | "todos";
  roteiro: EntradaDoPacote["roteiro"];
  historia: EntradaDoPacote["historia"];
  pedidos: PedidoDeVideo[];
  destino: "editor" | "remotion";
  fps: number | null;
  formato: string;
  direcao: string;
  urls?: Record<string, string>;
  agora: string;
}): EntradaDoPacote {
  const ativos = p.arquivos.filter((a) => a.estado !== "arquivado");
  const doRoteiro = p.roteiro ? ativos.filter((a) => a.roteiro_id === (p.roteiro as { id: string }).id) : ativos;
  const base = doRoteiro.length ? doRoteiro : ativos;
  const escolhidos = p.quais === "melhores" && base.some((a) => a.melhor) ? base.filter((a) => a.melhor) : base;
  const takes: TakeDoPacote[] = escolhidos.map((a) => ({ ...a, url: p.urls ? p.urls[a.storage_path] || null : null }));
  return {
    cliente: { id: p.clienteId, nome: p.clienteNome || "Cliente" },
    titulo: p.titulo,
    formato: p.formato || null,
    fps: p.fps,
    destino: p.destino,
    roteiro: p.roteiro,
    historia: p.historia,
    takes,
    legendas: p.pedidos
      .filter((x) => (x.tipo === "transcrever" || x.tipo === "legendar") && x.estado !== "cancelado" && x.alvo && x.alvo.arquivo_id)
      .map((x) => {
        const r = (x as unknown as { resultado?: { srt?: unknown } | null }).resultado;
        return { arquivo_id: String(x.alvo.arquivo_id), estado: x.estado, srt: r && typeof r.srt === "string" ? r.srt : null };
      }),
    referencias: [],
    direcao: p.direcao,
    gerado_em: p.agora,
  };
}

function PacoteParaEditar() {
  const { clientId, clientName } = useMesa();
  const arquivosQ = useArquivosDeVideo(clientId);
  const roteirosQ = useRoteirosAprovados(clientId);
  const historiasQ = useHistorias(clientId);
  const pedidosQ = usePedidos(clientId);
  const roteiros = (roteirosQ.data && roteirosQ.data.roteiros) || [];
  const historias = (historiasQ.data && historiasQ.data.historias) || [];
  const [titulo, setTitulo] = useState("");
  const [roteiroId, setRoteiroId] = useState("");
  const [canvasId, setCanvasId] = useState("");
  const [quais, setQuais] = useState<"melhores" | "todos">("melhores");
  const [destino, setDestino] = useState<"editor" | "remotion">("editor");
  const [fps, setFps] = useState("");
  const [formato, setFormato] = useState("9:16");
  const [direcao, setDirecao] = useState("");
  const [baixando, setBaixando] = useState(false);

  const roteiro = roteiros.find((r) => r.id === roteiroId) || null;
  const historia = historias.find((h) => h.canvas_id === canvasId) || null;
  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];
  const pedidos = (pedidosQ.data && pedidosQ.data.itens) || [];

  const entrada = (urls?: Record<string, string>) =>
    entradaDoPacote({
      clienteId: clientId,
      clienteNome: clientName,
      titulo: titulo || (roteiro ? roteiro.titulo : historia ? historia.nome : "Vídeo"),
      arquivos,
      quais,
      roteiro: roteiro ? { id: roteiro.id, titulo: roteiro.titulo, cenas: roteiro.cenas } : null,
      historia: historia
        ? { canvas_id: historia.canvas_id, nome: historia.nome, cenas: historia.cenas.map((c) => ({ numero: c.numero, no_id: c.no_id, titulo: c.titulo, acao: c.acao, narrativa: c.narrativa, enquadramento: c.enquadramento, imagem_id: c.imagem_id })) }
        : null,
      pedidos,
      destino,
      fps: Number(fps) > 0 ? Number(fps) : null,
      formato,
      direcao,
      urls,
      agora: new Date().toISOString(),
    });
  const previa = montarPacote(entrada());

  const baixar = async () => {
    setBaixando(true);
    try {
      const e0 = entrada();
      const caminhos = e0.takes.map((t) => t.storage_path);
      const urls: Record<string, string> = {};
      if (caminhos.length) {
        const { data } = await supabase.storage.from(BUCKET_DOS_VIDEOS).createSignedUrls(caminhos, 24 * 3600);
        ((data || []) as { path: string | null; signedUrl: string; error: string | null }[]).forEach((x) => {
          if (x.path && x.signedUrl && !x.error) urls[x.path] = x.signedUrl;
        });
      }
      const pacote = montarPacote(entrada(urls));
      const modulo: any = await import("jszip");
      const JSZip = modulo.default || modulo;
      const zip = new JSZip();
      Object.keys(pacote.arquivos).forEach((k) => zip.file(k, pacote.arquivos[k]));
      salvarBlob(await zip.generateAsync({ type: "blob" }), pacote.nome_do_zip);
      toast.success("Pacote pronto", { description: `${pacote.resumo.takes} ${pacote.resumo.takes === 1 ? "take" : "takes"}, ${pacote.pendencias.length} ${pacote.pendencias.length === 1 ? "pendência" : "pendências"} no LEIA-ME.` });
    } catch (e) {
      toast.error("Não foi possível montar o pacote", { description: textoDoErro(e) });
    } finally {
      setBaixando(false);
    }
  };

  return (
    <Cartao
      titulo="Pacote para editar"
      dica="Roteiro, takes na ordem de montar, legendas, direção de edição e referências num ZIP, para o editor ou para o pipeline Remotion local."
      acao={
        <Button type="button" size="sm" className="h-8" onClick={() => void baixar()} disabled={baixando || !previa.resumo.takes}>
          {baixando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
          Baixar pacote
        </Button>
      }
    >
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <label className="min-w-0 text-[11px] text-muted-foreground sm:col-span-2">
          Nome do vídeo
          <input className={campo} value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} placeholder={roteiro ? roteiro.titulo : "Ex.: Reel do lançamento"} />
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Roteiro aprovado
          <select className={campo} value={roteiroId} onChange={(e) => setRoteiroId(e.target.value)} disabled={!roteiros.length}>
            <option value="">{roteiros.length ? "Sem roteiro" : "Nenhum roteiro publicado"}</option>
            {roteiros.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titulo}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          História do Canvas
          <select className={campo} value={canvasId} onChange={(e) => setCanvasId(e.target.value)} disabled={!historias.length}>
            <option value="">{historias.length ? "Sem história" : "Nenhuma história"}</option>
            {historias.map((h) => (
              <option key={h.canvas_id} value={h.canvas_id}>
                {h.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Takes
          <select className={campo} value={quais} onChange={(e) => setQuais(e.target.value === "todos" ? "todos" : "melhores")}>
            <option value="melhores">Só os melhores (se houver)</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Para quem
          <select className={campo} value={destino} onChange={(e) => setDestino(e.target.value === "remotion" ? "remotion" : "editor")}>
            <option value="editor">Editor humano</option>
            <option value="remotion">Pipeline Remotion local</option>
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Formato
          <select className={campo} value={formato} onChange={(e) => setFormato(e.target.value)}>
            {["9:16", "4:5", "1:1", "16:9"].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          FPS
          <select className={campo} value={fps} onChange={(e) => setFps(e.target.value)}>
            <option value="">Conferir no arquivo</option>
            {["24", "25", "30", "60"].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground sm:col-span-2">
          Direção desta peça (vale sobre o método)
          <textarea
            className="min-h-[64px] w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-[12px]"
            value={direcao}
            maxLength={2000}
            onChange={(e) => setDirecao(e.target.value)}
            placeholder="Ex.: ritmo calmo, legenda discreta, sem trilha"
          />
        </label>
      </div>
      <div className="mt-3 rounded-lg bg-muted/60 p-2.5" data-previa-do-pacote="">
        <p className="text-[11.5px] font-medium">
          {previa.resumo.takes} {previa.resumo.takes === 1 ? "take" : "takes"}
          {previa.resumo.melhores ? `, ${previa.resumo.melhores} ${previa.resumo.melhores === 1 ? "melhor" : "melhores"}` : ""}
          {previa.resumo.duracao_melhores_s ? ` (${duracaoCurta(previa.resumo.duracao_melhores_s)})` : ""}
        </p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          {previa.pendencias.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10.5px] text-muted-foreground">
          Direção de edição: método de {FONTE_BRABO.autor}, resumido em palavras próprias, mais o kit audiovisual da casa.
        </p>
      </div>
    </Cartao>
  );
}

// ------------------------------------------------------------------ computador do agente (desligado)

function ComputadorDoAgente() {
  const { clientId } = useMesa();
  const filaQ = useFilaDoComputador(clientId);
  const tarefas = (filaQ.data && filaQ.data.itens) || [];
  return (
    <Cartao
      titulo="Tarefas para o computador do agente"
      dica="Um agente que opera um programa de computador (organizar o projeto no Premiere, por exemplo). Desligado: o dono liga quando houver executor aprovado."
      acao={
        <Button type="button" size="sm" variant="outline" className="h-8" disabled title="Desligado. Desenho em docs/motores/COMPUTADOR-DO-AGENTE.md">
          <Monitor className="mr-1.5 h-3.5 w-3.5" />
          Pedir tarefa
        </Button>
      }
    >
      <p className="text-[12px] leading-snug text-muted-foreground" data-computador-do-agente="desligado">
        Desligado. Nenhuma tarefa roda sem aprovação do dono, nada com senha de cliente passa pelo painel e cada passo deixa um print como prova.
      </p>
      {tarefas.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {tarefas.map((t) => (
            <li key={t.id} className="flex min-w-0 items-center py-1 text-[12px]">
              <span className="min-w-0 flex-1 truncate">{t.titulo}</span>
              <span className="ml-2 shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px]">{ROTULO_DA_TAREFA[t.estado] || t.estado}</span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

export default function EtapaEdicao() {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <OrganizadorDeTakes />
        <TranscricaoELegenda />
      </div>
      <div className="min-w-0 space-y-4">
        <PacoteParaEditar />
        <ComputadorDoAgente />
      </div>
    </div>
  );
}
