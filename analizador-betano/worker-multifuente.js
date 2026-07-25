const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};

export default{
 async fetch(request){
  if(request.method==="OPTIONS")return new Response(null,{headers:corsHeaders});
  const url=new URL(request.url);
  if(url.pathname==="/")return json({ok:true,service:"Buscador RTP multifuente",sources:["DuckDuckGo","Bing","Google fallback"]});
  if(url.pathname!=="/buscar"||request.method!=="POST")return json({ok:false,error:"Ruta no encontrada"},404);
  try{
   const body=await request.json();
   const juegos=Array.isArray(body.juegos)?body.juegos.map(x=>String(x||"").trim()).filter(Boolean).slice(0,12):[];
   if(!juegos.length)return json({ok:false,error:"No se recibieron juegos"},400);
   const resultados=[];
   for(const juego of juegos)resultados.push(await buscarRtp(juego));
   return json({ok:true,resultados});
  }catch(e){return json({ok:false,error:"No se pudo procesar",detalle:String(e)},500)}
 }
};

async function buscarRtp(juego){
 const queries=[
  {name:"DuckDuckGo",url:`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`\"${juego}\" slot RTP`)}`},
  {name:"Bing",url:`https://www.bing.com/search?q=${encodeURIComponent(`\"${juego}\" slot RTP`)}`},
  {name:"Google",url:`https://www.google.com/search?q=${encodeURIComponent(`\"${juego}\" slot RTP`)}`}
 ];
 let all=[];let used=[];
 for(const q of queries){
  try{
   const r=await fetch(q.url,{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36","Accept-Language":"es-AR,es;q=0.9,en;q=0.8"}});
   if(!r.ok)continue;
   const html=await r.text();
   const vals=extraerRtp(html);
   if(vals.length){all.push(...vals);used.push(q.name)}
  }catch{}
 }
 const valores=[...new Set(all)].filter(v=>v>=80&&v<=100).sort((a,b)=>b-a);
 if(!valores.length)return{juego,rtp:null,estado:"no_verificado",fuentes:used};
 const rtp=elegirRtp(valores);
 return{juego,rtp,estado:clasificar(rtp),valores_encontrados:valores.slice(0,10),fuentes:used,advertencia:valores.length>1?"Se encontraron varios valores; el casino puede usar otra configuración.":null};
}

function extraerRtp(html){
 const texto=decode(html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," "));
 const patrones=[/RTP.{0,80}?(\d{2}(?:[.,]\d{1,2})?)\s*%/gi,/(\d{2}(?:[.,]\d{1,2})?)\s*%.{0,60}?RTP/gi,/return to player.{0,80}?(\d{2}(?:[.,]\d{1,2})?)\s*%/gi,/payout.{0,60}?(\d{2}(?:[.,]\d{1,2})?)\s*%/gi];
 const out=[];
 for(const p of patrones){let m;while((m=p.exec(texto))!==null){const n=Number(m[1].replace(",","."));if(n>=80&&n<=100)out.push(n)}}
 return out;
}
function decode(s){return s.replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")}
function elegirRtp(v){const normales=v.filter(x=>x>=90&&x<100);return normales.length?normales[0]:v[0]}
function clasificar(rtp){if(rtp>=97)return"alto";if(rtp>=96)return"normal";return"bajo"}
function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{...corsHeaders,"Content-Type":"application/json; charset=UTF-8"}})}