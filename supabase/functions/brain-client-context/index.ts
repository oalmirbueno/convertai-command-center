// Aceleriq OS — O que o segundo cérebro sabe sobre um cliente
//
// O painel guarda o que aconteceu dentro dele. O segundo cérebro guarda o
// resto: contexto de reuniões, decisões de estratégia, histórico que nunca
// passou por uma tela. Sem essa ponte, o ritual escreve com meio contexto e
// soa genérico, ou pior, afirma coisa errada por não saber o que já existe.
//
// Esta função busca no repositório de memória as notas que mencionam aquele
// cliente e devolve trechos curtos, prontos para virar contexto de IA.
//
// Segurança: só equipe autenticada. O bridge é read-only aqui: nada é escrito.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  bridgeStatusPublic,
  getFile,
  searchCode,
  SecondBrainError,
} from "../_shared/second-brain-github.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Só os pedaços que citam o cliente, com um pouco de contexto em volta. */
function trechosRelevantes(conteudo: string, termos: string[], max = 3): string[] {
  const linhas = conteudo.split("\n");
  const achados: string[] = [];
  for (let i = 0; i < linhas.length && achados.length < max; i += 1) {
    const linha = linhas[i];
    if (!termos.some((termo) => linha.toLowerCase().includes(termo))) continue;
    const bloco = linhas.slice(Math.max(0, i - 1), i + 3).join(" ").replace(/\s+/g, " ").trim();
    if (bloco.length > 40) achados.push(bloco.slice(0, 500));
  }
  return achados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Sessão expirada." }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: "Sessão expirada." }, 401);
    const { data: isStaff } = await admin.rpc("is_staff", { _user_id: userData.user.id });
    if (!isStaff) return jsonResponse({ error: "Somente equipe." }, 403);

    // Sem bridge configurado o painel segue funcionando sem este contexto.
    if (!bridgeStatusPublic().configured) {
      return jsonResponse({ configured: false, context: "", sources: [] });
    }

    const body = await req.json().catch(() => ({}));
    const nome = String(body?.client_name || "").trim();
    if (nome.length < 2) return jsonResponse({ error: "client_name obrigatório." }, 400);

    // Termos de busca: o nome inteiro e a primeira palavra (as notas raramente
    // usam a razão social completa).
    const primeiraPalavra = nome.split(/\s+/)[0];
    const termos = [nome.toLowerCase(), primeiraPalavra.toLowerCase()];

    let arquivos: Array<{ path: string }> = [];
    try {
      arquivos = await searchCode(primeiraPalavra, 5);
    } catch (error) {
      if (error instanceof SecondBrainError) {
        return jsonResponse({ configured: true, context: "", sources: [], note: "busca indisponível" });
      }
      throw error;
    }

    const blocos: string[] = [];
    const fontes: string[] = [];
    for (const arquivo of arquivos.slice(0, 4)) {
      try {
        const conteudo = await getFile(arquivo.path);
        const texto = typeof conteudo?.content === "string" ? conteudo.content : "";
        const trechos = trechosRelevantes(texto, termos);
        if (trechos.length > 0) {
          fontes.push(arquivo.path);
          blocos.push(`[${arquivo.path}]\n${trechos.join("\n")}`);
        }
      } catch {
        /* arquivo ilegível: segue para o próximo */
      }
    }

    return jsonResponse({
      configured: true,
      context: blocos.join("\n\n").slice(0, 4000),
      sources: fontes,
    });
  } catch (error) {
    // Contexto extra nunca pode derrubar a geração do ritual.
    console.warn(`[cerebro] falha: ${error instanceof Error ? error.message : String(error)}`);
    return jsonResponse({ configured: true, context: "", sources: [] });
  }
});
