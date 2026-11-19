# -*- coding: utf-8 -*-
import json,re,copy
B=json.load(open('/home/claude/man_build/blocks.json'))
R=json.load(open('/home/claude/man_build/e5_results.json'))
OPS=[]   # (kind, idx, payload)
LOG=[]   # (cap, ejemplo, tipo, texto)
def log(cap,ej,tipo,txt): LOG.append((cap,ej,tipo,txt))
def _txt(b):
    if b['t']=='table': return '\n'.join(' | '.join(r) for r in b['rows'])
    if b['t']=='callout': return '\n'.join(i['x'] for i in b['items'])+(b.get('title') or '')
    return b.get('x','')
def rep(i,old,new):
    """reemplazo de texto dentro del bloque i (assert: el ancla existe)"""
    OPS.append(('rep',i,(old,new)))
def setx(i,new): OPS.append(('setx',i,new))
def settable(i,rows,w=None): OPS.append(('settable',i,(rows,w)))
def after(i,*blocks): OPS.append(('after',i,list(blocks)))
def before(i,*blocks): OPS.append(('before',i,list(blocks)))
def delete(i): OPS.append(('del',i,None))
def replace_block(i,*blocks): OPS.append(('repl',i,list(blocks)))
# constructores
def P(x): return {'t':'p','x':x}
def H2(x): return {'t':'h2','x':'<b>%s </b>'%x}
def LI(x): return {'t':'li','x':x}
def MONO(x,title=None,tcol=None): 
    d={'t':'mono','x':x}
    if title: d['title']=title; d['tcol']=tcol or 'green'
    return d
def TBL(rows,w=None): return {'t':'table','rows':rows,'w':w or [100]*len(rows[0])}
def CALL(title,items,kind='v3'):
    """kind: v3 (verde, corrección), warn (naranja), info (azul)"""
    st={'v3':('green',[0.886,0.941,0.91]),'warn':('orange',[0.988,0.894,0.839]),'info':('blue',[0.87,0.92,0.97])}[kind]
    its=[(i if isinstance(i,dict) else {'t':'p','x':i}) for i in items]
    return {'t':'callout','title':title,'tcol':st[0],'fill':st[1],'items':its}
def V3(items,title='Corrección v3'): return CALL('✔ '+title,items,'v3')
def WARN(title,items): return CALL('⚠ '+title,items,'warn')
def INFO(title,items): return CALL('ℹ '+title,items,'info')
def esc(s): return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
def res_table(key,cols=None,heads=None,outs=(0,1,2,3),extra=None):
    """tabla ejecutada: Evento | IN | OUT1.. (desde e5_results.json)"""
    r=R[key]; rows=r['rows']
    ins=sorted({k for x in rows for k in x['in']})
    hd=['<b>Evento</b>']+['<b>IN%d</b>'%(int(k)+1) for k in ins]
    if any(x['adv'] for x in rows): hd.append('<b>Avance (ms)</b>')
    if any(x.get('ai') is not None for x in rows): hd.append('<b>AI1</b>')
    hd+=['<b>OUT%d</b>'%(o+1) for o in outs]
    if heads: hd=heads
    out=[hd]
    for x in rows:
        line=[x['l']]+[str(x['in'].get(k,'·')) for k in ins]
        if any(y['adv'] for y in rows): line.append(str(x['adv']) if x['adv'] else '—')
        if any(y.get('ai') is not None for y in rows): line.append('—' if x.get('ai') is None else str(x['ai']))
        line+=[x['out'][o] for o in outs]
        out.append(line)
    return out
def apply(blocks=None):
    bl=copy.deepcopy(B) if blocks is None else blocks
    byidx={}
    for k,i,p in OPS: byidx.setdefault(i,[]).append((k,p))
    out=[];changed=[]
    for i,b in enumerate(bl):
        ops=byidx.get(i,[]); pre=[];post=[];drop=False;rb=None
        for k,p in ops:
            if k=='rep':
                old,new=p; done=False
                def sub(s):
                    nonlocal done
                    if old in s: done=True; return s.replace(old,new)
                    return s
                if b['t']=='table': b['rows']=[[sub(c) for c in r] for r in b['rows']]
                elif b['t']=='callout':
                    for it in b['items']: it['x']=sub(it['x'])
                    if b.get('title'): b['title']=sub(b['title'])
                else: b['x']=sub(b['x'])
                assert done,'ancla no encontrada en #%d: %r'%(i,old[:60])
            elif k=='setx': b['x']=p
            elif k=='settable': b['rows']=p[0]; b['w']=p[1] or [100]*len(p[0][0])
            elif k=='before': pre+=p
            elif k=='after': post+=p
            elif k=='del': drop=True
            elif k=='repl': rb=p
        out+=pre
        if rb is not None: out+=rb
        elif not drop: out.append(b)
        out+=post
    return out

def rt(key,outs,names=None,inames=None,w=None,labels=None):
    """res_table con encabezados con nombre: names=lista de nombres de salida, inames={'IN1':'IN1 (arranque NA)'}"""
    t=res_table(key,outs=outs)
    hd=t[0]
    for j,h in enumerate(hd):
        plain=re.sub('<[^>]+>','',h)
        if inames and plain in inames: hd[j]='<b>%s</b>'%inames[plain]
    k=len(hd)-len(outs)
    if names:
        for n,nm in enumerate(names): hd[k+n]='<b>%s</b>'%nm
    if labels:
        for r in t[1:]:
            if r[0] in labels: r[0]=labels[r[0]]
    return t
