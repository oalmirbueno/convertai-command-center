import { createClient } from "npm:@supabase/supabase-js@2";
import { conectar, credenciais, conferirVenda } from "./cliente.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const resposta = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return resposta({ erro: "metodo_invalido" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
  if (!jwt) return resposta({ erro: "sessao_expirada" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: aut, error } = await usuario.auth.getUser(jwt);
  if (error || !aut.user) return resposta({ erro: "sessao_expirada" }, 401);
  const { data: admin, error: erroAdmin } = await usuario.rpc("has_role", {
    _user_id: aut.user.id,
    _role: "admin",
  });
  if (erroAdmin || admin !== true)
    return resposta({ erro: "sem_permissao" }, 403);
  try {
    const texto = await req.text();
    if (texto.length > 5000) return resposta({ erro: "pedido_grande" }, 413);
    const corpo = JSON.parse(texto);
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo))
      return resposta({ erro: "pedido_invalido" }, 400);
    const servidor = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (corpo.acao === "salvar") {
      const c = credenciais(corpo);
      const conexao = await conectar(c, fetch);
      const { data: i, error: ei } = await servidor.rpc(
        "vendas_integracao_criar",
        { _client_id: null, _gateway: "kiwify", _ator: aut.user.id },
      );
      if (ei || !i?.id) throw Error("configuracao_nao_salva");
      const { error: ec } = await servidor.rpc("membros_kiwify_guardar", {
        _integracao: i.id,
        _credenciais: c,
        _nome: conexao.nome,
        _ator: aut.user.id,
      });
      if (ec) throw Error("configuracao_nao_salva");
      return resposta({ ok: true, automatico: false, nome: conexao.nome });
    }
    if (corpo.acao === "conferir") {
      const { data: c, error: ec } = await servidor.rpc(
        "membros_kiwify_credenciais",
      );
      if (ec || !c) throw Error("configuracao_pendente");
      const conexao = await conectar(credenciais(c), fetch);
      if (corpo.pedido) {
        const venda = await conferirVenda(
          String(corpo.pedido),
          conexao.headers,
          fetch,
        );
        return resposta({
          ok: true,
          automatico: false,
          nome: conexao.nome,
          pedido: venda.pedido,
          produto: venda.produto,
          estado: venda.estado,
        });
      }
      return resposta({ ok: true, automatico: false, nome: conexao.nome });
    }
    return resposta({ erro: "acao_invalida" }, 400);
  } catch (e) {
    const codigo = e instanceof Error ? e.message : "";
    const permitidos = [
      "credenciais_invalidas",
      "credenciais_recusadas",
      "permissoes_insuficientes",
      "conta_nao_confirmada",
      "venda_nao_confirmada",
      "pedido_invalido",
      "configuracao_pendente",
      "configuracao_nao_salva",
    ];
    return resposta(
      { erro: permitidos.includes(codigo) ? codigo : "conexao_indisponivel" },
      400,
    );
  }
});
