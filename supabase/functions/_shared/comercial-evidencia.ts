/**
 * Régua dos fatos com prova do comercial (25/10/2026). Inspirado no Comp AI CRM (MIT), apps/agent/agent/lib/evidence.ts
 * e skills/evidence.md: o agente nunca diz "tenho 80% de certeza"; ele diz O QUE viu, e a régua dá o peso.
 * Um fato errado com cara de certo é pior que um campo vazio.
 *
 * - Primária: a fonte identifica ESTA empresa ou ESTA pessoa (o lead confirmou na conversa, o site oficial, o
 *   CNPJ na Receita, o perfil oficial no Instagram, um documento que o lead mandou). Sozinha pode gravar.
 * - De apoio: verdadeira, mas não basta (uma página cita, uma busca aponta, um diretório público, uma dedução).
 * - Contradição: outra fonte discorda. Não baixa um pouco: segura o fato inteiro.
 *
 * Resultado: gravado (vai para a ficha), sugestao (fica para a equipe confirmar) ou descartado (não aparece).
 * Puro: sem Deno, sem banco. A tela e o Vitest leem o mesmo arquivo. Sem lookbehind, classe Unicode ou grupo nomeado.
 */

export type TipoDeEvidencia =
  | 'lead_confirmou_na_conversa'
  | 'documento_enviado_pelo_lead'
  | 'cnpj_receita'
  | 'site_oficial_da_empresa'
  | 'perfil_oficial_instagram'
  | 'pagina_citada'
  | 'busca_cita_perfil'
  | 'diretorio_publico'
  | 'deducao_do_agente'
  | 'contradicao';

export const PESOS_DA_EVIDENCIA: Record<TipoDeEvidencia, { peso: number; primaria: boolean; rotulo: string }> = {
  lead_confirmou_na_conversa: { peso: 0.9, primaria: true, rotulo: 'o lead confirmou na conversa' },
  documento_enviado_pelo_lead: { peso: 0.9, primaria: true, rotulo: 'está num documento que o lead mandou' },
  cnpj_receita: { peso: 0.9, primaria: true, rotulo: 'consta no CNPJ da Receita' },
  site_oficial_da_empresa: { peso: 0.85, primaria: true, rotulo: 'está no site oficial da empresa' },
  perfil_oficial_instagram: { peso: 0.8, primaria: true, rotulo: 'está no perfil oficial no Instagram' },
  pagina_citada: { peso: 0.4, primaria: false, rotulo: 'uma página citada afirma' },
  busca_cita_perfil: { peso: 0.35, primaria: false, rotulo: 'uma busca aponta para este perfil' },
  diretorio_publico: { peso: 0.35, primaria: false, rotulo: 'aparece num diretório público' },
  deducao_do_agente: { peso: 0.15, primaria: false, rotulo: 'dedução do agente' },
  contradicao: { peso: 0, primaria: false, rotulo: 'outra fonte discorda' },
};

export const TIPOS_DE_EVIDENCIA = Object.keys(PESOS_DA_EVIDENCIA) as TipoDeEvidencia[];

export interface Evidencia {
  tipo: TipoDeEvidencia;
  /** Lido pela equipe: o que foi visto, onde e quando ("no site, rodapé: CNPJ 12.345..."). */
  detalhe: string;
  fonte_url?: string | null;
}

export type SituacaoDoFato = 'gravado' | 'sugestao' | 'descartado';

export interface Avaliacao {
  situacao: SituacaoDoFato;
  nota: number;
  tem_primaria: boolean;
  porque: string;
}

const TETO = 0.99;
export const PISO_PARA_GRAVAR = 0.8;
export const PISO_PARA_SUGERIR = 0.3;

export const ehTipoDeEvidencia = (v: unknown): v is TipoDeEvidencia => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PESOS_DA_EVIDENCIA, v);

/** A nota das provas e o que acontece com o fato. */
export function avaliarEvidencias(lista: Evidencia[]): Avaliacao {
  const validas = (lista || []).filter((e) => e && ehTipoDeEvidencia(e.tipo));
  if (!validas.length) return { situacao: 'descartado', nota: 0, tem_primaria: false, porque: 'Sem prova.' };
  const contradicao = validas.filter((e) => e.tipo === 'contradicao')[0];
  const temPrimaria = validas.some((e) => PESOS_DA_EVIDENCIA[e.tipo].primaria);
  const resto = validas.reduce((r, e) => r * (1 - PESOS_DA_EVIDENCIA[e.tipo].peso), 1);
  const nota = Math.round(Math.min(TETO, 1 - resto) * 100) / 100;
  if (contradicao) {
    return { situacao: 'descartado', nota: Math.min(nota, 0.45), tem_primaria: temPrimaria, porque: `Segurado: ${(contradicao.detalhe || 'as fontes discordam').slice(0, 200)}.` };
  }
  const motivos = validas.map((e) => PESOS_DA_EVIDENCIA[e.tipo].rotulo);
  const porque = `${motivos.join('; ')}.`;
  if (temPrimaria && nota >= PISO_PARA_GRAVAR) return { situacao: 'gravado', nota, tem_primaria: true, porque };
  if (nota >= PISO_PARA_SUGERIR) return { situacao: 'sugestao', nota, tem_primaria: temPrimaria, porque };
  return { situacao: 'descartado', nota, tem_primaria: temPrimaria, porque: `Fraco sozinho: ${porque}` };
}

/** O nome curto da evidência para guardar em commercial_facts.evidencia (o tipo mais forte). */
export function evidenciaPrincipal(lista: Evidencia[]): TipoDeEvidencia {
  const validas = (lista || []).filter((e) => e && ehTipoDeEvidencia(e.tipo));
  const contradicao = validas.filter((e) => e.tipo === 'contradicao')[0];
  if (contradicao) return 'contradicao';
  let melhor: TipoDeEvidencia = 'deducao_do_agente';
  for (const e of validas) if (PESOS_DA_EVIDENCIA[e.tipo].peso > PESOS_DA_EVIDENCIA[melhor].peso) melhor = e.tipo;
  return melhor;
}

// ------------------------------------------------------------------ onde o fato gravado vai

/** Campos da ficha que um fato gravado pode escrever. Fora daqui, o fato fica só registrado. */
export const CAMPOS_DO_FATO: Record<string, { alvo: 'lead' | 'empresa' | 'qualificacao'; coluna: string; max: number }> = {
  whatsapp: { alvo: 'lead', coluna: 'whatsapp', max: 40 },
  email: { alvo: 'lead', coluna: 'email', max: 200 },
  company: { alvo: 'lead', coluna: 'company', max: 200 },
  empresa: { alvo: 'lead', coluna: 'company', max: 200 },
  instagram: { alvo: 'empresa', coluna: 'instagram', max: 200 },
  phone: { alvo: 'empresa', coluna: 'phone', max: 60 },
  telefone: { alvo: 'empresa', coluna: 'phone', max: 60 },
  address: { alvo: 'empresa', coluna: 'address', max: 300 },
  endereco: { alvo: 'empresa', coluna: 'address', max: 300 },
  cnpj: { alvo: 'empresa', coluna: 'cnpj', max: 30 },
  size: { alvo: 'empresa', coluna: 'size', max: 300 },
  porte: { alvo: 'empresa', coluna: 'size', max: 300 },
  site: { alvo: 'empresa', coluna: 'site', max: 200 },
  segment: { alvo: 'empresa', coluna: 'segment', max: 200 },
  segmento: { alvo: 'empresa', coluna: 'segment', max: 200 },
  city: { alvo: 'empresa', coluna: 'city', max: 200 },
  cidade: { alvo: 'empresa', coluna: 'city', max: 200 },
  cargo: { alvo: 'qualificacao', coluna: 'cargo', max: 200 },
  decisor: { alvo: 'qualificacao', coluna: 'autoridade', max: 600 },
  autoridade: { alvo: 'qualificacao', coluna: 'autoridade', max: 600 },
  orcamento: { alvo: 'qualificacao', coluna: 'orcamento', max: 600 },
  problema: { alvo: 'qualificacao', coluna: 'problema', max: 600 },
  urgencia: { alvo: 'qualificacao', coluna: 'urgencia', max: 600 },
  presenca_digital: { alvo: 'qualificacao', coluna: 'presenca_digital', max: 600 },
  concorrencia: { alvo: 'qualificacao', coluna: 'concorrencia', max: 600 },
  oferta: { alvo: 'qualificacao', coluna: 'oferta', max: 600 },
};

export const normalizarCampoDoFato = (v: unknown): string => String(v || '').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 60);

// ------------------------------------------------------------------ pedido para parar (LGPD)

// Fortes valem em qualquer mensagem; médias só em mensagem curta (até 8 palavras); fracas ("sair", "parar")
// só quando a mensagem é praticamente só isso (até 3 palavras), porque "posso sair às 18h" não é um pedido.
const FORTES = ['descadastrar', 'descadastre', 'nao me mande', 'nao mande mais', 'nao entre em contato', 'me tira da lista', 'me tire da lista', 'cancelar contato', 'para de me mandar', 'pare de me mandar'];
const MEDIAS = ['nao quero', 'sem interesse', 'nao tenho interesse', 'me tira', 'me tire', 'bloquear', 'para de', 'pare de'];
const FRACAS = ['parar', 'pare', 'sair', 'stop', 'remover', 'remova'];

const sem = (s: string) => s.toLowerCase().replace(/[áàâã]/g, 'a').replace(/[éê]/g, 'e').replace(/í/g, 'i').replace(/[óôõ]/g, 'o').replace(/ú/g, 'u').replace(/ç/g, 'c');

/** A mensagem de entrada pede para não ser mais contatado? */
export function pedeParaParar(texto: unknown): boolean {
  const t = sem(String(texto || '')).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const palavras = t.split(' ').length;
  const tem = (f: string) => (' ' + t + ' ').indexOf(' ' + f + ' ') >= 0;
  if (FORTES.some(tem)) return true;
  if (palavras <= 8 && MEDIAS.some(tem)) return true;
  return palavras <= 3 && FRACAS.some(tem);
}
