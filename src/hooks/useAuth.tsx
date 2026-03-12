import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authService, operationLogService } from '../services';
import websocketService from '../services/websocketService';
import type { Teacher } from '../types';

interface OnlineTeacher {
  id: string;
  teacher_id: string;
  name: string;
  faculty_id: string;
  faculty_name: string;
  loginTime: number;
  lastActivityTime: number;
  status: 'online' | 'busy' | 'away';
}

interface LoggedInUser {
  id: string;
  teacher_id: string;
  name: string;
  faculty_id: string;
  faculty_name: string;
  loginTime: number;
}

interface AuthContextType {
  user: any;
  teacher: Teacher | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, facultyCode: string, specialty?: string[]) => Promise<void>;
  signOut: () => Promise<void>;
  refreshTeacher: (userId?: string) => Promise<void>;
  updateProfile: (updates: Partial<{ fullName: string; facultyCode: string; specialty: string[] }>) => Promise<void>;
  // 新增：在线教师和多用户功能
  onlineTeachers: OnlineTeacher[];
  loggedInUsers: LoggedInUser[];
  switchUser: (userId: string) => Promise<void>;
  removeFromLoggedInList: (userId: string) => void;
  refreshOnlineTeachers: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlineTeachers, setOnlineTeachers] = useState<OnlineTeacher[]>([]);
  const [loggedInUsers, setLoggedInUsers] = useState<LoggedInUser[]>([]);

  // 判断是否为管理员
  const isAdmin = user?.faculty_id === 'ADMIN' || user?.is_admin === true || user?.role === 'admin' || user?.teacher_id === '110' || user?.email === 'admin@music.edu.cn';

  const refreshTeacher = async (userId?: string) => {
    const teacherId = userId || user?.teacher_id;
    if (teacherId) {
      try {
        const profile = await authService.getTeacherProfile(teacherId);
        setTeacher(profile);
      } catch (err) {
        console.error('获取教师信息失败:', err);
      }
    }
  };

  // 刷新在线教师列表：统一通过 WebSocket 向服务器请求，杜绝仅用本地缓存导致只显示自己
  const refreshOnlineTeachers = useCallback(() => {
    websocketService.getOnlineTeachers();
  }, []);

  // 刷新已登录用户列表
  const refreshLoggedInUsers = useCallback(() => {
    const users = authService.getLoggedInUsers();
    setLoggedInUsers(users);
  }, []);

  // 切换用户
  const switchUser = async (userId: string) => {
    try {
      const switchedUser = await authService.switchToUser(userId);
      if (switchedUser) {
        setUser(switchedUser);
        await refreshTeacher(switchedUser.teacher_id);
        refreshOnlineTeachers();
      }
    } catch (err) {
      console.error('切换用户失败:', err);
    }
  };

  // 从已登录列表中移除用户
  const removeFromLoggedInList = (userId: string) => {
    authService.removeUserFromLoggedInList(userId);
    refreshLoggedInUsers();
  };

  // 初始化时检查登录状态
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        if (isMounted) {
          setUser(currentUser);
          if (currentUser) {
            await refreshTeacher(currentUser.teacher_id);
            if (websocketService.getConnectionStatus()) {
              websocketService.teacherOnline({
                teacher_id: currentUser.teacher_id,
                teacher_name: currentUser.full_name,
                login_time: Date.now()
              });
            }
          }
        }
      } catch (err) {
        console.error('初始化认证失败:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  // 心跳机制：定期更新教师活动时间
  useEffect(() => {
    if (!user?.teacher_id) return;

    const heartbeatInterval = setInterval(() => {
      if (websocketService.getConnectionStatus()) {
        websocketService.teacherOnline({
          teacher_id: user.teacher_id,
          teacher_name: user.full_name,
          login_time: Date.now()
        });
      }
    }, 30000);

    return () => {
      clearInterval(heartbeatInterval);
    };
  }, [user?.teacher_id]);

  // WebSocket在线教师监听
  useEffect(() => {
    const handleOnlineTeachersUpdate = (teachers: any[]) => {
      setOnlineTeachers(teachers);
    };

    websocketService.on('online_teachers_update', handleOnlineTeachersUpdate);
    websocketService.getOnlineTeachers();

    return () => {
      websocketService.off('online_teachers_update', handleOnlineTeachersUpdate);
    };
  }, []);

  // 定期刷新在线教师列表（每30秒，缩短间隔）
  useEffect(() => {
    // 首次挂载时向服务器请求一次在线教师列表
    refreshOnlineTeachers();

    const refreshInterval = setInterval(() => {
      refreshOnlineTeachers();
    }, 30000);

    return () => {
      clearInterval(refreshInterval);
    };
  }, [refreshOnlineTeachers]);

  // 登录
  const signIn = async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const response = await authService.signIn(email, password);
      setUser(response.user);
      // 直接传递 teacher_id，避免状态更新延迟问题
      await refreshTeacher(response.user.teacher_id);
      // 记录登录日志
      await operationLogService.logLogin(response.user.teacher_id, response.user.name);
      // 强制结束加载状态
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  };

  // 注册
  const signUp = async (email: string, password: string, fullName: string, facultyCode: string, specialty?: string[]) => {
    setError(null);
    setLoading(true);
    try {
      const response = await authService.signUp(email, password, fullName, facultyCode, specialty);
      setUser(response.user);
      // 直接传递 userId，避免状态更新延迟问题
      await refreshTeacher(response.user.id);
      // 强制结束加载状态
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  };

  // 登出
  const signOut = async () => {
    setError(null);
    try {
      // 记录登出日志
      if (user?.teacher_id && user?.name) {
        await operationLogService.logLogout(user.teacher_id, user.name);
      }
      await authService.signOut();
      setUser(null);
      setTeacher(null);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  // 更新个人资料
  const updateProfile = async (updates: Partial<{ fullName: string; facultyCode: string; specialty: string[] }>) => {
    setError(null);
    try {
      if (!user) throw new Error('用户未登录');

      const updatedUser = await authService.updateProfile(user.id, {
        full_name: updates.fullName,
        faculty_code: updates.facultyCode,
        specialty: updates.specialty,
      });

      // 更新本地状态
      setUser(updatedUser);
      // 直接传递 teacher_id，避免状态更新延迟问题
      await refreshTeacher(updatedUser.teacher_id);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      teacher, 
      loading, 
      error, 
      isAdmin, 
      signIn, 
      signUp, 
      signOut, 
      refreshTeacher, 
      updateProfile,
      onlineTeachers,
      loggedInUsers,
      switchUser,
      removeFromLoggedInList,
      refreshOnlineTeachers
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth 必须在 AuthProvider 中使用');
  return context;
}
