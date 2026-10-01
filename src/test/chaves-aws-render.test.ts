import { describe, expect, it } from "vitest";
import { assinarSigV4, testarChave } from "../../supabase/functions/chaves-admin/modulos/testes";
import { provedorPorId } from "../../supabase/functions/chaves-admin/modulos/catalogo";

// Render na nuvem (Remotion Lambda, 01/10/2026): as chaves da AWS entram pelo admin
// e o teste pergunta à AWS "quem sou eu" (STS, nunca cobrado).

const ID = "AKIDEXAMPLE";
const SEGREDO = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

describe("chaves da AWS no admin", () => {
  it("a assinatura SigV4 bate com a da biblioteca oficial da AWS (@smithy/signature-v4)", async () => {
    const cab = await assinarSigV4({
      id: ID,
      segredo: SEGREDO,
      regiao: "us-east-1",
      servico: "sts",
      host: "sts.us-east-1.amazonaws.com",
      consulta: "Action=GetCallerIdentity&Version=2011-06-15",
      agora: new Date("2026-10-01T21:00:00Z"),
    });
    expect(cab["X-Amz-Date"]).toBe("20261001T210000Z");
    expect(cab.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261001/us-east-1/sts/aws4_request, SignedHeaders=host;x-amz-date, Signature=02f00d6f9894c9d15433f3ceb598ecd72d5e54f3a29564560f8ca83a281f7f0c",
    );
  });

  it("aparece no catálogo com os dois campos", () => {
    const p = provedorPorId("aws");
    expect(p?.campos.map((c) => c.nome)).toEqual(["REMOTION_AWS_ACCESS_KEY_ID", "REMOTION_AWS_SECRET_ACCESS_KEY"]);
  });

  it("200 = válida e mostra só o número da conta; 403 = recusada; nada da chave no resultado", async () => {
    const valores = { REMOTION_AWS_ACCESS_KEY_ID: ID, REMOTION_AWS_SECRET_ACCESS_KEY: SEGREDO };
    const ok = await testarChave("aws", valores, async () =>
      new Response(`<GetCallerIdentityResponse><GetCallerIdentityResult><Arn>arn:aws:iam::123456789012:user/remotion-user</Arn><Account>123456789012</Account></GetCallerIdentityResult></GetCallerIdentityResponse>`, { status: 200 }),
    );
    expect(ok.estado).toBe("valida");
    expect(ok.numeros.conta).toBe("conta 123456789012");
    expect(JSON.stringify(ok)).not.toContain(SEGREDO.slice(0, 8));

    const nao = await testarChave("aws", valores, async () => new Response("<Error><Code>InvalidClientTokenId</Code></Error>", { status: 403 }));
    expect(nao.estado).toBe("invalida");

    const falta = await testarChave("aws", { REMOTION_AWS_ACCESS_KEY_ID: ID }, async () => new Response("", { status: 200 }));
    expect(falta.estado).toBe("nao_testada");
  });
});
