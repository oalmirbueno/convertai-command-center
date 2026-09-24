import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { custoDaResposta, estimarLocal, textoDoErro, usd } from "@/lib/mesa/api";
import {
  brl,
  CAMPOS_DA_FICHA,
  chamarAds,
  chavesAds,
  decimal,
  ESCALA_DE_EVIDENCIA,
  estiloDaReferencia,
  fichaLida,
  galeriaDaReferencia,
  humanizar,
  inteiro,
  marcarDestaque,
  nichoDaReferencia,
  nomeDoNicho,
  normalizarDetalhe,
  normalizarMetricas,
  partesDaLeitura,
  porcento,
  rotuloDaOrigem,
  rotuloDoCta,
  salvarFicha,
  type DetalheDaReferencia,
  type Evidencia,
  type FichaDaReferencia,
  type ImagemDaGaleria,
  type MetricasDaConta,
  type PontoDaSerie,
  type ReferenciaAds,
} from "./adsApi";
import { Abas, Andamento, BotaoCopiar, Diagnostico, Foto, SeloDeEvidencia, useAndamento } from "./Comuns";

/**
 * A referência aberta DENTRO do painel (Dialog grande), com abas: Visão
 * (galeria grande com setas e miniaturas), Ficha (editável no cliente),
 * Copy e destino, Métricas (anúncio próprio: totais, série diária e
 * diagnóstico) e Original (o link externo fica por último). Ao abrir chama
 * referencia_abrir, que busca a página ou o anúncio uma vez e guarda as
 * imagens no storage. Ficha ainda não lida: "Completar ficha com IA"; no
 * anúncio próprio isso roda sozinho uma vez.
 */

type Aba = "visao" | "ficha" | "copy" | "metricas" | "original";

/** Evidência que a equipe marca à mão; E3 e E4 vêm de resultado documentado. */
const EVIDENCIAS_MANUAIS: Evidencia[] = ["E0", "E1", "E2"];

/** Leituras automáticas já pedidas nesta sessão (uma vez por referência). */
const leiturasAutomaticas: string[] = [];

export function temMetricas(m: MetricasDaConta): boolean {
  return m.gasto !== null || m.impressoes !== null || m.resultados !== null;
}

/** Referência sem imagem (padrão do nicho): cartão tipográfico com o gancho verbal. */
export function CartaoTipografico({ r, grande = false, className = "" }: { r: ReferenciaAds; grande?: boolean; className?: string }) {
  const gancho = String(r.ficha.gancho_verbal || r.titulo || "").trim();
  const estilo = estiloDaReferencia(r);
  const nicho = nichoDaReferencia(r) ? nomeDoNicho(r) : "";
  return (
    <div data-tipografico="" className={`flex h-full w-full flex-col justify-between bg-primary/5 ${grande ? "p-8" : "p-3"} ${className}`}>
      <p className={`truncate font-medium uppercase tracking-widest text-primary ${grande ? "text-[11px]" : "text-[9.5px]"}`}>
        {[nicho, estilo ? humanizar(estilo) : ""].filter(Boolean).join(" · ") || rotuloDaOrigem(r.origem)}
      </p>
      <p className={`font-serif font-semibold leading-tight text-foreground [overflow-wrap:anywhere] ${grande ? "text-[28px] sm:text-[34px]" : "line-clamp-5 text-[15px]"}`}>
        {"“"}
        {gancho}
        {"”"}
      </p>
      <p className={`truncate text-muted-foreground ${grande ? "text-[12.5px]" : "text-[10px]"}`}>{r.mecanismo || String(r.ficha.gancho_visual || "")}</p>
    </div>
  );
}

function Galeria({ imagens, r }: { imagens: ImagemDaGaleria[]; r: ReferenciaAds }) {
  const [i, setI] = useState(0);
  const total = imagens.length;
  useEffect(() => setI(0), [r.id, total]);
  if (!total) {
    if (r.origem === "padrao" || r.ficha.gancho_verbal) {
      return (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="relative w-full" style={{ paddingTop: "80%" }}>
            <div className="absolute inset-0">
              <CartaoTipografico r={r} grande />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center">
        <p className="text-[13.5px] font-medium">Sem imagem guardada ainda</p>
        <p className="mt-1 text-[12px] text-muted-foreground">O painel busca as imagens do link ao abrir. Se a página não deixar, suba um print em Referências.</p>
      </div>
    );
  }
  const atual = imagens[Math.min(i, total - 1)];
  const ir = (d: number) => setI((x) => (x + d + total) % total);
  return (
    <div
      className="min-w-0"
      tabIndex={0}
      aria-label="Galeria da referência"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") ir(1);
        if (e.key === "ArrowLeft") ir(-1);
      }}
    >
      <div className="relative h-[44vh] overflow-hidden rounded-xl border border-border bg-secondary/40 sm:h-[56vh]">
        <Foto key={atual.url} src={atual.url} alt={atual.legenda || r.titulo} contain className="h-full w-full" />
        {total > 1 && (
          <>
            <button type="button" aria-label="Imagem anterior" onClick={() => ir(-1)} className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm hover:bg-secondary">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Próxima imagem" onClick={() => ir(1)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm hover:bg-secondary">
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="absolute bottom-2 right-2 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] tabular-nums text-foreground">
              {Math.min(i, total - 1) + 1} de {total}
            </span>
          </>
        )}
      </div>
      {atual.legenda && <p className="mt-1.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{atual.legenda}</p>}
      {total > 1 && (
        <div className="mt-2 flex flex-wrap" role="group" aria-label="Miniaturas">
          {imagens.map((img, k) => (
            <button
              key={img.url}
              type="button"
              aria-label={`Ver a imagem ${k + 1}`}
              aria-current={k === i ? "true" : undefined}
              onClick={() => setI(k)}
              className={`mb-1.5 mr-1.5 block h-14 w-14 overflow-hidden rounded-md border-2 transition-colors ${k === i ? "border-primary" : "border-transparent hover:border-border"}`}
            >
              <Foto src={img.url} alt="" className="h-full w-full" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, valor, copiar = true, link = false }: { rotulo: string; valor: string; copiar?: boolean; link?: boolean }) {
  if (!valor) return null;
  const ehLink = link && /^https?:\/\//i.test(valor);
  return (
    <div className="min-w-0 border-b border-border py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center">
        <p className="min-w-0 flex-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{rotulo}</p>
        {copiar && <BotaoCopiar texto={valor} rotulo={`Copiar ${rotulo.toLowerCase()}`} />}
      </div>
      {ehLink ? (
        <a href={valor} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex max-w-full items-center text-[13px] text-primary hover:underline">
          <span className="truncate">{valor}</span> <ExternalLink className="ml-1 h-3 w-3 shrink-0" />
        </a>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{valor}</p>
      )}
    </div>
  );
}

const KPIS: { chave: keyof MetricasDaConta; rotulo: string; formato: (v: number | null) => string }[] = [
  { chave: "gasto", rotulo: "Gasto", formato: brl },
  { chave: "impressoes", rotulo: "Impressões", formato: inteiro },
  { chave: "cliques", rotulo: "Cliques", formato: inteiro },
  { chave: "ctr", rotulo: "CTR", formato: porcento },
  { chave: "ctr_saida", rotulo: "CTR de saída", formato: porcento },
  { chave: "frequencia", rotulo: "Frequência", formato: decimal },
  { chave: "resultados", rotulo: "Resultados", formato: inteiro },
  { chave: "custo_por_resultado", rotulo: "Custo por resultado", formato: brl },
];

export function Indicadores({ m, className = "" }: { m: MetricasDaConta; className?: string }) {
  const visiveis = KPIS.filter((k) => m[k.chave] !== null);
  if (!visiveis.length) return null;
  return (
    <dl className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${className}`}>
      {visiveis.map((k) => (
        <div key={k.chave} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
          <dt className="truncate text-[10.5px] uppercase tracking-wider text-muted-foreground">{k.rotulo}</dt>
          <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums">{k.formato(m[k.chave])}</dd>
        </div>
      ))}
    </dl>
  );
}

function SerieDiaria({ serie }: { serie: PontoDaSerie[] }) {
  if (!serie.length) return null;
  const maior = Math.max.apply(null, serie.map((p) => p.gasto || 0).concat([0.0001]));
  return (
    <section aria-label="Série diária" className="rounded-xl border border-border bg-card p-4">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Gasto por dia e resultados</h4>
      <div className="mt-3 flex h-32 items-end">
        {serie.map((p) => (
          <div key={p.dia} className="mr-px flex h-full min-w-0 flex-1 flex-col justify-end" title={`${p.dia}: ${brl(p.gasto)} · ${inteiro(p.resultados)} resultados`}>
            <div className="w-full rounded-t-sm bg-primary/70" style={{ height: `${Math.max(2, ((p.gasto || 0) / maior) * 100)}%` }} />
          </div>
        ))}
      </div>
      <table className="mt-3 w-full table-fixed text-left text-[11.5px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1 font-medium">Dia</th>
            <th className="py-1 text-right font-medium">Gasto</th>
            <th className="py-1 text-right font-medium">Cliques</th>
            <th className="py-1 text-right font-medium">CTR</th>
            <th className="py-1 text-right font-medium">Result.</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((p) => (
            <tr key={p.dia} className="border-t border-border tabular-nums">
              <td className="truncate py-1">{p.dia.slice(5).split("-").reverse().join("/")}</td>
              <td className="py-1 text-right">{brl(p.gasto)}</td>
              <td className="py-1 text-right">{inteiro(p.cliques)}</td>
              <td className="py-1 text-right">{porcento(p.ctr)}</td>
              <td className="py-1 text-right">{inteiro(p.resultados)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function JanelaDaReferencia({
  referencia,
  referenciaId,
  onFechar,
}: {
  /** O que a lista já tem (aparece na hora, antes de referencia_abrir voltar). */
  referencia: ReferenciaAds | null;
  referenciaId: string | null;
  onFechar: () => void;
}) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const id = referenciaId || (referencia ? referencia.id : null);
  const [aba, setAba] = useState<Aba>("visao");
  const [ficha, setFicha] = useState<FichaDaReferencia>({});
  const [mecanismo, setMecanismo] = useState("");
  const [evidencia, setEvidencia] = useState<Evidencia>("E0");
  const [salvando, setSalvando] = useState(false);
  const [desde, rodar] = useAndamento();
  const [lendoSozinho, setLendoSozinho] = useState(false);

  const detalhe = useQuery({
    queryKey: chavesAds.referenciaAberta(clientId, id || ""),
    enabled: !!id,
    retry: false,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<DetalheDaReferencia> => normalizarDetalhe(await chamarAds("referencia_abrir", { client_id: clientId, referencia_id: id })),
  });
  const d = detalhe.data || null;
  // Aberta de fora da biblioteca (Conta): usa o que a lista de referências já tem.
  const daLista = !referencia && id ? (queryClient.getQueryData<ReferenciaAds[]>(chavesAds.referencias(clientId)) || []).find((x) => x.id === id) || null : null;
  const r: ReferenciaAds | null = (d && d.referencia) || referencia || daLista;
  const galeria = d && d.galeria.length ? d.galeria : r ? galeriaDaReferencia(r) : [];
  const daAgencia = !!r && r.client_id === null;
  const lida = !!r && fichaLida(r.ficha);
  const fichaChave = r ? JSON.stringify(r.ficha) : "";

  useEffect(() => setAba("visao"), [id]);
  useEffect(() => {
    setFicha(r ? { ...r.ficha } : {});
    setMecanismo(r ? r.mecanismo || String(r.ficha.mecanismo || "") : "");
    setEvidencia(r ? r.evidencia : "E0");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r ? r.id : null, fichaChave]);

  const atualizar = async () => {
    await queryClient.invalidateQueries({ queryKey: chavesAds.referencias(clientId) });
    if (id) await queryClient.invalidateQueries({ queryKey: chavesAds.referenciaAberta(clientId, id) });
  };

  const ler = () => chamarAds<any>("referencia_ler", { client_id: clientId, referencia_id: id });
  const aoLer = (data: any) => {
    if (data && data.ficha && typeof data.ficha === "object") setFicha({ ...data.ficha });
    void atualizar();
  };

  // Anúncio próprio sem ficha lida: completa sozinho, uma vez, depois de abrir.
  const pediu = useRef(false);
  useEffect(() => {
    pediu.current = false;
  }, [id]);
  useEffect(() => {
    if (!r || !id || pediu.current || detalhe.isLoading) return;
    if (r.origem !== "anuncio_proprio" || lida || leiturasAutomaticas.indexOf(r.id) >= 0) return;
    const estimativa = estimarLocal(partesDaLeitura(catalogo), catalogo);
    if (mesa.saldoUsd !== null && estimativa !== null && mesa.saldoUsd < estimativa) return;
    pediu.current = true;
    leiturasAutomaticas.push(r.id);
    setLendoSozinho(true);
    ler()
      .then((data) => {
        mesa.atualizarCusto();
        const custo = custoDaResposta(data);
        toast.success("Ficha completada", { description: custo === null ? "Custo registrado na carteira do cliente." : `Custo real: ${usd(custo)}.` });
        aoLer(data);
      })
      .catch((e) => {
        mesa.atualizarCusto();
        avisarErro(e, "A ficha não foi completada");
      })
      .then(() => setLendoSozinho(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r ? r.id : null, lida, detalhe.isLoading]);

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

  const alternarDestaque = async () => {
    if (!r || daAgencia) return;
    try {
      await marcarDestaque(r.id, !r.destaque);
      await atualizar();
    } catch (e) {
      toast.error("Destaque não salvo", { description: textoDoErro(e) });
    }
  };

  const evidenciasPossiveis = r && EVIDENCIAS_MANUAIS.indexOf(r.evidencia) < 0 ? EVIDENCIAS_MANUAIS.concat([r.evidencia]) : EVIDENCIAS_MANUAIS;
  const anuncio = d ? d.anuncio : null;
  const pagina = d ? d.pagina : null;
  const metricas = anuncio ? anuncio.metricas : normalizarMetricas(r ? r.metricas : {});
  const temAnuncio = !!anuncio || (!!r && r.origem === "anuncio_proprio");
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  const copy = {
    titulo: (anuncio && anuncio.titulo) || texto(ficha.titulo) || (pagina ? pagina.titulo : ""),
    corpo: (anuncio && anuncio.corpo) || texto(ficha.corpo) || texto(ficha.texto_principal),
    descricao: (anuncio && anuncio.descricao) || texto(ficha.descricao) || (pagina ? pagina.descricao : ""),
    gancho: texto(ficha.gancho_verbal),
    cta: (anuncio && anuncio.cta) || texto(ficha.cta),
    destino: (anuncio && anuncio.destino) || texto(ficha.destino) || (r && r.url) || "",
  };
  const semCopy = !copy.titulo && !copy.corpo && !copy.descricao && !copy.gancho && !copy.cta && !copy.destino;
  const nicho = r && nichoDaReferencia(r) ? nomeDoNicho(r) : "";
  const estilo = r ? estiloDaReferencia(r) : "";

  const blocoCompletar = (r && !lida) || desde !== null || lendoSozinho ? (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <p className="text-[12.5px] font-medium">{lendoSozinho || desde !== null ? "Completando a ficha" : "Ficha ainda não lida"}</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
        O leitor usa a galeria, a página, a copy e as métricas para preencher situação, gancho, argumento e o que transportar. Não inventa número; a evidência continua a que está.
      </p>
      <div className="mt-2 flex flex-wrap items-center">
        {lendoSozinho ? (
          <span role="status" className="inline-flex items-center text-[11.5px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo o anúncio
          </span>
        ) : (
          <>
            <BotaoComCusto
              rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Completar ficha com IA</>}
              titulo="Completar a ficha"
              descricao="O leitor preenche a ficha pela galeria, pela página e pelos números."
              className="mb-1 mr-2 h-8"
              partes={() => partesDaLeitura(catalogo)}
              executar={() => rodar(ler)}
              aoConcluir={aoLer}
            />
            <Andamento desde={desde} rotulo="Lendo" />
          </>
        )}
      </div>
    </div>
  ) : null;

  const titulo = r ? r.titulo : "Referência";

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="flex h-[92vh] w-[calc(100vw-1rem)] max-w-6xl flex-col overflow-hidden bg-background p-0 sm:w-[calc(100vw-2rem)]">
        <div className="shrink-0 border-b border-border px-4 pb-0 pt-4 sm:px-5">
          <div className="flex min-w-0 items-start pr-8">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[16px] font-semibold leading-snug [overflow-wrap:anywhere]">{titulo}</DialogTitle>
              <DialogDescription asChild>
                <div className="mt-1 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
                  {r && <SeloDeEvidencia valor={r.evidencia} className="mb-1 mr-2" />}
                  {r && <span className="mb-1 mr-2">{daAgencia ? "Biblioteca da agência" : rotuloDaOrigem(r.origem)}</span>}
                  {nicho && <span className="mb-1 mr-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px]">{nicho}</span>}
                  {estilo && <span className="mb-1 mr-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px]">{humanizar(estilo)}</span>}
                  {detalhe.isFetching && (
                    <span className="mb-1 inline-flex items-center text-[11.5px]">
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> buscando imagens e dados
                    </span>
                  )}
                </div>
              </DialogDescription>
            </div>
            {r && !daAgencia && (
              <button
                type="button"
                onClick={() => void alternarDestaque()}
                aria-pressed={r.destaque}
                aria-label={r.destaque ? "Tirar o destaque" : "Destacar para o plano"}
                title={r.destaque ? "Em destaque: o estrategista usa no plano" : "Destacar para o plano"}
                className="ml-2 flex h-8 shrink-0 items-center rounded-lg border border-border px-2.5 text-[12px] hover:bg-secondary"
              >
                <Star className={`mr-1 h-3.5 w-3.5 ${r.destaque ? "fill-warning text-warning" : "text-muted-foreground"}`} />
                {r.destaque ? "Em destaque" : "Destacar"}
              </button>
            )}
          </div>
          <Abas<Aba>
            rotulo="Partes da referência"
            valor={aba}
            onMudar={setAba}
            className="mt-3 border-b-0"
            opcoes={[
              { valor: "visao", rotulo: "Visão" },
              { valor: "ficha", rotulo: "Ficha" },
              { valor: "copy", rotulo: "Copy e destino" },
              { valor: "metricas", rotulo: "Métricas" },
              { valor: "original", rotulo: "Original" },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {d && d.aviso && <p className="mb-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[12px]">{d.aviso}</p>}
          {detalhe.isError && (
            <div className="mb-3">
              <AvisoDeErro erro={detalhe.error} />
              <p className="mt-1 text-[11.5px] text-muted-foreground">Mostrando o que já está guardado na biblioteca.</p>
            </div>
          )}
          {!r && detalhe.isLoading && (
            <div aria-busy="true" className="space-y-3">
              <div className="h-[44vh] animate-pulse rounded-xl bg-muted/70" />
              <div className="h-16 animate-pulse rounded-xl bg-muted/60" />
            </div>
          )}

          {r && aba === "visao" && (
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              {detalhe.isLoading && !galeria.length ? <div className="h-[44vh] animate-pulse rounded-xl bg-muted/70 sm:h-[56vh]" aria-label="Carregando as imagens" /> : <Galeria imagens={galeria} r={r} />}
              <div className="min-w-0 space-y-3">
                {blocoCompletar}
                <div className="rounded-xl border border-border bg-card px-4 py-1">
                  <Linha rotulo="Mecanismo" valor={r.mecanismo || texto(r.ficha.mecanismo)} copiar={false} />
                  <Linha rotulo="Primeira fala ou headline" valor={texto(r.ficha.gancho_verbal)} />
                  <Linha rotulo="Gancho visual" valor={texto(r.ficha.gancho_visual)} copiar={false} />
                  <Linha rotulo="Argumento central" valor={texto(r.ficha.argumento)} copiar={false} />
                  <Linha rotulo="O que transportar" valor={texto(r.ficha.o_que_transportar)} copiar={false} />
                  {!r.mecanismo && !r.ficha.gancho_verbal && !r.ficha.argumento && !r.ficha.o_que_transportar && (
                    <p className="py-3 text-[12px] text-muted-foreground">Sem leitura ainda. Complete a ficha para o estrategista usar esta referência.</p>
                  )}
                </div>
                {temMetricas(metricas) && (
                  <button type="button" onClick={() => setAba("metricas")} className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left hover:border-primary/40">
                    <span className="block text-[10.5px] uppercase tracking-wider text-muted-foreground">Resultado real</span>
                    <span className="mt-0.5 block text-[13px] tabular-nums">
                      {brl(metricas.gasto)} · {inteiro(metricas.resultados)} resultados · {brl(metricas.custo_por_resultado)} cada
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

          {r && aba === "ficha" && (
            <div className="mx-auto max-w-3xl space-y-4">
              {blocoCompletar}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">Evidência</span>
                  <select
                    aria-label="Evidência"
                    value={evidencia}
                    disabled={daAgencia}
                    onChange={(e) => setEvidencia(e.target.value as Evidencia)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]"
                  >
                    {ESCALA_DE_EVIDENCIA.filter((e) => evidenciasPossiveis.indexOf(e.valor) >= 0).map((e) => (
                      <option key={e.valor} value={e.valor}>
                        {e.valor} · {e.rotulo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">Mecanismo</span>
                  <Input aria-label="Mecanismo" className="h-9 text-[12.5px]" value={mecanismo} readOnly={daAgencia} placeholder="Sem citar a marca" onChange={(e) => setMecanismo(e.target.value)} />
                </label>
              </div>
              <p className="-mt-2 text-[11px] leading-snug text-muted-foreground">E3 e E4 só com resultado documentado (importação dos anúncios ou aprendizado registrado).</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CAMPOS_DA_FICHA.map((c) => {
                  const valor = typeof ficha[c.chave] === "string" ? String(ficha[c.chave]) : "";
                  return (
                    <label key={String(c.chave)} className={`block min-w-0 ${c.longo ? "sm:col-span-2" : ""}`}>
                      <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">{c.rotulo}</span>
                      {daAgencia ? (
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
              {daAgencia ? (
                <p className="text-[11.5px] text-muted-foreground">Biblioteca da agência: a ficha é só leitura aqui. Completar com IA grava a leitura na própria biblioteca.</p>
              ) : (
                <div className="sticky bottom-0 flex justify-end border-t border-border bg-background py-3">
                  <Button type="button" size="sm" disabled={salvando} onClick={() => void salvar()}>
                    {salvando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    Salvar ficha
                  </Button>
                </div>
              )}
            </div>
          )}

          {r && aba === "copy" && (
            <div className="mx-auto max-w-3xl">
              {semCopy ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center">
                  <p className="text-[13.5px] font-medium">Sem copy registrada</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">Complete a ficha com IA ou escreva na aba Ficha o que o anúncio diz.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card px-4 py-1">
                  <Linha rotulo="Título" valor={copy.titulo} />
                  <Linha rotulo="Texto principal" valor={copy.corpo} />
                  <Linha rotulo="Descrição" valor={copy.descricao} />
                  <Linha rotulo="Primeira fala ou headline" valor={copy.gancho} />
                  <Linha rotulo="Botão" valor={rotuloDoCta(copy.cta)} />
                  <Linha rotulo="Destino" valor={copy.destino} link />
                </div>
              )}
            </div>
          )}

          {r && aba === "metricas" && (
            <div className="mx-auto max-w-4xl space-y-4">
              {temMetricas(metricas) ? (
                <>
                  {anuncio && (anuncio.campanha || anuncio.status) && (
                    <p className="text-[12px] text-muted-foreground">
                      {[anuncio.campanha ? `Campanha ${anuncio.campanha}` : "", anuncio.status ? humanizar(anuncio.status.toLowerCase()) : ""].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <Indicadores m={metricas} />
                  {anuncio && <SerieDiaria serie={anuncio.serie} />}
                  {anuncio && (
                    <section className="rounded-xl border border-border bg-card p-4" aria-label="Diagnóstico">
                      <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Diagnóstico</h4>
                      <Diagnostico valor={anuncio.diagnostico} />
                    </section>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-8 text-center">
                  <p className="text-[13.5px] font-medium">{temAnuncio ? "Sem entrega no período" : "Referência externa, sem métricas"}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {temAnuncio ? "O anúncio não teve números recentes na conta." : "Longevidade, curtidas e bibliotecas de vencedores não são prova de retorno. Só anúncio próprio traz resultado real."}
                  </p>
                </div>
              )}
            </div>
          )}

          {r && aba === "original" && (
            <div className="mx-auto max-w-3xl space-y-3">
              {pagina && (pagina.titulo || pagina.descricao) && (
                <section className="rounded-xl border border-border bg-card px-4 py-1" aria-label="Página de origem">
                  <Linha rotulo="Título da página" valor={pagina.titulo} copiar={false} />
                  <Linha rotulo="Descrição" valor={pagina.descricao} copiar={false} />
                  <Linha rotulo="Site" valor={[pagina.site, pagina.tipo ? humanizar(pagina.tipo) : ""].filter(Boolean).join(" · ")} copiar={false} />
                  {Object.keys(pagina.extra).map((k) => {
                    const v = pagina.extra[k];
                    const t = Array.isArray(v) ? v.join(", ") : typeof v === "object" && v ? "" : String(v === null || v === undefined ? "" : v);
                    return <Linha key={k} rotulo={humanizar(k)} valor={t} copiar={false} />;
                  })}
                </section>
              )}
              <section className="rounded-xl border border-border bg-card px-4 py-1">
                <Linha rotulo="Origem" valor={daAgencia ? "Biblioteca da agência" : rotuloDaOrigem(r.origem)} copiar={false} />
                <Linha rotulo="Plataforma e formato" valor={[r.plataforma, r.formato].filter(Boolean).join(" · ")} copiar={false} />
                <Linha rotulo="Anúncio no Meta" valor={r.ad_id || (anuncio ? anuncio.ad_id : "")} />
              </section>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-[12.5px] font-medium hover:bg-secondary">
                  Abrir o original em outra aba <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="text-[12px] text-muted-foreground">Esta referência não tem link externo.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
