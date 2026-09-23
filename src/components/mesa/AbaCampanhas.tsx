import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AvisoDeErro } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import CampanhaDetalhe, { SeloDoEstado } from "./CampanhaDetalhe";
import CampanhaNova from "./CampanhaNova";
import CampanhaAgente, { type RascunhoParaOAgente } from "./CampanhaAgente";
import { chaves, lerCampanhas, lerHypes, periodoCurto, useMidia, type Campanha } from "./mesaV4Api";
import { chavesDaCampanha, conteudosDaCampanha, lerContagemDosConteudos, usePedidoDaCampanha } from "./campanhasApi";

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
}: {
  campanha: Campanha;
  conteudos: number | null;
  ativa: boolean;
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-current={ativa ? "true" : undefined}
      className={`flex w-full min-w-0 items-center rounded-lg px-2 py-2 text-left transition-colors ${ativa ? "bg-primary/10" : "hover:bg-muted"}`}
    >
      <SeloPequeno campanha={campanha} />
      <span className="ml-2.5 min-w-0 flex-1">
        <span className={`block truncate text-[13px] ${ativa ? "font-semibold" : "font-medium"}`}>{campanha.nome}</span>
        <span className="mt-0.5 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
          <span className="mr-1.5 min-w-0 truncate">
            {periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}
            {conteudos !== null ? ` · ${conteudos} cont.` : ""}
          </span>
          <SeloDoEstado estado={campanha.status} />
        </span>
      </span>
    </button>
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
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <Megaphone className="h-5 w-5 text-primary" />
        </span>
        <h2 className="mt-4 text-[17px] font-semibold">{lista.length ? "Abra uma campanha ou comece outra" : "A primeira campanha deste cliente"}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
          Uma campanha junta o tema, a identidade com o selo e os conteúdos do período. O agente cria tudo a partir de uma frase e ajusta pela conversa.
        </p>
        <Button type="button" className="mt-5 h-10" onClick={onNova}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova campanha
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
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recentes</p>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" aria-label="Campanhas recentes">
            {recentes.map((c) => {
              const n = contagem(c);
              return (
                <li key={c.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onAbrir(c.id)}
                    className="flex w-full min-w-0 items-center rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
                  >
                    <SeloPequeno campanha={c} tamanho="h-11 w-11" />
                    <span className="ml-3 min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{c.nome}</span>
                      <span className="mt-0.5 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
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
}: {
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
  const [nova, setNova] = useState(hypeIndice !== null);
  const [projetoDaCriacao, setProjetoDaCriacao] = useState<Record<string, string>>({});
  const [gaveta, setGaveta] = useState(false);
  const [rascunho, setRascunho] = useState<RascunhoParaOAgente | null>(null);

  const campanhas = useQuery({ queryKey: chaves.campanhas(clientId), queryFn: () => lerCampanhas(clientId) });
  const hypes = useQuery({ queryKey: chaves.hypes(clientId), enabled: hypeIndice !== null, queryFn: () => lerHypes(clientId) });
  const hype = hypeIndice !== null && hypes.data ? hypes.data.itens[hypeIndice] || null : null;
  // A campanha nova só recomeça quando chega OUTRO hype. Tirar o hype (o X do
  // "Do hype") mantém o que já foi escrito no formulário.
  const chaveDaNova = useRef("nova");
  if (hype && hypeIndice !== null) chaveDaNova.current = `hype-${hypeIndice}`;

  const lista = campanhas.data || [];
  const idsDasPropostas = lista.map((c) => c.proposta_id || "").filter(Boolean).sort();
  const contagem = useQuery({
    queryKey: chavesDaCampanha.contagem(clientId, idsDasPropostas),
    enabled: idsDasPropostas.length > 0,
    queryFn: () => lerContagemDosConteudos(idsDasPropostas),
  });
  const conteudosDe = (c: Campanha) => conteudosDaCampanha(queryClient, c, contagem.data);

  useEffect(() => { setIdLocal(campanhaId); }, [campanhaId]);
  useEffect(() => { if (hypeIndice !== null) setNova(true); }, [hypeIndice]);

  const escolhida = nova ? null : lista.find((c) => c.id === idLocal) || null;
  // Andamento da campanha aberta, não de qualquer uma: o pedido de outra
  // campanha não acende nem apaga o botão desta.
  const andando = !!usePedidoDaCampanha(escolhida ? escolhida.id : null);
  // Lista ao lado com três colunas, ou entre 1024 e 1279 (o agente vira gaveta);
  // entre 1280 e 1535, o agente fica e a lista vira seletor.
  const listaAoLado = tresColunas || (colunasFixas && !agenteFixo);

  const abrir = (id: string | null) => {
    setIdLocal(id);
    setNova(false);
    setRascunho(null);
    if (onCampanha) onCampanha(id);
  };

  const comecarNova = () => {
    setNova(true);
    setIdLocal(null);
    if (onCampanha) onCampanha(null);
  };

  const fecharNova = () => {
    setNova(false);
    if (onLimparHype) onLimparHype();
  };

  const pedirAoAgente = (texto: string) => {
    setRascunho((r) => ({ texto, vez: (r ? r.vez : 0) + 1 }));
    if (!agenteFixo) setGaveta(true);
  };

  const criada = (c: Campanha, projectId: string | null) => {
    if (projectId) setProjetoDaCriacao((m) => ({ ...m, [c.id]: projectId }));
    if (onLimparHype) onLimparHype();
    abrir(c.id);
  };

  // ---------------------------------------------------------------- partes

  const botaoNova = (
    <Button type="button" size="sm" className="h-8 shrink-0" onClick={comecarNova} disabled={nova}>
      <Plus className="mr-1 h-3.5 w-3.5" /> Nova campanha
    </Button>
  );

  const listaLateral = (
    <nav aria-label="Campanhas do cliente" className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-border px-3 py-3">
        <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">Campanhas</h2>
        {botaoNova}
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
              <ItemDaLista campanha={c} conteudos={conteudosDe(c)} ativa={!!escolhida && escolhida.id === c.id} onAbrir={() => abrir(c.id)} />
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
    />
  ) : campanhas.isError && !listaAoLado ? (
    <AvisoDeErro erro={campanhas.error} />
  ) : (
    <EstadoVazio lista={lista} contagem={conteudosDe} carregando={campanhas.isLoading} onNova={comecarNova} onAbrir={(id) => abrir(id)} />
  );

  const agente = escolhida ? (
    <CampanhaAgente
      key={escolhida.id}
      campanha={escolhida}
      rascunho={rascunho}
      naGaveta={!agenteFixo}
      className="h-full"
    />
  ) : null;

  const agenteAoLado = agenteFixo && !!agente;
  const grade = listaAoLado && agenteAoLado
    ? "lg:grid-cols-[250px_minmax(0,1fr)_360px]"
    : listaAoLado
      ? "lg:grid-cols-[250px_minmax(0,1fr)]"
      : agenteAoLado
        ? "lg:grid-cols-[minmax(0,1fr)_360px]"
        : "lg:grid-cols-1";

  return (
    <>
      {/* No computador, a mesa ocupa a altura da tela, abaixo do cabeçalho fixo
          da Mesa, e cada coluna rola sozinha. No celular, a página rola. */}
      <div className={`grid min-w-0 grid-cols-1 gap-4 lg:h-[calc(100vh-260px)] lg:min-h-[520px] ${grade}`}>
        {listaAoLado && (
          <aside className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card">{listaLateral}</aside>
        )}

        <section className="min-h-0 min-w-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1" aria-label="Campanha">
          {!listaAoLado && seletor}
          {centro}
        </section>

        {agenteAoLado && (
          <aside className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card" aria-label="Agente da campanha">
            {agente}
          </aside>
        )}
      </div>

      {!agenteFixo && agente && (
        <>
          <button
            type="button"
            onClick={() => setGaveta(true)}
            className="fixed bottom-[72px] right-4 z-30 inline-flex h-11 max-w-[calc(100vw-32px)] items-center rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-lg md:bottom-6 md:right-6"
          >
            {andando ? <Loader2 className="mr-1.5 h-4 w-4 shrink-0 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4 shrink-0" />}
            <span className="truncate">Agente da campanha</span>
          </button>
          <Sheet
            open={gaveta}
            onOpenChange={(v) => {
              setGaveta(v);
              // O texto levado ao agente vale uma vez: reabrir a gaveta não preenche de novo.
              if (!v) setRascunho(null);
            }}
          >
            <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" aria-describedby={undefined}>
              <SheetTitle className="sr-only">Agente da campanha</SheetTitle>
              {agente}
            </SheetContent>
          </Sheet>
        </>
      )}
    </>
  );
}
