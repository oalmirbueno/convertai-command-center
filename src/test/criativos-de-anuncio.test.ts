import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Criativos: a peça que faltava para o painel falar de anúncio de verdade.
 *
 * O que existia era só CAMPANHA — a Graph era consultada com
 * `level=campaign`, e nesse nível não existe imagem, nome de peça nem
 * "qual anúncio performou". Nenhuma tela conseguiria mostrar miniatura a
 * partir disso, por melhor que fosse escrita: o dado não estava lá.
 */

const raiz = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(raiz, "supabase/migrations/20260828130000_criativos_de_anuncio.sql"), "utf8",
);
const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const servico = readFileSync(
  resolve(raiz, "supabase/functions/_shared/aceleriq-metrics-services.ts"), "utf8",
);
const ferramentas = readFileSync(
  resolve(raiz, "supabase/functions/_shared/mcp-tools.ts"), "utf8",
);
const galeria = readFileSync(
  resolve(raiz, "src/components/ads/GaleriaDeCriativos.tsx"), "utf8",
);
const hook = readFileSync(resolve(raiz, "src/hooks/useAdsMetrics.ts"), "utf8");
const tela = readFileSync(resolve(raiz, "src/pages/AdminAds.tsx"), "utf8");

describe("a coleta desce ao nivel do anuncio", () => {
  it("consulta a Graph com level=ad, e nao level=campaign", () => {
    // E o unico jeito de existir numero POR PECA.
    expect(codigo).toContain("level=ad");
    expect(codigo).toContain("/ads'");
    expect(codigo).toContain("creative{id,thumbnail_url");
  });

  it("a fila e SEPARADA da de campanhas", () => {
    // A coleta de campanhas funciona e o dono depende dela. Se o lado novo
    // falhar, o que ja funciona nem fica sabendo.
    expect(codigo).toContain("social_private.ads_creatives_requests");
    expect(codigo).not.toContain("social_private.ads_metrics_requests");
  });

  it("pagina ate o fim, senao conta grande mostra so as cem primeiras", () => {
    expect(codigo).toContain("paging,cursors,after");
    expect(codigo).toContain("paging,next");
  });

  it("desiste depois de tres tentativas", () => {
    // Erro permanente nao pode ocupar a fila para sempre.
    expect(codigo).toContain("_req.attempts >= 3");
  });

  it("a miniatura e sobrescrita a cada leitura, porque o endereco expira", () => {
    expect(codigo).toContain("thumbnail_url = excluded.thumbnail_url");
    expect(sql).toContain("EXPIRA");
  });

  it("a RLS copia a das campanhas, com can_access_client", () => {
    // Designer alocado num cliente nao tem por que ver o investimento de
    // outro. Minha primeira versao era mais frouxa que o resto do painel.
    expect(codigo).toContain("public.is_staff(auth.uid()) and public.can_access_client(client_id)");
    expect(codigo).toContain("client_id = auth.uid()");
  });
});

describe("alcance nao soma, em nenhuma das tres camadas", () => {
  it("no servico do MCP", () => {
    expect(servico).toContain("maior_alcance_em_um_dia");
    expect(servico).toContain("não são duas pessoas");
  });

  it("no hook da tela", () => {
    expect(hook).toContain("maior_alcance");
    expect(hook).toContain("não são");
  });

  it("e escrito na propria tela, para ninguem somar num relatorio", () => {
    expect(galeria).toContain("é o maior dia do período, não a soma");
  });

  it("a ferramenta do MCP avisa quem for ler", () => {
    expect(ferramentas).toContain("NAO e a soma do alcance");
  });
});

describe("a galeria mostra a peca e o numero", () => {
  it("imagem que nao carrega vira nome, nunca buraco branco", () => {
    // O endereco expira do lado da Meta: falhar e normal, e um vazio na
    // grade faria qualquer pessoa achar que o painel quebrou.
    expect(galeria).toContain("onError={() => setFalhou(true)}");
    expect(galeria).toContain("a imagem expirou na Meta");
  });

  it("abre em tela grande e fecha com Escape", () => {
    expect(galeria).toContain('e.key === "Escape"');
    expect(galeria).toContain("max-h-[60vh]");
  });

  it("ordena por gasto, custo e CTR, e quem nao tem custo vai para o fim", () => {
    // Senao o 'melhor' do ranking seria justamente quem nao gastou nada.
    expect(galeria).toContain("if (a.custo_no_link === null) return 1;");
  });

  it("peca sem numero no periodo diz isso, em vez de mostrar zero", () => {
    expect(galeria).toContain("sem número no período");
  });

  it("a lista de contas da Meta tem rolagem propria", () => {
    expect(tela).toContain("max-h-[22rem] space-y-1.5 overflow-y-auto");
  });

  it("atualizar agora colhe campanhas E criativos", () => {
    expect(hook).toContain('rpc("collect_ads_now"');
    expect(codigo).toContain("public.ads_creatives_tick()");
    expect(tela).toContain('queryKey: ["ads-creatives"]');
  });
});

describe("a arte aparece em tamanho de verdade", () => {
  it("a grade usa image_url, e nao a miniatura de 64 pixels", () => {
    // thumbnail_url da Meta traz `p64x64` na propria URL: sao 64 pixels,
    // que esticados num cartao de 272px viram um borrao. Conferi uma
    // image_url real da conta: 697 por 697.
    expect(galeria).toContain("const src = c.image_url || c.thumbnail_url;");
    expect(galeria).toContain("p64x64");
  });

  it("nao manda a origem do painel para o fbcdn", () => {
    // A imagem vem sem exigir origem, e mandar a nossa so vazaria de onde
    // o painel esta sendo aberto.
    expect(galeria).toContain('referrerPolicy="no-referrer"');
  });

  it("o topo diz quanto foi investido nas pecas", () => {
    // Sem um teto de leitura, quem abre a tela ve vinte cartoes e nao sabe
    // se aquilo e muito ou pouco dinheiro.
    expect(galeria).toContain("investido nas peças");
    expect(galeria).toContain("custo médio");
    expect(galeria).toContain("maior gasto:");
  });

  it("cada peca diz de qual campanha e", () => {
    // Primeira pergunta de quem olha vinte artes seguidas.
    expect(galeria).toContain("{c.campanha}");
    expect(hook).toContain("nomeDaCampanha.get(peca.campaign_id)");
  });
});
