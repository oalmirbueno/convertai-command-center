import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  blocosDoMetodoDoAgente,
  CHAMADAS_SEM_METODO,
  FONTES,
  fontesDoMotor,
  METODO_DOS_MOTORES,
  MOTORES,
  motoresDaFonte,
  ORIGEM_DOS_BLOCOS,
  origemDoBloco,
  SEM_BASE_DE_PROPOSITO,
  SEM_METODO_DE_PROPOSITO,
  SKILLS_MARKETINGSKILLS,
  SKILLS_SUPERPOWERS,
  skillsDoMotor,
  SUPERPODERES_DOS_AGENTES,
  VERSAO_DOS_MOTORES,
} from "../../supabase/functions/_shared/motores";
import { AGENTES_COM_SUPERPODERES, SKILL_DE_ORIGEM, VERSAO_DOS_SUPERPODERES } from "../../supabase/functions/_shared/superpoderes-catalogo";
import * as REPOS from "../../supabase/functions/_shared/conhecimento-repositorios";
import { CHECKLIST_CRIATIVO_POR_OBJETIVO } from "../../supabase/functions/_shared/conhecimento-especialistas-ads";

/**
 * Frente W (25/09/2026): o índice único dos motores (_shared/motores.ts) é uma
 * promessa. Este teste cobra que cada agente recebe de verdade o conhecimento
 * que o índice diz (queixa real do dono: "o agente não usa as técnicas").
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const OBJETIVOS: unknown[] = [undefined, ...Object.keys(CHECKLIST_CRIATIVO_POR_OBJETIVO), { id: "vendas" }, "qualquer"];

describe("cada motor recebe o que o índice promete", () => {
  it("os blocos prometidos entram inteiros, com qualquer objetivo, e dentro do teto", () => {
    for (const m of MOTORES) {
      for (const objetivo of OBJETIVOS) {
        const k = m.montar(objetivo);
        for (const b of m.promete) expect(k.ids, `${m.id} / ${String(objetivo)} / ${b}`).toContain(b);
        expect(k.tamanho, m.id).toBeLessThanOrEqual(k.teto);
        expect(k.texto.length, m.id).toBeGreaterThan(0);
      }
    }
  });

  it("o texto de cada bloco novo chega igual ao prompt (nada cortado no meio)", () => {
    const porId: Record<string, string> = {
      matriz_de_ganchos: REPOS.MATRIZ_DE_GANCHOS,
      portfolio_de_estaticos: REPOS.PORTFOLIO_DE_ESTATICOS,
      fontes_do_criativo: REPOS.FONTES_DO_CRIATIVO,
      meta_na_pratica: REPOS.META_NA_PRATICA,
      psicologia_do_comprador: REPOS.PSICOLOGIA_DO_COMPRADOR,
      revisao_em_sete_passadas: REPOS.REVISAO_EM_SETE_PASSADAS,
      briefing_antes_de_criar: REPOS.BRIEFING_ANTES_DE_CRIAR,
      contexto_de_marketing: REPOS.CONTEXTO_DE_MARKETING,
      pesquisa_de_cliente: REPOS.PESQUISA_DE_CLIENTE,
      lancamento_e_isca: REPOS.LANCAMENTO_E_ISCA,
      estrategia_de_conteudo: REPOS.ESTRATEGIA_DE_CONTEUDO,
      foto_de_produto_com_verdade: REPOS.FOTO_DE_PRODUTO_COM_VERDADE,
      imagem_e_titulo: REPOS.IMAGEM_E_TITULO,
    };
    for (const [id, texto] of Object.entries(porId)) {
      const donos = MOTORES.filter((m) => m.promete.includes(id));
      expect(donos.length, `${id} tem motor`).toBeGreaterThan(0);
      for (const m of donos) expect(m.montar().texto, `${m.id} / ${id}`).toContain(texto);
    }
  });

  it("todo bloco que algum motor monta tem origem registrada", () => {
    for (const m of MOTORES) {
      for (const objetivo of OBJETIVOS) {
        for (const id of m.montar(objetivo).ids) expect(origemDoBloco(id), `${m.id}: ${id}`).not.toBeNull();
      }
    }
  });

  it("a função da mesa chama a montagem e põe o texto no sistema (trechos no código)", () => {
    for (const m of MOTORES) {
      const fonte = ler(m.ligacao.arquivo);
      for (const t of m.ligacao.trechos) expect(fonte, `${m.id}: ${t}`).toContain(t);
    }
  });

  it("ids de motor únicos e cada motor diz sua base principal", () => {
    const ids = MOTORES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MOTORES) expect(m.bases.length, m.id).toBeGreaterThan(0);
  });
});

describe("skills e repositórios chegam a algum prompt", () => {
  it("toda skill do marketingskills está mapeada e a integrada tem bloco prometido por um motor", () => {
    expect(Object.keys(SKILLS_MARKETINGSKILLS).length).toBe(50);
    for (const [skill, s] of Object.entries(SKILLS_MARKETINGSKILLS)) {
      expect(s.nota.length, skill).toBeGreaterThan(0);
      if (s.estado !== "integrado") {
        expect(s.blocos, skill).toEqual([]);
        continue;
      }
      expect(s.blocos.length, skill).toBeGreaterThan(0);
      for (const b of s.blocos) {
        expect(origemDoBloco(b)?.skills, `${skill} -> ${b}`).toContain(skill);
        expect(MOTORES.some((m) => m.promete.includes(b)), `${skill} -> ${b} chega a um motor`).toBe(true);
      }
    }
  });

  it("repositório integrado ou parcial alcança pelo menos um motor; os que não se aplicam não alcançam", () => {
    for (const f of Object.values(FONTES)) {
      const alcance = motoresDaFonte(f.id);
      if (f.estado === "integrado" || f.estado === "parcial") {
        // A biblioteca de prompts da Mesa Foto (YouMind) chega pelo dado escolhido pela equipe, não por bloco.
        if (f.id === "nano_banana_pro_youmind") continue;
        expect(alcance.length, f.id).toBeGreaterThan(0);
      } else {
        expect(alcance, f.id).toEqual([]);
      }
      expect(f.licenca.length, f.id).toBeGreaterThan(0);
    }
  });

  it("as consultas do índice respondem por motor", () => {
    expect(skillsDoMotor("mesa_ads.copy")).toEqual(expect.arrayContaining(["ad-creative", "marketing-psychology", "copy-editing"]));
    expect(skillsDoMotor("estudio.legenda")).toContain("copy-editing");
    expect(skillsDoMotor("contexto")).toEqual(expect.arrayContaining(["product-marketing", "customer-research"]));
    expect(fontesDoMotor("mesa_foto.diretor")).toEqual(expect.arrayContaining(["foto_de_produto_jeremygdm", "gpt_image_2_evolink"]));
    expect(fontesDoMotor("mesa_ads.senior")).toEqual(expect.arrayContaining(["especialistas", "marketingskills"]));
    expect(motoresDaFonte("advertising_ops")).toEqual(expect.arrayContaining(["mesa_ads.oferta", "mesa_ads.copy"]));
  });
});

describe("limites e decisões que não podem voltar atrás", () => {
  it("o texto ao gerador de imagem do Estúdio continua sem base de marketing", () => {
    const direcao = ler("supabase/functions/_shared/direcao-arte.ts");
    for (const proibido of ["conhecimento-repositorios", "conhecimento-dos-agentes", "motores.ts"]) expect(direcao).not.toContain(proibido);
    expect(SEM_BASE_DE_PROPOSITO["estudio.gerador"]).toContain("promptDaLamina");
  });

  it("diretor e variações da Mesa Foto recebem só a técnica de foto, sem marketing", () => {
    const foto = ler("supabase/functions/mesa-foto/index.ts");
    const constante = (nome: string) => new RegExp(`const ${nome} = \`([\\s\\S]*?)\`;`).exec(foto)?.[1] ?? "";
    for (const s of ["SISTEMA_DIRETOR", "SISTEMA_VARIACOES"]) {
      const corpo = constante(s);
      expect(corpo, s).toContain("${REGRAS_DA_CASA}\n${TECNICA_DA_FOTO}\nResponda só com o JSON pedido.");
      expect(corpo, s).not.toContain("CONHECIMENTO_DA_FOTO");
    }
    const k = MOTORES.find((m) => m.id === "mesa_foto.diretor")!.montar();
    expect(k.ids).toEqual(["foto_de_produto_com_verdade"]);
    expect(k.texto.startsWith("PRIORIDADE")).toBe(false);
  });

  it("os módulos novos não têm travessão nem número de resultado prometido", () => {
    for (const p of ["supabase/functions/_shared/conhecimento-repositorios.ts", "supabase/functions/_shared/motores.ts"]) {
      expect(ler(p), p).not.toMatch(/[—–]/);
    }
    for (const [nome, v] of Object.entries(REPOS)) {
      if (typeof v !== "string" || nome.startsWith("VERSAO")) continue;
      expect(v, nome).not.toMatch(/[—–]/);
      // Leitura de mercado sem promessa de ganho em porcentagem.
      expect(v, nome).not.toMatch(/\d+\s?%\s*(de|a mais|mais)\s*(convers|lucro|venda|ROAS)/i);
    }
  });
});

// ------------------------------------------------------------------ frente SPP (30/09): superpoderes

describe("superpoderes: o método da casa em todas as mesas (frente SPP)", () => {
  it("as 15 skills de obra/superpowers v6.4.2 estão mapeadas, e a que vira método tem bloco com origem", () => {
    const nomes = Object.keys(SKILLS_SUPERPOWERS);
    expect(nomes).toHaveLength(15);
    expect(nomes.slice().sort()).toEqual([
      "brainstorming", "diagnosing-superpowers", "dispatching-parallel-agents", "executing-plans", "finishing-a-development-branch",
      "receiving-code-review", "requesting-code-review", "subagent-driven-development", "systematic-debugging", "test-driven-development",
      "using-git-worktrees", "using-superpowers", "verification-before-completion", "writing-plans", "writing-skills",
    ]);
    for (const [skill, s] of Object.entries(SKILLS_SUPERPOWERS)) {
      expect(s.onde.length && s.como.length, skill).toBeTruthy();
      if (s.estado !== "metodo") {
        expect(s.blocos, skill).toEqual([]);
        continue;
      }
      expect(s.blocos.length, skill).toBeGreaterThan(0);
      for (const b of s.blocos) expect(origemDoBloco(b)?.skills, `${skill} -> ${b}`).toContain(skill);
    }
    expect(VERSAO_DOS_MOTORES).toContain(VERSAO_DOS_SUPERPODERES);
  });

  it("os blocos sp_* vêm do catálogo, com a fonte superpowers (MIT) e a skill de origem", () => {
    const ids = ["sp_abertura", "sp_entender", "sp_plano", "sp_prova", "sp_causa", "sp_receber", "sp_revisor", "sp_aceite", "sp_frentes"];
    for (const id of ids) {
      expect(ORIGEM_DOS_BLOCOS[id], id).toBeDefined();
      expect(ORIGEM_DOS_BLOCOS[id].modulo).toBe("superpoderes-catalogo.ts");
      expect(ORIGEM_DOS_BLOCOS[id].fontes).toEqual(["superpowers"]);
    }
    expect(ORIGEM_DOS_BLOCOS.sp_prova.skills).toEqual(SKILL_DE_ORIGEM.prova);
    expect(FONTES.superpowers.licenca).toBe("MIT (Copyright (c) 2025 Jesse Vincent)");
    expect(FONTES.superpowers.estado).toBe("integrado");
  });

  it("um registro por agente do catálogo, todos com a ligação no código (trechos existem em cada arquivo)", () => {
    expect(SUPERPODERES_DOS_AGENTES.map((a) => a.id)).toEqual(AGENTES_COM_SUPERPODERES.map((a) => a.id));
    expect(new Set(SUPERPODERES_DOS_AGENTES.map((a) => a.id)).size).toBe(SUPERPODERES_DOS_AGENTES.length);
    for (const a of SUPERPODERES_DOS_AGENTES) {
      expect(a.ligacao.arquivo, a.id).toMatch(/^supabase\/functions\//);
      expect(a.ligacao.trechos.length, a.id).toBeGreaterThan(0);
      for (const l of [a.ligacao, ...(a.mais || [])]) {
        const fonte = ler(l.arquivo);
        expect(fonte, `${a.id}: ${l.arquivo} importa o método`).toMatch(/from "\.\.?\/(_shared\/)?superpoderes(-catalogo)?\.ts"/);
        for (const t of l.trechos) expect(fonte, `${a.id}: ${t}`).toContain(t);
      }
      expect(a.metodos, a.id).toContain("prova");
    }
  });

  it("todas as mesas, inclusive as que estão fora de MOTORES, recebem o método", () => {
    const funcoes = new Set(SUPERPODERES_DOS_AGENTES.map((a) => a.funcao));
    for (const f of ["mesa-instagram", "mesa-videos", "editor-video", "mesa-proposta", "contratos", "mesa-identidade", "mesa-site", "mesa-motion", "briefing-agente", "documentos", "preencher-ia", "workspace-agent", "voice-assistant-agent", "agente-central", "conselho"]) {
      expect(funcoes.has(f), f).toBe(true);
    }
    // Revisão 30/09: cada MOTOR (e não só a função dele) tem quem leve o método: um agente do catálogo da mesma
    // função ou uma entrada de SEM_METODO_DE_PROPOSITO. Antes, o "montar contexto" passava por causa da conversa.
    expect(Object.keys(METODO_DOS_MOTORES).sort()).toEqual(MOTORES.map((m) => m.id).sort());
    for (const m of MOTORES) {
      const quem = METODO_DOS_MOTORES[m.id] || [];
      expect(quem.length, m.id).toBeGreaterThan(0);
      for (const id of quem) {
        const agente = AGENTES_COM_SUPERPODERES.find((a) => a.id === id);
        if (agente) expect(agente.funcao, `${m.id} -> ${id}`).toBe(m.funcao);
        else expect(SEM_METODO_DE_PROPOSITO[id], `${m.id} -> ${id} (nem agente nem exclusão)`).toBeTruthy();
      }
    }
    // A fonte superpowers alcança cada agente (pelos blocos sp_* que ele pode receber).
    const alcance = motoresDaFonte("superpowers");
    for (const a of SUPERPODERES_DOS_AGENTES) {
      expect(alcance, a.id).toContain(`superpoderes.${a.id}`);
      expect(blocosDoMetodoDoAgente(a.id), a.id).toEqual(expect.arrayContaining(["sp_abertura", "sp_prova"]));
    }
  });

  it("sem método de propósito: gerador de imagem, leitores e conferências da Mesa Foto, legenda e a escreverCena", () => {
    for (const k of ["estudio.gerador", "estudio.legenda", "mesa_foto.diretor_e_variacoes", "mesa_foto.leitores_e_conferencias", "leituras", "motion.cena", "mcp", "jev"]) {
      expect(SEM_METODO_DE_PROPOSITO[k], k).toBeTruthy();
    }
    // Nenhum import do método das mesas no gerador, no escritor de cenas e nos leitores da Mesa Foto. Revisão
    // 30/09: cobra o import (e a chamada), não a palavra: o escritor de cenas tem o METODO_DA_CENA próprio da
    // frente SPM, que cita "superpoderes da casa" no texto. O Canvas saiu da lista: o agente dele conversa com a
    // equipe e recebe o método (foto.canvas); a conferência do Canvas segue sem (CHAMADAS_SEM_METODO).
    for (const p of [
      "supabase/functions/_shared/direcao-arte.ts",
      "supabase/functions/_shared/cena-hf.ts",
      "supabase/functions/mesa-foto/clones.ts",
      "supabase/functions/mesa-foto/modelos.ts",
      "supabase/functions/mesa-foto/book.ts",
      "supabase/functions/mesa-foto/diretor.ts",
    ]) {
      expect(ler(p), p).not.toMatch(/from\s+["'][^"']*superpoderes(-catalogo)?(\.ts)?["']/);
      expect(ler(p), p).not.toContain("superpoderesPara(");
    }
    expect(Object.keys(CHAMADAS_SEM_METODO)).not.toContain("mesa-foto/canvas.ts#canvasAgente");
    expect(CHAMADAS_SEM_METODO["mesa-foto/canvas.ts#canvasConferir"]).toBe("mesa_foto.leitores_e_conferencias");
    // A chamada de cada um, dentro de arquivos que têm agente com método, segue sem o campo.
    const semMetodoNaChamada = (arquivo: string, marcador: string) => {
      const fonte = ler(arquivo);
      const i = fonte.indexOf(marcador);
      expect(i, `${arquivo}: ${marcador}`).toBeGreaterThan(0);
      const ini = fonte.lastIndexOf("chamarTexto({", i);
      const fim = fonte.indexOf("});", i);
      return fonte.slice(ini, fim);
    };
    for (const s of ["sistema: `${SISTEMA_DIRETOR}", "sistema: `${SISTEMA_VARIACOES}"]) {
      expect(semMetodoNaChamada("supabase/functions/mesa-foto/index.ts", s), s).not.toContain("metodo:");
    }
    expect(semMetodoNaChamada("supabase/functions/estudio-arte/index.ts", "sistema: `${CONHECIMENTO_DA_LEGENDA}")).not.toContain("metodo:");
    const motion = ler("supabase/functions/mesa-motion/index.ts");
    const ini = motion.indexOf("async function escreverCena(");
    const cena = motion.slice(ini, motion.indexOf("\nasync function ", ini + 10));
    expect(cena).toContain("chamarTexto({");
    expect(cena).not.toContain("metodo:");
    expect(cena).not.toContain("superpoderesPara(");
    // O gerador de imagem não tem o campo.
    const motor = ler("supabase/functions/_shared/ia-motor.ts");
    const imagem = motor.slice(motor.indexOf("export type EntradaImagem = {"), motor.indexOf("export type SaidaImagem"));
    expect(imagem).not.toContain("metodo");
  });

  it("toda chamada ao modelo de texto nas funções passa `metodo` ou está na lista de exclusão com o porquê", () => {
    const chamadas = chamadasAoModelo();
    // 30/09: cerca de 130 chamadas em 38 arquivos; o varredor precisa enxergar todas.
    expect(chamadas.length).toBeGreaterThanOrEqual(120);
    const semMetodo = chamadas.filter((c) => c.metodo === "nao");
    const fora = semMetodo.filter((c) => !CHAMADAS_SEM_METODO[c.chave]).map((c) => `${c.chave} (linha ${c.linha})`);
    expect(fora, "chamada sem metodo e fora de CHAMADAS_SEM_METODO").toEqual([]);
    // Cada exclusão diz o porquê (uma entrada de SEM_METODO_DE_PROPOSITO) e ainda tem chamada sem o campo.
    for (const [chave, motivo] of Object.entries(CHAMADAS_SEM_METODO)) {
      expect(SEM_METODO_DE_PROPOSITO[motivo], `${chave} -> ${motivo}`).toBeTruthy();
      expect(semMetodo.some((c) => c.chave === chave), `${chave}: exclusão sem chamada (ligou o método? tire da lista)`).toBe(true);
    }
    // As que a revisão de 30/09 achou sem método agora passam o campo.
    for (const chave of [
      "agente-contexto/index.ts#montar",
      "agente-contexto/index.ts#montarDaMarca",
      "perfis-instagram/index.ts#escreverPautas",
      "mesa-foto/index.ts#campanhaPlanejar",
      "estudio-arte/index.ts#refinarTexto",
      "mesa-instagram/index.ts#bio",
      "mesa-instagram/index.ts#sugerirDestaques",
      "mesa-foto/canvas.ts#canvasAgente",
    ]) {
      const desta = chamadas.filter((c) => c.chave === chave);
      expect(desta.length, chave).toBeGreaterThan(0);
      for (const c of desta) expect(c.metodo, `${chave} (linha ${c.linha})`).toBe("sim");
    }
    // Quem repassa o pedido inteiro (...pedido) leva o metodo de quem chama, e quem chama passa.
    expect(chamadas.filter((c) => c.chamada === "chamarComTetoDeTempo").every((c) => c.metodo === "sim")).toBe(true);
  });
});

// ------------------------------------------------------------------ varredura das chamadas ao modelo (revisão 30/09)

type ChamadaAoModelo = { chave: string; linha: number; chamada: string; metodo: "sim" | "nao" | "repasse" };

/**
 * Cada chamada a chamarTexto, escreverComModeloDaCentral ou ao invólucro
 * chamarComTetoDeTempo nas Edge Functions (menos o próprio motor), com o
 * caminho da função onde mora ("arquivo#funcao/propriedade") e se o objeto
 * passa `metodo`. Objeto com `...pedido` e sem `metodo` é repasse: o campo vem
 * de quem chama o invólucro.
 */
function chamadasAoModelo(): ChamadaAoModelo[] {
  const raiz = resolve(process.cwd(), "supabase/functions");
  const alvos = ["chamarTexto", "escreverComModeloDaCentral", "chamarComTetoDeTempo"];
  const arquivos: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const p = resolve(dir, nome);
      if (statSync(p).isDirectory()) andar(p);
      else if (/\.ts$/.test(nome) && !/_test\.ts$/.test(nome) && !/\.d\.ts$/.test(nome)) arquivos.push(p);
    }
  };
  andar(raiz);
  const caminho = (no: ts.Node, f: ts.SourceFile): string => {
    const nomes: string[] = [];
    for (let x: ts.Node | undefined = no.parent; x; x = x.parent) {
      if ((ts.isFunctionDeclaration(x) || ts.isMethodDeclaration(x)) && x.name) {
        nomes.unshift(x.name.getText(f));
        break;
      }
      if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) {
        const p = x.parent;
        if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
          nomes.unshift(p.name.text);
          break;
        }
        if (p && ts.isPropertyAssignment(p)) nomes.unshift(p.name.getText(f));
        else if (p && ts.isCallExpression(p)) nomes.unshift(p.expression.getText(f).split("(")[0].slice(0, 40));
      }
    }
    return nomes.join("/") || "(topo)";
  };
  const saida: ChamadaAoModelo[] = [];
  for (const arquivo of arquivos) {
    const rel = relative(raiz, arquivo).split("\\").join("/");
    if (rel === "_shared/ia-motor.ts") continue;
    const texto = readFileSync(arquivo, "utf8");
    if (!alvos.some((a) => texto.indexOf(`${a}(`) >= 0)) continue;
    const f = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2020, true);
    const visitar = (no: ts.Node) => {
      if (ts.isCallExpression(no) && ts.isIdentifier(no.expression) && alvos.indexOf(no.expression.text) >= 0) {
        const a = no.arguments[0];
        let metodo: ChamadaAoModelo["metodo"] = "nao";
        if (a && ts.isObjectLiteralExpression(a)) {
          const nomeado = a.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText(f) === "metodo");
          metodo = nomeado ? "sim" : a.properties.some((p) => ts.isSpreadAssignment(p)) ? "repasse" : "nao";
        }
        saida.push({ chave: `${rel}#${caminho(no, f)}`, linha: f.getLineAndCharacterOfPosition(no.getStart(f)).line + 1, chamada: no.expression.text, metodo });
      }
      ts.forEachChild(no, visitar);
    };
    visitar(f);
  }
  return saida;
}
