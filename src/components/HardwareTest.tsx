import { FinchPhoto } from './FinchView';
import type { FinchStatus } from '../core/FinchAdapter';
export function HardwareTest({
  status,
  busy,
  onAttach,
  onDisconnect,
  onBeak,
  onWheels,
  onStop,
}: {
  status: FinchStatus;
  busy: boolean;
  onAttach: () => void;
  onDisconnect: () => void;
  onBeak: (color: string) => void;
  onWheels: () => void;
  onStop: () => void;
}) {
  const connected = status.connection === 'connected';
  return (
    <div className="hardware-test"><FinchPhoto />
      <h3>Hardware test · Finch A</h3>
      <dl>
        <div>
          <dt>BlueBird Connector</dt>
          <dd>{status.connector === 'detected' ? 'Detected' : 'Not detected'}</dd>
        </div>
        <div>
          <dt>Finch</dt>
          <dd>
            {connected
              ? 'Connected'
              : status.connection === 'connecting'
                ? 'Connecting…'
                : 'Disconnected'}
          </dd>
        </div>
      </dl>
      <p role="status">{status.message}</p>
      <button disabled={busy} onClick={connected ? onDisconnect : onAttach}>
        {status.connection === 'connecting'
          ? 'Checking…'
          : connected
            ? 'Disconnect from app'
            : 'Attach to Finch A'}
      </button>
      <div className="hardware-test-buttons">
        <button disabled={!connected || busy} onClick={() => onBeak('#00ff00')}>
          GREEN BEAK
        </button>
        <button disabled={!connected || busy} onClick={() => onBeak('#ff0000')}>
          RED BEAK
        </button>
        <button disabled={!connected || busy} onClick={onWheels}>
          WHEELS 10% · 1 sec
        </button>
        <button className="stop-button" onClick={onStop}>
          STOP
        </button>
      </div>
      <p>
        Connect Finch as A in BlueBird first. Place it on a clear floor for the wheel test. Movement
        is limited to 20% and 1 second during validation.
      </p>
      <p>
        HTTP responses confirm a request, not physical motion. Observe the Finch. If communication
        fails while moving, use its power button.
      </p>
    </div>
  );
}

