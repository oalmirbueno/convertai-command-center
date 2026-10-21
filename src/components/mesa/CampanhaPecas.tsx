import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { padraoPara, TAMANHOS, type ParteDaEstimativa } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import { BotaoComCusto } from "./Custo";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "./MesaContexto";
import { diaCurto, type Campanha } from "./mesaV4Api";
import { corpoDaPeca, ehPecaDeArte, FASES, ROTULO_DO_ESTADO_DA_PECA, type EstadoDaPeca, type SituacaoDaPeca } from "./regrasDaCampanha";
import { chavesDaCampanhaCompleta, gerarLaminasDaPeca, prepararPecaDaCampanha } from "./campanhasApi";
import { emAndamento, useExecucao } from "./execucaoDaCampanha";

/**
 * Peças da campanha (etapa 5, 21/10/2026): cada conteúdo da série vira arte ou carrossel GERADO pelo
 * Estúdio (arte rápida com a identidade da campanha). A grade mostra a capa de cada peça, a fase, o dia e
 * onde ela está; cada peça abre no Estúdio para ajustar, e a que falhou ou ainda não saiu gera sozinha.
 */

const COR_DO_ESTADO: Record<EstadoDaPeca, string> = {
  outra_mesa: "text-muted-foreground",
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
        {peca.laminas > 1 && (
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

export default function CampanhaPecas({
  campanha,
  pecas,
  carregando,
  onAbrirArteRapida,
}: {
  campanha: Campanha;
  pecas: SituacaoDaPeca[];
  carregando: boolean;
  onAbrirArteRapida?: (trabalhoId: string) => void;
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

  const acoes = (p: SituacaoDaPeca) => {
    const i = deArte.indexOf(p);
    if (p.estado === "a_fazer") {
      return (
        <BotaoComCusto
          rotulo={<><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Criar esta peça</span></>}
          titulo="Peça da campanha"
          descricao="Criar esta peça pelo gerador do Estúdio, com a identidade da campanha"
          partes={() => [{ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida } as ParteDaEstimativa].concat(partesDasLaminas(p.laminas))}
          executar={async () => {
            try {
              await prepararPecaDaCampanha(corpoDaPeca({ clientId, campanha, item: p.item, posicao: { i: i + 1, total: deArte.length }, marcaId, modeloImagemId: imagem ? imagem.id : null }), marcaId);
            } finally {
              reler();
            }
            return { custo_usd: null };
          }}
          disabled={andando}
          variant="ghost"
          className="h-7 gap-0 px-1.5"
        />
      );
    }
    if ((p.estado === "a_gerar" || p.estado === "erro") && p.trabalho && p.faltam.length) {
      const trabalhoId = p.trabalho.id;
      return (
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
      );
    }
    if (p.trabalho && onAbrirArteRapida) {
      const id = p.trabalho.id;
      return (
        <button type="button" className={juntar(botao.icone, "h-7 w-7 text-primary")} onClick={() => onAbrirArteRapida(id)} aria-label="Abrir no Estúdio" title="Abrir no Estúdio para ajustar">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      );
    }
    return null;
  };

  if (carregando) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  return (
    <div className="min-w-0 space-y-3" data-pecas-da-campanha="">
      <p className={texto.auxiliar}>Tudo pelo gerador do Estúdio; foto real só como referência.</p>
      <PecasPorFase pecas={pecas} acoes={acoes} vazio="A série ainda não tem conteúdos: gere a série na etapa anterior." />
    </div>
  );
}
