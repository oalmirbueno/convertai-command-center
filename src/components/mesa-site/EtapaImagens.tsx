import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Check, ChevronDown, ChevronRight, EyeOff, ImagePlus, Images, Loader2 } from "lucide-react";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { SeletorDeModelo, SeletorDeQualidade } from "@/components/mesa/Seletores";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { modeloDoPapel, nomeDoModelo, QUALIDADES, type Qualidade, usd } from "@/lib/mesa/api";
import { rotuloDaSecao, SLOTS_DE_IMAGEM } from "../../../supabase/functions/_shared/site-metodo";
import { mapaDoSite, slotsDoMapa, slotsQueOGeradorFaz, slotsVazios, type SlotDoSite } from "../../../supabase/functions/_shared/site-biblioteca";
import { chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";
import CampoComIA, { textoDoValor } from "./CampoComIA";
import { copyDaLinha } from "./estadoDoSite";
import { useBarraDaEtapa } from "./BarraDaEtapa";

type Foto = { id: string; storage_bucket: string; storage_path: string; nome: string; origem?: string | null };
type Imagem = { id: string; slot: string; secao?: string | null; origem: string; bucket: string; path: string; alt: string; escolhida?: boolean; custo_usd?: number };

const MAX_POR_VEZ = 4;
const rotuloDoSlot = (slot: string) => (SLOTS_DE_IMAGEM.find((s) => s.id === slot) || { rotulo: slot }).rotulo;

/**
 * As fotos reais (acervo e Mesa Foto), montadas só quando abertas: a consulta
 * roda ao montar. Mira o slot e a seção dados; o backend só filtra a origem.
 */
function FotosReais({ site, slot, secao, ocupado, onUsar }: { site: LinhaDoSite; slot: string; secao: string | null; ocupado: boolean; onUsar: (f: Foto) => void }) {
  const [origem, setOrigem] = useState<string>("acervo");
  const fotos = useQuery({ queryKey: ["mesa-site", "acervo", site.id, origem], queryFn: () => chamarSite<{ fotos: Foto[] }>("fotos_reais", { site_id: site.id, origem }) });
  const onde = `${rotuloDoSlot(slot)}${secao ? ` de ${rotuloDaSecao(secao)}` : ""}`;
  return (
    <div className="min-w-0 space-y-2" data-fotos-reais={secao || "avulsa"}>
      <SeletorCompacto rotulo="Origem das fotos" opcoes={[{ valor: "acervo", rotulo: "Acervo" }, { valor: "mesa_foto", rotulo: "Mesa Foto" }, { valor: "todas", rotulo: "Todas" }]} valor={origem} onEscolher={setOrigem} />
      {fotos.isLoading && <Carregando forma="grade" linhas={6} rotulo="Lendo as fotos" />}
      {fotos.isError && (
        <EstadoDeErro
          titulo="As fotos não foram lidas."
          acao={
            <button type="button" className={botao.discreto} onClick={() => void fotos.refetch()}>
              Tentar de novo
            </button>
          }
        />
      )}
      {fotos.data && !fotos.data.fotos.length && <EstadoVazio compacto titulo="Nenhuma foto nesta origem." />}
      <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {(fotos.data ? fotos.data.fotos : []).slice(0, 36).map((f) => (
          <button key={f.id} type="button" className="min-w-0 overflow-hidden rounded-md" disabled={ocupado} title={`Usar ${f.nome} em ${onde}`} onClick={() => onUsar(f)}>
            <ImagemDaMesa caminho={f.storage_path} bucket={f.storage_bucket} alt={f.nome} className="h-20 w-full" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Etapa 5: imagens. SIT2: os slots que o mapa pede, seção por seção (o que
 * falta e o que é só de foto real), "Gerar os que faltam" com o custo antes
 * (até 4 por vez), a fórmula de imagem por slot com o ✨ no sujeito, e as
 * fotos do acervo e da Mesa Foto (entram pelo código, nunca pelo gerador).
 *
 * UXS 30/09: gerar ou trocar a imagem de uma seção é no próprio lugar. A linha
 * aberta traz o sujeito (do título da copy da seção), a luz, "Gerar" com o
 * custo e "Usar foto real" (a grade já mirada nela). Linha só de foto real
 * não tem "Gerar" (nada inventado: rosto ou prova). A imagem avulsa tem o
 * próprio estado e nunca vai para uma seção. Gerador e qualidade ficam em
 * "Mais opções", à vista no resumo. O Seguir mora na barra.
 */
export default function EtapaImagens({ site }: { site: LinhaDoSite; onIrPara?: (etapa: string) => void }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  // A linha aberta (seção e slot) e o que ela gera.
  const [aberta, setAberta] = useState<string | null>(null);
  const [fotosDaLinha, setFotosDaLinha] = useState(false);
  const [sujeito, setSujeito] = useState("");
  const [luz, setLuz] = useState("");
  // A imagem avulsa: estado próprio, sem seção.
  const [avulsa, setAvulsa] = useState({ slot: "hero", sujeito: "", luz: "" });
  const [modelo, setModelo] = useState<string>(() => {
    const m = modeloDoPapel(catalogo, "imagem");
    return m ? m.id : "";
  });
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [maisRecolhido, setMaisRecolhido] = useRecolhido("mesa-site:imagens:mais", true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [custo, setCusto] = useState<number | null>(null);
  const imagens = (site.imagens || []) as Imagem[];
  const mapa = useMemo(() => mapaDoSite(site), [site]);
  const slots = useMemo(() => slotsDoMapa(mapa, imagens), [mapa, imagens]);
  const faltam = slotsVazios(slots);
  const gerador = slotsQueOGeradorFaz(slots);
  const nestaVez = Math.min(MAX_POR_VEZ, gerador);
  const modeloEscolhido = catalogo.find((m) => m.id === modelo) || null;
  const rotuloDaQualidade = (QUALIDADES.find((q) => q.valor === qualidade) || { rotulo: qualidade }).rotulo;

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

  const gerarNaSecao = (x: SlotDoSite) => rodar("A imagem não foi gerada", () => chamarSite("imagem_gerar", { site_id: site.id, slot: x.slot, secao: x.uid, sujeito: sujeito.trim(), luz: luz.trim() || undefined, modelo_id: modelo || undefined, qualidade }));
  const gerarAvulsa = () => rodar("A imagem avulsa não foi gerada", () => chamarSite("imagem_gerar", { site_id: site.id, slot: avulsa.slot, secao: undefined, sujeito: avulsa.sujeito.trim(), luz: avulsa.luz.trim() || undefined, modelo_id: modelo || undefined, qualidade }));
  const gerarOsQueFaltam = () =>
    rodar("As imagens dos slots não saíram", async () => {
      const d = await chamarSite<{ site: LinhaDoSite; geradas: number; faltam: number; falhas: string[]; custo_usd: number }>("imagens_dos_slots_gerar", { site_id: site.id, modelo_id: modelo || undefined, qualidade, maximo: MAX_POR_VEZ });
      if (d.falhas && d.falhas.length) avisarErro(new Error(d.falhas.join("; ")), "Algumas imagens não saíram");
      return d;
    });
  const escolher = (id: string, escolhida: boolean) => rodar("Não foi possível mudar a imagem", () => chamarSite("imagem_escolher", { site_id: site.id, imagem_id: id, escolhida }));
  const usarFoto = (f: Foto, slot: string, secao: string | null) => rodar("A foto não entrou", () => chamarSite("foto_real_usar", { site_id: site.id, cliente_imagem_id: f.id, slot, secao: secao || undefined }));

  /** Abrir a linha: o sujeito vem do título da copy da seção (ou fica vazio) e a luz limpa. */
  const abrirLinha = (x: SlotDoSite) => {
    const chave = `${x.uid}:${x.slot}`;
    if (aberta === chave) {
      setAberta(null);
      return;
    }
    const copy = copyDaLinha(site);
    const daSecao = copy ? copy.secoes.find((s) => s.id === x.uid) : null;
    setAberta(chave);
    setFotosDaLinha(false);
    setSujeito(daSecao && daSecao.titulo ? String(daSecao.titulo) : "");
    setLuz("");
  };

  const estimativaDoLote = modelo && nestaVez > 0 ? [{ modeloId: modelo, tipo: "imagem" as const, imagens: nestaVez, qualidade }] : null;
  const estimativaDeUma = modelo ? [{ modeloId: modelo, tipo: "imagem" as const, imagens: 1, qualidade }] : null;

  useBarraDaEtapa({ estado: faltam ? `${faltam} ${faltam === 1 ? "imagem faltando" : "imagens faltando"}` : slots.length ? "Todas as seções com imagem" : null, pendente: nestaVez > 0 });

  return (
    <div className="min-w-0 space-y-6" data-etapa-imagens="">
      <Secao
        titulo="Imagens por seção"
        descricao={faltam ? `${faltam} imagem(ns) faltando` : "Todas as seções com imagem"}
        ajuda="Cada seção do mapa pede as suas imagens (abertura 16:9, seção 4:5, detalhe 1:1, fundo 16:9). Clique numa seção para gerar a imagem dela no lugar ou usar uma foto real. Gerar os que faltam faz até 4 por vez com o gerador escolhido em Mais opções, pela fórmula de imagem e com o sujeito tirado da copy da seção. Seção marcada só foto real (equipe, antes e depois, sobre) pede foto do acervo: o gerador não faz rosto nem prova."
        acao={
          <>
            {estimativaDoLote && (
              <span className="mr-2 inline-flex min-w-0">
                <EstimativaInline partes={estimativaDoLote} />
              </span>
            )}
            <button type="button" className={nestaVez > 0 ? botao.primario : botao.secundario} disabled={!!ocupado || !nestaVez || !modelo} onClick={() => void gerarOsQueFaltam()} data-gerar-slots="">
              {ocupado === "As imagens dos slots não saíram" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Images className="mr-1 h-3.5 w-3.5" />}
              Gerar {nestaVez || ""} que faltam
            </button>
          </>
        }
      >
        {/* Gerador e qualidade: um lugar só para o lote, a linha e a avulsa, com o escolhido à vista no resumo. */}
        <div className="min-w-0" data-mais-opcoes-das-imagens="">
          <TituloRecolhivel titulo="Mais opções" recolhido={maisRecolhido} onAlternar={() => setMaisRecolhido(!maisRecolhido)} resumo={`${modeloEscolhido ? nomeDoModelo(modeloEscolhido) : "Sem gerador"} · ${rotuloDaQualidade.toLowerCase()}`} />
          {!maisRecolhido && (
            <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-[640px]">
              <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modelo} onChange={setModelo} rotulo="Gerador" qualidade={qualidade} />
              <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
            </div>
          )}
        </div>
        {!slots.length && <EstadoVazio compacto className="mt-3" titulo="O mapa ainda não pede imagem." />}
        <ul className={juntar(lista.aberta, lista.divisoria, "mt-2")}>
          {slots.map((x, n) => {
            const falta = x.precisa - x.tem;
            const chave = `${x.uid}:${x.slot}`;
            const aqui = aberta === chave;
            return (
              <li key={`${chave}-${n}`} className="min-w-0" data-slot-da-secao={chave}>
                <button type="button" className={juntar(lista.linha, "w-full text-left", aqui && lista.destaque)} onClick={() => abrirLinha(x)} aria-expanded={aqui} title={aqui ? "Fechar" : "Gerar ou usar foto real nesta seção"}>
                  {aqui ? <ChevronDown className="mr-1.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mr-1.5 h-4 w-4 shrink-0" />}
                  <span className="mr-2 min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")}>{x.rotulo}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      {x.pagina} · {rotuloDoSlot(x.slot)} · {x.tem} de {x.precisa}
                    </span>
                  </span>
                  {x.so_real && <span className={juntar(etiqueta, "mr-1 shrink-0 bg-muted")}>só foto real</span>}
                  {falta > 0 ? <span className={juntar(etiqueta, "shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-400")}>falta {falta}</span> : <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Completo" />}
                </button>
                {aqui && (
                  <div className="min-w-0 space-y-3 px-2 pb-3 pt-2" data-linha-aberta={chave}>
                    {!x.so_real && (
                      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
                        <CampoComIA
                          rotulo="Sujeito"
                          campo={{ chave: "imagem.sujeito", rotulo: "Sujeito da imagem", tipo: "texto", valorAtual: sujeito, maximo: 300, dica: `o que a imagem mostra em ${rotuloDoSlot(x.slot)} de ${rotuloDaSecao(x.uid)}: cena do negócio, sem pessoa conhecida, sem texto e sem logo` }}
                          onAplicar={(v) => setSujeito(textoDoValor(v))}
                          onDesfazer={(a) => setSujeito(textoDoValor(a))}
                        >
                          <input value={sujeito} onChange={(e) => setSujeito(e.target.value)} maxLength={400} placeholder="Ex.: mesa de trabalho com notebook e celular" className={campo} aria-label={`Sujeito da imagem de ${x.rotulo}`} />
                        </CampoComIA>
                        <label className="block min-w-0">
                          <span className={juntar(texto.rotulo, "mb-1 block")}>Luz</span>
                          <input value={luz} onChange={(e) => setLuz(e.target.value)} maxLength={160} placeholder="Opcional" className={campo} aria-label={`Luz da imagem de ${x.rotulo}`} />
                        </label>
                      </div>
                    )}
                    <div className="flex min-w-0 flex-wrap items-center">
                      {!x.so_real && (
                        <button type="button" className={juntar(nestaVez > 0 ? botao.secundario : botao.primario, "mb-2 mr-2")} disabled={!!ocupado || sujeito.trim().length < 4 || !modelo} onClick={() => void gerarNaSecao(x)} data-gerar-imagem-secao={x.uid}>
                          {ocupado === "A imagem não foi gerada" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
                          Gerar
                        </button>
                      )}
                      <button type="button" className={juntar(x.so_real && !nestaVez ? botao.primario : botao.secundario, "mb-2 mr-2")} onClick={() => setFotosDaLinha(!fotosDaLinha)} aria-expanded={fotosDaLinha} data-usar-foto-real={x.uid}>
                        <Camera className="mr-1 h-3.5 w-3.5" />
                        Usar foto real
                      </button>
                      {!x.so_real && estimativaDeUma && (
                        <span className="mb-2 min-w-0">
                          <EstimativaInline partes={estimativaDeUma} />
                        </span>
                      )}
                    </div>
                    {fotosDaLinha && <FotosReais site={site} slot={x.slot} secao={x.uid} ocupado={!!ocupado} onUsar={(f) => void usarFoto(f, x.slot, x.uid)} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Secao>

      <Secao
        titulo="Imagem avulsa"
        descricao={custo !== null ? `Última: ${usd(custo)}` : undefined}
        ajuda="Uma imagem fora das seções do mapa (fica em Imagens do site). Fórmula de imagem: sujeito, ação, luz, fundo, estilo e proporção, com espaço negativo para o título. O gerador nunca faz logo, texto ou foto real do cliente: essas entram pelo código."
        recolher="mesa-site:imagens:gerar"
        recolhidaDeInicio
      >
        <div className="min-w-0 space-y-3">
          <SeletorCompacto rotulo="Slot da imagem" opcoes={SLOTS_DE_IMAGEM.map((s) => ({ valor: s.id, rotulo: `${s.rotulo} ${s.proporcao.split(" ")[0]}` }))} valor={avulsa.slot} onEscolher={(v) => setAvulsa((a) => ({ ...a, slot: v }))} />
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <CampoComIA
              rotulo="Sujeito"
              campo={{ chave: "imagem.sujeito", rotulo: "Sujeito da imagem", tipo: "texto", valorAtual: avulsa.sujeito, maximo: 300, dica: `o que a imagem mostra (${rotuloDoSlot(avulsa.slot)}): cena do negócio, sem pessoa conhecida, sem texto e sem logo` }}
              onAplicar={(v) => setAvulsa((a) => ({ ...a, sujeito: textoDoValor(v) }))}
              onDesfazer={(v) => setAvulsa((a) => ({ ...a, sujeito: textoDoValor(v) }))}
            >
              <input value={avulsa.sujeito} onChange={(e) => setAvulsa((a) => ({ ...a, sujeito: e.target.value }))} maxLength={400} placeholder="Ex.: mesa de trabalho com notebook e celular" className={campo} aria-label="Sujeito da imagem" />
            </CampoComIA>
            <label className="block min-w-0">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Luz</span>
              <input value={avulsa.luz} onChange={(e) => setAvulsa((a) => ({ ...a, luz: e.target.value }))} maxLength={160} placeholder="Opcional" className={campo} aria-label="Luz da imagem" />
            </label>
          </div>
          <div className="flex min-w-0 flex-wrap items-center">
            <button type="button" className={juntar(botao.secundario, "mb-2 mr-2")} disabled={!!ocupado || avulsa.sujeito.trim().length < 4 || !modelo} onClick={() => void gerarAvulsa()} data-gerar-imagem="">
              {ocupado === "A imagem avulsa não foi gerada" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
              Gerar
            </button>
            {estimativaDeUma && (
              <span className="mb-2 min-w-0">
                <EstimativaInline partes={estimativaDeUma} />
              </span>
            )}
          </div>
        </div>
      </Secao>

      <Secao titulo="Imagens do site" descricao={`${imagens.filter((i) => i.escolhida !== false).length} no site`} recolher="mesa-site:imagens:lista">
        {!imagens.length && <EstadoVazio compacto titulo="Nenhuma imagem ainda." />}
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {imagens.map((i) => (
            <figure key={i.id} className={juntar("min-w-0", i.escolhida === false && "opacity-50")}>
              <ImagemDaMesa caminho={i.path} bucket={i.bucket} alt={i.alt} className="h-36 w-full rounded-md" />
              <figcaption className="mt-1 flex min-w-0 items-center">
                <span className={juntar(etiqueta, "mr-1.5 shrink-0 bg-muted")}>{i.origem === "real" ? "Foto real" : rotuloDoSlot(i.slot)}</span>
                <span className={juntar(texto.auxiliar, "mr-1 min-w-0 flex-1 truncate")} title={i.alt}>
                  {i.secao ? rotuloDaSecao(i.secao) : i.alt}
                </span>
                <button type="button" className={botao.icone} aria-label={i.escolhida === false ? "Voltar para o site" : "Tirar do site"} onClick={() => void escolher(i.id, i.escolhida === false)}>
                  {i.escolhida === false ? <Check className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </Secao>

      {/* Um fecho só: recolhida de início, e a grade (com a consulta) só monta aberta. Mira a imagem avulsa, sem seção. */}
      <Secao
        titulo="Fotos reais"
        descricao={`Para ${rotuloDoSlot(avulsa.slot)} avulsa`}
        ajuda="Fotos do acervo do cliente e da Mesa Foto (originais e as alinhadas pela Mesa Foto). Entram no site pelo código, do jeito que estão. Aqui a foto vai como imagem avulsa, no slot escolhido em Imagem avulsa; para uma seção, use Usar foto real na linha dela."
        recolher="mesa-site:imagens:acervo"
        recolhidaDeInicio
      >
        <FotosReais site={site} slot={avulsa.slot} secao={null} ocupado={!!ocupado} onUsar={(f) => void usarFoto(f, avulsa.slot, null)} />
      </Secao>
    </div>
  );
}
