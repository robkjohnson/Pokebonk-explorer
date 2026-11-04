# Usage: python3 make_csv.py ../extracted/<version>
import json,csv,sys,os
base=sys.argv[1]; os.makedirs(os.path.join(base,'csv'),exist_ok=True)
L=lambda n: json.load(open(os.path.join(base,'json',n+'.json'),encoding='utf-8'))
def w(name,rows,cols):
    with open(os.path.join(base,'csv',name+'.csv'),'w',newline='',encoding='utf-8') as f:
        wr=csv.writer(f); wr.writerow(cols)
        for r in rows: wr.writerow(['|'.join(map(str,v)) if isinstance(v,list) else json.dumps(v) if isinstance(v,dict) else v for v in (r.get(c) for c in cols)])
sp=L('species')
for s in sp:
    for k,v in s['stats'].items(): s['base_'+k]=v
    s['type1']=s['types'][0]; s['type2']=s['types'][1] if len(s['types'])>1 else ''
    rs=s['run_stats_lv1'] or {}
    for k in ['maxHp','regen','armor','evasion','moveSpeed','physical','special']: s['run_'+k]=round(rs.get(k,0),4)
    s['evolves_to']=[e['to'] for e in s['run_evolutions']]; s['evolves_at']=[e['level'] for e in s['run_evolutions']]
w('species',sp,['id','key','name','type1','type2','base_hp','base_atk','base_def','base_spa','base_spd','base_spe','bst','legendary','mythical','evoFrom','evolves_to','evolves_at','family','run_maxHp','run_regen','run_armor','run_evasion','run_moveSpeed','run_physical','run_special'])
pt=L('partners'); pas=L('passives'); kl=L('partner_kit_unlock_levels')
ch=lambda c: c['desc'] if isinstance(c,dict) else ' / '.join(x['desc'] for x in c) if isinstance(c,list) else ''
rows=[]
for p in pt:
    r=dict(p); r['passive_name']=pas.get(p['passive'],{}).get('name'); r['passive_desc']=pas.get(p['passive'],{}).get('desc')
    for i,m in enumerate(p['kit']): r[f'kit{i+1}']=m; r[f'kit{i+1}_level']=kl[i] if i<len(kl) else ''
    r['challenge']=ch(p.get('challenge')); rows.append(r)
w('partners',rows,['id','name','start','role','rank','passive','passive_name','passive_desc','kit1','kit1_level','kit2','kit2_level','kit3','kit3_level','kit4','kit4_level','evoLevels','challenge'])
w('moves',L('moves'),['id','key','name','type','cls','arch','power','dmg','cd','count','area','speed','dur','pierce','status','statusChance','drain','critBonus','flinch','weather','buff','pulses','spread','accuracy','priority','desc'])
w('archetypes',[dict(k=k,**v) for k,v in L('archetypes').items()],['k','label','dmg','cd','count','area','speed','dur','pierce','stats','desc'])
w('vitamins',L('vitamins'),['key','name','stat','kind','per','desc','note'])
it=L('items'); rn=['Common','Uncommon','Rare','Epic','Legendary']
for i in it: i['rarity_name']=rn[i['rarity']] if isinstance(i['rarity'],int) and i['rarity']<5 else i['rarity']; i['mods_text']='; '.join(f"{m['stat']} {'+'+str(m['add']) if 'add' in m else 'x'+str(m.get('mul'))}" for m in i.get('mods',[]))
w('items',it,['key','name','rarity','rarity_name','max','desc','mods_text','tags'])
w('lab',L('lab'),['id','name','desc','max','costs','stat','per'])
fu=L('fusions')
for f in fu: f['move1']=(f.get('moves') or ['',''])[0]; f['move2']=(f.get('moves') or ['',''])[1]; f['pair_types']=json.dumps(f['pair']) if 'pair' in f else ''
w('fusions',fu,['key','kind','member','member_name','move1','move2','pair_types','name','type','type2','cls','cd','power','hits','range','status','repeats','desc'])
w('passives',[dict(key=k,**v) for k,v in pas.items()],['key','name','desc','mods'])
print('csv written')
