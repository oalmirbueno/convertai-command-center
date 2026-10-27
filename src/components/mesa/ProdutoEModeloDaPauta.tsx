import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { SeletorDeModelo } from "./Seletores";
import { padraoPara } from "@/lib/mesa/api";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { campo, campoTexto, juntar } from "@/components/sistema/estilos";
import { MiniaturaDaFoto, useMesaFoto } from "@/components/mesa-foto/Comuns";
import EscolhaDoProduto from "@/components/mesa-foto/EscolhaDoProduto";
import EscolhaDoModeloDaFoto from "@/components/mesa-foto/EscolhaDoModeloDaFoto";
import { CENARIOS_PARA_COMBINAR, gerarCombinacao } from "@/components/mesa-foto/CombinarFotos";
import type { ModeloEscolhido } from "@/components/mesa-foto/escolhasDaLinha";
import { acrescentarFotos, useFotos, useKits } from "@/components/mesa-foto/fotoApi";
import { useClones } from "@/components/mesa-foto/clonesApi";
import { usePersonas } from "@/components/mesa-foto/modelosApi";
import { chaveDosCanvases, partesDoGerar } from "@/components/mesa-foto/canvasApi";

interface Rascunho { pessoa: ModeloEscolhido | null; cenario: string; pedido: string; formato: string; quantidade: number; geradas: string[] }
const INICIAL: Rascunho = { pessoa: null, cenario: "cotidiano", pedido: "", formato: "4:5", quantidade: 1, geradas: [] };

/**
 * Produto + modelo na pauta (27/10/2026): escolher o produto e a pessoa
 * (modelo ou clone autorizado) e combinar ali mesmo, pelo mesmo motor do
 * Combinar da Mesa Foto (Canvas). O resultado cai no acervo e na prancheta.
 */
export default function ProdutoEModeloDaPauta({ taskId, titulo, onFotos, onAbrirCompleto }: {
  taskId: string; titulo: string; onFotos: (ids: string[]) => void; onAbrirCompleto?: () => void;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { kitId } = useMesaFoto();
  const cache = useQueryClient();
  const fotos = useFotos(clientId);
  const kits = useKits(clientId);
  const clones = useClones(clientId);
  const personas = usePersonas(clientId);
  const [r, setR] = useEstadoDaTela<Rascunho>(`mesa:foto:produto-modelo:${clientId}:${taskId}`, { ...INICIAL, pedido: titulo });
  const mudar = (p: Partial<Rascunho>) => setR((a) => ({ ...a, ...p }));
  const [motor, setMotor] = useState("");
  const [progresso, setProgresso] = useState("");
  const modeloImagem = motor || padraoPara(catalogo, "imagem")?.id || "";
  const kit = kits.data?.find((k) => k.id === kitId) || null;
  const persona = r.pessoa?.tipo === "persona" ? personas.data?.find((p) => p.id === r.pessoa?.id) || null : null;
  const clone = r.pessoa?.tipo === "clone" ? clones.data?.find((c) => c.id === r.pessoa?.id) || null : null;
  const faltaPessoa = !!r.pessoa && (r.pessoa.tipo === "clone" ? !clone?.autorizacao_valida.ok : r.pessoa.tipo === "persona" ? !persona?.ancora_imagem_id : false);
  const cenario = CENARIOS_PARA_COMBINAR.find((c) => c.id === r.cenario) || CENARIOS_PARA_COMBINAR[0];
  const geradas = r.geradas.map((id) => fotos.data?.find((f) => f.id === id && f.ativa)).filter((f): f is NonNullable<typeof f> => !!f);
  return <section aria-label="Produto e modelo" className="min-w-0 space-y-4" data-produto-e-modelo="">
    <EscolhaDoProduto />
    <div className="min-w-0"><p className="mb-2 text-[12px] font-medium text-muted-foreground">Quem aparece</p><EscolhaDoModeloDaFoto semPessoa valor={r.pessoa} onEscolher={(pessoa) => mudar({ pessoa })} /></div>
    {faltaPessoa && <p role="status" className="text-[12px]">Escolha um modelo com retrato base ou um clone autorizado.</p>}
    <label className="block min-w-0 text-[12px] text-muted-foreground">Cenário<select aria-label="Cenário da combinação" className={juntar(campo, "mt-1")} value={r.cenario} onChange={(e) => mudar({ cenario: e.target.value })}>{CENARIOS_PARA_COMBINAR.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
    <label className="block min-w-0 text-[12px] text-muted-foreground">O que acontece na foto<textarea aria-label="Pedido da combinação" className={juntar(campoTexto, "mt-1")} value={r.pedido} onChange={(e) => mudar({ pedido: e.target.value })} placeholder="Ex.: a modelo segura o produto no balcão da loja, fim de tarde" /></label>
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <label className="min-w-0 text-[12px] text-muted-foreground">Formato<select aria-label="Formato da combinação" className={juntar(campo, "mt-1")} value={r.formato} onChange={(e) => mudar({ formato: e.target.value })}>{["4:5", "1:1", "9:16", "16:9"].map((f) => <option key={f}>{f}</option>)}</select></label>
      <label className="min-w-0 text-[12px] text-muted-foreground">Fotos<select aria-label="Quantidade de combinações" className={juntar(campo, "mt-1")} value={r.quantidade} onChange={(e) => mudar({ quantidade: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
    <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modeloImagem} onChange={setMotor} />
    <BotaoComCusto rotulo={progresso || (r.quantidade === 1 ? "Combinar" : `Combinar ${r.quantidade} fotos`)} titulo="Combinar produto e modelo" descricao="Cria fotos novas com o produto e a pessoa escolhidos, preservando os dois. Entram no acervo e na prancheta."
      disabled={!kit || !modeloImagem || faltaPessoa || !!progresso} className="w-full"
      partes={() => Array.from({ length: r.quantidade }, () => partesDoGerar([modeloImagem], "alta", Math.min(14, (kit?.refs.length || 0) + (persona ? 5 : clone ? 1 : 0)))).flat()}
      executar={async () => {
        try {
          for (let i = 0; i < r.quantidade; i++) {
            setProgresso(`Combinando ${i + 1} de ${r.quantidade}…`);
            const foto = await gerarCombinacao({ clientId, kitId: kit!.id, kitNome: kit!.nome || "Produto", modelo: persona, clone, cenario, pedido: r.pedido, formato: r.formato, motor: modeloImagem, indice: i });
            acrescentarFotos(cache, clientId, [foto]);
            setR((a) => ({ ...a, geradas: [foto.id, ...a.geradas.filter((x) => x !== foto.id)].slice(0, 24) }));
            onFotos([foto.id]);
          }
          return { pronto: true };
        } finally { setProgresso(""); atualizarCusto(); void cache.invalidateQueries({ queryKey: chaveDosCanvases(clientId) }); }
      }} />
    {!kit && <p className="text-[12px] text-muted-foreground">Escolha o produto para combinar.</p>}
    {geradas.length > 0 && <div className="min-w-0"><p className="mb-2 text-[12px] font-medium text-muted-foreground">Combinações desta pauta</p><ul className="grid grid-cols-3 gap-2">{geradas.map((f) => <li key={f.id}><button type="button" aria-label={`Usar ${f.nome} no post`} title="Usar no post" onClick={() => onFotos([f.id])} className="block w-full overflow-hidden rounded-md"><MiniaturaDaFoto foto={f} /></button></li>)}</ul></div>}
    {onAbrirCompleto && <button type="button" className="text-[12px] text-primary" onClick={onAbrirCompleto}>Abrir Combinar completo (ambiente do Workspace, tratamento do produto)</button>}
  </section>;
}
