/**
 * PDF da ata do conselho (frente BRF2, 30/09/2026), pelo gerador comum
 * pdf-base.ts (A4, faixa verde, logo, rodapé com página): a pergunta, quem
 * esteve na mesa e com qual modelo, a recomendação com o porquê, as
 * divergências (sempre à vista), o ranking, quem disse o quê em cada rodada, a
 * conversa e a decisão do dono. Texto nunca é cortado: o que não cabe vai para
 * a página seguinte.
 *
 * Puro: sem Deno e sem npm. Sem travessão.
 */

import {
  CORES,
  DIR,
  DocumentoPdf,
  ESQ,
  type ImagemDoPdf,
  MIOLO,
  montarPdf,
  quebrarLinhas,
  rotuloEmCima,
  tituloDeSecao,
} from "../../_shared/pdf-base.ts";
import { type FalaDoConselho, NOME_DA_ETAPA, nomeDoEspecialista, planoDasEtapas, type SessaoDoConselho } from "./conselho.ts";
import { MODOS } from "./conselho-presets.ts";

const semTravessao = (t: string) => String(t || "").replace(/\s*[\u2013\u2014]\s*/g, ", ");

const dataBr = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const sp = new Date(d.getTime() - 3 * 3_600_000);
  return `${p(sp.getUTCDate())}/${p(sp.getUTCMonth() + 1)}/${sp.getUTCFullYear()} ${p(sp.getUTCHours())}:${p(sp.getUTCMinutes())}`;
};

const usd = (v: number) => `US$ ${(Number(v) || 0).toFixed(4).replace(".", ",")}`;

const NIVEL: Record<string, string> = { alto: "Consenso alto", medio: "Consenso médio", baixo: "Consenso baixo", sem_medida: "Consenso sem medida" };

/** Parágrafo que atravessa páginas. */
function escrever(d: DocumentoPdf, secao: string, t: string, fonte: "F1" | "F2", tamanho: number, cor: [number, number, number], x = ESQ, largura = MIOLO, entrelinha = tamanho * 1.36) {
  semTravessao(t).split(/\n+/).forEach((par) => {
    const limpo = par.trim();
    if (!limpo) return;
    for (const l of quebrarLinhas(limpo, fonte, tamanho, largura)) {
      d.garantir(entrelinha, secao);
      d.atual().texto(x, d.y, l, fonte, tamanho, cor);
      d.y += entrelinha;
    }
    d.y += 3;
  });
}

function lista(d: DocumentoPdf, secao: string, itens: string[]) {
  itens.forEach((t) => {
    d.garantir(14, secao);
    d.atual().texto(ESQ, d.y, "•", "F2", 10, CORES.verde);
    escrever(d, secao, t, "F1", 10, CORES.tinta, ESQ + 14, MIOLO - 14);
  });
}

function rotulo(d: DocumentoPdf, secao: string, t: string) {
  d.garantir(34, secao);
  d.y += 6;
  rotuloEmCima(d.atual(), ESQ, d.y, t);
  d.y += 16;
}

export type ExtrasDaAta = { cliente?: string | null; modelos?: Record<string, string>; logo?: ImagemDoPdf | null };

export function gerarPdfDaAta(sessao: SessaoDoConselho, falas: FalaDoConselho[], extras: ExtrasDaAta = {}): Uint8Array {
  const cliente = extras.cliente || "Cliente";
  const d = new DocumentoPdf(cliente, false, "ATA DO CONSELHO", extras.logo || null);
  const etapas = planoDasEtapas(sessao.rodadas, sessao.rodadas_extras);
  const r = sessao.resultado;

  // Abertura
  let secao = "ATA";
  d.nova(secao);
  tituloDeSecao(d, "Ata do conselho", sessao.tema, `${cliente}  /  ${dataBr(sessao.criado_em)}  /  modo ${MODOS[sessao.modo || "padrao"].rotulo.toLowerCase()}`);
  const numeros: Array<[string, string]> = [
    [String(sessao.especialistas.length), "ESPECIALISTAS"],
    [String(etapas.length), "RODADAS"],
    [r ? (r.consenso != null ? `${Math.round(r.consenso * 100)}%` : "sem") : "sem", "CONSENSO"],
    [usd(sessao.custo_usd).replace("US$ ", ""), "CUSTO (US$)"],
  ];
  d.garantir(50, secao);
  numeros.forEach(([valor, rot], i) => {
    const x = ESQ + i * (MIOLO / 4);
    d.atual().texto(x, d.y + 8, valor, "F2", 18, CORES.tinta);
    d.atual().texto(x, d.y + 24, rot, "F2", 7, CORES.verdeEscuro);
  });
  d.y += 44;
  rotulo(d, secao, "Pergunta");
  escrever(d, secao, sessao.pergunta, "F1", 10.6, CORES.tinta);
  if (sessao.pauta && (sessao.pauta.itens.length || sessao.pauta.anexos.length)) {
    rotulo(d, secao, "Pauta");
    lista(d, secao, sessao.pauta.itens);
    if (sessao.pauta.anexos.length) escrever(d, secao, `Anexos: ${sessao.pauta.anexos.map((a) => a.nome).join("; ")}`, "F1", 9.2, CORES.cinza);
  }
  rotulo(d, secao, "Na mesa");
  lista(d, secao, sessao.especialistas.map((m) => `${m.nome} (${(extras.modelos && extras.modelos[m.modelo_id]) || m.modelo_id})`));
  escrever(d, secao, `Critérios: ${sessao.criterios.join("; ")}.`, "F1", 9.2, CORES.cinza);

  // Recomendação e consenso
  if (r) {
    secao = "RECOMENDAÇÃO";
    d.nova(secao);
    tituloDeSecao(d, "Recomendação", `${NIVEL[r.nivel] || "Consenso"}${r.consenso != null ? ` (${Math.round(r.consenso * 100)}%)` : ""}`, r.vencedor ? `Vencedora: ${nomeDoEspecialista(r.vencedor)}.` : undefined);
    escrever(d, secao, r.recomendacao || "O moderador não escreveu a recomendação.", "F1", 11, CORES.tinta);
    if (r.porque) {
      rotulo(d, secao, "Por quê");
      escrever(d, secao, r.porque, "F1", 10, CORES.tinta);
    }
    if (r.em_aberto.length) {
      rotulo(d, secao, "Em aberto");
      lista(d, secao, r.em_aberto);
    }
    if (r.proximos_passos.length) {
      rotulo(d, secao, "Próximos passos");
      lista(d, secao, r.proximos_passos);
    }
    rotulo(d, secao, "Divergências");
    if (r.divergencias.length) lista(d, secao, r.divergencias.map((x) => x.texto));
    else escrever(d, secao, "Nenhuma registrada.", "F1", 10, CORES.cinza);
    rotulo(d, secao, "Ranking");
    r.ranking.forEach((l, i) => {
      d.garantir(16, secao);
      const p = d.atual();
      p.texto(ESQ, d.y, `${i + 1}. ${l.nome}`, "F2", 10, CORES.tinta);
      p.textoADireita(DIR, d.y, `Jev ${l.nota_jev ?? "sem"}  /  crítica ${l.nota_media ?? "sem"}  /  escolha ${l.probabilidade != null ? `${Math.round(l.probabilidade * 100)}%` : "sem"}`, "F1", 9, CORES.cinza);
      d.y += 15;
    });
    if (r.aviso) escrever(d, secao, `Aviso: ${r.aviso}`, "F1", 9, CORES.cinza);
  }

  // Quem disse o quê
  secao = "RODADAS";
  d.nova(secao);
  tituloDeSecao(d, "Rodadas", "Quem disse o quê");
  etapas.forEach((etapa, i) => {
    const rodada = i + 1;
    const doRound = falas.filter((f) => f.rodada === rodada && f.etapa !== "conversa");
    if (!doRound.length) return;
    rotulo(d, secao, `Rodada ${rodada}: ${NOME_DA_ETAPA[etapa]}`);
    doRound.forEach((f) => {
      d.garantir(30, secao);
      d.atual().texto(ESQ, d.y, nomeDoEspecialista(f.especialista), "F2", 10.4, CORES.tinta);
      d.y += 14;
      const corpo = f.status === "feita" ? String(f.texto || "") : `(${f.status}${f.erro_mensagem ? `: ${f.erro_mensagem}` : ""})`;
      escrever(d, secao, corpo.slice(0, 4_000), "F1", 9.4, CORES.cinza);
      d.y += 4;
    });
  });

  const conversa = falas.filter((f) => f.etapa === "conversa");
  if (conversa.length) {
    rotulo(d, secao, "Conversa com o conselho");
    conversa.forEach((f) => {
      escrever(d, secao, `Pergunta para ${nomeDoEspecialista(f.especialista)}: ${String(f.pedido || "")}`, "F2", 9.6, CORES.tinta);
      escrever(d, secao, f.status === "feita" ? String(f.texto || "") : `(${f.status})`, "F1", 9.4, CORES.cinza);
    });
  }

  // Decisão
  rotulo(d, secao, "Decisão do dono");
  const dec = sessao.decisao;
  if (!dec || dec.desfeita_em) escrever(d, secao, dec && dec.desfeita_em ? `Decisão desfeita em ${dataBr(dec.desfeita_em)}.` : "Ainda não decidida.", "F1", 10, CORES.tinta);
  else {
    const oQue = dec.escolha === "recomendacao" ? "seguir a recomendação do conselho" : dec.escolha === "proposta" ? `seguir a proposta de ${nomeDoEspecialista(String(dec.especialista))}` : "não seguir nenhuma proposta";
    escrever(d, secao, `${dec.por_nome || "A equipe"} decidiu ${oQue} em ${dataBr(dec.em)}.${dec.nota ? ` Nota: ${dec.nota}` : ""}`, "F1", 10, CORES.tinta);
  }
  escrever(d, secao, `Sessão ${sessao.id.slice(0, 8)}  /  custo ${usd(sessao.custo_usd)} de um teto de ${usd(sessao.teto_usd)}`, "F1", 8, CORES.verdeEscuro);

  d.rodapes();
  return montarPdf(d.paginas, { titulo: `Ata do conselho: ${sessao.tema}`, assunto: `conselho ${sessao.id}`, produtor: "Aceleriq OS, Conselho de agentes" });
}

/** Nome do arquivo: ata-conselho-2026-09-30-tema.pdf, sem acento nem espaço. */
export function nomeDoPdfDaAta(sessao: Pick<SessaoDoConselho, "criado_em" | "tema">): string {
  const tema = String(sessao.tema || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sessao";
  return `ata-conselho-${String(sessao.criado_em || "").slice(0, 10)}-${tema}.pdf`;
}
