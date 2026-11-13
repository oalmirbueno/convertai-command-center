import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CampoDeFormulario, JanelaCentral, botao } from "@/components/sistema";
import { CampoDeSenha, campoPublico } from "@/components/publico/CascaPublica";

/**
 * Quem entrou pelo link do convite ainda não tem senha. A janela aparece uma
 * vez, na primeira entrada, e grava no próprio login que a senha foi criada.
 */
export function precisaCriarSenha(user: { invited_at?: string | null; user_metadata?: Record<string, unknown> | null } | null): boolean {
  return !!user && !!user.invited_at && !(user.user_metadata && user.user_metadata.produto_senha === true);
}

export const senhaAceita = (s: string) => s.length >= 10 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);

export default function CriarSenha() {
  const { user } = useAuth();
  const [senha, setSenha] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(false);
  if (feito || !precisaCriarSenha(user as never)) return null;

  const salvar = async () => {
    if (!senhaAceita(senha)) return void toast.error("Use 10 caracteres ou mais, com maiúscula, minúscula e número.");
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha, data: { produto_senha: true } });
    setSalvando(false);
    if (error) return void toast.error("Não foi possível salvar a senha. Tente de novo.");
    setFeito(true);
    toast.success("Senha criada.");
  };

  return (
    <JanelaCentral
      aberta
      largura="sm"
      titulo="Crie a sua senha"
      descricaoOculta="Primeira entrada: escolha a senha que você vai usar para entrar."
      fecharNoFundo={false}
      onFechar={() => setFeito(true)}
      rodape={
        <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar senha"}
        </button>
      }
    >
      <CampoDeFormulario rotulo="Senha" apoio="10 caracteres ou mais, com maiúscula, minúscula e número">
        <CampoDeSenha
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          mostrar={mostrar}
          aoAlternar={() => setMostrar((v) => !v)}
          autoComplete="new-password"
          className={campoPublico}
          onKeyDown={(e) => {
            if (e.key === "Enter") void salvar();
          }}
        />
      </CampoDeFormulario>
    </JanelaCentral>
  );
}
