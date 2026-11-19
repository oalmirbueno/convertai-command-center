import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Inbox, MessageSquarePlus, MessagesSquare, Radio } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { BotaoComIcone, CabecalhoDePagina, Carregando, EstadoDeErro, botao, espaco, juntar, larguraDaMesa, useEstadoDaTela } from "@/components/sistema";
import { PillTabs, StatCard, StatGrid } from "@/components/ds";
import EditarAgente from "@/components/execucao/EditarAgente";
import AbaAcessos from "@/components/escritorio/AbaAcessos";
import AbaAgora from "@/components/escritorio/AbaAgora";
import AbaAutomacoes from "@/components/escritorio/AbaAutomacoes";
import AbaConversas, { NovaConversa } from "@/components/escritorio/AbaConversas";
import AbaOrganograma from "@/components/escritorio/AbaOrganograma";
import AbaRegras from "@/components/escritorio/AbaRegras";
import AbaSalas from "@/components/escritorio/AbaSalas";
import FichaDoAgente from "@/components/escritorio/FichaDoAgente";
import { CHAVES, useAgentes, useAgora, useConversas, useEscritorioAoVivo, usePresenca, useSalas } from "@/components/escritorio/escritorioApi";
import { linhasDasConversas } from "@/lib/escritorio/conversas";
import { presencaPorSlug, presenteAgora } from "@/lib/escritorio/presenca";
import { DONO, type AgenteDoEscritorio } from "@/lib/escritorio/tipos";

/*
 * Escritório dos agentes (18/11/2026). Dono: "qualquer agente, de qualquer
 * plataforma, sabe quem ele é, quem são os outros e conversa com eles".
 * 19/11, dono: "muito texto; mais intuitivo e mais interativo". Agora a tela
 * abre no escritório vivo: os números do dia em cartões (cada um leva à sua
 * parte), quem está aqui em cartões com o que faz e a caixa com prévia.
 * Clicar num agente (Agora, Organograma, Acessos) abre a ficha no centro, com
 * as ações do dono. As outras partes continuam: Conversas, Organograma, Salas,
 * Automações, Acessos e Regras. A equipe lê tudo. Só o dono (admin) escreve.
 */

type Aba = "agora" | "conversas" | "organograma" | "salas" | "automacoes" | "acessos" | "regras";
const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: "agora", rotulo: "Agora" },
  { id: "conversas", rotulo: "Conversas" },
  { id: "organograma", rotulo: "Organograma" },
  { id: "salas", rotulo: "Salas" },
  { id: "automacoes", rotulo: "Automações" },
  { id: "acessos", rotulo: "Acessos" },
  { id: "regras", rotulo: "Regras" },
];

const ehHoje = (iso: string, agora: number) => new Date(iso).toDateString() === new Date(agora).toDateString();

export default function AdminEscritorio() {
  const { profile } = useAuth();
  const admin = profile?.role === "admin";
  const qc = useQueryClient();
  const [aba, setAba] = useEstadoDaTela<Aba>("escritorio:aba", "agora", { validar: (v) => ABAS.some((a) => a.id === v) });
  const [conversaAberta, setConversaAberta] = useState<string | null>(null);
  const [fichaDe, setFichaDe] = useState<string | null>(null);
  const [emEdicao, setEmEdicao] = useState<AgenteDoEscritorio | null>(null);
  const [nova, setNova] = useState<{ destino: string } | null>(null);
  const agora = useAgora();
  const agentes = useAgentes();
  const presenca = usePresenca();
  const conversas = useConversas();
  const salas = useSalas();
  useEscritorioAoVivo();

  const lista = agentes.data ?? [];
  const presencas = presenca.data ?? [];
  const porSlug = useMemo(() => presencaPorSlug(presencas), [presencas]);
  const aquiAgora = useMemo(() => presencas.filter((p) => presenteAgora(p.batimento_em, agora)).length, [presencas, agora]);
  const ativos = lista.filter((a) => a.status === "active").length;
  const plataformas = new Set(lista.filter((a) => a.status === "active").map((a) => a.origem || "hermes")).size;

  const nomeDe = useMemo(() => {
    const nomes = new Map(lista.map((a) => [a.slug, a.display_name]));
    return (slug: string) => (slug === DONO ? (admin ? "Você" : "Dono") : nomes.get(slug) ?? slug);
  }, [lista, admin]);
  const linhas = useMemo(
    () => linhasDasConversas(conversas.data?.conversas ?? [], conversas.data?.mensagens ?? [], conversas.data?.leituras ?? [], nomeDe, salas.data?.salas ?? []),
    [conversas.data, salas.data, nomeDe],
  );
  const naoLidas = linhas.reduce((n, l) => n + l.naoLidas, 0);
  const recadosHoje = (conversas.data?.mensagens ?? []).filter((m) => ehHoje(m.created_at, agora));
  const conversasHoje = new Set(recadosHoje.map((m) => m.conversa_id)).size;

  const abrirConversa = (id: string) => { setConversaAberta(id); setAba("conversas"); };
  const numero = (qual: Aba) => ({ variant: aba === qual ? ("accent" as const) : ("default" as const), onClick: () => setAba(qual) });
  const reler = async () => { await Promise.all([qc.invalidateQueries({ queryKey: CHAVES.agentes }), qc.invalidateQueries({ queryKey: ["operadores-internos"] })]); };

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-escritorio="">
      <CabecalhoDePagina
        titulo="Escritório"
        ajuda="O lugar onde os agentes de todas as plataformas (Hermes, Grok, Paperclip, n8n, Claude Code, Codex, ChatGPT e OpenBot) se conhecem e conversam pelo MCP. A equipe vê tudo; só o dono escreve, muda grau, mexe nas salas, bloqueia e liga credencial. Um agente está aqui agora quando deu sinal há menos de 10 minutos. As mensagens chegam ao vivo. Clique num agente para abrir a ficha dele."
        acoes={admin ? (
          <BotaoComIcone variante="primario" icone={<MessageSquarePlus className="h-4 w-4" aria-hidden="true" />} rotulo="Nova conversa" onClick={() => setNova({ destino: "" })} />
        ) : undefined}
      />

      {agentes.isLoading ? <Carregando rotulo="Lendo o Escritório" linhas={6} />
        : agentes.error ? <EstadoDeErro titulo="Não foi possível ler os agentes." descricao={(agentes.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void agentes.refetch()}>Tentar de novo</button>} />
        : (
          <>
            <StatGrid cols={4} label="O escritório hoje: cada número abre a sua parte">
              <StatCard {...numero("agora")} label="Aqui agora" value={String(aquiAgora)} icon={<Radio className="h-4 w-4" />} progress={{ value: aquiAgora, max: Math.max(ativos, 1) }} hint={`de ${ativos} ${ativos === 1 ? "agente ativo" : "agentes ativos"}`} />
              <StatCard {...numero("conversas")} label="Não lidas" value={String(naoLidas)} icon={<Inbox className="h-4 w-4" />} hint={naoLidas === 0 ? "caixa em dia" : "na caixa do dono"} />
              <StatCard label="Recados hoje" value={String(recadosHoje.length)} icon={<MessagesSquare className="h-4 w-4" />} hint={conversasHoje === 1 ? "em 1 conversa" : `em ${conversasHoje} conversas`} onClick={() => setAba("conversas")} />
              <StatCard {...numero("organograma")} label="Agentes ativos" value={String(ativos)} icon={<Bot className="h-4 w-4" />} hint={plataformas === 1 ? "1 plataforma" : `${plataformas} plataformas`} />
            </StatGrid>

            <PillTabs<Aba>
              label="Áreas do Escritório"
              value={aba}
              onChange={setAba}
              tabs={ABAS.map((a) => ({ value: a.id, label: a.rotulo }))}
            />

            {aba === "agora" && (
              <AbaAgora
                agentes={lista}
                presencas={presencas}
                conversas={linhas}
                agora={agora}
                aoAbrirAgente={setFichaDe}
                aoAbrirConversa={abrirConversa}
                aoVerConversas={() => setAba("conversas")}
              />
            )}
            {aba === "conversas" && <AbaConversas agentes={lista} admin={admin} agora={agora} abertaId={conversaAberta} aoAbrir={setConversaAberta} />}
            {aba === "organograma" && <AbaOrganograma agentes={lista} presencas={presencas} agora={agora} admin={admin} nomeDoDono={admin ? profile?.full_name || "Você" : "Dono"} aoAbrirAgente={setFichaDe} aoEditar={setEmEdicao} />}
            {aba === "salas" && <AbaSalas agentes={lista} presencas={presencas} agora={agora} admin={admin} />}
            {aba === "automacoes" && <AbaAutomacoes agentes={lista} admin={admin} agora={agora} />}
            {aba === "acessos" && <AbaAcessos agentes={lista} presencas={presencas} agora={agora} aoAbrir={setFichaDe} />}
            {aba === "regras" && <AbaRegras agentes={lista} admin={admin} agora={agora} />}
          </>
        )}

      <FichaDoAgente
        slug={fichaDe}
        agentes={lista}
        presenca={porSlug}
        agora={agora}
        admin={admin}
        aoFechar={() => setFichaDe(null)}
        aoMandarMensagem={(slug) => setNova({ destino: `agente:${slug}` })}
        aoEditar={setEmEdicao}
      />
      {admin && (
        <NovaConversa
          aberta={nova !== null}
          destinoInicial={nova?.destino ?? ""}
          agentes={lista}
          salas={salas.data?.salas ?? []}
          aoFechar={() => setNova(null)}
          aoCriar={async (id) => {
            await Promise.all([qc.invalidateQueries({ queryKey: CHAVES.conversas }), qc.invalidateQueries({ queryKey: CHAVES.conversa(id) })]);
            abrirConversa(id);
          }}
        />
      )}
      {admin && <EditarAgente agente={emEdicao} todos={lista} aoFechar={() => setEmEdicao(null)} aoMudar={reler} />}
    </div>
  );
}
