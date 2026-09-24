import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Link2 } from "lucide-react";
import { toast } from "sonner";
import { AvisoDeErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import { textoDoErro } from "@/lib/mesa/api";
import {
  chavesAds,
  formatoDe,
  lerAnunciosDoCliente,
  lerCriativos,
  lerPlanos,
  lerTrabalhos,
  mudarCriativo,
  nomeDoAnuncio,
  STATUS_DO_CRIATIVO,
  type CriativoAds,
  type PlanoAds,
  type StatusDoCriativo,
} from "./adsApi";
import ArteDoCriativo, { capaDoTrabalho } from "./ArteDoCriativo";
import PainelDaCopy from "./PainelDaCopy";

/**
 * Etapa 4, Estúdio Ads: os criativos por plano e ângulo, com o formato. Ao
 * abrir um, a arte no motor do Estúdio (ArteDoCriativo), a copy do anúncio
 * ao lado com a prévia no feed, o status (rascunho, pronto, no ar) e o
 * vínculo com o anúncio real no Meta (ad_id de ads_creatives).
 */

export function SeloDoStatus({ status }: { status: StatusDoCriativo }) {
  const s = STATUS_DO_CRIATIVO.find((x) => x.valor === status) || STATUS_DO_CRIATIVO[0];
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium ${s.tom}`}>{s.rotulo}</span>;
}

/** Nome do criativo: o dado, senão o ângulo do plano e o formato. */
export function nomeDoCriativo(c: CriativoAds, planos: PlanoAds[]): string {
  if (c.nome) return c.nome;
  const plano = planos.find((p) => p.id === c.plano_id);
  const angulo = plano ? plano.angulos.find((a) => a.id === c.angulo_id) : null;
  return `${angulo ? angulo.nome : "Criativo"} · ${formatoDe(c.formato).curto}`;
}

interface Grupo {
  chave: string;
  titulo: string;
  criativos: CriativoAds[];
}

function agrupar(criativos: CriativoAds[], planos: PlanoAds[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const c of criativos) {
    const plano = planos.find((p) => p.id === c.plano_id);
    const angulo = plano ? plano.angulos.find((a) => a.id === c.angulo_id) : null;
    const chave = `${c.plano_id || "-"}:${c.angulo_id || "-"}`;
    let g = grupos.find((x) => x.chave === chave);
    if (!g) {
      g = { chave, titulo: `${plano ? plano.nome : "Sem plano"}${angulo ? ` · ${angulo.nome}` : ""}`, criativos: [] };
      grupos.push(g);
    }
    g.criativos.push(c);
  }
  return grupos;
}

export default function AbaEstudioAds({
  criativoId,
  onCriativo,
  planoId,
  onVerTodos,
}: {
  criativoId: string | null;
  onCriativo: (id: string | null) => void;
  /** Plano em foco (vindo de "Produzir criativos"): a lista mostra só ele. */
  planoId: string | null;
  onVerTodos?: () => void;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const criativos = useQuery({ queryKey: chavesAds.criativos(clientId), queryFn: () => lerCriativos(clientId) });
  const planos = useQuery({ queryKey: chavesAds.planos(clientId), queryFn: () => lerPlanos(clientId) });
  const anuncios = useQuery({ queryKey: chavesAds.anuncios(clientId), queryFn: () => lerAnunciosDoCliente(clientId) });
  const listaDePlanos = planos.data || [];
  const todos = criativos.data || [];
  const doPlano = planoId ? todos.filter((c) => c.plano_id === planoId) : todos;
  const visiveis = doPlano.length ? doPlano : todos;
  const idsDosTrabalhos = useMemo(() => visiveis.map((c) => c.trabalho_id).filter(Boolean).sort() as string[], [visiveis]);
  const temTrabalhos = visiveis.some((c) => !!c.trabalho_id);
  const trabalhos = useQuery({
    queryKey: chavesAds.trabalhos(clientId).concat([idsDosTrabalhos.join(",")]),
    enabled: idsDosTrabalhos.length > 0,
    queryFn: () => lerTrabalhos(idsDosTrabalhos),
    // Direção ainda montando: relê até ela chegar.
    refetchInterval: (q) => {
      const dados = (q.state.data || []) as any[];
      return temTrabalhos && dados.some((t) => !(t.direcao && Array.isArray(t.direcao.cards) && t.direcao.cards.length)) ? 8000 : false;
    },
  });
  const trabalhoDe = (c: CriativoAds): Trabalho | null =>
    c.trabalho_id ? (((trabalhos.data || []) as any[]).find((t) => t.id === c.trabalho_id) as Trabalho) || null : null;

  const aberto = visiveis.find((c) => c.id === criativoId) || visiveis[0] || null;
  const trabalho = aberto ? trabalhoDe(aberto) : null;
  const grupos = agrupar(visiveis, listaDePlanos);

  const atualizarTrabalhos = () => {
    void queryClient.invalidateQueries({ queryKey: chavesAds.trabalhos(clientId) });
  };

  const mudar = async (c: CriativoAds, campos: { status?: StatusDoCriativo; ad_id?: string | null }, aviso: string) => {
    const chave = chavesAds.criativos(clientId);
    const antes = queryClient.getQueryData<CriativoAds[]>(chave);
    queryClient.setQueryData<CriativoAds[]>(chave, (l) => (l || []).map((x) => (x.id === c.id ? { ...x, ...campos } : x)));
    try {
      await mudarCriativo(c.id, campos);
      toast.success(aviso);
    } catch (e) {
      queryClient.setQueryData(chave, antes);
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
    }
  };

  if (criativos.isLoading) return <div className="h-[60vh] animate-pulse rounded-xl bg-muted/70" />;
  if (criativos.isError) return <AvisoDeErro erro={criativos.error} />;
  if (!todos.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <Clapperboard className="mx-auto h-6 w-6 text-primary" />
        <p className="mt-3 text-[14px] font-medium">Nenhum criativo produzido ainda</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">No Plano de teste, escolha os ângulos e os formatos e use "Produzir criativos".</p>
      </div>
    );
  }

  const listaDeAnuncios = anuncios.data || [];
  const anuncioLigado = aberto && aberto.ad_id ? listaDeAnuncios.find((a) => a.ad_id === aberto.ad_id) : null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_360px]">
      <aside className="min-w-0 lg:sticky lg:top-[140px] lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto" aria-label="Criativos">
        {planoId && doPlano.length > 0 && doPlano.length < todos.length && (
          <p className="mb-2 text-[11.5px] text-muted-foreground">
            Só do plano em foco ({doPlano.length} de {todos.length}).{" "}
            {onVerTodos && (
              <button type="button" className="text-primary hover:underline" onClick={onVerTodos}>
                Ver todos
              </button>
            )}
          </p>
        )}
        {grupos.map((g) => (
          <div key={g.chave} className="mb-3">
            <p className="mb-1.5 truncate px-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground" title={g.titulo}>{g.titulo}</p>
            <ul className="space-y-1">
              {g.criativos.map((c) => {
                const ativo = aberto && aberto.id === c.id;
                const capa = capaDoTrabalho(trabalhoDe(c));
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onCriativo(c.id)}
                      aria-current={ativo ? "true" : undefined}
                      className={`flex w-full min-w-0 items-center rounded-lg border p-1.5 text-left transition-colors ${ativo ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
                    >
                      <span className="mr-2 block h-12 w-10 shrink-0 overflow-hidden rounded-md bg-secondary">
                        {capa ? <ImagemDaMesa caminho={capa} alt="" className="h-full w-full" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{nomeDoCriativo(c, listaDePlanos)}</span>
                        <span className="mt-0.5 flex items-center">
                          <span className="mr-1.5 text-[11px] text-muted-foreground">{formatoDe(c.formato).curto}</span>
                          <SeloDoStatus status={c.status} />
                          {c.ad_id && <Link2 className="ml-1 h-3 w-3 text-success" aria-label="ligado a um anúncio" />}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </aside>

      {aberto && (
        <>
          <div className="min-w-0 space-y-3">
            <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
              <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold" title={nomeDoCriativo(aberto, listaDePlanos)}>{nomeDoCriativo(aberto, listaDePlanos)}</h2>
                <p className="text-[11.5px] text-muted-foreground">
                  {formatoDe(aberto.formato).rotulo}
                  {anuncioLigado ? ` · no Meta: ${nomeDoAnuncio(anuncioLigado)}` : aberto.ad_id ? ` · no Meta: ${aberto.ad_id}` : " · sem anúncio ligado"}
                </p>
              </div>
              <label className="mb-1 mr-2 mt-1 flex items-center text-[11.5px] text-muted-foreground">
                <span className="mr-1.5">Status</span>
                <select
                  aria-label="Status do criativo"
                  value={aberto.status}
                  onChange={(e) => void mudar(aberto, { status: e.target.value as StatusDoCriativo }, "Status salvo")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground"
                >
                  {STATUS_DO_CRIATIVO.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
                </select>
              </label>
              <label className="mb-1 mt-1 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
                <span className="mr-1.5 shrink-0">Anúncio</span>
                <select
                  aria-label="Anúncio no Meta"
                  value={aberto.ad_id || ""}
                  disabled={anuncios.isLoading}
                  onChange={(e) => void mudar(aberto, { ad_id: e.target.value || null }, e.target.value ? "Criativo ligado ao anúncio" : "Vínculo desfeito")}
                  className="h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-[12px] text-foreground"
                >
                  <option value="">{anuncios.isLoading ? "Carregando…" : listaDeAnuncios.length ? "Ligar a um anúncio" : "Sem anúncios importados"}</option>
                  {listaDeAnuncios.map((a) => (
                    <option key={a.ad_id} value={a.ad_id}>{nomeDoAnuncio(a)}{a.effective_status ? ` (${a.effective_status.toLowerCase()})` : ""}</option>
                  ))}
                  {aberto.ad_id && !anuncioLigado && <option value={aberto.ad_id}>{aberto.ad_id}</option>}
                </select>
              </label>
            </div>

            {trabalho ? (
              <ArteDoCriativo key={aberto.id} criativo={aberto} trabalho={trabalho} onAtualizar={atualizarTrabalhos} />
            ) : aberto.trabalho_id && (trabalhos.isLoading || trabalhos.isFetching) ? (
              <div className="h-[50vh] animate-pulse rounded-xl bg-muted/70" />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-[13.5px] font-medium">Sem trabalho de arte ligado</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">Produza este ângulo de novo pelo Plano de teste para o diretor montar a direção.</p>
              </div>
            )}
          </div>

          <div className="min-w-0 lg:col-span-2 xl:col-span-1">
            <PainelDaCopy key={aberto.id} criativo={aberto} caminhoDaArte={capaDoTrabalho(trabalho)} />
          </div>
        </>
      )}
    </div>
  );
}
