import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import type { Campanha } from "./mesaV4Api";
import { linhaDaCampanha } from "./CampanhaLinhaDoTempo";
import { porFase } from "./areasDaCampanha";
import { executarPasso, partesDoPasso } from "./passosDaCampanha";
import PreviaDoStory from "./stories/PreviaDoStory";
import { useMarcaDosStories } from "./stories/marcaDosStories";
import { baixarTodosOsStories } from "./stories/baixarStories";
import { imagemDoStory, lerStoriesDaCampanha, SITUACOES, useLaminasDosStories, type Sequencia, type Story } from "./stories/storiesApi";

/**
 * Stories da campanha (22/10/2026, dono: "a área de stories ali, que já leva pra área de story já com a tela,
 * sem sair da tela; só sai pra gerar e volta e já está ali"): as sequências por fase da linha do tempo, com as
 * telas em miniatura, o estado, o horário e o texto de cada tela. Criar a sequência da fase (custo antes),
 * Abrir nos Stories (direto na sequência e na tela) e Baixar (PNG ou zip). Ao voltar, relê sozinho.
 */

export const chaveDosStoriesDaCampanha = (clientId: string, campanhaId: string) => ["mesa", "campanha-stories", clientId, campanhaId];

const MINIATURA = 56;
const hora = (s: Story) => (s.horario ? s.horario.slice(11, 16) || s.horario.slice(0, 5) : "");

function SequenciaDaFase({ sequencia, stories, onAbrir }: { sequencia: Sequencia; stories: Story[]; onAbrir?: (sequenciaId: string, storyId?: string) => void }) {
  const { clientId } = useMesa();
  const marca = useMarcaDosStories(clientId);
  const laminas = useLaminasDosStories(clientId, stories.map((s) => String(s.fundo.trabalho_id || "")));
  const [baixando, setBaixando] = useState(false);
  const telas = stories.slice().sort((a, b) => a.ordem - b.ordem);
  const baixar = async () => {
    setBaixando(true);
    try {
      const r = await baixarTodosOsStories(telas, marca, { laminas: laminas.data, nome: sequencia.titulo });
      if (!r.baixadas) toast.error("Nenhuma tela pronta para baixar ainda.");
      else if (r.deFora.length) toast.warning(`${r.baixadas} baixada(s); fora: tela ${r.deFora.join(", ")}.`);
    } catch (e) {
      toast.error("Não baixou", { description: textoDoErro(e) });
    } finally {
      setBaixando(false);
    }
  };
  return (
    <div className="min-w-0" data-sequencia-da-campanha={sequencia.id}>
      <div className="flex min-w-0 items-center">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{sequencia.titulo || "Sequência"}</span>
          <span className="block text-[11px] text-muted-foreground">{sequencia.data.slice(8, 10)}/{sequencia.data.slice(5, 7)} · {telas.length} tela(s)</span>
        </span>
        <button type="button" className={botao.icone} onClick={() => void baixar()} disabled={baixando || !telas.length} aria-label={`Baixar ${sequencia.titulo || "a sequência"}`} title="Baixar as telas (PNG; várias vão num zip)">
          {baixando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        </button>
        {onAbrir && (
          <button type="button" className={juntar(botao.icone, "text-primary hover:text-primary")} onClick={() => onAbrir(sequencia.id)} aria-label={`Abrir ${sequencia.titulo || "a sequência"} nos Stories`} title="Abrir nos Stories (volta para cá depois)">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <ol className="mt-2 flex min-w-0 flex-wrap" aria-label={`Telas de ${sequencia.titulo || "a sequência"}`}>
        {telas.map((s, i) => (
          <li key={s.id} className="mb-2 mr-2 w-[88px] min-w-0" data-tela={s.id}>
            <button
              type="button"
              className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => onAbrir && onAbrir(sequencia.id, s.id)}
              disabled={!onAbrir}
              aria-label={`Abrir a tela ${i + 1} nos Stories`}
              title={s.texto_na_tela || `Tela ${i + 1}`}
            >
              <PreviaDoStory story={s} largura={MINIATURA} paleta={marca.paleta} familia={marca.familia} foto={marca.foto(s.fundo.imagem_id)} semSelo imagem={imagemDoStory(s, laminas.data)} />
            </button>
            <span className={juntar("mt-1 inline-block rounded-full px-1.5 py-0.5 text-[11px] font-medium", SITUACOES[s.situacao].tom)}>{SITUACOES[s.situacao].rotulo}</span>
            {hora(s) && <span className="ml-1 text-[11px] text-muted-foreground">{hora(s)}</span>}
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={s.texto_na_tela}>{s.texto_na_tela || "(sem texto)"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function CampanhaStories({ campanha, onAbrirStories }: { campanha: Campanha; onAbrirStories?: (sequenciaId: string, storyId?: string) => void }) {
  const { clientId, catalogo } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: chaveDosStoriesDaCampanha(clientId, campanha.id),
    queryFn: () => lerStoriesDaCampanha(clientId, campanha.id),
    // Volta dos Stories: a área monta de novo e relê na hora (e ao voltar para a aba do navegador).
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const linha = linhaDaCampanha(campanha);
  if (!linha) return <p className={texto.auxiliar}>Escolha o período da campanha para ver os stories por fase.</p>;
  if (q.isError) return <AvisoDeErro erro={q.error} />;
  const sequencias = q.data ? q.data.sequencias : [];
  const stories = q.data ? q.data.stories : [];
  const grupos = porFase(linha.fases, sequencias.map((s) => ({ ...s, etapa: s.campanha && s.campanha.fase ? s.campanha.fase : "" })));
  return (
    <div className="min-w-0 space-y-5" data-stories-da-campanha={q.isLoading ? "lendo" : String(sequencias.length)}>
      {q.isLoading && (
        <p className={texto.auxiliar}>
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Lendo os stories da campanha…
        </p>
      )}
      {grupos.map(({ fase, itens }) => (
        <section key={fase.fase} className="min-w-0" aria-label={`Stories: ${fase.nome}`} data-fase-dos-stories={fase.fase}>
          <div className="flex min-w-0 items-center">
            <h3 className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>
              {fase.nome} · {fase.inicio.slice(8, 10)}/{fase.inicio.slice(5, 7)}{fase.fim !== fase.inicio ? ` a ${fase.fim.slice(8, 10)}/${fase.fim.slice(5, 7)}` : ""}
            </h3>
            {!itens.length && !q.isLoading && (
              <BotaoComCusto
                rotulo={<><Smartphone className="h-4 w-4" aria-hidden="true" /><span className="ml-1">Criar a sequência desta fase</span></>}
                titulo={`Stories: ${fase.nome}`}
                descricao="Cria a sequência desta fase pela aba Stories, com a identidade da campanha (as telas e as imagens)"
                partes={() => partesDoPasso({ acao: "criar_stories_da_fase", alvo: fase.etapa }, catalogo)}
                executar={async () => {
                  const r = await executarPasso({ acao: "criar_stories_da_fase", alvo: fase.etapa }, { campanha, clientId, qc, marcaId: marca ? marca.id : null });
                  await q.refetch();
                  return r;
                }}
                variant="ghost"
                className="h-8 px-2"
              />
            )}
          </div>
          {itens.length ? (
            <div className="mt-2 space-y-3">
              {itens.map((s) => (
                <SequenciaDaFase key={s.id} sequencia={s} stories={stories.filter((x) => x.sequencia_id === s.id)} onAbrir={onAbrirStories} />
              ))}
            </div>
          ) : (
            !q.isLoading && <p className={juntar(texto.auxiliar, "mt-1")}>Sem sequência nesta fase ainda.</p>
          )}
        </section>
      ))}
    </div>
  );
}
