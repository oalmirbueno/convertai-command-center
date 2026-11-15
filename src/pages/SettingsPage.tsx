import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bell, Brain, Building2, CalendarHeart, ChevronRight, Cpu, KeyRound, Link2, Moon, Palette, Shield, SlidersHorizontal, Sparkles, Sun, User, Users } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import NotificationsPanel from "@/components/NotificationsPanel";
import DadosDaAgencia from "@/components/agencia/DadosDaAgencia";
import VideoDoDiaPrioritarioAdmin from "@/components/dia-prioritario/VideoDoDiaPrioritarioAdmin";
import { Avatar } from "@/components/ds";
import { CabecalhoDePagina, Carregando, SeletorCompacto, espaco, foco, juntar, superficie, texto } from "@/components/sistema";

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
 * Rodada ousada v3 (15/11/2026): cada grupo é um cartão grande com o ícone
 * num círculo; a Conta é o cartão de tinta e o Sistema leva o círculo verde.
 *
 * Grupos: Conta e Agência e equipe lado a
 * lado no computador; Sistema embaixo, na largura toda, com as linhas que
 * abrem por baixo delas mesmas (Chaves e custos, Estado dos motores,
 * Superpoderes; carga preguiçosa); por fim os Dados da agência. Explicação
 * só no "?". Endereços: ?secao=chaves|motores|superpoderes e ?motores=1.
 */

function IconeDaLinha({ children }: { children: ReactNode }) {
  return (
    <span className="mr-3.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground" aria-hidden="true">
      {children}
    </span>
  );
}

/** O texto de uma linha: nome em 15 px e uma linha apagada de apoio. */
function TextoDaLinha({ rotulo, apoio }: { rotulo: string; apoio: string }) {
  return (
    <span className="mr-3 flex min-w-0 flex-1 flex-col">
      <span className="min-w-0 truncate text-[15px] font-medium leading-5 tracking-[-0.01em] text-foreground">{rotulo}</span>
      <span className={juntar(texto.auxiliar, "mt-0.5 min-w-0 truncate")}>{apoio}</span>
    </span>
  );
}

const LINHA = "group -mx-3 flex w-[calc(100%+24px)] min-w-0 items-center rounded-[18px] px-3 py-3 text-left transition-colors hover:bg-muted";

/**
 * Cartão de seção (rodada ousada v3, 15/11/2026): grande, com o ícone num
 * círculo e o título em 20 px; as linhas ficam limpas, sem traço entre elas.
 * `variante="tinta"` é o cartão escuro (a Conta, o principal da tela) e
 * `destaque` pinta o círculo do ícone na cor da marca. `cabecalho` troca o
 * círculo e o título por um miolo próprio (o título continua no `aria-label`).
 */
function Grupo({
  titulo,
  icone,
  variante = "padrao",
  destaque = false,
  cabecalho,
  children,
  ...resto
}: {
  titulo: string;
  icone: ReactNode;
  variante?: "padrao" | "tinta";
  destaque?: boolean;
  cabecalho?: ReactNode;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <section className={juntar(superficie.painel, "min-w-0 p-5 sm:p-7", variante === "tinta" && superficie.tinta)} aria-label={titulo} {...resto}>
      <header className="mb-4 flex min-w-0 items-center sm:mb-5">
        {cabecalho || (
          <>
            <span className={juntar("mr-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-full", destaque ? "bg-accent-solid text-on-accent" : "bg-muted text-foreground")} aria-hidden="true">
              {icone}
            </span>
            <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold leading-7 tracking-[-0.02em] text-foreground">{titulo}</h2>
          </>
        )}
      </header>
      <ul className="min-w-0 space-y-1">{children}</ul>
    </section>
  );
}

/** Uma linha que leva a outro lugar ou abre uma janela. */
function LinhaDeAcao({ icone, rotulo, apoio, onClick }: { icone: ReactNode; rotulo: string; apoio: string; onClick: () => void }) {
  return (
    <li className="min-w-0">
      <button type="button" onClick={onClick} className={juntar(LINHA, foco)}>
        <IconeDaLinha>{icone}</IconeDaLinha>
        <TextoDaLinha rotulo={rotulo} apoio={apoio} />
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-foreground group-hover:text-background" aria-hidden="true">
          <ChevronRight className="h-4 w-4" />
        </span>
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
        className={juntar(LINHA, aberta && "bg-muted", foco)}
        {...resto}
      >
        <IconeDaLinha>{icone}</IconeDaLinha>
        <TextoDaLinha rotulo={rotulo} apoio={apoio} />
        <span className={juntar("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors", aberta ? "bg-accent-solid text-on-accent" : "bg-muted text-foreground group-hover:bg-foreground group-hover:text-background")} aria-hidden="true">
          <ChevronRight className={juntar("h-4 w-4 transition-transform", aberta && "rotate-90")} />
        </span>
      </button>
      {aberta && (
        <div id={corpo} className="min-w-0 pb-5 pt-4">
          <Suspense fallback={<Carregando rotulo={carregando} linhas={3} />}>{children}</Suspense>
        </div>
      )}
    </li>
  );
}

type Aberta = "chaves" | "motores" | "superpoderes" | "videoDoDia";

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
    videoDoDia: secao === "video-dia-prioritario",
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

      <div className="grid min-w-0 grid-cols-1 items-stretch gap-5 lg:grid-cols-2 lg:gap-6">
        <Grupo
          titulo="Conta"
          icone={<User className="h-5 w-5" />}
          variante="tinta"
          data-grupo-conta=""
          cabecalho={
            // A Conta é o cartão de tinta: a foto (ou as iniciais), o nome grande e o e-mail de quem está logado.
            <>
              <Avatar name={profile?.full_name} src={profile?.avatar_url} size="lg" tone="solid" className="mr-4 h-14 w-14 text-[18px]" />
              <span className="flex min-w-0 flex-1 flex-col">
                <h2 className={juntar(texto.rotulo, "truncate")}>Conta</h2>
                {profile?.full_name && <span className="min-w-0 truncate text-[24px] font-semibold leading-8 tracking-[-0.03em] text-foreground max-sm:text-[20px] max-sm:leading-7" data-nome-da-conta="">{profile.full_name}</span>}
                {profile?.email && <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>{profile.email}</span>}
              </span>
            </>
          }
        >
          <li className="flex min-w-0 items-center py-3">
            <IconeDaLinha>
              <Palette className="h-4 w-4" />
            </IconeDaLinha>
            <span className="mr-3 min-w-0 flex-1 truncate text-[15px] font-medium leading-5 tracking-[-0.01em] text-foreground">Aparência</span>
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

        <Grupo titulo="Agência e equipe" icone={<Building2 className="h-5 w-5" />} data-grupo-agencia="">
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

      <Grupo titulo="Sistema" icone={<SlidersHorizontal className="h-5 w-5" />} destaque data-grupo-sistema="">
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
        {admin && (
          <LinhaDeAcao
            icone={<Link2 className="h-4 w-4" />}
            rotulo="Meta pelo usuário do sistema"
            apoio="Token da BM que não vence, para publicar e medir"
            onClick={() => navigate("/config/meta-usuario-do-sistema")}
          />
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
        {admin && (
          <LinhaQueAbre
            id="videoDoDia"
            icone={<CalendarHeart className="h-4 w-4" />}
            rotulo="Vídeo do Dia Prioritário"
            apoio="O vídeo oficial que o cliente vê no cartão do Dia Prioritário"
            aberta={abertas.videoDoDia}
            onAlternar={() => alternar("videoDoDia")}
            carregando="Lendo o vídeo"
            data-linha-video-dia-prioritario=""
          >
            <VideoDoDiaPrioritarioAdmin />
          </LinhaQueAbre>
        )}
      </Grupo>

      <div id="dados-da-agencia" className={juntar(superficie.painel, "min-w-0 p-5 sm:p-7")}>
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
