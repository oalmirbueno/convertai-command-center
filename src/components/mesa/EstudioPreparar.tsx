import { useState, type ReactNode } from "react";
import { Loader2, Sparkles, Star, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ParteDaEstimativa } from "@/lib/mesa/api";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { Cronometro } from "./PranchetaDoEstudio";
import { FORMATOS_DO_POST, QUANTIDADES_DE_LAMINAS, type EscolhasDoPreparo, type FormatoDoPost } from "./estudioUtil";
import type { InfoDoRoteiro } from "./useItensDoMes";

/**
 * Primeiro posto da esteira: tudo o que precisa ser decidido ANTES da
 * direção, num cartão só (pedido do dono em 23/09: "o carrossel infinito tem
 * que ser decidido já no começo"; "nem todos são sete cards").
 *
 * Modo: roteiro do estrategista (grátis, quando o item tem roteiro
 * detalhado) ou diretor de arte (com preço). Quantidade de lâminas
 * (Automático ou 3 a 8), carrossel contínuo e um pedido livre para o
 * diretor. Post de uma lâmina só esconde quantidade e contínuo.
 */

function Opcao({ ativa, onClick, titulo, detalhe, icone }: { ativa: boolean; onClick: () => void; titulo: string; detalhe: string; icone: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      onClick={onClick}
      className={`flex min-h-[56px] min-w-0 items-start rounded-lg border px-3 py-2.5 text-left transition-colors ${
        ativa ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/50"
      }`}
    >
      <span className={`mr-2 mt-0.5 shrink-0 ${ativa ? "text-primary" : "text-muted-foreground"}`}>{icone}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-tight">{titulo}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{detalhe}</span>
      </span>
    </button>
  );
}

/**
 * Formato do post (pedido do dono em 25/09: "todos os tamanhos do
 * Instagram"): 4:5, 3:4 (o retrato novo, 1080 x 1440), 1:1 e 9:16. Um toque
 * escolhe; o carrossel inteiro usa o mesmo formato.
 */
export function SeletorDeFormato({
  valor,
  onMudar,
  disabled = false,
  compacto = false,
}: {
  valor: FormatoDoPost;
  onMudar: (f: FormatoDoPost) => void;
  disabled?: boolean;
  compacto?: boolean;
}) {
  return (
    <div className={`grid grid-cols-4 gap-0.5 rounded-lg border border-border bg-background p-0.5 ${compacto ? "" : "w-full"}`} role="radiogroup" aria-label="Formato do post">
      {FORMATOS_DO_POST.map((f) => {
        const ativo = valor === f.valor;
        // Miniatura do quadro na proporção (altura fixa de 14 px, largura pela proporção).
        const largura = Math.round(14 * f.proporcao);
        return (
          <button
            key={f.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            disabled={disabled}
            onClick={() => onMudar(f.valor)}
            title={`${f.rotulo} (${f.tamanho}): ${f.dica}`}
            data-formato={f.valor}
            className={`flex min-w-[52px] flex-col items-center justify-center rounded-md px-1.5 leading-tight transition-colors disabled:opacity-50 ${compacto ? "h-10" : "h-12"} ${
              ativo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <span className="flex items-center">
              <span className={`mr-1 inline-block rounded-[2px] border ${ativo ? "border-primary-foreground" : "border-current"}`} style={{ width: largura, height: 14 }} aria-hidden />
              <span className={`text-[12px] tabular-nums ${ativo ? "font-medium" : ""}`}>{f.rotulo}</span>
            </span>
            {!compacto && <span className={`mt-0.5 text-[9.5px] tabular-nums ${ativo ? "text-primary-foreground/80" : ""}`}>{f.tamanho}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default function EstudioPreparar({
  roteiro,
  postUnico,
  partesDiretor,
  onPreparar,
  onConcluido,
  aviso,
}: {
  /** Roteiro do estrategista do item (null = sem proposta gravada). */
  roteiro: InfoDoRoteiro | null;
  postUnico: boolean;
  partesDiretor: () => ParteDaEstimativa[];
  onPreparar: (escolhas: EscolhasDoPreparo) => Promise<any>;
  onConcluido: () => void;
  /** Linha de contexto acima das escolhas (ex.: refazendo uma arte que já está na Agenda). */
  aviso?: ReactNode;
}) {
  const avisarErro = useAvisarErro();
  const temRoteiro = !!roteiro && roteiro.laminas > 0;
  const [modo, setModo] = useState<"roteiro" | "diretor">(temRoteiro ? "roteiro" : "diretor");
  const [laminas, setLaminas] = useState<number | null>(null);
  const [continuo, setContinuo] = useState<boolean>(!!(roteiro && roteiro.continuo));
  const [pedido, setPedido] = useState("");
  const [formato, setFormato] = useState<FormatoDoPost>("feed_4x5");
  const [desde, setDesde] = useState<number | null>(null);

  const escolhas: EscolhasDoPreparo = { modo, laminas, continuo: continuo && formato === "feed_4x5", pedido, formato };
  const preparar = async () => {
    setDesde(Date.now());
    try {
      return await onPreparar(escolhas);
    } finally {
      setDesde(null);
    }
  };
  const montarDoRoteiro = async () => {
    try {
      await preparar();
      onConcluido();
    } catch (e) {
      avisarErro(e, "Não foi possível montar a direção");
    }
  };

  return (
    <section className="mx-auto w-full max-w-[560px] rounded-xl border border-border bg-background p-4 sm:p-5">
      <div className="flex items-center">
        <Sparkles className="mr-2 h-4 w-4 shrink-0 text-primary" />
        <h3 className="text-[15px] font-semibold">Preparar a direção</h3>
      </div>
      {aviso && <div className="mt-2">{aviso}</div>}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Quem faz a direção">
        <Opcao
          ativa={modo === "roteiro"}
          onClick={() => temRoteiro && setModo("roteiro")}
          titulo="Roteiro do estrategista"
          detalhe={temRoteiro ? `${roteiro!.laminas} lâmina${roteiro!.laminas === 1 ? "" : "s"} prontas no roteiro · grátis` : "Este item não tem roteiro detalhado"}
          icone={<Star className={`h-4 w-4 ${temRoteiro ? "fill-warning text-warning" : ""}`} />}
        />
        <Opcao
          ativa={modo === "diretor"}
          onClick={() => setModo("diretor")}
          titulo="Diretor de arte"
          detalhe="Lê a pauta, a marca e as referências e decide cada lâmina · com custo de IA"
          icone={<Wand2 className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Formato</p>
        <SeletorDeFormato valor={formato} onMudar={setFormato} />
      </div>

      {!postUnico && (
        <div className="mt-4 space-y-4">
          {modo === "diretor" && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Quantidade de lâminas</p>
              <div className="flex flex-wrap" role="radiogroup" aria-label="Quantidade de lâminas">
                {[null as number | null].concat(QUANTIDADES_DE_LAMINAS).map((n) => (
                  <button
                    key={n === null ? "auto" : n}
                    type="button"
                    role="radio"
                    aria-checked={laminas === n}
                    onClick={() => setLaminas(n)}
                    title={n === null ? "O diretor decide pelo conteúdo" : `${n} lâminas`}
                    className={`mb-1.5 mr-1.5 h-9 min-w-[40px] rounded-md border px-2.5 text-[12.5px] tabular-nums transition-colors ${
                      laminas === n ? "border-primary bg-primary font-medium text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {n === null ? "Automático" : n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-start rounded-lg border border-border px-3 py-2.5">
            <Switch checked={continuo && formato === "feed_4x5"} onCheckedChange={setContinuo} disabled={formato !== "feed_4x5"} className="mr-3 mt-0.5 shrink-0" aria-label="Carrossel contínuo" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">Carrossel contínuo</span>
              <span className="block text-[11.5px] leading-snug text-muted-foreground">
                {formato === "feed_4x5"
                  ? "A cena atravessa as lâminas, como um panorama. Gera uma de cada vez. Sem ele, as lâminas seguem a capa como série."
                  : "Só no 4:5. Neste formato as lâminas seguem a capa como série."}
              </span>
            </span>
          </label>
        </div>
      )}

      {modo === "diretor" && (
        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Pedido para o diretor (opcional)</p>
          <Textarea
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            rows={2}
            placeholder="Ex.: use fotos reais do ambiente, capa centralizada"
            className="text-[13px]"
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end">
        {desde !== null && (
          <span className="mb-2 mr-auto inline-flex items-center text-[12px] text-muted-foreground sm:mb-0">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-primary" /> Preparando <span className="ml-1 tabular-nums"><Cronometro desde={desde} /></span>
          </span>
        )}
        {modo === "roteiro" ? (
          <Button type="button" className="h-10" onClick={() => void montarDoRoteiro()} disabled={desde !== null}>
            {desde !== null ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            Montar do roteiro · grátis
          </Button>
        ) : (
          <BotaoComCusto
            rotulo={<><Wand2 className="mr-1 h-4 w-4" /> Preparar direção</>}
            titulo="Preparar a direção de arte"
            descricao="Uma chamada ao diretor de arte. Nenhuma imagem é gerada ainda."
            className="h-10"
            disabled={desde !== null}
            partes={partesDiretor}
            executar={preparar}
            aoConcluir={() => onConcluido()}
          />
        )}
      </div>
    </section>
  );
}
