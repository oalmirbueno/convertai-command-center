import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  escolherIdentidadePrincipal, handleCombina, normalizar,
} from "@/lib/identidadePrincipal";

/**
 * A logo da AcelerIQ aparecia como a do sitebolt.
 *
 * Um cliente pode ter mais de um perfil. A AcelerIQ tem @aceleriq e
 * @sitebolt, capturados no MESMO segundo — e a regra "a mais recente
 * vence" não tinha desempate: a ordem virava sorteio.
 *
 * Marca errada é pior que marca nenhuma: quem olha confia no que vê e não
 * tem como desconfiar.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const cand = (username: string, extra: Partial<Parameters<typeof escolherIdentidadePrincipal>[0][number]> = {}) => ({
  client_id: "c1",
  username,
  profile_picture_url: `https://cdn/${username}.jpg`,
  captured_at: "2026-08-28T19:50:00Z",
  posts: 0,
  ...extra,
});

describe("o handle que conversa com o nome do cliente", () => {
  it("resolve o caso real da AcelerIQ", () => {
    expect(handleCombina("aceleriq", "AcelerIQ")).toBe(true);
    expect(handleCombina("sitebolt", "AcelerIQ")).toBe(false);
  });

  it("aceita contenção nos dois sentidos", () => {
    // "acerbispc" contém "acerbi"; "verzelo jardins e poda" contém
    // "verzelojardins". Exigir igualdade exata reprovaria os dois — e é
    // justamente o caso comum.
    expect(handleCombina("acerbispc", "Acerbi")).toBe(true);
    expect(handleCombina("verzelo.jardins", "Verzelo - Jardins e Poda de árvores")).toBe(true);
    expect(handleCombina("stop.info", "Stop Informatica")).toBe(true);
  });

  it("ignora acento e pontuação", () => {
    expect(normalizar("Verzelo - Jardins e Poda de árvores")).toBe("verzelojardinsepodadearvores");
  });

  it("handle curto não casa por acidente", () => {
    // Sem o mínimo, um "vip" casaria com meia dúzia de clientes.
    expect(handleCombina("vip", "Vip Coisas")).toBe(false);
  });
});

describe("a escolha da conta principal", () => {
  it("o nome vence o volume", () => {
    // Uma conta secundária muito ativa não vira a cara da marca.
    const escolhida = escolherIdentidadePrincipal(
      [cand("sitebolt", { posts: 900 }), cand("aceleriq", { posts: 9 })],
      "AcelerIQ",
    );
    expect(escolhida!.username).toBe("aceleriq");
  });

  it("sem nome casando, o volume decide", () => {
    const escolhida = escolherIdentidadePrincipal(
      [cand("outra", { posts: 4 }), cand("terceira", { posts: 40 })],
      "Nome Que Nao Casa Com Nada",
    );
    expect(escolhida!.username).toBe("terceira");
  });

  it("conta sem foto perde para a que tem", () => {
    const escolhida = escolherIdentidadePrincipal(
      [cand("sem", { profile_picture_url: null, posts: 50 }), cand("com", { posts: 1 })],
      "Nada",
    );
    expect(escolhida!.username).toBe("com");
  });

  it("empate total é ESTÁVEL entre recargas", () => {
    // Sem desempate determinístico a logo mudaria sozinha a cada F5 — que
    // foi exatamente o defeito original.
    const a = [cand("bbb"), cand("aaa")];
    const b = [cand("aaa"), cand("bbb")];
    expect(escolherIdentidadePrincipal(a, "X")!.username)
      .toBe(escolherIdentidadePrincipal(b, "X")!.username);
  });

  it("lista vazia devolve null, e não um objeto vazio", () => {
    expect(escolherIdentidadePrincipal([], "X")).toBeNull();
  });
});

describe("o layout que estava bagunçado", () => {
  it("a saúde das contas saiu do topo das métricas", () => {
    // Os cartões são o que a pessoa veio ver; diagnóstico é consulta.
    const pagina = ler("src/pages/AdminMetricas.tsx");
    const posCartoes = pagina.indexOf("filteredHubs.map");
    const posSaude = pagina.indexOf("<SaudeDasContas />");
    expect(posSaude).toBeGreaterThan(posCartoes);
  });

  it("as campanhas saíram do topo dos anúncios", () => {
    const pagina = ler("src/pages/AdminAds.tsx");
    const posCartoes = pagina.indexOf("filtrados.map");
    const posCampanhas = pagina.lastIndexOf("<CampanhasAtivas");
    expect(posCampanhas).toBeGreaterThan(posCartoes);
  });

  it("dá para saber de qual cliente é cada campanha", () => {
    // A primeira versão punha uma etiqueta miúda em cada linha; o
    // agrupamento por cliente resolve melhor e tornou a etiqueta
    // redundante. O que não pode voltar é a lista anônima.
    const comp = ler("src/components/ads/CampanhasAtivas.tsx");
    expect(comp).toContain("porCliente.map((grupo)");
    expect(comp).toContain("grupo.nome");
  });

  it("dá para clicar na campanha e abrir o cliente", () => {
    const comp = ler("src/components/ads/CampanhasAtivas.tsx");
    expect(comp).toContain("aoAbrirCliente?.((c as any).client_id)");
    expect(comp).toContain('role={aoAbrirCliente ? "button" : undefined}');
  });

  it("entrar no cliente não faz as campanhas sumirem", () => {
    const pagina = ler("src/pages/AdminAds.tsx");
    expect(pagina).toContain("<CampanhasAtivas clientId={clienteAberto} />");
  });
});

describe("os anúncios dizem de quem é o que", () => {
  const comp = ler("src/components/ads/CampanhasAtivas.tsx");

  it("'No ar agora' declara o escopo dos números", () => {
    // Três totais sem escopo fazem quem lê achar que é de um cliente só —
    // e decidir errado por isso.
    expect(comp).toContain("todos os clientes ·");
    expect(comp).toContain('nomesDeClientes?.get(clientId) ?? "este cliente"');
  });

  it("as campanhas são agrupadas por cliente, e não etiquetadas uma a uma", () => {
    // Uma lista corrida com etiqueta miúda ainda obriga a ler linha por
    // linha para saber de quem é.
    expect(comp).toContain("porCliente.map((grupo)");
    expect(comp).toContain("grupo.campanhas.map((c)");
  });

  it("o cabeçalho do grupo traz a logo e o gasto do cliente", () => {
    expect(comp).toContain("<LogoDoCliente");
    expect(comp).toContain("em 14 dias");
  });

  it("o cliente que gasta mais aparece primeiro", () => {
    // Quem consome mais dinheiro merece o primeiro olhar.
    expect(comp).toContain("b.gasto - a.gasto || a.nome.localeCompare(b.nome)");
  });

  it("a etiqueta miúda saiu de dentro da linha", () => {
    // O cabeçalho do grupo já diz de quem é; repetir em cada linha é ruído.
    expect(comp).not.toContain("DE QUEM É a campanha");
  });
});
