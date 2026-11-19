import { MarcaAceleriq } from "@/components/publico/CascaPublica";

/**
 * O logo do Aceleriq Correio (19/11/2026): o envelope branco num bloco verde floresta, com a aba em neon
 * (o mesmo verde da marca) e o ponto de "chegou" no canto. Os traços à esquerda dão a ideia de rapidez.
 * Ele vem sempre junto do logo da Aceleriq.
 */
export function IconeDoCorreio({ tamanho = 40, className = "" }: { tamanho?: number; className?: string }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="correio-fundo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0E4A35" />
          <stop offset="1" stopColor="#07291E" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#correio-fundo)" />
      <path d="M4.5 17.5h4M3 21.5h5.5M5 25.5h3.5" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="11" y="12.5" width="23" height="16.5" rx="3.6" fill="#FFFFFF" />
      <path d="M12.6 14.6 22.5 22l9.9-7.4" fill="none" stroke="#12E86A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="33" cy="11.5" r="4.2" fill="#12E86A" stroke="#07291E" strokeWidth="2" />
    </svg>
  );
}

/**
 * A marca completa: o logo da Aceleriq, um traço fino e o ícone com "Correio". A Aceleriq continua na frente
 * (pedido do dono: combinar, não trocar); o ícone diz que aqui é o e-mail.
 */
export default function LogoDoCorreio({ tamanho = 34, className = "", compacto = false }: { tamanho?: number; className?: string; compacto?: boolean }) {
  return (
    <span className={`inline-flex min-w-0 items-center ${className}`} data-logo-do-correio="">
      {!compacto && (
        <>
          <MarcaAceleriq altura={Math.round(tamanho * 0.6)} className="logo-do-topo" />
          <i className="mx-3 h-6 w-px shrink-0 bg-[#07291E]/15" aria-hidden="true" />
        </>
      )}
      <IconeDoCorreio tamanho={tamanho} className="mr-2 shrink-0" />
      <span className="text-[17px] font-semibold tracking-[-0.03em] text-[#07291E]">Correio</span>
    </span>
  );
}
