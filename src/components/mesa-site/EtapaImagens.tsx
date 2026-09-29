import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, EyeOff, ImagePlus, Loader2 } from "lucide-react";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { SeletorDeModelo, SeletorDeQualidade } from "@/components/mesa/Seletores";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { modeloDoPapel, type Qualidade, usd } from "@/lib/mesa/api";
import { SLOTS_DE_IMAGEM } from "../../../supabase/functions/_shared/site-metodo";
import { chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";

type Foto = { id: string; storage_bucket: string; storage_path: string; nome: string };

/**
 * Etapa 5: imagens. GPT Image (ou o gerador escolhido) pela fórmula de
 * imagem, com espaço negativo e a proporção do slot, sem texto e sem logo.
 * A logo e as fotos reais do cliente entram no site pelo código.
 */
export default function EtapaImagens({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const [slot, setSlot] = useState<string>("hero");
  const [sujeito, setSujeito] = useState("");
  const [luz, setLuz] = useState("");
  const [modelo, setModelo] = useState<string>(() => {
    const m = modeloDoPapel(catalogo, "imagem");
    return m ? m.id : "";
  });
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [gerando, setGerando] = useState(false);
  const [custo, setCusto] = useState<number | null>(null);
  const [verAcervo, setVerAcervo] = useState(false);
  const fotos = useQuery({ queryKey: ["mesa-site", "acervo", site.id], enabled: verAcervo, queryFn: () => chamarSite<{ fotos: Foto[] }>("fotos_reais", { site_id: site.id }) });
  const imagens = (site.imagens || []) as Array<{ id: string; slot: string; origem: string; bucket: string; path: string; alt: string; escolhida?: boolean; custo_usd?: number }>;

  const gerar = async () => {
    setGerando(true);
    try {
      const d = await chamarSite<{ site: LinhaDoSite; custo_usd: number }>("imagem_gerar", { site_id: site.id, slot, sujeito: sujeito.trim(), luz: luz.trim() || undefined, modelo_id: modelo || undefined, qualidade });
      guardar(d.site);
      setCusto(d.custo_usd);
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "A imagem não foi gerada");
    } finally {
      setGerando(false);
    }
  };

  const escolher = async (id: string, escolhida: boolean) => {
    try {
      const d = await chamarSite<{ site: LinhaDoSite }>("imagem_escolher", { site_id: site.id, imagem_id: id, escolhida });
      guardar(d.site);
    } catch (e) {
      avisarErro(e, "Não foi possível mudar a imagem");
    }
  };

  const usarFoto = async (f: Foto) => {
    try {
      const d = await chamarSite<{ site: LinhaDoSite }>("foto_real_usar", { site_id: site.id, cliente_imagem_id: f.id, slot });
      guardar(d.site);
    } catch (e) {
      avisarErro(e, "A foto não entrou");
    }
  };

  return (
    <div className="min-w-0 space-y-6" data-etapa-imagens="">
      <Secao
        titulo="Gerar imagem"
        descricao={custo !== null ? `Última: ${usd(custo)}` : undefined}
        ajuda="Fórmula de imagem: sujeito, ação, luz, fundo, estilo e proporção, com espaço negativo para o título. O gerador nunca faz logo, texto ou foto real do cliente: essas entram pelo código."
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={gerando || sujeito.trim().length < 4 || !modelo} onClick={() => void gerar()} data-gerar-imagem="">
              {gerando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
              Gerar
            </button>
            <button type="button" className={botao.primario} onClick={() => onIrPara("construcao")}>
              Seguir
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <SeletorCompacto rotulo="Slot da imagem" opcoes={SLOTS_DE_IMAGEM.map((s) => ({ valor: s.id, rotulo: `${s.rotulo} ${s.proporcao.split(" ")[0]}` }))} valor={slot} onEscolher={setSlot} />
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <input value={sujeito} onChange={(e) => setSujeito(e.target.value)} maxLength={400} placeholder="O que a imagem mostra (ex.: mesa de trabalho com notebook e celular)" className={campo} aria-label="Sujeito da imagem" />
          <input value={luz} onChange={(e) => setLuz(e.target.value)} maxLength={160} placeholder="Luz (opcional)" className={campo} aria-label="Luz da imagem" />
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
        titulo="Fotos reais do acervo"
        recolher="mesa-site:imagens:acervo"
        acao={
          <button type="button" className={botao.discreto} onClick={() => setVerAcervo(!verAcervo)}>
            {verAcervo ? "Esconder" : "Ver acervo"}
          </button>
        }
      >
        {verAcervo && (
          <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {(fotos.data ? fotos.data.fotos : []).slice(0, 36).map((f) => (
              <button key={f.id} type="button" className="min-w-0 overflow-hidden rounded-md" title={`Usar ${f.nome} no slot ${slot}`} onClick={() => void usarFoto(f)}>
                <ImagemDaMesa caminho={f.storage_path} bucket={f.storage_bucket} alt={f.nome} className="h-20 w-full" />
              </button>
            ))}
          </div>
        )}
      </Secao>
    </div>
  );
}
