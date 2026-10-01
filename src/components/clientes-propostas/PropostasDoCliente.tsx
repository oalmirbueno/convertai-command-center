import { useState } from "react";
import { BriefcaseBusiness, Plus } from "lucide-react";
import BotaoDoConselho from "@/components/conselho/BotaoDoConselho";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar } from "@/components/sistema/estilos";
import { SERVICOS_DA_CASA } from "../../../supabase/functions/mesa-proposta/modulos/proposta-upsell";
import { LinhaDaProposta } from "./AreaDePropostas";
import { enderecoDaProposta, filtrarCarteira, usePropostasDoCliente } from "./propostasDaCarteira";
import NovaProposta from "./NovaProposta";

export type ClienteDasAcoes = { id: string; nome: string; services_config?: unknown; plan_name?: string | null; client_type?: string | null };

/** O que a tela sabe do cliente para o conselho (tema e contexto pré-preenchidos, sem inventar número). */
export function contextoDoClienteParaConselho(c: ClienteDasAcoes): string {
  const config = c.services_config && typeof c.services_config === "object" ? (c.services_config as Record<string, unknown>) : {};
  const servicos = Object.keys(SERVICOS_DA_CASA).filter((k) => config[k] === true).map((k) => SERVICOS_DA_CASA[k]);
  const tipo = c.client_type === "one_off" ? "avulso" : c.client_type === "hybrid" ? "híbrido" : "recorrente";
  return `Cliente ${tipo}. Serviços contratados: ${servicos.join(", ") || "nenhum marcado"}. Plano: ${c.plan_name || "sem plano no cadastro"}. Pergunta típica: qual o próximo passo com este cliente (upsell, retenção, proposta nova).`;
}

/**
 * O conselho de agentes na linha da lista de Clientes e na ficha (frente
 * PRO3, 30/09), com o tema do cliente. Frente PRS (30/09): o botão "Upsell"
 * que ficava ao lado saiu da linha (repetia o "..." da linha, que continua
 * com "Nova proposta" e "Proposta de upsell"); na ficha, "Nova proposta"
 * abre a mesma janela de todo o painel.
 */
export function AcoesComerciaisDoCliente({ cliente, semConselho = false }: { cliente: ClienteDasAcoes; onAbrir?: (caminho: string) => void | Promise<void>; semConselho?: boolean }) {
  if (semConselho) return null;
  return <BotaoDoConselho clientId={cliente.id} origem="cliente" tema={`Próximo passo com ${cliente.nome}`} contexto={contextoDoClienteParaConselho(cliente)} referencia={{ tipo: "cliente", id: cliente.id }} />;
}

/**
 * Seção "Propostas" da ficha do cliente (frente PRO3): o histórico de
 * propostas dele, "Nova proposta" (PRS: a janela de sempre, já com o
 * cliente, para venda nova ou upsell) e o Conselho. Abrir leva à Mesa Proposta (a ficha fecha antes, pelo
 * `onAbrir` da ficha, que avisa de cadastro não salvo).
 */
export default function PropostasDoCliente({ cliente, onAbrir }: { cliente: ClienteDasAcoes; onAbrir: (caminho: string) => void | Promise<void> }) {
  const propostas = usePropostasDoCliente(cliente.id);
  const [nova, setNova] = useState(false);
  const lista = propostas.data ? propostas.data.lista : [];
  const abertas = filtrarCarteira(lista, "abertas").length;
  return (
    <Secao
      titulo="Propostas"
      divisoria
      descricao={propostas.isLoading ? "Lendo" : lista.length ? `${lista.length} no histórico${abertas ? ` · ${abertas} em aberto` : ""}` : "Nenhuma ainda"}
      ajuda="Nova proposta abre a janela de sempre, já com este cliente: venda nova ou upsell (nasce com o que ele já tem e os resultados reais; o estrategista sugere o próximo passo). As duas abrem na Mesa Proposta."
      acao={
        <>
          <button type="button" className={botao.secundario} onClick={() => setNova(true)} aria-label="Nova proposta para este cliente">
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
        <EstadoVazio compacto icone={<BriefcaseBusiness className="h-5 w-5" />} titulo="Sem proposta." descricao="Venda nova ou upsell, em Nova proposta." />
      ) : (
        <Painel semEspaco>
          <ul className={juntar("divide-y divide-border")}>
            {lista.map((l) => (
              <LinhaDaProposta key={l.id} l={l} onAbrir={(x) => void onAbrir(enderecoDaProposta(x))} />
            ))}
          </ul>
        </Painel>
      )}
      <NovaProposta aberta={nova} onAberta={setNova} clientes={[]} clienteFixo={{ id: cliente.id, nome: cliente.nome }} podeCriarCliente={false} onAbrir={onAbrir} />
    </Secao>
  );
}
