import { BriefcaseBusiness, Loader2, Plus, TrendingUp } from "lucide-react";
import BotaoDoConselho from "@/components/conselho/BotaoDoConselho";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar } from "@/components/sistema/estilos";
import { SERVICOS_DA_CASA } from "../../../supabase/functions/mesa-proposta/modulos/proposta-upsell";
import { LinhaDaProposta } from "./AreaDePropostas";
import { enderecoDaProposta, filtrarCarteira, useCriarProposta, usePropostasDoCliente } from "./propostasDaCarteira";

export type ClienteDasAcoes = { id: string; nome: string; services_config?: unknown; plan_name?: string | null; client_type?: string | null };

/** O que a tela sabe do cliente para o conselho (tema e contexto pré-preenchidos, sem inventar número). */
export function contextoDoClienteParaConselho(c: ClienteDasAcoes): string {
  const config = c.services_config && typeof c.services_config === "object" ? (c.services_config as Record<string, unknown>) : {};
  const servicos = Object.keys(SERVICOS_DA_CASA).filter((k) => config[k] === true).map((k) => SERVICOS_DA_CASA[k]);
  const tipo = c.client_type === "one_off" ? "avulso" : c.client_type === "hybrid" ? "híbrido" : "recorrente";
  return `Cliente ${tipo}. Serviços contratados: ${servicos.join(", ") || "nenhum marcado"}. Plano: ${c.plan_name || "sem plano no cadastro"}. Pergunta típica: qual o próximo passo com este cliente (upsell, retenção, proposta nova).`;
}

/**
 * Botões comerciais do cliente (frente PRO3, 30/09), na linha da lista de
 * Clientes e na ficha: "Upsell" cria na hora a proposta de upsell (sem custo;
 * nasce com o que ele já tem e os resultados reais, o toast traz o Desfazer)
 * e o Conselho de agentes (adendo do dono) abre com o tema do cliente.
 */
export function AcoesComerciaisDoCliente({ cliente, onAbrir, semConselho = false }: { cliente: ClienteDasAcoes; onAbrir?: (caminho: string) => void | Promise<void>; semConselho?: boolean }) {
  const { criar, criando } = useCriarProposta(onAbrir);
  return (
    <>
      <button
        type="button"
        className={botao.barra}
        onClick={() => void criar({ clientId: cliente.id, tipo: "upsell" })}
        disabled={!!criando}
        aria-label={`Proposta de upsell para ${cliente.nome}`}
        title="Proposta de upsell"
        data-botao-upsell={cliente.id}
      >
        {criando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="ml-1 hidden xl:inline">Upsell</span>
      </button>
      {!semConselho && (
        <BotaoDoConselho clientId={cliente.id} origem="cliente" tema={`Próximo passo com ${cliente.nome}`} contexto={contextoDoClienteParaConselho(cliente)} referencia={{ tipo: "cliente", id: cliente.id }} />
      )}
    </>
  );
}

/**
 * Seção "Propostas" da ficha do cliente (frente PRO3): o histórico de
 * propostas dele, "Nova proposta" (venda nova para este cliente), "Upsell"
 * e o Conselho. Abrir leva à Mesa Proposta (a ficha fecha antes, pelo
 * `onAbrir` da ficha, que avisa de cadastro não salvo).
 */
export default function PropostasDoCliente({ cliente, onAbrir }: { cliente: ClienteDasAcoes; onAbrir: (caminho: string) => void | Promise<void> }) {
  const propostas = usePropostasDoCliente(cliente.id);
  const { criar, criando } = useCriarProposta(onAbrir);
  const lista = propostas.data ? propostas.data.lista : [];
  const abertas = filtrarCarteira(lista, "abertas").length;
  return (
    <Secao
      titulo="Propostas"
      divisoria
      descricao={propostas.isLoading ? "Lendo" : lista.length ? `${lista.length} no histórico${abertas ? ` · ${abertas} em aberto` : ""}` : "Nenhuma ainda"}
      ajuda="Nova proposta é venda nova para este cliente. Upsell nasce com o que ele já tem (serviços e plano) e os resultados reais; o estrategista sugere o próximo passo. As duas abrem na Mesa Proposta."
      acao={
        <>
          <button type="button" className={botao.secundario} onClick={() => void criar({ clientId: cliente.id, tipo: "nova" })} disabled={!!criando} aria-label="Nova proposta para este cliente">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="ml-1.5 hidden sm:inline">Nova proposta</span>
          </button>
          <AcoesComerciaisDoCliente cliente={cliente} onAbrir={onAbrir} />
        </>
      }
      data-propostas-do-cliente={cliente.id}
    >
      {propostas.isLoading ? (
        <Carregando rotulo="Lendo as propostas" linhas={2} />
      ) : propostas.isError ? (
        <EstadoDeErro
          titulo="As propostas não foram lidas."
          acao={
            <button type="button" className={botao.secundario} onClick={() => void propostas.refetch()}>
              Tentar de novo
            </button>
          }
        />
      ) : lista.length === 0 ? (
        <EstadoVazio compacto icone={<BriefcaseBusiness className="h-5 w-5" />} titulo="Sem proposta." descricao="Nova proposta ou Upsell." />
      ) : (
        <Painel semEspaco>
          <ul className={juntar("divide-y divide-border")}>
            {lista.map((l) => (
              <LinhaDaProposta key={l.id} l={l} onAbrir={(x) => void onAbrir(enderecoDaProposta(x))} />
            ))}
          </ul>
        </Painel>
      )}
    </Secao>
  );
}
