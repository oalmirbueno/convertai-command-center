import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, Check, ExternalLink, ImagePlus, Instagram, Link2, Loader2, MoreHorizontal, RefreshCw, ScanEye } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useLargo } from "@/components/sistema/AreaDeTrabalho";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campoTexto, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { useMesa } from "@/components/mesa/MesaContexto";
import { avisarCustoReal, useAvisarErro } from "@/components/mesa/Custo";
import { supabase } from "@/integrations/supabase/client";
import { gravarCopiasSemEsperar, urlsLevesEmLote } from "@/lib/miniaturas";
import AgenteDoPerfil from "./AgenteDoPerfil";
import {
  chamarPerfis,
  chaveDaLista,
  chaveDoPerfil,
  dataCurta,
  emPorcentagem,
  MAX_POSTS_NO_ESTILO,
  nomeUnico,
  normalizarLinkDePost,
  numeroCurto,
  type PerfilAbertoDados,
  type PerfilNaLista,
  type PostDoPerfil,
  ROTULO_DO_FORMATO,
  ROTULO_DO_FORMATO_EDITORIAL,
} from "./perfisApi";

/**
 * Um perfil aberto: grade dos posts (miniaturas próprias), fora da curva
 * marcados, filtros por formato e pilar, o resumo e o agente do perfil. No
 * computador o agente fica ao lado, parado; no celular abre em tela cheia.
 * Filtros e seleção ficam lembrados por perfil.
 */

type Filtros = { formato: string; pilar: string; fora: boolean };
const FILTROS_INICIAIS: Filtros = { formato: "todos", pilar: "todos", fora: false };

const ROTULOS_DO_RESUMO: Array<[keyof NonNullable<PerfilNaLista["resumo"]>, string]> = [
  ["padrao_visual", "Padrão visual"],
  ["padrao_editorial", "Padrão editorial"],
  ["o_que_funciona", "O que funciona"],
  ["o_que_evitar", "O que evitar"],
];

export function filtrarPosts(posts: PostDoPerfil[], f: Filtros): PostDoPerfil[] {
  return posts.filter((p) => (f.formato === "todos" || p.formato === f.formato) && (f.pilar === "todos" || p.pilar === f.pilar) && (!f.fora || p.fora_da_curva));
}

function CartaoDoPost({ post, url, escolhido, onEscolher }: { post: PostDoPerfil; url?: string; escolhido: boolean; onEscolher: () => void }) {
  const linha = [
    post.formato_editorial ? ROTULO_DO_FORMATO_EDITORIAL[post.formato_editorial] || post.formato_editorial : ROTULO_DO_FORMATO[post.formato as keyof typeof ROTULO_DO_FORMATO] || post.formato,
    post.engajamento !== null ? emPorcentagem(Number(post.engajamento)) : "",
  ].filter(Boolean).join(" · ");
  const titulo = [post.ref, post.legenda ? post.legenda.slice(0, 180) : "", post.leitura ? `Imagem: ${post.leitura.slice(0, 180)}` : ""].filter(Boolean).join("\n");
  return (
    <li className="min-w-0" data-post={post.ref}>
      <div className={juntar("relative w-full overflow-hidden rounded-md bg-muted", escolhido ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "")} style={{ paddingBottom: "125%" }}>
        {post.midia_caminho ? (
          <button type="button" onClick={onEscolher} aria-pressed={escolhido} aria-label={`${escolhido ? "Tirar" : "Escolher"} ${post.ref}`} title={titulo} className="absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {url ? <img src={url} alt={post.leitura ? post.leitura.slice(0, 120) : `Post ${post.ref}`} loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : null}
          </button>
        ) : (
          <a href={post.permalink || "#"} target="_blank" rel="noreferrer" className="absolute inset-0 flex flex-col items-center justify-center text-[11px] text-muted-foreground hover:text-foreground" title={post.permalink || ""}>
            <Link2 className="mb-1 h-4 w-4" aria-hidden="true" />
            Abrir o post
          </a>
        )}
        {post.fora_da_curva && (
          <span className={juntar(etiqueta, "pointer-events-none absolute left-1 top-1 bg-primary text-primary-foreground")} title="Fora da curva: engajamento 2x a mediana ou mais">
            {post.vezes_a_mediana ? `${String(post.vezes_a_mediana).replace(".", ",")}x` : "fora da curva"}
          </span>
        )}
        {escolhido && (
          <span className="pointer-events-none absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
            <Check className="h-3 w-3" />
          </span>
        )}
        <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-background/80 px-1 text-[10px] tabular-nums text-foreground">{post.ref}</span>
      </div>
      <p className={juntar(texto.auxiliar, "mt-1 truncate")}>{linha || "sem leitura"}</p>
    </li>
  );
}

function JanelaDeEnvio({ aberta, onFechar, perfil, onEnviado }: { aberta: boolean; onFechar: () => void; perfil: PerfilNaLista; onEnviado: () => void }) {
  const { clientId, marca } = useMesa();
  const marcaId = marca && !marca.principal ? marca.id : null;
  const avisarErro = useAvisarErro();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [links, setLinks] = useState("");
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement | null>(null);
  const linksValidos = links.split(/\s+/).map(normalizarLinkDePost).filter(Boolean).length;

  const escolher = (e: ChangeEvent<HTMLInputElement>) => {
    const lista = Array.prototype.slice.call(e.target.files || []) as File[];
    setArquivos(lista.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type)).slice(0, 24));
  };

  const enviar = async () => {
    if (enviando || (!arquivos.length && !linksValidos)) return;
    setEnviando(true);
    try {
      const caminhos: string[] = [];
      for (const f of arquivos) {
        const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
        const caminho = `${clientId}/perfis/${perfil.id}/manual/${nomeUnico(ext)}`;
        const { error } = await supabase.storage.from("mesa").upload(caminho, f, { contentType: f.type, upsert: false });
        if (error) throw error;
        gravarCopiasSemEsperar("mesa", caminho, f, { nome: f.name, mime: f.type });
        caminhos.push(caminho);
      }
      const r = await chamarPerfis<{ novos: number }>("enviar", clientId, marcaId, { perfil_id: perfil.id, arquivos: caminhos.map((c) => ({ caminho: c })), links: links.split(/\s+/).filter(Boolean) });
      toast.success(`${r.novos} ${r.novos === 1 ? "item guardado" : "itens guardados"} em @${perfil.handle}`);
      setArquivos([]);
      setLinks("");
      onEnviado();
      onFechar();
    } catch (e) {
      avisarErro(e, "Prints e links não guardados");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={aberta} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-lg">
        <DialogTitle className={texto.tituloSecao}>Prints e links de @{perfil.handle}</DialogTitle>
        <DialogDescription className="sr-only">Envie prints do grid ou de posts e cole links de posts.</DialogDescription>
        <div className="space-y-3">
          <CampoDeFormulario rotulo="Prints" apoio={arquivos.length ? `${arquivos.length} ${arquivos.length === 1 ? "imagem" : "imagens"}` : "Grid, post ou carrossel. Print com várias artes vale."}>
            <div className="flex min-w-0 items-center">
              <button type="button" className={botao.secundario} onClick={() => entrada.current && entrada.current.click()}>
                <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Escolher imagens
              </button>
              <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={escolher} />
            </div>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Links de posts" apoio={linksValidos ? `${linksValidos} ${linksValidos === 1 ? "link" : "links"} de post` : "Um por linha."}>
            <textarea className={campoTexto} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://www.instagram.com/p/..." />
          </CampoDeFormulario>
          <div className="flex items-center justify-end">
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={onFechar}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} disabled={enviando || (!arquivos.length && !linksValidos)} onClick={() => void enviar()}>
              {enviando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Guardar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PerfilAberto({
  perfil,
  fotoUrl,
  capturaApi,
  onVoltar,
}: {
  perfil: PerfilNaLista;
  fotoUrl?: string;
  capturaApi: { disponivel: boolean; motivo: string | null };
  onVoltar: () => void;
}) {
  const { clientId, marca, atualizarCusto } = useMesa();
  const marcaId = marca && !marca.principal ? marca.id : null;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const largo = useLargo();
  const [filtros, setFiltros] = useEstadoDaTela<Filtros>(`mesa:perfis:filtros:${perfil.id}`, FILTROS_INICIAIS, {
    validar: (v) => !!v && typeof v === "object" && typeof (v as Filtros).formato === "string",
  });
  const [escolhidos, setEscolhidos] = useEstadoDaTela<string[]>(`mesa:perfis:escolhidos:${perfil.id}`, [], { validar: (v) => Array.isArray(v) });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [agenteAberto, setAgenteAberto] = useState(false);

  const consulta = useQuery({
    queryKey: chaveDoPerfil(clientId, perfil.id),
    queryFn: () => chamarPerfis<PerfilAbertoDados>("perfil", clientId, null, { perfil_id: perfil.id }),
    staleTime: 60_000,
    placeholderData: (anterior) => anterior,
  });
  const dados = consulta.data || null;
  const posts = useMemo(() => (dados ? dados.posts : []), [dados]);
  const caminhos = posts.map((p) => p.midia_caminho).filter((c): c is string => !!c);
  const urls = useQuery({
    queryKey: ["perfis-instagram", clientId, perfil.id, "urls", caminhos.join("|")],
    enabled: caminhos.length > 0,
    staleTime: 40 * 60_000,
    queryFn: () => urlsLevesEmLote("mesa", caminhos),
    placeholderData: (anterior) => anterior,
  });

  const reler = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: chaveDoPerfil(clientId, perfil.id) }),
      queryClient.invalidateQueries({ queryKey: chaveDaLista(clientId) }),
    ]);
  };

  const rodar = async (acao: "capturar" | "ler" | "resumo" | "arquivar", rotulo: string, extra: Record<string, unknown> = {}) => {
    if (ocupado) return;
    setOcupado(acao);
    try {
      const r = await chamarPerfis<any>(acao, clientId, marcaId, { perfil_id: perfil.id, ...extra });
      if (acao === "capturar") toast.success(`${r.novos} ${r.novos === 1 ? "post novo" : "posts novos"}`, { description: r.fora_da_curva ? `${r.fora_da_curva} fora da curva.` : undefined });
      else if (acao === "arquivar") {
        toast.success(`@${perfil.handle} arquivado`);
        onVoltar();
      } else avisarCustoReal(rotulo, r, atualizarCusto);
      await reler();
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const formatos = Array.from(new Set(posts.map((p) => p.formato)));
  const pilares = Array.from(new Set(posts.map((p) => p.pilar).filter((x): x is string => !!x)));
  const visiveis = filtrarPosts(posts, filtros);
  const escolhidosValidos = escolhidos.filter((id) => posts.some((p) => p.id === id && !!p.midia_caminho));
  const alternar = (id: string) =>
    setEscolhidos((atual) => (atual.indexOf(id) >= 0 ? atual.filter((x) => x !== id) : atual.length >= MAX_POSTS_NO_ESTILO ? atual : atual.concat([id])));
  const resumo = (dados && dados.perfil.resumo) || perfil.resumo;
  const m = (dados && dados.perfil.metricas) || perfil.metricas || {};
  const semLeitura = posts.filter((p) => !p.lido_em && !!p.midia_caminho).length;
  const numeros = [
    m.por_semana ? `${String(m.por_semana).replace(".", ",")} posts por semana` : "",
    m.engajamento_mediano !== undefined && m.engajamento_mediano !== null ? `engajamento mediano ${emPorcentagem(m.engajamento_mediano)}` : "",
    m.mix ? Object.keys(m.mix).map((k) => `${m.mix![k]} ${(ROTULO_DO_FORMATO as Record<string, string>)[k] || k}`).join(", ") : "",
    m.horas_mais_usadas && m.horas_mais_usadas.length ? `posta às ${m.horas_mais_usadas.map((h) => `${h}h`).join(", ")}` : "",
  ].filter(Boolean);

  const agente = (
    <AgenteDoPerfil
      perfil={perfil}
      mensagens={dados ? dados.mensagens : []}
      escolhidos={escolhidosValidos}
      posts={posts}
      onMudou={() => void reler()}
      onLimparEscolha={() => setEscolhidos([])}
    />
  );

  return (
    <div className="min-w-0" data-perfil-aberto={perfil.handle}>
      <div className="flex min-w-0 items-center">
        <button type="button" onClick={onVoltar} className={botao.icone} aria-label="Voltar aos perfis" title="Voltar aos perfis">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
          {fotoUrl ? <img src={fotoUrl} alt={`Foto de @${perfil.handle}`} className="h-full w-full object-cover" /> : <Instagram className="h-4 w-4" aria-hidden="true" />}
        </span>
        <div className="ml-2 mr-2 min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-foreground">@{perfil.handle}</p>
          <p className={juntar(texto.auxiliar, "truncate")}>
            {[perfil.seguidores !== null ? `${numeroCurto(perfil.seguidores)} seguidores` : "", `${posts.length} posts`, perfil.capturado_em ? `capturado ${dataCurta(perfil.capturado_em)}` : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        {capturaApi.disponivel && (
          <button type="button" className={juntar(botao.secundario, "hidden px-3.5 sm:inline-flex")} onClick={() => void rodar("capturar", "Captura")} disabled={!!ocupado} aria-label="Capturar pela API" title="Capturar pela API (só posts novos)">
            {ocupado === "capturar" ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" aria-hidden="true" /> : <RefreshCw className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />}
            <span className="hidden sm:inline">Capturar</span>
          </button>
        )}
        {semLeitura > 0 && (
          <button type="button" className={juntar(botao.secundario, "ml-1.5 hidden px-3.5 sm:inline-flex")} onClick={() => void rodar("ler", "Leitura dos posts")} disabled={!!ocupado} aria-label={`Ler ${semLeitura} posts com IA`} title={`Ler ${semLeitura} posts (visão e Jev, centavos)`}>
            {ocupado === "ler" ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" aria-hidden="true" /> : <ScanEye className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />}
            <span className="hidden sm:inline">Ler {semLeitura}</span>
          </button>
        )}
        {!largo && (
          <button type="button" className={juntar(botao.secundario, "ml-1.5 px-2.5")} onClick={() => setAgenteAberto(true)} aria-label="Abrir o agente do perfil" title="Agente do perfil">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={juntar(botao.icone, "ml-1")} aria-label="Mais ações do perfil">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {capturaApi.disponivel && (
              <DropdownMenuItem className="sm:hidden" onSelect={() => void rodar("capturar", "Captura")} disabled={!!ocupado}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Capturar
              </DropdownMenuItem>
            )}
            {semLeitura > 0 && (
              <DropdownMenuItem className="sm:hidden" onSelect={() => void rodar("ler", "Leitura dos posts")} disabled={!!ocupado}>
                <ScanEye className="mr-2 h-4 w-4" aria-hidden="true" /> Ler {semLeitura} posts
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setEnviando(true)}>
              <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" /> Prints e links
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void rodar("resumo", "Resumo do perfil", { forcar: true })} disabled={!posts.length}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Refazer o resumo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.open(`https://www.instagram.com/${perfil.handle}/`, "_blank", "noopener")}>
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" /> Abrir no Instagram
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void rodar("arquivar", "Arquivar")} className="text-destructive">
              Arquivar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={juntar("mt-3 min-w-0", largo ? "grid grid-cols-[minmax(0,1fr)_340px] gap-5 xl:grid-cols-[minmax(0,1fr)_380px]" : "")}>
        <div className="min-w-0">
          {consulta.isLoading && !dados ? (
            <Carregando forma="grade" linhas={2} rotulo="Carregando os posts" />
          ) : consulta.isError && !dados ? (
            <EstadoDeErro descricao="Os posts não carregaram." acao={<button type="button" className={botao.secundario} onClick={() => void consulta.refetch()}>Tentar de novo</button>} />
          ) : (
            <>
              {resumo && (resumo.padrao_visual || resumo.padrao_editorial) ? (
                <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2" data-resumo-do-perfil="">
                  {ROTULOS_DO_RESUMO.filter(([k]) => resumo[k]).map(([k, rotulo]) => (
                    <div key={k} className="min-w-0">
                      <dt className={texto.rotulo}>{rotulo}</dt>
                      <dd className="mt-0.5 text-[12.5px] leading-5 text-foreground [overflow-wrap:anywhere]">{String(resumo[k])}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <div className="mt-2 flex min-w-0 items-center">
                <p className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")} title={numeros.join(" · ")}>
                  {numeros.length ? numeros.join(" · ") : "Sem números ainda"}
                </p>
                <AjudaRecolhida className="ml-1.5" rotulo="Como ler a grade">
                  Toque nos posts para escolher (até {MAX_POSTS_NO_ESTILO}) e leve ao estilo pelo agente. O número em verde é quantas vezes o engajamento passou da mediana do perfil (fora da curva).
                </AjudaRecolhida>
              </div>

              {posts.length === 0 ? (
                <EstadoVazio
                  compacto
                  className="mt-3"
                  icone={<Instagram className="h-4 w-4" />}
                  titulo="Nenhum post ainda"
                  descricao={capturaApi.disponivel ? "Capture pela API ou envie prints e links." : "Envie prints e links."}
                  acao={
                    <button type="button" className={botao.secundario} onClick={() => setEnviando(true)}>
                      Prints e links
                    </button>
                  }
                />
              ) : (
                <>
                  <div className="mt-3 flex min-w-0 flex-wrap items-center">
                    <SeletorCompacto
                      className="mb-2 mr-2"
                      rotulo="Formato"
                      valor={filtros.formato}
                      onEscolher={(v) => setFiltros({ ...filtros, formato: v })}
                      opcoes={[{ valor: "todos", rotulo: "Todos" }].concat(formatos.map((f) => ({ valor: f, rotulo: (ROTULO_DO_FORMATO as Record<string, string>)[f] || f })))}
                    />
                    {pilares.length > 0 && (
                      <SeletorCompacto
                        className="mb-2 mr-2"
                        rotulo="Pilar"
                        modo="lista"
                        valor={filtros.pilar}
                        onEscolher={(v) => setFiltros({ ...filtros, pilar: v })}
                        opcoes={[{ valor: "todos", rotulo: "Todos os pilares" }].concat(pilares.map((p) => ({ valor: p, rotulo: p })))}
                      />
                    )}
                    <button
                      type="button"
                      aria-pressed={filtros.fora}
                      onClick={() => setFiltros({ ...filtros, fora: !filtros.fora })}
                      className={juntar(filtros.fora ? botao.primario : botao.secundario, "mb-2 h-9")}
                    >
                      Fora da curva
                    </button>
                  </div>
                  {escolhidosValidos.length > 0 && (
                    <p className={juntar(texto.auxiliar, "mb-2")}>
                      {escolhidosValidos.length} de {MAX_POSTS_NO_ESTILO} escolhidos ·{" "}
                      <button type="button" className="underline hover:text-foreground" onClick={() => setEscolhidos([])}>
                        limpar
                      </button>
                    </p>
                  )}
                  {visiveis.length === 0 ? (
                    <EstadoVazio compacto titulo="Nada com estes filtros" />
                  ) : (
                    <ul className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5 desk:grid-cols-6" aria-label="Posts do perfil">
                      {visiveis.map((p) => (
                        <CartaoDoPost key={p.id} post={p} url={p.midia_caminho && urls.data ? urls.data[p.midia_caminho] : undefined} escolhido={escolhidos.indexOf(p.id) >= 0} onEscolher={() => alternar(p.id)} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
        {largo && <div className="h-[500px] min-w-0 lg:sticky lg:top-0 desk:h-[640px]">{agente}</div>}
      </div>

      {!largo && (
        <Dialog open={agenteAberto} onOpenChange={setAgenteAberto}>
          <DialogContent className="flex h-[92vh] w-[calc(100vw-16px)] max-w-lg flex-col gap-0 overflow-hidden p-0 [&_[data-cabecalho-do-agente]]:pr-12">
            <DialogTitle className="sr-only">Agente do perfil @{perfil.handle}</DialogTitle>
            <DialogDescription className="sr-only">Plano igual, ideias de resposta, comparar e levar ao estilo.</DialogDescription>
            {agente}
          </DialogContent>
        </Dialog>
      )}
      <JanelaDeEnvio aberta={enviando} onFechar={() => setEnviando(false)} perfil={perfil} onEnviado={() => void reler()} />
    </div>
  );
}
