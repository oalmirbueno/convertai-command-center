import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  etapasDoServico, resumoDoTime, servicosDoCliente, temEtapasProprias,
} from "@/lib/servicosCliente";

const raiz = resolve(__dirname, "../..");
const ler = (caminho: string) => readFileSync(resolve(raiz, caminho), "utf8");
const ciclo = ler("src/pages/AdminCiclo.tsx");
const folha = ler("src/components/ciclo/ClientCycleSheet.tsx");
const extras = ler("src/lib/cycleExtras.ts");
const entrega = ler("src/lib/entregaAvulsa.ts");

/**
 * Cliente avulso não tem semana que se repete — tem UMA entrega, do serviço
 * dele. A folha mostrava a ele as seis etapas de social media, que descrevem
 * rotina de contrato correndo e não eram o trabalho dele.
 */

// Espelha um avulso real da carteira: Ajenda, que tem quatro serviços.
const ajenda = { services_config: { copywriting: true, design: true, seo: true, site: true } };

describe("o cadastro guarda serviço junto com bandeira de controle", () => {
  it("só devolve serviço vendido", () => {
    expect(servicosDoCliente(ajenda)).toEqual(["design", "copywriting", "site", "seo"].sort((a, b) =>
      servicosDoCliente(ajenda).indexOf(a) - servicosDoCliente(ajenda).indexOf(b)));
    expect(servicosDoCliente(ajenda).sort()).toEqual(["copywriting", "design", "seo", "site"]);
  });

  it("bandeira de controle não vira serviço", () => {
    // Estas chaves convivem com os serviços no mesmo objeto e apareceriam
    // como "serviço contratado" se a leitura fosse do objeto inteiro.
    const comBandeiras = {
      services_config: {
        site: true,
        internal_company: true,
        one_off_done: true,
        cobranca: true,
        ciclo_extra: ["social"],
        finance_boxes: { a: 1 },
      },
    };
    expect(servicosDoCliente(comBandeiras)).toEqual(["site"]);
  });

  it("serviço desmarcado ou cadastro vazio não inventa nada", () => {
    expect(servicosDoCliente({ services_config: { site: false } })).toEqual([]);
    expect(servicosDoCliente({})).toEqual([]);
    expect(servicosDoCliente(null)).toEqual([]);
  });
});

describe("cada serviço tem as etapas dele", () => {
  it("site tem etapa de site, não do ciclo semanal", () => {
    const etapas = etapasDoServico("site");
    expect(etapas.length).toBeGreaterThan(0);
    expect(etapas.join(" ")).toMatch(/domínio|Layout|Estrutura/i);
    // Nada de "posts agendados" ou "verba conferida" numa entrega de site.
    expect(etapas.join(" ")).not.toMatch(/posts agendados|verba/i);
  });

  it("serviços diferentes não compartilham o mesmo trilho", () => {
    expect(etapasDoServico("site")).not.toEqual(etapasDoServico("design"));
  });

  it("serviço sem trilho desenhado devolve vazio em vez de inventar", () => {
    expect(etapasDoServico("nao_existe")).toEqual([]);
    expect(temEtapasProprias("nao_existe")).toBe(false);
    expect(temEtapasProprias("site")).toBe(true);
  });
});

describe("'O seu time é' fala a língua do cliente", () => {
  it("traduz a chave de banco em trabalho", () => {
    const texto = resumoDoTime({ services_config: { edicao_video: true } });
    expect(texto).toContain("O seu time é");
    expect(texto).toContain("edita os seus vídeos");
    // O cliente não contratou uma chave de banco.
    expect(texto).not.toContain("edicao_video");
  });

  it("junta vários com 'e' antes do último", () => {
    const texto = resumoDoTime(ajenda);
    expect(texto).toMatch(/, .+ e /);
    expect(texto.endsWith(".")).toBe(true);
  });

  it("sem serviço marcado o texto some, em vez de sair quebrado", () => {
    // "O seu time é ." em tela de cliente é pior do que ausência.
    expect(resumoDoTime({ services_config: {} })).toBe("");
    expect(resumoDoTime({ services_config: { internal_company: true } })).toBe("");
  });
});

describe("a entrega avulsa não pode morar na tabela semanal", () => {
  it("grava em project_memory e diz por quê", () => {
    // weekly_cycle_progress tem CHECK (area in ('social','trafego')) e
    // week_start na chave: a etapa concluída sumiria na virada da semana.
    expect(entrega).toContain('from("project_memory")');
    // A tabela semanal só pode ser citada na explicação, nunca consultada.
    expect(entrega).not.toContain('from("weekly_cycle_progress")');
    expect(entrega).toContain("weekly_cycle_progress");
  });

  it("desmarcar apaga em vez de gravar que não foi feito", () => {
    // Registro dizendo "não aconteceu" é ruído na história que a IA lê.
    expect(entrega).toMatch(/if \(!feito\)[\s\S]{0,200}\.delete\(\)/);
  });
});

describe("a tela do ciclo passou a contar a verdade", () => {
  it("empresa do grupo aparece na operação", () => {
    // Jalimpo, Stop Informática e AcelerIQ têm social e tráfego marcados e
    // não apareciam em frente nenhuma: a flag de cobrança escondia o trabalho.
    expect(ciclo).not.toMatch(/activeClients[\s\S]{0,400}isInternalClient\(client\)\) return false/);
  });

  it("as contagens seguem a mesma régua da lista", () => {
    // Número de aba que discorda da lista que ela abre é pior que número nenhum.
    expect(ciclo).not.toMatch(/totalAvulsos[\s\S]{0,220}!isInternalClient/);
    expect(ciclo).not.toMatch(/otherAreaTotals[\s\S]{0,220}!isInternalClient/);
    expect(ciclo).not.toMatch(/unassignedCount[\s\S]{0,260}!isInternalClient/);
  });

  it("incluir no ciclo grava o serviço no cadastro", () => {
    // Antes ia para ciclo_extra e o cadastro não sabia: a mesma informação em
    // dois lugares, e a ficha do cliente mentia.
    expect(extras).toContain("[area]: incluir");
    expect(extras).toContain("ciclo_extra: legado");
  });

  it("a aba de avulsos filtra por serviço", () => {
    expect(ciclo).toContain("servicosDosAvulsos");
    expect(ciclo).toContain("servicosDoCliente(client).includes(servicoAvulso)");
  });

  it("abrir um avulso leva a entrega do serviço, não o ciclo semanal", () => {
    expect(ciclo).toMatch(/servicoAvulso=\{[\s\S]{0,300}servicosDoCliente\(detailClient\)\[0\]/);
    expect(folha).toContain("servicoAvulso ? (");
    expect(folha).toContain("<EtapasDaEntrega");
  });
});
