import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { NotificationContainer } from './NotificationComponents';
import {
  Home,
  Users,
  BookOpen,
  MapPin,
  Calendar,
  Settings,
  LogOut,
  Music,
  ChevronDown,
  User,
  BarChart3,
  ClipboardList,
  Award,
  FlaskConical,
  Upload,
  UserPlus,
  CalendarPlus,
  Download,
  GraduationCap,
  Database,
  FolderOpen,
  ChevronRight,
  DatabaseBackup,
  Zap,
  Lightbulb,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { STORAGE_KEYS, courseService } from '../services';
import websocketService from '../services/websocketService';

export default function Layout() {
  const { user, teacher, signOut } = useAuth();
  usePageTitle();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);

  // 判断是否为管理员
  const isAdmin = user?.faculty_id === 'ADMIN' || user?.is_admin === true || user?.role === 'admin' || user?.teacher_id === '110' || user?.email === 'admin@music.edu.cn';

  // 检查教师是否有专业大课
  const [hasMajorCourses, setHasMajorCourses] = useState(false);
  // 检查教师是否有专业小课
  const [hasIndividualCourses, setHasIndividualCourses] = useState(false);

  // WebSocket连接状态
  const [wsConnected, setWsConnected] = useState(false);

  // 初始化WebSocket连接
  useEffect(() => {
    const initWebSocket = async () => {
      try {
        const connected = await websocketService.connect();
        setWsConnected(connected);
        
        // 监听课程更新
        websocketService.on('courses_updated', (data) => {
          console.log('Courses updated via WebSocket:', data.scheduledCourses.length, 'courses');
          // 可以在这里添加UI更新逻辑，比如显示通知
        });
        
        websocketService.on('blocked_slots_updated', (data) => {
          console.log('Blocked slots updated via WebSocket:', data.length, 'slots');
        });
      } catch (error) {
        console.error('WebSocket initialization failed:', error);
      }
    };

    initWebSocket();

    // 清理函数
    return () => {
      websocketService.disconnect();
    };
  }, []);

  useEffect(() => {
    const checkTeacherCourses = async () => {
      if (!teacher?.id && !user?.teacher_id) {
        setHasMajorCourses(false);
        setHasIndividualCourses(false);
        return;
      }

      // 支持多种ID格式：内部ID、工号、姓名
      const teacherId = teacher?.id || user?.teacher_id;
      const teacherWorkId = teacher?.teacher_id || user?.work_id || user?.teacher_id;
      const teacherName = teacher?.name || user?.full_name;

      try {
        // 使用courseService获取课程数据（支持数据库和本地存储模式）
        const courses = await courseService.getAll();

        // 检查是否有专业大课
        const teacherMajorCourses = courses.filter((course: any) => {
          const isMajorCourse = course.teaching_type === '专业大课' || course.teaching_type === '大课';
          // 支持多种匹配方式：内部ID、工号、姓名
          const isTeacherCourse =
            course.teacher_id === teacherId ||
            course.teacher_id === teacherWorkId ||
            course.teacher_name === teacherName;
          return isMajorCourse && isTeacherCourse;
        });
        setHasMajorCourses(teacherMajorCourses.length > 0);

        // 检查是否有专业小课（小组课）
        const teacherIndividualCourses = courses.filter((course: any) => {
          const isIndividualCourse = course.teaching_type === '小组课' || course.teaching_type === '专业小课';
          // 支持多种匹配方式：内部ID、工号、姓名
          const isTeacherCourse =
            course.teacher_id === teacherId ||
            course.teacher_id === teacherWorkId ||
            course.teacher_name === teacherName;
          return isIndividualCourse && isTeacherCourse;
        });
        setHasIndividualCourses(teacherIndividualCourses.length > 0);
      } catch (error) {
        console.error('检查教师课程失败:', error);
        setHasMajorCourses(false);
        setHasIndividualCourses(false);
      }
    };

    checkTeacherCourses();
  }, [teacher, user]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    setShowDropdown(false);
  };

  // 教师可见的核心功能菜单
  const teacherMenuItems = [
    { path: '/', icon: Home, label: '数据统计' },
    { path: '/teaching-calendar', icon: Calendar, label: '教学日历' },
    // 专业小课：教师有专业小课或者是管理员才显示
    ...(hasIndividualCourses || isAdmin
      ? [{ path: '/arrange-class', icon: CalendarPlus, label: '专业小课' }]
      : []),
    // 专业大课：教师有专业大课或者是管理员才显示
    ...(hasMajorCourses || isAdmin
      ? [{ path: '/major-class-schedule', icon: Music, label: '专业大课' }]
      : []),
    // 通适大课：仅管理员可见
    ...(isAdmin ? [{ path: '/large-class', icon: BookOpen, label: '通适大课' }] : []),
  ];

  // 管理员专用菜单 - 基础信息管理
  const adminResourceMenuItems = [
    { path: '/teachers', icon: Users, label: '教师管理' },
    { path: '/students', icon: Users, label: '学生管理' },
    { path: '/courses', icon: BookOpen, label: '课程管理' },
    { path: '/rooms', icon: MapPin, label: '教室管理' },
  ];

  // 管理员专用菜单 - 分配管理
  const adminAssignmentMenuItems = [
    { path: '/teacher-student-stats', icon: Users, label: '教师分配' },
    { path: '/smart-student-assignment', icon: Zap, label: '学生分配' },
  ];

  // 管理员专用菜单 - 统计与视图
  const adminStatsMenuItems = [
    { path: '/course-schedule-stats', icon: BarChart3, label: '排课统计' },
    { path: '/faculty-schedule', icon: ClipboardList, label: '排课视图' },
    { path: '/workload', icon: Award, label: '课时统计' },
  ];

  // 管理员专用菜单 - 系统工具
  const adminToolsMenuItems = [
    { path: '/week-config', icon: Calendar, label: '周次配置' },
    { path: '/backup', icon: Database, label: '数据备份' },
    { path: '/operation-logs', icon: ClipboardList, label: '操作日志' },
  ];

  // 测试菜单
  const testMenuItems = [
    { path: '/test-dashboard', icon: FlaskConical, label: '测试仪表板' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-white border-r border-gray-200 fixed h-full flex flex-col">
        <div className="p-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <Music className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">音乐系管理系统</h1>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto pb-4">
          {/* 教师核心功能菜单（所有用户可见） */}
          {teacherMenuItems.map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${isActive ? 'bg-purple-100 text-purple-700 font-medium' : 'text-gray-600 hover:bg-purple-50 hover:text-purple-700'}`} end={item.path === '/'}>
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          ))}

          {/* 管理员专用菜单 - 仅管理员可见 */}
          {isAdmin && (
            <>
              {/* 基础信息管理 */}
              <div className="pt-6 pb-2">
                <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">基础信息管理</p>
              </div>
              {adminResourceMenuItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${isActive
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                    }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              ))}

              {/* 分配管理 */}
              <div className="pt-6 pb-2">
                <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">分配管理</p>
              </div>
              {adminAssignmentMenuItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${isActive
                      ? 'bg-purple-100 text-purple-700 font-medium'
                      : 'text-gray-600 hover:bg-purple-50 hover:text-purple-700'
                    }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              ))}

              {/* 统计与视图 */}
              <div className="pt-6 pb-2">
                <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">统计与视图</p>
              </div>
              {adminStatsMenuItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${isActive
                      ? 'bg-green-100 text-green-700 font-medium'
                      : 'text-gray-600 hover:bg-green-50 hover:text-green-700'
                    }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              ))}

              {/* 系统工具 */}
              <div className="pt-6 pb-2">
                <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">系统工具</p>
              </div>
              {adminToolsMenuItems.map((item) => (
                <NavLink key={item.path} to={item.path} className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${isActive ? 'bg-orange-100 text-orange-700 font-medium' : 'text-gray-600 hover:bg-orange-50 hover:text-orange-700'}`}>
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}

          {/* 测试菜单 - 只对管理员显示 */}
          {isAdmin && (
            <>
              <div className="pt-6 pb-2">
                <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">开发测试</p>
              </div>
              {testMenuItems.map((item) => (
                <NavLink key={item.path} to={item.path} className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${isActive ? 'bg-red-100 text-red-700 font-medium' : 'text-gray-600 hover:bg-red-50 hover:text-red-700'}`}>
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white">
          <div className="relative">
            <button onClick={() => setShowDropdown(!showDropdown)} className="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-purple-600" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.full_name || teacher?.name || '教师'}</p>
                <p className="text-xs text-gray-500 truncate">{isAdmin ? '管理员' : teacher?.faculty_name || '教师'}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
            {showDropdown && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 py-2">
                <button onClick={() => handleNavigate('/profile')} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  <User className="w-4 h-4" />
                  个人设置
                </button>
                <button onClick={handleSignOut} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <main className="flex-1 ml-64 p-8">
        <Outlet />
      </main>

      {/* 全局通知容器 */}
      <NotificationContainer />
    </div>
  );
}
