import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Catalogo,
  Produto,
  Material,
  Progresso,
  ItemChecklist,
  TesteCliente,
} from "./modelo";

// Contrato local explícito da biblioteca; mantém os tipos operacionais existentes.
const banco = supabase as unknown as SupabaseClient;
export type ProdutoEditavel = Omit<
  Produto,
  "origens" | "progresso" | "ultimo_material"
>;
export type Acesso = {
  id: string;
  user_id: string;
  produto_id: string;
  origem: string;
  referencia: string;
  inicio: string;
  fim: string | null;
  revogado_em: string | null;
};
export type Beneficio = {
  id: string;
  plano_id: string;
  produto_id: string;
  ativo: boolean;
};
export type Vinculo = {
  id: string;
  integracao_id: string;
  produto_id: string;
  produto_externo_id: string;
  regra: "dias" | "sem_prazo";
  dias: number | null;
  revogar_reembolso: boolean;
  ativo: boolean;
};
export type Processamento = {
  evento_id: string;
  estado: string;
  mensagem: string;
  tentativas: number;
  atualizado_em: string;
};
export type DadosAdmin = {
  produtos: ProdutoEditavel[];
  materiais: Material[];
  acessos: Acesso[];
  beneficios: Beneficio[];
  vinculos: Vinculo[];
  checklist: ItemChecklist[];
  historico: ItemChecklist[];
  processamentos: Processamento[];
  planos: { id: string; name: string }[];
  integracoes: { id: string; gateway: string }[];
  pessoas: { id: string; full_name: string; email: string }[];
};

export function mensagemDoErro(e: unknown): string {
  const obj = e as {
    code?: string;
    status?: number;
    message?: string;
    context?: { status?: number };
  };
  if (obj?.code === "MEMBROS_PAGAMENTOS_PAUSADOS")
    return "A liberação por Kiwify e Asaas está desativada até validarmos os pagamentos. Use um acesso manual para testar.";
  if (obj?.code === "MEMBROS_PENDENTE")
    return "A conferência continua pendente. Veja o motivo em Conferências de pagamento; nenhum novo acesso foi liberado.";
  if (obj?.code === "ARQUIVO_GRANDE")
    return "O arquivo excede o limite de 500 MB.";
  if (
    obj?.code === "PGRST202" ||
    obj?.code === "42P01" ||
    /membros_.*(not find|does not exist)/i.test(obj?.message || "")
  )
    return "A biblioteca ainda precisa ser preparada no servidor. Peça à administração para concluir a ativação.";
  if (
    obj?.code === "42501" ||
    obj?.status === 403 ||
    obj?.context?.status === 403
  )
    return "Você não tem acesso a este conteúdo.";
  if (
    obj?.status === 401 ||
    obj?.code === "PGRST301" ||
    obj?.context?.status === 401
  )
    return "Sua sessão expirou. Entre novamente.";
  return "Não foi possível carregar agora. Confira a conexão e tente novamente.";
}
function conferir<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}
export async function carregarCatalogo(
  previa?: string,
  teste?: TesteCliente,
): Promise<Catalogo & { pessoa?: { id: string; nome: string } }> {
  const dado: unknown = conferir(
    await (previa
      ? banco.rpc("membros_previa", { _usuario: previa })
      : banco.rpc("membros_biblioteca", {
          _teste: !!teste,
          _bloqueado: !!teste?.bloqueado,
        })),
  );
  if (
    !dado ||
    typeof dado !== "object" ||
    !Array.isArray((dado as Catalogo).produtos) ||
    !Array.isArray((dado as Catalogo).pendentes)
  )
    throw new Error("Resposta da biblioteca inválida");
  return dado as Catalogo;
}
export async function carregarMateriais(
  produto: string,
  previa?: string,
  teste?: TesteCliente,
): Promise<{ materiais: Material[]; progresso: Progresso[] }> {
  if (teste)
    return conferir(
      await banco.rpc("membros_teste_materiais", {
        _produto: produto,
        _bloqueado: teste.bloqueado,
      }),
    );
  if (previa)
    return conferir(
      await banco.rpc("membros_previa", {
        _usuario: previa,
        _produto: produto,
      }),
    );
  const materiais = conferir(
    await banco
      .from("membros_materiais")
      .select("id,produto_id,titulo,tipo,texto,arquivo,permite_download,ordem")
      .eq("produto_id", produto)
      .order("ordem")
      .returns<Material[]>(),
  );
  const ids = materiais.map((m) => m.id);
  const progresso = ids.length
    ? conferir(
        await banco
          .from("membros_progresso")
          .select("material_id,posicao,duracao,concluido,atualizado_em")
          .in("material_id", ids)
          .returns<Progresso[]>(),
      )
    : [];
  return { materiais, progresso };
}
export async function gravarProgresso(
  material: string,
  posicao: number,
  duracao: number,
  concluido: boolean,
  teste?: TesteCliente,
): Promise<void> {
  if (teste) {
    conferir(
      await banco.rpc("membros_teste_salvar_progresso", {
        _material: material,
        _posicao: posicao,
        _duracao: duracao,
        _concluido: concluido,
        _bloqueado: teste.bloqueado,
      }),
    );
    return;
  }
  const sessao = conferir(await supabase.auth.getUser());
  if (!sessao.user) throw { status: 401 };
  const resultado = await banco
    .from("membros_progresso")
    .upsert(
      {
        user_id: sessao.user.id,
        material_id: material,
        posicao: Math.max(0, Math.min(posicao, duracao || posicao, 604800)),
        duracao: Math.max(0, Math.min(duracao, 604800)),
        concluido,
      },
      { onConflict: "user_id,material_id" },
    )
    .select("material_id");
  const linhas = conferir(resultado);
  if (!linhas?.length) throw new Error("Progresso não confirmado");
}
export async function abrirArquivo(
  material: string,
  download = false,
  previa?: string,
  teste?: TesteCliente,
): Promise<{ url: string; expira_em: string }> {
  const dado = conferir(
    await supabase.functions.invoke("area-membros", {
      body: {
        acao: "arquivo",
        material_id: material,
        download,
        previa_usuario: previa,
        teste_cliente: !!teste,
        bloqueado: !!teste?.bloqueado,
      },
    }),
  );
  if (!dado?.url) throw new Error("Arquivo não disponível");
  return dado as { url: string; expira_em: string };
}
export async function reiniciarTeste(): Promise<void> {
  conferir(await banco.rpc("membros_teste_reiniciar"));
}
export async function carregarAdmin(): Promise<DadosAdmin> {
  const respostas = await Promise.all([
    banco.from("membros_produtos").select("*").order("ordem"),
    banco.from("membros_materiais").select("*").order("ordem"),
    banco
      .from("membros_acessos")
      .select("*")
      .order("atualizado_em", { ascending: false })
      .limit(200),
    banco.from("membros_beneficios_plano").select("*"),
    banco.from("membros_vinculos_venda").select("*"),
    banco.from("membros_checklist").select("*"),
    banco
      .from("membros_checklist_historico")
      .select("*")
      .order("atualizado_em", { ascending: false })
      .limit(100),
    banco
      .from("membros_processamentos")
      .select("*")
      .order("atualizado_em", { ascending: false })
      .limit(100),
    banco.from("financial_plans").select("id,name").eq("is_active", true),
    banco
      .from("vendas_integracoes")
      .select("id,gateway")
      .is("client_id", null)
      .eq("ativo", true)
      .in("gateway", ["kiwify", "asaas"]),
    banco.from("profiles").select("id,full_name,email").order("full_name"),
  ]);
  const rows = respostas.map(conferir);
  return Object.fromEntries(
    [
      "produtos",
      "materiais",
      "acessos",
      "beneficios",
      "vinculos",
      "checklist",
      "historico",
      "processamentos",
      "planos",
      "integracoes",
      "pessoas",
    ].map((key, i) => [key, rows[i] || []]),
  ) as DadosAdmin;
}
export async function salvarLinha(
  tabela:
    | "membros_produtos"
    | "membros_materiais"
    | "membros_acessos"
    | "membros_beneficios_plano"
    | "membros_vinculos_venda"
    | "membros_checklist",
  dados: Record<string, unknown>,
  conflito = "id",
): Promise<void> {
  const resultado = await banco
    .from(tabela)
    .upsert(dados, { onConflict: conflito })
    .select();
  const rows = conferir(resultado);
  if (!rows?.length) throw new Error("Gravação não confirmada");
}
export async function reprocessarEvento(evento_id: string): Promise<void> {
  const dado = conferir(
    await supabase.functions.invoke("area-membros", {
      body: { acao: "conciliar", evento_id },
    }),
  );
  if (!dado?.ok) throw new Error("Conciliação não confirmada");
  if (dado.motivo === "pagamentos_desativados")
    throw { code: "MEMBROS_PAGAMENTOS_PAUSADOS" };
  if (dado.pendente) throw { code: "MEMBROS_PENDENTE" };
}
export async function enviarMaterial(
  produto: string,
  material: string,
  arquivo: File,
): Promise<string> {
  if (arquivo.size > 524288000) throw { code: "ARQUIVO_GRANDE" };
  const nome = arquivo.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(-160);
  const caminho = `${produto}/${material}/${crypto.randomUUID()}-${nome}`;
  conferir(
    await banco.storage.from("membros-materiais").upload(caminho, arquivo, {
      upsert: false,
      contentType:
        arquivo.type === "application/x-zip-compressed"
          ? "application/zip"
          : arquivo.type || "application/octet-stream",
    }),
  );
  return caminho;
}
