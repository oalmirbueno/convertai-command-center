/**
 * Dados da agência (frente BAS, 29/09/2026): quem é a contratada nos contratos,
 * quem assina a proposta e o que vai no cabeçalho dos documentos.
 *
 * A tabela é public.agencia_dados (uma linha só, migration
 * 20260930000100_dados_da_agencia.sql). Ela nasce vazia: nenhum dado é
 * inventado. Contrato e proposta NÃO geram enquanto faltarNosDados devolver
 * alguma coisa; a mesa mostra a lista e manda para Configurações, Dados da
 * agência.
 *
 * Sem import de Deno nem de npm e sem regex moderna: as funções (Deno), a tela
 * (Vite, Safari 11, por src/lib/agencia/dadosDaAgencia.ts) e os testes (vitest)
 * leem o mesmo arquivo. Leitura no servidor recebe o cliente do Supabase por
 * parâmetro (em geral o da chave de serviço). Nenhum erro é engolido: falha de
 * leitura sobe como Error com a mensagem do banco.
 */

export interface DadosDaAgencia {
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  /** Endereço completo (rua, número, complemento, bairro, CEP). */
  endereco: string | null;
  cidade: string | null;
  /** Duas letras, maiúsculas. */
  uf: string | null;
  /** Comarca do foro dos contratos (ex.: "Londrina/PR"). */
  comarca: string | null;
  representante_nome: string | null;
  /** Opcional. */
  representante_cpf: string | null;
  email: string | null;
  telefone: string | null;
  site: string | null;
  instagram: string | null;
  pix_chave: string | null;
  /** Texto livre: banco, agência, conta, titular. */
  dados_bancarios: string | null;
  /** Bucket do Storage da logo (sempre "mesa"). */
  logo_bucket: string;
  /** Caminho da logo no bucket, dentro de agencia/. */
  logo_path: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

/** Campos que a pessoa preenche (a logo é o logo_path). */
export type CampoDaAgencia =
  | "razao_social"
  | "nome_fantasia"
  | "cnpj"
  | "endereco"
  | "cidade"
  | "uf"
  | "comarca"
  | "representante_nome"
  | "representante_cpf"
  | "email"
  | "telefone"
  | "site"
  | "instagram"
  | "pix_chave"
  | "dados_bancarios"
  | "logo_path";

export type TipoDeDocumentoDaAgencia = "contrato" | "proposta" | "documento";

export interface FaltaNosDados {
  campo: CampoDaAgencia;
  rotulo: string;
  motivo: "vazio" | "invalido";
}

export interface DescricaoDoCampo {
  campo: CampoDaAgencia;
  rotulo: string;
  grupo: "empresa" | "endereco" | "representante" | "contato" | "pagamento" | "logo";
}

/** Ordem da tela e rótulo de cada campo. */
export const CAMPOS_DA_AGENCIA: DescricaoDoCampo[] = [
  { campo: "razao_social", rotulo: "Razão social", grupo: "empresa" },
  { campo: "nome_fantasia", rotulo: "Nome fantasia", grupo: "empresa" },
  { campo: "cnpj", rotulo: "CNPJ", grupo: "empresa" },
  { campo: "endereco", rotulo: "Endereço completo", grupo: "endereco" },
  { campo: "cidade", rotulo: "Cidade", grupo: "endereco" },
  { campo: "uf", rotulo: "UF", grupo: "endereco" },
  { campo: "comarca", rotulo: "Comarca do foro", grupo: "endereco" },
  { campo: "representante_nome", rotulo: "Representante", grupo: "representante" },
  { campo: "representante_cpf", rotulo: "CPF do representante", grupo: "representante" },
  { campo: "email", rotulo: "E-mail", grupo: "contato" },
  { campo: "telefone", rotulo: "Telefone", grupo: "contato" },
  { campo: "site", rotulo: "Site", grupo: "contato" },
  { campo: "instagram", rotulo: "Instagram", grupo: "contato" },
  { campo: "pix_chave", rotulo: "Chave Pix", grupo: "pagamento" },
  { campo: "dados_bancarios", rotulo: "Dados bancários", grupo: "pagamento" },
  { campo: "logo_path", rotulo: "Logo", grupo: "logo" },
];

/**
 * O que cada tipo de peça exige. CPF do representante, site, Instagram, Pix e
 * banco nunca travam: entram quando existem.
 * - contrato: qualificação completa da contratada e o foro;
 * - proposta: nome, contato e logo (a capa e o rodapé);
 * - documento: nome e logo (cabeçalho de qualquer documento da agência).
 * nome_fantasia aceita a razão social no lugar.
 */
export const OBRIGATORIOS_POR_TIPO: Record<TipoDeDocumentoDaAgencia, CampoDaAgencia[]> = {
  contrato: ["razao_social", "cnpj", "endereco", "cidade", "uf", "comarca", "representante_nome", "email"],
  proposta: ["nome_fantasia", "email", "telefone", "logo_path"],
  documento: ["nome_fantasia", "logo_path"],
};

const ALTERNATIVAS: Partial<Record<CampoDaAgencia, CampoDaAgencia[]>> = {
  nome_fantasia: ["razao_social"],
};

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export const COLUNAS_DOS_DADOS_DA_AGENCIA =
  "razao_social, nome_fantasia, cnpj, endereco, cidade, uf, comarca, representante_nome, representante_cpf, email, telefone, site, instagram, pix_chave, dados_bancarios, logo_bucket, logo_path, atualizado_em, atualizado_por";

// ------------------------------------------------------------------ texto

export const somenteDigitos = (v: unknown): string => String(v === null || v === undefined ? "" : v).replace(/[^0-9]/g, "");

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t ? t : null;
}

/** Texto de várias linhas (endereço, dados bancários): mantém as quebras. */
function textoLongo(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const linhas = String(v)
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0);
  return linhas.length ? linhas.join("\n") : null;
}

export function cnpjValido(v: unknown): boolean {
  const d = somenteDigitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (base: string, pesos: number[]) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += Number(base.charAt(i)) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = digito(d, p1);
  const d2 = digito(d.slice(0, 12) + String(d1), p2);
  return d1 === Number(d.charAt(12)) && d2 === Number(d.charAt(13));
}

export function cpfValido(v: unknown): boolean {
  const d = somenteDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d.charAt(i)) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digito(9) === Number(d.charAt(9)) && digito(10) === Number(d.charAt(10));
}

export function formatarCnpj(v: unknown): string | null {
  const d = somenteDigitos(v);
  if (d.length !== 14) return texto(v);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatarCpf(v: unknown): string | null {
  const d = somenteDigitos(v);
  if (d.length !== 11) return texto(v);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Vazio vira null, espaços saem, UF maiúscula, CNPJ e CPF com máscara. */
export function normalizarDadosDaAgencia(bruto: Partial<Record<keyof DadosDaAgencia, unknown>> | null | undefined): DadosDaAgencia {
  const b = bruto || {};
  const uf = texto(b.uf);
  return {
    razao_social: texto(b.razao_social),
    nome_fantasia: texto(b.nome_fantasia),
    cnpj: formatarCnpj(b.cnpj),
    endereco: textoLongo(b.endereco),
    cidade: texto(b.cidade),
    uf: uf ? uf.toUpperCase() : null,
    comarca: texto(b.comarca),
    representante_nome: texto(b.representante_nome),
    representante_cpf: formatarCpf(b.representante_cpf),
    email: texto(b.email) ? String(texto(b.email)).toLowerCase() : null,
    telefone: texto(b.telefone),
    site: texto(b.site),
    instagram: texto(b.instagram),
    pix_chave: texto(b.pix_chave),
    dados_bancarios: textoLongo(b.dados_bancarios),
    logo_bucket: texto(b.logo_bucket) || "mesa",
    logo_path: texto(b.logo_path),
    atualizado_em: texto(b.atualizado_em),
    atualizado_por: texto(b.atualizado_por),
  };
}

/** Um valor preenchido e bem formado? (Vazio é "vazio"; formato errado é "invalido".) */
export function situacaoDoCampo(dados: DadosDaAgencia, campo: CampoDaAgencia): "ok" | "vazio" | "invalido" {
  const valor = dados[campo];
  if (!valor) return "vazio";
  if (campo === "cnpj") return cnpjValido(valor) ? "ok" : "invalido";
  if (campo === "representante_cpf") return cpfValido(valor) ? "ok" : "invalido";
  if (campo === "uf") return UFS.indexOf(String(valor).toUpperCase()) >= 0 ? "ok" : "invalido";
  if (campo === "email") return emailValido(String(valor)) ? "ok" : "invalido";
  if (campo === "telefone") return somenteDigitos(valor).length >= 10 ? "ok" : "invalido";
  return "ok";
}

const rotuloDe = (campo: CampoDaAgencia) => (CAMPOS_DA_AGENCIA.find((c) => c.campo === campo) || { rotulo: campo }).rotulo;

/**
 * O que falta para gerar um contrato, uma proposta ou um documento. Lista vazia
 * = pode gerar. Campo opcional preenchido com formato errado (ex.: CPF) também
 * entra, para nunca sair um documento com dado quebrado.
 */
export function faltasNosDados(
  dados: DadosDaAgencia | Partial<Record<keyof DadosDaAgencia, unknown>> | null | undefined,
  tipo: TipoDeDocumentoDaAgencia,
): FaltaNosDados[] {
  const d = normalizarDadosDaAgencia(dados as Partial<Record<keyof DadosDaAgencia, unknown>>);
  const faltas: FaltaNosDados[] = [];
  const obrigatorios = OBRIGATORIOS_POR_TIPO[tipo] || [];
  for (const campo of obrigatorios) {
    let situacao = situacaoDoCampo(d, campo);
    if (situacao === "vazio") {
      const alternativas = ALTERNATIVAS[campo] || [];
      if (alternativas.some((a) => situacaoDoCampo(d, a) === "ok")) situacao = "ok";
    }
    if (situacao !== "ok") faltas.push({ campo, rotulo: rotuloDe(campo), motivo: situacao });
  }
  // Opcionais preenchidos que entram no documento: formato errado também trava.
  const opcionaisQueEntram: CampoDaAgencia[] = tipo === "contrato" ? ["representante_cpf", "telefone"] : ["cnpj"];
  for (const campo of opcionaisQueEntram) {
    if (obrigatorios.indexOf(campo) >= 0) continue;
    if (situacaoDoCampo(d, campo) === "invalido") faltas.push({ campo, rotulo: rotuloDe(campo), motivo: "invalido" });
  }
  return faltas;
}

/** "Faltam nos dados da agência: CNPJ (inválido), Comarca do foro." ou null. */
export function textoDasFaltas(faltas: FaltaNosDados[]): string | null {
  if (!faltas.length) return null;
  const itens = faltas.map((f) => (f.motivo === "invalido" ? `${f.rotulo} (inválido)` : f.rotulo));
  return `Faltam nos dados da agência: ${itens.join(", ")}. Preencha em Configurações, Dados da agência.`;
}

/** Nome para capa, rodapé e cabeçalho: fantasia, senão razão social. */
export const nomeDaAgencia = (dados: DadosDaAgencia): string | null => dados.nome_fantasia || dados.razao_social;

/**
 * Qualificação da contratada no preâmbulo do contrato, montada por código (o
 * modelo de texto nunca escreve CNPJ nem endereço). null quando faltar algo.
 */
export function qualificacaoDaContratada(dados: DadosDaAgencia): string | null {
  if (faltasNosDados(dados, "contrato").length) return null;
  const cpf = dados.representante_cpf ? `, inscrito(a) no CPF sob o nº ${dados.representante_cpf}` : "";
  const endereco = String(dados.endereco).replace(/\n/g, ", ");
  return (
    `${dados.razao_social}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${dados.cnpj}, ` +
    `com sede em ${endereco}, ${dados.cidade}/${dados.uf}, neste ato representada por ${dados.representante_nome}${cpf}`
  );
}

// ------------------------------------------------------------------ servidor

/** O mínimo do cliente do Supabase que estas funções usam (evita import de npm). */
export interface ClienteDoBanco {
  from: (tabela: string) => any;
  storage?: { from: (bucket: string) => any };
}

export class DadosDaAgenciaIncompletos extends Error {
  codigo = "dados_da_agencia_incompletos";
  faltas: FaltaNosDados[];
  tipo: TipoDeDocumentoDaAgencia;
  constructor(tipo: TipoDeDocumentoDaAgencia, faltas: FaltaNosDados[]) {
    super(textoDasFaltas(faltas) || "Dados da agência incompletos.");
    this.name = "DadosDaAgenciaIncompletos";
    this.tipo = tipo;
    this.faltas = faltas;
  }
}

/** Lê a linha única. Tabela sem linha vale vazio; erro do banco sobe. */
export async function lerDadosDaAgencia(cliente: ClienteDoBanco): Promise<DadosDaAgencia> {
  const { data, error } = await cliente.from("agencia_dados").select(COLUNAS_DOS_DADOS_DA_AGENCIA).eq("id", true).maybeSingle();
  if (error) throw new Error(`Dados da agência não lidos: ${error.message || String(error)}`);
  return normalizarDadosDaAgencia(data || null);
}

/**
 * Lê e confere para um tipo de peça. Faltando algo, lança
 * DadosDaAgenciaIncompletos (codigo "dados_da_agencia_incompletos", com a
 * lista em `faltas`) para a função devolver à tela sem gastar IA.
 */
export async function exigirDadosDaAgencia(cliente: ClienteDoBanco, tipo: TipoDeDocumentoDaAgencia): Promise<DadosDaAgencia> {
  const dados = await lerDadosDaAgencia(cliente);
  const faltas = faltasNosDados(dados, tipo);
  if (faltas.length) throw new DadosDaAgenciaIncompletos(tipo, faltas);
  return dados;
}

/** Bytes da logo (para o PDF). null quando não há logo; erro do Storage sobe. */
export async function lerLogoDaAgencia(
  cliente: ClienteDoBanco,
  dados: DadosDaAgencia,
): Promise<{ bytes: Uint8Array; tipo: string; caminho: string } | null> {
  if (!dados.logo_path) return null;
  if (!cliente.storage) throw new Error("Logo da agência não lida: cliente sem Storage.");
  const { data, error } = await cliente.storage.from(dados.logo_bucket || "mesa").download(dados.logo_path);
  if (error || !data) throw new Error(`Logo da agência não lida: ${(error && error.message) || "arquivo vazio"}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, tipo: String(data.type || tipoDaLogoPeloCaminho(dados.logo_path)), caminho: dados.logo_path };
}

export function tipoDaLogoPeloCaminho(caminho: string): string {
  const ext = (caminho.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "application/octet-stream";
}
