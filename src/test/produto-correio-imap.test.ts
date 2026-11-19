import { describe, expect, it } from "vitest";
import { adaptadorImap, authPlain, lerList, type Conexao } from "../../supabase/functions/produto-correio/modulos/imap";
import { cabecalhoLegivel, htmlParaTexto, lerCorpo } from "../../supabase/functions/produto-correio/modulos/mime";
import type { CaixaAberta } from "../../supabase/functions/produto-correio/modulos/adaptador";

const CAIXA: CaixaAberta = { id: "c1", endereco: "almir@aceleriq.com", dominio: "aceleriq.com", provedor: "migadu", segredo: "senha-teste" };

const MENSAGEM_1 = [
  "From: =?UTF-8?B?Sm/Do28gU2lsdmE=?= <joao@cliente.com.br>",
  "To: almir@aceleriq.com",
  "Subject: =?UTF-8?Q?Or=C3=A7amento_do_site?=",
  "Date: Wed, 19 Nov 2026 10:00:00 -0300",
  'Content-Type: multipart/mixed; boundary="xyz"',
  "",
  "--xyz",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  btoa(String.fromCharCode(...new TextEncoder().encode("Olá Almir, segue o orçamento.\nAbraço"))),
  "--xyz",
  'Content-Type: application/pdf; name="orcamento.pdf"',
  "Content-Disposition: attachment; filename=\"orcamento.pdf\"",
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQK",
  "--xyz--",
  "",
].join("\r\n");
const CABECALHO_1 = MENSAGEM_1.split("\r\n\r\n")[0] + "\r\n\r\n";
const CABECALHO_2 = "From: Boletim <news@loja.com>\r\nSubject: Ofertas\r\nList-Id: <ofertas.loja.com>\r\nDate: Tue, 18 Nov 2026 08:00:00 +0000\r\n\r\n";

/** Um servidor falso: IMAP na 993 e SMTP na 465, guardando tudo o que recebe. */
function servidorFalso(opcoes: { senhaCerta?: string } = {}) {
  const senha = opcoes.senhaCerta ?? "senha-teste";
  const log: string[] = [];
  const conectar = async (_host: string, porta: number): Promise<Conexao> => {
    const fila: string[] = [porta === 465 ? "220 smtp.migadu.com ESMTP\r\n" : "* OK IMAP pronto\r\n"];
    let esperaLiteral: { tag: string; n: number } | null = null;
    let emData = false;
    let acumulado = "";
    const responder = (t: string) => fila.push(t);
    const tratarImap = (linha: string) => {
      log.push(`IMAP ${/ LOGIN /i.test(linha) ? "LOGIN ***" : linha}`);
      const [tag, ...resto] = linha.split(" ");
      const cmd = resto.join(" ");
      if (/^LOGIN/i.test(cmd)) return responder(cmd.indexOf(`"${senha}"`) >= 0 ? `${tag} OK logado\r\n` : `${tag} NO [AUTHENTICATIONFAILED] senha errada\r\n`);
      if (/^LIST/i.test(cmd)) return responder(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n* LIST (\\Noselect) "/" "Pasta"\r\n${tag} OK\r\n`);
      if (/^STATUS "INBOX"/i.test(cmd)) return responder(`* STATUS "INBOX" (UNSEEN 1)\r\n${tag} OK\r\n`);
      if (/^STATUS/i.test(cmd)) return responder(`* STATUS "Sent" (UNSEEN 0)\r\n${tag} OK\r\n`);
      if (/^(EXAMINE|SELECT)/i.test(cmd)) return responder(`* 2 EXISTS\r\n${tag} OK [READ-WRITE]\r\n`);
      if (/^UID SEARCH/i.test(cmd)) return responder(`* SEARCH 7 9\r\n${tag} OK\r\n`);
      if (/^UID FETCH 9,7 /i.test(cmd))
        return responder(`* 1 FETCH (UID 9 FLAGS () INTERNALDATE "19-Nov-2026 10:00:00 -0300" RFC822.SIZE 900 BODY[HEADER.FIELDS (FROM)] {${CABECALHO_1.length}}\r\n${CABECALHO_1})\r\n* 2 FETCH (UID 7 FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM)] {${CABECALHO_2.length}}\r\n${CABECALHO_2})\r\n${tag} OK\r\n`);
      if (/^UID FETCH 9 /i.test(cmd)) return responder(`* 1 FETCH (UID 9 FLAGS () BODY[] {${MENSAGEM_1.length}}\r\n${MENSAGEM_1})\r\n${tag} OK\r\n`);
      if (/^UID STORE/i.test(cmd)) return responder(`${tag} OK\r\n`);
      const ap = /^APPEND "Sent" \(\\Seen\) \{(\d+)\}$/i.exec(cmd);
      if (ap) {
        esperaLiteral = { tag, n: Number(ap[1]) };
        return responder("+ pronto\r\n");
      }
      if (/^LOGOUT/i.test(cmd)) return responder("* BYE\r\n");
      responder(`${tag} BAD comando desconhecido\r\n`);
    };
    const tratarSmtp = (linha: string) => {
      if (emData) {
        if (linha === ".") {
          emData = false;
          return responder("250 OK fila\r\n");
        }
        log.push(`DATA ${linha}`);
        return;
      }
      log.push(`SMTP ${linha.startsWith("AUTH") ? "AUTH ***" : linha}`);
      if (/^EHLO/.test(linha)) return responder("250-smtp.migadu.com\r\n250 AUTH PLAIN\r\n");
      if (/^AUTH PLAIN /.test(linha)) return responder(linha.slice(11) === authPlain(CAIXA.endereco, senha) ? "235 ok\r\n" : "535 senha errada\r\n");
      if (/^(MAIL|RCPT)/.test(linha)) return responder("250 ok\r\n");
      if (linha === "DATA") {
        emData = true;
        return responder("354 manda\r\n");
      }
      if (linha === "QUIT") return responder("221 tchau\r\n");
    };
    return {
      async read(p: Uint8Array) {
        const t = fila.shift();
        if (t === undefined) return null;
        const b = Uint8Array.from(t, (c) => c.charCodeAt(0) & 0xff);
        p.set(b);
        return b.length;
      },
      async write(p: Uint8Array) {
        acumulado += String.fromCharCode(...p);
        for (;;) {
          if (esperaLiteral && porta !== 465) {
            if (acumulado.length < esperaLiteral.n + 2) break;
            log.push(`APPEND ${acumulado.slice(0, esperaLiteral.n).split("\r\n")[0]}`);
            acumulado = acumulado.slice(esperaLiteral.n + 2);
            responder(`${esperaLiteral.tag} OK APPEND\r\n`);
            esperaLiteral = null;
            continue;
          }
          const i = acumulado.indexOf("\r\n");
          if (i < 0) break;
          const linha = acumulado.slice(0, i);
          acumulado = acumulado.slice(i + 2);
          if (porta === 465) tratarSmtp(linha);
          else tratarImap(linha);
        }
        return p.length;
      },
      close() {},
    };
  };
  return { conectar, log };
}

const SERV = { imap: { host: "imap.teste", porta: 993 }, smtp: { host: "smtp.teste", porta: 465 } };

describe("correio por IMAP e SMTP (servidor falso)", () => {
  it("lista as pastas com não lidas e sem as que não abrem", async () => {
    const s = servidorFalso();
    const pastas = await adaptadorImap(SERV, s.conectar).pastas(CAIXA);
    expect(pastas).toEqual([{ id: "INBOX", nome: "Entrada", nao_lidas: 1 }, { id: "Sent", nome: "Sent", nao_lidas: 0 }]);
  });

  it("lista a entrada da mais nova para a mais antiga, com acento, prioridade e boletim separado", async () => {
    const s = servidorFalso();
    const lista = await adaptadorImap(SERV, s.conectar).listar(CAIXA, { pasta: "INBOX", pagina: 1 });
    expect(lista.map((m) => m.id)).toEqual(["9", "7"]);
    expect(lista[0]).toMatchObject({ de: "João Silva <joao@cliente.com.br>", assunto: "Orçamento do site", lida: false, aguardando: "voce", automatica: false, tem_anexo: true });
    expect(lista[1]).toMatchObject({ assunto: "Ofertas", lida: true, automatica: true, aguardando: null });
    expect(s.log.some((l) => /EXAMINE "INBOX"/.test(l))).toBe(true);
  });

  it("abre a mensagem: texto da parte certa, anexo listado e marca como lida", async () => {
    const s = servidorFalso();
    const m = await adaptadorImap(SERV, s.conectar).ler(CAIXA, { pasta: "INBOX", id: "9" });
    expect(m.texto).toBe("Olá Almir, segue o orçamento.\nAbraço");
    expect(m.anexos).toEqual([{ nome: "orcamento.pdf", tamanho: 9 }]);
    expect(m.lida).toBe(true);
    expect(s.log.some((l) => /UID STORE 9 \+FLAGS\.SILENT \(\\Seen\)/.test(l))).toBe(true);
  });

  it("envia pelo SMTP com a senha da caixa e guarda a cópia em Enviados", async () => {
    const s = servidorFalso();
    const r = await adaptadorImap(SERV, s.conectar).enviar(CAIXA, { para: ["joao@cliente.com.br"], assunto: "Resposta do orçamento", texto: "Olá João" });
    expect(r.id).toMatch(/^<.+@aceleriq\.com>$/);
    expect(s.log).toContain("SMTP MAIL FROM:<almir@aceleriq.com>");
    expect(s.log).toContain("SMTP RCPT TO:<joao@cliente.com.br>");
    const assunto = s.log.find((l) => l.startsWith("DATA Subject: ")) || "";
    expect(assunto).toMatch(/^DATA Subject: =\?UTF-8\?B\?/);
    expect(cabecalhoLegivel(assunto.slice("DATA Subject: ".length))).toBe("Resposta do orçamento");
    expect(s.log.some((l) => l.startsWith("APPEND From: almir@aceleriq.com"))).toBe(true);
    expect(s.log.every((l) => l.indexOf("senha-teste") < 0)).toBe(true);
  });

  it("senha errada vira um aviso que a pessoa entende", async () => {
    const s = servidorFalso({ senhaCerta: "outra" });
    await expect(adaptadorImap(SERV, s.conectar).listar(CAIXA, { pasta: "INBOX", pagina: 1 })).rejects.toThrow(/recusou a senha/);
  });

  it("id de mensagem fora do formato não chega ao servidor", async () => {
    const s = servidorFalso();
    await expect(adaptadorImap(SERV, s.conectar).ler(CAIXA, { pasta: "INBOX", id: "9 (BODY[])" })).rejects.toThrow(/inválida/);
    expect(s.log.length).toBe(0);
  });
});

describe("MIME", () => {
  it("cabeçalho codificado em partes e latin1", () => {
    expect(cabecalhoLegivel("=?UTF-8?B?w6k=?= =?UTF-8?B?w6o=?= fim")).toBe("éê fim");
    expect(cabecalhoLegivel("=?ISO-8859-1?Q?Jo=E3o?=")).toBe("João");
  });

  it("HTML vira texto sem script", () => {
    expect(htmlParaTexto("<style>x</style><p>Oi&nbsp;<b>Ana</b></p><script>alert(1)</script>tchau")).toBe("Oi Ana\ntchau");
  });

  it("só HTML: o texto sai do HTML", () => {
    const r = lerCorpo('Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Ol=C3=A1</p>');
    expect(r).toMatchObject({ texto: "Olá", html: true, anexos: [] });
  });

  it("LIST com nome entre aspas e com espaço", () => {
    expect(lerList([{ texto: '* LIST (\\HasNoChildren) "." "Itens Enviados"', literais: [] }])).toEqual([{ nome: "Itens Enviados", marcas: ["\\HasNoChildren"] }]);
  });
});
