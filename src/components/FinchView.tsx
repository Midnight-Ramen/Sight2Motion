import type { MockState } from '../core/RobotAdapter';

export function FinchPhoto() {
  return <div className="finch-photo-frame"><img className="finch-photo" src={`${import.meta.env.BASE_URL}finch-2.png`} alt="Finch Robot 2.0 with a white shell, turquoise front, and two distance sensors" /></div>;
}

export function FinchView({ state }: { state: MockState }) {
  return <div className="finch-photo-simulator">
    <FinchPhoto />
    <div className="finch-simulation-label">Finch 2 <span>SIMULATOR</span></div>
    <div className="finch-output-row">
      <span>Beak <svg width="18" height="18" role="img" aria-label={`Beak color ${state.beak}`}><circle data-testid="finch-beak" cx="9" cy="9" r="7" fill={state.beak} stroke="#8b9d86" /></svg></span>
      <span>Tail {state.tails.map((color,i)=><svg key={i} width="14" height="14" role="img" aria-label={`Tail light ${i+1}: ${color}`}><circle cx="7" cy="7" r="5" fill={color} stroke="#8b9d86" /></svg>)}</span>
    </div>
    <div className="finch-output-row" aria-label="Simulated wheel movement">
      <span><i className={state.left?'finch-wheel-indicator moving':'finch-wheel-indicator'}/> Left {state.left}%</span>
      <span><i className={state.right?'finch-wheel-indicator moving':'finch-wheel-indicator'}/> Right {state.right}%</span>
    </div>
    {state.sound&&<div className="finch-note" role="status">♪ {state.sound}</div>}
  </div>;
}
