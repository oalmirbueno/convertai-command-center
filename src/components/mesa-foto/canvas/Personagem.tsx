import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, UserRoundPlus, X } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { chaveDasPersonas, decidirImagemDaPersona, gerarVista, partesDaVista, rotuloDaVista, type ImagemDaPersona } from "../modelosApi";
import { criarPersonagem, type PersonagemCriada, type ResultadoDoCanvas } from "../canvasApi";
import { BOTAO, CAMPO, ROTULO } from "./comum";

/**
 * "Virar personagem" (dono, 25/09 à noite: "a pessoa gerada vira personagem
 * reutilizável"): a foto vira a âncora de uma persona (canvas_personagem_criar,
 * sem IA e sem custo) e a folha de identidade sai uma vista por vez, pelo
 * mesmo gerador da foto (modelo_vista_gerar), com o custo à vista antes.
 * Sem laço: vista que falha fica escrita; gerar de novo é com a equipe.
 */

const IDADE_MINIMA = 21;

export function VirarPersonagem({ r, qualidade, onCriada, onFechar }: { r: ResultadoDoCanvas; qualidade: Qualidade; onCriada: (p: PersonagemCriada) => void; onFechar: () => void }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [nome, setNome] = useState("");
  const [idade, setIdade] = useState("28");
  const [tracos, setTracos] = useState("");
  const [descricao, setDescricao] = useState("");
  const [etica, setEtica] = useState(false);
  const [criando, setCriando] = useState(false);
  const [criada, setCriada] = useState<PersonagemCriada | null>(null);
  const [vistas, setVistas] = useState<ImagemDaPersona[]>([]);
  const [falhas, setFalhas] = useState<string[]>([]);
  const [decididas, setDecididas] = useState<Record<string, "aprovar" | "rejeitar">>({});
  const n = Number(idade);
  const problemas = [!nome.trim() ? "Dê um nome." : "", !isFinite(n) || n < IDADE_MINIMA ? `Idade aparente a partir de ${IDADE_MINIMA} anos.` : "", !etica ? "Confirme a declaração." : ""].filter(Boolean);

  const criar = async () => {
    if (criando || problemas.length || !r.imagem_id) return;
    setCriando(true);
    try {
      const p = await criarPersonagem({
        clientId,
        imagemId: r.imagem_id,
        nome,
        idade: n,
        descricao,
        invariantes: tracos.split(/\n|;/).map((x) => x.trim()).filter(Boolean),
      });
      setCriada(p);
      void queryClient.invalidateQueries({ queryKey: chaveDasPersonas(clientId) });
      toast.success(`${p.nome} virou personagem`, { description: "Já dá para usar no cartão Pessoa, nas próximas cenas e na Mesa Vídeos." });
      p.avisos.forEach((a) => toast.info(a));
      onCriada(p);
    } catch (e) {
      avisarErro(e, "A personagem não foi criada");
    } finally {
      setCriando(false);
    }
  };

  const gerarFolha = async () => {
    if (!criada) return {};
    const erros: string[] = [];
    // Uma vista por vez, na ordem da folha (a função gera uma imagem por chamada).
    for (const vista of criada.folha_sugerida) {
      try {
        const g = await gerarVista({ clientId, modeloId: criada.modelo_id, vista, qualidade });
        if (g.imagem) setVistas((v) => v.concat([g.imagem as ImagemDaPersona]));
      } catch (e) {
        erros.push(`${rotuloDaVista(vista)}: ${textoDoErro(e)}`);
      }
    }
    setFalhas(erros);
    atualizarCusto();
    void queryClient.invalidateQueries({ queryKey: chaveDasPersonas(clientId) });
    return {};
  };

  const decidir = async (img: ImagemDaPersona, decisao: "aprovar" | "rejeitar") => {
    try {
      await decidirImagemDaPersona(img.id, decisao);
      setDecididas((d) => ({ ...d, [img.id]: decisao }));
      void queryClient.invalidateQueries({ queryKey: chaveDasPersonas(clientId) });
    } catch (e) {
      avisarErro(e, "A decisão não foi gravada");
    }
  };

  return (
    <div className="mt-2 min-w-0 space-y-2 rounded-xl border border-sky-400/30 bg-zinc-950 p-2.5" data-virar-personagem={r.geracao_id}>
      <div className="flex min-w-0 items-center">
        <p className="flex min-w-0 flex-1 items-center text-[12px] font-semibold">
          <UserRoundPlus className="mr-1.5 h-3.5 w-3.5 shrink-0 text-sky-300" /> {criada ? `Personagem ${criada.nome}` : "Virar personagem"}
        </p>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {!criada ? (
        <>
          <p className="text-[11px] leading-snug text-zinc-400">A pessoa desta foto vira uma personagem fixa, com esta foto como âncora. Pessoa real não entra aqui: ela vira clone, com a autorização, na aba Clones.</p>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex.: Lia)" aria-label="Nome da personagem" className={CAMPO} />
          <label className="flex min-w-0 items-center text-[11px] text-zinc-400">
            <span className="mr-2 shrink-0">Idade aparente</span>
            <input inputMode="numeric" value={idade} onChange={(e) => setIdade(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} aria-label="Idade aparente" className={`${CAMPO} h-7 py-0`} />
          </label>
          <textarea value={tracos} onChange={(e) => setTracos(e.target.value)} rows={2} placeholder="Traços que não mudam, um por linha: cabelo cacheado castanho; jaqueta jeans; brinco de argola" aria-label="Traços fixos da personagem" className={CAMPO} />
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} placeholder="Quem ela é na história (opcional)" aria-label="Descrição da personagem" className={CAMPO} />
          <label className="flex items-start text-[11.5px] leading-snug text-zinc-200">
            <input type="checkbox" className="mr-2 mt-0.5" checked={etica} onChange={(e) => setEtica(e.target.checked)} aria-label="Declaração da personagem" />
            A personagem é sintética, adulta e não imita nenhuma pessoa real.
          </label>
          {problemas.length > 0 && <p className="text-[11px] text-amber-300">{problemas[0]}</p>}
          <button type="button" className={BOTAO} disabled={criando || problemas.length > 0} onClick={() => void criar()}>
            {criando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UserRoundPlus className="mr-1 h-3.5 w-3.5" />} Criar personagem (sem custo)
          </button>
        </>
      ) : (
        <>
          <p className="text-[11px] leading-snug text-zinc-400">
            A folha de identidade ({criada.folha_sugerida.map(rotuloDaVista).join(", ")}) segura o rosto nas próximas cenas. Sai pelo mesmo gerador da foto, uma vista por vez.
            {criada.estimativa_vista_usd !== null ? ` Cerca de ${usd(criada.estimativa_vista_usd)} por vista.` : ""}
          </p>
          <BotaoComCusto
            rotulo={<>Gerar a folha ({criada.folha_sugerida.length} vistas)</>}
            titulo="Folha da personagem"
            descricao="Uma imagem por vista, pelo mesmo gerador da âncora. Aprove as que ficaram iguais."
            variant="outline"
            className="h-8 border-white/10 bg-white/5 text-[11.5px] text-zinc-100 hover:bg-white/10"
            fecharAoConfirmar
            disabled={vistas.length > 0}
            partes={() => partesDaVista(criada.motor_id, qualidade, 1, criada.folha_sugerida.length)}
            executar={gerarFolha}
          />
          {falhas.map((f) => (
            <p key={f} className="text-[11px] text-red-400 [overflow-wrap:anywhere]" role="alert">
              {f}
            </p>
          ))}
          {vistas.length > 0 && (
            <div className="min-w-0">
              <p className={ROTULO}>Aprove as vistas iguais à âncora</p>
              <div className="flex min-w-0 flex-wrap">
                {vistas.map((v) => (
                  <div key={v.id} className="mb-1.5 mr-1.5 w-16">
                    <span className="block overflow-hidden rounded-lg border border-white/10 bg-zinc-900" style={{ width: 64, height: 80 }}>
                      <MiniaturaDoStorage bucket={v.storage_bucket} caminho={v.storage_path || v.url} alt={rotuloDaVista(v.vista)} largura={160} className="h-full w-full" />
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-zinc-400">{rotuloDaVista(v.vista)}</span>
                    {decididas[v.id] ? (
                      <span className={`block text-[10px] ${decididas[v.id] === "aprovar" ? "text-emerald-300" : "text-zinc-500"}`}>{decididas[v.id] === "aprovar" ? "aprovada" : "rejeitada"}</span>
                    ) : (
                      <span className="flex">
                        <button type="button" className="mr-1 flex h-6 w-7 items-center justify-center rounded-md border border-white/10 text-emerald-300 hover:bg-white/10" onClick={() => void decidir(v, "aprovar")} aria-label={`Aprovar ${rotuloDaVista(v.vista)}`}>
                          <Check className="h-3 w-3" />
                        </button>
                        <button type="button" className="flex h-6 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-400 hover:bg-white/10" onClick={() => void decidir(v, "rejeitar")} aria-label={`Rejeitar ${rotuloDaVista(v.vista)}`}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-zinc-400">A personagem também fica na aba Modelos, com a folha completa.</p>
        </>
      )}
    </div>
  );
}
