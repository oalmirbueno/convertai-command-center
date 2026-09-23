import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ExternalLink, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro, usd, type ParteDaEstimativa } from "@/lib/mesa/api";
import { Ampliar } from "./Ampliar";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { BlocoDaProposta } from "./ConteudosPropostos";
import CampanhaReferencias, { MAX_REFERENCIAS, ReferenciasEscolhidas } from "./CampanhaReferencias";
import { Cronometro } from "./Cronometro";
import {
  ajustarProposta,
  campanhaAjustar,
  campanhaSelo,
  chaves,
  lerProposta,
  mesDaData,
  partesDoAjuste,
  partesDoAjusteDaCampanha,
  partesDoSelo,
  periodoCurto,
  salvarReferenciasDaCampanha,
  type Campanha,
} from "./mesaV4Api";

/**
 * Detalhe da campanha: o conceito, a identidade do tema (com o selo
 * desenhado), as referências escolhidas e os conteúdos, que vão todos para a
 * agenda num clique. Depois de gravada, abre no Estúdio já na identidade da
 * campanha.
 */

export const ROTULO_DO_ESTADO: Record<string, string> = { planejada: "planejada", gravada: "gravada", encerrada: "encerrada" };

export function SeloDoEstado({ estado }: { estado: string }) {
  const cor = estado === "gravada" ? "bg-success/15 text-success" : estado === "encerrada" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cor}`}>{ROTULO_DO_ESTADO[estado] || estado}</span>;
}

/** Caixa de ajuste em português: texto e o botão com custo. */
function CaixaDeAjuste({
  rotulo,
  placeholder,
  titulo,
  partes,
  executar,
  aoConcluir,
  onFechar,
}: {
  rotulo: string;
  placeholder: string;
  titulo: string;
  partes: () => ParteDaEstimativa[];
  executar: (mensagem: string) => Promise<any>;
  aoConcluir: (data: any) => void;
  onFechar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState<number | null>(null);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-2.5">
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={2}
        autoFocus
        aria-label={titulo}
        placeholder={placeholder}
        className="min-h-[56px] resize-none border-0 px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex flex-wrap items-center justify-end">
        {desde !== null && <span className="mb-1 mr-auto"><Cronometro desde={desde} rotulo="Ajustando" /></span>}
        <Button type="button" size="sm" variant="ghost" className="mb-1 mr-1.5 h-8" onClick={onFechar}>Cancelar</Button>
        <BotaoComCusto
          rotulo={rotulo}
          titulo={titulo}
          partes={partes}
          executar={async () => {
            setDesde(Date.now());
            try {
              return await executar(texto.trim());
            } finally {
              setDesde(null);
            }
          }}
          aoConcluir={(data) => {
            setTexto("");
            aoConcluir(data);
          }}
          disabled={!texto.trim() || desde !== null}
          className="mb-1 h-8"
        />
      </div>
    </div>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default function CampanhaDetalhe({
  campanha,
  projetoSugerido,
  onVoltar,
  onAbrirNoEstudio,
}: {
  campanha: Campanha;
  projetoSugerido?: string | null;
  onVoltar?: () => void;
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [seloDesde, setSeloDesde] = useState<number | null>(null);
  const [seloAberto, setSeloAberto] = useState(false);
  const [ajustarCampanha, setAjustarCampanha] = useState(false);
  const [ajustarConteudos, setAjustarConteudos] = useState(false);
  const [galeria, setGaleria] = useState(false);
  const [ultimaResposta, setUltimaResposta] = useState("");
  const [referencias, setReferencias] = useState<string[]>(campanha.referencias_ids || []);
  const [salvandoRefs, setSalvandoRefs] = useState(0);
  const fila = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setReferencias(campanha.referencias_ids || []);
    setAjustarCampanha(false);
    setAjustarConteudos(false);
    setUltimaResposta("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanha.id]);

  const proposta = useQuery({
    queryKey: chaves.proposta(campanha.proposta_id || ""),
    enabled: !!campanha.proposta_id,
    queryFn: () => lerProposta(campanha.proposta_id as string),
  });

  const id = campanha.identidade || {};
  const paleta = (id.paleta_apoio || []).filter((c) => c && c.hex);
  const selo = id.selo || {};
  const gravada = campanha.status === "gravada";
  const itens = proposta.data ? proposta.data.itens || [] : [];
  const primeiraTarefa = itens.slice().sort((a, b) => String(a.data || "").localeCompare(String(b.data || ""))).find((i) => !!i.task_id);

  const trocarNaLista = (nova: Campanha) =>
    queryClient.setQueryData<Campanha[]>(chaves.campanhas(clientId), (lista) => (lista || []).map((c) => (c.id === nova.id ? nova : c)));

  /** Grava a lista inteira; as gravações seguem em fila, a última vence. */
  const gravarReferencias = (lista: string[]) => {
    setReferencias(lista);
    trocarNaLista({ ...campanha, referencias_ids: lista });
    setSalvandoRefs((n) => n + 1);
    fila.current = fila.current.then(async () => {
      try {
        await salvarReferenciasDaCampanha(campanha.id, lista);
      } catch (e) {
        toast.error("Referências não salvas", { description: textoDoErro(e) });
        void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
      } finally {
        setSalvandoRefs((n) => n - 1);
      }
    });
  };

  const desenharSelo = async () => {
    setSeloDesde(Date.now());
    try {
      return await campanhaSelo(campanha.id);
    } finally {
      setSeloDesde(null);
    }
  };

  const corDoSelo = paleta.length ? String(paleta[0].hex) : undefined;

  return (
    <div className="min-w-0 space-y-5">
      {onVoltar && (
        <button type="button" onClick={onVoltar} className="inline-flex items-center text-[12.5px] text-muted-foreground hover:text-foreground lg:hidden">
          <ChevronLeft className="mr-0.5 h-4 w-4" /> Campanhas
        </button>
      )}

      {/* Cabeçalho: selo, nome, período e estado. */}
      <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex min-w-0 flex-col sm:flex-row sm:items-start">
          <div className="mb-3 shrink-0 sm:mb-0 sm:mr-4">
            {campanha.selo_path ? (
              <button
                type="button"
                onClick={() => setSeloAberto(true)}
                aria-label="Ver o selo grande"
                className="block h-24 w-24 cursor-zoom-in overflow-hidden rounded-xl border border-border bg-background"
              >
                <ImagemDaMesa caminho={campanha.selo_path} alt={`Selo da campanha ${campanha.nome}`} className="h-full w-full !object-contain p-1.5" />
              </button>
            ) : (
              <div
                className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-background p-2 text-center text-[11px] font-semibold leading-tight [overflow-wrap:anywhere]"
                style={corDoSelo ? { color: corDoSelo } : undefined}
              >
                {selo.texto || campanha.nome}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center">
              <h2 className="mr-2 min-w-0 text-[17px] font-semibold leading-snug [overflow-wrap:anywhere]">{campanha.nome}</h2>
              <SeloDoEstado estado={campanha.status} />
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}
              {itens.length ? ` · ${itens.length} conteúdo(s)` : ""}
              {campanha.custo_usd ? ` · ${usd(Number(campanha.custo_usd))}` : ""}
            </p>
            {campanha.objetivo && <p className="mt-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{campanha.objetivo}</p>}
            <div className="mt-3 flex flex-wrap items-center">
              <BotaoComCusto
                rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />{campanha.selo_path ? "Desenhar de novo" : "Desenhar selo"}</>}
                titulo="Selo da campanha"
                descricao="O gerador de imagem desenha o selo (logo do tema) com o texto e as cores da campanha."
                partes={() => partesDoSelo(catalogo)}
                executar={desenharSelo}
                aoConcluir={(data) => {
                  if (data && data.campanha) trocarNaLista(data.campanha as Campanha);
                  void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
                }}
                variant={campanha.selo_path ? "outline" : "default"}
                disabled={seloDesde !== null}
                className="mb-1.5 mr-1.5 h-8"
              />
              <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8" onClick={() => setAjustarCampanha((v) => !v)} aria-expanded={ajustarCampanha}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Ajustar campanha
              </Button>
              {gravada && primeiraTarefa && onAbrirNoEstudio && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mb-1.5 h-8 text-primary"
                  onClick={() => onAbrirNoEstudio(primeiraTarefa.task_id as string, mesDaData(primeiraTarefa.data))}
                >
                  Abrir no Estúdio <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {seloDesde !== null && <Cronometro desde={seloDesde} rotulo="Desenhando o selo" previsao="~40s" />}
          </div>
        </div>
        {ajustarCampanha && (
          <div className="mt-3">
            <CaixaDeAjuste
              rotulo="Ajustar"
              titulo="Campanha ajustada"
              placeholder="Ex.: nome mais curto, tom mais leve, trocar o rosa por vinho"
              partes={() => partesDoAjusteDaCampanha(catalogo)}
              executar={(mensagem) => campanhaAjustar(campanha.id, mensagem)}
              aoConcluir={(data) => {
                if (data && data.campanha) trocarNaLista(data.campanha as Campanha);
                setUltimaResposta(String((data && data.resposta) || ""));
                setAjustarCampanha(false);
              }}
              onFechar={() => setAjustarCampanha(false)}
            />
          </div>
        )}
        {ultimaResposta && (
          <p className="mt-3 flex items-start rounded-lg bg-muted px-3 py-2 text-[12px] leading-relaxed [overflow-wrap:anywhere]">
            <span className="min-w-0 flex-1">{ultimaResposta}</span>
            <button type="button" onClick={() => setUltimaResposta("")} aria-label="Fechar" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </p>
        )}
      </section>

      {/* Conceito e identidade do tema. */}
      <section className="grid min-w-0 grid-cols-1 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 xl:grid-cols-2">
        <dl className="min-w-0 space-y-3">
          {campanha.conceito && <Linha rotulo="Conceito">{campanha.conceito}</Linha>}
          {id.tom && <Linha rotulo="Tom">{id.tom}</Linha>}
          {(selo.texto || selo.descricao) && (
            <Linha rotulo="Selo">
              {selo.texto && <strong className="font-medium">{selo.texto}</strong>}
              {selo.texto && selo.descricao ? ". " : ""}
              {selo.descricao}
            </Linha>
          )}
        </dl>
        <dl className="min-w-0 space-y-3">
          {id.tema_visual && <Linha rotulo="Tema visual">{id.tema_visual}</Linha>}
          {paleta.length > 0 && (
            <Linha rotulo="Cores de apoio">
              <span className="mt-1 flex flex-wrap">
                {paleta.map((c, i) => (
                  <span key={`${c.hex}-${i}`} className="mb-1.5 mr-3 inline-flex min-w-0 items-center">
                    <span className="mr-1.5 inline-block h-5 w-5 shrink-0 rounded-md border border-border" style={{ backgroundColor: c.hex }} />
                    <span className="min-w-0 text-[11.5px] text-muted-foreground">{c.nome ? `${c.nome} ` : ""}{c.hex}</span>
                  </span>
                ))}
              </span>
            </Linha>
          )}
          {id.tipografia && <Linha rotulo="Tipografia">{id.tipografia}</Linha>}
          {id.elementos && <Linha rotulo="Elementos">{id.elementos}</Linha>}
        </dl>
      </section>

      {/* Referências. */}
      <section className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <button type="button" onClick={() => setGaleria((v) => !v)} aria-expanded={galeria} className="flex w-full min-w-0 items-center text-left">
          <span className="min-w-0 flex-1 text-[13px] font-semibold">
            Referências <span className="text-[12px] font-normal text-muted-foreground">({referencias.length} de {MAX_REFERENCIAS})</span>
          </span>
          {salvandoRefs > 0 && <Loader2 className="mr-2 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          <span className="inline-flex shrink-0 items-center text-[12px] font-medium text-primary">
            {galeria ? "Fechar" : "Escolher"}
            <ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${galeria ? "rotate-180" : ""}`} />
          </span>
        </button>
        {!galeria && (
          <ReferenciasEscolhidas
            ids={referencias}
            onTirar={(rid) => gravarReferencias(referencias.filter((x) => x !== rid))}
            vazio="Nenhuma escolhida: os conteúdos seguem a identidade e as referências do cliente."
          />
        )}
        {galeria && <CampanhaReferencias valor={referencias} onChange={gravarReferencias} />}
      </section>

      {/* Conteúdos. */}
      <section className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h3 className="text-[13px] font-semibold">Conteúdos{itens.length ? ` (${itens.length})` : ""}</h3>
        {proposta.isLoading && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
        {proposta.isError && <AvisoDeErro erro={proposta.error} />}
        {!campanha.proposta_id && <p className="text-[12px] text-muted-foreground">Esta campanha ainda não tem conteúdos.</p>}
        {proposta.data && (
          <BlocoDaProposta
            proposta={proposta.data}
            projetoSugerido={projetoSugerido || null}
            rotuloGravar="Gravar tudo na agenda"
            rotuloAjustar="Ajustar conteúdos"
            onAjustar={() => setAjustarConteudos((v) => !v)}
            onAbrirNoEstudio={onAbrirNoEstudio}
            grade
          />
        )}
        {ajustarConteudos && proposta.data && (
          <CaixaDeAjuste
            rotulo="Ajustar"
            titulo="Conteúdos ajustados"
            placeholder="Ex.: troque o terceiro por um depoimento, menos carrossel"
            partes={() => partesDoAjuste(catalogo)}
            executar={(mensagem) => ajustarProposta(proposta.data ? proposta.data.id : "", mensagem)}
            aoConcluir={(data) => {
              if (data && data.proposta && proposta.data) queryClient.setQueryData(chaves.proposta(proposta.data.id), data.proposta);
              setUltimaResposta(String((data && data.resposta) || ""));
              setAjustarConteudos(false);
            }}
            onFechar={() => setAjustarConteudos(false)}
          />
        )}
      </section>

      {campanha.selo_path && (
        <Ampliar
          imagens={[{ caminho: campanha.selo_path, titulo: `Selo: ${campanha.nome}` }]}
          indice={seloAberto ? 0 : null}
          onFechar={() => setSeloAberto(false)}
        />
      )}
    </div>
  );
}
