import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Flame, Sparkles, TrendingUp } from "lucide-react";
import CampoDeBusca from "@/components/sistema/CampoDeBusca";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { useMesa } from "./MesaContexto";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import LinhaDoHypeETrending, { BlocoDaLinha, CabecalhoDaColuna, Detalhe, AcoesDeCriar, MenuDeFiltro } from "./LinhaDoHypeETrending";
import { COLUNA_DO_HYPE } from "./AreaDoHype";
import { juntadoDaLeitura, podeJuntar, type ItemJuntado } from "./hypeETrending";
import { chaves, mensagemDoHype, partesDoPedido, pedidoLivre, ROTULO_DA_JANELA, type HypesDaSemana } from "./mesaV4Api";
import {
  filtrarTrendy, FILTROS_INICIAIS_DO_TRENDY, fonteDoTrendy, fontesPresentes, formatosPresentes,
  type FiltrosDoTrendy, type FormatoDoTrendy, type ItemDoTrendy, type TipoDoTrendy,
} from "./trendy";

/**
 * Trendy (4ª visão; o do Codex, commit ce942b77, de volta a pedido do dono): busca e filtros LOCAIS sobre a
 * leitura semanal gravada, sem nova chamada de IA. Tipo (momento/nicho), formato (só os que existem nos dados),
 * fonte e a data real da pesquisa. "Criar" mantém o índice original do item para a campanha. Mesma grade e
 * mesma limpeza das outras visões (uma ação "Criar", caixinha só no modo Juntar).
 */
export default function VisaoTrendy({
  dados,
  itens,
  juntando,
  juntados,
  onAlternar,
  onCriarCampanha,
  onPedidoInicio,
  onPedidoFim,
}: {
  dados: HypesDaSemana | null;
  itens: ItemDoTrendy[];
  juntando: boolean;
  juntados: ItemJuntado[];
  onAlternar: (item: ItemJuntado) => void;
  onCriarCampanha: (item: ItemJuntado) => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  // Filtros por cliente: trocar de cliente volta ao começo.
  const [escolha, setEscolha] = useState<{ clientId: string; filtros: FiltrosDoTrendy }>({ clientId, filtros: FILTROS_INICIAIS_DO_TRENDY });
  const filtros = escolha.clientId === clientId ? escolha.filtros : FILTROS_INICIAIS_DO_TRENDY;
  const mudar = (campos: Partial<FiltrosDoTrendy>) => setEscolha({ clientId, filtros: { ...filtros, ...campos } });
  const filtrados = filtrarTrendy(itens, filtros);
  const formatos = formatosPresentes(itens);
  const fontes = fontesPresentes(itens);
  const pesquisadoEm = dados && dados.criado_em ? dados.criado_em.slice(0, 10) : null;
  const dataDaPesquisa = pesquisadoEm ? `pesquisa de ${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)}` : "";
  const temFiltro = filtros.tipo !== "todos" || filtros.formato !== "todos" || !!filtros.fonte || !!filtros.busca.trim();
  const marcado = (chave: string) => juntados.some((x) => x.chave === chave);

  const pedir = async (h: ItemDoTrendy["h"]) => {
    const mensagem = mensagemDoHype(h);
    if (onPedidoInicio) onPedidoInicio({ mensagem, desde: Date.now() });
    try {
      const data = await pedidoLivre({ clientId, mensagem, hype: { tipo: h.tipo, titulo: h.titulo } });
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return data;
    } finally {
      if (onPedidoFim) onPedidoFim();
    }
  };

  return (
    <div className={COLUNA_DO_HYPE} data-area="trendy">
      <CabecalhoDaColuna
        icone={<Sparkles className="h-4 w-4" />}
        titulo="Trendy"
        ajuda="Busca e filtros sobre a leitura semanal já gravada (hypes do momento e em alta no nicho): tipo, formato, fonte e texto. Não faz nova pesquisa nem gasta IA. A data é a da pesquisa."
        controles={
          <MenuDeFiltro
            grupos={[
              { rotulo: "Tipo", valor: filtros.tipo, onEscolher: (v) => mudar({ tipo: v as TipoDoTrendy }), opcoes: [{ valor: "todos", rotulo: "Todos" }, { valor: "momento", rotulo: "Momento" }, { valor: "nicho", rotulo: "Nicho" }] },
              { rotulo: "Formato", valor: filtros.formato, onEscolher: (v) => mudar({ formato: v as FormatoDoTrendy }), opcoes: formatos },
              { rotulo: "Fonte", valor: filtros.fonte, onEscolher: (v) => mudar({ fonte: v }), opcoes: [{ valor: "", rotulo: "Todas as fontes" }].concat(fontes.map((f) => ({ valor: f, rotulo: f }))) },
            ]}
          />
        }
        abaixo={
          <>
            <CampoDeBusca valor={filtros.busca} onMudar={(v) => mudar({ busca: v })} placeholder="Assunto, gancho ou fonte" rotulo="Buscar nas sugestões" />
            {itens.length > 0 && (
              <div className="mt-1.5 flex min-w-0 items-center">
                <p role="status" className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>
                  {filtrados.length} de {itens.length} sugestões{dataDaPesquisa ? ` · ${dataDaPesquisa}` : ""}
                </p>
                {temFiltro && <button type="button" onClick={() => mudar(FILTROS_INICIAIS_DO_TRENDY)} className={juntar(botao.barra, "ml-2 h-7")}>Limpar filtros</button>}
              </div>
            )}
          </>
        }
      />
      <RegiaoRolavel modo="lg" rotulo="Lista do Trendy" className="pb-6 pt-1">
        {!dados && <EstadoVazio compacto className="mt-3" titulo="Nenhuma leitura da semana ainda." descricao="Use “Buscar o que está em alta agora” no topo." />}
        {dados && itens.length > 0 && !filtrados.length && <p className={juntar(texto.auxiliar, "pt-3")}>Nenhuma sugestão com estes filtros.</p>}
        {dados && !itens.length && <p className={juntar(texto.auxiliar, "pt-3")}>As sugestões desta pesquisa já estão na agenda.</p>}
        {filtrados.length > 0 && (
          <ul className={juntar(lista.aberta, lista.divisoria, "pt-1")} aria-label="Sugestões do Trendy">
            {filtrados.map(({ h, indice }) => {
              const item = juntadoDaLeitura(h, indice, pesquisadoEm);
              const fonte = fonteDoTrendy(h);
              const temPauta = !!(h.pauta && h.pauta.tema);
              const tipo = h.tipo === "nicho" ? "nicho" : ROTULO_DA_JANELA[String(h.janela || "")] || "esta semana";
              return (
                <LinhaDoHypeETrending
                  key={item.chave}
                  bloco={<BlocoDaLinha icone={h.tipo === "nicho" ? <TrendingUp className="h-4 w-4" /> : <Flame className="h-4 w-4" />} />}
                  titulo={h.titulo}
                  apoio={[tipo, h.formato ? (h.formato === "estatico" ? "estático" : h.formato) : "", fonte, dataDaPesquisa].filter(Boolean).join(" · ")}
                  nota={typeof h.nota === "number" ? h.nota : null}
                  juntando={juntando}
                  marcado={marcado(item.chave)}
                  podeMarcar={podeJuntar(juntados, item)}
                  onMarcar={() => onAlternar(item)}
                  detalhes={
                    <>
                      {h.sinal && <Detalhe rotulo="Onde está viralizando">{h.sinal}</Detalhe>}
                      {h.o_que_e && <Detalhe rotulo="O que é">{h.o_que_e}</Detalhe>}
                      {h.por_que_agora && <Detalhe rotulo="Por que agora">{h.por_que_agora}</Detalhe>}
                      {h.como_usar && <Detalhe rotulo="Como usar">{h.como_usar}</Detalhe>}
                      {h.cuidado && <Detalhe rotulo="Cuidado">{h.cuidado}</Detalhe>}
                      {temPauta && h.pauta && <Detalhe rotulo="Pauta pronta (sem data)">{h.pauta.tema}{h.pauta.gancho ? ` · capa: ${h.pauta.gancho}` : ""}</Detalhe>}
                      {h.fonte && fonte && (
                        <a href={h.fonte} target="_blank" rel="noopener noreferrer" className="toque-compacto inline-flex max-w-full items-center text-primary hover:underline" aria-label={`Ver fonte de ${h.titulo}`}>
                          <span className="truncate">{fonte}</span><ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                        </a>
                      )}
                    </>
                  }
                  criar={<AcoesDeCriar titulo={h.titulo} rotuloDoConteudo={temPauta ? "Usar a pauta" : "Criar conteúdo"} partes={() => partesDoPedido(catalogo, 0)} executar={() => pedir(h)} onCampanha={() => onCriarCampanha(item)} />}
                />
              );
            })}
          </ul>
        )}
      </RegiaoRolavel>
    </div>
  );
}
