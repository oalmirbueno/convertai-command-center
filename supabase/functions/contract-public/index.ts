import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { EMAIL_APP_URL } from "../_shared/email-config.ts";
import { hashDosBytes, nomeDoArquivoDoContrato } from "../_shared/contrato-modelo.ts";
import { type EventoNoCarimbo, gerarPdfDoContrato } from "../_shared/pdf-contrato.ts";
// Frente CON2 (30/09): mais de um signatário do cliente e testemunhas, cada um com o próprio link.
import { fecharComSignatarios, lerSignatariosDoContrato } from "../_shared/contrato-assinaturas.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function storagePathFromFilesReference(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("files://")) return value.slice("files://".length);
  try {
    const parsed = new URL(value);
    const marker = "/storage/v1/object/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const parts = parsed.pathname
      .slice(markerIndex + marker.length)
      .split("/")
      .filter(Boolean);
    if (["public", "sign", "authenticated"].includes(parts[0])) parts.shift();
    const bucket = parts.shift();
    if (bucket !== "files" || parts.length === 0) return null;
    return decodeURIComponent(parts.join("/"));
  } catch {
    return null;
  }
}

// Frente CON (30/09): contrato montado por modelo. O cliente lê o texto
// congelado com o código de integridade (SHA-256), assina com nome, e-mail e
// aceite, e o PDF final (com a página de carimbo) vai para Arquivos pela RPC
// contrato_concluir_assinatura, que usa o complete_contract_signature de
// sempre. Contrato de arquivo (PDF enviado) segue o caminho antigo.
const CAMPOS_BASE =
  "id, title, description, original_file_url, original_file_name, status, admin_signature_name, admin_signed_at, client_signature_name, client_signed_at, client_id";
const CAMPOS_MODELO =
  `${CAMPOS_BASE}, origem, numero, versao, documento_texto, documento_hash, documento_pdf_url, substituido_por, admin_signature_email, admin_signature_ip`;

const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type SignatarioDoLink = { id: string; contract_id: string; papel: string; nome: string; email: string; principal: boolean; assinado_em: string | null };

/** O link de uma pessoa da lista de quem assina (o principal usa o link de sempre, que também está na lista). */
async function signatarioDoToken(supabase: any, token: string): Promise<SignatarioDoLink | null> {
  const { data, error } = await supabase.from("contrato_signatarios").select("id, contract_id, papel, nome, email, principal, assinado_em").eq("token", token).is("removido_em", null).maybeSingle();
  if (error) {
    // Banco sem a lista (migration 20260930195100 pendente): segue o caminho de sempre.
    if (!/contrato_signatarios|does not exist|schema cache/i.test(String(error.message || ""))) console.error("contract-public: signatário não lido", { message: error.message });
    return null;
  }
  return data || null;
}

async function lerPorToken(supabase: any, token: string): Promise<{ contract: any; modelo: boolean; error: any; signatario?: SignatarioDoLink | null }> {
  const signatario = await signatarioDoToken(supabase, token);
  if (signatario) {
    const r = await supabase.from("contracts").select(CAMPOS_MODELO).eq("id", signatario.contract_id).maybeSingle();
    return { contract: r.data, modelo: !!r.data && r.data.origem === "modelo", error: r.error, signatario };
  }
  const novo = await supabase.from("contracts").select(CAMPOS_MODELO).eq("sign_token", token).maybeSingle();
  if (!novo.error) return { contract: novo.data, modelo: !!novo.data && novo.data.origem === "modelo", error: null };
  // Banco sem as colunas novas (migration da frente CON ainda não aplicada): leitura antiga.
  const antigo = await supabase.from("contracts").select(CAMPOS_BASE).eq("sign_token", token).maybeSingle();
  return { contract: antigo.data, modelo: false, error: antigo.error };
}

async function urlAssinada(supabase: any, ref: string | null | undefined, segundos = 60 * 60): Promise<string | null> {
  const caminho = storagePathFromFilesReference(ref);
  if (!caminho) return null;
  const { data, error } = await supabase.storage.from("files").createSignedUrl(caminho, segundos);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

/** Visita do cliente na trilha (uma por IP a cada 30 minutos). Falha vai para o log e não segura a página. */
async function registrarVisita(supabase: any, contract: any, ip: string, userAgent: string) {
  try {
    const desde = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data } = await supabase.from("contrato_eventos").select("id").eq("contract_id", contract.id).eq("tipo", "visualizado").eq("ip", ip).gte("criado_em", desde).limit(1);
    if (Array.isArray(data) && data.length) return;
    const { error } = await supabase.from("contrato_eventos").insert({
      contract_id: contract.id,
      client_id: contract.client_id,
      tipo: "visualizado",
      resumo: "Link aberto pelo contratante.",
      detalhe: { documento_hash: contract.documento_hash },
      ip,
      user_agent: userAgent.slice(0, 400),
    });
    if (error) console.error("contract-public: visita não registrada", { contract_id: contract.id, message: error.message });
  } catch (e) {
    console.error("contract-public: visita não registrada", { contract_id: contract.id, message: e instanceof Error ? e.message : String(e) });
  }
}

async function assinarComoSignatario(supabase: any, contract: any, signatario: SignatarioDoLink, body: any, ip: string, userAgent: string, token: string) {
  const nome = typeof body.signature_name === "string" ? body.signature_name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const hashVisto = typeof body.hash === "string" ? body.hash.trim().toLowerCase() : "";
  if (!nome || nome.length > 200 || !EMAIL_VALIDO.test(email) || email.length > 254 || body.accept !== true) {
    return json({ error: "missing or invalid fields", mensagem: "Preencha nome, e-mail válido e o aceite." }, 400);
  }
  if (email !== String(signatario.email || "").toLowerCase()) {
    return json({ error: "email_diferente", mensagem: "Use o e-mail cadastrado para esta assinatura. Se ele mudou, peça um link novo à agência." }, 400);
  }
  if (hashVisto !== contract.documento_hash) {
    return json({ error: "documento_mudou", mensagem: "O documento mudou desde que você abriu o link. Abra o link de novo." }, 409);
  }
  const { data: r, error } = await supabase.rpc("contrato_assinar_signatario", {
    p_token: token,
    p_nome: nome,
    p_email: email,
    p_ip: ip,
    p_user_agent: userAgent.slice(0, 400),
    p_hash_visto: hashVisto,
    p_assinado_em: new Date().toISOString(),
  });
  if (error) {
    const status = error.message === "signatario not found" ? 404 : 409;
    return json({ error: error.message, mensagem: error.message === "esta pessoa já assinou" ? "Sua assinatura já estava registrada." : "A assinatura não foi registrada. Abra o link de novo." }, status);
  }
  const faltam = Number(r && r.faltam) || 0;
  if (faltam > 0) return json({ ok: true, faltam, concluido: false });
  // Última assinatura obrigatória: fecha o contrato (PDF final com todas as assinaturas).
  const { data: perfil } = await supabase.from("profiles").select("company_name, full_name").eq("id", contract.client_id).maybeSingle();
  const cliente = (perfil && (perfil.company_name || perfil.full_name)) || "cliente";
  const f = await fecharComSignatarios(supabase, contract.id, { verificacao: `${EMAIL_APP_URL}/contrato/${token}`, cliente });
  if (!f.ok) {
    console.error("contract-public: fechamento com signatários falhou", { contract_id: contract.id, motivo: f.motivo });
    // A assinatura ficou registrada; a rotina diária tenta fechar de novo e a equipe pode pedir pela tela.
    return json({ ok: true, faltam: 0, concluido: false, mensagem: "Sua assinatura ficou registrada. O PDF final sai em seguida." });
  }
  return json({ ok: true, faltam: 0, concluido: true, pdf_url: await urlAssinada(supabase, `files://${f.pdf_path}`), pdf_hash: f.pdf_hash });
}

async function assinarContratoDeModelo(supabase: any, contract: any, body: any, ip: string, userAgent: string, token: string) {
  const nome = typeof body.signature_name === "string" ? body.signature_name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const hashVisto = typeof body.hash === "string" ? body.hash.trim().toLowerCase() : "";
  if (!nome || nome.length > 200 || !EMAIL_VALIDO.test(email) || email.length > 254 || body.accept !== true) {
    return json({ error: "missing or invalid fields", mensagem: "Preencha nome, e-mail válido e o aceite." }, 400);
  }
  if (contract.status !== "sent" || !contract.admin_signed_at || contract.client_signed_at || !contract.documento_texto) {
    return json({ error: "contract is not available for signing", mensagem: "Este contrato não está disponível para assinatura." }, 409);
  }
  if (hashVisto !== contract.documento_hash) {
    return json({ error: "documento_mudou", mensagem: "O documento mudou desde que você abriu o link. Abra o link de novo." }, 409);
  }

  // Trilha para a página de carimbo (o que já aconteceu e esta assinatura).
  const { data: evs, error: erroEventos } = await supabase.from("contrato_eventos").select("tipo, resumo, criado_em").eq("contract_id", contract.id).order("criado_em", { ascending: true }).limit(80);
  if (erroEventos) console.error("contract-public: trilha não lida", { contract_id: contract.id, message: erroEventos.message });
  const assinadoEm = new Date().toISOString();
  const eventos: EventoNoCarimbo[] = ((evs as any[]) || []).map((e) => ({ quando: String(e.criado_em), texto: String(e.resumo || e.tipo) }));
  eventos.push({ quando: assinadoEm, texto: `Assinado pelo contratante: ${nome} (${email}), IP ${ip}.` });

  const { data: perfil } = await supabase.from("profiles").select("company_name, full_name").eq("id", contract.client_id).maybeSingle();
  const cliente = (perfil && (perfil.company_name || perfil.full_name)) || "cliente";
  const pdf = gerarPdfDoContrato({
    texto: contract.documento_texto,
    numero: String(contract.numero || ""),
    versao: Number(contract.versao) || 1,
    hash: contract.documento_hash,
    quemAssina: [
      { papel: "Pela contratada", nome: String(contract.admin_signature_name || "") },
      { papel: "Pelo contratante", nome, detalhe: email },
    ],
    carimbo: {
      assinaturas: [
        { papel: "Pela contratada", nome: String(contract.admin_signature_name || ""), email: contract.admin_signature_email, quando: String(contract.admin_signed_at), ip: contract.admin_signature_ip },
        { papel: "Pelo contratante", nome, email, quando: assinadoEm, ip, navegador: userAgent.slice(0, 200) },
      ],
      eventos,
      verificacao: `${EMAIL_APP_URL}/contrato/${token}`,
    },
  });
  const pdfHash = await hashDosBytes(pdf);
  const arquivo = nomeDoArquivoDoContrato(String(contract.numero || ""), cliente, Number(contract.versao) || 1, true);
  const caminho = `contracts/${contract.client_id}/${contract.id}/v${Number(contract.versao) || 1}/${arquivo}`;
  const { error: erroUpload } = await supabase.storage.from("files").upload(caminho, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
  if (erroUpload) {
    console.error("contract-public: PDF assinado não subiu", { contract_id: contract.id, message: erroUpload.message });
    return json({ error: "pdf_nao_enviado", mensagem: "Não foi possível registrar a assinatura agora. Tente de novo." }, 503);
  }

  const { error: erroAssinatura } = await supabase.rpc("contrato_concluir_assinatura", {
    p_token: token,
    p_nome: nome,
    p_email: email,
    p_ip: ip,
    p_user_agent: userAgent.slice(0, 400),
    p_hash_visto: hashVisto,
    p_assinado_em: assinadoEm,
    p_pdf_path: caminho,
    p_pdf_nome: arquivo,
    p_pdf_hash: pdfHash,
  });
  if (erroAssinatura) {
    const { error: limpeza } = await supabase.storage.from("files").remove([caminho]);
    if (limpeza) console.error("contract-public: PDF sem assinatura ficou no Storage", { caminho, message: limpeza.message });
    const status = erroAssinatura.message === "contract not found" ? 404 : 409;
    return json({ error: erroAssinatura.message, mensagem: "A assinatura não foi registrada. Abra o link de novo." }, status);
  }
  return json({ ok: true, pdf_url: await urlAssinada(supabase, `files://${caminho}`), pdf_hash: pdfHash });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = req.headers.get("user-agent") || "";

    // GET ?token=xxx -> public details (limited fields)
    if (req.method === "GET") {
      const token = url.searchParams.get("token");
      if (!token) return json({ error: "missing token" }, 400);

      const { contract, modelo, error, signatario } = await lerPorToken(supabase, token);
      if (error || !contract) return json({ error: "invalid token" }, 404);
      if (contract.status === "substituido") {
        return json({ error: "substituido", mensagem: "Este link foi substituído por uma versão nova do contrato. Peça o link novo à agência." }, 410);
      }
      if (!["sent", "signed", "completed"].includes(contract.status)) return json({ error: "invalid token" }, 404);

      // attach client basic info for display
      const { data: client, error: clientError } = await supabase
        .from("profiles")
        .select(modelo ? "full_name, company_name, email" : "full_name, company_name")
        .eq("id", contract.client_id)
        .maybeSingle();
      if (clientError) return json({ error: "client unavailable" }, 503);

      if (modelo) {
        if (contract.status === "sent") await registrarVisita(supabase, contract, ip, userAgent);
        const pdfRef = contract.status === "completed" ? contract.original_file_url : contract.documento_pdf_url;
        // Frente CON2: quem é a pessoa deste link e quem já assinou (nomes e papéis, sem e-mail nem IP dos outros).
        const { lista } = signatario ? await lerSignatariosDoContrato(supabase, contract.id) : { lista: [] };
        return json({
          signatario: signatario ? { papel: signatario.papel, nome: signatario.nome, email: signatario.email, assinado_em: signatario.assinado_em } : null,
          assinaturas: lista.map((s) => ({ papel: s.papel, nome: s.nome, assinado: !!s.assinado_em })),
          contract: {
            title: contract.title,
            description: contract.description,
            status: contract.status,
            origem: "modelo",
            numero: contract.numero,
            versao: contract.versao,
            documento_texto: contract.documento_texto,
            documento_hash: contract.documento_hash,
            admin_signature_name: contract.admin_signature_name,
            admin_signed_at: contract.admin_signed_at,
            client_signature_name: contract.client_signature_name,
            client_signed_at: contract.client_signed_at,
            original_file_name: contract.original_file_name,
            pdf_url: await urlAssinada(supabase, pdfRef),
          },
          client,
        });
      }

      const contractPath = storagePathFromFilesReference(contract.original_file_url);
      let signedFileUrl = contract.original_file_url;
      if (contractPath) {
        const { data: signed, error: signedError } = await supabase.storage
          .from("files")
          .createSignedUrl(contractPath, 60 * 60);
        if (signedError || !signed?.signedUrl) {
          return json({ error: "contract file unavailable" }, 503);
        }
        signedFileUrl = signed.signedUrl;
      }

      // Só os campos de sempre (o IP e o e-mail de quem assinou não saem no link).
      return json({
        contract: {
          id: contract.id,
          title: contract.title,
          description: contract.description,
          original_file_name: contract.original_file_name,
          status: contract.status,
          admin_signature_name: contract.admin_signature_name,
          admin_signed_at: contract.admin_signed_at,
          client_signature_name: contract.client_signature_name,
          client_signed_at: contract.client_signed_at,
          original_file_url: signedFileUrl,
        },
        client,
      });
    }

    // POST -> sign action
    if (req.method === "POST") {
      const body = await req.json();
      const { token, signature_name, accept } = body || {};
      const normalizedToken = typeof token === "string" ? token.trim() : "";
      if (!normalizedToken) return json({ error: "missing or invalid fields" }, 400);

      const { contract, modelo, signatario } = await lerPorToken(supabase, normalizedToken);
      if (contract && modelo && signatario) {
        return await assinarComoSignatario(supabase, contract, signatario, body || {}, ip, userAgent, normalizedToken);
      }
      if (contract && modelo) {
        return await assinarContratoDeModelo(supabase, contract, body || {}, ip, userAgent, normalizedToken);
      }

      const normalizedName = typeof signature_name === "string"
        ? signature_name.trim()
        : "";
      if (!normalizedName || normalizedName.length > 200 || accept !== true) {
        return json({ error: "missing or invalid fields" }, 400);
      }

      const { error: completionError } = await supabase.rpc(
        "complete_contract_signature",
        {
          p_token: normalizedToken,
          p_signature_name: normalizedName,
          p_signature_ip: ip,
        },
      );
      if (completionError) {
        const status = completionError.message === "contract not found" ? 404 : 400;
        return json({ error: completionError.message }, status);
      }

      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
