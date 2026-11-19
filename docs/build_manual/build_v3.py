# -*- coding: utf-8 -*-
import sys,glob,re,json
sys.path.insert(0,'/home/claude/man_build')
import pl
from pl import *
G={}
for f in sorted(glob.glob('/home/claude/man_build/patches/p*.py')):
    exec(compile(open(f).read(),f,'exec'),pl.__dict__)
blocks=pl.apply()
LADDER_OK='✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales (firmware y simulador); no es una prueba formal de equivalencia.'
LADDER_ANALOG='✓ Conversión FBD → Ladder: soportada (AI1, SCALE, CMP y PWM se muestran como filas numéricas). Validada con pruebas diferenciales; no es una prueba formal.'
def gfix(b):
    if b['t']!='mono': return
    out=[]
    for l in b['x'].split('\n'):
        s=l.strip()
        if re.match(r'^✅ (Compatibilidad|Ladder)',s) and ('Level 1' in s or 'PERFECTA' in s or 'igual que' in s or 'Level 1' in s): out.append('  '+LADDER_OK)
        elif s.startswith('❌ Compatibilidad Ladder: NO CONVERTIBLE'): out.append('  '+LADDER_ANALOG)
        else: out.append(l)
    b['x']='\n'.join(out)
for b in blocks: gfix(b)
import re as _re
for k,b in enumerate(blocks):
    if b['t']=='p' and b['x'].startswith('1   Conexiones'):
        items=_re.split(r'\s+(?=(?:\d{1,2}|[ABCG])\s{3}\S)',b['x'])
        order={'A':0,'G':1,'B':2,'C':3}
        lead=[i for i in items if i[0].isdigit()]
        ap=[i for i in items if not i[0].isdigit()]
        ap.sort(key=lambda t:order[t[0]])
        names={'A':'Apéndice A','G':'Glosario','B':'Apéndice B','C':'Apéndice C'}
        new=[]
        for i in lead: n,_,t=i.partition('   '); new.append({'t':'li','x':'<b>Capítulo %s</b> — %s'%(n,t)})
        for i in ap:
            n,_,t=i.partition('   ')
            t=t if n=='G' else t
            new.append({'t':'li','x':'<b>%s</b> — %s'%(names[n],t.replace('Apéndice — ','') if n=='A' else t)})
        blocks[k:k+1]=new
        break
def _ck(c):
    m=_re.search(r'(\d+)',c)
    return (0,int(m.group(1))) if c.startswith('Cap') and m else (1,0) if c.startswith('Ap') else (2,0) if c.startswith('Glos') else (-1,0)
LOGS=sorted(pl.LOG,key=lambda r:_ck(r[0]))
rows=[['<b>Capítulo</b>','<b>Ejemplo</b>','<b>Tipo</b>','<b>Cambio</b>']]+[[c,e,t,x] for c,e,t,x in LOGS]
blocks+= [{'t':'pagebreak'},{'t':'chtitle','x':'<b>Apéndice C — Registro de cambios (v2 → v3) </b>'},
 {'t':'p','x':'Resumen de las correcciones y actualizaciones de ejemplos respecto de la edición v2. Cada fila corresponde a un cambio verificado con la batería de pruebas del repositorio (ver Nota de revisión).'},
 {'t':'table','rows':rows,'w':[14,12,12,62]}]
json.dump(blocks,open('/home/claude/man_build/blocks_v3.json','w'),ensure_ascii=False)
print('bloques',len(pl.B),'->',len(blocks),'ops',len(pl.OPS),'log',len(pl.LOG))
json.dump(pl.LOG,open('/home/claude/man_build/log_v3.json','w'),ensure_ascii=False,indent=0)
