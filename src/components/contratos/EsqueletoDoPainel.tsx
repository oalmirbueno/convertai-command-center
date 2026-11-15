import { juntar, superficie } from "@/components/sistema/estilos";

/**
 * Esqueleto com a forma da faixa do painel dos contratos (4 números, 2 por
 * linha no celular): ocupa o lugar enquanto o painel chega, para a lista não
 * pular para baixo (UXS, 30/09). Arquivo próprio para a lista usar como
 * fallback do Suspense sem carregar o painel junto. Sem número inventado.
 */
export default function EsqueletoDoPainel() {
  return (
    <div aria-busy="true" aria-label="Carregando o painel" className="grid min-w-0 grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-4" data-esqueleto-do-painel="">
      {/* A forma dos quatro cartões de número (2 por linha até 1280 px). */}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={juntar(superficie.painel, "h-[132px] min-w-0 p-5 sm:h-[148px] sm:p-6")}>
          <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
          <div className="mt-5 h-9 w-1/2 animate-pulse rounded-md bg-muted" />
        </div>
      ))}
    </div>
  );
}
