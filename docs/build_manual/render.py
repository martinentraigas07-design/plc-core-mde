# -*- coding: utf-8 -*-
import json,re,sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate,PageTemplate,Frame,Paragraph,Spacer,Table,TableStyle,KeepTogether,
                                Preformatted,PageBreak,NextPageTemplate,CondPageBreak,FrameBreak)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping
FD='/usr/share/fonts/truetype/'
for n,f in [('LS','liberation/LiberationSans-Regular.ttf'),('LS-B','liberation/LiberationSans-Bold.ttf'),('LS-I','liberation/LiberationSans-Italic.ttf'),('LS-BI','liberation/LiberationSans-BoldItalic.ttf'),
            ('LM','liberation/LiberationMono-Regular.ttf'),('LM-B','liberation/LiberationMono-Bold.ttf'),('DV','dejavu/DejaVuSans.ttf'),('DV-B','dejavu/DejaVuSans-Bold.ttf'),('DVM','dejavu/DejaVuSansMono.ttf')]:
    pdfmetrics.registerFont(TTFont(n,FD+f))
addMapping('LS',0,0,'LS');addMapping('LS',1,0,'LS-B');addMapping('LS',0,1,'LS-I');addMapping('LS',1,1,'LS-BI')
addMapping('LM',0,0,'LM');addMapping('LM',1,0,'LM-B');addMapping('LM',0,1,'LM');addMapping('LM',1,1,'LM-B')
addMapping('DV',0,0,'DV');addMapping('DV',1,0,'DV-B');addMapping('DV',0,1,'DV');addMapping('DV',1,1,'DV-B')
from fontTools.ttLib import TTFont as FT
CMAP_S=set(FT(FD+'liberation/LiberationSans-Regular.ttf').getBestCmap().keys())
CMAP_M=set(FT(FD+'liberation/LiberationMono-Regular.ttf').getBestCmap().keys())
CMAP_D=set(FT(FD+'dejavu/DejaVuSans.ttf').getBestCmap().keys())
REPL={'⛔':'✗','✅':'✓','❌':'✗'}
C_TEXT=colors.Color(.251,.251,.251); C_BLUE=colors.Color(.18,.459,.714); C_DBLUE=colors.Color(.122,.306,.475)
C_GREEN=colors.Color(.118,.42,.235); C_ORANGE=colors.Color(.518,.235,.047); C_GRAY=colors.Color(.349,.349,.349)
NAMED={'green':'#1e6b3c','orange':'#843c0c','blue':'#2e75b6'}
def fallback(s,cmap=CMAP_S):
    """envuelve en DejaVu los caracteres ausentes de la fuente base (fuera de las etiquetas)"""
    for k,v in REPL.items(): s=s.replace(k,v)
    out=[];intag=False
    for ch in s:
        if ch=='<': intag=True
        if intag or ord(ch) in cmap or ord(ch)<32: out.append(ch)
        elif ord(ch) in CMAP_D: out.append('<font name="DV">%s</font>'%ch)
        else: out.append('?')
        if ch=='>': intag=False
    return ''.join(out)
def fixcolors(s):
    return re.sub(r'<font color="(\w+)">',lambda m:'<font color="%s">'%NAMED.get(m.group(1),m.group(1)),s)
def mk(s): return fallback(fixcolors(s))
ST={
 'p':ParagraphStyle('p',fontName='LS',fontSize=10,leading=13.2,textColor=C_TEXT,spaceAfter=5),
 'li':ParagraphStyle('li',fontName='LS',fontSize=10,leading=13,textColor=C_TEXT,leftIndent=22,bulletIndent=10,spaceAfter=2.5),
 'ol':ParagraphStyle('ol',fontName='LS',fontSize=10,leading=13,textColor=C_TEXT,leftIndent=22,bulletIndent=6,spaceAfter=2.5),
 'h2':ParagraphStyle('h2',fontName='LS-B',fontSize=12,leading=15,textColor=C_DBLUE,spaceBefore=9,spaceAfter=4,keepWithNext=1),
 'ex':ParagraphStyle('ex',fontName='LS-B',fontSize=14,leading=17,textColor=colors.white),
 'ch':ParagraphStyle('ch',fontName='LS-B',fontSize=20,leading=24,textColor=colors.white),
 'cell':ParagraphStyle('cell',fontName='LS',fontSize=8.6,leading=10.6,textColor=C_TEXT),
 'cellh':ParagraphStyle('cellh',fontName='LS-B',fontSize=8.6,leading=10.6,textColor=colors.white),
 'ct':ParagraphStyle('ct',fontName='LS-B',fontSize=10,leading=13,textColor=C_GREEN),
 'cb':ParagraphStyle('cb',fontName='LS',fontSize=9.6,leading=12.6,textColor=C_TEXT,spaceAfter=2),
 'cbli':ParagraphStyle('cbli',fontName='LS',fontSize=9.6,leading=12.4,textColor=C_TEXT,leftIndent=14,bulletIndent=4,spaceAfter=1.5),
}
W=A4[0]-110
def plain(s): return re.sub(r'<[^>]+>','',s)
class Doc(BaseDocTemplate):
    def __init__(self,fn,title,footer,**kw):
        BaseDocTemplate.__init__(self,fn,pagesize=A4,leftMargin=55,rightMargin=55,topMargin=62,bottomMargin=52,title=title,author='Martín Entraigas — PLC-CORE-MDE',**kw)
        self.footer=footer
        fr=Frame(55,52,A4[0]-110,A4[1]-62-52,id='f',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
        self.addPageTemplates([PageTemplate(id='n',frames=[fr],onPage=self.deco)])
        self.chap_marks=[]
    def deco(self,c,d):
        c.saveState()
        c.setFont('LS-B',8);c.setFillColor(C_BLUE);c.drawString(55,A4[1]-34,'PLC-CORE-MDE')
        c.setFont('LS',8);c.setFillColor(C_GRAY);c.drawString(55+66,A4[1]-34,'Manual Didáctico FBD-LADDER  |  ESETP N°748  |  Prof. Martín Entraigas')
        c.setStrokeColor(C_BLUE);c.setLineWidth(.8);c.line(55,A4[1]-40,A4[0]-55,A4[1]-40)
        c.line(55,44,A4[0]-55,44)
        c.setFont('LS',7.5);c.setFillColor(C_GRAY)
        c.drawCentredString(A4[0]/2,34,'Pág. %d  |  IEC 61131-3 FBD  |  ESP32  |  RS-485 / Modbus RTU  |  %s'%(d.page,self.footer))
        c.setFont('LS-I',6.8);c.drawCentredString(A4[0]/2,25,'PLC-CORE-MDE © 2026 Martín Entraigas  |  Uso educativo permitido – uso comercial requiere autorización')
        c.restoreState()
    def afterFlowable(self,f):
        if hasattr(f,'_bm'):
            key,txt,lvl=f._bm
            self.canv.bookmarkPage(key);self.canv.addOutlineEntry(txt,key,lvl,0)
def bar(par,color,pad=5):
    t=Table([[par]],colWidths=[W]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),color),('LEFTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),pad),('BOTTOMPADDING',(0,0),(-1,-1),pad)]));return t
def mono_flow(text,maxw=W-16):
    lines=text.split('\n'); mx=max([len(l) for l in lines]+[1])
    fs=min(8.6,maxw/(0.6*mx)); fs=max(fs,5.2)
    from reportlab.platypus import Preformatted
    style=ParagraphStyle('m',fontName='LM',fontSize=fs,leading=fs*1.22,textColor=colors.Color(.102,.102,.102))
    # sustituir glifos ausentes
    out=[]
    for l in lines:
        s=''
        for ch in l:
            for k,v in REPL.items(): ch=ch.replace(k,v)
            s+=ch
        out.append(s)
    return out,style
def mono_table(text,title=None,tcol=None,fill=None):
    lines,style=mono_flow(text)
    # trocear cajas largas en tramos de 45 líneas
    parts=[lines[i:i+46] for i in range(0,len(lines),46)] or [[]]
    fl=[]
    for p in parts:
        body='\n'.join(p)
        # fallback de glifos fuera de Liberation Mono usando DejaVu Sans Mono
        pf=Preformatted(body,style)
        rows=[[pf]];sty=[('BACKGROUND',(0,0),(-1,-1),colors.Color(.961,.961,.961)),('BOX',(0,0),(-1,-1),.5,colors.Color(.8,.8,.8)),('LEFTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]
        if title and p is parts[0]:
            col={'green':C_GREEN,'orange':C_ORANGE,'blue':C_BLUE}.get(tcol,C_DBLUE)
            bg=colors.Color(*fill) if fill and isinstance(fill,list) and len(fill)==3 else colors.Color(.93,.95,.98)
            rows.insert(0,[Paragraph(mk(esc_title(title)),ParagraphStyle('ctt',parent=ST['ct'],textColor=col))]);sty.append(('BACKGROUND',(0,0),(0,0),bg));sty=[x if x[0]!='BOX' else ('BOX',(0,0),(-1,-1),.8,col) for x in sty]
        t=Table(rows,colWidths=[W]);t.setStyle(TableStyle(sty))
        fl.append(t)
    return fl
def callout(b):
    fill=b.get('fill'); tcol=b.get('tcol')
    col={'green':C_GREEN,'orange':C_ORANGE,'blue':C_BLUE}.get(tcol,C_DBLUE)
    bg=colors.Color(*fill) if fill and isinstance(fill,list) and len(fill)==3 else colors.Color(.93,.95,.98)
    rows=[];sty=[('BOX',(0,0),(-1,-1),.8,col),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]
    if b.get('title'):
        st=ParagraphStyle('ctt',parent=ST['ct'],textColor=col)
        rows.append([Paragraph(mk(esc_title(b['title'])),st)]);sty.append(('BACKGROUND',(0,0),(0,0),bg))
    body=[]
    for it in b['items']:
        body+=item_flow(it,'cb','cbli')
    rows.append([body])
    t=Table(rows,colWidths=[W]);t.setStyle(TableStyle(sty))
    return t
def esc_title(s): return s.replace('&','&amp;') if '&amp;' not in s else s
def item_flow(it,pst='p',lst='li'):
    t=it['t']
    if t=='p': return [Paragraph(mk(it['x']),ST[pst])]
    if t=='li': return [Paragraph(mk(it['x']),ST[lst],bulletText='•')]
    if t=='ol': return [Paragraph(mk(it['x']),ST['ol' if lst=='li' else lst],bulletText='%d.'%it.get('n',1))]
    if t=='mono': return mono_table(it['x'],it.get('title'),it.get('tcol'),it.get('fill'))
    return []
def data_table(b):
    rows=b['rows'];n=len(rows[0]);w=b.get('w') or [W/n]*n
    tot=float(sum(w)) or 1; cw=[x/tot*W for x in w]
    cw=[max(c,26) for c in cw]; s=sum(cw); cw=[c/s*W for c in cw]
    data=[]
    for i,r in enumerate(rows):
        r=(r+['']*n)[:n]
        data.append([Paragraph(mk(c or ''),ST['cellh' if i==0 else 'cell']) for c in r])
    t=Table(data,colWidths=cw,repeatRows=1)
    sty=[('BACKGROUND',(0,0),(-1,0),C_BLUE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('GRID',(0,0),(-1,-1),.4,colors.Color(.75,.75,.75)),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]
    for i in range(1,len(rows)):
        if i%2==0: sty.append(('BACKGROUND',(0,i),(-1,i),colors.Color(.95,.97,.99)))
    t.setStyle(TableStyle(sty));return t
def build(blocks,out,footer,title,cover=None):
    doc=Doc(out,title,footer);story=[];bmn=[0]
    if cover: story+=cover
    for b in blocks:
        t=b['t']
        if t=='pagebreak': story.append(PageBreak());continue
        if t=='chtitle':
            story.append(PageBreak())
            p=Paragraph(mk(b['x']),ST['ch']);p._bm=('c%d'%bmn[0],plain(b['x']),0);bmn[0]+=1
            story+=[bar(p,C_DBLUE,8),Spacer(1,8)];continue
        if t=='extitle':
            p=Paragraph(mk(b['x']),ST['ex']);p._bm=('e%d'%bmn[0],plain(b['x']),1);bmn[0]+=1
            story+=[CondPageBreak(120),Spacer(1,8),bar(p,C_BLUE,4),Spacer(1,3)];continue
        if t=='h2':
            story.append(Paragraph(mk(b['x']),ST['h2']));continue
        if t=='table':
            tb=data_table(b);story+=[tb,Spacer(1,6)];continue
        if t=='mono':
            fl=mono_table(b['x'],b.get('title'),b.get('tcol'),b.get('fill'))
            story+=fl+[Spacer(1,6)];continue
        if t=='callout':
            story+=[callout(b),Spacer(1,6)];continue
        story+=item_flow(b)
    doc.build(story)
if __name__=='__main__':
    blocks=json.load(open('/home/claude/man_build/blocks.json'))
    build(blocks,'/home/claude/man_build/faithful.pdf','v2 re-render','test')
