import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { CabecalhoDePagina } from "@/components/sistema";
import AreaDoCFO from "@/components/cfo/AreaDoCFO";

/**
 * Financeiro › CFO (frente CFO, 30/09): o endereço próprio do agente
 * financeiro (/financeiro/cfo), para o Assist e o menu levarem direto. A
 * mesma área também mora na aba "CFO" do Financeiro. Só admin.
 */
export default function FinanceiroCFO() {
  const { profile } = useAuth();
  if (profile && profile.role !== "admin") return <Navigate to="/financeiro" replace />;
  return (
    <div className="min-w-0 space-y-6">
      <CabecalhoDePagina
        titulo="CFO"
        voltar={{ para: "/financeiro", rotulo: "Financeiro" }}
        ajuda="O agente financeiro da agência: saúde do caixa, projeção, limite do mês, onde você está errando, onde cortar e o plano de crescimento. Toda conta é feita em código com os lançamentos do Financeiro; a IA só explica e conduz."
      />
      <AreaDoCFO />
    </div>
  );
}
