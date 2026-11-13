import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { fraseDoErro, salvarConta, type EstadoDoProduto } from "@/lib/produto/api";
import { ETAPAS_DO_FUNIL, NICHOS, NOME_PADRAO_DA_ETAPA, type EtapaId, type NichoId } from "@/lib/produto/nichos";
import { useRelerProduto } from "@/hooks/useProduto";
import { CampoDeFormulario, Secao, botao, campo, juntar, texto } from "@/components/sistema";

const AJUDA_DA_ETAPA: Record<EtapaId, string> = {
  novo: "Chegou e ainda não foi atendido",
  contato: "Conversa aberta",
  diagnostico: "Entendendo o que a pessoa precisa",
  proposta: "Proposta ou orçamento enviado",
  negociacao: "Ajustando valor, prazo ou papelada",
  ganho: "Fechou",
  perdido: "Não seguiu (o motivo fica registrado)",
};

/**
 * O funil com as palavras da empresa: o ramo e o nome de cada etapa. As sete
 * etapas são as mesmas por dentro (os relatórios e a API continuam valendo);
 * o que muda é o nome que a equipe lê em todo o CRM.
 */
export default function FunilDaConta({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const reler = useRelerProduto();
  const [nicho, setNicho] = useState<NichoId | "">(conta.perfil.nicho || "");
  const [nomes, setNomes] = useState<Partial<Record<EtapaId, string>>>(conta.perfil.etapas || {});
  const [salvando, setSalvando] = useState(false);

  const usarNomesDoRamo = (id: NichoId | "") => {
    const n = NICHOS.filter((x) => x.id === id)[0];
    setNomes(n ? { ...n.etapas } : {});
  };

  const salvar = async () => {
    const etapas: Partial<Record<EtapaId, string>> = {};
    ETAPAS_DO_FUNIL.forEach((id) => {
      const v = (nomes[id] || "").trim();
      if (v.length >= 2 && v !== NOME_PADRAO_DA_ETAPA[id]) etapas[id] = v.slice(0, 24);
    });
    setSalvando(true);
    try {
      await salvarConta({ perfil: { ...(nicho ? { nicho } : {}), ...(conta.perfil.objetivo ? { objetivo: conta.perfil.objetivo } : {}), etapas } });
      await reler();
      toast.success("Funil salvo. Os nomes novos já valem para a equipe.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar o funil."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Secao
      titulo="Funil"
      ajuda="Dê às etapas os nomes que a sua equipe usa no dia a dia. Os negócios que já existem continuam na mesma etapa, só com o nome novo. Etapa em branco usa o nome padrão."
      acao={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-funil="">{salvando ? "Salvando..." : "Salvar"}</button>}
    >
      <div className="min-w-0 max-w-[720px] space-y-5" data-funil-da-conta="">
        <CampoDeFormulario rotulo="Ramo da empresa">
          <div className="flex min-w-0 items-center">
            <select value={nicho} onChange={(e) => setNicho(e.target.value as NichoId | "")} className={juntar(campo, "max-w-[320px]")} aria-label="Ramo da empresa">
              <option value="">Não informado</option>
              {NICHOS.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
            </select>
            <button type="button" className={juntar(botao.discreto, "ml-2")} onClick={() => usarNomesDoRamo(nicho)} title="Preenche as etapas com os nomes sugeridos para o ramo">
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Usar os nomes do ramo
            </button>
          </div>
        </CampoDeFormulario>

        <ol className="min-w-0 space-y-2">
          {ETAPAS_DO_FUNIL.map((id, i) => (
            <li key={id} className="grid min-w-0 grid-cols-[24px_minmax(0,220px)_minmax(0,1fr)] items-center gap-x-3">
              <span className={juntar(texto.auxiliar, "text-center tabular-nums")}>{i + 1}</span>
              <input
                value={nomes[id] === undefined ? "" : nomes[id]}
                onChange={(e) => setNomes({ ...nomes, [id]: e.target.value.slice(0, 24) })}
                placeholder={NOME_PADRAO_DA_ETAPA[id]}
                maxLength={24}
                aria-label={`Nome da etapa ${NOME_PADRAO_DA_ETAPA[id]}`}
                className={campo}
                data-etapa={id}
              />
              <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>{AJUDA_DA_ETAPA[id]}</span>
            </li>
          ))}
        </ol>
      </div>
    </Secao>
  );
}
