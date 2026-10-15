/**
 * Borda do painel na Cloudflare (15/10/2026). Só roda para /assets/* (run_worker_first no wrangler.jsonc);
 * o resto vai direto para os arquivos estáticos.
 *
 * Por quê: com "single-page-application", um pedaço com hash que ainda não existe (publicação pela
 * metade) voltava como o index.html, com 200 e o cabeçalho de /assets/* (cache de 1 ano, immutable).
 * O navegador guardava esse HTML no lugar do .js e a tela travava ("reading 'default'") até limpar o
 * cache. Agora o pedaço que falta é 404 sem cache, e a próxima tentativa pega o arquivo certo.
 */
export default {
  async fetch(request, env) {
    const resposta = await env.ASSETS.fetch(request);
    if ((resposta.headers.get("content-type") || "").includes("text/html")) {
      return new Response("Arquivo não encontrado.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return resposta;
  },
};
