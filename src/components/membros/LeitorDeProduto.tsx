import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import {
  Check,
  Download,
  FileText,
  Loader2,
  LockKeyhole,
  Play,
  RefreshCw,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  MessageCircle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  abrirArquivo,
  carregarMateriais,
  gravarProgresso,
  mensagemDoErro,
} from "@/lib/membros/api";
import {
  podeAbrir,
  rotuloDoAcesso,
  urlHttps,
  type Material,
  type Produto,
  type Progresso,
  type TesteCliente,
} from "@/lib/membros/modelo";
import { texto, AjudaRecolhida } from "@/components/sistema";
import { BotaoPomodoro, PomodoroCompacto } from "./FocoDeEstudo";
import OfertaDoProduto from "./OfertaDoProduto";
import ComunidadeDoCurso from "./ComunidadeDoCurso";
const PdfSeguro = lazy(() => import("./PdfSeguro"));

export function ConsumoMaterial({
  material,
  progresso,
  previa,
  teste,
  poster,
  onFim,
  autoplay = false,
}: {
  material: Material;
  progresso?: Progresso;
  previa?: string;
  teste?: TesteCliente;
  poster?: string;
  onFim?: () => void;
  autoplay?: boolean;
}) {
  const cliente = useQueryClient();
  const { user } = useAuth();
  const [falha, setFalha] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(progresso?.concluido || false);
  const [baixando, setBaixando] = useState(false);
  const midia = useRef<HTMLMediaElement | null>(null);
  const [velocidade, setVelocidade] = useState(1);
  const fila = useRef(Promise.resolve());
  const contexto = useRef({ previa, teste, feito });
  contexto.current.previa = previa;
  contexto.current.teste = teste;
  const ultimo = useRef(0);
  const posicaoAtual = useRef({
    posicao: progresso?.posicao || 0,
    duracao: progresso?.duracao || 0,
  });
  const fonte = useQuery({
    queryKey: [
      "membros",
      "arquivo",
      user?.id,
      previa,
      teste?.teste,
      teste?.bloqueado,
      material.id,
    ],
    queryFn: () => abrirArquivo(material.id, false, previa, teste),
    enabled: !!material.arquivo,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const salvar = async (
    posicao = 0,
    duracao = 0,
    concluido = contexto.current.feito,
  ) => {
    if (previa) return;
    contexto.current.feito = concluido;
    setSalvando(true);
    setFalha("");
    try {
      // Pausa, término e conclusão não podem se ultrapassar na rede.
      fila.current = fila.current
        .catch(() => {})
        .then(() =>
          gravarProgresso(material.id, posicao, duracao, concluido, teste),
        );
      await fila.current;
      setFeito(concluido);
      void cliente.invalidateQueries({ queryKey: ["membros", "catalogo"] });
      void cliente.invalidateQueries({ queryKey: ["membros", "materiais"] });
    } catch (e) {
      setFalha(`Não salvamos o progresso. ${mensagemDoErro(e)}`);
    } finally {
      setSalvando(false);
    }
  };
  useEffect(
    () => () => {
      const {
        previa: somenteLeitura,
        teste: modo,
        feito: concluido,
      } = contexto.current;
      const { posicao, duracao } = posicaoAtual.current;
      if (somenteLeitura || posicao <= 0) return;
      // Trocar a aula ou fechar o leitor preserva os segundos desde o último salvamento.
      fila.current = fila.current
        .catch(() => {})
        .then(() =>
          gravarProgresso(material.id, posicao, duracao, concluido, modo),
        )
        .catch(() => {});
    },
    [material.id],
  );
  const atualizar = (el: HTMLMediaElement, fim = false, forcar = false) => {
    if (!Number.isFinite(el.duration) || !Number.isFinite(el.currentTime))
      return;
    posicaoAtual.current = { posicao: el.currentTime, duracao: el.duration };
    if (!fim && !forcar && Date.now() - ultimo.current < 15000) return;
    ultimo.current = Date.now();
    void salvar(el.currentTime, el.duration, fim || contexto.current.feito);
  };
  async function baixar() {
    setBaixando(true);
    setFalha("");
    try {
      const { url } = await abrirArquivo(material.id, true, previa, teste);
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      a.download = material.titulo;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setFalha(mensagemDoErro(e));
    } finally {
      setBaixando(false);
    }
  }
  return (
    <section
      className="membros-material-conteudo min-w-0 space-y-4"
      aria-label={material.titulo}
    >
      <h2 className={texto.tituloSecao}>{material.titulo}</h2>
      {material.tipo === "texto" ? (
        <article className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown
            components={{
              a: ({ href, children }) =>
                urlHttps(href) ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ) : (
                  <span>{children}</span>
                ),
              img: () => null,
            }}
          >
            {material.texto}
          </ReactMarkdown>
        </article>
      ) : fonte.isPending ? (
        <p role="status" className={texto.auxiliar}>
          Abrindo material…
        </p>
      ) : fonte.isError ? (
        <div role="alert">
          <p>{mensagemDoErro(fonte.error)}</p>
          <button className="membros-acao" onClick={() => void fonte.refetch()}>
            Tentar novamente
          </button>
        </div>
      ) : fonte.data ? (
        <>
          {material.tipo === "video" || material.tipo === "audio" ? (
            <>
              {material.tipo === "video" ? (
                <video
                  ref={(el) => {
                    midia.current = el;
                  }}
                  poster={poster}
                  autoPlay={autoplay}
                  key={fonte.data.url}
                  src={fonte.data.url}
                  controls
                  preload="metadata"
                  controlsList={
                    material.permite_download ? undefined : "nodownload"
                  }
                  onLoadedMetadata={(e) => {
                    e.currentTarget.currentTime = Math.min(
                      progresso?.posicao || 0,
                      e.currentTarget.duration || 0,
                    );
                  }}
                  onTimeUpdate={(e) => atualizar(e.currentTarget)}
                  onPause={(e) => atualizar(e.currentTarget, false, true)}
                  onEnded={(e) => {
                    atualizar(e.currentTarget, true);
                    onFim?.();
                  }}
                  onError={() =>
                    setFalha(
                      "O vídeo não abriu ou o acesso temporário expirou. Use Renovar acesso ao arquivo.",
                    )
                  }
                />
              ) : (
                <audio
                  ref={(el) => {
                    midia.current = el;
                  }}
                  src={fonte.data.url}
                  controls
                  preload="metadata"
                  controlsList={
                    material.permite_download ? undefined : "nodownload"
                  }
                  onLoadedMetadata={(e) => {
                    e.currentTarget.currentTime = progresso?.posicao || 0;
                  }}
                  onTimeUpdate={(e) => atualizar(e.currentTarget)}
                  onPause={(e) => atualizar(e.currentTarget, false, true)}
                  onEnded={(e) => atualizar(e.currentTarget, true)}
                  onError={() =>
                    setFalha("O áudio não abriu. Renove o acesso ao arquivo.")
                  }
                />
              )}
            </>
          ) : material.tipo === "pdf" ||
            material.arquivo?.toLowerCase().endsWith(".pdf") ? (
            <Suspense fallback={<p role="status">Preparando leitor de PDF…</p>}>
              <PdfSeguro url={fonte.data.url} titulo={material.titulo} />
            </Suspense>
          ) : (
            <p className={texto.corpo}>
              Arquivo disponível
              {material.permite_download
                ? " para download."
                : ". O download não foi autorizado. Peça à administração uma versão de leitura."}
            </p>
          )}
          <details className="text-[12px] text-muted-foreground">
            <summary className="cursor-pointer min-h-11 inline-flex items-center gap-2">
              <RefreshCw size={14} />
              Problema ao abrir?
            </summary>
            <button
              className="membros-acao"
              onClick={() => void fonte.refetch()}
            >
              Renovar acesso ao arquivo
            </button>
          </details>
        </>
      ) : null}
      {(material.tipo === "video" || material.tipo === "audio") && (
        <div className="flex flex-wrap gap-1 items-center">
          <button
            className="membros-acao text-muted-foreground"
            aria-label="Voltar 10 segundos"
            onClick={() => {
              const el = midia.current;
              if (el) {
                el.currentTime = Math.max(0, el.currentTime - 10);
                atualizar(el, false, true);
              }
            }}
          >
            <SkipBack size={15} />
            10 s
          </button>
          <button
            className="membros-acao text-muted-foreground"
            aria-label="Avançar 10 segundos"
            onClick={() => {
              const el = midia.current;
              if (el && Number.isFinite(el.duration)) {
                el.currentTime = Math.min(el.duration, el.currentTime + 10);
                atualizar(el, false, true);
              }
            }}
          >
            10 s<SkipForward size={15} />
          </button>
          <label className="ml-auto text-[12px] flex items-center gap-2">
            Velocidade{" "}
            <select
              aria-label="Velocidade da aula"
              className="bg-muted rounded px-2 py-2"
              value={velocidade}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVelocidade(v);
                if (midia.current) midia.current.playbackRate = v;
              }}
            >
              {[0.75, 1, 1.25, 1.5, 1.75, 2].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {material.tipo !== "texto" && material.texto && (
        <section className="membros-descricao-aula">
          <h3 className="text-[14px] font-semibold mb-2">
            {material.tipo === "video" || material.tipo === "audio"
              ? "Sobre esta aula"
              : "Sobre este material"}
          </h3>
          <article className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown
              components={{
                img: () => null,
                a: ({ href, children }) =>
                  urlHttps(href) ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ) : (
                    <span>{children}</span>
                  ),
              }}
            >
              {material.texto}
            </ReactMarkdown>
          </article>
        </section>
      )}
      {falha && (
        <p role="alert" className="text-[13px] text-destructive">
          {falha}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {material.permite_download && material.arquivo && (
          <button
            className="membros-acao bg-primary text-primary-foreground"
            disabled={baixando}
            onClick={() => void baixar()}
          >
            <Download size={16} />
            {baixando ? "Preparando…" : "Baixar arquivo"}
          </button>
        )}
        <button
          className="membros-acao border border-border"
          disabled={salvando || !!previa}
          onClick={() =>
            void salvar(
              posicaoAtual.current.posicao,
              posicaoAtual.current.duracao,
              !feito,
            )
          }
        >
          {salvando ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}{" "}
          {feito ? "Concluído · desfazer" : "Marcar como concluído"}
        </button>
      </div>
    </section>
  );
}

export default function LeitorDeProduto({
  produto,
  fechar,
  pendente,
  previa,
  teste,
}: {
  produto: Produto;
  fechar: () => void;
  pendente: boolean;
  previa?: string;
  teste?: TesteCliente;
}) {
  const { user } = useAuth();
  const permitido = podeAbrir(produto);
  const [selecionado, setSelecionado] = useState(produto.ultimo_material || "");
  const [foco, setFoco] = useState(false);
  const [sumario, setSumario] = useState(true);
  const [aba, setAba] = useState<"aula" | "materiais" | "comunidade">("aula");
  const [autoProxima, setAutoProxima] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);
  const dados = useQuery({
    queryKey: [
      "membros",
      "materiais",
      user?.id,
      previa,
      teste?.teste,
      teste?.bloqueado,
      produto.id,
    ],
    queryFn: () => carregarMateriais(produto.id, previa, teste),
    enabled: permitido,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const materiais = dados.data?.materiais || [];
  const modulos = dados.data?.modulos || [];
  const progresso = dados.data?.progresso || [];
  const concluidos = progresso.filter((p) => p.concluido).length;
  const percentualConcluido = materiais.length
    ? Math.min(100, Math.round((100 * concluidos) / materiais.length))
    : 0;
  useEffect(() => {
    if (dados.data && !dados.data.materiais.some((m) => m.id === selecionado))
      setSelecionado(
        dados.data.materiais.find((m) => !m.aula_id)?.id ||
          dados.data.materiais[0]?.id ||
          "",
      );
  }, [dados.data, selecionado]);
  const atual = materiais.find((m) => m.id === selecionado);
  const base = atual?.aula_id
    ? materiais.find((m) => m.id === atual.aula_id)
    : atual;
  const grupos = [
    ...modulos.map((m) => ({ id: m.id, titulo: m.titulo })),
    {
      id: "",
      titulo: modulos.length ? "Outros materiais" : "Conteúdo do produto",
    },
  ]
    .map((g) => ({
      ...g,
      itens: materiais.filter(
        (m) => !m.aula_id && (m.modulo_id || "") === g.id,
      ),
    }))
    .filter((g) => g.itens.length);
  const aulas = grupos.flatMap((g) => g.itens);
  const indice = aulas.findIndex((m) => m.id === base?.id);
  const anterior = aulas[indice - 1];
  const proxima = aulas[indice + 1];
  const complementos = base
    ? materiais.filter((m) => m.aula_id === base.id)
    : [];
  function abrir(id: string, automatico = false) {
    setSelecionado(id);
    setAba("aula");
    setAutoplay(automatico);
    rolagem.current?.scrollTo({ top: 0, behavior: "instant" });
  }
  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) fechar();
      }}
    >
      <DialogContent
        className={`membros-modal membros-modal-curso ${foco ? "membros-modal-foco" : ""}`}
        onEscapeKeyDown={(e) => {
          if (foco) {
            e.preventDefault();
            setFoco(false);
          }
        }}
      >
        <header className="membros-leitor-cabecalho membros-curso-banner">
          <img
            key={produto.capa_url || "capa-padrao"}
            className="membros-curso-banner-imagem"
            src={
              urlHttps(produto.capa_url) || "/membros/capas/boas-vindas-v2.webp"
            }
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            decoding="async"
            onError={(evento) => {
              evento.currentTarget.hidden = true;
            }}
          />
          {permitido && (
            <button
              className="membros-acao membros-curso-menu shrink-0"
              aria-label={
                sumario
                  ? "Recolher conteúdo do curso"
                  : "Mostrar conteúdo do curso"
              }
              aria-expanded={sumario}
              onClick={() => setSumario((s) => !s)}
            >
              {sumario ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </button>
          )}
          <div className="membros-curso-identidade min-w-0">
            <span className="membros-curso-categoria">
              {produto.categoria || "Biblioteca Aceleriq"}
            </span>
            <DialogTitle className={texto.tituloPagina}>
              {produto.titulo}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {rotuloDoAcesso(produto)} · {produto.formato}
            </DialogDescription>
          </div>
          {permitido && (
            <div className="membros-curso-controles flex items-center gap-1 mr-6">
              <BotaoPomodoro compacto />
              <button
                className="membros-acao"
                aria-label={foco ? "Sair do modo foco" : "Entrar no modo foco"}
                title="Modo foco"
                onClick={() => {
                  if (!foco) setSumario(false);
                  setFoco((f) => !f);
                }}
              >
                {foco ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            </div>
          )}
        </header>
        {!permitido ? (
          <OfertaDoProduto produto={produto} pendente={pendente} />
        ) : dados.isPending ? (
          <p role="status">Carregando materiais…</p>
        ) : dados.isError ? (
          <div role="alert">
            <p>{mensagemDoErro(dados.error)}</p>
            <button
              className="membros-acao"
              onClick={() => void dados.refetch()}
            >
              Tentar novamente
            </button>
          </div>
        ) : !materiais.length ? (
          <p className="text-[13px] text-muted-foreground">
            Os materiais deste produto ainda não estão disponíveis.
          </p>
        ) : (
          <div
            className={`membros-leitor membros-leitor-curso ${!sumario ? "sem-sumario" : ""}`}
          >
            {sumario && (
              <nav
                aria-label="Materiais do produto"
                className="membros-sumario"
              >
                <div className="membros-sumario-topo">
                  <p className="text-[13px] font-semibold">Conteúdo do curso</p>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    {concluidos} de {materiais.length} concluídos
                  </p>
                  <div
                    className="membros-progresso mt-3"
                    role="progressbar"
                    aria-label="Progresso do curso"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percentualConcluido}
                  >
                    <span
                      style={{
                        width: `${percentualConcluido}%`,
                      }}
                    />
                  </div>
                </div>
                {grupos.map((g) => (
                  <details key={g.id} open className="membros-modulo">
                    <summary>
                      {g.titulo}
                      <span>{g.itens.length}</span>
                    </summary>
                    <div>
                      {g.itens.map((m) => (
                        <div key={m.id}>
                          <button
                            aria-current={
                              m.id === base?.id ? "page" : undefined
                            }
                            className="membros-acao w-full text-left"
                            onClick={() => abrir(m.id)}
                          >
                            {m.tipo === "video" || m.tipo === "audio" ? (
                              <Play size={15} className="shrink-0" />
                            ) : (
                              <FileText size={15} className="shrink-0" />
                            )}
                            <span className="flex-1 min-w-0 break-words">
                              {m.titulo}
                            </span>
                            {progresso.find((p) => p.material_id === m.id)
                              ?.concluido && (
                              <Check
                                size={14}
                                className="text-primary shrink-0"
                              />
                            )}
                          </button>
                          {materiais
                            .filter((c) => c.aula_id === m.id)
                            .map((c) => (
                              <button
                                key={c.id}
                                aria-current={
                                  c.id === selecionado ? "page" : undefined
                                }
                                className="membros-complemento-link"
                                onClick={() => abrir(c.id)}
                              >
                                <Paperclip size={12} />
                                <span>{c.titulo}</span>
                                {progresso.find((p) => p.material_id === c.id)
                                  ?.concluido && <Check size={12} />}
                              </button>
                            ))}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </nav>
            )}
            <div className="membros-aula-principal">
              <div className="membros-abas">
                <button
                  className="membros-acao"
                  aria-current={aba === "aula" ? "page" : undefined}
                  onClick={() => setAba("aula")}
                >
                  {atual?.tipo === "video" ? "Aula" : "Conteúdo"}
                </button>
                <button
                  className="membros-acao"
                  aria-current={aba === "materiais" ? "page" : undefined}
                  onClick={() => setAba("materiais")}
                >
                  <Paperclip size={15} />
                  Complementos{" "}
                  {complementos.length ? `(${complementos.length})` : ""}
                </button>
                {produto.comunidade_ativa && (
                  <button
                    className="membros-acao"
                    aria-current={aba === "comunidade" ? "page" : undefined}
                    onClick={() => setAba("comunidade")}
                  >
                    <MessageCircle size={15} />
                    Comunidade
                  </button>
                )}
              </div>
              <div className="membros-aula-rolagem" ref={rolagem}>
                {aba === "aula" && atual && (
                  <ConsumoMaterial
                    key={atual.id}
                    material={atual}
                    progresso={progresso.find(
                      (p) => p.material_id === atual.id,
                    )}
                    previa={previa}
                    teste={teste}
                    poster={urlHttps(produto.capa_url) || undefined}
                    autoplay={autoplay}
                    onFim={() => {
                      if (autoProxima && proxima) abrir(proxima.id, true);
                    }}
                  />
                )}
                {aba === "materiais" && (
                  <section
                    className="space-y-4"
                    aria-label="Materiais complementares"
                  >
                    <h2 className="text-[15px] font-semibold">
                      Materiais complementares
                    </h2>
                    <AjudaRecolhida rotulo="Sobre os complementos">
                      Materiais vinculados a {base?.titulo}. Abra para ler ou
                      baixar quando disponível.
                    </AjudaRecolhida>
                    {complementos.length ? (
                      complementos.map((m) => (
                        <button
                          key={m.id}
                          className="membros-material-cartao"
                          onClick={() => abrir(m.id)}
                        >
                          <FileText size={22} className="text-primary" />
                          <span className="flex-1 text-left">
                            <strong className="block text-[13px]">
                              {m.titulo}
                            </strong>
                            <small className="text-muted-foreground">
                              {m.tipo === "pdf" || m.arquivo?.endsWith(".pdf")
                                ? "PDF para ler aqui"
                                : m.permite_download
                                  ? "Arquivo para baixar"
                                  : "Material de apoio"}
                            </small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      ))
                    ) : (
                      <p className="text-[13px] text-muted-foreground py-6">
                        Esta aula ainda não tem materiais complementares.
                      </p>
                    )}
                  </section>
                )}
                {aba === "comunidade" && produto.comunidade_ativa && (
                  <ComunidadeDoCurso
                    produto={produto.id}
                    teste={teste}
                    previa={previa}
                  />
                )}
              </div>
              <footer className="membros-aula-rodape">
                <button
                  className="membros-acao"
                  aria-label={atual?.aula_id ? "Voltar à aula" : "Anterior"}
                  disabled={!atual?.aula_id && !anterior}
                  onClick={() =>
                    atual?.aula_id && base
                      ? abrir(base.id)
                      : anterior && abrir(anterior.id)
                  }
                >
                  <ChevronLeft size={16} />
                  <span className="hidden sm:inline">
                    {atual?.aula_id ? "Voltar à aula" : "Anterior"}
                  </span>
                </button>
                <PomodoroCompacto />
                <AjudaRecolhida rotulo="Opções de reprodução">
                  <label className="flex items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={autoProxima}
                      onChange={(e) => setAutoProxima(e.target.checked)}
                    />
                    Próxima aula automaticamente
                  </label>
                </AjudaRecolhida>
                <button
                  className="membros-acao border border-border"
                  aria-label={
                    base?.tipo === "video" ? "Próxima aula" : "Próximo conteúdo"
                  }
                  disabled={!proxima}
                  onClick={() => proxima && abrir(proxima.id)}
                >
                  <span className="hidden sm:inline">
                    {base?.tipo === "video"
                      ? "Próxima aula"
                      : "Próximo conteúdo"}
                  </span>
                  <ChevronRight size={16} />
                </button>
              </footer>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
