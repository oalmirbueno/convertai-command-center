import { useMemo, useState } from "react";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { campo, juntar, texto } from "@/components/sistema/estilos";
import { dataCurta } from "../../../supabase/functions/_shared/proposta-modelo";
import { diferencasDoConteudo, diferencasDosItens } from "../../../supabase/functions/_shared/proposta-comercial";
import { ListaDeDiferencas } from "./PreviaDoPreenchimento";
import { useVersaoCompleta, type Proposta, type Versao } from "./propostaApi";

/**
 * Comparar versões (frente PRO2): escolha uma versão guardada e veja o que
 * mudou até a atual, campo a campo, e nos itens (entrou, saiu, mudou o
 * preço). Só leitura: para voltar, é o Restaurar da lista de versões.
 */
export default function CompararVersoes({ proposta, versoes }: { proposta: Proposta; versoes: Versao[] }) {
  const [escolhida, setEscolhida] = useState<number | null>(versoes.length ? versoes[0].versao : null);
  const versao = useVersaoCompleta(proposta.id, escolhida);
  const diferencas = useMemo(() => (versao.data ? diferencasDoConteudo(versao.data.conteudo, proposta.conteudo) : []), [versao.data, proposta.conteudo]);
  const itens = useMemo(() => (versao.data ? diferencasDosItens(versao.data.itens, proposta.itens) : []), [versao.data, proposta.itens]);
  if (!versoes.length) return null;
  const total = diferencas.length + itens.length;
  return (
    <Secao titulo="Comparar versões" divisoria recolhidaDeInicio descricao={versao.data ? `${total} mudança(s) até a atual` : undefined} ajuda="Mostra o que mudou da versão escolhida até a versão atual. Para voltar a uma versão, use Restaurar na lista acima.">
      <CampoDeFormulario rotulo="Comparar a atual com" className="max-w-[320px]">
        <select value={escolhida || ""} onChange={(e) => setEscolhida(Number(e.target.value) || null)} className={campo}>
          {versoes.map((v) => (
            <option key={v.versao} value={v.versao}>
              v{v.versao} · {dataCurta(v.criado_em.slice(0, 10))}
              {v.nota ? ` · ${v.nota.slice(0, 40)}` : ""}
            </option>
          ))}
        </select>
      </CampoDeFormulario>
      <div className="mt-3 min-w-0" data-comparacao="">
        {versao.isLoading ? (
          <p className={texto.auxiliar}>Lendo a versão...</p>
        ) : versao.isError ? (
          <p className={juntar(texto.auxiliar, "text-destructive")}>A versão não foi lida agora.</p>
        ) : !total ? (
          <p className={texto.auxiliar}>Nada mudou desde essa versão.</p>
        ) : (
          <>
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
    </Secao>
  );
}
