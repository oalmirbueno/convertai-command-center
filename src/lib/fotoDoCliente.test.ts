import { describe, expect, it } from "vitest";
import { escolherArquivoDeLogo, fotoDoCliente, iniciaisDoCliente, pontuarLogo, type ArquivoDeLogo } from "@/lib/fotoDoCliente";

const arq = (file_name: string, over: Partial<ArquivoDeLogo> = {}): ArquivoDeLogo => ({ id: file_name, client_id: "c1", file_name, file_url: `files://c1/${file_name}`, mime_type: "image/png", created_at: "2026-09-01T00:00:00Z", ...over });

describe("a cara do cliente", () => {
  it("cadastro vence Instagram, que vence logo dos arquivos", () => {
    expect(fotoDoCliente({ avatarUrl: "a", instagramUrl: "i", logoUrl: "l" })).toEqual({ url: "a", tipo: "foto" });
    expect(fotoDoCliente({ avatarUrl: " ", instagramUrl: "i", logoUrl: "l" })).toEqual({ url: "i", tipo: "instagram" });
    expect(fotoDoCliente({ avatarUrl: null, instagramUrl: null, logoUrl: "l" })).toEqual({ url: "l", tipo: "logo" });
    expect(fotoDoCliente({})).toBeNull();
  });

  it("entre as logos da Jalimpo, a principal transparente vence a monocromatica", () => {
    const escolhida = escolherArquivoDeLogo([
      arq("03_jalimpo_logo_monocromatica_azul.png"),
      arq("JALimpo_Logo_Horizontal_HQ_Fundo_Escuro.png"),
      arq("01_jalimpo_logo_principal_transparente.png"),
      arq("04_jalimpo_logo_monocromatica_branca.png"),
    ]);
    expect(escolhida?.file_name).toBe("01_jalimpo_logo_principal_transparente.png");
  });

  it("na Verzelo, o logotipo simplificado oficial colorido vence as versoes brancas e com slogan", () => {
    const escolhida = escolherArquivoDeLogo([
      arq("02-02_VERZELO_Logo_Completa_Com_Slogan_Verde_Profundo_4K.png"),
      arq("01-05_VERZELO_Logo_Principal_Branca_4K.png"),
      arq("03-01_VERZELO_Logotipo_Simplificado_Oficial_Colorido_4K.png"),
      arq("01-01_VERZELO_Logo_Principal_Oficial_Colorida_4K.png"),
    ]);
    expect(escolhida?.file_name).toBe("03-01_VERZELO_Logotipo_Simplificado_Oficial_Colorido_4K.png");
  });

  it("logo 'de perfil do Instagram' e a preferida; branca sem fundo fica por ultimo", () => {
    expect(pontuarLogo("Logo Perfil do Instagram SKC .png")).toBeGreaterThan(pontuarLogo("Logo Reduzida Bordo.png"));
    expect(pontuarLogo("Logo Aceleriq Branca e verde sem fundo .png")).toBeLessThan(0);
  });

  it("ignora o que nao e imagem e prefere a mais nova no empate", () => {
    const escolhida = escolherArquivoDeLogo([
      arq("logo.pdf", { mime_type: "application/pdf" }),
      arq("logo-v1.png", { created_at: "2026-01-01T00:00:00Z" }),
      arq("logo-v2.png", { created_at: "2026-06-01T00:00:00Z" }),
    ]);
    expect(escolhida?.file_name).toBe("logo-v2.png");
    expect(escolherArquivoDeLogo([arq("logo.pdf", { mime_type: "application/pdf" })])).toBeNull();
  });

  it("iniciais: duas letras, sem tracos soltos", () => {
    expect(iniciaisDoCliente("Mirante Luz Floripa")).toBe("ML");
    expect(iniciaisDoCliente("Verzelo - Jardins e Poda")).toBe("VJ");
    expect(iniciaisDoCliente("Acerbi")).toBe("AC");
    expect(iniciaisDoCliente("")).toBe("?");
  });
});
