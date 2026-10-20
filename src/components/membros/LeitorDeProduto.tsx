import { useEffect, useRef, useState } from "react";
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
import { texto } from "@/components/sistema";

export function ConsumoMaterial({
  material,
  progresso,
  previa,
  teste,
}: {
  material: Material;
  progresso?: Progresso;
  previa?: string;
  teste?: TesteCliente;
}) {
  const cliente = useQueryClient();
  const { user } = useAuth();
  const [falha, setFalha] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(progresso?.concluido || false);
  const [baixando, setBaixando] = useState(false);
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
    <section className="min-w-0 space-y-4" aria-label={material.titulo}>
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
                  onEnded={(e) => atualizar(e.currentTarget, true)}
                  onError={() =>
                    setFalha(
                      "O vídeo não abriu ou o acesso temporário expirou. Use Renovar acesso ao arquivo.",
                    )
                  }
                />
              ) : (
                <audio
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
          ) : material.tipo === "pdf" ? (
            <iframe
              title={material.titulo}
              src={`${fonte.data.url}#toolbar=${material.permite_download ? 1 : 0}`}
              referrerPolicy="no-referrer"
            />
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
  const materiais = useQuery({
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
  useEffect(() => {
    if (
      materiais.data &&
      !materiais.data.materiais.some((m) => m.id === selecionado)
    )
      setSelecionado(materiais.data.materiais[0]?.id || "");
  }, [materiais.data, selecionado]);
  const atual = materiais.data?.materiais.find((m) => m.id === selecionado);
  const checkout = urlHttps(produto.checkout_url);
  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) fechar();
      }}
    >
      <DialogContent className="membros-modal">
        <header className="pr-8 space-y-2">
          <DialogTitle className={texto.tituloPagina}>
            {produto.titulo}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            {rotuloDoAcesso(produto)} · {produto.formato}
          </DialogDescription>
        </header>
        {!permitido ? (
          <div className="overflow-auto space-y-4">
            <p className="text-[13px] whitespace-pre-wrap">
              {produto.descricao}
            </p>
            {produto.condicoes && (
              <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">
                {produto.condicoes}
              </p>
            )}
            {pendente ? (
              <p role="status">
                Pagamento pendente. O conteúdo será liberado após confirmação
                segura.
              </p>
            ) : checkout ? (
              <a
                className="membros-acao bg-primary text-primary-foreground"
                href={checkout}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver oferta no checkout
              </a>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                <LockKeyhole className="inline mr-2" size={16} />
                Conteúdo bloqueado. A compra ainda não está disponível.
              </p>
            )}
          </div>
        ) : materiais.isPending ? (
          <p role="status">Carregando materiais…</p>
        ) : materiais.isError ? (
          <div role="alert">
            <p>{mensagemDoErro(materiais.error)}</p>
            <button
              className="membros-acao"
              onClick={() => void materiais.refetch()}
            >
              Tentar novamente
            </button>
          </div>
        ) : !materiais.data?.materiais.length ? (
          <p className="text-[13px] text-muted-foreground">
            Os materiais deste produto ainda não estão disponíveis.
          </p>
        ) : (
          <div className="membros-leitor">
            {atual && (
              <ConsumoMaterial
                previa={previa}
                teste={teste}
                key={atual.id}
                material={atual}
                progresso={materiais.data.progresso.find(
                  (p) => p.material_id === atual.id,
                )}
              />
            )}
            <nav
              aria-label="Materiais do produto"
              className="membros-sumario space-y-1"
            >
              <div className="pb-3 mb-2 border-b border-border">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Dentro deste produto
                </p>
                <p className="text-[13px] mt-2">
                  {materiais.data.progresso.filter((p) => p.concluido).length}{" "}
                  de {materiais.data.materiais.length} concluídos
                </p>
              </div>
              {materiais.data.materiais.map((m) => (
                <button
                  key={m.id}
                  aria-current={m.id === selecionado ? "page" : undefined}
                  className={`membros-acao w-full justify-start text-left ${m.id === selecionado ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                  onClick={() => setSelecionado(m.id)}
                >
                  {m.tipo === "video" || m.tipo === "audio" ? (
                    <Play size={16} className="shrink-0" />
                  ) : (
                    <FileText size={16} className="shrink-0" />
                  )}
                  <span className="min-w-0 break-words flex-1">
                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                      {m.tipo === "video"
                        ? "Aula em vídeo"
                        : m.permite_download
                          ? "Material para baixar"
                          : m.tipo === "audio"
                            ? "Áudio"
                            : "Material de leitura"}
                    </span>
                    {m.titulo}
                  </span>
                  {materiais.data.progresso.find((p) => p.material_id === m.id)
                    ?.concluido && (
                    <Check size={14} className="shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </nav>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
