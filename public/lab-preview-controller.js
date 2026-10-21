/* Controlador do visor do Laboratório. Nenhum script da página gerada é executado. */
(function () {
  "use strict";

  function enviar(tipo, caminho) {
    window.parent.postMessage({ tipo: tipo, caminho: caminho }, "*");
  }

  function linkDoEvento(evento) {
    var alvo = evento.target;
    return alvo && alvo.closest ? alvo.closest("a[data-lab-destino],area[data-lab-destino]") : null;
  }

  function ativar(evento, link) {
    evento.preventDefault();
    evento.stopImmediatePropagation();
    var destino = link.getAttribute("data-lab-destino") || "";
    if (destino.charAt(0) === "#") {
      try {
        var secao = document.getElementById(decodeURIComponent(destino.slice(1)));
        if (secao) secao.scrollIntoView();
      } catch (_) { /* Uma âncora inválida não navega para fora da prévia. */ }
      return;
    }
    enviar("lab-previa-navegar", destino);
  }

  document.addEventListener("click", function (evento) {
    var link = linkDoEvento(evento);
    if (link) ativar(evento, link);
  }, true);

  document.addEventListener("keydown", function (evento) {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    var link = linkDoEvento(evento);
    if (link) ativar(evento, link);
  }, true);

  document.addEventListener("submit", function (evento) {
    evento.preventDefault();
    evento.stopImmediatePropagation();
    enviar("lab-previa-formulario-bloqueado", "");
  }, true);

  HTMLFormElement.prototype.submit = function () {
    enviar("lab-previa-formulario-bloqueado", "");
  };
})();
