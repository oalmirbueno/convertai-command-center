/**
 * Teste A/B do Laboratório (nó `teste_ab`, ESPEC v4, 19/10/2026): o script que
 * a página do teste (/teste-ab-xxxx) roda no navegador do visitante, e o
 * script de conversão da página de obrigado.
 *
 * - Divisão: 2 a 5 variantes com pesos inteiros que somam 100. A variante
 *   sorteada fica fixa por visitante em localStorage ("ab:<teste>"), sempre
 *   dentro de try/catch (aba anônima ou bloqueio: sorteia de novo, sem quebrar).
 * - Visita e conversão vão para a função ab-contar (sendBeacon com text/plain,
 *   que não pede preflight de CORS; sem sendBeacon, XMLHttpRequest).
 * - Redireciona para a página da variante com utm_content=<variante>, que o
 *   formulário do site já repassa como origem do clique.
 *
 * O script sai em ES5 puro (var, function, sem crase, sem arrow, sem
 * Promise): roda no Safari 11 e no Chrome 64. Sem dependência externa. Os
 * valores entram por JSON.stringify com "<" escapado: nada fecha a tag
 * <script> nem injeta código.
 *
 * Puro: sem Deno, sem banco. O agente dos nós importa daqui.
 */

export const TESTE_ID = /^[a-z0-9][a-z0-9-]{2,62}$/;
export const VARIANTE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type VarianteDoTeste = { id: string; url: string; peso: number };

export type OpcoesDaDivisao = {
  testeId: string;
  variantes: VarianteDoTeste[];
  /** Endereço da função: https://<projeto>.supabase.co/functions/v1/ab-contar */
  endpoint: string;
};

export class ErroDaDivisao extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

function urlSegura(v: string, campo: string): string {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ErroDaDivisao("url_invalida", `${campo} precisa ser um endereço completo (https://...).`);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) {
    throw new ErroDaDivisao("url_invalida", `${campo} precisa começar com https://.`);
  }
  return u.toString();
}

/** Confere tudo antes de gerar (o script não confere de novo no navegador). */
export function conferirDivisao(o: OpcoesDaDivisao): OpcoesDaDivisao {
  if (!TESTE_ID.test(o.testeId)) throw new ErroDaDivisao("teste_invalido", "O id do teste só aceita letras minúsculas, números e hífen (3 a 63).");
  if (!Array.isArray(o.variantes) || o.variantes.length < 2 || o.variantes.length > 5) throw new ErroDaDivisao("variantes_invalidas", "O teste precisa de 2 a 5 variantes.");
  const vistos: Record<string, true> = {};
  let soma = 0;
  const variantes = o.variantes.map((v, i) => {
    if (!VARIANTE_ID.test(v.id)) throw new ErroDaDivisao("variante_invalida", `A variante ${i + 1} tem um id inválido (minúsculas, números, - e _).`);
    if (vistos[v.id]) throw new ErroDaDivisao("variante_repetida", `A variante "${v.id}" aparece duas vezes.`);
    vistos[v.id] = true;
    if (!Number.isInteger(v.peso) || v.peso < 1 || v.peso > 99) throw new ErroDaDivisao("peso_invalido", `O peso da variante "${v.id}" precisa ser um inteiro de 1 a 99.`);
    soma += v.peso;
    return { id: v.id, url: urlSegura(v.url, `O endereço da variante "${v.id}"`), peso: v.peso };
  });
  if (soma !== 100) throw new ErroDaDivisao("soma_diferente_de_100", `A divisão precisa somar 100% (está em ${soma}%).`);
  return { testeId: o.testeId, variantes, endpoint: urlSegura(o.endpoint, "O endereço do contador") };
}

/** JSON dentro de <script>: "<", ">" e "&" escapados, mais os separadores de linha do JS antigo. */
export function jsonNoScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Trecho comum: guardar/ler a variante e enviar a contagem. ES5. */
function nucleo(testeId: string, endpoint: string): string {
  return [
    "var T=" + jsonNoScript(testeId) + ",E=" + jsonNoScript(endpoint) + ",K='ab:'+T;",
    "function ler(){try{return window.localStorage.getItem(K);}catch(e){return null;}}",
    "function guardar(v){try{window.localStorage.setItem(K,v);}catch(e){}}",
    "function contar(tipo,v){var c=JSON.stringify({teste_id:T,variante:v,tipo:tipo});",
    "try{if(navigator.sendBeacon&&navigator.sendBeacon(E,new Blob([c],{type:'text/plain'})))return true;}catch(e){}",
    "try{var x=new XMLHttpRequest();x.open('POST',E,true);x.setRequestHeader('Content-Type','text/plain');x.send(c);}catch(e){}",
    "return false;}",
  ].join("");
}

/**
 * Script da página do teste: sorteia (ou relê) a variante, conta a visita e
 * redireciona. Devolve só o JavaScript; quem monta a página põe dentro de
 * <script>...</script>. Lança ErroDaDivisao se a divisão estiver errada.
 */
export function gerarScriptDeDivisao(opcoes: OpcoesDaDivisao): string {
  const o = conferirDivisao(opcoes);
  const lista = o.variantes.map((v) => ({ id: v.id, url: v.url, peso: v.peso }));
  return [
    "(function(){",
    nucleo(o.testeId, o.endpoint),
    "var V=" + jsonNoScript(lista) + ";",
    "function achar(id){for(var i=0;i<V.length;i++){if(V[i].id===id)return V[i];}return null;}",
    "function sortear(){var n=Math.random()*100,a=0;for(var i=0;i<V.length;i++){a+=V[i].peso;if(n<a)return V[i];}return V[V.length-1];}",
    "var v=achar(ler());if(!v){v=sortear();guardar(v.id);}",
    "var foi=contar('visita',v.id);",
    "var u=v.url,h='',i=u.indexOf('#');if(i>=0){h=u.slice(i);u=u.slice(0,i);}",
    "var q=window.location.search?window.location.search.slice(1).split('&'):[],extra=[];",
    "for(var j=0;j<q.length;j++){if(q[j]&&q[j].indexOf('utm_content=')!==0)extra.push(q[j]);}",
    "extra.push('utm_content='+encodeURIComponent(v.id));",
    "u+=(u.indexOf('?')>=0?'&':'?')+extra.join('&')+h;",
    "function ir(){window.location.replace(u);}",
    // Sem sendBeacon o XHR precisa de um instante antes de trocar de página.
    "if(foi){ir();}else{setTimeout(ir,300);}",
    "})();",
  ].join("");
}

/**
 * Script da página de obrigado (ou do clique que vale como conversão): conta
 * uma conversão para a variante guardada; visitante que não passou pelo teste
 * não conta. Uma conversão por visitante (marca "ab:<teste>:ok").
 */
export function gerarScriptDeConversao(opcoes: { testeId: string; endpoint: string }): string {
  if (!TESTE_ID.test(opcoes.testeId)) throw new ErroDaDivisao("teste_invalido", "O id do teste só aceita letras minúsculas, números e hífen (3 a 63).");
  const endpoint = urlSegura(opcoes.endpoint, "O endereço do contador");
  return [
    "(function(){",
    nucleo(opcoes.testeId, endpoint),
    "var v=ler();if(!v)return;",
    "try{if(window.localStorage.getItem(K+':ok'))return;window.localStorage.setItem(K+':ok','1');}catch(e){}",
    "contar('conversao',v);",
    "})();",
  ].join("");
}
