import { juntar, superficie } from "@/components/sistema/estilos";

/**
 * Esqueleto com a forma da faixa do painel dos contratos (4 números, 2 por
 * linha no celular): ocupa o lugar enquanto o painel chega, para a lista não
 * pular para baixo (UXS, 30/09). Arquivo próprio para a lista usar como
 * fallback do Suspense sem carregar o painel junto. Sem número inventado.
 */
export default function EsqueletoDoPainel() {
  return (
    <div aria-busy="true" aria-label="Carregando o painel" className={juntar("min-w-0 overflow-hidden", superficie.painel)} data-esqueleto-do-painel="">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {/* Alturas da faixa compacta: no celular a 1ª linha não tem apoio (62 px) e a 2ª tem (81 px); de 1024 px para cima, uma linha de 80 px. */}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={juntar("px-4 py-2.5 lg:h-20", i < 2 ? "h-[62px]" : "h-[81px]")}>
            <div className="h-full animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
