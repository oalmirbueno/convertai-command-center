import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Contrato do estrategista editorial (docs/mesa-do-cliente/SPEC.md, secao 4),
// pinado no codigo-fonte da funcao agente-calendario.
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/agente-calendario/index.ts");
const config = ler("supabase/config.toml");

/** Corpo de uma funcao de topo, do cabecalho ate a proxima funcao de topo. */
function corpoDe(nome: string): string {
  const ini = fonte.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = fonte.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst ACOES/);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

describe("agente-calendario: acoes e acesso", () => {
  it("expoe exatamente as cinco acoes da SPEC", () => {
    const mapa = fonte.slice(fonte.indexOf("const ACOES"), fonte.indexOf("Deno.serve("));
    for (const acao of ["propor_temas: proporTemas", "escolher_temas: escolherTemas", "detalhar,", "conversar,", "gravar,"]) {
      expect(mapa).toContain(acao);
    }
  });

  it("so equipe, com can_access_client conferido pelo JWT de quem chamou", () => {
    expect(fonte).toContain('servico.rpc("is_staff", { _user_id: userId })');
    expect(fonte).toContain('clienteDoChamador(chamador.token).rpc("can_access_client", { _client_id: clientId })');
    for (const acao of ["proporTemas", "escolherTemas", "detalhar", "conversar", "gravar"]) {
      expect(corpoDe(acao), `${acao} confere o acesso`).toContain("await exigirAcessoAoCliente(chamador,");
    }
  });

  it("a funcao exige JWT no config.toml", () => {
    expect(config).toMatch(/\[functions\.agente-calendario\]\s*\n\s*verify_jwt = true/);
  });
});

describe("agente-calendario: contexto so com dado real", () => {
  const contexto = corpoDe("montarContexto");

  it("le dossie geral atual, movimentos de 60 dias, metricas, agenda, kit, memoria e prompt", () => {
    expect(contexto).toContain('.eq("dossier_type", "contexto").eq("is_current", true).is("project_id", null)');
    expect(contexto).toContain('servico.rpc("movimentos_do_cliente"');
    expect(contexto).toContain("60 * 86_400_000");
    expect(contexto).toContain('from("social_post_metrics")');
    expect(contexto).toContain('from("social_metrics_weekly")');
    expect(contexto).toContain("reach, saved, shares");
    expect(contexto).toContain('from("editorial_posts")');
    expect(contexto).toContain('.not("delivery_type", "is", null)');
    expect(contexto).toContain('from("cliente_kit_marca")');
    expect(contexto).toContain('from("agente_memoria")');
    expect(contexto).toContain('.eq("ativa", true)');
    expect(contexto).toContain('from("agente_prompts")');
  });

  it("prompt efetivo e o global ativo mais o complemento do cliente, e falta de global e erro", () => {
    expect(contexto).toContain("client_id.is.null,client_id.eq.");
    expect(contexto).toContain("prompt_global_ausente");
    expect(contexto).toContain("COMPLEMENTO DESTE CLIENTE");
  });
});

describe("agente-calendario: propor_temas", () => {
  const propor = corpoDe("proporTemas");

  it("pesquisa na web e pede JSON com diagnostico e temas", () => {
    expect(propor).toContain("pesquisaWeb: true");
    expect(propor).toContain("esquemaJson: ESQUEMA_TEMAS");
    expect(fonte).toContain("diagnostico: S(\"string\")");
    expect(fonte).toContain("temas: { type: \"array\", items: ESQUEMA_TEMA }");
  });

  it("raciocinio pedido prevalece; sem escolha, o mais alto do modelo padrao do estrategista", () => {
    const modelo = corpoDe("resolverModelo");
    expect(modelo).toContain("modeloPadrao(AGENTE)");
    expect(modelo).toContain("const r = explicito ?? raciocinioPadrao(");
    expect(corpoDe("raciocinioPadrao")).toContain("aceitos[aceitos.length - 1]");
  });

  it("com pesquisa na web o padrao e high, para nao estourar os 120 s do motor", () => {
    expect(corpoDe("raciocinioPadrao")).toContain('if (pesquisaWeb && aceitos.includes("high")) return "high";');
    expect(propor).toContain("resolverModelo(corpo.modelo_id, corpo.raciocinio, { pesquisaWeb: true })");
    // Detalhar e conversar nao pesquisam: seguem o padrao sem pesquisa.
    expect(corpoDe("detalhar")).not.toContain("pesquisaWeb: true");
    expect(corpoDe("conversar")).not.toContain("pesquisaWeb: true");
    // So a escolha explicita do usuario vira parametro da proposta.
    expect(propor).toContain("raciocinio: raciocinioExplicito ? raciocinio : null");
  });

  it("o Jev pontua cada tema com Score de criterios em lista ordenada", () => {
    expect(propor).toContain("pontuarTemasComJev(");
    const jev = corpoDe("pontuarTemasComJev");
    expect(jev).toContain("jevPerguntar({ state, questions })");
    expect(jev).toContain('type: "score"');
    expect(jev).toContain("criteria: NIVEIS_ADERENCIA");
    expect(jev).toContain("criteria: NIVEIS_POTENCIAL");
    expect(fonte).toMatch(/const NIVEIS_ADERENCIA = \[/);
    expect(fonte).toMatch(/const NIVEIS_POTENCIAL = \[/);
  });

  it("grava a proposta em status temas e abre a conversa com as mensagens", () => {
    expect(propor).toContain('from("calendario_propostas")');
    expect(propor).toContain('status: "temas"');
    expect(propor).toContain('from("agente_conversas")');
    expect(propor).toContain("registrarMensagens(");
  });
});

describe("agente-calendario: detalhar e conversar", () => {
  it("datas so de segunda a sexta dentro do periodo", () => {
    expect(corpoDe("ehDiaUtil")).toContain("d >= 1 && d <= 5");
    expect(corpoDe("diasUteisDoPeriodo")).toContain("ehDiaUtil(d)");
    expect(corpoDe("normalizarItem")).toContain("normalizarDataUtil(");
    expect(corpoDe("detalhar")).toContain("distribuirDatas(");
    expect(corpoDe("conversar")).toContain("normalizarItem(bruto, uteis)");
  });

  it("formato so carrossel ou estatico, e estatico tem um card", () => {
    expect(fonte).toContain('export const FORMATOS = ["carrossel", "estatico"] as const;');
    expect(fonte).toContain('formato: S("string", { enum: [...FORMATOS] })');
    expect(fonte).toContain('if (formato === "estatico") cards = cards.slice(0, 1);');
    expect(fonte).toContain('const FORMATO_PARA_ENTREGA: Record<Formato, "carousel" | "static"> = { carrossel: "carousel", estatico: "static" };');
  });

  it("itens trazem cards com ordem, funcao, texto, ilustracao e estilo, e carrossel infinito", () => {
    for (const campo of ["ordem", "funcao", "texto", "ilustracao", "estilo"]) {
      expect(fonte.slice(fonte.indexOf("const ESQUEMA_CARD"), fonte.indexOf("const ESQUEMA_ITEM"))).toContain(`${campo}:`);
    }
    const item = fonte.slice(fonte.indexOf("const ESQUEMA_ITEM"), fonte.indexOf("export const ESQUEMA_TEMAS"));
    for (const campo of ["data", "formato", "pilar", "fase", "publico", "tema", "gancho", "resumo", "copy", "cta", "objetivo", "metrica_principal", "palavra_chave", "termo_regional", "status", "tipo_conteudo", "carrossel_infinito", "cards"]) {
      expect(item).toContain(`${campo}:`);
    }
  });

  it("detalhar termina em pronta e conversar aplica a mudanca por JSON", () => {
    expect(corpoDe("detalhar")).toContain('faltam.length === 0 ? "pronta" : "detalhando"');
    const conversa = corpoDe("conversar");
    expect(conversa).toContain("esquemaJson: ESQUEMA_CONVERSA");
    expect(conversa).toContain("salvarProposta(servico, p, campos)");
    expect(conversa).toContain("registrarMensagens(");
  });
});

describe("agente-calendario: gravar", () => {
  const grava = corpoDe("gravar");

  it("usa createEditorialItem do MCP com idempotencia por proposta e item", () => {
    expect(fonte).toContain('from "../_shared/mcp-write-services.ts"');
    expect(grava).toContain("await createEditorialItem(parsed, ctx)");
    expect(grava).toContain("createEditorialItemSchema.parse(entrada)");
    expect(grava).toContain("const idempotencyKey = `mesa-cal:${p.id}:${i}`;");
    expect(grava).toContain("due_date: data");
    expect(grava).toContain("keyId: PRINCIPAL_MESA");
    expect(grava).toContain("auditLog(");
  });

  it("grava o task_id dentro de cada item, inclusive do item que ja existia", () => {
    expect(fonte).toContain("task_id?: string | null;");
    const copia = corpoDe("itensComTaskId");
    expect(copia).toContain("task_id: porIndice.get(i) ?? item.task_id ?? null");
    // O pulado por ja existir leva o id da tarefa existente.
    expect(grava).toContain('task_id: duplicado.id, situacao: "ja_existia"');
    expect(grava).toContain("const itensComTarefa = itensComTaskId(p.itens, resultado);");
    // Os dois caminhos de gravacao (parcial e completa) salvam os itens com task_id.
    expect(grava.match(/itens: itensComTarefa/g) ?? []).toHaveLength(2);
    // task_ids tambem leva as tarefas encontradas.
    expect(grava).toContain("...resultado.map((r) => r.task_id)");
  });

  it("preserva o que existe: mesmo titulo na mesma data nao duplica", () => {
    expect(grava).toContain('situacao: "ja_existia"');
    expect(grava).toContain("tituloNormal(t.title) === tituloNormal(titulo)");
  });

  it("guarda task_ids, status gravada e escreve a memoria do agente", () => {
    expect(grava).toContain("task_ids: todos");
    expect(grava).toContain('status: "gravada"');
    expect(grava).toContain("await registrarMemoriaDaEscolha(servico, p)");
    const memoria = corpoDe("registrarMemoriaDaEscolha");
    expect(memoria).toContain('from("agente_memoria").insert(linhas)');
    expect(memoria).toContain("Temas escolhidos pela equipe");
    expect(memoria).toContain("descartados pela equipe");
  });

  it("a descricao leva o item estruturado em portugues e cabe no limite", () => {
    const desc = corpoDe("descricaoDoItem");
    for (const rotulo of ["Gancho:", "Roteiro dos cards:", "Ilustração:", "Estilo:", "CTA:", "Objetivo:", "Métrica principal:", "Palavra-chave:", "Legenda (copy):"]) {
      expect(desc).toContain(rotulo);
    }
    expect(fonte).toContain("const LIMITE_DESCRICAO = 4000;");
  });
});

describe("agente-calendario: erros nunca respondem 200", () => {
  it("erros de dinheiro e chave viram 402 ou 403 com mensagem em portugues", () => {
    expect(fonte).toMatch(/saldo_insuficiente: \{ status: 402,/);
    expect(fonte).toMatch(/cota_da_chave_esgotada: \{ status: 402,/);
    expect(fonte).toMatch(/cliente_sem_chave: \{ status: 403,/);
    expect(fonte).toMatch(/provedor_sem_chave: \{ status: 403,/);
  });

  it("toda resposta de erro leva status de erro", () => {
    const erro = corpoDe("respostaDeErro");
    expect(erro).not.toMatch(/,\s*200\)/);
    expect(erro).toContain("err.status >= 400 ? err.status : 500");
    // Falha parcial tambem nao e 200.
    expect(corpoDe("gravar")).toContain('error: "gravacao_parcial"');
    expect(corpoDe("gravar")).toMatch(/erros\.length === p\.itens\.length \? 500 : 409/);
    expect(corpoDe("detalhar")).toContain("resposta.status);");
  });

  it("sem travessao no codigo", () => {
    expect(fonte).not.toMatch(new RegExp("[\\u2013\\u2014]"));
  });
});
