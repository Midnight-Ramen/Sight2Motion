import type { VerifiedCandidate } from '../src/core/VerifiedHypotheses';
/** Synthetic physical-style Finch body/front/top masks, not a camera capture. */
export function finchHypotheses(offset=0,scale=1,partWins=false):VerifiedCandidate[] {
 return [
  {x:44,y:30,width:64,height:50,score:partWins?.9:.92,view:1},
  {x:68,y:52,width:36,height:25,score:partWins?.93:.9,view:4},
  {x:48,y:34,width:46,height:22,score:.89,view:3}
 ].map(({score,view,...raw})=>{
  const box={x:Math.round(76+(raw.x-76)*scale+offset),y:Math.round(55+(raw.y-55)*scale),width:Math.round(raw.width*scale),height:Math.round(raw.height*scale)};
  const mask=new Uint8Array(160*120);for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++)mask[y*160+x]=1;
  return {box,score,view,scale,segmentation:{mask,width:160,height:120}};
 });
}
