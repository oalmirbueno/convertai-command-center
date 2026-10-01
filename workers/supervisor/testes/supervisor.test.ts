/**
 * Frente SUP: o supervisor inteiro com workers falsos de verdade (processos Node),
 * banco, cofre e bandeja falsos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bancoFalso, CHAVE_DE_SERVICO, h, montar } from "./montagem.ts";
import { esperarAte, eventos } from "./apoio.ts";

const subiu = (dir: string) => eventos(dir).filter((e) => e.texto.startsWith("subiu"));

describe("supervisor", () => {
  it("liga só os motores desta máquina, com as chaves certas e sem chave no registro", async () => {
    const banco = bancoFalso(() => ({}), { OPENROUTER_API_KEY: "sk-or-do-painel-2222222222222222" });
    const t = montar({ motores: ["render", "navegador"], banco });
    await t.s.iniciar();
    await esperarAte(() => subiu(t.dirs.render).length === 1 && subiu(t.dirs.navegador).length === 1);
    await esperarAte(() => t.bandejas.length > 0 && t.bandejas[t.bandejas.length - 1].cor === "verde");
    assert.equal(subiu(t.dirs.codigo).length, 0, "o motor de código não roda nesta máquina");
    const linha = subiu(t.dirs.render)[0].texto;
    assert.match(linha, /sup=1/);
    assert.ok(linha.indexOf(`openrouter=${h("sk-or-do-painel-2222222222222222")}`) >= 0, "a chave do cofre do painel vence a local");
    assert.ok(linha.indexOf(`servico=${h(CHAVE_DE_SERVICO)}`) >= 0, "a chave de serviço do cofre DPAPI desce para o worker");
    const s0 = (banco as ReturnType<typeof bancoFalso>).sinais[0];
    assert.equal(s0.hostname, "PC-TESTE");
    assert.deepEqual(s0.executores, { render: "PC-TESTE-render", codigo: "agencia-PC-TESTE", navegador: "PC-TESTE-navegador" });
    assert.equal(t.bandejas[t.bandejas.length - 1].dica, "Tudo ligado: 2 motores");
    await t.s.encerrar(0);
    assert.deepEqual(t.saidas, [0]);
    const tudo = [...t.registro.linhas, ...Object.values(t.regs).flatMap((r) => r.linhas), JSON.stringify((banco as ReturnType<typeof bancoFalso>).sinais)].join("\n");
    assert.ok(tudo.indexOf(CHAVE_DE_SERVICO) < 0 && tudo.indexOf("sk-or-do-painel") < 0 && tudo.indexOf("sk-or-local") < 0);
  });

  it("sem o cofre do painel, cai na chave local", async () => {
    const banco = bancoFalso(() => ({}));
    banco.chaves = async () => {
      throw new Error("rede");
    };
    const t = montar({ motores: ["render"], banco });
    await t.s.iniciar();
    await esperarAte(() => subiu(t.dirs.render).length === 1);
    assert.ok(subiu(t.dirs.render)[0].texto.indexOf(`openrouter=${h("sk-or-local-0000000000000000")}`) >= 0);
    assert.equal((t.s.estadoParaOPainel() as { chaves_do_painel: string }).chaves_do_painel, "indisponivel");
    await t.s.encerrar(0);
  });

  it("o painel tira um motor desta máquina: ele para com calma", async () => {
    let motores: string[] | null = null;
    const t = montar({ banco: bancoFalso(() => ({ motores })) });
    await t.s.iniciar();
    await esperarAte(() => subiu(t.dirs.codigo).length === 1 && t.s.filhos.get("codigo")!.comCanal);
    motores = ["navegador"];
    await esperarAte(() => eventos(t.dirs.codigo).some((e) => e.texto === "saiu limpo") && eventos(t.dirs.render).some((e) => e.texto === "saiu limpo"), 10_000);
    assert.deepEqual(t.s.maquina.motores, ["navegador"]);
    assert.equal(t.s.situacao("codigo"), "fora");
    await t.s.encerrar(0);
  });

  it("máquina removida no painel: para tudo, apaga o cofre e sai", async () => {
    let revogada = false;
    const t = montar({ motores: ["render"], banco: bancoFalso(() => ({ revogada })) });
    await t.s.iniciar();
    await esperarAte(() => t.s.filhos.get("render")!.comCanal);
    revogada = true;
    await esperarAte(() => t.saidas.length === 1, 10_000);
    assert.deepEqual(t.saidas, [0]);
    assert.deepEqual(t.cofre.valores, {});
    assert.equal(t.s.maquina.revogada, true);
    assert.ok(eventos(t.dirs.render).some((e) => e.texto === "saiu limpo"));
  });

  it("sem chave de serviço: nada liga e o ícone fica vermelho pedindo o pareamento", async () => {
    const t = montar({ cofre: {} });
    await t.s.iniciar();
    await esperarAte(() => t.bandejas.length > 0);
    const b = t.bandejas[t.bandejas.length - 1];
    assert.equal(b.cor, "vermelho");
    assert.match(b.dica, /parear/);
    assert.equal(subiu(t.dirs.render).length, 0);
  });

  it("pausar e retomar pelo menu; abrir o painel e os registros só por clique, com freio de 10 s", async () => {
    const t = montar({ motores: ["render"] });
    await t.s.iniciar();
    await esperarAte(() => t.s.filhos.get("render")!.comCanal);
    await t.s.acaoDaBandeja("pausar");
    await esperarAte(() => t.bandejas[t.bandejas.length - 1]?.cor === "amarelo");
    assert.equal(t.s.situacao("render"), "pausado");
    assert.equal(t.bandejas[t.bandejas.length - 1].pausado, true);
    await t.s.acaoDaBandeja("retomar");
    await esperarAte(() => subiu(t.dirs.render).length === 2);
    assert.deepEqual(t.abertos, [], "nada abriu sem clique de abrir");
    await t.s.acaoDaBandeja("abrir");
    await t.s.acaoDaBandeja("ver-estado");
    await t.s.acaoDaBandeja("registros");
    assert.deepEqual(t.abertos, ["https://painel.exemplo"], "três cliques seguidos abrem uma vez só (freio de 10 s)");
    (t.s as unknown as { ultimaAbertura: number }).ultimaAbertura = Date.now() - 11_000;
    await t.s.acaoDaBandeja("ver-estado");
    (t.s as unknown as { ultimaAbertura: number }).ultimaAbertura = Date.now() - 11_000;
    await t.s.acaoDaBandeja("registros");
    assert.deepEqual(t.abertos, ["https://painel.exemplo", "https://painel.exemplo/config?motores=1", t.c.logs]);
    await t.s.encerrar(0);
  });

  it("o controle local (instalador, testes) nunca abre navegador, nem pedindo estado em laço", async () => {
    const t = montar({ motores: ["render"] });
    await t.s.iniciar();
    await esperarAte(() => t.s.filhos.get("render")!.comCanal);
    for (let i = 0; i < 50; i++) {
      const e = (await t.s.comando("estado")) as { motores: Record<string, { situacao: string }> };
      assert.equal(e.motores.render.situacao, "ligado");
    }
    await t.s.comando("atualizar");
    await t.s.comando("reiniciar");
    await esperarAte(() => subiu(t.dirs.render).length === 2);
    assert.deepEqual(t.abertos, [], "nenhuma abertura sem clique no menu");
    assert.ok(!t.registro.linhas.some((l) => /pedido: estado/.test(l)), "estado nem vai para o registro (é só leitura)");
    await t.s.encerrar(0);
    assert.deepEqual(t.abertos, [], "nem ao sair");
  });

  it("um motor que cai 3 vezes deixa o ícone vermelho com o motivo", async () => {
    const t = montar({ motores: ["navegador"], comportamento: { navegador: { modo: "cai" } } });
    await t.s.iniciar();
    await esperarAte(() => t.s.filhos.get("navegador")!.quedasSeguidas >= 3, 10_000);
    await esperarAte(() => t.bandejas[t.bandejas.length - 1]?.cor === "vermelho");
    assert.match(t.bandejas[t.bandejas.length - 1].dica, /navegador do agente caindo ao subir/);
    await t.s.encerrar(0);
  });
});
