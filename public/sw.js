/*
 * Service worker do painel (09/11/2026; dono: "o PWA funcionando nos Android").
 *
 * Por que existe: sem ele, Chrome antigo e Samsung Internet não oferecem "Instalar app" (só um atalho), e o app
 * instalado depende da rede para abrir: sem sinal, aparecia a página de erro do navegador.
 *
 * O que faz, e só isto:
 * 1. Página (navegação): rede primeiro. Se a rede falhar ou passar de 4 s, entra a última casca guardada. Com rede,
 *    nada muda em relação a antes: a versão nova chega na hora e o vigia de versão (src/lib/appRefresh.ts) segue valendo.
 * 2. /assets/* (arquivo com hash no nome, que nunca muda): guardado primeiro, rede depois. HTML nunca é guardado no
 *    lugar de um pedaço (15/10/2026: publicação pela metade devolvia o index.html como .js).
 * 3. Todo o resto (banco, /version.json, outros sites) passa direto, sem tocar.
 *
 * Escrito em JavaScript antigo de propósito: este arquivo não passa pelo build e o piso é Chrome 64.
 * Desligar em emergência: publicar este arquivo só com
 *   self.addEventListener("install", function () { self.skipWaiting(); });
 *   self.addEventListener("activate", function () { self.registration.unregister(); });
 * A recarga forçada do painel (hardRefresh) também desregistra e limpa os caches.
 */
var CACHE = "painel-v1";
var CASCA = "/__casca__";
var ESPERA_DA_REDE_MS = 4000;
var MAX_PEDACOS = 450;

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function ehHtml(resposta) {
  return (resposta.headers.get("content-type") || "").indexOf("text/html") >= 0;
}

/** Rota do painel (sem extensão no fim): /mesa, /clientes. Arquivo (.html, .json, .png) não é. */
function ehRota(caminho) {
  return !/\.[a-z0-9]+$/i.test(caminho);
}

function guardarCasca(resposta) {
  if (!resposta || !resposta.ok || resposta.type !== "basic" || !ehHtml(resposta)) return;
  var copia = resposta.clone();
  caches.open(CACHE).then(function (cache) { return cache.put(CASCA, copia); }).catch(function () {});
}

function navegar(pedido) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(CASCA).then(function (guardada) {
      var daRede = fetch(pedido).then(function (resposta) {
        guardarCasca(resposta);
        return resposta;
      });
      // Sem casca guardada não há plano B: vale o que a rede disser.
      if (!guardada) return daRede;
      return new Promise(function (resolver) {
        var decidido = false;
        var relogio = setTimeout(function () {
          if (decidido) return;
          decidido = true;
          resolver(guardada);
        }, ESPERA_DA_REDE_MS);
        daRede.then(function (resposta) {
          if (decidido) return;
          decidido = true;
          clearTimeout(relogio);
          // Erro do servidor (5xx) com casca guardada: abre o painel em vez da página de erro.
          resolver(resposta.status >= 500 ? guardada : resposta);
        }, function () {
          if (decidido) return;
          decidido = true;
          clearTimeout(relogio);
          resolver(guardada);
        });
      });
    });
  });
}

function aparar(cache) {
  return cache.keys().then(function (chaves) {
    var sobra = chaves.length - MAX_PEDACOS;
    if (sobra <= 0) return;
    // As chaves vêm na ordem em que entraram: saem as mais antigas (a casca fica).
    var antigas = chaves.filter(function (c) { return c.url.indexOf(CASCA) < 0; }).slice(0, sobra);
    return Promise.all(antigas.map(function (c) { return cache.delete(c); }));
  });
}

function pedaco(pedido) {
  return caches.open(CACHE).then(function (cache) {
    // ignoreVary: a hospedagem manda Vary e o mesmo arquivo com hash deixaria de casar entre um pedido e outro.
    return cache.match(pedido, { ignoreVary: true }).then(function (guardado) {
      if (guardado) return guardado;
      return fetch(pedido).then(function (resposta) {
        if (resposta && resposta.status === 200 && resposta.type === "basic" && !ehHtml(resposta)) {
          var copia = resposta.clone();
          cache.put(pedido, copia).then(function () { return aparar(cache); }).catch(function () {});
        }
        return resposta;
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var pedido = event.request;
  if (pedido.method !== "GET") return;
  var url;
  try { url = new URL(pedido.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  if (pedido.mode === "navigate") {
    // Só a página de cima e só rota do painel: quadro (iframe) e arquivo .html seguem direto pela rede.
    var destino = pedido.destination;
    if ((destino && destino !== "document") || !ehRota(url.pathname)) return;
    event.respondWith(navegar(pedido));
    return;
  }
  if (url.pathname.indexOf("/assets/") === 0 && !pedido.headers.get("range")) {
    event.respondWith(pedaco(pedido));
  }
});
