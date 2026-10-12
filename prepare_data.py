"""Build local map data from the supplied city buildings, roads and StatsCan files.
Usage: python prepare_data.py CITY.geojson ROADS.geojson STATSCAN.geojson
Requires pyproj and shapely. No network calls.
"""
import sys,json,statistics,math,re
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import transform
from shapely.strtree import STRtree
from pyproj import Transformer
city=json.load(open(sys.argv[1]));roads=json.load(open(sys.argv[2]));stats=json.load(open(sys.argv[3]))
project=Transformer.from_crs(4326,26910,always_xy=True).transform
stats_project=Transformer.from_crs(3347,26910,always_xy=True).transform
geoms=[transform(project,shape(f['geometry'])) for f in city['features']]
tree=STRtree(geoms);links={};audit=[]
for f in stats['features']:
 p=f['properties']
 if p['name']=='..' and p['address']=='..':continue
 g=transform(stats_project,shape(f['geometry'])); candidates=[]
 for index in tree.query(g):
  cg=geoms[index]
  if not g.is_valid or not cg.is_valid:continue
  overlap=g.intersection(cg).area;score=overlap/max(g.area,cg.area) if max(g.area,cg.area)>0 else 0
  if score>=.95:candidates.append((int(index),score))
 if len(candidates)==1:
  index,score=candidates[0]
  if index not in links:links[index]=p
  audit.append({'stats_id':p['id'],'city_id':city['features'][index]['properties']['OBJECTID'],'overlap_score':score})
 else:audit.append({'stats_id':p['id'],'status':'unmatched_or_ambiguous','candidate_count':len(candidates)})
# Source addresses known to be malformed (the facility name already carries the correct street address).
OMIT_ADDRESSES={'3435 Victoria Hall'}
def clean_name(n):return re.sub(r'\s+',' ',re.sub(r'\(\d{3}\)\s*\d{3}-\d{4}','',n)).strip()
def xy(coords):
 if isinstance(coords[0],(int,float)):return [round(coords[0],6),round(coords[1],6)]
 return [xy(c) for c in coords]
features=[];heights=[];bands=[0]*6;missing=zero=0;bad_categories=0
for i,f in enumerate(city['features']):
 p=f['properties'];h=p.get('HEIGHT');status='recorded'
 if h is None:missing+=1;status='missing'
 elif h<=0:zero+=1;h=None;status='zero'
 if h is not None:assert math.isfinite(h);heights.append(h)
 b=5 if h is None else sum(h>=x for x in [10,20,40,80]);bands[b]+=1
 category=p.get('GENERIC_NAME')
 if category and category.startswith('Upon activation,'):category=None;bad_categories+=1
 props={'id':p['OBJECTID'],'height':h,'band':b}
 if category:props['category']=category
 if i in links:
  if links[i]['name']!='..':props['name']=clean_name(links[i]['name'])
  if links[i]['address']!='..' and links[i]['address'] not in OMIT_ADDRESSES:props['address']=links[i]['address']
 features.append({'type':'Feature','id':p['OBJECTID'],'properties':props,'geometry':{'type':f['geometry']['type'],'coordinates':xy(f['geometry']['coordinates'])}})
rfeatures=[]
for f in roads['features']:
 p=f['properties'];c=p.get('CLASS');priority=0 if c in ['FWY','HWY','ART'] else 1 if c in ['COL','HWR','FWR'] else 2
 rfeatures.append({'type':'Feature','id':p['OBJECTID'],'properties':{'name':p.get('FULLNAME') or '', 'class':c or 'Unknown','priority':priority},'geometry':{'type':f['geometry']['type'],'coordinates':xy(f['geometry']['coordinates'])}})
b=[g.bounds for g in (shape(f['geometry']) for f in features)]
meta={'total':len(features),'known':len(heights),'missing':missing+zero,'null_height':missing,'zero_height':zero,'max':max(heights),'median':statistics.median(heights),'bands':bands,'bounds':[min(x[0] for x in b),min(x[1] for x in b),max(x[2] for x in b),max(x[3] for x in b)],'roads':len(rfeatures),'named_roads':sum(bool(f['properties']['name']) for f in rfeatures),'names_retained':sum('name' in f['properties'] for f in features),'addresses_retained':sum('address' in f['properties'] for f in features),'invalid_categories_suppressed':bad_categories}
root=Path(__file__).parent/'data'
for name,data in [('buildings.geojson',{'type':'FeatureCollection','features':features}),('roads.geojson',{'type':'FeatureCollection','features':rfeatures}),('summary.json',meta),('label-match-audit.json',audit)]:
 (root/name).write_text(json.dumps(data,separators=(',',':')))
print(json.dumps(meta,indent=2));print('unmatched labels',[x for x in audit if 'status'in x])
