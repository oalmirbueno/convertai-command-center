/**
 * Lançamento do site (frente SIT2, 30/09/2026): integrações (WhatsApp
 * flutuante, formulário que cai no CRM, pixel da Meta, GA4, Google Maps),
 * SEO completo (título, descrição, OG, sitemap, robots e schema
 * LocalBusiness), aviso de cookies (LGPD), a conferência anti-spam do
 * formulário público e o checklist de lançamento.
 *
 * Regras fixas, sem julgamento: validação de formato, montagem do JSON-LD e
 * contagem do que falta. O checklist é aviso: nunca trava a publicação.
 *
 * Puro: sem Deno, sem npm e sem banco. A função mesa-site, a função pública
 * site-formulario, a tela e os testes importam o mesmo arquivo.
 */

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const semTravessao = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

// ------------------------------------------------------------------ integrações

/**
 * WhatsApp no formato do wa.me (só dígitos, com o país). Número brasileiro
 * sem o 55 ganha o 55; com DDD e 8 ou 9 dígitos. Estrangeiro precisa vir com +.
 */
export function normalizarWhatsapp(v: unknown): string | null {
  const bruto = String(v ?? "").trim();
  if (!bruto) return null;
  const internacional = bruto.charAt(0) === "+";
  let d = bruto.replace(/\D/g, "");
  if (d.indexOf("00") === 0) d = d.slice(2);
  if (!internacional && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (d.indexOf("55") === 0) return d.length === 12 || d.length === 13 ? d : null;
  return internacional && d.length >= 8 && d.length <= 15 ? d : null;
}

/** Pixel da Meta: só dígitos (15 ou 16 hoje; aceita de 10 a 20). */
export const normalizarPixel = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{10,20}$/.test(s) ? s : null;
};

/** GA4: G-XXXXXXX (o antigo UA- não existe mais). */
export const normalizarGa4 = (v: unknown): string | null => {
  const s = String(v ?? "").trim().toUpperCase();
  return /^G-[A-Z0-9]{6,12}$/.test(s) ? s : null;
};

export const urlHttps = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"'<>]*)?$/i.test(s)) return null;
  return s.slice(0, 300);
};

export type IntegracoesDoSite = {
  whatsapp: { ligado: boolean; numero: string | null; mensagem: string };
  formulario: { ligado: boolean; chave: string | null; campos: Array<"nome" | "email" | "whatsapp" | "empresa" | "mensagem">; agradecimento: string };
  pixel_meta: { id: string | null };
  ga4: { id: string | null };
  mapa: { ligado: boolean; endereco: string };
  cookies: { ligado: boolean; politica_url: string | null };
};

export const CAMPOS_DO_FORMULARIO = ["nome", "email", "whatsapp", "empresa", "mensagem"] as const;

/** Chave pública do formulário (não é segredo: identifica o site no envio sem expor o id). */
export const CHAVE_DO_FORMULARIO = /^[a-z0-9]{20,40}$/;

/**
 * Lê as integrações sem confiar em nada. Pixel ou GA4 ligado força o aviso de
 * cookies (LGPD: rastreio só depois do consentimento).
 */
export function normalizarIntegracoes(bruto: unknown, antes?: Partial<IntegracoesDoSite> | null): IntegracoesDoSite {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const sub = (k: string) => (o[k] && typeof o[k] === "object" ? (o[k] as Record<string, unknown>) : {});
  const w = sub("whatsapp");
  const f = sub("formulario");
  const mp = sub("mapa");
  const ck = sub("cookies");
  const numero = normalizarWhatsapp(w.numero);
  const chaveAntes = antes && antes.formulario && typeof antes.formulario.chave === "string" && CHAVE_DO_FORMULARIO.test(antes.formulario.chave) ? antes.formulario.chave : null;
  const chavePedida = typeof f.chave === "string" && CHAVE_DO_FORMULARIO.test(f.chave) ? f.chave : null;
  const campos = (Array.isArray(f.campos) ? f.campos : ["nome", "whatsapp", "mensagem"])
    .map((c) => String(c))
    .filter((c, i, l): c is IntegracoesDoSite["formulario"]["campos"][number] => (CAMPOS_DO_FORMULARIO as readonly string[]).indexOf(c) >= 0 && l.indexOf(c) === i);
  if (campos.indexOf("nome") < 0) campos.unshift("nome");
  if (campos.indexOf("email") < 0 && campos.indexOf("whatsapp") < 0) campos.push("whatsapp");
  const pixel = normalizarPixel(sub("pixel_meta").id);
  const ga4 = normalizarGa4(sub("ga4").id);
  return {
    whatsapp: { ligado: w.ligado === true && !!numero, numero, mensagem: semTravessao(umaLinha(w.mensagem, 200)) || "Olá! Vim pelo site." },
    formulario: { ligado: f.ligado === true, chave: chaveAntes || chavePedida, campos, agradecimento: semTravessao(umaLinha(f.agradecimento, 200)) || "Recebemos a sua mensagem. Em breve entramos em contato." },
    pixel_meta: { id: pixel },
    ga4: { id: ga4 },
    mapa: { ligado: mp.ligado === true && umaLinha(mp.endereco, 200).length >= 6, endereco: umaLinha(mp.endereco, 200) },
    cookies: { ligado: ck.ligado === true || !!pixel || !!ga4, politica_url: urlHttps(ck.politica_url) },
  };
}

/** Mapa do Google sem chave de API (embed pela busca do endereço). */
export const urlDoMapa = (endereco: string) => `https://www.google.com/maps?q=${encodeURIComponent(endereco)}&output=embed`;

/** O que vai para o pacote do site (o template lê em src/lib/integracoes). */
export function integracoesDoPacote(i: IntegracoesDoSite, endpointDoFormulario: string | null) {
  return {
    whatsapp: i.whatsapp.ligado && i.whatsapp.numero ? { numero: i.whatsapp.numero, mensagem: i.whatsapp.mensagem, link: `https://wa.me/${i.whatsapp.numero}?text=${encodeURIComponent(i.whatsapp.mensagem)}` } : null,
    formulario: i.formulario.ligado && i.formulario.chave && endpointDoFormulario ? { endpoint: endpointDoFormulario, chave: i.formulario.chave, campos: i.formulario.campos, agradecimento: i.formulario.agradecimento } : null,
    pixel_meta: i.pixel_meta.id,
    ga4: i.ga4.id,
    mapa: i.mapa.ligado ? { endereco: i.mapa.endereco, embed: urlDoMapa(i.mapa.endereco) } : null,
    cookies: i.cookies.ligado ? { politica_url: i.cookies.politica_url } : null,
  };
}

// ------------------------------------------------------------------ SEO

/** Tipos do schema.org que cobrem os clientes da casa (LocalBusiness e os filhos mais comuns). */
export const TIPOS_DE_NEGOCIO = [
  { id: "LocalBusiness", rotulo: "Negócio local" },
  { id: "ProfessionalService", rotulo: "Serviço profissional" },
  { id: "Store", rotulo: "Loja" },
  { id: "Restaurant", rotulo: "Restaurante" },
  { id: "BeautySalon", rotulo: "Salão de beleza" },
  { id: "HealthAndBeautyBusiness", rotulo: "Saúde e estética" },
  { id: "Dentist", rotulo: "Dentista" },
  { id: "MedicalClinic", rotulo: "Clínica" },
  { id: "LegalService", rotulo: "Advocacia" },
  { id: "AccountingService", rotulo: "Contabilidade" },
  { id: "RealEstateAgent", rotulo: "Imobiliária" },
  { id: "AutoRepair", rotulo: "Oficina" },
  { id: "HomeAndConstructionBusiness", rotulo: "Casa e construção" },
  { id: "SportsActivityLocation", rotulo: "Academia e esporte" },
  { id: "EducationalOrganization", rotulo: "Escola e curso" },
  { id: "Organization", rotulo: "Empresa sem endereço aberto" },
] as const;

export type SeoDoSite = {
  titulo: string;
  descricao: string;
  palavras: string[];
  indexar: boolean;
  og_imagem: string | null;
  negocio: {
    tipo: string;
    nome: string;
    telefone: string | null;
    email: string | null;
    rua: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
    horario: string[];
    faixa_de_preco: string;
    redes: string[];
  };
};

const email = (v: unknown) => {
  const s = String(v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) && s.length <= 120 ? s : null;
};

/** Horário no formato do schema: "Mo-Fr 09:00-18:00". */
export const HORARIO = /^(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?(,(Mo|Tu|We|Th|Fr|Sa|Su))* ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d$/;

export function normalizarSeo(bruto: unknown): SeoDoSite {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const n = o.negocio && typeof o.negocio === "object" ? (o.negocio as Record<string, unknown>) : {};
  const tel = normalizarWhatsapp(n.telefone);
  return {
    titulo: semTravessao(umaLinha(o.titulo, 60)),
    descricao: semTravessao(umaLinha(o.descricao, 155)),
    palavras: (Array.isArray(o.palavras) ? o.palavras : []).map((p) => umaLinha(p, 40)).filter(Boolean).slice(0, 10),
    indexar: o.indexar !== false,
    og_imagem: typeof o.og_imagem === "string" && /^[0-9a-f-]{36}$/i.test(o.og_imagem) ? o.og_imagem : null,
    negocio: {
      tipo: TIPOS_DE_NEGOCIO.some((t) => t.id === n.tipo) ? String(n.tipo) : "LocalBusiness",
      nome: umaLinha(n.nome, 120),
      telefone: tel ? `+${tel}` : null,
      email: email(n.email),
      rua: umaLinha(n.rua, 160),
      bairro: umaLinha(n.bairro, 80),
      cidade: umaLinha(n.cidade, 80),
      estado: umaLinha(n.estado, 2).toUpperCase().replace(/[^A-Z]/g, ""),
      cep: String(n.cep ?? "").replace(/\D/g, "").slice(0, 8),
      horario: (Array.isArray(n.horario) ? n.horario : []).map((h) => umaLinha(h, 40)).filter((h) => HORARIO.test(h)).slice(0, 7),
      faixa_de_preco: /^\${1,4}$/.test(String(n.faixa_de_preco || "")) ? String(n.faixa_de_preco) : "",
      redes: (Array.isArray(n.redes) ? n.redes : []).map(urlHttps).filter((u): u is string => !!u).slice(0, 6),
    },
  };
}

/**
 * JSON-LD do negócio (schema.org). Só entra o que existe: sem endereço, vira
 * Organization. Nada é inventado; o prerender injeta como está.
 */
export function schemaDoNegocio(seo: SeoDoSite, extra: { url: string | null; logo: string | null; imagem: string | null; nomePadrao: string }): Record<string, unknown> {
  const n = seo.negocio;
  const temEndereco = !!(n.rua && n.cidade);
  const tipo = temEndereco ? n.tipo : n.tipo === "LocalBusiness" ? "Organization" : n.tipo;
  const absoluta = (caminho: string | null) => (caminho && extra.url && caminho.charAt(0) === "/" ? `${extra.url.replace(/\/$/, "")}${caminho}` : caminho);
  const s: Record<string, unknown> = { "@context": "https://schema.org", "@type": tipo, name: n.nome || extra.nomePadrao };
  if (seo.descricao) s.description = seo.descricao;
  if (extra.url) s.url = extra.url;
  if (extra.logo) s.logo = absoluta(extra.logo);
  if (extra.imagem) s.image = absoluta(extra.imagem);
  if (n.telefone) s.telephone = n.telefone;
  if (n.email) s.email = n.email;
  if (temEndereco) {
    const endereco: Record<string, unknown> = { "@type": "PostalAddress", streetAddress: n.rua, addressLocality: n.cidade, addressCountry: "BR" };
    if (n.estado) endereco.addressRegion = n.estado;
    if (n.cep.length === 8) endereco.postalCode = `${n.cep.slice(0, 5)}-${n.cep.slice(5)}`;
    s.address = endereco;
  }
  if (n.horario.length) s.openingHours = n.horario;
  if (n.faixa_de_preco) s.priceRange = n.faixa_de_preco;
  if (n.redes.length) s.sameAs = n.redes;
  return s;
}

/** Endereço canônico do site (o domínio do cliente, ou null antes de ter um). */
export const urlDoSite = (dominio: string | null) => (dominio ? `https://${dominio}` : null);

/** robots.txt: indexa (com o sitemap) ou pede para não indexar. */
export function robotsTxt(indexar: boolean, url: string | null): string {
  if (!indexar) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\n${url ? `\nSitemap: ${url}/sitemap.xml\n` : ""}`;
}

/** sitemap.xml das páginas do mapa (só com o domínio: o sitemap pede endereço absoluto). */
export function sitemapXml(url: string, slugs: string[], hoje: string): string {
  const base = url.replace(/\/$/, "");
  const linhas = slugs.map((s) => `  <url><loc>${base}/${s ? `${s}/` : ""}</loc><lastmod>${hoje}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join("\n")}\n</urlset>\n`;
}

// ------------------------------------------------------------------ formulário público (anti-spam)

export type EnvioDoFormulario = { chave: string; nome: string; email: string | null; whatsapp: string | null; empresa: string; mensagem: string; pagina: string; iniciado_em: number; armadilha: string };

/** Tempo mínimo entre abrir e enviar (robô preenche em milissegundos). */
export const TEMPO_MINIMO_MS = 3000;
/** Envio mais velho que isso (página aberta há um dia) vale, mas não pode vir do futuro. */
export const TEMPO_MAXIMO_MS = 24 * 60 * 60_000;
export const MAX_LINKS_NA_MENSAGEM = 2;

/**
 * Lê o envio público e diz se é spam antes de gravar. Regras fixas:
 * armadilha preenchida (campo invisível), rápido demais, relógio do futuro,
 * sem nome, sem contato, links demais, texto com cara de robô.
 */
export function lerEnvio(bruto: unknown, agora = Date.now()): { envio: EnvioDoFormulario | null; motivo: string | null } {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const chave = String(o.chave ?? "");
  if (!CHAVE_DO_FORMULARIO.test(chave)) return { envio: null, motivo: "chave_invalida" };
  const armadilha = String(o.site_url ?? o.armadilha ?? "");
  const iniciado = Number(o.iniciado_em);
  const envio: EnvioDoFormulario = {
    chave,
    nome: umaLinha(o.nome, 120),
    email: email(o.email),
    whatsapp: normalizarWhatsapp(o.whatsapp),
    empresa: umaLinha(o.empresa, 120),
    mensagem: String(o.mensagem ?? "").replace(/\r/g, "").trim().slice(0, 2000),
    pagina: umaLinha(o.pagina, 200),
    iniciado_em: Number.isFinite(iniciado) ? iniciado : 0,
    armadilha,
  };
  if (armadilha) return { envio, motivo: "armadilha" };
  if (!envio.iniciado_em || agora - envio.iniciado_em < TEMPO_MINIMO_MS) return { envio, motivo: "rapido_demais" };
  if (envio.iniciado_em - agora > 60_000 || agora - envio.iniciado_em > TEMPO_MAXIMO_MS) return { envio, motivo: "tempo_invalido" };
  if (envio.nome.length < 2) return { envio, motivo: "sem_nome" };
  if (!envio.email && !envio.whatsapp) return { envio, motivo: "sem_contato" };
  const links = (envio.mensagem.match(/https?:\/\/|www\./gi) || []).length;
  if (links > MAX_LINKS_NA_MENSAGEM) return { envio, motivo: "links_demais" };
  if (/<\s*(script|a|iframe)\b/i.test(envio.mensagem) || /\[url=|\[link=/i.test(envio.mensagem)) return { envio, motivo: "marcacao" };
  if (/https?:\/\//i.test(envio.nome)) return { envio, motivo: "link_no_nome" };
  return { envio, motivo: null };
}

/** Origem permitida: o domínio do cliente (com e sem www), o endereço da publicação e a prévia do motor. */
export function origemPermitida(origem: string | null, hosts: string[]): boolean {
  if (!origem) return true;
  let host = "";
  try {
    host = new URL(origem).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (/\.trycloudflare\.com$|\.cfargotunnel\.com$/.test(host) || host === "localhost" || host === "127.0.0.1") return true;
  return hosts.some((h) => {
    const x = String(h || "").toLowerCase();
    return !!x && (host === x || host === `www.${x}` || `www.${host}` === x);
  });
}

// ------------------------------------------------------------------ checklist de lançamento

export type ItemDoChecklist = { id: string; rotulo: string; ok: boolean; etapa: string; detalhe?: string; obrigatorio: boolean };

export type EstadoParaChecklist = {
  briefingSalvo: boolean;
  temMapa: boolean;
  secoes: string[];
  construidas: string[];
  preset: boolean;
  copyEscolhida: boolean;
  slotsVazios: number;
  buildOk: boolean | null;
  avisosDeQa: number;
  seo: SeoDoSite;
  temOgImagem: boolean;
  temLogo: boolean;
  integracoes: IntegracoesDoSite;
  secoesComFormulario: boolean;
  secoesComMapa: boolean;
  dominio: string | null;
  dominioVerificado: boolean;
  construidoDepoisDasMudancas: boolean;
  /** UXM: regras de UX críticas ou altas que falharam ou faltam conferir (base UI UX Pro Max). Sem o número, não pesa. */
  pendenciasDeUx?: number | null;
};

/**
 * O que falta para lançar. Obrigatório = o site não deveria ir ao ar sem (a
 * tela pede Confirmar com a lista); o resto é recomendação. Nunca trava.
 */
export function checklistDeLancamento(e: EstadoParaChecklist): ItemDoChecklist[] {
  const faltando = e.secoes.filter((s) => e.construidas.indexOf(s) < 0);
  const rastreio = !!(e.integracoes.pixel_meta.id || e.integracoes.ga4.id);
  const itens: ItemDoChecklist[] = [
    { id: "briefing", rotulo: "Briefing salvo", ok: e.briefingSalvo, etapa: "briefing", obrigatorio: false },
    { id: "mapa", rotulo: "Mapa do site com seções", ok: e.temMapa && e.secoes.length > 0, etapa: "direcao", obrigatorio: true },
    { id: "estilo", rotulo: "Estilo escolhido", ok: e.preset, etapa: "direcao", obrigatorio: false },
    { id: "copy", rotulo: "Conteúdo escolhido", ok: e.copyEscolhida, etapa: "conteudo", obrigatorio: true },
    { id: "imagens", rotulo: "Imagens nos slots", ok: e.slotsVazios === 0, etapa: "imagens", detalhe: e.slotsVazios ? `${e.slotsVazios} slot(s) vazio(s)` : undefined, obrigatorio: false },
    { id: "construido", rotulo: "Todas as seções construídas", ok: !faltando.length && e.secoes.length > 0, etapa: "construcao", detalhe: faltando.length ? `faltam ${faltando.length}` : undefined, obrigatorio: true },
    { id: "atualizado", rotulo: "Site montado depois da última mudança", ok: e.construidoDepoisDasMudancas, etapa: "construcao", detalhe: e.construidoDepoisDasMudancas ? undefined : "SEO ou integrações mudaram: aplique no site", obrigatorio: false },
    { id: "build", rotulo: "Build sem erro", ok: e.buildOk === true, etapa: "revisao", obrigatorio: true },
    { id: "qa", rotulo: "Revisão sem avisos", ok: e.buildOk === true && e.avisosDeQa === 0, etapa: "revisao", detalhe: e.avisosDeQa ? `${e.avisosDeQa} aviso(s)` : undefined, obrigatorio: false },
    { id: "seo_titulo", rotulo: "Título e descrição de SEO", ok: !!e.seo.titulo && e.seo.descricao.length >= 50, etapa: "integracoes", obrigatorio: true },
    { id: "og", rotulo: "Imagem de compartilhamento", ok: e.temOgImagem, etapa: "integracoes", obrigatorio: false },
    { id: "logo", rotulo: "Logo da marca (favicon)", ok: e.temLogo, etapa: "direcao", obrigatorio: false },
    { id: "schema", rotulo: "Dados do negócio (schema)", ok: !!e.seo.negocio.nome && (!!e.seo.negocio.telefone || !!e.seo.negocio.email), etapa: "integracoes", obrigatorio: false },
    { id: "contato", rotulo: "Um jeito de falar com o cliente", ok: e.integracoes.whatsapp.ligado || e.integracoes.formulario.ligado, etapa: "integracoes", obrigatorio: true },
    { id: "formulario", rotulo: "Formulário ligado na seção de contato", ok: !e.secoesComFormulario || e.integracoes.formulario.ligado, etapa: "integracoes", obrigatorio: false },
    { id: "mapa_google", rotulo: "Endereço do mapa", ok: !e.secoesComMapa || e.integracoes.mapa.ligado, etapa: "integracoes", obrigatorio: false },
    { id: "lgpd", rotulo: "Aviso de cookies (LGPD)", ok: !rastreio || e.integracoes.cookies.ligado, etapa: "integracoes", detalhe: rastreio ? "pixel ou GA4 ligado" : undefined, obrigatorio: true },
    { id: "politica", rotulo: "Política de privacidade", ok: !(rastreio || e.integracoes.formulario.ligado) || !!e.integracoes.cookies.politica_url, etapa: "integracoes", obrigatorio: false },
    { id: "indexar", rotulo: "Liberado para o Google", ok: e.seo.indexar, etapa: "integracoes", obrigatorio: false },
    { id: "dominio", rotulo: "Domínio configurado", ok: !!e.dominio, etapa: "publicacao", obrigatorio: false },
    { id: "dns", rotulo: "DNS verificado", ok: e.dominioVerificado, etapa: "publicacao", obrigatorio: false },
  ];
  // UXM: só entra quando a tela calculou as regras de UX da base (não obrigatório: a conferência é só aviso).
  if (typeof e.pendenciasDeUx === "number") {
    const qa = itens.map((i) => i.id).indexOf("qa");
    itens.splice(qa + 1, 0, { id: "ux", rotulo: "Sem pendência crítica ou alta de UX", ok: e.pendenciasDeUx === 0, etapa: "revisao", detalhe: e.pendenciasDeUx ? `${e.pendenciasDeUx} pendência(s)` : undefined, obrigatorio: false });
  }
  return itens;
}

export const pendentesObrigatorios = (lista: ItemDoChecklist[]) => lista.filter((i) => i.obrigatorio && !i.ok);
