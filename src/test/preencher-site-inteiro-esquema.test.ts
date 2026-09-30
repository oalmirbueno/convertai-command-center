import { describe, expect, it } from "vitest";
import { camposDoSiteInteiro } from "@/components/mesa-site/preencherDoSite";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";
import { esquemaDosCampos, MAX_CAMPOS, montarPedido, type CampoParaPreencher } from "../../supabase/functions/_shared/preencher-com-ia";

/**
 * CT-01 (30/09): o "Preencher tudo" do site mandava 18 campos e o esquema
 * tinha 19 uniões (valor ou null); a Anthropic recusa mais de 16 (log de
 * 01:37 UTC). O main 9e95417e tirou as uniões ("sem base" é vazio) e a função
 * publicada (preencher-ia v5) já tem a correção. Este teste guarda o caso real:
 * o esquema do site inteiro e o de MAX_CAMPOS campos saem com no máximo 16
 * uniões por chamada (hoje, nenhuma).
 */

type No = { type?: unknown; enum?: unknown[]; anyOf?: No[]; oneOf?: No[]; properties?: Record<string, No>; items?: No; required?: string[] };

function unioes(no: unknown, caminho = "$", saida: string[] = []): string[] {
  if (!no || typeof no !== "object") return saida;
  const o = no as No;
  if (Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.oneOf)) saida.push(caminho);
  const props = o.properties || {};
  for (const k of Object.keys(props)) unioes(props[k], `${caminho}.${k}`, saida);
  if (o.items) unioes(o.items, `${caminho}[]`, saida);
  for (const alt of (o.anyOf || []).concat(o.oneOf || [])) unioes(alt, `${caminho}|`, saida);
  return saida;
}

const SITE_VAZIO = { tipo: null, direcao: null, seo: null, integracoes: null } as unknown as LinhaDoSite;

describe("Preencher tudo do site: esquema que a Anthropic aceita", () => {
  it("o site inteiro (18 campos) sai sem união e cada campo vira uma chave obrigatória", () => {
    const campos = camposDoSiteInteiro(SITE_VAZIO, {});
    expect(campos.length).toBe(18);
    const { schema, mapa } = esquemaDosCampos(campos);
    expect(unioes(schema)).toEqual([]);
    const valores = (schema.properties as Record<string, No>).valores as Required<Pick<No, "properties" | "required">>;
    expect(valores.required).toHaveLength(18);
    expect(Object.keys(mapa).map((k) => mapa[k].chave)).toEqual(campos.map((c) => c.chave));
    // A escolha leva a opção vazia no enum ("sem base") em vez de null.
    const tipo = valores.properties[Object.keys(mapa).filter((k) => mapa[k].chave === "tipo")[0]];
    const opcoes = tipo.enum || [];
    expect(tipo.type).toBe("string");
    expect(opcoes[opcoes.length - 1]).toBe("");
  });

  it(`com o máximo de campos (${MAX_CAMPOS}), todos os tipos, o pedido segue com no máximo 16 uniões`, () => {
    const tipos = ["texto", "texto_longo", "lista", "numero", "escolha", "objeto"] as const;
    const campos: CampoParaPreencher[] = [];
    for (let i = 0; i < MAX_CAMPOS; i++) {
      const tipo = tipos[i % tipos.length];
      campos.push({
        chave: `k${i}`,
        rotulo: `Campo ${i}`,
        tipo,
        opcoes: tipo === "escolha" ? ["a", "b"] : undefined,
        valorAtual: tipo === "objeto" ? (i % 12 === 5 ? [{ a: "", b: [] }] : { a: "", b: [], c: 0 }) : undefined,
      });
    }
    const pedido = montarPedido({ papel: "site", campos, fontes: [] });
    expect(unioes(pedido.esquema.schema).length).toBeLessThanOrEqual(16);
    expect(unioes(pedido.esquema.schema)).toEqual([]);
  });
});
