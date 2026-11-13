/**
 * Conferência do domínio de e-mail (13/11/2026): MX, SPF, DKIM e DMARC lidos
 * do DNS público (DNS sobre HTTPS). Diz, em palavras, o que está certo e o que
 * falta para o provedor escolhido. Só lê; não muda DNS de ninguém.
 */

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

export type Provedor = "zoho" | "google" | "microsoft" | "outro";

export interface ItemDaChecagem {
  chave: "mx" | "spf" | "dkim" | "dmarc";
  titulo: string;
  estado: "certo" | "atencao" | "falta";
  achado: string[];
  esperado: string;
  explicacao: string;
}

export interface Checagem {
  dominio: string;
  provedor: Provedor;
  itens: ItemDaChecagem[];
  pronto: boolean;
  conferido_em: string;
}

/** O que cada provedor pede no DNS. */
export const GABARITO: Record<Provedor, { mx: string[]; spf: string; mxTexto: string; seletorPadrao: string }> = {
  zoho: { mx: ["zoho.com", "zoho.eu", "zohomail.com"], spf: "include:zoho.com", mxTexto: "mx.zoho.com (10), mx2.zoho.com (20), mx3.zoho.com (50)", seletorPadrao: "zmail" },
  google: { mx: ["google.com", "googlemail.com"], spf: "include:_spf.google.com", mxTexto: "smtp.google.com (1)", seletorPadrao: "google" },
  microsoft: { mx: ["outlook.com"], spf: "include:spf.protection.outlook.com", mxTexto: "<domínio>.mail.protection.outlook.com (0)", seletorPadrao: "selector1" },
  outro: { mx: [], spf: "", mxTexto: "o servidor do seu provedor", seletorPadrao: "default" },
};

const DOMINIO = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
const SELETOR = /^[a-z0-9._-]{1,60}$/i;

async function consultar(buscar: Buscar, nome: string, tipo: "MX" | "TXT" | "CNAME"): Promise<string[]> {
  const r = await buscar(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nome)}&type=${tipo}`, {
    headers: { accept: "application/dns-json" },
  });
  if (!r.ok) throw new Error(`dns_${r.status}`);
  const corpo = (await r.json().catch(() => ({}))) as { Answer?: Array<{ data?: string; type?: number }> };
  const tipoNumero = tipo === "MX" ? 15 : tipo === "TXT" ? 16 : 5;
  return (corpo.Answer || [])
    .filter((a) => a && a.type === tipoNumero && typeof a.data === "string")
    // O TXT vem entre aspas e, quando é longo, em pedaços: "parte1" "parte2".
    .map((a) => (tipo === "TXT" ? String(a.data).replace(/"\s+"/g, "").replace(/^"|"$/g, "") : String(a.data).replace(/\.$/, "")));
}

const terminaCom = (host: string, sufixos: string[]) => sufixos.some((s) => host === s || host.slice(-(s.length + 1)) === `.${s}`);

/** As regras, separadas da rede para o teste. */
export function avaliar(p: { dominio: string; provedor: Provedor; seletor: string; mx: string[]; txt: string[]; dkim: string[]; dmarc: string[]; agora: Date }): Checagem {
  const g = GABARITO[p.provedor];
  const hostsMx = p.mx.map((linha) => linha.split(/\s+/).slice(-1)[0].toLowerCase());
  const mxNoProvedor = g.mx.length ? hostsMx.filter((h) => terminaCom(h, g.mx)) : hostsMx;
  const mx: ItemDaChecagem = {
    chave: "mx",
    titulo: "Recebimento (MX)",
    estado: !hostsMx.length ? "falta" : g.mx.length && mxNoProvedor.length === hostsMx.length ? "certo" : g.mx.length && mxNoProvedor.length ? "atencao" : g.mx.length ? "falta" : "certo",
    achado: p.mx,
    esperado: g.mxTexto,
    explicacao: !hostsMx.length
      ? "O domínio não tem MX: nenhum e-mail chega."
      : g.mx.length && !mxNoProvedor.length
        ? "O e-mail ainda chega no provedor antigo."
        : g.mx.length && mxNoProvedor.length < hostsMx.length
          ? "Há MX do provedor novo misturado com outro: parte das mensagens pode ir para o lugar errado."
          : "As mensagens chegam no provedor certo.",
  };

  const spfs = p.txt.filter((t) => /^v=spf1(\s|$)/i.test(t));
  const spfCerto = spfs.length === 1 && (!g.spf || spfs[0].toLowerCase().indexOf(g.spf) >= 0);
  const spf: ItemDaChecagem = {
    chave: "spf",
    titulo: "Quem pode enviar (SPF)",
    estado: spfCerto ? "certo" : spfs.length ? "atencao" : "falta",
    achado: spfs,
    esperado: g.spf ? `v=spf1 ${g.spf} ~all` : "v=spf1 com o servidor do provedor",
    explicacao: !spfs.length
      ? "Sem SPF, o que a empresa envia pode cair no spam."
      : spfs.length > 1
        ? "Há mais de um SPF. Só pode existir um: junte tudo num registro só."
        : spfCerto
          ? "O provedor está autorizado a enviar pelo domínio."
          : "O SPF existe, mas não autoriza o provedor novo.",
  };

  const dkimValido = p.dkim.filter((t) => /(^|;\s*)p=[A-Za-z0-9+/=]{20,}/.test(t) || /^v=DKIM1/i.test(t) || /domainkey/i.test(t));
  const dkim: ItemDaChecagem = {
    chave: "dkim",
    titulo: "Assinatura (DKIM)",
    estado: dkimValido.length ? "certo" : "falta",
    achado: p.dkim.map((t) => (t.length > 90 ? `${t.slice(0, 90)}...` : t)),
    esperado: `registro em ${p.seletor}._domainkey.${p.dominio} com a chave que o provedor gera`,
    explicacao: dkimValido.length
      ? "As mensagens saem assinadas pelo domínio."
      : `Não achei a chave no seletor "${p.seletor}". Gere o DKIM no provedor e publique o registro, ou corrija o seletor.`,
  };

  const dmarcs = p.dmarc.filter((t) => /^v=DMARC1/i.test(t));
  const politica = dmarcs.length ? (/;\s*p=([a-z]+)/i.exec(dmarcs[0]) || [])[1] || "" : "";
  const dmarc: ItemDaChecagem = {
    chave: "dmarc",
    titulo: "Política contra falsificação (DMARC)",
    estado: !dmarcs.length ? "falta" : politica.toLowerCase() === "none" ? "atencao" : "certo",
    achado: dmarcs,
    esperado: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${p.dominio}`,
    explicacao: !dmarcs.length
      ? "Sem DMARC, qualquer um pode tentar enviar em nome do domínio."
      : politica.toLowerCase() === "none"
        ? "O DMARC só observa (p=none). Depois de alguns dias sem erro, suba para quarantine."
        : "O domínio diz aos outros servidores o que fazer com mensagem falsa.",
  };

  const itens = [mx, spf, dkim, dmarc];
  return {
    dominio: p.dominio,
    provedor: p.provedor,
    itens,
    pronto: mx.estado === "certo" && spf.estado === "certo" && dkim.estado === "certo" && dmarc.estado !== "falta",
    conferido_em: p.agora.toISOString(),
  };
}

export async function conferirDominio(buscar: Buscar, entrada: { dominio: string; provedor: Provedor; seletor?: string | null }, agora = new Date()): Promise<Checagem> {
  const dominio = String(entrada.dominio || "").trim().toLowerCase();
  if (!DOMINIO.test(dominio)) throw new Error("dominio_invalido");
  const provedor: Provedor = GABARITO[entrada.provedor] ? entrada.provedor : "outro";
  const pedido = String(entrada.seletor || "").trim();
  const seletor = SELETOR.test(pedido) ? pedido : GABARITO[provedor].seletorPadrao;
  const semErro = (p: Promise<string[]>) => p.catch(() => [] as string[]);
  const [mx, txt, dkimTxt, dkimCname, dmarc] = await Promise.all([
    consultar(buscar, dominio, "MX"),
    consultar(buscar, dominio, "TXT"),
    semErro(consultar(buscar, `${seletor}._domainkey.${dominio}`, "TXT")),
    semErro(consultar(buscar, `${seletor}._domainkey.${dominio}`, "CNAME")),
    semErro(consultar(buscar, `_dmarc.${dominio}`, "TXT")),
  ]);
  return avaliar({ dominio, provedor, seletor, mx, txt, dkim: dkimTxt.concat(dkimCname), dmarc, agora });
}
