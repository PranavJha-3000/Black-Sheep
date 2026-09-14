import Terminal from './components/Terminal';
import AuthScreen from './screens/AuthScreen';
import LobbyScreen from './screens/LobbyScreen';
import AwaySummary from './components/AwaySummary';
import { useGameStore } from './store/gameStore';

function App() {
  const phase = useGameStore((s) => s.phase);
  const awaySummary = useGameStore((s) => s.awaySummary);
  if (phase === 'auth') return <AuthScreen />;
  if (phase === 'lobby') return <LobbyScreen />;
  // The away-summary takeover renders OVER the terminal when the store holds
  // a notable summary (gated server-side via isNotable). The terminal stays
  // mounted underneath so the first poll after ENTER TERMINAL is instant.
  return (
    <>
      <Terminal />
      {awaySummary ? <AwaySummary /> : null}
    </>
  );
}

export default App;