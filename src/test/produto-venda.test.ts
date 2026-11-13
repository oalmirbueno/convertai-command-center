import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { destinoDaCompra, documentoConferido, documentoLegivel, enderecoDeCompra, lerEscolhaDeCompra } from "@/lib/produto/venda";
import { lerRespostasGuardadas } from "@/components/produto/OnboardingDoProduto";

const raiz = resolve(__dirname, "../..");
const ler = (arquivo: string) => readFileSync(resolve(raiz, arquivo), "utf8");

describe("página de venda: da escolha ao cadastro", () => {
  it("o botão do plano leva plano e usuários no endereço, e o cadastro lê de volta", () => {
    const endereco = enderecoDeCompra({ plano: "pro", usuarios: 4 });
    expect(endereco).toBe("/crm/comecar?plano=pro&usuarios=4");
    expect(lerEscolhaDeCompra(endereco.slice(endereco.indexOf("?")))).toEqual({ plano: "pro", usuarios: 4 });
  });

  it("escolha estranha não passa: plano inválido cai no starter e usuários ficam entre 1 e 500", () => {
    expect(enderecoDeCompra({ plano: "<script>", usuarios: 9999 })).toBe("/crm/comecar?plano=starter&usuarios=500");
    expect(lerEscolhaDeCompra("?plano=DROP%20TABLE&usuarios=3")).toBeNull();
    expect(lerEscolhaDeCompra("?usuarios=3")).toBeNull();
    expect(lerEscolhaDeCompra("?plano=pro&usuarios=-2")).toEqual({ plano: "pro", usuarios: 1 });
    expect(lerEscolhaDeCompra("?plano=pro&usuarios=%E0%A4%A")).toEqual({ plano: "pro", usuarios: 1 });
  });

  it("a origem do anúncio segue junto, e só ela", () => {
    expect(enderecoDeCompra({ plano: "starter", usuarios: 1 }, "?utm_source=meta&utm_campaign=crm&fbclid=abc&plano=pro")).toBe("/crm/comecar?plano=starter&usuarios=1&utm_source=meta&utm_campaign=crm");
  });
});

describe("CPF e CNPJ antes do checkout", () => {
  it("aceita documento com dígitos certos, com ou sem pontuação", () => {
    expect(documentoConferido("529.982.247-25")).toBe("52998224725");
    expect(documentoConferido("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("recusa dígito errado, repetição e tamanho errado", () => {
    expect(documentoConferido("529.982.247-26")).toBe("");
    expect(documentoConferido("111.111.111-11")).toBe("");
    expect(documentoConferido("11.222.333/0001-82")).toBe("");
    expect(documentoConferido("1234")).toBe("");
  });

  it("mostra o documento formatado enquanto a pessoa digita", () => {
    expect(documentoLegivel("52998224725")).toBe("529.982.247-25");
    expect(documentoLegivel("11222333000181")).toBe("11.222.333/0001-81");
    expect(documentoLegivel("5299")).toBe("529.9");
  });
});

describe("teste grátis ou checkout", () => {
  it("cobrança desligada: sempre teste, mesmo com documento", () => {
    expect(destinoDaCompra({ pagamentosAtivos: false, documento: "52998224725" })).toBe("teste");
  });

  it("cobrança ligada: checkout só com documento válido", () => {
    expect(destinoDaCompra({ pagamentosAtivos: true, documento: "52998224725" })).toBe("checkout");
    expect(destinoDaCompra({ pagamentosAtivos: true, documento: "123" })).toBe("teste");
  });

  it("as respostas guardadas lembram o caminho direto e o documento", () => {
    localStorage.setItem("aceleriq:produto:onboarding", JSON.stringify({ nicho: "saude", empresa: "Clínica Vida", plano: "pro", usuarios: 3, direto: true, documento: "529.982.247-25" }));
    const r = lerRespostasGuardadas();
    expect(r && r.direto).toBe(true);
    expect(r && r.documento).toBe("52998224725");
    localStorage.removeItem("aceleriq:produto:onboarding");
  });
});

describe("checkout do Asaas com a marca", () => {
  const itens = [{ chave: "crm", nome: "CRM Pro", quantidade: 3, unitario: 79.9, total: 239.7 }];
  const abrir = async (imagemBase64?: string) => {
    const { criarCheckoutDaAssinatura } = await import("../../supabase/functions/produto/modulos/asaas");
    let corpo: Record<string, unknown> = {};
    const buscar = async (_url: string, init?: RequestInit) => {
      corpo = JSON.parse(String(init && init.body));
      return new Response(JSON.stringify({ id: "chk_1", link: "https://sandbox.asaas.com/checkoutSession/show/chk_1" }), { status: 200 });
    };
    await criarCheckoutDaAssinatura("$aact_hmlg_teste", buscar, { clienteId: "cus_1", itens, referencia: "conta:abc", voltarPara: "https://aceleriq.online/app/conta", agora: new Date("2026-11-13T15:00:00Z"), imagemBase64 });
    return (corpo.items as Array<Record<string, unknown>>)[0];
  };

  it("o item leva o nome da marca e diz que não tem fidelidade", async () => {
    const item = await abrir();
    expect(item.name).toBe("Aceleriq CRM Pro");
    expect(String(item.name).length).toBeLessThanOrEqual(30);
    expect(item.description).toContain("Sem fidelidade");
    expect(String(item.description).length).toBeLessThanOrEqual(150);
    expect("imageBase64" in item).toBe(false);
  });

  it("a imagem só vai quando é Base64 de verdade", async () => {
    const boa = "iVBORw0KGgo".repeat(20);
    expect((await abrir(`data:image/png;base64,${boa}`)).imageBase64).toBe(boa);
    expect("imageBase64" in (await abrir("<script>alert(1)</script>".repeat(10)))).toBe(false);
  });
});

describe("arquivos da página de venda", () => {
  const arquivos = ["src/pages/ProdutoLanding.tsx", "src/components/venda/Cenas.tsx", "src/components/venda/venda.css", "src/lib/produto/venda.ts", "src/pages/ProdutoComecar.tsx"];

  it("sem travessão e compatíveis com navegador antigo", () => {
    const travessao = String.fromCharCode(0x2014);
    for (const arquivo of arquivos) {
      const texto = ler(arquivo);
      expect(texto.indexOf(travessao), `${arquivo}: travessão`).toBe(-1);
      if (/\.tsx?$/.test(arquivo)) {
        expect(/\(\?<[=!]/.test(texto), `${arquivo}: lookbehind`).toBe(false);
        expect(/\.at\(/.test(texto), `${arquivo}: .at()`).toBe(false);
        expect(/\.replaceAll\(/.test(texto), `${arquivo}: replaceAll`).toBe(false);
      }
    }
  });

  it("o visual não usa o que o Safari 11 não entende e respeita quem pede menos movimento", () => {
    const css = ler("src/components/venda/venda.css");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("-webkit-backdrop-filter");
    expect(/clamp\(|aspect-ratio|\binset\s*:/.test(css)).toBe(false);
    // gap só em grade, sempre com grid-gap ao lado
    const blocos = css.split("}");
    for (const bloco of blocos) {
      if (/(^|[\s;{])gap\s*:/.test(bloco)) expect(bloco, "gap sem grid-gap").toContain("grid-gap");
    }
    // nada de animar propriedade que refaz o desenho da página
    expect(/transition:[^;]*\b(width|height|top|left|margin|box-shadow|background)\b/.test(css)).toBe(false);
  });

  it("sem prova inventada: nada de depoimento nem de número de clientes", () => {
    const pagina = ler("src/pages/ProdutoLanding.tsx").toLowerCase();
    expect(/depoimento|clientes atendidos|empresas confiam|\+ de \d/.test(pagina)).toBe(false);
    expect(pagina).toContain("dados de exemplo");
  });

  it("os preços e os dias de teste vêm do banco", () => {
    const pagina = ler("src/pages/ProdutoLanding.tsx");
    expect(pagina).toContain("listarPlanos()");
    expect(pagina).toContain("lerPrecos()");
    expect(/49,90|79,90/.test(pagina)).toBe(false);
  });
});
