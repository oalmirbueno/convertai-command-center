import { useEffect, useState } from "react";
import { LayoutTemplate, Link as LinkIcone, Sparkles } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, espaco, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { MODOS_DA_REFERENCIA, type ModoDaReferencia, objetivoDoSite, type PartidaDoSite, type TipoDePartida, urlPublicaDaReferencia } from "../../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";
import { jornadaDoSite, useModelosProntos } from "./jornadaApi";
import { useBarraDaEtapa } from "./BarraDaEtapa";
import { gradeDeOpcoes, opcaoDaGrade } from "./PassoObjetivo";
import GaleriaDeSitesProntos from "./GaleriaDeSitesProntos";

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
    <div className={espaco.pagina} data-passo-partida="">
      <Secao titulo="Por onde começar?" descricao={objetivo ? objetivo.rotulo : "Sem objetivo"} ajuda="Do zero, o motor monta o mapa do objetivo pelo método da casa. De uma referência, ele segue o site que o cliente admira no modo escolhido. De um site pronto, ele parte de um repositório aberto da galeria. Em todos, o texto, as imagens e a marca são do cliente." recolher={false}>
        <ul className={gradeDeOpcoes} data-partidas="">
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
          {visiveis.length > 0 && <GaleriaDeSitesProntos modelos={visiveis} escolhido={modeloId} recomendado={recomendado} onEscolher={setModeloId} data-galeria-de-prontos="" />}
        </Secao>
      )}
    </div>
  );
}
