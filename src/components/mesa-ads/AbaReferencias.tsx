import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, ImagePlus, Link2, Loader2, Sparkles, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { imagensDoColar } from "@/components/mesa/EstudioFotos";
import { textoDoErro } from "@/lib/mesa/api";
import {
  adicionarLink,
  adicionarPrint,
  brl,
  chamarAds,
  chavesAds,
  ESCALA_DE_EVIDENCIA,
  inteiro,
  lerReferencias,
  linkValido,
  marcarDestaque,
  ORIGENS,
  partesDaLeitura,
  porcento,
  rotuloDaOrigem,
  salvarFicha,
  type Evidencia,
  type FichaDaReferencia,
  type ReferenciaAds,
} from "./adsApi";
import { Andamento, SeloDeEvidencia, useAndamento } from "./Comuns";

/**
 * Etapa 2, Referências: a biblioteca de anúncios do cliente e da agência
 * (client_id nulo, só leitura). Cada referência leva o selo de evidência E0
 * a E4 (a escala no tooltip), o mecanismo e a estrela de destaque, que o
 * estrategista usa ao montar o plano. Adicionar: colar um link, subir ou
 * colar um print, ou importar os anúncios do próprio cliente com as métricas
 * reais (grátis). Abrir uma referência mostra a ficha ao lado, com "Ler com IA".
 */

export const LINKS_UTEIS = [
  { rotulo: "Meta Ad Library", url: "https://www.facebook.com/ads/library/" },
  { rotulo: "TikTok Top Ads", url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en" },
  { rotulo: "Swiped", url: "https://swiped.co/" },
  { rotulo: "Google Ads Transparency", url: "https://adstransparency.google.com/" },
];

export const CAMPOS_DA_FICHA: { chave: keyof FichaDaReferencia; rotulo: string; longo?: boolean }[] = [
  { chave: "situacao", rotulo: "Situação do comprador", longo: true },
  { chave: "motivacao", rotulo: "Motivação" },
  { chave: "estagio", rotulo: "Estágio de consciência" },
  { chave: "gancho_visual", rotulo: "Gancho visual", longo: true },
  { chave: "gancho_verbal", rotulo: "Primeira fala ou headline", longo: true },
  { chave: "argumento", rotulo: "Argumento central", longo: true },
  { chave: "prova", rotulo: "Prova apresentada e limite dela", longo: true },
  { chave: "objecao", rotulo: "Objeção respondida" },
  { chave: "cta", rotulo: "CTA" },
  { chave: "destino", rotulo: "Destino" },
  { chave: "o_que_transportar", rotulo: "O que transportar", longo: true },
  { chave: "o_que_substituir", rotulo: "O que substituir e produzir original", longo: true },
  { chave: "limites", rotulo: "Limites e direitos de uso", longo: true },
];

/** Evidência que a equipe marca à mão; E3 e E4 vêm de resultado documentado. */
const EVIDENCIAS_MANUAIS: Evidencia[] = ["E0", "E1", "E2"];

const METRICAS_DA_REFERENCIA: { chave: string; rotulo: string; formato: (v: number) => string }[] = [
  { chave: "gasto", rotulo: "gasto", formato: brl },
  { chave: "resultados", rotulo: "resultados", formato: inteiro },
  { chave: "custo_por_resultado", rotulo: "por resultado", formato: brl },
  { chave: "ctr_saida", rotulo: "CTR saída", formato: porcento },
];

const miniaturaExterna = (r: ReferenciaAds): string | null => {
  const m = r.metricas || {};
  const t = (m as any).thumbnail_url || (m as any).image_url || (r.ficha as any).thumbnail_url;
  return typeof t === "string" && t.indexOf("://") > 0 ? t : null;
};

function Miniatura({ r, className = "" }: { r: ReferenciaAds; className?: string }) {
  const externa = miniaturaExterna(r);
  if (r.storage_path || externa) {
    return <ImagemDaMesa caminho={r.storage_path || externa} alt={r.titulo} className={className} />;
  }
  let dominio = "";
  try {
    dominio = r.url ? new URL(r.url).hostname.replace(/^www\./, "") : "";
  } catch {
    dominio = "";
  }
  return (
    <div className={`flex flex-col items-center justify-center bg-secondary/60 px-3 text-center ${className}`}>
      <Link2 className="h-5 w-5 text-muted-foreground" />
      <span className="mt-1.5 text-[11px] font-medium text-foreground/80">{rotuloDaOrigem(r.origem)}</span>
      {dominio && <span className="mt-0.5 max-w-full truncate text-[10.5px] text-muted-foreground">{dominio}</span>}
    </div>
  );
}

function CartaoDaReferencia({
  r,
  onAbrir,
  onEstrela,
}: {
  r: ReferenciaAds;
  onAbrir: () => void;
  onEstrela: () => void;
}) {
  const daAgencia = r.client_id === null;
  const metricas = METRICAS_DA_REFERENCIA.filter((m) => typeof (r.metricas as any)[m.chave] === "number");
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
      aria-label={`Abrir a ficha de ${r.titulo}`}
      className="group min-w-0 cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative w-full" style={{ paddingBottom: "100%" }}>
        <div className="absolute inset-0">
          <Miniatura r={r} className="h-full w-full" />
        </div>
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="flex min-w-0 items-center">
          <SeloDeEvidencia valor={r.evidencia} />
          <span className="ml-1.5 min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{daAgencia ? "Agência" : rotuloDaOrigem(r.origem)}</span>
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
        {r.mecanismo && <p className="truncate text-[11px] text-muted-foreground" title={r.mecanismo}>{r.mecanismo}</p>}
        {metricas.length > 0 && (
          <p className="truncate text-[10.5px] tabular-nums text-muted-foreground">
            {metricas.map((m) => `${m.formato((r.metricas as any)[m.chave])} ${m.rotulo}`).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

function FichaLateral({ r, onFechar }: { r: ReferenciaAds | null; onFechar: () => void }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [ficha, setFicha] = useState<FichaDaReferencia>({});
  const [mecanismo, setMecanismo] = useState("");
  const [evidencia, setEvidencia] = useState<Evidencia>("E0");
  const [salvando, setSalvando] = useState(false);
  const [desde, rodar] = useAndamento();
  const somenteLeitura = !r || r.client_id === null;

  useEffect(() => {
    setFicha(r ? { ...r.ficha } : {});
    setMecanismo(r ? r.mecanismo || String(r.ficha.mecanismo || "") : "");
    setEvidencia(r ? r.evidencia : "E0");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r ? r.id : null, r ? JSON.stringify(r.ficha) : ""]);

  const atualizar = () => queryClient.invalidateQueries({ queryKey: chavesAds.referencias(clientId) });

  const salvar = async () => {
    if (!r) return;
    setSalvando(true);
    try {
      await salvarFicha(r.id, { ficha: { ...ficha, mecanismo: mecanismo.trim() || undefined }, mecanismo: mecanismo.trim() || null, evidencia });
      toast.success("Ficha salva");
      await atualizar();
    } catch (e) {
      avisarErro(e, "Ficha não salva");
    } finally {
      setSalvando(false);
    }
  };

  const evidenciasPossiveis = r && EVIDENCIAS_MANUAIS.indexOf(r.evidencia) < 0 ? EVIDENCIAS_MANUAIS.concat([r.evidencia]) : EVIDENCIAS_MANUAIS;

  return (
    <Sheet open={!!r} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[460px]">
        {r && (
          <div className="flex min-h-full flex-col">
            <SheetHeader className="space-y-1 border-b border-border p-4 pr-12 text-left">
              <SheetTitle className="text-[15px] leading-snug [overflow-wrap:anywhere]">{r.titulo}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center text-[12px]">
                <SeloDeEvidencia valor={r.evidencia} className="mr-2" />
                <span className="mr-2">{r.client_id === null ? "Biblioteca da agência (só leitura)" : rotuloDaOrigem(r.origem)}</span>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline">
                    abrir original <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                )}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 p-4">
              {(r.storage_path || miniaturaExterna(r)) && (
                <div className="overflow-hidden rounded-lg border border-border bg-secondary">
                  <ImagemDaMesa caminho={r.storage_path || miniaturaExterna(r)} alt={r.titulo} className="max-h-[360px] w-full !object-contain" />
                </div>
              )}
              {!somenteLeitura && (
                <div className="flex flex-wrap items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <span className="mb-1 mr-2 mt-1 min-w-0 text-[11.5px] leading-snug text-muted-foreground">
                    O leitor preenche a ficha pela imagem. Não inventa métrica; a evidência continua a que está.
                  </span>
                  <span className="mb-1 mt-1 flex items-center">
                    <Andamento desde={desde} rotulo="Lendo" />
                    <BotaoComCusto
                      rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Ler com IA</>}
                      titulo="Ler a referência"
                      descricao="O leitor de imagem preenche a ficha a partir do print ou da miniatura."
                      className="ml-2 h-8"
                      disabled={!r.storage_path && !miniaturaExterna(r) && !r.url}
                      partes={() => partesDaLeitura(catalogo)}
                      executar={() => rodar(() => chamarAds("referencia_ler", { client_id: clientId, referencia_id: r.id }))}
                      aoConcluir={(data) => {
                        if (data && data.ficha && typeof data.ficha === "object") setFicha({ ...data.ficha });
                        void atualizar();
                      }}
                    />
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">Evidência</span>
                  <select
                    aria-label="Evidência"
                    value={evidencia}
                    disabled={somenteLeitura}
                    onChange={(e) => setEvidencia(e.target.value as Evidencia)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]"
                  >
                    {ESCALA_DE_EVIDENCIA.filter((e) => evidenciasPossiveis.indexOf(e.valor) >= 0).map((e) => (
                      <option key={e.valor} value={e.valor}>{e.valor} · {e.rotulo}</option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">Mecanismo</span>
                  <Input aria-label="Mecanismo" className="h-9 text-[12.5px]" value={mecanismo} readOnly={somenteLeitura} placeholder="Sem citar a marca" onChange={(e) => setMecanismo(e.target.value)} />
                </label>
              </div>
              <p className="-mt-2 text-[11px] leading-snug text-muted-foreground">E3 e E4 só com resultado documentado (importação dos anúncios ou aprendizado registrado).</p>
              {CAMPOS_DA_FICHA.map((c) => {
                const valor = typeof ficha[c.chave] === "string" ? String(ficha[c.chave]) : "";
                return (
                  <label key={String(c.chave)} className="block min-w-0">
                    <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">{c.rotulo}</span>
                    {somenteLeitura ? (
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{valor || <span className="text-muted-foreground">Sem registro.</span>}</p>
                    ) : c.longo ? (
                      <Textarea aria-label={c.rotulo} className="min-h-[56px] text-[12.5px]" value={valor} onChange={(e) => { const v = e.target.value; setFicha((f) => ({ ...f, [c.chave]: v })); }} />
                    ) : (
                      <Input aria-label={c.rotulo} className="h-9 text-[12.5px]" value={valor} onChange={(e) => { const v = e.target.value; setFicha((f) => ({ ...f, [c.chave]: v })); }} />
                    )}
                  </label>
                );
              })}
            </div>
            {!somenteLeitura && (
              <div className="sticky bottom-0 mt-auto flex justify-end border-t border-border bg-background p-3">
                <Button type="button" size="sm" disabled={salvando} onClick={() => void salvar()}>
                  {salvando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Salvar ficha
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

type FiltroDaAgencia = "todas" | "cliente" | "agencia";

export default function AbaReferencias() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const referencias = useQuery({ queryKey: chavesAds.referencias(clientId), queryFn: () => lerReferencias(clientId) });
  const [filtroEvidencia, setFiltroEvidencia] = useState<Evidencia | "">("");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [filtroMecanismo, setFiltroMecanismo] = useState("");
  const [deQuem, setDeQuem] = useState<FiltroDaAgencia>("todas");
  const [aberta, setAberta] = useState<string | null>(null);
  const [colarLink, setColarLink] = useState(false);
  const [link, setLink] = useState("");
  const [tituloDoLink, setTituloDoLink] = useState("");
  const [enviando, setEnviando] = useState(0);
  const [importando, setImportando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const todas = referencias.data || [];
  const mecanismos = useMemo(() => {
    const vistos: string[] = [];
    for (const r of todas) if (r.mecanismo && vistos.indexOf(r.mecanismo) < 0) vistos.push(r.mecanismo);
    return vistos.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [todas]);
  const origensUsadas = ORIGENS.filter((o) => todas.some((r) => r.origem === o.valor));

  const filtradas = todas
    .filter((r) => !filtroEvidencia || r.evidencia === filtroEvidencia)
    .filter((r) => !filtroOrigem || r.origem === filtroOrigem)
    .filter((r) => !filtroMecanismo || r.mecanismo === filtroMecanismo)
    .filter((r) => deQuem === "todas" || (deQuem === "agencia" ? r.client_id === null : r.client_id !== null))
    .sort((a, b) => Number(b.destaque) - Number(a.destaque));
  const abertaRef = todas.find((r) => r.id === aberta) || null;

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
      await adicionarLink(clientId, url, tituloDoLink);
      setLink("");
      setTituloDoLink("");
      setColarLink(false);
      toast.success("Referência guardada", { description: "Abra a ficha para registrar o que ela ensina." });
      await atualizar();
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
      toast.success(ok === 1 ? "Print guardado" : `${ok} prints guardados`, { description: "Use Ler com IA na ficha para preencher." });
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
        description: isFinite(n) ? `${n} anúncio${n === 1 ? "" : "s"} com as métricas reais. E3 quando há gasto e resultado.` : "Com as métricas reais. E3 quando há gasto e resultado.",
      });
      await atualizar();
    } catch (e) {
      avisarErro(e, "Não foi possível importar");
    } finally {
      setImportando(false);
    }
  };

  const pilula = (ativa: boolean) =>
    `mb-1.5 mr-1.5 inline-flex h-7 items-center rounded-full border px-2.5 text-[11.5px] transition-colors ${
      ativa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
    }`;

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
            {todas.length} na biblioteca · {todas.filter((r) => r.destaque).length} em destaque para o plano. Cole um print com Ctrl+V ou arraste para cá.
          </p>
        </div>
        <div className="mb-1 mt-1 flex flex-wrap items-center">
          {enviando > 0 && (
            <span className="mr-2 inline-flex items-center text-[11.5px] text-muted-foreground"><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> guardando</span>
          )}
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-9" onClick={() => setColarLink((v) => !v)} aria-expanded={colarLink}>
            <Link2 className="mr-1 h-3.5 w-3.5" /> Colar link
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
          <Button type="button" size="sm" className="mb-1 h-9" disabled={importando} onClick={() => void importar()} title="Traz os anúncios do cliente com as métricas somadas. Sem custo de IA.">
            {importando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            Importar meus anúncios
          </Button>
        </div>
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
              placeholder="https:// (Meta Ad Library, TikTok, Swiped, Pinterest, Instagram)"
              className="mb-1.5 mr-2 h-9 min-w-[220px] flex-1 text-[12.5px]"
            />
            <Input aria-label="Título da referência" value={tituloDoLink} onChange={(e) => setTituloDoLink(e.target.value)} placeholder="Título (opcional)" className="mb-1.5 mr-2 h-9 w-full text-[12.5px] sm:w-56" />
            <Button type="button" size="sm" className="mb-1.5 h-9" onClick={() => void guardarLink()} disabled={!link.trim()}>
              Guardar
            </Button>
            <button type="button" aria-label="Fechar" onClick={() => setColarLink(false)} className="mb-1.5 ml-1 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-1" aria-label="Filtros">
        <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Filtrar por evidência">
          <button type="button" className={pilula(filtroEvidencia === "")} onClick={() => setFiltroEvidencia("")}>Toda evidência</button>
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
          <select aria-label="Filtrar por origem" value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)} className="mb-1.5 mr-2 h-8 rounded-md border border-input bg-background px-2 text-[12px]">
            <option value="">Toda origem</option>
            {origensUsadas.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
          <select aria-label="Filtrar por mecanismo" value={filtroMecanismo} onChange={(e) => setFiltroMecanismo(e.target.value)} className="mb-1.5 mr-2 h-8 max-w-[260px] rounded-md border border-input bg-background px-2 text-[12px]">
            <option value="">Todo mecanismo</option>
            {mecanismos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {(filtroEvidencia || filtroOrigem || filtroMecanismo || deQuem !== "todas") && (
            <button type="button" className="mb-1.5 text-[12px] text-primary hover:underline" onClick={() => { setFiltroEvidencia(""); setFiltroOrigem(""); setFiltroMecanismo(""); setDeQuem("todas"); }}>
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {referencias.isError && <AvisoDeErro erro={referencias.error} />}
      {referencias.isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-56 animate-pulse rounded-xl bg-muted/70" />)}
        </div>
      )}
      {referencias.data && filtradas.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">{todas.length ? "Nenhuma referência com esses filtros" : "A biblioteca ainda está vazia"}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {todas.length ? "Limpe os filtros para ver todas." : "Importe os anúncios do cliente, cole um link ou suba um print para começar."}
          </p>
        </div>
      )}
      {filtradas.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {filtradas.map((r) => (
            <CartaoDaReferencia key={r.id} r={r} onAbrir={() => setAberta(r.id)} onEstrela={() => void alternarDestaque(r)} />
          ))}
        </div>
      )}

      <FichaLateral r={abertaRef} onFechar={() => setAberta(null)} />
    </div>
  );
}
