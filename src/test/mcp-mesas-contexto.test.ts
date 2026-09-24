import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";
import {
  arteDoTrabalho,
  COMO_ESTUDAR_ADS,
  criativoParaLer,
  faltaNoBanco,
  kitParaLer,
  ofertaParaLer,
  planoParaLer,
  tomadaParaLer,
} from "../../supabase/functions/_shared/mcp-mesas-formato";
import { CLIENT_SCOPED_LEGACY_TOOLS } from "../../supabase/functions/_shared/mcp-security";

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");
const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const servico = ler("supabase/functions/_shared/mcp-mesas-services.ts");

/**
 * Quem vai rodar o tráfego precisa estudar o que a Mesa Ads gerou (oferta,
 * porquê de cada ângulo, notas do Jev, copy e arte) e o que a Mesa Foto
 * aprovou ANTES de subir. Estas duas leituras (v1.46.0) levam isso ao MCP.
 */
const NOVAS = ["aceleriq_mesa_ads_contexto", "aceleriq_mesa_foto_contexto"];

describe("as leituras das mesas estão no catálogo", () => {
  const registro = tools.slice(tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["), tools.indexOf("export const TOOLS: readonly ToolDefinition[]"));

  it("declaradas, registradas e com escopo granular de leitura", () => {
    for (const nome of NOVAS) expect(tools).toContain(`name: '${nome}'`);
    expect(registro).toContain("  mesaAdsContextoTool,");
    expect(registro).toContain("  mesaFotoContextoTool,");
    expect(tools).toContain("aceleriq_mesa_ads_contexto: 'reports:read'");
    expect(tools).toContain("aceleriq_mesa_foto_contexto: 'files:read'");
  });

  it("só leem, e a descrição em português manda estudar antes, sem travessão", () => {
    for (const nome of NOVAS) {
      const trecho = tools.slice(tools.indexOf(`name: '${nome}'`), tools.indexOf("handler:", tools.indexOf(`name: '${nome}'`)));
      expect(trecho).toContain("annotations: READ_ANNOTATIONS");
      expect(trecho).toMatch(/estudar/i);
      expect(trecho).not.toMatch(/[–—]/);
    }
  });

  it("o mapa do painel tem Mesa Ads e Mesa Foto apontando para as leituras", () => {
    expect(tools).toMatch(/area: 'Mesa Ads', rota: '\/mesa-ads'[^\n]*aceleriq_mesa_ads_contexto/);
    expect(tools).toMatch(/area: 'Mesa Foto', rota: '\/mesa-foto'[^\n]*aceleriq_mesa_foto_contexto/);
  });

  it("a versão subiu (cliente MCP guarda o catálogo em cache)", () => {
    const [maior, menor] = MCP_VERSION.split(".").map(Number);
    expect(maior > 1 || (maior === 1 && menor >= 46)).toBe(true);
  });
});

describe("acesso igual ao das outras leituras", () => {
  it("chave restrita a cliente não alcança (fora da lista tenant-scoped) e o handler confere o cliente", () => {
    for (const nome of NOVAS) expect((CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).indexOf(nome)).toBe(-1);
    expect(servico.match(/assertClientAccess\(ctx, clientId\)/g)?.length).toBe(1);
    expect(servico).toContain("await conferirCliente(clientId, ctx);");
    expect(servico.match(/await conferirCliente\(clientId, ctx\);/g)?.length).toBe(2);
    expect(servico).toContain("exigirClienteExistente(db(), clientId)");
    // Nada escreve.
    expect(servico).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("a Mesa Foto sem tabela no banco vira aviso claro em vez de erro", () => {
    expect(servico).toContain("disponivel: false");
    expect(servico).toContain("A migration da Mesa Foto precisa ser aplicada");
    expect(faltaNoBanco({ code: "PGRST205", message: "Could not find the table 'public.foto_kits' in the schema cache" })).toBe(true);
    expect(faltaNoBanco({ code: "42P01", message: 'relation "foto_ensaios" does not exist' })).toBe(true);
    expect(faltaNoBanco({ code: "42703", message: "column cliente_imagens.aprovada does not exist" })).toBe(true);
    expect(faltaNoBanco({ code: "42501", message: "permission denied" })).toBe(false);
    expect(faltaNoBanco(null)).toBe(false);
  });
});

describe("o formato que o agente lê", () => {
  it("o plano traz o porquê, as notas do Jev, os descartados com motivo, a estrutura e as lacunas", () => {
    const p = planoParaLer({
      id: "p1",
      nome: "Plano",
      status: "aprovado",
      angulos: [{ id: "a1", nome: "Dor", hipotese: "Dói, clica", mecanismo: "Conta real", jev: { clareza: 8, risco_politica: 9, alerta_politica: "" }, aprovado: true, pontuacao: 8.2 }],
      estrutura: {
        resumo: "Dois caminhos",
        objetivo: "mensagens",
        oferta_id: "o1",
        descartados: [{ id: "d1", nome: "Antes e depois", motivos: ["Fere a política"], reprovado: true }],
        conjuntos: [{ nome: "Aberto", angulo_ids: ["a1"], verba_diaria_brl: null }],
        lacunas: ["Preço"],
        qualidade: { rodadas: 2, aprovados: 1, reprovados: 1 },
      },
    });
    const a = (p.angulos as any[])[0];
    expect(a.por_que).toBe("Dói, clica");
    expect(a.notas_do_jev).toEqual({ clareza: 8, risco_politica: 9 });
    expect(a.aprovado_pelo_jev).toBe(true);
    const d = (p.descartados as any[])[0];
    expect(d.descartado).toBe(true);
    expect(d.aprovado_pelo_jev).toBe(false);
    expect(d.motivos_do_jev).toEqual(["Fere a política"]);
    expect((p.estrutura as any).conjuntos[0].angulo_ids).toEqual(["a1"]);
    expect(p.lacunas).toEqual(["Preço"]);
    expect(p.oferta_id).toBe("o1");
  });

  it("a oferta junta os campos de dentro de `oferta` com as notas do Jev", () => {
    const o = ofertaParaLer({ id: "o1", status: "escolhida", oferta: { nome: "Diagnóstico", promessa: "Achar o gasto", riscos: ["Promessa de economia"] }, jev: { clareza: 0.8, alerta_politica: true } });
    expect(o.nome).toBe("Diagnóstico");
    expect(o.riscos).toEqual(["Promessa de economia"]);
    expect((o.notas_do_jev as any).alerta_politica).toBe("Alerta de política");
  });

  it("o criativo traz a copy escolhida, o pacote sem a conferência interna e o porquê do ângulo", () => {
    const arte = arteDoTrabalho({ status: "pronto", direcao: { cards: [{ ordem: 1 }] }, cards: [{ ordem: 1, versao: 2, storage_path: "c/1-2.png" }, { ordem: 1, versao: 1, storage_path: "c/1-1.png" }] });
    expect(arte.imagens).toEqual([{ bucket: "mesa", caminho: "c/1-2.png", ordem: 1, versao: 2, formato: null }]);
    const c = criativoParaLer(
      { id: "k", plano_id: "p", angulo_id: "a1", formato: "feed_4x5", copy: { titulo: "Título", pacote: { titulos: ["T1"], conferencia: { x: 1 }, modelo_id: "m" } } },
      { id: "a1", nome: "Dor", hipotese: "Dói, clica" },
      arte,
    );
    expect(c.por_que_do_angulo).toBe("Dói, clica");
    expect((c.copy_escolhida as any).titulo).toBe("Título");
    expect(c.pacote_de_copy).toEqual({ titulos: ["T1"] });
    expect((c.arte as any).imagens[0]).toEqual({ ordem: 1, versao: 2, formato: null, url: null });
  });

  it("kit não expõe dados pessoais da autorização; tomada assina só a aprovada e a mais recente", () => {
    const k = kitParaLer({ id: "k", tipo: "pessoa", nome: "Dona Ana", autorizacao: { nome: "Ana", cpf: "000" }, invariantes: ["Rosto"], lacunas: ["Perfil esquerdo"] }, []);
    expect(k.autorizacao_registrada).toBe(true);
    expect(JSON.stringify(k)).not.toContain("000");
    expect(k.lacunas).toEqual(["Perfil esquerdo"]);
    const t = tomadaParaLer({ id: "t1", versoes: [{ versao: 1, storage_path: "a", aprovada: true }, { versao: 2, storage_path: "b" }, { versao: 3, storage_path: "c", conferencia: { alertas: ["Rótulo diferente"] } }] });
    expect(t.paraAssinar).toEqual([{ versao: 1, caminho: "a" }, { versao: 3, caminho: "c" }]);
    expect((t.tomada.versoes as any[])[2].alertas_da_conferencia).toEqual(["Rótulo diferente"]);
  });

  it("o roteiro de estudo lembra as regras duras", () => {
    expect(COMO_ESTUDAR_ADS).toContain("Nunca invente prova");
    expect(COMO_ESTUDAR_ADS).toContain("verba (só se o briefing tiver verba)");
    expect(COMO_ESTUDAR_ADS).not.toMatch(/[–—]/);
  });
});
