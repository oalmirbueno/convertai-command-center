import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Hammer, Loader2, RotateCcw, Square } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, lista, superficie, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { ehAberto, podeDesfazer, ROTULO_DO_ESTADO, ROTULO_DO_TIPO, type TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { rotuloDaSecao, SECOES_PADRAO } from "../../../supabase/functions/_shared/site-metodo";
import { CHAVES, chamarMotor, type LinhaDoSite, previaAtual, secoesConstruidas, useEventos, useTrabalhos } from "./siteApi";
import SeletorDoMotor from "./SeletorDoMotor";
import PreviaNosAparelhos from "./PreviaNosAparelhos";
import Versoes from "./Versoes";
import { mapaDoSite, secoesDoMapa } from "../../../supabase/functions/_shared/site-biblioteca";

const TOM: Record<string, string> = {
  na_fila: "bg-muted text-muted-foreground",
  executando: "bg-primary/10 text-primary",
  parando: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  feito: "bg-primary/10 text-primary",
  falhou: "bg-destructive/10 text-destructive",
  parado: "bg-muted text-foreground",
  cancelado: "bg-muted text-muted-foreground",
};

export function SeloDoTrabalho({ t }: { t: Pick<TrabalhoDoMotor, "estado"> }) {
  return <span className={juntar(etiqueta, TOM[t.estado] || TOM.na_fila)}>{ROTULO_DO_ESTADO[t.estado]}</span>;
}

/**
 * Etapa 6: construção. O motor de código (opencode no worker da agência)
 * constrói uma seção por vez, com commit por passo; a prévia é ao vivo
 * (Vite + túnel). Custo antes (estimativa e teto reservado), Parar a qualquer
 * momento e Desfazer (volta o commit). SIT2: as seções vêm do mapa, a prévia
 * troca entre celular, tablet e computador, e as versões comparam e voltam.
 */
export default function EtapaConstrucao({ site }: { site: LinhaDoSite; onIrPara?: (etapa: string) => void }) {
  const { clientId, atualizarCusto } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const trabalhosQ = useTrabalhos(clientId, site.id);
  const trabalhos = trabalhosQ.data ? trabalhosQ.data.trabalhos : [];
  const feitas = secoesConstruidas(trabalhos);
  // SIT2: as seções saem do mapa (páginas na ordem, topo e rodapé globais); site antigo, da direção.
  const secoesDoSite: string[] = site.mapa && Array.isArray((site.mapa as any).paginas) && (site.mapa as any).paginas.length ? secoesDoMapa(mapaDoSite(site)) : Array.isArray(site.direcao.secoes) && site.direcao.secoes.length ? site.direcao.secoes : SECOES_PADRAO.slice();
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [modelo, setModelo] = useState<string>(site.modelo || "");
  const [teto, setTeto] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    setEscolhidas(secoesDoSite.filter((s) => feitas.indexOf(s) < 0));
    // Ao abrir o site e quando uma seção fica pronta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, feitas.join(",")]);

  const estimativa = useQuery({
    queryKey: ["mesa-site", "estimativa", site.id, modelo, escolhidas.join(",")],
    enabled: escolhidas.length > 0,
    queryFn: () => chamarMotor<{ estimativa_usd: number; teto_sugerido_usd: number; livre_usd: number; modelo: { modelo_api: string } | null }>("estimar", { client_id: clientId, tipo: "construir", secoes: escolhidas, modelo_id: modelo || undefined }),
  });
  const tetoUsd = teto.trim() ? Number(teto.replace(",", ".")) : estimativa.data ? estimativa.data.teto_sugerido_usd : 0;

  const selecionado = useMemo(() => trabalhos.find((t) => t.id === aberto) || trabalhos[0] || null, [trabalhos, aberto]);
  const vivo = trabalhosQ.data ? trabalhosQ.data.vivo : false;
  const eventos = useEventos(selecionado, vivo);
  const previa = previaAtual(trabalhos);
  const rodando = trabalhos.some((t) => ehAberto(t.estado));
  const executor = trabalhosQ.data ? trabalhosQ.data.executor : null;

  const reler = () => {
    void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
    atualizarCusto();
  };

  const pedir = async (corpo: Record<string, unknown>, rotulo: string) => {
    setEnviando(true);
    try {
      const d = await chamarMotor<{ trabalho: TrabalhoDoMotor }>("pedir", { client_id: clientId, site_id: site.id, ...corpo });
      setAberto(d.trabalho.id);
      reler();
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setEnviando(false);
    }
  };

  const parar = async (t: TrabalhoDoMotor) => {
    try {
      await chamarMotor("parar", { trabalho_id: t.id });
      reler();
    } catch (e) {
      avisarErro(e, "Não foi possível parar");
    }
  };

  const construir = () => pedir({ tipo: "construir", secoes: escolhidas, teto_usd: tetoUsd, modelo_id: modelo || undefined, instrucao: `Construir ${escolhidas.map(rotuloDaSecao).join(", ")}` }, "A construção não entrou na fila");

  return (
    <div className="min-w-0 space-y-6" data-etapa-construcao="">
      <Secao
        titulo="Construir"
        descricao={vivo ? `Motor ligado${executor && executor.capacidades && executor.capacidades.tunel === false ? " · prévia só local" : ""}` : "Motor desligado: o pedido espera na fila"}
        ajuda="Uma seção por vez, pela fórmula de 6 blocos, com o método da casa (AGENTS.md do projeto) e as regras de licença do kit de motion. O teto fica reservado na carteira enquanto o trabalho roda; o custo real vem do provedor e só ele sai da carteira. O motor roda no worker da agência (workers/motor-codigo)."
        acao={
          <button type="button" className={botao.primario} disabled={enviando || !escolhidas.length || !(tetoUsd > 0) || !!estimativa.isError} onClick={() => void construir()} data-construir="">
            {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Hammer className="mr-1 h-3.5 w-3.5" />}
            Construir{tetoUsd > 0 ? ` · teto ${usd(tetoUsd)}` : ""}
          </button>
        }
      >
        <div className="grid min-w-0 grid-cols-2 gap-1 sm:grid-cols-4">
          {secoesDoSite.map((s) => (
            <label key={s} className="flex min-w-0 cursor-pointer items-center py-1 text-[13px]">
              <input type="checkbox" className="mr-2 shrink-0" checked={escolhidas.indexOf(s) >= 0} onChange={() => setEscolhidas((l) => (l.indexOf(s) >= 0 ? l.filter((x) => x !== s) : secoesDoSite.filter((x) => x === s || l.indexOf(x) >= 0)))} />
              <span className="truncate">{rotuloDaSecao(s)}</span>
              {feitas.indexOf(s) >= 0 && <span className={juntar(etiqueta, "ml-1.5 bg-primary/10 text-primary")}>pronta</span>}
            </label>
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
          <SeletorDoMotor valor={modelo} onChange={setModelo} />
          <label className="block min-w-0">
            <span className={juntar(texto.rotulo, "mb-1 block")}>Teto (US$)</span>
            <input value={teto} onChange={(e) => setTeto(e.target.value)} inputMode="decimal" placeholder={estimativa.data ? String(estimativa.data.teto_sugerido_usd) : "0,50"} className={campo} aria-label="Teto do trabalho em dólar" />
          </label>
          <div className="flex min-w-0 items-end pb-2">
            <span className={juntar(texto.auxiliar, "truncate")}>
              {estimativa.isLoading ? "Estimando..." : estimativa.data ? `Estimativa ${usd(estimativa.data.estimativa_usd)} · livre na carteira ${usd(estimativa.data.livre_usd)}` : estimativa.isError ? "Sem estimativa (banco ou modelo)" : ""}
            </span>
          </div>
        </div>
      </Secao>

      <div className="grid min-w-0 grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Secao
          titulo="Prévia"
          descricao={previa ? (previa.preview_url && /trycloudflare|https:/.test(previa.preview_url) ? "Ao vivo" : "Só na máquina da agência") : "Sem prévia ainda"}
          recolher="mesa-site:construcao:previa"
          acao={
            previa && previa.preview_url ? (
              <a href={previa.preview_url} target="_blank" rel="noopener noreferrer" className={botao.secundario}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Abrir
              </a>
            ) : null
          }
        >
          {previa && previa.preview_url ? (
            <PreviaNosAparelhos url={previa.preview_url} titulo={site.nome} />
          ) : (
            <EstadoVazio compacto titulo="A prévia aparece quando o motor começa a construir." />
          )}
        </Secao>

        <Secao titulo="Trabalhos" descricao={rodando ? "Rodando" : `${trabalhos.length}`} recolher="mesa-site:construcao:trabalhos">
          {!trabalhos.length && <EstadoVazio compacto titulo="Nenhum trabalho ainda." />}
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {trabalhos.slice(0, 12).map((t) => (
              <li key={t.id} className={juntar(lista.linha, selecionado && selecionado.id === t.id && lista.destaque)}>
                <button type="button" className="mr-2 min-w-0 flex-1 text-left" onClick={() => setAberto(t.id)}>
                  <span className={juntar(texto.corpo, "block truncate")}>{ROTULO_DO_TIPO[t.tipo]}{t.instrucao ? `: ${t.instrucao}` : ""}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {usd(t.custo_usd)}
                    {t.teto_usd ? ` de ${usd(t.teto_usd)}` : ""}
                  </span>
                </button>
                <SeloDoTrabalho t={t} />
                {ehAberto(t.estado) && t.estado !== "parando" && (
                  <button type="button" className={juntar(botao.icone, "ml-1")} aria-label="Parar" title="Parar" onClick={() => void parar(t)} data-parar="">
                    <Square className="h-4 w-4" />
                  </button>
                )}
                {podeDesfazer(t) && (
                  <button type="button" className={juntar(botao.icone, "ml-1")} aria-label="Desfazer (volta o commit)" title="Desfazer" onClick={() => void pedir({ tipo: "desfazer", alvo_trabalho_id: t.id, instrucao: `Desfazer ${ROTULO_DO_TIPO[t.tipo].toLowerCase()}` }, "O desfazer não entrou na fila")}>
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {selecionado && (
            <div className="border-t border-border pt-3" data-eventos-do-trabalho="">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Passo a passo</span>
              <ol className="space-y-1">
                {(eventos.data || []).slice(-40).map((e) => (
                  <li key={e.id} className={juntar(texto.auxiliar, "flex min-w-0 whitespace-normal", e.tipo === "erro" && "text-destructive")}>
                    <span className="mr-2 shrink-0 tabular-nums">{new Date(e.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="min-w-0">{e.resumo}</span>
                  </li>
                ))}
              </ol>
              {selecionado.erro && <p className={juntar(texto.auxiliar, "mt-2 whitespace-normal text-destructive")}>{selecionado.erro}</p>}
            </div>
          )}
        </Secao>
      </div>

      <Versoes site={site} trabalhos={trabalhos} />
    </div>
  );
}
