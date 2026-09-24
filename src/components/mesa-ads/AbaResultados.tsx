import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, padraoPara, textoDoErro } from "@/lib/mesa/api";
import {
  brl,
  chamarAds,
  chavesAds,
  decimal,
  formatoDe,
  inteiro,
  lerAprendizados,
  lerCriativos,
  lerPlanos,
  mudarCriativo,
  nomeDoAnuncio,
  normalizarResultados,
  porcento,
  type LinhaDeResultado,
} from "./adsApi";
import { nomeDoCriativo } from "./AbaEstudioAds";
import { Diagnostico } from "./Comuns";

export { Diagnostico };

/**
 * Etapa 5, Resultados: métricas reais por criativo ligado (resultados_ler,
 * grátis), com o diagnóstico de cada um pela tabela do dossiê e o registro
 * do aprendizado (E3; E4 quando confirma em nova janela). Anúncios do cliente
 * sem vínculo aparecem para ligar a um criativo.
 */

export const PERIODOS = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 14, rotulo: "14 dias" },
  { dias: 30, rotulo: "30 dias" },
];

const dataIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function periodoDosUltimos(dias: number, hoje = new Date()): { inicio: string; fim: string } {
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const inicio = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() - (dias - 1));
  return { inicio: dataIso(inicio), fim: dataIso(fim) };
}

const COLUNAS: { chave: keyof LinhaDeResultado["metricas"]; rotulo: string; formato: (v: number | null | undefined) => string }[] = [
  { chave: "gasto", rotulo: "Gasto", formato: brl },
  { chave: "impressoes", rotulo: "Impressões", formato: inteiro },
  { chave: "ctr_saida", rotulo: "CTR de saída", formato: porcento },
  { chave: "cpc", rotulo: "CPC", formato: brl },
  { chave: "cpm", rotulo: "CPM", formato: brl },
  { chave: "frequencia", rotulo: "Frequência", formato: decimal },
  { chave: "resultados", rotulo: "Resultados", formato: inteiro },
  { chave: "custo_por_resultado", rotulo: "Custo por resultado", formato: brl },
];

export default function AbaResultados() {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [dias, setDias] = useState(14);
  const periodo = periodoDosUltimos(dias);
  const resultados = useQuery({
    queryKey: chavesAds.resultados(clientId, `${periodo.inicio}:${periodo.fim}`),
    queryFn: async () => normalizarResultados(await chamarAds("resultados_ler", { client_id: clientId, periodo_inicio: periodo.inicio, periodo_fim: periodo.fim })),
    staleTime: 10 * 60_000,
  });
  const criativos = useQuery({ queryKey: chavesAds.criativos(clientId), queryFn: () => lerCriativos(clientId) });
  const planos = useQuery({ queryKey: chavesAds.planos(clientId), queryFn: () => lerPlanos(clientId) });
  const aprendizados = useQuery({ queryKey: chavesAds.aprendizados(clientId), queryFn: () => lerAprendizados(clientId) });
  const [registrando, setRegistrando] = useState<string | null>(null);
  const [textoDoAprendizado, setTextoDoAprendizado] = useState("");
  const [ligando, setLigando] = useState<string | null>(null);

  const dados = resultados.data;
  const listaDeCriativos = criativos.data || [];
  const semAnuncio = listaDeCriativos.filter((c) => !c.ad_id);
  const estrategista = padraoPara(catalogo, "estrategista");

  const ligar = async (adId: string, criativoId: string) => {
    if (!criativoId) return;
    setLigando(adId);
    try {
      await mudarCriativo(criativoId, { ad_id: adId });
      toast.success("Anúncio ligado ao criativo");
      await queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
      await queryClient.invalidateQueries({ queryKey: ["mesa", "ads", "resultados", clientId] });
    } catch (e) {
      toast.error("Não foi possível ligar", { description: textoDoErro(e) });
    } finally {
      setLigando(null);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Resultados</h2>
          <p className="text-[12px] text-muted-foreground">
            Métricas reais dos anúncios ligados aos criativos, de {dataCurta(periodo.inicio)} a {dataCurta(periodo.fim)}. A métrica que decide é a do negócio.
          </p>
        </div>
        <div className="mb-1 mr-2 mt-1 flex items-center rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              role="radio"
              aria-checked={dias === p.dias}
              onClick={() => setDias(p.dias)}
              className={`h-7 rounded-md px-2.5 text-[12px] ${dias === p.dias ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" className="mb-1 mt-1 h-9" disabled={resultados.isFetching} onClick={() => void resultados.refetch()} title="Relê as métricas (sem custo de IA)">
          {resultados.isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      {resultados.isError && <AvisoDeErro erro={resultados.error} />}
      {resultados.isLoading && <div className="h-64 animate-pulse rounded-xl bg-muted/70" />}

      {dados && dados.linhas.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">Nenhum criativo ligado com dados no período</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Ligue os criativos aos anúncios no Estúdio Ads ou aqui embaixo, nos anúncios sem vínculo.</p>
        </div>
      )}

      {dados && dados.linhas.length > 0 && (
        <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[980px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Criativo</th>
                {COLUNAS.map((c) => <th key={c.chave} className="px-2 py-2 text-right font-medium">{c.rotulo}</th>)}
                <th className="px-3 py-2 font-medium">Diagnóstico</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l, i) => {
                const chave = l.criativo_id || l.ad_id || String(i);
                const aberto = registrando === chave;
                return (
                  <Fragment key={chave}>
                    <tr className="border-b border-border align-top last:border-b-0">
                      <td className="max-w-[220px] px-3 py-2.5">
                        <p className="truncate font-medium" title={l.nome}>{l.nome}</p>
                        {l.formato && <p className="text-[11px] text-muted-foreground">{formatoDe(l.formato).rotulo}</p>}
                      </td>
                      {COLUNAS.map((c) => (
                        <td key={c.chave} className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{c.formato(l.metricas[c.chave] as number | null | undefined)}</td>
                      ))}
                      <td className="min-w-[220px] max-w-[320px] px-3 py-2.5"><Diagnostico valor={l.diagnostico} /></td>
                      <td className="px-3 py-2.5 text-right">
                        {l.criativo_id && (
                          <Button type="button" size="sm" variant={aberto ? "secondary" : "outline"} className="h-8 whitespace-nowrap text-[12px]" onClick={() => { setRegistrando(aberto ? null : chave); setTextoDoAprendizado(""); }}>
                            <BookmarkCheck className="mr-1 h-3.5 w-3.5" /> Registrar aprendizado
                          </Button>
                        )}
                      </td>
                    </tr>
                    {aberto && l.criativo_id && (
                      <tr className="border-b border-border bg-muted/40">
                        <td colSpan={COLUNAS.length + 3} className="px-3 py-3">
                          <div className="flex min-w-0 flex-wrap items-end">
                            <Textarea
                              aria-label="Aprendizado"
                              value={textoDoAprendizado}
                              onChange={(e) => setTextoDoAprendizado(e.target.value)}
                              rows={2}
                              placeholder="Opcional: o que aprendemos. Em branco, o estrategista escreve no formato do dossiê a partir das métricas."
                              className="mb-1 mr-2 min-w-[260px] flex-1 text-[12.5px]"
                            />
                            <BotaoComCusto
                              rotulo="Registrar"
                              titulo="Registrar aprendizado"
                              descricao="Grava o aprendizado com as métricas do período (E3; E4 quando confirma em nova janela) e alimenta a memória do estrategista de ads."
                              className="mb-1 h-9"
                              partes={() => [{ modeloId: estrategista ? estrategista.id : null, tipo: "texto", tokensEntrada: 8000, tokensSaida: 1200 }]}
                              executar={() =>
                                chamarAds("aprendizado_registrar", {
                                  criativo_id: l.criativo_id,
                                  periodo_inicio: periodo.inicio,
                                  periodo_fim: periodo.fim,
                                  texto: textoDoAprendizado.trim() || undefined,
                                })
                              }
                              aoConcluir={() => {
                                setRegistrando(null);
                                setTextoDoAprendizado("");
                                void queryClient.invalidateQueries({ queryKey: chavesAds.aprendizados(clientId) });
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dados && dados.sem_vinculo.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4" aria-label="Anúncios sem vínculo">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Anúncios sem vínculo</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">Rodaram no período e não estão ligados a nenhum criativo da Mesa Ads. Ligue para entrarem no diagnóstico.</p>
          <ul className="mt-3 space-y-2">
            {dados.sem_vinculo.map((a) => (
              <li key={a.ad_id} className="flex min-w-0 flex-wrap items-center rounded-lg border border-border px-2.5 py-2">
                <span className="mr-2.5 block h-10 w-10 shrink-0 overflow-hidden rounded-md bg-secondary">
                  {a.thumbnail_url ? <ImagemDaMesa caminho={a.thumbnail_url} alt="" className="h-full w-full" /> : null}
                </span>
                <span className="mr-2 min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{nomeDoAnuncio(a)}</span>
                  <span className="block text-[11px] text-muted-foreground">{a.effective_status ? a.effective_status.toLowerCase() : a.ad_id}</span>
                </span>
                <select
                  aria-label={`Ligar ${nomeDoAnuncio(a)} a um criativo`}
                  value=""
                  disabled={ligando === a.ad_id || semAnuncio.length === 0}
                  onChange={(e) => void ligar(a.ad_id, e.target.value)}
                  className="h-8 max-w-[240px] rounded-md border border-input bg-background px-2 text-[12px]"
                >
                  <option value="">{semAnuncio.length ? "Ligar a um criativo" : "Sem criativo livre"}</option>
                  {semAnuncio.map((c) => <option key={c.id} value={c.id}>{nomeDoCriativo(c, planos.data || [])}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(aprendizados.data || []).length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4" aria-label="Aprendizados registrados">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Aprendizados registrados</h3>
          <ul className="mt-2 space-y-2">
            {(aprendizados.data || []).map((a) => (
              <li key={a.id} className="rounded-lg border border-border px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{a.evidencia} · {dataCurta(a.criado_em)}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{a.texto}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
