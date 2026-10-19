import type { LeituraDoLink } from "../../../supabase/functions/mesa-site/modulos/leitura-do-link";

/**
 * O que a leitura do link (ação link_ler) vira no briefing do site
 * (19/10/2026). Cada achado é um item que o dono marca e pode reescrever antes
 * de usar; o destino é uma pergunta do briefing (ou a observação da direção,
 * para as cores). Usar ACRESCENTA à resposta que já existe, nunca apaga.
 */

export type { LeituraDoLink };

export type DestinoDoAchado = "oferta" | "diferenciais" | "acao" | "dominio" | "direcao";

export type AchadoDoLink = { id: string; rotulo: string; destino: DestinoDoAchado; texto: string };

export const ROTULO_DO_DESTINO: Record<DestinoDoAchado, string> = {
  oferta: "O que o cliente vende",
  diferenciais: "Por que escolher o cliente",
  acao: "Próximo passo do visitante",
  dominio: "Domínio",
  direcao: "Observação da direção",
};

/** Endereços que não são o site do cliente (o domínio não vem deles). */
const NAO_E_DOMINIO = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linktr\.ee|linktree\.com|wa\.me|whatsapp\.com|tiktok\.com|youtube\.com|google\.com|goo\.gl|bit\.ly|hotmart\.com|kiwify\.com\.br|beacons\.ai|bio\.link|linkin\.bio)$/i;

const juntarLista = (l: string[], max: number) => l.slice(0, max).join("; ");

/** Os achados da leitura, na ordem em que aparecem na tela (só os que têm texto). */
export function achadosDaLeitura(l: LeituraDoLink): AchadoDoLink[] {
  const a: AchadoDoLink[] = [];
  if (l.nome) a.push({ id: "nome", rotulo: "Nome", destino: "oferta", texto: `Nome do negócio: ${l.nome}` });
  const oferta = [l.titulo, l.descricao].filter((x) => !!x && x !== l.nome).join(". ");
  if (oferta) a.push({ id: "oferta", rotulo: "Oferta", destino: "oferta", texto: `Oferta no site: ${oferta}` });
  if (l.servicos.length) a.push({ id: "servicos", rotulo: "Serviços", destino: "oferta", texto: `Serviços no site: ${juntarLista(l.servicos, 12)}` });
  if (l.depoimentos.length) a.push({ id: "depoimentos", rotulo: "Depoimentos", destino: "diferenciais", texto: `Depoimentos no site: ${l.depoimentos.slice(0, 4).map((d) => `"${d}"`).join(" ")}` });
  const c = l.contatos;
  const contato = [c.whatsapp ? `WhatsApp ${c.whatsapp}` : "", c.telefone ? `telefone ${c.telefone}` : "", c.email ? `e-mail ${c.email}` : "", c.instagram ? `Instagram ${c.instagram}` : ""].filter(Boolean).join(", ");
  if (contato) a.push({ id: "contato", rotulo: "Contato", destino: "acao", texto: `Contato no site: ${contato}` });
  if (l.cores.length) a.push({ id: "cores", rotulo: "Cores aparentes", destino: "direcao", texto: `Cores aparentes no site atual: ${l.cores.join(", ")}` });
  if (l.host && !NAO_E_DOMINIO.test(l.host)) a.push({ id: "dominio", rotulo: "Domínio", destino: "dominio", texto: l.host });
  return a;
}

/** Acrescenta um texto a uma resposta (linha nova); o que já está lá não entra de novo. */
export function acrescentar(atual: string, novo: string): string {
  const a = String(atual || "").replace(/\s+$/, "");
  const n = String(novo || "").trim();
  if (!n) return a;
  if (!a) return n;
  if (a.toLowerCase().indexOf(n.toLowerCase()) >= 0) return a;
  return `${a}\n${n}`;
}

/**
 * Os achados escolhidos aplicados: as respostas que mudam (só as perguntas
 * tocadas) e a observação nova da direção (null = não muda). O domínio só
 * entra quando a pergunta está vazia.
 */
export function aplicarAchados(respostas: Record<string, string>, observacao: string, escolhidos: AchadoDoLink[]): { respostas: Record<string, string>; observacao: string | null } {
  const mudou: Record<string, string> = {};
  let obs: string | null = null;
  escolhidos.forEach((x) => {
    if (x.destino === "direcao") {
      obs = acrescentar(obs === null ? observacao : obs, x.texto);
      return;
    }
    const atual = mudou[x.destino] !== undefined ? mudou[x.destino] : respostas[x.destino] || "";
    if (x.destino === "dominio") {
      if (!atual.trim()) mudou.dominio = x.texto.trim();
      return;
    }
    mudou[x.destino] = acrescentar(atual, x.texto);
  });
  Object.keys(mudou).forEach((k) => {
    if ((respostas[k] || "") === mudou[k]) delete mudou[k];
  });
  return { respostas: mudou, observacao: obs !== null && obs !== observacao ? obs : null };
}

/** O que fica guardado no briefing (briefing.pagina_lida) para o diretor e as próximas etapas. */
export function registroDaLeitura(l: LeituraDoLink) {
  return {
    url: l.url,
    lida_em: new Date().toISOString(),
    nome: l.nome,
    titulo: l.titulo,
    descricao: l.descricao,
    servicos: l.servicos.slice(0, 12),
    depoimentos: l.depoimentos.slice(0, 6),
    cores: l.cores.slice(0, 6),
    imagens: l.imagens.slice(0, 6),
    logo: l.logo,
    contatos: l.contatos,
  };
}
