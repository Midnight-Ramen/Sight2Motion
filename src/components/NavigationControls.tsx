import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { FinchNavigation } from '../core/FinchNavigation';
import { FINCH_EFFECTIVE_TRACK_WIDTH_CM } from '../core/FinchGeometry';
import { encoderPair } from '../core/EncoderRecording';
import type { ActionEngine } from '../core/ActionEngine';
import type { RobotAdapter } from '../core/RobotAdapter';
import type { SensorState } from '../core/Sensors';
export function NavigationControls({ engine, robot, sensors, enabled, speed, stopRevision, cancelRef }: {
 engine: ActionEngine; robot: RobotAdapter; sensors: SensorState; enabled: boolean; speed: number; stopRevision: number;
 cancelRef: MutableRefObject<(() => void) | null>;
}) {
 const [distance,setDistance]=useState(30),[angle,setAngle]=useState(90),[status,setStatus]=useState('');
 const latest=useRef({sensors,enabled});latest.current={sensors,enabled};
 const [controller]=useState(()=>new FinchNavigation(engine,robot,()=>latest.current.sensors,()=>latest.current.enabled&&!document.hidden,setStatus));
 cancelRef.current=()=>controller.cancel();
 useEffect(()=>{if(!enabled)controller.cancel();},[enabled,controller]);
 useEffect(()=>{controller.cancel();},[stopRevision,controller]);
 useEffect(()=>{
  const stop=()=>controller.cancel(),hidden=()=>{if(document.hidden)stop();},key=(e:KeyboardEvent)=>{if(e.code==='Space')stop();};
  window.addEventListener('blur',stop);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',hidden);
  return()=>{window.removeEventListener('blur',stop);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',hidden);stop();cancelRef.current=null;};
 },[controller,cancelRef]);
 const disabled=!enabled||controller.active||speed<=0||!encoderPair(sensors,performance.now());
 const calibrated=FINCH_EFFECTIVE_TRACK_WIDTH_CM!==null&&FINCH_EFFECTIVE_TRACK_WIDTH_CM>0;
 return <div className="navigation-controls">
  <div><label>Drive distance <input aria-label="Drive distance cm" type="number" min={1} max={200} value={distance} onChange={e=>setDistance(+e.target.value)} /> cm</label>
   <button disabled={disabled} onClick={()=>void controller.start({kind:'distance',direction:'forward',amount:distance},speed)}>Forward</button>
   <button disabled={disabled} onClick={()=>void controller.start({kind:'distance',direction:'backward',amount:distance},speed)}>Backward</button></div>
  <div><label>Turn <input aria-label="Turn angle degrees" type="number" min={1} max={360} value={angle} onChange={e=>setAngle(+e.target.value)} /> °</label>
   <button disabled={disabled||!calibrated} onClick={()=>void controller.start({kind:'turn',direction:'left',amount:angle},speed)}>Turn Left</button>
   <button disabled={disabled||!calibrated} onClick={()=>void controller.start({kind:'turn',direction:'right',amount:angle},speed)}>Turn Right</button></div>
  {!calibrated&&<small>Turn calibration required</small>}
  <small role="status">{status}</small>
 </div>;
}
