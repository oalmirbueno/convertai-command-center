import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, ImagePlus, Library, Link2, Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { imagensDoColar } from "@/components/mesa/EstudioFotos";
import { ErroDaMesa, textoDoErro } from "@/lib/mesa/api";
import {
  adicionarLink,
  adicionarPrint,
  brl,
  capaDaReferencia,
  chamarAds,
  chavesAds,
  ESCALA_DE_EVIDENCIA,
  estiloDaReferencia,
  fichaLida,
  humanizar,
  inteiro,
  lerReferencias,
  linkValido,
  marcarDestaque,
  nichoDaReferencia,
  nomeDoNicho,
  normalizarDetalhe,
  ORIGENS,
  ordenarReferencias,
  partesDosPadroes,
  porcento,
  rotuloDaOrigem,
  type Evidencia,
  type ReferenciaAds,
} from "./adsApi";
import { Andamento, Foto, pilula, SeloDeEvidencia, useAndamento } from "./Comuns";
import JanelaDaReferencia, { CartaoTipografico } from "./JanelaDaReferencia";

export { CAMPOS_DA_FICHA } from "./adsApi";

/**
 * Etapa 2, Referências: a biblioteca de anúncios do cliente e da agência
 * (client_id nulo, só leitura), com a miniatura real de cada uma. Destaque
 * e E3/E4 vêm primeiro. Clicar abre a janela de detalhe DENTRO do painel
 * (JanelaDaReferencia). Adicionar: qualquer link (referencia_importar_url
 * busca a página e as imagens), print, os anúncios do próprio cliente com as
 * métricas reais (grátis) ou os padrões do nicho criados pelo estrategista.
 */

export const LINKS_UTEIS = [
  { rotulo: "Meta Ad Library", url: "https://www.facebook.com/ads/library/" },
  { rotulo: "TikTok Top Ads", url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en" },
  { rotulo: "Swiped", url: "https://swiped.co/" },
  { rotulo: "Google Ads Transparency", url: "https://adstransparency.google.com/" },
];

const METRICAS_DA_REFERENCIA: { chave: string; rotulo: string; formato: (v: number) => string }[] = [
  { chave: "gasto", rotulo: "gasto", formato: brl },
  { chave: "resultados", rotulo: "resultados", formato: inteiro },
  { chave: "custo_por_resultado", rotulo: "por resultado", formato: brl },
  { chave: "ctr_saida", rotulo: "CTR saída", formato: porcento },
];

export const QUANTIDADE_DE_PADROES = 10;

function Miniatura({ r }: { r: ReferenciaAds }) {
  const capa = capaDaReferencia(r);
  if (capa) return <Foto src={capa} alt={r.titulo} className="h-full w-full" />;
  if (r.origem === "padrao" || r.ficha.gancho_verbal) return <CartaoTipografico r={r} />;
  let dominio = "";
  try {
    dominio = r.url ? new URL(r.url).hostname.replace(/^www\./, "") : "";
  } catch {
    dominio = "";
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-secondary/60 px-3 text-center">
      <Link2 className="h-5 w-5 text-muted-foreground" />
      <span className="mt-1.5 text-[11px] font-medium text-foreground/80">{rotuloDaOrigem(r.origem)}</span>
      {dominio && <span className="mt-0.5 max-w-full truncate text-[10.5px] text-muted-foreground">{dominio}</span>}
      <span className="mt-1 text-[10px] text-muted-foreground">abra para buscar as imagens</span>
    </div>
  );
}

function CartaoDaReferencia({ r, onAbrir, onEstrela }: { r: ReferenciaAds; onAbrir: () => void; onEstrela: () => void }) {
  const daAgencia = r.client_id === null;
  const metricas = METRICAS_DA_REFERENCIA.filter((m) => typeof (r.metricas as any)[m.chave] === "number");
  const estilo = estiloDaReferencia(r);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      aria-label={`Abrir ${r.titulo}`}
      className="group min-w-0 cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative w-full" style={{ paddingTop: "125%" }}>
        <div className="absolute inset-0">
          <Miniatura r={r} />
        </div>
        {r.destaque && (
          <span className="absolute left-2 top-2 inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-foreground">
            <Star className="mr-1 h-3 w-3 fill-warning text-warning" /> Destaque
          </span>
        )}
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="flex min-w-0 items-center">
          <SeloDeEvidencia valor={r.evidencia} />
          <span className="ml-1.5 min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{daAgencia ? (r.origem === "padrao" ? "Padrão da agência" : "Agência") : rotuloDaOrigem(r.origem)}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!daAgencia) onEstrela();
            }}
            disabled={daAgencia}
            aria-pressed={r.destaque}
            aria-label={r.destaque ? "Tirar o destaque" : "Destacar para o plano"}
            title={daAgencia ? "Biblioteca da agência: só leitura" : r.destaque ? "Em destaque: o estrategista usa no plano" : "Destacar para o plano"}
            className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-secondary disabled:opacity-40"
          >
            <Star className={`h-3.5 w-3.5 ${r.destaque ? "fill-warning text-warning" : "text-muted-foreground"}`} />
          </button>
        </div>
        <p className="line-clamp-2 text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{r.titulo}</p>
        {(r.mecanismo || estilo) && (
          <p className="truncate text-[11px] text-muted-foreground" title={r.mecanismo || humanizar(estilo)}>
            {r.mecanismo || humanizar(estilo)}
          </p>
        )}
        {metricas.length > 0 && (
          <p className="truncate text-[10.5px] tabular-nums text-muted-foreground">
            {metricas.map((m) => `${m.formato((r.metricas as any)[m.chave])} ${m.rotulo}`).join(" · ")}
          </p>
        )}
        {!fichaLida(r.ficha) && r.origem !== "padrao" && <p className="text-[10.5px] text-warning">ficha por completar</p>}
      </div>
    </div>
  );
}

type FiltroDaAgencia = "todas" | "cliente" | "agencia";

const unicos = (valores: string[]) => {
  const vistos: string[] = [];
  valores.forEach((v) => {
    if (v && vistos.indexOf(v) < 0) vistos.push(v);
  });
  return vistos.sort((a, b) => a.localeCompare(b, "pt-BR"));
};

export default function AbaReferencias() {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const referencias = useQuery({ queryKey: chavesAds.referencias(clientId), queryFn: () => lerReferencias(clientId) });
  const [filtroEvidencia, setFiltroEvidencia] = useState<Evidencia | "">("");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [filtroMecanismo, setFiltroMecanismo] = useState("");
  const [filtroNicho, setFiltroNicho] = useState("");
  const [filtroEstilo, setFiltroEstilo] = useState("");
  const [deQuem, setDeQuem] = useState<FiltroDaAgencia>("todas");
  const [aberta, setAberta] = useState<string | null>(null);
  const [colarLink, setColarLink] = useState(false);
  const [link, setLink] = useState("");
  const [tituloDoLink, setTituloDoLink] = useState("");
  const [enviando, setEnviando] = useState(0);
  const [importando, setImportando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [desdePadroes, rodarPadroes] = useAndamento();
  const entrada = useRef<HTMLInputElement>(null);

  const todas = useMemo(() => referencias.data || [], [referencias.data]);
  const mecanismos = useMemo(() => unicos(todas.map((r) => r.mecanismo || "")), [todas]);
  const nichos = useMemo(() => unicos(todas.map(nichoDaReferencia)), [todas]);
  const nomesDosNichos = useMemo(() => {
    const m: Record<string, string> = {};
    todas.forEach((r) => {
      const id = nichoDaReferencia(r);
      if (id && !m[id]) m[id] = nomeDoNicho(r);
    });
    return m;
  }, [todas]);
  const estilos = useMemo(() => unicos(todas.map(estiloDaReferencia)), [todas]);
  const origensUsadas = ORIGENS.filter((o) => todas.some((r) => r.origem === o.valor));

  const filtradas = ordenarReferencias(
    todas
      .filter((r) => !filtroEvidencia || r.evidencia === filtroEvidencia)
      .filter((r) => !filtroOrigem || r.origem === filtroOrigem)
      .filter((r) => !filtroMecanismo || r.mecanismo === filtroMecanismo)
      .filter((r) => !filtroNicho || nichoDaReferencia(r) === filtroNicho)
      .filter((r) => !filtroEstilo || estiloDaReferencia(r) === filtroEstilo)
      .filter((r) => deQuem === "todas" || (deQuem === "agencia" ? r.client_id === null : r.client_id !== null)),
  );
  const abertaRef = todas.find((r) => r.id === aberta) || null;
  const temFiltro = !!(filtroEvidencia || filtroOrigem || filtroMecanismo || filtroNicho || filtroEstilo || deQuem !== "todas");

  const atualizar = () => queryClient.invalidateQueries({ queryKey: chavesAds.referencias(clientId) });

  const alternarDestaque = async (r: ReferenciaAds) => {
    const chave = chavesAds.referencias(clientId);
    queryClient.setQueryData<ReferenciaAds[]>(chave, (l) => (l || []).map((x) => (x.id === r.id ? { ...x, destaque: !r.destaque } : x)));
    try {
      await marcarDestaque(r.id, !r.destaque);
    } catch (e) {
      toast.error("Destaque não salvo", { description: textoDoErro(e) });
      void atualizar();
    }
  };

  const guardarLink = async () => {
    const url = link.trim();
    if (!linkValido(url)) {
      toast.error("Cole um endereço completo, começando com https://");
      return;
    }
    setEnviando((n) => n + 1);
    try {
      let novaId: string | null = null;
      try {
        const data = await chamarAds<any>("referencia_importar_url", { client_id: clientId, url, titulo: tituloDoLink.trim() || undefined });
        const detalhe = normalizarDetalhe(data);
        const solta = data && (data.referencia_id || data.id) ? String(data.referencia_id || data.id) : null;
        novaId = detalhe.referencia ? detalhe.referencia.id : solta;
        if (novaId && detalhe.referencia) queryClient.setQueryData(chavesAds.referenciaAberta(clientId, novaId), detalhe);
      } catch (e) {
        // Função ainda sem a ação nova: guarda só o link, como antes.
        if (!(e instanceof ErroDaMesa && e.codigo === "acao_desconhecida")) throw e;
        await adicionarLink(clientId, url, tituloDoLink);
      }
      setLink("");
      setTituloDoLink("");
      setColarLink(false);
      toast.success("Referência guardada", { description: novaId ? "Imagens e dados da página já estão na janela." : "Abra para registrar o que ela ensina." });
      await atualizar();
      if (novaId) setAberta(novaId);
    } catch (e) {
      avisarErro(e, "Referência não guardada");
    } finally {
      setEnviando((n) => n - 1);
    }
  };

  const subir = async (arquivos: File[]) => {
    if (!arquivos.length) return;
    setEnviando((n) => n + arquivos.length);
    let ok = 0;
    for (const f of arquivos) {
      try {
        await adicionarPrint(clientId, f);
        ok += 1;
      } catch (e) {
        toast.error("O print não subiu", { description: textoDoErro(e) });
      } finally {
        setEnviando((n) => n - 1);
      }
    }
    if (ok) {
      toast.success(ok === 1 ? "Print guardado" : `${ok} prints guardados`, { description: "Abra e use Completar ficha com IA." });
      await atualizar();
    }
  };

  const colar = (e: ClipboardEvent<HTMLDivElement>) => {
    const alvo = e.target as HTMLElement;
    if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA")) return;
    const imagens = imagensDoColar(e.clipboardData);
    if (!imagens.length) return;
    e.preventDefault();
    void subir(imagens);
  };

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastando(false);
    const arquivos = e.dataTransfer && e.dataTransfer.files ? (Array.prototype.slice.call(e.dataTransfer.files) as File[]) : [];
    void subir(arquivos.filter((f) => String(f.type || "").indexOf("image/") === 0));
  };

  const importar = async () => {
    setImportando(true);
    try {
      const data = await chamarAds<any>("referencias_importar_proprias", { client_id: clientId });
      const n = Number(data && (data.importadas ?? data.total ?? (Array.isArray(data.referencias) ? data.referencias.length : NaN)));
      toast.success("Anúncios importados", {
        description: isFinite(n)
          ? `${n} anúncio${n === 1 ? "" : "s"} com imagem, copy e métricas reais. E3 quando há gasto e resultado.`
          : "Com imagem, copy e métricas reais. E3 quando há gasto e resultado.",
      });
      await atualizar();
    } catch (e) {
      avisarErro(e, "Não foi possível importar");
    } finally {
      setImportando(false);
    }
  };

  const limparFiltros = () => {
    setFiltroEvidencia("");
    setFiltroOrigem("");
    setFiltroMecanismo("");
    setFiltroNicho("");
    setFiltroEstilo("");
    setDeQuem("todas");
  };

  const seletor = "mb-1.5 mr-2 h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-[12px]";

  return (
    <div
      className={`min-w-0 space-y-4 rounded-xl ${arrastando ? "ring-2 ring-primary/50" : ""}`}
      onPaste={colar}
      onDragOver={(e) => {
        e.preventDefault();
        if (!arrastando) setArrastando(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setArrastando(false);
      }}
      onDrop={soltar}
    >
      <nav aria-label="Bibliotecas de anúncios" className="flex min-w-0 flex-wrap items-center">
        <span className="mb-1.5 mr-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Buscar em</span>
        {LINKS_UTEIS.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1.5 mr-1.5 inline-flex h-7 items-center rounded-full border border-border bg-card px-2.5 text-[11.5px] text-foreground/90 transition-colors hover:border-primary/50"
          >
            {l.rotulo} <ExternalLink className="ml-1 h-3 w-3 text-muted-foreground" />
          </a>
        ))}
      </nav>

      <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Referências</h2>
          <p className="text-[12px] text-muted-foreground">
            {todas.length} na biblioteca · {todas.filter((r) => r.destaque).length} em destaque para o plano. Clique para abrir aqui mesmo. Cole um print com Ctrl+V ou arraste para cá.
          </p>
        </div>
        <div className="mb-1 mt-1 flex min-w-0 flex-wrap items-center">
          {enviando > 0 && (
            <span className="mb-1 mr-2 inline-flex items-center text-[11.5px] text-muted-foreground">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> guardando
            </span>
          )}
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-9" onClick={() => setColarLink((v) => !v)} aria-expanded={colarLink}>
            <Link2 className="mr-1 h-3.5 w-3.5" /> Adicionar por link
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-9" onClick={() => entrada.current && entrada.current.click()}>
            <ImagePlus className="mr-1 h-3.5 w-3.5" /> Subir print
          </Button>
          <input
            ref={entrada}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            aria-label="Escolher prints"
            onChange={(e) => {
              const arquivos = e.target.files ? (Array.prototype.slice.call(e.target.files) as File[]) : [];
              e.target.value = "";
              void subir(arquivos);
            }}
          />
          <span className="mb-1 mr-1.5 inline-flex items-center">
            <BotaoComCusto
              rotulo={<><Library className="mr-1 h-3.5 w-3.5" /> Padrões do nicho</>}
              titulo="Padrões do nicho"
              descricao={`O estrategista cria ${QUANTIDADE_DE_PADROES} padrões de criativo do nicho deste cliente, com a ficha completa e conferidos pelo Jev (risco de política). Entram como E0: inspiração, não prova.`}
              variant="outline"
              className="h-9"
              partes={() => partesDosPadroes(catalogo, QUANTIDADE_DE_PADROES)}
              executar={() => rodarPadroes(() => chamarAds<any>("biblioteca_do_nicho", { client_id: clientId, quantidade: QUANTIDADE_DE_PADROES }))}
              aoConcluir={(data) => {
                setFiltroOrigem("padrao");
                const descartados = data && Array.isArray(data.descartados) ? data.descartados.length : 0;
                const aviso = data && typeof data.aviso === "string" ? data.aviso : "";
                if (descartados || aviso) {
                  toast.info("Padrões do nicho", {
                    description: `${descartados ? `${descartados} padrão(ões) saíram na conferência de política. ` : ""}${aviso}`.trim(),
                  });
                }
                void atualizar();
              }}
            />
          </span>
          <Button type="button" size="sm" className="mb-1 h-9" disabled={importando} onClick={() => void importar()} title="Traz os anúncios do cliente com imagem, copy e métricas. Sem custo de IA.">
            {importando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            Importar meus anúncios
          </Button>
        </div>
        {desdePadroes !== null && (
          <div className="w-full">
            <Andamento desde={desdePadroes} rotulo="Criando os padrões do nicho" />
          </div>
        )}
        {colarLink && (
          <div className="mt-2 flex w-full min-w-0 flex-wrap items-center border-t border-border pt-3">
            <Input
              autoFocus
              aria-label="Link da referência"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void guardarLink();
                }
              }}
              placeholder="https:// (Pinterest, Instagram, Behance, Meta Ad Library, imagem ou página)"
              className="mb-1.5 mr-2 h-9 w-full min-w-0 flex-1 text-[12.5px] sm:w-auto"
            />
            <Input aria-label="Título da referência" value={tituloDoLink} onChange={(e) => setTituloDoLink(e.target.value)} placeholder="Título (opcional)" className="mb-1.5 mr-2 h-9 w-full text-[12.5px] sm:w-56" />
            <Button type="button" size="sm" className="mb-1.5 h-9" onClick={() => void guardarLink()} disabled={!link.trim() || enviando > 0}>
              Guardar e abrir
            </Button>
            <button type="button" aria-label="Fechar" onClick={() => setColarLink(false)} className="mb-1.5 ml-1 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-1" aria-label="Filtros">
        <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Filtrar por evidência">
          <button type="button" className={pilula(filtroEvidencia === "")} onClick={() => setFiltroEvidencia("")}>
            Toda evidência
          </button>
          {ESCALA_DE_EVIDENCIA.map((e) => (
            <button key={e.valor} type="button" className={pilula(filtroEvidencia === e.valor)} onClick={() => setFiltroEvidencia(filtroEvidencia === e.valor ? "" : e.valor)} title={`${e.rotulo}: ${e.dica}`}>
              {e.valor}
            </button>
          ))}
          <span className="mx-1.5 mb-1.5 h-5 w-px bg-border" aria-hidden="true" />
          {(["todas", "cliente", "agencia"] as FiltroDaAgencia[]).map((q) => (
            <button key={q} type="button" className={pilula(deQuem === q)} onClick={() => setDeQuem(q)}>
              {q === "todas" ? "Cliente e agência" : q === "cliente" ? "Do cliente" : "Da agência"}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center">
          <select aria-label="Filtrar por origem" value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)} className={seletor}>
            <option value="">Toda origem</option>
            {origensUsadas.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
            {filtroOrigem && !origensUsadas.some((o) => o.valor === filtroOrigem) && <option value={filtroOrigem}>{rotuloDaOrigem(filtroOrigem)}</option>}
          </select>
          {nichos.length > 0 && (
            <select aria-label="Filtrar por nicho" value={filtroNicho} onChange={(e) => setFiltroNicho(e.target.value)} className={seletor}>
              <option value="">Todo nicho</option>
              {nichos.map((n) => (
                <option key={n} value={n}>
                  {nomesDosNichos[n] || humanizar(n)}
                </option>
              ))}
            </select>
          )}
          {estilos.length > 0 && (
            <select aria-label="Filtrar por estilo" value={filtroEstilo} onChange={(e) => setFiltroEstilo(e.target.value)} className={seletor}>
              <option value="">Todo estilo</option>
              {estilos.map((n) => (
                <option key={n} value={n}>
                  {humanizar(n)}
                </option>
              ))}
            </select>
          )}
          {mecanismos.length > 0 && (
            <select aria-label="Filtrar por mecanismo" value={filtroMecanismo} onChange={(e) => setFiltroMecanismo(e.target.value)} className={seletor}>
              <option value="">Todo mecanismo</option>
              {mecanismos.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {temFiltro && (
            <button type="button" className="mb-1.5 text-[12px] text-primary hover:underline" onClick={limparFiltros}>
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {referencias.isError && <AvisoDeErro erro={referencias.error} />}
      {referencias.isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-muted/70" />
          ))}
        </div>
      )}
      {referencias.data && filtradas.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">{todas.length ? "Nenhuma referência com esses filtros" : "A biblioteca ainda está vazia"}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {todas.length ? "Limpe os filtros para ver todas." : "Importe os anúncios do cliente, peça os padrões do nicho, cole um link ou suba um print para começar."}
          </p>
        </div>
      )}
      {filtradas.length > 0 && (
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {filtradas.map((r) => (
            <CartaoDaReferencia key={r.id} r={r} onAbrir={() => setAberta(r.id)} onEstrela={() => void alternarDestaque(r)} />
          ))}
        </div>
      )}

      <JanelaDaReferencia referencia={abertaRef} referenciaId={aberta} onFechar={() => setAberta(null)} />
    </div>
  );
}
