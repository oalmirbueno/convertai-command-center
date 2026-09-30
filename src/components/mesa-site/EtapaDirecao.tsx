import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { GradeDeGrupos, GrupoDeFuncoes } from "@/components/sistema/GrupoDeFuncoes";
import { PreencherComIA } from "@/components/sistema";
import { botao, campoTexto, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { ATRIBUTOS_DO_DNA, MAX_ATRIBUTOS, MIN_ATRIBUTOS, MOVIMENTOS, NICHOS, NIVEIS } from "../../../supabase/functions/_shared/site-metodo";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";
import SeletorDoMotor from "./SeletorDoMotor";
import EditorDoMapa from "./EditorDoMapa";
import PresetsDeEstilo from "./PresetsDeEstilo";
import CampoComIA, { textoDoValor } from "./CampoComIA";

/**
 * Etapa 3: direção. SIT2: tipo de site e mapa (páginas e seções da
 * biblioteca), presets de estilo com prévia e de movimento, e depois o ajuste
 * fino: nicho, referência de nível, DNA (3 a 5 atributos), o modelo do motor
 * (rápido e barato ou premium) e a observação. A paleta vem do kit da marca.
 * O ✨ da direção propõe nicho, nível, movimento e observação com prévia.
 */
export default function EtapaDirecao({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const dnaSalvo = site.dna && Array.isArray(site.dna.atributos) ? site.dna : null;
  const [atributos, setAtributos] = useState<string[]>([]);
  const [movimento, setMovimento] = useState("sutil");
  const [nivel, setNivel] = useState("saas");
  const [nicho, setNicho] = useState("servico_local");
  const [observacao, setObservacao] = useState("");
  const [modelo, setModelo] = useState<string>("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setAtributos(dnaSalvo ? dnaSalvo.atributos.map((a: { id: string }) => a.id) : []);
    setMovimento((dnaSalvo && dnaSalvo.movimento) || "sutil");
    setNivel((dnaSalvo && dnaSalvo.nivel) || "saas");
    setNicho((dnaSalvo && dnaSalvo.nicho) || site.direcao.nicho || "servico_local");
    setObservacao(site.direcao.observacao || "");
    setModelo(site.modelo || "");
    // Ao abrir outro site e quando o DNA muda por fora (preset ou diretor de site).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(site.dna || null)]);

  const alternar = (id: string) => setAtributos((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.length >= MAX_ATRIBUTOS ? l : l.concat([id])));

  const gravar = async (campos: { atributos?: string[]; movimento?: string; nivel?: string; nicho?: string; observacao?: string; modelo?: string }, seguir = false) => {
    const a = campos.atributos || atributos;
    const mv = campos.movimento || movimento;
    const nv = campos.nivel || nivel;
    const ni = campos.nicho || nicho;
    const ob = campos.observacao !== undefined ? campos.observacao : observacao;
    await salvarSite("site_salvar", {
      site_id: site.id,
      dna: { atributos: a, movimento: mv, nivel: nv, nicho: ni },
      direcao: { nicho: ni, nivel: nv, observacao: ob },
      modelo: campos.modelo !== undefined ? campos.modelo : modelo,
      etapa: seguir ? "conteudo" : undefined,
    });
  };

  const salvar = async (seguir: boolean) => {
    setSalvando(true);
    try {
      await gravar({}, seguir);
      if (seguir) onIrPara("conteudo");
    } catch (e) {
      avisarErro(e, "A direção não foi salva");
    } finally {
      setSalvando(false);
    }
  };

  /** ✨ da direção: aplica o que veio (com a prévia da peça) e grava. */
  const aplicarDirecao = async (v: Record<string, unknown>) => {
    const novo: { nicho?: string; nivel?: string; movimento?: string; observacao?: string } = {};
    if (typeof v["direcao.nicho"] === "string" && NICHOS.some((n) => n.id === v["direcao.nicho"])) novo.nicho = String(v["direcao.nicho"]);
    if (typeof v["direcao.nivel"] === "string" && NIVEIS.some((n) => n.id === v["direcao.nivel"])) novo.nivel = String(v["direcao.nivel"]);
    if (typeof v["direcao.movimento"] === "string" && MOVIMENTOS.some((n) => n.id === v["direcao.movimento"])) novo.movimento = String(v["direcao.movimento"]);
    if (v["direcao.observacao"] !== undefined) novo.observacao = textoDoValor(v["direcao.observacao"]);
    if (novo.nicho) setNicho(novo.nicho);
    if (novo.nivel) setNivel(novo.nivel);
    if (novo.movimento) setMovimento(novo.movimento);
    if (novo.observacao !== undefined) setObservacao(novo.observacao);
    await gravar(novo);
  };

  const poucos = atributos.length < MIN_ATRIBUTOS;
  const camposDaDirecao = [
    { chave: "direcao.nicho", rotulo: "Nicho", tipo: "escolha" as const, opcoes: NICHOS.map((n) => n.id), valorAtual: nicho },
    { chave: "direcao.nivel", rotulo: "Referência de nível", tipo: "escolha" as const, opcoes: NIVEIS.map((n) => n.id), valorAtual: nivel, dica: NIVEIS.map((n) => `${n.id}: ${n.descricao}`).join("; ") },
    { chave: "direcao.movimento", rotulo: "Movimento", tipo: "escolha" as const, opcoes: MOVIMENTOS.map((n) => n.id), valorAtual: movimento, dica: MOVIMENTOS.map((n) => `${n.id}: ${n.descricao}`).join("; ") },
    { chave: "direcao.observacao", rotulo: "Observação para o site", tipo: "texto_longo" as const, valorAtual: observacao, dica: "o que o site deve priorizar ou evitar, em 1 a 3 frases", maximo: 1500 },
  ];

  return (
    <div className="min-w-0 space-y-6" data-etapa-direcao="">
      <EditorDoMapa site={site} />
      <PresetsDeEstilo site={site} />

      <Secao
        titulo="Direção"
        descricao={`${atributos.length} de ${MIN_ATRIBUTOS} a ${MAX_ATRIBUTOS} atributos`}
        ajuda="A fórmula de 6 blocos: o quê, estrutura, estilo e DNA, movimento, stack e referência de nível. O DNA escolhe de 3 a 5 atributos (o preset já preenche); a paleta sai do kit da marca. O ✨ propõe nicho, nível, movimento e observação pelo contexto e pelo briefing, com prévia antes de gravar."
        acao={
          <>
            <span className="mr-2 inline-flex">
              <PreencherComIA
                papel="site"
                clientId={clientId}
                marcaId={marca ? marca.id : null}
                campos={camposDaDirecao}
                rotulo="Preencher a direção"
                onAplicar={aplicarDirecao}
                onDesfazer={aplicarDirecao}
              />
            </span>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={salvando} onClick={() => void salvar(false)}>
              {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Salvar
            </button>
            <button type="button" className={botao.primario} disabled={salvando || poucos} onClick={() => void salvar(true)} title={poucos ? "Escolha ao menos 3 atributos (ou um preset)" : undefined}>
              Seguir
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <GradeDeGrupos colunas={3}>
          <GrupoDeFuncoes titulo="Nicho">
            <SeletorCompacto rotulo="Nicho" opcoes={NICHOS.map((n) => ({ valor: n.id, rotulo: n.rotulo }))} valor={nicho} onEscolher={setNicho} larguraTotal />
          </GrupoDeFuncoes>
          <GrupoDeFuncoes titulo="Movimento base">
            <SeletorCompacto rotulo="Movimento base" opcoes={MOVIMENTOS.map((m) => ({ valor: m.id, rotulo: m.rotulo, descricao: m.descricao }))} valor={movimento} onEscolher={setMovimento} larguraTotal />
          </GrupoDeFuncoes>
          <GrupoDeFuncoes titulo="Referência de nível">
            <SeletorCompacto rotulo="Referência de nível" opcoes={NIVEIS.map((n) => ({ valor: n.id, rotulo: n.rotulo, descricao: n.descricao }))} valor={nivel} onEscolher={setNivel} larguraTotal />
          </GrupoDeFuncoes>
        </GradeDeGrupos>
      </Secao>

      <Secao titulo="DNA" descricao={dnaSalvo && dnaSalvo.fonte === "jev" ? "Sugerido pelas referências" : undefined} recolher="mesa-site:direcao:dna">
        <div className="flex flex-wrap" role="group" aria-label="Atributos do DNA">
          {ATRIBUTOS_DO_DNA.map((a) => {
            const ligado = atributos.indexOf(a.id) >= 0;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={ligado}
                title={a.descricao}
                onClick={() => alternar(a.id)}
                className={juntar(etiqueta, "mb-2 mr-2 h-7 px-2.5 text-[12px]", ligado ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70")}
              >
                {a.rotulo}
              </button>
            );
          })}
        </div>
        {dnaSalvo && Array.isArray(dnaSalvo.cores_das_referencias) && dnaSalvo.cores_das_referencias.length > 0 && (
          <div className="flex min-w-0 items-center">
            <span className={juntar(texto.auxiliar, "mr-2")}>Cores das referências</span>
            {dnaSalvo.cores_das_referencias.slice(0, 8).map((c: string) => (
              <span key={c} className="mr-1 inline-block h-4 w-4 rounded-sm border border-border" style={{ background: c }} title={c} />
            ))}
          </div>
        )}
      </Secao>

      <Secao titulo="Motor e observação" recolher="mesa-site:direcao:motor">
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <SeletorDoMotor valor={modelo} onChange={setModelo} />
          <CampoComIA
            rotulo="Observação para o site"
            campo={camposDaDirecao[3]}
            onAplicar={(v) => aplicarDirecao({ "direcao.observacao": v })}
            onDesfazer={(a) => aplicarDirecao({ "direcao.observacao": a })}
          >
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={1500} aria-label="Observação para o site" className={juntar(campoTexto, "min-h-[76px]")} placeholder="Ex.: CTA para o WhatsApp; evitar fundo branco puro" />
          </CampoComIA>
        </div>
      </Secao>
    </div>
  );
}
