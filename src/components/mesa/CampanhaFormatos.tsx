import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { partesDosConteudosDaCampanha } from "./CampanhaConteudos";
import { aplicarRespostaDaCampanha, campanhaConteudos, campanhaSalvar, normalizarBriefing, trocarCampanhaNoCache } from "./campanhasApi";
import { chaves, type Campanha } from "./mesaV4Api";
import { Clapperboard, ListPlus, GalleryHorizontal, Image as IconeDeImagem, Minus, Plus, RotateCcw, Smartphone } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema";
import { periodoCurto } from "./mesaV4Api";
import {
  FASES,
  FORMATOS_DA_CAMPANHA,
  formatosQueFaltam,
  MAX_NA_SERIE,
  MAX_POR_FORMATO,
  normalizarFormatos,
  sugerirFormatos,
  totalNaSerie,
  type ChaveDoFormato,
  type FormatosDaCampanha,
} from "./regrasDaCampanha";
import { diasEntreIso, somarDiasIso } from "./mesaV4Api";
import { dataBr } from "../../../supabase/functions/_shared/agenda-inteligente";

/**
 * Formatos da campanha (21/10/2026, dono: "escolher vídeos, posts, carrosséis e stories: eu escolho ali"):
 * quatro cartões com ícone e a quantidade, a sugestão pela duração (o dono ajusta) e a prévia da campanha
 * montando (fases com as datas e quantos de cada formato caem em cada uma).
 */

export const ICONE_DO_FORMATO: Record<ChaveDoFormato, ReactNode> = {
  posts: <IconeDeImagem className="h-5 w-5" aria-hidden="true" />,
  carrosseis: <GalleryHorizontal className="h-5 w-5" aria-hidden="true" />,
  stories: <Smartphone className="h-5 w-5" aria-hidden="true" />,
  videos: <Clapperboard className="h-5 w-5" aria-hidden="true" />,
};

const iguais = (a: FormatosDaCampanha, b: FormatosDaCampanha) => a.posts === b.posts && a.carrosseis === b.carrosseis && a.stories === b.stories && a.videos === b.videos;

export const vazio = (): FormatosDaCampanha => ({ posts: 0, carrosseis: 0, stories: 0, videos: 0 });

export function SeletorDeFormatos({
  valor,
  onChange,
  dias,
  desabilitado,
  atual,
}: {
  valor: FormatosDaCampanha;
  onChange: (f: FormatosDaCampanha) => void;
  /** Duração da campanha (para a sugestão). */
  dias: number;
  desabilitado?: boolean;
  /** O que a série já tem (campanha aberta): mostra "2 de 3". */
  atual?: FormatosDaCampanha | null;
}) {
  const sugestao = sugerirFormatos(Math.max(1, dias));
  const naSerie = totalNaSerie(valor);
  const mudar = (k: ChaveDoFormato, delta: number) => {
    const novo = { ...valor, [k]: Math.max(0, Math.min(MAX_POR_FORMATO, valor[k] + delta)) };
    onChange(normalizarFormatos(novo) || vazio());
  };
  return (
    <div className="min-w-0" data-seletor-de-formatos="">
      <ul className="grid min-w-0 grid-cols-2 gap-2.5" aria-label="Formatos da campanha">
        {FORMATOS_DA_CAMPANHA.map((f) => {
          const n = valor[f.chave];
          const cheio = n >= MAX_POR_FORMATO || (f.chave !== "stories" && naSerie >= MAX_NA_SERIE);
          return (
            <li
              key={f.chave}
              className={juntar("flex min-w-0 flex-col rounded-md p-3 transition-colors", n ? "bg-primary/[0.08] ring-1 ring-primary/40" : "bg-muted/50")}
              data-formato={f.chave}
            >
              <div className="flex min-w-0 items-center">
                <span className={juntar("mr-2 shrink-0", n ? "text-primary" : "text-muted-foreground")}>{ICONE_DO_FORMATO[f.chave]}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{f.rotulo}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{f.dica}</span>
                </span>
              </div>
              <div className="mt-2.5 flex min-w-0 items-center">
                <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => mudar(f.chave, -1)} disabled={desabilitado || n === 0} aria-label={`Menos ${f.rotulo.toLowerCase()}`} title={`Menos ${f.rotulo.toLowerCase()}`}>
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="mx-1 w-7 text-center text-[20px] font-semibold tabular-nums" aria-live="polite" aria-label={`${n} ${f.rotulo.toLowerCase()}`}>{n}</span>
                <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => mudar(f.chave, 1)} disabled={desabilitado || cheio} aria-label={`Mais ${f.rotulo.toLowerCase()}`} title={`Mais ${f.rotulo.toLowerCase()}`}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
                {atual && <span className="ml-auto truncate pl-1 text-[11px] text-muted-foreground">{atual[f.chave]} na série</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex min-w-0 items-center">
        <p className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>
          {naSerie + valor.stories} {naSerie + valor.stories === 1 ? "peça" : "peças"}
          {iguais(valor, sugestao) ? " · sugestão para " + dias + " dias" : ""}
        </p>
        {!iguais(valor, sugestao) && (
          <button type="button" className={botao.icone} onClick={() => onChange(sugestao)} disabled={desabilitado} aria-label="Usar a sugestão" title={`Usar a sugestão para ${dias} dias`}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Quantas peças de cada formato caem em cada fase (aquecimento 25%, lançamento 35%, urgência 25%, encerramento 15%). */
export function distribuirPorFase(f: FormatosDaCampanha): Record<string, FormatosDaCampanha> {
  const pesos = [0.25, 0.35, 0.25, 0.15];
  const saida: Record<string, FormatosDaCampanha> = {};
  FASES.forEach((fase) => { saida[fase.valor] = vazio(); });
  (Object.keys(f) as ChaveDoFormato[]).forEach((k) => {
    let resto = f[k];
    // Maior resto primeiro: cada fase ganha a parte inteira e o que sobra vai para as fases de maior peso.
    const partes = pesos.map((p) => f[k] * p);
    const inteiros = partes.map((x) => Math.floor(x));
    inteiros.forEach((x, i) => { saida[FASES[i].valor][k] = x; resto -= x; });
    const ordem = partes.map((x, i) => ({ i, sobra: x - Math.floor(x) })).sort((a, b) => b.sobra - a.sobra || pesos[b.i] - pesos[a.i]);
    for (let j = 0; resto > 0; j = (j + 1) % ordem.length, resto--) saida[FASES[ordem[j].i].valor][k] += 1;
  });
  return saida;
}

/** As datas de cada fase pela janela da campanha (as mesmas proporções da fase de cada peça). */
export function janelasDasFases(inicio: string, fim: string): Record<string, { de: string; ate: string }> {
  const total = Math.max(1, diasEntreIso(inicio, fim));
  const cortes = [0, 0.25, 0.6, 0.85, 1];
  const saida: Record<string, { de: string; ate: string }> = {};
  FASES.forEach((f, i) => {
    const de = somarDiasIso(inicio, Math.round(total * cortes[i]));
    const ate = i === FASES.length - 1 ? fim : somarDiasIso(inicio, Math.max(Math.round(total * cortes[i]), Math.round(total * cortes[i + 1]) - 1));
    saida[f.valor] = { de, ate };
  });
  return saida;
}

/** Prévia da campanha montando: nome, período, total e as fases com datas e formatos. */
export function PreviaDaCampanha({ nome, inicio, fim, formatos, className = "" }: { nome: string; inicio: string; fim: string; formatos: FormatosDaCampanha; className?: string }) {
  const valido = !!inicio && !!fim && fim >= inicio;
  const porFase = distribuirPorFase(formatos);
  const janelas = valido ? janelasDasFases(inicio, fim) : null;
  const total = totalNaSerie(formatos) + formatos.stories;
  return (
    <section className={juntar("min-w-0", className)} aria-label="Prévia da campanha" data-previa-da-campanha="">
      <p className={texto.rotulo}>Prévia</p>
      <p className="mt-1 truncate text-[15px] font-semibold" title={nome || "Campanha"}>{nome.trim() || "Sua campanha"}</p>
      <p className={juntar(texto.auxiliar, "mt-0.5")}>{valido ? periodoCurto(inicio, fim) : "sem período"} · {total} {total === 1 ? "peça" : "peças"}</p>
      <ol className="mt-3 space-y-2.5" aria-label="Fases da campanha">
        {FASES.map((f) => {
          const n = porFase[f.valor];
          const itens = FORMATOS_DA_CAMPANHA.filter((x) => n[x.chave] > 0);
          return (
            <li key={f.valor} className="flex min-w-0 items-start" data-fase-previa={f.valor}>
              <span className="mr-2.5 mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline text-[13px] font-medium">
                  <span className="truncate">{f.rotulo}</span>
                  {janelas && <span className="ml-1.5 shrink-0 text-[11px] font-normal text-muted-foreground">{dataBr(janelas[f.valor].de)}</span>}
                </p>
                <p className="mt-0.5 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
                  {itens.length ? itens.map((x) => (
                    <span key={x.chave} className="mr-2.5 inline-flex items-center" title={x.rotulo}>
                      <span className="mr-1 inline-flex [&>svg]:h-3.5 [&>svg]:w-3.5">{ICONE_DO_FORMATO[x.chave]}</span>
                      {n[x.chave]}
                    </span>
                  )) : "nada ainda"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A mistura na campanha aberta (etapa Ideia): o planejado (editável, sem custo) contra o que a série tem, e
 * "Gerar o que falta" de posts, carrosséis e vídeos pelo agente da campanha (campanha_conteudos, custo antes).
 * Stories que faltam saem ao refazer a série pelo agente (a sequência de cada story nasce na criação).
 */
export function FormatosDaCampanhaAberta({ campanha, atual }: { campanha: Campanha; atual: FormatosDaCampanha }) {
  const { clientId, catalogo } = useMesa();
  const qc = useQueryClient();
  const b = normalizarBriefing(campanha.briefing);
  const dias = campanha.periodo_inicio && campanha.periodo_fim ? diasEntreIso(campanha.periodo_inicio, campanha.periodo_fim) : 14;
  const planejado = normalizarFormatos(b.formatos) || atual;
  const [salvando, setSalvando] = useState(false);
  const falta = formatosQueFaltam(planejado, atual);
  const faltaNaSerie = falta.posts + falta.carrosseis + falta.videos;

  const salvar = async (f: FormatosDaCampanha) => {
    setSalvando(true);
    trocarCampanhaNoCache(qc, clientId, { ...campanha, briefing: { ...b, formatos: f } });
    try {
      const r = await campanhaSalvar({ campanhaId: campanha.id, briefing: { ...b, formatos: f } });
      if (r && r.campanha) trocarCampanhaNoCache(qc, clientId, r.campanha);
    } catch (e) {
      toast.error("Formatos não salvos", { description: textoDoErro(e) });
      void qc.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    } finally {
      setSalvando(false);
    }
  };

  const gerarFaltam = async () => {
    let custo = 0;
    const pedidos: { formato: "estatico" | "carrossel" | "video"; n: number }[] = [
      { formato: "estatico", n: falta.posts },
      { formato: "carrossel", n: falta.carrosseis },
      { formato: "video", n: falta.videos },
    ];
    for (const p of pedidos) {
      if (!p.n) continue;
      const d = await campanhaConteudos({ campanhaId: campanha.id, quantidade: p.n, formato: p.formato });
      custo += Number(d && d.custo_usd) || 0;
      aplicarRespostaDaCampanha(qc, clientId, d);
    }
    return { custo_usd: custo };
  };

  return (
    <div className="min-w-0" data-formatos-da-campanha="">
      <SeletorDeFormatos valor={planejado} onChange={(f) => void salvar(f)} dias={Math.max(1, dias)} desabilitado={salvando} atual={atual} />
      {faltaNaSerie > 0 && (
        <div className="mt-2 flex min-w-0 items-center">
          <p className={juntar(texto.auxiliar, "min-w-0 flex-1")}>Falta na série: {faltaNaSerie} {faltaNaSerie === 1 ? "conteúdo" : "conteúdos"}</p>
          <BotaoComCusto
            rotulo={<><ListPlus className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Gerar o que falta na série</span></>}
            titulo="Conteúdos da campanha"
            descricao="Gerar o que falta na série, nos formatos escolhidos"
            partes={() => partesDosConteudosDaCampanha(catalogo, faltaNaSerie)}
            executar={gerarFaltam}
            variant="ghost"
            className="h-8 gap-0 px-2"
          />
        </div>
      )}
      {falta.stories > 0 && <p className={juntar(texto.auxiliar, "mt-1")}>Stories novos: peça ao agente da campanha.</p>}
    </div>
  );
}
