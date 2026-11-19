/**
 * A cópia do e-mail antigo para a caixa nova, um pouco por vez (19/11/2026).
 *
 * O provedor de lá é só lido (EXAMINE e BODY.PEEK): nada é apagado nem marcado lá. Cada rodada copia
 * até o prazo acabar e anota onde parou (pastas.<nome>.ultimo); a rodada seguinte continua dali. Cada
 * mensagem é reconhecida pelo Message-ID: o que já foi não vai de novo, nem se a cópia recomeçar.
 *
 * As duas conexões e o "já vi" chegam de fora, para o teste rodar sem rede e sem banco.
 */
import { aspas, lerFetch, lerList, type Imap, type PastaListada } from "../../produto-correio/modulos/imap.ts";

export interface ProvedorDeOrigem {
  id: string;
  nome: string;
  host: string;
  porta: number;
  /** O provedor só aceita uma senha de app (não a senha normal da conta). */
  senha_de_app?: { onde: string; passos: string[] };
}

/** Os provedores mais comuns no Brasil, já com o servidor certo: o cliente só escolhe a marca. */
export const PROVEDORES: ProvedorDeOrigem[] = [
  { id: "gmail", nome: "Gmail ou Google Workspace", host: "imap.gmail.com", porta: 993, senha_de_app: { onde: "https://myaccount.google.com/apppasswords", passos: ["Abra o link com a conta do e-mail antigo.", "Se pedir, ative a verificação em duas etapas.", "Dê o nome Aceleriq e clique em Criar.", "Copie as 16 letras e cole aqui."] } },
  { id: "outlook", nome: "Outlook, Hotmail ou Microsoft 365", host: "outlook.office365.com", porta: 993, senha_de_app: { onde: "https://account.live.com/proofs/AppPassword", passos: ["Abra o link com a conta do e-mail antigo.", "Crie uma senha de aplicativo.", "Copie e cole aqui."] } },
  { id: "yahoo", nome: "Yahoo", host: "imap.mail.yahoo.com", porta: 993, senha_de_app: { onde: "https://login.yahoo.com/account/security", passos: ["Abra o link com a conta do e-mail antigo.", "Em Senha de app, gere uma nova.", "Copie e cole aqui."] } },
  { id: "uol", nome: "UOL Host", host: "imap.uhserver.com", porta: 993 },
  { id: "locaweb", nome: "Locaweb", host: "email-ssl.com.br", porta: 993 },
  { id: "hostinger", nome: "Hostinger", host: "imap.hostinger.com", porta: 993 },
  { id: "kinghost", nome: "KingHost", host: "imap.kinghost.net", porta: 993 },
  { id: "hostgator", nome: "HostGator", host: "imap.hostgator.com.br", porta: 993 },
  { id: "zoho", nome: "Zoho Mail (plano pago)", host: "imap.zoho.com", porta: 993 },
  { id: "terra", nome: "Terra", host: "imap.terra.com.br", porta: 993 },
  { id: "outro", nome: "Outro provedor", host: "", porta: 993 },
];

export const provedorPorId = (id: string) => PROVEDORES.find((p) => p.id === id) || null;

export interface PlanoDaPasta {
  origem: string;
  destino: string;
}

/**
 * Que pasta vai para onde. Entrada e Enviados primeiro. No Gmail, o "Todos os e-mails" vira "Arquivo
 * antigo" (o que sobra das marcadores); as outras pastas do Gmail repetem mensagens e ficam de fora.
 * Lixeira, spam e rascunhos não vão.
 */
export function planoDePastas(lista: PastaListada[]): PlanoDaPasta[] {
  const gmail = lista.some((p) => /^\[gmail\]|^\[google mail\]/i.test(p.nome));
  const ignorar = (p: PastaListada) =>
    p.marcas.some((m) => /\\(Trash|Junk|Drafts|Flagged|Important)/i.test(m)) || /^(trash|lixeira|lixo|junk|spam|lixo eletr[oô]nico|drafts?|rascunhos?|deleted( items)?|itens exclu[ií]dos|outbox|caixa de sa[ií]da)$/i.test(p.nome.split(/[./]/).pop() || "");
  const plano: PlanoDaPasta[] = [];
  for (const p of lista) {
    if (ignorar(p)) continue;
    const enviados = p.marcas.some((m) => /\\Sent/i.test(m)) || /^(sent( items| mail| messages)?|enviad[ao]s?|itens enviados|e-mails enviados)$/i.test(p.nome.split(/[./]/).pop() || "");
    if (p.nome.toUpperCase() === "INBOX") plano.push({ origem: p.nome, destino: "INBOX" });
    else if (enviados) plano.push({ origem: p.nome, destino: "Sent" });
    else if (p.marcas.some((m) => /\\All/i.test(m))) plano.push({ origem: p.nome, destino: "Arquivo antigo" });
    else if (!gmail) plano.push({ origem: p.nome, destino: p.nome.replace(/^INBOX[./]/i, "") || p.nome });
  }
  const ordem = (d: PlanoDaPasta) => (d.destino === "INBOX" ? 0 : d.destino === "Sent" ? 1 : d.destino === "Arquivo antigo" ? 9 : 5);
  return plano.sort((a, b) => ordem(a) - ordem(b));
}

const RE_MID = /^Message-ID:[ \t]*(?:\r?\n[ \t]+)?(<[^>\r\n]+>|\S+)/im;

async function sha(texto: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(d)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A chave da mensagem: o Message-ID, ou (sem ele) o cabeçalho e o tamanho. */
export async function chaveDaMensagem(bruta: string, data: string | null): Promise<string> {
  const cabecalho = bruta.split(/\r?\n\r?\n/)[0] || "";
  const m = RE_MID.exec(cabecalho);
  return sha(m ? m[1].trim().toLowerCase() : `sem-id|${cabecalho.slice(0, 4000)}|${bruta.length}|${data || ""}`);
}

export interface AndamentoDaPasta {
  validade?: string;
  ultimo?: number;
  total?: number;
  feita?: boolean;
}

export interface Vistos {
  quais(chaves: string[]): Promise<Set<string>>;
  marcar(chaves: string[]): Promise<void>;
}

export interface ResultadoDaRodada {
  pastas: Record<string, AndamentoDaPasta>;
  total: number;
  copiadas: number;
  puladas: number;
  erros: number;
  acabou: boolean;
  problemas: string[];
}

const LOTE = 15;
const MAIOR_MENSAGEM = 25_000_000;

/** Uma rodada: copia até o prazo e devolve onde parou. */
export async function rodada(
  origem: Imap,
  destino: Imap,
  p: { pastas: Record<string, AndamentoDaPasta>; vistos: Vistos; prazo: number; agora?: () => number },
): Promise<ResultadoDaRodada> {
  const agora = p.agora || (() => Date.now());
  const pastas: Record<string, AndamentoDaPasta> = JSON.parse(JSON.stringify(p.pastas || {}));
  const r: ResultadoDaRodada = { pastas, total: 0, copiadas: 0, puladas: 0, erros: 0, acabou: false, problemas: [] };
  const plano = planoDePastas(lerList(await origem.comando(`LIST "" "*"`)));
  const existentes = new Set(lerList(await destino.comando(`LIST "" "*"`)).map((x) => x.nome));

  for (const { origem: nome } of plano) {
    if (pastas[nome] && pastas[nome].total !== undefined) continue;
    const st = await origem.comando(`STATUS ${aspas(nome)} (MESSAGES UIDVALIDITY)`).catch(() => []);
    const texto = st.map((x) => x.texto).join(" ");
    const total = Number((/MESSAGES (\d+)/i.exec(texto) || [])[1] || 0);
    pastas[nome] = { ...(pastas[nome] || {}), total, validade: (/UIDVALIDITY (\d+)/i.exec(texto) || [])[1] || "" };
  }
  r.total = plano.reduce((s, x) => s + (pastas[x.origem] ? pastas[x.origem].total || 0 : 0), 0);

  for (const { origem: nome, destino: alvo } of plano) {
    const a = pastas[nome];
    if (a.feita) continue;
    if (alvo !== "INBOX" && !existentes.has(alvo)) {
      await destino.comando(`CREATE ${aspas(alvo)}`).catch(() => []);
      existentes.add(alvo);
    }
    await origem.comando(`EXAMINE ${aspas(nome)}`);
    const busca = await origem.comando(`UID SEARCH UID ${(a.ultimo || 0) + 1}:*`);
    const uids = busca
      .flatMap((x) => (/^\* SEARCH ?(.*)$/i.exec(x.texto) || ["", ""])[1].trim().split(/\s+/))
      .filter((x) => /^\d+$/.test(x))
      .map(Number)
      .filter((u) => u > (a.ultimo || 0))
      .sort((x, y) => x - y);
    for (let i = 0; i < uids.length; i += LOTE) {
      if (agora() > p.prazo) return r;
      const lote = uids.slice(i, i + LOTE);
      let itens = [] as Awaited<ReturnType<Imap["comando"]>>;
      try {
        itens = await origem.comando(`UID FETCH ${lote.join(",")} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])`);
      } catch {
        // Uma mensagem que o servidor não entrega derruba o lote: pede uma por uma.
        for (const u of lote) {
          try {
            itens.push(...(await origem.comando(`UID FETCH ${u} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])`)));
          } catch {
            r.erros++;
          }
        }
      }
      const lidas = lerFetch(itens);
      const chaves = await Promise.all(lidas.map((f) => chaveDaMensagem(f.literal, f.data)));
      const ja = await p.vistos.quais(chaves);
      const novas: string[] = [];
      for (let k = 0; k < lidas.length; k++) {
        const f = lidas[k];
        if (ja.has(chaves[k]) || novas.indexOf(chaves[k]) >= 0) {
          r.puladas++;
          continue;
        }
        if (!f.literal || f.literal.length > MAIOR_MENSAGEM) {
          r.erros++;
          r.problemas.push(`Uma mensagem de ${nome} é grande demais (mais de 25 MB) e ficou de fora.`);
          continue;
        }
        const marcas = f.flags.some((x) => /\\Seen/i.test(x)) ? "(\\Seen)" : "()";
        try {
          await destino.comando(`APPEND ${aspas(alvo)} ${marcas}${f.data ? ` ${aspas(f.data)}` : ""}`, f.literal);
          novas.push(chaves[k]);
          r.copiadas++;
        } catch (e) {
          r.erros++;
          if (r.problemas.length < 5) r.problemas.push(`Uma mensagem de ${nome} não entrou: ${(e as Error).message.slice(0, 120)}`);
        }
      }
      if (novas.length) await p.vistos.marcar(novas);
      a.ultimo = Math.max(a.ultimo || 0, ...lote);
    }
    a.feita = true;
  }
  r.acabou = true;
  return r;
}
