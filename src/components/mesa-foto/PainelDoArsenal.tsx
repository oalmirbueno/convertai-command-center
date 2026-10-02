import { useMemo, useState, type ReactNode } from "react";
import { Camera, Check, Copy, CornerDownLeft, Layers, LayoutGrid, Mountain, Package, Search, Sun, User, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { campo, juntar, rolagem, texto as textoDoSistema } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import {
  AREAS_DO_ARSENAL,
  ehAreaDoArsenal,
  MODELO_PADRAO,
  produtosDosKits,
  promptsDoCliente,
  rotuloDaArea,
  type AreaDoArsenal,
  type ProdutoDoArsenal,
  type PromptDoArsenal,
} from "./arsenalDaBiblioteca";
import { useBiblioteca, useKits } from "./fotoApi";

/**
 * Arsenal de prompts ao lado da geração (pedido do dono, 02/10): escolhe a
 * área da foto (Produto, Modelo, Cenário, Luz, Ângulo, Detalhe, Composição)
 * e copia o prompt já montado para o produto, sem sair do formulário. A
 * lista rola por dentro (altura limitada em qualquer largura); a página não
 * anda.
 *
 * "Usar" chama `onUsarPrompt` quando quem monta o painel passa; sem ele,
 * entrega o texto (área de transferência, sessionStorage e o evento
 * `mesa-foto:usar-prompt`) para o campo de pedido que estiver ouvindo.
 */

/** Lista longa com rolagem própria em qualquer largura (a página não rola junto). */
export const ROLAGEM_DO_ARSENAL = juntar(rolagem.janela, "scrollbar-hidden");

export const EVENTO_USAR_PROMPT = "mesa-foto:usar-prompt";
export const chaveDoPromptEntregue = (clientId: string) => `mesa-foto:prompt-do-arsenal:${clientId}`;

export async function copiarParaAreaDeTransferencia(texto: string): Promise<boolean> {
  try {
    const nav: Navigator | null = typeof navigator !== "undefined" ? navigator : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      await nav.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* sem permissão: tenta o caminho antigo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
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

/** Entrega o prompt ao campo de pedido aberto (quem ouvir o evento) e deixa na área de transferência. */
export async function entregarPromptDoArsenal(clientId: string, texto: string): Promise<void> {
  try {
    window.sessionStorage.setItem(chaveDoPromptEntregue(clientId), JSON.stringify({ texto, em: Date.now() }));
  } catch {
    /* navegador sem armazenamento: segue com o evento */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_USAR_PROMPT, { detail: { clientId, texto } }));
  } catch {
    /* navegador antigo sem CustomEvent: fica a área de transferência */
  }
  const ok = await copiarParaAreaDeTransferencia(texto);
  toast.success("Prompt pronto", { description: ok ? "Também está copiado: cole no pedido." : "Cole no pedido." });
}

const ICONES: Record<AreaDoArsenal | "todas", typeof Package> = {
  todas: Layers,
  produto: Package,
  modelo: User,
  cenario: Mountain,
  luz: Sun,
  angulo: Camera,
  detalhe: ZoomIn,
  composicao: LayoutGrid,
};

export function IconeDaArea({ area, className = "h-3.5 w-3.5" }: { area: AreaDoArsenal | "todas"; className?: string }) {
  const Icone = ICONES[area] || Layers;
  return <Icone className={className} aria-hidden="true" />;
}

/** Áreas em ícone + nome (radiogroup). Com `comTudo`, a primeira opção é "Tudo". */
export function SeletorDaArea({
  valor,
  onEscolher,
  comTudo = false,
  contagem,
}: {
  valor: AreaDoArsenal | "todas";
  onEscolher: (a: AreaDoArsenal | "todas") => void;
  comTudo?: boolean;
  contagem?: Partial<Record<AreaDoArsenal | "todas", number>>;
}) {
  const tudo: { valor: AreaDoArsenal | "todas"; rotulo: string }[] = comTudo ? [{ valor: "todas", rotulo: "Tudo" }] : [];
  const opcoes = tudo.concat(AREAS_DO_ARSENAL.map((a) => ({ valor: a.valor, rotulo: a.rotulo })));
  return (
    <div role="radiogroup" aria-label="Área da foto" className="flex min-w-0 flex-wrap items-center" data-areas-do-arsenal="">
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        const n = contagem ? contagem[o.valor] : undefined;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onEscolher(o.valor)}
            className={juntar(
              "toque-compacto mb-1 mr-1 inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-[12px] font-medium transition-colors",
              ativo ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            data-area={o.valor}
          >
            <IconeDaArea area={o.valor} />
            <span className="ml-1.5">{o.rotulo}</span>
            {n !== undefined && <span className="ml-1 tabular-nums opacity-70">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Botão de copiar um texto, com "Copiado" por um instante. */
export function BotaoCopiarTexto({ texto, rotulo = "Copiar", nome }: { texto: string; rotulo?: string; nome?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      disabled={!texto}
      aria-label={nome || rotulo}
      onClick={async () => {
        const ok = await copiarParaAreaDeTransferencia(texto);
        if (ok) {
          setCopiado(true);
          window.setTimeout(() => setCopiado(false), 1800);
        } else toast.error("Não foi possível copiar", { description: "Selecione o texto e copie com Ctrl+C." });
      }}
      className="toque-compacto mr-1 inline-flex h-7 shrink-0 items-center rounded-md border border-input px-2 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
    >
      {copiado ? <Check className="mr-1 h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
      {copiado ? "Copiado" : rotulo}
    </button>
  );
}

/** Lista de prompts prontos, com rolagem própria. */
export function ListaDoArsenal({
  prompts,
  onUsar,
  vazio,
  rotulo = "Prompts do arsenal",
}: {
  prompts: PromptDoArsenal[];
  onUsar?: (texto: string) => void;
  vazio?: ReactNode;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  if (!prompts.length) return <p className={juntar(textoDoSistema.auxiliar, "py-2")}>{vazio || "Nenhum prompt nesta área."}</p>;
  return (
    <ul className={juntar(ROLAGEM_DO_ARSENAL, "min-w-0 divide-y divide-border")} aria-label={rotulo} data-rolagem-do-arsenal="" data-lista-do-arsenal="">
      {prompts.map((p) => {
        const inteiro = aberto === p.id;
        return (
          <li key={p.id} className="min-w-0 py-2" data-prompt-do-arsenal={p.id} data-origem={p.origem}>
            <div className="flex min-w-0 items-center">
              <IconeDaArea area={p.area} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="ml-1.5 min-w-0 flex-1 truncate text-[12px] font-semibold" title={p.titulo}>
                {p.titulo}
              </p>
              <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{p.origem === "logica" ? rotuloDaArea(p.area) : "biblioteca"}</span>
            </div>
            <button
              type="button"
              onClick={() => setAberto(inteiro ? null : p.id)}
              aria-expanded={inteiro}
              className={juntar("mt-1 block w-full text-left font-mono text-[12px] leading-5 text-foreground [overflow-wrap:anywhere]", inteiro ? "" : "line-clamp-3")}
              title={inteiro ? "Mostrar menos" : "Mostrar o prompt inteiro"}
            >
              {p.texto}
            </button>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
              <BotaoCopiarTexto texto={p.texto} nome={`Copiar o prompt ${p.titulo}`} />
              {onUsar && (
                <button
                  type="button"
                  onClick={() => onUsar(p.texto)}
                  aria-label={`Usar o prompt ${p.titulo}`}
                  className="toque-compacto mr-1 inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[12px] font-medium text-primary hover:bg-primary/10"
                >
                  <CornerDownLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Usar
                </button>
              )}
              {p.negativo && <BotaoCopiarTexto texto={p.negativo} rotulo="Evitar" nome={`Copiar o evitar de ${p.titulo}`} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Descrições rápidas de modelo (pessoa gerada pela IA) para os prompts da área Modelo. */
export const MODELOS_RAPIDOS: { rotulo: string; texto: string }[] = [
  { rotulo: "Mulher 30", texto: "uma mulher de 30 anos, pele morena, cabelo castanho solto, sorriso leve" },
  { rotulo: "Homem 40", texto: "um homem de 40 anos, barba curta, camisa clara, expressão confiante" },
  { rotulo: "Jovem 20", texto: "uma pessoa jovem de 20 anos, estilo urbano casual, expressão descontraída" },
  { rotulo: "Mulher 60", texto: "uma mulher de 60 anos, cabelo grisalho curto, elegante e natural" },
];

const validarArea = (v: unknown) => v === "todas" || ehAreaDoArsenal(v);

export default function PainelDoArsenal({
  produtoNome,
  tipo,
  onUsarPrompt,
}: {
  produtoNome?: string | null;
  tipo?: string | null;
  onUsarPrompt?: (texto: string) => void;
}) {
  const { clientId } = useMesa();
  const biblioteca = useBiblioteca(clientId);
  const kits = useKits(clientId);
  const [area, setArea] = useEstadoDaTela<AreaDoArsenal | "todas">(`mesa-foto:arsenal:area:${clientId}`, "produto", { validar: validarArea });
  const [busca, setBusca] = useState("");
  const [modelo, setModelo] = useState("");
  const [kitEscolhido, setKitEscolhido] = useState(0);

  const doKit = useMemo(() => produtosDosKits(kits.data || []), [kits.data]);
  const produtos: ProdutoDoArsenal[] = useMemo(() => {
    const nome = String(produtoNome || "").trim();
    if (nome) return [{ nome, tipo: tipo || null }];
    const k = doKit[Math.min(kitEscolhido, Math.max(0, doKit.length - 1))];
    return k ? [k] : [];
  }, [produtoNome, tipo, doKit, kitEscolhido]);

  const prompts = useMemo(() => {
    const todos = promptsDoCliente(biblioteca.data || [], produtos, { area, modelo: modelo || MODELO_PADRAO });
    const termo = busca.trim().toLowerCase();
    return termo ? todos.filter((p) => `${p.titulo} ${p.texto}`.toLowerCase().indexOf(termo) >= 0) : todos;
  }, [biblioteca.data, produtos, area, modelo, busca]);

  const usar = (t: string) => {
    if (onUsarPrompt) onUsarPrompt(t);
    else void entregarPromptDoArsenal(clientId, t);
  };

  return (
    <section className="min-w-0" aria-label="Arsenal de prompts" data-painel-do-arsenal="">
      <div className="mb-2 flex min-w-0 items-center">
        <h3 className={textoDoSistema.tituloSecao}>Arsenal de prompts</h3>
        <AjudaRecolhida className="ml-1.5" rotulo="Sobre o arsenal">
          Prompts de fotografia montados para o produto: escolha a área, copie ou use no pedido. Os da biblioteca que não combinam com o produto ficam de fora.
        </AjudaRecolhida>
        <span className={juntar(textoDoSistema.auxiliar, "ml-auto tabular-nums")}>{prompts.length}</span>
      </div>
      {!String(produtoNome || "").trim() && doKit.length > 1 && (
        <select
          value={String(Math.min(kitEscolhido, doKit.length - 1))}
          onChange={(e) => setKitEscolhido(Number(e.target.value) || 0)}
          aria-label="Produto dos prompts"
          className={juntar(campo, "mb-2 h-8 text-[12px]")}
        >
          {doKit.map((p, n) => (
            <option key={`${p.nome}-${n}`} value={String(n)}>
              {p.nome}
            </option>
          ))}
        </select>
      )}
      <SeletorDaArea valor={area} onEscolher={setArea} comTudo />
      {area === "modelo" && (
        <div className="mb-1 mt-1 min-w-0" data-modelos-rapidos="">
          <div className="flex min-w-0 flex-wrap items-center">
            {MODELOS_RAPIDOS.map((m) => (
              <button
                key={m.rotulo}
                type="button"
                aria-pressed={modelo === m.texto}
                onClick={() => setModelo(modelo === m.texto ? "" : m.texto)}
                className={juntar(
                  "toque-compacto mb-1 mr-1 inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[12px]",
                  modelo === m.texto ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <User className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {m.rotulo}
              </button>
            ))}
          </div>
          <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Quem é o modelo (ex.: mulher de 30 anos, cabelo cacheado)" aria-label="Descrição do modelo" className={juntar(campo, "h-8 text-[12px]")} />
        </div>
      )}
      <div className="relative my-1.5 min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no arsenal" aria-label="Buscar no arsenal" className={juntar(campo, "h-8 pl-8 text-[12px]")} />
      </div>
      {biblioteca.isLoading && <p className={textoDoSistema.auxiliar}>Lendo a biblioteca...</p>}
      <ListaDoArsenal prompts={prompts} onUsar={usar} vazio={busca.trim() ? "Nada com essa busca." : undefined} />
    </section>
  );
}
