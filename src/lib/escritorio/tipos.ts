/**
 * Escritório dos agentes (18/11/2026): as linhas do banco como a tela lê.
 * Contrato: supabase/migrations/20261118220000_escritorio_dos_agentes.sql.
 * As tabelas ainda não estão nos tipos gerados do Supabase, por isso ficam aqui.
 */

/** O lugar reservado da pessoa nas conversas: nenhum operador usa este slug. */
export const DONO = "dono";

export type Grau = "orquestrador" | "coordenador" | "executor" | "leitor";

/** Os graus, do que fala com todos ao que só lê. */
export const GRAUS: { valor: Grau; rotulo: string; alcance: string }[] = [
  { valor: "orquestrador", rotulo: "Orquestrador", alcance: "Fala com todos" },
  { valor: "coordenador", rotulo: "Coordenador", alcance: "Fala com a própria área e com os orquestradores" },
  { valor: "executor", rotulo: "Executor", alcance: "Fala com o coordenador e com as salas dele" },
  { valor: "leitor", rotulo: "Leitor", alcance: "Só lê e manda alerta" },
];
export const nomeDoGrau = (g?: string | null) => GRAUS.find((x) => x.valor === g)?.rotulo ?? "Executor";

export interface AgenteDoEscritorio {
  id: string;
  slug: string;
  display_name: string;
  role: string;
  scope: string;
  status: string;
  area: string | null;
  parent_slug: string | null;
  display_order?: number | null;
  origem: string | null;
  is_coordinator: boolean;
  last_run_at: string | null;
  hermes_profile_ref?: string | null;
  grau: string | null;
}

export type PapelNaSala = "dono_da_sala" | "membro" | "observador";

export const PAPEIS_NA_SALA: { valor: PapelNaSala; rotulo: string }[] = [
  { valor: "dono_da_sala", rotulo: "Dono da sala" },
  { valor: "membro", rotulo: "Membro" },
  { valor: "observador", rotulo: "Observador" },
];

export interface Sala {
  id: string;
  slug: string;
  nome: string;
  area: string | null;
  descricao: string | null;
  ativo: boolean;
}

export interface MembroDaSala {
  grupo_id: string;
  operator_slug: string;
  papel: PapelNaSala | string;
}

export interface Conversa {
  id: string;
  tipo: "direta" | "grupo" | string;
  grupo_id: string | null;
  assunto: string | null;
  client_id?: string | null;
  task_id?: string | null;
  criada_por: string;
  created_at: string;
  ultima_em: string;
}

export interface Mensagem {
  id: string;
  conversa_id: string;
  de_slug: string;
  de_tipo: "operador" | "humano" | string;
  para_slug: string | null;
  grupo_id: string | null;
  corpo: string;
  responde_a: string | null;
  client_id?: string | null;
  task_id?: string | null;
  created_at: string;
}

export interface Leitura {
  mensagem_id: string;
  leitor_slug: string;
  lida_em?: string | null;
}

export interface Presenca {
  operator_slug: string;
  batimento_em: string;
  fazendo: string | null;
  plataforma: string | null;
}

export interface Automacao {
  id: string;
  plataforma: string;
  ref: string;
  nome: string;
  o_que_faz: string | null;
  dono_slug: string | null;
  ativo: boolean;
  ultima_execucao_em: string | null;
  ultimo_status: "ok" | "erro" | "rodando" | null;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
  execucoes: number;
  erros: number;
  atualizado_em: string;
}

export interface Bloqueio {
  operator_slug: string;
  motivo: string | null;
  bloqueado_em: string;
  desfeito_em: string | null;
}

/** Qual credencial assina por qual agente. `principal` é "key:<uuid>" ou "oauth:<uuid>". */
export interface VinculoDeCredencial {
  principal: string;
  operator_slug: string;
  padrao: boolean;
  rotulo: string | null;
}

/** Só o que a tela pode mostrar de uma chave: nome e o começo dela. O segredo fica com hash no banco. */
export interface ChaveMcp {
  id: string;
  name: string;
  key_preview: string | null;
  audience?: string | null;
  is_active: boolean;
}

/** Regra permanente: dentro dela o agente faz sozinho e fica registrado; fora dela, sobe para o dono. */
export interface RegraPermanente {
  chave: string;
  nome: string;
  area: string | null;
  descricao: string | null;
  ligada: boolean;
  acoes: string[];
  /** Quem pode usar a regra. Vazio = qualquer agente. */
  operadores: string[];
  limites: Record<string, unknown>;
  atualizado_em: string;
}

/** Uma vez em que um agente agiu sozinho dentro de uma regra. */
export interface UsoDeRegra {
  id: string;
  regra: string;
  operator_slug: string | null;
  client_id: string | null;
  action_kind: string | null;
  valor: number | null;
  assunto: string | null;
  usado_em: string;
}

/** Um pedido antigo da caixa que já cabe nas regras de hoje. */
export interface ItemDaFilaDasRegras {
  approval_id: string;
  regra: string;
  operador: string | null;
  acao: string | null;
  o_que: string | null;
  criado_em: string;
}

export interface FilaDasRegras {
  total: number;
  aplicado: boolean;
  itens: ItemDaFilaDasRegras[];
}
