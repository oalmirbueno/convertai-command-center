import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import CascaPublica from "@/components/publico/CascaPublica";
import { EstadoVazio } from "@/components/sistema/Estados";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, campoTexto, foco, juntar, lista, texto } from "@/components/sistema/estilos";

/**
 * Votação dos nomes pelo cliente (/nomes/:token), frente IDV2. Sem login: lê
 * só o retrato que a equipe publicou (nome, justificativa e pronúncia dos
 * finalistas) pela RPC idv_naming_votacao_publica e grava pela
 * idv_naming_votar_publico (que confere token, votação aberta e finalista).
 * A pessoa dá de 1 a 5 a cada nome; votar de novo com o mesmo nome troca o voto.
 */

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

type Retrato = { marca: string; alvo: string; finalistas: Array<{ id: string; nome: string; justificativa: string; pronuncia: string | null }> };

const MENSAGENS: Record<string, string> = {
  votacao_fechada: "A votação foi encerrada pela equipe.",
  votacao_cheia: "A votação já recebeu o máximo de pessoas.",
  nome_invalido: "Escreva o seu nome (de 2 a 60 letras).",
  votos_invalidos: "Dê uma nota a pelo menos um nome.",
  votacao_invalida: "Este link não está mais no ar.",
};

export function mensagemDoErroDaVotacao(e: unknown): string {
  const t = String((e && typeof e === "object" && "message" in (e as Record<string, unknown>) ? (e as Record<string, unknown>).message : e) || "");
  for (const k of Object.keys(MENSAGENS)) if (t.indexOf(k) >= 0) return MENSAGENS[k];
  return "Não foi possível registrar agora. Tente de novo.";
}

export default function VotacaoDeNomes() {
  const { token } = useParams<{ token: string }>();
  const [fase, setFase] = useState<"lendo" | "invalido" | "pronto" | "fechada" | "enviado">("lendo");
  const [retrato, setRetrato] = useState<Retrato | null>(null);
  const [notas, setNotas] = useState<Record<string, number>>({});
  const [nome, setNome] = useState("");
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !TOKEN.test(token)) {
      setFase("invalido");
      return;
    }
    let vivo = true;
    (supabase as any).rpc("idv_naming_votacao_publica", { _token: token }).then(({ data, error }: { data: any; error: unknown }) => {
      if (!vivo) return;
      if (error || !data || !data.votacao || !Array.isArray(data.votacao.finalistas)) {
        setFase("invalido");
        return;
      }
      setRetrato(data.votacao as Retrato);
      setFase(data.aberta === false ? "fechada" : "pronto");
    });
    return () => {
      vivo = false;
    };
  }, [token]);

  const enviar = async () => {
    setErro(null);
    setEnviando(true);
    try {
      const votos = Object.keys(notas).map((k) => ({ candidato_id: k, nota: notas[k] }));
      const { error } = await (supabase as any).rpc("idv_naming_votar_publico", { _token: token, _votante: nome.trim(), _votos: votos, _comentario: comentario.trim() || null });
      if (error) throw error;
      setFase("enviado");
    } catch (e) {
      setErro(mensagemDoErroDaVotacao(e));
    } finally {
      setEnviando(false);
    }
  };

  if (fase === "lendo") {
    return (
      <CascaPublica titulo="Votação dos nomes">
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Abrindo
        </p>
      </CascaPublica>
    );
  }
  if (fase === "invalido" || !retrato) {
    return (
      <CascaPublica titulo="Votação dos nomes">
        <EstadoVazio titulo="Este link não está mais no ar." descricao="Peça o link novo à equipe da Aceleriq." />
      </CascaPublica>
    );
  }
  if (fase === "fechada") {
    return (
      <CascaPublica titulo={`Nomes para ${retrato.marca}`}>
        <EstadoVazio titulo="A votação foi encerrada." descricao="Obrigado. A equipe já está com os votos." />
      </CascaPublica>
    );
  }
  if (fase === "enviado") {
    return (
      <CascaPublica titulo={`Nomes para ${retrato.marca}`}>
        <EstadoVazio icone={<CheckCircle2 className="h-5 w-5" />} titulo="Voto registrado. Obrigado!" descricao="Se quiser mudar, vote de novo com o mesmo nome." />
      </CascaPublica>
    );
  }

  const podeEnviar = nome.trim().length >= 2 && Object.keys(notas).length > 0 && !enviando;
  return (
    <CascaPublica titulo={`Nomes para ${retrato.marca}`} descricao={`Finalistas para o ${retrato.alvo}`} ajuda="Dê de 1 a 5 estrelas a cada nome (5 é o que tem mais a cara de vocês). Votar de novo com o mesmo nome troca o voto.">
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Finalistas">
        {retrato.finalistas.map((f) => (
          <li key={f.id} className={juntar(lista.linha, "flex-wrap items-start")} data-finalista={f.id}>
            <span className="min-w-0 flex-1">
              <span className={juntar(texto.tituloSecao, "block")}>{f.nome}</span>
              {f.pronuncia && <span className={juntar(texto.auxiliar, "block")}>Fala-se: {f.pronuncia}</span>}
              {f.justificativa && <span className={juntar(texto.corpo, "mt-0.5 block text-muted-foreground")}>{f.justificativa}</span>}
            </span>
            <span className="inline-flex items-center" role="radiogroup" aria-label={`Nota para ${f.nome}`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={notas[f.id] === n} aria-label={`${n} de 5`} onClick={() => setNotas({ ...notas, [f.id]: n })} className={juntar("inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted", foco)}>
                  <Star className={juntar("h-5 w-5", n <= (notas[f.id] || 0) ? "fill-primary text-primary" : "text-muted-foreground")} />
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-5 grid min-w-0 grid-cols-1 gap-4">
        <CampoDeFormulario rotulo="Seu nome" obrigatorio>
          <input className={campo} value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Comentário" apoio="Opcional">
          <textarea className={juntar(campoTexto, "min-h-[72px]")} value={comentario} maxLength={500} onChange={(e) => setComentario(e.target.value)} />
        </CampoDeFormulario>
        {erro && (
          <p className={juntar(texto.auxiliar, "text-destructive")} role="alert">
            {erro}
          </p>
        )}
        <button type="button" className={botao.primario} disabled={!podeEnviar} onClick={() => void enviar()}>
          {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Enviar meu voto
        </button>
      </div>
    </CascaPublica>
  );
}
