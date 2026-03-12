import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { NotificationProvider } from './contexts/NotificationContext';
import { BlockedTimeProvider, useBlockedTime } from './contexts/BlockedTimeContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import Students from './pages/Students';
import Classes from './pages/Classes';
import Rooms from './pages/Rooms';
import Courses from './pages/Courses';

import AutoSchedule from './pages/AutoSchedule';
import Profile from './pages/Profile';
import TestDashboard from './pages/TestDashboard';

import FacultyScheduleView from './pages/FacultyScheduleView';
import Teachers from './pages/Teachers';
import StudentImport from './pages/StudentImport';
import StudentAssignment from './pages/SmartStudentAssignment';
import TeacherStudentStats from './pages/TeacherStudentStats';
import ArrangeClass from './pages/ArrangeClass';
import CourseAssignmentTest from './pages/CourseAssignmentTest';
import TeacherWorkload from './pages/TeacherWorkload';
import Backup from './pages/Backup';
import WeekConfig from './pages/WeekConfig';
import MajorClassSchedule from './pages/MajorClassSchedule_Simple';
import CourseScheduleStats from './pages/CourseScheduleStats';
import TeachingCalendarPage from './pages/TeachingCalendar';

import LargeClass from './pages/LargeClass';
import OperationLogs from './pages/OperationLogs';
import TeacherScheduleConflicts from './pages/TeacherScheduleConflicts';

import './index.css';

// 应用初始化组件 - 仅登录后首次检查/加载禁排，不阻塞后续排课页的刷新
function AppInitializer({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { refreshBlockedTimes, isLoading } = useBlockedTime();
  const loadAttemptedRef = React.useRef(false);
  // 仅表示「登录后首次加载」期间显示全屏遮罩，避免排课页调用 refreshBlockedTimes 时整站被挡
  const [isFirstLoad, setIsFirstLoad] = React.useState(false);

  useEffect(() => {
    console.log('AppInitializer 挂载，当前用户:', user ? '已登录' : '未登录');
  }, []);

  useEffect(() => {
    const loadData = async () => {
      if (user && !loadAttemptedRef.current) {
        loadAttemptedRef.current = true;

        console.log('用户已登录，开始检查禁排数据缓存...');
        const legacyCache = localStorage.getItem('music_scheduler_imported_blocked_times');
        const newCache = localStorage.getItem('blockedTimesCache');

        let newCacheDataCount = 0;
        if (newCache) {
          try {
            const parsed = JSON.parse(newCache);
            newCacheDataCount = parsed.data?.length || 0;
          } catch (e) {
            console.log('新缓存解析失败');
          }
        }

        const hasLegacyData = legacyCache && legacyCache !== '[]' && legacyCache !== '';
        const hasNewData = newCache && newCache !== '' && newCacheDataCount > 0;

        if (!hasLegacyData || !hasNewData) {
          console.log('禁排数据缓存不完整或为空，从服务器加载...');
          setIsFirstLoad(true);
          try {
            await refreshBlockedTimes();
            console.log('禁排数据已加载完成');
          } catch (error) {
            console.error('禁排数据加载失败:', error);
          } finally {
            setIsFirstLoad(false);
          }
        } else {
          console.log('禁排数据缓存已存在，无需加载');
        }
      }
    };

    loadData();
  }, [user, refreshBlockedTimes]);

  // 仅登录后首次加载禁排时显示全屏遮罩；排课页内的 refreshBlockedTimes 不再触发整站遮罩
  if (isFirstLoad && isLoading) {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-gray-800">正在加载禁排时间数据...</span>
          </div>
          <p className="text-sm text-gray-500 mt-2">首次加载需要几秒钟，请耐心等待</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 to-indigo-900">
        <div className="text-white text-xl">加载中...</div>
      </div>
    );
  }
  return user ? <>{children}</> : <Navigate to="/login" />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 to-indigo-900">
        <div className="text-white text-xl">加载中...</div>
      </div>
    );
  }
  return user ? <Navigate to="/" /> : <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="admin-dashboard" element={<AdminDashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="classes" element={<Classes />} />
        <Route path="courses" element={<Courses />} />
        <Route path="rooms" element={<Rooms />} />

        <Route path="auto-schedule" element={<AutoSchedule />} />
        <Route path="profile" element={<Profile />} />
        {/* 教研室相关页面 */}
        <Route path="faculty-schedule" element={<FacultyScheduleView />} />
        <Route path="teachers" element={<Teachers />} />
        {/* 学生管理相关页面 */}
        <Route path="student-import" element={<StudentImport />} />
        <Route path="smart-student-assignment" element={<StudentAssignment />} />
        <Route path="teacher-student-stats" element={<TeacherStudentStats />} />
        <Route path="arrange-class" element={<ArrangeClass />} />
        {/* 工作量统计 */}
        <Route path="workload" element={<TeacherWorkload />} />
        {/* 排课统计 */}
        <Route path="course-schedule-stats" element={<CourseScheduleStats />} />
        {/* 备份管理 */}
        <Route path="backup" element={<Backup />} />
        {/* 学期周次配置 */}
        <Route path="week-config" element={<WeekConfig />} />
        {/* 教学日历 */}
        <Route path="teaching-calendar" element={<TeachingCalendarPage />} />
        {/* 测试页面 */}
        <Route path="test-dashboard" element={<TestDashboard />} />
        <Route path="course-assignment-test" element={<CourseAssignmentTest />} />
        {/* 专业大课排课页面 */}
        <Route path="major-class-schedule" element={<MajorClassSchedule />} />

        {/* 通适大课页面 */}
        <Route path="large-class" element={<LargeClass />} />
        
        {/* 操作日志页面 */}
        <Route path="operation-logs" element={<OperationLogs />} />
        {/* 教师时间冲突检查（仅管理员） */}
        <Route path="teacher-schedule-conflicts" element={<TeacherScheduleConflicts />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <BlockedTimeProvider>
            <AppInitializer>
              <AppRoutes />
            </AppInitializer>
          </BlockedTimeProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
// Force redeploy 2026年 2月19日 星期四 17时53分07秒 CST
