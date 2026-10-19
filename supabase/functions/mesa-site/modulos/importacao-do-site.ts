/**
 * Importar um site que já existe para a Mesa Site (Gravyx, 19/10/2026): zip,
 * pasta ou um HTML. As regras puras que a tela (antes de subir), a função
 * mesa-site (o manifesto) e o worker do motor (a palavra final, com os
 * arquivos de verdade) dividem:
 *
 * - caminhos normalizados (sem "..", sem absoluto, sem a pasta raiz única do zip);
 * - fora do projeto: dependências, cache, histórico e a saída de build
 *   (refeita aqui), o lixo do sistema;
 * - limites: zip, total, quantidade e tamanho por arquivo;
 * - só estático: framework que exige servidor é recusado com o motivo;
 * - sem segredos: .env, chave privada, token de serviço ou credencial no
 *   código RECUSAM a importação inteira, com o arquivo e o motivo (a equipe
 *   tira e importa de novo). Nada é "limpo" calado;
 * - o framework detectado (Vite/React, Next estático, Astro, HTML puro...)
 *   decide como o motor compila e onde fica a saída.
 *
 * Puro: sem Deno, sem npm e sem banco. Sem lookbehind, classe de propriedade Unicode ou grupo nomeado
 * (a tela importa este arquivo).
 */

export const LIMITES_DA_IMPORTACAO = {
  /** O zip que sobe para o Storage. */
  zipBytes: 50 * 1024 * 1024,
  /** A soma dos arquivos que ficam no projeto. */
  totalBytes: 200 * 1024 * 1024,
  arquivos: 4000,
  arquivoBytes: 25 * 1024 * 1024,
  /** Arquivo de texto maior que isto não é varrido atrás de segredo (minificado de terceiro). */
  textoVarridoBytes: 2 * 1024 * 1024,
} as const;

export type OrigemDaImportacao = "zip" | "pasta" | "html";
export const ROTULO_DA_ORIGEM_DA_IMPORTACAO: Record<OrigemDaImportacao, string> = { zip: "Zip", pasta: "Pasta", html: "Arquivo HTML" };

/** Um arquivo como chega: caminho, tamanho e (quando é texto pequeno) o conteúdo. */
export type ArquivoDaImportacao = { caminho: string; bytes: number; texto?: string | null };

export type IdDoFramework =
  | "vite"
  | "next"
  | "astro"
  | "cra"
  | "gatsby"
  | "nuxt"
  | "sveltekit"
  | "angular"
  | "eleventy"
  | "parcel"
  | "npm"
  | "estatico"
  | "html";

export type FrameworkDetectado = {
  id: IdDoFramework;
  rotulo: string;
  /** Script do package.json que compila (null = estático, o motor só copia). */
  build: string | null;
  /** Pasta onde o build deixa o site (o motor procura o index.html nela). */
  saida: string | null;
};

export type SegredoAchado = { arquivo: string; motivo: string };

export type AnaliseDaImportacao = {
  ok: boolean;
  codigo: string | null;
  motivo: string | null;
  framework: FrameworkDetectado | null;
  /** A pasta raiz única do zip que foi tirada ("" quando não havia). */
  raiz: string;
  /** Os arquivos que vão para o projeto (caminho já normalizado). */
  arquivos: ArquivoDaImportacao[];
  bytes: number;
  ignorados: { total: number; exemplos: string[] };
  segredos: SegredoAchado[];
  avisos: string[];
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const mb = (b: number) => `${Math.max(0.1, Math.round((b / (1024 * 1024)) * 10) / 10).toString().replace(".", ",")} MB`;

// ------------------------------------------------------------------ caminhos

/** Caminho relativo seguro com "/" (null = recusado: "..", absoluto, drive, vazio ou caractere de controle). */
export function normalizarCaminho(bruto: unknown): string | null {
  let c = String(bruto == null ? "" : bruto).split("\\").join("/");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(c)) return null;
  while (c.indexOf("./") === 0) c = c.slice(2);
  if (/^[a-zA-Z]:/.test(c) || c.charAt(0) === "/") return null;
  const partes = c.split("/").filter((p) => p !== "" && p !== ".");
  if (!partes.length || partes.some((p) => p === "..")) return null;
  return partes.join("/");
}

/** A pasta única de cima ("meu-site/") que todo arquivo divide, ou "". */
export function raizComum(caminhos: string[]): string {
  if (!caminhos.length) return "";
  const primeira = caminhos[0].split("/")[0];
  if (caminhos.some((c) => c.indexOf("/") < 0)) return "";
  return caminhos.every((c) => c.split("/")[0] === primeira) ? `${primeira}/` : "";
}

/** Pastas que nunca entram (em qualquer nível). */
export const PASTAS_FORA = ["node_modules", ".git", ".svn", ".hg", ".next", ".nuxt", ".output", ".svelte-kit", ".astro", ".vercel", ".netlify", ".cache", ".turbo", ".parcel-cache", ".angular", "__MACOSX", ".idea", ".vscode", "coverage", ".DS_Store"];
/** Arquivos de sistema que nunca entram. */
const LIXO = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
/** Saída de build (só em projeto que compila: aqui ela é refeita). */
export const SAIDAS_DE_BUILD = ["dist", "build", "out", "_site", ".output"];

function foraDoProjeto(caminho: string, compila: boolean): boolean {
  const partes = caminho.split("/");
  if (partes.some((p) => PASTAS_FORA.indexOf(p) >= 0)) return true;
  if (LIXO.test(caminho)) return true;
  if (compila && partes.length > 1 && SAIDAS_DE_BUILD.indexOf(partes[0]) >= 0) return true;
  // A Mesa escreve a própria pasta .aceleriq; a que vier de fora não entra.
  if (partes[0] === ".aceleriq") return true;
  return false;
}

// ------------------------------------------------------------------ segredos

/** Arquivo que é segredo pelo nome (recusa sem olhar dentro). */
const NOME_DE_SEGREDO = /(^|\/)(\.env(\.[a-z0-9_-]+)?|id_rsa|id_dsa|id_ecdsa|id_ed25519|[^/]+\.(pem|key|p12|pfx|jks|keystore)|credentials\.json|service[-_]account[^/]*\.json|[^/]*firebase-adminsdk[^/]*\.json|\.htpasswd)$/i;
/** .env de exemplo (sem valor de verdade) passa pela varredura do conteúdo em vez de recusar pelo nome. */
const ENV_DE_EXEMPLO = /(^|\/)\.env\.(example|sample|template|dist|exemplo|modelo)$/i;

/** Padrões de credencial no conteúdo (o rótulo vai para a tela; o valor nunca). */
const PADROES_DE_SEGREDO: Array<{ re: RegExp; motivo: string }> = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, motivo: "chave privada" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, motivo: "chave de acesso da AWS" },
  { re: /\b(sk|rk)_live_[0-9a-zA-Z]{16,}/, motivo: "chave secreta do Stripe" },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, motivo: "chave da Anthropic" },
  { re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, motivo: "chave da OpenAI" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}/, motivo: "token do GitHub" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{40,}/, motivo: "token do GitHub" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, motivo: "token do Slack" },
  { re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, motivo: "chave do SendGrid" },
  { re: /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{24,}\b/, motivo: "chave do Resend" },
  { re: /\b(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_PASSWORD)\s*[=:]\s*["']?[^\s"']{12,}/, motivo: "credencial do banco" },
  { re: /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{6,}@/, motivo: "senha do banco no endereço" },
  { re: /\b(secret|client_secret|private_key|senha|password)["']?\s*[:=]\s*["'][A-Za-z0-9/+_.=-]{16,}["']/i, motivo: "segredo escrito no código" },
  { re: /_authToken\s*=\s*\S{8,}/, motivo: "token do npm" },
];

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function decodificarBase64Url(s: string): string {
  try {
    const b = s.split("-").join("+").split("_").join("/");
    const comPad = b + "===".slice((b.length + 3) % 4);
    return typeof atob === "function" ? atob(comPad) : "";
  } catch {
    return "";
  }
}

/** O motivo do segredo no texto (null = nada achado). A chave anon do Supabase é pública: passa; a service_role não. */
export function segredoNoTexto(texto: string): string | null {
  const t = String(texto || "");
  if (!t) return null;
  for (const p of PADROES_DE_SEGREDO) if (p.re.test(t)) return p.motivo;
  JWT.lastIndex = 0;
  let m: RegExpExecArray | null;
  let vistos = 0;
  while ((m = JWT.exec(t)) && vistos < 20) {
    vistos += 1;
    if (/service_role/.test(decodificarBase64Url(m[1]))) return "chave service_role do Supabase";
  }
  return null;
}

/** Arquivo de segredo pelo nome (null = não é). */
export function segredoPeloNome(caminho: string): string | null {
  if (ENV_DE_EXEMPLO.test(caminho)) return null;
  if (NOME_DE_SEGREDO.test(caminho)) {
    const nome = caminho.split("/").pop() || caminho;
    return nome.charAt(0) === "." && nome.indexOf(".env") === 0 ? "arquivo .env (variáveis e chaves)" : "arquivo de chave ou credencial";
  }
  return null;
}

/** Extensões de texto (o resto é binário: imagem, fonte, vídeo). */
export const EXTENSOES_DE_TEXTO = /\.(html?|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|mts|cts|vue|svelte|astro|json|jsonc|md|mdx|txt|xml|svg|yml|yaml|toml|ini|env|example|sample|template|njk|liquid|hbs|ejs|pug|webmanifest|map|csv|graphql|gql)$/i;
export const ehTexto = (caminho: string) => {
  const nome = caminho.split("/").pop() || "";
  return EXTENSOES_DE_TEXTO.test(nome) || /^\.(env|npmrc|gitignore|editorconfig|prettierrc|eslintrc|browserslistrc|nvmrc)/i.test(nome) || /^(LICENSE|README|Dockerfile|Procfile|_headers|_redirects|CNAME)$/i.test(nome);
};

/** Os segredos de uma lista (pelo nome e, quando veio o texto, pelo conteúdo). Até 10. */
export function segredosDosArquivos(arquivos: ArquivoDaImportacao[]): SegredoAchado[] {
  const achados: SegredoAchado[] = [];
  for (const a of arquivos) {
    if (achados.length >= 10) break;
    const pelo = segredoPeloNome(a.caminho);
    if (pelo) {
      achados.push({ arquivo: a.caminho, motivo: pelo });
      continue;
    }
    if (typeof a.texto === "string" && a.texto.length <= LIMITES_DA_IMPORTACAO.textoVarridoBytes) {
      const no = segredoNoTexto(a.texto);
      if (no) achados.push({ arquivo: a.caminho, motivo: no });
    }
  }
  return achados;
}

// ------------------------------------------------------------------ framework

type PacoteNpm = { scripts: Record<string, string>; deps: Record<string, string>; workspaces: boolean };

export function lerPackageJson(texto: string | null | undefined): PacoteNpm | null {
  if (typeof texto !== "string") return null;
  try {
    const p = obj(JSON.parse(texto));
    const scripts: Record<string, string> = {};
    const s = obj(p.scripts);
    for (const k of Object.keys(s)) if (typeof s[k] === "string") scripts[k] = String(s[k]);
    const deps: Record<string, string> = {};
    for (const campo of ["dependencies", "devDependencies"]) {
      const d = obj(p[campo]);
      for (const k of Object.keys(d)) deps[k] = String(d[k]);
    }
    return { scripts, deps, workspaces: !!p.workspaces };
  } catch {
    return null;
  }
}

const temDep = (p: PacoteNpm, nome: string) => Object.prototype.hasOwnProperty.call(p.deps, nome);
const temDepQueComeca = (p: PacoteNpm, prefixo: string) => Object.keys(p.deps).some((k) => k.indexOf(prefixo) === 0);

type Deteccao = { framework: FrameworkDetectado } | { recusa: { codigo: string; motivo: string } };

const recusa = (codigo: string, motivo: string): Deteccao => ({ recusa: { codigo, motivo } });
const achou = (id: IdDoFramework, rotulo: string, build: string | null, saida: string | null): Deteccao => ({ framework: { id, rotulo, build, saida } });

const textoDe = (arquivos: ArquivoDaImportacao[], re: RegExp) => {
  const a = arquivos.find((x) => re.test(x.caminho));
  return a && typeof a.texto === "string" ? a.texto : null;
};

/**
 * Qual é o site: o framework pelo package.json e pelos arquivos de
 * configuração da raiz. Framework que exige servidor (Next sem export, Remix,
 * Nuxt e SvelteKit sem saída estática, Astro em modo servidor, servidor Node)
 * é recusado: a Mesa publica só site estático.
 */
export function detectarFramework(arquivos: ArquivoDaImportacao[], origem: OrigemDaImportacao): Deteccao {
  const caminhos = arquivos.map((a) => a.caminho);
  const naRaiz = (re: RegExp) => caminhos.some((c) => c.indexOf("/") < 0 && re.test(c));
  if (origem === "html") return achou("html", "Página HTML única", null, null);
  if (naRaiz(/^(pnpm-workspace\.yaml|lerna\.json|turbo\.json|nx\.json|rush\.json)$/)) {
    return recusa("monorepo", "É um monorepo (vários pacotes). Importe só a pasta do site, a que tem o package.json dele.");
  }
  const pjTexto = textoDe(arquivos, /^package\.json$/);
  const temPj = caminhos.indexOf("package.json") >= 0;
  const temIndex = caminhos.indexOf("index.html") >= 0;
  if (!temPj) {
    if (temIndex) return achou("estatico", "Site estático (HTML, CSS e JS)", null, null);
    if (naRaiz(/^(hugo|config)\.(toml|ya?ml)$/) || naRaiz(/^_config\.ya?ml$/)) return recusa("gerador_fora_do_npm", "Parece Hugo ou Jekyll (gerador fora do npm). Importe a pasta já gerada (public/ ou _site/), com o index.html na raiz.");
    const htmls = caminhos.filter((c) => /\.html?$/i.test(c));
    if (htmls.length) return recusa("sem_index", `Falta o index.html na raiz (achei ${htmls.slice(0, 2).join(", ")}). A página inicial precisa se chamar index.html.`);
    return recusa("sem_site", "Não achei um site aqui: nem package.json nem index.html na raiz.");
  }
  const p = lerPackageJson(pjTexto);
  if (!p) return recusa("package_json_ilegivel", "O package.json não é um JSON válido.");
  if (p.workspaces) return recusa("monorepo", "O package.json declara workspaces (monorepo). Importe só a pasta do site.");
  const build = p.scripts.build ? "build" : null;
  const scriptBuild = build ? p.scripts.build : "";
  const configDe = (prefixo: string) => textoDe(arquivos, new RegExp(`^${prefixo}\\.config\\.(js|mjs|cjs|ts|mts)$`)) || "";

  if (temDep(p, "next")) {
    const conf = configDe("next");
    const exporta = /output\s*:\s*["']export["']/.test(conf) || /next\s+export/.test(scriptBuild);
    if (!exporta) return recusa("next_com_servidor", "É Next com servidor (sem output: 'export' no next.config). A Mesa publica só site estático: ligue o export estático no projeto e importe de novo.");
    if (!build) return recusa("sem_build", "O package.json do Next não tem o script build.");
    return achou("next", "Next.js (exportação estática)", build, "out");
  }
  if (temDepQueComeca(p, "@remix-run/") || temDep(p, "@react-router/dev")) return recusa("remix", "É Remix ou React Router em modo framework, que precisa de servidor. A Mesa publica só site estático.");
  if (temDep(p, "nuxt")) {
    if (p.scripts.generate || /nuxt\s+generate/.test(scriptBuild)) return achou("nuxt", "Nuxt (geração estática)", p.scripts.generate ? "generate" : build, ".output/public");
    return recusa("nuxt_com_servidor", "É Nuxt com servidor. Use nuxt generate (script generate) e importe de novo.");
  }
  if (temDep(p, "@sveltejs/kit")) {
    if (temDep(p, "@sveltejs/adapter-static") && build) return achou("sveltekit", "SvelteKit (adapter-static)", build, "build");
    return recusa("sveltekit_com_servidor", "É SvelteKit sem o adapter-static. A Mesa publica só site estático.");
  }
  if (temDep(p, "astro")) {
    const conf = configDe("astro");
    if (/output\s*:\s*["'](server|hybrid)["']/.test(conf) || ["@astrojs/node", "@astrojs/vercel", "@astrojs/netlify", "@astrojs/cloudflare"].some((d) => temDep(p, d))) {
      return recusa("astro_com_servidor", "É Astro em modo servidor (output server ou adapter). A Mesa publica só site estático.");
    }
    if (!build) return recusa("sem_build", "O package.json do Astro não tem o script build.");
    return achou("astro", "Astro", build, "dist");
  }
  if (temDep(p, "gatsby") && build) return achou("gatsby", "Gatsby", build, "public");
  if (temDep(p, "@angular/core") && build) return achou("angular", "Angular", build, "dist");
  if (temDep(p, "react-scripts") && build) return achou("cra", "Create React App", build, "build");
  if (temDep(p, "@11ty/eleventy") && build) return achou("eleventy", "Eleventy", build, "_site");
  if (temDep(p, "vite") && build) {
    const sabor = temDep(p, "react") ? "React" : temDep(p, "vue") ? "Vue" : temDep(p, "svelte") ? "Svelte" : temDep(p, "preact") ? "Preact" : temDep(p, "solid-js") ? "Solid" : null;
    return achou("vite", sabor ? `Vite + ${sabor}` : "Vite", build, "dist");
  }
  if (temDep(p, "parcel") && build) return achou("parcel", "Parcel", build, "dist");
  if (["express", "fastify", "koa", "@nestjs/core", "hono", "@hapi/hapi"].some((d) => temDep(p, d)) && !temIndex) {
    return recusa("servidor_node", "É um servidor Node (Express, Fastify, Nest...). A Mesa publica só site estático.");
  }
  if (build) return achou("npm", "Projeto npm (build próprio)", build, null);
  if (temIndex) return achou("estatico", "Site estático (HTML, CSS e JS)", null, null);
  return recusa("sem_build", "O package.json não tem o script build e não há index.html na raiz.");
}

// ------------------------------------------------------------------ a análise inteira

/**
 * A análise de uma importação: normaliza, tira o que não entra, confere os
 * limites, procura segredo e detecta o framework. `ok: false` traz o código e
 * o motivo (a tela mostra; o worker recusa o trabalho com ele).
 */
export function analisarImportacao(brutos: ArquivoDaImportacao[], origem: OrigemDaImportacao): AnaliseDaImportacao {
  const avisos: string[] = [];
  const vazia = (codigo: string, motivo: string, extra: Partial<AnaliseDaImportacao> = {}): AnaliseDaImportacao => ({
    ok: false, codigo, motivo, framework: null, raiz: "", arquivos: [], bytes: 0, ignorados: { total: 0, exemplos: [] }, segredos: [], avisos, ...extra,
  });
  const validos: ArquivoDaImportacao[] = [];
  const recusados: string[] = [];
  for (const a of brutos || []) {
    const c = normalizarCaminho(a && a.caminho);
    if (!c) {
      recusados.push(String(a && a.caminho).slice(0, 80));
      continue;
    }
    validos.push({ caminho: c, bytes: Math.max(0, Number(a.bytes) || 0), texto: a.texto });
  }
  if (recusados.length) return vazia("caminho_invalido", `Há caminho inseguro no pacote (${recusados.slice(0, 2).join(", ")}): nada de "..", caminho absoluto ou letra de disco.`);
  if (!validos.length) return vazia("vazio", "Não veio nenhum arquivo.");

  // HTML único vira o index.html.
  let lista = validos;
  if (origem === "html") {
    if (lista.length !== 1 || !/\.html?$/i.test(lista[0].caminho)) return vazia("html_invalido", "Escolha um arquivo .html só.");
    lista = [{ ...lista[0], caminho: "index.html" }];
  }
  // A pasta raiz única do zip ("meu-site/...") sai; o lixo do sistema primeiro, para não atrapalhar a raiz.
  const semLixo = lista.filter((a) => !LIXO.test(a.caminho) && a.caminho.split("/")[0] !== "__MACOSX");
  const raiz = raizComum(semLixo.map((a) => a.caminho));
  const naRaiz = raiz ? semLixo.map((a) => ({ ...a, caminho: a.caminho.slice(raiz.length) })).filter((a) => !!a.caminho) : semLixo;

  // Segredo primeiro: recusa a importação inteira (a tela mostra o arquivo e o motivo).
  const segredos = segredosDosArquivos(naRaiz.filter((a) => a.caminho.split("/").every((p) => PASTAS_FORA.indexOf(p) < 0)));
  if (segredos.length) {
    return vazia("segredo", `Achei ${segredos.length === 1 ? "um segredo" : `${segredos.length} segredos`} no pacote (${segredos.slice(0, 3).map((s) => `${s.arquivo}: ${s.motivo}`).join("; ")}). Tire do projeto (e troque a chave, se ela já circulou) e importe de novo.`, { raiz, segredos });
  }

  const pj = naRaiz.find((a) => a.caminho === "package.json");
  const compila = !!(pj && lerPackageJson(pj.texto) && (lerPackageJson(pj.texto) as PacoteNpm).scripts.build);
  const ficam: ArquivoDaImportacao[] = [];
  const exemplos: string[] = [];
  let ignorados = 0;
  let avisouLock = false;
  for (const a of naRaiz) {
    if (foraDoProjeto(a.caminho, compila)) {
      ignorados += 1;
      if (exemplos.length < 4) {
        const topo = a.caminho.split("/").slice(0, a.caminho.indexOf("node_modules") >= 0 ? a.caminho.split("/").indexOf("node_modules") + 1 : 1).join("/");
        if (exemplos.indexOf(topo) < 0) exemplos.push(topo);
      }
      continue;
    }
    // .npmrc sem token e os locks de outro gerenciador não entram: o motor instala com npm.
    if (/^(\.npmrc|\.yarnrc(\.yml)?|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(a.caminho)) {
      ignorados += 1;
      if (/lock/.test(a.caminho) && !avisouLock) {
        avisouLock = true;
        avisos.push(`O ${a.caminho} não entra: o motor instala com npm (pnpm, yarn e bun não).`);
      }
      continue;
    }
    ficam.push(a);
  }
  const bytes = ficam.reduce((n, a) => n + a.bytes, 0);
  const extra = { raiz, ignorados: { total: ignorados, exemplos } };
  if (!ficam.length) return vazia("vazio", "Depois de tirar dependências e cache, não sobrou arquivo do site.", extra);
  if (ficam.length > LIMITES_DA_IMPORTACAO.arquivos) return vazia("arquivos_demais", `São ${ficam.length} arquivos; o máximo é ${LIMITES_DA_IMPORTACAO.arquivos}.`, extra);
  const grande = ficam.find((a) => a.bytes > LIMITES_DA_IMPORTACAO.arquivoBytes);
  if (grande) return vazia("arquivo_grande", `O arquivo ${grande.caminho} tem ${mb(grande.bytes)}; o máximo por arquivo é ${mb(LIMITES_DA_IMPORTACAO.arquivoBytes)}. Vídeo pesado vai por link.`, extra);
  if (bytes > LIMITES_DA_IMPORTACAO.totalBytes) return vazia("grande_demais", `O site tem ${mb(bytes)}; o máximo é ${mb(LIMITES_DA_IMPORTACAO.totalBytes)}.`, extra);

  const d = detectarFramework(ficam, origem);
  if ("recusa" in d) return vazia(d.recusa.codigo, d.recusa.motivo, { ...extra, arquivos: ficam, bytes });
  if (ficam.some((a) => a.caminho.indexOf("api/") === 0) && d.framework.id !== "estatico" && d.framework.id !== "html") avisos.push("A pasta api/ (funções de servidor) não roda: o site sai estático.");
  if (ficam.some((a) => /^(src\/)?middleware\.(ts|js)$/.test(a.caminho))) avisos.push("O middleware não roda: o site sai estático.");
  if (d.framework.id === "npm") avisos.push("Framework não reconhecido: o motor roda o build do projeto e procura o index.html em dist, build, out ou public.");
  return { ok: true, codigo: null, motivo: null, framework: d.framework, raiz, arquivos: ficam, bytes, ignorados: { total: ignorados, exemplos }, segredos: [], avisos };
}

/**
 * O manifesto que a tela manda para a função (nomes e tamanhos, sem o
 * conteúdo): a função confere o que dá sem baixar o zip (nome de segredo,
 * limites e caminho). O conteúdo é varrido na tela antes de subir e no worker.
 */
export function conferirManifesto(bruto: unknown): { ok: boolean; codigo: string | null; motivo: string | null; arquivos: number; bytes: number } {
  const lista = (Array.isArray(bruto) ? bruto : []).slice(0, LIMITES_DA_IMPORTACAO.arquivos + 1).map((x) => {
    const o = obj(x);
    return { caminho: normalizarCaminho(o.caminho), bruto: String(o.caminho || "").slice(0, 80), bytes: Math.max(0, Number(o.bytes) || 0) };
  });
  const bytes = lista.reduce((n, x) => n + x.bytes, 0);
  const nao = (codigo: string, motivo: string) => ({ ok: false, codigo, motivo, arquivos: lista.length, bytes });
  if (!lista.length) return nao("vazio", "Não veio nenhum arquivo.");
  if (lista.length > LIMITES_DA_IMPORTACAO.arquivos) return nao("arquivos_demais", `O máximo é ${LIMITES_DA_IMPORTACAO.arquivos} arquivos.`);
  const inseguro = lista.find((x) => !x.caminho);
  if (inseguro) return nao("caminho_invalido", `Há caminho inseguro no pacote (${inseguro.bruto}).`);
  const segredo = lista.map((x) => ({ arquivo: x.caminho as string, motivo: segredoPeloNome(x.caminho as string) })).find((x) => !!x.motivo);
  if (segredo) return nao("segredo", `Achei um segredo no pacote (${segredo.arquivo}: ${segredo.motivo}). Tire do projeto e importe de novo.`);
  const grande = lista.find((x) => x.bytes > LIMITES_DA_IMPORTACAO.arquivoBytes);
  if (grande) return nao("arquivo_grande", `O arquivo ${grande.caminho} passa de ${mb(LIMITES_DA_IMPORTACAO.arquivoBytes)}.`);
  if (bytes > LIMITES_DA_IMPORTACAO.totalBytes) return nao("grande_demais", `O site tem ${mb(bytes)}; o máximo é ${mb(LIMITES_DA_IMPORTACAO.totalBytes)}.`);
  return { ok: true, codigo: null, motivo: null, arquivos: lista.length, bytes };
}

// ------------------------------------------------------------------ o projeto importado

/** O que o worker grava em .aceleriq/importado.json (o motor sabe que o projeto não é do modelo da casa). */
export type RegistroDaImportacao = {
  framework: IdDoFramework;
  rotulo: string;
  build: string | null;
  saida: string | null;
  origem: OrigemDaImportacao;
  arquivos: number;
  bytes: number;
  importado_em: string;
};

export function registroDaImportacao(a: AnaliseDaImportacao, origem: OrigemDaImportacao, agora: string): RegistroDaImportacao {
  const f = a.framework as FrameworkDetectado;
  return { framework: f.id, rotulo: f.rotulo, build: f.build, saida: f.saida, origem, arquivos: a.arquivos.length, bytes: a.bytes, importado_em: agora };
}

/**
 * O package.json do projeto importado: o build vira o do motor (que roda o
 * build original e leva a saída para dist/), o original fica em
 * build:importado e o checar (o que o agente roda) faz o mesmo build.
 * Sem package.json (HTML puro), nasce um mínimo, sem dependência.
 */
export function packageJsonDoImportado(original: string | null, nome: string, f: FrameworkDetectado): string {
  const MONTAR = "node .aceleriq/montar.mjs";
  let p: Record<string, unknown> = {};
  if (original) {
    try {
      p = obj(JSON.parse(original));
    } catch {
      p = {};
    }
  } else {
    p = { name: nome, private: true, version: "0.0.0" };
  }
  const scripts = { ...obj(p.scripts) } as Record<string, unknown>;
  if (f.build && typeof scripts[f.build] === "string" && scripts[f.build] !== MONTAR) scripts["build:importado"] = scripts[f.build];
  scripts.build = MONTAR;
  scripts.checar = MONTAR;
  p.scripts = scripts;
  return `${JSON.stringify(p, null, 2)}\n`;
}

/** As linhas que o .gitignore do importado precisa (somadas às que ele já tem). */
export const GITIGNORE_DO_IMPORTADO = ["node_modules", "dist", ".env", ".env.*", "!.env.example"];

export function gitignoreDoImportado(atual: string | null): string {
  const linhas = String(atual || "").split(/\r?\n/);
  const falta = GITIGNORE_DO_IMPORTADO.filter((l) => linhas.map((x) => x.trim()).indexOf(l) < 0);
  if (!falta.length) return atual || "";
  const base = atual && !/\n$/.test(atual) ? `${atual}\n` : atual || "";
  return `${base}${base ? "\n" : ""}# Mesa Site (importação)\n${falta.join("\n")}\n`;
}

/** O AGENTS.md do importado (só quando o projeto não tem um): o agente edita sem redesenhar. */
export function agentesDoImportado(f: FrameworkDetectado): string {
  return [
    "# Site importado na Mesa Site",
    "",
    `Projeto ${f.rotulo} trazido de fora (não é o modelo da casa). Edite o que for pedido, no estilo do código que já existe.`,
    "",
    "- Não troque o framework, não reorganize pastas e não mude dependências sem o pedido.",
    "- `npm run checar` compila e deixa o site em `dist/` (o motor confere no computador e no celular).",
    "- O site é estático: nada de servidor, pasta api/ ou middleware.",
    "- Nunca escreva chave, token ou senha no código.",
    "",
  ].join("\n");
}
