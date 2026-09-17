"""Package the source for sharing without deployment identity or runtime data."""
from pathlib import Path
import json, zipfile
root=Path(__file__).resolve().parent.parent
excluded={'.git','node_modules','dist','.wrangler','.sites-runtime','.next','.vinext','.agents','.codex','outputs','work','__pycache__'}
with zipfile.ZipFile(root/'public'/'relay-source.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob('*')):
        rel=path.relative_to(root)
        if not path.is_file() or any(p in excluded for p in rel.parts): continue
        if path.name.startswith('.env') or path.suffix in {'.zip','.tsbuildinfo'}: continue
        if str(rel)=='.openai/hosting.json':
            archive.writestr(str(rel),json.dumps({'d1':'DB','r2':'BUCKET'},indent=2))
        else: archive.write(path,str(rel))
print('Source archive generated without credentials, database files or deployment identity.')
