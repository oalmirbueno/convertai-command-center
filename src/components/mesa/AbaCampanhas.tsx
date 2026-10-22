import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Megaphone, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReservaFlutuante } from "@/components/sistema/useReservaFlutuante";
import { useAlturaQueCabe } from "@/components/sistema/AreaDeTrabalho";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { juntar, superficie, texto } from "@/components/sistema/estilos";
import { AvisoDeErro } from "./Custo";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "./MesaContexto";
import { campanhaDaMarcaNaTela } from "@/lib/mesa/marcas";
import { rotuloDoTipo, tipoDaCampanha } from "../../../supabase/functions/_shared/tipos-de-campanha";
import CampanhaDetalhe, { SeloDoEstado } from "./CampanhaDetalhe";
import CampanhaNova from "./CampanhaNova";
import CampanhaAgente, { type RascunhoParaOAgente } from "./CampanhaAgente";
import { chaves, lerCampanhas, lerHypes, periodoCurto, useMidia, type Campanha } from "./mesaV4Api";
import { chavesDaCampanha, conteudosDaCampanha, lerContagemDosConteudos, usePedidoDaCampanha } from "./campanhasApi";
import { tirarSementeDaCampanha, type SementeDaCampanha } from "./sementeDaCampanha";
import { gravarEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao } from "@/components/sistema/estilos";
import { chavesDaCampanhaCompleta, lerTrabalhosDasCampanhas } from "./campanhasApi";
import { moldeDaCampanha, progressoDaCampanha, prontasPorCampanha, type MoldeDaCampanha } from "./regrasDaCampanha";
// Frente IDV (30/09): o criador de nomes da Mesa Identidade também dá nome de campanha (só baixa quando abre).
const NamingDaCampanha = lazy(() => import("@/components/mesa-identidade/NamingDaCampanha"));

/**
 * Aba Campanhas (entre Mês e Estúdio), mesa de trabalho em três colunas:
 * à esquerda a lista das campanhas, no centro a campanha aberta em seções
 * (visão geral, identidade com o selo, referências, conteúdos) e à direita o
 * agente da campanha, com quem a equipe conversa para mudar tudo. Cada coluna
 * rola sozinha. Em telas menores, a lista vira um seletor e o agente vira uma
 * gaveta. Um hype da semana chega aqui já preenchido na campanha nova.
 */

/** Selo pequeno da campanha: a imagem desenhada ou a inicial na cor do tema. */
function SeloPequeno({ campanha, tamanho = "h-10 w-10" }: { campanha: Campanha; tamanho?: string }) {
  const paleta = (campanha.identidade && campanha.identidade.paleta_apoio) || [];
  const cor = paleta.length && paleta[0].hex ? String(paleta[0].hex) : undefined;
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background ${tamanho}`}>
      {campanha.selo_path ? (
        <ImagemDaMesa caminho={campanha.selo_path} alt="" className="h-full w-full !object-contain p-0.5" />
      ) : (
        <span className="text-[15px] font-semibold" style={cor ? { color: cor } : undefined}>{(campanha.nome || "C").charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

function ItemDaLista({
  campanha,
  conteudos,
  ativa,
  onAbrir,
  progresso = null,
  onDuplicar,
}: {
  campanha: Campanha;
  conteudos: number | null;
  ativa: boolean;
  onAbrir: () => void;
  /** 22/10/2026: peças prontas de um total (a barra fina embaixo). */
  progresso?: { prontas: number; total: number } | null;
  /** 22/10/2026: "Nova campanha a partir desta" (a estrutura, com outro tema). */
  onDuplicar?: () => void;
}) {
  return (
    <div className={`group flex w-full min-w-0 items-center rounded-lg transition-colors ${ativa ? "bg-primary/10" : "hover:bg-muted"}`}>
    <button
      type="button"
      onClick={onAbrir}
      aria-current={ativa ? "true" : undefined}
      className="flex min-w-0 flex-1 items-center px-2 py-2 text-left"
    >
      <SeloPequeno campanha={campanha} />
      <span className="ml-2.5 min-w-0 flex-1">
        <span className={`block truncate text-[13px] ${ativa ? "font-semibold" : "font-medium"}`}>{campanha.nome}</span>
        <span className="mt-0.5 flex min-w-0 items-center text-[12px] text-muted-foreground">
          <span className="mr-1.5 min-w-0 truncate">
            {rotuloDoTipo(tipoDaCampanha(campanha.identidade)) ? `${rotuloDoTipo(tipoDaCampanha(campanha.identidade))} · ` : ""}
            {periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}
            {conteudos !== null ? ` · ${conteudos} cont.` : ""}
          </span>
          <SeloDoEstado estado={campanha.status} />
        </span>
        {progresso && (
          <span className="mt-1 flex min-w-0 items-center" title={`${progresso.prontas} de ${progresso.total} peças prontas`} data-progresso={`${progresso.prontas}/${progresso.total}`}>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((progresso.prontas / progresso.total) * 100)}%` }} />
            </span>
            <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">{progresso.prontas}/{progresso.total}</span>
          </span>
        )}
      </span>
    </button>
    {onDuplicar && (
      <button type="button" className={`${botao.icone} mr-1`} onClick={onDuplicar} aria-label={`Nova campanha a partir de ${campanha.nome}`} title="Nova campanha a partir desta (mesma estrutura, outro tema)">
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    )}
    </div>
  );
}

/** Nenhuma campanha aberta: convite para criar e as recentes a um clique. */
function EstadoVazio({
  lista,
  contagem,
  carregando,
  onNova,
  onAbrir,
}: {
  lista: Campanha[];
  contagem: (c: Campanha) => number | null;
  carregando: boolean;
  onNova: () => void;
  onAbrir: (id: string) => void;
}) {
  const recentes = lista.slice(0, 4);
  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl py-6 sm:py-10">
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
          <Megaphone className="h-5 w-5 text-primary" />
        </span>
        {/* Só o título; o que é uma campanha fica no "?" (28/09). */}
        <div className="mt-4 flex min-w-0 items-center justify-center">
          <h2 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{lista.length ? "Abra uma campanha ou comece outra" : "A primeira campanha deste cliente"}</h2>
          <AjudaRecolhida className="ml-1.5" rotulo="O que é uma campanha">
            Uma campanha junta o tema, a identidade com o selo e os conteúdos do período. O agente cria tudo a partir de uma frase e ajusta pela conversa.
          </AjudaRecolhida>
        </div>
        <Button type="button" className="mt-5 h-10 w-10 rounded-full p-0" onClick={onNova} aria-label="Nova campanha" title="Nova campanha">
          <Plus className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>
      {carregando && (
        <div className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="h-[68px] animate-pulse rounded-xl bg-muted" />
          <div className="h-[68px] animate-pulse rounded-xl bg-muted" />
        </div>
      )}
      {recentes.length > 0 && (
        <div className="mt-8">
          <p className={juntar(texto.rotulo, "mb-2")}>Recentes</p>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" aria-label="Campanhas recentes">
            {recentes.map((c) => {
              const n = contagem(c);
              return (
                <li key={c.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onAbrir(c.id)}
                    className="flex w-full min-w-0 items-center rounded-lg p-2.5 text-left transition-colors hover:bg-muted"
                  >
                    <SeloPequeno campanha={c} tamanho="h-11 w-11" />
                    <span className="ml-3 min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{c.nome}</span>
                      <span className="mt-0.5 flex min-w-0 items-center text-[12px] text-muted-foreground">
                        <span className="mr-1.5 min-w-0 truncate">
                          {periodoCurto(c.periodo_inicio, c.periodo_fim)}
                          {n !== null ? ` · ${n} conteúdo(s)` : ""}
                        </span>
                        <SeloDoEstado estado={c.status} />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AbaCampanhas({
  campanhaId = null,
  onCampanha,
  hypeIndice = null,
  onLimparHype,
  onAbrirNoEstudio,
  onAbrirArteRapida,
  onAbrirStories,
  novaPedida = false,
}: {
  /** 22/10/2026: abre a aba Stories (a sequência já fica escolhida). */
  onAbrirStories?: () => void;
  /** 21/10/2026: &nova=1 (o Mês juntou hypes e trendings): abre a campanha nova e lê a semente. */
  novaPedida?: boolean;
  /** 21/10/2026: abre a peça da campanha (arte rápida) no Estúdio. */
  onAbrirArteRapida?: (trabalhoId: string) => void;
  campanhaId?: string | null;
  onCampanha?: (id: string | null) => void;
  /** Índice do hype (na busca mais recente) que abre a campanha nova já preenchida. */
  hypeIndice?: number | null;
  onLimparHype?: () => void;
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
} = {}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  // Três colunas só com espaço de verdade (o painel tem o menu à esquerda).
  const tresColunas = useMidia("(min-width: 1536px)");
  const agenteFixo = useMidia("(min-width: 1280px)");
  const colunasFixas = useMidia("(min-width: 1024px)");
  const [idLocal, setIdLocal] = useState<string | null>(campanhaId);
  const [nova, setNova] = useState(hypeIndice !== null || novaPedida);
  const [projetoDaCriacao, setProjetoDaCriacao] = useState<Record<string, string>>({});
  const [gaveta, setGaveta] = useState(false);
  const [rascunho, setRascunho] = useState<RascunhoParaOAgente | null>(null);
  const [nomes, setNomes] = useState(false);
  // 21/10/2026: a semente do Mês (hypes + trendings + pedido) chega uma vez e abre a campanha nova preenchida.
  const [semente, setSemente] = useState<SementeDaCampanha | null>(null);
  // 22/10/2026: "Nova campanha a partir desta" (a estrutura de outra campanha, outro tema).
  const [molde, setMolde] = useState<MoldeDaCampanha | null>(null);
  // 22/10/2026 (dono: "coloque recolher o agente e a aba campanhas"): as laterais recolhem para o lado, lembrado por cliente.
  const [listaRecolhida, setListaRecolhida] = useEstadoDaTela<boolean>(`mesa:campanhas:lista-recolhida:${clientId}`, false);
  const [agenteRecolhido, setAgenteRecolhido] = useEstadoDaTela<boolean>(`mesa:campanhas:agente-recolhido:${clientId}`, false);
  useEffect(() => {
    const s = tirarSementeDaCampanha(clientId);
    if (s) setSemente(s);
    if (!s && !novaPedida) return;
    setNova(true);
    setIdLocal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, novaPedida]);

  const campanhas = useQuery({ queryKey: chaves.campanhas(clientId), queryFn: () => lerCampanhas(clientId) });
  const hypes = useQuery({ queryKey: chaves.hypes(clientId), enabled: hypeIndice !== null, queryFn: () => lerHypes(clientId) });
  const hype = hypeIndice !== null && hypes.data ? hypes.data.itens[hypeIndice] || null : null;
  // A campanha nova só recomeça quando chega OUTRO hype. Tirar o hype (o X do
  // "Do hype") mantém o que já foi escrito no formulário.
  const chaveDaNova = useRef("nova");
  if (hype && hypeIndice !== null) chaveDaNova.current = `hype-${hypeIndice}`;
  if (semente) chaveDaNova.current = `semente-${semente.criada_em}`;
  if (molde) chaveDaNova.current = `molde-${molde.origemId}`;

  // Frente AE: com duas marcas (Acerbi e CME), só as campanhas da marca aberta.
  const { marca } = useMarcaDaMesa();
  const lista = (campanhas.data || []).filter((c) => campanhaDaMarcaNaTela(c.identidade, marca));
  const idsDasPropostas = lista.map((c) => c.proposta_id || "").filter(Boolean).sort();
  const contagem = useQuery({
    queryKey: chavesDaCampanha.contagem(clientId, idsDasPropostas),
    enabled: idsDasPropostas.length > 0,
    queryFn: () => lerContagemDosConteudos(idsDasPropostas),
  });
  const conteudosDe = (c: Campanha) => conteudosDaCampanha(queryClient, c, contagem.data);
  // Progresso de cada campanha na lista: peças prontas (trabalhos do Estúdio) de um total.
  const trabalhosDasCampanhas = useQuery({
    queryKey: ["mesa", "campanhas-progresso", clientId],
    enabled: lista.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: () => lerTrabalhosDasCampanhas(clientId),
  });
  const prontas = trabalhosDasCampanhas.data ? prontasPorCampanha(trabalhosDasCampanhas.data) : {};
  const progressoDe = (c: Campanha) => (trabalhosDasCampanhas.data ? progressoDaCampanha(c, conteudosDe(c), prontas) : null);

  useEffect(() => { setIdLocal(campanhaId); }, [campanhaId]);
  useEffect(() => { if (hypeIndice !== null) setNova(true); }, [hypeIndice]);

  const escolhida = nova ? null : lista.find((c) => c.id === idLocal) || null;
  // Andamento da campanha aberta, não de qualquer uma: o pedido de outra
  // campanha não acende nem apaga o botão desta.
  const andando = !!usePedidoDaCampanha(escolhida ? escolhida.id : null);
  // Lista ao lado com três colunas, ou entre 1024 e 1279 (o agente vira gaveta);
  // entre 1280 e 1535, o agente fica e a lista vira seletor.
  // Agente recolhido libera espaço: a lista volta para o lado (de 1024 px para cima).
  const listaAoLado = tresColunas || (colunasFixas && (!agenteFixo || agenteRecolhido));

  const abrir = (id: string | null) => {
    setIdLocal(id);
    setNova(false);
    setRascunho(null);
    if (onCampanha) onCampanha(id);
  };

  const comecarNova = (m: MoldeDaCampanha | null = null) => {
    setMolde(m);
    setNova(true);
    setIdLocal(null);
    if (onCampanha) onCampanha(null);
  };

  const fecharNova = () => {
    setNova(false);
    setSemente(null);
    setMolde(null);
    if (onLimparHype) onLimparHype();
  };

  const pedirAoAgente = (texto: string) => {
    setRascunho((r) => ({ texto, vez: (r ? r.vez : 0) + 1 }));
    if (!agenteFixo) setGaveta(true);
  };

  const criada = (c: Campanha, projectId: string | null) => {
    if (projectId) setProjetoDaCriacao((m) => ({ ...m, [c.id]: projectId }));
    setSemente(null);
    setMolde(null);
    if (onLimparHype) onLimparHype();
    abrir(c.id);
  };

  // ---------------------------------------------------------------- partes

  // Secundário: o primário da área é o do estado vazio ou o da campanha aberta (28/09, um primário por área).
  const botaoNova = (
    <>
      <Button type="button" size="sm" variant="ghost" className="mr-0.5 h-8 w-8 shrink-0 p-0" onClick={() => setNomes(true)} title="Criar nome de campanha" aria-label="Criar nome de campanha">
        <Type className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" onClick={() => comecarNova()} disabled={nova} aria-label="Nova campanha" title="Nova campanha">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </>
  );

  const listaLateral = (
    <nav aria-label="Campanhas do cliente" className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-border px-3 py-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Campanhas</h2>
        {botaoNova}
        <button type="button" className={`${botao.icone} ml-0.5`} onClick={() => setListaRecolhida(true)} aria-label="Recolher as campanhas" title="Recolher a lista de campanhas para o lado">
          <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {campanhas.isLoading && (
          <div className="space-y-1.5 p-1">
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
          </div>
        )}
        {campanhas.isError && <AvisoDeErro erro={campanhas.error} />}
        {campanhas.isSuccess && lista.length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">Nenhuma campanha ainda.</p>
        )}
        <ul className="space-y-0.5">
          {lista.map((c) => (
            <li key={c.id} className="min-w-0">
              <ItemDaLista campanha={c} conteudos={conteudosDe(c)} ativa={!!escolhida && escolhida.id === c.id} onAbrir={() => abrir(c.id)} progresso={progressoDe(c)} onDuplicar={() => comecarNova(moldeDaCampanha(c))} />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );

  const seletor = (
    <div className="mb-3 flex min-w-0 items-center">
      <Select value={escolhida ? escolhida.id : ""} onValueChange={(v) => abrir(v)}>
        <SelectTrigger className="mr-2 h-9 min-w-0 flex-1 text-[13px]" aria-label="Campanha aberta">
          <SelectValue placeholder={campanhas.isLoading ? "Lendo campanhas…" : lista.length ? "Escolha uma campanha" : "Nenhuma campanha ainda"} />
        </SelectTrigger>
        <SelectContent>
          {lista.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.nome} · {periodoCurto(c.periodo_inicio, c.periodo_fim)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {botaoNova}
    </div>
  );

  const centro = nova ? (
    hypeIndice !== null && hypes.isLoading ? (
      <div className="mx-auto h-64 max-w-2xl animate-pulse rounded-xl bg-muted" />
    ) : (
      <CampanhaNova
        key={chaveDaNova.current}
        hype={hype}
        semente={semente}
        onLimparSemente={() => setSemente(null)}
        molde={molde}
        onLimparMolde={() => setMolde(null)}
        onLimparHype={onLimparHype}
        onCancelar={fecharNova}
        onCriada={criada}
      />
    )
  ) : escolhida ? (
    <CampanhaDetalhe
      key={escolhida.id}
      campanha={escolhida}
      projetoSugerido={projetoDaCriacao[escolhida.id] || null}
      onAbrirNoEstudio={onAbrirNoEstudio}
      onPedirAoAgente={pedirAoAgente}
      onAbrirAgente={agenteFixo ? undefined : () => setGaveta(true)}
      onAbrirArteRapida={onAbrirArteRapida}
      onDuplicar={() => comecarNova(moldeDaCampanha(escolhida))}
      onAbrirStories={onAbrirStories ? (sequenciaId, storyId) => {
        // A aba Stories abre na sequência (e na tela) guardadas no estado da tela dela (useEstadoDaTela).
        gravarEstadoDaTela(`mesa:stories:sequencia:${clientId}`, sequenciaId);
        gravarEstadoDaTela(`mesa:stories:bloco:${clientId}`, "sequencia");
        gravarEstadoDaTela(`mesa:stories:filtro:${clientId}`, "todas");
        gravarEstadoDaTela(`mesa:stories:tela:${clientId}`, storyId || null);
        onAbrirStories();
      } : undefined}
    />
  ) : campanhas.isError && !listaAoLado ? (
    <AvisoDeErro erro={campanhas.error} />
  ) : (
    <EstadoVazio lista={lista} contagem={conteudosDe} carregando={campanhas.isLoading} onNova={() => comecarNova()} onAbrir={(id) => abrir(id)} />
  );

  const agente = escolhida ? (
    <CampanhaAgente
      key={escolhida.id}
      campanha={escolhida}
      rascunho={rascunho}
      naJanela={!agenteFixo}
      className="h-full flex-1"
    />
  ) : null;

  const agenteAoLado = agenteFixo && !!agente;
  // Botão flutuante do agente (abaixo de 1280 px): o fim da página fica livre para rolar acima dele.
  useReservaFlutuante(!agenteFixo && !!agente, 64);
  // 28/09 (dono: "sobra espaço embaixo na tela cheia" e "área cortada"): a altura
  // é medida de onde a grade começa até o fim da janela, e não mais 100vh-260px
  // fixo. Na tela cheia o cabeçalho do painel some e a grade cresce junto.
  const { ref: refDaGrade, altura: alturaDaGrade } = useAlturaQueCabe(true);
  // Cada lateral aberta (250 e 360 px) ou recolhida numa faixa fina (44 px); o centro fica com o resto.
  const GRADES: Record<string, string> = {
    "aberta-aberto": "lg:grid-cols-[250px_minmax(0,1fr)_360px]",
    "aberta-recolhido": "lg:grid-cols-[250px_minmax(0,1fr)_44px]",
    "recolhida-aberto": "lg:grid-cols-[44px_minmax(0,1fr)_360px]",
    "recolhida-recolhido": "lg:grid-cols-[44px_minmax(0,1fr)_44px]",
    "aberta-sem": "lg:grid-cols-[250px_minmax(0,1fr)]",
    "recolhida-sem": "lg:grid-cols-[44px_minmax(0,1fr)]",
    "sem-aberto": "lg:grid-cols-[minmax(0,1fr)_360px]",
    "sem-recolhido": "lg:grid-cols-[minmax(0,1fr)_44px]",
    "sem-sem": "lg:grid-cols-1",
  };
  const grade = GRADES[`${listaAoLado ? (listaRecolhida ? "recolhida" : "aberta") : "sem"}-${agenteAoLado ? (agenteRecolhido ? "recolhido" : "aberto") : "sem"}`];

  return (
    <>
      {/* No computador, a mesa ocupa a altura da tela, abaixo do cabeçalho fixo
          da Mesa, e cada coluna rola sozinha. No celular, a página rola. */}
      <div
        ref={refDaGrade}
        className={`grid min-w-0 grid-cols-1 gap-4 ${grade}`}
        style={alturaDaGrade ? { height: `${alturaDaGrade}px` } : undefined}
        data-altura-que-cabe=""
      >
        {listaAoLado && (listaRecolhida ? (
          <aside className="flex min-h-0 min-w-0 flex-col items-center pt-1" aria-label="Campanhas (recolhida)" data-lista-recolhida="">
            <button type="button" className={botao.icone} onClick={() => setListaRecolhida(false)} aria-label="Abrir as campanhas" title="Abrir a lista de campanhas">
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={`${botao.icone} mt-1`} onClick={() => comecarNova()} disabled={nova} aria-label="Nova campanha" title="Nova campanha">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </aside>
        ) : (
          <aside className={juntar(superficie.painel, "min-h-0 min-w-0 overflow-hidden")}>{listaLateral}</aside>
        ))}

        {/* 22/10/2026 (dono: "rolando lá pra baixo de forma muito longa"): relative prende o que é absoluto
            (texto só para leitor de tela, selos) dentro da rolagem da coluna; sem ele a página crescia vazia. */}
        <section className="relative min-h-0 min-w-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1" aria-label="Campanha">
          {!listaAoLado && seletor}
          {centro}
        </section>

        {agenteAoLado && (agenteRecolhido ? (
          <aside className="flex min-h-0 min-w-0 flex-col items-center pt-1" aria-label="Agente da campanha (recolhido)" data-agente-recolhido="">
            <button type="button" className={`${botao.icone} text-primary hover:text-primary`} onClick={() => setAgenteRecolhido(false)} aria-label="Abrir o agente da campanha" title="Abrir o agente da campanha">
              {andando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PanelRightOpen className="h-4 w-4" aria-hidden="true" />}
            </button>
          </aside>
        ) : (
          <aside className={juntar(superficie.painel, "relative min-h-0 min-w-0 overflow-hidden")} aria-label="Agente da campanha">
            <button type="button" className={`${botao.icone} absolute right-2 top-2.5 z-10`} onClick={() => setAgenteRecolhido(true)} aria-label="Recolher o agente" title="Recolher o agente da campanha para o lado">
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            </button>
            {agente}
          </aside>
        ))}
      </div>

      {nomes && (
        <Suspense fallback={null}>
          <NamingDaCampanha aberto={nomes} onOpenChange={setNomes} campanhaId={escolhida ? escolhida.id : null} nomeDaCampanha={escolhida ? escolhida.nome : null} />
        </Suspense>
      )}

      {!agenteFixo && agente && (
        <>
          <button
            type="button"
            onClick={() => setGaveta(true)}
            className="fixed bottom-[72px] right-4 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm md:bottom-6 md:right-6"
            aria-label="Agente da campanha"
            title="Agente da campanha"
          >
            {andando ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" /> : <Sparkles className="h-5 w-5 shrink-0" aria-hidden="true" />}
          </button>
          <JanelaCentral
            aberta={gaveta}
            onMudar={(v) => {
              setGaveta(v);
              // O texto levado ao agente vale uma vez: reabrir a janela não preenche de novo.
              if (!v) setRascunho(null);
            }}
            largura="lg"
            corpo="fixo"
            semEspaco
            icone={<Sparkles className="h-4 w-4 text-primary" />}
            titulo="Agente da campanha"
            descricao={escolhida ? escolhida.nome : undefined}
          >
            {agente}
          </JanelaCentral>
        </>
      )}
    </>
  );
}
