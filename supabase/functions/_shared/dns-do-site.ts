/**
 * Cartão de DNS por registrador (frente SIT, 30/09/2026), a partir de
 * plano/p4-motores.md §3. A Vercel devolve os valores (registro A do apex,
 * CNAME do www, TXT quando o domínio já está em outra conta); o painel só
 * mostra o que a API mandar, sem IP fixo no código. Sem a resposta da API, o
 * cartão mostra o tipo e o nome, e o valor fica "aparece quando a Vercel
 * responder".
 *
 * Puro: a tela, a função mesa-site, o worker e os testes usam o mesmo.
 */

export const REGISTRADORES = [
  { id: "registro_br", rotulo: "Registro.br" },
  { id: "godaddy", rotulo: "GoDaddy" },
  { id: "hostinger", rotulo: "Hostinger" },
  { id: "cloudflare", rotulo: "Cloudflare" },
  { id: "outro", rotulo: "Outro" },
] as const;
export type Registrador = (typeof REGISTRADORES)[number]["id"];
export const ehRegistrador = (v: unknown): v is Registrador => typeof v === "string" && REGISTRADORES.some((r) => r.id === v);

export type RegistroDns = { tipo: "A" | "CNAME" | "TXT" | "ALIAS"; nome: string; valor: string | null; apoio?: string };
export type CartaoDeDns = { registrador: Registrador; dominio: string; apex: string; registros: RegistroDns[]; cuidados: string[]; onde: string };

/** O que a Vercel devolve em GET /v6/domains/{d}/config e no domínio do projeto. */
export type ConfigDaVercel = {
  recommendedIPv4?: Array<{ rank?: number; value?: string[] }> | string[] | null;
  recommendedCNAME?: Array<{ rank?: number; value?: string }> | string | null;
  verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }> | null;
  misconfigured?: boolean;
  verified?: boolean;
};

/** Domínio normalizado (sem protocolo, sem barra, minúsculo) ou null. */
export function normalizarDominio(bruto: unknown): string | null {
  const s = String(bruto || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) || s.length > 253) return null;
  if (s.split(".").some((p) => !p || p.length > 63 || p.charAt(0) === "-" || p.charAt(p.length - 1) === "-")) return null;
  return s;
}

/** Sufixos de dois níveis mais comuns no Brasil (com.br, net.br...), para achar o apex. */
const SEGUNDO_NIVEL = /\.(com|net|org|art|blog|eco|edu|gov|ind|inf|med|adv|arq|eng|nom|srv|tur|tv|app|dev|log|psi|rec|ong)\.br$/;

/** O domínio raiz (apex): cliente.com.br de www.cliente.com.br. */
export function apexDe(dominio: string): string {
  const partes = dominio.split(".");
  const n = SEGUNDO_NIVEL.test(dominio) ? 3 : 2;
  return partes.slice(-n).join(".");
}

function primeiroIPv4(c: ConfigDaVercel | null | undefined): string | null {
  const r = c && c.recommendedIPv4;
  if (!r) return null;
  if (Array.isArray(r) && typeof r[0] === "string") return String(r[0]);
  const lista = (r as Array<{ rank?: number; value?: string[] }>).slice().sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99));
  const v = lista[0] && Array.isArray(lista[0].value) ? lista[0].value[0] : null;
  return v ? String(v) : null;
}

function primeiroCname(c: ConfigDaVercel | null | undefined): string | null {
  const r = c && c.recommendedCNAME;
  if (!r) return null;
  if (typeof r === "string") return r.replace(/\.$/, "");
  const lista = r.slice().sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99));
  return lista[0] && lista[0].value ? String(lista[0].value).replace(/\.$/, "") : null;
}

const CUIDADOS: Record<Registrador, string[]> = {
  registro_br: [
    "Use o modo avançado do DNS do Registro.br (Editar zona).",
    "O Registro.br não aceita CNAME no domínio raiz: o raiz usa o registro A.",
    "Cabem até 40 registros na zona.",
  ],
  godaddy: [
    "Desligue o encaminhamento de domínio (Forwarding): ele trava o registro A do @.",
    "Troque o registro A do @ que já existir (Parked) pelo valor abaixo.",
  ],
  hostinger: [
    "No painel DNS da Hostinger, apague o A e o CNAME antigos do @ e do www antes de criar os novos.",
    "A Hostinger aceita ALIAS no @ (um por zona), mas o registro A basta.",
  ],
  cloudflare: [
    "Deixe a nuvem CINZA (DNS only) nos dois registros: com o proxy laranja a verificação e o certificado da Vercel falham.",
    "No raiz dá para usar CNAME com flattening, mas o registro A é o caminho simples.",
  ],
  outro: ["Crie os registros no painel de DNS de quem registrou o domínio.", "Se houver encaminhamento ou proxy ligado, desligue."],
};

const ONDE: Record<Registrador, string> = {
  registro_br: "registro.br > Domínios > o domínio > DNS > Configurar zona DNS (modo avançado)",
  godaddy: "godaddy.com > Meus produtos > Domínio > DNS > Gerenciar DNS",
  hostinger: "hPanel > Domínios > o domínio > DNS / Nameservers",
  cloudflare: "dash.cloudflare.com > o site > DNS > Registros",
  outro: "o painel de DNS do registrador do domínio",
};

/**
 * O cartão: registro A no raiz (valor da API), CNAME no www (valor único do
 * projeto, da API) e o TXT de verificação quando a Vercel pedir. Sem valor da
 * API, o registro fica com `valor: null` (a tela diz que aparece depois).
 */
export function cartaoDeDns(registrador: Registrador, dominio: string, config?: ConfigDaVercel | null): CartaoDeDns {
  const apex = apexDe(dominio);
  const ehSub = dominio !== apex && dominio !== `www.${apex}`;
  const registros: RegistroDns[] = [];
  if (ehSub) {
    // Subdomínio (loja.cliente.com.br): só um CNAME com o nome da parte da frente.
    registros.push({ tipo: "CNAME", nome: dominio.slice(0, dominio.length - apex.length - 1), valor: primeiroCname(config) });
  } else {
    registros.push({ tipo: "A", nome: "@", valor: primeiroIPv4(config), apoio: registrador === "cloudflare" ? "nuvem cinza" : undefined });
    registros.push({ tipo: "CNAME", nome: "www", valor: primeiroCname(config), apoio: registrador === "cloudflare" ? "nuvem cinza" : undefined });
  }
  for (const v of (config && config.verification) || []) {
    if (!v || String(v.type || "").toUpperCase() !== "TXT") continue;
    const nomeCompleto = String(v.domain || "").toLowerCase();
    const nome = nomeCompleto.endsWith(`.${apex}`) ? nomeCompleto.slice(0, nomeCompleto.length - apex.length - 1) : nomeCompleto || "_vercel";
    registros.push({ tipo: "TXT", nome, valor: v.value ? String(v.value) : null, apoio: "verificação da Vercel" });
  }
  return { registrador, dominio, apex, registros, cuidados: CUIDADOS[registrador], onde: ONDE[registrador] };
}

export type EstadoDoDominio = "sem_dominio" | "aguardando_dns" | "verificado" | "certificado";

export const ROTULO_DO_DOMINIO: Record<EstadoDoDominio, string> = {
  sem_dominio: "Sem domínio",
  aguardando_dns: "Aguardando o DNS",
  verificado: "DNS certo",
  certificado: "No ar com certificado",
};

/** Estado ao vivo pelo que a Vercel respondeu. */
export function estadoDoDominio(c: ConfigDaVercel | null | undefined, temDominio: boolean, certificado = false): EstadoDoDominio {
  if (!temDominio) return "sem_dominio";
  if (!c || c.misconfigured !== false) return "aguardando_dns";
  return certificado ? "certificado" : "verificado";
}
