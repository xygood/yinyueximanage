import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const PAGE_TITLES: Record<string, string> = {
  '/': '控制台 - 音乐系管理系统',
  '/admin-dashboard': '控制台 - 音乐系管理系统',
  '/students': '学生管理 - 音乐系管理系统',
  '/classes': '班级管理 - 音乐系管理系统',
  '/courses': '课程管理 - 音乐系管理系统',
  '/rooms': '教室管理 - 音乐系管理系统',
  '/auto-schedule': '自动排课 - 音乐系管理系统',
  '/profile': '个人中心 - 音乐系管理系统',
  '/faculty-schedule': '我的课表 - 音乐系管理系统',
  '/teachers': '教师管理 - 音乐系管理系统',
  '/student-import': '学生导入 - 音乐系管理系统',
  '/smart-student-assignment': '学生分配 - 音乐系管理系统',
  '/teacher-student-stats': '教师分配 - 音乐系管理系统',
  '/arrange-class': '专业小课 - 音乐系管理系统',
  '/workload': '工作量统计 - 音乐系管理系统',
  '/course-schedule-stats': '排课统计 - 音乐系管理系统',
  '/backup': '数据备份 - 音乐系管理系统',
  '/week-config': '周次配置 - 音乐系管理系统',
  '/test-dashboard': '测试面板 - 音乐系管理系统',
  '/course-assignment-test': '课程分配测试 - 音乐系管理系统',
  '/major-class-schedule': '专业大课 - 音乐系管理系统',
  '/large-class': '通适大课 - 音乐系管理系统',
  '/operation-logs': '操作日志 - 音乐系管理系统',
  '/teacher-schedule-conflicts': '教师时间冲突检查 - 音乐系管理系统',
  '/login': '登录 - 音乐系管理系统',
};

export function usePageTitle() {
  const location = useLocation();
  
  useEffect(() => {
    const title = PAGE_TITLES[location.pathname] || '音乐系管理系统';
    document.title = title;
  }, [location.pathname]);
}
