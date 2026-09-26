import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CloudOff, Loader2, Redo2, Scissors, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { useLargo } from "@/components/sistema/AreaDeTrabalho";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { comecarHistorico, desfazer, fazer, refazer, type Historico } from "@/lib/editor/historico";
import { acharClipe, aplicarOperacoes, assinaturaDoProjeto, ErroDaOperacao, fimDoClipe, trilhaPrincipal, type Operacao } from "@/lib/editor/operacoes";
import { criarSalvador, type EstadoDoSalvamento, type Salvador } from "@/lib/editor/autosave";
import { opsParaInserir, type ItemDaBiblioteca } from "@/lib/editor/biblioteca";
import { apelidosDoProjeto } from "@/lib/editor/apelidos";
import type { CenaDoRoteiro, PropostaDaSkill } from "@/lib/editor/skills";
import { noQuadro, tempoFino } from "@/lib/editor/tempo";
import ComparadorAntesDepois from "@/components/comparar/ComparadorAntesDepois";
import { criarRelogio, ehCampoDeTexto, useLarguraMinima, useTempo, useUrlsDasFontes, type Relogio } from "./apoio";
import Previa, { type ControleDaPrevia } from "./Previa";
import LinhaDoTempo from "./LinhaDoTempo";
import Inspector from "./Inspector";
import Biblioteca from "./Biblioteca";
import PainelDeSkills, { type ControleDePropostas } from "./PainelDeSkills";
import PainelDeGeracao, { type PedidoDeGeracao } from "./PainelDeGeracao";
import PainelTimestamp from "./PainelTimestamp";
import PainelDeReferencias from "./PainelDeReferencias";
import AgenteEditor from "./AgenteEditor";
import { publicarNaPonte, tirarDaPonte } from "./ponteDoAgente";

/**
 * Editor de vídeo da Mesa Edição (frente V-B). Carregado sob demanda (lazy)
 * pela AreaDoEditor, para não pesar o resto do painel.
 *
 * Um projeto (_shared/projeto-de-edicao.ts), uma porta de mudança
 * (operações puras em src/lib/editor), desfazer/refazer, salvamento
 * automático sem laço (projeto_salvar, um por vez, só quando muda). Mão, skill
 * e agente geram as mesmas operações. Computador e notebook: três colunas
 * (mídia/skills/gerar/timestamp/referências, prévia, ajustes/agente) e a linha
 * do tempo embaixo, cada região rolando sozinha. Celular: prévia e lista de
 * cortes, a página rola normal.
 *
 * Atalhos: espaço toca/pausa; J volta 1 s; K pausa; L toca (de novo: 2x);
 * S divide no cursor; Delete tira (Shift puxa o resto); Ctrl+Z desfaz;
 * Ctrl+Shift+Z ou Ctrl+Y refaz; setas andam 1 quadro (Shift: 1 s).
 */

type AbaEsquerda = "midia" | "skills" | "gerar" | "timestamp" | "referencias" | "ajustes";
type AbaDireita = "ajustes" | "agente";

const ABAS_ESQUERDA: { valor: AbaEsquerda; rotulo: string }[] = [
  { valor: "midia", rotulo: "Mídia" },
  { valor: "skills", rotulo: "Skills" },
  { valor: "gerar", rotulo: "Gerar" },
  { valor: "timestamp", rotulo: "Timestamp" },
  { valor: "referencias", rotulo: "Referências" },
];

/** Com o agente na lateral da mesa e a janela estreita, os Ajustes viram uma aba da esquerda. */
const ABAS_COM_AJUSTES: { valor: AbaEsquerda; rotulo: string }[] = ABAS_ESQUERDA.concat([{ valor: "ajustes", rotulo: "Ajustes" }]);
/** Janela a partir da qual os Ajustes ganham coluna própria mesmo com o agente na lateral. */
const LARGURA_TRES_COLUNAS = 1680;

const ROTULO_DO_SALVAMENTO: Record<EstadoDoSalvamento, string> = { salvo: "Salvo", pendente: "Salvando em instantes", salvando: "Salvando", erro: "Não salvou", conflito: "Mudou em outro lugar" };

/** Só quem precisa do cursor redesenha quando ele anda (a linha do tempo e a tela inteira não). */
function ComCursor({ relogio, passo, children }: { relogio: Relogio; passo: number; children: (t: number) => ReactNode }) {
  const t = useTempo(relogio, passo);
  return <>{children(t)}</>;
}

export interface PropsDoEditor {
  versaoId: string;
  projetoInicial: ProjetoDeEdicao;
  revisao: number;
  cenas?: CenaDoRoteiro[] | null;
  onConflito?: () => void;
  /**
   * Frente Q (26/09): o agente editor mora na lateral fixa da Mesa Edição
   * (ponteDoAgente.ts). O editor publica o projeto lá e não mostra a aba
   * "Agente" na coluna da direita.
   */
  agenteNaLateral?: boolean;
}

export default function EditorDeVideo({ versaoId, projetoInicial, revisao, cenas, onConflito, agenteNaLateral = false }: PropsDoEditor) {
  const { clientId } = useMesa();
  const largo = useLargo();
  const tresColunas = useLarguraMinima(LARGURA_TRES_COLUNAS);
  const ajustesNaEsquerda = agenteNaLateral && !tresColunas;
  const abasDaEsquerda = ajustesNaEsquerda ? ABAS_COM_AJUSTES : ABAS_ESQUERDA;
  const [h, setH] = useState<Historico>(() => comecarHistorico(projetoInicial));
  const projeto = h.presente.projeto;
  const relogio = useMemo(() => criarRelogio(0), []);
  const previa = useRef<ControleDaPrevia | null>(null);
  const [selecao, setSelecao] = useState<string[]>([]);
  const [px, setPx] = useEstadoDaTela<number>(`mesa-edicao:editor:zoom:${clientId}`, 40, { validar: (v) => typeof v === "number" && v > 0 });
  const [aba, setAba] = useEstadoDaTela<AbaEsquerda>(`mesa-edicao:editor:aba:${clientId}`, "midia", { validar: (v) => ABAS_COM_AJUSTES.some((a) => a.valor === v) });
  const [abaDireita, setAbaDireita] = useEstadoDaTela<AbaDireita>(`mesa-edicao:editor:lado:${clientId}`, "ajustes", { validar: (v) => v === "ajustes" || v === "agente" });
  const [geracao, setGeracao] = useState<PedidoDeGeracao>({ tipo: "angulo_gerar", clipe: null });
  const [extras, setExtras] = useState<ItemDaBiblioteca[]>([]);
  const [comparar, setComparar] = useState<{ antes: string; depois: string; rotulos: [string, string]; tipo: "imagem" | "video" } | null>(null);
  const [salvamento, setSalvamento] = useState<{ estado: EstadoDoSalvamento; detalhe: string | null }>({ estado: "salvo", detalhe: null });
  const urls = useUrlsDasFontes(projeto, extras);
  const aplicadas = useRef<Map<PropostaDaSkill, ProjetoDeEdicao>>(new Map());

  // ---------------------------------------------------------------- salvar sozinho
  const salvador = useRef<Salvador | null>(null);
  if (!salvador.current) {
    salvador.current = criarSalvador({
      projetoInicial,
      revisaoInicial: revisao,
      esperaMs: 1500,
      salvar: async (p, lida) => {
        const r = await chamarMesaVideos({ acao: "projeto_salvar", versao_id: versaoId, projeto: p, revisao_lida: lida });
        const nova = r && r.versao && r.versao.projeto ? Number((r.versao.projeto as { revisao?: unknown }).revisao) : lida + 1;
        return { revisao: isFinite(nova) ? nova : lida + 1 };
      },
      ehConflito: (e) => !!e && typeof e === "object" && ["projeto_mudou", "versao_travada"].indexOf(String((e as { codigo?: unknown }).codigo)) >= 0,
      textoDoErro: (e) => textoDoErro(e),
      aoMudar: (estado, detalhe) => setSalvamento({ estado, detalhe }),
    });
  }
  useEffect(() => {
    if (salvador.current) salvador.current.mudou(projeto);
  }, [projeto]);
  useEffect(
    () => () => {
      const s = salvador.current;
      if (s) void s.agora().finally(() => s.parar());
    },
    [],
  );

  // ---------------------------------------------------------------- mudanças
  const aplicarOps = useCallback((ops: Operacao[], rotulo: string) => {
    setH((atual) => {
      try {
        return fazer(atual, aplicarOperacoes(atual.presente.projeto, ops), rotulo);
      } catch (e) {
        if (e instanceof ErroDaOperacao) window.setTimeout(() => toast.error(e.message), 0);
        else window.setTimeout(() => toast.error(e instanceof Error ? e.message : "Não deu."), 0);
        return atual;
      }
    });
  }, []);
  const aplicarProjeto = useCallback((p: ProjetoDeEdicao, rotulo: string) => setH((atual) => fazer(atual, p, rotulo)), []);

  const controle: ControleDePropostas = {
    aplicar: (prop, rotulo) => {
      const atual = h.presente.projeto;
      let novo: ProjetoDeEdicao;
      if (!prop.base || prop.base === assinaturaDoProjeto(atual)) novo = prop.resultado;
      else {
        try {
          novo = aplicarOperacoes(atual, prop.operacoes);
        } catch {
          return false;
        }
      }
      aplicadas.current.set(prop, novo);
      setH(fazer(h, novo, rotulo));
      return true;
    },
    desfazer: (prop) => {
      const feito = aplicadas.current.get(prop);
      if (!feito || h.presente.projeto !== feito) {
        toast.error("Mudou depois de aplicar.", { description: "Use Ctrl+Z para voltar passo a passo." });
        return false;
      }
      setH(desfazer(h));
      return true;
    },
  };

  // Agente na lateral da mesa: publica o projeto e o jeito de aplicar a cada mudança.
  useEffect(() => {
    if (!agenteNaLateral) return;
    publicarNaPonte({ clientId, versaoId, projeto, controle, aplicarProjeto, urls });
  });
  useEffect(() => (agenteNaLateral ? () => tirarDaPonte(versaoId) : undefined), [agenteNaLateral, versaoId]);

  const principal = trilhaPrincipal(projeto);
  const dividirNoCursor = () => {
    const t = relogio.get();
    const alvos = selecao.length ? selecao : principal ? principal.clipes.filter((c) => c.inicio_s < t && fimDoClipe(c) > t).map((c) => c.id) : [];
    const ops: Operacao[] = alvos.filter((id) => {
      const a = acharClipe(projeto, id);
      return a && a.clipe.inicio_s < t && fimDoClipe(a.clipe) > t;
    }).map((id) => ({ op: "dividir", clipe: id, em_s: noQuadro(t, projeto.fps) }));
    if (!ops.length) return toast.info("Ponha o cursor dentro de um clipe para dividir.");
    aplicarOps(ops, "Dividir");
  };
  const remover = (ondular: boolean) => {
    if (!selecao.length) return;
    aplicarOps(selecao.map((id) => ({ op: "remover", clipe: id, ondular })), ondular ? "Tirar e puxar" : "Tirar");
    setSelecao([]);
  };

  // ---------------------------------------------------------------- atalhos
  const taxa = useRef(1);
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (ehCampoDeTexto(e.target) || e.altKey) return;
      const p = previa.current;
      const k = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (k === "z" || k === "Z")) {
        e.preventDefault();
        setH((x) => (e.shiftKey ? refazer(x) : desfazer(x)));
        return;
      }
      if (ctrl && (k === "y" || k === "Y")) {
        e.preventDefault();
        setH((x) => refazer(x));
        return;
      }
      if (ctrl) return;
      const q = 1 / projeto.fps;
      if (k === " ") {
        e.preventDefault();
        if (p) p.tocarOuPausar();
      } else if (k === "k" || k === "K") {
        if (p) p.pausar();
        taxa.current = 1;
      } else if (k === "l" || k === "L") {
        if (!p) return;
        if (p.tocando()) {
          taxa.current = Math.min(4, taxa.current * 2);
          p.velocidade(taxa.current);
        } else {
          taxa.current = 1;
          p.velocidade(1);
          p.tocar();
        }
      } else if (k === "j" || k === "J") {
        if (p) p.pausar();
        relogio.set(Math.max(0, relogio.get() - 1));
      } else if (k === "s" || k === "S") {
        e.preventDefault();
        dividirNoCursor();
      } else if (k === "Delete" || k === "Backspace") {
        if (!selecao.length) return;
        e.preventDefault();
        remover(e.shiftKey);
      } else if (k === "ArrowLeft" || k === "ArrowRight") {
        e.preventDefault();
        const passo = e.shiftKey ? 1 : q;
        relogio.set(noQuadro(Math.max(0, Math.min(projeto.duracao_s, relogio.get() + (k === "ArrowLeft" ? -passo : passo))), projeto.fps));
      } else if (k === "Home") relogio.set(0);
      else if (k === "End") relogio.set(projeto.duracao_s);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  // ---------------------------------------------------------------- mídia e geração
  const inserir = (item: ItemDaBiblioteca, onde: "fim" | "cursor" | { depoisDe: string }, origem?: Parameters<typeof opsParaInserir>[4]) => {
    try {
      aplicarOps(opsParaInserir(projeto, item, onde, relogio.get(), origem), `Pôr ${item.nome}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para pôr na linha do tempo.");
    }
  };
  const abrirGeracao = (g: PedidoDeGeracao) => {
    setGeracao(g);
    setAba("gerar");
  };
  const virarClipe = (item: ItemDaBiblioteca) => {
    setExtras((l) => (l.some((x) => x.storage_path === item.storage_path) ? l : l.concat([item])));
    abrirGeracao({ tipo: "gerar_cena", item });
  };
  const abrirComparar = () => {
    const ids = selecao.slice(0, 2);
    const clipes = ids.map((id) => acharClipe(projeto, id)).filter(Boolean) as NonNullable<ReturnType<typeof acharClipe>>[];
    const um = clipes.length === 1 && clipes[0].clipe.comparar ? clipes[0].clipe : null;
    const chaveA = um ? um.fonte : clipes[0] && clipes[0].clipe.fonte;
    const chaveB = um && um.comparar ? um.comparar.fonte_b : clipes[1] && clipes[1].clipe.fonte;
    if (!chaveA || !chaveB || !urls[chaveA] || !urls[chaveB]) return toast.info("Escolha dois clipes com mídia (Ctrl + clique).");
    const imagem = projeto.fontes[chaveA].midia === "imagem" && projeto.fontes[chaveB].midia === "imagem";
    setComparar({ antes: urls[chaveA], depois: urls[chaveB], rotulos: [projeto.fontes[chaveA].nome, projeto.fontes[chaveB].nome], tipo: imagem ? "imagem" : "video" });
  };

  const apelidos = useMemo(() => apelidosDoProjeto(projeto), [projeto]);
  const contextoDaSkill = { agora: new Date().toISOString(), cenas: cenas || null, selecionados: selecao };

  // ---------------------------------------------------------------- partes da tela
  const barra = (
    <div className="flex min-w-0 items-center" data-barra-do-editor="">
      <button type="button" className={botao.icone} onClick={() => setH(desfazer(h))} disabled={!h.passado.length} aria-label={h.passado.length ? `Desfazer: ${h.presente.rotulo}` : "Nada para desfazer"} title="Ctrl+Z">
        <Undo2 className="h-4 w-4" />
      </button>
      <button type="button" className={botao.icone} onClick={() => setH(refazer(h))} disabled={!h.futuro.length} aria-label="Refazer" title="Ctrl+Shift+Z">
        <Redo2 className="h-4 w-4" />
      </button>
      <button type="button" className={juntar(botao.icone, "ml-1")} onClick={dividirNoCursor} aria-label="Dividir no cursor (S)" title="S">
        <Scissors className="h-4 w-4" />
      </button>
      <button type="button" className={botao.icone} onClick={() => remover(false)} disabled={!selecao.length} aria-label="Tirar o escolhido (Delete)" title="Delete">
        <Trash2 className="h-4 w-4" />
      </button>
      <span className={juntar(texto.auxiliar, "ml-2 hidden truncate md:inline")}>{selecao.length ? `${selecao.map((id) => apelidos.porId[id]).join(", ")} escolhido` : ""}</span>
      <span className={juntar("ml-auto flex items-center text-[12px]", salvamento.estado === "erro" || salvamento.estado === "conflito" ? "text-destructive" : "text-muted-foreground")} data-salvamento={salvamento.estado} title={salvamento.detalhe || undefined}>
        {salvamento.estado === "salvo" && <Check className="mr-1 h-3.5 w-3.5" />}
        {(salvamento.estado === "salvando" || salvamento.estado === "pendente") && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
        {salvamento.estado === "erro" && <CloudOff className="mr-1 h-3.5 w-3.5" />}
        {salvamento.estado === "conflito" && <AlertTriangle className="mr-1 h-3.5 w-3.5" />}
        {ROTULO_DO_SALVAMENTO[salvamento.estado]}
        {salvamento.estado === "erro" && (
          <button type="button" className="ml-1.5 underline" onClick={() => salvador.current && salvador.current.tentarDeNovo()}>
            Tentar de novo
          </button>
        )}
        {salvamento.estado === "conflito" && onConflito && (
          <button type="button" className="ml-1.5 underline" onClick={onConflito}>
            Recarregar
          </button>
        )}
      </span>
    </div>
  );

  const inspector = (
    <ComCursor relogio={relogio} passo={0.25}>
      {(cursor) => (
        <Inspector
          projeto={projeto}
          selecao={selecao}
          cursor={cursor}
          onOps={aplicarOps}
          onDividir={dividirNoCursor}
          onRemover={remover}
          abrirCamera={() => abrirGeracao({ tipo: "angulo_gerar", clipe: selecao[0] || null })}
          abrirComparar={abrirComparar}
          gerarContinuacao={(id) => abrirGeracao({ tipo: "continuar_video", clipe: id })}
          gerarTransicao={(a, b) => abrirGeracao({ tipo: "transicao_gerar", clipe: a, clipeB: b })}
        />
      )}
    </ComCursor>
  );

  const abaVisivel: AbaEsquerda = aba === "ajustes" && !ajustesNaEsquerda ? "midia" : aba;
  const painelEsquerdo =
    abaVisivel === "midia" ? (
      <Biblioteca projeto={projeto} onInserir={(i, onde) => inserir(i, onde)} onVirarClipe={virarClipe} />
    ) : abaVisivel === "skills" ? (
      <PainelDeSkills projeto={projeto} contexto={contextoDaSkill} controle={controle} />
    ) : abaVisivel === "gerar" ? (
      <ComCursor relogio={relogio} passo={0.25}>
        {(cursor) => <PainelDeGeracao projeto={projeto} urls={urls} urlsExtras={urls} pedido={geracao} selecao={selecao} cursor={cursor} onOps={aplicarOps} />}
      </ComCursor>
    ) : abaVisivel === "timestamp" ? (
      <PainelTimestamp projeto={projeto} urls={urls} onAplicarProjeto={aplicarProjeto} />
    ) : abaVisivel === "ajustes" ? (
      inspector
    ) : (
      <PainelDeReferencias projeto={projeto} controle={controle} urlsDoProjeto={urls} />
    );

  const janelaDeComparar = (
    <Dialog open={!!comparar} onOpenChange={(v) => !v && setComparar(null)}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="text-[15px]">Comparar</DialogTitle>
        {comparar && (
          <ComparadorAntesDepois
            tipo={comparar.tipo}
            antes={{ src: comparar.antes, rotulo: comparar.rotulos[0] }}
            depois={{ src: comparar.depois, rotulo: comparar.rotulos[1] }}
            proporcao={projeto.altura / projeto.largura}
            modoInicial="cortina"
          />
        )}
      </DialogContent>
    </Dialog>
  );

  // ---------------------------------------------------------------- celular: prévia e lista de cortes
  if (!largo) {
    const cortes = principal ? principal.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s) : [];
    return (
      <div className="min-w-0 space-y-3" data-editor-de-video="simples">
        {barra}
        <Previa ref={previa} projeto={projeto} urls={urls} relogio={relogio} compacta />
        <div>
          <p className={juntar(texto.rotulo, "mb-1")}>Cortes</p>
          <ul className="divide-y divide-border" aria-label="Lista de cortes">
            {cortes.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center py-1.5">
                <button
                  type="button"
                  className={juntar("min-w-0 flex-1 truncate text-left text-[13px]", selecao.indexOf(c.id) >= 0 && "font-semibold text-primary")}
                  onClick={() => {
                    setSelecao([c.id]);
                    relogio.set(c.inicio_s);
                  }}
                >
                  <span className="mr-1.5 text-muted-foreground">{apelidos.porId[c.id]}</span>
                  {tempoFino(c.inicio_s)} a {tempoFino(fimDoClipe(c))}
                  <span className="ml-1.5 text-muted-foreground">{c.fonte && projeto.fontes[c.fonte] ? projeto.fontes[c.fonte].nome : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className={texto.auxiliar}>{agenteNaLateral ? "Linha do tempo e câmera abrem no computador. O agente editor fica no botão de baixo." : "Linha do tempo, câmera e agente abrem no computador."}</p>
        <PainelDeSkills projeto={projeto} contexto={contextoDaSkill} controle={controle} />
        {janelaDeComparar}
      </div>
    );
  }

  // ---------------------------------------------------------------- computador e notebook
  return (
    <div className="grid min-w-0 gap-3" style={{ gridTemplateRows: "minmax(0,1fr) 250px", height: "calc(100vh - 150px)", minHeight: 620, maxHeight: 1200 }} data-editor-de-video="completo">
      <div
        className={juntar(
          "grid min-h-0 min-w-0 gap-3",
          !agenteNaLateral
            ? "lg:grid-cols-[280px_minmax(0,1fr)_300px] xl:grid-cols-[320px_minmax(0,1fr)_340px] desk:grid-cols-[360px_minmax(0,1fr)_380px]"
            : ajustesNaEsquerda
              ? "lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] desk:grid-cols-[340px_minmax(0,1fr)]"
              : "lg:grid-cols-[320px_minmax(0,1fr)_300px]",
        )}
        data-agente-na-lateral={agenteNaLateral ? "" : undefined}
      >
        <div className="flex min-h-0 min-w-0 flex-col">
          <SeletorCompacto rotulo="Painel do editor" valor={abaVisivel} onEscolher={(v) => setAba(v as AbaEsquerda)} opcoes={abasDaEsquerda} larguraTotal />
          <RegiaoRolavel modo="sempre" className="mt-2 min-h-0 flex-1 pr-1" memoria={`mesa-edicao:editor:rolagem:${abaVisivel}:${clientId}`}>
            {painelEsquerdo}
          </RegiaoRolavel>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          {barra}
          <div className="mt-2 min-h-0 flex-1">
            <Previa ref={previa} projeto={projeto} urls={urls} relogio={relogio} />
          </div>
        </div>
        {agenteNaLateral ? (
          !ajustesNaEsquerda && (
            <div className="flex min-h-0 min-w-0 flex-col">
              <p className={juntar(texto.rotulo, "mb-2")}>Ajustes</p>
              <RegiaoRolavel modo="sempre" className="min-h-0 flex-1 pr-1">
                {inspector}
              </RegiaoRolavel>
            </div>
          )
        ) : (
          <div className="flex min-h-0 min-w-0 flex-col">
            <SeletorCompacto
              rotulo="Lado direito do editor"
              valor={abaDireita}
              onEscolher={(v) => setAbaDireita(v as AbaDireita)}
              opcoes={[
                { valor: "ajustes", rotulo: "Ajustes" },
                { valor: "agente", rotulo: "Agente" },
              ]}
              larguraTotal
            />
            <div className="mt-2 flex min-h-0 flex-1 flex-col">
              {abaDireita === "ajustes" ? (
                <RegiaoRolavel modo="sempre" className="pr-1">
                  {inspector}
                </RegiaoRolavel>
              ) : (
                <AgenteEditor projeto={projeto} controle={controle} onAplicarProjeto={aplicarProjeto} urls={urls} />
              )}
            </div>
          </div>
        )}
      </div>
      <div className="min-h-0 min-w-0">
        <LinhaDoTempo projeto={projeto} relogio={relogio} px={px} setPx={setPx} selecao={selecao} onSelecionar={setSelecao} onOps={aplicarOps} urls={urls} />
      </div>
      {janelaDeComparar}
    </div>
  );
}
