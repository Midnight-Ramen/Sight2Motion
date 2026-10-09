import {VisionRoadSigns} from './VisionRoadSigns';
import type {RoadSignVision} from '../core/RoadSigns';
import type { SensorProvider } from '../core/SensorProvider';
import { NumericSlider } from './NumericSlider';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { FinchNavigation, freshDistance, freshLines, lineDirection, type LineEventMode, type DriveUntilCondition } from '../core/FinchNavigation';
import { FINCH_EFFECTIVE_TRACK_WIDTH_CM } from '../core/FinchGeometry';
import { EncoderRecording, encoderPair } from '../core/EncoderRecording';
import type { ActionEngine } from '../core/ActionEngine';
import type { RobotAdapter } from '../core/RobotAdapter';
import type { SensorState } from '../core/Sensors';
export function NavigationControls({ engine, robot, roadVision, lineSensorProvider, sensors, enabled, speed, stopRevision, cancelRef, recording, onActiveChange }: {
 roadVision?:RoadSignVision;
 lineSensorProvider?: SensorProvider;
 recording: EncoderRecording; onActiveChange: (active:boolean)=>void;
 engine: ActionEngine; robot: RobotAdapter; sensors: SensorState; enabled: boolean; speed: number; stopRevision: number;
 cancelRef: MutableRefObject<(() => void) | null>;
}) {
 const [behaviors,setBehaviors]=useState<string[]>([]);
 const [adding,setAdding]=useState(false);
 const hideBehavior=(name:string)=>setBehaviors(items=>items.filter(item=>item!==name));
 const [distance,setDistance]=useState(30),[angle,setAngle]=useState(90),[status,setStatus]=useState('');
 const [untilOperator,setUntilOperator]=useState<DriveUntilCondition['operator']>('lessThan');
 const [untilValue,setUntilValue]=useState(20),[untilSpeed,setUntilSpeed]=useState(30);
 const [emergencyEnabled,setEmergencyEnabled]=useState(false),[emergencyDistance,setEmergencyDistance]=useState(10);
 const [keepTarget,setKeepTarget]=useState(25),[keepTolerance,setKeepTolerance]=useState(3),[keepSpeed,setKeepSpeed]=useState(30);
 const [lineEvent,setLineEvent]=useState<LineEventMode>('stop');
 const [lineSpeed,setLineSpeed]=useState(20);
 const latest=useRef({sensors,enabled});latest.current={sensors,enabled};
 const [controller]=useState(()=>new FinchNavigation(engine,robot,()=>latest.current.sensors,()=>latest.current.enabled&&!document.hidden,setStatus));
 useEffect(()=>{onActiveChange(controller.active);},[status,controller,onActiveChange]);
 useEffect(()=>{controller.sensorsUpdated();},[sensors,controller]);
 useEffect(()=>{
  lineSensorProvider?.setPriority(controller.lineSensorIds,async state=>{latest.current.sensors=state;await controller.sensorsUpdated(true);});
  return()=>lineSensorProvider?.setPriority([]);
 },[status,controller,lineSensorProvider]);
 const lineValues=freshLines(sensors,performance.now());
 const lineLabel=lineValues?lineDirection(...lineValues):'No data';
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
  <h3>Navigation</h3>
  <div><label>Drive distance <input aria-label="Drive distance cm" type="number" min={1} max={200} value={distance} onChange={e=>setDistance(+e.target.value)} /> cm</label>
   <button disabled={disabled||emergencyInvalid} onClick={()=>void controller.start({kind:'distance',direction:'forward',amount:distance},speed,emergency)}>Forward</button>
   <button disabled={disabled} onClick={()=>void controller.start({kind:'distance',direction:'backward',amount:distance},speed)}>Backward</button></div>
  <div><label>Turn <input aria-label="Turn angle degrees" type="number" min={1} max={360} value={angle} onChange={e=>setAngle(+e.target.value)} /> °</label>
   <button disabled={disabled||!calibrated} onClick={()=>void controller.start({kind:'turn',direction:'left',amount:angle},speed)}>Turn Left</button>
   <button disabled={disabled||!calibrated} onClick={()=>void controller.start({kind:'turn',direction:'right',amount:angle},speed)}>Turn Right</button></div>
  <div><button disabled={disabled||!recording.origin||!recording.segments.length} onClick={()=>void controller.returnToBase(recording,speed)}>Return to Base</button>
   <small>Path: {recording.segments.length} segments</small></div>
  {!calibrated&&<small>Turn calibration required</small>}
  <div><label><input type="checkbox" checked={emergencyEnabled} disabled={controller.active} onChange={e=>setEmergencyEnabled(e.target.checked)} /> Emergency braking</label>
   <input aria-label="Emergency stop distance cm" type="number" min={0} value={emergencyDistance} disabled={controller.active||!emergencyEnabled} onChange={e=>setEmergencyDistance(+e.target.value)} /> cm</div>
  <div className="behavior-heading"><h3>Assists &amp; Autonomy</h3><button aria-expanded={adding} onClick={()=>setAdding(!adding)}>+ Add behavior</button></div>
  {adding&&<div className="behavior-picker"><label>Add behavior<select aria-label="Add behavior" value="" onChange={e=>{if(e.target.value)setBehaviors(items=>[...items,e.target.value]);setAdding(false);}}>
   <option value="">Choose a behavior…</option>
   <optgroup label="Distance"><option disabled={behaviors.includes('Drive Until')}>Drive Until</option><option disabled={behaviors.includes('Keep Distance')}>Keep Distance</option></optgroup>
   <optgroup label="Line"><option disabled={behaviors.includes('Line Follow')}>Line Follow</option></optgroup>
   <optgroup label="Vision"><option disabled={behaviors.includes('Vision Road Signs')}>Vision Road Signs</option></optgroup>
  </select></label></div>}
  {behaviors.includes('Drive Until')&&<div className="behavior-card" aria-label="Drive Until controls"><header><strong>Drive Until</strong><button aria-label="Hide Drive Until" title="Hide controls only" onClick={()=>hideBehavior('Drive Until')}>×</button></header><span>Distance sensor</span>
   <select aria-label="Drive Until operator" value={untilOperator} onChange={e=>setUntilOperator(e.target.value as DriveUntilCondition['operator'])}>
    <option value="lessThan">&lt;</option><option value="lessThanOrEqual">≤</option><option value="greaterThan">&gt;</option><option value="greaterThanOrEqual">≥</option>
   </select><input aria-label="Drive Until distance cm" type="number" min={0} value={untilValue} onChange={e=>setUntilValue(+e.target.value)} /> cm
   <label>Speed %<NumericSlider aria-label="Drive Until speed" min={1} max={100} step={1} value={untilSpeed} onChange={e=>setUntilSpeed(+e.target.value)} /></label>
   <button disabled={!enabled||controller.active||!encoderPair(sensors,performance.now())||!distanceFresh||emergencyInvalid||!Number.isFinite(untilValue)||untilValue<0||untilSpeed<=0||untilSpeed>100}
    onClick={()=>void controller.driveUntil({operator:untilOperator,value:untilValue},untilSpeed,emergency)}>Start Drive Until</button>
  </div>}
  {behaviors.includes('Keep Distance')&&<div className="behavior-card" aria-label="Keep Distance controls"><header><strong>Keep Distance</strong><button aria-label="Hide Keep Distance" title="Hide controls only" onClick={()=>hideBehavior('Keep Distance')}>×</button></header>
   <label>Target <input aria-label="Keep Distance target cm" type="number" min={1} value={keepTarget} onChange={e=>setKeepTarget(+e.target.value)} /> cm</label>
   <label>Tolerance ±<input aria-label="Keep Distance tolerance cm" type="number" min={0} step={.5} value={keepTolerance} onChange={e=>setKeepTolerance(+e.target.value)} /> cm</label>
   <label>Speed %<NumericSlider aria-label="Keep Distance speed" min={1} max={100} step={1} value={keepSpeed} onChange={e=>setKeepSpeed(+e.target.value)} /></label>
   <button disabled={!enabled||controller.active||!encoderPair(sensors,performance.now())||!distanceFresh||
    !Number.isFinite(keepTarget)||keepTarget<=0||!Number.isFinite(keepTolerance)||keepTolerance<0||keepTolerance>=keepTarget||!Number.isFinite(keepSpeed)||keepSpeed<=0||keepSpeed>100}
    onClick={()=>void controller.keepDistance(keepTarget,keepTolerance,keepSpeed)}>Start Keep Distance</button>
  </div>}
  {behaviors.includes('Line Follow')&&<div className="behavior-card" aria-label="Line Follow controls"><header><strong>Line Follow</strong><button aria-label="Hide Line Follow" title="Hide controls only" onClick={()=>hideBehavior('Line Follow')}>×</button></header>
   <label>Speed %<NumericSlider aria-label="Line Follow speed" min={1} max={100} value={lineSpeed} onChange={e=>setLineSpeed(+e.target.value)} /></label>
   <label>When both sensors see black<select aria-label="Line marker action" value={lineEvent} disabled={controller.active} onChange={e=>setLineEvent(e.target.value as LineEventMode)}>
    <option value="stop">Stop</option><option value="continue">Continue</option><option value="left">Turn Left</option><option value="right">Turn Right</option>
   </select></label>
   <button disabled={!enabled||controller.active||!freshLines(sensors,performance.now())}
    onClick={()=>void controller.lineFollow(lineSpeed,lineEvent,true)}>Start Line Follow</button>
   <small aria-label="Line Follow readings">L: {lineValues?.[0]??'—'} R: {lineValues?.[1]??'—'} · {lineValues?`pair age: ${Math.max(0,Math.round(performance.now()-Math.min(sensors.finchLineLeft.updatedAt,sensors.finchLineRight.updatedAt)))} ms · `:''}{lineLabel}</small>
  </div>}
  {behaviors.includes('Vision Road Signs')&&roadVision&&<VisionRoadSigns motionActive={controller.active} vision={roadVision} available={enabled} resetKey={`${stopRevision}:${controller.stopRevision}`} onCancelHold={()=>controller.cancelVisionHold()} onAction={action=>controller.roadSign(action,speed)} onHide={()=>hideBehavior('Vision Road Signs')}/>}
  {!distanceFresh&&(emergencyEnabled||behaviors.includes('Drive Until'))&&<small>Fresh distance sensor data is required for Drive Until and emergency braking.</small>}
  <small role="status">{status}</small>
 </div>;
}
