import { createClient } from "npm:@supabase/supabase-js@2";
import { autorizaDownload, confirmarAsaas } from "./confirmacao.ts";
import { modoArquivoValido } from "./modo.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Max-Age": "7200",
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")
    return resposta({ erro: "metodo_nao_permitido" }, 405);
  const token = (req.headers.get("authorization") || "").replace(
    /^Bearer /i,
    "",
  );
  if (!token) return resposta({ erro: "sessao_expirada" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const usuario = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: erroAuth } = await usuario.auth.getUser(token);
  if (erroAuth || !auth.user) return resposta({ erro: "sessao_expirada" }, 401);
  let corpo: Record<string, unknown>;
  try {
    const texto = await req.text();
    if (texto.length > 4096) return resposta({ erro: "pedido_grande" }, 413);
    corpo = JSON.parse(texto);
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo))
      throw new Error();
  } catch {
    return resposta({ erro: "pedido_invalido" }, 400);
  }
  try {
    if (corpo.acao === "arquivo_versao") {
      if (typeof corpo.material_id !== "string" || !UUID.test(corpo.material_id) || typeof corpo.versao_id !== "string" || !UUID.test(corpo.versao_id)
        || corpo.previa_usuario !== undefined || corpo.teste_cliente !== undefined || corpo.download !== undefined)
        return resposta({erro:"versao_invalida"},400);
      // A consulta usa o JWT real e só a administração pode ler versões.
      const {data:versoes,error}=await usuario.rpc("membros_conteudo_versoes_ler",{_material:corpo.material_id});
      if(error) return resposta({erro:"sem_permissao"},403);
      const versao=Array.isArray(versoes)?versoes.find(v=>v.id===corpo.versao_id):null;
      const caminho=versao?.dados?.arquivo;
      if(typeof caminho!=="string" || caminho.split('/')[1]!==corpo.material_id || !UUID.test(caminho.split('/')[0]))
        return resposta({erro:"arquivo_indisponivel"},404);
      const {data:arquivo,error:erroArquivo}=await usuario.storage.from("membros-materiais").createSignedUrl(caminho,60);
      if(erroArquivo||!arquivo) return resposta({erro:"arquivo_indisponivel"},503);
      return resposta({url:arquivo.signedUrl,expira_em:new Date(Date.now()+60000).toISOString()});
    }
    if (corpo.acao === "arquivo") {
      if (
        typeof corpo.material_id !== "string" ||
        !UUID.test(corpo.material_id)
      )
        return resposta({ erro: "material_invalido" }, 400);
      const previa = corpo.previa_usuario;
      if (
        previa !== undefined &&
        (typeof previa !== "string" || !UUID.test(previa))
      )
        return resposta({ erro: "pessoa_invalida" }, 400);
      if (!modoArquivoValido(corpo))
        return resposta({ erro: "modo_invalido" }, 400);
      // Consulta com o JWT real. A prévia exige admin no servidor e os direitos do cliente.
      const { data: material, error } = await usuario
        .from("membros_materiais")
        .select("id,produto_id,arquivo,titulo,permite_download")
        .eq("id", corpo.material_id)
        .maybeSingle();
      if (error) return resposta({ erro: "leitura_indisponivel" }, 503);
      if (!material || !material.arquivo)
        return resposta({ erro: "material_indisponivel" }, 404);
      let m = material;
      if (corpo.teste_cliente === true) {
        // Não basta o RLS de admin: o teste exige o direito real de membro.
        const { data: vista, error: erroTeste } = await usuario.rpc(
          "membros_teste_materiais",
          {
            _produto: material.produto_id,
            _bloqueado: corpo.bloqueado === true,
          },
        );
        const autorizado = vista?.materiais?.find(
          (item: { id: string }) => item.id === material.id,
        );
        if (erroTeste || !autorizado)
          return resposta({ erro: "sem_permissao" }, 403);
        m = autorizado;
      }
      if (previa) {
        const { data: vista, error: erroPrevia } = await usuario.rpc(
          "membros_previa",
          { _usuario: previa, _produto: material.produto_id },
        );
        if (erroPrevia) return resposta({ erro: "sem_permissao" }, 403);
        const autorizado = vista?.materiais?.find(
          (item: { id: string }) => item.id === material.id,
        );
        if (!autorizado) return resposta({ erro: "sem_permissao" }, 403);
        m = autorizado;
      }
      if (!autorizaDownload(m.permite_download, corpo.download === true))
        return resposta({ erro: "download_nao_autorizado" }, 403);
      const { data: arquivo, error: erroArquivo } = await usuario.storage
        .from("membros-materiais")
        .createSignedUrl(
          m.arquivo,
          60,
          corpo.download === true ? { download: true } : undefined,
        );
      if (erroArquivo || !arquivo)
        return resposta({ erro: "arquivo_indisponivel" }, 503);
      return resposta({
        url: arquivo.signedUrl,
        expira_em: new Date(Date.now() + 60000).toISOString(),
      });
    }
    if (corpo.acao !== "conciliar")
      return resposta({ erro: "acao_invalida" }, 400);
    const { data: admin, error: erroPapel } =
      await usuario.rpc("membros_admin");
    if (erroPapel || admin !== true)
      return resposta({ erro: "sem_permissao" }, 403);
    const { data: habilitado, error: erroTrava } = await usuario.rpc(
      "membros_pagamentos_habilitados",
    );
    if (erroTrava) return resposta({ erro: "configuracao_indisponivel" }, 503);
    if (habilitado !== true)
      return resposta({
        ok: true,
        pendente: true,
        motivo: "pagamentos_desativados",
      });
    if (typeof corpo.evento_id !== "string" || !UUID.test(corpo.evento_id))
      return resposta({ erro: "evento_invalido" }, 400);
    const servico = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: ev, error: erroEvento } = await servico
      .from("vendas_eventos")
      .select("id,integracao_id,id_externo")
      .eq("id", corpo.evento_id)
      .maybeSingle();
    if (erroEvento || !ev)
      return resposta({ erro: "evento_indisponivel" }, 404);
    const { data: i, error: erroIntegracao } = await servico
      .from("vendas_integracoes")
      .select("id,gateway,chave,client_id,ativo")
      .eq("id", ev.integracao_id)
      .maybeSingle();
    if (
      erroIntegracao ||
      !i ||
      !i.ativo ||
      i.client_id !== null ||
      !["asaas", "kiwify"].includes(i.gateway)
    )
      return resposta({ erro: "integracao_nao_autorizada" }, 403);
    const registrar = async (estado: string, mensagem: string) => {
      const { error } = await servico.from("membros_processamentos").upsert(
        {
          evento_id: ev.id,
          estado,
          mensagem,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: "evento_id" },
      );
      if (error) throw new Error("registro_indisponivel");
    };
    if (i.gateway === "kiwify") {
      await registrar(
        "kiwify_pendente",
        "A confirmação segura da Kiwify ainda precisa ser configurada e validada.",
      );
      return resposta({ ok: true, pendente: true });
    }
    const { data: cred, error: erroCred } = await servico.rpc(
      "vendas_integracao_para_webhook",
      { _gateway: i.gateway, _chave: i.chave },
    );
    if (erroCred || !cred?.token_api) {
      await registrar(
        "sem_configuracao",
        "Falta a configuração de leitura do provedor no cofre existente.",
      );
      return resposta({ ok: true, pendente: true });
    }
    try {
      // Nunca usa contato, produto ou estado do corpo recebido para conceder direito.
      const id = ev.id_externo.split(":")[0];
      const confirmado = await confirmarAsaas(
        id,
        cred.token_api,
        (endereco, init) =>
          fetch(endereco, { ...init, signal: AbortSignal.timeout(8000) }),
      );
      const { data: conciliado, error } = await servico.rpc(
        "membros_conciliar_pagamento",
        {
          _evento: ev.id,
          _pedido: confirmado.pedido,
          _produto_externo: confirmado.produto,
          _email: confirmado.email,
          _estado: confirmado.estado,
        },
      );
      if (error || !conciliado?.ok) {
        await registrar(
          "erro",
          "Confira o vínculo do produto e os dados da compra antes de repetir.",
        );
        return resposta({ ok: true, pendente: true });
      }
      return resposta(conciliado);
    } catch {
      await registrar(
        "erro",
        "Não foi possível confirmar o pagamento no provedor. Nenhum novo acesso foi liberado.",
      );
      return resposta({ ok: true, pendente: true });
    }
  } catch {
    // Não registrar token, conteúdo do provedor ou objeto de erro bruto.
    return resposta({ erro: "servico_indisponivel" }, 503);
  }
});
