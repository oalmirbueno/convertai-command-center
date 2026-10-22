import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { padraoPara, TAMANHOS, type ParteDaEstimativa } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import { BotaoComCusto } from "./Custo";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "./MesaContexto";
import { diaCurto, type Campanha } from "./mesaV4Api";
import { corpoDaPeca, ehPecaDeArte, FASES, faseDaPeca, ROTULO_DO_ESTADO_DA_PECA, TELAS_DO_STORY, type ChaveDoFormato, type EstadoDaPeca, type ItemDeStory, type SituacaoDaPeca } from "./regrasDaCampanha";
import { chavesDaCampanhaCompleta, gerarLaminasDaPeca, gerarStoryDaCampanha, geradorDeStoriesDisponivel, normalizarBriefing, prepararPecaSemGerar } from "./campanhasApi";
import { ICONE_DO_FORMATO } from "./CampanhaFormatos";
import { chaves } from "./mesaV4Api";

/** A chave do formato da peça (para o ícone). */
const chaveDaPeca = (formato?: string): ChaveDoFormato => (formato === "estatico" ? "posts" : formato === "story" ? "stories" : formato === "video" ? "videos" : "carrosseis");
import { emAndamento, useExecucao } from "./execucaoDaCampanha";

/**
 * Peças da campanha (etapa 5, 21/10/2026): cada conteúdo da série vira arte ou carrossel GERADO pelo
 * Estúdio (arte rápida com a identidade da campanha). A grade mostra a capa de cada peça, a fase, o dia e
 * onde ela está; cada peça abre no Estúdio para ajustar, e a que falhou ou ainda não saiu gera sozinha.
 */

const COR_DO_ESTADO: Record<EstadoDaPeca, string> = {
  outra_mesa: "text-muted-foreground",
  roteiro_pronto: "text-success",
  no_roteiro: "text-success",
  a_fazer: "text-muted-foreground",
  sem_direcao: "text-warning",
  a_gerar: "text-warning",
  gerando: "text-primary",
  erro: "text-destructive",
  pronta: "text-success",
  na_agenda: "text-success",
};

/** Uma peça na grade: capa gerada (ou o lugar dela), título, dia e estado. */
export function PecaNaGrade({ peca, acoes }: { peca: SituacaoDaPeca; acoes?: ReactNode }) {
  const it = peca.item;
  return (
    <li className="min-w-0" data-peca={it.tema_id} data-estado={peca.estado}>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-md bg-muted">
        {peca.capa ? (
          <ImagemDaMesa caminho={peca.capa} alt={`Capa de ${it.tema || "peça"}`} className="h-full w-full" />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-3 text-center text-[12px] text-muted-foreground">
            {peca.estado === "gerando" ? <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Gerando" /> : it.gancho || it.tema || "Peça"}
          </span>
        )}
        <span className="absolute left-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground [&>svg]:h-3.5 [&>svg]:w-3.5" role="img" aria-label={it.formato === "story" ? "Stories" : it.formato === "video" ? "Vídeo" : it.formato === "estatico" ? "Post" : "Carrossel"}>
          {ICONE_DO_FORMATO[chaveDaPeca(it.formato)]}
        </span>
        {peca.laminas > 1 && it.formato !== "story" && (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center rounded-full bg-background/90 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
            <Layers className="mr-0.5 h-3 w-3" aria-hidden="true" />
            {peca.feitas}/{peca.laminas}
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-[12px] font-medium" title={it.tema}>{it.tema || "Peça"}</p>
      <div className="flex min-w-0 items-center text-[11px]">
        <span className="mr-1.5 shrink-0 text-muted-foreground">{diaCurto(it.data)}</span>
        <span className={juntar("min-w-0 truncate font-medium", COR_DO_ESTADO[peca.estado])}>{ROTULO_DO_ESTADO_DA_PECA[peca.estado]}</span>
        {peca.colagem && (
          <span className="ml-1 shrink-0 text-warning" role="img" aria-label="Lâmina que não saiu do gerador" title="Uma lâmina não saiu do gerador (foto composta ou layout montado): refaça pelo gerador no Estúdio.">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
        {acoes && <span className="ml-auto flex shrink-0 items-center">{acoes}</span>}
      </div>
    </li>
  );
}

/** A série por fase (aquecimento, lançamento, urgência, encerramento), cada fase com a grade das peças. */
export function PecasPorFase({ pecas, acoes, vazio }: { pecas: SituacaoDaPeca[]; acoes?: (p: SituacaoDaPeca) => ReactNode; vazio?: string }) {
  if (!pecas.length) return <p className={texto.auxiliar}>{vazio || "Nenhuma peça ainda."}</p>;
  return (
    <div className="min-w-0 space-y-5">
      {FASES.map((f) => {
        const daFase = pecas.filter((p) => p.fase === f.valor);
        if (!daFase.length) return null;
        return (
          <section key={f.valor} className="min-w-0" aria-label={`Fase de ${f.rotulo.toLowerCase()}`} data-fase={f.valor}>
            <p className={juntar(texto.rotulo, "mb-2")}>
              {f.rotulo} <span className="font-normal">· {daFase.length}</span>
            </p>
            <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {daFase.map((p) => (
                <PecaNaGrade key={p.item.tema_id || p.item.tema} peca={p} acoes={acoes ? acoes(p) : undefined} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * As ações de cada peça (22/10/2026, dono: "clico em abrir no Estúdio e ele já puxa a sequência e eu já gero
 * por lá, já com o tema, e tudo pronto, só gerar; e quando eu voltar aparece ali"):
 * - post e carrossel sem trabalho: "Abrir no Estúdio" cria a direção (rapida_preparar com o conteúdo, a
 *   identidade, campanha_id e peca_da_campanha), SEM gerar, e abre a arte no Estúdio para a equipe gerar lá;
 * - com trabalho: abre o trabalho existente (e "Gerar o que falta" quando faltam lâminas);
 * - story: abre a sequência na aba Stories (ou cria pelo contrato, com custo antes, e abre);
 * - vídeo: o roteiro mora na Série (sem ação aqui).
 */
export function useAcoesDasPecas({
  campanha,
  pecas,
  onAbrirArteRapida,
  onAbrirStories,
}: {
  campanha: Campanha;
  pecas: SituacaoDaPeca[];
  onAbrirArteRapida?: (trabalhoId: string) => void;
  onAbrirStories?: (sequenciaId: string) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const execucao = useExecucao(campanha.id);
  const andando = emAndamento(execucao);
  const imagem = padraoPara(catalogo, "imagem");
  const leitor = padraoPara(catalogo, "leitura");
  const diretor = padraoPara(catalogo, "diretor_arte");
  const marcaId = (campanha.identidade && campanha.identidade.marca_id) || (marca ? marca.id : null);
  const deArte = pecas.filter((p) => ehPecaDeArte(p.item));
  const reler = () => {
    void qc.invalidateQueries({ queryKey: chavesDaCampanhaCompleta.pecas(clientId, campanha.id) });
    void qc.invalidateQueries({ queryKey: ["mesa", "campanha-pecas-fila", campanha.id] });
  };
  const partesDasLaminas = (n: number): ParteDaEstimativa[] => [
    { modeloId: imagem ? imagem.id : null, tipo: "imagem", imagens: 1, qualidade: "media", tokensEntrada: TAMANHOS.imagemAnexos.entrada, vezes: n },
    { modeloId: leitor ? leitor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida, vezes: n },
  ];
  const parteDaDirecao = (): ParteDaEstimativa => ({ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida });

  const abrirTrabalho = (id: string, rotulo = "Abrir no Estúdio") =>
    onAbrirArteRapida ? (
      <button type="button" className={juntar(botao.icone, "h-7 w-7 text-primary")} onClick={() => onAbrirArteRapida(id)} aria-label={rotulo} title={`${rotulo}: conferir, ajustar e gerar lá`} data-abrir-no-estudio={id}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    ) : null;

  return (p: SituacaoDaPeca): ReactNode => {
    const i = deArte.indexOf(p);
    if (p.item.formato === "story") {
      const sequencia = (p.item as ItemDeStory).sequencia_id;
      if (sequencia && onAbrirStories) {
        return (
          <button type="button" className={juntar(botao.icone, "h-7 w-7 text-primary")} onClick={() => onAbrirStories(sequencia)} aria-label="Abrir nos Stories" title="Abrir a sequência na aba Stories">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      }
      if (p.estado !== "a_fazer") return null;
      const pronto = geradorDeStoriesDisponivel();
      return (
        <BotaoComCusto
          rotulo={<><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Criar e abrir nos Stories</span></>}
          titulo="Stories da campanha"
          descricao={pronto ? "Criar esta sequência pela aba Stories, com a identidade da campanha, e abrir lá" : "Os stories da campanha ainda não estão ligados à aba Stories"}
          partes={() => [parteDaDirecao()].concat(partesDasLaminas(p.laminas || TELAS_DO_STORY))}
          executar={async () => {
            let id = "";
            try {
              id = await gerarStoryDaCampanha(campanha, {
                clientId,
                campanhaId: campanha.id,
                temaId: p.item.tema_id || "",
                briefing: normalizarBriefing(campanha.briefing),
                identidade: campanha.identidade,
                fase: faseDaPeca(p.item, campanha.periodo_inicio, campanha.periodo_fim),
                quantidadeDeTelas: p.laminas || TELAS_DO_STORY,
                data: p.item.data || null,
                pedido: [p.item.tema, p.item.gancho].concat((p.item.cards || []).map((x) => x.texto || "")).filter(Boolean).join(" / "),
                marcaId,
              });
            } finally {
              void qc.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
            }
            if (id && id !== "feita" && onAbrirStories) onAbrirStories(id);
            return { custo_usd: null };
          }}
          disabled={andando || !pronto}
          variant="ghost"
          className="h-7 gap-0 px-1.5"
        />
      );
    }
    if (p.item.formato === "video") return null;
    if (p.estado === "a_fazer") {
      // Abrir no Estúdio: só a direção (sem gerar); a equipe confere e gera lá.
      return (
        <BotaoComCusto
          rotulo={<><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Abrir no Estúdio</span></>}
          titulo="Peça no Estúdio"
          descricao="Abrir no Estúdio com tudo pronto (tema, texto, lâminas e identidade da campanha); gerar fica lá"
          partes={() => [parteDaDirecao()]}
          executar={async () => {
            let id = "";
            try {
              const r = await prepararPecaSemGerar(corpoDaPeca({ clientId, campanha, item: p.item, posicao: { i: i + 1, total: deArte.length }, marcaId, modeloImagemId: imagem ? imagem.id : null }));
              id = r.trabalhoId;
            } finally {
              reler();
            }
            if (id && onAbrirArteRapida) onAbrirArteRapida(id);
            return { custo_usd: null };
          }}
          disabled={andando}
          variant="ghost"
          className="h-7 gap-0 px-1.5 text-primary"
        />
      );
    }
    if ((p.estado === "a_gerar" || p.estado === "erro") && p.trabalho && p.faltam.length) {
      const trabalhoId = p.trabalho.id;
      return (
        <>
          <BotaoComCusto
            rotulo={<><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Gerar o que falta</span></>}
            titulo="Lâminas da peça"
            descricao={`Gerar as ${p.faltam.length} lâmina(s) que faltam`}
            partes={() => partesDasLaminas(p.faltam.length)}
            executar={async () => {
              try {
                await gerarLaminasDaPeca(trabalhoId, p.faltam, marcaId);
              } finally {
                reler();
              }
              return { custo_usd: null };
            }}
            disabled={andando}
            variant="ghost"
            className="h-7 gap-0 px-1.5"
          />
          {abrirTrabalho(trabalhoId)}
        </>
      );
    }
    return p.trabalho ? abrirTrabalho(p.trabalho.id) : null;
  };
}

export default function CampanhaPecas({
  campanha,
  pecas,
  carregando,
  onAbrirArteRapida,
  onAbrirStories,
}: {
  campanha: Campanha;
  pecas: SituacaoDaPeca[];
  carregando: boolean;
  onAbrirArteRapida?: (trabalhoId: string) => void;
  onAbrirStories?: (sequenciaId: string) => void;
}) {
  const acoes = useAcoesDasPecas({ campanha, pecas, onAbrirArteRapida, onAbrirStories });
  if (carregando) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  return (
    <div className="min-w-0 space-y-3" data-pecas-da-campanha="">
      <p className={texto.auxiliar}>Abra no Estúdio: tudo pronto, só gerar lá.</p>
      <PecasPorFase pecas={pecas} acoes={acoes} vazio="A série ainda não tem conteúdos: gere a série na etapa anterior." />
    </div>
  );
}
