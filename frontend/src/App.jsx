import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/ui';
import { RequireRole } from './components/RequireAuth';
import Home from './pages/Home';
import Explore from './pages/Explore';
import ProjectDetail from './pages/ProjectDetail';
import Checkout from './pages/Checkout';
import { Auth, Onboarding } from './pages/Auth';
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/PasswordReset';
import Profile from './pages/Profile';
import CreateProject from './pages/CreateProject';
import { MyProjects, ManageProject } from './pages/Owner';
import { Admin } from './pages/Admin';
import Notifications from './pages/Notifications';
import Forbidden from './pages/Forbidden';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function AdminWrapper() {
  const { tab } = useParams();
  return <Admin tab={tab} />;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Layout>
          <Routes>
            {/* Công khai */}
            <Route path="/" element={<Home />} />
            <Route path="/kham-pha" element={<Explore />} />
            <Route path="/du-an/:id" element={<ProjectDetail />} />
            <Route path="/dang-nhap" element={<Auth />} />
            <Route path="/quen-mat-khau" element={<ForgotPassword />} />
            <Route path="/dat-lai-mat-khau" element={<ResetPassword />} />
            <Route path="/xac-thuc-email" element={<VerifyEmail />} />
            <Route path="/403" element={<Forbidden />} />

            {/* Cần đăng nhập */}
            <Route
              path="/tai-tro/:id"
              element={
                <RequireRole allow={['backer', 'owner']}>
                  <Checkout />
                </RequireRole>
              }
            />
            <Route
              path="/chon-so-thich"
              element={
                <RequireRole allow={['backer', 'owner']}>
                  <Onboarding />
                </RequireRole>
              }
            />
            <Route
              path="/ca-nhan"
              element={
                <RequireRole allow={['backer', 'owner', 'admin']}>
                  <Profile />
                </RequireRole>
              }
            />
            <Route
              path="/thong-bao"
              element={
                <RequireRole allow={['backer', 'owner', 'admin']}>
                  <Notifications />
                </RequireRole>
              }
            />

            {/* Tạo dự án: cần KYC; backer sẽ được nâng thành owner sau dự án đầu tiên */}
            <Route
              path="/tao-du-an"
              element={
                <RequireRole allow={['backer', 'owner']} needKyc>
                  <CreateProject />
                </RequireRole>
              }
            />
            <Route
              path="/du-an-cua-toi"
              element={
                <RequireRole allow={['backer', 'owner']}>
                  <MyProjects />
                </RequireRole>
              }
            />
            <Route
              path="/quan-ly/:id"
              element={
                <RequireRole allow={['backer', 'owner']}>
                  <ManageProject />
                </RequireRole>
              }
            />

            {/* Quản trị */}
            <Route
              path="/admin"
              element={
                <RequireRole allow={['admin']}>
                  <Navigate to="/admin/tong-quan" replace />
                </RequireRole>
              }
            />
            <Route
              path="/admin/:tab"
              element={
                <RequireRole allow={['admin']}>
                  <AdminWrapper />
                </RequireRole>
              }
            />

            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AppProvider>
  );
}
