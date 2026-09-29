import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import CascaPublica from "@/components/publico/CascaPublica";
import { EstadoVazio } from "@/components/sistema/Estados";
import { juntar, texto } from "@/components/sistema/estilos";
import VisaoDoBrandbook from "@/components/mesa-identidade/VisaoDoBrandbook";
import type { DadosDoBrandbook, LogoDoBrandbook, ModeloDoBrandbook } from "../../supabase/functions/_shared/brandbook";

/**
 * Página pública do brandbook (/marca/:token), frente IDV. Sem login: lê só
 * o retrato publicado pela equipe (RPC idv_brandbook_publico), que não leva
 * caminho de arquivo nem dado do cliente; as imagens vêm dentro (data URL).
 * A equipe tira do ar quando quiser (o link para de abrir).
 */

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

type Publico = Record<string, any>;

/** O retrato público vira o formato do brandbook (imagens por apelido, com o mapa apelido -> data URL). */
export function dadosDoPublico(p: Publico): { dados: DadosDoBrandbook; imagens: Record<string, string> } {
  const imagens: Record<string, string> = {};
  let n = 0;
  const guardar = (url: unknown): string | null => {
    if (typeof url !== "string" || url.indexOf("data:image/") !== 0) return null;
    const chave = `pub:${n++}`;
    imagens[chave] = url;
    return chave;
  };
  const logo = (l: any): LogoDoBrandbook | null => {
    if (!l) return null;
    const c = guardar(l.imagem);
    return { caminho: c || "pub:sem", mime: "image/png", rotulo: String(l.rotulo || ""), previa_png: c };
  };
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const dados: DadosDoBrandbook = {
    versao_do_esquema: Number(p.versao_do_esquema) || 1,
    marca: { nome: String((p.marca && p.marca.nome) || ""), slogan: String((p.marca && p.marca.slogan) || ""), assinatura: "" },
    conceito: { resumo: String((p.conceito && p.conceito.resumo) || ""), significado_do_logo: String((p.conceito && p.conceito.significado_do_logo) || ""), palavras: arr(p.conceito && p.conceito.palavras).map(String) },
    plataforma: {
      proposito: String((p.plataforma && p.plataforma.proposito) || ""),
      missao: String((p.plataforma && p.plataforma.missao) || ""),
      visao: String((p.plataforma && p.plataforma.visao) || ""),
      valores: arr(p.plataforma && p.plataforma.valores).map(String),
      personalidade: arr(p.plataforma && p.plataforma.personalidade).map(String),
      arquetipo: String((p.plataforma && p.plataforma.arquetipo) || ""),
      publico: String((p.plataforma && p.plataforma.publico) || ""),
    },
    tom: { como_fala: arr(p.tom && p.tom.como_fala).map(String), como_nao_fala: arr(p.tom && p.tom.como_nao_fala).map(String), exemplos: [] },
    logos: {
      principal: logo(p.logos && p.logos.principal),
      secundario: logo(p.logos && p.logos.secundario),
      alternativas: arr(p.logos && p.logos.alternativas).map(logo).filter((l): l is LogoDoBrandbook => !!l),
      icone: arr(p.logos && p.logos.icone).map(logo).filter((l): l is LogoDoBrandbook => !!l),
    },
    regras: {
      protecao_fator: Number(p.regras && p.regras.protecao_fator) || 0.25,
      reducao_minima_px: Number(p.regras && p.regras.reducao_minima_px) || 120,
      reducao_minima_mm: Number(p.regras && p.regras.reducao_minima_mm) || 25,
      usos_incorretos: arr(p.regras && p.regras.usos_incorretos).map(String),
    },
    cores: arr(p.cores).map((c: any) => ({ nome: String(c.nome || c.hex), papel: c.papel === "primaria" || c.papel === "destaque" || c.papel === "neutra" ? c.papel : "secundaria", hex: String(c.hex) })),
    perfil_cmyk: p.perfil_cmyk === "nao_revestido" ? "nao_revestido" : "revestido",
    tipografia: arr(p.tipografia).map((t: any) => ({ familia: String(t.familia || ""), pesos: arr(t.pesos).map(String), uso: t.uso === "titulo" || t.uso === "apoio" ? t.uso : "texto", licenca: String(t.licenca || ""), alternativa: String(t.alternativa || "") })),
    grafismos: arr(p.grafismos).map((g: any) => ({ tipo: g.tipo || "outro", descricao: String(g.descricao || ""), imagem: guardar(g.imagem) })),
    fotografia: { coloracao: String((p.fotografia && p.fotografia.coloracao) || ""), composicao: String((p.fotografia && p.fotografia.composicao) || ""), evitar: String((p.fotografia && p.fotografia.evitar) || ""), ia: String((p.fotografia && p.fotografia.ia) || "") },
    aplicacoes: arr(p.aplicacoes).map((a: any) => ({ tipo: String(a.tipo || ""), descricao: String(a.descricao || ""), imagem: guardar(a.imagem) })),
    mockups: arr(p.mockups).map((m: any) => ({ titulo: String(m.titulo || ""), imagem: guardar(m.imagem) })),
    arquivos: arr(p.arquivos).map((a: any) => ({ nome: String(a.nome || ""), formato: String(a.formato || ""), onde: "" })),
    creditos: { feito_por: "Aceleriq", contato: String((p.creditos && p.creditos.contato) || "") },
  };
  return { dados, imagens };
}

export default function BrandbookPublico() {
  const { token } = useParams<{ token: string }>();
  const [fase, setFase] = useState<"lendo" | "invalido" | "pronto">("lendo");
  const [conteudo, setConteudo] = useState<{ dados: DadosDoBrandbook; imagens: Record<string, string>; modelo: ModeloDoBrandbook; versao: number } | null>(null);

  useEffect(() => {
    if (!token || !TOKEN.test(token)) {
      setFase("invalido");
      return;
    }
    let vivo = true;
    (supabase as any)
      .rpc("idv_brandbook_publico", { _token: token })
      .then(({ data, error }: { data: any; error: unknown }) => {
        if (!vivo) return;
        if (error || !data || !data.brandbook) {
          setFase("invalido");
          return;
        }
        const r = dadosDoPublico(data.brandbook);
        setConteudo({ ...r, modelo: data.modelo === "prancha" ? "prancha" : "paginado", versao: Number(data.versao) || 1 });
        setFase("pronto");
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  if (fase === "lendo") {
    return (
      <CascaPublica titulo="Manual da marca">
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Abrindo
        </p>
      </CascaPublica>
    );
  }
  if (fase === "invalido" || !conteudo) {
    return (
      <CascaPublica titulo="Manual da marca">
        <EstadoVazio titulo="Este link não está mais no ar." descricao="Peça o link novo à equipe da Aceleriq." />
      </CascaPublica>
    );
  }
  return (
    <CascaPublica titulo={conteudo.dados.marca.nome ? `Manual da marca ${conteudo.dados.marca.nome}` : "Manual da marca"} descricao={`Versão ${conteudo.versao}`} largura="documento" centralizar={false}>
      <VisaoDoBrandbook dados={conteudo.dados} modelo={conteudo.modelo} urlDe={(c) => (c ? conteudo.imagens[c] || null : null)} />
    </CascaPublica>
  );
}
