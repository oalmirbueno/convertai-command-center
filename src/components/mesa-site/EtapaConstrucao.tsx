import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Hammer, Loader2, RotateCcw, Square } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { nomeDoModelo, usd } from "@/lib/mesa/api";
import { ehAberto, podeDesfazer, ROTULO_DO_ESTADO, ROTULO_DO_TIPO, type TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { rotuloDaSecao, SECOES_PADRAO } from "../../../supabase/functions/_shared/site-metodo";
import { CHAVES, chamarMotor, type EventoDoMotor, type LinhaDoSite, previaAtual, secoesConstruidas, useEventos, useSalvarSite, useTrabalhos } from "./siteApi";
import SeletorDoMotor from "./SeletorDoMotor";
import PreviaNosAparelhos from "./PreviaNosAparelhos";
import Versoes from "./Versoes";
import { mapaDoSite, secoesDoMapa } from "../../../supabase/functions/_shared/site-biblioteca";
import { useBarraDaEtapa } from "./BarraDaEtapa";

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
 * Rótulo do Construir (UXS 30/09): "o que falta" quando a seleção é
 * exatamente o que falta; "N seções" quando foi mexida; "Tudo construído"
 * quando não há o que construir.
 */
export function rotuloDoConstruir(escolhidas: string[], faltando: string[], tetoUsd: number): string {
  const teto = tetoUsd > 0 ? ` · teto ${usd(tetoUsd)}` : "";
  if (!escolhidas.length) return faltando.length ? "Construir" : "Tudo construído";
  const igual = escolhidas.length === faltando.length && escolhidas.every((s) => faltando.indexOf(s) >= 0);
  return igual ? `Construir o que falta${teto}` : `Construir ${escolhidas.length} ${escolhidas.length === 1 ? "seção" : "seções"}${teto}`;
}

/**
 * Etapa 6: construção. O motor de código (opencode no worker da agência)
 * constrói uma seção por vez, com commit por passo; a prévia é ao vivo
 * (Vite + túnel). Custo antes (estimativa e teto reservado), Parar a qualquer
 * momento e Desfazer (volta o commit). SIT2: as seções vêm do mapa, a prévia
 * troca entre celular, tablet e computador, e as versões comparam e voltam.
 *
 * UXS 30/09: "Construir o que falta" num clique, com o custo numa linha; as
 * seções, o modelo (salvo no site ao trocar: aqui é o único lugar dele) e o
 * teto ficam em "Mais opções", com o resumo à vista. O passo a passo abre com
 * trabalho rodando, com falha ou quando se clica num trabalho; o que falhou
 * ganha "Tentar de novo" (construir leva ao botão; ajustar vira pedido ao
 * diretor de site; revisar pede de novo, sem custo).
 */
export default function EtapaConstrucao({ site, onPedirAoDiretor }: { site: LinhaDoSite; onIrPara?: (etapa: string) => void; onPedirAoDiretor?: (texto: string) => void }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const trabalhosQ = useTrabalhos(clientId, site.id);
  const trabalhos = trabalhosQ.data ? trabalhosQ.data.trabalhos : [];
  const feitas = secoesConstruidas(trabalhos);
  // SIT2: as seções saem do mapa (páginas na ordem, topo e rodapé globais); site antigo, da direção.
  const secoesDoSite: string[] = site.mapa && Array.isArray((site.mapa as any).paginas) && (site.mapa as any).paginas.length ? secoesDoMapa(mapaDoSite(site)) : Array.isArray(site.direcao.secoes) && site.direcao.secoes.length ? site.direcao.secoes : SECOES_PADRAO.slice();
  const faltando = secoesDoSite.filter((s) => feitas.indexOf(s) < 0);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [modelo, setModelo] = useState<string>(site.modelo || "");
  const [teto, setTeto] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [passoAPasso, setPassoAPasso] = useState<boolean | null>(null);
  const [maisRecolhido, setMaisRecolhido] = useRecolhido("mesa-site:construcao:mais", true);
  const botaoConstruir = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setEscolhidas(secoesDoSite.filter((s) => feitas.indexOf(s) < 0));
    // Ao abrir o site e quando uma seção fica pronta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, feitas.join(",")]);
  // O modelo salvo muda por fora (o diretor de site, outra aba): a tela acompanha.
  useEffect(() => {
    setModelo(site.modelo || "");
  }, [site.id, site.modelo]);

  const estimativa = useQuery({
    queryKey: ["mesa-site", "estimativa", site.id, modelo, escolhidas.join(",")],
    enabled: escolhidas.length > 0,
    queryFn: () => chamarMotor<{ estimativa_usd: number; teto_sugerido_usd: number; livre_usd: number; modelo: { modelo_api: string } | null }>("estimar", { client_id: clientId, tipo: "construir", secoes: escolhidas, modelo_id: modelo || undefined }),
  });
  const tetoManual = !!teto.trim();
  const tetoUsd = tetoManual ? Number(teto.replace(",", ".")) : estimativa.data ? estimativa.data.teto_sugerido_usd : 0;

  const selecionado = useMemo(() => trabalhos.find((t) => t.id === aberto) || trabalhos[0] || null, [trabalhos, aberto]);
  // Passo a passo aberto com o trabalho rodando ou com falha; senão, só quando a pessoa pede.
  const passoAberto = passoAPasso !== null ? passoAPasso : !!selecionado && (ehAberto(selecionado.estado) || selecionado.estado === "falhou");
  // Fechado, os eventos não são buscados.
  const vivo = trabalhosQ.data ? trabalhosQ.data.vivo : false;
  const eventos = useEventos(passoAberto ? selecionado : null, vivo);
  const eventosEmCache = selecionado ? qc.getQueryData<EventoDoMotor[]>(CHAVES.eventos(selecionado.id)) : undefined;
  const previa = previaAtual(trabalhos);
  const rodando = trabalhos.some((t) => ehAberto(t.estado));
  const executor = trabalhosQ.data ? trabalhosQ.data.executor : null;
  const modeloEscolhido = modelo ? catalogo.find((m) => m.id === modelo) || null : null;

  const reler = () => {
    void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
    atualizarCusto();
  };

  const pedir = async (corpo: Record<string, unknown>, rotulo: string) => {
    setEnviando(true);
    try {
      const d = await chamarMotor<{ trabalho: TrabalhoDoMotor }>("pedir", { client_id: clientId, site_id: site.id, ...corpo });
      setAberto(d.trabalho.id);
      setPassoAPasso(null);
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

  /** O modelo do motor: aqui é o único lugar; troca salva no site (sem custo, sem Confirmar). */
  const trocarModelo = async (id: string) => {
    if (id === modelo) return;
    const antes = modelo;
    setModelo(id);
    try {
      await salvarSite("site_salvar", { site_id: site.id, modelo: id });
    } catch (e) {
      setModelo(antes);
      avisarErro(e, "O modelo não foi salvo");
    }
  };

  const construir = () => pedir({ tipo: "construir", secoes: escolhidas, teto_usd: tetoUsd, modelo_id: modelo || undefined, instrucao: `Construir ${escolhidas.map(rotuloDaSecao).join(", ")}` }, "A construção não entrou na fila");

  /** "Tentar de novo" do trabalho que falhou: nada volta para a fila sozinho quando custa. */
  const tentarDeNovo = (t: TrabalhoDoMotor) => {
    if (t.tipo === "construir") {
      // As seções que não ficaram prontas já voltam marcadas; o clique que gasta continua sendo o Construir.
      const b = botaoConstruir.current;
      if (b) {
        if (typeof b.scrollIntoView === "function") b.scrollIntoView({ block: "center" });
        b.focus();
      }
      return;
    }
    if (t.tipo === "ajustar") {
      if (onPedirAoDiretor) onPedirAoDiretor(`Tente de novo este ajuste: ${t.instrucao || "ajuste de seção"}.${t.erro ? ` Da outra vez deu erro: ${String(t.erro).slice(-400)}` : ""}`);
      return;
    }
    if (t.tipo === "revisar") void pedir({ tipo: "revisar", instrucao: t.instrucao || "Revisar acessibilidade, celular e SEO" }, "A revisão não entrou na fila");
  };
  const podeTentarDeNovo = (t: TrabalhoDoMotor) => t.estado === "falhou" && (t.tipo === "construir" || t.tipo === "revisar" || (t.tipo === "ajustar" && !!onPedirAoDiretor));

  const linhaDoCusto = !escolhidas.length
    ? faltando.length
      ? "Nenhuma seção marcada"
      : "Tudo construído: para reconstruir, marque em Mais opções"
    : estimativa.isLoading
      ? "Estimando..."
      : estimativa.data
        ? `${escolhidas.length} ${escolhidas.length === 1 ? "seção" : "seções"} · estimativa ${usd(estimativa.data.estimativa_usd)} · teto ${usd(tetoUsd)} · livre ${usd(estimativa.data.livre_usd)}${tetoUsd > estimativa.data.livre_usd ? " · o teto passa do livre" : ""}`
        : estimativa.isError
          ? "Sem estimativa (banco ou modelo)"
          : "";
  const resumoDoMais = [`${feitas.filter((s) => secoesDoSite.indexOf(s) >= 0).length} de ${secoesDoSite.length} prontas`, modeloEscolhido ? nomeDoModelo(modeloEscolhido) : modelo ? "modelo escolhido" : "", tetoManual ? "teto manual" : ""].filter(Boolean).join(" · ");

  const rotuloDoBotao = rotuloDoConstruir(escolhidas, faltando, tetoUsd);
  const corte = rotuloDoBotao.indexOf(" · teto");
  const rotuloPrincipal = corte >= 0 ? rotuloDoBotao.slice(0, corte) : rotuloDoBotao;
  const rotuloDoTeto = corte >= 0 ? rotuloDoBotao.slice(corte) : "";

  useBarraDaEtapa({ estado: rodando ? "Construindo" : `${secoesDoSite.length - faltando.length} de ${secoesDoSite.length} seções prontas`, pendente: faltando.length > 0 });

  return (
    <div className="min-w-0 space-y-6" data-etapa-construcao="">
      <Secao
        titulo="Construir"
        descricao={vivo ? `Motor ligado${executor && executor.capacidades && executor.capacidades.tunel === false ? " · prévia só local" : ""}` : "Motor desligado: o pedido espera na fila"}
        ajuda="Uma seção por vez, pela fórmula de 6 blocos, com o método da casa (AGENTS.md do projeto) e as regras de licença do kit de motion. O teto fica reservado na carteira enquanto o trabalho roda; o custo real vem do provedor e só ele sai da carteira. O motor roda no worker da agência (workers/motor-codigo). As seções, o modelo e o teto ficam em Mais opções."
        acao={
          <button ref={botaoConstruir} type="button" aria-label={rotuloDoBotao} className={faltando.length ? botao.primario : botao.secundario} disabled={enviando || !escolhidas.length || !(tetoUsd > 0) || !!estimativa.isError} onClick={() => void construir()} title={!escolhidas.length && !faltando.length ? "Para reconstruir, marque as seções em Mais opções" : undefined} data-construir="">
            {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Hammer className="mr-1 h-3.5 w-3.5" />}
            {rotuloPrincipal}
            {/* No celular o teto fica só na linha do custo (o botão não passa da borda). */}
            {rotuloDoTeto && <span className="hidden sm:inline">{rotuloDoTeto}</span>}
          </button>
        }
      >
        <p className={juntar(texto.auxiliar, "flex min-w-0 items-center")} data-custo-do-construir="">
          <span className="min-w-0 truncate">{linhaDoCusto}</span>
          {estimativa.isError && escolhidas.length > 0 && (
            <button type="button" className={juntar(botao.discreto, "ml-2 h-6 shrink-0 px-1.5 text-[12px]")} onClick={() => void estimativa.refetch()} data-estimar-de-novo="">
              Tentar de novo
            </button>
          )}
        </p>
        <div className="mt-3 min-w-0" data-mais-opcoes-do-construir="">
          <TituloRecolhivel titulo="Mais opções" recolhido={maisRecolhido} onAlternar={() => setMaisRecolhido(!maisRecolhido)} resumo={resumoDoMais} />
          {!maisRecolhido && (
            <div className="mt-2 min-w-0 space-y-3">
              <div className="grid min-w-0 grid-cols-2 gap-1 sm:grid-cols-4">
                {secoesDoSite.map((s) => (
                  <label key={s} className="flex min-w-0 cursor-pointer items-center py-1 text-[13px]">
                    <input type="checkbox" className="mr-2 shrink-0" checked={escolhidas.indexOf(s) >= 0} onChange={() => setEscolhidas((l) => (l.indexOf(s) >= 0 ? l.filter((x) => x !== s) : secoesDoSite.filter((x) => x === s || l.indexOf(x) >= 0)))} />
                    <span className="truncate">{rotuloDaSecao(s)}</span>
                    {feitas.indexOf(s) >= 0 && <span className={juntar(etiqueta, "ml-1.5 bg-primary/10 text-primary")}>pronta</span>}
                  </label>
                ))}
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
                <SeletorDoMotor valor={modelo} onChange={(id) => void trocarModelo(id)} />
                <label className="block min-w-0">
                  <span className={juntar(texto.rotulo, "mb-1 block")}>Teto (US$)</span>
                  <input value={teto} onChange={(e) => setTeto(e.target.value)} inputMode="decimal" placeholder={estimativa.data ? String(estimativa.data.teto_sugerido_usd) : "0,50"} className={campo} aria-label="Teto do trabalho em dólar" />
                </label>
              </div>
            </div>
          )}
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
                <button
                  type="button"
                  className="mr-2 min-w-0 flex-1 text-left"
                  onClick={() => {
                    setAberto(t.id);
                    setPassoAPasso(true);
                  }}
                >
                  <span className={juntar(texto.corpo, "block truncate")}>{ROTULO_DO_TIPO[t.tipo]}{t.instrucao ? `: ${t.instrucao}` : ""}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {usd(t.custo_usd)}
                    {t.teto_usd ? ` de ${usd(t.teto_usd)}` : ""}
                  </span>
                </button>
                <SeloDoTrabalho t={t} />
                {podeTentarDeNovo(t) && (
                  <button type="button" className={juntar(botao.discreto, "ml-1 h-7 px-1.5 text-[12px]")} disabled={enviando} onClick={() => tentarDeNovo(t)} data-tentar-de-novo={t.tipo}>
                    Tentar de novo
                  </button>
                )}
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
              {/* O erro fica sempre à vista, fora do recolhido. */}
              {selecionado.erro && <p className={juntar(texto.auxiliar, "mb-2 whitespace-normal text-destructive")}>{selecionado.erro}</p>}
              <TituloRecolhivel
                titulo={passoAberto ? "Passo a passo" : `Ver passo a passo${eventosEmCache && eventosEmCache.length ? ` (${eventosEmCache.length})` : ""}`}
                recolhido={!passoAberto}
                onAlternar={() => setPassoAPasso(!passoAberto)}
              />
              {passoAberto && (
                <ol className="mt-1 space-y-1">
                  {eventos.isLoading && <li className={texto.auxiliar}>Lendo os passos</li>}
                  {(eventos.data || []).slice(-40).map((e) => (
                    <li key={e.id} className={juntar(texto.auxiliar, "flex min-w-0 whitespace-normal", e.tipo === "erro" && "text-destructive")}>
                      <span className="mr-2 shrink-0 tabular-nums">{new Date(e.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      <span className="min-w-0">{e.resumo}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </Secao>
      </div>

      <Versoes site={site} trabalhos={trabalhos} />
    </div>
  );
}
