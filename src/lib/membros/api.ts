import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Catalogo,
  Produto,
  Material,
  Progresso,
  ItemChecklist,
  TesteCliente,
  Modulo,
  PassoFunil,
} from "./modelo";

import { limparProduto, limparMaterial, semTravessoes } from "./modelo";
import { validarMaterial } from "./arquivos";

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
  modulos: Modulo[];
  funil: PassoFunil[];
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
  const mensagensClaras = [
    "O acesso a esta ferramenta não está liberado ou venceu. Seus dados permanecem privados.",
    "A ferramenta está aberta em outro dispositivo ou a sessão venceu. Abra novamente para continuar.",
    "Este contato mudou em outra aba. Atualize antes de salvar.",
    "Este negócio mudou em outra aba. Atualize antes de salvar.",
    "O material mudou depois deste rascunho. Prepare uma nova versão antes de publicar.",
    "Entre e confirme seu cadastro",
    "Abra a ferramenta novamente",
    "Não troque o tipo de uma ferramenta que já tem licenças",
  ];
  if (obj?.message && mensagensClaras.includes(obj.message)) return obj.message;
  if (
    e instanceof Error &&
    /^(Escolha |Este arquivo |O arquivo escolhido |Arquivo compactado |Diretório do pacote |Este pacote |O pacote contém |Permita o armazenamento |Não foi possível preparar |Não foi possível copiar\.)/.test(
      e.message,
    )
  )
    return e.message;
  if (obj?.code === "40001")
    return "Este registro mudou em outra aba. Atualize antes de salvar.";
  if (["22023", "23514", "23502", "22P02"].includes(obj?.code || ""))
    return "Confira os campos e o arquivo selecionado antes de salvar.";
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
  const catalogo = dado as Catalogo;
  return { ...catalogo, produtos: catalogo.produtos.map(limparProduto) };
}
export async function carregarMateriais(
  produto: string,
  previa?: string,
  teste?: TesteCliente,
): Promise<{
  materiais: Material[];
  progresso: Progresso[];
  modulos?: Modulo[];
}> {
  const dado = conferir(
    await banco.rpc("membros_acervo", {
      _produto: produto,
      _teste: !!teste,
      _bloqueado: !!teste?.bloqueado,
      _previa: previa || null,
    }),
  );
  return {
    ...dado,
    materiais: (dado?.materiais || []).map(limparMaterial),
    modulos: (dado?.modulos || []).map((m: Modulo) => ({
      ...m,
      titulo: semTravessoes(m.titulo),
      descricao: semTravessoes(m.descricao),
    })),
  };
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
    banco.from("membros_modulos").select("*").order("ordem"),
    banco.from("membros_funil").select("*").order("ordem"),
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
      "modulos",
      "funil",
    ].map((key, i) => [
      key,
      (rows[i] || []).map((row: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            typeof v === "string" &&
            [
              "titulo",
              "descricao",
              "texto",
              "categoria",
              "formato",
              "condicoes",
              "observacao",
              "mensagem",
              "full_name",
              "name",
            ].includes(k)
              ? semTravessoes(v)
              : v,
          ]),
        ),
      ),
    ]),
  ) as DadosAdmin;
}
export async function salvarLinha(
  tabela:
    | "membros_produtos"
    | "membros_materiais"
    | "membros_acessos"
    | "membros_beneficios_plano"
    | "membros_vinculos_venda"
    | "membros_checklist"
    | "membros_modulos"
    | "membros_funil",
  dados: Record<string, unknown>,
  conflito = "id",
): Promise<void> {
  const resultado = await banco
    .from(tabela)
    .upsert(
      Object.fromEntries(
        Object.entries(dados).map(([k, v]) => [
          k,
          typeof v === "string" &&
          [
            "titulo",
            "descricao",
            "texto",
            "condicoes",
            "formato",
            "categoria",
            "cta",
          ].includes(k)
            ? semTravessoes(v)
            : v,
        ]),
      ),
      { onConflict: conflito },
    )
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
  if (![produto, material].every((id) => /^[a-f0-9-]{36}$/i.test(id)))
    throw Error("Destino do arquivo inválido.");
  const contentType = await validarMaterial(arquivo);
  const nome = arquivo.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(-160);
  const caminho = `${produto}/${material}/${crypto.randomUUID()}-${nome}`;
  conferir(
    await banco.storage.from("membros-materiais").upload(caminho, arquivo, {
      upsert: false,
      contentType,
    }),
  );
  return caminho;
}
