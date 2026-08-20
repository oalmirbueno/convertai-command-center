import { describe, expect, it } from "vitest";
import { CONTEXTO_KINDS, trechoDoContexto } from "@/lib/contextoDoCliente";
import { buildGroupMessageText, type GroupMessageContext } from "@/lib/groupMessage";

/**
 * O teste que o dono não conseguiria fazer sem abrir a tela: a mensagem do
 * grupo muda quando o dossiê muda?
 *
 * Ele relatou que a mensagem semanal saía "sempre a mesma coisa" por mais que
 * a rotina do GPT reescrevesse o dossiê pelo MCP. A causa era a leitura pegar
 * o TÍTULO do registro — um rótulo com data, igual em toda versão — em vez do
 * corpo. Aqui o caminho inteiro é exercitado: registros do banco -> escolha do
 * contexto -> trecho -> texto final da mensagem.
 */

// Os três dossiês reais do Vifut, com os títulos e horários do banco.
const DOSSIES = [
  {
    kind: "summary",
    title: "Dossiê de contexto - 18/08/2026",
    content:
      "ONDE ESTAMOS\n\nEm 18/08/2026, a operação tem três frentes em teste e o " +
      "foco da semana é a régua de conteúdo do canal principal.",
    created_at: "2026-08-18T19:56:38Z",
  },
  {
    kind: "summary",
    title: "Dossiê de contexto - 18/08/2026 - atualização",
    content:
      "ONDE ESTAMOS\n\nEm 18/08/2026, o cliente aprovou a virada de posicionamento " +
      "e pediu prioridade nos cortes verticais para a próxima semana.",
    created_at: "2026-08-18T21:01:20Z",
  },
];

const diasDesde = (iso: string, agora = new Date("2026-08-19T12:00:00Z")) =>
  Math.floor((agora.getTime() - new Date(iso).getTime()) / 86400000);

/** Reproduz a seleção que o hook faz sobre os registros do banco. */
function contextoDe(registros: typeof DOSSIES): string | null {
  const achado = registros
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .find((m) => CONTEXTO_KINDS.has(m.kind) && diasDesde(m.created_at) <= 14);
  return achado ? trechoDoContexto(achado) || null : null;
}

const base: GroupMessageContext = {
  clientName: "Vifut",
  greeting: "Bom dia",
  entregasSemana: [],
  entregasDesdeSegunda: [],
  aguardandoOk: [],
  publicadasSemana: 0,
  proximasAgendadas: [],
  cicloFeito: [],
  avulsosFeitos: [],
  frentes: [],
  pautasProntas: [],
  contextoRecente: null,
  proximoPasso: null,
  anuncios: null,
};

const mensagemCom = (registros: typeof DOSSIES) =>
  buildGroupMessageText(
    { ...base, contextoRecente: contextoDe(registros) },
    "abertura",
  );

describe("atualizar o dossiê muda a mensagem", () => {
  it("o texto do dossiê chega à mensagem", () => {
    const texto = mensagemCom(DOSSIES);
    // "Por dentro:" virou o bloco "*Onde estamos*" quando a abertura passou a
    // ter linha do tempo. O compromisso é o mesmo: o dossiê abre a mensagem.
    expect(texto).toContain("*Onde estamos*");
    expect(texto).toContain("virada de posicionamento");
  });

  it("duas versões do dossiê produzem mensagens diferentes", () => {
    // Este é o relato exato: reescrever o dossiê não mudava nada. Com a
    // leitura pelo título, as duas mensagens sairiam idênticas.
    const antes = mensagemCom([DOSSIES[0]]);
    const depois = mensagemCom(DOSSIES);
    expect(antes).not.toBe(depois);
    expect(antes).toContain("régua de conteúdo");
    expect(depois).toContain("cortes verticais");
  });

  it("vale a versão mais nova, mesmo com títulos quase iguais", () => {
    // Os dois títulos diferem só pelo sufixo "- atualização"; a ordem tem de
    // vir da data de criação.
    expect(mensagemCom(DOSSIES)).toContain("cortes verticais");
    expect(mensagemCom(DOSSIES)).not.toContain("régua de conteúdo");
  });

  it("o rótulo com data nunca aparece como se fosse contexto", () => {
    const texto = mensagemCom(DOSSIES);
    expect(texto).not.toContain("Dossiê de contexto");
  });

  it("sem dossiê a mensagem sai sem a linha, em vez de sair quebrada", () => {
    const texto = buildGroupMessageText({ ...base, contextoRecente: null }, "abertura");
    expect(texto).not.toContain("*Onde estamos*");
    expect(texto.length).toBeGreaterThan(0);
  });

  it("dossiê antigo demais não é apresentado como novidade da semana", () => {
    const velho = [{ ...DOSSIES[0], created_at: "2026-06-01T10:00:00Z" }];
    expect(contextoDe(velho)).toBeNull();
  });
});
