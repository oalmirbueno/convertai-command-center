import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trocar o e-mail de login do cliente (08/10/2026): o cliente às vezes troca
 * de e-mail e precisa entrar com o novo. O cadastro deixa o admin editar; o
 * servidor troca no Auth e no perfil juntos, sem mexer na senha nem mandar
 * convite, e desfaz o Auth se o perfil falhar.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("trocar o e-mail de login do cliente", () => {
  const fn = ler("supabase/functions/manage-team/index.ts");
  const bloco = fn.slice(fn.indexOf('if (action === "update_email")'), fn.indexOf('throw new Error("Invalid action")'));

  it("manage-team: só admin chama, só conta de cliente muda, Auth antes do perfil, com volta", () => {
    expect(bloco.length).toBeGreaterThan(200);
    // O papel de admin é conferido antes de qualquer ação (topo da função).
    expect(fn.indexOf('.eq("role", "admin")')).toBeLessThan(fn.indexOf('if (action === "update_email")'));
    expect(bloco).toContain('.eq("role", "client")');
    const auth = bloco.indexOf("auth.admin.updateUserById(user_id, { email: novo, email_confirm: true })");
    const perfil = bloco.indexOf('from("profiles").update({ email: novo })');
    expect(auth).toBeGreaterThan(0);
    expect(perfil).toBeGreaterThan(auth);
    expect(bloco).toContain("updateUserById(user_id, { email: anterior, email_confirm: true })");
    expect(bloco).toContain("Esse e-mail já é o login de outra conta");
  });

  it("manage-team: não mexe na senha nem reemite o primeiro acesso", () => {
    expect(bloco).not.toMatch(/password|first_access|issue_first_access_token|send-transactional-email/);
  });

  it("cadastro: o admin edita o e-mail; a troca vai ao manage-team antes de salvar o resto", () => {
    const tela = ler("src/components/admin/EditClientDrawer.tsx");
    expect(tela).toContain("onChange={(e) => setEmail(e.target.value)}");
    expect(tela).toContain("disabled={!isAdmin}");
    expect(tela).toContain("Ao salvar, o cliente passa a entrar com este e-mail. A senha continua a mesma.");
    const troca = tela.indexOf('action: "update_email"');
    const perfil = tela.indexOf('await supabase.from("profiles").update(updatePayload)');
    expect(troca).toBeGreaterThan(0);
    expect(troca).toBeLessThan(perfil);
    // O e-mail nunca vai direto no update do perfil pelo navegador.
    const payload = tela.slice(tela.indexOf("const updatePayload: any = {"), tela.indexOf("// Only admin can change plan name"));
    expect(payload).not.toContain("email");
  });
});
