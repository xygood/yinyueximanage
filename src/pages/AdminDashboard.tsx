import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNotification } from '../contexts/NotificationContext';
import { useBlockedTime } from '../contexts/BlockedTimeContext';
import { EnhancedStatsPanel } from '../components/EnhancedStatsPanel';
import { DetailedInstrumentStats } from '../components/DetailedInstrumentStats';
import BlockedTimesImport from '../components/BlockedTimesImport';
import BlockedTimesList from '../components/BlockedTimesList';
import { studentService, courseService, roomService, scheduleService, classService, teacherService, studentTeacherAssignmentService } from '../services';
import { INSTRUMENT_TO_FACULTY } from '../types';
import {
  Users, BookOpen, MapPin, Calendar, TrendingUp, Clock, Music,
  Settings, BarChart, GraduationCap, BarChart3,
  Plus, Zap, AlertCircle, CheckCircle, Activity,
  Eye, EyeOff, Grid, LineChart, RefreshCw, Building, Award,
  ChevronDown, ChevronUp
} from 'lucide-react';

import {
  PieChart, Pie, Cell, BarChart as RechartsBarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Link } from 'react-router-dom';

// 核心统计数据接口
interface CoreStats {
  totalStudents: number;
  totalClasses: number;
  totalTeachers: number;
  totalRooms: number;
  totalCourses: number;
  totalSchedules: number;
}

// 专业统计类型
interface MajorDistribution {
  piano: number;
  vocal: number;
  instrumental: number;
  instrumental_breakdown: {
    guzheng: number;
    bamboo_flute: number;
    hulusi: number;
    guqin: number;
    organ: number;
    violin: number;
    saxophone: number;
    cello: number;
    guitar: number;
    drum: number;
    flute: number;
    clarinet: number;
    other: number;
  };
}



// 快捷操作类型
interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  color: string;
  link: string;
  stats?: number;
}

// 系统健康度类型
interface SystemHealth {
  score: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
  issues: string[];
  suggestions: string[];
}

interface TeacherGroupClassStats {
  teacherId: string;
  teacherName: string;
  teacherJobId: string;
  facultyName: string;
  primaryStudentCount: number;
  secondaryStudentCount: number;
  totalStudentCount: number;
  totalHours: number;
  scheduledHours: number;
  remainingHours: number;
  classStats: {
    className: string;
    hasPrimary: boolean;
    hasSecondary: boolean;
    primaryStudentCount: number;
    secondaryStudentCount: number;
    studentCount: number;
    scheduledHours: number;
    students: {
      studentId: string;
      studentName: string;
      studentNumber: string;
      instrument: string;
      scheduledHours: number;
      type: 'primary' | 'secondary';
    }[];
  }[];
}

export default function AdminDashboard() {
  const { user, teacher, isAdmin, onlineTeachers, refreshOnlineTeachers } = useAuth();
  const { showInfo } = useNotification();
  const { allData: blockedTimesData, refreshBlockedTimes, hasLoaded: blockedTimesLoaded, isLoading: blockedTimesLoading } = useBlockedTime();
  
  // 核心状态
  const [coreStats, setCoreStats] = useState<CoreStats>({
    totalStudents: 0,
    totalClasses: 0,
    totalTeachers: 0,
    totalRooms: 0,
    totalCourses: 0,
    totalSchedules: 0
  });

  // 专业统计状态
  const [majorDistribution, setMajorDistribution] = useState<MajorDistribution>({
    piano: 0,
    vocal: 0,
    instrumental: 0,
    instrumental_breakdown: {
      guzheng: 0,
      bamboo_flute: 0,
      hulusi: 0,
      guqin: 0,
      organ: 0,
      violin: 0,
      saxophone: 0,
      cello: 0,
      guitar: 0,
      drum: 0,
      flute: 0,
      clarinet: 0,
      other: 0
    }
  });
  const [activeMajor, setActiveMajor] = useState<string | null>(null);
  const [hoveredInstrument, setHoveredInstrument] = useState<string | null>(null);
  const [activeClass, setActiveClass] = useState<string>('');
  
  const [studentsData, setStudentsData] = useState<any[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [allClasses, setAllClasses] = useState<any[]>([]);
  const [studentTeacherAssignments, setStudentTeacherAssignments] = useState<any[]>([]);
  const [teachersData, setTeachersData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({
    score: 0,
    status: 'good',
    issues: [],
    suggestions: []
  });
  const [activeFaculty, setActiveFaculty] = useState<string>('ALL');
  const [activePosition, setActivePosition] = useState<string>('ALL');
  const [activeDistribution, setActiveDistribution] = useState<string>('专业分布');
  const [expandedGroupTeacher, setExpandedGroupTeacher] = useState<string | null>(null);

  const [coursesData, setCoursesData] = useState<any[]>([]);
  const [schedulesData, setSchedulesData] = useState<any[]>([]);


  // UI状态
  const [viewMode, setViewMode] = useState<'grid' | 'compact'>('grid');
  const [showDetails, setShowDetails] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 加载核心统计数据
  const loadCoreStats = async () => {
    setLoadError(null);
    try {
      const LOAD_TIMEOUT_MS = 20000; // 20 秒超时
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('加载超时，请检查网络或后端服务')), LOAD_TIMEOUT_MS)
      );
      const dataPromise = Promise.all([
        studentService.getAll(),
        courseService.getAll(),
        roomService.getAll(),
        scheduleService.getAll(),
        classService.getAll(),
        teacherService.getAll(),
        studentTeacherAssignmentService.getAll()
      ]);
      const [students, courses, rooms, schedules, classes, teachers, assignments] = await Promise.race([
        dataPromise,
        timeoutPromise
      ]);

      // 班级数据处理：如果为空，从学生数据中提取
      let finalClasses = classes;
      if (classes.length === 0 && students.length > 0) {
        // 从学生数据中提取班级信息
        const uniqueClasses = [...new Set(students.map(s => s.major_class).filter(Boolean))];
        finalClasses = uniqueClasses.map((className, index) => {
          // 获取该班级对应的学生
          const classStudents = students.filter(s => s.major_class === className);
          // 使用第一个学生的grade字段作为入学年份
          const enrollmentYear = classStudents.length > 0 && classStudents[0].grade 
            ? 2000 + classStudents[0].grade 
            : 2024;
          
          return {
            id: `auto_${index}`,
            class_name: className,
            enrollment_year: enrollmentYear,
            student_count: classStudents.length,
            status: 'active'
          };
        });
      }

      const newStats = {
        totalStudents: students.length,
        totalClasses: finalClasses.length,
        totalTeachers: teachers.filter(t => !t.remarks || !t.remarks.includes('其它系教师')).length,
        totalRooms: rooms.length,
        totalCourses: courses.length,
        totalSchedules: schedules.length
      };

      setCoreStats(newStats);
      setStudentsData(students);
      setAllStudents(students);
      setAllClasses(finalClasses);
      setStudentTeacherAssignments(assignments);
      setTeachersData(teachers);
      setCoursesData(courses);
      setSchedulesData(schedules);
      
      // 设置默认选中的班级为全部
      setActiveClass('全部');
      setActiveFaculty('ALL');


      // 专业统计计算 - 根据文档要求实现
      if (students.length > 0) {
        // 过滤学生类型
        const regularStudents = students.filter(s => s.student_type === 'general');
        const degreeStudents = students.filter(s => s.student_type !== 'general');

        // 主项专业分布统计：普通班主项 + 专升本副项1
        const distribution: MajorDistribution = {
          piano: 0,
          vocal: 0,
          instrumental: 0,
          instrumental_breakdown: {
            guzheng: 0,
            bamboo_flute: 0,
            hulusi: 0,
            guqin: 0,
            organ: 0,
            violin: 0,
            saxophone: 0,
            cello: 0,
            guitar: 0,
            drum: 0,
            flute: 0,
            clarinet: 0,
            other: 0
          }
        };

        // 从学生备注中提取专业名称的工具函数
        const extractInstrumentFromRemarks = (remarks: string): string => {
          if (!remarks) return '';
          const match = remarks.match(/(?:主项:)?(.+)/);
          return match ? match[1].trim() : '';
        };

        // 统计普通班主项
        regularStudents.forEach(student => {
          const primaryInstrument = extractInstrumentFromRemarks(student.remarks || '');
          if (primaryInstrument) {
            categorizeInstrument(primaryInstrument, distribution, 'regular');
          }
        });

        // 统计专升本副项1作为主项
        degreeStudents.forEach(student => {
          const secondary1 = extractInstrumentFromRemarks(student.secondary_instrument_1 || '');
          if (secondary1) {
            categorizeInstrument(secondary1, distribution, 'degree');
          }
        });

        setMajorDistribution(distribution);
      }

      // 计算系统健康度
      calculateSystemHealth(newStats, students, schedules);

    } catch (error) {
      console.error('获取统计数据失败:', error);
      setLoadError(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 计算系统健康度
  const calculateSystemHealth = (stats: CoreStats, students: any[], schedules: any[]) => {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    // 检查数据完整性
    if (stats.totalStudents === 0) {
      issues.push('系统中暂无学生数据');
      score -= 30;
    }

    if (stats.totalTeachers === 0) {
      issues.push('系统中暂无教师数据');
      score -= 30;
    }

    if (stats.totalRooms === 0) {
      issues.push('系统中暂无琴房配置');
      suggestions.push('建议先在琴房管理中配置可用教室');
      score -= 15;
    }

    // 检查资源利用率
    if (stats.totalSchedules > 0 && stats.totalStudents > 0) {
      const utilizationRate = (stats.totalSchedules / stats.totalStudents) * 100;
      if (utilizationRate < 50) {
        suggestions.push('排课利用率较低，建议检查排课配置');
        score -= 10;
      }
    }

    // 检查师生比
    if (stats.totalTeachers > 0) {
      const studentTeacherRatio = stats.totalStudents / stats.totalTeachers;
      if (studentTeacherRatio > 20) {
        suggestions.push('师生比较高，建议增加教师数量或优化课程安排');
        score -= 5;
      }
    }

    // 确定状态等级
    let status: SystemHealth['status'];
    if (score >= 90) status = 'excellent';
    else if (score >= 75) status = 'good';
    else if (score >= 50) status = 'warning';
    else status = 'critical';

    setSystemHealth({ score, status, issues, suggestions });
  };

  useEffect(() => {
    loadCoreStats();
    // 禁排数据现在由 BlockedTimeProvider 自动加载
    // 如果缓存中没有数据，Provider 会自动从服务器加载
  }, []);





  // 乐器分类函数 - 根据文档要求实现
  const categorizeInstrument = (instrument: string, distribution: MajorDistribution, source: 'regular' | 'degree') => {
    const instrumentLower = instrument.toLowerCase();
    
    if (instrumentLower.includes('钢琴')) {
      distribution.piano++;
      distribution.instrumental_breakdown.organ++;
    } else if (instrumentLower.includes('声乐')) {
      distribution.vocal++;
    } else {
      distribution.instrumental++;
      
      // 细分器乐统计 - 根据文档要求的具体乐器
      if (instrumentLower.includes('古筝')) {
        distribution.instrumental_breakdown.guzheng++;
      } else if (instrumentLower.includes('竹笛')) {
        distribution.instrumental_breakdown.bamboo_flute++;
      } else if (instrumentLower.includes('葫芦丝')) {
        distribution.instrumental_breakdown.hulusi++;
      } else if (instrumentLower.includes('古琴')) {
        distribution.instrumental_breakdown.guqin++;
      } else if (instrumentLower.includes('双排键') || instrumentLower.includes('双排键')) {
        distribution.instrumental_breakdown.organ++;
      } else if (instrumentLower.includes('小提琴')) {
        distribution.instrumental_breakdown.violin++;
      } else if (instrumentLower.includes('萨克斯')) {
        distribution.instrumental_breakdown.saxophone++;
      } else if (instrumentLower.includes('大提琴')) {
        distribution.instrumental_breakdown.cello++;
      } else if (instrumentLower.includes('吉他')) {
        distribution.instrumental_breakdown.guitar++;
      } else if (instrumentLower.includes('鼓') || instrumentLower.includes('drum')) {
        distribution.instrumental_breakdown.drum++;
      } else if (instrumentLower.includes('长笛')) {
        distribution.instrumental_breakdown.flute++;
      } else if (instrumentLower.includes('单簧管')) {
        distribution.instrumental_breakdown.clarinet++;
      } else {
        distribution.instrumental_breakdown.other++;
      }
    }
  };



  // 自动刷新
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        setRefreshing(true);
        loadCoreStats();
      }, 30000); // 30秒自动刷新

      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // 按班级统计主项分布
  const classMajorDistribution = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    
    // 定义需要统计的主项
    const majors = ['钢琴', '声乐', '古筝', '竹笛', '葫芦丝', '古琴', '双排键', '小提琴', '萨克斯'];
    
    allStudents.forEach(student => {
      const className = student.major_class || '未分班';
      
      // 初始化班级数据
      if (!result[className]) {
        result[className] = {};
        majors.forEach(major => {
          result[className][major] = 0;
        });
      }
      
      // 确定主项
      let major: string;
      if (student.student_type === 'upgrade') {
        // 专升本使用副项1
        major = student.secondary_instruments?.[0] || '';
      } else {
        // 普通班使用主项
        major = student.primary_instrument || '';
      }
      
      // 标准化主项名称
      if (major.includes('钢琴')) major = '钢琴';
      else if (major.includes('声乐')) major = '声乐';
      else if (major.includes('古筝')) major = '古筝';
      else if (major.includes('竹笛')) major = '竹笛';
      else if (major.includes('葫芦丝')) major = '葫芦丝';
      else if (major.includes('古琴')) major = '古琴';
      else if (major.includes('双排键')) major = '双排键';
      else if (major.includes('小提琴')) major = '小提琴';
      else if (major.includes('萨克斯')) major = '萨克斯';
      
      // 统计
      if (majors.includes(major)) {
        result[className][major]++;
      }
    });
    
    return result;
  }, [allStudents]);

  // 按班级统计副项分布
  const classSecondaryDistribution = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    
    // 定义需要统计的副项
    const secondary = ['钢琴', '声乐', '古筝', '竹笛', '葫芦丝', '古琴', '双排键', '小提琴', '萨克斯'];
    
    allStudents.forEach(student => {
      const className = student.major_class || '未分班';
      
      // 初始化班级数据
      if (!result[className]) {
        result[className] = {};
        secondary.forEach(item => {
          result[className][item] = 0;
        });
      }
      
      // 确定副项
      let secondaryItems: string[] = [];
      if (student.student_type === 'upgrade') {
        // 专升本使用副项2+副项3
        secondaryItems = [
          student.secondary_instruments?.[1] || '',
          student.secondary_instruments?.[2] || ''
        ];
      } else {
        // 普通班使用副项1+副项2
        secondaryItems = [
          student.secondary_instruments?.[0] || '',
          student.secondary_instruments?.[1] || ''
        ];
      }
      
      // 统计每个副项
      secondaryItems.forEach(item => {
        // 标准化副项名称
        let standardizedItem = item;
        if (standardizedItem.includes('钢琴')) standardizedItem = '钢琴';
        else if (standardizedItem.includes('声乐')) standardizedItem = '声乐';
        else if (standardizedItem.includes('古筝')) standardizedItem = '古筝';
        else if (standardizedItem.includes('竹笛')) standardizedItem = '竹笛';
        else if (standardizedItem.includes('葫芦丝')) standardizedItem = '葫芦丝';
        else if (standardizedItem.includes('古琴')) standardizedItem = '古琴';
        else if (standardizedItem.includes('双排键')) standardizedItem = '双排键';
        else if (standardizedItem.includes('小提琴')) standardizedItem = '小提琴';
        else if (standardizedItem.includes('萨克斯')) standardizedItem = '萨克斯';
        
        // 统计
        if (secondary.includes(standardizedItem)) {
          result[className][standardizedItem]++;
        }
      });
    });
    
    return result;
  }, [allStudents]);

  // 图表数据计算
  const chartData = useMemo(() => {
    // 主项分布饼图数据
    const pieData = [
      { name: '钢琴', value: majorDistribution.piano, color: '#8884d8' },
      { name: '声乐', value: majorDistribution.vocal, color: '#82ca9d' },
      { name: '器乐', value: majorDistribution.instrumental, color: '#ffc658' }
    ].filter(item => item.value > 0);

    // 器乐细分柱状图数据
    const barData = Object.entries(majorDistribution.instrumental_breakdown)
      .filter(([_, value]) => value > 0)
      .map(([instrument, value]) => ({
        name: instrument === 'guzheng' ? '古筝' :
              instrument === 'bamboo_flute' ? '竹笛' :
              instrument === 'hulusi' ? '葫芦丝' :
              instrument === 'guqin' ? '古琴' :
              instrument === 'organ' ? '双排键' :
              instrument === 'violin' ? '小提琴' :
              instrument === 'saxophone' ? '萨克斯' :
              instrument === 'cello' ? '大提琴' :
              instrument === 'guitar' ? '吉他' :
              instrument === 'drum' ? '鼓' :
              instrument === 'flute' ? '长笛' :
              instrument === 'clarinet' ? '单簧管' : '其他',
        value: value
      }));

    // 按班级统计主项分布的图表数据
    const classMajorChartData = Object.entries(classMajorDistribution).map(([className, distribution]) => {
      const entry: any = { name: className };
      Object.entries(distribution).forEach(([major, count]) => {
        entry[major] = count;
      });
      return entry;
    });

    return { pieData, barData, classMajorChartData };
  }, [majorDistribution, classMajorDistribution]);

  // 图表交互处理
  const resetSelections = () => {
    setActiveMajor(null);
    setHoveredInstrument(null);
    showInfo('已重置所有选择');
  };

  const handlePieClick = (data: any) => {
    setActiveMajor(data.name);
    showInfo(`查看${data.name}专业详细分布`);
  };

  const handleBarHover = (data: any) => {
    setHoveredInstrument(data.activeLabel);
  };



  // 快捷操作配置
  const quickActions: QuickAction[] = [
    {
      id: 'students',
      title: '学生管理',
      description: '管理所有学生信息',
      icon: Users,
      color: 'from-blue-500 to-blue-600',
      link: '/students',
      stats: coreStats.totalStudents
    },
    {
      id: 'teachers',
      title: '教师管理',
      description: '管理教师账户和权限',
      icon: GraduationCap,
      color: 'from-green-500 to-green-600',
      link: '/teachers',
      stats: coreStats.totalTeachers
    },
    {
      id: 'classes',
      title: '班级管理',
      description: '创建和管理班级',
      icon: BookOpen,
      color: 'from-purple-500 to-purple-600',
      link: '/classes',
      stats: coreStats.totalClasses
    },
    {
      id: 'rooms',
      title: '琴房管理',
      description: '配置教室资源',
      icon: MapPin,
      color: 'from-orange-500 to-orange-600',
      link: '/rooms',
      stats: coreStats.totalRooms
    },
    {
      id: 'schedule',
      title: '排课管理',
      description: '查看和调整课程安排',
      icon: Calendar,
      color: 'from-indigo-500 to-indigo-600',
      link: '/schedule',
      stats: coreStats.totalSchedules
    },
    {
      id: 'courses',
      title: '课程管理',
      description: '管理课程信息',
      icon: Music,
      color: 'from-pink-500 to-pink-600',
      link: '/courses',
      stats: coreStats.totalCourses
    }
  ];

  // 获取状态颜色
  const getHealthStatusColor = (status: SystemHealth['status']) => {
    switch (status) {
      case 'excellent': return 'text-green-600 bg-green-100';
      case 'good': return 'text-blue-600 bg-blue-100';
      case 'warning': return 'text-yellow-600 bg-yellow-100';
      case 'critical': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getHealthStatusText = (status: SystemHealth['status']) => {
    switch (status) {
      case 'excellent': return '优秀';
      case 'good': return '良好';
      case 'warning': return '警告';
      case 'critical': return '严重';
      default: return '未知';
    }
  };

  const teacherGroupClassStats = useMemo(() => {
    const HOURS_PER_STUDENT = 16;
    const stats: TeacherGroupClassStats[] = [];

    const targetTeachers = isAdmin 
      ? teachersData 
      : teachersData.filter(t => t.id === teacher?.id || t.teacher_id === teacher?.teacher_id);

    targetTeachers.forEach(t => {
      const classStatsMap = new Map<string, {
        className: string;
        hasPrimary: boolean;
        hasSecondary: boolean;
        primaryStudentCount: number;
        secondaryStudentCount: number;
        studentCount: number;
        scheduledHours: number;
        students: {
          studentId: string;
          studentName: string;
          studentNumber: string;
          instrument: string;
          scheduledHours: number;
          type: 'primary' | 'secondary';
        }[];
      }>();

      let primaryStudentCount = 0;
      let secondaryStudentCount = 0;
      const teacherIdForFilter = t.id || t.teacher_id;

      allStudents.forEach(student => {
        const studentClass = student.major_class || student.class_name || '未知班级';
        const studentId = student.id;
        const studentName = student.name;
        const studentNumber = student.student_id;

        const getStudentScheduledHours = (sId: string, tid: string, instrumentName?: string): number => {
          const studentSchedules = schedulesData.filter(sc => {
            const isStudentMatch = sc.student_id === sId;
            if (!isStudentMatch) return false;
            
            const isTeacherMatch = sc.teacher_id === tid || 
                                   sc.teacher_id === t.teacher_id ||
                                   sc.teacher_id === t.id;
            if (!isTeacherMatch) return false;
            
            const course = coursesData.find(c => c.id === sc.course_id || (c as any).course_id === sc.course_id);
            const teachingType = (course as any)?.teaching_type || (sc as any).teaching_type;
            const courseType = course?.course_type || (sc as any).course_type;
            
            const isGroupCourse = teachingType === '小组课' || teachingType === '专业小课' ||
                                  courseType === '钢琴' || courseType === '声乐' || courseType === '器乐';
            
            if (instrumentName && isGroupCourse) {
              const courseName = course?.course_name || (sc as any).course_name || '';
              const coursePrimaryInstrument = (course as any)?.primary_instrument;
              const courseSecondaryInstrument = (course as any)?.secondary_instrument;
              
              const instrumentMatch = courseType === instrumentName ||
                                      coursePrimaryInstrument === instrumentName ||
                                      courseSecondaryInstrument === instrumentName ||
                                      courseName.includes(instrumentName) ||
                                      courseName === instrumentName;
              
              const instrumentFaculty = INSTRUMENT_TO_FACULTY[instrumentName];
              const isInstrumentTypeMatch = instrumentFaculty === 'INSTRUMENT' && courseType === '器乐';
              
              return instrumentMatch || isInstrumentTypeMatch;
            }
            
            return isGroupCourse;
          });
          
          // 按「节次」统计课时：同一 (星期+节次+周次) 只计 1 课时，与排课结果页一致，避免重复记录导致 16 显示成 32
          const uniqueSlots = new Set<string>();
          studentSchedules.forEach(sc => {
            const week = sc.start_week ?? sc.end_week ?? sc.week_number;
            const key = `${sc.day_of_week ?? (sc as any).day}_${sc.period}_${week ?? ''}`;
            uniqueSlots.add(key);
          });
          return uniqueSlots.size;
        };

        if (student.assigned_teachers?.primary_teacher_id === t.id ||
            student.assigned_teachers?.primary_teacher_id === t.teacher_id) {
          primaryStudentCount++;
          
          const instrument = student.primary_instrument || '';
          const scheduledHours = getStudentScheduledHours(studentId, teacherIdForFilter, instrument);
          
          if (!classStatsMap.has(studentClass)) {
            classStatsMap.set(studentClass, {
              className: studentClass,
              hasPrimary: false,
              hasSecondary: false,
              primaryStudentCount: 0,
              secondaryStudentCount: 0,
              studentCount: 0,
              scheduledHours: 0,
              students: []
            });
          }
          const classStat = classStatsMap.get(studentClass)!;
          classStat.hasPrimary = true;
          classStat.primaryStudentCount++;
          classStat.studentCount++;
          classStat.scheduledHours += scheduledHours;
          classStat.students.push({
            studentId,
            studentName,
            studentNumber,
            instrument,
            scheduledHours,
            type: 'primary'
          });
        }

        const secondaryAssignments = [
          { teacherId: student.assigned_teachers?.secondary1_teacher_id, instrument: student.secondary_instrument1 || student.secondary_instruments?.[0] },
          { teacherId: student.assigned_teachers?.secondary2_teacher_id, instrument: student.secondary_instrument2 || student.secondary_instruments?.[1] },
          { teacherId: student.assigned_teachers?.secondary3_teacher_id, instrument: student.secondary_instrument3 || student.secondary_instruments?.[2] }
        ];

        secondaryAssignments.forEach(assignment => {
          if (assignment.teacherId === t.id || assignment.teacherId === t.teacher_id) {
            secondaryStudentCount++;
            
            const scheduledHours = getStudentScheduledHours(studentId, teacherIdForFilter, assignment.instrument);
            
            if (!classStatsMap.has(studentClass)) {
              classStatsMap.set(studentClass, {
                className: studentClass,
                hasPrimary: false,
                hasSecondary: false,
                primaryStudentCount: 0,
                secondaryStudentCount: 0,
                studentCount: 0,
                scheduledHours: 0,
                students: []
              });
            }
            const classStat = classStatsMap.get(studentClass)!;
            classStat.hasSecondary = true;
            classStat.secondaryStudentCount++;
            classStat.studentCount++;
            classStat.scheduledHours += scheduledHours;
            classStat.students.push({
              studentId,
              studentName,
              studentNumber,
              instrument: assignment.instrument || '',
              scheduledHours,
              type: 'secondary'
            });
          }
        });
      });

      const totalStudentCount = primaryStudentCount + secondaryStudentCount;
      
      if (totalStudentCount > 0) {
        const totalHours = totalStudentCount * HOURS_PER_STUDENT;
        const scheduledHours = Array.from(classStatsMap.values()).reduce((sum, cs) => sum + cs.scheduledHours, 0);
        
        stats.push({
          teacherId: t.id || t.teacher_id,
          teacherName: t.name || t.full_name,
          teacherJobId: t.teacher_id || '',
          facultyName: t.faculty_name || '',
          primaryStudentCount,
          secondaryStudentCount,
          totalStudentCount,
          totalHours,
          scheduledHours,
          remainingHours: Math.max(0, totalHours - scheduledHours),
          classStats: Array.from(classStatsMap.values()).sort((a, b) => a.className.localeCompare(b.className))
        });
      }
    });

    return stats.sort((a, b) => a.teacherJobId.localeCompare(b.teacherJobId));
  }, [teachersData, allStudents, schedulesData, coursesData, isAdmin, teacher]);

  const teacherGroupTotalStats = useMemo(() => {
    return teacherGroupClassStats.reduce((acc, stat) => ({
      totalTeachers: acc.totalTeachers + 1,
      totalStudents: acc.totalStudents + stat.totalStudentCount,
      totalHours: acc.totalHours + stat.totalHours,
      scheduledHours: acc.scheduledHours + stat.scheduledHours,
      remainingHours: acc.remainingHours + stat.remainingHours
    }), { totalTeachers: 0, totalStudents: 0, totalHours: 0, scheduledHours: 0, remainingHours: 0 });
  }, [teacherGroupClassStats]);

  const getProgressColor = (rate: number) => {
    if (rate >= 100) return 'bg-green-500';
    if (rate >= 75) return 'bg-blue-500';
    if (rate >= 50) return 'bg-yellow-500';
    if (rate >= 25) return 'bg-orange-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-gray-600">加载中...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-red-600">{loadError}</p>
        <p className="text-sm text-gray-500">请确认后端已启动（http://localhost:5000）且项目根目录 .env 中配置了 VITE_USE_DATABASE=true 和 VITE_API_URL=http://localhost:5000/api</p>
        <button
          type="button"
          onClick={() => { setLoadError(null); setLoading(true); loadCoreStats(); }}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* 头部控制栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            数据统计看板
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              {new Date().toLocaleDateString('zh-CN', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <div className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
              音乐系管理系统
            </div>
          </div>
        </div>

        {/* 在线教师模块（仅管理员可见） */}
        {isAdmin && onlineTeachers && onlineTeachers.length > 0 && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">在线教师：</span>
              <div className="flex items-center gap-1 flex-wrap max-w-md justify-end">
                {onlineTeachers.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                      t.id === user?.id
                        ? 'bg-green-100 text-green-700 border border-green-300'
                        : 'bg-blue-100 text-blue-700 border border-blue-300'
                    }`}
                    title={`${t.name} - ${t.faculty_name || '未知教研室'}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        t.status === 'online'
                          ? 'bg-green-500'
                          : t.status === 'busy'
                          ? 'bg-yellow-500'
                          : 'bg-gray-400'
                      }`}
                    ></span>
                    <span>{t.name}</span>
                    {t.id === user?.id && <span className="text-green-600">(我)</span>}
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={refreshOnlineTeachers}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
            >
              <RefreshCw className="w-3 h-3" />
              手动刷新在线列表
            </button>
          </div>
        )}
      </div>



      {/* 核心指标卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">学生总数</p>
              <p className="text-2xl font-bold">{coreStats.totalStudents}</p>
            </div>
            <Users className="w-8 h-8 text-blue-200" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm">班级数量</p>
              <p className="text-2xl font-bold">{coreStats.totalClasses}</p>
            </div>
            <BookOpen className="w-8 h-8 text-purple-200" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">教师总数</p>
              <p className="text-2xl font-bold">{coreStats.totalTeachers}</p>
            </div>
            <GraduationCap className="w-8 h-8 text-green-200" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm">琴房数量</p>
              <p className="text-2xl font-bold">{coreStats.totalRooms}</p>
            </div>
            <MapPin className="w-8 h-8 text-orange-200" />
          </div>
        </div>

        {/* 已排课程模块已隐藏 */}

      </div>



      {/* 主要内容区域 */}
      <div className="space-y-6">
        {/* 统计详情 */}
        <div className="space-y-6">
          {/* 小组课统计模块 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-gray-900">小组课排课统计</h3>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-4 border border-blue-100">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  <span className="text-sm text-blue-700">教师数</span>
                </div>
                <p className="text-2xl font-bold text-blue-700 mt-1">{teacherGroupTotalStats.totalTeachers}</p>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-100">
                <div className="flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-green-600" />
                  <span className="text-sm text-green-700">学生数</span>
                </div>
                <p className="text-2xl font-bold text-green-700 mt-1">{teacherGroupTotalStats.totalStudents}</p>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg p-4 border border-purple-100">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-purple-600" />
                  <span className="text-sm text-purple-700">总课时</span>
                </div>
                <p className="text-2xl font-bold text-purple-700 mt-1">{teacherGroupTotalStats.totalHours}</p>
              </div>
              <div className="bg-gradient-to-br from-cyan-50 to-blue-50 rounded-lg p-4 border border-cyan-100">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-cyan-600" />
                  <span className="text-sm text-cyan-700">已排课时</span>
                </div>
                <p className="text-2xl font-bold text-cyan-700 mt-1">{teacherGroupTotalStats.scheduledHours}</p>
              </div>
              <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-lg p-4 border border-orange-100">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-orange-600" />
                  <span className="text-sm text-orange-700">剩余课时</span>
                </div>
                <p className="text-2xl font-bold text-orange-700 mt-1">{teacherGroupTotalStats.remainingHours}</p>
              </div>
            </div>

            {teacherGroupClassStats.map((teacherStat) => (
              <div key={teacherStat.teacherId} className="border border-gray-200 rounded-lg overflow-hidden mb-3">
                <div 
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedGroupTeacher(expandedGroupTeacher === teacherStat.teacherId ? null : teacherStat.teacherId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-cyan-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">
                        {teacherStat.teacherName.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">{teacherStat.teacherName}</h3>
                        <p className="text-sm text-gray-500">
                          {teacherStat.facultyName && <span>{teacherStat.facultyName} · </span>}
                          {teacherStat.totalStudentCount}名学生
                          {teacherStat.primaryStudentCount > 0 && <span className="text-purple-600 ml-1">(主项{teacherStat.primaryStudentCount}人)</span>}
                          {teacherStat.secondaryStudentCount > 0 && <span className="text-blue-600 ml-1">(副项{teacherStat.secondaryStudentCount}人)</span>}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="w-32">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-500">完成率</span>
                          <span className="font-medium text-gray-700">
                            {teacherStat.totalHours > 0 ? ((teacherStat.scheduledHours / teacherStat.totalHours) * 100).toFixed(0) : 0}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${getProgressColor(teacherStat.totalHours > 0 ? (teacherStat.scheduledHours / teacherStat.totalHours) * 100 : 0)}`}
                            style={{ width: `${Math.min(100, teacherStat.totalHours > 0 ? (teacherStat.scheduledHours / teacherStat.totalHours) * 100 : 0)}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-green-600">已排 {teacherStat.scheduledHours}课时</span>
                        <span className="text-orange-600">剩余 {teacherStat.remainingHours}课时</span>
                      </div>

                      {expandedGroupTeacher === teacherStat.teacherId ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {expandedGroupTeacher === teacherStat.teacherId && (
                  <div className="border-t border-gray-200 bg-gray-50 p-4">
                    <div className="space-y-4">
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">按班级统计</h5>
                        <div className="space-y-2">
                          {teacherStat.classStats.map((classStat, idx) => (
                            <div key={idx} className="bg-white p-3 rounded-lg border border-gray-200">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900">{classStat.className}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    classStat.hasPrimary && classStat.hasSecondary 
                                      ? 'bg-gradient-to-r from-purple-100 to-blue-100' 
                                      : classStat.hasPrimary 
                                        ? 'bg-purple-100 text-purple-700' 
                                        : 'bg-blue-100 text-blue-700'
                                  }`}>
                                    {classStat.hasPrimary && classStat.hasSecondary 
                                      ? <><span className="text-purple-700">主项</span>/<span className="text-blue-700">副项</span></> 
                                      : classStat.hasPrimary 
                                        ? '主项' 
                                        : '副项'}
                                  </span>
                                </div>
                                <div className="text-sm">
                                  <span className="text-gray-500">{classStat.studentCount}人 · </span>
                                  <span className="text-green-600">已排{classStat.scheduledHours}课时</span>
                                  <span className="text-gray-400 mx-1">/</span>
                                  <span className="text-purple-600">共{classStat.studentCount * 16}课时</span>
                                </div>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div 
                                  className={`h-1.5 rounded-full ${getProgressColor(classStat.studentCount > 0 ? (classStat.scheduledHours / (classStat.studentCount * 16)) * 100 : 0)}`}
                                  style={{ width: `${Math.min(100, classStat.studentCount > 0 ? (classStat.scheduledHours / (classStat.studentCount * 16)) * 100 : 0)}%` }}
                                />
                              </div>
                              <div className="mt-2 space-y-1">
                                {classStat.hasPrimary && (
                                  <div className="text-xs">
                                    <span className="text-purple-600 font-medium">主项：</span>
                                    <span className="text-gray-500">
                                      {classStat.students.filter(s => s.type === 'primary').map(s => (
                                        <span key={s.studentId} className="inline-block mr-3">
                                          {s.studentName}
                                          {s.instrument && <span className="text-gray-400 ml-1">({s.instrument})</span>}
                                          <span className="ml-1">
                                            <span className={`font-bold text-sm ${s.scheduledHours >= 16 ? 'text-green-600' : s.scheduledHours === 0 ? 'text-red-500' : 'text-orange-500'}`}>{s.scheduledHours}</span>
                                            <span className="text-gray-500 text-xs">课时</span>
                                          </span>
                                        </span>
                                      ))}
                                    </span>
                                  </div>
                                )}
                                {classStat.hasSecondary && (
                                  <div className="text-xs">
                                    <span className="text-blue-600 font-medium">副项：</span>
                                    <span className="text-gray-500">
                                      {classStat.students.filter(s => s.type === 'secondary').map(s => (
                                        <span key={s.studentId} className="inline-block mr-3">
                                          {s.studentName}
                                          {s.instrument && <span className="text-gray-400 ml-1">({s.instrument})</span>}
                                          <span className="ml-1">
                                            <span className={`font-bold text-sm ${s.scheduledHours >= 16 ? 'text-green-600' : s.scheduledHours === 0 ? 'text-red-500' : 'text-orange-500'}`}>{s.scheduledHours}</span>
                                            <span className="text-gray-500 text-xs">课时</span>
                                          </span>
                                        </span>
                                      ))}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {teacherGroupClassStats.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>暂无小组课数据</p>
              </div>
            )}
          </div>

          {isAdmin && (
            <>
              {/* 分布模块容器 */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900">分布统计</h3>
                  </div>
                </div>

            {/* 分布类型选项卡 */}
            <div className="mb-6">
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                <button
                  onClick={() => setActiveDistribution('专业分布')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeDistribution === '专业分布' ? 'bg-purple-200 text-purple-800 border border-purple-300' : 'bg-purple-100 text-purple-700 border border-purple-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  专业分布
                </button>
                <button
                  onClick={() => setActiveDistribution('教师分布')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeDistribution === '教师分布' ? 'bg-blue-200 text-blue-800 border border-blue-300' : 'bg-blue-100 text-blue-700 border border-blue-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  教师分布
                </button>
                <button
                  onClick={() => setActiveDistribution('职称分布')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeDistribution === '职称分布' ? 'bg-green-200 text-green-800 border border-green-300' : 'bg-green-100 text-green-700 border border-green-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  职称分布
                </button>
              </div>
            </div>

            {/* 专业分布内容 */}
            {activeDistribution === '专业分布' && (
              <>
                <div className="text-xs text-gray-500 mb-4">
                  数据范围：普通班主项 + 专升本副项1 | 普通班副项1+2 + 专升本副项2+3
                </div>
                {/* 班级选项卡 */}
                <div className="mb-6">
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {/* 全部选项 */}
                <button
                  onClick={() => setActiveClass('全部')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeClass === '全部' ? 'bg-purple-200 text-purple-800 border border-purple-300' : 'bg-purple-100 text-purple-700 border border-purple-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  全部
                </button>
                {/* 班级选项 - 按年级及班级序号排列，并按年级区分颜色 */}
                {Object.keys(classMajorDistribution)
                  .sort((a, b) => {
                    // 提取年级和班级序号
                    const getClassInfo = (className: string) => {
                      // 匹配格式：音乐学2301
                      const match = className.match(/(\d{2})(\d{2})/);
                      if (match) {
                        return {
                          grade: parseInt(match[1]),
                          classNumber: parseInt(match[2])
                        };
                      }
                      // 没有匹配到数字，返回默认值
                      return {
                        grade: 0,
                        classNumber: 0
                      };
                    };
                    
                    const infoA = getClassInfo(a);
                    const infoB = getClassInfo(b);
                    
                    // 先按年级排序（从高到低）
                    if (infoA.grade !== infoB.grade) {
                      return infoB.grade - infoA.grade;
                    }
                    // 同年级按班级序号排序（从低到高）
                    return infoA.classNumber - infoB.classNumber;
                  })
                  .map((className) => {
                    // 提取年级
                    const getGrade = (className: string) => {
                      const match = className.match(/(\d{2})(\d{2})/);
                      return match ? parseInt(match[1]) : 0;
                    };
                    
                    const grade = getGrade(className);
                    const isActive = activeClass === className;
                    
                    // 根据年级直接分配颜色类（加深颜色，确保所有年级都有边框）
                    let colorClass = '';
                    if (grade === 25) {
                      colorClass = isActive ? 'bg-blue-200 text-blue-800 border border-blue-300' : 'bg-blue-100 text-blue-700 border border-blue-200';
                    } else if (grade === 24) {
                      colorClass = isActive ? 'bg-green-200 text-green-800 border border-green-300' : 'bg-green-100 text-green-700 border border-green-200';
                    } else if (grade === 23) {
                      colorClass = isActive ? 'bg-orange-200 text-orange-800 border border-orange-300' : 'bg-orange-100 text-orange-700 border border-orange-200';
                    } else if (grade === 22) {
                      colorClass = isActive ? 'bg-red-200 text-red-800 border border-red-300' : 'bg-red-100 text-red-700 border border-red-200';
                    } else if (grade === 21) {
                      colorClass = isActive ? 'bg-purple-200 text-purple-800 border border-purple-300' : 'bg-purple-100 text-purple-700 border border-purple-200';
                    } else if (grade === 20) {
                      colorClass = isActive ? 'bg-indigo-200 text-indigo-800 border border-indigo-300' : 'bg-indigo-100 text-indigo-700 border border-indigo-200';
                    } else {
                      colorClass = isActive ? 'bg-gray-200 text-gray-800 border border-gray-300' : 'bg-gray-100 text-gray-700 border border-gray-200';
                    }
                    
                    return (
                      <button
                        key={className}
                        onClick={() => setActiveClass(className)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${colorClass} shadow-sm hover:shadow-md focus:outline-none`}
                      >
                        {className}
                      </button>
                    );
                  })
                }
              </div>
            </div>

            {/* 当前选中项的柱状图 */}
            {activeClass && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 主项专业分布 */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                    <h4 className="text-sm font-medium text-gray-900">主项专业分布</h4>
                  </div>
                  {/* 全部数据 */}
                  {activeClass === '全部' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-900">全部</h4>
                        <span className="text-sm font-medium text-gray-700">合计: {allStudents.length}人</span>
                      </div>
                      <div className="space-y-2">
                        {Object.keys(classMajorDistribution[Object.keys(classMajorDistribution)[0]] || {}).map((major) => {
                          const total = Object.values(classMajorDistribution).reduce((sum, distribution) => sum + (distribution[major] || 0), 0);
                          const percentage = allStudents.length > 0 ? (total / allStudents.length) * 100 : 0;
                          
                          if (total === 0) return null;
                          
                          // 为每个主项分配不同的颜色
                          const colors = {
                            '钢琴': 'bg-blue-500',
                            '声乐': 'bg-green-500',
                            '古筝': 'bg-yellow-500',
                            '竹笛': 'bg-purple-500',
                            '葫芦丝': 'bg-orange-500',
                            '古琴': 'bg-pink-500',
                            '双排键': 'bg-indigo-500',
                            '小提琴': 'bg-teal-500',
                            '萨克斯': 'bg-red-500'
                          };
                          
                          const color = colors[major] || 'bg-gray-500';
                          
                          return (
                            <div key={major} className="space-y-2">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-700 font-medium">{major}</span>
                                    <span className="font-medium text-gray-900">{total}人 ({percentage.toFixed(1)}%)</span>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-3">
                                    <div 
                                      className={`h-3 rounded-full ${color} transition-all duration-500 ease-in-out`}
                                      style={{ width: `${percentage}%` }}
                                    ></div>
                                  </div>
                                </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    // 班级数据
                    Object.entries(classMajorDistribution).map(([className, distribution]) => {
                      if (className !== activeClass) return null;
                      
                      // 计算合计
                      const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
                      
                      // 过滤出有数据的主项
                      const filteredDistribution = Object.entries(distribution)
                        .filter(([_, count]) => count > 0)
                        .sort(([_, countA], [__, countB]) => countB - countA);
                      
                      return (
                        <div key={className} className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium text-gray-900">{className}</h4>
                            <span className="text-sm font-medium text-gray-700">合计: {total}人</span>
                          </div>
                          <div className="space-y-2">
                            {filteredDistribution.map(([major, count]) => {
                              // 计算百分比
                              const percentage = total > 0 ? (count / total) * 100 : 0;
                              
                              // 为每个主项分配不同的颜色
                              const colors = {
                                '钢琴': 'bg-blue-500',
                                '声乐': 'bg-green-500',
                                '古筝': 'bg-yellow-500',
                                '竹笛': 'bg-purple-500',
                                '葫芦丝': 'bg-orange-500',
                                '古琴': 'bg-pink-500',
                                '双排键': 'bg-indigo-500',
                                '小提琴': 'bg-teal-500',
                                '萨克斯': 'bg-red-500'
                              };
                              
                              const color = colors[major] || 'bg-gray-500';
                              
                              return (
                                <div key={major} className="space-y-2">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-700 font-medium">{major}</span>
                                    <span className="font-medium text-gray-900">{count}人 ({percentage.toFixed(1)}%)</span>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-3">
                                    <div 
                                      className={`h-3 rounded-full ${color} transition-all duration-500 ease-in-out`}
                                      style={{ width: `${percentage}%` }}
                                    ></div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 副项专业分布 */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <h4 className="text-sm font-medium text-gray-900">副项专业分布</h4>
                  </div>
                  {/* 全部数据 */}
                  {activeClass === '全部' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-900">全部</h4>
                        <span className="text-sm font-medium text-gray-700">合计: {allStudents.length * 2}人次</span>
                      </div>
                      <div className="space-y-2">
                        {Object.keys(classSecondaryDistribution[Object.keys(classSecondaryDistribution)[0]] || {}).map((secondary) => {
                          const total = Object.values(classSecondaryDistribution).reduce((sum, distribution) => sum + (distribution[secondary] || 0), 0);
                          const totalStudents = allStudents.length * 2; // 每个学生有2个副项
                          const percentage = totalStudents > 0 ? (total / totalStudents) * 100 : 0;
                          
                          if (total === 0) return null;
                          
                          // 为每个副项分配不同的颜色
                          const colors = {
                            '钢琴': 'bg-blue-500',
                            '声乐': 'bg-green-500',
                            '古筝': 'bg-yellow-500',
                            '竹笛': 'bg-purple-500',
                            '葫芦丝': 'bg-orange-500',
                            '古琴': 'bg-pink-500',
                            '双排键': 'bg-indigo-500',
                            '小提琴': 'bg-teal-500',
                            '萨克斯': 'bg-red-500'
                          };
                          
                          const color = colors[secondary] || 'bg-gray-500';
                          
                          return (
                            <div key={secondary} className="space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-700 font-medium">{secondary}</span>
                                <span className="font-medium text-gray-900">{total}人次 ({percentage.toFixed(1)}%)</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-3">
                                <div 
                                  className={`h-3 rounded-full ${color} transition-all duration-500 ease-in-out`}
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    // 班级数据
                    Object.entries(classSecondaryDistribution).map(([className, distribution]) => {
                      if (className !== activeClass) return null;
                      
                      // 计算合计
                      const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
                      
                      // 过滤出有数据的副项
                      const filteredDistribution = Object.entries(distribution)
                        .filter(([_, count]) => count > 0)
                        .sort(([_, countA], [__, countB]) => countB - countA);
                      
                      return (
                        <div key={className} className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium text-gray-900">{className}</h4>
                            <span className="text-sm font-medium text-gray-700">合计: {total}人次</span>
                          </div>
                          <div className="space-y-2">
                            {filteredDistribution.map(([secondary, count]) => {
                              // 计算百分比
                              const percentage = total > 0 ? (count / total) * 100 : 0;
                              
                              // 为每个副项分配不同的颜色
                              const colors = {
                                '钢琴': 'bg-blue-500',
                                '声乐': 'bg-green-500',
                                '古筝': 'bg-yellow-500',
                                '竹笛': 'bg-purple-500',
                                '葫芦丝': 'bg-orange-500',
                                '古琴': 'bg-pink-500',
                                '双排键': 'bg-indigo-500',
                                '小提琴': 'bg-teal-500',
                                '萨克斯': 'bg-red-500'
                              };
                              
                              const color = colors[secondary] || 'bg-gray-500';
                              
                              return (
                                <div key={secondary} className="space-y-2">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-700 font-medium">{secondary}</span>
                                    <span className="font-medium text-gray-900">{count}人次 ({percentage.toFixed(1)}%)</span>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-3">
                                    <div 
                                      className={`h-3 rounded-full ${color} transition-all duration-500 ease-in-out`}
                                      style={{ width: `${percentage}%` }}
                                    ></div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
            
            {/* 当选中班级时，不显示单独的全部部分 */}
            {activeClass !== '全部' && activeClass !== '' && (
              <div className="pt-4">
                <div className="text-center text-sm text-gray-500">
                  点击上方选项卡查看其他班级或全部数据
                </div>
              </div>
            )}
              </>
            )}
          
            {/* 教师分布内容 */}
            {activeDistribution === '教师分布' && (
              <>
                <div className="text-xs text-gray-500 mb-4">
                  数据范围：按教研室分类展示教师分布情况
                </div>
                {/* 教研室选项卡 */}
                <div className="mb-6">
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {/* 全部选项 */}
                <button
                  onClick={() => setActiveFaculty('ALL')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeFaculty === 'ALL' ? 'bg-blue-200 text-blue-800 border border-blue-300' : 'bg-blue-100 text-blue-700 border border-blue-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  全部
                </button>
                {/* 钢琴教研室 */}
                <button
                  onClick={() => setActiveFaculty('PIANO')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeFaculty === 'PIANO' ? 'bg-blue-200 text-blue-800 border border-blue-300' : 'bg-blue-100 text-blue-700 border border-blue-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  钢琴教研室
                </button>
                {/* 声乐教研室 */}
                <button
                  onClick={() => setActiveFaculty('VOCAL')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeFaculty === 'VOCAL' ? 'bg-green-200 text-green-800 border border-green-300' : 'bg-green-100 text-green-700 border border-green-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  声乐教研室
                </button>
                {/* 器乐教研室 */}
                <button
                  onClick={() => setActiveFaculty('INSTRUMENT')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeFaculty === 'INSTRUMENT' ? 'bg-orange-200 text-orange-800 border border-orange-300' : 'bg-orange-100 text-orange-700 border border-orange-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  器乐教研室
                </button>
                {/* 理论教研室 */}
                <button
                  onClick={() => setActiveFaculty('THEORY')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeFaculty === 'THEORY' ? 'bg-purple-200 text-purple-800 border border-purple-300' : 'bg-purple-100 text-purple-700 border border-purple-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  理论教研室
                </button>
              </div>
            </div>

            {/* 教师分布数据 */}
            <div className="space-y-4">
              {activeFaculty === 'ALL' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900">总计</h4>
                    <span className="text-sm font-medium text-gray-700">合计: {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length}人</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* 钢琴教研室 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">钢琴教研室</span>
                        <span className="font-medium text-gray-900">
                          {teachersData.filter(t => t && t.faculty_id === 'PIANO' && !t.remarks.includes('其它系教师')).length}人
                          {' ('}
                          {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.faculty_id === 'PIANO' && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                          {'%)'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className="h-3 rounded-full bg-blue-500 transition-all duration-500 ease-in-out"
                          style={{
                            width: `${(() => {
                              const total = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                              if (total === 0) return 0;
                              const count = teachersData.filter(t => t && t.faculty_id === 'PIANO' && !t.remarks.includes('其它系教师')).length;
                              return (count / total * 100).toFixed(1);
                            })()}%`
                          }}
                        ></div>
                      </div>
                      <div className="space-y-2">
                        {teachersData.filter(t => t && t.faculty_id === 'PIANO' && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                          <div key={teacher.id} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium text-xs">
                              {teacher.name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                              <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                              <div className="text-xs text-gray-500">{teacher.position}</div>
                              {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* 声乐教研室 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">声乐教研室</span>
                        <span className="font-medium text-gray-900">
                          {teachersData.filter(t => t && t.faculty_id === 'VOCAL' && !t.remarks.includes('其它系教师')).length}人
                          {' ('}
                          {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.faculty_id === 'VOCAL' && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                          {'%)'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className="h-3 rounded-full bg-green-500 transition-all duration-500 ease-in-out"
                          style={{
                            width: `${(() => {
                              const total = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                              if (total === 0) return 0;
                              const count = teachersData.filter(t => t && t.faculty_id === 'VOCAL' && !t.remarks.includes('其它系教师')).length;
                              return (count / total * 100).toFixed(1);
                            })()}%`
                          }}
                        ></div>
                      </div>
                      <div className="space-y-2">
                        {teachersData.filter(t => t && t.faculty_id === 'VOCAL' && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                          <div key={teacher.id} className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white font-medium text-xs">
                              {teacher.name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                              <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                              <div className="text-xs text-gray-500">{teacher.position}</div>
                              {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* 器乐教研室 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">器乐教研室</span>
                        <span className="font-medium text-gray-900">
                          {teachersData.filter(t => t && t.faculty_id === 'INSTRUMENT' && !t.remarks.includes('其它系教师')).length}人
                          {' ('}
                          {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.faculty_id === 'INSTRUMENT' && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                          {'%)'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className="h-3 rounded-full bg-orange-500 transition-all duration-500 ease-in-out"
                          style={{
                            width: `${(() => {
                              const total = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                              if (total === 0) return 0;
                              const count = teachersData.filter(t => t && t.faculty_id === 'INSTRUMENT' && !t.remarks.includes('其它系教师')).length;
                              return (count / total * 100).toFixed(1);
                            })()}%`
                          }}
                        ></div>
                      </div>
                      <div className="space-y-2">
                        {teachersData.filter(t => t && t.faculty_id === 'INSTRUMENT' && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                          <div key={teacher.id} className="flex items-center gap-2 p-2 bg-orange-50 rounded-lg">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white font-medium text-xs">
                              {teacher.name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                              <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                              <div className="text-xs text-gray-500">{teacher.position}</div>
                              {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* 理论教研室 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">理论教研室</span>
                        <span className="font-medium text-gray-900">
                          {teachersData.filter(t => t && t.faculty_id === 'THEORY' && !t.remarks.includes('其它系教师')).length}人
                          {' ('}
                          {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.faculty_id === 'THEORY' && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                          {'%)'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className="h-3 rounded-full bg-purple-500 transition-all duration-500 ease-in-out"
                          style={{
                            width: `${(() => {
                              const total = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                              if (total === 0) return 0;
                              const count = teachersData.filter(t => t && t.faculty_id === 'THEORY' && !t.remarks.includes('其它系教师')).length;
                              return (count / total * 100).toFixed(1);
                            })()}%`
                          }}
                        ></div>
                      </div>
                      <div className="space-y-2">
                        {teachersData.filter(t => t && t.faculty_id === 'THEORY' && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                          <div key={teacher.id} className="flex items-center gap-2 p-2 bg-purple-50 rounded-lg">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-medium text-xs">
                              {teacher.name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                              <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                              <div className="text-xs text-gray-500">{teacher.position}</div>
                              {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900">
                      {activeFaculty === 'PIANO' ? '钢琴教研室' : 
                       activeFaculty === 'VOCAL' ? '声乐教研室' : 
                       activeFaculty === 'INSTRUMENT' ? '器乐教研室' : '理论教研室'}
                    </h4>
                    <span className="text-sm font-medium text-gray-700">
                      合计: {teachersData.filter(t => t && t.faculty_id === activeFaculty && !t.remarks.includes('其它系教师')).length}人
                      {' ('}
                      {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.faculty_id === activeFaculty && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                      {'%)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {teachersData.filter(t => t && t.faculty_id === activeFaculty && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                      <div key={teacher.id} className={`flex items-center gap-3 p-3 rounded-lg ${activeFaculty === 'PIANO' ? 'bg-blue-50' : activeFaculty === 'VOCAL' ? 'bg-green-50' : activeFaculty === 'INSTRUMENT' ? 'bg-orange-50' : 'bg-purple-50'}`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium ${activeFaculty === 'PIANO' ? 'bg-blue-500' : activeFaculty === 'VOCAL' ? 'bg-green-500' : activeFaculty === 'INSTRUMENT' ? 'bg-orange-500' : 'bg-purple-500'}`}>
                          {teacher.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{teacher.name}</div>
                          <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                          <div className="text-xs text-gray-500">{teacher.position}</div>
                          {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                        </div>
                        <div className="flex flex-col items-end">
                          <div className="text-xs text-gray-500">可教课程</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(teacher.can_teach_instruments || []).map((course, idx) => (
                              <span key={idx} className="px-2 py-0.5 text-xs rounded-full bg-white border border-gray-200 text-gray-600">
                                {course}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {teachersData.filter(t => t && t.faculty_id === activeFaculty).length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      该教研室暂无教师数据
                    </div>
                  )}
                </div>
              )}
            </div>
              </>
            )}
          
            {/* 职称分布内容 */}
            {activeDistribution === '职称分布' && (
              <>
                <div className="text-xs text-gray-500 mb-4">
                  数据范围：按职称分类展示教师分布情况
                </div>
                {/* 职称选项卡 */}
                <div className="mb-6">
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {/* 全部选项 */}
                <button
                  onClick={() => setActivePosition('ALL')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activePosition === 'ALL' ? 'bg-green-200 text-green-800 border border-green-300' : 'bg-green-100 text-green-700 border border-green-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  全部
                </button>
                {/* 教授选项 */}
                <button
                  onClick={() => setActivePosition('教授')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activePosition === '教授' ? 'bg-green-200 text-green-800 border border-green-300' : 'bg-green-100 text-green-700 border border-green-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  教授
                </button>
                {/* 副教授选项 */}
                <button
                  onClick={() => setActivePosition('副教授')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activePosition === '副教授' ? 'bg-blue-200 text-blue-800 border border-blue-300' : 'bg-blue-100 text-blue-700 border border-blue-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  副教授
                </button>
                {/* 讲师选项 */}
                <button
                  onClick={() => setActivePosition('讲师')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activePosition === '讲师' ? 'bg-orange-200 text-orange-800 border border-orange-300' : 'bg-orange-100 text-orange-700 border border-orange-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  讲师
                </button>
                {/* 助教选项 */}
                <button
                  onClick={() => setActivePosition('助教')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activePosition === '助教' ? 'bg-purple-200 text-purple-800 border border-purple-300' : 'bg-purple-100 text-purple-700 border border-purple-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  助教
                </button>
                {/* 博士选项 */}
                <button
                  onClick={() => setActivePosition('博士')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${activePosition === '博士' ? 'bg-indigo-200 text-indigo-800 border border-indigo-300' : 'bg-indigo-100 text-indigo-700 border border-indigo-200'} shadow-sm hover:shadow-md focus:outline-none`}
                >
                  博士
                </button>
              </div>
            </div>

            {/* 职称分布数据 */}
            <div className="space-y-4">
              {activePosition === 'ALL' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900">总计</h4>
                    <span className="text-sm font-medium text-gray-700">合计: {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length}人</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* 教授 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">教授</span>
                        <span className="font-medium text-gray-900">
                          {teachersData.filter(t => t && t.position === '教授' && !t.remarks.includes('其它系教师')).length}人
                          {' ('}
                          {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.position === '教授' && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                          {'%)'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className="h-3 rounded-full bg-green-500 transition-all duration-500 ease-in-out"
                          style={{
                            width: `${(() => {
                              const total = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                              if (total === 0) return 0;
                              const count = teachersData.filter(t => t && t.position === '教授' && !t.remarks.includes('其它系教师')).length;
                              return (count / total * 100).toFixed(1);
                            })()}%`
                          }}
                        ></div>
                      </div>
                      <div className="space-y-2">
                        {teachersData.filter(t => t && t.position === '教授' && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                          <div key={teacher.id} className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white font-medium text-xs">
                              {teacher.name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                              <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                              <div className="text-xs text-gray-500">{teacher.faculty_name}</div>
                              {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* 副教授 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">副教授</span>
                        <span className="font-medium text-gray-900">
                          {teachersData.filter(t => t && t.position === '副教授' && !t.remarks.includes('其它系教师')).length}人
                          {' ('}
                          {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.position === '副教授' && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                          {'%)'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className="h-3 rounded-full bg-blue-500 transition-all duration-500 ease-in-out"
                          style={{
                            width: `${(() => {
                              const total = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                              if (total === 0) return 0;
                              const count = teachersData.filter(t => t && t.position === '副教授' && !t.remarks.includes('其它系教师')).length;
                              return (count / total * 100).toFixed(1);
                            })()}%`
                          }}
                        ></div>
                      </div>
                      <div className="space-y-2">
                        {teachersData.filter(t => t && t.position === '副教授' && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                          <div key={teacher.id} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium text-xs">
                              {teacher.name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                              <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                              <div className="text-xs text-gray-500">{teacher.faculty_name}</div>
                              {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* 讲师 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">讲师</span>
                        <span className="font-medium text-gray-900">
                          {teachersData.filter(t => t && t.position === '讲师' && !t.remarks.includes('其它系教师')).length}人
                          {' ('}
                          {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.position === '讲师' && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                          {'%)'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className="h-3 rounded-full bg-orange-500 transition-all duration-500 ease-in-out"
                          style={{
                            width: `${(() => {
                              const total = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                              if (total === 0) return 0;
                              const count = teachersData.filter(t => t && t.position === '讲师' && !t.remarks.includes('其它系教师')).length;
                              return (count / total * 100).toFixed(1);
                            })()}%`
                          }}
                        ></div>
                      </div>
                      <div className="space-y-2">
                        {teachersData.filter(t => t && t.position === '讲师' && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                          <div key={teacher.id} className="flex items-center gap-2 p-2 bg-orange-50 rounded-lg">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white font-medium text-xs">
                              {teacher.name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                              <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                              <div className="text-xs text-gray-500">{teacher.faculty_name}</div>
                              {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* 助教 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">助教</span>
                        <span className="font-medium text-gray-900">
                          {teachersData.filter(t => t && t.position === '助教' && !t.remarks.includes('其它系教师')).length}人
                          {' ('}
                          {teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length > 0 ? ((teachersData.filter(t => t && t.position === '助教' && !t.remarks.includes('其它系教师')).length / teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length * 100).toFixed(1)) : 0}
                          {'%)'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className="h-3 rounded-full bg-purple-500 transition-all duration-500 ease-in-out"
                          style={{
                            width: `${(() => {
                              const total = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                              if (total === 0) return 0;
                              const count = teachersData.filter(t => t && t.position === '助教' && !t.remarks.includes('其它系教师')).length;
                              return (count / total * 100).toFixed(1);
                            })()}%`
                          }}
                        ></div>
                      </div>
                      <div className="space-y-2">
                        {teachersData.filter(t => t && t.position === '助教' && !t.remarks.includes('其它系教师')).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                          <div key={teacher.id} className="flex items-center gap-2 p-2 bg-purple-50 rounded-lg">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-medium text-xs">
                              {teacher.name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                              <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                              <div className="text-xs text-gray-500">{teacher.faculty_name}</div>
                              {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900">
                      {activePosition}
                    </h4>
                    <span className="text-sm font-medium text-gray-700">
                      合计: 
                      {activePosition === '博士' ? teachersData.filter(t => t && t.remarks && (t.remarks.includes('博士') || t.remarks.includes('D类博士')) && !t.remarks.includes('其它系教师')).length : teachersData.filter(t => t && t.position === activePosition && !t.remarks.includes('其它系教师')).length}
                      人
                      {' ('}
                      {(() => {
                        const totalTeachers = teachersData.filter(t => t && !t.remarks.includes('其它系教师')).length;
                        if (totalTeachers === 0) return 0;
                        if (activePosition === '博士') {
                          const count = teachersData.filter(t => t && t.remarks && (t.remarks.includes('博士') || t.remarks.includes('D类博士')) && !t.remarks.includes('其它系教师')).length;
                          return (count / totalTeachers * 100).toFixed(1);
                        } else {
                          const count = teachersData.filter(t => t && t.position === activePosition && !t.remarks.includes('其它系教师')).length;
                          return (count / totalTeachers * 100).toFixed(1);
                        }
                      })()}
                      {'%)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {(activePosition === '博士' ? teachersData.filter(t => t && t.remarks && (t.remarks.includes('博士') || t.remarks.includes('D类博士')) && !t.remarks.includes('其它系教师')) : teachersData.filter(t => t && t.position === activePosition && !t.remarks.includes('其它系教师'))).sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || '')).map((teacher, index) => (
                      <div key={teacher.id} className={`flex items-center gap-3 p-3 rounded-lg ${activePosition === '教授' ? 'bg-green-50' : activePosition === '副教授' ? 'bg-blue-50' : activePosition === '讲师' ? 'bg-orange-50' : activePosition === '助教' ? 'bg-purple-50' : 'bg-indigo-50'}`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium ${activePosition === '教授' ? 'bg-green-500' : activePosition === '副教授' ? 'bg-blue-500' : activePosition === '讲师' ? 'bg-orange-500' : activePosition === '助教' ? 'bg-purple-500' : 'bg-indigo-500'}`}>
                          {teacher.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{teacher.name}</div>
                          <div className="text-xs text-gray-500">{teacher.teacher_id}</div>
                          <div className="text-xs text-gray-500">{teacher.faculty_name}</div>
                          {teacher.remarks && <div className="text-xs text-gray-500 mt-1">备注: {teacher.remarks}</div>}
                        </div>
                        <div className="flex flex-col items-end">
                          <div className="text-xs text-gray-500">可教课程</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(teacher.can_teach_instruments || []).map((course, idx) => (
                              <span key={idx} className="px-2 py-0.5 text-xs rounded-full bg-white border border-gray-200 text-gray-600">
                                {course}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(activePosition === '博士' ? teachersData.filter(t => t && t.remarks && (t.remarks.includes('博士') || t.remarks.includes('D类博士')) && !t.remarks.includes('其它系教师')).length : teachersData.filter(t => t && t.position === activePosition && !t.remarks.includes('其它系教师')).length) === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      {activePosition === '博士' ? '暂无标记为博士的教师数据' : '该职称暂无教师数据'}
                    </div>
                  )}
                </div>
              )}
            </div>
              </>
            )}
              </div>
            </>
          )}
        </div>
      </div>


      {/* 底部统计信息 */}
      <div className="mt-6 flex items-center justify-between text-sm text-gray-500">
        <div className="flex items-center gap-4">
          <span>最后更新: {new Date().toLocaleString('zh-CN')}</span>
          {refreshing && (
            <span className="flex items-center gap-1 text-blue-600">
              <RefreshCw className="w-4 h-4 animate-spin" />
              正在刷新数据...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span>系统运行正常</span>
        </div>
      </div>

      {/* 底部系统健康度 */}
      {systemHealth.score > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-600" />
              系统状态: {getHealthStatusText(systemHealth.status)} (分数: {systemHealth.score}/100)
            </h4>
          </div>
          {(systemHealth.issues.length > 0 || systemHealth.suggestions.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {systemHealth.issues.length > 0 && (
                <div>
                  <h5 className="font-medium text-red-600 mb-1">需要关注:</h5>
                  <ul className="space-y-1">
                    {systemHealth.issues.slice(0, 2).map((issue, index) => (
                      <li key={index} className="text-red-500">• {issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {systemHealth.suggestions.length > 0 && (
                <div>
                  <h5 className="font-medium text-blue-600 mb-1">优化建议:</h5>
                  <ul className="space-y-1">
                    {systemHealth.suggestions.slice(0, 2).map((suggestion, index) => (
                      <li key={index} className="text-blue-500">• {suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 禁排时间管理模块 - 管理员和教师都可见 */}
      {(isAdmin || teacher) && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-purple-600" />
              <h3 className="text-lg font-semibold text-gray-900">禁排时间管理</h3>
            </div>
            <div className="flex items-center gap-2">
              {blockedTimesLoaded && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" />
                  数据已缓存 ({blockedTimesData.length} 条)
                </span>
              )}
              <button
                onClick={refreshBlockedTimes}
                disabled={blockedTimesLoading}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${blockedTimesLoading ? 'animate-spin' : ''}`} />
                刷新数据
              </button>
            </div>
          </div>
          {isAdmin && <BlockedTimesImport />}
          <div className="mt-4">
            <BlockedTimesList isAdmin={isAdmin} />
          </div>
        </div>
      )}
    </div>
  );
}
