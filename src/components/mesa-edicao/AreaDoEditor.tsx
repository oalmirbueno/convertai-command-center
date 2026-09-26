import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Film, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarMesaVideos, chaveDasVersoes, useVersoes } from "@/components/mesa-videos/videosApi";
import { motivoParaNaoMudar, type VersaoDeVideo } from "../../../supabase/functions/_shared/memoria-de-video";
import { duracaoDoClipe, migrarProjeto, ROTULO_DA_TRILHA, type ClipeDoProjeto, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { navegadorDoEditor } from "./editor/apoio";
import type { CenaDoRoteiro } from "@/lib/editor/skills";

/**
 * Área do editor (Mesa Edição, etapa Editar). Frente E2 reservou o espaço;
 * frente V-B (26/09) pluga aqui o EDITOR DE VÍDEO completo
 * (./editor/EditorDeVideo.tsx, carregado sob demanda).
 *
 * - Sem versão com projeto: mostra a montagem (os melhores takes na ordem das
 *   cenas) só para ler, e "Editar" cria a versão rascunho com esse projeto
 *   (versao_registrar) e abre o editor.
 * - Com versão editável (rascunho ou em revisão): abre o editor nela (a
 *   última, ou a escolhida, lembrada por cliente). Projeto antigo abre pela
 *   migração do formato (migrarProjeto). O editor salva sozinho por
 *   projeto_salvar (trava otimista pela revisão).
 * - Navegador antigo: aviso calmo e a montagem para ler (o editor pede
 *   navegador atual; o resto do painel continua no piso Safari 11).
 */

const EditorDeVideo = lazy(() => import("./editor/EditorDeVideo"));

const tempo = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const m = Math.floor(t / 60);
  const seg = t % 60;
  return `${m}:${seg < 10 ? `0${seg}` : seg}`;
};

class LimiteDoEditor extends Component<{ children: ReactNode; aoFalhar: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };
  static getDerivedStateFromError() {
    return { falhou: true };
  }
  componentDidCatch(e: unknown) {
    console.error("[editor de vídeo] falhou ao abrir", e instanceof Error ? e.name : "desconhecido");
  }
  render() {
    return this.state.falhou ? this.props.aoFalhar : this.props.children;
  }
}

function Previa({ projeto, clipe }: { projeto: ProjetoDeEdicao; clipe: ClipeDoProjeto | null }) {
  const fonte = clipe && clipe.fonte ? projeto.fontes[clipe.fonte] : null;
  const url = useUrlDaMesa(fonte ? fonte.storage_path : null, (fonte && fonte.storage_bucket) || "mesa");
  const alto = projeto.altura >= projeto.largura;
  return (
    <div className={juntar("mx-auto w-full min-w-0", alto ? "max-w-[240px]" : "max-w-[420px]")}>
      <div className="relative w-full overflow-hidden rounded-md bg-black" style={{ paddingBottom: `${Math.round((projeto.altura / projeto.largura) * 10000) / 100}%` }} data-previa-do-editor="">
        {url.data ? (
          <video
            key={`${url.data}#${clipe ? clipe.entrada_s : 0}`}
            src={`${url.data}#t=${clipe ? clipe.entrada_s : 0},${clipe ? clipe.saida_s : ""}`}
            controls
            preload="metadata"
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Film className="h-6 w-6" aria-hidden="true" />
          </div>
        )}
      </div>
      <p className={juntar(texto.auxiliar, "mt-1.5 truncate text-center")}>{fonte ? fonte.nome : "Escolha um clipe na linha do tempo"}</p>
    </div>
  );
}

/** A montagem só para ler (a área reservada da E2, igual). */
function Montagem({ projeto }: { projeto: ProjetoDeEdicao }) {
  const video = projeto.trilhas.find((t) => t.tipo === "video") || null;
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const clipe = (video && (video.clipes.find((c) => c.id === escolhido) || video.clipes[0])) || null;
  const total = projeto.duracao_s || 0;
  const vazio = !projeto.trilhas.some((t) => t.clipes.length);
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]" data-area-do-editor="reservada">
      <Previa projeto={projeto} clipe={clipe} />
      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 items-center">
          <p className={juntar(texto.rotulo, "mr-2")}>Linha do tempo</p>
          <span className={juntar(etiqueta, "bg-muted tabular-nums text-muted-foreground")}>{tempo(total)}</span>
          <span className={juntar(etiqueta, "ml-1 bg-muted text-muted-foreground")}>
            {projeto.formato} · {projeto.fps} fps{projeto.fps_informado ? "" : " (provisório)"}
          </span>
        </div>
        {vazio ? (
          <EstadoVazio compacto titulo="Sem clipe na linha do tempo." descricao="Marque os melhores takes em Organizar." />
        ) : (
          <ul className="space-y-1.5" aria-label="Trilhas do projeto">
            {projeto.trilhas.map((t) => (
              <li key={t.id} className="flex min-w-0 items-center" data-trilha={t.tipo}>
                <span className={juntar(texto.auxiliar, "w-24 shrink-0 truncate")}>{t.nome || ROTULO_DA_TRILHA[t.tipo]}</span>
                <div className="relative h-8 min-w-0 flex-1 overflow-hidden rounded bg-muted/50">
                  {t.clipes.map((c) => {
                    const esquerda = total > 0 ? (c.inicio_s / total) * 100 : 0;
                    const largura = total > 0 ? Math.max(0.8, (duracaoDoClipe(c) / total) * 100) : 0;
                    const fonte = c.fonte ? projeto.fontes[c.fonte] : null;
                    const ativo = clipe && c.id === clipe.id && t.tipo === "video";
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => t.tipo === "video" && setEscolhido(c.id)}
                        title={`${fonte ? fonte.nome : c.texto || "Clipe"} · ${tempo(c.inicio_s)} a ${tempo(c.inicio_s + duracaoDoClipe(c))}`}
                        aria-label={`${fonte ? fonte.nome : c.texto || "Clipe"}, de ${tempo(c.inicio_s)} a ${tempo(c.inicio_s + duracaoDoClipe(c))}`}
                        className={juntar(
                          "absolute inset-y-0.5 truncate rounded-sm px-1.5 text-left text-[11px] leading-7",
                          t.tipo === "video" ? "bg-primary/25 text-foreground" : "bg-secondary text-foreground",
                          ativo && "ring-2 ring-primary",
                        )}
                        style={{ left: `${esquerda}%`, width: `${largura}%` }}
                      >
                        {fonte ? fonte.nome : c.texto || ""}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const editavel = (v: VersaoDeVideo) => !!v.projeto && !motivoParaNaoMudar(v, "decidir");

export default function AreaDoEditor({ projeto, cenas, roteiroId }: { projeto: ProjetoDeEdicao; cenas?: CenaDoRoteiro[] | null; roteiroId?: string | null }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const versoesQ = useVersoes(clientId);
  const [escolhida, setEscolhida] = useEstadoDaTela<string>(`mesa-edicao:editor:versao:${clientId}`, "");
  const [aberto, setAberto] = useEstadoDaTela<boolean>(`mesa-edicao:editor:aberto:${clientId}`, false, { validar: (v) => typeof v === "boolean" });
  const [criando, setCriando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const navegador = navegadorDoEditor();

  const versoes = ((versoesQ.data && versoesQ.data.itens) || []).filter(editavel).sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1));
  const versao = aberto ? versoes.find((v) => v.id === escolhida) || versoes[0] || null : null;
  const migrado = versao ? migrarProjeto(versao.projeto) : null;

  const comecar = async () => {
    setCriando(true);
    try {
      const r = await chamarMesaVideos<{ versao: VersaoDeVideo }>({
        acao: "versao_registrar",
        client_id: clientId,
        titulo: projeto.titulo,
        roteiro_id: roteiroId || null,
        nota: "Projeto aberto no editor da Mesa Edição.",
        estado: "rascunho",
        projeto,
      });
      await queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      if (r && r.versao) setEscolhida(r.versao.id);
      setAberto(true);
    } catch (e) {
      toast.error("Não foi possível abrir o editor", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setCriando(false);
    }
  };

  const fechar = () => {
    setAberto(false);
    void queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
  };

  const recarregar = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) }).then(() => setRecarga((n) => n + 1));
  };

  if (!versao || !migrado || !migrado.projeto) {
    return (
      <div className="min-w-0">
        <div className="mb-3 flex min-w-0 flex-wrap items-center">
          {versoes.length > 0 && (
            <select className={juntar(campo, "mb-1 mr-2 h-8 w-auto max-w-[280px]")} value={escolhida} onChange={(e) => setEscolhida(e.target.value)} aria-label="Versão para editar">
              {versoes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.titulo} · v{v.numero}
                </option>
              ))}
            </select>
          )}
          <button type="button" className={juntar(botao.primario, "mb-1 h-8")} onClick={() => (versoes.length ? setAberto(true) : void comecar())} disabled={criando || !navegador.ok || !projeto.trilhas.some((t) => t.clipes.length)} data-abrir-editor="">
            {criando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pencil className="mr-1.5 h-3.5 w-3.5" />}
            {versoes.length ? "Abrir no editor" : "Editar"}
          </button>
          {!navegador.ok && <span className={juntar(texto.auxiliar, "mb-1 ml-2")}>O editor pede um navegador atualizado (Chrome, Edge ou Safari 14+).</span>}
          {versao && migrado && !migrado.projeto && <span className="mb-1 ml-2 text-[12px] text-destructive">O projeto desta versão não abriu.</span>}
        </div>
        <Montagem projeto={projeto} />
      </div>
    );
  }

  return (
    <div className="min-w-0" data-area-do-editor="editor">
      <div className="mb-2 flex min-w-0 items-center">
        {versoes.length > 1 ? (
          <select className={juntar(campo, "mr-2 h-8 w-auto max-w-[280px]")} value={versao.id} onChange={(e) => setEscolhida(e.target.value)} aria-label="Versão em edição">
            {versoes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.titulo} · v{v.numero}
              </option>
            ))}
          </select>
        ) : (
          <span className="mr-2 truncate text-[13px] font-medium">
            {versao.titulo} · v{versao.numero}
          </span>
        )}
        {migrado.de < 2 && <span className={juntar(etiqueta, "mr-2 bg-muted text-muted-foreground")}>formato antigo, abriu convertido</span>}
        {migrado.aviso && <span className="mr-2 text-[12px] text-amber-500">{migrado.aviso}</span>}
        <button type="button" className={juntar(botao.discreto, "ml-auto h-8")} onClick={fechar}>
          <X className="mr-1.5 h-3.5 w-3.5" />
          Fechar editor
        </button>
      </div>
      <LimiteDoEditor
        aoFalhar={
          <div className="space-y-3">
            <p className="text-[13px]">O editor não abriu neste navegador. Atualize o navegador (Chrome, Edge ou Safari 14+) ou recarregue a página. A montagem continua aqui para ler.</p>
            <Montagem projeto={migrado.projeto} />
          </div>
        }
      >
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center rounded-md bg-muted/40" aria-busy="true">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
              <span className={texto.auxiliar}>Abrindo o editor</span>
            </div>
          }
        >
          <EditorDeVideo key={`${versao.id}:${recarga}`} versaoId={versao.id} projetoInicial={migrado.projeto} revisao={migrado.projeto.revisao} cenas={cenas || null} onConflito={recarregar} />
        </Suspense>
      </LimiteDoEditor>
    </div>
  );
}
