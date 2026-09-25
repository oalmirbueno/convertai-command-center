import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Link2, Loader2, PackageCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import { chamarFuncao, textoDoErro, type Qualidade } from "@/lib/mesa/api";
import {
  chamarAds,
  chavesAds,
  formatoDe,
  irmaosDoCriativo,
  lerAnunciosDoCliente,
  lerCriativos,
  lerPlanos,
  lerTrabalhos,
  mudarCriativo,
  nomeDoAnuncio,
  partesDaArte,
  partesDoPacote,
  STATUS_DO_CRIATIVO,
  type CriativoAds,
  type PlanoAds,
  type StatusDoCriativo,
} from "./adsApi";
import ArteDoCriativo, { capaDoTrabalho } from "./ArteDoCriativo";
import ResultadoDoCriativo from "./ResultadoDoCriativo";
import { Andamento, pilula, useAndamento } from "./Comuns";
import { laminasSemArte, produzirLamina, situacaoDe, situacaoDoTrabalho, SITUACOES, type EtapaDoLote, type SituacaoDoCriativo } from "./loteDoEstudio";
import PainelDaCopy from "./PainelDaCopy";
import PosicionamentosDoAnuncio from "./PosicionamentosDoAnuncio";
import type { CopyDoAnuncio } from "./adsApi";
import { EnvioAoGestor } from "./PacoteDaCopy";

/**
 * Etapa 4, Estúdio Ads: os criativos por plano e ângulo, cada um com a
 * situação clara (sem arte, gerando, conferindo, corrigindo, pronto,
 * entregue). Em lote: "Gerar todos" (gera, confere e corrige sozinho antes de
 * dar como pronto) e "Entregar ao cliente" (o cliente vê em Documentos >
 * Criativos de anúncio, sem aprovação). Ao abrir um criativo: a arte no
 * motor do Estúdio (ArteDoCriativo) em largura cheia e a copy com o pacote
 * completo ao lado (telas largas) ou embaixo.
 */

export const AVISO_DA_ENTREGA = "O cliente vê em Documentos > Criativos de anúncio.";

export function SeloDoStatus({ status }: { status: StatusDoCriativo }) {
  const s = STATUS_DO_CRIATIVO.find((x) => x.valor === status) || STATUS_DO_CRIATIVO[0];
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium ${s.tom}`}>{s.rotulo}</span>;
}

export function SeloDaSituacao({ situacao }: { situacao: SituacaoDoCriativo }) {
  const s = situacaoDe(situacao);
  const andando = situacao === "gerando" || situacao === "conferindo" || situacao === "corrigindo";
  return (
    <span data-situacao={situacao} className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium ${s.tom}`}>
      {andando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {s.rotulo}
    </span>
  );
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
  plano: string;
  angulo: string;
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
      g = { chave, plano: plano ? plano.nome : "Sem plano", angulo: angulo ? angulo.nome : "Sem ângulo", criativos: [] };
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
  const mesa = useMesa();
  const { clientId, catalogo, clientName } = mesa;
  // Copy ao vivo do painel, para as prévias de posicionamento na faixa de baixo.
  const [copyAoVivo, setCopyAoVivo] = useState<{ id: string; copy: CopyDoAnuncio } | null>(null);
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const criativos = useQuery({ queryKey: chavesAds.criativos(clientId), queryFn: () => lerCriativos(clientId) });
  const planos = useQuery({ queryKey: chavesAds.planos(clientId), queryFn: () => lerPlanos(clientId) });
  const anuncios = useQuery({ queryKey: chavesAds.anuncios(clientId), queryFn: () => lerAnunciosDoCliente(clientId) });
  const [etapas, setEtapas] = useState<Record<string, EtapaDoLote>>({});
  const [filtro, setFiltro] = useState<SituacaoDoCriativo | "">("");
  const [entregando, setEntregando] = useState<string[]>([]);
  const [armado, setArmado] = useState<string | null>(null);
  const [desdeLote, rodarLote] = useAndamento();
  const [desdePacote, rodarPacote] = useAndamento();
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
    // Direção montando ou arte gerando: relê até assentar.
    refetchInterval: (q) => {
      const dados = (q.state.data || []) as any[];
      const montando = dados.some((t) => !(t.direcao && Array.isArray(t.direcao.cards) && t.direcao.cards.length));
      const gerando = dados.some((t) => t.status === "gerando");
      return temTrabalhos && (montando || gerando) ? 8000 : false;
    },
  });
  const trabalhoDe = (c: CriativoAds): Trabalho | null =>
    c.trabalho_id ? (((trabalhos.data || []) as any[]).find((t) => t.id === c.trabalho_id) as Trabalho) || null : null;
  const situacao = (c: CriativoAds): SituacaoDoCriativo => situacaoDoTrabalho(trabalhoDe(c), c.trabalho_id ? etapas[c.trabalho_id] : null);

  const filtrados = filtro ? visiveis.filter((c) => situacao(c) === filtro) : visiveis;
  const aberto = visiveis.find((c) => c.id === criativoId) || filtrados[0] || visiveis[0] || null;
  const trabalho = aberto ? trabalhoDe(aberto) : null;
  const grupos = agrupar(filtrados, listaDePlanos);
  const planoEmFoco = planoId && doPlano.length ? planoId : visiveis.length && visiveis.every((c) => c.plano_id === visiveis[0].plano_id) ? visiveis[0].plano_id : null;

  const semArte = visiveis.filter((c) => {
    const t = trabalhoDe(c);
    return !!t && laminasSemArte(t).length > 0 && !(c.trabalho_id && etapas[c.trabalho_id]);
  });
  const laminasPendentes = semArte.reduce((n, c) => n + laminasSemArte(trabalhoDe(c)).length, 0);
  const prontos = visiveis.filter((c) => situacao(c) === "pronto" && !!c.trabalho_id);
  const contagem = (s: SituacaoDoCriativo) => visiveis.filter((c) => situacao(c) === s).length;
  const primeiroDoLote = semArte.length ? trabalhoDe(semArte[0]) : null;
  const qualidadeDoLote = ((primeiroDoLote && primeiroDoLote.qualidade) as Qualidade) || "media";
  const modeloDoLote = primeiroDoLote ? primeiroDoLote.modelo_imagem_id : null;

  const atualizarTrabalhos = () => {
    void queryClient.invalidateQueries({ queryKey: chavesAds.trabalhos(clientId) });
  };

  const marcar = (trabalhoId: string, e: EtapaDoLote | null) =>
    setEtapas((atual) => {
      const n = { ...atual };
      if (e) n[trabalhoId] = e;
      else delete n[trabalhoId];
      return n;
    });

  const gerarTodos = async () => {
    const fila = semArte.map((c) => ({ c, t: trabalhoDe(c) as Trabalho }));
    fila.forEach(({ t }) => marcar(t.id, "fila"));
    let total = 0;
    let pendentes = 0;
    try {
      for (const { t } of fila) {
        for (const ordem of laminasSemArte(t)) {
          const r = await produzirLamina((corpo) => chamarFuncao<any>("estudio-arte", corpo), t.id, ordem, (e) => marcar(t.id, e));
          total += r.custo_usd;
          if (r.pendencias && r.pendencias.length) pendentes += 1;
          atualizarTrabalhos();
        }
        marcar(t.id, null);
      }
    } finally {
      fila.forEach(({ t }) => marcar(t.id, null));
      atualizarTrabalhos();
    }
    if (pendentes) toast.warning("Arte com ponto a revisar", { description: `${pendentes} lâmina(s) seguem com aviso da conferência. Abra o criativo e use Corrigir de novo.` });
    return { custo_usd: total };
  };

  const entregar = async (lista: CriativoAds[]) => {
    const ids = lista.map((c) => c.id);
    setEntregando((e) => e.concat(ids));
    let ok = 0;
    const falhas: unknown[] = [];
    for (const c of lista) {
      try {
        await chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: c.trabalho_id, nome: nomeDoCriativo(c, listaDePlanos) });
        ok += 1;
      } catch (e) {
        falhas.push(e);
      }
    }
    setEntregando((e) => e.filter((x) => ids.indexOf(x) < 0));
    atualizarTrabalhos();
    if (ok) toast.success(ok === 1 ? "Criativo entregue" : `${ok} criativos entregues`, { description: AVISO_DA_ENTREGA });
    if (falhas.length) avisarErro(falhas[0], falhas.length === 1 ? "Um criativo não foi entregue" : `${falhas.length} criativos não foram entregues`);
  };

  /** Entregar pede um segundo clique (o cliente passa a ver). */
  const armarOuEntregar = (chave: string, lista: CriativoAds[]) => {
    if (armado !== chave) {
      setArmado(chave);
      window.setTimeout(() => setArmado((a) => (a === chave ? null : a)), 6000);
      return;
    }
    setArmado(null);
    void entregar(lista);
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
  // v3: formatos irmãos do criativo aberto (mesmo ângulo e variação) e o ângulo com a meta.
  const irmaos = aberto ? irmaosDoCriativo(aberto, todos).map((c) => ({ criativo: c, trabalho: trabalhoDe(c) })) : [];
  const planoAberto = aberto ? listaDePlanos.find((p) => p.id === aberto.plano_id) || null : null;
  const anguloAberto = aberto && planoAberto ? planoAberto.angulos.find((a) => a.id === aberto.angulo_id) || null : null;
  const anuncioLigado = aberto && aberto.ad_id ? listaDeAnuncios.find((a) => a.ad_id === aberto.ad_id) : null;
  const situacaoAberta = aberto ? situacao(aberto) : "sem_arte";

  return (
    <div className="min-w-0 space-y-4">
      <section className="min-w-0 rounded-xl border border-border bg-card px-4 py-3" aria-label="Produção em lote">
        <div className="flex min-w-0 flex-wrap items-center">
          <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Estúdio Ads</h2>
            <p className="text-[12px] text-muted-foreground">
              {visiveis.length} criativo{visiveis.length === 1 ? "" : "s"}
              {planoId && doPlano.length > 0 && doPlano.length < todos.length ? ` do plano em foco (de ${todos.length})` : ""}. A arte só aparece depois de conferida; se o texto, a logo ou a política estiverem errados, ela é corrigida antes.
              {planoId && doPlano.length > 0 && doPlano.length < todos.length && onVerTodos && (
                <>
                  {" "}
                  <button type="button" className="text-primary hover:underline" onClick={onVerTodos}>
                    Ver todos
                  </button>
                </>
              )}
            </p>
          </div>
          <span className="mb-1 mr-2 mt-1 inline-flex items-center">
            <BotaoComCusto
              rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Gerar todos{laminasPendentes ? ` (${laminasPendentes})` : ""}</>}
              titulo="Gerar todas as artes"
              descricao="Gera cada lâmina sem arte, confere e corrige sozinho (até 2 vezes) antes de dar como pronta."
              className="h-9"
              disabled={!laminasPendentes || desdeLote !== null}
              partes={() => partesDaArte(catalogo, laminasPendentes, qualidadeDoLote, modeloDoLote)}
              executar={() => rodarLote(gerarTodos)}
            />
          </span>
          <Button
            type="button"
            size="sm"
            variant={armado === "lote" ? "default" : "outline"}
            className="mb-1 mt-1 h-9"
            disabled={!prontos.length || entregando.length > 0}
            onClick={() => armarOuEntregar("lote", prontos)}
            title={`Entrega os criativos prontos sem aprovação. ${AVISO_DA_ENTREGA}`}
          >
            {entregando.length > 0 ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="mr-1 h-3.5 w-3.5" />}
            {armado === "lote" ? `Confirmar entrega de ${prontos.length}` : `Entregar ao cliente${prontos.length ? ` (${prontos.length})` : ""}`}
          </Button>
        </div>
        {desdeLote !== null && <Andamento desde={desdeLote} rotulo="Gerando, conferindo e corrigindo as artes" />}
        <div className="mt-2 flex min-w-0 flex-wrap items-center" role="group" aria-label="Filtrar por situação">
          <button type="button" className={pilula(filtro === "")} onClick={() => setFiltro("")}>
            Todos ({visiveis.length})
          </button>
          {SITUACOES.filter((s) => contagem(s.valor) > 0).map((s) => (
            <button key={s.valor} type="button" className={pilula(filtro === s.valor)} onClick={() => setFiltro(filtro === s.valor ? "" : s.valor)}>
              {s.rotulo} ({contagem(s.valor)})
            </button>
          ))}
        </div>
        {planoEmFoco && (
          <div className="mt-2 flex min-w-0 flex-wrap items-center border-t border-border pt-2">
            <span className="mb-1 mr-2 text-[11.5px] text-muted-foreground">Copy do plano:</span>
            <span className="mb-1 mr-2 inline-flex items-center">
              <BotaoComCusto
                rotulo="Pacote de copy de todos"
                titulo="Pacote de copy do plano"
                descricao="Gera o pacote completo de copy de cada criativo do plano (até o tempo da função acabar; o que faltar fica pendente)."
                variant="outline"
                className="h-8"
                disabled={desdePacote !== null}
                partes={() => partesDoPacote(catalogo, doPlano.length || visiveis.length)}
                executar={() => rodarPacote(() => chamarAds<any>("copy_pacote", { plano_id: planoEmFoco }))}
                aoConcluir={(data) => {
                  void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
                  const pend = data && Array.isArray(data.pendentes) ? data.pendentes.length : 0;
                  if (pend) toast.info("Parte do pacote ficou para depois", { description: `${pend} criativo(s) pendentes. Clique de novo para continuar.` });
                }}
              />
            </span>
            <EnvioAoGestor corpo={() => ({ plano_id: planoEmFoco })} rotulo="Enviar pacote do plano ao gestor" />
            <Andamento desde={desdePacote} rotulo="Escrevendo os pacotes" />
          </div>
        )}
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)_400px]">
        <aside className="min-w-0 lg:sticky lg:top-[140px] lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto" aria-label="Criativos">
          {grupos.length === 0 && <p className="px-1 text-[12px] text-muted-foreground">Nenhum criativo nessa situação.</p>}
          {grupos.map((g) => (
            <div key={g.chave} className="mb-3">
              <p className="truncate px-1 text-[10px] uppercase tracking-wider text-muted-foreground" title={g.plano}>
                {g.plano}
              </p>
              <p className="mb-1.5 truncate px-1 text-[12px] font-semibold" title={g.angulo}>
                {g.angulo}
              </p>
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
                        <span className="mr-2 block h-12 w-10 shrink-0 overflow-hidden rounded-md bg-secondary">{capa ? <ImagemDaMesa caminho={capa} alt="" className="h-full w-full" /> : null}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">{formatoDe(c.formato).rotulo}</span>
                          <span className="mt-0.5 flex min-w-0 flex-wrap items-center">
                            <SeloDaSituacao situacao={situacao(c)} />
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
          <div className="min-w-0 space-y-3">
            <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
              <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
                <div className="flex min-w-0 items-center">
                  <h2 className="min-w-0 truncate text-[15px] font-semibold" title={nomeDoCriativo(aberto, listaDePlanos)}>
                    {nomeDoCriativo(aberto, listaDePlanos)}
                  </h2>
                  <SeloDaSituacao situacao={situacaoAberta} />
                </div>
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
                  {STATUS_DO_CRIATIVO.map((s) => (
                    <option key={s.valor} value={s.valor}>
                      {s.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mb-1 mr-2 mt-1 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
                <span className="mr-1.5 shrink-0">Anúncio</span>
                <select
                  aria-label="Anúncio no Meta"
                  value={aberto.ad_id || ""}
                  disabled={anuncios.isLoading}
                  onChange={(e) => void mudar(aberto, { ad_id: e.target.value || null }, e.target.value ? "Criativo ligado ao anúncio" : "Vínculo desfeito")}
                  className="h-8 min-w-0 max-w-[200px] rounded-md border border-input bg-background px-2 text-[12px] text-foreground"
                >
                  <option value="">{anuncios.isLoading ? "Carregando…" : listaDeAnuncios.length ? "Ligar a um anúncio" : "Sem anúncios importados"}</option>
                  {listaDeAnuncios.map((a) => (
                    <option key={a.ad_id} value={a.ad_id}>
                      {nomeDoAnuncio(a)}
                      {a.effective_status ? ` (${a.effective_status.toLowerCase()})` : ""}
                    </option>
                  ))}
                  {aberto.ad_id && !anuncioLigado && <option value={aberto.ad_id}>{aberto.ad_id}</option>}
                </select>
              </label>
              {situacaoAberta === "pronto" && aberto.trabalho_id && (
                <Button
                  type="button"
                  size="sm"
                  variant={armado === aberto.id ? "default" : "outline"}
                  className="mb-1 mt-1 h-8"
                  disabled={entregando.indexOf(aberto.id) >= 0}
                  onClick={() => armarOuEntregar(aberto.id, [aberto])}
                  title={AVISO_DA_ENTREGA}
                >
                  {entregando.indexOf(aberto.id) >= 0 ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="mr-1 h-3.5 w-3.5" />}
                  {armado === aberto.id ? "Confirmar entrega" : "Entregar ao cliente"}
                </Button>
              )}
              {situacaoAberta === "entregue" && <span className="mb-1 mt-1 text-[11.5px] text-primary">{AVISO_DA_ENTREGA}</span>}
            </div>

            <ResultadoDoCriativo criativo={aberto} angulo={anguloAberto} />

            {trabalho ? (
              <ArteDoCriativo key={aberto.id} criativo={aberto} trabalho={trabalho} onAtualizar={atualizarTrabalhos} irmaos={irmaos} />
            ) : aberto.trabalho_id && (trabalhos.isLoading || trabalhos.isFetching) ? (
              <div className="h-[50vh] animate-pulse rounded-xl bg-muted/70" />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-[13.5px] font-medium">Sem trabalho de arte ligado</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">Produza este ângulo de novo pelo Plano de teste para o diretor montar a direção.</p>
              </div>
            )}
          </div>
        )}

        {aberto && (
          <div className="min-w-0 lg:col-start-2 2xl:col-start-auto">
            <PainelDaCopy key={aberto.id} criativo={aberto} caminhoDaArte={capaDoTrabalho(trabalho)} nome={nomeDoCriativo(aberto, listaDePlanos)} aoMudarCopy={(c) => setCopyAoVivo({ id: aberto.id, copy: c })} />
          </div>
        )}
      </div>

      {aberto && (
        // Posicionamentos numa faixa larga embaixo, lado a lado, em tamanho de celular.
        <div className="min-w-0 rounded-xl border border-border bg-card p-3 lg:ml-[266px] 2xl:ml-[276px]">
          <PosicionamentosDoAnuncio
            copy={copyAoVivo && copyAoVivo.id === aberto.id ? copyAoVivo.copy : aberto.copy}
            caminho={capaDoTrabalho(trabalho)}
            formato={aberto.formato}
            nome={clientName}
          />
        </div>
      )}
    </div>
  );
}
