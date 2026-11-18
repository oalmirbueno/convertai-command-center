import { useMemo } from "react";
import { DoorOpen, KeyRound, MessagesSquare, Network, ShieldCheck, Workflow } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CabecalhoDePagina, Carregando, EstadoDeErro, botao, espaco, juntar, larguraDaMesa, useEstadoDaTela } from "@/components/sistema";
import AbaAcessos from "@/components/escritorio/AbaAcessos";
import AbaAutomacoes from "@/components/escritorio/AbaAutomacoes";
import AbaConversas from "@/components/escritorio/AbaConversas";
import AbaOrganograma from "@/components/escritorio/AbaOrganograma";
import AbaRegras from "@/components/escritorio/AbaRegras";
import AbaSalas from "@/components/escritorio/AbaSalas";
import { useAgentes, useAgora, useEscritorioAoVivo, usePresenca } from "@/components/escritorio/escritorioApi";
import { presenteAgora } from "@/lib/escritorio/presenca";

/*
 * Escritório dos agentes (18/11/2026). Dono: "qualquer agente, de qualquer
 * plataforma, sabe quem ele é, quem são os outros e conversa com eles".
 * Uma tela para a equipe ver e o dono mexer:
 * - Organograma: todos os agentes, com plataforma e grau, e o aviso de função repetida.
 * - Conversas: o que os agentes falam entre si e com o dono; o dono escreve.
 * - Salas: quem está em cada sala e com qual papel.
 * - Automações: os fluxos, o dono de cada um, a última execução e o último erro.
 * - Acessos: grau, credenciais, última atividade, bloquear e ligar credencial.
 * - Regras: o que o agente faz sozinho, os limites de cada regra e o que sempre sobe para o dono.
 * A equipe lê tudo. Só o dono (admin) escreve.
 */

type Aba = "organograma" | "conversas" | "salas" | "automacoes" | "acessos" | "regras";
const ABAS: Array<{ id: Aba; rotulo: string; icone: typeof Network }> = [
  { id: "organograma", rotulo: "Organograma", icone: Network },
  { id: "conversas", rotulo: "Conversas", icone: MessagesSquare },
  { id: "salas", rotulo: "Salas", icone: DoorOpen },
  { id: "automacoes", rotulo: "Automações", icone: Workflow },
  { id: "acessos", rotulo: "Acessos", icone: KeyRound },
  { id: "regras", rotulo: "Regras", icone: ShieldCheck },
];

export default function AdminEscritorio() {
  const { profile } = useAuth();
  const admin = profile?.role === "admin";
  const [aba, setAba] = useEstadoDaTela<Aba>("escritorio:aba", "organograma", { validar: (v) => ABAS.some((a) => a.id === v) });
  const agora = useAgora();
  const agentes = useAgentes();
  const presenca = usePresenca();
  useEscritorioAoVivo();

  const lista = agentes.data ?? [];
  const presencas = presenca.data ?? [];
  const aquiAgora = useMemo(() => presencas.filter((p) => presenteAgora(p.batimento_em, agora)).length, [presencas, agora]);
  const ativos = lista.filter((a) => a.status === "active").length;
  const estado = agentes.isLoading ? " " : `${ativos} ${ativos === 1 ? "agente ativo" : "agentes ativos"} · ${aquiAgora === 0 ? "ninguém aqui agora" : aquiAgora === 1 ? "1 aqui agora" : `${aquiAgora} aqui agora`}`;

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-escritorio="">
      <CabecalhoDePagina
        titulo="Escritório"
        descricao={estado}
        ajuda="O lugar onde os agentes de todas as plataformas (Hermes, Grok, Paperclip, n8n, Claude Code, Codex, ChatGPT e OpenBot) se conhecem e conversam pelo MCP. A equipe vê tudo; só o dono escreve, muda grau, mexe nas salas, bloqueia e liga credencial. Um agente está aqui agora quando deu sinal há menos de 10 minutos. As mensagens chegam ao vivo."
      />
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Áreas do Escritório">
        {ABAS.map(({ id, rotulo, icone: Icone }) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={juntar(aba === id ? botao.primario : botao.secundario, "h-9")}>
            <Icone className="mr-1.5 h-4 w-4" aria-hidden="true" />{rotulo}
          </button>
        ))}
      </div>

      {agentes.isLoading ? <Carregando rotulo="Lendo o Escritório" linhas={6} />
        : agentes.error ? <EstadoDeErro titulo="Não foi possível ler os agentes." descricao={(agentes.error as Error).message} />
        : (
          <>
            {aba === "organograma" && <AbaOrganograma agentes={lista} presencas={presencas} agora={agora} admin={admin} nomeDoDono={admin ? profile?.full_name || "Você" : "Dono"} />}
            {aba === "conversas" && <AbaConversas agentes={lista} admin={admin} agora={agora} />}
            {aba === "salas" && <AbaSalas agentes={lista} presencas={presencas} agora={agora} admin={admin} />}
            {aba === "automacoes" && <AbaAutomacoes agentes={lista} admin={admin} agora={agora} />}
            {aba === "acessos" && <AbaAcessos agentes={lista} presencas={presencas} agora={agora} admin={admin} />}
            {aba === "regras" && <AbaRegras agentes={lista} admin={admin} agora={agora} />}
          </>
        )}
    </div>
  );
}
