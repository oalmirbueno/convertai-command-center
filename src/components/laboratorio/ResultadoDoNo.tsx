import { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Download, ExternalLink, Loader2, Maximize2, PauseCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { JanelaCentral, botao, etiqueta, juntar, texto } from "@/components/sistema";
import { enderecoParaBaixar, enderecosAssinados, lerHtmlSalvo } from "@/lib/laboratorio/arquivos";
import { enderecoDaAprovacao, type EstadoNoAr, type ExecucaoDoLab, type FonteDaPesquisa, type ImagemDoLab, type SaidaDaExecucao, type StatusDaExecucao, type StoryboardDoFilme } from "@/lib/laboratorio/api";
import type { TipoDeNo } from "@/lib/laboratorio/nos";

/**
 * O resultado no próprio nó: estado com cor, texto resumido, miniaturas,
 * prévia da landing (iframe sandbox do arquivo salvo) e, na logo, a escolha
 * do Jev com o motivo.
 */

export const ESTADOS: Record<StatusDaExecucao, { rotulo: string; classe: string; borda: string }> = {
  na_fila: { rotulo: "Na fila", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300", borda: "#f59e0b" },
  rodando: { rotulo: "Rodando", classe: "bg-sky-500/15 text-sky-700 dark:text-sky-300", borda: "#0ea5e9" },
  pronto: { rotulo: "Pronto", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", borda: "#10b981" },
  erro: { rotulo: "Erro", classe: "bg-destructive/15 text-destructive", borda: "#ef4444" },
  aguardando: { rotulo: "Aguardando", classe: "bg-violet-500/15 text-violet-700 dark:text-violet-300", borda: "#8b5cf6" },
};

export const emAndamento = (s: StatusDaExecucao | string | null | undefined) => s === "na_fila" || s === "rodando" || s === "aguardando";

export function EstadoDoNo({ status }: { status: StatusDaExecucao }) {
  const e = ESTADOS[status];
  const I = status === "pronto" ? CheckCircle2 : status === "erro" ? AlertTriangle : status === "rodando" ? Loader2 : status === "aguardando" ? PauseCircle : Clock;
  return (
    <span className={juntar(etiqueta, e.classe)} data-estado-do-no={status}>
      <I className={juntar("mr-1 h-3 w-3", status === "rodando" && "animate-spin")} aria-hidden="true" />
      {e.rotulo}
    </span>
  );
}

/** Endereços das imagens: usa a url que veio; sem url, assina o caminho no bucket workspace. */
export function useImagens(imagens: ImagemDoLab[]): string[] {
  const chave = imagens.map((i) => i.url || i.path).join("|");
  const [assinadas, setAssinadas] = useState<Record<string, string>>({});
  useEffect(() => {
    const faltam = imagens.filter((i) => !i.url && i.path).map((i) => i.path);
    if (!faltam.length) return;
    let vivo = true;
    enderecosAssinados(faltam)
      .then((r) => {
        if (vivo) setAssinadas(r);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return imagens.map((i) => i.url || assinadas[i.path] || "");
}

export function Miniaturas({ imagens, escolhida, max = 4 }: { imagens: ImagemDoLab[]; escolhida?: number | null; max?: number }) {
  const urls = useImagens(imagens);
  if (!imagens.length) return null;
  return (
    <div className="grid min-w-0 grid-cols-4 gap-1" data-miniaturas="">
      {urls.slice(0, max).map((u, i) => (
        <span key={i} className={juntar("block h-12 overflow-hidden rounded bg-muted", escolhida === i && "ring-2 ring-primary")} data-escolhida={escolhida === i ? "" : undefined}>
          {u ? <img src={u} alt={`Imagem ${i + 1}`} className="h-full w-full object-cover" loading="lazy" /> : null}
        </span>
      ))}
    </div>
  );
}

/** Prévia da landing: o HTML salvo num iframe sem mesma origem (scripts só para o Tailwind por CDN). */
export function PreviaDaLanding({ caminho, url, alta = false, cheia = false }: { caminho: string; url: string; alta?: boolean; cheia?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    lerHtmlSalvo(caminho)
      .then((t) => {
        if (vivo) setHtml(t);
      })
      .catch(() => {
        if (vivo) setErro(true);
      });
    return () => {
      vivo = false;
    };
  }, [caminho]);
  if (!caminho && !url) return null;
  if (erro) return <p className={texto.auxiliar}>Não deu para abrir a prévia.</p>;
  return (
    <iframe
      title="Prévia da landing"
      sandbox="allow-scripts"
      {...(html !== null ? { srcDoc: html } : caminho ? {} : { src: url })}
      className={juntar("w-full bg-white", cheia ? "pointer-events-none h-full" : "rounded border border-border", !cheia && (alta ? "h-[70vh]" : "pointer-events-none h-32"))}
      data-previa-da-landing=""
    />
  );
}

/** Baixa a imagem: caminho no workspace vira link de download assinado; sem caminho, a url que veio. */
export async function baixarImagem(img: ImagemDoLab, url: string, nome: string) {
  try {
    const link = img.path && (!img.bucket || img.bucket === "workspace") ? await enderecoParaBaixar(img.path, nome) : url;
    if (!link) throw new Error("sem link");
    const a = document.createElement("a");
    a.href = link;
    a.download = nome;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    toast.error("Não deu para baixar a imagem", { description: "Tente de novo em instantes." });
  }
}

/**
 * As imagens geradas no próprio nó (Resultado, Carrossel, Logo): grade
 * quadrada; tocar amplia numa janela central, com anterior, próxima e baixar.
 */
export function GradeDeImagens({ imagens, escolhida, colunas = 2 }: { imagens: ImagemDoLab[]; escolhida?: number | null; colunas?: 2 | 3 }) {
  const urls = useImagens(imagens);
  const [aberta, setAberta] = useState<number | null>(null);
  if (!imagens.length) return null;
  const total = imagens.length;
  const nome = (i: number) => `imagem-${i + 1}.png`;
  const ir = (passo: number) => setAberta((a) => (a === null ? a : (a + passo + total) % total));
  return (
    <div className="min-w-0" data-grade-de-imagens="">
      <div className={juntar("grid min-w-0 gap-1.5", total === 1 ? "grid-cols-1" : colunas === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {urls.map((u, i) => (
          <button
            key={i}
            type="button"
            className={juntar("nodrag relative block w-full overflow-hidden rounded-md bg-muted transition-opacity hover:opacity-90", escolhida === i && "ring-2 ring-primary")}
            // Uma imagem só fica cheia, na proporção dela; várias, em grade quadrada.
            style={total === 1 ? undefined : { paddingTop: "100%" }}
            onClick={(e) => {
              e.stopPropagation();
              setAberta(i);
            }}
            aria-label={`Ampliar a imagem ${i + 1}`}
            title={`Ampliar a imagem ${i + 1}`}
            data-escolhida={escolhida === i ? "" : undefined}
          >
            {u ? <img src={u} alt="" className={total === 1 ? "block h-auto max-h-[420px] w-full object-cover" : "absolute inset-0 h-full w-full object-cover"} loading="lazy" /> : total === 1 ? <span className="block h-40" /> : null}
          </button>
        ))}
      </div>
      <JanelaCentral
        aberta={aberta !== null}
        onFechar={() => setAberta(null)}
        titulo={aberta !== null ? `Imagem ${aberta + 1} de ${total}` : "Imagem"}
        largura="xl"
        acoes={
          aberta !== null ? (
            <>
              {total > 1 ? (
                <>
                  <button type="button" className={botao.icone} onClick={() => ir(-1)} aria-label="Imagem anterior" title="Imagem anterior">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={botao.icone} onClick={() => ir(1)} aria-label="Próxima imagem" title="Próxima imagem">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              ) : null}
              <button type="button" className={botao.icone} onClick={() => void baixarImagem(imagens[aberta], urls[aberta], nome(aberta))} aria-label="Baixar a imagem" title="Baixar a imagem" data-baixar-imagem="">
                <Download className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : null
        }
        data-imagem-ampliada=""
      >
        {aberta !== null && urls[aberta] ? <img src={urls[aberta]} alt={`Imagem ${aberta + 1}`} className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full rounded-md object-contain" /> : null}
      </JanelaCentral>
    </div>
  );
}

/** A página gerada em miniatura: o HTML salvo desenhado em 1280 px e reduzido para caber no nó. */
export function MiniaturaDaLanding({ caminho, url, largura }: { caminho: string; url: string; largura: number }) {
  const escala = largura / 1280;
  return (
    <div className="relative w-full overflow-hidden rounded-md bg-white" style={{ height: Math.round(900 * escala) }} data-miniatura-da-landing="">
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: 1280, height: 900, transform: `scale(${escala})` }}>
        <PreviaDaLanding caminho={caminho} url={url} cheia />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ v2: pesquisa, oferta, funil, filme, pôr no ar

const textoDe = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Pesquisa: as fontes, cada uma com o link (abre em outra aba). */
function FontesDaPesquisa({ fontes, compacto }: { fontes: FonteDaPesquisa[]; compacto: boolean }) {
  if (!fontes.length) return null;
  const lista = compacto ? fontes.slice(0, 3) : fontes;
  return (
    <div className="min-w-0" data-fontes-da-pesquisa="">
      <p className={juntar(texto.auxiliar, "font-medium text-foreground")}>{fontes.length} fonte(s)</p>
      <ul className="min-w-0 space-y-0.5">
        {lista.map((f, i) => {
          let dominio = f.url;
          try {
            dominio = new URL(f.url).hostname.replace(/^www\./, "");
          } catch {
            /* fica o endereço inteiro */
          }
          return (
            <li key={i} className="min-w-0">
              <a className={juntar(texto.auxiliar, "nodrag inline-flex max-w-full items-center text-primary hover:underline")} href={f.url} target="_blank" rel="noreferrer noopener" title={f.url} data-fonte="">
                <ExternalLink className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{f.titulo || dominio}</span>
              </a>
            </li>
          );
        })}
      </ul>
      {compacto && fontes.length > lista.length ? <p className={texto.auxiliar}>+{fontes.length - lista.length} no inspetor</p> : null}
    </div>
  );
}

/** Oferta: produto, preço e a promessa, em poucas linhas. */
function ResumoDaOferta({ json, compacto }: { json: Record<string, unknown>; compacto: boolean }) {
  const produto = textoDe(json.produto) || textoDe(json.nome);
  const preco = textoDe(json.preco);
  const promessa = textoDe(json.promessa);
  const extras: Array<[string, string]> = [
    ["Ancoragem", textoDe(json.ancoragem)],
    ["Garantia", textoDe(json.garantia)],
    ["Bônus", Array.isArray(json.bonus) ? json.bonus.map(textoDe).filter(Boolean).join(" · ") : textoDe(json.bonus)],
  ];
  return (
    <div className="min-w-0" data-resumo-da-oferta="">
      <p className={juntar(texto.auxiliar, "truncate font-medium text-foreground")}>{[produto || "Oferta", preco].filter(Boolean).join(" · ")}</p>
      {promessa ? <p className={juntar(texto.auxiliar, compacto && "line-clamp-2")}>{promessa}</p> : null}
      {!compacto &&
        extras
          .filter((x) => x[1])
          .map((x) => (
            <p key={x[0]} className={texto.auxiliar}>
              <span className="text-foreground">{x[0]}:</span> {x[1]}
            </p>
          ))}
    </div>
  );
}

/** Funil: o desenho das etapas, em sequência. */
function DesenhoDoFunil({ json, compacto }: { json: Record<string, unknown>; compacto: boolean }) {
  const etapas = (Array.isArray(json.etapas) ? json.etapas : []).map((e: any) => (typeof e === "string" ? { nome: e } : e && typeof e === "object" ? e : null)).filter(Boolean) as Array<Record<string, unknown>>;
  if (!etapas.length) return null;
  return (
    <div className="min-w-0" data-desenho-do-funil="">
      <ol className="flex min-w-0 flex-wrap items-center">
        {etapas.map((e, i) => (
          <li key={i} className="flex min-w-0 items-center" data-etapa-do-funil="">
            {i > 0 ? <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
            <span className={juntar(etiqueta, "max-w-[140px] truncate bg-muted text-foreground")} title={textoDe(e.mensagem) || textoDe(e.pagina) || undefined}>
              {textoDe(e.nome) || textoDe(e.titulo) || textoDe(e.etapa) || `Etapa ${i + 1}`}
            </span>
          </li>
        ))}
      </ol>
      {!compacto && (
        <ul className="mt-1 min-w-0 space-y-0.5">
          {etapas.map((e, i) => {
            const detalhe = [textoDe(e.pagina), textoDe(e.mensagem), textoDe(e.meta) ? `meta: ${textoDe(e.meta)}` : ""].filter(Boolean).join(" · ");
            return detalhe ? (
              <li key={i} className={texto.auxiliar}>
                <span className="text-foreground">{textoDe(e.nome) || textoDe(e.titulo) || `Etapa ${i + 1}`}:</span> {detalhe}
              </li>
            ) : null;
          })}
        </ul>
      )}
    </div>
  );
}

/** Capa do storyboard: a primeira imagem; sem imagem (roteiro da Mesa Motion), o número e as cenas. */
function CapaDoStoryboard({ sb, numero }: { sb: StoryboardDoFilme; numero: number }) {
  const urls = useImagens(sb.imagens.slice(0, 1));
  if (urls[0]) return <span className="block h-16 overflow-hidden rounded bg-muted"><img src={urls[0]} alt={sb.titulo || `Storyboard ${numero}`} className="h-full w-full object-cover" loading="lazy" /></span>;
  const info = [sb.cenas ? `${sb.cenas} cenas` : "", sb.duracao_s ? `${Math.round(sb.duracao_s)} s` : ""].filter(Boolean).join(" · ");
  return (
    <span className="flex h-16 flex-col items-center justify-center rounded bg-muted text-center">
      <span className="text-[15px] font-semibold tabular-nums text-foreground">{numero}</span>
      {info ? <span className="text-[11px] text-muted-foreground">{info}</span> : null}
    </span>
  );
}

/** Filme: 3 storyboards para escolher no nó; depois o render e o vídeo. */
function FilmeDoNo({ saida, status, onEscolher, escolhendo, compacto }: { saida: SaidaDaExecucao; status: StatusDaExecucao; onEscolher?: (indice: number) => void; escolhendo: number | null; compacto: boolean }) {
  const video = useImagens(saida.video_path && !saida.video_url ? [{ path: saida.video_path, url: "" }] : []);
  const urlDoVideo = saida.video_url || video[0] || "";
  if (urlDoVideo)
    return (
      <video src={urlDoVideo} controls playsInline preload="metadata" className={juntar("nodrag w-full rounded bg-black", compacto ? "h-32" : "max-h-[60vh]")} data-video-do-filme="">
        <track kind="captions" />
      </video>
    );
  if (!saida.storyboards.length) return null;
  const escolhido = saida.storyboard_escolhido;
  if (escolhido !== null) {
    const sb = saida.storyboards.find((x) => x.indice === escolhido) || saida.storyboards[escolhido];
    const p = saida.render_progresso;
    const parado = status === "erro" || saida.etapa_filme === "parado";
    return (
      <div className="min-w-0" data-filme-renderizando="">
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          {parado ? null : <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />}
          {parado ? "O render parou (veja o aviso no nó)." : `${saida.etapa_filme === "montando" ? "Montando" : "Renderizando"} ${sb && sb.titulo ? `"${sb.titulo}"` : `o storyboard ${escolhido + 1}`}`}
          {typeof p === "number" ? ` · ${Math.round(p)}%` : ""}
        </p>
        {typeof p === "number" ? (
          <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label="Andamento do render">
            <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, p))}%` }} />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="min-w-0" data-storyboards-do-filme="">
      <p className={juntar(texto.auxiliar, "mb-1 font-medium text-foreground")}>Escolha o storyboard</p>
      <div className="grid min-w-0 grid-cols-3 gap-1">
        {saida.storyboards.map((sb, i) => (
          <div key={i} className="min-w-0" data-storyboard={sb.indice}>
            <CapaDoStoryboard sb={sb} numero={i + 1} />
            <div className="mt-0.5 flex min-w-0 items-center">
              <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")} title={sb.resumo || sb.titulo}>
                {sb.titulo || `Opção ${i + 1}`}
              </span>
              {onEscolher ? (
                <button
                  type="button"
                  className={juntar(botao.icone, "nodrag h-6 w-6 shrink-0 text-primary")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEscolher(sb.indice);
                  }}
                  disabled={escolhendo !== null}
                  aria-label={`Escolher o storyboard ${i + 1}`}
                  title="Escolher este storyboard e renderizar o filme"
                >
                  {escolhendo === sb.indice ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              ) : null}
            </div>
            {!compacto && sb.resumo ? <p className={juntar(texto.auxiliar, "line-clamp-3")}>{sb.resumo}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

const PASSOS_NO_AR: Array<{ valor: EstadoNoAr; rotulo: string }> = [
  { valor: "aguardando_aprovacao", rotulo: "Aguardando sua aprovação" },
  { valor: "com_agente", rotulo: "Com o agente" },
  { valor: "feito", rotulo: "Feito" },
];

/** O estado do Pôr no ar: o que veio na saída, ou o que o status da execução diz. */
export function estadoNoAr(execucao: ExecucaoDoLab): EstadoNoAr {
  const s = execucao.saida;
  if (s.estado_no_ar) return s.estado_no_ar;
  if (execucao.status === "pronto") return s.link_no_ar || s.prova ? "feito" : "com_agente";
  if (execucao.status === "rodando" || execucao.status === "na_fila") return s.aprovacao_id ? "com_agente" : "aguardando_aprovacao";
  return "aguardando_aprovacao";
}

function PorNoArDoNo({ execucao }: { execucao: ExecucaoDoLab }) {
  const s = execucao.saida;
  // Erro sem estado é falha ao pedir (a frase já aparece no nó); recusado vem como erro com o motivo.
  if (execucao.status === "erro" && !s.estado_no_ar) return null;
  const estado = estadoNoAr(execucao);
  const atual = PASSOS_NO_AR.findIndex((p) => p.valor === estado);
  return (
    <div className="min-w-0" data-estado-no-ar={estado}>
      {estado === "recusado" ? (
        <p className={juntar(texto.auxiliar, "text-warning")}>Não aprovado. Nada foi ao ar.</p>
      ) : (
        <ol className="min-w-0 space-y-0.5">
          {PASSOS_NO_AR.map((p, i) => (
            <li key={p.valor} className={juntar(texto.auxiliar, "flex items-center", i === atual ? "font-medium text-foreground" : i < atual ? "text-muted-foreground" : "text-muted-foreground/60")} data-passo-no-ar={p.valor} aria-current={i === atual ? "step" : undefined}>
              {i < atual || estado === "feito" ? <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-600" aria-hidden="true" /> : i === atual ? <Clock className="mr-1 h-3 w-3 text-amber-600" aria-hidden="true" /> : <span className="mr-1 inline-block h-3 w-3 rounded-full border border-border" aria-hidden="true" />}
              {p.rotulo}
              {p.valor === "com_agente" && s.operador ? ` (${s.operador === "default" ? "Hermes" : s.operador})` : ""}
            </li>
          ))}
        </ol>
      )}
      {estado === "aguardando_aprovacao" ? (
        <a className={juntar(botao.secundario, "nodrag mt-1.5 h-7 px-2 text-[12px]")} href={s.link_aprovacao || enderecoDaAprovacao(s.aprovacao_id)} target="_blank" rel="noreferrer" data-abrir-aprovacao="">
          <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Abrir a aprovação
        </a>
      ) : null}
      {estado === "feito" && s.link_no_ar ? (
        <a className={juntar(texto.auxiliar, "nodrag mt-1 inline-flex items-center text-primary hover:underline")} href={s.link_no_ar} target="_blank" rel="noreferrer noopener" data-link-no-ar="">
          <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" />
          Ver no ar
        </a>
      ) : null}
      {estado === "feito" && s.prova ? <p className={juntar(texto.auxiliar, "line-clamp-3")} data-prova-no-ar="">Prova: {s.prova}</p> : null}
    </div>
  );
}

/** Copiar o texto do resultado (fica no canto do texto). */
function BotaoDeCopiar({ texto: conteudo }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(conteudo);
      else {
        const area = document.createElement("textarea");
        area.value = conteudo;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    } catch {
      toast.error("Não deu para copiar");
    }
  };
  return (
    <button type="button" className={juntar(botao.icone, "nodrag absolute right-0 top-0 h-6 w-6")} onClick={(e) => { e.stopPropagation(); void copiar(); }} aria-label={copiado ? "Copiado" : "Copiar o texto"} title={copiado ? "Copiado" : "Copiar o texto"} data-copiar-texto="">
      {copiado ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

export default function ResultadoDoNo({
  execucao,
  compacto = true,
  tipo,
  onEscolherStoryboard,
  escolhendo = null,
  largura,
  semImagens = false,
}: {
  execucao: ExecucaoDoLab | null | undefined;
  compacto?: boolean;
  /** No nó do quadro: a largura útil (px), para a miniatura da landing e a grade de imagens. */
  largura?: number;
  /** As imagens já aparecem em outro bloco do nó (nós criativos: ImagensDoResultado). */
  semImagens?: boolean;
  /** O tipo do nó (a execução recém-criada ainda não traz). */
  tipo?: TipoDeNo;
  /** Filme: escolher um dos storyboards no próprio nó (filme_escolher). */
  onEscolherStoryboard?: (indice: number) => void;
  escolhendo?: number | null;
}) {
  const [grande, setGrande] = useState(false);
  if (!execucao) return null;
  const s = execucao.saida;
  const t = tipo || execucao.tipo;
  const jsonProprio = t === "oferta" || t === "funil";
  return (
    <div className="mt-2 min-w-0 space-y-1.5" data-resultado-do-no={execucao.no_id}>
      {execucao.status === "erro" && execucao.erro ? <p className={juntar(texto.auxiliar, "text-destructive")}>{execucao.erro}</p> : null}
      {t === "oferta" && s.json ? <ResumoDaOferta json={s.json} compacto={compacto} /> : null}
      {t === "funil" && s.json ? <DesenhoDoFunil json={s.json} compacto={compacto} /> : null}
      {t === "filme" ? <FilmeDoNo saida={s} status={execucao.status} onEscolher={onEscolherStoryboard} escolhendo={escolhendo} compacto={compacto} /> : null}
      {t === "por_no_ar" ? <PorNoArDoNo execucao={execucao} /> : null}
      {s.texto && !(jsonProprio && s.json && compacto) ? (
        <div className="group/texto relative min-w-0" data-texto-do-resultado="">
          <p className={juntar(texto.auxiliar, "whitespace-pre-wrap pr-7 text-foreground", compacto && "line-clamp-3")}>{s.texto}</p>
          <BotaoDeCopiar texto={s.texto} />
        </div>
      ) : null}
      <FontesDaPesquisa fontes={s.fontes} compacto={compacto} />
      {s.imagens.length && !semImagens ? (largura || !compacto ? <GradeDeImagens imagens={s.imagens} escolhida={s.escolha ? s.escolha.indice : null} colunas={!largura || largura > 300 ? 3 : 2} /> : <Miniaturas imagens={s.imagens} escolhida={s.escolha ? s.escolha.indice : null} />) : null}
      {s.escolha ? (
        <p className={juntar(texto.auxiliar, compacto && "line-clamp-2")} data-escolha-do-jev="">
          <span className="font-medium text-foreground">Jev escolheu a {s.escolha.indice + 1}ª:</span> {s.escolha.motivo}
        </p>
      ) : null}
      {s.aviso_jev ? <p className={juntar(texto.auxiliar, "text-warning", compacto && "line-clamp-2")}>{s.aviso_jev}</p> : null}
      {s.html_path || s.html_url ? (
        <div className="relative min-w-0">
          {largura ? <MiniaturaDaLanding caminho={s.html_path} url={s.html_url} largura={largura} /> : <PreviaDaLanding caminho={s.html_path} url={s.html_url} />}
          <button type="button" className={juntar(botao.icone, "nodrag absolute right-1 top-1 h-7 w-7 bg-background/90")} onClick={() => setGrande(true)} aria-label="Abrir a prévia grande" title="Abrir a prévia grande">
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <JanelaCentral aberta={grande} onFechar={() => setGrande(false)} titulo="Prévia da landing" largura="tela" semEspaco>
            {grande ? <PreviaDaLanding caminho={s.html_path} url={s.html_url} alta /> : null}
          </JanelaCentral>
        </div>
      ) : null}
      {s.rascunho_sem_fonte.some((b) => !b.confirmado) ? (
        <p className={juntar(texto.auxiliar, "flex items-center text-warning")} data-sem-fonte-no-no="">
          <AlertTriangle className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
          {s.rascunho_sem_fonte.filter((b) => !b.confirmado).length} bloco(s) sem fonte: trava o Pôr no ar
        </p>
      ) : null}
      {s.json && t === "anuncio" ? (
        <p className={juntar(texto.auxiliar, "line-clamp-2")}>
          {String((s.json as any).titulo || (Array.isArray((s.json as any).titulos) ? (s.json as any).titulos[0] : "") || "Pacote pronto")} · nasce pausado
        </p>
      ) : null}
      {s.tarefa_url || s.tarefa_id ? (
        <a className={juntar(texto.auxiliar, "nodrag inline-flex items-center text-primary hover:underline")} href={s.tarefa_url || `/execucao?tarefa=${s.tarefa_id}`} target="_blank" rel="noreferrer">
          <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" />
          Tarefa no Kanban
        </a>
      ) : null}
    </div>
  );
}
