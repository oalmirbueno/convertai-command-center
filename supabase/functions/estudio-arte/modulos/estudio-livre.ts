/**
 * Estúdio livre do Laboratório (19/10/2026).
 *
 * Pedido do dono: "um estúdio com a mesma funcionalidade do estúdio de artes,
 * pegada de arte rápida, carrossel, com a inteligência do estúdio, mas livre:
 * às vezes não é cliente nem projeto, é um trabalho avulso; posso escolher o
 * cliente, mas não quero que entre na mesa do cliente; vai para o arquivo
 * livre organizado".
 *
 * Decisão: o mesmo motor da arte rápida (rapida_preparar, geração, ajustes,
 * conferência, diretor), com o trabalho marcado em estudio_trabalhos.origem =
 * 'laboratorio'. A Mesa do cliente só lista origem 'mesa'. Sem cliente, o
 * trabalho é do cliente interno da agência (carteira e marca dela); com
 * cliente, usa a marca, o contexto e a carteira dele.
 *
 * Guardar (a ação `entregar` de um trabalho do Laboratório) NÃO vai para os
 * Arquivos do cliente, nem para a Agenda, nem para a aprovação: cada lâmina
 * vai para o Workspace global (bucket workspace, workspace_nodes scope
 * 'global') em Laboratório / <Livres | Nome do cliente> / Estúdio livre /
 * <AAAA-MM-DD>. Idempotente por lâmina e versão: guardar de novo só sobe o
 * que mudou.
 *
 * Sem import de Deno nem de npm: a função e os testes (vitest e deno) leem o
 * mesmo arquivo. Sem lookbehind, propriedade Unicode ou grupo nomeado em regex.
 */

export type OrigemDoTrabalho = "mesa" | "laboratorio";
export const ORIGENS_DO_TRABALHO: OrigemDoTrabalho[] = ["mesa", "laboratorio"];

export const BUCKET_DO_LABORATORIO = "workspace";
export const RAIZ_DO_LABORATORIO = "Laboratório";
export const PASTA_DOS_LIVRES = "Livres";
export const PASTA_DO_ESTUDIO_LIVRE = "Estúdio livre";

/** A origem pedida pela tela: só 'laboratorio' muda alguma coisa; o resto é a Mesa de sempre. */
export function origemDoPedido(v: unknown): OrigemDoTrabalho {
  return v === "laboratorio" ? "laboratorio" : "mesa";
}

/** O trabalho é do Laboratório (coluna estudio_trabalhos.origem). Sem a coluna, é da Mesa. */
export function ehDoLaboratorio(t: { origem?: unknown } | null | undefined): boolean {
  return !!t && t.origem === "laboratorio";
}

const semAcento = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Nome comparável de pasta: sem acento, sem caixa, só letras e números. */
export const nomeComparavel = (t: string) =>
  semAcento(t)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Nome que pode ir para pasta ou arquivo: sem barra, sem controle, curto. */
export function nomeDePasta(t: string | null | undefined, reserva: string): string {
  const s = String(t || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return s || reserva;
}

/** O dia em São Paulo (AAAA-MM-DD), a pasta do dia. */
export function diaEmSaoPaulo(agora: Date): string {
  try {
    const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
    if (/^\d{4}-\d{2}-\d{2}$/.test(partes)) return partes;
  } catch {
    /* sem Intl com fuso: cai no UTC-3 fixo */
  }
  return new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** As pastas: Laboratório / <Livres | Nome do cliente> / Estúdio livre / <dia>. */
export function pastasDoEstudioLivre(nomeDoCliente: string | null, dia: string): string[] {
  return [RAIZ_DO_LABORATORIO, nomeDoCliente ? nomeDePasta(nomeDoCliente, PASTA_DOS_LIVRES) : PASTA_DOS_LIVRES, PASTA_DO_ESTUDIO_LIVRE, dia];
}

/**
 * O nome da pasta do cliente: o cliente interno da agência (ou nenhum) vai para "Livres";
 * os outros, pelo nome da empresa (ou da pessoa).
 */
export function pastaDoCliente(perfil: { company_name?: unknown; full_name?: unknown; services_config?: unknown } | null | undefined): string | null {
  if (!perfil) return null;
  const sc = perfil.services_config && typeof perfil.services_config === "object" ? (perfil.services_config as Record<string, unknown>) : null;
  if (sc && sc.internal_company) return null;
  const nome = String(perfil.company_name || perfil.full_name || "").trim();
  return nome || null;
}

/** Prefixo fixo da lâmina (por trabalho, ordem e versão): guardar de novo acha o que já subiu. */
export function prefixoDaLamina(trabalhoId: string, ordem: number, versao: number): string {
  return `global/laboratorio/estudio-livre/${trabalhoId}/${Math.max(1, Math.floor(ordem))}-v${Math.max(1, Math.floor(versao))}`;
}

export const caminhoDaLamina = (trabalhoId: string, ordem: number, versao: number, extensao: string) =>
  `${prefixoDaLamina(trabalhoId, ordem, versao)}.${String(extensao || "png").replace(/^\./, "").toLowerCase()}`;

/** "<Título>.png" ou "<Título> (2 de 5).png" no carrossel. */
export function nomeDoArquivoDaLamina(titulo: string, posicao: number, total: number, extensao: string): string {
  const base = nomeDePasta(titulo, "Arte do estúdio livre").slice(0, 90);
  const ext = String(extensao || "png").replace(/^\./, "").toLowerCase();
  return total > 1 ? `${base} (${posicao} de ${total}).${ext}` : `${base}.${ext}`;
}

export interface NoDaPasta {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
}

export interface NoNovoDoLaboratorio {
  name: string;
  kind: "file";
  scope: "global";
  client_id: null;
  parent_id: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
  created_by: string | null;
}

/** O que o módulo precisa do banco e do Storage (Supabase de verdade no index.ts; simulada nos testes). */
export interface PortaDoLaboratorio {
  /** Pastas filhas no escopo global (parent null = raiz). */
  pastasFilhas(parentId: string | null): Promise<NoDaPasta[]>;
  criarPasta(parentId: string | null, nome: string, criadoPor: string | null): Promise<string>;
  /** O nó global cujo storage_path começa com o prefixo (a lâmina já guardada), ou null. */
  noComPrefixo(prefixo: string): Promise<{ id: string } | null>;
  subir(caminho: string, bytes: Uint8Array, mime: string): Promise<void>;
  criarNo(linha: NoNovoDoLaboratorio): Promise<string>;
}

/** Acha cada pasta do caminho pelo nome (sem acento e sem caixa) ou cria a que falta. Devolve o id da última. */
export async function garantirPastasGlobais(porta: PortaDoLaboratorio, caminho: string[], criadoPor: string | null): Promise<string> {
  let pai: string | null = null;
  for (const nome of caminho) {
    const alvo = nomeComparavel(nome);
    const todas: NoDaPasta[] = await porta.pastasFilhas(pai);
    const filhas: NoDaPasta[] = todas.filter((n: NoDaPasta) => n.kind === "folder" && nomeComparavel(n.name) === alvo);
    // Homônimas: a de menor id, sempre a mesma.
    const achada: NoDaPasta | undefined = filhas.sort((x: NoDaPasta, y: NoDaPasta) => (x.id < y.id ? -1 : 1))[0];
    pai = achada ? achada.id : await porta.criarPasta(pai, nome, criadoPor);
  }
  return pai as string;
}

export interface LaminaParaGuardar {
  ordem: number;
  versao: number;
  /** Abre a lâmina no formato final só quando ela ainda não foi guardada (CPU da função). */
  carregar: () => Promise<{ bytes: Uint8Array; mime: string; extensao: string }>;
}

export interface GuardadoNoLaboratorio {
  pasta_id: string;
  caminho: string[];
  node_ids: string[];
  novos: number;
}

/**
 * Guarda as lâminas no Workspace global. Cada lâmina: se o prefixo dela (trabalho, ordem, versão) já
 * tem nó, reaproveita; senão abre, sobe no bucket workspace e cria o nó na pasta do dia.
 */
export async function guardarNoLaboratorio(
  porta: PortaDoLaboratorio,
  e: { trabalhoId: string; titulo: string; nomeDoCliente: string | null; dia: string; criadoPor: string | null; laminas: LaminaParaGuardar[] },
): Promise<GuardadoNoLaboratorio> {
  if (!e.laminas.length) throw new Error("sem_laminas");
  const caminho = pastasDoEstudioLivre(e.nomeDoCliente, e.dia);
  const pasta = await garantirPastasGlobais(porta, caminho, e.criadoPor);
  const ids: string[] = [];
  let novos = 0;
  const total = e.laminas.length;
  for (let i = 0; i < total; i++) {
    const l = e.laminas[i];
    const prefixo = prefixoDaLamina(e.trabalhoId, l.ordem, l.versao);
    const ja = await porta.noComPrefixo(prefixo);
    if (ja) {
      ids.push(ja.id);
      continue;
    }
    const arquivo = await l.carregar();
    const storage = caminhoDaLamina(e.trabalhoId, l.ordem, l.versao, arquivo.extensao);
    await porta.subir(storage, arquivo.bytes, arquivo.mime);
    const id = await porta.criarNo({
      name: nomeDoArquivoDaLamina(e.titulo, i + 1, total, arquivo.extensao),
      kind: "file",
      scope: "global",
      client_id: null,
      parent_id: pasta,
      mime: arquivo.mime,
      size_bytes: arquivo.bytes.byteLength,
      storage_path: storage,
      created_by: e.criadoPor,
    });
    ids.push(id);
    novos++;
  }
  return { pasta_id: pasta, caminho, node_ids: ids, novos };
}

/**
 * Ações que levam o trabalho para a Agenda, para a publicação ou para a aprovação do cliente: um
 * trabalho do Laboratório nunca passa por elas (o "Guardar" dele é o `entregar`, que vai ao Workspace).
 */
export const ACOES_SO_DA_MESA = [
  "rapida_para_agenda",
  "entrega_concluir",
  "agenda_sincronizar",
  "publicacao_confirmar",
  "publicacao_agora",
  "publicacao_desfazer",
  "publicacao_perfis",
  "publicacao_dispensar",
];

export const MENSAGEM_SO_DA_MESA = "Esta arte é do Laboratório: ela fica no arquivo livre e não vai para a Agenda nem para a aprovação do cliente.";
