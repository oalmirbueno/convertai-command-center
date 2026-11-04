import { Suspense, lazy } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Briefcase, CircleDollarSign, FileSignature, Users } from "lucide-react";
import { AreaDeTrabalho, CabecalhoDePagina, Carregando, Etapas, type ItemDeEtapa } from "@/components/sistema";

/**
 * Mesa Freela (MVP): o canal de aquisição ao lado da agência.
 *
 * Contato → proposta → projeto → parcelas. As parcelas alimentam o caixa
 * do freela e, pelo gatilho do banco, o financeiro (billing type='freela').
 * BRL e USD convivem sem nunca se somar. Só admin e manager: a rota usa a
 * mesma régua do Comercial (ComercialRoute) e o RLS repete no banco.
 *
 * A aba mora na URL (/freela/:aba), como no Comercial: o menu aponta direto,
 * o voltar do navegador funciona e o link pode ser mandado para alguém.
 */

const AbaContatos = lazy(() => import("@/components/freela/AbaContatos"));
const AbaPropostas = lazy(() => import("@/components/freela/AbaPropostas"));
const AbaProjetos = lazy(() => import("@/components/freela/AbaProjetos"));
const AbaCaixa = lazy(() => import("@/components/freela/AbaCaixa"));

type Aba = "contatos" | "propostas" | "projetos" | "caixa";
const ABAS_VALIDAS: Aba[] = ["contatos", "propostas", "projetos", "caixa"];

const AREAS: ItemDeEtapa[] = [
  { valor: "contatos", rotulo: "Contatos", icone: <Users className="h-4 w-4" /> },
  { valor: "propostas", rotulo: "Propostas", icone: <FileSignature className="h-4 w-4" /> },
  { valor: "projetos", rotulo: "Projetos", icone: <Briefcase className="h-4 w-4" /> },
  { valor: "caixa", rotulo: "Caixa", icone: <CircleDollarSign className="h-4 w-4" /> },
];

const AJUDA_DA_ABA: Record<Aba, string> = {
  contatos: "Pessoas e empresas atendidas por fora da agência. Quando vira recorrente, promova a cliente.",
  propostas: "Arraste entre as etapas. Em Fechados, transforme em cliente; em Perdidos fica o motivo e a data de retomar.",
  projetos: "O trabalho fechado e as parcelas. Marcar paga aqui atualiza o caixa e o financeiro.",
  caixa: "Todas as parcelas, com os totais separados por moeda: real e dólar nunca se somam.",
};

export default function AdminFreela() {
  const navigate = useNavigate();
  const { aba: abaDaUrl } = useParams<{ aba?: string }>();
  const aba: Aba = ABAS_VALIDAS.includes(abaDaUrl as Aba) ? (abaDaUrl as Aba) : "contatos";
  const setAba = (proxima: Aba) => navigate(proxima === "contatos" ? "/freela" : `/freela/${proxima}`);

  return (
    <div className="min-w-0 space-y-4">
      <header className="min-w-0">
        <CabecalhoDePagina
          titulo="Freela"
          descricao="Trabalhos por fora da agência"
          ajuda={AJUDA_DA_ABA[aba]}
          aoLado={
            <Etapas
              soIcone
              rotulo="Áreas do Freela"
              itens={AREAS}
              valor={aba}
              onEscolher={(v) => setAba(v as Aba)}
              className="min-w-0 flex-1"
            />
          }
        />
      </header>

      {/* 04/11/2026 (dono: "está com scroll infinito"): a página não rola; cada aba rola por dentro, e o funil por coluna. */}
      <AreaDeTrabalho principalRolavel={aba !== "propostas"} rotuloDoPrincipal={`Freela: ${aba}`} memoriaDaRolagem={`freela:${aba}`}>
        <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo a área" />}>
          {aba === "contatos" && <AbaContatos />}
          {aba === "propostas" && <AbaPropostas />}
          {aba === "projetos" && <AbaProjetos />}
          {aba === "caixa" && <AbaCaixa />}
        </Suspense>
      </AreaDeTrabalho>
    </div>
  );
}
