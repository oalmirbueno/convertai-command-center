import { normalizarRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import type { DocumentoDeRoteiros, ItemDoPdf } from "../../../supabase/functions/_shared/pdf-roteiro";

/**
 * Casos fixos do PDF da Mesa Roteiros (Frente DOC, 29/09/2026). Os bytes
 * desses casos foram gerados ANTES de extrair as primitivas para
 * _shared/pdf-base.ts; o SHA-256 de cada um fica em pdf-base.test.ts e prova
 * que o PDF do Roteiro saiu igual, byte a byte, depois da extração.
 */

const base = normalizarRoteiro({
  titulo: "Salário-maternidade",
  subtitulo: "Estou desempregada e agora?",
  tipo: "fala_camera",
  ganchos: [
    { texto: "Estou grávida e sem emprego. Tenho direito ao salário-maternidade?", mecanismo: "pergunta concreta" },
    { texto: "Perdeu o emprego grávida? Ainda pode haver proteção.", mecanismo: "contraste" },
    { texto: "A data em que você saiu do emprego muda tudo.", mecanismo: "resultado primeiro" },
  ],
  blocos: [
    { funcao: "Abertura", fala: "Estou grávida e sem emprego. Tenho direito ao salário-maternidade?", segundos: 6, visual: "Sentada, peito para cima", texto_na_tela: "Grávida e sem emprego?" },
    { funcao: "Resposta", fala: "Não necessariamente. Mesmo depois de sair do emprego, você pode continuar protegida pelo INSS.", segundos: 8, visual: "Aproximar" },
    { funcao: "Explicação", fala: "Isso se chama período de graça. É preciso conferir as contribuições e as datas.", segundos: 10, visual: "Gesto leve", broll: "Agenda sem dados pessoais" },
    { funcao: "Fechamento", fala: "Salve para consultar depois. 🤰 “Aspas” … – (parênteses) \ barra", segundos: 5, visual: "Expressão acolhedora" },
  ],
  direcao: { enquadramento: "Peito para cima", ambiente: "Sentada à mesa", luz: "Janela a 45 graus", figurino: "Blazer claro", objetos: "Caneca", orientacoes: ["Olhar firme na lente.", "Pausa entre blocos."] },
  broll: ["Abrindo uma agenda sem dados pessoais"],
  cta: "Salve para consultar depois.",
  legenda: "Grávida e sem emprego? Você pode continuar protegida pelo INSS.",
  hashtags: ["inss", "maternidade"],
  pendencias: ["Conferir o prazo do período de graça."],
  fontes: ["Contexto do cliente", "Lei 8.213/91"],
});

const longa = Array.from({ length: 180 }, (_, i) => `palavra${i}`).join(" ");
const grande = normalizarRoteiro({
  ...base,
  titulo: "Vídeo longo com título que ocupa bem mais que uma linha inteira da página do documento",
  blocos: [...base.blocos, { funcao: "Detalhe", fala: longa, segundos: 60, visual: "x" }, { funcao: "Outro", fala: longa, segundos: 60, visual: "y" }],
  legenda: Array.from({ length: 90 }, (_, i) => `legenda${i}`).join(" "),
});
const cinema = normalizarRoteiro({ ...base, tipo: "cinema", titulo: "Cena única", logline: "Uma advogada descobre o prazo." });
const tutorial = normalizarRoteiro({ ...base, tipo: "tutorial", titulo: "Passo a passo", formato: "16:9" });

const it = (r: typeof base, status: ItemDoPdf["status"], versao: number, hash: string, agenda?: ItemDoPdf["agenda"]): ItemDoPdf => ({ roteiro: r, versao, hash, status, agenda });

export const CASOS_DO_PDF_DO_ROTEIRO: Array<{ nome: string; doc: DocumentoDeRoteiros }> = [
  { nome: "um-aprovado", doc: { cliente: "Thainá Lima Rosa Advogada", itens: [it(base, "aprovado", 3, "abc123")], data: "2026-09-26T12:00:00Z", assinatura: "OAB/PR 12.345" } },
  { nome: "rascunho", doc: { cliente: "Cliente (Teste) \ Ação", itens: [it(base, "rascunho", 1, "h1")], data: "2026-01-05T12:00:00Z" } },
  {
    nome: "varios-e-longo",
    doc: {
      cliente: "Loja do Bairro com um nome bem comprido para cortar no cabeçalho da página",
      itens: [it(base, "aprovado", 2, "h2", { titulo: "Pauta de terça", data: "2026-10-01" }), it(grande, "rascunho", 4, "h4"), it(base, "gravado", 5, "h5"), it(cinema, "aprovado", 1, "c1"), it(tutorial, "aprovado", 1, "t1")],
      data: "2026-12-31T12:00:00Z",
    },
  },
  { nome: "so-cinema", doc: { cliente: "Estúdio", itens: [it(cinema, "gravado", 7, "c7")], data: "2026-03-15T12:00:00Z" } },
];
