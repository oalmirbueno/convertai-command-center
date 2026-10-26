/**
 * Roteiro que roda DENTRO do Ego Lite (`ego-browser nodejs`), no perfil e nas sessões do dono
 * (navegador do PC, 26/10/2026). JavaScript puro (o runtime do Ego não lê TypeScript); o worker
 * (workers/computador/ego.ts) escreve um .mjs pequeno que importa este arquivo e chama `rodar`.
 *
 * Um TaskSpace por pedido (nome único), fechado no fim com finish({ keep: [] }): o Ego não retoma
 * espaço já fechado, e as abas do dono nunca são tocadas.
 *
 * Travas (as mesmas regras do MCP, conferidas de novo aqui no alvo REAL):
 * - navegar só para URL permitida (o worker manda a lista e os padrões);
 * - clique: lê o rótulo do alvo na página; se publica/envia/paga/salva/apaga/ativa/pausa e o passo
 *   não veio autorizado pelo servidor, para sem clicar ("precisa_aprovacao");
 * - digitar: nunca em campo de senha; fora de busca só autorizado;
 * - página de login no meio = "sessao_expirada": para, sem digitar nada;
 * - um print por passo que muda a tela; texto lido cortado.
 */

export class ParadaDoEgo extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Rótulos (texto visível) do snapshot que contêm o texto pedido, mais o próprio texto. */
export function rotulosDoTexto(snapshot, alvo) {
  const procurado = String(alvo || "").toLowerCase().trim();
  const achados = [String(alvo || "")];
  if (!procurado) return achados;
  for (const linha of String(snapshot || "").split("\n")) {
    const m = linha.match(/"([^"]*)"/);
    if (m && m[1].toLowerCase().indexOf(procurado) >= 0) achados.push(m[1]);
  }
  return achados;
}

/** Rótulo do elemento de um seletor CSS (null quando o seletor não é CSS simples ou não acha nada). */
export async function rotuloDoSeletor(page, seletor) {
  const s = String(seletor || "");
  if (!s || /^(text=|loc=|xpath=|@|ref=)/i.test(s)) return null;
  try {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const partes = [el.innerText, el.getAttribute("aria-label"), el.getAttribute("title"), el.value, el.getAttribute("type") === "submit" ? "enviar" : ""];
      return partes.filter(Boolean).join(" ").slice(0, 300);
    }, s);
  } catch {
    return null;
  }
}

const re = (fonte) => new RegExp(fonte, "i");

/** Uma URL passa nas regras que o worker mandou. */
export function urlPermitida(url, regras) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (re(regras.hostsProibidos).test(host)) return false;
  if (!regras.dominios.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  if (re(regras.caminhoProibido).test(`${u.pathname}${u.search}`)) return false;
  return true;
}

async function pararSeLogin(page, regras) {
  const url = String((await page.url().catch(() => "")) || "");
  const temSenha = await page.evaluate(() => !!document.querySelector("input[type=password]")).catch(() => false);
  if (re(regras.urlDeLogin).test(url) || temSenha) {
    throw new ParadaDoEgo("sessao_expirada", `O site pediu login (${url.slice(0, 160)}). A sessão do dono no Ego caiu: o dono precisa entrar de novo nesse site no Ego. Nada foi digitado.`);
  }
}

/**
 * Roda os passos. ctx: { taskSpace, dirSaida, nomeDoEspaco }. pedido: { passos, regras, limiteTexto }.
 * Nunca lança: devolve { passos, prints, parou, erro, url_final, titulo, texto_final }.
 */
export async function rodar(ctx, pedido) {
  const regras = pedido.regras;
  const limite = Number(pedido.limiteTexto) || 8000;
  const out = { passos: [], prints: [], parou: null, erro: null, url_final: null, titulo: null, texto_final: null, espaco: ctx.nomeDoEspaco };
  let task = null;
  let page = null;
  const print = async (legenda) => {
    if (out.prints.length >= 14) return;
    const caminho = `${ctx.dirSaida}/print-${String(out.prints.length + 1).padStart(2, "0")}.png`;
    try {
      await page.screenshot({ path: caminho });
      out.prints.push({ caminho, legenda: String(legenda).slice(0, 200) });
    } catch {
      // Sem print, o passo continua valendo; o texto lido é a evidência.
    }
  };
  try {
    task = await ctx.taskSpace(ctx.nomeDoEspaco);
    page = task.page("p1");
    for (let i = 0; i < pedido.passos.length; i++) {
      const p = pedido.passos[i];
      const r = { passo: i + 1, acao: p.acao, ok: false };
      out.passos.push(r);
      if (p.acao === "navegar") {
        if (!urlPermitida(p.url, regras)) throw new ParadaDoEgo("fora_da_lista", `O endereço ${String(p.url).slice(0, 160)} está fora da lista do navegador do PC.`);
        try {
          await page.goto(p.url);
        } catch (e) {
          // Página pesada (gerenciador de anúncios): a navegação já foi feita, só o "load" demorou. Segue.
          if (!/committed/i.test(String((e && e.message) || e))) throw e;
          r.lenta = true;
        }
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
        // Redirecionamento para fora da lista também para.
        const atual = String(await page.url());
        if (!urlPermitida(atual, regras) && !re(regras.urlDeLogin).test(atual)) throw new ParadaDoEgo("fora_da_lista", `A página foi para ${atual.slice(0, 160)}, fora da lista. Parei.`);
        await pararSeLogin(page, regras);
        await print(`Abri ${atual.slice(0, 150)}`);
      } else if (p.acao === "ler") {
        const s = await page.snapshot(p.inteira ? { scope: "full_page" } : undefined);
        r.texto = String(s || "").slice(0, limite);
      } else if (p.acao === "capturar") {
        await print(`Tela no passo ${i + 1}`);
      } else if (p.acao === "clicar") {
        const rotulos = p.texto ? rotulosDoTexto(await page.snapshot(), p.texto) : [];
        const doSeletor = p.seletor ? await rotuloDoSeletor(page, p.seletor) : null;
        if (p.seletor && doSeletor === null && !p.autorizado) {
          throw new ParadaDoEgo("precisa_aprovacao", `Não consegui ler o que o seletor ${p.seletor.slice(0, 80)} clica. Clique sem rótulo claro só com aprovação. Nada foi clicado.`);
        }
        const sensivel = rotulos.concat(doSeletor ? [doSeletor] : []).find((t) => re(regras.alvoSensivel).test(t));
        if (sensivel && !p.autorizado) {
          throw new ParadaDoEgo("precisa_aprovacao", `"${sensivel.slice(0, 80)}" muda a conta (publica, envia, paga, salva, apaga, ativa ou pausa): só com uma aprovação aprovada (aprovacao_id). Nada foi clicado.`);
        }
        const alvo = p.texto ? `text=${p.texto}` : p.seletor;
        const recibo = await page.click(alvo, { label: `clicar ${String(p.texto || "alvo").slice(0, 30)}` });
        r.rotulo = (sensivel || rotulos[1] || doSeletor || p.texto || "").slice(0, 160);
        if (recibo && recibo.popups && recibo.popups.length) r.popup = true;
        await page.waitForLoadState().catch(() => undefined);
        await pararSeLogin(page, regras);
        await print(`Cliquei em ${r.rotulo || "alvo"}`);
      } else if (p.acao === "digitar") {
        const busca = re(regras.campoDeBusca).test(`${p.campo || ""} ${p.seletor || ""}`);
        if (!busca && !p.autorizado) throw new ParadaDoEgo("precisa_aprovacao", "Digitar fora de um campo de busca muda a conta: só com uma aprovação aprovada. Nada foi digitado.");
        const alvo = p.seletor || `loc=role:textbox[name*="${String(p.campo).replace(/"/g, "")}"]`;
        await page.focus(alvo);
        const tipo = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute("type")) || "").catch(() => "");
        if (/password/i.test(String(tipo))) throw new ParadaDoEgo("campo_de_senha", "O campo é de senha. O agente nunca digita senha. Nada foi digitado.");
        await page.fill(alvo, p.valor);
        if (p.enviar) {
          if (!busca && !p.autorizado) throw new ParadaDoEgo("precisa_aprovacao", "Enviar o formulário só com aprovação.");
          await page.press(alvo, "Enter");
          await page.waitForLoadState().catch(() => undefined);
        }
        await pararSeLogin(page, regras);
        await print(`Digitei em ${String(p.campo || p.seletor).slice(0, 60)}`);
      } else if (p.acao === "rolar") {
        const info = await page.info().catch(() => ({ w: 1280, h: 720 }));
        await page.mouse.move(Math.round((info.w || 1280) / 2), Math.round((info.h || 720) / 2), { label: "rolar a página" });
        await page.mouse.wheel(0, Number(p.dy) || 800, { label: "rolar a página" });
        await print(`Rolei ${p.dy} px`);
      } else if (p.acao === "esperar") {
        await page.waitForTimeout(Math.min(10_000, Number(p.ms) || 1500));
      } else {
        throw new ParadaDoEgo("acao_desconhecida", `Ação desconhecida: ${p.acao}`);
      }
      r.ok = true;
      r.url = String(await page.url().catch(() => "")).slice(0, 500);
    }
    const ultimo = pedido.passos[pedido.passos.length - 1];
    if (!ultimo || ultimo.acao !== "ler") out.texto_final = String((await page.snapshot().catch(() => "")) || "").slice(0, limite);
    // Print do fim sempre (o da navegação pode ter saído com a página ainda carregando).
    await print("Tela no fim");
  } catch (e) {
    if (e instanceof ParadaDoEgo) out.parou = { codigo: e.codigo, motivo: e.message };
    else out.erro = String((e && e.message) || e).slice(0, 400);
    if (page) await print("Onde parei");
  } finally {
    if (page) {
      out.url_final = String((await page.url().catch(() => "")) || "").slice(0, 500) || null;
      out.titulo = String((await page.title().catch(() => "")) || "").slice(0, 300) || null;
    }
    if (task) await task.finish({ keep: [] }).catch(() => undefined);
  }
  return out;
}
