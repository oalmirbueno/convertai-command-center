import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Megaphone, X } from "lucide-react";
import { toast } from "sonner";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { botao, CabecalhoDeSecao, Carregando, EstadoVazio, juntar, texto } from "@/components/sistema";
import { chavesAds } from "./adsApi";
import {
  chavesDaCampanhaMesa,
  faseEData,
  lerCampanhasComPecas,
  lerPecasDaCampanhaMesa,
  ROTULO_DO_TIPO,
  usarComoCriativos,
  type PecaDaCampanhaAds,
} from "./campanhaDaMesaApi";

/**
 * "Peças da campanha X" no Estúdio Ads (22/10/2026): as artes prontas da campanha da Mesa (posts, carrosséis
 * e stories 9:16) como criativos selecionáveis, com a fase e a data de cada uma. "Usar como criativo" registra
 * o criativo apontando para o mesmo trabalho do Estúdio (sem copiar arquivo) e abre o primeiro; a copy do
 * anúncio sai do "Refinar copy" (custo antes), que parte da copy da peça e do briefing da campanha. Grátis.
 */

export const AVISO_DA_CAMPANHA =
  "Cada peça vira um criativo com a mesma arte (nada é copiado). A copy começa pela legenda da peça e o CTA do briefing; o Refinar copy reescreve para anúncio, com o custo antes. Na Meta, o anúncio sobe pausado e só com a sua aprovação.";

export default function PecasDaCampanha({
  campanhaId,
  onFechar,
  onAbrirCriativo,
  aoMudarAltura,
}: {
  campanhaId: string;
  onFechar: () => void;
  onAbrirCriativo: (id: string) => void;
  /** A grade do Estúdio mede a altura que cabe de novo quando o painel muda de tamanho. */
  aoMudarAltura?: () => void;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [usando, setUsando] = useState(false);
  const leitura = useQuery({
    queryKey: chavesDaCampanhaMesa.pecas(clientId, campanhaId),
    queryFn: () => lerPecasDaCampanhaMesa(clientId, campanhaId),
    staleTime: 30_000,
  });
  const campanha = leitura.data ? leitura.data.campanha : null;
  const pecas = leitura.data ? leitura.data.pecas : [];
  const livres = pecas.filter((p) => !p.criativo_id);
  const marcadas = livres.filter((p) => escolhidas.indexOf(p.chave) >= 0);
  useEffect(() => {
    if (!aoMudarAltura) return;
    const t = window.setTimeout(aoMudarAltura, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leitura.status, pecas.length]);

  const alternar = (p: PecaDaCampanhaAds) =>
    setEscolhidas((l) => (l.indexOf(p.chave) >= 0 ? l.filter((x) => x !== p.chave) : l.concat([p.chave])));

  const usar = async (lista: PecaDaCampanhaAds[]) => {
    if (!lista.length || usando) return;
    setUsando(true);
    try {
      const r = await usarComoCriativos(clientId, campanhaId, lista);
      const novos = r && Array.isArray(r.criativos) ? r.criativos : [];
      setEscolhidas([]);
      await queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
      void queryClient.invalidateQueries({ queryKey: chavesDaCampanhaMesa.pecas(clientId, campanhaId) });
      if (novos.length) {
        toast.success(novos.length === 1 ? "Peça virou criativo" : `${novos.length} peças viraram criativos`, { description: AVISO_DA_CAMPANHA });
        onAbrirCriativo(novos[0].id);
      } else if (r && Array.isArray(r.ja_existiam) && r.ja_existiam.length) {
        toast.info("Essas peças já eram criativos");
        onAbrirCriativo(r.ja_existiam[0]);
      }
    } catch (e) {
      avisarErro(e, "As peças não viraram criativos");
    } finally {
      setUsando(false);
    }
  };

  const titulo = campanha ? `Peças da campanha ${campanha.nome}` : "Peças da campanha";
  const fechar = (
    <button type="button" className={botao.icone} onClick={onFechar} aria-label="Fechar as peças da campanha" title="Fechar as peças da campanha">
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    <section className="min-w-0 border-b border-border pb-4" aria-label="Peças da campanha" data-pecas-da-campanha={campanhaId}>
      <CabecalhoDeSecao
        nivel={3}
        icone={<Megaphone className="h-4 w-4 text-primary" aria-hidden="true" />}
        titulo={titulo}
        truncar
        ajuda={AVISO_DA_CAMPANHA}
        descricao={
          leitura.isLoading
            ? "Lendo as peças…"
            : campanha
              ? `${pecas.length} pronta${pecas.length === 1 ? "" : "s"}${pecas.length - livres.length ? ` · ${pecas.length - livres.length} já ${pecas.length - livres.length === 1 ? "é criativo" : "são criativos"}` : ""}`
              : undefined
        }
        acao={
          <>
            {livres.length > 0 && (
              <button
                type="button"
                className={juntar(marcadas.length ? botao.primario : botao.secundario, "mr-1 h-8")}
                disabled={usando || !marcadas.length}
                onClick={() => void usar(marcadas)}
                title={AVISO_DA_CAMPANHA}
                aria-label={`Usar como criativo${marcadas.length ? ` (${marcadas.length})` : ""}`}
                data-usar-como-criativo=""
              >
                {usando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                Usar<span className="hidden sm:inline">&nbsp;como criativo</span>
                {marcadas.length ? ` (${marcadas.length})` : ""}
              </button>
            )}
            {fechar}
          </>
        }
      />
      {leitura.isLoading ? (
        <Carregando forma="grade" rotulo="Lendo as peças da campanha" className="mt-3" />
      ) : leitura.isError ? (
        <EstadoVazio compacto titulo="As peças da campanha não foram lidas agora." descricao="Tente de novo em instantes." className="mt-3" />
      ) : !campanha ? (
        <EstadoVazio compacto titulo="Campanha não encontrada para este cliente." className="mt-3" />
      ) : !pecas.length ? (
        <EstadoVazio compacto titulo="Nenhuma peça pronta nesta campanha ainda." descricao="Gere as artes na campanha da Mesa e volte aqui." className="mt-3" />
      ) : (
        <>
          {livres.length > 1 && (
            <p className={juntar(texto.auxiliar, "mt-2")}>
              <button type="button" className="text-primary hover:underline" onClick={() => setEscolhidas(marcadas.length === livres.length ? [] : livres.map((p) => p.chave))}>
                {marcadas.length === livres.length ? "Desmarcar todas" : "Marcar todas"}
              </button>
            </p>
          )}
          <ul className="mt-2 grid min-w-0 grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10" aria-label="Peças prontas da campanha">
            {pecas.map((p) => {
              const marcada = escolhidas.indexOf(p.chave) >= 0;
              const quando = faseEData(p.fase, p.data);
              return (
                <li key={p.chave} className="min-w-0" data-peca={p.chave} data-tipo-da-peca={p.tipo}>
                  <button
                    type="button"
                    className={juntar("block w-full min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", p.criativo_id && "cursor-default")}
                    aria-pressed={p.criativo_id ? undefined : marcada}
                    aria-label={p.criativo_id ? `${p.titulo}: já é criativo` : `${marcada ? "Desmarcar" : "Marcar"} ${p.titulo}`}
                    title={p.criativo_id ? "Já é criativo da Mesa Ads" : marcada ? "Desmarcar" : "Marcar para usar como criativo"}
                    onClick={() => (p.criativo_id ? undefined : alternar(p))}
                  >
                    {/* Proporção pelo padding (Safari 11 não tem a proporção nativa): 4:5 no feed e no carrossel, 9:16 nos stories. */}
                    <span
                      className={juntar(
                        "relative block h-0 w-full overflow-hidden rounded-md bg-secondary ring-2",
                        p.formato === "stories_9x16" ? "pb-[177.78%]" : "pb-[125%]",
                        marcada ? "ring-primary" : "ring-transparent",
                      )}
                    >
                      <ImagemDaMesa caminho={p.capa} alt="" className="absolute inset-0 h-full w-full" />
                      {marcada && (
                        <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 block truncate text-[12px] font-medium" title={p.titulo}>{p.titulo}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      {ROTULO_DO_TIPO[p.tipo]}
                      {p.tipo === "carrossel" || p.tipo === "stories" ? ` · ${p.laminas}` : ""}
                      {quando ? ` · ${quando}` : ""}
                    </span>
                  </button>
                  {p.criativo_id && (
                    <button
                      type="button"
                      className="mt-0.5 inline-flex items-center text-[11px] font-medium text-primary hover:underline"
                      onClick={() => onAbrirCriativo(String(p.criativo_id))}
                      title="Abrir o criativo desta peça"
                    >
                      <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" />
                      Já é criativo
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {leitura.data && leitura.data.avisoDosStories && <p className={juntar(texto.auxiliar, "mt-2")}>{leitura.data.avisoDosStories}</p>}
        </>
      )}
    </section>
  );
}

/** "Puxar de uma campanha": as campanhas do cliente com peças prontas. Some quando não há nenhuma. */
export function PuxarDeUmaCampanha({ onEscolher, className = "" }: { onEscolher: (campanhaId: string) => void; className?: string }) {
  const { clientId } = useMesa();
  const lista = useQuery({ queryKey: chavesDaCampanhaMesa.lista(clientId), queryFn: () => lerCampanhasComPecas(clientId), staleTime: 60_000 });
  const campanhas = lista.data || [];
  if (!campanhas.length) return null;
  return (
    <select
      aria-label="Puxar de uma campanha"
      title="Usar as peças prontas de uma campanha da Mesa como criativos"
      value=""
      onChange={(e) => {
        if (e.target.value) onEscolher(e.target.value);
      }}
      className={juntar("h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground sm:max-w-[260px]", className)}
      data-puxar-de-campanha=""
    >
      <option value="">Puxar de uma campanha</option>
      {campanhas.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nome} ({c.prontas} pronta{c.prontas === 1 ? "" : "s"})
        </option>
      ))}
    </select>
  );
}
