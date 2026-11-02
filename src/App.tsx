import Terminal from './components/Terminal';
import AuthScreen from './screens/AuthScreen';
import LobbyScreen from './screens/LobbyScreen';
import { useGameStore } from './store/gameStore';

function App() {
  const phase = useGameStore((s) => s.phase);
  if (phase === 'auth') return <AuthScreen />;
  if (phase === 'lobby') return <LobbyScreen />;
  return <Terminal />;
}

export default App;
