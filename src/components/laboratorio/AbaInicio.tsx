import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Workflow } from "lucide-react";
import { espaco, juntar, lista as estiloDaLista, superficie, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { chaveDosProjetos, criarProjeto, listarFluxosDaGaleria, listarProjetos, pedidoInicio, perguntasDoPedido, usarTemplate, type PerguntaGuiada, type ProjetoDoLab } from "@/lib/laboratorio/api";
import { ATALHOS_DE_PROJETO_COMPLETO, MODELO_PADRAO_DO_LAB, ehProjetoCompleto } from "@/lib/laboratorio/nos";
import { guardarPedidoPendente } from "@/lib/laboratorio/pedidoPendente";
import CaixaDoPedido, { ATALHOS_DA_INICIO } from "./CaixaDoPedido";
import GaleriaDeFluxos, { ROLAGEM_DA_COLUNA } from "./GaleriaDeFluxos";
import PerguntasGuiadas from "./PerguntasGuiadas";
import { nomeDoCliente, type ClienteDoLab } from "./Seletores";

/**
 * Início do Laboratório: uma caixa de pedido ("peça um projeto, uma arte,
 * um carrossel, uma logo..."), com modelo e cliente opcional. Os atalhos só
 * preenchem o pedido. Pedido de peça chama `pedido_inicio`, que monta o
 * projeto pelo agente (sem gerar nada) e abre o canvas. Pedido de projeto
 * completo (empresa, low ticket, funil; v2) cria o projeto e abre o canvas
 * na hora: o Canvas Studio manda o `planejar` em modo projeto_completo e o
 * dono vê o quadro sendo construído. Abaixo, os fluxos (oficiais e pessoais,
 * "Usar fluxo") e os projetos recentes.
 *
 * v3: antes de criar o projeto completo, até 4 perguntas guiadas quando falta
 * o essencial (perguntas_do_pedido); as respostas (ou o "pular") seguem com
 * o pedido para o Canvas Studio. 21/10 (pedido do dono): as perguntas abrem
 * na etapa grande (só ela na tela, opção e campo por pergunta, conversa
 * livre, Seguir/Pular), e tocar num atalho de projeto completo já pergunta.
 *
 * v4 (20/10, dono: "o fluxo do lado, os recentes do lado, para não ficar
 * rodando muito scroll"): abaixo da caixa, Fluxos e Recentes lado a lado de
 * 1024 px para cima (fluxos à esquerda, 2/3; recentes numa coluna à direita,
 * em lista compacta); no celular, empilha. Os fluxos viram a GaleriaDeFluxos
 * (abas de categoria, busca, miniatura, "Seus fluxos").
 */

/** Quando o projeto mudou, curto: "hoje", "ontem" ou o dia. */
function quandoMudou(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(hoje) - dia(d)) / 86400000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Linha compacta de projeto recente (a coluna da direita da Início). */
function LinhaDeRecente({ p, clientes, onAbrir }: { p: ProjetoDoLab; clientes: ClienteDoLab[]; onAbrir: () => void }) {
  const quando = quandoMudou(p.updated_at);
  return (
    <li>
      <button type="button" onClick={onAbrir} title={`Abrir ${p.nome} no canvas`} className={juntar(estiloDaLista.linha, "w-full text-left")} data-recente={p.id}>
        {p.previa_url ? (
          <img src={p.previa_url} alt="" className="mr-3 block h-9 w-9 shrink-0 rounded-md object-cover" loading="lazy" />
        ) : (
          <span className={juntar(superficie.poco, "mr-3 flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground")} aria-hidden="true">
            <Workflow className="h-4 w-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>{p.nome}</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>
            {nomeDoCliente(clientes, p.client_id, p.cliente_nome || "Livre")} · {p.total_nos} {p.total_nos === 1 ? "nó" : "nós"}
            {quando ? ` · ${quando}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

export { ATALHOS_DA_INICIO };

/**
 * De 1024 para cima, Fluxos e Recentes ocupam a altura que sobra até o fim da
 * janela e cada um rola sozinho (a página não rola). Abaixo disso, ou com a
 * janela baixa demais, fica a altura natural e as colunas empilham.
 */
function useAlturaAteOFim() {
  const ref = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el || (window.innerWidth || 0) < 1024) {
        setAltura((a) => (a === null ? a : null));
        return;
      }
      const caixa = el.getBoundingClientRect();
      const topo = caixa.top + (window.scrollY || window.pageYOffset || 0);
      // O que a página tem abaixo das colunas (o espaço do fim da página) também precisa caber na janela.
      const doc = document.scrollingElement || document.documentElement;
      const abaixo = Math.max(0, Math.round(doc.scrollHeight - (topo + caixa.height)));
      const sobra = Math.round((window.innerHeight || 800) - topo - abaixo);
      const nova = Math.max(420, sobra);
      setAltura((a) => (a === nova ? a : nova));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  });
  return { ref, altura };
}

export default function AbaInicio({
  clienteId,
  onCliente,
  clientes,
  onAbrirProjeto,
}: {
  clienteId: string | null;
  onCliente: (id: string | null) => void;
  clientes: ClienteDoLab[];
  onAbrirProjeto: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { ref: refDasColunas, altura: alturaDasColunas } = useAlturaAteOFim();
  const [pedido, setPedido] = useState("");
  const [modelo, setModelo] = useState(MODELO_PADRAO_DO_LAB);
  const [enviando, setEnviando] = useState(false);
  const [usando, setUsando] = useState<string | null>(null);
  const [atalho, setAtalho] = useState<string | null>(null);
  const [perguntas, setPerguntas] = useState<{ pedido: string; completo: boolean; lista: PerguntaGuiada[] } | null>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  // Mesma raiz de chave dos templates: salvar um fluxo pessoal (invalida ["laboratorio", "templates"]) relê a galeria.
  const templates = useQuery({ queryKey: ["laboratorio", "templates", "galeria"], queryFn: listarFluxosDaGaleria });
  const projetos = useQuery({ queryKey: chaveDosProjetos, queryFn: listarProjetos });

  /**
   * 21/10: com as perguntas abertas, as respostas vêm da etapa grande (Seguir) e o pedido é o de antes.
   * `texto`/`atalhoUsado`: o atalho de projeto completo manda direto, sem esperar o estado da caixa.
   */
  const enviar = async (extra: { respostas?: string; pularPerguntas?: boolean; texto?: string; atalhoUsado?: string | null } = {}) => {
    const p = perguntas ? perguntas.pedido : (extra.texto !== undefined ? extra.texto : pedido).trim();
    if (!p || enviando) return;
    const respondendo = !!perguntas;
    const respostas = respondendo && !extra.pularPerguntas ? (extra.respostas || "").trim() : "";
    setEnviando(true);
    try {
      const completo = respondendo ? perguntas!.completo : ehProjetoCompleto(p, extra.atalhoUsado !== undefined ? extra.atalhoUsado : atalho, 0);
      if (completo) {
        // Perguntas guiadas antes de criar (só na primeira vez): o que falta do essencial.
        if (!respondendo) {
          const lista = await perguntasDoPedido(p, clienteId).catch(() => [] as PerguntaGuiada[]);
          if (lista.length) {
            setPerguntas({ pedido: p, completo: true, lista });
            setPedido("");
            setAtalho(null);
            return;
          }
        }
        // Projeto completo: abre o canvas já e constrói lá (Canvas Studio), à vista do dono.
        const novo = await criarProjeto({ nome: p.replace(/\s+/g, " ").slice(0, 60), client_id: clienteId, contexto: respostas ? `${p}\n\n${respostas}` : p });
        guardarPedidoPendente(novo.id, { pedido: p, modelo, modo: "projeto_completo", ...(respostas ? { respostas } : {}), ...(extra.pularPerguntas ? { pularPerguntas: true } : {}) });
        void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
        setPedido("");
        setAtalho(null);
        setPerguntas(null);
        onAbrirProjeto(novo.id);
        return;
      }
      const r = await pedidoInicio({ pedido: p, clientId: clienteId, modelo, ...(respostas ? { respostas } : {}), ...(extra.pularPerguntas ? { pularPerguntas: true } : {}) });
      if (!r.projeto) {
        // A função achou que é projeto completo e faltou o essencial: pergunta aqui mesmo.
        setPerguntas({ pedido: p, completo: false, lista: r.perguntas });
        setPedido("");
        setAtalho(null);
        return;
      }
      const projeto = r.projeto;
      setPerguntas(null);
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
      setPedido("");
      setAtalho(null);
      toast.success("Projeto montado", { description: "Confira o fluxo no canvas e rode com o custo à vista." });
      onAbrirProjeto(projeto.id);
    } catch (e) {
      toast.error("Não deu para montar o projeto", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  const usar = async (id: string) => {
    setUsando(id);
    try {
      const projeto = await usarTemplate(id, clienteId);
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
      onAbrirProjeto(projeto.id);
    } catch (e) {
      toast.error("Não deu para usar o fluxo", { description: textoDoErro(e) });
    } finally {
      setUsando(null);
    }
  };

  const recentes = (projetos.data || []).filter((p) => p.status === "ativo").slice(0, 8);

  return (
    <div className={espaco.pagina} data-aba-inicio="">
      {perguntas ? (
        // Perguntas primeiro (21/10, pedido do dono): só a etapa grande, sem a caixa nem os fluxos embaixo.
        <PerguntasGuiadas
          perguntas={perguntas.lista}
          pedido={perguntas.pedido}
          ocupado={enviando}
          onSeguir={(respostas) => void enviar({ respostas })}
          onPular={() => void enviar({ pularPerguntas: true })}
          onFechar={() => {
            setPedido(perguntas.pedido);
            setPerguntas(null);
          }}
        />
      ) : (
      <>
      <div className="mx-auto w-full min-w-0 max-w-[760px]">
        <CaixaDoPedido
          ref={campoRef}
          valor={pedido}
          onMudar={(v) => {
            setPedido(v);
            if (!v.trim()) setAtalho(null);
          }}
          onEnviar={() => void enviar()}
          enviando={enviando}
          modelo={modelo}
          onModelo={setModelo}
          clienteId={clienteId}
          onCliente={onCliente}
          clientes={clientes}
          atalhos={ATALHOS_DA_INICIO}
          onAtalho={(a) => {
            setPedido(a.pedido);
            // 21/10 (dono: "quando ele escolhe [o projeto pronto], ele só abre essa parte aqui das perguntas"):
            // atalho de projeto completo já pergunta; os outros só preenchem a caixa.
            if (ATALHOS_DE_PROJETO_COMPLETO.indexOf(a.id) >= 0) {
              setAtalho(null);
              void enviar({ texto: a.pedido, atalhoUsado: a.id });
              return;
            }
            setAtalho(a.id);
            if (campoRef.current) campoRef.current.focus();
          }}
          rotulo="Pedido para o Laboratório"
          placeholder="Peça um projeto completo, uma arte, um carrossel, uma logo…"
          tituloDoEnviar="Enviar o pedido (monta o projeto no canvas; nada é gerado ainda)"
        />
      </div>

      <div ref={refDasColunas} className={juntar(espaco.colunas, "lg:grid-cols-3", alturaDasColunas ? "lg:grid-rows-[minmax(0,1fr)] lg:items-stretch" : null)} style={alturaDasColunas ? { height: alturaDasColunas } : undefined} data-inicio-lado-a-lado="">
        <div className="min-w-0 lg:col-span-2 lg:min-h-0" data-coluna-fluxos="">
          <GaleriaDeFluxos fluxos={templates.data || []} carregando={templates.isLoading} erro={templates.isError ? textoDoErro(templates.error) : null} usando={usando} onUsar={(id) => void usar(id)} />
        </div>
        <section className="flex min-w-0 flex-col lg:min-h-0" aria-label="Projetos recentes" data-coluna-recentes="">
          <h2 className={juntar(texto.tituloSecao, "mb-5 flex h-9 items-center")}>Recentes</h2>
          {recentes.length ? (
            <ul className={juntar(estiloDaLista.aberta, "space-y-0.5", ROLAGEM_DA_COLUNA)} data-rolagem-dos-recentes="">
              {recentes.map((p) => (
                <LinhaDeRecente key={p.id} p={p} clientes={clientes} onAbrir={() => onAbrirProjeto(p.id)} />
              ))}
            </ul>
          ) : (
            <p className={texto.auxiliar}>{projetos.isLoading ? "Lendo os projetos…" : "Os projetos que você abrir aparecem aqui."}</p>
          )}
        </section>
      </div>
      </>
      )}
    </div>
  );
}
