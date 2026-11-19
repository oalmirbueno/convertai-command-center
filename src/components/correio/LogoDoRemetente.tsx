import { useState } from "react";

const BASE = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const PESSOAIS = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|uol|bol|terra|ig|globo|r7|gmx|yandex)\.(com|com\.br|net|me|ch)$/i;

/** Uma cor suave por remetente (sempre a mesma para a mesma pessoa). */
const CORES = [
  ["#D9F7E6", "#0B5134"], ["#FFE4D6", "#8A3A12"], ["#E6E0FF", "#3F2D8C"], ["#D8ECFF", "#124A82"],
  ["#FFF2C4", "#6E5100"], ["#FFDCE7", "#8C1D45"], ["#D6F5F2", "#0C5A54"], ["#EDE3D6", "#5B4120"],
] as const;
export function corDaPessoa(texto: string): { background: string; color: string } {
  let h = 0;
  for (const ch of String(texto || "").toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [background, color] = CORES[h % CORES.length];
  return { background, color };
}

export function iniciaisDe(texto: string): string {
  const limpo = String(texto || "").replace(/<[^>]*>/g, "").replace(/"/g, "").split("@")[0].trim();
  const partes = limpo.split(/[\s._-]+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : partes[0][1] || "")).toUpperCase();
}

/**
 * O rosto de quem mandou: o logo da empresa (pelo domínio do e-mail) e, sem logo ou em e-mail pessoal,
 * as iniciais numa cor fixa da pessoa. O logo vem da função produto-logo, com cache de 7 dias.
 */
export default function LogoDoRemetente({ endereco, nome, tamanho = 36, className = "" }: { endereco: string; nome?: string; tamanho?: number; className?: string }) {
  const dominio = (/@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(endereco || "") || [])[1] || "";
  const pessoal = !dominio || PESSOAIS.test(endereco || "");
  const [falhou, setFalhou] = useState(false);
  const estilo = { width: tamanho, height: tamanho, borderRadius: Math.round(tamanho * 0.3) };
  if (pessoal || falhou || !BASE) {
    return (
      <span className={`flex shrink-0 items-center justify-center font-semibold ${className}`} style={{ ...estilo, ...corDaPessoa(endereco || nome || ""), fontSize: Math.round(tamanho * 0.36) }} aria-hidden="true">
        {iniciaisDe(nome || endereco)}
      </span>
    );
  }
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden border border-border bg-white ${className}`} style={estilo} aria-hidden="true">
      <img src={`${BASE}/functions/v1/produto-logo?d=${encodeURIComponent(dominio)}`} alt="" loading="lazy" decoding="async" width={tamanho} height={tamanho} onError={() => setFalhou(true)} style={{ width: Math.round(tamanho * 0.62), height: Math.round(tamanho * 0.62), objectFit: "contain" }} />
    </span>
  );
}
