#!/usr/bin/env python3
"""Run a transformation notebook's code cells as a plain script.

The two notebooks here are the documented, hand-edited way to regenerate
src/assets/data. Automation (rulings/refresh.sh, a shell, CI you run yourself) needs
to run them without a Jupyter kernel, so this executes their code cells in order in a
single namespace -- what "Run All" does, minus the kernel and minus writing outputs
back into the .ipynb.

    ./run.py json-transformer     # master, hummingbirds, bonus, general, goals, parameters
    ./run.py language-to-json     # i18n/*.xlsx -> src/assets/data/i18n/<lang>.json

Cells whose only result is a displayed value (a DataFrame, the rule_counts dict) print
nothing here; that is expected. cwd is set to this directory first, so the notebooks'
repo-root lookup resolves the same way it does interactively.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def run(name):
    path = os.path.join(HERE, name if name.endswith('.ipynb') else name + '.ipynb')
    if not os.path.exists(path):
        sys.exit(f'no such notebook: {path}')
    nb = json.load(open(path, encoding='utf-8'))
    cells = [c for c in nb['cells'] if c['cell_type'] == 'code']
    scope = {'__name__': '__main__'}
    os.chdir(HERE)
    for i, cell in enumerate(cells):
        src = ''.join(cell['source'])
        exec(compile(src, f'<{os.path.basename(path)} cell {i}>', 'exec'), scope)
    print(f'{os.path.basename(path)}: ran {len(cells)} code cell(s)')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    run(sys.argv[1])
