import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Circle, Loader2, Pause, Play, Square, Wand2, X } from "lucide-react";
import { padraoPara, type ModeloIa } from "@/lib/mesa/api";
import { juntar, texto, botao } from "@/components/sistema";
import { BotaoComCusto } from "./Custo";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import { chaves, lerCampanhas, lerProposta, type Campanha, type ItemProposto, type PropostaV4 } from "./mesaV4Api";
import {
  cancelarFilaDasPecas,
  chavesDaCampanhaCompleta,
  gerarLaminasDaPeca,
  gerarSeloDaCampanha,
  gerarStoryDaCampanha,
  modeloDoSelo,
  normalizarBriefing,
  padraoDaCampanha,
  lerFilaDosTrabalhos,
  lerTrabalhosDaCampanha,
  prepararPecaDaCampanha,
} from "./campanhasApi";
import {
  corpoDaPeca,
  ehPecaDeArte,
  partesDosPassos,
  passosQueFaltam,
  resumoDosPassos,
  faseDaPeca,
  situacaoDaPeca,
  storiesComoItens,
  trabalhoDaPeca,
  type PassoDaCampanha,
  type SituacaoDaPeca,
} from "./regrasDaCampanha";
import { resumoDoPadraoParaAPeca } from "../../../supabase/functions/_shared/padrao-da-campanha";
import { cancelar, continuar, emAndamento, esquecer, executarCampanha, pausar, useExecucao, type DepsDaExecucao, type Execucao } from "./execucaoDaCampanha";

/**
 * Campanha completa na tela (21/10/2026): as peças da série lidas do servidor, o botão "Gerar campanha
 * completa" com o custo TOTAL antes (estimativa e confirmar, BotaoComCusto) e o andamento por etapa e por
 * peça, com pausar, continuar e cancelar. As regras ficam em regrasDaCampanha.ts e execucaoDaCampanha.ts.
 */

const ordenarPorData = (itens: ItemProposto[]) => itens.slice().sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));

/** As peças da campanha (conteúdo + trabalho do Estúdio + fila do gerador), relidas enquanto algo anda. */
export function usePecasDaCampanha(campanha: Campanha, proposta: PropostaV4 | null | undefined) {
  const { clientId } = useMesa();
  const execucao = useExecucao(campanha.id);
  // Enquanto o gerador trabalha (ou a campanha completa anda), relê a cada 5 s: as lâminas aparecem conforme ficam prontas.
  const [vivo, setVivo] = useState(false);
  const trabalhos = useQuery({
    queryKey: chavesDaCampanhaCompleta.pecas(clientId, campanha.id),
    queryFn: () => lerTrabalhosDaCampanha(clientId, campanha.id),
    staleTime: 10_000,
    refetchInterval: vivo ? 5_000 : false,
    // 22/10/2026: voltar do Estúdio (remonta a aba) ou focar a janela relê: a arte gerada lá aparece aqui.
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const ids = (trabalhos.data || []).map((t) => t.id);
  const fila = useQuery({
    queryKey: chavesDaCampanhaCompleta.fila(campanha.id, ids),
    enabled: ids.length > 0,
    queryFn: () => lerFilaDosTrabalhos(ids),
    staleTime: 5_000,
    refetchInterval: vivo ? 5_000 : false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const pecas: SituacaoDaPeca[] = useMemo(() => {
    // A série inteira: os conteúdos da proposta e os stories planejados (formato "story").
    const itens = ordenarPorData(((proposta && proposta.itens) || []).concat(storiesComoItens(campanha)));
    // 22/10/2026: as peças que o agente mudou (arte antiga arquivada) aparecem como "a refazer".
    const refazer = normalizarBriefing(campanha.briefing).refazer || [];
    return itens.map((it) => situacaoDaPeca(campanha, it, trabalhoDaPeca(trabalhos.data || [], it), fila.data || [], refazer));
  }, [campanha, proposta, trabalhos.data, fila.data]);
  const agoraVivo = emAndamento(execucao) || pecas.some((p) => p.estado === "gerando");
  useEffect(() => {
    setVivo(agoraVivo);
  }, [agoraVivo]);
  return { pecas, carregando: trabalhos.isLoading, erro: trabalhos.isError ? trabalhos.error : null, execucao, recarregar: () => void trabalhos.refetch() };
}

/** As ações de verdade de cada passo (campanha, selo, peça), com a marca e o modelo de imagem da Mesa. */
export function depsDaCampanha(a: {
  qc: QueryClient;
  clientId: string;
  catalogo: ModeloIa[];
  marcaId: string | null;
  criarCampanha?: () => Promise<{ campanha: Campanha; proposta: PropostaV4 | null }>;
}): DepsDaExecucao {
  const imagem = padraoPara(a.catalogo, "imagem");
  const campanhaAtual = async (id: string): Promise<Campanha> => {
    const lista = await a.qc.fetchQuery({ queryKey: chaves.campanhas(a.clientId), queryFn: () => lerCampanhas(a.clientId), staleTime: 0 });
    const c = (lista || []).filter((x) => x.id === id)[0];
    if (!c) throw new Error("Campanha não encontrada.");
    return c;
  };
  const itensDe = async (c: Campanha): Promise<ItemProposto[]> => {
    if (!c.proposta_id) return [];
    const p = await a.qc.fetchQuery({ queryKey: chaves.proposta(c.proposta_id), queryFn: () => lerProposta(c.proposta_id as string), staleTime: 60_000 });
    return ordenarPorData((p && p.itens) || []);
  };
  const reler = (campanhaId: string) => {
    void a.qc.invalidateQueries({ queryKey: ["mesa", "campanha-pecas", a.clientId, campanhaId] });
    void a.qc.invalidateQueries({ queryKey: ["mesa", "campanha-pecas-fila", campanhaId] });
  };
  return {
    criarCampanha: async () => {
      if (!a.criarCampanha) throw new Error("Sem campanha para criar.");
      const r = await a.criarCampanha();
      const itens = ordenarPorData(((r.proposta && r.proposta.itens) || []).concat(storiesComoItens(r.campanha)));
      const pecas = itens.map((it) => situacaoDaPeca(r.campanha, it, null));
      const passos = passosQueFaltam({ temCampanha: true, temSelo: !!r.campanha.selo_path, pecas });
      return { campanhaId: r.campanha.id, passos };
    },
    gerarSelo: async (campanhaId) => {
      const c = await campanhaAtual(campanhaId);
      if (c.selo_path) return;
      // O selo no GPT Image 2.5 do catálogo (MODELOS_DO_SELO), seguindo o padrão visual da campanha.
      await gerarSeloDaCampanha(c, modeloDoSelo(a.catalogo) || (imagem ? imagem.id : null));
      await a.qc.invalidateQueries({ queryKey: chaves.campanhas(a.clientId) });
    },
    prepararPeca: async (campanhaId, passo) => {
      const c = await campanhaAtual(campanhaId);
      const itens = (await itensDe(c)).filter(ehPecaDeArte);
      const i = itens.map((x) => x.tema_id).indexOf(passo.temaId);
      if (i < 0) throw new Error("O conteúdo desta peça não está mais na série.");
      const marca = (c.identidade && c.identidade.marca_id) || a.marcaId;
      try {
        await prepararPecaDaCampanha(
          corpoDaPeca({ clientId: a.clientId, campanha: c, item: itens[i], posicao: { i: i + 1, total: itens.length }, marcaId: marca || null, modeloImagemId: imagem ? imagem.id : null }),
          marca || null,
        );
      } finally {
        reler(campanhaId);
      }
    },
    gerarPeca: async (campanhaId, passo) => {
      if (!passo.trabalhoId || !passo.ordens || !passo.ordens.length) return;
      const c = await campanhaAtual(campanhaId);
      try {
        await gerarLaminasDaPeca(passo.trabalhoId, passo.ordens, (c.identidade && c.identidade.marca_id) || a.marcaId);
      } finally {
        reler(campanhaId);
      }
    },
    gerarStory: async (campanhaId, passo) => {
      const c = await campanhaAtual(campanhaId);
      const item = storiesComoItens(c).filter((x) => x.tema_id === passo.temaId)[0];
      if (!item) throw new Error("Este story não está mais na campanha.");
      await gerarStoryDaCampanha(c, {
        clientId: a.clientId,
        campanhaId,
        temaId: passo.temaId || "",
        briefing: normalizarBriefing(c.briefing),
        identidade: c.identidade,
        fase: faseDaPeca(item, c.periodo_inicio, c.periodo_fim),
        quantidadeDeTelas: passo.laminas || 3,
        data: item.data || null,
        pedido: [item.tema, item.gancho].concat((item.cards || []).map((c) => c.texto || "")).filter(Boolean).join(" / ") + (padraoDaCampanha(c) ? `
${resumoDoPadraoParaAPeca(padraoDaCampanha(c))}` : ""),
        marcaId: (c.identidade && c.identidade.marca_id) || a.marcaId,
      });
      await a.qc.invalidateQueries({ queryKey: chaves.campanhas(a.clientId) });
    },
    aoCancelar: async (campanhaId) => {
      if (!campanhaId) return;
      const trabalhos = await lerTrabalhosDaCampanha(a.clientId, campanhaId).catch(() => []);
      const fila = await lerFilaDosTrabalhos(trabalhos.map((t) => t.id));
      const naFila = fila.filter((f) => f.status === "fila").map((f) => f.trabalho_id);
      await cancelarFilaDasPecas(naFila.filter((id, k) => naFila.indexOf(id) === k));
      reler(campanhaId);
    },
  };
}

const ICONE_DO_PASSO = {
  fila: <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />,
  rodando: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />,
  feito: <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />,
  erro: <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />,
  pulado: <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />,
};

const ROTULO_DA_SITUACAO: Record<Execucao["situacao"], string> = {
  rodando: "Gerando a campanha completa",
  pausada: "Pausada",
  cancelada: "Cancelada",
  concluida: "Campanha completa pedida",
  falhou: "Não deu para criar a campanha",
};

/** Andamento: por etapa (campanha, selo, peças) e por peça, com pausar, continuar, cancelar. */
export function ProgressoDaCampanha({ execucao }: { execucao: Execucao }) {
  const pecas = execucao.passos.filter((p) => p.tipo === "preparar" || p.tipo === "gerar" || p.tipo === "story");
  const feitas = pecas.filter((p) => p.situacao === "feito").length;
  const erros = execucao.passos.filter((p) => p.situacao === "erro").length;
  const andando = emAndamento(execucao);
  return (
    <section className="min-w-0 border-b border-border pb-3" aria-label="Andamento da campanha completa" data-execucao={execucao.situacao}>
      <div className="flex min-w-0 items-center">
        {execucao.situacao === "rodando" ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" /> : <Wand2 className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {ROTULO_DA_SITUACAO[execucao.situacao]}
          <span className="ml-1.5 font-normal text-muted-foreground">
            {pecas.length ? `${feitas} de ${pecas.length} peças` : ""}
            {erros ? ` · ${erros} com erro` : ""}
          </span>
        </p>
        {execucao.situacao === "rodando" && (
          <button type="button" className={botao.icone} onClick={() => pausar(execucao.chave)} aria-label="Pausar" title="Pausar depois do passo em curso">
            <Pause className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {execucao.situacao === "pausada" && (
          <button type="button" className={juntar(botao.icone, "text-primary")} onClick={() => continuar(execucao.chave)} aria-label="Continuar" title="Continuar">
            <Play className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {andando ? (
          <button type="button" className={botao.icone} onClick={() => cancelar(execucao.chave)} aria-label="Cancelar" title="Cancelar: o que já foi feito fica salvo">
            <Square className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={botao.icone} onClick={() => esquecer(execucao.chave)} aria-label="Fechar o andamento" title="Fechar o andamento">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {execucao.erro && <p className="mt-1 text-[12px] text-destructive">{execucao.erro}</p>}
      <ol className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="Passos">
        {execucao.passos.map((p) => (
          <li key={p.id} className="flex min-w-0 items-center text-[12px]" data-passo={p.situacao}>
            <span className="mr-1.5 shrink-0">{ICONE_DO_PASSO[p.situacao]}</span>
            <span className={juntar("min-w-0 truncate", p.situacao === "feito" || p.situacao === "pulado" ? "text-muted-foreground" : "")} title={p.erro || p.rotulo}>
              {p.tipo === "preparar" ? "Peça: " : p.tipo === "gerar" ? "Gerar: " : p.tipo === "story" ? "Stories: " : ""}
              {p.rotulo}
            </span>
          </li>
        ))}
      </ol>
      {erros > 0 && !andando && <p className={juntar(texto.auxiliar, "mt-1.5")}>As que falharam ficam na lista: gere de novo só elas.</p>}
    </section>
  );
}

/** Botão "Gerar campanha completa" de uma campanha já criada: o que falta, o custo total antes e o andamento. */
export function GerarCampanhaCompleta({ campanha, pecas, carregando }: { campanha: Campanha; pecas: SituacaoDaPeca[]; carregando?: boolean }) {
  const { clientId, catalogo } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const execucao = useExecucao(campanha.id);
  const passos: PassoDaCampanha[] = useMemo(
    () => (carregando ? [] : passosQueFaltam({ temCampanha: true, temSelo: !!campanha.selo_path, pecas })),
    [carregando, campanha.selo_path, pecas],
  );
  const imagem = padraoPara(catalogo, "imagem");
  const iniciar = async () => {
    void executarCampanha(campanha.id, campanha.id, passos, depsDaCampanha({ qc, clientId, catalogo, marcaId: marca ? marca.id : null }));
    return { custo_usd: 0 };
  };
  if (execucao && (emAndamento(execucao) || execucao.situacao !== "concluida" || passos.length === 0)) {
    return <ProgressoDaCampanha execucao={execucao} />;
  }
  if (!passos.length || !pecas.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center border-b border-border pb-3" data-gerar-completa="">
      <p className="mb-1 mr-3 min-w-0 flex-1 text-[12px] text-muted-foreground">
        Falta: {resumoDosPassos(passos)}
      </p>
      <BotaoComCusto
        rotulo={<><Wand2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Gerar campanha completa</span></>}
        titulo="Campanha completa"
        descricao={`Gerar campanha completa: ${resumoDosPassos(passos)}, tudo pelo gerador do Estúdio. Custo total estimado ao lado; confirme no segundo clique.`}
        partes={() => partesDosPassos(passos, catalogo, { modeloImagemId: imagem ? imagem.id : null })}
        executar={iniciar}
        fecharAoConfirmar
        sempreConfirmar
        className="mb-1 h-8 gap-0 px-2.5"
      />
    </div>
  );
}
