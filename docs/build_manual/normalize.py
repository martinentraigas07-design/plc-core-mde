import json,re
raw=json.load(open('/home/claude/man_build/raw.json'))
blocks=[]  # lista plana con 'pg'
prev_last=None
for pg,items in raw:
    for k,it in enumerate(items):
        it['pg']=pg
        if k==0 and blocks and prev_last is not None:
            pl=blocks[-1]
            near_end=pl.get('_bot',0)>735
            first_top=it.get('_top',0)
            if near_end and first_top<95:
                if it['t']=='mono' and pl['t']=='mono':
                    pl['x']+='\n'+it['x']; pl['_bot']=it.get('_bot',pl['_bot']); continue
                if it['t']=='table' and pl['t']=='table' and (it.get('cont') or not it.get('_hdr')) and len(pl['rows'][0])==len(it['rows'][0]):
                    pl['rows']+=it['rows']; pl['_bot']=it.get('_bot',0); continue
                if it['t']=='p' and pl['t'] in('p','li','ol') and it['x'][:1].islower():
                    pl['x']+=' '+it['x']; pl['_bot']=it.get('_bot',0); continue
                if it['t']=='callout' and pl['t']=='callout' and not it.get('title'):
                    pl['items']+=it['items']; continue
        blocks.append(it)
    if items: prev_last=items[-1]
    # actualizar _bot del último
# renumerar listas ordenadas consecutivas (el original arrastraba la numeración de Word entre secciones)
k=0
for i,b in enumerate(blocks):
    if b['t']=='ol':
        k=k+1 if i>0 and blocks[i-1]['t']=='ol' else 1
        b['n']=k
for b in blocks:
    b.pop('_top',None)
# capítulos
cur='Front'
for b in blocks:
    if b['t']=='chtitle': cur=re.sub('<[^>]+>','',b['x']).strip()
    b['ch']=cur
json.dump(blocks,open('/home/claude/man_build/blocks.json','w'),ensure_ascii=False,indent=0)
import collections
print(len(blocks),collections.Counter(b['t'] for b in blocks))
print(collections.Counter(b['ch'] for b in blocks))
