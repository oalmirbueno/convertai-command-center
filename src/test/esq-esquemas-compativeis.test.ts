// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coletarEsquemasDasFuncoes, type EsquemaColetado, RAIZ_DAS_FUNCOES, VARIANTES_DAS_FUNCOES } from "./fixtures/esquemas-das-funcoes";
import {
  converterParaAnthropic,
  diagnosticarEsquema,
  esquemaNoProvedor,
  LIMITE_DE_UNIOES,
  normalizarDaAnthropic,
  respeitaAsRegrasDaAnthropic,
  respostaNoFormatoOriginal,
  schemaDoEsquema,
} from "../../supabase/functions/_shared/esquema-compativel";

/**
 * ESQ 30/09/2026: o Claude Opus 5.5 (padrão de 7 papéis) nunca rodou com
 * esquema estrito em produção. A Anthropic (direta e pelo OpenRouter) recusa
 * mais de 16 uniões, enum com null, minimum/maximum e outras restrições. O
 * motor converte o esquema para ela e devolve a resposta na forma original.
 * Este teste pega CADA esquema que as funções mandam ao motor.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- esquema JSON solto, lido campo a campo no teste
type No = Record<string, any>;

// ------------------------------------------------------------ conferência independente (a mesma régua do teste da QA)

const SEM_SUPORTE = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "uniqueItems"];

function conferirComoAAnthropic(esquema: unknown): { unioes: string[]; opcionais: string[]; problemas: string[] } {
  const conta = { unioes: [] as string[], opcionais: [] as string[], problemas: [] as string[] };
  const andar = (no: unknown, caminho: string) => {
    if (!no || typeof no !== "object") return;
    const o = no as No;
    if (Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.oneOf)) conta.unioes.push(caminho);
    if (o.enum && Array.isArray(o.type)) conta.problemas.push(`${caminho}: enum com type em lista`);
    if (Array.isArray(o.enum) && o.enum.indexOf(null) >= 0) conta.problemas.push(`${caminho}: enum com null`);
    if (Array.isArray(o.oneOf)) conta.problemas.push(`${caminho}: oneOf`);
    for (const k of SEM_SUPORTE) if (o[k] !== undefined) conta.problemas.push(`${caminho}: ${k}`);
    if (typeof o.minItems === "number" && o.minItems > 1) conta.problemas.push(`${caminho}: minItems`);
    const tipos = Array.isArray(o.type) ? o.type : [o.type];
    if (tipos.indexOf("object") >= 0) {
      if (o.additionalProperties !== false) conta.problemas.push(`${caminho}: additionalProperties`);
      for (const k of Object.keys(o.properties || {})) {
        if ((o.required || []).indexOf(k) < 0) conta.opcionais.push(`${caminho}.${k}`);
        andar(o.properties[k], `${caminho}.${k}`);
      }
    }
    if (o.items) andar(o.items, `${caminho}[]`);
    for (const alt of (o.anyOf || []).concat(o.oneOf || [])) andar(alt, `${caminho}|`);
  };
  andar(schemaDoEsquema(esquema), "$");
  return conta;
}

// ------------------------------------------------------------ validador mínimo (tipo, enum, obrigatórias, extras, itens, anyOf)

function tipoDe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

/** caixaLivre: a Anthropic não garante maiúsculas e minúsculas do enum (a leitura acerta). */
function validar(n: No, v: unknown, caminho = "$", erros: string[] = [], caixaLivre = false): string[] {
  if (v === null && Array.isArray(n.enum) && n.enum.indexOf(null) >= 0) return erros;
  if (Array.isArray(n.anyOf)) {
    if (!n.anyOf.some((a: No) => !validar(a, v, caminho, [], caixaLivre).length)) erros.push(`${caminho}: nenhuma alternativa`);
    return erros;
  }
  const tipos: string[] = Array.isArray(n.type) ? n.type : n.type ? [n.type] : [];
  const t = tipoDe(v);
  if (tipos.length && tipos.indexOf(t) < 0 && !(t === "integer" && tipos.indexOf("number") >= 0)) {
    erros.push(`${caminho}: ${t} fora de ${tipos.join("|")}`);
    return erros;
  }
  const naCaixa = (o: unknown) => o === v || (caixaLivre && typeof o === "string" && typeof v === "string" && o.toLowerCase() === v.toLowerCase());
  if (Array.isArray(n.enum) && !n.enum.some(naCaixa)) erros.push(`${caminho}: ${JSON.stringify(v)} fora do enum`);
  if (t === "object" && n.properties) {
    for (const k of n.required || []) if (!(k in (v as No))) erros.push(`${caminho}.${k}: faltou`);
    for (const k of Object.keys(v as No)) {
      if (!n.properties[k]) erros.push(`${caminho}.${k}: chave a mais`);
      else validar(n.properties[k], (v as No)[k], `${caminho}.${k}`, erros, caixaLivre);
    }
  }
  if (t === "array" && n.items) (v as unknown[]).forEach((x, i) => validar(n.items, x, `${caminho}[${i}]`, erros, caixaLivre));
  return erros;
}

// ------------------------------------------------------------ resposta de exemplo, como a Anthropic devolveria

/**
 * Anda no esquema ORIGINAL e escreve a resposta que a Anthropic daria ao
 * esquema convertido: onde a conversão trocou o null, o vazio ("" ou []);
 * no resto, um valor cheio (opção com a caixa trocada, para testar a volta).
 * "cheio" põe valor em tudo; senão, o vazio onde dá.
 */
function respostaDeExemplo(n: No, caminho: string, vazios: Record<string, string>, cheio: boolean): unknown {
  const forma = vazios[caminho];
  if (forma && !cheio) return forma === "texto" ? "" : [];
  if (Array.isArray(n.anyOf)) {
    const i = n.anyOf.findIndex((a: No) => a.type !== "null");
    const v = respostaDeExemplo(n.anyOf[i], `${caminho}|${i}`, vazios, cheio);
    return forma === "embrulho" ? [v] : v;
  }
  const tipos: string[] = (Array.isArray(n.type) ? n.type : [n.type]).filter((x: string) => x && x !== "null");
  let v: unknown;
  if (Array.isArray(n.enum)) {
    const op = n.enum.find((x: unknown) => x !== null && x !== "");
    v = typeof op === "string" ? op.toUpperCase() : op;
  } else if (tipos[0] === "object" || n.properties) {
    const o: No = {};
    for (const k of Object.keys(n.properties || {})) o[k] = respostaDeExemplo(n.properties[k], `${caminho}.${k}`, vazios, cheio);
    v = o;
  } else if (tipos[0] === "array") v = n.items ? [respostaDeExemplo(n.items, `${caminho}[]`, vazios, cheio)] : [];
  else if (tipos[0] === "integer") v = typeof n.maximum === "number" ? n.maximum + 5 : 3;
  else if (tipos[0] === "number") v = typeof n.maximum === "number" ? n.maximum + 0.5 : 2.5;
  else if (tipos[0] === "boolean") v = true;
  else v = "texto de exemplo";
  return forma === "embrulho" ? [v] : v;
}

/** Valor no caminho do esquema ("$.a[].b|0.c"), com a resposta de exemplo (um item por lista); undefined se não chega. */
function valorNoCaminho(v: unknown, caminho: string): unknown {
  let atual: unknown = v;
  for (const passo of caminho.slice(1).match(/\.[^.[|]+|\[\]|\|\d+/g) || []) {
    if (atual === null || atual === undefined) return undefined;
    if (passo === "[]") atual = Array.isArray(atual) ? atual[0] : undefined;
    else if (passo[0] === ".") atual = (atual as No)[passo.slice(1)];
  }
  return atual;
}

// ------------------------------------------------------------ todos os esquemas das funções

let coletados: EsquemaColetado[] | null = null;
const todos = () => (coletados = coletados || coletarEsquemasDasFuncoes(VARIANTES_DAS_FUNCOES));

describe("contrato: cada esquema que as funções mandam ao motor cabe na Anthropic depois da conversão", { timeout: 180_000 }, () => {
  it("o coletor lê todos os esquemaJson do código (nenhum ficou sem avaliar)", () => {
    const lista = todos();
    const semAvaliar = lista.filter((e) => e.dinamico).map((e) => `${e.rotulo}: ${e.erro}`);
    expect(semAvaliar).toEqual([]);
    // Cruzamento pelo texto: todo "esquemaJson:" (ou { esquemaJson }) do código entrou na coleta.
    const noTexto: string[] = [];
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = resolve(dir, nome);
        if (statSync(p).isDirectory()) andar(p);
        else if (/\.tsx?$/.test(nome)) {
          const rel = relative(RAIZ_DAS_FUNCOES, p).split("\\").join("/");
          if (rel === "_shared/ia-motor.ts") continue;
          readFileSync(p, "utf8").split("\n").forEach((l, i) => {
            if (/\besquemaJson\s*[:,}]/.test(l) && !/^\s*(\/\/|\*)/.test(l)) noTexto.push(`${rel}:${i + 1}`);
          });
        }
      }
    };
    andar(RAIZ_DAS_FUNCOES);
    const coletados = Array.from(new Set(lista.map((e) => `${e.arquivo}:${e.linha}`))).sort();
    expect(coletados).toEqual(Array.from(new Set(noTexto)).sort());
    // 30/09: 130 usos de esquemaJson em 36 arquivos (133 esquemas com as variantes).
    expect(lista.length).toBeGreaterThanOrEqual(130);
    const funcoes = Array.from(new Set(lista.map((e) => e.funcao))).sort();
    for (const f of ["agente-calendario", "agente-contexto", "agente-estilo", "briefing-agente", "conselho", "contratos", "documentos", "editor-video", "estudio-arte", "mesa-ads", "mesa-foto", "mesa-identidade", "mesa-instagram", "mesa-motion", "mesa-proposta", "mesa-publicidade", "mesa-roteiros", "mesa-site", "mesa-videos", "perfis-instagram", "preencher-ia", "workspace-organizar"]) {
      expect(funcoes).toContain(f);
    }
  });

  it("todo esquema convertido respeita as regras: até 16 uniões, até 24 opcionais, sem enum com null, sem minimum/maximum", () => {
    const fora: string[] = [];
    for (const e of todos()) {
      const c = converterParaAnthropic(e.esquema);
      const conta = conferirComoAAnthropic(c.schema);
      if (conta.problemas.length || conta.unioes.length > 16 || conta.opcionais.length > 24) {
        fora.push(`${e.rotulo}: ${conta.unioes.length} uniões, ${conta.opcionais.length} opcionais, ${conta.problemas.slice(0, 3).join("; ")}`);
      }
      expect(respeitaAsRegrasDaAnthropic(c.schema), e.rotulo).toBe(true);
    }
    expect(fora).toEqual([]);
  });

  it("os que passavam de 16 uniões (visto na QA) agora cabem", () => {
    // Pelo arquivo e pelo nome do esquema, não pela linha (SPP 30/09: outra frente que mexe no arquivo desloca a
    // linha). O mesmo esquema com o metodos_usados da frente SPP (NOME_COM_METODO) tem as mesmas uniões.
    const porNome = (arquivo: string, nome: string) =>
      todos().find((e) => e.arquivo === arquivo && (e.expressao === nome || e.expressao === `${nome}_COM_METODO`)) as EsquemaColetado;
    for (const [trecho, antes] of [
      ["agente-contexto/index.ts ESQUEMA_CONVERSA_DO_PLANO", 31],
      ["mesa-foto/index.ts ESQUEMA_AGENTE", 32],
      ["mesa-ads/index.ts ESQUEMA_FICHA", 20],
      ["mesa-ads/index.ts ESQUEMA_OFERTA_CONVERSA", 21],
      ["mesa-ads/index.ts ESQUEMA_SUGESTAO", 17],
    ] as Array<[string, number]>) {
      const [arquivo, nome] = trecho.split(" ");
      const e = porNome(arquivo, nome);
      expect(e, trecho).toBeTruthy();
      const c = converterParaAnthropic((e as EsquemaColetado).esquema);
      expect(c.antes.unioes.length, trecho).toBe(antes);
      expect(c.depois.unioes.length, trecho).toBeLessThanOrEqual(LIMITE_DE_UNIOES);
    }
  });

  it("esquema que já cabia sai idêntico; o convertido é ponto fixo (converter de novo não muda nada)", () => {
    for (const e of todos()) {
      const c = converterParaAnthropic(e.esquema);
      if (respeitaAsRegrasDaAnthropic(e.esquema)) expect(c.mudou, e.rotulo).toBe(false);
      expect(converterParaAnthropic(c.schema).mudou, e.rotulo).toBe(false);
    }
  });

  it("a resposta da Anthropic volta na forma do esquema original (vazio vira null, caixa da opção certa), para cada esquema", () => {
    for (const e of todos()) {
      const c = converterParaAnthropic(e.esquema);
      const original = schemaDoEsquema(e.esquema) as No;
      const convertido = schemaDoEsquema(c.schema) as No;
      for (const cheio of [false, true]) {
        const resposta = respostaDeExemplo(original, "$", c.vazios, cheio);
        // A resposta de exemplo é o que o esquema convertido deixa a Anthropic escrever...
        expect(validar(convertido, resposta, "$", [], true), `${e.rotulo} (convertido, cheio=${cheio})`).toEqual([]);
        // ...e, normalizada, é o que o código já lia do esquema original.
        const lida = normalizarDaAnthropic(e.esquema, resposta);
        expect(validar(original, lida), `${e.rotulo} (original, cheio=${cheio})`).toEqual([]);
        // Cada vazio que a conversão criou volta null (o código lia null ali); cheio, nunca null.
        for (const caminho of Object.keys(c.vazios)) {
          const v = valorNoCaminho(lida, caminho);
          if (v === undefined) continue;
          if (cheio) expect(v, `${e.rotulo} ${caminho}`).not.toBeNull();
          else expect(v, `${e.rotulo} ${caminho}`).toBeNull();
        }
      }
    }
  });
});

// ------------------------------------------------------------ conversão e leitura, caso a caso

const obj = (properties: No, extra: No = {}) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties, ...extra });

describe("conversão para a Anthropic", () => {
  it("enum com null perde o null e ganha a opção vazia; a leitura devolve null e acerta a caixa", () => {
    const e = { nome: "t", schema: obj({ estagio: { type: ["string", "null"], enum: ["frio", "morno", "quente", null] }, cor: { type: "string", enum: ["azul", null] } }) };
    const c = converterParaAnthropic(e);
    const s = (c.schema as No).schema;
    expect(s.properties.estagio).toMatchObject({ type: "string", enum: ["frio", "morno", "quente", ""] });
    expect(s.properties.cor).toMatchObject({ type: "string", enum: ["azul", ""] });
    expect(c.depois).toEqual({ unioes: [], opcionais: [], problemas: [] });
    expect(normalizarDaAnthropic(e, { estagio: "", cor: "Azul" })).toEqual({ estagio: null, cor: "azul" });
    expect(normalizarDaAnthropic(e, { estagio: "QUENTE", cor: "" })).toEqual({ estagio: "quente", cor: null });
  });

  it("até 16 uniões fica como está (null continua null); acima, texto e lista ganham o vazio natural", () => {
    const poucos: No = {};
    for (let i = 0; i < 16; i++) poucos[`c${i}`] = { type: ["string", "null"] };
    const e16 = obj(poucos);
    expect(converterParaAnthropic(e16).mudou).toBe(false);
    expect(normalizarDaAnthropic(e16, { c0: "", c1: null })).toEqual({ c0: "", c1: null });

    const muitos: No = { lista: { type: ["array", "null"], items: { type: "string" } } };
    for (let i = 0; i < 18; i++) muitos[`c${i}`] = { type: ["string", "null"], description: `Campo ${i}.` };
    const e = obj(muitos);
    const c = converterParaAnthropic(e);
    expect(c.antes.unioes.length).toBe(19);
    expect(c.depois.unioes.length).toBe(0);
    expect((c.schema as No).properties.c3).toEqual({ type: "string", description: "Campo 3. Texto vazio quando não houver" });
    expect((c.schema as No).properties.lista).toMatchObject({ type: "array", items: { type: "string" } });
    const lida = normalizarDaAnthropic(e, { ...Object.fromEntries(Object.keys(muitos).map((k) => [k, ""])), c1: "algo", lista: [] }) as No;
    expect(lida.c0).toBeNull();
    expect(lida.c1).toBe("algo");
    expect(lida.lista).toBeNull();
  });

  it("número, sim/não e objeto com null só viram lista de um item se ainda passar de 16, um a um", () => {
    const props: No = {};
    for (let i = 0; i < 17; i++) props[`n${i}`] = { type: ["integer", "null"] };
    props.ok = { type: ["boolean", "null"] };
    const e = obj(props);
    const c = converterParaAnthropic(e);
    expect(c.antes.unioes.length).toBe(18);
    expect(c.depois.unioes.length).toBe(16);
    expect(Object.keys(c.vazios)).toEqual(["$.n0", "$.n1"]);
    expect((c.schema as No).properties.n0).toEqual({ type: "array", items: { type: "integer" }, description: "Lista com um item, ou vazia quando não houver" });
    expect((c.schema as No).properties.n2).toEqual({ type: ["integer", "null"] });
    const lida = normalizarDaAnthropic(e, { n0: [], n1: [7], n2: null, n3: 4, ok: true }) as No;
    expect(lida).toMatchObject({ n0: null, n1: 7, n2: null, n3: 4, ok: true });
  });

  it("objeto com null (type em lista e anyOf) vira lista de um item com os vazios de dentro no caminho certo", () => {
    const filho = (i: number) => obj({ nome: { type: ["string", "null"] }, qtd: { type: ["integer", "null"] }, tipo: { type: "string", enum: ["a", "b"] } }, { description: `Bloco ${i}` });
    const props: No = {};
    for (let i = 0; i < 5; i++) props[`o${i}`] = { ...filho(i), type: ["object", "null"] };
    props.alt = { anyOf: [filho(9), { type: "null" }] };
    const e = obj(props);
    // 6 objetos + 6 nomes + 6 quantidades = 18 uniões: os 6 nomes viram "" e ficam 12.
    const c = converterParaAnthropic(e);
    expect(c.antes.unioes.length).toBe(18);
    expect(c.depois.unioes.length).toBe(12);
    expect(c.vazios["$.o0.nome"]).toBe("texto");
    expect(c.vazios["$.alt|0.nome"]).toBe("texto");
    // O objeto com null (anyOf) fica como união: só o texto de dentro mudou.
    expect((c.schema as No).properties.alt.anyOf[0].properties.nome).toEqual({ type: "string", description: "Texto vazio quando não houver" });
    expect((c.schema as No).properties.alt.anyOf[1]).toEqual({ type: "null" });

    // Com mais objetos, os de número e depois os objetos se embrulham.
    const muitos: No = {};
    for (let i = 0; i < 12; i++) muitos[`o${i}`] = { ...filho(i), type: ["object", "null"] };
    muitos.alt = { anyOf: [{ type: "null" }, filho(99)] };
    const e2 = obj(muitos);
    const c2 = converterParaAnthropic(e2);
    expect(c2.antes.unioes.length).toBe(39);
    expect(c2.depois.unioes.length).toBeLessThanOrEqual(16);
    expect(respeitaAsRegrasDaAnthropic(c2.schema)).toBe(true);
    const formas = Object.keys(c2.vazios).reduce((a: No, k) => ((a[c2.vazios[k]] = (a[c2.vazios[k]] || 0) + 1), a), {});
    expect(formas).toEqual({ texto: 13, embrulho: 10 });
    // As 10 primeiras quantidades (pré-ordem) viraram lista de um item; o10, o11 e alt ficaram com null.
    expect(c2.vazios["$.o0.qtd"]).toBe("embrulho");
    expect(c2.vazios["$.o9.qtd"]).toBe("embrulho");
    expect(c2.vazios["$.o10.qtd"]).toBeUndefined();
    expect(c2.vazios["$.alt|1.nome"]).toBe("texto");
    expect((c2.schema as No).properties.o1.properties.qtd).toEqual({ type: "array", items: { type: "integer" }, description: "Lista com um item, ou vazia quando não houver" });
    // Resposta da Anthropic ao esquema convertido.
    const resposta: No = {};
    for (let i = 0; i < 12; i++) resposta[`o${i}`] = { nome: "", qtd: i < 10 ? [] : null, tipo: "A" };
    resposta.o1 = { nome: "Ana", qtd: [3], tipo: "B" };
    resposta.alt = { nome: "", qtd: 2, tipo: "b" };
    expect(validar(schemaDoEsquema(c2.schema) as No, resposta, "$", [], true)).toEqual([]);
    const lida = normalizarDaAnthropic(e2, resposta) as No;
    expect(lida.o1).toEqual({ nome: "Ana", qtd: 3, tipo: "b" });
    expect(lida.o0).toEqual({ nome: null, qtd: null, tipo: "a" });
    expect(lida.o11).toEqual({ nome: null, qtd: null, tipo: "a" });
    expect(lida.alt).toEqual({ nome: null, qtd: 2, tipo: "b" });
    expect(validar(e2 as No, lida)).toEqual([]);
  });

  it("minimum, maximum, tamanho e itens saem do esquema, vão para a descrição e são conferidos na leitura", () => {
    const e = obj({
      nota: { type: "integer", minimum: 1, maximum: 5, description: "Nota" },
      peso: { type: "number", minimum: 0, multipleOf: 0.5 },
      titulo: { type: "string", maxLength: 10, minLength: 2 },
      tags: { type: "array", items: { type: "string" }, maxItems: 2, minItems: 3 },
    });
    const c = converterParaAnthropic(e);
    const p = (c.schema as No).properties;
    expect(p.nota).toEqual({ type: "integer", description: "Nota. (entre 1 e 5)" });
    expect(p.peso.description).toBe("(no mínimo 0, múltiplo de 0.5)");
    expect(p.titulo.description).toBe("(no mínimo 2 caracteres, até 10 caracteres)");
    expect(p.tags).toEqual({ type: "array", items: { type: "string" }, minItems: 1, description: "(no mínimo 3 itens, até 2 itens)" });
    expect(c.depois.problemas).toEqual([]);
    const lida = normalizarDaAnthropic(e, { nota: 9, peso: -1.2, titulo: "um título comprido", tags: ["a", "b", "c"] }) as No;
    expect(lida).toEqual({ nota: 5, peso: 0, titulo: "um título ", tags: ["a", "b"] });
    expect((normalizarDaAnthropic(e, { nota: 0.4, peso: 2.3, titulo: "ok", tags: [] }) as No)).toMatchObject({ nota: 1, peso: 2.5 });
  });

  it("oneOf vira anyOf, format fora da lista sai, padrão sem suporte sai e objeto sem additionalProperties fecha", () => {
    const e = {
      type: "object",
      required: ["a", "b", "c", "d"],
      properties: {
        a: { oneOf: [{ type: "string" }, { type: "number" }] },
        b: { type: "string", format: "url" },
        c: { type: "string", format: "date", pattern: "^\\bx" },
        d: { type: "object", properties: { x: { type: "string" } } },
      },
    };
    const c = converterParaAnthropic(e);
    const s = c.schema as No;
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.a).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(s.properties.b).toEqual({ type: "string", description: "(formato url)" });
    expect(s.properties.c).toEqual({ type: "string", format: "date" });
    // Fecha sem inventar required: a propriedade opcional continua opcional (conta no limite de 24).
    expect(s.properties.d).toEqual({ type: "object", properties: { x: { type: "string" } }, additionalProperties: false });
    expect(c.depois.problemas).toEqual([]);
    expect(c.depois.opcionais).toEqual(["$.d.x"]);
    // A união que não é com null fica e conta.
    expect(c.depois.unioes).toEqual(["$.a"]);
    expect(normalizarDaAnthropic(e, { a: 3, b: "x", c: "2026-09-30", d: { x: "y" } })).toEqual({ a: 3, b: "x", c: "2026-09-30", d: { x: "y" } });
  });

  it("mapa livre não fecha calado: fica como problema (vai para o log do motor)", () => {
    const e = obj({ contagem: { type: "object", additionalProperties: { type: "integer" } } });
    const c = converterParaAnthropic(e);
    expect((c.schema as No).properties.contagem).toEqual({ type: "object", additionalProperties: { type: "integer" } });
    expect(c.depois.problemas).toEqual(["$.contagem: additionalProperties"]);
    expect(respeitaAsRegrasDaAnthropic(c.schema)).toBe(false);
  });

  it("diagnóstico aponta uniões, opcionais e problemas", () => {
    const d = diagnosticarEsquema({ type: "object", properties: { a: { type: ["string", "null"], enum: ["x", null] }, b: { type: "integer", minimum: 1 } }, required: ["a"] });
    expect(d.unioes).toEqual(["$.a"]);
    expect(d.opcionais).toEqual(["$.b"]);
    expect(d.problemas).toEqual(["$: additionalProperties", "$.a: enum com type em lista", "$.a: enum com null", "$.b: minimum"]);
  });
});

describe("por modelo: só a Anthropic recebe o esquema convertido", () => {
  const grande: No = {};
  for (let i = 0; i < 20; i++) grande[`c${i}`] = { type: ["string", "null"] };
  grande.estagio = { type: ["string", "null"], enum: ["frio", "quente", null] };
  const esquema = { nome: "grande", schema: obj(grande) };

  it("OpenAI direto e modelos não Anthropic do OpenRouter recebem o MESMO objeto e a resposta volta intacta", () => {
    for (const m of [
      { provedor: "openai", modelo_api: "gpt-6" },
      { provedor: "openrouter", modelo_api: "openai/gpt-6-luna" },
      { provedor: "openrouter", modelo_api: "google/gemini-3-pro" },
    ]) {
      const r = esquemaNoProvedor(m, esquema);
      expect(r.esquema).toBe(esquema);
      expect(r.conversao).toBeNull();
      const valor = { c0: "", estagio: "Frio" };
      expect(respostaNoFormatoOriginal(m, esquema, valor)).toBe(valor);
    }
  });

  it("Anthropic direta e anthropic/* no OpenRouter recebem a forma aceita e a resposta volta ao original", () => {
    for (const m of [
      { provedor: "anthropic", modelo_api: "claude-opus-5-5" },
      { provedor: "openrouter", modelo_api: "anthropic/claude-opus-5.5" },
      { provedor: "openrouter", modelo_api: "~anthropic/claude-sonnet-latest" },
    ]) {
      const r = esquemaNoProvedor(m, esquema);
      expect(r.esquema).not.toBe(esquema);
      expect((r.esquema as No).nome).toBe("grande");
      expect(respeitaAsRegrasDaAnthropic(r.esquema)).toBe(true);
      expect(respostaNoFormatoOriginal(m, esquema, { c0: "", c1: "x", estagio: "Frio" })).toMatchObject({ c0: null, c1: "x", estagio: "frio" });
    }
    // Esquema que já cabe vai como está, mesmo na Anthropic.
    const pequeno = { nome: "p", schema: obj({ a: { type: "string" } }) };
    expect(esquemaNoProvedor({ provedor: "anthropic", modelo_api: "claude-opus-5-5" }, pequeno).esquema).toBe(pequeno);
  });
});

describe("ia-motor: a conversão é central e não toca a OpenAI", () => {
  const motor = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/ia-motor.ts"), "utf8");
  const corpo = (nome: string) => {
    const ini = motor.indexOf(`async function ${nome}(`);
    const resto = motor.slice(ini + 10);
    return resto.slice(0, resto.search(/\n(?:export )?(?:async )?function /));
  };

  it("OpenAI: o esquema original, como antes", () => {
    const openai = corpo("textoOpenAi");
    expect(openai).toContain("const { nome, schema } = nomeEsquema(e.esquemaJson);");
    expect(openai).toContain('corpo.text = { format: { type: "json_schema", name: nome, schema, strict: true } };');
    expect(openai).not.toContain("esquemaDoProvedor");
  });

  it("Anthropic e OpenRouter: o esquema passa pelo esquemaDoProvedor (decide pelo modelo que vai atender)", () => {
    expect(corpo("textoAnthropic")).toContain('outputConfig.format = { type: "json_schema", schema: nomeEsquema(esquemaDoProvedor(m, e.esquemaJson)).schema };');
    expect(corpo("textoOpenRouter")).toContain("const { nome, schema } = nomeEsquema(esquemaDoProvedor(m, e.esquemaJson));");
    expect(motor).toContain("const { esquema, conversao } = esquemaNoProvedor(m, e);");
  });

  it("a resposta volta à forma original com o modelo que atendeu (depois da reserva)", () => {
    const chamar = corpo("chamarTexto");
    expect(chamar).toContain("const { r, m, chave, reserva } = await comReservaOpenRouter(");
    expect(chamar).toContain("if (e.esquemaJson) saida.json = respostaNoFormatoOriginal(m, e.esquemaJson, lerJson(r.texto));");
  });
});
