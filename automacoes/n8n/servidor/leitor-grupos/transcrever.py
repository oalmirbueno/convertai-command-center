#!/usr/bin/env python3
"""Transcreve um áudio de grupo aqui no servidor (faster-whisper). O áudio não sai da máquina.

Uso: transcrever.py /caminho/arquivo.ogg  ->  uma linha JSON: {"ok": true, "texto": "..."}
ou {"ok": false, "motivo": "sem_fala" | "falhou"}. Nunca imprime o caminho nem variável de ambiente.
O áudio é aberto pelo ffmpeg do sistema (a biblioteca PyAV 19 quebra com o faster-whisper 1.2).
"""
import json
import os
import subprocess
import sys


def sair(obj, codigo=0):
    print(json.dumps(obj, ensure_ascii=False), flush=True)
    raise SystemExit(codigo)


def main():
    if len(sys.argv) != 2 or not os.path.isfile(sys.argv[1]):
        sair({"ok": False, "motivo": "falhou"}, 2)
    try:
        import numpy as np
        from faster_whisper import WhisperModel

        bruto = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", sys.argv[1], "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=120, check=True,
        ).stdout
        audio = np.frombuffer(bruto, dtype=np.float32)
        if audio.size < 1600:
            sair({"ok": False, "motivo": "sem_fala"})
        modelo = WhisperModel(
            os.environ.get("LEITOR_WHISPER_MODELO", "small"),
            device="cpu",
            compute_type="int8",
            cpu_threads=int(os.environ.get("LEITOR_WHISPER_THREADS", "2")),
        )
        trechos, _ = modelo.transcribe(
            audio, language="pt", vad_filter=True, beam_size=5, condition_on_previous_text=False
        )
        texto = " ".join(t.text.strip() for t in trechos).strip()
    except SystemExit:
        raise
    except Exception as erro:
        # Só o tipo do erro, no canal de erro (o leitor ignora; aparece na instalação e no teste manual).
        print("transcricao falhou: " + type(erro).__name__, file=sys.stderr)
        sair({"ok": False, "motivo": "falhou"}, 1)
    if len(texto) < 2:
        sair({"ok": False, "motivo": "sem_fala"})
    sair({"ok": True, "texto": texto})


if __name__ == "__main__":
    main()
