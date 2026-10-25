import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken } from '../lib/api';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const EMPTY_STATS = {
  owned_projects: 0,
  collaborating_projects: 0,
  unread_notifications: 0,
  total_pledged: 0,
};

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [interests, setInterests] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [categories, setCategories] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message, type = 'info') => {
      if (!message) return;
      const id = `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((list) => [...list.slice(-3), { id, message, type }]);
      const timer = setTimeout(() => dismissToast(id), 4500);
      timers.current.set(id, timer);
    },
    [dismissToast],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const clearSession = useCallback(() => {
    setToken(null);
    setCurrentUser(null);
    setInterests([]);
    setStats(EMPTY_STATS);
    setNotifications([]);
  }, []);

  const refreshCategories = useCallback(async () => {
    try {
      const data = await api.get('/categories', { auth: false });
      setCategories(data?.items || []);
    } catch {
      setCategories([]);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    if (!getToken()) {
      setCurrentUser(null);
      return null;
    }
    try {
      const data = await api.get('/auth/me');
      setCurrentUser(data.user);
      setInterests(data.interests || []);
      setStats(data.stats || EMPTY_STATS);
      return data;
    } catch (err) {
      // Token cũ / đã bị vô hiệu hoá sau khi đặt lại mật khẩu
      if (err.status === 401 || err.status === 403) clearSession();
      throw err;
    }
  }, [clearSession]);

  const refreshNotifications = useCallback(async () => {
    if (!getToken()) {
      setNotifications([]);
      return;
    }
    setNotificationsLoading(true);
    try {
      const data = await api.get('/me/notifications');
      setNotifications(data?.items || []);
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    } finally {
      setNotificationsLoading(false);
    }
  }, [toast]);

  const applyAuth = useCallback(
    async (data) => {
      setToken(data.token);
      setCurrentUser(data.user);
      await Promise.allSettled([refreshSession(), refreshNotifications()]);
      return data.user;
    },
    [refreshNotifications, refreshSession],
  );

  const login = useCallback(
    async (email, password) => {
      const data = await api.post('/auth/login', { email: String(email).trim(), password }, { auth: false });
      return applyAuth(data);
    },
    [applyAuth],
  );

  const register = useCallback(async ({ full_name, email, password }) => {
    return api.post(
      '/auth/register',
      { full_name: String(full_name).trim(), email: String(email).trim(), password },
      { auth: false },
    );
  }, []);

  const forgotPassword = useCallback(
    async (email) => api.post('/auth/forgot-password', { email: String(email).trim() }, { auth: false }),
    [],
  );

  const resetPassword = useCallback(
    async ({ email, token, password }) =>
      api.post(
        '/auth/reset-password',
        { email: email ? String(email).trim() : undefined, token: String(token).trim(), password },
        { auth: false },
      ),
    [],
  );

  const verifyEmail = useCallback(
    async (token) => api.post('/auth/verify-email', { token }, { auth: false }),
    [],
  );

  const resendVerification = useCallback(
    async (email) => api.post('/auth/resend-verification', { email: String(email).trim() }, { auth: false }),
    [],
  );

  const logout = useCallback(async () => {
    // JWT stateless: chỉ cần xoá token ở client. API /auth/logout vẫn tồn tại cho đủ hợp đồng.
    clearSession();
  }, [clearSession]);

  const updateCurrentUser = useCallback((patch) => {
    setCurrentUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  const saveInterests = useCallback(
    async (categoryIds) => {
      const data = await api.put('/me/interests', { category_ids: categoryIds });
      setInterests(data?.interests || []);
      return data?.interests || [];
    },
    [],
  );

  const markNotificationRead = useCallback(async (id) => {
    await api.patch(`/me/notifications/${id}/read`);
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    await api.patch('/me/notifications/read-all');
    setNotifications((list) => list.map((n) => ({ ...n, is_read: true })));
  }, []);

  const removeNotification = useCallback(async (id) => {
    await api.del(`/me/notifications/${id}`);
    setNotifications((list) => list.filter((n) => n.id !== id));
  }, []);

  const clearNotifications = useCallback(async () => {
    await api.del('/me/notifications');
    setNotifications([]);
  }, []);

  // Khôi phục phiên + danh mục công khai khi mở ứng dụng
  useEffect(() => {
    let alive = true;
    (async () => {
      await refreshCategories();
      if (getToken()) {
        try {
          await Promise.allSettled([refreshSession(), refreshNotifications()]);
        } finally {
          if (alive) setBooting(false);
        }
      } else if (alive) {
        setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Token hết hạn ở bất kỳ API nào -> đăng xuất và thông báo
  useEffect(() => {
    const onUnauthorized = () => {
      if (getToken()) {
        clearSession();
        toast('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.', 'warning');
      }
    };
    window.addEventListener('gq:unauthorized', onUnauthorized);
    return () => window.removeEventListener('gq:unauthorized', onUnauthorized);
  }, [clearSession, toast]);

  const unread = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications]);
  const role = currentUser?.role || 'guest';

  const value = useMemo(
    () => ({
      currentUser,
      role,
      interests,
      stats,
      categories,
      notifications,
      notificationsLoading,
      unread,
      booting,
      toasts,
      toast,
      dismissToast,
      login,
      register,
      forgotPassword,
      resetPassword,
      verifyEmail,
      resendVerification,
      logout,
      refreshSession,
      refreshNotifications,
      refreshCategories,
      updateCurrentUser,
      saveInterests,
      markNotificationRead,
      markAllNotificationsRead,
      removeNotification,
      clearNotifications,
    }),
    [
      currentUser,
      role,
      interests,
      stats,
      categories,
      notifications,
      notificationsLoading,
      unread,
      booting,
      toasts,
      toast,
      dismissToast,
      login,
      register,
      forgotPassword,
      resetPassword,
      verifyEmail,
      resendVerification,
      logout,
      refreshSession,
      refreshNotifications,
      refreshCategories,
      updateCurrentUser,
      saveInterests,
      markNotificationRead,
      markAllNotificationsRead,
      removeNotification,
      clearNotifications,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
