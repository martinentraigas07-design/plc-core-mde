# -*- coding: utf-8 -*-
"""Extrae el manual v2 (PDF generado desde Word) a bloques estructurados (JSON)."""
import pdfplumber, json, re, sys, html
SRC='/home/claude/work2/plc-core-mde-main/docs/Manual_PLC_CORE_MDE_COMPLETO_v2.pdf'
COL={ (0.118,0.42,0.235):'green',(0.518,0.235,0.047):'orange',(0.18,0.459,0.714):'blue',(0.122,0.306,0.475):'dblue'}
def ckey(c):
    if isinstance(c,(list,tuple)) and len(c)==3: return tuple(round(x,3) for x in c)
    return None
def esc(s): return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
def markup(chars, mono=False):
    """chars de una línea -> marcado (<b>,<i>,<font color>) sin mono si mono=True"""
    out=[];cur=None;buf=''
    def flush():
        nonlocal buf,cur
        if buf=='' : return
        b,i,c=cur
        t=esc(buf)
        if not mono:
            if c: t='<font color="%s">%s</font>'%(c,t)
            if i: t='<i>%s</i>'%t
            if b: t='<b>%s</b>'%t
        out.append(t);buf=''
    prev=None
    for ch in chars:
        fn=ch['fontname']
        b='Bold' in fn; i=('Oblique' in fn or 'Italic' in fn)
        c=COL.get(ckey(ch.get('non_stroking_color')))
        if c in('dblue',): c=None
        key=(b,i,c)
        if prev is not None and ch['x0']-prev['x1']>1.2*ch['size']*0.28 and ch['text']!=' ':
            pass
        if cur!=key: flush();cur=key
        # espacios: pdfplumber ya incluye ' ' como char
        buf+=ch['text']; prev=ch
    flush()
    return ''.join(out)
def line_class(ch0):
    fn=ch0['fontname']; sz=round(ch0['size'],1); col=ckey(ch0.get('non_stroking_color'))
    if 'Courier' in fn: return 'mono'
    white=ch0.get('non_stroking_color') in ((1.0,),(1,),[1.0],[1.0,1.0,1.0],(1.0,1.0,1.0),1.0)
    if 'Bold' in fn and sz>=19 and white: return 'chtitle'
    if 'Bold' in fn and sz>=13 and white: return 'extitle'
    if 'Bold' in fn and sz>=12 and COL.get(col)=='dblue': return 'h2'
    return 'text'
def group_lines(chars,tol=2.5):
    chars=[c for c in chars if c['text']!='\n']
    chars.sort(key=lambda c:(round(c['top']),c['x0']))
    lines=[];cur=[];ct=None
    for c in sorted(chars,key=lambda c:(c['top'],c['x0'])):
        if ct is None or abs(c['top']-ct)<=tol: cur.append(c); ct=c['top'] if ct is None else ct
        else: lines.append(cur);cur=[c];ct=c['top']
    if cur: lines.append(cur)
    return [sorted(l,key=lambda c:c['x0']) for l in lines]
def mono_text(chars,x0):
    lines=group_lines(chars,tol=2.0)
    out=[]
    for l in lines:
        s=''
        if sum(1 for c in l if 'Courier' in c['fontname'])<0.5*len(l):
            txt=''.join(c['text'] for c in l)
            out.append((' '*max(0,int(round((l[0]['x0']-x0)/5.4)))+txt).rstrip());continue
        for c in l:
            col=int(round((c['x0']-x0)/5.4))
            if col<len(s): 
                if s[col]==' ' or True: s=s[:col]+c['text']+s[col+1:]
            else: s+=' '*(col-len(s))+c['text']
        out.append(s.rstrip())
    return '\n'.join(out).strip('\n')
def isbul(t): return bool(re.match(r'^(•|–|-)\s',t))
def isnum(t): return bool(re.match(r'^\d+[\.\)]\s',t))
def lines_to_blocks(lines):
    """lines: [(x0,top,bottom,markup,plain,cls)] -> bloques"""
    blocks=[]
    for L in lines:
        x0,top,bot,mk,pl,cls=L
        if cls in('chtitle','extitle','h2'):
            if blocks and blocks[-1]['t']==cls and top-blocks[-1]['_bot']<4: blocks[-1]['x']+=' '+mk; blocks[-1]['_bot']=bot
            else: blocks.append({'t':cls,'x':mk,'_bot':bot,'_x0':x0,'_top':top})
            continue
        if isbul(pl):
            blocks.append({'t':'li','x':re.sub(r'^(•|–|-)\s+','',mk),'_bot':bot,'_x0':x0,'_top':top}); continue
        if isnum(pl) and not (blocks and blocks[-1]['t']=='ol' and (top-blocks[-1]['_bot'])<5.0 and int(re.match(r'^(\d+)',pl).group(1))!=blocks[-1]['n']+1):
            m=re.match(r'^(\d+)[\.\)]\s+',pl)
            blocks.append({'t':'ol','x':re.sub(r'^\d+[\.\)]\s+','',mk,count=1),'n':int(m.group(1)),'_bot':bot,'_x0':x0,'_top':top}); continue
        if blocks and blocks[-1]['t'] in('p','li','ol') and (top-blocks[-1]['_bot'])<5.0 and (blocks[-1]['t']!='p' or blocks[-1].get('_cls')==cls):
            blocks[-1]['x']+=' '+mk; blocks[-1]['_bot']=bot; continue
        blocks.append({'t':'p','x':mk,'_bot':bot,'_x0':x0,'_cls':cls,'_top':top})
    return blocks
def page_lines(page,bbox_excl):
    def ok(c):
        if c['top']<50 or c['top']>782: return False
        for (a,b,c2,d) in bbox_excl:
            if a-1<=c['x0']<=c2+1 and b-1<=c['top']<=d+1: return False
        return True
    ch=[c for c in page.chars if ok(c)]
    res=[]
    for l in group_lines(ch):
        txt=''.join(c['text'] for c in l)
        if not txt.strip(): continue
        res.append((l[0]['x0'],min(c['top'] for c in l),max(c['bottom'] for c in l),markup(l).strip(),txt.strip(),line_class(l[0])))
    return res
LAST={'cols':None}
def bands(chars,gap=3.5):
    cs=sorted(chars,key=lambda c:c['top']); out=[];cur=[];bot=None
    for c in cs:
        if bot is None or c['top']<=bot+gap: cur.append(c); bot=c['bottom'] if bot is None else max(bot,c['bottom'])
        else: out.append(cur);cur=[c];bot=c['bottom']
    if cur: out.append(cur)
    return out
def para_items(chars):
    bl=[]
    for l in group_lines(chars):
        txt=''.join(c['text'] for c in l)
        if txt.strip(): bl.append((l[0]['x0'],min(c['top'] for c in l),max(c['bottom'] for c in l),markup(l).strip(),txt.strip(),line_class(l[0])))
    return [{k:v for k,v in b.items() if not k.startswith('_')} for b in lines_to_blocks(bl)]
def table_block(page,t):
    x0,top,x1,bot=t.bbox
    sub=[c for c in page.chars if x0-1<=c['x0']<=x1+1 and top-1<=c['top']<=bot+1 ]
    if not sub or not any(c['text'].strip() for c in sub): return None
    ncells=len(t.rows[0].cells); ncols=max(1,ncells//3)
    mono=sum(1 for c in sub if 'Courier' in c['fontname'])/len(sub)>0.5
    if ncols==1:
        tr=None
        for r in page.rects:
            if abs(r['top']-top)<3 and r['width']>200 and r['height']<35 and r['non_stroking_color'] not in (1.0,0.961,(1.0,1.0,1.0),0.0):
                tr=r;break
        allc=[c for c in page.chars if x0-1<=c['x0']<=x1+1 and top-1<=c['top']<=bot+1]
        title=None;tcol=None;body=sub;bodyall=allc
        if tr is not None:
            tb=tr['bottom']
            tc=[c for c in sub if c['top']<tb-1]; body=[c for c in sub if c['top']>=tb-1]; bodyall=[c for c in allc if c['top']>=tb-1]
            title=' '.join(markup(l).strip() for l in group_lines(tc))
            m=re.search(r'color="(\w+)"',title); tcol=m.group(1) if m else None
            title=re.sub(r'</?(b|i|font[^>]*)>','',title)
        bm=sum(1 for c in body if 'Courier' in c['fontname'])/max(1,len(body))>0.5
        if bm:
            d={'t':'mono','x':mono_text(bodyall,x0+9)}
            if title: d.update({'title':title,'tcol':tcol,'fill':tr['non_stroking_color']})
            return d
        return {'t':'callout','title':title,'tcol':tcol,'fill':(tr['non_stroking_color'] if tr is not None else None),'items':para_items(body)}
    hr=[r for r in page.rects if abs(r['top']-(top+1))<4 and r['height']>=15 and r['width']>15 and ckey(r['non_stroking_color'])==(0.18,0.459,0.714)]
    hr.sort(key=lambda r:r['x0'])
    cols=[(r['x0'],r['x1']) for r in hr]
    if len(cols)<2:
        r0=t.rows[0].cells
        cols=[(r0[3*j][0],r0[3*j][2]) for j in range(ncols) if 3*j<len(r0) and r0[3*j]]
    cont=False
    if len(cols)<2 and LAST['cols'] and len(LAST['cols'])==ncols: cols=list(LAST['cols']);cont=True
    if len(cols)<2: cols=[(x0+i*(x1-x0)/ncols,x0+(i+1)*(x1-x0)/ncols) for i in range(ncols)]
    else:
        if not cont: LAST['cols']=list(cols)
    cols[0]=(x0-2,cols[0][1]); cols[-1]=(cols[-1][0],x1+2)
    data=[]
    for bd in bands(sub):
        row=[]
        for (ca,cb) in cols:
            cs=[c for c in bd if ca<=c['x0']<cb or (c is bd[0] and False)]
            ls=[markup(l).strip() for l in group_lines(cs)]
            row.append(' '.join(q for q in ls if q))
        if any(row): data.append(row)
    return {'t':'table','rows':data,'w':[round(b-a) for a,b in cols],'W':round(x1-x0),'cont':cont}
def extract():
    pdf=pdfplumber.open(SRC)
    out=[]
    for pn,page in enumerate(pdf.pages):
        tbs=[t for t in page.find_tables() if t.bbox[1]>=50 and t.bbox[3]<=790]
        def inside(a,b): return a.bbox[0]>=b.bbox[0]-2 and a.bbox[1]>=b.bbox[1]-2 and a.bbox[2]<=b.bbox[2]+2 and a.bbox[3]<=b.bbox[3]+2 and a is not b
        tbs=[t for t in tbs if not any(inside(t,u) for u in tbs)]
        excl=[t.bbox for t in tbs]
        items=[]
        for t in tbs:
            b=table_block(page,t)
            if b: b['_top']=t.bbox[1];b['_bot']=t.bbox[3];b['_hdr']=len([r for r in page.rects if abs(r['top']-(t.bbox[1]+1))<4 and r['height']>=15 and ckey(r['non_stroking_color'])==(0.18,0.459,0.714)])>=2;items.append(b)
        ls=page_lines(page,excl)
        for b in lines_to_blocks(ls):
            items.append(b)
        items.sort(key=lambda b:b['_top'])
        # ordenar por posición: bloques de texto no tienen top guardado -> recomputo
        out.append((pn+1,items,ls))
    return out
if __name__=='__main__':
    res=extract()
    json.dump([(p,[{k:v for k,v in it.items() if k in('_top','_bot','_hdr') or not k.startswith('_')} for it in items]) for p,items,_ in res],open('/home/claude/man_build/raw.json','w'),ensure_ascii=False)
