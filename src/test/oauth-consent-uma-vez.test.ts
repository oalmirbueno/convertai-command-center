import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = resolve(__dirname, "../..");
const pagina = readFileSync(resolve(raiz, "src/pages/OAuthConsent.tsx"), "utf8");

/**
 * O relato: "fui reconectar e deu Autorização indisponível — authorization
 * request cannot be processed".
 *
 * A mensagem é da própria tela do painel: ela chama
 * `getAuthorizationDetails(authorization_id)` e mostra o erro que voltar.
 * Essa chamada é de USO ÚNICO. E o efeito que a dispara depende de `user`,
 * que ganha identidade nova a cada evento de sessão do Supabase
 * (INITIAL_SESSION, TOKEN_REFRESHED) — então ele reexecutava sozinho, a
 * segunda chamada queimava a autorização, e o consentimento virava erro.
 */

describe("o consentimento busca a autorização uma vez só", () => {
  it("prende a busca ao authorization_id já consultado", () => {
    expect(pagina).toContain("const buscado = useRef<string | null>(null)");
    expect(pagina).toContain("if (buscado.current === authorizationId) return;");
    expect(pagina).toContain("buscado.current = authorizationId;");
  });

  it("a trava vem ANTES da chamada, não depois", () => {
    // Marcar depois de resolver deixaria a janela aberta: dois efeitos
    // disparam antes de qualquer resposta chegar.
    const guarda = pagina.indexOf("buscado.current = authorizationId;");
    const chamada = pagina.indexOf("oauth.getAuthorizationDetails");
    expect(guarda).toBeGreaterThan(-1);
    expect(chamada).toBeGreaterThan(guarda);
  });

  it("a trava não atrapalha um pedido novo", () => {
    // A comparação é por id, não um booleano: começar outra conexão traz
    // outro authorization_id e a busca acontece normalmente.
    expect(pagina).not.toContain("if (buscado.current) return;");
  });
});

describe("a tela de erro diz o que fazer", () => {
  it("explica que o pedido vale uma vez e manda recomeçar pelo aplicativo", () => {
    // Antes era um beco sem saída: só a mensagem crua do servidor, e quem
    // chegava ali recarregava a página, que não resolve nada.
    expect(pagina).toContain("vale uma vez e expira");
    expect(pagina).toContain("comece a conexão de novo");
    expect(pagina).toContain("Recarregar esta página não");
  });
});
