// What the window says about the engine behind it (D43), and the button that puts the command on your machine.
import type { EngineStatus } from '../../shared/api';

/** A note under the top bar when the engine stopped, runs an older build, or is waiting to restart. Nothing when all is well. */
export function EngineBanner({ engine, onStart, onRestartWhenIdle }: { engine: EngineStatus; onStart: () => void; onRestartWhenIdle: () => void }) {
  if (engine.state === 'stopped') {
    return (
      <div className="engine-banner frame" role="status">
        <span>Engine stopped. Runs are paused until it starts again.</span>
        <button className="btn primary" onClick={onStart}>Start</button>
      </div>
    );
  }
  if (engine.state === 'older') {
    const what = engine.version === engine.appVersion ? 'The engine runs an earlier build than the app.' : `The engine is older than the app (${engine.version} and ${engine.appVersion}).`;
    return (
      <div className="engine-banner frame" role="status">
        <span>{what} It keeps your runs going until you restart it.</span>
        <button className="btn" onClick={onRestartWhenIdle}>Restart when idle</button>
      </div>
    );
  }
  if (engine.state === 'restarting') {
    return <div className="engine-banner frame" role="status"><span>The engine restarts once nothing is running. No new work starts until then.</span></div>;
  }
  return null;
}

/** Offered while the `roboratory` command is not installed for this build. */
export function InstallCliButton({ state, onInstall }: { state: 'installed' | 'outdated' | 'missing'; onInstall: () => void }) {
  if (state === 'installed') return null;
  return (
    <button className="pill" onClick={onInstall} title="Put the roboratory command on your machine, to drive this factory from a terminal">
      {state === 'outdated' ? 'Update CLI' : 'Install CLI'}
    </button>
  );
}
