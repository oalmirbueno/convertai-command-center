import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const auth = ler("src/contexts/AuthContext.tsx");
const html = ler("index.html");

/**
 * "O painel está demorando para abrir."
 *
 * A tela que o dono viu é a rede final do index.html: 30 segundos sem nada
 * dentro de #root. Medido no ar, o painel monta em menos de um segundo para
 * quem não está logado, então o custo está no caminho de QUEM ESTÁ: antes de
 * a primeira tela aparecer, a abertura esperava uma fila de idas ao servidor,
 * uma depois da outra.
 */

describe("a abertura não empilha idas ao servidor", () => {
  it("perfil e papel são buscados juntos", () => {
    // São independentes. Em sequência somavam duas viagens antes de qualquer
    // coisa aparecer; em conexão de meio segundo de latência, um segundo
    // inteiro de tela parada sem nenhuma consulta estar lenta.
    expect(auth).toContain("await Promise.all([");
    const trecho = auth.slice(auth.indexOf("await Promise.all(["));
    expect(trecho.slice(0, 700)).toContain('.from("profiles")');
    expect(trecho.slice(0, 700)).toContain('.from("user_roles")');
  });

  it("a busca do papel não espera a do perfil terminar", () => {
    // O jeito antigo: const { data: profileData } = await ... ; depois
    // const { data: roleData } = await ...
    const antes = auth.indexOf('.from("profiles")');
    const depois = auth.indexOf('.from("user_roles")');
    const entre = auth.slice(antes, depois);
    expect(entre).not.toContain("await supabase");
  });
});

describe("a rede de segurança não abre o painel com a identidade errada", () => {
  it("quem decide é um sinal explícito, não um estado congelado", () => {
    // A condição era `if (mounted && loading)`, e `loading` vinha congelado do
    // primeiro render porque a dependência do efeito é getOrCreateProfile.
    // Valia true para sempre.
    expect(auth).toContain("const sessaoRespondeu = useRef(false)");
    expect(auth).toContain("if (!mounted || sessaoRespondeu.current) return;");
    expect(auth).not.toContain("if (mounted && loading) {");
  });

  it("com usuário conhecido, a espera pelo perfil continua", () => {
    // Desligar o carregando com perfil nulo faz o papel cair no padrão de
    // cliente: o dono via a tela de cliente e as telas internas
    // redirecionando de volta. Parecia painel quebrado.
    const inicio = auth.indexOf("if (session?.user) {");
    const trecho = auth.slice(inicio, inicio + 600);
    expect(trecho).toContain("sessaoRespondeu.current = true;");
    expect(trecho).toContain("await getOrCreateProfile(session.user)");
  });

  it("todos os caminhos de saída marcam que a sessão respondeu", () => {
    // Se um caminho esquecer, o painel espera os 8 segundos à toa.
    const marcacoes = auth.split("sessaoRespondeu.current = true").length - 1;
    expect(marcacoes).toBeGreaterThanOrEqual(4);
  });
});

describe("o aviso de demora continua sendo a última rede", () => {
  it("só aparece quando não há nada na tela", () => {
    expect(html).toContain("function appMounted()");
    expect(html).toContain("root.children.length > 0");
  });

  it("some sozinho se o painel terminar de carregar depois", () => {
    // Aviso que fica na frente para sempre é pior que aviso nenhum.
    expect(html).toContain("if (!appMounted()) return;");
    expect(html).toContain('box.style.display = "none"');
  });
});
