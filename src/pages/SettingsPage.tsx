import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bell, Brain, Building2, ChevronRight, Cpu, KeyRound, Moon, Palette, Shield, Sparkles, Sun, User, Users } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import NotificationsPanel from "@/components/NotificationsPanel";
import DadosDaAgencia from "@/components/agencia/DadosDaAgencia";
import { CabecalhoDePagina, Carregando, SeletorCompacto, espaco, foco, juntar, texto } from "@/components/sistema";

// Frente SPP (30/09): a seção dos superpoderes só carrega quando a pessoa abre a linha.
const SuperpoderesDasMesas = lazy(() => import("@/components/config/SuperpoderesDasMesas"));
// Frente MTR (30/09): o estado dos motores também só carrega quando a pessoa abre a linha (ou chega com ?motores=1).
const EstadoDosMotores = lazy(() => import("@/components/config/EstadoDosMotores"));
// Frente CHV (01/10): Chaves e custos (só admin), sob demanda (ou ?secao=chaves).
const ChavesECustos = lazy(() => import("@/components/config/ChavesECustos"));
// O catálogo de modelos é a mesma janela das mesas (só admin).
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

/**
 * Configurações em largura total (frente CHV, 01/10/2026; pedido do dono:
 * "deixar as Configurações estendidas, no padrão do sistema, bem bonito").
 *
 * Grupos abertos, sem caixa (SISTEMA.md 4.1): Conta e Agência e equipe lado a
 * lado no computador; Sistema embaixo, na largura toda, com as linhas que
 * abrem por baixo delas mesmas (Chaves e custos, Estado dos motores,
 * Superpoderes; carga preguiçosa); por fim os Dados da agência. Explicação
 * só no "?". Endereços: ?secao=chaves|motores|superpoderes e ?motores=1.
 */

function IconeDaLinha({ children }: { children: ReactNode }) {
  return (
    <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
      {children}
    </span>
  );
}

function Grupo({ titulo, children, ...resto }: { titulo: string; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <section className="min-w-0" aria-label={titulo} {...resto}>
      <h2 className={juntar(texto.rotulo, "mb-1")}>{titulo}</h2>
      <ul className="min-w-0 divide-y divide-border border-y border-border">{children}</ul>
    </section>
  );
}

/** Uma linha que leva a outro lugar ou abre uma janela. */
function LinhaDeAcao({ icone, rotulo, apoio, onClick }: { icone: ReactNode; rotulo: string; apoio: string; onClick: () => void }) {
  return (
    <li className="min-w-0">
      <button type="button" onClick={onClick} className={juntar("flex w-full min-w-0 items-center rounded-md py-3 text-left transition-colors hover:bg-muted/50", foco)}>
        <IconeDaLinha>{icone}</IconeDaLinha>
        <span className={juntar(texto.corpo, "mr-3 min-w-0 truncate font-medium")}>{rotulo}</span>
        <span className={juntar(texto.auxiliar, "mr-2 hidden min-w-0 flex-1 truncate text-right sm:block")}>{apoio}</span>
        <span className="min-w-0 flex-1 sm:hidden" aria-hidden="true" />
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Uma linha que abre o conteúdo logo abaixo dela (tudo recolhe, SISTEMA.md 4.3). */
function LinhaQueAbre({
  id,
  icone,
  rotulo,
  apoio,
  aberta,
  onAlternar,
  carregando,
  children,
  ...resto
}: {
  id: string;
  icone: ReactNode;
  rotulo: string;
  apoio: string;
  aberta: boolean;
  onAlternar: () => void;
  carregando: string;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const corpo = `config-${id}`;
  return (
    <li className="min-w-0" id={`secao-${id}`}>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberta}
        aria-controls={corpo}
        className={juntar("flex w-full min-w-0 items-center rounded-md py-3 text-left transition-colors hover:bg-muted/50", foco)}
        {...resto}
      >
        <IconeDaLinha>{icone}</IconeDaLinha>
        <span className={juntar(texto.corpo, "mr-3 min-w-0 truncate font-medium")}>{rotulo}</span>
        <span className={juntar(texto.auxiliar, "mr-2 hidden min-w-0 flex-1 truncate text-right sm:block")}>{apoio}</span>
        <span className="min-w-0 flex-1 sm:hidden" aria-hidden="true" />
        <ChevronRight className={juntar("h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberta && "rotate-90")} aria-hidden="true" />
      </button>
      {aberta && (
        <div id={corpo} className="min-w-0 pb-5 pt-1">
          <Suspense fallback={<Carregando rotulo={carregando} linhas={3} />}>{children}</Suspense>
        </div>
      )}
    </li>
  );
}

type Aberta = "chaves" | "motores" | "superpoderes";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { profile } = useAuth();
  const admin = profile?.role === "admin";
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [busca] = useSearchParams();
  const secao = busca.get("secao");
  const [abertas, setAbertas] = useState<Record<Aberta, boolean>>(() => ({
    chaves: secao === "chaves",
    motores: busca.get("motores") === "1" || secao === "motores",
    superpoderes: secao === "superpoderes",
  }));
  const [destaque, setDestaque] = useState<string | null>(() => busca.get("chave"));
  const [rolarPara, setRolarPara] = useState<Aberta | null>(() => (secao === "chaves" || secao === "motores" || secao === "superpoderes" ? secao : null));
  const alternar = (s: Aberta) => setAbertas((a) => ({ ...a, [s]: !a[s] }));

  // Leva a linha aberta para a vista (link do Estado dos motores e ?secao=).
  useEffect(() => {
    if (!rolarPara) return;
    const el = typeof document !== "undefined" ? document.getElementById(`secao-${rolarPara}`) : null;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "smooth" });
    setRolarPara(null);
  }, [rolarPara]);

  const abrirChaves = (id?: string | null) => {
    setAbertas((a) => ({ ...a, chaves: true }));
    setDestaque(id || null);
    setRolarPara("chaves");
  };

  return (
    <div className={espaco.pagina}>
      <CabecalhoDePagina
        titulo="Configurações"
        ajuda="Tema e conta, a equipe, os modelos de IA, as chaves dos provedores com o custo do mês, o estado dos motores, o método dos agentes (superpoderes) e os dados da agência."
      />

      <div className={juntar(espaco.colunas, "lg:grid-cols-2")}>
        <Grupo titulo="Conta" data-grupo-conta="">
          <li className="flex min-w-0 items-center py-3">
            <IconeDaLinha>
              <Palette className="h-4 w-4" />
            </IconeDaLinha>
            <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-medium")}>Aparência</span>
            <SeletorCompacto
              rotulo="Tema"
              valor={theme}
              onEscolher={(v) => setTheme(v === "light" ? "light" : "dark")}
              opcoes={[
                { valor: "dark", rotulo: "Escuro", icone: <Moon className="h-3.5 w-3.5" /> },
                { valor: "light", rotulo: "Claro", icone: <Sun className="h-3.5 w-3.5" /> },
              ]}
            />
          </li>
          <LinhaDeAcao icone={<User className="h-4 w-4" />} rotulo="Perfil" apoio="Nome, empresa e foto" onClick={() => navigate("/perfil")} />
          <LinhaDeAcao icone={<Bell className="h-4 w-4" />} rotulo="Notificações" apoio="Avisos e atualizações" onClick={() => setNotificationsOpen(true)} />
          <LinhaDeAcao icone={<Shield className="h-4 w-4" />} rotulo="Segurança" apoio="Senha, no perfil" onClick={() => navigate("/perfil")} />
        </Grupo>

        <Grupo titulo="Agência e equipe" data-grupo-agencia="">
          <LinhaDeAcao icone={<Users className="h-4 w-4" />} rotulo="Equipe" apoio="Pessoas, papéis e acessos" onClick={() => navigate("/equipe")} />
          {admin && <LinhaDeAcao icone={<Brain className="h-4 w-4" />} rotulo="Modelos de IA" apoio="Catálogo e padrão de cada papel" onClick={() => setModelosAbertos(true)} />}
          <LinhaDeAcao
            icone={<Building2 className="h-4 w-4" />}
            rotulo="Dados da agência"
            apoio="Contratada, foro, contato e logo"
            onClick={() => {
              const el = typeof document !== "undefined" ? document.getElementById("dados-da-agencia") : null;
              if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          />
        </Grupo>
      </div>

      <Grupo titulo="Sistema" data-grupo-sistema="">
        {admin && (
          <LinhaQueAbre
            id="chaves"
            icone={<KeyRound className="h-4 w-4" />}
            rotulo="Chaves e custos"
            apoio="Chaves dos provedores, validade, saldo e gasto do mês"
            aberta={abertas.chaves}
            onAlternar={() => alternar("chaves")}
            carregando="Lendo as chaves"
            data-linha-chaves=""
          >
            <ChavesECustos destaque={destaque} />
          </LinhaQueAbre>
        )}
        <LinhaQueAbre
          id="motores"
          icone={<Cpu className="h-4 w-4" />}
          rotulo="Estado dos motores"
          apoio="Site, render, imagem e vídeo"
          aberta={abertas.motores}
          onAlternar={() => alternar("motores")}
          carregando="Conferindo os motores"
          data-linha-motores=""
        >
          <EstadoDosMotores semTitulo onAbrirChaves={admin ? abrirChaves : undefined} admin={admin} />
        </LinhaQueAbre>
        <LinhaQueAbre
          id="superpoderes"
          icone={<Sparkles className="h-4 w-4" />}
          rotulo="Superpoderes"
          apoio="Método dos agentes"
          aberta={abertas.superpoderes}
          onAlternar={() => alternar("superpoderes")}
          carregando="Carregando os superpoderes"
          data-linha-superpoderes=""
        >
          <SuperpoderesDasMesas />
        </LinhaQueAbre>
      </Grupo>

      <div id="dados-da-agencia" className="min-w-0">
        <DadosDaAgencia />
      </div>

      {notificationsOpen && <NotificationsPanel open={notificationsOpen} onOpenChange={setNotificationsOpen} />}
      {admin && modelosAbertos && (
        <Suspense fallback={null}>
          <ModelosDeIa aberto={modelosAbertos} onOpenChange={setModelosAbertos} />
        </Suspense>
      )}
    </div>
  );
}
