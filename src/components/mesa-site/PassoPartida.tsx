import { useEffect, useState } from "react";
import { ExternalLink, LayoutTemplate, Link as LinkIcone, Sparkles, Star } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { MODOS_DA_REFERENCIA, type ModoDaReferencia, objetivoDoSite, type PartidaDoSite, type TipoDePartida, urlPublicaDaReferencia } from "../../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";
import { jornadaDoSite, useModelosProntos } from "./jornadaApi";
import { useBarraDaEtapa } from "./BarraDaEtapa";
import { opcaoDaGrade } from "./PassoObjetivo";

const PARTIDAS: Array<{ id: TipoDePartida; rotulo: string; descricao: string; Icone: typeof Sparkles }> = [
  { id: "zero", rotulo: "Do zero", descricao: "o motor cria pelo método da casa", Icone: Sparkles },
  { id: "referencia", rotulo: "De uma referência", descricao: "um site que o cliente admira", Icone: LinkIcone },
  { id: "modelo_pronto", rotulo: "De um site pronto", descricao: "um repositório aberto da galeria", Icone: LayoutTemplate },
];

/** O que a tela manda: a partida escolhida, ou o motivo de não dar para seguir. */
export function partidaDaTela(tipo: TipoDePartida | null, url: string, modo: ModoDaReferencia, modeloId: string | null): { partida: PartidaDoSite | null; motivo: string | null } {
  if (!tipo) return { partida: null, motivo: "Escolha por onde começar" };
  if (tipo === "zero") return { partida: { tipo: "zero" }, motivo: null };
  if (tipo === "referencia") {
    const u = urlPublicaDaReferencia(url);
    return u ? { partida: { tipo: "referencia", url: u, modo }, motivo: null } : { partida: null, motivo: "Cole o endereço público da referência (https://...)" };
  }
  return modeloId ? { partida: { tipo: "modelo_pronto", modelo_id: modeloId }, motivo: null } : { partida: null, motivo: "Escolha um site pronto da galeria" };
}

/**
 * Passo 2: por onde começar. Do zero, de uma referência (Fiel, Próximo ou
 * Criativo) ou de um site pronto da galeria (filtrada pelo objetivo e pelo
 * nicho do cliente, com a licença à vista e o Jev recomendando um).
 */
export default function PassoPartida({ site }: { site: LinhaDoSite }) {
  const { clientId, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvar = useSalvarSite(clientId, marca ? marca.id : null);
  const j = jornadaDoSite(site);
  const objetivo = objetivoDoSite(j.objetivo);
  const [tipo, setTipo] = useState<TipoDePartida | null>(j.partida ? j.partida.tipo : null);
  const [url, setUrl] = useState<string>(j.partida && j.partida.url ? j.partida.url : "");
  const [modo, setModo] = useState<ModoDaReferencia>((j.partida && j.partida.modo) || "proximo");
  const [modeloId, setModeloId] = useState<string | null>(j.partida && j.partida.modelo_id ? j.partida.modelo_id : null);
  const [soDoNicho, setSoDoNicho] = useState(true);
  const prontos = useModelosProntos(site.id, j.objetivo, tipo === "modelo_pronto");

  useEffect(() => {
    // A recomendação do Jev já vem marcada quando ninguém escolheu (a equipe troca com um clique).
    if (prontos.data && prontos.data.recomendado && !modeloId) setModeloId(prontos.data.recomendado);
    if (prontos.data && prontos.data.custo_usd > 0) atualizarCusto();
    // Só quando a recomendação chega (ela é cobrada uma vez).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prontos.data]);

  const { partida, motivo } = partidaDaTela(tipo, url, modo, modeloId);
  const salvo = JSON.stringify(j.partida || null);
  const mudou = JSON.stringify(partida || null) !== salvo;
  const gravar = async () => {
    if (!partida) return false;
    if (mudou) await salvar("jornada_salvar", { site_id: site.id, partida });
    return true;
  };
  useBarraDaEtapa(
    { estado: partida ? (PARTIDAS.find((p) => p.id === partida.tipo) || PARTIDAS[0]).rotulo : null, motivo, salvar: true, nadaASalvar: !partida || !mudou },
    { antesDeSeguir: gravar, aoSalvar: gravar },
  );

  const lista = prontos.data ? prontos.data.modelos : [];
  const doNicho = prontos.data ? prontos.data.do_nicho : 0;
  const visiveis = soDoNicho && doNicho > 0 ? lista.slice(0, doNicho) : lista;
  const recomendado = prontos.data ? prontos.data.recomendado : null;
  const modoAtual = MODOS_DA_REFERENCIA.find((m) => m.id === modo) || MODOS_DA_REFERENCIA[1];

  return (
    <div className="mx-auto w-full min-w-0 max-w-[960px] space-y-6" data-passo-partida="">
      <Secao titulo="Por onde começar?" descricao={objetivo ? objetivo.rotulo : "Sem objetivo"} ajuda="Do zero, o motor monta o mapa do objetivo pelo método da casa. De uma referência, ele segue o site que o cliente admira no modo escolhido. De um site pronto, ele parte de um repositório aberto da galeria. Em todos, o texto, as imagens e a marca são do cliente." recolher={false}>
        <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3" data-partidas="">
          {PARTIDAS.map((p) => (
            <li key={p.id} className="min-w-0">
              <button type="button" className={opcaoDaGrade(tipo === p.id)} aria-pressed={tipo === p.id} onClick={() => setTipo(p.id)} data-partida={p.id}>
                <p.Icone className={juntar("mr-3 h-5 w-5 shrink-0", tipo === p.id ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{p.rotulo}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{p.descricao}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Secao>

      {tipo === "referencia" && (
        <Secao titulo="Referência" descricao={modoAtual.rotulo} recolher={false} data-referencia-da-partida="">
          <label className="block min-w-0">
            <span className={juntar(texto.rotulo, "mb-1 block")}>Endereço do site</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://site-que-o-cliente-admira.com.br" className={campo} aria-label="Endereço da referência" data-url-da-referencia="" />
          </label>
          <div className="mt-3 flex min-w-0 flex-wrap items-center" role="radiogroup" aria-label="Modo da referência">
            {MODOS_DA_REFERENCIA.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={modo === m.id} className={juntar(modo === m.id ? botao.primario : botao.secundario, "mb-2 mr-2 h-8")} onClick={() => setModo(m.id)} title={m.descricao} data-modo={m.id}>
                {m.rotulo}
              </button>
            ))}
          </div>
          <p className={juntar(texto.auxiliar, "whitespace-normal")} data-regra-do-modo={modo}>
            {modoAtual.descricao}
          </p>
        </Secao>
      )}

      {tipo === "modelo_pronto" && (
        <Secao
          titulo="Sites prontos"
          descricao={prontos.data ? `${visiveis.length} de ${lista.length}${doNicho ? ` · ${doNicho} do nicho` : ""}${prontos.data.custo_usd > 0 ? ` · Jev ${usd(prontos.data.custo_usd)}` : ""}` : "Lendo a galeria"}
          ajuda="A galeria mostra os repositórios abertos que servem ao objetivo, com os do nicho do cliente primeiro; o Jev recomenda o que mais combina. A licença fica à vista: o motor reaproveita a estrutura e o código que a licença libera, e todo texto, foto e marca são do cliente."
          acao={
            doNicho > 0 && doNicho < lista.length ? (
              <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} aria-pressed={soDoNicho} onClick={() => setSoDoNicho(!soDoNicho)} data-so-do-nicho="">
                {soDoNicho ? "Ver todos" : "Só do nicho"}
              </button>
            ) : null
          }
          recolher={false}
        >
          {prontos.isLoading && <Carregando forma="lista" rotulo="Lendo a galeria" />}
          {prontos.isError && (
            <EstadoDeErro
              titulo="A galeria não abriu."
              acao={
                <button type="button" className={botao.secundario} onClick={() => void prontos.refetch()}>
                  Tentar de novo
                </button>
              }
            />
          )}
          {prontos.data && !lista.length && <EstadoVazio compacto icone={<LayoutTemplate className="h-5 w-5" />} titulo="Nenhum site pronto para este objetivo." descricao="Comece do zero ou de uma referência." />}
          {visiveis.length > 0 && (
            <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-galeria-de-prontos="">
              {visiveis.map((m) => {
                const escolhido = modeloId === m.id;
                return (
                  <li key={m.id} className="min-w-0" data-modelo-pronto={m.id}>
                    <button type="button" className={juntar(opcaoDaGrade(escolhido), "flex-col items-stretch p-2")} aria-pressed={escolhido} onClick={() => setModeloId(m.id)} title={m.descricao}>
                      <span className="block h-[132px] w-full overflow-hidden rounded-md bg-muted/50">
                        {m.miniatura ? <img src={m.miniatura} alt="" loading="lazy" width={400} height={264} className="h-full w-full object-cover object-top" /> : null}
                      </span>
                      <span className="mt-2 flex min-w-0 items-center">
                        <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{m.nome}</span>
                        {recomendado === m.id && (
                          <span className={juntar(etiqueta, "ml-1 shrink-0 bg-primary/10 text-primary")} title="Recomendado pelo Jev para este cliente" data-recomendado="">
                            <Star className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                            Jev
                          </span>
                        )}
                      </span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>{m.descricao}</span>
                      <span className={juntar(texto.auxiliar, "mt-1 block truncate")} data-licenca={m.licenca}>
                        Licença {m.licenca}
                        {m.autor ? ` · ${m.autor}` : ""}
                      </span>
                    </button>
                    <span className="mt-1 flex min-w-0 items-center">
                      {m.previa_url && (
                        <a href={m.previa_url} target="_blank" rel="noopener noreferrer" className={botao.icone} aria-label={`Ver ${m.nome} no ar`} title="Ver o modelo no ar">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                      <a href={m.repositorio} target="_blank" rel="noopener noreferrer" className={juntar(texto.auxiliar, "ml-1 min-w-0 truncate underline-offset-2 hover:underline")} title={`${m.repositorio} (commit ${m.commit.slice(0, 7)})`}>
                        Repositório
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Secao>
      )}
    </div>
  );
}
