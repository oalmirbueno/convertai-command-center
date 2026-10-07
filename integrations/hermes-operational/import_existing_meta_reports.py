"""One-time projection of already-sent, verified reports. No collection/Meta/AI.
Run next to painel_bridge.py. Does not reset the outbox or create a schedule.
"""
import asyncio
import json
import sys
from pathlib import Path
import painel_bridge as bridge


async def main():
    sys.path.insert(0, '/usr/local/lib/hermes-agent')
    from tools.mcp_tool_config import _load_mcp_config
    from tools.mcp_tool_discovery import _connect_server
    root = Path(__file__).resolve().parent
    records = [r for r in bridge.read_outbox(root) if r['state'] == 'sent' and r['payload'].get('event') == 'review']
    server = await asyncio.wait_for(_connect_server('aceleriq', _load_mcp_config()['aceleriq']), 15)
    verified = 0
    try:
        for row in records:
            payload = bridge.readable_report(root, row['payload'])
            if not payload.get('detail', {}).get('summary'):
                continue
            result = await asyncio.wait_for(server.session.call_tool('aceleriq_operator_report', payload), 25)
            if getattr(result, 'isError', False):
                raise RuntimeError('Report rejected; no other records replayed')
            value = json.loads('\n'.join(getattr(c, 'text', '') for c in result.content))
            if isinstance(value, dict) and isinstance(value.get('result'), str):
                value = json.loads(value['result'])
            if value.get('error'):
                raise RuntimeError('Report not accepted')
            verified += 1
        print(json.dumps({'existing_reports_projected': verified, 'new_schedules': 0, 'meta_mutations': 0}))
    finally:
        await server.shutdown()


if __name__ == '__main__':
    asyncio.run(main())
