/**
 * Cliente IMAP e SMTP enxuto para o correio do painel (19/11/2026). Fala com o Migadu (imap.migadu.com
 * na 993 e smtp.migadu.com na 465, as duas com TLS), mas serve para qualquer servidor padrão.
 *
 * A conexão chega de fora (`Conectar`), para o teste rodar com um servidor falso. Os bytes viram texto
 * "latin1" (um caractere por byte): assim o tamanho dos literais IMAP ({123}) bate com o que foi lido.
 * Sem import de rede: só Deno.connectTls quando a função roda de verdade.
 */
import { cabecalhoCodificado, cabecalhoLegivel, corpoBase64, lerCabecalhos, lerCorpo, remetenteLegivel } from "./mime.ts";
import type { AdaptadorDeCorreio, CaixaAberta, Envio, Mensagem, Pasta, ResumoDaMensagem } from "./adaptador.ts";

export interface Conexao {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
}
export type Conectar = (host: string, porta: number) => Promise<Conexao>;

export const conectarTls: Conectar = async (host, porta) => {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  return await d.connectTls({ hostname: host, port: porta });
};

const paraLatin1 = (b: Uint8Array, n: number) => {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[i]);
  return s;
};
const deLatin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};
/** Texto que veio em bytes UTF-8 crus (cabeçalho sem codificar) volta a ser UTF-8. */
const utf8DeLatin1 = (s: string) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(deLatin1(s));
  } catch {
    return s;
  }
};

export class ErroDoCorreio extends Error {}

/** Lê linhas e literais de uma conexão, com prazo. */
class Leitor {
  private buffer = "";
  constructor(private conexao: Conexao, private prazoMs = 20000) {}
  private async mais(): Promise<void> {
    const pedaco = new Uint8Array(32 * 1024);
    let timer: number | undefined;
    const prazo = new Promise<null>((_, rej) => {
      timer = setTimeout(() => rej(new ErroDoCorreio("O servidor de e-mail demorou demais para responder.")), this.prazoMs) as unknown as number;
    });
    try {
      const n = await Promise.race([this.conexao.read(pedaco), prazo]);
      if (n === null || n === 0) throw new ErroDoCorreio("O servidor de e-mail fechou a conexão.");
      this.buffer += paraLatin1(pedaco, n);
    } finally {
      clearTimeout(timer);
    }
  }
  async linha(): Promise<string> {
    for (;;) {
      const i = this.buffer.indexOf("\r\n");
      if (i >= 0) {
        const l = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 2);
        return l;
      }
      if (this.buffer.length > 2_000_000) throw new ErroDoCorreio("Resposta grande demais do servidor de e-mail.");
      await this.mais();
    }
  }
  async bytes(n: number): Promise<string> {
    if (n > 30_000_000) throw new ErroDoCorreio("Mensagem grande demais para abrir no painel.");
    while (this.buffer.length < n) await this.mais();
    const s = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return s;
  }
}

/** Uma resposta IMAP: o texto da linha (literais trocados por \x00N\x00) e os literais em ordem. */
export interface Item {
  texto: string;
  literais: string[];
}

export const aspas = (s: string) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** Texto para busca IMAP sem CHARSET: sem acento e sem aspas. */
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim();

export class Imap {
  private leitor: Leitor;
  private n = 0;
  private constructor(private conexao: Conexao) {
    this.leitor = new Leitor(conexao);
  }
  static async abrir(conectar: Conectar, host: string, porta: number, usuario: string, senha: string): Promise<Imap> {
    const c = new Imap(await conectar(host, porta));
    const saudacao = await c.leitor.linha();
    if (!/^\* (OK|PREAUTH)/i.test(saudacao)) {
      c.fechar();
      throw new ErroDoCorreio("O servidor de e-mail recusou a conexão.");
    }
    try {
      await c.comando(`LOGIN ${aspas(usuario)} ${aspas(senha)}`);
    } catch {
      c.fechar();
      throw new ErroDoCorreio("O provedor recusou a senha desta caixa. Guarde a senha de novo.");
    }
    return c;
  }
  private async escrever(t: string) {
    await this.conexao.write(deLatin1(t));
  }
  private async item(primeira: string): Promise<Item> {
    let texto = "";
    const literais: string[] = [];
    let linha = primeira;
    for (;;) {
      const m = /\{(\d+)\}$/.exec(linha);
      if (!m) {
        texto += linha;
        return { texto, literais };
      }
      texto += linha.slice(0, m.index) + `\x00${literais.length}\x00`;
      literais.push(await this.leitor.bytes(Number(m[1])));
      linha = await this.leitor.linha();
    }
  }
  /** Manda um comando e junta as respostas até a linha da etiqueta. NO ou BAD viram erro. */
  async comando(cmd: string, literal?: string): Promise<Item[]> {
    const tag = `A${++this.n}`;
    const itens: Item[] = [];
    if (literal !== undefined) {
      await this.escrever(`${tag} ${cmd} {${literal.length}}\r\n`);
      for (;;) {
        const l = await this.leitor.linha();
        if (l.startsWith("+")) break;
        if (l.startsWith(`${tag} `)) throw new ErroDoCorreio(`O servidor recusou: ${l.slice(tag.length + 1, 200)}`);
        itens.push(await this.item(l));
      }
      await this.escrever(literal + "\r\n");
    } else {
      await this.escrever(`${tag} ${cmd}\r\n`);
    }
    for (;;) {
      const l = await this.leitor.linha();
      if (l.startsWith(`${tag} `)) {
        const resto = l.slice(tag.length + 1);
        if (/^OK/i.test(resto)) return itens;
        if (/UNAVAILABLE|INUSE|TRYLATER/i.test(resto)) throw new ErroDoCorreio("Esta mensagem ainda está chegando na caixa. Tente de novo em instantes.");
        throw new ErroDoCorreio(`O servidor recusou: ${resto.slice(0, 200)}`);
      }
      itens.push(await this.item(l));
    }
  }
  fechar() {
    try {
      void this.escrever("ZZ LOGOUT\r\n").catch(() => undefined);
      this.conexao.close();
    } catch {
      /* já fechada */
    }
  }
}

export interface PastaListada {
  nome: string;
  marcas: string[];
}

/** `* LIST (\HasNoChildren \Sent) "/" "Sent"` vira { nome: "Sent", marcas: ["\\Sent", ...] }. */
export function lerList(itens: Item[]): PastaListada[] {
  const out: PastaListada[] = [];
  for (const it of itens) {
    const m = /^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i.exec(it.texto);
    if (!m) continue;
    let nome = m[2].trim();
    const lit = /^\x00(\d+)\x00$/.exec(nome);
    if (lit) nome = it.literais[Number(lit[1])];
    else if (nome.startsWith('"')) nome = nome.slice(1, -1).replace(/\\(["\\])/g, "$1");
    const marcas = m[1].split(/\s+/).filter(Boolean);
    if (!marcas.some((x) => /\\Noselect|\\NonExistent/i.test(x))) out.push({ nome, marcas });
  }
  return out;
}

export interface FetchLido {
  uid: string;
  flags: string[];
  data: string | null;
  tamanho: number;
  literal: string;
}

/** As linhas `* n FETCH (UID 12 FLAGS (\Seen) INTERNALDATE "..." RFC822.SIZE 99 BODY[...] {123}` lidas. */
export function lerFetch(itens: Item[]): FetchLido[] {
  const out: FetchLido[] = [];
  for (const it of itens) {
    if (!/^\* \d+ FETCH /i.test(it.texto)) continue;
    const uid = (/\bUID (\d+)/i.exec(it.texto) || [])[1];
    if (!uid) continue;
    const flags = ((/\bFLAGS \(([^)]*)\)/i.exec(it.texto) || [])[1] || "").split(/\s+/).filter(Boolean);
    const data = (/\bINTERNALDATE "([^"]+)"/i.exec(it.texto) || [])[1] || null;
    const tamanho = Number((/\bRFC822\.SIZE (\d+)/i.exec(it.texto) || [])[1] || 0);
    out.push({ uid, flags, data, tamanho, literal: it.literais[0] || "" });
  }
  return out;
}

const dataIso = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const t = Date.parse(v.replace(/^(\d{1,2})-(\w{3})-(\d{4})/, "$1 $2 $3"));
  return isFinite(t) ? new Date(t).toISOString() : null;
};

/** Mensagem automática (lista, boletim, aviso de sistema): ninguém espera resposta. */
export function automatica(c: Record<string, string>): boolean {
  const auto = String(c["auto-submitted"] || "").toLowerCase();
  const prec = String(c["precedence"] || "").toLowerCase();
  const de = String(c["from"] || "").toLowerCase();
  return !!c["list-id"] || !!c["list-unsubscribe"] || (!!auto && auto !== "no") || /bulk|list|junk/.test(prec) || /no-?reply|nao-?responda|naoresponda|mailer-daemon|postmaster|notifica|notify|notificat|alert|newsletter|news@|marketing@|bounce|info@.*(mail|news)/.test(de);
}

export function resumoDoFetch(f: FetchLido, pasta: string, enviados: boolean): ResumoDaMensagem {
  const c = lerCabecalhos(utf8DeLatin1(f.literal));
  const lida = f.flags.some((x) => /\\Seen/i.test(x));
  const auto = automatica(c);
  const tipo = String(c["content-type"] || "").toLowerCase();
  return {
    id: f.uid,
    mensagem_id: /^<[^<>\s]{3,250}>$/.test(String(c["message-id"] || "").trim()) ? String(c["message-id"]).trim() : null,
    de: remetenteLegivel(c["from"] || ""),
    para: cabecalhoLegivel(c["to"] || "").slice(0, 300),
    assunto: cabecalhoLegivel(c["subject"] || "(sem assunto)").slice(0, 300),
    resumo: "",
    recebida_em: dataIso(c["date"]) || dataIso(f.data),
    lida,
    tem_anexo: /multipart\/(mixed|related)/.test(tipo),
    automatica: auto,
    aguardando: enviados ? "outro" : !auto && !lida ? "voce" : null,
    arquivada: /arquiv|archive/i.test(pasta),
  };
}

const POR_PAGINA = 30;

export interface ServidoresDoCorreio {
  imap: { host: string; porta: number };
  smtp: { host: string; porta: number };
}

/** O adaptador do contrato do correio sobre IMAP e SMTP. */
export function adaptadorImap(servidores: ServidoresDoCorreio, conectar: Conectar = conectarTls): AdaptadorDeCorreio {
  const umaVez = async <T>(caixa: CaixaAberta, fazer: (imap: Imap) => Promise<T>): Promise<T> => {
    const imap = await Imap.abrir(conectar, servidores.imap.host, servidores.imap.porta, caixa.endereco, caixa.segredo);
    try {
      return await fazer(imap);
    } finally {
      imap.fechar();
    }
  };
  // Conexão que caiu ou demorou (rede, servidor ocupado) tenta mais uma vez. Senha errada não repete.
  const com = async <T>(caixa: CaixaAberta, fazer: (imap: Imap) => Promise<T>): Promise<T> => {
    try {
      return await umaVez(caixa, fazer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const deRede = !(e instanceof ErroDoCorreio) || /fechou a conexão|demorou demais|recusou a conexão/.test(msg);
      if (!deRede) throw e;
      return await umaVez(caixa, fazer);
    }
  };
  const pastaDeEnviados = async (imap: Imap): Promise<string> => {
    const lista = lerList(await imap.comando(`LIST "" "*"`));
    const sent = lista.find((p) => p.marcas.some((m) => /\\Sent/i.test(m))) || lista.find((p) => /^(sent|enviad)/i.test(p.nome));
    return sent ? sent.nome : "Sent";
  };
  return {
    async pastas(caixa): Promise<Pasta[]> {
      return com(caixa, async (imap) => {
        const lista = lerList(await imap.comando(`LIST "" "*"`)).slice(0, 30);
        const saida: Pasta[] = [];
        for (const p of lista) {
          let nao = 0;
          try {
            const st = await imap.comando(`STATUS ${aspas(p.nome)} (UNSEEN)`);
            nao = Number((/UNSEEN (\d+)/i.exec(st.map((x) => x.texto).join(" ")) || [])[1] || 0);
          } catch {
            nao = 0;
          }
          saida.push({ id: p.nome, nome: p.nome === "INBOX" ? "Entrada" : p.nome, nao_lidas: nao });
        }
        return saida;
      });
    },
    async listar(caixa, p): Promise<ResumoDaMensagem[]> {
      return com(caixa, async (imap) => {
        await imap.comando(`EXAMINE ${aspas(p.pasta)}`);
        const busca = p.busca ? semAcento(p.busca) : "";
        const achados = await imap.comando(busca ? `UID SEARCH TEXT ${aspas(busca)}` : "UID SEARCH ALL");
        const uids = achados
          .map((x) => /^\* SEARCH ?(.*)$/i.exec(x.texto))
          .filter(Boolean)
          .flatMap((m) => String((m as RegExpExecArray)[1]).trim().split(/\s+/))
          .filter((x) => /^\d+$/.test(x))
          .map(Number)
          .sort((a, b) => b - a);
        const pagina = uids.slice((p.pagina - 1) * POR_PAGINA, p.pagina * POR_PAGINA);
        if (!pagina.length) return [];
        const campos = "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID CONTENT-TYPE LIST-ID LIST-UNSUBSCRIBE AUTO-SUBMITTED PRECEDENCE)])";
        let itens: Item[];
        try {
          itens = await imap.comando(`UID FETCH ${pagina.join(",")} ${campos}`);
        } catch {
          // Uma mensagem que o servidor não entrega agora (chegando, sendo copiada) derruba o lote todo:
          // pede uma por uma e mostra as que vierem.
          itens = [];
          for (const uid of pagina) {
            try {
              itens.push(...(await imap.comando(`UID FETCH ${uid} ${campos}`)));
            } catch {
              /* esta fica para a próxima vez */
            }
          }
        }
        const enviados = /sent|enviad/i.test(p.pasta);
        return lerFetch(itens)
          .map((f) => resumoDoFetch(f, p.pasta, enviados))
          .sort((a, b) => Number(b.id) - Number(a.id));
      });
    },
    async ler(caixa, p): Promise<Mensagem> {
      if (!/^\d{1,12}$/.test(p.id)) throw new ErroDoCorreio("Mensagem inválida.");
      return com(caixa, async (imap) => {
        await imap.comando(`SELECT ${aspas(p.pasta)}`);
        const [f] = lerFetch(await imap.comando(`UID FETCH ${p.id} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])`));
        if (!f) throw new ErroDoCorreio("Essa mensagem não está mais na pasta.");
        const resumo = resumoDoFetch({ ...f, literal: f.literal.split(/\r?\n\r?\n/)[0] }, p.pasta, /sent|enviad/i.test(p.pasta));
        const corpo = lerCorpo(f.literal);
        if (!resumo.lida) await imap.comando(`UID STORE ${p.id} +FLAGS.SILENT (\\Seen)`).catch(() => []);
        return { ...resumo, lida: true, resumo: corpo.texto.slice(0, 200), texto: corpo.texto, html: corpo.conteudo_html, anexos: corpo.anexos, tem_anexo: corpo.anexos.length > 0 };
      });
    },
    async enviar(caixa, envio: Envio): Promise<{ id: string }> {
      const id = `<${crypto.randomUUID()}@${caixa.dominio || "aceleriq.com"}>`;
      const mensagem = [
        `From: ${caixa.endereco}`,
        `To: ${envio.para.join(", ")}`,
        `Subject: ${cabecalhoCodificado(envio.assunto)}`,
        `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
        `Message-ID: ${id}`,
        ...(envio.em_resposta_a ? [`In-Reply-To: ${envio.em_resposta_a}`, `References: ${envio.em_resposta_a}`] : []),
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        corpoBase64(envio.texto),
      ].join("\r\n");
      await enviarSmtp(conectar, servidores.smtp.host, servidores.smtp.porta, { usuario: caixa.endereco, senha: caixa.segredo, de: caixa.endereco, para: envio.para, mensagem });
      // Uma cópia em Enviados (o SMTP não guarda sozinho). Se falhar, o e-mail já foi.
      // Sem repetir: uma segunda tentativa poderia guardar a cópia duas vezes.
      await umaVez(caixa, async (imap) => {
        const pasta = await pastaDeEnviados(imap);
        await imap.comando(`APPEND ${aspas(pasta)} (\\Seen)`, mensagem);
      }).catch(() => undefined);
      return { id };
    },
  };
}

/** "\0usuário\0senha" em base64, com a senha em UTF-8. */
export function authPlain(usuario: string, senha: string): string {
  const u = new TextEncoder().encode(usuario);
  const s = new TextEncoder().encode(senha);
  const tudo = new Uint8Array(2 + u.length + s.length);
  tudo.set(u, 1);
  tudo.set(s, 2 + u.length);
  let bin = "";
  for (const b of tudo) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** SMTP com TLS direto (465): EHLO, AUTH PLAIN, MAIL FROM, RCPT TO e DATA. */
export async function enviarSmtp(conectar: Conectar, host: string, porta: number, p: { usuario: string; senha: string; de: string; para: string[]; mensagem: string }): Promise<void> {
  const conexao = await conectar(host, porta);
  const leitor = new Leitor(conexao);
  const escrever = (t: string) => conexao.write(deLatin1(t));
  const resposta = async (esperado: RegExp, etapa: string) => {
    let l = await leitor.linha();
    while (/^\d{3}-/.test(l)) l = await leitor.linha();
    if (!esperado.test(l)) throw new ErroDoCorreio(etapa === "auth" ? "O provedor recusou a senha desta caixa para enviar." : `O servidor de envio recusou (${etapa}): ${l.slice(0, 160)}`);
  };
  try {
    await resposta(/^220/, "saudacao");
    await escrever("EHLO painel.aceleriq.com\r\n");
    await resposta(/^250/, "ehlo");
    await escrever(`AUTH PLAIN ${authPlain(p.usuario, p.senha)}\r\n`);
    await resposta(/^235/, "auth");
    await escrever(`MAIL FROM:<${p.de}>\r\n`);
    await resposta(/^250/, "remetente");
    for (const d of p.para) {
      await escrever(`RCPT TO:<${d}>\r\n`);
      await resposta(/^25[01]/, `destinatário ${d}`);
    }
    await escrever("DATA\r\n");
    await resposta(/^354/, "data");
    const corpo = p.mensagem.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    await escrever(corpo + "\r\n.\r\n");
    await resposta(/^250/, "envio");
    await escrever("QUIT\r\n").catch(() => 0);
  } finally {
    try {
      conexao.close();
    } catch {
      /* já fechada */
    }
  }
}
