import { MarcaAceleriq } from "@/components/publico/CascaPublica";

/**
 * O ícone do CRM (19/11/2026), irmão do Correio: o mesmo bloco verde floresta, três colunas do funil em branco
 * e o cartão que avança em neon. Vem sempre junto do logo da Aceleriq.
 */
export function IconeDoCrm({ tamanho = 40, className = "" }: { tamanho?: number; className?: string }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="crm-fundo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0E4A35" />
          <stop offset="1" stopColor="#07291E" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#crm-fundo)" />
      <rect x="8" y="10" width="7" height="20" rx="2.4" fill="#FFFFFF" fillOpacity="0.92" />
      <rect x="16.5" y="10" width="7" height="14" rx="2.4" fill="#FFFFFF" fillOpacity="0.92" />
      <rect x="25" y="10" width="7" height="9" rx="2.4" fill="#FFFFFF" fillOpacity="0.92" />
      <rect x="24" y="22" width="9" height="7" rx="2.4" fill="#12E86A" />
      <path d="M19 27.5h3.4" stroke="#12E86A" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default function LogoDoCrm({ tamanho = 34, className = "", rotulo = "CRM" }: { tamanho?: number; className?: string; rotulo?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center ${className}`} data-logo-do-crm="">
      <MarcaAceleriq altura={Math.round(tamanho * 0.6)} className="logo-do-topo max-sm:hidden" />
      <i className="mx-3 h-6 w-px shrink-0 bg-[#07291E]/15 max-sm:hidden dark:bg-white/20" aria-hidden="true" />
      <IconeDoCrm tamanho={tamanho} className={rotulo ? "mr-2 shrink-0" : "shrink-0"} />
      {rotulo && <span className="truncate text-[17px] font-semibold tracking-[-0.03em] text-[#07291E] dark:text-white">{rotulo}</span>}
    </span>
  );
}
