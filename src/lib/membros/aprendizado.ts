import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { semTravessoes, type PassoFunil, type TesteCliente } from "./modelo";
const banco = supabase as unknown as SupabaseClient;
function conferir<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}
export type Conversa = {
  id: string;
  produto_id: string;
  autor_id: string;
  autor_nome: string;
  texto: string;
  resposta_a: string | null;
  oculto: boolean;
  fixado: boolean;
  criado_em: string;
  atualizado_em: string;
};
export async function carregarLista(teste = false): Promise<string[]> {
  return (
    conferir(await banco.rpc("membros_minha_lista", { _teste: teste })) || []
  );
}
export async function favoritar(
  produto: string,
  favorito: boolean,
  teste = false,
) {
  conferir(
    await banco.rpc("membros_favoritar", {
      _produto: produto,
      _favorito: favorito,
      _teste: teste,
    }),
  );
}
export async function carregarFunil(): Promise<PassoFunil[]> {
  return (
    conferir(
      await banco
        .from("membros_funil")
        .select("*")
        .eq("ativo", true)
        .order("ordem"),
    ) || []
  );
}
export async function carregarComunidade(
  produto: string,
  teste?: TesteCliente,
  previa?: string,
): Promise<Conversa[]> {
  const linhas = conferir(
    await banco.rpc("membros_comunidade_ler", {
      _produto: produto,
      _teste: !!teste,
      _bloqueado: !!teste?.bloqueado,
      _previa: previa || null,
    }),
  );
  return (linhas || []).map((c: Conversa) => ({
    ...c,
    texto: semTravessoes(c.texto),
    autor_nome: semTravessoes(c.autor_nome),
  }));
}
export async function salvarConversa(
  produto: string,
  texto: string,
  id?: string,
  resposta?: string,
  oculto = false,
  fixado = false,
) {
  conferir(
    await banco.rpc("membros_comunidade_salvar", {
      _produto: produto,
      _texto: semTravessoes(texto),
      _id: id || null,
      _resposta: resposta || null,
      _oculto: oculto,
      _fixado: fixado,
    }),
  );
}
export type PessoaMembro = {
  id: string;
  nome: string;
  email: string;
  confirmado: boolean;
  liberados: number;
  compras: number;
  pendentes: number;
  encerrados: number;
  situacao: string;
  ultimo_progresso: string | null;
};
export type ResumoPessoas = {
  pessoas: number;
  compradores: number;
  liberados: number;
  encerrados: number;
  pendentes: number;
};
export async function carregarPessoas(
  busca = "",
  produto = "",
  estado = "",
  pagina = 0,
): Promise<{ pessoas: PessoaMembro[]; total: number; resumo: ResumoPessoas }> {
  return conferir(
    await banco.rpc("membros_pessoas", {
      _busca: busca,
      _produto: produto || null,
      _estado: estado,
      _pagina: pagina,
    }),
  );
}
export type DetalhePessoa = {
  pessoa: { id: string; nome: string; email: string; confirmado: boolean };
  produtos: {
    id: string;
    titulo: string;
    estado: string;
    em_venda: boolean;
    origens: string[];
  }[];
  acessos: {
    id: string;
    produto_id: string;
    origem: string;
    inicio: string;
    fim: string | null;
    revogado_em: string | null;
  }[];
  compras: {
    id: string;
    produto_id: string;
    estado: string;
    inicio: string;
    fim: string | null;
    confirmado_em: string;
  }[];
  historico: {
    id: number;
    produto_id: string;
    origem: string;
    criado_em: string;
    anterior: Record<string, unknown> | null;
    atual: Record<string, unknown>;
  }[];
};
export async function carregarPessoa(id: string): Promise<DetalhePessoa> {
  return conferir(await banco.rpc("membros_pessoa_detalhe", { _usuario: id }));
}
export async function liberarPessoas(
  usuarios: string[],
  produtos: string[],
  fim?: string,
) {
  conferir(
    await banco.rpc("membros_liberar", {
      _usuarios: usuarios,
      _produtos: produtos,
      _fim: fim || null,
    }),
  );
}
export async function revogarManual(usuario: string, produto: string) {
  conferir(
    await banco.rpc("membros_revogar_manual", {
      _usuario: usuario,
      _produto: produto,
    }),
  );
}
export async function salvarNome(usuario: string, nome: string) {
  conferir(
    await banco.rpc("membros_pessoa_nome", {
      _usuario: usuario,
      _nome: semTravessoes(nome),
    }),
  );
}
export async function ordenar(
  produto: string,
  ids: string[],
  tipo: "modulos" | "materiais",
) {
  conferir(
    await banco.rpc("membros_ordenar", {
      _produto: produto,
      _itens: ids,
      _tipo: tipo,
    }),
  );
}
