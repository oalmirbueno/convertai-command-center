/**
 * O logo do Aceleriq Correio (19/11/2026): o envelope branco num bloco verde floresta, com a aba em neon
 * (o mesmo verde da marca) e o ponto de "chegou" no canto. Os traços à esquerda dão a ideia de rapidez.
 * Ao lado, "Correio" grande e "da Aceleriq" pequeno, para não virar só mais um ícone de e-mail.
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

export default function LogoDoCorreio({ tamanho = 38, className = "" }: { tamanho?: number; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center ${className}`} data-logo-do-correio="">
      <IconeDoCorreio tamanho={tamanho} className="mr-2.5 shrink-0" />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="text-[17px] font-semibold tracking-[-0.03em] text-[#07291E]">Correio</span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#2F6B52]">da Aceleriq</span>
      </span>
    </span>
  );
}
