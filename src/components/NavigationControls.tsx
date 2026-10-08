import { NumericSlider } from './NumericSlider';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { FinchNavigation, freshDistance, type DriveUntilCondition } from '../core/FinchNavigation';
import { FINCH_EFFECTIVE_TRACK_WIDTH_CM } from '../core/FinchGeometry';
import { EncoderRecording, encoderPair } from '../core/EncoderRecording';
import type { ActionEngine } from '../core/ActionEngine';
import type { RobotAdapter } from '../core/RobotAdapter';
import type { SensorState } from '../core/Sensors';
export function NavigationControls({ engine, robot, sensors, enabled, speed, stopRevision, cancelRef, recording, onActiveChange }: {
 recording: EncoderRecording; onActiveChange: (active:boolean)=>void;
 engine: ActionEngine; robot: RobotAdapter; sensors: SensorState; enabled: boolean; speed: number; stopRevision: number;
 cancelRef: MutableRefObject<(() => void) | null>;
}) {
 const [distance,setDistance]=useState(30),[angle,setAngle]=useState(90),[status,setStatus]=useState('');
 const [untilOperator,setUntilOperator]=useState<DriveUntilCondition['operator']>('lessThan');
 const [untilValue,setUntilValue]=useState(20),[untilSpeed,setUntilSpeed]=useState(30);
 const [emergencyEnabled,setEmergencyEnabled]=useState(false),[emergencyDistance,setEmergencyDistance]=useState(10);
 const latest=useRef({sensors,enabled});latest.current={sensors,enabled};
 const [controller]=useState(()=>new FinchNavigation(engine,robot,()=>latest.current.sensors,()=>latest.current.enabled&&!document.hidden,setStatus));
 useEffect(()=>{onActiveChange(controller.active);},[status,controller,onActiveChange]);
 useEffect(()=>{controller.sensorsUpdated();},[sensors,controller]);
 cancelRef.current=()=>controller.cancel();
 useEffect(()=>{if(!enabled)controller.cancel();},[enabled,controller]);
 useEffect(()=>{controller.cancel();},[stopRevision,controller]);
 useEffect(()=>{
  const stop=()=>controller.cancel(),hidden=()=>{if(document.hidden)stop();},key=(e:KeyboardEvent)=>{if(e.code==='Space')stop();};
  window.addEventListener('blur',stop);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',hidden);
  return()=>{window.removeEventListener('blur',stop);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',hidden);stop();cancelRef.current=null;};
 },[controller,cancelRef]);
 const disabled=!enabled||controller.active||speed<=0||!encoderPair(sensors,performance.now());
 const distanceFresh=freshDistance(sensors,performance.now())!==null;
 const emergency=emergencyEnabled?emergencyDistance:undefined;
 const emergencyInvalid=emergencyEnabled&&(!distanceFresh||!Number.isFinite(emergencyDistance)||emergencyDistance<0);
 const calibrated=FINCH_EFFECTIVE_TRACK_WIDTH_CM!==null&&FINCH_EFFECTIVE_TRACK_WIDTH_CM>0;
 return <div className="navigation-controls">
  <div><label>Drive distance <input aria-label="Drive distance cm" type="number" min={1} max={200} value={distance} onChange={e=>setDistance(+e.target.value)} /> cm</label>
   <button disabled={disabled||emergencyInvalid} onClick={()=>void controller.start({kind:'distance',direction:'forward',amount:distance},speed,emergency)}>Forward</button>
   <button disabled={disabled} onClick={()=>void controller.start({kind:'distance',direction:'backward',amount:distance},speed)}>Backward</button></div>
  <div><label><input type="checkbox" checked={emergencyEnabled} disabled={controller.active} onChange={e=>setEmergencyEnabled(e.target.checked)} /> Emergency stop distance</label>
   <input aria-label="Emergency stop distance cm" type="number" min={0} value={emergencyDistance} disabled={controller.active||!emergencyEnabled} onChange={e=>setEmergencyDistance(+e.target.value)} /> cm</div>
  <div><strong>Drive Until</strong><span>Distance sensor</span>
   <select aria-label="Drive Until operator" value={untilOperator} onChange={e=>setUntilOperator(e.target.value as DriveUntilCondition['operator'])}>
    <option value="lessThan">&lt;</option><option value="lessThanOrEqual">≤</option><option value="greaterThan">&gt;</option><option value="greaterThanOrEqual">≥</option>
   </select><input aria-label="Drive Until distance cm" type="number" min={0} value={untilValue} onChange={e=>setUntilValue(+e.target.value)} /> cm
   <label>Speed %<NumericSlider aria-label="Drive Until speed" min={1} max={100} step={1} value={untilSpeed} onChange={e=>setUntilSpeed(+e.target.value)} /></label>
   <button disabled={!enabled||controller.active||!encoderPair(sensors,performance.now())||!distanceFresh||emergencyInvalid||!Number.isFinite(untilValue)||untilValue<0||untilSpeed<=0||untilSpeed>100}
    onClick={()=>void controller.driveUntil({operator:untilOperator,value:untilValue},untilSpeed,emergency)}>Start Drive Until</button>
  </div>
  {!distanceFresh&&<small>Fresh distance sensor data is required for Drive Until and emergency braking.</small>}
  <div><label>Turn <input aria-label="Turn angle degrees" type="number" min={1} max={360} value={angle} onChange={e=>setAngle(+e.target.value)} /> °</label>
   <button disabled={disabled||!calibrated} onClick={()=>void controller.start({kind:'turn',direction:'left',amount:angle},speed)}>Turn Left</button>
   <button disabled={disabled||!calibrated} onClick={()=>void controller.start({kind:'turn',direction:'right',amount:angle},speed)}>Turn Right</button></div>
  <div><button disabled={disabled||!recording.origin||!recording.segments.length} onClick={()=>void controller.returnToBase(recording,speed)}>Return to Base</button>
   <small>Path: {recording.segments.length} segments</small></div>
  {!calibrated&&<small>Turn calibration required</small>}
  <small role="status">{status}</small>
 </div>;
}
