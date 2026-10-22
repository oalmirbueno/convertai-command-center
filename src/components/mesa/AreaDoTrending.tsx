import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Newspaper, Search } from "lucide-react";
import CampoDeBusca from "@/components/sistema/CampoDeBusca";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import LinhaDoHypeETrending, { BlocoDaLinha, CabecalhoDaColuna, MenuCriar, MenuDeFiltro, SubtituloDaLista } from "./LinhaDoHypeETrending";
import { COLUNA_DO_HYPE } from "./AreaDoHype";
import { blocoDaData } from "./datasDoHype";
import {
  buscarTrending, CUSTO_DO_JEV_NAS_NOTICIAS_USD, filtrarNoticias, fontesDasNoticias, juntadoDaNoticia, mensagemDaNoticia, podeJuntar, quandoDaNoticia,
  RECENCIAS, separarNoticias, type ItemJuntado, type Noticia, type Recencia,
} from "./hypeETrending";
import { chaves, partesDoPedido, pedidoLivre } from "./mesaV4Api";

/** A busca de notícias em curso (fica na seção: o "Buscar o que está em alta agora" do topo também dispara). */
export interface ConsultaDoTrending {
  clientId: string;
  assunto: string;
  recencia: Recencia;
  /** Muda a cada pedido explícito: a mesma busca refeita relê. */
  vez: number;
}

interface Props {
  consulta: ConsultaDoTrending | null;
  onConsulta: (c: { assunto: string; recencia: Recencia }) => void;
  /** Assuntos prontos para clicar além dos que o servidor sugere (ex.: as próximas datas). */
  assuntosExtras: string[];
  juntando: boolean;
  juntados: ItemJuntado[];
  onAlternar: (item: ItemJuntado) => void;
  onCriarCampanha: (item: ItemJuntado) => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}

const MAXIMO_DE_SUGERIDOS = 4;

/**
 * Em alta (Trending): manchetes reais do Google Notícias, com fonte, data real e link da matéria. Sem assunto,
 * a busca usa o NICHO do cliente (servidor). Cada manchete vem julgada pelo Jev ("cabe no marketing deste
 * cliente?", com o motivo); assunto sensível sai. O que serve aparece primeiro; o que não serve fica em
 * "Mostrar descartadas". O custo do Jev está à vista no botão de buscar. A leitura semanal mora na "Da semana".
 */
export default function AreaDoTrending({ consulta, onConsulta, assuntosExtras, juntando, juntados, onAlternar, onCriarCampanha, onPedidoInicio, onPedidoFim }: Props) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const atual = consulta && consulta.clientId === clientId ? consulta : null;
  const [rascunho, setRascunho] = useState({ clientId, texto: "" });
  const textoDoRascunho = rascunho.clientId === clientId ? rascunho.texto : "";
  const [fonte, setFonte] = useState("");
  const [verDescartadas, setVerDescartadas] = useState(false);
  const custoDaBusca = `~${usd(CUSTO_DO_JEV_NAS_NOTICIAS_USD)}`;
  const recencia: Recencia = atual ? atual.recencia : "7d";

  const noticias = useQuery({
    queryKey: ["mesa", "trending", clientId, atual ? atual.assunto.toLowerCase() : "", recencia, atual ? atual.vez : 0],
    queryFn: () => buscarTrending(clientId, atual ? atual.assunto : "", recencia),
    enabled: !!atual,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const buscar = (assunto: string, r: Recencia = recencia) => {
    setFonte("");
    setVerDescartadas(false);
    setRascunho({ clientId, texto: assunto });
    onConsulta({ assunto: assunto.trim(), recencia: r });
  };

  const dados = noticias.data && atual ? noticias.data : null;
  const agora = Date.now();
  const filtradas = dados ? filtrarNoticias(dados.itens || [], { recencia, fonte }, agora) : [];
  // 21/10 (dono: "tem que fazer sentido pro marketing"): o que não serve fica escondido.
  const { visiveis: itens, descartadas } = separarNoticias(filtradas);
  const fontes = dados ? fontesDasNoticias(dados.itens || []) : [];
  const sugeridos = ((dados && dados.sugeridos) || []).concat(assuntosExtras).filter((a, i, l) => a && l.indexOf(a) === i).slice(0, MAXIMO_DE_SUGERIDOS);
  const marcado = (chave: string) => juntados.some((x) => x.chave === chave);

  const pedir = async (mensagem: string, titulo: string) => {
    if (onPedidoInicio) onPedidoInicio({ mensagem, desde: Date.now() });
    try {
      const data = await pedidoLivre({ clientId, mensagem, hype: { tipo: "nicho", titulo } });
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return data;
    } finally {
      if (onPedidoFim) onPedidoFim();
    }
  };

  const linhaDaNoticia = (n: Noticia) => {
    const item = juntadoDaNoticia(n);
    const b = blocoDaData(n.data.slice(0, 10));
    const recente = agora - Date.parse(n.data) < 24 * 3_600_000;
    const j = n.julgamento;
    return (
      <LinhaDoHypeETrending
        key={item.chave}
        bloco={<BlocoDaLinha dia={b.dia} mes={b.mes} destaque={recente} />}
        titulo={n.titulo}
        apoio={
          <>
            {j && <span className={juntar("block truncate", j.cabe === "serve" ? "text-primary" : "")} data-motivo={j.cabe}>{j.motivo}</span>}
            <span className="block truncate">
              {n.fonte} · {quandoDaNoticia(n.data, agora)} ·{" "}
              <a href={n.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="toque-compacto inline-flex items-center text-primary hover:underline" aria-label={`Abrir a matéria: ${n.titulo}`} title="Abrir a matéria">
                matéria<ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
              </a>
            </span>
          </>
        }
        selo={recente && (!j || j.cabe !== "nao_serve") ? "agora" : null}
        juntando={juntando}
        marcado={marcado(item.chave)}
        podeMarcar={podeJuntar(juntados, item)}
        onMarcar={() => onAlternar(item)}
        criar={<MenuCriar titulo={n.titulo} rotuloDoConteudo="Conteúdo desta notícia" partes={() => partesDoPedido(catalogo, 0)} executar={() => pedir(mensagemDaNoticia(n), n.titulo)} onCampanha={() => onCriarCampanha(item)} />}
      />
    );
  };

  return (
    <div className={COLUNA_DO_HYPE} data-area="trending">
      <CabecalhoDaColuna
        icone={<Newspaper className="h-4 w-4" />}
        titulo="Em alta"
        ajuda="O que está em alta agora: manchetes reais do Google Notícias por assunto, com a fonte, a data da matéria e o link. As notícias saem do nicho do cliente (segmento, contexto da marca e produtos) e o Jev confere se cada uma cabe no marketing dele; assunto sensível (tragédia, crime, política) sai. O que não serve fica em “Mostrar descartadas”. Clique em Criar para fazer um conteúdo ou uma campanha a partir da notícia."
        controles={
          <MenuDeFiltro
            grupos={[
              { rotulo: "Recência", valor: recencia, onEscolher: (v) => buscar(atual ? atual.assunto : textoDoRascunho, v as Recencia), padrao: "7d", opcoes: RECENCIAS.map((r) => ({ valor: r.valor, rotulo: r.valor === "24h" ? "Últimas 24 h" : `Últimos ${r.rotulo}` })) },
              { rotulo: "Fonte", valor: fonte, onEscolher: setFonte, opcoes: [{ valor: "", rotulo: "Todas as fontes" }].concat(fontes.map((f) => ({ valor: f, rotulo: f }))) },
            ]}
          />
        }
        abaixo={
          <>
            <form className="flex min-w-0 items-center" role="search" onSubmit={(e) => { e.preventDefault(); buscar(textoDoRascunho); }}>
              <CampoDeBusca className="mr-2 flex-1" valor={textoDoRascunho} onMudar={(v) => setRascunho({ clientId, texto: v })} placeholder="Assunto (vazio: o nicho do cliente)" rotulo="Assunto das notícias" />
              <button type="submit" className={juntar(botao.secundario, "px-2.5")} aria-label="Buscar notícias" title={`Buscar notícias: o Jev confere se cada uma cabe no marketing do cliente (${custoDaBusca})`}>
                <Search className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">{custoDaBusca}</span>
              </button>
            </form>
            {sugeridos.length > 0 && (
              <div className="-mx-1 mt-1.5 flex min-w-0 flex-wrap" aria-label="Assuntos sugeridos">
                {sugeridos.map((a) => {
                  const ativo = !!atual && atual.assunto.toLowerCase() === a.toLowerCase();
                  return (
                    <button key={a} type="button" onClick={() => buscar(a)} aria-pressed={ativo} className={juntar(botao.barra, "mx-1 h-7 max-w-[11rem]", ativo ? "bg-muted text-foreground" : "")} title={`Buscar notícias de ${a}`}>
                      <span className="truncate">{a}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        }
      />
      <RegiaoRolavel modo="lg" rotulo="Lista do Em alta" className="pb-6 pt-1">
        {!atual && (
          <EstadoVazio
            compacto
            className="mt-3"
            titulo="Notícias em alta agora."
            descricao="Do nicho do cliente, conferidas pelo Jev."
            acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => buscar(textoDoRascunho)} title={`Inclui a conferência do Jev (${custoDaBusca})`}>Buscar o que está em alta<span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">{custoDaBusca}</span></button>}
          />
        )}
        {atual && noticias.isLoading && <Carregando className="pt-3" rotulo="Buscando notícias" linhas={4} />}
        {atual && noticias.isError && (
          <EstadoDeErro
            className="mt-3"
            titulo="Não foi possível buscar as notícias."
            descricao={noticias.error instanceof Error ? noticias.error.message : undefined}
            acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void noticias.refetch()}>Tentar de novo</button>}
          />
        )}
        {dados && dados.sem_assunto && <p className={juntar(texto.auxiliar, "pt-3")}>Escreva um assunto ou escolha um dos sugeridos.</p>}
        {dados && !dados.sem_assunto && (
          <SubtituloDaLista apoio={[`${itens.length} ${itens.length === 1 ? "serve" : "servem"} ao cliente`, dados.fonte || "Google Notícias", typeof dados.custo_usd === "number" && dados.custo_usd > 0 ? `Jev ${usd(dados.custo_usd)}` : ""].filter(Boolean).join(" · ")}>
            <span role="status">“{dados.assunto}”</span>
          </SubtituloDaLista>
        )}
        {dados && !dados.sem_assunto && !itens.length && !noticias.isFetching && (
          <EstadoVazio compacto titulo="Nenhuma notícia nesse período." acao={recencia !== "30d" ? <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => buscar(dados.assunto, "30d")}>Ver 30 dias</button> : undefined} />
        )}
        {itens.length > 0 && <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Notícias em alta">{itens.map(linhaDaNoticia)}</ul>}
        {descartadas.length > 0 && (
          <div className="min-w-0 pt-2">
            <button type="button" className={juntar(botao.barra, "-ml-2")} onClick={() => setVerDescartadas(!verDescartadas)} aria-expanded={verDescartadas}>
              <ChevronDown className={juntar("mr-1 h-3.5 w-3.5 transition-transform", verDescartadas ? "rotate-180" : "")} aria-hidden="true" />
              {verDescartadas ? "Esconder descartadas" : `Mostrar descartadas (${descartadas.length})`}
            </button>
            {verDescartadas && <ul className={juntar(lista.aberta, lista.divisoria, "opacity-70")} aria-label="Notícias descartadas">{descartadas.map(linhaDaNoticia)}</ul>}
          </div>
        )}
      </RegiaoRolavel>
    </div>
  );
}
