/**
 * A API da Vercel de mentira (20/10/2026) para os testes da prévia na nuvem e
 * da publicação: guarda cada chamada (sem nunca devolver o token) e responde
 * como a Vercel nos caminhos que o painel e o worker usam.
 */

export type ChamadaDaVercel = { metodo: string; caminho: string; url: string; autorizacao: string | null; corpo: string };

export function vercelFalsa(op: { token: string; dominio?: string } = { token: "" }) {
  const chamadas: ChamadaDaVercel[] = [];
  const estado = { projetoCriado: false, deploys: 0, dominios: new Set<string>(), txtCriado: false, dnsCerto: false, apelidos: new Map<string, Array<{ uid: string; alias: string }>>() };
  const verificacao = (d: string) => [{ type: "TXT", domain: `_vercel.${d.replace(/^www\./, "")}`, value: `vc-domain-verify=${d},abc123`, reason: "pending_domain_verification" }];
  const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

  const f = (async (entrada: unknown, init?: RequestInit) => {
    const url = String(entrada);
    const u = new URL(url);
    const metodo = String((init && init.method) || "GET");
    const cab = (init && init.headers ? init.headers : {}) as Record<string, string>;
    const corpo = init && typeof init.body === "string" ? init.body : init && init.body ? "<bytes>" : "";
    chamadas.push({ metodo, caminho: u.pathname, url, autorizacao: cab.Authorization || null, corpo });
    if (cab.Authorization !== `Bearer ${op.token}`) return resposta(403, { error: { code: "forbidden", message: "Not authorized" } });
    const c = u.pathname;
    const json = corpo && corpo !== "<bytes>" ? JSON.parse(corpo) : {};
    if (metodo === "POST" && c === "/v11/projects") {
      if (estado.projetoCriado) return resposta(409, { error: { code: "conflict", message: "Project already exists" } });
      estado.projetoCriado = true;
      return resposta(200, { id: "prj_1", name: json.name });
    }
    if (metodo === "GET" && c.indexOf("/v9/projects/") === 0 && c.split("/").length === 4) return resposta(200, { id: "prj_1", name: decodeURIComponent(c.split("/")[3]) });
    if (metodo === "PATCH" && c === "/v9/projects/prj_1") return resposta(200, { id: "prj_1", ssoProtection: json.ssoProtection });
    if (metodo === "POST" && c === "/v2/files") return resposta(200, {});
    if (metodo === "POST" && c === "/v13/deployments") {
      estado.deploys += 1;
      const id = `dpl_${estado.deploys}`;
      estado.apelidos.set(id, json.target === "production" ? [{ uid: `al_${id}_a`, alias: `${json.name}.vercel.app` }].concat(op.dominio ? [{ uid: `al_${id}_b`, alias: op.dominio }] : []) : []);
      return resposta(200, { id, url: `${json.name}-h${estado.deploys}-agencia.vercel.app`, readyState: "QUEUED" });
    }
    if (metodo === "GET" && c.indexOf("/v13/deployments/") === 0) return resposta(200, { id: c.split("/")[3], readyState: "READY" });
    if (metodo === "POST" && c.indexOf("/v2/deployments/") === 0 && c.slice(-8) === "/aliases") {
      const id = c.split("/")[3];
      (estado.apelidos.get(id) || []).push({ uid: `al_${id}_p`, alias: json.alias });
      return resposta(200, { uid: `al_${id}_p`, alias: json.alias });
    }
    if (metodo === "GET" && c.indexOf("/v2/deployments/") === 0 && c.slice(-8) === "/aliases") return resposta(200, { aliases: estado.apelidos.get(c.split("/")[3]) || [] });
    if (metodo === "DELETE" && c.indexOf("/v2/aliases/") === 0) {
      const uid = decodeURIComponent(c.split("/")[3]);
      for (const [k, v] of estado.apelidos) estado.apelidos.set(k, v.filter((a) => a.uid !== uid));
      return resposta(200, { status: "SUCCESS" });
    }
    if (metodo === "POST" && c === "/v10/projects/prj_1/domains") {
      if (estado.dominios.has(json.name)) return resposta(409, { error: { code: "domain_already_in_use", message: "Domain already in use by this project" } });
      estado.dominios.add(json.name);
      return resposta(200, { name: json.name, verified: estado.txtCriado, verification: estado.txtCriado ? undefined : verificacao(json.name) });
    }
    if (c.indexOf("/v9/projects/prj_1/domains/") === 0) {
      const d = decodeURIComponent(c.split("/")[5]);
      if (!estado.dominios.has(d)) return resposta(404, { error: { code: "not_found", message: "Domain not found" } });
      if (metodo === "POST" && c.slice(-7) === "/verify") {
        if (!estado.txtCriado) return resposta(400, { error: { code: "missing_txt_record", message: "TXT record not found" } });
        return resposta(200, { name: d, verified: true });
      }
      return resposta(200, { name: d, verified: estado.txtCriado, verification: estado.txtCriado ? undefined : verificacao(d) });
    }
    if (metodo === "GET" && c.indexOf("/v6/domains/") === 0 && c.slice(-7) === "/config") {
      return resposta(200, { misconfigured: !estado.dnsCerto, recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }], recommendedCNAME: [{ rank: 1, value: "abc123.vercel-dns-017.com." }] });
    }
    return resposta(404, { error: { code: "not_found", message: `rota falsa sem resposta: ${metodo} ${c}` } });
  }) as unknown as typeof fetch;

  return { fetch: f, chamadas, estado, de: (metodo: string, prefixo: string) => chamadas.filter((x) => x.metodo === metodo && x.caminho.indexOf(prefixo) === 0) };
}
