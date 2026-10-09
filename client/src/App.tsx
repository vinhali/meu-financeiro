import { useEffect, useState } from 'react';
import { api } from './api';
import Loader from './components/Loader';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .me()
      .then((r) => setAuthenticated(r.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return <Loader />;
  }

  if (!authenticated) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }

  return <Dashboard onLogout={() => setAuthenticated(false)} />;
}
