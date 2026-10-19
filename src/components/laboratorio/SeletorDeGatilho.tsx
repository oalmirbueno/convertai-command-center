import { Zap } from "lucide-react";
import { campo, juntar, texto } from "@/components/sistema";
import { gatilhosDe, rotuloDoGatilho, type LigacaoDoLab, type TipoDeNo } from "@/lib/laboratorio/nos";

/**
 * v4 (ESPEC-LABORATORIO-v4.md): o "quando?" de uma ligação do funil. Só os gatilhos que a origem tem
 * (checkout tem os de venda, captura tem formulário, quiz tem as faixas). Vazio = sem gatilho.
 * O visual do fio é do quadro (LigacaoDoLab); aqui só o dado `gatilho` da ligação.
 */
export default function SeletorDeGatilho({ ligacao, tipoDaOrigem, onMudar, id }: { ligacao: LigacaoDoLab; tipoDaOrigem: TipoDeNo; onMudar: (gatilho: string | null) => void; id: string }) {
  const opcoes = gatilhosDe(tipoDaOrigem);
  if (!opcoes.length) return null;
  return (
    <div className="mt-1 flex min-w-0 items-center" data-gatilho-da-ligacao={ligacao.id}>
      <label htmlFor={id} className={juntar(texto.auxiliar, "mr-1 inline-flex shrink-0 items-center")} title="Quando a pessoa passa por este fio">
        <Zap className="mr-1 h-3 w-3" aria-hidden="true" />
        Quando
      </label>
      <select id={id} className={juntar(campo, "h-7 min-w-0 flex-1 py-0 text-[12px]")} value={ligacao.gatilho || ""} onChange={(e) => onMudar(e.target.value || null)}>
        <option value="">Sem gatilho</option>
        {opcoes.map((g) => (
          <option key={g} value={g}>
            {rotuloDoGatilho(g)}
          </option>
        ))}
      </select>
    </div>
  );
}
