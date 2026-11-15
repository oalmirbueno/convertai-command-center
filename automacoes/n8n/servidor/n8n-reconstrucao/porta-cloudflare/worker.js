// Porta estável do n8n da Aceleriq: n8n.aceleriq.com.br repassa SÓ os webhooks de produção e o teste de
// saúde para o servidor onde o n8n roda. O editor do n8n não passa por aqui (continua no endereço do servidor).
// Se o n8n mudar de servidor, troca-se só a variável ORIGEM e publica de novo: Meta e os outros não mudam.
export default {
  async fetch(pedido, env) {
    const url = new URL(pedido.url);
    if (!(url.pathname.startsWith('/webhook/') || url.pathname === '/healthz')) {
      return new Response('nada aqui', { status: 404 });
    }
    const destino = new URL(url.pathname + url.search, env.ORIGEM);
    return fetch(new Request(destino, pedido));
  },
};
