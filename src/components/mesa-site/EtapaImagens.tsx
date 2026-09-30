import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, EyeOff, ImagePlus, Images, Loader2 } from "lucide-react";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { SeletorDeModelo, SeletorDeQualidade } from "@/components/mesa/Seletores";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { modeloDoPapel, type Qualidade, usd } from "@/lib/mesa/api";
import { SLOTS_DE_IMAGEM } from "../../../supabase/functions/_shared/site-metodo";
import { mapaDoSite, slotsDoMapa, slotsQueOGeradorFaz, slotsVazios } from "../../../supabase/functions/_shared/site-biblioteca";
import { chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";
import CampoComIA, { textoDoValor } from "./CampoComIA";

type Foto = { id: string; storage_bucket: string; storage_path: string; nome: string; origem?: string | null };
type Imagem = { id: string; slot: string; secao?: string | null; origem: string; bucket: string; path: string; alt: string; escolhida?: boolean; custo_usd?: number };

const MAX_POR_VEZ = 4;

/**
 * Etapa 5: imagens. SIT2: os slots que o mapa pede, seção por seção (o que
 * falta e o que é só de foto real), "Gerar os que faltam" com o custo antes
 * (até 4 por vez), a fórmula de imagem por slot com o ✨ no sujeito, e as
 * fotos do acervo e da Mesa Foto (entram pelo código, nunca pelo gerador).
 */
export default function EtapaImagens({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const [slot, setSlot] = useState<string>("hero");
  const [secao, setSecao] = useState<string | null>(null);
  const [sujeito, setSujeito] = useState("");
  const [luz, setLuz] = useState("");
  const [modelo, setModelo] = useState<string>(() => {
    const m = modeloDoPapel(catalogo, "imagem");
    return m ? m.id : "";
  });
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [custo, setCusto] = useState<number | null>(null);
  const [origem, setOrigem] = useState<string>("acervo");
  const [verAcervo, setVerAcervo] = useState(false);
  const fotos = useQuery({ queryKey: ["mesa-site", "acervo", site.id, origem], enabled: verAcervo, queryFn: () => chamarSite<{ fotos: Foto[] }>("fotos_reais", { site_id: site.id, origem }) });
  const imagens = (site.imagens || []) as Imagem[];
  const mapa = useMemo(() => mapaDoSite(site), [site]);
  const slots = useMemo(() => slotsDoMapa(mapa, imagens), [mapa, imagens]);
  const faltam = slotsVazios(slots);
  const gerador = slotsQueOGeradorFaz(slots);
  const nestaVez = Math.min(MAX_POR_VEZ, gerador);

  const rodar = async (rotulo: string, fn: () => Promise<{ site?: LinhaDoSite; custo_usd?: number } | void>) => {
    setOcupado(rotulo);
    try {
      const d = await fn();
      if (d && d.site) guardar(d.site);
      if (d && typeof d.custo_usd === "number") {
        setCusto(d.custo_usd);
        atualizarCusto();
      }
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const gerar = () => rodar("A imagem não foi gerada", () => chamarSite("imagem_gerar", { site_id: site.id, slot, secao: secao || undefined, sujeito: sujeito.trim(), luz: luz.trim() || undefined, modelo_id: modelo || undefined, qualidade }));
  const gerarOsQueFaltam = () =>
    rodar("As imagens dos slots não saíram", async () => {
      const d = await chamarSite<{ site: LinhaDoSite; geradas: number; faltam: number; falhas: string[]; custo_usd: number }>("imagens_dos_slots_gerar", { site_id: site.id, modelo_id: modelo || undefined, qualidade, maximo: MAX_POR_VEZ });
      if (d.falhas && d.falhas.length) avisarErro(new Error(d.falhas.join("; ")), "Algumas imagens não saíram");
      return d;
    });
  const escolher = (id: string, escolhida: boolean) => rodar("Não foi possível mudar a imagem", () => chamarSite("imagem_escolher", { site_id: site.id, imagem_id: id, escolhida }));
  const usarFoto = (f: Foto) => rodar("A foto não entrou", () => chamarSite("foto_real_usar", { site_id: site.id, cliente_imagem_id: f.id, slot, secao: secao || undefined }));

  const mirar = (uid: string, s: string) => {
    setSecao(uid);
    setSlot(s);
    const doTexto = site.conteudo && Array.isArray(site.conteudo.opcoes) && typeof site.conteudo.escolhida === "number" ? (site.conteudo.opcoes[site.conteudo.escolhida] || { secoes: [] }).secoes.find((x: { id: string }) => x.id === uid) : null;
    if (!sujeito.trim() && doTexto && doTexto.titulo) setSujeito(String(doTexto.titulo));
  };

  const estimativaDoLote = modelo && nestaVez > 0 ? [{ modeloId: modelo, tipo: "imagem" as const, imagens: nestaVez, qualidade }] : null;

  return (
    <div className="min-w-0 space-y-6" data-etapa-imagens="">
      <Secao
        titulo="Slots do mapa"
        descricao={faltam ? `${faltam} imagem(ns) faltando` : "Todos os slots com imagem"}
        ajuda="Cada seção do mapa pede as suas imagens (hero 16:9, seção 4:5, detalhe 1:1, fundo 16:9). Gerar os que faltam faz até 4 por vez com o GPT Image, pela fórmula de imagem e com o sujeito tirado da copy da seção. Slot marcado só real (equipe, antes e depois, sobre) pede foto do acervo: o gerador não faz rosto nem prova."
        acao={
          <button type="button" className={botao.primario} disabled={!!ocupado || !nestaVez || !modelo} onClick={() => void gerarOsQueFaltam()} data-gerar-slots="">
            {ocupado === "As imagens dos slots não saíram" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Images className="mr-1 h-3.5 w-3.5" />}
            Gerar {nestaVez || ""} que faltam
          </button>
        }
      >
        <div className="min-w-0 truncate">{estimativaDoLote && <EstimativaInline partes={estimativaDoLote} />}</div>
        {!slots.length && <EstadoVazio compacto titulo="O mapa ainda não pede imagem." />}
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {slots.map((x, n) => {
            const falta = x.precisa - x.tem;
            const mirado = secao === x.uid && slot === x.slot;
            return (
              <li key={`${x.uid}-${x.slot}-${n}`} className={juntar(lista.linha, mirado && lista.destaque)}>
                <button type="button" className="mr-2 min-w-0 flex-1 text-left" onClick={() => mirar(x.uid, x.slot)} title="Mirar a geração ou a foto nesta seção">
                  <span className={juntar(texto.corpo, "block truncate")}>{x.rotulo}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {x.pagina} · {(SLOTS_DE_IMAGEM.find((s) => s.id === x.slot) || { rotulo: x.slot }).rotulo} · {x.tem} de {x.precisa}
                  </span>
                </button>
                {x.so_real && <span className={juntar(etiqueta, "mr-1 bg-muted")}>só real</span>}
                {falta > 0 ? <span className={juntar(etiqueta, "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>falta {falta}</span> : <Check className="h-4 w-4 text-primary" aria-label="Completo" />}
              </li>
            );
          })}
        </ul>
      </Secao>

      <Secao
        titulo="Gerar imagem"
        descricao={custo !== null ? `Última: ${usd(custo)}` : secao ? `Para ${secao}` : undefined}
        ajuda="Fórmula de imagem: sujeito, ação, luz, fundo, estilo e proporção, com espaço negativo para o título. O gerador nunca faz logo, texto ou foto real do cliente: essas entram pelo código. Clique num slot do mapa para mirar a imagem nele."
        recolher="mesa-site:imagens:gerar"
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!!ocupado || sujeito.trim().length < 4 || !modelo} onClick={() => void gerar()} data-gerar-imagem="">
              {ocupado === "A imagem não foi gerada" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
              Gerar
            </button>
            <button type="button" className={botao.primario} onClick={() => onIrPara("integracoes")}>
              Seguir
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <SeletorCompacto rotulo="Slot da imagem" opcoes={SLOTS_DE_IMAGEM.map((s) => ({ valor: s.id, rotulo: `${s.rotulo} ${s.proporcao.split(" ")[0]}` }))} valor={slot} onEscolher={setSlot} />
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <CampoComIA
            rotulo="Sujeito"
            campo={{ chave: "imagem.sujeito", rotulo: "Sujeito da imagem", tipo: "texto", valorAtual: sujeito, maximo: 300, dica: `o que a imagem mostra para o slot ${slot}${secao ? ` da seção ${secao}` : ""}: cena do negócio, sem pessoa conhecida, sem texto e sem logo` }}
            onAplicar={(v) => setSujeito(textoDoValor(v))}
            onDesfazer={(a) => setSujeito(textoDoValor(a))}
          >
            <input value={sujeito} onChange={(e) => setSujeito(e.target.value)} maxLength={400} placeholder="Ex.: mesa de trabalho com notebook e celular" className={campo} aria-label="Sujeito da imagem" />
          </CampoComIA>
          <label className="block min-w-0">
            <span className={juntar(texto.rotulo, "mb-1 block")}>Luz</span>
            <input value={luz} onChange={(e) => setLuz(e.target.value)} maxLength={160} placeholder="Opcional" className={campo} aria-label="Luz da imagem" />
          </label>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
          <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modelo} onChange={setModelo} rotulo="Gerador" qualidade={qualidade} />
          <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
          <div className="flex min-w-0 items-end pb-2">{modelo && <EstimativaInline partes={[{ modeloId: modelo, tipo: "imagem", imagens: 1, qualidade }]} />}</div>
        </div>
      </Secao>

      <Secao titulo="Imagens do site" descricao={`${imagens.filter((i) => i.escolhida !== false).length} no site`} recolher="mesa-site:imagens:lista">
        {!imagens.length && <EstadoVazio compacto titulo="Nenhuma imagem ainda." />}
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {imagens.map((i) => (
            <figure key={i.id} className={juntar("min-w-0", i.escolhida === false && "opacity-50")}>
              <ImagemDaMesa caminho={i.path} bucket={i.bucket} alt={i.alt} className="h-36 w-full rounded-md" />
              <figcaption className="mt-1 flex min-w-0 items-center">
                <span className={juntar(etiqueta, "mr-1.5 bg-muted")}>{i.origem === "real" ? "Foto real" : i.slot}</span>
                <span className={juntar(texto.auxiliar, "mr-1 min-w-0 flex-1 truncate")} title={i.alt}>
                  {i.secao ? `${i.secao}: ` : ""}
                  {i.alt}
                </span>
                <button type="button" className={botao.icone} aria-label={i.escolhida === false ? "Voltar para o site" : "Tirar do site"} onClick={() => void escolher(i.id, i.escolhida === false)}>
                  {i.escolhida === false ? <Check className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </Secao>

      <Secao
        titulo="Fotos reais"
        descricao={secao ? `Para ${secao}` : undefined}
        ajuda="Fotos do acervo do cliente e da Mesa Foto (originais e as alinhadas pela Mesa Foto). Entram no site pelo código, do jeito que estão. Clique num slot do mapa antes para mirar a seção."
        recolher="mesa-site:imagens:acervo"
        acao={
          <button type="button" className={botao.discreto} onClick={() => setVerAcervo(!verAcervo)}>
            {verAcervo ? "Esconder" : "Ver fotos"}
          </button>
        }
      >
        {verAcervo && (
          <>
            <SeletorCompacto rotulo="Origem das fotos" opcoes={[{ valor: "acervo", rotulo: "Acervo" }, { valor: "mesa_foto", rotulo: "Mesa Foto" }, { valor: "todas", rotulo: "Todas" }]} valor={origem} onEscolher={setOrigem} />
            {fotos.isLoading && <p className={texto.auxiliar}>Lendo as fotos</p>}
            {fotos.data && !fotos.data.fotos.length && <EstadoVazio compacto titulo="Nenhuma foto nesta origem." />}
            <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {(fotos.data ? fotos.data.fotos : []).slice(0, 36).map((f) => (
                <button key={f.id} type="button" className="min-w-0 overflow-hidden rounded-md" title={`Usar ${f.nome} no slot ${slot}${secao ? ` de ${secao}` : ""}`} onClick={() => void usarFoto(f)}>
                  <ImagemDaMesa caminho={f.storage_path} bucket={f.storage_bucket} alt={f.nome} className="h-20 w-full" />
                </button>
              ))}
            </div>
          </>
        )}
      </Secao>
    </div>
  );
}
