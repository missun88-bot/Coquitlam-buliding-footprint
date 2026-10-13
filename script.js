'use strict';
// Band boundaries are lower-inclusive; null heights belong only to Unknown.
const BANDS=[
 {label:'Under 10 m',color:'#319DBB'},
 {label:'10–<20 m',color:'#477DDD'},
 {label:'20–<40 m',color:'#6859DF'},
 {label:'40–<80 m',color:'#A344D4'},
 {label:'80 m and above',color:'#E32BC2'},
 {label:'Height unknown',color:'#5B6670'}
];
const $=id=>document.getElementById(id),fmt=n=>n.toLocaleString('en-CA');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let map,meta,records=[],selectedBand=null,selectedFeature=null,ready=false,frame=0,playing=false,ceiling=0,ceilingMax=124;
const colors=['match',['get','band'],...BANDS.flatMap((b,i)=>[i,b.color]),'#5b6670'];
const revealedHeight=['coalesce',['get','height'],0];
let revealFilterPending=false,appliedRevealKey='';
function applyRevealFilter(){
 if(!ready||revealFilterPending)return;
 const key=`${ceiling}|${selectedBand}`;if(key===appliedRevealKey)return;
 revealFilterPending=true;appliedRevealKey=key;
 const filter=['all',['>', ['coalesce',['get','height'],0],0],['<=',['coalesce',['get','height'],0],ceiling]];
 if(selectedBand!==null)filter.push(['==',['get','band'],selectedBand]);
 // Wait only for the building source to render, not for the entire map to become idle.
 // A forced frame also completes updates that leave the filter unchanged.
 const onRendered=()=>{
  if(!map.isSourceLoaded('buildings'))return;
  map.off('render',onRendered);
  revealFilterPending=false;
  requestAnimationFrame(applyRevealFilter);
 };
 map.on('render',onRendered);
 map.setFilter('buildings',filter);
 map.setLayoutProperty('footprints','visibility',selectedBand===5?'visible':'none');
 map.triggerRepaint();
}
let revealRecords=[],revealedCount=0,overviewOutline=[];
let animationPaused=false;
function stop(pause=false){playing=false;animationPaused=pause;cancelAnimationFrame(frame);$('play').textContent=pause?'▶ Resume reveal':ceiling>=ceilingMax?'↻ Reveal buildings':'▶ Reveal buildings';}
function setCeiling(value){
 ceiling=Math.max(0,Math.min(ceilingMax,Number(value)));$('ceiling').value=ceiling;
 $('ceiling-value').textContent=`${ceiling.toFixed(1).replace(/\.0$/,'')} m`;
 const complete=d3.bisectRight(records,ceiling);
 if(selectedFeature&&(selectedFeature.properties.height==null?selectedBand!==5:selectedFeature.properties.height>ceiling))clearDetail();
 applyRevealFilter();
 $('rise-status').textContent=`${fmt(complete)} / ${fmt(meta.known)} revealed in 3D`;
}
function play(){
 if(playing){stop(true);return;}
 // Playback is explicitly requested, never automatic. Reduced-motion still disables camera transitions.
 if(!animationPaused)setCeiling(6);
 animationPaused=false;playing=true;$('play').textContent='Ⅱ Pause reveal';
 const phase=Math.cbrt(ceiling/ceilingMax),duration=5000*(1-phase)/(1-Math.cbrt(6/ceilingMax));let elapsed=0,previous=performance.now(),last=0;
 function tick(now){
  if(!playing)return;
  const delta=Math.min(100,now-previous);previous=now;
  elapsed+=delta;
  if(revealFilterPending){frame=requestAnimationFrame(tick);return;}
  const t=Math.min(1,elapsed/duration);
  if(now-last>=40||t===1){setCeiling(ceilingMax*Math.pow(phase+(1-phase)*t,3));last=now;}
  if(t<1)frame=requestAnimationFrame(tick);else stop();
 }
 frame=requestAnimationFrame(tick);
}
function filterBand(index){
 if(!ready)return;
 selectedBand=selectedBand===index?null:index;
 applyRevealFilter();
 clearDetail();
 d3.selectAll('.band').classed('selected',(_,i)=>i===selectedBand).attr('aria-pressed',(_,i)=>String(i===selectedBand));
 $('clear-band').disabled=selectedBand===null;
 $('selection-status').textContent=selectedBand===null?`All height bands selected. Visibility follows the slider.`:`${fmt(meta.bands[selectedBand])} footprints · ${BANDS[selectedBand].label}. Counts cover the full dataset, regardless of map zoom.`;
}
function drawChart(){
 const scale=d3.scaleLinear().domain([0,d3.max(meta.bands)]).range([0,260]);
 const rows=d3.select('#height-chart').selectAll('button').data(BANDS).join('button').attr('class','band').attr('type','button').attr('aria-pressed','false').attr('aria-label',(b,i)=>`${b.label}: ${fmt(meta.bands[i])} footprints. Filter map.`).on('click',(_,b)=>filterBand(BANDS.indexOf(b)));
 rows.each(function(b,i){
  const row=d3.select(this);const line=row.append('span').attr('class','band-heading');
  line.append('span').attr('class','swatch').style('background',b.color);
  line.append('span').text(b.label);line.append('span').attr('class','band-count').text(`${fmt(meta.bands[i])} · ${(meta.bands[i]/meta.total*100).toFixed(2)}%`);
  const svg=row.append('svg').attr('viewBox','0 0 260 5').attr('preserveAspectRatio','none').attr('aria-hidden','true');
  svg.append('rect').attr('width',260).attr('height',5).attr('rx',2).attr('fill','#dfe3d9');
  svg.append('rect').attr('width',scale(meta.bands[i])).attr('height',5).attr('rx',1).attr('fill',b.color);
 });
}
let hoverPopup,lockedPopup;
function tooltipContent(feature){
 const p=feature.properties,box=document.createElement('div');
 box.style.cssText='font:15px/1.45 Arial,sans-serif;color:#172d20;padding:5px 8px';
 const line=(text,css)=>{const el=document.createElement('div');el.textContent=text;if(css)el.style.cssText=css;box.appendChild(el);};
 if(p.name)line(p.name,'font-weight:700;margin-bottom:3px');
 line(p.height==null?'Height unavailable':`${Number(p.height).toFixed(1)} m tall`,'font:22px Georgia,serif');
 const bits=[p.category,p.height==null?null:BANDS[p.band]?.label].filter(Boolean);
 if(bits.length)line(bits.join(' · '),'font-size:13px;color:#637066');
 if(p.address)line(p.address,'font-size:13px;color:#637066');
 return box;
}
function clearDetail(){
 hoverPopup?.remove();lockedPopup?.remove();
 selectedFeature=null;if(ready)map.setFilter('selected',['==',['id'],-1]);
}
function wholeCity(duration=900){
 const previous={center:map.getCenter(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};
 const b=meta.bounds;map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:45,pitch:55,bearing:0,duration:0});
 // Fit the projected footprint outline at the final pitch, with room for map labels and roofs.
 const {clientWidth:w,clientHeight:h}=map.getContainer();
 const edges={left:28,right:w-54,top:74,bottom:h-76};
 let best=null;
 for(let i=0;i<20&&overviewOutline.length;i++){
  const points=overviewOutline.map(p=>map.project(p));
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
  const top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
  if(left>=edges.left&&right<=edges.right&&top>=edges.top&&bottom<=edges.bottom){
   if(!best||map.getZoom()>best.zoom)best={center:map.getCenter(),zoom:map.getZoom()};
  }
  const dx=(left+right-edges.left-edges.right)/2,dy=(top+bottom-edges.top-edges.bottom)/2;
  const scale=Math.min((edges.right-edges.left)/(right-left),(edges.bottom-edges.top)/(bottom-top));
  if(Math.abs(dx)<1&&Math.abs(dy)<1&&Math.abs(scale-1)<.015)break;
  const center=map.unproject([w/2+dx,h/2+dy]);
  const zoom=map.getZoom()+Math.max(-.35,Math.min(.35,Math.log2(scale*.985)*.7));
  map.jumpTo({center,zoom});
 }
 const target={...(best||{center:map.getCenter(),zoom:map.getZoom()}),pitch:55,bearing:0};
 map.jumpTo(previous);
 map.easeTo({...target,duration:reduced?0:duration});
 $('view-label').textContent='Municipality-wide footprints';$('all-view').classList.add('active');$('centre-view').classList.remove('active');
}
function grid(){
 const features=[];
 for(let x=-122.96;x<=-122.59;x+=.01)features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[x,49.18],[x,49.4]]}});
 for(let y=49.18;y<=49.4;y+=.01)features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-122.96,y],[-122.59,y]]}});
 return {type:'FeatureCollection',features};
}
async function init(){
 try{
  if(!window.maplibregl||!window.d3)throw Error('A bundled JavaScript library could not load. Re-extract the complete ZIP.');
  const responses=await Promise.all([fetch('data/summary.json'),fetch('data/buildings.geojson'),fetch('data/roads.geojson')]);
  if(responses.some(r=>!r.ok))throw Error('Data could not load. Run the included local server from the project folder.');
  const [summary,data,roadData]=await Promise.all(responses.map(r=>r.json()));meta=summary;$('tower-count').textContent=fmt(meta.bands[3]+meta.bands[4]);
  const footprintPoints=data.features.flatMap(f=>f.geometry.type==='MultiPolygon'?f.geometry.coordinates.flat(2):f.geometry.coordinates.flat());
  overviewOutline=d3.polygonHull(footprintPoints)||[];
  revealRecords=data.features.filter(f=>f.properties.height!==null).map(f=>({id:f.id,height:f.properties.height})).sort((a,b)=>a.height-b.height);
  records=revealRecords.map(f=>f.height);ceilingMax=Math.ceil(meta.max);$('ceiling').max=ceilingMax;
  drawChart();
  map=new maplibregl.Map({container:'map',style:{version:8,glyphs:new URL('assets/fonts/',document.baseURI).href+'{fontstack}/{range}.pbf',sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#0e1a24'}}],light:{anchor:'viewport',color:'#ffffff',intensity:.45,position:[1.5,210,40]}},center:[-122.78,49.285],zoom:11,pitch:0,maxPitch:70,maxZoom:19,minZoom:9,renderWorldCopies:false,attributionControl:false});
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'City of Coquitlam | Names/addresses: Statistics Canada'}));
  map.on('error',e=>{console.error(e.error);if(!ready){$('loading').textContent='The map could not initialize. Check that browser hardware acceleration is enabled, then reload.';}});
  map.on('load',()=>{
   map.addSource('grid',{type:'geojson',data:grid()});map.addLayer({id:'grid',type:'line',source:'grid',paint:{'line-color':'#a5baa8','line-opacity':.09,'line-width':.7}});
   map.addSource('roads',{type:'geojson',data:roadData,tolerance:.2,attribution:'City road centrelines'});
   map.addLayer({id:'road-lines',type:'line',source:'roads',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#81968b','line-opacity':['interpolate',['linear'],['zoom'],10,.18,14,.42,17,.60],'line-width':['interpolate',['linear'],['zoom'],10,.35,14,['match',['get','priority'],0,1.5,1,1.1,.65],18,['match',['get','priority'],0,5,1,3.5,2]]}});
   map.addSource('buildings',{type:'geojson',data,tolerance:.15,maxzoom:16,attribution:'City building footprints'});
   map.addLayer({id:'footprints',type:'fill',source:'buildings',filter:['==',['get','band'],5],layout:{visibility:'none'},paint:{'fill-color':colors,'fill-opacity':.65}});
   map.addLayer({id:'buildings',type:'fill-extrusion',source:'buildings',filter:['==',['id'],-1],paint:{'fill-extrusion-color':colors,'fill-extrusion-height':revealedHeight,'fill-extrusion-base':0,'fill-extrusion-opacity':.96,'fill-extrusion-vertical-gradient':true}});
   map.addLayer({id:'selected',type:'line',source:'buildings',filter:['==',['id'],-1],paint:{'line-color':'#ffffff','line-width':2}});
   // Draw names along roads, prioritising major streets and avoiding label collisions.
   for(const [priority,minzoom] of [[0,13],[1,14.5],[2,15.5]]){
    map.addLayer({id:`road-labels-${priority}`,type:'symbol',source:'roads',minzoom,
     filter:['all',['==',['get','priority'],priority],['!=',['get','name'],'']],
     layout:{'symbol-placement':'line','symbol-spacing':350,'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],13,11,17,13],'text-max-angle':30,'text-keep-upright':true,'text-pitch-alignment':'viewport','text-rotation-alignment':'map','text-allow-overlap':false,'text-ignore-placement':false,'text-padding':5},
     paint:{'text-color':'#e1e7dc','text-halo-color':'#0e1a24','text-halo-width':1.6,'text-opacity':['interpolate',['linear'],['zoom'],minzoom,0,minzoom+.5,.95]}});
   }
   // Place road labels beneath the 3D buildings.
for (const priority of [0, 1, 2]) {
  map.moveLayer(`road-labels-${priority}`, 'buildings');
}
  ready=true;wholeCity(0);$('perspective').textContent='Flat view';$('perspective').setAttribute('aria-pressed','true');
   map.once('idle',()=>{$('loading').classList.add('hidden');for(const id of ['ceiling','play','reset'])$(id).disabled=false;setCeiling(ceilingMax);stop();});
   hoverPopup=new maplibregl.Popup({closeButton:false,closeOnClick:false,maxWidth:'250px',offset:12});
   lockedPopup=new maplibregl.Popup({closeButton:true,closeOnClick:false,maxWidth:'250px',offset:12});
   map.on('click',event=>{
    const features=map.queryRenderedFeatures(event.point,{layers:['buildings','footprints']});
    if(features.length){selectedFeature=features[0];map.setFilter('selected',['==',['id'],selectedFeature.id]);hoverPopup.remove();lockedPopup.setLngLat(event.lngLat).setDOMContent(tooltipContent(selectedFeature)).addTo(map);}
    else clearDetail();
   });
   map.on('mousemove',event=>{
    const feature=map.queryRenderedFeatures(event.point,{layers:['buildings','footprints']})[0];
    map.getCanvas().style.cursor=feature?'pointer':'';
    if(lockedPopup.isOpen()){hoverPopup.remove();return;}
    if(feature){hoverPopup.setLngLat(event.lngLat).setDOMContent(tooltipContent(feature)).addTo(map);hoverPopup.getElement().style.pointerEvents='none';}
    else hoverPopup.remove();
   });
   map.getCanvas().addEventListener('mouseleave',()=>hoverPopup.remove());
   map.on('movestart',()=>hoverPopup.remove());
   map.on('rotate',()=>{document.querySelector('.north').style.transform=`rotate(${-map.getBearing()}deg)`;});
   map.on('pitchend',()=>{const on=map.getPitch()>10;$('perspective').textContent=on?'Flat view':'3D view';$('perspective').setAttribute('aria-pressed',String(on));});
   new ResizeObserver(()=>map.resize()).observe($('map'));
  });
  $('ceiling').oninput=e=>{stop();setCeiling(e.target.value);};
  $('play').onclick=()=>{if(map.getPitch()<10)map.easeTo({pitch:innerWidth<540?58:68,duration:reduced?0:650});play();};
  $('reset').onclick=()=>{stop();setCeiling(0);};
  $('all-view').onclick=()=>{if(ready)wholeCity();};
  $('centre-view').onclick=()=>{
   if(!ready)return;
   map.flyTo({center:[-122.792,49.282],zoom:15.25,pitch:innerWidth<540?58:68,bearing:-25,duration:reduced?0:1400});
   $('view-label').textContent='City Centre · detail view';$('centre-view').classList.add('active');$('all-view').classList.remove('active');
  };
  $('perspective').onclick=()=>{if(ready)map.easeTo({pitch:map.getPitch()>10?0:(innerWidth<540?58:68),duration:reduced?0:700});};
  $('clear-band').onclick=()=>filterBand(selectedBand);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
 }catch(error){console.error(error);$('loading').textContent=error.message+' Open this project at http://127.0.0.1:8000 rather than double-clicking index.html.';}
}
init();
