import { useMemo, useState, type ReactNode } from "react";
import { Check, ImageIcon, Loader2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { useFotos } from "@/components/mesa-foto/fotoApi";
import { textoDoErro } from "@/lib/mesa/api";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, superficie, texto } from "@/components/sistema/estilos";
import { gravarCopiasSemEsperar } from "@/lib/miniaturas";
import { subirQuadro } from "@/lib/mesa-videos/quadros";
import type { MotorNaTela } from "@/lib/mesa-videos/api";
import { atende, type CustoDoMotor, custoDoMotor, type MotorDeVideo, ROTULO_DO_NIVEL, textoDoCusto, type NivelDoMotor, type RequisitoDoPedido } from "../../../supabase/functions/_shared/modelos-de-video";
import { MOVIMENTOS_DA_HIGGSFIELD } from "../../../supabase/functions/_shared/video-provedor-higgsfield";
import { useArquivosDeVideo } from "./videosApi";

/**
 * Peças do gerador (frente V-A): botão de gerar com o custo à vista e
 * confirmação, seletor de motor por nível (Normal, Top, Rápido) e o escolhedor
 * de imagem (acervo, quadros e ângulos já gerados ou uma foto nova).
 * Safari 11: arrastar por mouse e toque, proporção por padding, margem em flex.
 */

// ------------------------------------------------------------------ gerar com o custo antes

export function BotaoDeGerar({
  custo,
  rotulo = "Gerar",
  motivo,
  onConfirmar,
  icone,
  extra,
}: {
  custo: CustoDoMotor;
  rotulo?: string;
  /** Por que não dá para gerar agora (o botão fica desligado e o motivo aparece). */
  motivo?: string | null;
  onConfirmar: (usd: number) => Promise<void>;
  icone?: ReactNode;
  /** Linha a mais na confirmação (ex.: "2 variações"). */
  extra?: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [fazendo, setFazendo] = useState(false);
  const semPreco = custo.usd === null;
  const bloqueado = !!motivo || semPreco;
  const confirmar = async () => {
    if (custo.usd === null) return;
    setFazendo(true);
    try {
      await onConfirmar(custo.usd);
      setAberto(false);
    } catch (e) {
      toast.error("Não foi possível gerar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setFazendo(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end" data-botao-de-gerar="">
      <span className={juntar(texto.auxiliar, "mr-3 min-w-0 flex-1 truncate")} title={motivo || custo.detalhe}>
        {motivo || (semPreco ? "Sem preço conferido: não gera." : custo.detalhe)}
      </span>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button type="button" className={botao.primario} disabled={bloqueado || fazendo}>
            {fazendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : icone || <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
            {rotulo}
            <span className="ml-1.5 text-[11.5px] font-normal opacity-80">{textoDoCusto(custo)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <p className={texto.tituloSecao}>Confirmar o custo</p>
          <p className={juntar(texto.corpo, "mt-1")}>
            {textoDoCusto(custo)} na carteira do cliente{custo.incerto ? " (preço estimado)" : ""}.
          </p>
          <p className={juntar(texto.auxiliar, "mt-1 [overflow-wrap:anywhere]")}>{custo.detalhe}</p>
          {extra && <p className={juntar(texto.auxiliar, "mt-1")}>{extra}</p>}
          <p className={juntar(texto.auxiliar, "mt-1")}>Geração não tem desfazer. Cobra só o que ficar pronto.</p>
          <div className="mt-3 flex justify-end">
            <button type="button" className={juntar(botao.discreto, "mr-1")} onClick={() => setAberto(false)} disabled={fazendo}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} onClick={() => void confirmar()} disabled={fazendo} data-confirmar-custo="">
              {fazendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
              Confirmar
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ------------------------------------------------------------------ motor por nível

const NIVEIS: { valor: NivelDoMotor; rotulo: string }[] = [
  { valor: "normal", rotulo: "Normal" },
  { valor: "top", rotulo: "Top" },
  { valor: "rapido", rotulo: "Rápido" },
];

export function SeletorDeMotor({
  lista,
  requisito,
  valor,
  nivel,
  onEscolher,
  onNivel,
  rotulo = "Motor",
  aceitar,
}: {
  lista: MotorNaTela[];
  requisito: RequisitoDoPedido;
  valor: string;
  nivel: NivelDoMotor;
  onEscolher: (id: string) => void;
  onNivel: (n: NivelDoMotor) => void;
  rotulo?: string;
  /** Aceita também motores que o requisito não pega (frente V-C: a Higgsfield no Ângulo). */
  aceitar?: (m: MotorDeVideo) => boolean;
}) {
  const doNivel = useMemo(
    () =>
      lista
        .filter((x) => (atende(x.motor, requisito) || (!!aceitar && aceitar(x.motor))) && !x.motor.situacao)
        // Normal = o mais barato que atende (inclui os Top); Top = a última geração; Rápido = rascunho.
        .filter((x) => requisito.modo === "angulo" || requisito.modo === "imagem" || (nivel === "normal" ? x.nivel !== "rapido" : x.nivel === nivel))
        .sort((a, b) => (custoDoMotor(a.motor, { duracao_s: 5 }).usd ?? 99) - (custoDoMotor(b.motor, { duracao_s: 5 }).usd ?? 99)),
    [lista, requisito, nivel, aceitar],
  );
  const atual = lista.find((x) => x.motor.id === valor) || null;
  const mostraNivel = requisito.modo !== "angulo" && requisito.modo !== "imagem";
  return (
    <div className="min-w-0" data-seletor-de-motor="">
      <div className="mb-1.5 flex min-w-0 items-center">
        <p className={juntar(texto.rotulo, "mr-2 flex-1")}>{rotulo}</p>
        {mostraNivel && <SeletorCompacto rotulo="Nível do motor" opcoes={NIVEIS.map((n) => ({ valor: n.valor, rotulo: n.rotulo, contador: lista.filter((x) => (n.valor === "normal" ? x.nivel !== "rapido" : x.nivel === n.valor) && atende(x.motor, requisito) && !x.motor.situacao).length }))} valor={nivel} onEscolher={(v) => onNivel(v as NivelDoMotor)} />}
      </div>
      <select className={campo} value={atual && doNivel.some((x) => x.motor.id === valor) ? valor : ""} onChange={(e) => onEscolher(e.target.value)} aria-label={rotulo}>
        <option value="">{doNivel.length ? "Escolha o motor" : `Nenhum motor ${mostraNivel ? ROTULO_DO_NIVEL[nivel] : ""} faz isso`}</option>
        {doNivel.map((x) => (
          <option key={x.motor.id} value={x.motor.id} disabled={x.estado !== "pronto" && x.estado !== "a_conferir"}>
            {x.motor.rotulo} · {textoDoCusto(custoDoMotor(x.motor, { duracao_s: 5 }))}/5 s{x.novo ? " · novo" : ""}
            {x.estado !== "pronto" ? ` · ${x.estado_rotulo.toLowerCase()}` : ""}
          </option>
        ))}
      </select>
      {atual && (
        <p className={juntar(texto.auxiliar, "mt-1 truncate")} title={atual.motor.nota}>
          {atual.estado_rotulo}
          {atual.chave ? ` (${atual.chave})` : ""} · {ROTULO_DO_NIVEL[atual.nivel]} · {atual.motor.nota}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ escolher imagem

interface OpcaoDeImagem {
  caminho: string;
  bucket: string;
  nome: string;
  grupo: "acervo" | "quadros" | "angulos";
}

const GRUPOS: { valor: OpcaoDeImagem["grupo"]; rotulo: string }[] = [
  { valor: "acervo", rotulo: "Acervo" },
  { valor: "quadros", rotulo: "Quadros" },
  { valor: "angulos", rotulo: "Ângulos" },
];

/**
 * Escolhe uma imagem do cliente para entrar no motor (quadro inicial, final,
 * referência). Só caminhos do bucket "mesa" do cliente (o servidor recusa o resto).
 */
export function EscolherImagem({ rotulo, valor, onEscolher, opcional = false }: { rotulo: string; valor: string | null; onEscolher: (caminho: string | null) => void; opcional?: boolean }) {
  const { clientId } = useMesa();
  const [aberto, setAberto] = useState(false);
  const [grupo, setGrupo] = useState<OpcaoDeImagem["grupo"]>("acervo");
  const [subindo, setSubindo] = useState(false);
  const fotosQ = useFotos(clientId);
  const arquivosQ = useArquivosDeVideo(clientId);
  const opcoes = useMemo<OpcaoDeImagem[]>(() => {
    const s: OpcaoDeImagem[] = [];
    (fotosQ.data || [])
      .filter((f) => f.ativa !== false && !f.referencia_web && (f.storage_bucket || "mesa") === "mesa" && f.storage_path.indexOf(`${clientId}/`) === 0)
      .slice(0, 300)
      .forEach((f) => s.push({ caminho: f.storage_path, bucket: "mesa", nome: f.nome, grupo: "acervo" }));
    ((arquivosQ.data && arquivosQ.data.arquivos) || [])
      .filter((a) => (a.tipo === "quadro" || a.tipo === "angulo") && a.estado !== "arquivado")
      .forEach((a) => s.push({ caminho: a.storage_path, bucket: a.storage_bucket || "mesa", nome: a.nome, grupo: a.tipo === "angulo" ? "angulos" : "quadros" }));
    return s;
  }, [fotosQ.data, arquivosQ.data, clientId]);
  const visiveis = opcoes.filter((o) => o.grupo === grupo);
  const subir = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setSubindo(true);
    try {
      const caminho = await subirQuadro(clientId, arquivo, arquivo.name.replace(/\.[a-z0-9]+$/i, ""));
      gravarCopiasSemEsperar("mesa", caminho, arquivo, { nome: arquivo.name, mime: arquivo.type });
      onEscolher(caminho);
      setAberto(false);
    } catch (e) {
      toast.error("A imagem não subiu", { description: textoDoErro(e) });
    } finally {
      setSubindo(false);
    }
  };
  return (
    <div className="min-w-0" data-escolher-imagem={rotulo}>
      <p className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</p>
      <div className="flex min-w-0 items-center">
        <button type="button" onClick={() => setAberto(true)} className="relative mr-2 block w-14 shrink-0 overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "4.5rem" }} aria-label={valor ? `Trocar ${rotulo}` : `Escolher ${rotulo}`}>
          {valor ? <MiniaturaDoStorage bucket="mesa" caminho={valor} alt={rotulo} className="absolute inset-0 h-full w-full" /> : <ImageIcon className="absolute left-1/2 top-1/2 -ml-2 -mt-2 h-4 w-4 text-muted-foreground" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className={juntar(texto.auxiliar, "truncate")}>{valor ? valor.split("/").pop() : opcional ? "Opcional" : "Nenhuma escolhida"}</p>
          <div className="flex">
            <button type="button" className={juntar(botao.discreto, "h-7 px-1.5 text-[12px]")} onClick={() => setAberto(true)}>
              {valor ? "Trocar" : "Escolher"}
            </button>
            {valor && (
              <button type="button" className={juntar(botao.discreto, "h-7 px-1.5 text-[12px]")} onClick={() => onEscolher(null)}>
                Tirar
              </button>
            )}
          </div>
        </div>
      </div>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{rotulo}</DialogTitle>
          </DialogHeader>
          <div className="flex min-w-0 items-center">
            <SeletorCompacto rotulo="De onde" opcoes={GRUPOS.map((g) => ({ valor: g.valor, rotulo: g.rotulo, contador: opcoes.filter((o) => o.grupo === g.valor).length }))} valor={grupo} onEscolher={(v) => setGrupo(v as OpcaoDeImagem["grupo"])} />
            <label className={juntar(botao.secundario, "ml-auto cursor-pointer")} aria-label="Subir imagem nova">
              {subindo ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Upload className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">Subir</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void subir(e.target.files ? e.target.files[0] : undefined)} />
            </label>
          </div>
          <RegiaoRolavel modo="sempre" className="max-h-[60vh]" rotulo="Imagens">
            {visiveis.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Imagens para escolher">
                {visiveis.map((o) => (
                  <li key={o.caminho}>
                    <button
                      type="button"
                      onClick={() => {
                        onEscolher(o.caminho);
                        setAberto(false);
                      }}
                      className={juntar("relative block w-full overflow-hidden rounded-md bg-muted", valor === o.caminho ? "ring-2 ring-primary" : "")}
                      style={{ paddingBottom: "125%" }}
                      aria-label={`Escolher ${o.nome}`}
                    >
                      <MiniaturaDoStorage bucket={o.bucket} caminho={o.caminho} alt={o.nome} className="absolute inset-0 h-full w-full" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EstadoVazio compacto titulo="Nada aqui ainda." descricao="Suba uma imagem ou gere um ângulo." />
            )}
          </RegiaoRolavel>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------------ câmera pronta (Higgsfield, frente V-C)

const GRUPOS_DA_CAMERA = MOVIMENTOS_DA_HIGGSFIELD.reduce<string[]>((l, m) => (l.indexOf(m.grupo) < 0 ? l.concat([m.grupo]) : l), []);

/** Movimento de câmera pronto do motor (Higgsfield Cinema Studio 4.0). Vazio = a câmera vai só pelo texto. */
export function SeletorDeCamera({ valor, onEscolher, rotulo = "Câmera pronta", opcional = true }: { valor: string; onEscolher: (v: string) => void; rotulo?: string; opcional?: boolean }) {
  return (
    <div className="min-w-0" data-seletor-de-camera="">
      <p className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</p>
      <select className={campo} value={valor} onChange={(e) => onEscolher(e.target.value)} aria-label={rotulo}>
        {opcional && <option value="">Pelo texto</option>}
        {GRUPOS_DA_CAMERA.map((g) => (
          <optgroup key={g} label={g}>
            {MOVIMENTOS_DA_HIGGSFIELD.filter((m) => m.grupo === g).map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** Poço com a linha de custo (resumo curto). */
export function LinhaDeCusto({ custo, rotulo }: { custo: CustoDoMotor; rotulo: string }) {
  return (
    <div className={juntar(superficie.poco, "flex min-w-0 items-baseline px-3 py-2 text-[12.5px]")} data-linha-de-custo="">
      <span className="mr-2 min-w-0 flex-1 truncate" title={custo.detalhe}>
        {rotulo}
      </span>
      <span className={juntar("tabular-nums", custo.usd === null ? "text-muted-foreground" : "font-medium")}>{textoDoCusto(custo)}</span>
    </div>
  );
}
