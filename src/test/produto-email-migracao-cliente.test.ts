import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Imap, type Conexao } from "../../supabase/functions/produto-correio/modulos/imap";
import { PROVEDORES, chaveDaMensagem, planoDePastas, rodada, type Vistos } from "../../supabase/functions/produto-migracao/modulos/copiar";

const raiz = resolve(__dirname, "../..");
const ler = (arquivo: string) => readFileSync(resolve(raiz, arquivo), "utf8");

type Msg = { uid: number; corpo: string; lida: boolean };
const msg = (uid: number, id: string, lida = false): Msg => ({ uid, lida, corpo: `Message-ID: <${id}@x.com>\r\nSubject: Teste ${uid}\r\nFrom: a@x.com\r\n\r\nOlá ${uid}\r\n` });

/** Um servidor IMAP falso com pastas, que guarda o que recebe por APPEND. */
function servidor(pastas: Record<string, { marcas: string; msgs: Msg[] }>, log: string[]) {
  const conectar = async (): Promise<Conexao> => {
    const fila: string[] = ["* OK pronto\r\n"];
    let acumulado = "";
    let aberta = "";
    let espera: { tag: string; n: number; pasta: string; lida: boolean } | null = null;
    const r = (t: string) => fila.push(t);
    const tratar = (linha: string) => {
      const [tag, ...resto] = linha.split(" ");
      const cmd = resto.join(" ");
      log.push(cmd.replace(/^LOGIN .*/i, "LOGIN ***"));
      if (/^LOGIN/i.test(cmd)) return r(`${tag} OK\r\n`);
      if (/^LIST/i.test(cmd)) return r(Object.entries(pastas).map(([n, p]) => `* LIST (${p.marcas}) "/" "${n}"\r\n`).join("") + `${tag} OK\r\n`);
      const st = /^STATUS "([^"]+)"/i.exec(cmd);
      if (st) return r(`* STATUS "${st[1]}" (MESSAGES ${pastas[st[1]] ? pastas[st[1]].msgs.length : 0} UIDVALIDITY 7)\r\n${tag} OK\r\n`);
      const ex = /^(EXAMINE|SELECT) "([^"]+)"/i.exec(cmd);
      if (ex) {
        aberta = ex[2];
        return r(`${tag} OK\r\n`);
      }
      const cr = /^CREATE "([^"]+)"/i.exec(cmd);
      if (cr) {
        pastas[cr[1]] = pastas[cr[1]] || { marcas: "\\HasNoChildren", msgs: [] };
        return r(`${tag} OK\r\n`);
      }
      const se = /^UID SEARCH UID (\d+):\*/i.exec(cmd);
      if (se) return r(`* SEARCH ${pastas[aberta].msgs.filter((m) => m.uid >= Number(se[1])).map((m) => m.uid).join(" ")}\r\n${tag} OK\r\n`);
      const fe = /^UID FETCH ([\d,]+) /i.exec(cmd);
      if (fe) {
        const uids = fe[1].split(",").map(Number);
        const linhas = pastas[aberta].msgs.filter((m) => uids.indexOf(m.uid) >= 0).map((m, i) => `* ${i + 1} FETCH (UID ${m.uid} FLAGS (${m.lida ? "\\Seen" : ""}) INTERNALDATE "19-Nov-2026 10:00:00 -0300" BODY[] {${m.corpo.length}}\r\n${m.corpo})\r\n`).join("");
        return r(linhas + `${tag} OK\r\n`);
      }
      const ap = /^APPEND "([^"]+)" \(([^)]*)\)(?: "[^"]*")? \{(\d+)\}$/i.exec(cmd);
      if (ap) {
        espera = { tag, n: Number(ap[3]), pasta: ap[1], lida: /Seen/.test(ap[2]) };
        return r("+ ok\r\n");
      }
      if (/^LOGOUT/i.test(cmd)) return r("* BYE\r\n");
      r(`${tag} BAD\r\n`);
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
          if (espera) {
            if (acumulado.length < espera.n + 2) break;
            const corpo = acumulado.slice(0, espera.n);
            acumulado = acumulado.slice(espera.n + 2);
            const alvo = (pastas[espera.pasta] = pastas[espera.pasta] || { marcas: "", msgs: [] });
            alvo.msgs.push({ uid: alvo.msgs.length + 1, corpo, lida: espera.lida });
            r(`${espera.tag} OK APPEND\r\n`);
            espera = null;
            continue;
          }
          const i = acumulado.indexOf("\r\n");
          if (i < 0) break;
          const linha = acumulado.slice(0, i);
          acumulado = acumulado.slice(i + 2);
          tratar(linha);
        }
        return p.length;
      },
      close() {},
    };
  };
  return conectar;
}

function vistosNaMemoria(): Vistos & { tudo: Set<string> } {
  const tudo = new Set<string>();
  return { tudo, quais: async (c) => new Set(c.filter((x) => tudo.has(x))), marcar: async (c) => void c.forEach((x) => tudo.add(x)) };
}

describe("migração pelo cliente: que pasta vai para onde", () => {
  it("Gmail: entrada, enviados e o 'Todos' vira Arquivo antigo; o resto do Gmail fica de fora", () => {
    const plano = planoDePastas([
      { nome: "INBOX", marcas: [] }, { nome: "[Gmail]/Todos os e-mails", marcas: ["\\All"] }, { nome: "[Gmail]/E-mails enviados", marcas: ["\\Sent"] },
      { nome: "[Gmail]/Lixeira", marcas: ["\\Trash"] }, { nome: "[Gmail]/Spam", marcas: ["\\Junk"] }, { nome: "Clientes", marcas: [] }, { nome: "[Gmail]/Rascunhos", marcas: ["\\Drafts"] },
    ]);
    expect(plano).toEqual([{ origem: "INBOX", destino: "INBOX" }, { origem: "[Gmail]/E-mails enviados", destino: "Sent" }, { origem: "[Gmail]/Todos os e-mails", destino: "Arquivo antigo" }]);
  });

  it("provedor comum: todas as pastas, sem lixeira, spam e rascunho", () => {
    const plano = planoDePastas([{ nome: "INBOX", marcas: [] }, { nome: "INBOX.Sent", marcas: [] }, { nome: "INBOX.Trash", marcas: [] }, { nome: "INBOX.Financeiro", marcas: [] }, { nome: "Spam", marcas: [] }]);
    expect(plano).toEqual([{ origem: "INBOX", destino: "INBOX" }, { origem: "INBOX.Sent", destino: "Sent" }, { origem: "INBOX.Financeiro", destino: "Financeiro" }]);
  });

  it("a chave é o Message-ID (e não o que a assinatura DKIM cita)", async () => {
    const a = await chaveDaMensagem("DKIM-Signature: h=from:message-id:subject;\r\nMessage-ID: <um@x>\r\n\r\ncorpo", null);
    const b = await chaveDaMensagem("DKIM-Signature: h=from:message-id:subject;\r\nMessage-ID: <dois@x>\r\n\r\ncorpo", null);
    expect(a).not.toBe(b);
    expect(await chaveDaMensagem("Message-ID: <UM@x>\r\n\r\noutro corpo", null)).toBe(a);
  });

  it("os provedores do Brasil vêm prontos, e os que pedem senha de app explicam como", () => {
    expect(PROVEDORES.find((p) => p.id === "uol")?.host).toBe("imap.uhserver.com");
    expect(PROVEDORES.find((p) => p.id === "gmail")?.senha_de_app?.onde).toMatch(/apppasswords/);
    expect(PROVEDORES[PROVEDORES.length - 1].id).toBe("outro");
  });
});

describe("migração pelo cliente: a cópia", () => {
  it("copia tudo, mantém lida/não lida, não duplica o que está em duas pastas e só lê o antigo", async () => {
    const logA: string[] = [];
    const logB: string[] = [];
    const antigo = { INBOX: { marcas: "", msgs: [msg(1, "a"), msg(2, "b", true)] }, "[Gmail]/E-mails enviados": { marcas: "\\Sent", msgs: [msg(5, "c", true)] }, "[Gmail]/Todos os e-mails": { marcas: "\\All", msgs: [msg(1, "a"), msg(2, "b", true), msg(3, "c"), msg(4, "d")] }, "[Gmail]/Lixeira": { marcas: "\\Trash", msgs: [msg(9, "lixo")] } };
    const novo: Record<string, { marcas: string; msgs: Msg[] }> = { INBOX: { marcas: "", msgs: [] }, Sent: { marcas: "\\Sent", msgs: [] } };
    const origem = await Imap.abrir(servidor(antigo, logA), "imap.gmail.com", 993, "eu@gmail.com", "x");
    const destino = await Imap.abrir(servidor(novo, logB), "imap.migadu.com", 993, "eu@empresa.com", "y");
    const vistos = vistosNaMemoria();
    const r = await rodada(origem, destino, { pastas: {}, vistos, prazo: Date.now() + 60_000 });
    expect(r.acabou).toBe(true);
    expect(novo.INBOX.msgs.length).toBe(2);
    expect(novo.Sent.msgs.length).toBe(1);
    expect(novo["Arquivo antigo"].msgs.length).toBe(1);
    expect(r).toMatchObject({ copiadas: 4, puladas: 3, erros: 0, total: 7 });
    expect(novo.INBOX.msgs.map((m) => m.lida)).toEqual([false, true]);
    expect(logA.some((l) => /^(SELECT|STORE|UID STORE|EXPUNGE|DELETE|APPEND)/i.test(l))).toBe(false);
    expect(logA.every((l) => !/FETCH/.test(l) || /BODY\.PEEK/.test(l))).toBe(true);
    expect(logA.some((l) => /Lixeira/.test(l) && /EXAMINE/.test(l))).toBe(false);
  });

  it("para no prazo e continua de onde parou na rodada seguinte, sem repetir", async () => {
    const antigo = { INBOX: { marcas: "", msgs: Array.from({ length: 40 }, (_, i) => msg(i + 1, `m${i + 1}`)) } };
    const novo: Record<string, { marcas: string; msgs: Msg[] }> = { INBOX: { marcas: "", msgs: [] } };
    const vistos = vistosNaMemoria();
    let relogio = 0;
    const abrir = async () => [await Imap.abrir(servidor(antigo, []), "o", 993, "u", "x"), await Imap.abrir(servidor(novo, []), "d", 993, "u", "y")] as const;
    let [o, d] = await abrir();
    // Primeira rodada: o prazo acaba depois do primeiro lote.
    const r1 = await rodada(o, d, { pastas: {}, vistos, prazo: 0, agora: () => relogio++ });
    expect(r1.acabou).toBe(false);
    expect(novo.INBOX.msgs.length).toBe(15);
    [o, d] = await abrir();
    const r2 = await rodada(o, d, { pastas: r1.pastas, vistos, prazo: Number.MAX_SAFE_INTEGER });
    expect(r2.acabou).toBe(true);
    expect(novo.INBOX.msgs.length).toBe(40);
    expect(new Set(novo.INBOX.msgs.map((m) => m.corpo)).size).toBe(40);
  });
});

describe("migração pelo cliente: o servidor", () => {
  const f = ler("supabase/functions/produto-migracao/index.ts");
  const sql = ler("supabase/migrations/20261119180000_produto_email_migracao_pelo_cliente.sql");
  it("a senha de lá vai para o Vault e sai quando termina; a tela nunca recebe host nem senha", () => {
    expect(sql).toContain("vault.create_secret");
    expect(sql).not.toMatch(/add column if not exists \w*(senha|token|secret)/i);
    expect(f).toMatch(/acabou[\s\S]{0,600}_acao: "apagar"/);
    expect(f).toMatch(/const publico = [\s\S]{0,400}criado_em/);
    expect(f.slice(f.indexOf("const publico"), f.indexOf("async function testarLogin"))).not.toMatch(/origem_host|senha/);
  });
  it("só quem administra a empresa (ou a casa) começa; a rotina só com o segredo do cron", () => {
    expect(f).toContain("Só quem administra a empresa traz os e-mails antigos.");
    expect(f).toMatch(/acao === "trabalhar"[\s\S]{0,80}daRotina\(req\)/);
  });
});
