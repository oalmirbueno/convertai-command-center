import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useClones } from "@/components/mesa-foto/clonesApi";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { custoNaTela, novoUid, useCatalogoDaHeygen, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { motorPorId } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { duracaoEstimadaDaFala, ROTEIRO_MAX_CARACTERES } from "../../../supabase/functions/mesa-videos/modulos/video-provedor-heygen";
import { AvisoDeAtivacao } from "./Comuns";
import { BotaoDeGerar } from "./PecasDoGerador";
import { chaveDoRascunhoDoAvatar, RASCUNHO_DO_AVATAR, type RascunhoDoAvatar } from "./rascunhoDoAvatar";
import { chamarMesaVideos, chaveDosPedidos } from "./videosApi";

/**
 * Avatar falando (frente V-C, 26/09/2026): o roteiro vira uma pessoa falando
 * pela HeyGen (motor Avatar IV). Quem fala: um avatar de estoque ou a foto
 * principal de um CLONE da Mesa Foto, este só com a autorização de imagem
 * válida (a mesma regra da Mesa Foto) e a confirmação de que ela cobre vídeo
 * com voz gerada por IA; sem autorização, fica bloqueado com o motivo.
 * Voz em português, formato, resolução e legenda no vídeo. Custo antes pela
 * duração estimada; cobra pela duração real, até o valor confirmado. O vídeo
 * cai nos Resultados e de lá vai para a Edição.
 * Imagens e áudios de prévia da HeyGen não são mostrados (o painel só toca
 * mídia do próprio armazenamento).
 */

const VELOCIDADES = [
  { valor: "0.9", rotulo: "Calma" },
  { valor: "1", rotulo: "Normal" },
  { valor: "1.1", rotulo: "Rápida" },
];

export default function AvatarFalando() {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const [bruto, setR] = useEstadoDaTela<RascunhoDoAvatar>(chaveDoRascunhoDoAvatar(clientId), RASCUNHO_DO_AVATAR, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const r: RascunhoDoAvatar = { ...RASCUNHO_DO_AVATAR, ...bruto };
  const mudar = (m: Partial<RascunhoDoAvatar>) => setR((x) => ({ ...RASCUNHO_DO_AVATAR, ...x, ...m }));

  const motor = motorPorId(r.fonte === "clone" ? "heygen-foto" : "heygen-avatar-iv", motores.motores);
  const estado = motor ? motores.lista.find((x) => x.motor.id === motor.id) || null : null;
  const pronto = !!estado && estado.estado === "pronto";
  const avataresQ = useCatalogoDaHeygen("avatares", pronto && r.fonte === "estoque");
  const vozesQ = useCatalogoDaHeygen("vozes", pronto);
  const clonesQ = useClones(clientId, r.fonte === "clone");

  const avatares = (avataresQ.data && avataresQ.data.itens) || [];
  const vozes = (vozesQ.data && vozesQ.data.itens) || [];
  const clones = clonesQ.data || [];
  const clone = clones.find((c) => c.id === r.clone) || null;
  const avatar = avatares.find((a) => a.id === r.avatar) || null;
  const voz = vozes.find((v) => v.id === r.voz) || vozes[0] || null;

  const segundos = duracaoEstimadaDaFala(r.roteiro, r.velocidade);
  const resolucao = motor && motor.resolucoes.indexOf(r.resolucao) >= 0 ? r.resolucao : motor ? motor.resolucao_padrao : "1080p";
  const custo = custoNaTela(motor, { duracao_s: Math.max(1, segundos), resolucao });
  const formatos = motor ? motor.formatos : ["9:16", "16:9", "1:1", "4:5"];

  const motivo = useMemo(() => {
    if (!motor) return "HeyGen fora do catálogo.";
    if (estado && estado.estado !== "pronto") return `HeyGen: ${estado.estado_rotulo.toLowerCase()}${estado.chave ? ` (${estado.chave})` : ""}.`;
    if (!r.roteiro.trim()) return "Escreva o roteiro.";
    if (r.fonte === "estoque" && !avatar) return "Escolha o avatar.";
    if (r.fonte === "clone") {
      if (!clone) return "Escolha o clone.";
      if (!clone.autorizacao_valida.ok) return `Bloqueado: ${clone.autorizacao_valida.motivo || "clone sem autorização de imagem válida."}`;
      if (!r.confirma) return "Confirme que a autorização cobre vídeo com voz gerada por IA.";
    }
    if (!voz) return "Escolha a voz.";
    return null;
  }, [motor, estado, r.roteiro, r.fonte, r.confirma, avatar, clone, voz]);

  const gerar = async (usd: number) => {
    if (!motor || !voz) return;
    const resp = await chamarMesaVideos<{ pedido_id: string }>({
      acao: "avatar_gerar",
      client_id: clientId,
      fonte: r.fonte,
      avatar_id: r.fonte === "estoque" && avatar ? avatar.id : null,
      clone_id: r.fonte === "clone" && clone ? clone.id : null,
      confirma_uso_em_video: r.fonte === "clone" ? r.confirma : false,
      voz_id: voz.id,
      locale: voz.aceita_locale ? "pt-BR" : null,
      roteiro: r.roteiro,
      formato: formatos.indexOf(r.formato) >= 0 ? r.formato : "9:16",
      resolucao,
      legendas: r.legendas,
      velocidade: r.velocidade,
      titulo: (r.titulo.trim() || (r.fonte === "clone" && clone ? `${clone.nome} falando` : avatar ? `${avatar.nome} falando` : "Avatar falando")).slice(0, 120),
      uid: novoUid(),
      custo_confirmado_usd: usd,
    });
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    toast.success("Avatar enviado para gerar", { description: `Pedido ${String(resp.pedido_id || "").slice(0, 8)}. Acompanhe nos Resultados.` });
  };

  const avisoDaLista = (q: { isLoading: boolean; isError: boolean; error: unknown }, nome: string) => (q.isError ? `Não deu para ler ${nome}: ${textoDoErro(q.error)}` : null);

  return (
    <div className="min-w-0 space-y-5" data-avatar-falando="">
      {estado && estado.estado === "precisa_chave" && <AvisoDeAtivacao>A HeyGen precisa de chave{estado.chave ? ` (${estado.chave})` : ""}. O dono cria o segredo no Supabase.</AvisoDeAtivacao>}

      <CampoDeFormulario rotulo="Roteiro" largo apoio={`${r.roteiro.length} de ${ROTEIRO_MAX_CARACTERES} letras${segundos ? ` · cerca de ${segundos} s de fala` : ""}`}>
        <textarea
          className={juntar(campoTexto, "min-h-[120px]")}
          value={r.roteiro}
          maxLength={ROTEIRO_MAX_CARACTERES}
          onChange={(e) => mudar({ roteiro: e.target.value })}
          placeholder="Ex.: Oi! Eu sou a Ana, da Clínica Bem Estar. Hoje eu vou te mostrar em 20 segundos como funciona a limpeza de pele."
        />
      </CampoDeFormulario>

      <GrupoDeCampos>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Quem fala</p>
          <SeletorCompacto
            rotulo="Quem fala"
            larguraTotal
            opcoes={[
              { valor: "estoque", rotulo: "Avatar de estoque" },
              { valor: "clone", rotulo: "Clone" },
            ]}
            valor={r.fonte}
            onEscolher={(v) => mudar({ fonte: v === "clone" ? "clone" : "estoque", confirma: false })}
          />
        </div>

        {r.fonte === "estoque" ? (
          <CampoDeFormulario rotulo="Avatar" apoio={avisoDaLista(avataresQ, "os avatares") || (avatar && avatar.genero ? avatar.genero : undefined)}>
            <select className={campo} value={avatar ? avatar.id : ""} disabled={!pronto || avataresQ.isLoading} onChange={(e) => mudar({ avatar: e.target.value })} aria-label="Avatar">
              <option value="">{avataresQ.isLoading ? "Lendo os avatares" : avatares.length ? "Escolha o avatar" : "Nenhum avatar"}</option>
              {avatares.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                  {a.genero ? ` · ${a.genero}` : ""}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        ) : (
          <CampoDeFormulario rotulo="Clone" apoio={clone ? (clone.autorizacao_valida.ok ? "Autorização de imagem válida. Vai a foto principal real." : clone.autorizacao_valida.motivo || "Sem autorização válida.") : clonesQ.isError ? `Não deu para ler os clones: ${textoDoErro(clonesQ.error)}` : "Só clone com autorização de imagem válida."}>
            <select className={campo} value={clone ? clone.id : ""} disabled={clonesQ.isLoading} onChange={(e) => mudar({ clone: e.target.value, confirma: false })} aria-label="Clone">
              <option value="">{clonesQ.isLoading ? "Lendo os clones" : clones.length ? "Escolha o clone" : "Nenhum clone na Mesa Foto"}</option>
              {clones.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.autorizacao_valida.ok}>
                  {c.nome}
                  {c.autorizacao_valida.ok ? "" : " · sem autorização válida"}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        )}

        <CampoDeFormulario rotulo="Voz em português" apoio={avisoDaLista(vozesQ, "as vozes") || (voz ? `${voz.brasil ? "Brasil" : voz.idioma}${voz.genero ? ` · ${voz.genero}` : ""}` : undefined)}>
          <select className={campo} value={voz ? voz.id : ""} disabled={!pronto || vozesQ.isLoading} onChange={(e) => mudar({ voz: e.target.value })} aria-label="Voz">
            <option value="">{vozesQ.isLoading ? "Lendo as vozes" : vozes.length ? "Escolha a voz" : "Nenhuma voz"}</option>
            {vozes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
                {v.genero ? ` · ${v.genero}` : ""}
                {v.brasil ? " · Brasil" : ""}
              </option>
            ))}
          </select>
        </CampoDeFormulario>

        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Ritmo da fala</p>
          <SeletorCompacto rotulo="Ritmo da fala" larguraTotal opcoes={VELOCIDADES} valor={String(r.velocidade)} onEscolher={(v) => mudar({ velocidade: Number(v) || 1 })} />
        </div>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
          <SeletorCompacto rotulo="Formato" larguraTotal opcoes={formatos.map((f) => ({ valor: f, rotulo: f }))} valor={formatos.indexOf(r.formato) >= 0 ? r.formato : "9:16"} onEscolher={(v) => mudar({ formato: v })} />
        </div>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Resolução</p>
          <SeletorCompacto rotulo="Resolução" larguraTotal opcoes={(motor ? motor.resolucoes : ["720p", "1080p"]).map((x) => ({ valor: x, rotulo: x }))} valor={resolucao} onEscolher={(v) => mudar({ resolucao: v })} />
        </div>
        <label className="flex min-w-0 items-center self-end pb-2 text-[13px]">
          <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={r.legendas} onChange={(e) => mudar({ legendas: e.target.checked })} />
          Legenda no vídeo
        </label>
        <CampoDeFormulario rotulo="Nome">
          <input className={campo} value={r.titulo} maxLength={120} onChange={(e) => mudar({ titulo: e.target.value })} placeholder="Opcional" />
        </CampoDeFormulario>
      </GrupoDeCampos>

      {r.fonte === "clone" && clone && clone.autorizacao_valida.ok && (
        <label className="flex min-w-0 items-start text-[13px]" data-confirma-uso-em-video="">
          <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={r.confirma} onChange={(e) => mudar({ confirma: e.target.checked })} />
          <span className="min-w-0">A autorização de {clone.nome} cobre vídeo com a imagem da pessoa falando, com voz gerada por IA. No painel, o vídeo fica marcado como gerado por IA.</span>
        </label>
      )}

      <BotaoDeGerar
        custo={custo}
        motivo={motivo}
        onConfirmar={gerar}
        icone={<Mic className="mr-1.5 h-3.5 w-3.5" />}
        extra={`Cerca de ${segundos} s de fala. Cobra pela duração real, até este valor.`}
      />
    </div>
  );
}
