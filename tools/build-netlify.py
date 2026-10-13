"""Build the Netlify drag-and-drop bundle: deploy/hood-warfare-netlify-latest.zip (always overwritten).

Layout inside the zip:
  /            landing page (site/index.html with its img/), links rewritten to play/
  /play/       the game (index.html, src/, vendor/ with only the addon modules it imports,
               assets it actually loads: chars, fonts, all models, sfx, used HDRIs, textures)
Declared manifest, forward slashes, no dotfiles — see memory netlify-windows-zip.
Run:  python tools/build-netlify.py
"""
import os, re, sys, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'deploy')
OUT = os.path.join(OUT_DIR, 'hood-warfare-netlify-latest.zip')
os.makedirs(OUT_DIR, exist_ok=True)

def rd(p):
    with open(os.path.join(ROOT, p), encoding='utf8') as f: return f.read()

entries = {}   # zip path -> (disk path | None, bytes | None)
def add_file(zp, disk):
    assert not any(part.startswith('.') for part in zp.split('/')), zp
    entries[zp] = (os.path.join(ROOT, disk), None)
def add_dir(zp_prefix, disk_dir, keep=None):
    for dp, _, files in os.walk(os.path.join(ROOT, disk_dir)):
        for f in files:
            if f.startswith('.') or f.startswith('_') or f.endswith('.txt'): continue
            if keep and not keep(f): continue
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, os.path.join(ROOT, disk_dir)).replace(os.sep, '/')
            add_file(zp_prefix + rel, os.path.relpath(full, ROOT))

# --- landing page at root ---
for f in os.listdir(os.path.join(ROOT, 'site')):
    if f.endswith('.html'): entries[f] = (None, rd('site/' + f).replace('../index.html', 'play/').encode('utf8'))
add_dir('img/', 'site/img', keep=lambda f: f.endswith(('.webp', '.png')) or f == 'og.jpg')

# --- game at /play ---
# the game is published at /play/, so its site/leaderboard.html link must become ../leaderboard.html
entries['play/index.html'] = (None, rd('index.html').replace('href="site/leaderboard.html"', 'href="../leaderboard.html"').encode('utf8'))
add_dir('play/src/', 'src')
add_file('play/vendor/three/three.module.js', 'vendor/three/three.module.js')
add_file('play/vendor/three/three.core.js', 'vendor/three/three.core.js')
add_file('play/vendor/three/LICENSE', 'vendor/three/LICENSE')
add_dir('play/vendor/three-avbd/', 'vendor/three-avbd')

# addon import graph from the modules the game imports
src_text = '\n'.join(rd('src/' + f) for f in os.listdir(os.path.join(ROOT, 'src'))) + rd('index.html')
src_text += '\n'.join(rd('vendor/three-avbd/' + f) for f in os.listdir(os.path.join(ROOT, 'vendor/three-avbd')) if f.endswith('.js'))
queue = sorted(set(re.findall(r"three/addons/([A-Za-z0-9_./-]+\.js)", src_text)))
seen = set()
while queue:
    m = queue.pop()
    if m in seen: continue
    seen.add(m)
    disk = 'vendor/three/jsm/' + m
    add_file('play/vendor/three/jsm/' + m, disk)
    for imp in re.findall(r"from\s+['\"]([^'\"]+)['\"]", rd(disk)):
        if imp.startswith('three/addons/'): queue.append(imp[len('three/addons/'):])
        elif imp.startswith('.'):
            queue.append(os.path.normpath(os.path.join(os.path.dirname(m), imp)).replace(os.sep, '/'))

# assets the code actually loads
add_dir('play/assets/chars/', 'assets/chars')
add_dir('play/assets/fonts/', 'assets/fonts')
add_dir('play/assets/sfx/', 'assets/sfx')
add_dir('play/assets/fx/', 'assets/fx')
add_dir('play/assets/models/', 'assets/models', keep=lambda f: f.endswith('.glb'))
skies = re.findall(r"^\s{4}([a-z_0-9]+):\s*\{", rd('src/main.js'), re.M)
for s in skies:
    p = 'assets/ph/hdri/%s_2k.hdr' % s
    if os.path.exists(os.path.join(ROOT, p)): add_file('play/' + p, p)
add_dir('play/assets/ph/textures/', 'assets/ph/textures')
entries['play/version.txt'] = (None, rd('version.txt').encode('utf8'))
entries['_headers'] = (None, b"/play/assets/*\n  Cache-Control: public, max-age=604800\n/play/vendor/*\n  Cache-Control: public, max-age=604800\n")

if os.path.exists(OUT): os.remove(OUT)
total = 0
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for zp in sorted(entries):
        disk, data = entries[zp]
        assert '\\' not in zp and not zp.startswith('/')
        if data is None:
            z.write(disk, zp); total += os.path.getsize(disk)
        else:
            z.writestr(zp, data); total += len(data)
names = [n for n in zipfile.ZipFile(OUT).namelist()]
assert not any('/.' in n or n.startswith('.') for n in names)
print('zip', OUT)
print('files', len(names), 'raw %.1f MB' % (total / 1e6), 'zip %.1f MB' % (os.path.getsize(OUT) / 1e6))
print('models', sum(n.startswith('play/assets/models/') for n in names), 'hdri', [n for n in names if n.endswith('.hdr')])
print('jsm', sorted(n[len('play/vendor/three/jsm/'):] for n in names if '/jsm/' in n))
