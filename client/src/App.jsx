import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Spinner from './components/Spinner';
import { useAuth } from './context/AuthContext';
import Home from './pages/Home';
import ExpeditionDetail from './pages/ExpeditionDetail';
import { ForgotPassword, Login, ResetPassword, Signup } from './pages/Auth';
import Account from './pages/Account';
import Profile from './pages/Profile';
import MyBookings from './pages/MyBookings';
import MyReviews from './pages/MyReviews';
import NotFound from './pages/NotFound';

// Sends signed-out visitors to the login page and brings them back afterwards.
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="expeditions/:slug" element={<ExpeditionDetail />} />

        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password/:token" element={<ResetPassword />} />

        <Route
          path="account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        >
          <Route index element={<Profile />} />
          <Route path="bookings" element={<MyBookings />} />
          <Route path="reviews" element={<MyReviews />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
