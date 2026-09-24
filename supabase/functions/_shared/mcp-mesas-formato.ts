/**
 * Formato das leituras das mesas para o MCP (Mesa Ads e Mesa Foto).
 *
 * Este arquivo é PURO (sem Deno, sem banco): recebe linhas do banco e devolve
 * o que o agente lê. Assim o Vitest cobre as regras sem backend, e o serviço
 * (mcp-mesas-services.ts) fica só com as consultas e as URLs assinadas.
 *
 * Para quem vai rodar o tráfego, o que importa não é a linha crua do banco e
 * sim o raciocínio: por que cada ângulo existe, o que o Jev achou, o que foi
 * descartado e por quê, e qual arte e qual copy saíram de cada ângulo.
 */

export type Linha = Record<string, unknown>;

const obj = (v: unknown): Linha => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Linha) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string | null => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const textos = (v: unknown): string[] =>
  lista(v)
    .map((x) => (typeof x === 'string' ? x.trim() : texto(obj(x).texto) ?? texto(obj(x).nome) ?? ''))
    .filter(Boolean);

/** Tempo de vida das URLs assinadas que as leituras devolvem (1 hora). */
export const URL_ASSINADA_S = 3600;

/**
 * Tabela ou coluna que ainda não existe no banco (migration não aplicada).
 * PostgREST: PGRST205 (tabela fora do cache), PGRST204 (coluna); Postgres:
 * 42P01 (tabela), 42703 (coluna).
 */
export function faltaNoBanco(erro: unknown): boolean {
  if (!erro || typeof erro !== 'object') return false;
  const e = erro as { code?: unknown; message?: unknown };
  const codigo = String(e.code ?? '');
  if (codigo === '42P01' || codigo === '42703' || codigo === 'PGRST205' || codigo === 'PGRST204') return true;
  return /does not exist|could not find the (table|.*column)/i.test(String(e.message ?? ''));
}

// ─── Mesa Ads ─────────────────────────────────────────────────

/** Notas do Jev como vieram (0 a 10; risco_politica alto = seguro) e o alerta em texto. */
export function notasDoJev(bruto: unknown): Linha | null {
  const j = obj(bruto);
  if (!Object.keys(j).length) return null;
  const saida: Linha = {};
  for (const chave of ['clareza', 'relevancia', 'prova', 'risco_politica', 'parada', 'diferenciacao', 'forca']) {
    const n = numero(j[chave]);
    if (n !== null) saida[chave] = n;
  }
  const alerta = j.alerta_politica;
  if (alerta === true) saida.alerta_politica = 'Alerta de política';
  else if (texto(alerta)) saida.alerta_politica = texto(alerta);
  else if (obj(alerta).motivo || obj(alerta).texto) saida.alerta_politica = texto(obj(alerta).motivo) ?? texto(obj(alerta).texto);
  const nota = texto(j.nota) ?? texto(j.comentario) ?? texto(j.porque);
  if (nota) saida.comentario = nota;
  return Object.keys(saida).length ? saida : null;
}

/** Um ângulo com o porquê: hipótese, mecanismo, prova, ganchos e as notas e motivos do Jev. */
export function anguloParaLer(bruto: unknown): Linha {
  const a = obj(bruto);
  return {
    id: texto(a.id),
    nome: texto(a.nome),
    por_que: texto(a.hipotese),
    situacao: texto(a.situacao),
    mecanismo: texto(a.mecanismo),
    tecnica: texto(a.tecnica),
    prova: texto(a.prova),
    gancho_visual: texto(a.gancho_visual),
    gancho_verbal: texto(a.gancho_verbal),
    metrica: texto(a.metrica),
    janela_dias: numero(a.janela_dias),
    formatos: textos(a.formatos),
    estilo_visual: texto(a.estilo_visual),
    objetivo: texto(a.objetivo),
    estagio_consciencia: texto(a.estagio_consciencia),
    pontuacao: numero(a.pontuacao),
    aprovado_pelo_jev: typeof a.aprovado === 'boolean' ? a.aprovado : a.reprovado === true ? false : null,
    rodadas: numero(a.rodadas),
    motivos_do_jev: textos(a.motivos),
    notas_do_jev: notasDoJev(a.jev),
    referencia_ids: textos(a.referencia_ids),
  };
}

/** Plano de teste: ângulos principais, descartados com motivo, estrutura, lacunas e qualidade. */
export function planoParaLer(bruto: unknown): Linha {
  const p = obj(bruto);
  const e = obj(p.estrutura);
  return {
    id: texto(p.id),
    nome: texto(p.nome),
    status: texto(p.status),
    criado_em: texto(p.criado_em),
    atualizado_em: texto(p.atualizado_em),
    pedido_da_equipe: texto(p.pedido),
    resumo: texto(e.resumo),
    objetivo: texto(e.objetivo),
    oferta_id: texto(e.oferta_id),
    nicho: texto(e.nicho),
    modo: texto(e.modo),
    angulos: lista(p.angulos).map(anguloParaLer),
    descartados: lista(e.descartados).map((d) => {
      const a = anguloParaLer(d);
      return { ...a, descartado: true };
    }),
    estrutura: {
      conjuntos: lista(e.conjuntos).map((c) => {
        const x = obj(c);
        return {
          nome: texto(x.nome),
          angulo_ids: textos(x.angulo_ids),
          verba_diaria_brl: numero(x.verba_diaria_brl),
          observacao: texto(x.observacao),
        };
      }),
      verba_diaria_total_brl: numero(e.verba_diaria_total_brl),
      janela_dias: numero(e.janela_dias),
      observacoes: texto(e.observacoes),
    },
    lacunas: textos(e.lacunas),
    qualidade: Object.keys(obj(e.qualidade)).length ? obj(e.qualidade) : null,
    custo_usd: numero(p.custo_usd),
  };
}

/** Oferta (linha de ads_ofertas: campos dentro de `oferta`). */
export function ofertaParaLer(bruto: unknown): Linha {
  const linha = obj(bruto);
  const o = { ...obj(linha.oferta), ...linha } as Linha;
  return {
    id: texto(linha.id),
    nome: texto(o.nome),
    status: texto(linha.status),
    para_quem: texto(o.para_quem),
    promessa: texto(o.promessa),
    mecanismo: texto(o.mecanismo),
    entregaveis: textos(o.entregaveis),
    bonus: textos(o.bonus),
    garantia: texto(o.garantia),
    urgencia_real: texto(o.urgencia_real),
    ancoragem: texto(o.ancoragem),
    cta: texto(o.cta),
    provas_necessarias: textos(o.provas_necessarias),
    riscos: textos(o.riscos),
    notas_do_jev: notasDoJev(linha.jev ?? obj(linha.oferta).jev),
    criado_em: texto(linha.criado_em),
  };
}

export interface ImagemParaAssinar {
  bucket: string;
  caminho: string;
  ordem: number;
  versao: number | null;
  formato: string | null;
}

export interface ArteDoCriativo {
  fonte: 'entregue' | 'estudio' | 'sem_arte';
  status: string | null;
  imagens: ImagemParaAssinar[];
}

/**
 * Arte final de um criativo. Entregue (direcao.entrega_ads.arquivos, bucket
 * files, já no tamanho exato do formato) vale mais que a versão do Estúdio;
 * sem entrega, a versão mais recente de cada lâmina (bucket mesa).
 */
export function arteDoTrabalho(trabalho: unknown): ArteDoCriativo {
  const t = obj(trabalho);
  if (!Object.keys(t).length) return { fonte: 'sem_arte', status: null, imagens: [] };
  const status = texto(t.status);
  const direcao = obj(t.direcao);
  const entregues = lista(obj(direcao.entrega_ads).arquivos)
    .map((a) => obj(a))
    .filter((a) => texto(a.storage_path))
    .map((a) => ({
      bucket: 'files',
      caminho: String(a.storage_path),
      ordem: numero(a.ordem) ?? 1,
      versao: numero(a.versao),
      formato: texto(a.formato),
    }))
    .sort((x, y) => x.ordem - y.ordem);
  if (entregues.length) return { fonte: 'entregue', status, imagens: entregues };

  const ultimas = new Map<number, Linha>();
  for (const bruto of lista(t.cards)) {
    const c = obj(bruto);
    const ordem = numero(c.ordem);
    if (ordem === null || !texto(c.storage_path)) continue;
    const atual = ultimas.get(ordem);
    if (!atual || (numero(c.versao) ?? 0) > (numero(atual.versao) ?? 0)) ultimas.set(ordem, c);
  }
  const ordensDaDirecao = lista(direcao.cards).map((c) => numero(obj(c).ordem)).filter((n): n is number => n !== null);
  const ordens = ordensDaDirecao.length ? ordensDaDirecao : Array.from(ultimas.keys());
  const imagens = ordens
    .slice()
    .sort((a, b) => a - b)
    .filter((o, i, todas) => todas.indexOf(o) === i && ultimas.has(o))
    .map((o) => {
      const c = ultimas.get(o)!;
      return { bucket: 'mesa', caminho: String(c.storage_path), ordem: o, versao: numero(c.versao), formato: null };
    });
  return { fonte: imagens.length ? 'estudio' : 'sem_arte', status, imagens };
}

/** Pacote de copy gravado em copy.pacote, sem os campos internos de conferência. */
export function pacoteParaLer(bruto: unknown): Linha | null {
  const p = obj(bruto);
  if (!Object.keys(p).length) return null;
  const { conferencia: _c, modelo_id: _m, ...resto } = p;
  return resto;
}

/** Criativo com a copy escolhida, o pacote completo e as imagens (as URLs entram depois). */
export function criativoParaLer(bruto: unknown, angulo: Linha | null, arte: ArteDoCriativo): Linha {
  const c = obj(bruto);
  const copy = obj(c.copy);
  return {
    id: texto(c.id),
    nome: texto(c.nome),
    plano_id: texto(c.plano_id),
    angulo_id: texto(c.angulo_id),
    angulo: angulo ? texto(angulo.nome) : null,
    por_que_do_angulo: angulo ? texto(angulo.hipotese) : null,
    formato: texto(c.formato),
    status: texto(c.status),
    evidencia: texto(c.evidencia),
    ad_id_na_meta: texto(c.ad_id),
    copy_escolhida: {
      texto_principal: texto(copy.texto_principal),
      texto_principal_longo: texto(copy.texto_principal_longo),
      titulo: texto(copy.titulo),
      descricao: texto(copy.descricao),
      cta_meta: texto(copy.cta_meta),
    },
    pacote_de_copy: pacoteParaLer(copy.pacote),
    arte: {
      fonte: arte.fonte,
      status_no_estudio: arte.status,
      imagens: arte.imagens.map((i) => ({ ordem: i.ordem, versao: i.versao, formato: i.formato, url: null as string | null })),
    },
    criado_em: texto(c.criado_em),
  };
}

export const COMO_ESTUDAR_ADS = [
  'Antes de propor ou subir qualquer campanha, leia nesta ordem:',
  '1. briefing (oferta, público, objeções, provas, destino, objetivo e restrições): é o que é verdade sobre o cliente; nada fora dele vira promessa.',
  '2. ofertas: a escolhida é a que o plano usa. Veja riscos e provas necessárias antes de prometer.',
  '3. planos: cada ângulo traz por_que (a hipótese), mecanismo, prova, ganchos e as notas do Jev. Descartados mostram o que NÃO fazer e por quê.',
  '4. criativos: copy escolhida, pacote completo (variações, CTAs e a orientação ao gestor com objetivo, evento, público, UTM, regras de corte e escala) e a arte final (URL assinada vale 1 hora).',
  '5. analises e aprendizados: o que a conta já mostrou. Números vêm da Meta, não de palpite.',
  'Só depois proponha estrutura, verba (só se o briefing tiver verba) e testes. Nunca invente prova, número, depoimento ou urgência, e respeite as políticas da Meta.',
].join('\n');

// ─── Mesa Foto ────────────────────────────────────────────────

/** Kit sem dados pessoais da autorização: só se existe. */
export function kitParaLer(bruto: unknown, refs: Linha[]): Linha {
  const k = obj(bruto);
  const atributos = obj(k.atributos);
  const autorizacao = obj(k.autorizacao);
  return {
    id: texto(k.id),
    tipo: texto(k.tipo),
    nome: texto(k.nome),
    variante: texto(k.variante),
    status: texto(k.status),
    atributos: {
      observado: textos(atributos.observado),
      informado: textos(atributos.informado),
      inferido: textos(atributos.inferido),
    },
    invariantes: textos(k.invariantes),
    lacunas: textos(k.lacunas),
    autorizacao_registrada: Object.keys(autorizacao).length > 0,
    frente_imagem_id: texto(k.frente_imagem_id),
    referencias: refs,
    atualizado_em: texto(k.atualizado_em) ?? texto(k.criado_em),
  };
}

/** Tomada do ensaio com as versões; só a aprovada e a mais recente pedem URL. */
export function tomadaParaLer(bruto: unknown): { tomada: Linha; paraAssinar: { versao: number; caminho: string }[] } {
  const t = obj(bruto);
  const versoes = lista(t.versoes).map((v) => obj(v));
  const maisRecente = versoes.reduce<number | null>((m, v) => {
    const n = numero(v.versao);
    return n !== null && (m === null || n > m) ? n : m;
  }, null);
  const paraAssinar: { versao: number; caminho: string }[] = [];
  const lidas = versoes.map((v) => {
    const n = numero(v.versao);
    const caminho = texto(v.storage_path);
    const aprovada = v.aprovada === true;
    if (caminho && n !== null && (aprovada || n === maisRecente)) paraAssinar.push({ versao: n, caminho });
    const conferencia = obj(v.conferencia);
    return {
      versao: n,
      aprovada,
      imagem_id: texto(v.imagem_id),
      motivo_rejeicao: texto(v.motivo_rejeicao),
      alertas_da_conferencia: textos(conferencia.alertas),
      custo_usd: numero(v.custo_usd),
      criado_em: texto(v.criado_em),
      url: null as string | null,
    };
  });
  const camera = obj(t.camera);
  return {
    tomada: {
      id: texto(t.id),
      nome: texto(t.nome),
      modo: texto(t.modo),
      status: texto(t.status),
      formato: texto(t.formato),
      camera: Object.keys(camera).length ? camera : null,
      cenario: texto(t.cenario),
      luz: texto(t.luz),
      invariantes: textos(t.invariantes),
      bloqueio: texto(t.motivo_bloqueio) ?? texto(t.bloqueio),
      versoes: lidas,
    },
    paraAssinar,
  };
}

export const COMO_ESTUDAR_FOTO = [
  'Fotos aprovadas são as que a equipe liberou para uso (anúncio, post, site). Use só estas em criativo.',
  'Kits dizem o que é invariável no produto, pessoa ou alimento (invariantes) e o que ainda falta de evidência (lacunas): não prometa nem mostre o que está em lacuna.',
  'Versão marcada como gerada, em modo "angulo", mostra partes não vistas: não serve como prova de detalhe do produto.',
  'URLs assinadas valem 1 hora.',
].join('\n');
