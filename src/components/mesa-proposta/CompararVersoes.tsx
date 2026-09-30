import { useMemo } from "react";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { diferencasDoConteudo, diferencasDosItens } from "../../../supabase/functions/_shared/proposta-comercial";
import { ListaDeDiferencas } from "./PreviaDoPreenchimento";
import { useVersaoCompleta, type Proposta } from "./propostaApi";

/**
 * Comparar versões (frente PRO2): o que mudou da versão escolhida até a
 * atual, campo a campo, e nos itens (entrou, saiu, mudou o preço). Só
 * leitura: para voltar, é o Restaurar da lista.
 *
 * Frente UXS (30/09): mora no Histórico da Revisão, logo abaixo da lista; a
 * versão vem do "Comparar" da linha (sem select). Sem versão escolhida, pede
 * para escolher (nunca "Nada mudou" sem ter lido a versão).
 */
export default function CompararVersoes({ proposta, versao: alvo }: { proposta: Proposta; versao: number | null }) {
  const versao = useVersaoCompleta(proposta.id, alvo);
  const diferencas = useMemo(() => (versao.data ? diferencasDoConteudo(versao.data.conteudo, proposta.conteudo) : []), [versao.data, proposta.conteudo]);
  const itens = useMemo(() => (versao.data ? diferencasDosItens(versao.data.itens, proposta.itens) : []), [versao.data, proposta.itens]);
  const total = diferencas.length + itens.length;
  return (
    <div className="mt-3 min-w-0" data-comparacao="" aria-live="polite">
      {alvo === null ? (
        <p className={texto.auxiliar}>Toque em Comparar numa versão.</p>
      ) : versao.isLoading ? (
        <Carregando forma="lista" linhas={2} rotulo="Lendo a versão" />
      ) : versao.isError && !versao.data ? (
        <EstadoDeErro
          titulo="A versão não foi lida agora."
          acao={
            <button type="button" className={botao.secundario} onClick={() => void versao.refetch()}>
              Tentar de novo
            </button>
          }
        />
      ) : !versao.data ? (
        <p className={texto.auxiliar}>Essa versão não está mais guardada.</p>
      ) : !total ? (
        <p className={texto.auxiliar}>Nada mudou desde a v{alvo}.</p>
      ) : (
        <>
          <p className={juntar(texto.rotulo, "mb-2")}>
            {total} mudança(s) da v{alvo} até a atual
          </p>
          {itens.length > 0 && (
            <ul className="mb-3 list-disc pl-5" aria-label="Mudanças nos itens">
              {itens.map((t) => (
                <li key={t} className={juntar(texto.corpo, "tabular-nums")}>
                  {t}
                </li>
              ))}
            </ul>
          )}
          <ListaDeDiferencas diferencas={diferencas} />
        </>
      )}
    </div>
  );
}
