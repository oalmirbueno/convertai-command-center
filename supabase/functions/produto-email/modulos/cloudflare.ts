/**
 * Cloudflare da Aceleriq (conta f1a32e14e962f68134a06c0370e45e0e): a zona de cada cliente mora lá.
 * Só leitura: acha a zona, lê os registros e confere o que o e-mail precisa. Nada aqui muda o DNS.
 * Sem import: roda na função (Deno) e no vitest.
 */

export interface RegistroDaCloudflare {
  type: string;
  name: string;
  content: string;
  priority?: number;
  proxied?: boolean;
}

export interface ZonaDaCloudflare {
  id: string;
  name: string;
  status: string;
  name_servers?: string[];
  original_name_servers?: string[] | null;
  plan?: { name?: string } | null;
}

export type Situacao = "ok" | "alerta" | "falta";

export interface ItemDaZona {
  chave: "zona" | "proxy" | "mx" | "spf" | "dkim" | "dmarc" | "verificacao";
  situacao: Situacao;
  texto: string;
}

export interface ResumoDaZona {
  ok: boolean;
  zona_id: string;
  status: string;
  plano: string | null;
  name_servers: string[];
  registros: number;
  proxied_email: number;
  itens: ItemDaZona[];
  conferido_em: string;
}

const MX_DO_PROVEDOR: Record<string, string[]> = {
  zoho: ["mx.zoho.com", "mx2.zoho.com", "mx3.zoho.com"],
  google: ["smtp.google.com"],
  microsoft: ["mail.protection.outlook.com"],
};
const SPF_DO_PROVEDOR: Record<string, string> = {
  zoho: "include:zoho.com",
  google: "include:_spf.google.com",
  microsoft: "include:spf.protection.outlook.com",
};

const semAspas = (t: string) => String(t || "").replace(/^"+|"+$/g, "").replace(/"\s+"/g, "");
const semPonto = (t: string) => String(t || "").toLowerCase().replace(/\.+$/, "");

/** Confere a zona contra o que o provedor de e-mail pede. Só regra: o teste chama direto. */
export function resumirZona(
  zona: ZonaDaCloudflare,
  registros: RegistroDaCloudflare[],
  opcoes: { dominio: string; provedor: string; seletor?: string | null; agora?: Date },
): ResumoDaZona {
  const dominio = semPonto(opcoes.dominio);
  const seletor = opcoes.seletor || (opcoes.provedor === "zoho" ? "zmail" : opcoes.provedor === "google" ? "google" : "selector1");
  const doApex = registros.filter((r) => semPonto(r.name) === dominio);
  const itens: ItemDaZona[] = [];

  itens.push(zona.status === "active"
    ? { chave: "zona", situacao: "ok", texto: `Zona ativa na Cloudflare (${(zona.name_servers || []).join(", ")}).` }
    : { chave: "zona", situacao: "alerta", texto: `Zona ${zona.status}: os nameservers do registrador ainda não apontam para a Cloudflare.` });

  // Registro de e-mail com proxy ligado quebra a entrega (a importação da zona vem com proxy ligado).
  const doEmail = registros.filter((r) => r.type === "MX" || /^(mail|smtp|imap|pop|webmail|autodiscover)\./i.test(r.name));
  const proxied = doEmail.filter((r) => r.proxied).length;
  itens.push(proxied
    ? { chave: "proxy", situacao: "falta", texto: `${proxied} registro(s) de e-mail com proxy ligado. Deixe em DNS only.` }
    : { chave: "proxy", situacao: "ok", texto: "Nenhum registro de e-mail passa pelo proxy." });

  const mx = doApex.filter((r) => r.type === "MX").map((r) => semPonto(r.content));
  const esperados = MX_DO_PROVEDOR[opcoes.provedor] || [];
  const mxOk = esperados.length > 0 && esperados.every((e) => mx.some((m) => m === e || m.endsWith(e)));
  const mxOutros = mx.filter((m) => !esperados.some((e) => m === e || m.endsWith(e)));
  itens.push(!mx.length
    ? { chave: "mx", situacao: "falta", texto: "Sem MX no domínio." }
    : mxOk && !mxOutros.length
      ? { chave: "mx", situacao: "ok", texto: `MX no provedor novo (${mx.join(", ")}).` }
      : mxOk
        ? { chave: "mx", situacao: "alerta", texto: `MX do provedor novo, mas ainda há ${mxOutros.join(", ")}.` }
        : { chave: "mx", situacao: "alerta", texto: `MX ainda no provedor antigo (${mx.join(", ")}).` });

  const spfs = doApex.filter((r) => r.type === "TXT" && /^v=spf1/i.test(semAspas(r.content))).map((r) => semAspas(r.content));
  const inc = SPF_DO_PROVEDOR[opcoes.provedor];
  itens.push(spfs.length === 0
    ? { chave: "spf", situacao: "falta", texto: "Sem SPF." }
    : spfs.length > 1
      ? { chave: "spf", situacao: "falta", texto: `${spfs.length} registros SPF: tem que ser um só.` }
      : inc && spfs[0].toLowerCase().indexOf(inc) < 0
        ? { chave: "spf", situacao: "alerta", texto: `O SPF não inclui ${inc}.` }
        : { chave: "spf", situacao: "ok", texto: "Um SPF só, com o provedor novo." });

  const nomeDkim = `${seletor}._domainkey.${dominio}`;
  const dkim = registros.filter((r) => r.type === "TXT" && semPonto(r.name) === nomeDkim);
  itens.push(dkim.length && /p=[A-Za-z0-9+/]{40,}/.test(semAspas(dkim[0].content))
    ? { chave: "dkim", situacao: "ok", texto: `DKIM publicado (${seletor}).` }
    : { chave: "dkim", situacao: "falta", texto: `Sem DKIM em ${nomeDkim}.` });

  const dmarc = registros.filter((r) => r.type === "TXT" && semPonto(r.name) === `_dmarc.${dominio}`);
  const politica = dmarc.length ? (semAspas(dmarc[0].content).match(/p=(\w+)/i) || [])[1] : null;
  itens.push(!dmarc.length
    ? { chave: "dmarc", situacao: "falta", texto: "Sem DMARC." }
    : { chave: "dmarc", situacao: "ok", texto: `DMARC com p=${politica || "?"}.` });

  if (opcoes.provedor === "zoho") {
    const verif = doApex.some((r) => r.type === "TXT" && /^zoho-verification=/i.test(semAspas(r.content)));
    itens.push(verif
      ? { chave: "verificacao", situacao: "ok", texto: "Verificação do Zoho publicada." }
      : { chave: "verificacao", situacao: "alerta", texto: "Sem o TXT zoho-verification (pode já ter sido verificado e removido)." });
  }

  return {
    ok: itens.every((i) => i.situacao !== "falta"),
    zona_id: zona.id,
    status: zona.status,
    plano: zona.plan && zona.plan.name ? zona.plan.name : null,
    name_servers: zona.name_servers || [],
    registros: registros.length,
    proxied_email: proxied,
    itens,
    conferido_em: (opcoes.agora || new Date()).toISOString(),
  };
}

type Busca = (url: string, init: RequestInit) => Promise<Response>;
const API = "https://api.cloudflare.com/client/v4";

async function pedir<T>(token: string, busca: Busca, caminho: string): Promise<T> {
  const r = await busca(`${API}${caminho}`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const corpo = (await r.json().catch(() => null)) as { success?: boolean; result?: T; errors?: Array<{ message?: string }> } | null;
  if (!r.ok || !corpo || corpo.success === false) {
    const m = corpo && corpo.errors && corpo.errors[0] && corpo.errors[0].message ? corpo.errors[0].message : `HTTP ${r.status}`;
    throw new Error(`A Cloudflare recusou: ${String(m).slice(0, 160)}`);
  }
  return corpo.result as T;
}

/** Lê a zona (pelo id guardado ou pelo nome do domínio) e os registros. Só GET. */
export async function lerZona(
  token: string,
  busca: Busca,
  p: { dominio: string; zonaId?: string | null; contaId?: string | null },
): Promise<{ zona: ZonaDaCloudflare; registros: RegistroDaCloudflare[] } | null> {
  let zona: ZonaDaCloudflare | null = null;
  if (p.zonaId) {
    zona = await pedir<ZonaDaCloudflare>(token, busca, `/zones/${encodeURIComponent(p.zonaId)}`);
  } else {
    const filtro = `name=${encodeURIComponent(semPonto(p.dominio))}${p.contaId ? `&account.id=${encodeURIComponent(p.contaId)}` : ""}`;
    const achadas = await pedir<ZonaDaCloudflare[]>(token, busca, `/zones?${filtro}`);
    zona = achadas && achadas[0] ? achadas[0] : null;
  }
  if (!zona) return null;
  const registros = await pedir<RegistroDaCloudflare[]>(token, busca, `/zones/${encodeURIComponent(zona.id)}/dns_records?per_page=500`);
  return { zona, registros: registros || [] };
}
