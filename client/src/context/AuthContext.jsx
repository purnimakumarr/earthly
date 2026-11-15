import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // undefined = still checking, null = signed out
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api
      .get('/users/me')
      .then((res) => setUser(res.data))
      .catch(() => setUser(null));
  }, []);

  const login = useCallback(async (credentials) => {
    const res = await api.post('/auth/login', credentials);
    setUser(res.data);
  }, []);

  const signup = useCallback(async (details) => {
    const res = await api.post('/auth/signup', details);
    setUser(res.data);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading: user === undefined, setUser, login, signup, logout }),
    [user, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
