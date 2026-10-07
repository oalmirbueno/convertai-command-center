"""Reviewed additive hook installation; no service restart, no session reads."""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/local/lib/hermes-agent")
source = Path(__file__).parent / "operational_mirror.py"
target = root / "tui_gateway/operational_mirror.py"
shutil.copy2(source, target)
server = root / "tui_gateway/server.py"
progress = root / "tui_gateway/tool_progress.py"
for path in (server, progress):
    backup = path.with_suffix(".before-caderno-20261007.py")
    if not backup.exists():
        shutil.copy2(path, backup)

text = server.read_text()
start = text.index("def _mirror_operational_event(")
end = text.index("\n# Idempotency registry", start)
text = text[:start] + '''def _mirror_operational_event(session_id: str, event: str, payload: dict | None = None) -> bool:
    try:
        from tui_gateway.operational_mirror import handle_event
        return handle_event(session_id, event, payload)
    except Exception:
        logger.warning("operational mirror unavailable; conversation continues")
        return False

''' + text[end:]
server.write_text(text)
text = progress.read_text()
marker = '    # Aceleriq: observe the public lifecycle even when UI progress is hidden.\n'
if marker not in text:
    needle = 'def _on_tool_complete(sid: str, tool_call_id: str, name: str, args: dict, result: str):\n'
    assert needle in text
    text = text.replace(needle, needle + marker + '''    _mirror_operational_event(sid, "tool.complete", {"tool_id": tool_call_id, "name": name, "args": args})
''')
progress.write_text(text)
compile(server.read_text(), str(server), "exec")
compile(progress.read_text(), str(progress), "exec")
print("Hooks installed; backups preserved. New gateway processes load them automatically.")
