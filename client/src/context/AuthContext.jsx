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

  // Resolves with a challenge token when the account has two-factor on;
  // the session then starts in verifyTwoFactor.
  const login = useCallback(async (credentials) => {
    const res = await api.post('/auth/login', credentials);
    if (res.twoFactorRequired) return res.challengeToken;
    setUser(res.data);
    return null;
  }, []);

  const verifyTwoFactor = useCallback(async (proof) => {
    const res = await api.post('/auth/2fa/verify', proof);
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

  // Updates the heart straight away and puts it back if the request fails.
  const toggleFavourite = useCallback(
    async (expeditionId) => {
      const before = user.favourites || [];
      const liked = before.includes(expeditionId);
      const setFavourites = (favourites) =>
        setUser((current) => current && { ...current, favourites });

      setFavourites(
        liked ? before.filter((id) => id !== expeditionId) : [...before, expeditionId],
      );

      try {
        const path = `/users/me/favourites/${expeditionId}`;
        const res = await (liked ? api.delete(path) : api.put(path));
        setFavourites(res.data);
      } catch (err) {
        setFavourites(before);
        throw err;
      }
    },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      loading: user === undefined,
      setUser,
      login,
      verifyTwoFactor,
      signup,
      logout,
      toggleFavourite,
    }),
    [user, login, verifyTwoFactor, signup, logout, toggleFavourite],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
