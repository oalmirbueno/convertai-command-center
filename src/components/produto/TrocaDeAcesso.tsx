import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { JanelaCentral, botao, juntar, texto } from "@/components/sistema";

/**
 * O painel da empresa e o CRM são acessos separados (18/11/2026, pedido do dono): o painel entra com o
 * login geral da empresa; o CRM, com o usuário de cada pessoa. Passar de um para o outro sai desta
 * sessão e pede o login do outro lado, para nunca misturar quem é quem.
 */
export type DestinoDaTroca = "painel" | "crm" | "correio";

const TEXTOS: Record<DestinoDaTroca, { titulo: string; corpo: string; botao: string; para: string }> = {
  painel: {
    titulo: "Entrar no painel da empresa",
    corpo: "O painel tem um acesso próprio, o login geral da empresa. Você vai sair do CRM e entrar com esse login. Para voltar ao CRM, entre de novo com o seu usuário.",
    botao: "Sair e entrar no painel",
    para: "/dashboard",
  },
  crm: {
    titulo: "Entrar no CRM",
    corpo: "No CRM cada pessoa entra com o próprio usuário, e não com o login geral do painel. Você vai sair do painel e entrar com o seu usuário do CRM.",
    botao: "Sair e entrar no CRM",
    para: "/app",
  },
  correio: {
    titulo: "Entrar no Correio",
    corpo: "O Correio abre com o seu usuário (o mesmo do CRM), e não com o login geral do painel. Você vai sair do painel e entrar com o seu usuário.",
    botao: "Sair e entrar no Correio",
    para: "/correio?de=painel",
  },
};

export function useTrocaDeAcesso() {
  const { logout } = useAuth();
  const [destino, setDestino] = useState<DestinoDaTroca | null>(null);
  const [saindo, setSaindo] = useState(false);
  const t = destino ? TEXTOS[destino] : null;
  const trocar = async () => {
    if (!t) return;
    setSaindo(true);
    try {
      await logout();
    } finally {
      window.location.assign(`/login?next=${encodeURIComponent(t.para)}`);
    }
  };
  const janela = (
    <JanelaCentral
      aberta={!!t}
      onFechar={() => setDestino(null)}
      largura="sm"
      titulo={t ? t.titulo : ""}
      rodape={
        <>
          <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setDestino(null)}>Ficar aqui</button>
          <button type="button" className={botao.primario} onClick={() => void trocar()} disabled={saindo} data-confirmar-troca-de-acesso="">
            {saindo ? "Saindo..." : t ? t.botao : ""}
          </button>
        </>
      }
    >
      <p className={texto.corpo}>{t ? t.corpo : ""}</p>
    </JanelaCentral>
  );
  return { abrir: setDestino, janela };
}
