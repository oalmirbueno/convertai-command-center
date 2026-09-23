import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Contrato da funcao estudio-arte (docs/mesa-do-cliente/SPEC.md, secao 5).
// Regra do dono: o gerador desenha a lamina inteira, texto incluido; nunca
// texto em camada por cima; ajuste e edicao dentro do gerador.
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/estudio-arte/index.ts");
const config = ler("supabase/config.toml");

/** Corpo de uma funcao de topo, do cabecalho ate a proxima funcao de topo. */
function corpoDe(nome: string): string {
  const ini = fonte.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = fonte.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst [A-Z_]+ = /);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

describe("estudio-arte: a lamina inteira sai do gerador", () => {
  it("nao tem codigo de composicao nem de texto em camada", () => {
    for (const proibido of [
      /\bfillText\b/,
      /\bstrokeText\b/,
      /getContext\(/,
      /OffscreenCanvas/,
      /createCanvas/,
      /npm:canvas|skia|imagescript|npm:sharp|jimp|resvg|satori/i,
      /\bcomposite\b/i,
      /drawImage\(/,
      /<svg/i,
    ]) {
      expect(fonte, `proibido: ${proibido}`).not.toMatch(proibido);
    }
  });

  it("o prompt do gerador exige o texto exato desenhado pela propria arte", () => {
    const regras = corpoDe("regrasDeRender");
    expect(regras).toContain("REGRA_TEXTO_NA_ARTE");
    expect(regras).toContain('nenhum outro texto: "${card.texto_exato}"');
    expect(fonte).toMatch(/Todo o texto é desenhado pela própria arte/);
  });

  it("gera direto em 4:5 (2:3 so para direcao antiga, sem layout) e logo so na capa e no final", () => {
    expect(fonte).toContain("const TAMANHO_GERADOR = TAMANHO_4X5;");
    expect(corpoDe("gerarCard")).toContain("tamanho: card.layout ? TAMANHO_GERADOR : TAMANHO_2X3,");
    expect(corpoDe("gerarCard")).toContain("promptSe2x3: card.layout ? formatoPara2x3(prompt) : undefined,");
    expect(fonte).toContain("const levaLogo = (t: Trabalho, ordem: number) => ordem === 1 || ordem === totalCards(t);");
  });

  it("direcao antiga (sem layout) continua com a area util 4:5 central da tela 2:3", () => {
    const regras = corpoDe("regrasDeRender");
    expect(regras).toContain("const formatoAntigo = !card.layout;");
    expect(regras).toContain("ÁREA ÚTIL: todo o texto, a logo e os elementos importantes ficam DENTRO da área central de 1024 x 1280 (de y = 128 a y = 1408)");
  });

  it("logo so vai no prompt quando o arquivo existe (sem anexo o gerador inventaria uma)", () => {
    const gerar = corpoDe("gerarCard");
    expect(gerar).toContain("let comLogo = false;");
    expect(gerar).toContain("marca.temLogo = comLogo;");
  });

  it("qualidade padrao media (US$ 0,01 por lamina contra US$ 0,04 da alta)", () => {
    expect(fonte).toContain('const QUALIDADE_PADRAO: Qualidade = "media";');
  });

  it("o roteiro da proposta e achado so pelo task_id do item", () => {
    const item = corpoDe("lerItemDaAgenda");
    expect(item).toContain("i.task_id === taskId");
    expect(item).not.toContain("indexOf(taskId)");
  });
});

describe("estudio-arte: uma lamina por chamada", () => {
  it("gerar_card recebe uma ordem inteira e recusa lista", () => {
    const ordem = corpoDe("lerOrdem");
    expect(ordem).toContain("Array.isArray(corpo.ordem)");
    expect(ordem).toContain("Number.isInteger(ordem)");
    expect(corpoDe("gerarCard")).toContain("const ordem = lerOrdem(corpo);");
  });

  it("o gerador so e chamado em gerar (foto composta, foto real, continuo ou normal, um por vez) e em ajustar, fora de laco", () => {
    // + 1 no panorama do carrossel contínuo (garantirFundoContinuo, um trecho por chamada).
    expect(fonte.match(/await chamarImagem\(/g) ?? []).toHaveLength(6);
    expect(corpoDe("garantirFundoContinuo").match(/await chamarImagem\(/g) ?? []).toHaveLength(1);
    const g = corpoDe("gerarCard");
    expect(g.match(/await chamarImagem\(/g) ?? []).toHaveLength(4);
    // Cada modo termina a chamada: foto real e continuo retornam antes do normal.
    expect(g.indexOf("if (baseFoto && elementos.length) {")).toBeLessThan(g.indexOf("if (baseFoto) {"));
    expect(g.indexOf("if (baseFoto) {")).toBeLessThan(g.indexOf("if (continuar) {"));
    expect(g.match(/return await gravarVersao\(/g) ?? []).toHaveLength(4);
    expect(corpoDe("ajustarCard").match(/await chamarImagem\(/g) ?? []).toHaveLength(1);
    // Nenhum laco envolve a chamada ao gerador.
    const gerar = corpoDe("gerarCard");
    const antes = gerar.slice(0, gerar.indexOf("await chamarImagem("));
    const abertos = (antes.match(/\bfor \(/g) ?? []).length;
    // Fontes, fotos-elemento da equipe e referências: todos fecham antes do gerador.
    expect(abertos).toBeLessThanOrEqual(3);
    expect(antes.lastIndexOf("}")).toBeGreaterThan(antes.lastIndexOf("for ("));
  });

  it("guarda no bucket mesa no caminho combinado", () => {
    expect(fonte).toContain("`${t.client_id}/estudio/${t.id}/card-${ordem}-v${versao}.png`");
    expect(corpoDe("salvarNaMesa")).toContain("upsert: false");
  });
});

describe("estudio-arte: ajuste e edicao dentro do gerador sobre a versao atual", () => {
  const ajuste = corpoDe("ajustarCard");
  it("baixa a versao atual e edita com editar", () => {
    expect(ajuste).toContain("const atualVersao = versaoAtual(t, ordem);");
    expect(ajuste).toContain('baixar("mesa", atualVersao.storage_path)');
    expect(ajuste).toContain("editar: { bytes: atual, mascara: comMascara ?");
  });

  it("ajuste por area: mascara so nas areas e os pixels de fora voltam da versao anterior", () => {
    expect(ajuste).toContain("normalizarAreas(corpo.areas)");
    expect(ajuste).toContain("devolverOriginalForaDasAreas(atual, gerado.png, abertas");
    expect(ajuste).toContain('tipo === "fundo"');
  });

  it("o diretor escreve a instrucao antes e o pedido vai para a memoria", () => {
    expect(ajuste.indexOf("await chamarTexto(")).toBeLessThan(ajuste.indexOf("await chamarImagem("));
    expect(ajuste).toContain('from("agente_memoria").insert(');
    expect(ajuste).toContain('origem: "ajuste"');
  });

  it("gerar e ajustar so gravam a versao, com a conferencia pendente", () => {
    expect(ajuste).toContain("return await gravarVersao(");
    expect(corpoDe("gerarCard")).toContain("return await gravarVersao(");
    const grava = corpoDe("gravarVersao");
    expect(grava).toContain("verificacao: { pendente: true },");
    expect(grava).toContain('proximo_passo: "conferir_card"');
    for (const corpo of [grava, corpoDe("gerarCard"), ajuste]) {
      expect(corpo).not.toContain("verificar(");
    }
  });
});

describe("estudio-arte: conferencia de ortografia e identidade", () => {
  const v = corpoDe("verificar");
  it("conferir_card e uma acao propria, com versao opcional (a atual por padrao)", () => {
    expect(fonte).toContain("conferir_card: conferirCard,");
    const c = corpoDe("conferirCard");
    expect(c).toContain("const ordem = lerOrdem(corpo);");
    expect(c).toContain("alvo = versaoAtual(t, ordem);");
    expect(c).toContain("c.ordem === ordem && c.versao === versao");
    expect(c).toContain("await verificar(ch, t, card, alvo.storage_path, kit, fontes)");
    expect(c).not.toContain("chamarImagem(");
  });

  it("a leitura e feita sobre o recorte 4:5 central, ou ignora as faixas", () => {
    expect(v).toContain("const recorte = await laminaFinal(caminho);");
    expect(v).toContain("v.leitura_no_recorte = recorte.redimensionada;");
    expect(v).toContain("ignore tudo o que estiver nas faixas de 128 px do topo e da base");
  });

  it("le o texto da imagem com o modelo padrao de leitura e compara com o texto_exato", () => {
    expect(v).toContain('modeloDoPapel("leitura")');
    expect(v).toMatch(/imagens: \[\{ bytes: recorte\.bytes, mime/);
    expect(v).toContain("compararTexto(card.texto_exato, v.texto_lido)");
    expect(v).toContain("v.ortografia_ok = cmp.ortografia_ok;");
    expect(fonte).toContain("texto_lido: string | null;");
  });

  it("Jev da a nota de identidade com Score em lista ordenada", () => {
    expect(v).toContain("await jevPerguntar(");
    expect(v).toContain('type: "score"');
    expect(v).toContain("criteria: NIVEIS_IDENTIDADE");
  });

  it("Jev escolhe por Score uma referencia de identidade e uma de tecnica (cliente ou banco global)", () => {
    const e = corpoDe("escolherReferencias");
    expect(e).toContain("await jevPerguntar(");
    expect(e).toContain('type: "score"');
    expect(e).toContain("globaisParaALamina(card)");
    expect(corpoDe("globaisParaALamina")).toContain('.from("referencias_globais")');
    expect(corpoDe("globaisParaALamina")).toContain('textSearch("leitura"');
    expect(e).toContain('notas.find((x) => x.r.papel === "identidade")?.r ?? await artePublicadaMaisRecente(t.client_id)');
    // Escolha da equipe na tela vale antes do Jev.
    expect(e.indexOf("escolhidasNaTela")).toBeLessThan(e.indexOf("await jevPerguntar("));
    expect(fonte).toContain("const MAX_REFERENCIAS = 2;");
  });
});

describe("estudio-arte: entregar pelo caminho da tela de Arquivos", () => {
  const e = corpoDe("entregar");
  it("sobe no bucket files e registra com create_file_record usando o JWT de quem chamou", () => {
    expect(e).toContain('ch.doChamador.storage\n      .from("files")');
    expect(e).toContain('ch.doChamador.rpc("create_file_record"');
    expect(e).toContain("file_url: `files://${caminho}`");
  });

  it("pasta materiais, carrossel com pai e filhos (n/N) e legenda no pai", () => {
    expect(e).toContain('folder: "materiais"');
    expect(e).toContain('file_type: ehCarrossel ? "carrossel" : "post"');
    expect(e).toContain("parent_file_id: ehCarrossel && i > 0 ? paiId : null");
    expect(e).toContain("`${nomeBase} (${i + 1}/${total})`");
    expect(e).toContain("caption: i === 0 ? legendaFinal : null");
    expect(e).toContain("project_id: projetoId");
  });

  it("nao pede aprovacao (isso e da etapa Entrega)", () => {
    expect(fonte).not.toMatch(/request_file_agency_review|admin_release_file_now|decide_file_approval/);
  });
});

describe("estudio-arte: erros nunca voltam 200", () => {
  it("os erros do motor mantem o status da SPEC", () => {
    expect(fonte).toContain("saldo_insuficiente: 402,");
    expect(fonte).toContain("cota_da_chave_esgotada: 402,");
    expect(fonte).toContain("cliente_sem_chave: 403,");
    expect(fonte).toContain("provedor_sem_chave: 503,");
  });

  it("toda resposta de erro passa pelo ajudante com status explicito", () => {
    // O unico json({ error ... }) da funcao e o do ajudante `erro`.
    expect(fonte.match(/json\(\{ error/g) ?? []).toHaveLength(1);
    expect(fonte).toContain("json({ error: codigo, mensagem, ...detalhes }, status)");
    const porta = fonte.slice(fonte.indexOf("Deno.serve("));
    expect(porta).toContain("if (e instanceof ErroEstudio) return erro(e.status, e.codigo, e.message, e.detalhes);");
    expect(porta).toContain("if (e instanceof IaMotorErro) return respostaDoMotor(e);");
  });

  it("so equipe com acesso ao cliente", () => {
    expect(fonte).toContain('rpc("is_staff", { _user_id: userId })');
    expect(corpoDe("garantirAcesso")).toContain('ch.doChamador.rpc("can_access_client"');
  });
});

describe("estudio-arte: configuracao", () => {
  it("exige JWT", () => {
    expect(config).toMatch(/\[functions\.estudio-arte\]\s*\n\s*verify_jwt = true/);
  });

  it("sem travessao no codigo", () => {
    expect(fonte).not.toMatch(/[–—]/);
  });
});
