import {useEffect,useRef,useState} from 'react';
import {RoadSignDetector,type RoadSignMapping,type RoadSignVision,type RoadSignAction} from '../core/RoadSigns';
import type {LineEventMode} from '../core/FinchNavigation';
export function VisionRoadSigns({vision,available,resetKey,onAction,onHide,onCancelHold,motionActive=false}:{vision:RoadSignVision;available:boolean;resetKey:string;onAction:(action:RoadSignAction)=>Promise<boolean>;motionActive?:boolean;onCancelHold?:()=>void;onHide:()=>void}){
 const [rows,setRows]=useState<RoadSignMapping[]>([]),[message,setMessage]=useState('');
 const cancelHold=useRef(onCancelHold);cancelHold.current=onCancelHold;
 const safetyBlocked=useRef(false);
 const previousReset=useRef(resetKey);
 const detector=useRef(new RoadSignDetector());const action=useRef(onAction);action.current=onAction;
 useEffect(()=>{
  if(previousReset.current!==resetKey)safetyBlocked.current=true;
  previousReset.current=resetKey;detector.current.reset();cancelHold.current?.();
 },[available,resetKey,vision.scope,vision.ready,vision.confidence]);
 useEffect(()=>{if(motionActive)safetyBlocked.current=false;},[motionActive]);
 useEffect(()=>{
  if(safetyBlocked.current||!available||!vision.ready||!rows.some(r=>vision.classes.includes(r.className)))return;
  const matched=detector.current.update(vision.items,vision.capturedAt,performance.now(),vision.confidence,rows.filter(r=>vision.classes.includes(r.className)));
  if(matched)void action.current(matched).then(ok=>{setMessage(ok?`Sign: ${matched}`:'Navigation busy — sign ignored');}).catch(()=>{safetyBlocked.current=true;setMessage('Road sign action stopped');});
 },[vision,rows,available]);
 useEffect(()=>{
  const stop=()=>{safetyBlocked.current=true;detector.current.reset();cancelHold.current?.();};
  const hidden=()=>{if(document.hidden)stop();};const key=(e:KeyboardEvent)=>{if(e.code==='Space'){e.preventDefault();stop();}};
  window.addEventListener('blur',stop);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',hidden);
  return()=>{safetyBlocked.current=true;cancelHold.current?.();window.removeEventListener('blur',stop);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',hidden);};
 },[]);
 const changeRows=(update:(items:RoadSignMapping[])=>RoadSignMapping[])=>{
  detector.current.reset();cancelHold.current?.();setMessage('');setRows(update);
 };
 const edit=(index:number,patch:Partial<RoadSignMapping>)=>changeRows(items=>items.map((row,i)=>i===index?{...row,...patch}:row));
 return <div className="behavior-card" aria-label="Vision Road Signs controls">
  <header><strong>Vision Road Signs</strong><button aria-label="Hide Vision Road Signs" onClick={onHide}>×</button></header>
  {rows.map((row,index)=><div className="road-sign-row" key={index}>
   <select aria-label={`Road sign class ${index+1}`} value={row.className} onChange={e=>edit(index,{className:e.target.value})}><option value="">Choose class</option>{vision.classes.map(c=><option key={c} disabled={rows.some((r,i)=>i!==index&&r.className===c)}>{c}</option>)}</select>
   <span>→</span><select aria-label={`Road sign action ${index+1}`} value={row.action} onChange={e=>edit(index,{action:e.target.value as LineEventMode})}>
    <option value="stop">Stop</option><option value="left">Turn Left</option><option value="right">Turn Right</option><option value="continue">Continue</option>
   </select><button aria-label={`Remove road sign mapping ${index+1}`} onClick={()=>changeRows(items=>items.filter((_,i)=>i!==index))}>×</button>
  </div>)}
  <button disabled={!vision.classes.length} onClick={()=>changeRows(items=>[...items,{className:'',action:'stop'}])}>Add mapping</button>

  {!vision.ready&&<small>Start your camera and load the active model.</small>}
  <small role="status">{message}</small>
 </div>;
}
