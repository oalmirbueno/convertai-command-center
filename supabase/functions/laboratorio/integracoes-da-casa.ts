/** Leituras nativas com o JWT do operador. Nunca concede licença, publica ou mistura titulares. */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ErroHttp, UUID } from "./comum.ts";
import type { NoDoCanvas } from "./modulos/regras.ts";
import { escaparHtml } from "./modulos/funil.ts";

export type ContextoDaCasa = { token: string; projeto: { client_id: string | null }; userId?: string };
export type ProdutoDaCasa = { id: string; titulo: string; estado: string };
type LeituraNativa = { texto: string; json: Record<string, unknown> };
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const lista = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(objeto) : [];
const texto = (v: unknown, max = 400) => typeof v === "string" ? v.trim().slice(0, max) : "";

function bancoDoOperador(ctx: ContextoDaCasa): SupabaseClient {
  if (!ctx.token) throw new ErroHttp(401, "sessao_expirada", "Entre novamente para puxar os dados do painel.");
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${ctx.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function exigirAdminMembros(banco: SupabaseClient) {
  const r = await banco.rpc("membros_admin");
  if (r.error || r.data !== true) throw new ErroHttp(403, "membros_sem_administracao", "A leitura da biblioteca e do CRM dos membros exige administração da área de membros.");
}

function idDoProduto(valor: unknown): string {
  const id = texto(valor, 80);
  if (!UUID.test(id)) throw new ErroHttp(400, "produto_da_casa_ausente", "Escolha o produto do painel neste nó.");
  return id;
}

/** Catálogo mínimo; não devolve compras, pessoas, chaves ou licenças. */
export async function catalogoDaCasa(ctx: ContextoDaCasa, no: NoDoCanvas, porta?: SupabaseClient): Promise<ProdutoDaCasa[]> {
  if (no.tipo !== "crm" && no.tipo !== "area_membros") throw new ErroHttp(400, "no_sem_conexao_nativa", "Escolha um nó CRM ou Área de membros.");
  const banco = porta || bancoDoOperador(ctx);
  await exigirAdminMembros(banco);
  const r = await banco.from("membros_produtos").select("id,titulo,estado").neq("estado", "arquivado").order("ordem").limit(200);
  if (r.error) throw new ErroHttp(503, "catalogo_membros_indisponivel", "Não foi possível ler os produtos da biblioteca.");
  const produtos = lista(r.data).map((x) => ({ id: texto(x.id, 80), titulo: texto(x.titulo, 180), estado: texto(x.estado, 30) }));
  if (no.tipo !== "crm") return produtos;
  const f = await banco.from("membros_ferramentas").select("produto_id").eq("motor", "crm").eq("ativo", true);
  if (f.error) throw new ErroHttp(503, "catalogo_crm_indisponivel", "Não foi possível conferir as ferramentas CRM.");
  const ids = new Set(lista(f.data).map((x) => texto(x.produto_id, 80)));
  return produtos.filter((x) => ids.has(x.id));
}

export function resumoDasEtapas(registros: Record<string, unknown>[], campo: string): Record<string, number> {
  const etapas: Record<string, number> = Object.create(null);
  for (const item of registros) {
    const etapa = texto(item[campo], 100) || "Sem etapa";
    etapas[etapa] = (etapas[etapa] || 0) + 1;
  }
  return etapas;
}

/** CRM interno e CRM do membro são fontes distintas, sempre com autorização original. */
export async function lerCrmDaCasa(ctx: ContextoDaCasa, no: NoDoCanvas, porta?: SupabaseClient): Promise<LeituraNativa | null> {
  const origem = texto(no.dados.crm_origem, 20);
  if (!origem) return null;
  if (origem !== "agencia" && origem !== "cliente") throw new ErroHttp(400, "crm_origem_invalida", "Escolha CRM da agência ou CRM do cliente.");
  const banco = porta || bancoDoOperador(ctx);
  const consultado = new Date().toISOString();
  if (origem === "agencia") {
    const titular = ctx.userId || (await banco.auth.getUser()).data.user?.id;
    if (!titular) throw new ErroHttp(401, "sessao_expirada", "Entre novamente para ler o CRM da agência.");
    const papeis = await banco.from("user_roles").select("role").eq("user_id", titular);
    if (papeis.error || !lista(papeis.data).some((p) => p.role === "admin" || p.role === "manager")) throw new ErroHttp(403, "crm_agencia_sem_acesso", "A leitura do CRM da agência exige acesso de administração ou gestão comercial.");
    const r = await banco.from("commercial_leads").select("stage").is("archived_at", null).order("id").limit(1001);
    if (r.error) throw new ErroHttp(403, "crm_agencia_sem_acesso", "Não foi possível ler o CRM da agência com o seu acesso comercial.");
    const todos = lista(r.data);
    const registros = todos.slice(0, 1000);
    const etapas = resumoDasEtapas(registros, "stage");
    return {
      texto: `CRM da agência Aceleriq. Consulta: ${consultado}. ${registros.length} oportunidades${todos.length > 1000 ? " na amostra de até 1.000" : ""}. Etapas: ${Object.entries(etapas).map(([n, qtd]) => `${n}: ${qtd}`).join("; ") || "nenhuma"}. Esta leitura não altera contatos nem negócios.`,
      json: { origem, fonte: "commercial_leads", consultado_em: consultado, oportunidades: registros.length, amostra: todos.length > 1000, etapas },
    };
  }
  const titular = ctx.projeto.client_id;
  if (!titular || !UUID.test(titular)) throw new ErroHttp(400, "crm_cliente_ausente", "Escolha o cliente do projeto antes de puxar o CRM dele.");
  const acesso = await banco.rpc("can_access_client", { _client_id: titular });
  if (acesso.error || acesso.data !== true) throw new ErroHttp(403, "crm_cliente_sem_acesso", "Você não tem acesso ao cliente deste projeto.");
  await exigirAdminMembros(banco);
  const produto = idDoProduto(no.dados.produto_crm_id);
  const f = await banco.from("membros_ferramentas").select("produto_id").eq("produto_id", produto).eq("motor", "crm").eq("ativo", true).maybeSingle();
  if (f.error || !f.data) throw new ErroHttp(400, "produto_nao_e_crm", "Escolha uma ferramenta CRM ativa do painel.");
  const r = await banco.rpc("membros_ferramentas_admin", { _usuario: titular, _produto: produto });
  if (r.error) throw new ErroHttp(403, "crm_membro_sem_acesso", "Não foi possível acompanhar o CRM deste cliente.");
  // O procedimento também devolve metadados administrativos. Só os agregados deste titular entram no contexto.
  const dados = objeto(r.data);
  const contatos = lista(dados.contatos).filter((x) => x.arquivado !== true);
  const negocios = lista(dados.negocios).filter((x) => x.arquivado !== true);
  const etapas = resumoDasEtapas(negocios, "estagio");
  const perfil = await banco.from("profiles").select("full_name,company_name").eq("id", titular).maybeSingle();
  const nomeCliente = texto(objeto(perfil.data).company_name) || texto(objeto(perfil.data).full_name) || "cliente deste projeto";
  return {
    texto: `CRM de ${nomeCliente}. Consulta: ${consultado}. ${contatos.length} contatos ativos e ${negocios.length} negócios ativos. Etapas: ${Object.entries(etapas).map(([n, qtd]) => `${n}: ${qtd}`).join("; ") || "nenhuma"}. Dados separados do CRM da agência; leitura sem alterações.`,
    json: { origem, fonte: "membros_crm", client_id: titular, produto_id: produto, consultado_em: consultado, contatos: contatos.length, negocios: negocios.length, etapas },
  };
}

/** Liga o funil a um produto existente da própria biblioteca. Não cria nem libera cursos por suposição. */
export async function lerMembrosDaCasa(ctx: ContextoDaCasa, no: NoDoCanvas, porta?: SupabaseClient): Promise<(LeituraNativa & { html: string }) | null> {
  if (no.dados.plataforma && no.dados.plataforma !== "painel") return null;
  const banco = porta || bancoDoOperador(ctx);
  await exigirAdminMembros(banco);
  const id = idDoProduto(no.dados.produto_membros_id);
  const p = await banco.from("membros_produtos").select("id,titulo,estado,descricao").eq("id", id).maybeSingle();
  if (p.error || !p.data) throw new ErroHttp(404, "produto_membros_indisponivel", "Este produto não está disponível na biblioteca do painel.");
  const [m, a] = await Promise.all([
    banco.from("membros_modulos").select("id,titulo,ordem").eq("produto_id", id).order("ordem").limit(100),
    banco.from("membros_materiais").select("id,titulo,tipo,modulo_id,estado,ordem").eq("produto_id", id).order("ordem").limit(300),
  ]);
  if (m.error || a.error) throw new ErroHttp(503, "estrutura_membros_indisponivel", "Não foi possível conferir os módulos e materiais deste produto.");
  const produto = objeto(p.data);
  const modulos = lista(m.data);
  const materiais = lista(a.data);
  const titulo = texto(produto.titulo, 180);
  const url = `https://aceleriq.online/membros?produto=${encodeURIComponent(id)}`;
  const consultado = new Date().toISOString();
  const conteudo = modulos.map((modulo) => `<section><h2>${escaparHtml(modulo.titulo)}</h2><ul>${materiais.filter((x) => x.modulo_id === modulo.id).map((x) => `<li>${escaparHtml(x.titulo)} <small>${escaparHtml(x.tipo)}</small></li>`).join("")}</ul></section>`).join("");
  const soltos = materiais.filter((x) => !x.modulo_id);
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(titulo)}</title><style>body{margin:0;background:#101211;color:#f4f5f4;font:16px/1.6 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:40px 24px}h1{font-size:32px;line-height:1.2}h2{font-size:20px}section{padding:16px 0;border-bottom:1px solid #303530}a{display:inline-block;background:#00df67;color:#07150c;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600}small{color:#a9b4ab}li{padding:4px 0}</style><main><small>Biblioteca Aceleriq</small><h1>${escaparHtml(titulo)}</h1><p>${escaparHtml(texto(produto.descricao, 3000))}</p>${conteudo}${soltos.length ? `<section><h2>Aulas e materiais</h2><ul>${soltos.map((x) => `<li>${escaparHtml(x.titulo)}</li>`).join("")}</ul></section>` : ""}<p><a href="${url}" target="_blank" rel="noopener noreferrer">Abrir na área de membros</a></p><small>O acesso segue a licença de cada pessoa. Nenhum pagamento ou liberação automática foi ativado.</small></main></html>`;
  return { texto: `Área de membros do próprio painel: ${titulo}. ${modulos.length} módulos e ${materiais.length} aulas/materiais existentes. Estado: ${texto(produto.estado)}. Consulta: ${consultado}. Abrir: ${url}. O nó não altera o produto nem concede acesso.`, json: { plataforma: "painel", produto_id: id, titulo, estado: produto.estado, url, consultado_em: consultado, modulos, materiais }, html };
}
