import { Suspense, lazy, useState } from "react";
import { TrendingUp } from "lucide-react";
import { Carregando, JanelaCentral, botao, juntar } from "@/components/sistema";

/**
 * O botão do Crescimento da carteira (Clientes e Financeiro) e a janela. O conteúdo (com o gráfico) só
 * é baixado quando a janela abre.
 */
const Conteudo = lazy(() => import("@/components/clientes/CrescimentoDaCarteira"));

export default function BotaoDoCrescimento({ className }: { className?: string }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={juntar(botao.icone, className)} aria-label="Crescimento da carteira" title="Crescimento: clientes que entraram e faturamento por mês" data-abrir-crescimento="">
        <TrendingUp className="h-4 w-4" aria-hidden="true" />
      </button>
      {aberta && (
        <JanelaCentral
          aberta
          onFechar={() => setAberta(false)}
          titulo="Crescimento da carteira"
          icone={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
          ajuda="Entrou é a data do cadastro do cliente no painel. Recebido é o que foi pago de fato (cobranças e parcelas de projeto), pela data do pagamento. Empresa do grupo e cadastro apagado não contam. O mês atual ainda está em aberto, por isso não disputa o mês com menos entradas."
          largura="xl"
          data-janela-crescimento=""
        >
          <Suspense fallback={<Carregando linhas={5} rotulo="Carregando o crescimento da carteira" />}>
            <Conteudo />
          </Suspense>
        </JanelaCentral>
      )}
    </>
  );
}
