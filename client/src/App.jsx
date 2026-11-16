import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Spinner from './components/Spinner';
import { useAuth } from './context/AuthContext';
import Home from './pages/Home';
import ExpeditionDetail from './pages/ExpeditionDetail';
import { ForgotPassword, Login, ResetPassword, Signup, VerifyEmail } from './pages/Auth';
import Account from './pages/Account';
import Profile from './pages/Profile';
import MyBookings from './pages/MyBookings';
import MyReviews from './pages/MyReviews';
import Favourites from './pages/Favourites';
import Manage from './pages/manage/Manage';
import ManageExpeditions from './pages/manage/ManageExpeditions';
import ManageUsers from './pages/manage/ManageUsers';
import ManageReviews from './pages/manage/ManageReviews';
import ManageBookings from './pages/manage/ManageBookings';
import NotFound from './pages/NotFound';

// Sends signed-out visitors to the login page and brings them back afterwards.
// With `role`, signed-in people without it get the not-found page: the API
// enforces the same rule, this only keeps the screens out of sight.
function RequireAuth({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <NotFound />;

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
        <Route path="verify-email/:token" element={<VerifyEmail />} />

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
          <Route path="favourites" element={<Favourites />} />
        </Route>

        <Route
          path="manage"
          element={
            <RequireAuth role="admin">
              <Manage />
            </RequireAuth>
          }
        >
          <Route index element={<ManageExpeditions />} />
          <Route path="users" element={<ManageUsers />} />
          <Route path="reviews" element={<ManageReviews />} />
          <Route path="bookings" element={<ManageBookings />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
