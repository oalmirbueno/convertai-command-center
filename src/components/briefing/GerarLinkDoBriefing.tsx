import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Loader2, MessageCircle, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useClients, useProjects } from "@/hooks/useSupabaseData";
import { appPublicUrl } from "@/lib/publicUrl";
import { CampoDeFormulario, GrupoDeCampos, JanelaCentral, botao, campo, gravarEstadoDaTela, juntar, lerEstadoDaTela, superficie, texto } from "@/components/sistema";
import { type LinkGerado, chamarAgenteDoBriefing, textoDoErroDoBriefing } from "@/lib/briefing/api";
import PerguntasExtras from "./PerguntasExtras";
import {
  type CampoDoBriefing,
  type SlugDoModelo,
  MODELOS_DE_FABRICA,
  camposDoModelo,
  SLUGS_DE_BRIEFING,
  VALIDADE_PADRAO_DIAS,
  linkDoWhatsApp,
  mensagemDoLink,
  modeloDeFabrica,
} from "../../../supabase/functions/_shared/briefing-modelos";

/**
 * Gerar o link do briefing (frente BRF, 30/09/2026): na ficha do cliente,
 * na lista de Briefings e em cada mesa (botão Briefing da casca). Escolhe o
 * modelo, a validade e, quando o cliente tem mais de uma marca, a marca. O
 * servidor grava a cópia do modelo e o que o painel já sabe do cliente para
 * ele só confirmar. Depois: Copiar link, WhatsApp (wa.me, a equipe envia) e
 * a mensagem pronta para o grupo. Nada é enviado daqui.
 *
 * Frente UXS: a janela é a JanelaCentral (Esc, foco preso, no centro), não
 * fecha no meio do "Gerando...", lembra o último tipo e a última validade
 * quando a tela não passa o modelo, e com o telefone do cliente o WhatsApp é
 * o principal.
 */

const VALIDADES = [7, 15, 30, 60, 90];

/** Último tipo e validade usados (só quando a tela não passa o modelo). Rota fixa: o mesmo em /briefings, na ficha e no Dashboard. */
const MEMORIA_DO_NOVO_LINK = "briefing:novo-link";
const ROTA_DA_MEMORIA = "/briefings";
type Lembrado = { modelo: SlugDoModelo; validade: number };
const lembradoValido = (v: unknown): boolean => {
  if (!v || typeof v !== "object") return false;
  const x = v as { modelo?: unknown; validade?: unknown };
  return SLUGS_DE_BRIEFING.indexOf(x.modelo as SlugDoModelo) >= 0 && VALIDADES.indexOf(Number(x.validade)) >= 0;
};

export async function copiarTexto(t: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch { /* cai no plano B */ }
  try {
    const area = document.createElement("textarea");
    area.value = t;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export default function GerarLinkDoBriefing({
  open,
  onClose,
  clientId: clienteFixo,
  marcaId: marcaInicial = null,
  modelo: modeloInicial,
  projectId: projetoInicial = null,
  aoGerar,
}: {
  open: boolean;
  onClose: () => void;
  clientId?: string | null;
  marcaId?: string | null;
  modelo?: SlugDoModelo;
  projectId?: string | null;
  aoGerar?: (l: LinkGerado) => void;
}) {
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const [clientId, setClientId] = useState(clienteFixo || "");
  const [modelo, setModelo] = useState<SlugDoModelo>(modeloInicial ?? "diagnostico");
  const [marcaId, setMarcaId] = useState<string>(marcaInicial || "");
  const [projectId, setProjectId] = useState<string>(projetoInicial || "");
  const [validade, setValidade] = useState(VALIDADE_PADRAO_DIAS);
  const [gerando, setGerando] = useState(false);
  const [gerado, setGerado] = useState<LinkGerado | null>(null);
  const [copiado, setCopiado] = useState<"link" | "grupo" | null>(null);
  const [extras, setExtras] = useState<CampoDoBriefing[]>([]);

  useEffect(() => {
    if (!open) return;
    // Modelo vindo da mesa manda; sem ele, o último tipo e a última validade usados.
    const lembrado = modeloInicial ? null : lerEstadoDaTela<Lembrado | null>(MEMORIA_DO_NOVO_LINK, null, lembradoValido, ROTA_DA_MEMORIA);
    setClientId(clienteFixo || "");
    setModelo(modeloInicial ?? (lembrado ? lembrado.modelo : "diagnostico"));
    setMarcaId(marcaInicial || "");
    setProjectId(projetoInicial || "");
    setValidade(lembrado ? Number(lembrado.validade) : VALIDADE_PADRAO_DIAS);
    setGerado(null);
    setCopiado(null);
    setExtras([]);
  }, [open, clienteFixo, modeloInicial, marcaInicial, projetoInicial]);

  const { data: marcas } = useQuery({
    queryKey: ["briefing-marcas", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cliente_marcas" as any).select("id, nome, principal").eq("client_id", clientId).order("ordem", { ascending: true });
      if (error) throw error;
      return (data as unknown as Array<{ id: string; nome: string; principal: boolean }>) || [];
    },
    enabled: open && !!clientId,
  });

  const projetosDoCliente = useMemo(() => ((projects as any[]) || []).filter((p) => p.client_id === clientId), [projects, clientId]);
  const url = gerado ? appPublicUrl(gerado.caminho) : "";
  const modeloDoLink = modeloDeFabrica(gerado?.briefing.modelo || modelo);
  const mensagem = gerado ? mensagemDoLink({ cliente: gerado.cliente, modelo: modeloDoLink, url, expiraEm: gerado.briefing.expira_em }) : "";
  const mensagemDoGrupo = gerado ? mensagemDoLink({ cliente: gerado.cliente, modelo: modeloDoLink, url, expiraEm: gerado.briefing.expira_em, grupo: true }) : "";

  const gerar = async () => {
    if (!clientId) {
      toast.error("Escolha o cliente.");
      return;
    }
    setGerando(true);
    try {
      const r = await chamarAgenteDoBriefing<LinkGerado>("gerar_link", {
        client_id: clientId,
        modelo,
        marca_id: marcaId || null,
        project_id: projectId || null,
        validade_dias: validade,
        extras,
      });
      setGerado(r);
      if (!modeloInicial) gravarEstadoDaTela<Lembrado>(MEMORIA_DO_NOVO_LINK, { modelo, validade }, ROTA_DA_MEMORIA);
      aoGerar?.(r);
      toast.success("Link gerado. Copie e envie ao cliente.");
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível gerar o link."));
    } finally {
      setGerando(false);
    }
  };

  const copiar = async (qual: "link" | "grupo") => {
    const ok = await copiarTexto(qual === "link" ? url : mensagemDoGrupo);
    if (!ok) {
      toast.error("Não foi possível copiar. Selecione o texto e copie à mão.");
      return;
    }
    setCopiado(qual);
    window.setTimeout(() => setCopiado(null), 2000);
  };

  const telefone = gerado ? gerado.telefone : null;
  return (
    <JanelaCentral
      aberta={open}
      // Nada fecha no meio do "Gerando..." (Esc, fundo e o X): o link criado não some da vista.
      onFechar={() => {
        if (!gerando) onClose();
      }}
      fecharNoFundo={false}
      titulo="Link do briefing"
      ajuda="Gera um link para o cliente responder no celular, no tempo dele. Salva sozinho, aceita arquivos e vale até a data escolhida. O que o painel já sabe do cliente vai preenchido para ele só confirmar. Depois de enviado, a equipe recebe o aviso e a decupagem. Sem modelo vindo da mesa, a janela lembra o último tipo e a última validade."
      largura="md"
      corpo="rola"
      rodape={
        !gerado ? (
          <>
            <button type="button" onClick={onClose} disabled={gerando} className={botao.secundario}>Fechar</button>
            <button type="button" onClick={() => void gerar()} disabled={gerando || !clientId} className={botao.primario}>
              {gerando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              {gerando ? "Gerando..." : "Gerar link"}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => void copiar("grupo")} className={botao.discreto}>
              {copiado === "grupo" ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {copiado === "grupo" ? "Copiado" : "Texto do grupo"}
            </button>
            {/* Com o telefone do cliente, o caminho comum é o WhatsApp com a mensagem pronta. */}
            <a href={linkDoWhatsApp(mensagem, telefone)} target="_blank" rel="noopener noreferrer" className={telefone ? botao.primario : botao.secundario}>
              <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
              WhatsApp
            </a>
            <button type="button" onClick={() => void copiar("link")} className={telefone ? botao.secundario : botao.primario}>
              {copiado === "link" ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {copiado === "link" ? "Copiado" : "Copiar link"}
            </button>
          </>
        )
      }
    >
      {!gerado ? (
        <GrupoDeCampos colunas={1}>
          {!clienteFixo && (
            <CampoDeFormulario rotulo="Cliente" obrigatorio>
              <select value={clientId} onChange={(e) => { setClientId(e.target.value); setMarcaId(""); setProjectId(""); }} className={campo}>
                <option value="">Selecionar...</option>
                {((clients as any[]) || []).map((c) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
              </select>
            </CampoDeFormulario>
          )}
          <CampoDeFormulario rotulo="Tipo de briefing" obrigatorio apoio={`${MODELOS_DE_FABRICA[modelo].minutos} minutos, mais ou menos.`}>
            <select value={modelo} onChange={(e) => setModelo(e.target.value as SlugDoModelo)} className={campo}>
              {SLUGS_DE_BRIEFING.map((s) => <option key={s} value={s}>{MODELOS_DE_FABRICA[s].nome}</option>)}
            </select>
          </CampoDeFormulario>
          {(marcas || []).length > 1 && (
            <CampoDeFormulario rotulo="Marca" apoio="O que o cliente responder vai para o contexto desta marca.">
              <select value={marcaId} onChange={(e) => setMarcaId(e.target.value)} className={campo}>
                <option value="">Principal</option>
                {(marcas || []).filter((m) => !m.principal).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </CampoDeFormulario>
          )}
          {projetosDoCliente.length > 0 && (
            <CampoDeFormulario rotulo="Projeto" apoio="Opcional.">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={campo}>
                <option value="">Sem projeto</option>
                {projetosDoCliente.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </CampoDeFormulario>
          )}
          <CampoDeFormulario rotulo="Validade">
            <select value={validade} onChange={(e) => setValidade(Number(e.target.value))} className={campo}>
              {VALIDADES.map((d) => <option key={d} value={d}>{d} dias</option>)}
            </select>
          </CampoDeFormulario>
          <PerguntasExtras extras={extras} onMudar={setExtras} chavesDoModelo={camposDoModelo(MODELOS_DE_FABRICA[modelo]).map((c) => c.key)} />
        </GrupoDeCampos>
      ) : (
        <div className="min-w-0 space-y-4">
          <CampoDeFormulario rotulo="Link" apoio={`${modeloDoLink.nome} · vale até ${new Date(gerado.briefing.expira_em).toLocaleDateString("pt-BR")}${gerado.prefill_campos.length ? ` · ${gerado.prefill_campos.length} dados para confirmar` : ""}`}>
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={juntar(campo, "font-mono text-[12px]")} />
          </CampoDeFormulario>
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>Mensagem</p>
            <p className={juntar(superficie.poco, texto.corpo, "whitespace-pre-line px-3 py-2 [overflow-wrap:anywhere]")}>{mensagem}</p>
          </div>
        </div>
      )}
    </JanelaCentral>
  );
}
