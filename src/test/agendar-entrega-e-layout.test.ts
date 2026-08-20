import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canDeliverAutomatically } from "@/lib/editorialScheduler";
import { editorialErrorMessage } from "@/lib/editorialErrorMessage";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const dialogo = ler("src/components/editorial/EditorialScheduleDialog.tsx");
const editor = ler("src/components/editorial/EditorialEditor.tsx");
const picker = ler("src/components/editorial/ApprovedMediaPicker.tsx");

/**
 * O dono escolheu conteúdo, conta e horário no celular e recebeu, em inglês:
 * "automatic delivery requires an enabled official connection".
 *
 * O gate do banco está certo — entrega automática exige conexão oficial com
 * automação LIGADA. Errado estava o app, que declarava "automatic" olhando
 * só a quantidade de arquivos. A conta do Verzelo está conectada, com token
 * válido, e automation_enabled = false: agendar ficou impossível em vez de
 * simplesmente cair para envio manual.
 */

describe("a entrega automática só é declarada quando a conta permite", () => {
  it("conta sem automação agenda como manual, não falha", () => {
    expect(canDeliverAutomatically(["a"], false)).toBe(false);
  });

  it("conta com automação segue automática dentro do limite", () => {
    expect(canDeliverAutomatically(["a"], true)).toBe(true);
  });

  it("o limite de arquivos da Meta continua valendo", () => {
    const onze = Array.from({ length: 11 }, (_, i) => String(i));
    expect(canDeliverAutomatically(onze, true)).toBe(false);
  });

  it("sem arquivo nenhum não é automática", () => {
    expect(canDeliverAutomatically([], true)).toBe(false);
  });

  it("estado desconhecido preserva o comportamento anterior", () => {
    // Quem ainda não informa o estado da conta decide pela contagem.
    expect(canDeliverAutomatically(["a"])).toBe(true);
  });
});

describe("as duas telas informam o estado real da conta", () => {
  it("o diálogo monta o mapa de automação por conta", () => {
    expect(dialogo).toContain("automacaoPorConta");
    expect(dialogo).toContain('account.connection_status === "connected"');
    expect(dialogo).toContain("account.automation_enabled === true");
  });

  it("os dois caminhos de alvo passam automationReady", () => {
    // Publicação existente e publicação nova: faltar um deixaria o bug vivo
    // pela metade.
    const ocorrencias = dialogo.match(/automationReady: automacaoPorConta\.get\(accountId\) === true/g) || [];
    expect(ocorrencias.length).toBe(2);
  });

  it("o editor também consulta a conta antes de declarar automática", () => {
    expect(editor).toContain("account.automation_enabled === true");
  });
});

describe("o erro fala português e diz o que fazer", () => {
  it("conexão sem automação explica a saída", () => {
    const msg = editorialErrorMessage(
      new Error("automatic delivery requires an enabled official connection"),
      "fallback",
    );
    expect(msg).toContain("publicação automática");
    expect(msg).toContain("Contas");
    expect(msg).not.toContain("automatic delivery");
  });

  it("arquivo ainda processando vira instrução de esperar", () => {
    const msg = editorialErrorMessage(
      new Error("automatic delivery requires sha256 for every approved asset"),
      "fallback",
    );
    expect(msg).toContain("sendo processado");
  });
});

describe("o card do conteúdo escolhido cabe no celular", () => {
  it("mostra a ARTE, não um ícone genérico", () => {
    // Com um clipe de papel, quem confere no celular precisava ler o nome do
    // arquivo para ter certeza de que era a peça certa.
    expect(dialogo).toContain("<AssetPreview asset={selectedAsset} />");
    expect(picker).toContain("export function AssetPreview");
  });

  it("o nome ocupa duas linhas em vez de virar reticências", () => {
    const card = dialogo.slice(dialogo.indexOf("Conteúdo escolhido"));
    expect(card).toContain("line-clamp-2");
  });

  it("os botões empilham no aparelho estreito", () => {
    expect(dialogo).toContain("grid-cols-1 gap-2 min-[380px]:grid-cols-2");
  });

  it("a lista de prontos rola sozinha, sem empurrar o botão de agendar", () => {
    // São 37 conteúdos disponíveis: sem rolagem própria, o diálogo crescia e
    // a ação principal saía da tela.
    expect(dialogo).toContain("max-h-[300px] gap-2 overflow-y-auto");
  });
});
