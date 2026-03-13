/**
 * 排课页面
 * 支持班级选择、学生分组勾选、拖拽排课和分组验证
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useBlockedTime } from '../contexts/BlockedTimeContext';
import { supabase } from '../services/supabase';
import { courseService, studentService, scheduleService, teacherService, roomService, classService, largeClassScheduleService, blockedSlotService, weekConfigService, operationLogService } from '../services';
import websocketService from '../services/websocketService';
import { calculateSemesterNumber, getCoursesForClass } from '../utils/courseAssignment';
import { v4 as uuidv4 } from 'uuid';
import { exportUtils, standardExportUtils } from '../utils/excel';

import {
  Calendar,
  Clock,
  Users,
  BookOpen,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Save,
  Trash2,
  GripVertical,
  Info,
  GraduationCap,
  Building,
  Copy,
  Download,
  Zap,
  X,
  CalendarDays,
  Plus,
  Search,
  FileSpreadsheet
} from 'lucide-react';
import type { Course, Student, ScheduledClass, Room } from '../types';
import {
  PERIOD_CONFIG,
  ACADEMIC_YEARS,
  generateSemesterOptions,
  getRequiredHours,
  calculateClassHours,
  getCourseCredit,
  getTeacherRoomByFaculty,
  getFacultyCodeForInstrument,
  getFacultyDisplayName,
  generateWeekNumbers,
  INSTRUMENT_TO_FACULTY
} from '../types';

// 班级类型定义
interface Class {
  id: string;
  class_id: string;
  class_name: string;
  enrollment_year: number;
  class_number: number;
  student_count: number;
  student_type: 'general' | 'upgrade';
  status: 'active' | 'inactive';
  created_at: string;
}

// 星期标签
const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
];

/** 同一课程、同一批学生（学号集合相同，顺序无关）始终得到同一个 group_id，避免删了再排产生多个 group_id */
async function getDeterministicGroupId(courseId: string, studentIds: string[]): Promise<string> {
  const sorted = studentIds.slice().sort();
  const key = `${courseId}|${sorted.join(',')}`;

  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    // 不支持 crypto.subtle 时使用简单哈希，仍然保证同一批学生得到同一个 group_id
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return 'g_' + hash.toString(16).padStart(8, '0');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return 'g_' + hashHex.slice(0, 32);
}

/** 课程任课教师为指定教师时返回 true（跨教研室也显示，如理论教研室教师被分配钢琴小组课） */
function isCourseAssignedToTeacher(course: any, effectiveTeacher: any): boolean {
  if (!effectiveTeacher) return false;
  const teacherName = effectiveTeacher?.name || '';
  const teacherId = effectiveTeacher?.id ?? effectiveTeacher?.teacher_id;
  return !!(
    (course?.teacher_id && (course.teacher_id === teacherId || course.teacher_id === effectiveTeacher?.teacher_id)) ||
    (course?.teacher_name && (course.teacher_name === teacherName || (teacherName && course.teacher_name.includes(teacherName))))
  );
}

// 可混排的乐器组：组内不同专业视为同一类，允许混合编组（如葫芦丝与竹笛可混排）
const MIXABLE_INSTRUMENT_GROUPS: string[][] = [['葫芦丝', '竹笛']];
const canMixMajors = (a: string | undefined, b: string | undefined): boolean => {
  if (!a || !b) return true;
  if (a === b) return true;
  for (const group of MIXABLE_INSTRUMENT_GROUPS) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
};
const getMajorGroupKey = (major: string | undefined): string => {
  if (!major) return major || '';
  for (const group of MIXABLE_INSTRUMENT_GROUPS) {
    if (group.includes(major)) return group[0];
  }
  return major;
};

// 大组乐器：普通班全部为副项时允许最多 8 人，其它情况最多 4 人（与古筝、葫芦丝、竹笛规则一致，仅此一份，三处校验共用）
const LARGE_GROUP_INSTRUMENTS = ['古筝', '葫芦丝', '竹笛', '双排键'];

// 排课显示类型（包含课程、学生和琴房信息）
interface ScheduledClassDisplay {
  id: string;
  day_of_week: number;
  period: number;
  course_id?: string;
  course_name: string;
  course_type: string;
  teacher_id?: string;
  teacher_name?: string;
  student_id?: string;
  student_name: string;
  room_id?: string;    // 琴房ID
  room_name?: string;  // 琴房名称
  class_name?: string;  // 班级名称
  start_week?: number;  // 开始周次
  end_week?: number;    // 结束周次
  group_id?: string;    // 小组ID
}

interface StudentGroup {
  id: string;
  students: Student[];
  courseType: '钢琴' | '声乐' | '器乐';
  isValid: boolean;
  message: string;
}

export default function ArrangeClass() {
  const { user, teacher, isAdmin, refreshTeacher, onlineTeachers, refreshOnlineTeachers } = useAuth();
  const { refreshBlockedTimes, hasLoaded: blockedTimesLoaded } = useBlockedTime();
  const [blockedTimesSchedulingReady, setBlockedTimesSchedulingReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 目标教师状态 - 关键修改
  const [targetTeacher, setTargetTeacher] = useState<Teacher | null>(null);
  const [availableTeachers, setAvailableTeachers] = useState<Teacher[]>([]);

  // 辅助函数：获取有效的教师ID（优先使用teacher，其次使用user）
  // 注意：这里返回的是教师工号（teacher_id），用于匹配 scheduled_classes.teacher_id
  const getEffectiveTeacherId = useCallback(() => {
    // 统一返回教师工号（现在教师的id字段就是工号）
    return targetTeacher?.id || teacher?.id || user?.teacher_id;
  }, [targetTeacher, teacher, user]);

  // 辅助函数：获取有效的教师工号（优先使用teacher，其次使用user）
  const getEffectiveTeacherNumber = useCallback(() => {
    // 统一返回教师工号
    return targetTeacher?.id || teacher?.id || user?.teacher_id;
  }, [targetTeacher, teacher, user]);

  // 辅助函数：获取有效的教师名称（优先使用teacher，其次使用user）
  const getEffectiveTeacherName = useCallback(() => {
    return targetTeacher?.name || teacher?.name || user?.full_name;
  }, [targetTeacher, teacher, user]);

  // 辅助函数：获取有效的教师对象（优先使用targetTeacher，其次使用teacher，最后使用user构建）
  const getEffectiveTeacher = useCallback(() => {
    if (targetTeacher) return targetTeacher;
    if (teacher) return teacher;
    if (user) {
      // 使用user对象构建一个临时的教师对象
      const tempTeacher: Teacher = {
        id: user.teacher_id,
        teacher_id: user.teacher_id,
        name: user.full_name,
        email: user.email,
        faculty_id: user.faculty_id,
        faculty_name: user.faculty_name,
        specialty: user.specialty,
        max_students: user.max_students,
        created_at: user.created_at,
        updated_at: user.updated_at
      };
      return tempTeacher;
    }
    return null;
  }, [targetTeacher, teacher, user]);

  // 统一规范教师ID为字符串，避免 number/string 不一致导致匹配失败
  const normalizeTeacherId = (id: any): string => {
    if (id === null || id === undefined) return '';
    return String(id).trim();
  };

  // 获取当前教师工号集合（仅使用 teacher_id，避免多种ID混淆）
  const getCurrentTeacherIdSet = (): Set<string> => {
    const ids = [
      (targetTeacher as any)?.teacher_id,
      (teacher as any)?.teacher_id,
    ];
    return new Set(ids.map(normalizeTeacherId).filter(Boolean));
  };

  // 判断某条排课记录是否属于当前教师（仅按教师工号匹配）
  const isCurrentTeacherSchedule = (sc: any, teacherIdSet?: Set<string>): boolean => {
    const set = teacherIdSet ?? getCurrentTeacherIdSet();
    if (!set || set.size === 0) return false;
    const tid = normalizeTeacherId(sc.teacher_id);
    return !!tid && set.has(tid);
  };

  // 选择状态
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState('2025-2026');
  const [selectedSemesterLabel, setSelectedSemesterLabel] = useState('2025-2026-2');
  const [selectedMajor, setSelectedMajor] = useState<'钢琴' | '声乐' | '器乐' | 'all'>('all');
  const [selectedSecondary, setSelectedSecondary] = useState<boolean>(false); // 是否只显示有副项的学生
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    return monday;
  });

  // 数据状态
  const [students, setStudents] = useState<Student[]>([]);
  const [myStudents, setMyStudents] = useState<Student[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [scheduledClasses, setScheduledClasses] = useState<ScheduledClassDisplay[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);  // 添加rooms状态
  const [myRooms, setMyRooms] = useState<Room[]>([]);  // 添加myRooms状态
  const [fixedRooms, setFixedRooms] = useState<Array<{ room: Room | null; facultyCode: string }>>([]);
  const [hasScheduleData, setHasScheduleData] = useState(false);

  // 学生进度状态将通过 useMemo 计算，不再需要 useState

  // 存储已排课的学生ID集合
  const [scheduledStudentIds, setScheduledStudentIds] = useState<Set<string>>(new Set());

  // 学生分组状态
  const [studentGroups, setStudentGroups] = useState<StudentGroup[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [selectedCourseType, setSelectedCourseType] = useState<'钢琴' | '声乐' | '器乐'>('器乐');
  const [selectedCourseName, setSelectedCourseName] = useState<string>('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [selectedCourseClassId, setSelectedCourseClassId] = useState<string>('');
  // 教室选择状态
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  // 当前小组的主要专业类型
  const [groupMajorType, setGroupMajorType] = useState<'钢琴' | '声乐' | '器乐'>('器乐');
  
  // 排课安排状态
  const [pendingSchedules, setPendingSchedules] = useState<Array<{dayOfWeek: number; period: number; students: Student[]; courseType: string}>>([]); // 待保存的排课安排

  // 三框式界面状态
  const [primaryStudents, setPrimaryStudents] = useState<Student[]>([]); // 主项学生
  const [secondaryStudents, setSecondaryStudents] = useState<Student[]>([]); // 副项学生
  const [groupStudents, setGroupStudents] = useState<Student[]>([]); // 小组学生
  const [studentSources, setStudentSources] = useState<Map<string, 'primary' | 'secondary'>>(new Map()); // 学生来源信息

  // 筛选状态
  const [primaryFilters, setPrimaryFilters] = useState({ grade: '', className: '' });
  const [secondaryFilters, setSecondaryFilters] = useState({ grade: '', className: '' });

  // 小组课时管理状态
  const [groupProgress, setGroupProgress] = useState<{[groupKey: string]: {
    completedHours: number;
    remainingHours: number;
    progress: number;
    totalHours: number;
  }}>({});
  
  // 小组课数据
  const [groupCourses, setGroupCourses] = useState<any[]>([]);
  // 小组课分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  // 三级筛选器状态
  const [selectedClassType, setSelectedClassType] = useState<string>('all'); // 班级类型：all/general/upgrade
  const [selectedGrade, setSelectedGrade] = useState<string>('all'); // 年级：all/2023/2024/2025等
  const [selectedClassId, setSelectedClassId] = useState<string>(''); // 选中的班级ID
  
  // 排课模式状态
  const [schedulingMode, setSchedulingMode] = useState<'group' | 'major'>('group'); // 排课模式：group-小组课，major-专业大课
  const [selectedClassesForMajor, setSelectedClassesForMajor] = useState<string[]>([]); // 专业大课选中的班级
  const [selectedRoomForMajor, setSelectedRoomForMajor] = useState<string>(''); // 专业大课选择的教室
  const [showMajorClassScheduleModal, setShowMajorClassScheduleModal] = useState(false); // 专业大课排课对话框
  const [currentMajorCourse, setCurrentMajorCourse] = useState<any>(null); // 当前正在排课的专业大课
  
  // 专业大课排课界面状态
  const [showMajorClassScheduleInterface, setShowMajorClassScheduleInterface] = useState(false); // 是否显示专业大课排课界面
  const [selectedWeekForMajor, setSelectedWeekForMajor] = useState<number | null>(null); // 选中的周次
  const [selectedDayForMajor, setSelectedDayForMajor] = useState<number | null>(null); // 选中的星期
  const [selectedPeriodForMajor, setSelectedPeriodForMajor] = useState<number[]>([]); // 选中的节次（多选）
  const [weekConflicts, setWeekConflicts] = useState<Set<number>>(new Set()); // 周次冲突
  const [dayConflicts, setDayConflicts] = useState<Set<number>>(new Set()); // 星期冲突
  const [periodConflicts, setPeriodConflicts] = useState<Set<number>>(new Set()); // 节次冲突

  // 提示状态
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // 从智能分配同步数据
  const handleSyncFromSmartAssignment = useCallback(async () => {
    try {
      setSaving(true);

      
      // 调用同步方法
      await courseService.syncFromSmartAssignment();
      
      // 重新加载课程数据
      const [coursesData] = await Promise.all([
        courseService.getAll()
      ]);
      setCourses(coursesData || []);
      
      // 显示同步成功通知
      showToast('success', `从智能分配同步完成：创建了 ${result.created} 个新课程，更新了 ${result.updated} 个现有课程，总计处理 ${result.total} 条记录`);
      
    } catch (error) {
      console.error('同步失败:', error);
      showToast('error', '同步失败，请检查控制台错误信息');
    } finally {
      setSaving(false);
    }
  }, []);



  // 周次选择状态
  const [selectedWeekRange, setSelectedWeekRange] = useState<{ startWeek: number; endWeek: number }>({
    startWeek: 1,
    endWeek: 16
  });
  const [totalWeeks, setTotalWeeks] = useState(16);
  const [semesterStartDate, setSemesterStartDate] = useState<string>('');
  
  // 排课时间相关状态
  const [selectedWeek, setSelectedWeek] = useState(1);
  
  // 排课时间网格状态
  const [timeGridStatus, setTimeGridStatus] = useState<Array<Array<{status: 'available' | 'scheduled' | 'blocked', courseId?: string}>>>([]);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<Array<{week: number, day: number, period: number}>>([]);
  
  // 时间选择模式（默认为批量选择）
  const [selectionMode, setSelectionMode] = useState<'single' | 'range' | 'batch'>('batch');
  
  // 框选模式状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{day: number, period: number} | null>(null);
  const [dragEnd, setDragEnd] = useState<{day: number, period: number} | null>(null);
  
  // 批量模式状态
  const [batchWeeks, setBatchWeeks] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  const [batchDay, setBatchDay] = useState<number>(2);
  const [batchPeriods, setBatchPeriods] = useState<number[]>([4]);
  
  // 通适大课状态
  const [largeClassEntries, setLargeClassEntries] = useState<any[]>([]);

  // 统一格式的禁排时间列表（参考专业大课页面）
  const [unifiedBlockedTimes, setUnifiedBlockedTimes] = useState<any[]>([]);

  // 冲突检测状态
  const [conflicts, setConflicts] = useState<Array<{week: number, day: number, period: number, type: 'room' | 'time' | 'class', message: string, suggestion: string}>>([]);
  
  // 一键复制选项
  const [copyOptions, setCopyOptions] = useState({
    weeks2_5: true,
    weeks7_10: true,
    weeks11_14: true,
    weeks15_17: true
  });

  // 辅助函数：通过内部ID或课程编号查找课程
  const findCourseById = (coursesList: any[], courseId: string) => {
    return coursesList.find(c => c.id === courseId || (c as any).course_id === courseId);
  };

  // 辅助函数：判断排课记录是否为专业大课或理论课（通过course_id关联课程数据判断）
  const isMajorClassSchedule = (sc: any, coursesList?: any[]): boolean => {
    const courseList = coursesList || courses;
    // 通过course_id关联课程数据，判断是否为专业大课
    const course = courseList?.find ? courseList.find(c => c.id === sc.course_id) : null;
    return course?.teaching_type === '专业大课' || 
           course?.teaching_type === '理论课' ||
           (sc as any).teaching_type === '专业大课' || 
           (sc as any).course_type === '专业大课' ||
           (sc as any).teaching_type === '理论课' ||
           (sc as any).course_type === '理论课';
  };

  // 检查禁排是否匹配当前班级（支持全班级：无 class_name/class_associations 即匹配所有）
  const isBlockedMatchClass = (slot: any, currentClassOrClasses?: string | string[]): boolean => {
    const classNames = slot.class_name ? (typeof slot.class_name === 'string' ? slot.class_name.split(/[,，]/).map((s: string) => s.trim()) : []) : [];
    const assocNames = (slot.class_associations || []).map((a: any) => (typeof a === 'string' ? a : a?.name) || '').filter(Boolean);
    const hasClassFilter = classNames.length > 0 || assocNames.length > 0;
    if (!hasClassFilter) return true; // 全班级禁排
    const classes = Array.isArray(currentClassOrClasses) ? currentClassOrClasses : (currentClassOrClasses ? [currentClassOrClasses] : []);
    if (classes.length === 0) return false;
    const match = (n: string) => n && classes.some(c => c && (c.includes(n) || n.includes(c)));
    return classNames.some(match) || assocNames.some(match);
  };

  // 检查周次是否为全周禁排（使用统一格式 unifiedBlockedTimes）
  const isWeekFullyBlocked = (week: number, blockedTimes: any[] = [], currentClass?: string): boolean => {
    // 统一格式：检查该周是否所有 (day, period) 都被禁排
    const blockedSet = new Set<string>();
    blockedTimes.forEach((slot: any) => {
      if (!isBlockedMatchClass(slot, currentClass)) return;
      const weeks = Array.isArray(slot.weeks) ? slot.weeks : [];
      if (!weeks.includes(week)) return;
      const day = slot.day_of_week !== undefined ? slot.day_of_week : slot.day;
      if (!day || !slot.periods) return;
      (slot.periods || []).forEach((p: number) => blockedSet.add(`${day}-${p}`));
    });
    for (let d = 1; d <= 7; d++) {
      for (let p = 1; p <= 10; p++) {
        if (!blockedSet.has(`${d}-${p}`)) return false;
      }
    }
    return blockedSet.size > 0;
  };

  // 检查周次是否有部分禁排（使用统一格式）
  const hasWeekPartialBlock = (week: number, blockedTimes: any[] = [], currentClass?: string): boolean => {
    if (isWeekFullyBlocked(week, blockedTimes, currentClass)) return false;
    return blockedTimes.some((slot: any) => {
      if (!isBlockedMatchClass(slot, currentClass)) return false;
      const weeks = Array.isArray(slot.weeks) ? slot.weeks : [];
      return weeks.includes(week);
    });
  };

  // 检查周次是否在禁排范围内
  const isWeekBlocked = (week: number, blockedTimes: any[] = [], currentClass?: string): boolean => {
    return isWeekFullyBlocked(week, blockedTimes, currentClass);
  };

  // 使用专业大课禁排数据检查周次是否有禁排（用于周次选择器）
  const checkWeekBlockedStatus = useCallback((week: number, currentClass?: string): { fullyBlocked: boolean; partiallyBlocked: boolean } => {
    if (!currentClass) {
      return { fullyBlocked: false, partiallyBlocked: false };
    }

    // 从统一的禁排时间列表中获取数据（支持全班级：无 class_name 即匹配所有）
    const classBlockedTimes = unifiedBlockedTimes.filter((b: any) => isBlockedMatchClass(b, currentClass));

    // 检查该周是否有禁排数据
    const weekBlockedTimes = classBlockedTimes.filter((b: any) =>
      b.weeks && b.weeks.includes(week)
    );

    if (weekBlockedTimes.length === 0) {
      return { fullyBlocked: false, partiallyBlocked: false };
    }

    // 按天分组，检查每天的禁排节次（统一 day_of_week ?? day）
    const dayPeriods: Map<number, Set<number>> = new Map();
    weekBlockedTimes.forEach((b: any) => {
      const d = b.day_of_week !== undefined ? b.day_of_week : b.day;
      if (d && b.periods && Array.isArray(b.periods)) {
        if (!dayPeriods.has(d)) dayPeriods.set(d, new Set());
        b.periods.forEach((p: number) => dayPeriods.get(d)?.add(p));
      }
    });

    // 如果没有有效的禁排数据
    if (dayPeriods.size === 0) {
      return { fullyBlocked: false, partiallyBlocked: false };
    }

    // 检查是否所有天都被全天禁排（所有10节课都被禁排才算全天）
    let fullDaysCount = 0;
    dayPeriods.forEach((periods, day) => {
      // 如果某天有10节课被禁排（全天），则计为全天禁排
      if (periods.size >= 10) {
        fullDaysCount++;
      }
    });

    // 全周禁排：一周7天，每天都有全天禁排
    const fullyBlocked = fullDaysCount === 7;
    // 部分禁排：有禁排数据，但不是全周禁排
    const partiallyBlocked = !fullyBlocked && dayPeriods.size > 0;

    return { fullyBlocked, partiallyBlocked };
  }, [unifiedBlockedTimes]);

  // 检查周次是否有通适大课禁排（用于周次选择的视觉提示）
  const hasLargeClassInWeek = useCallback((week: number, currentClass?: string): boolean => {
    return largeClassEntries.some(entry => {
      // 检查班级是否匹配
      if (currentClass && entry.class_name !== currentClass) {
        return false;
      }

      // 解析周次范围
      const weekRange = entry.week_range || '';
      const weeks: number[] = [];

      // 处理格式如 "1-17" 或 "1,2,3" 或 "1-5,7-10"
      const parts = weekRange.split(',');
      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(Number);
          for (let w = start; w <= end; w++) {
            weeks.push(w);
          }
        } else {
          const w = Number(part);
          if (!isNaN(w)) {
            weeks.push(w);
          }
        }
      }

      return weeks.includes(week);
    });
  }, [largeClassEntries]);

  // 检查特定时段是否有通适大课禁排
  const isBlockedByLargeClass = useCallback((week: number, day: number, period: number, currentClass?: string): boolean => {
    return largeClassEntries.some(entry => {
      // 检查班级是否匹配
      if (currentClass && entry.class_name !== currentClass) {
        return false;
      }

      // 检查星期是否匹配
      if (entry.day_of_week !== day) {
        return false;
      }

      // 检查节次是否匹配
      if (period < entry.period_start || period > entry.period_end) {
        return false;
      }

      // 解析周次范围
      const weekRange = entry.week_range || '';
      const weeks: number[] = [];

      // 处理格式如 "1-17" 或 "1,2,3" 或 "1-5,7-10"
      const parts = weekRange.split(',');
      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(Number);
          for (let w = start; w <= end; w++) {
            weeks.push(w);
          }
        } else {
          const w = Number(part);
          if (!isNaN(w)) {
            weeks.push(w);
          }
        }
      }

      return weeks.includes(week);
    });
  }, [largeClassEntries]);

  // 同步所有禁排数据到统一格式（单一来源：仅导入禁排 + 通适大课，不再使用 blockedSlots）
  const syncBlockedTimes = useCallback(() => {
    try {
      const allBlockedTimes: any[] = [];

      // 1. 导入禁排（单一来源，来自 BlockedTimeContext 写入的 localStorage）
      const importedBlockedTimes = JSON.parse(localStorage.getItem('music_scheduler_imported_blocked_times') || '[]');
      importedBlockedTimes.forEach((b: any) => {
        const weeks = Array.isArray(b.weeks) ? b.weeks : [];
        const day = b.day_of_week !== undefined ? b.day_of_week : b.day;
        const periods = Array.isArray(b.periods) ? b.periods : [];
        if (weeks.length > 0 && day && periods.length > 0) {
          allBlockedTimes.push({
            class_name: b.class_name,
            class_associations: b.class_associations,
            // 保留教师信息，用于按照教师维度禁排
            teacher_name: b.teacher_name,
            weeks,
            day,
            day_of_week: day,
            periods,
            reason: b.reason || '禁排时间'
          });
        }
      });

      // 2. 处理通适大课数据
      if (largeClassEntries.length > 0) {
        largeClassEntries.forEach((entry: any) => {
          const className = entry.class_name || entry.class_id;
          if (!className) return;

          // 解析周次范围
          const weeks: number[] = [];
          const weekRange = entry.week_range || entry.weeks;
          if (weekRange) {
            const cleanWeekRange = weekRange.replace(/周/g, '');
            const parts = cleanWeekRange.split(/[,，]/);
            parts.forEach((part: string) => {
              const trimmed = part.trim();
              if (trimmed.includes('-')) {
                const [start, end] = trimmed.split('-').map((s: string) => parseInt(s.trim()));
                if (!isNaN(start) && !isNaN(end)) {
                  for (let i = start; i <= end; i++) {
                    weeks.push(i);
                  }
                }
              } else {
                const weekNum = parseInt(trimmed);
                if (!isNaN(weekNum)) {
                  weeks.push(weekNum);
                }
              }
            });
          }

          // 解析节次
          const periods: number[] = [];
          const periodStart = entry.period_start ?? entry.start_period ?? entry.period;
          const periodEnd = entry.period_end ?? entry.end_period ?? entry.period;

          if (periodStart !== undefined && periodEnd !== undefined) {
            const start = Number(periodStart);
            const end = Number(periodEnd);
            if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0) {
              for (let i = start; i <= end; i++) {
                periods.push(i);
              }
            }
          } else if (periodStart !== undefined) {
            const start = Number(periodStart);
            if (!isNaN(start) && start > 0) {
              periods.push(start);
            }
          }

          if (weeks.length > 0 && periods.length > 0 && entry.day_of_week) {
            allBlockedTimes.push({
              class_name: className,
              // 通适大课对应的授课教师（可能为多位教师，以逗号分隔）
              teacher_name: entry.teacher_name,
              weeks: [...new Set(weeks)].sort((a, b) => a - b),
              day: entry.day_of_week,
              periods: [...new Set(periods)].sort((a, b) => a - b),
              reason: entry.course_name ? `${entry.course_name}（通适大课）` : '通适大课'
            });
          }
        });
      }



      setUnifiedBlockedTimes(allBlockedTimes);

    } catch (error) {
      console.error('同步禁排数据失败:', error);
    }
  }, [largeClassEntries]);

  // 初始化时间网格（单一来源：使用 unifiedBlockedTimes）
  const initializeTimeGrid = useCallback(async () => {
    try {
      const currentClass = groupStudents.length > 0 ? (groupStudents[0].major_class || groupStudents[0].class_name || '') : '';
      const allClasses = groupStudents.length > 0 ? Array.from(new Set(groupStudents.map((s: any) => s.major_class || s.class_name || '').filter((c: string) => c))) : [];
      const effectiveTeacherName = (targetTeacher?.name || teacher?.name || '').trim();

      // 预计算占用/禁排集合，避免在 7x10 循环内重复遍历大数组，降低 CPU 占用
      const teacherIdSet = getCurrentTeacherIdSet();
      const teacherSlotSet = new Set<string>();
      const studentSlotSet = new Set<string>();
      const majorClassSlotSet = new Set<string>();
      const blockedSlotSet = new Set<string>();

      scheduledClasses.forEach((sc: any) => {
        const key = `${sc.day_of_week}_${sc.period}`;
        const weekInRange = !sc.start_week || !sc.end_week || (selectedWeek >= (sc.start_week || 0) && selectedWeek <= (sc.end_week || 99));
        if (!weekInRange) return;
        if (teacherIdSet.size > 0 && isCurrentTeacherSchedule(sc, teacherIdSet)) teacherSlotSet.add(key);
        if (groupStudents.length > 0 && groupStudents.some(s => s.id === sc.student_id)) studentSlotSet.add(key);
        if (groupStudents.length > 0 && isMajorClassSchedule(sc) && (sc.class_id || (sc as any).class_name)) {
          const scClassName = sc.class_id || (sc as any).class_name;
          const scClassNumber = scClassName.replace(/[^0-9]/g, '');
          const match = allClasses.some((cn: string) => scClassNumber === cn.replace(/[^0-9]/g, '') || scClassName.includes(cn) || cn.includes(scClassName));
          if (match) majorClassSlotSet.add(key);
        }
      });
      unifiedBlockedTimes.forEach((slot: any) => {
        const weeks = Array.isArray(slot.weeks) ? slot.weeks : [];
        if (weeks.length > 0 && !weeks.includes(selectedWeek)) return;

        const d = slot.day_of_week !== undefined ? slot.day_of_week : slot.day;
        const periods = slot.periods || [];
        if (!d || periods.length === 0) return;

        // 1）按班级维度匹配禁排
        const classMatches = isBlockedMatchClass(slot, allClasses.length > 0 ? allClasses : currentClass);

        // 2）按教师维度匹配禁排（例如：教师在该时段上通适大课或专业大课）
        let teacherMatches = false;
        if (effectiveTeacherName && slot.teacher_name) {
          const teacherNames = String(slot.teacher_name)
            .split(/[,，、]/)
            .map((n: string) => n.trim())
            .filter(Boolean);
          teacherMatches = teacherNames.includes(effectiveTeacherName);
        }

        if (!classMatches && !teacherMatches) return;

        periods.forEach((p: number) => blockedSlotSet.add(`${d}_${p}`));
      });

      const grid = [];
      for (let day = 0; day < 7; day++) {
        const dayRow = [];
        for (let period = 0; period < 10; period++) {
          const key = `${day + 1}_${period + 1}`;
          let isBlocked = blockedSlotSet.has(key) || isPeriodBlocked(day + 1, period + 1) || teacherSlotSet.has(key) || studentSlotSet.has(key) || majorClassSlotSet.has(key);

          if (!isBlocked && groupStudents.length > 0 && allClasses.length > 0 && unifiedBlockedTimes.length > 0) {
            const allClassesBlockedTimes = unifiedBlockedTimes.filter((b: any) => {
              const blockedClassName = b.class_name;
              return blockedClassName && allClasses.some((className: string) => blockedClassName.includes(className));
            });
            isBlocked = allClassesBlockedTimes.some((blockedTime: any) => {
              const d = blockedTime.day_of_week !== undefined ? blockedTime.day_of_week : blockedTime.day;
              if (d !== day + 1) return false;
              return (blockedTime.periods || []).includes(period + 1);
            });
          }

          dayRow.push({ status: isBlocked ? 'blocked' : 'available' });
        }
        grid.push(dayRow);
      }
      setTimeGridStatus(grid);
    } catch (error) {
      console.error('初始化时间网格失败:', error);
      // 失败时使用默认值
      const grid = [];
      for (let day = 0; day < 7; day++) {
        const dayRow = [];
        for (let period = 0; period < 10; period++) {
          // 即使初始化失败，也要检查禁排时段
          const isBlocked = isPeriodBlocked(day + 1, period + 1);
          dayRow.push({ status: isBlocked ? 'blocked' : 'available' });
        }
        grid.push(dayRow);
      }
      setTimeGridStatus(grid);
    }
  }, [unifiedBlockedTimes, selectedWeek, groupStudents, scheduledClasses, targetTeacher, teacher]);

  // 检查时段是否可用（同步版本，用于批量选择）
  const isSlotAvailableSync = (day: number, period: number, week: number) => {
    // 获取当前选中的班级信息（支持混合小组，获取所有班级）
    const allClasses = groupStudents.length > 0 
      ? Array.from(new Set(groupStudents.map(s => s.major_class || s.class_name || '').filter(c => c)))
      : [];

    // 检查全周禁排周次
    const weekBlockedStatus = checkWeekBlockedStatus(week, allClasses.join(','));
    if (weekBlockedStatus.fullyBlocked) {
      return false;
    }

    // 检查班级 / 教师的专业大课禁排时间数据（支持全班级，统一 day_of_week ?? day）
    if (unifiedBlockedTimes.length > 0) {
      const effectiveTeacherName = (targetTeacher?.name || teacher?.name || '').trim();
      const allClassesBlockedTimes = unifiedBlockedTimes.filter((b: any) => {
        const classMatches = isBlockedMatchClass(b, allClasses);

        let teacherMatches = false;
        if (effectiveTeacherName && b.teacher_name) {
          const teacherNames = String(b.teacher_name)
            .split(/[,，、]/)
            .map((n: string) => n.trim())
            .filter(Boolean);
          teacherMatches = teacherNames.includes(effectiveTeacherName);
        }

        return classMatches || teacherMatches;
      });
      const isBlockedByImported = allClassesBlockedTimes.some((blockedTime: any) => {
        const weeksArr = Array.isArray(blockedTime.weeks) ? blockedTime.weeks : [];
        if (weeksArr.length > 0 && !weeksArr.includes(week)) return false;
        const d = blockedTime.day_of_week !== undefined ? blockedTime.day_of_week : blockedTime.day;
        if (d !== day) return false;
        const periodsArr = blockedTime.periods || [];
        if (!periodsArr.includes(period)) return false;
        return true;
      });
      if (isBlockedByImported) return false;
    }

    // 直接从排课记录中检查班级的专业大课禁排（不依赖localStorage）
    if (allClasses.length > 0) {
      const majorClassSchedule = scheduledClasses.find(sc => {
        // 检查是否为专业大课（通过course_id关联课程数据判断）
        if (!isMajorClassSchedule(sc)) return false;
        
        // 检查班级是否匹配
        const scClassName = sc.class_id || (sc as any).class_name;
        if (!scClassName) return false;
        
        // 提取班级编号进行匹配（学生班级格式：音乐学2301，排课班级格式：2301）
        const scClassNumber = scClassName.replace(/[^0-9]/g, ''); // 提取数字部分
        const classMatches = allClasses.some((className: string) => {
          const classNumber = className.replace(/[^0-9]/g, ''); // 提取数字部分
          return scClassNumber === classNumber || 
                 scClassName.includes(className) || 
                 className.includes(scClassName);
        });
        if (!classMatches) return false;
        
        // 检查时间是否匹配
        if (sc.day_of_week !== day || sc.period !== period) return false;
        if (sc.start_week !== undefined && sc.end_week !== undefined) {
          return week >= sc.start_week && week <= sc.end_week;
        }
        if (sc.week_number !== undefined) return sc.week_number === week;
        return week <= 16;
      });
      
      if (majorClassSchedule) {
        return false;
      }
    }

    // 检查教师已经排定的时间
    const teacherIdSet = getCurrentTeacherIdSet();
    if (teacherIdSet.size > 0) {
      const teacherSchedule = scheduledClasses.find(sc => {
        const isTeacherMatch = isCurrentTeacherSchedule(sc, teacherIdSet);

        if (!isTeacherMatch) return false;
        if (sc.day_of_week !== day || sc.period !== period) return false;
        if (sc.start_week !== undefined && sc.end_week !== undefined) {
          return week >= sc.start_week && week <= sc.end_week;
        }
        if (sc.week !== undefined) return sc.week === week;
        return week <= 16;
      });
      if (teacherSchedule) {
        return false;
      }

      // 检查教师是否有专业大课或理论课（通过course_id关联课程数据判断）
      const teacherName = targetTeacher?.name || teacher?.name;
      const teacherMajorClass = scheduledClasses.find(sc => {
        if (!isMajorClassSchedule(sc)) return false;

        let teacherMatches = isCurrentTeacherSchedule(sc, teacherIdSet);
        if (!teacherMatches && sc.teacher_name) {
          if (sc.teacher_name === teacherName) {
            teacherMatches = true;
          } else {
            const scheduleTeachers = sc.teacher_name.split(/[,，、]/).map((t: string) => t.trim());
            teacherMatches = scheduleTeachers.includes(teacherName || '');
          }
        }
        if (!teacherMatches) return false;
        if (sc.day_of_week !== day || sc.period !== period) return false;
        if (sc.start_week !== undefined && sc.end_week !== undefined) {
          return week >= sc.start_week && week <= sc.end_week;
        }
        if (sc.week !== undefined) return sc.week === week;
        return week <= 16;
      });
      if (teacherMajorClass) {
        return false;
      }
    }

    // 检查学生是否已经被其他老师排课（跨教师，全局检查）
    if (groupStudents.length > 0) {
      const studentIds = groupStudents.map((s: any) => s.id);
      const allSchedules = allSchedulesCache.length > 0 ? allSchedulesCache : scheduledClasses;
      const studentConflict = allSchedules.find(sc => {
        if (!studentIds.includes(sc.student_id)) return false;
        if (sc.day_of_week !== day || sc.period !== period) return false;
        if (sc.start_week !== undefined && sc.end_week !== undefined) {
          return week >= sc.start_week && week <= sc.end_week;
        }
        if (sc.week !== undefined) return sc.week === week;
        return week <= 16;
      });
      if (studentConflict) {
        return false;
      }
    }

    return true;
  };

  // 检查时段是否可用（异步版本，单一来源：使用 unifiedBlockedTimes）
  const isSlotAvailable = async (day: number, period: number, week: number = selectedWeek) => {
    try {
      // 先检查同步的禁排
      if (!isSlotAvailableSync(day, period, week)) {
        return false;
      }

      const currentClass = groupStudents.length > 0 ? (groupStudents[0].major_class || groupStudents[0].class_name || '') : '';

      // 使用统一格式检查禁排（导入禁排 + 通适大课）
      const hasBlocked = unifiedBlockedTimes.some((slot: any) => {
        if (!isBlockedMatchClass(slot, currentClass)) return false;
        const weeks = Array.isArray(slot.weeks) ? slot.weeks : [];
        if (!weeks.includes(week)) return false;
        const d = slot.day_of_week !== undefined ? slot.day_of_week : slot.day;
        if (d !== day) return false;
        return (slot.periods || []).includes(period);
      });
      if (hasBlocked) return false;

      // 检查周次是否被禁排（全周禁排）
      if (isWeekBlocked(week, unifiedBlockedTimes, currentClass)) {
        return false;
      }

      // 检查学生排课冲突（跨教师）
      // 即使在同步版本中检查过了，这里也要再检查一次，确保缓存为空时也能正确检查
      if (groupStudents.length > 0) {
        // 使用缓存数据或从服务器获取
        const allSchedules = allSchedulesCache.length > 0 ? allSchedulesCache : await scheduleService.getAll();
        
        for (const student of groupStudents) {
          const studentId = student.id;
          
          // 检查是否有冲突
          const hasConflict = allSchedules.some(sc => {
            return sc.student_id === studentId &&
                   sc.day_of_week === day &&
                   sc.period === period &&
                   sc.start_week === week;
          });
          
          if (hasConflict) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      console.error('检查时段可用性失败:', error);
      return true;
    }
  };

  // 时间槽点击处理
  const handleTimeSlotClick = async (day: number, period: number) => {

    
    // 检查时段是否可用（批量模式下不检查，因为批量模式会遍历所有周次）
    if (selectionMode !== 'batch') {
      const available = await isSlotAvailable(day, period);
      if (!available) {
        return;
      }
    }

    // 显示进度条
    const progressBar = document.createElement('div');
    progressBar.className = 'fixed top-0 left-0 w-full h-2 bg-gray-200 z-50';
    
    const progressFill = document.createElement('div');
    progressFill.className = 'h-full bg-purple-600 transition-all duration-300';
    progressFill.style.width = '0%';
    
    progressBar.appendChild(progressFill);
    document.body.appendChild(progressBar);
    
    // 更新进度条的函数
    const updateProgress = (current: number, total: number) => {
      const percentage = Math.min(100, Math.round((current / total) * 100));
      progressFill.style.width = `${percentage}%`;
    };

    try {
      if (selectionMode === 'single') {
        // 单选模式：支持多选和取消选择
        const newSlot = { week: selectedWeek, day, period };
        const existingIndex = selectedTimeSlots.findIndex(
          slot => slot.week === newSlot.week && slot.day === newSlot.day && slot.period === newSlot.period
        );
        
        updateProgress(50, 100);
        
        if (existingIndex >= 0) {
          // 取消选择
          setSelectedTimeSlots(prev => prev.filter((_, index) => index !== existingIndex));
        } else {
          // 添加选择
          setSelectedTimeSlots(prev => [...prev, newSlot]);
        }
      } else if (selectionMode === 'range') {
        // 范围选择：当前点与起始点之间全部选中
        if (!dragStart) {
          setDragStart({ day, period });
          setDragEnd({ day, period });
          return;
        }
        // 重新计算拖动范围
        const newDragEnd = { day, period };
        setDragEnd(newDragEnd);
        // 生成范围内的所有格子
        const startDay = Math.min(dragStart.day, newDragEnd.day);
        const endDay = Math.max(dragStart.day, newDragEnd.day);
        const startPeriod = Math.min(dragStart.period, newDragEnd.period);
        const endPeriod = Math.max(dragStart.period, newDragEnd.period);
        const slots = [];
        let totalSlots = (endDay - startDay + 1) * (endPeriod - startPeriod + 1);
        let processedSlots = 0;
        
        for (let d = startDay; d <= endDay; d++) {
          for (let p = startPeriod; p <= endPeriod; p++) {
            // 只添加可用时段
            const slotAvailable = await isSlotAvailable(d, p);
            if (slotAvailable) {
              const slot = { week: selectedWeek, day: d, period: p };
              // 检查是否已存在，避免重复
              if (!selectedTimeSlots.some(s => s.week === slot.week && s.day === slot.day && s.period === slot.period)) {
                slots.push(slot);
              }
            }
            processedSlots++;
            updateProgress(processedSlots, totalSlots);
          }
        }
        setSelectedTimeSlots(prev => [...prev, ...slots]);
      } else if (selectionMode === 'batch') {
        // 批量选择模式 - 全新实现
        // 专业小课：不管学分多少，都需要排16次课（16节次），不需要除以2
        const requiredWeeks = 16;

        // 2. 计算已选择的总课时（所有节次的周次数总和）
        const totalSelectedCount = selectedTimeSlots.length;
        const remainingWeeks = Math.max(0, requiredWeeks - totalSelectedCount);

        if (remainingWeeks === 0) {
          showToast('info', `已选满 ${requiredWeeks} 节课时，请先取消部分选择`);
          return;
        }

        // 3. 获取当前节次已选择的周次
        const alreadySelectedWeeks = new Set(
          selectedTimeSlots.filter(slot => slot.day === day && slot.period === period).map(slot => slot.week)
        );

        // 4. 检查是否点击了已选中的时段（取消选择）
        if (alreadySelectedWeeks.has(selectedWeek)) {
          // 取消选择：移除该时段的所有周次
          setSelectedTimeSlots(prev => prev.filter(
            slot => !(slot.day === day && slot.period === period)
          ));
          showToast('info', `已取消该时段的 ${alreadySelectedWeeks.size} 周选择`);
          return;
        }

        // 5. 自动填充可用周次（限制在剩余课时内），自动跳过禁排周次
        const newSlots: Array<{week: number, day: number, period: number}> = [];
        let selectedCount = 0;
        
        // 收集所有可用的周次（自动跳过禁排周次）
        const availableWeeks: number[] = [];
        for (let w = 1; w <= totalWeeks; w++) {
          // 跳过已选择的周次
          if (alreadySelectedWeeks.has(w)) continue;
          // 检查该周次是否可用（自动跳过禁排周次）
          if (isSlotAvailableSync(day, period, w)) {
            availableWeeks.push(w);
          }
        }

        // 从当前点击的周次开始选择
        const startWeekIndex = availableWeeks.indexOf(selectedWeek);
        let currentWeekIndex = startWeekIndex >= 0 ? startWeekIndex : 0;
        let loopCount = 0;
        const maxLoops = availableWeeks.length; // 防止无限循环

        // 循环选择直到选满或遍历完所有可用周次
        while (selectedCount < remainingWeeks && loopCount < maxLoops) {
          const week = availableWeeks[currentWeekIndex];
          if (week !== undefined && !alreadySelectedWeeks.has(week)) {
            newSlots.push({ week, day, period });
            selectedCount++;
          }
          currentWeekIndex = (currentWeekIndex + 1) % availableWeeks.length;
          loopCount++;
          
          // 如果已经遍历完所有可用周次但还没选满，退出循环
          if (currentWeekIndex === startWeekIndex && loopCount > 0) {
            break;
          }
        }

        // 6. 更新选择状态
        setSelectedTimeSlots(prev => [...prev, ...newSlots]);

        // 7. 显示结果提示
        const newTotalSelected = totalSelectedCount + selectedCount;
        if (selectedCount === 0) {
          showToast('error', '当前时段没有可用周次，请选择其他时段');
        } else if (newTotalSelected < requiredWeeks) {
          showToast('info', `已选择 ${selectedCount} 周，当前共 ${newTotalSelected} 节，还需 ${requiredWeeks - newTotalSelected} 节`);
        } else {
          showToast('success', `成功选择 ${selectedCount} 周，已选满 ${requiredWeeks} 节课时`);
        }
      }
    } finally {
      // 完成后移除进度条
      setTimeout(() => {
        // 移除所有可能的进度条，包括不同高度的
        const progressBars = document.querySelectorAll('.fixed.top-0.left-0.w-full.h-2.bg-gray-200.z-50');
        progressBars.forEach(bar => {
          try {
            document.body.removeChild(bar);
          } catch (e) {
            // 忽略移除失败的错误
          }
        });
        // 同时移除其他可能的进度条样式
        const progressContainers = document.querySelectorAll('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
        progressContainers.forEach(container => {
          try {
            document.body.removeChild(container);
          } catch (e) {
            // 忽略移除失败的错误
          }
        });
      }, 100);
    }
  };

  // 鼠标按下处理
  const handleMouseDown = async (day: number, period: number) => {
    // 检查时段是否可用
    const available = await isSlotAvailable(day, period);
    if (!available) return;
    
    if (selectionMode !== 'range') return;
    setIsDragging(true);
    setDragStart({ day, period });
    setDragEnd({ day, period });
  };

  // 鼠标进入处理
  const handleMouseEnter = (day: number, period: number) => {
    if (selectionMode !== 'range' || !isDragging || !dragStart) return;
    setDragEnd({ day, period });
  };

  // 鼠标释放处理
  const handleMouseUp = () => {
    if (selectionMode !== 'range' || !isDragging) return;
    setIsDragging(false);
  };

  // 时间冲突检测
  const checkAndHandleConflict = (day: number, period: number): boolean => {
    // 当前周次
    const week = selectedWeek;
    // 检查当前时间段是否已有课程
    const hasConflict = scheduledClasses.some(
      sc => sc.day_of_week === day && sc.period === period
    );

    // 防止与其他教师的课程冲突
    const effectiveTeacherId = targetTeacher?.id || teacher?.id || user?.teacher_id;
    if (effectiveTeacherId) {
      const hasTeacherConflict = scheduledClasses.some(
        sc => sc.teacher_id === effectiveTeacherId &&
              sc.day_of_week === day &&
              sc.period === period
      );

      if (hasConflict || hasTeacherConflict) {
        setConflicts(prev => [
          ...prev,
          {
            week,
            day,
            period,
            type: 'time',
            message: `该时间段已有其他课程或教师已排`,
            suggestion: '建议调整时间或选择其他时间'
          }
        ]);
        return false;
      }
    }
    return true;
  };

  // 排课处理
  const handleSchedule = async () => {
    try {
      setSaving(true);
      
      // 检查冲突
      const validSlots = selectedTimeSlots.filter(slot => 
        checkAndHandleConflict(slot.day, slot.period)
      );

      if (validSlots.length === 0) {
        showToast('error', '所有选中的时间槽都有冲突');
        return;
      }

      // 这里可以添加具体的排课逻辑
      // 例如，为选中的学生和课程安排时间

      showToast('success', `成功安排 ${validSlots.length} 个时间段的课程`);
      
      // 清空选中的时间槽
      setSelectedTimeSlots([]);
      
      // 重新初始化时间网格
      await initializeTimeGrid();
      
    } catch (error) {
      console.error('排课失败:', error);
      showToast('error', '排课失败，请检查控制台错误信息');
    } finally {
      setSaving(false);
    }
  };

  // 批量排课处理
  const handleBatchSchedule = async () => {
    try {
      setSaving(true);
      
      // 生成批量时间槽
      const batchSlots = [];
      batchWeeks.forEach(week => {
        batchPeriods.forEach(period => {
          batchSlots.push({ week, day: batchDay, period });
        });
      });

      // 检查冲突
      const validSlots = batchSlots.filter(slot => 
        checkAndHandleConflict(slot.day, slot.period)
      );

      if (validSlots.length === 0) {
        showToast('error', '所有选中的时间槽都有冲突');
        return;
      }

      // 这里可以添加具体的批量排课逻辑

      showToast('success', `成功批量安排 ${validSlots.length} 个时间段的课程`);
      
      // 清空选中的时间槽
      setSelectedTimeSlots([]);
      
      // 重新初始化时间网格
      await initializeTimeGrid();
      
    } catch (error) {
      console.error('批量排课失败:', error);
      showToast('error', '批量排课失败，请检查控制台错误信息');
    } finally {
      setSaving(false);
    }
  };

  // 一键复制到其他周
  const handleCopyToOtherWeeks = async () => {
    try {
      setSaving(true);
      
      // 这里可以添加具体的复制逻辑

      showToast('success', '成功复制到其他周');
      
    } catch (error) {
      console.error('复制失败:', error);
      showToast('error', '复制失败，请检查控制台错误信息');
    } finally {
      setSaving(false);
    }
  };

  // 清除选中的时间槽
  const handleClearSelection = () => {
    setSelectedTimeSlots([]);
    setDragStart(null);
    setDragEnd(null);
  };
  
  // 保存排课结果
  const handleSaveSchedule = async () => {
    if (groupStudents.length === 0 || !selectedCourseName || selectedTimeSlots.length === 0) {
      showToast('error', '请先选择学生、课程和时间');
      return;
    }

    // 计算 effectiveSelectedTimeSlots：排除对小组内任一学生为禁排的节次
    const effectiveSelectedTimeSlots = selectedTimeSlots.filter(slot => {
      return !groupStudents.some(student => {
        const studentClass = student.major_class || '';
        return unifiedBlockedTimes.some((bt: any) => {
          if (!isBlockedMatchClass(bt, studentClass)) return false;
          if (!bt.weeks || !bt.weeks.includes(slot.week)) return false;
          const d = bt.day_of_week !== undefined ? bt.day_of_week : bt.day;
          if (d !== slot.day) return false;
          return bt.periods && bt.periods.includes(slot.period);
        });
      });
    });

    if (effectiveSelectedTimeSlots.length === 0) {
      showToast('error', '所选时间均与禁排冲突，请重新选择');
      return;
    }

    // 课程最多 16 节次，超出禁止保存
    if (effectiveSelectedTimeSlots.length > 16) {
      showToast('error', `该课程最多排 16 节，当前已选 ${effectiveSelectedTimeSlots.length} 节，请减少后再保存`);
      return;
    }

    // 验证分组
    const validation = validateCurrentGroup();
    if (!validation.isValid) {
      showToast('error', validation.message);
      return;
    }

    // 提取班级编号（如从"2025级音乐学2503"提取"2503"），用于跨字段比对
    const getClassNumber = (className: string | null | undefined) => {
      if (!className) return '';
      const matches = String(className).match(/\d+/g);
      // 使用最后一段数字作为班级号，避免把“2025级”这种年级数字当成班级
      if (matches && matches.length > 0) {
        return matches[matches.length - 1];
      }
      return String(className);
    };

    try {
      setSaving(true);
      
      // 显示进度条（醒目样式）
      const progressContainer = document.createElement('div');
      progressContainer.className = 'fixed top-0 left-0 w-full h-8 bg-gray-100 z-50 shadow-lg flex items-center';
      
      const progressBar = document.createElement('div');
      progressBar.className = 'h-full bg-gradient-to-r from-purple-500 to-purple-600 transition-all duration-300 flex items-center justify-end pr-2';
      progressBar.style.width = '0%';
      
      const progressText = document.createElement('span');
      progressText.className = 'text-white text-sm font-bold';
      progressText.textContent = '0%';
      
      progressBar.appendChild(progressText);
      progressContainer.appendChild(progressBar);
      document.body.appendChild(progressContainer);
      
      // 更新进度条的函数
      const updateProgress = (current: number, total: number) => {
        const percentage = Math.min(100, Math.round((current / total) * 100));
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}%`;
      };
      
      updateProgress(5, 100);
      
      // 并行获取排课与课程，减少等待时间
      const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))
        ]).catch(() => fallback);
      const cached = allSchedulesCache || [];
      const [freshSchedules, allCourses] = await Promise.all([
        withTimeout(scheduleService.getAll(), 15000, cached),
        courseService.getAll()
      ]);
      if (freshSchedules === cached) {
        showToast('info', '排课数据加载较慢，使用缓存继续保存');
      }
      setAllSchedulesCache(freshSchedules);
      
      updateProgress(10, 100);
      
      // 使用目标教师或当前教师
      const effectiveTeacher = targetTeacher || teacher;
      
      if (!effectiveTeacher) {
        showToast('error', '教师信息不完整');
        return;
      }
      
      // 获取班级信息
      // 优先使用当前小组学生的班级（与教师的直觉一致：先看学生属于哪个班）
      let classId = '';
      if (groupStudents.length > 0) {
        const firstStudent = groupStudents[0];
        classId = firstStudent.major_class || (firstStudent as any).class_name || '';
      }
      // 其次使用当前排课信息中选中的课程班级（来自小组课列表）
      if (!classId && selectedCourseClassId) {
        classId = selectedCourseClassId;
      }
      // 最后才退回到左侧班级筛选器的选中班级
      if (!classId && selectedClass?.class_id) {
        classId = selectedClass.class_id;
      }
      
      if (!classId) {
        showToast('error', '班级信息不完整');
        return;
      }

      // 验证当前小组学生的年级与类型是否一致（允许同年级、同类型的跨班混组）
      const studentGrades = Array.from(
        new Set(
          groupStudents
            .map(s => (s.major_class ? extractGradeFromClassId(s.major_class) : '未知'))
            .filter(g => g && g !== '未知')
        )
      );

      if (studentGrades.length > 1) {
        showToast('error', '不同年级不能混合编组，请按年级分别排课');
        return;
      }

      const studentTypes = Array.from(
        new Set(groupStudents.map(s => s.student_type || 'general'))
      );

      if (studentTypes.length > 1) {
        showToast('error', '普通班和专升本不能混合编组，请按班级类型分别排课');
        return;
      }

      const studentGrade = studentGrades[0] || '';
      
      // 使用已刷新的排课数据（freshSchedules）和课程数据（已在上面并行获取）
      const allSchedules = freshSchedules;
      updateProgress(15, 100);
      
      // 优化数据结构：使用 Map 按时间槽索引已排课记录，提高冲突检测效率
      const teacherSchedulesMap = new Map<string, any>();
      const studentSchedulesMap = new Map<string, any>();
      
      // 预处理已排课记录
      allSchedules.forEach(sc => {
        // 按教师 ID + 时间槽索引
        const teacherSlotKey = `${sc.teacher_id}_${sc.day_of_week}_${sc.period}_${sc.start_week}`;
        teacherSchedulesMap.set(teacherSlotKey, sc);
        
        // 按学生 ID + 时间槽索引
        if (sc.student_id) {
          const studentSlotKey = `${sc.student_id}_${sc.day_of_week}_${sc.period}_${sc.start_week}`;
          studentSchedulesMap.set(studentSlotKey, sc);
        }
      });
      updateProgress(15, 100);
      
      // 使用刷新后的排课数据直接计算学生已完成课时（解决编辑后重新保存时课时计算错误的问题）
      const coursesMapForProgress = new Map(allCourses.map(course => [course.id, course]));
      
      // 计算每个学生的已完成课时
      const studentCompletedHours: Map<string, number> = new Map();
      groupStudents.forEach(student => {
        const studentSchedules = allSchedules.filter(sc => sc.student_id === student.id);
        const uniqueTimeSlots = new Set<string>();
        studentSchedules.forEach(sc => {
          const course = coursesMapForProgress.get(sc.course_id);
          if (course && course.course_name === selectedCourseName) {
            const timeKey = `${sc.day_of_week || sc.day}_${sc.period}_${sc.start_week || sc.week}`;
            uniqueTimeSlots.add(timeKey);
          }
        });
        studentCompletedHours.set(student.id, uniqueTimeSlots.size);
      });
      
      // 并行计算所有学生的剩余课时
      const totalRequiredHours = 16; // 固定16课时
      const studentProgresses = groupStudents.map((student) => {
        const completed = studentCompletedHours.get(student.id) || 0;
        const studentType = student?.student_type || 'general';
        const semester = getSemesterFromCourse(selectedCourseName);
        const required = getRequiredHours(selectedCourseName, semester, studentType);
        const remaining = Math.max(0, required - completed);
        const percentage = required > 0 ? (completed / required) * 100 : 100;
        
        return {
          student,
          progress: { completed, remaining, percentage }
        };
      });
      updateProgress(20, 100);
      
      // 检查所有学生的课时是否完成
      const incompleteStudents: string[] = [];
      studentProgresses.forEach(({ student, progress }) => {
        const totalPlannedHours = effectiveSelectedTimeSlots.length;
        const totalCompletedHours = progress.completed + totalPlannedHours;
        const totalRequiredHours = progress.completed + progress.remaining;

        // 如果计划排课后仍未达到总课时要求
        if (totalCompletedHours < totalRequiredHours) {
          incompleteStudents.push(`${student.name}（还需${totalRequiredHours - totalCompletedHours}课时）`);
        }
      });

      // 如果有学生课时未完成，提示确认
      if (incompleteStudents.length > 0) {
        const confirmSave = window.confirm(
          `以下学生课时未完成：\n${incompleteStudents.join('\n')}\n\n是否继续保存？`
        );
        if (!confirmSave) {
          return;
        }
      }
      updateProgress(25, 100);
      
      // 确定课程类型（根据课程名称自动判断）
      let courseType = '器乐'; // 默认值
      if (selectedCourseName) {
        if (selectedCourseName.includes('钢琴')) {
          courseType = '钢琴';
        } else if (selectedCourseName.includes('声乐')) {
          courseType = '声乐';
        } else if (selectedCourseName.includes('器乐')) {
          courseType = '器乐';
        } else if (selectedCourseName.includes('中国器乐')) {
          courseType = '器乐';
        }
      }

      // 获取或创建课程
      // 课程编号 + 班级 必须同时匹配才能使用已有课程；班级支持“音乐学2301”与“2301”等格式互通
      const extractClassNumber = (s: string | undefined | null) => {
        if (!s) return '';
        const m = String(s).match(/\d+/);
        return m ? m[0] : String(s).trim();
      };
      const classKey = extractClassNumber(classId);
      
      let course = null;
      
      if (selectedCourseId && classId) {
        course = allCourses.find(c => {
          const cid = (c as any).course_id;
          const cClass = (c as any).major_class;
          const idMatch = cid === selectedCourseId;
          const classMatch = cClass === classId || extractClassNumber(cClass) === classKey || cClass === classKey;
          return idMatch && (classMatch || !cClass);
        });
      }
      if (!course && selectedCourseId) {
        course = allCourses.find(c => (c as any).course_id === selectedCourseId);
      }
      
      // 如果课程编号+班级不存在，再按课程名称和班级查找（不要求任课教师一致，排课只使用现有课程）
      if (!course) {
        course = allCourses.find(c => {
          if (c.course_name !== selectedCourseName) return false;
          const cClass = (c as any).major_class;
          if (classId) return cClass === classId || extractClassNumber(cClass) === classKey || cClass === classKey;
          return c.course_type === courseType &&
                 (c as any).teaching_type === '小组课' &&
                 (!cClass || cClass === '');
        });
      }

      // 排课不创建新课程：只根据现有课程列表输出排课结果，未找到则提示从列表选择
      if (!course) {
        showToast('error', '未在小组课列表中找到匹配的课程，请先从小组课列表中选择课程（课程名称+班级需与现有课程一致）后再排课');
        return;
      }
      
      // 再次校验：课程名称 / 课程编号 / 课程年级 必须与当前选择及学生年级保持一致
      const courseGradeValue =
        (course as any).grade ||
        ((course as any).major_class ? extractGradeFromClassId((course as any).major_class) : '');
      const courseIdValue = (course as any).course_id || course.id;
      const courseNameValue = course.course_name;

      // 如果能解析出学生年级和课程年级，则要求两者一致
      if (studentGrade && courseGradeValue && studentGrade !== courseGradeValue) {
        showToast('error', '课程年级与学生年级不一致，禁止保存，请检查课程编码与年级设置');
        return;
      }

      if (selectedCourseId && courseIdValue && selectedCourseId !== courseIdValue) {
        showToast('error', '所选课程编码与实际课程编码不一致，禁止保存，请重新从小组课列表中选择课程');
        return;
      }

      if (selectedCourseName && courseNameValue && selectedCourseName !== courseNameValue) {
        showToast('error', '所选课程名称与实际课程名称不一致，禁止保存，请重新从小组课列表中选择课程');
        return;
      }
      updateProgress(30, 100);

      // 根据课程类型获取对应的琴房
      const facultyCode = selectedCourseType === '钢琴' ? 'PIANO' :
                         selectedCourseType === '声乐' ? 'VOCAL' : 'INSTRUMENT';
      
      // 优先使用用户手动选择的教室
      let roomInfo = selectedRoom ? fixedRooms.find(r => r.room?.id === selectedRoom) : null;
      // 如果用户没有选择教室，根据课程类型自动选择
      if (!roomInfo) {
        // 检查是否是林琳教师（特殊情况：她既带钢琴又带器乐课程）
        const teacherNumber = effectiveTeacher.id;
        const isLinLinTeacher = teacherNumber === '120170194';
        
        if (isLinLinTeacher) {
          // 林琳教师特殊处理：根据课程类型匹配特定琴房
          if (selectedCourseType === '钢琴') {
            // 匹配影琴221-03
            roomInfo = fixedRooms.find(r => r.room?.room_name === '影琴221-03');
          } else if (selectedCourseType === '器乐') {
            // 匹配器乐排练室114
            roomInfo = fixedRooms.find(r => r.room?.room_name === '器乐排练室114');
          } else {
            // 其他课程类型按正常逻辑匹配
            roomInfo = fixedRooms.find(r => r.facultyCode === facultyCode);
          }
        } else {
          // 其他教师按正常逻辑匹配
          roomInfo = fixedRooms.find(r => r.facultyCode === facultyCode);
        }
      }
      const roomId = roomInfo?.room?.id || undefined;

      // 计算总任务数
      const totalTasks = groupStudents.length * effectiveSelectedTimeSlots.length;
      let completedTasks = 0;

      // 检查教师冲突（在保存前一次性检查所有时段）
      for (const slot of effectiveSelectedTimeSlots) {
        const teacherSlotKey = `${effectiveTeacher.id}_${slot.day}_${slot.period}_${slot.week}`;
        const teacherConflict = teacherSchedulesMap.get(teacherSlotKey);

        if (teacherConflict) {
          const courseInfo = allCourses.find(c => c.id === teacherConflict.course_id);
          const courseName = courseInfo?.course_name || teacherConflict.course_name || teacherConflict.course_type;
          showToast('error', `教师冲突：${effectiveTeacher.name} 在第${slot.week}周周${['一','二','三','四','五','六','日'][slot.day-1]}第${slot.period}节已有 ${courseName}`);
          // 移除进度条
          const progressContainer = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
          if (progressContainer) {
            document.body.removeChild(progressContainer);
          }
          setSaving(false);
          return;
        }
      }
      updateProgress(35, 100);

      // 同一课程、同一批学生（无论顺序）始终使用同一 group_id，避免多次删建产生多个 group
      const courseIdForGroup = (course as any).course_id || course.id;
      const groupId = await getDeterministicGroupId(courseIdForGroup, groupStudents.map((s) => s.id));

      // 批量创建排课记录（优化：使用createMany减少数据库操作）
      const schedulesToCreate: Array<Omit<ScheduledClass, 'id' | 'created_at'>> = [];
      
      // 检查禁排时间冲突（使用统一的禁排时间列表，已从服务器加载）
      updateProgress(40, 100);
      
      for (const student of groupStudents) {
        // 获取学生的剩余课时（使用缓存的结果）
        const studentProgress = studentProgresses.find(sp => sp.student.id === student.id);
        const progress = studentProgress?.progress;
        
        for (const slot of effectiveSelectedTimeSlots) {
          // 检查学生排课冲突（跨教师）
          // 学生同一时段不能被不同教师排课（无论课程是否相同）
          const studentSlotKey = `${student.id}_${slot.day}_${slot.period}_${slot.week}`;
          const studentConflict = studentSchedulesMap.get(studentSlotKey);

          if (studentConflict) {
            const conflictTeacherName = studentConflict.teacher_name || '其他教师';
            // 优先从课程列表中查找课程名称，兼容 id / course_id 两种字段
            const courseInfo =
              allCourses.find(c =>
                c.id === studentConflict.course_id ||
                (c as any).course_id === studentConflict.course_id
              ) ||
              courses.find(c =>
                c.id === studentConflict.course_id ||
                (c as any).course_id === studentConflict.course_id
              );
            const courseName =
              courseInfo?.course_name ||
              studentConflict.course_name ||
              studentConflict.course_type ||
              '小组课';
            showToast('error', `学生冲突：${student.name} 在第${slot.week}周周${['一','二','三','四','五','六','日'][slot.day-1]}第${slot.period}节已有 ${courseName}（${conflictTeacherName}安排）`);
            // 移除进度条
            const progressContainer = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
            if (progressContainer) {
              document.body.removeChild(progressContainer);
            }
            setSaving(false);
            return;
          }

          // 检查禁排时间冲突（统一 day_of_week ?? day，支持全班级）
          const studentClass = student.major_class || '';
          const blockedTimeConflict = unifiedBlockedTimes.find((bt: any) =>
            isBlockedMatchClass(bt, studentClass) &&
            bt.weeks && bt.weeks.includes(slot.week) &&
            (bt.day_of_week !== undefined ? bt.day_of_week : bt.day) === slot.day &&
            bt.periods && bt.periods.includes(slot.period)
          );

          if (blockedTimeConflict) {
            showToast('error', `禁排冲突：${student.name} 在第${slot.week}周周${['一','二','三','四','五','六','日'][slot.day-1]}第${slot.period}节有禁排（${blockedTimeConflict.reason || '禁排时间'}）`);
            // 移除进度条
            const progressContainer = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
            if (progressContainer) {
              document.body.removeChild(progressContainer);
            }
            setSaving(false);
            return;
          }

          // 检查课时是否已排满
          if (progress && progress.remaining <= 0) {
            showToast('info', `学生 ${student.name} 的 ${selectedCourseName} 课程课时已排满（${progress.completed}/${progress.completed}）`);
            // 不跳过该学生，继续创建排课记录
          }

          // 计算本节课的课时（1课时=1节次）
          const classHours = 1;
          const remainingAfterThis = progress ? progress.remaining - classHours : 0;

          // 如果排完这节会超出，阻止保存
          if (remainingAfterThis < -0.5) {
            showToast('error', `课时超出：学生 ${student.name} 的 ${selectedCourseName} 课时将超出 ${Math.abs(Math.round(remainingAfterThis))} 课时，无法保存`);
            // 移除进度条
            const progressContainer = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
            if (progressContainer) {
              document.body.removeChild(progressContainer);
            }
            setSaving(false);
            return;
          }

          // 添加到批量创建列表（使用group_id关联同组学生）
          schedulesToCreate.push({
            teacher_id: effectiveTeacher.id,
            teacher_name: effectiveTeacher.name,
            course_id: (course as any).course_id || course.id, // 使用课程编号，如果没有则使用内部ID
            course_name: course.course_name,
            course_type: course.course_type,
            student_id: student.id,
            student_name: student.name,
            room_id: roomId,
            room_name: roomInfo?.room?.room_name,
            day_of_week: slot.day,
            period: slot.period,
            start_week: slot.week,
            end_week: slot.week,
            semester_label: selectedSemesterLabel,
            academic_year: selectedAcademicYear,
            semester: currentSemesterNumber,
            status: 'scheduled',
            group_id: groupId // 添加小组ID，确保同组学生关联
          } as any); // 使用as any绕过group_id类型检查

          // 更新进度条
          completedTasks++;
          updateProgress(35 + Math.round((completedTasks / totalTasks) * 60), 100);
        }
      }
      
      // 批量创建排课记录（一次性创建所有记录，减少数据库操作）
      updateProgress(95, 100);
      if (schedulesToCreate.length > 0) {
        await scheduleService.createMany(schedulesToCreate);
      }

      // 刷新排课、课程、学生（3 个并行请求，复用 updatedSchedules 避免重复调用 getAll）
      const [updatedSchedules, updatedCourses, allStudentsData] = await Promise.all([
        scheduleService.getAll(),
        courseService.getAll(),
        studentService.getAll()
      ]);
      const scheduleData = (updatedSchedules || []).filter((s: any) => s.teacher_id === effectiveTeacher.id);
      
      // 更新缓存，触发studentProgress重新计算
      setAllSchedulesCache(updatedSchedules);
      setAllCoursesCache(updatedCourses);
      setCourses(updatedCourses); // 更新courses状态，确保scheduleResults能获取到新创建的课程
      setStudents(allStudentsData); // 更新学生数据
      
      // 重新生成 myStudents 数据，确保基于最新的学生和排课数据
      const effectiveTeacherId = targetTeacher?.id || teacher?.id;
      if (effectiveTeacherId) {
        // 尝试多种方式匹配学生（包括主项和副项），并为每个课程类型创建学生实例
        const targetStudentsData: any[] = [];
        
        allStudentsData.forEach(s => {
          // 分别检查主项教师和副项教师匹配
          // 1. 检查是否为主项教师
          const isPrimaryTeacherMatch = (
            s.teacher_id === effectiveTeacherId ||
            (targetTeacher && s.teacher_name === targetTeacher.name) ||
            (targetTeacher && s.teacher_id === targetTeacher.id) ||
            (s.assigned_teachers && (
              s.assigned_teachers.primary_teacher_id === effectiveTeacherId ||
              (targetTeacher && s.assigned_teachers.primary_teacher_id === targetTeacher.id)
            ))
          );
          
          // 2. 检查是否为副项教师
          const isSecondaryTeacherMatch = s.assigned_teachers && (
            s.assigned_teachers.secondary1_teacher_id === effectiveTeacherId ||
            s.assigned_teachers.secondary2_teacher_id === effectiveTeacherId ||
            s.assigned_teachers.secondary3_teacher_id === effectiveTeacherId ||
            (targetTeacher && (
              s.assigned_teachers.secondary1_teacher_id === targetTeacher.id ||
              s.assigned_teachers.secondary2_teacher_id === targetTeacher.id ||
              s.assigned_teachers.secondary3_teacher_id === targetTeacher.id
            ))
          );
          
          // 1. 主项课程：只有当教师是学生的主项教师时才添加
          if (isPrimaryTeacherMatch && s.primary_instrument) {
            targetStudentsData.push({
              ...s,
              __courseType: s.primary_instrument,
              __source: 'primary'
            });
          }
          
          // 2. 副项课程：只有当教师是学生的副项教师时才添加
          if (isSecondaryTeacherMatch && s.secondary_instruments && s.secondary_instruments.length > 0) {
            // 检查每个副项是否由当前教师教授
            s.secondary_instruments.forEach((instrument: string, index: number) => {
              // 检查副项教师是否为当前教师
              let isThisSecondaryTeacherMatch = false;
              
              // 根据索引检查对应的副项教师
              switch (index) {
                case 0:
                  if (s.assigned_teachers?.secondary1_teacher_id === effectiveTeacherId ||
                      (targetTeacher && s.assigned_teachers?.secondary1_teacher_id === targetTeacher.id)) {
                    isThisSecondaryTeacherMatch = true;
                  }
                  break;
                case 1:
                  if (s.assigned_teachers?.secondary2_teacher_id === effectiveTeacherId ||
                      (targetTeacher && s.assigned_teachers?.secondary2_teacher_id === targetTeacher.id)) {
                    isThisSecondaryTeacherMatch = true;
                  }
                  break;
                case 2:
                  if (s.assigned_teachers?.secondary3_teacher_id === effectiveTeacherId ||
                      (targetTeacher && s.assigned_teachers?.secondary3_teacher_id === targetTeacher.id)) {
                    isThisSecondaryTeacherMatch = true;
                  }
                  break;
              }
              
              // 只有当副项教师是当前教师时，才创建学生实例
              if (isThisSecondaryTeacherMatch) {
                targetStudentsData.push({
                  ...s,
                  __courseType: instrument,
                  __source: 'secondary'
                });
              }
            });
          } else if (isSecondaryTeacherMatch && s.secondary_instrument1) {
            // 兼容旧格式
            // 检查副项1教师是否为当前教师
            if (s.assigned_teachers?.secondary1_teacher_id === effectiveTeacherId ||
                (targetTeacher && s.assigned_teachers?.secondary1_teacher_id === targetTeacher.teacher_id)) {
              targetStudentsData.push({
                ...s,
                __courseType: s.secondary_instrument1,
                __source: 'secondary'
              });
            }
          }
        });
        
        setMyStudents(targetStudentsData); // 更新 myStudents 数据
      }
      
      // 创建课程映射，提高查找效率（同时支持内部ID和课程编号查找）
      const updatedCoursesMap = new Map(updatedCourses.map(c => [c.id, c]));
      // 添加课程编号到映射
      updatedCourses.forEach(c => {
        if ((c as any).course_id) {
          updatedCoursesMap.set((c as any).course_id, c);
        }
      });
      
      const displaySchedule: ScheduledClassDisplay[] = scheduleData.map(sc => {
        // 从映射中获取课程信息（支持内部ID和课程编号）
        const courseInfo = updatedCoursesMap.get(sc.course_id);
        
        return {
          id: sc.id,
          day_of_week: sc.day_of_week,
          period: sc.period,
          course_id: sc.course_id,
          course_name: sc.courses?.course_name || sc.course_name || courseInfo?.course_name || '课程',
          course_type: sc.courses?.course_type || sc.course_type || courseInfo?.course_type || '器乐',
          teacher_id: sc.teacher_id,
          teacher_name: sc.teacher_name || sc.courses?.teacher_name || sc.courses?.teacher?.name || effectiveTeacher.name,
          student_id: sc.student_id,
          student_name: sc.students?.name || sc.student_name || students.find(s => s.id === sc.student_id)?.name || '学生',
          room_name: sc.rooms?.room_name || sc.room_name || (sc as any).rooms?.room_name || (sc as any).room_name,
          class_name: sc.class_name || sc.courses?.major_class || courseInfo?.major_class || students.find(s => s.id === sc.student_id)?.major_class || '',
          start_week: sc.start_week,
          end_week: sc.end_week,
          group_id: sc.group_id
        };
      });
      setScheduledClasses(displaySchedule);

      // 清除已安排的分组
      const scheduledStudentIds = new Set(groupStudents.map(s => s.id));
      setSelectedStudents(prev => {
        const newSet = new Set(prev);
        scheduledStudentIds.forEach(id => newSet.delete(id));
        return newSet;
      });

      // 手动更新学生列表，显示已排满的学生状态
      // 使用 setTimeout 确保 myStudents 状态已经更新
      setTimeout(() => {
        setPrimaryStudents(getPrimaryStudents());
        setSecondaryStudents(getSecondaryStudents());
      }, 100);

      showToast('success', '排课保存成功');
      updateProgress(100, 100);
      
      // 通过WebSocket同步排课数据（复用已获取的 updatedSchedules，避免再次请求）
      try {
        await websocketService.sendCourseUpdate(updatedSchedules || []);
        console.log('Course data synchronized via WebSocket');
      } catch (error) {
        console.error('WebSocket synchronization failed:', error);
      }
      
      // 排课保存成功后，清空当前排课信息，避免被下一组误用
      handleClearSelection();      // 清空已选时间/当前排课信息面板
      // 如果是使用当前小组排课，成功后清空小组
      clearGroup();
      
    } catch (error) {
      console.error('保存排课失败:', error);
      showToast('error', '保存排课失败，请重试');
    } finally {
      // 移除进度条
      const progressContainer = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
      if (progressContainer) {
        document.body.removeChild(progressContainer);
      }
      
      setSaving(false);
    }
  };

  // 编辑排课结果
  const handleEditSchedule = async (result: any, index: number) => {
    // 显示进度条（醒目样式）
    const progressContainer = document.createElement('div');
    progressContainer.className = 'fixed top-0 left-0 w-full h-8 bg-gray-100 z-50 shadow-lg flex items-center';

    const progressBar = document.createElement('div');
    progressBar.className = 'h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 flex items-center justify-end pr-2';
    progressBar.style.width = '0%';

    const progressText = document.createElement('span');
    progressText.className = 'text-white text-sm font-bold';
    progressText.textContent = '0%';

    progressBar.appendChild(progressText);
    progressContainer.appendChild(progressBar);
    document.body.appendChild(progressContainer);

    // 更新进度条的函数
    const updateProgress = (current: number, total: number) => {
      const percentage = Math.min(100, Math.round((current / total) * 100));
      progressBar.style.width = `${percentage}%`;
      progressText.textContent = `${percentage}%`;
    };

    try {
      // 计算总任务数
      const totalTasks = 3 + (result.originalSchedules?.length || 0); // 切换教师 + 删除记录 + 加载信息
      let completedTasks = 0;
      
      // 1. 先切换到该教师名下
      let teacherToSelect = null;
      if (result.teacherName && availableTeachers.length > 0) {
        teacherToSelect = availableTeachers.find(t => t.name === result.teacherName);
        if (teacherToSelect) {
          setTargetTeacher(teacherToSelect);
        }
      }
      completedTasks++;
      updateProgress(completedTasks, totalTasks);
      
      // 2. 先删除原来的排课记录，避免保存时出现冲突
      if (result.originalSchedules && result.originalSchedules.length > 0) {

        for (let i = 0; i < result.originalSchedules.length; i++) {
          const schedule = result.originalSchedules[i];
          if (schedule.id) {
            await scheduleService.delete(schedule.id);
          }
          completedTasks++;
          updateProgress(completedTasks, totalTasks);
        }
      }
      
      // 3. 重新加载排课数据，更新学生课时状态（回到未排状态）
      // 删除后需要刷新数据，让学生的课时状态回到未排状态
      const updatedSchedules = await scheduleService.getAll();
      if (updatedSchedules) {
        // 更新缓存（关键：让 updateStudentProgress 使用最新数据）
        setAllSchedulesCache(updatedSchedules);

        // 过滤掉大课，只保留小课
        const smallClassSchedules = updatedSchedules.filter((sc: any) => {
          const course = findCourseById(courses, sc.course_id);
          const courseName = course?.course_name || sc.course_name;
          return !courseName?.includes('大课');
        });
        setScheduledClasses(smallClassSchedules);
      }
      completedTasks++;
      updateProgress(completedTasks, totalTasks);

      // 4. 更新学生课时进度（关键：让学生的课时状态回到未排状态）
      // 注意：需要在 setAllSchedulesCache 之后立即调用，使用最新数据
      if (result.courseName && updatedSchedules) {
        // 手动计算进度，使用最新的 updatedSchedules 而不是缓存
        const progressMap: {[studentId: string]: {completed: number; remaining: number; percentage: number}} = {};
        const allCourses = await courseService.getAll();
        const coursesMap = new Map(allCourses.map(course => [course.id, course]));

        students.forEach(student => {
          const studentId = student.id;
          const studentSchedules = updatedSchedules.filter((sc: any) => sc.student_id === studentId);

          // 计算已完成课时
          const uniqueTimeSlots = new Set();
          studentSchedules.forEach((sc: any) => {
            const course = coursesMap.get(sc.course_id);
            if (course && course.course_name === result.courseName) {
              const timeKey = `${sc.day_of_week || sc.day}_${sc.period}_${sc.start_week || sc.week}`;
              uniqueTimeSlots.add(timeKey);
            }
          });

          const completed = uniqueTimeSlots.size;
          const semester = getSemesterFromCourse(result.courseName);
          const studentType = student.student_type || 'general';
          const required = getRequiredHours(result.courseName, semester, studentType);
          const remaining = Math.max(0, required - completed);
          const percentage = required > 0 ? (completed / required) * 100 : 100;

          progressMap[studentId] = {
            completed: Math.round(completed),
            remaining: Math.round(remaining),
            percentage
          };
        });

        // 不需要手动更新进度，useMemo 会自动计算
      }
      completedTasks++;
      updateProgress(completedTasks, totalTasks);

      // 5. 将排课结果的信息填充到表单中
    // 设置选中的课程名称
    setSelectedCourseName(result.courseName);
    
    // 5. 设置选中的学生
    // 使用 result.students 获取学生列表（支持分行显示）
    const selectedStudentIds = new Set<string>();
    const studentsToAdd = [];
    
    // 获取当前教师信息
    const effectiveTeacherId = targetTeacher?.id || teacher?.id;
    const effectiveTeacherNumber = targetTeacher?.id || teacher?.id;
    const effectiveTeacherName = targetTeacher?.name || teacher?.name;
    
    // 从 result.students 获取学生列表
    if (result.students && result.students.length > 0) {
      result.students.forEach((studentObj: any) => {
        const student = students.find(s => s.id === studentObj.id || s.name === studentObj.name);
        if (student) {
          selectedStudentIds.add(student.id);
          studentsToAdd.push(student);
        }
      });
    } else {
      // 兼容旧版本：从 studentName 解析
      const studentNames = result.studentName.split('、');
      studentNames.forEach((name: string) => {
        const student = students.find(s => s.name === name);
        if (student) {
          selectedStudentIds.add(student.id);
          studentsToAdd.push(student);
        }
      });
    }
    
    setSelectedStudents(selectedStudentIds);
    
    // 6. 清空小组，然后一次性添加所有学生
    setGroupStudents(studentsToAdd);
    
    // 7. 存储学生来源信息
    // 从原始排课记录中恢复学生来源信息
    const newStudentSources = new Map(studentSources);
    
    // 首先，尝试从原始排课记录中恢复学生来源
    // 由于数据库中没有存储 student_source 字段，我们需要根据原始排课时的逻辑来判断
    // 原始逻辑：根据添加学生时的来源（主项/副项按钮）来确定
    
    // 获取原始排课记录中的教师信息
    const originalTeacherId = result.teacherId;
    const originalTeacherNumber = availableTeachers.find(t => t.id === originalTeacherId)?.teacher_id;
    
    studentsToAdd.forEach(student => {
      let source: 'primary' | 'secondary' = 'primary';
      
      // 判断逻辑：
      // 1. 如果该教师是学生的主项教师 → primary
      // 2. 如果该教师是学生的副项教师 → secondary
      // 3. 如果都不是（可能是管理员安排的）→ 检查学生的 teacher_id 是否匹配
      
      // 检查是否为主项教师（使用教师ID，现在是工号）
      const isPrimaryTeacher = student.assigned_teachers?.primary_teacher_id === originalTeacherId ||
                              student.teacher_id === originalTeacherId;
      
      // 检查是否为副项教师
      const isSecondaryTeacher = student.assigned_teachers?.secondary1_teacher_id === originalTeacherId ||
                                student.assigned_teachers?.secondary2_teacher_id === originalTeacherId ||
                                student.assigned_teachers?.secondary3_teacher_id === originalTeacherId;
      
      if (isSecondaryTeacher && !isPrimaryTeacher) {
        // 是副项教师但不是主项教师 → 副项学生
        source = 'secondary';
      } else if (!isPrimaryTeacher && !isSecondaryTeacher) {
        // 既不是主项也不是副项教师
        // 可能是管理员安排的，或者是数据不一致
        // 检查学生的 teacher_id 是否匹配当前教师
        if (student.teacher_id !== originalTeacherId && student.teacher_id !== originalTeacherNumber) {
          // 学生的 teacher_id 也不匹配，可能是副项学生
          source = 'secondary';
        }
      }
      // 否则（是主项教师）→ 主项学生（默认）
      
      newStudentSources.set(student.id, source);
    });
    setStudentSources(newStudentSources);
    
    // 8. 如果选择了课程，更新学生进度
    if (selectedCourseName) {
      // 不需要手动更新进度，useMemo 会自动计算
    }
    
    // 9. 重新过滤小组课数据，根据小组中学生的班级和教师
    if (studentsToAdd.length > 0) {
      filterGroupCoursesByStudentClasses(studentsToAdd, teacherToSelect);
    }
    
    // 10. 重要：学生选择变化后，自动更新时间网格，显示基于所选学生的禁排时段和可用时段
    if (studentsToAdd.length > 0) {
      // 延迟一点执行，确保状态更新完成
      setTimeout(() => {
        initializeTimeGrid();
      }, 100);
    }
    
    // 11. 加载已选时间槽（从原排课记录中恢复）
    // 注意：需要恢复该小组的所有节次，而不仅是当前行的节次
    if (result.originalSchedules && result.originalSchedules.length > 0) {
      // 获取当前小组的学生姓名列表
      const currentStudentNames = result.students && result.students.length > 0
        ? result.students.map((s: any) => s.name)
        : result.studentName.split('、');
      const courseName = result.courseName;
      const teacherName = result.teacherName;
      
      // 从所有排课记录中查找该小组的所有排课（所有节次）
      const allGroupSchedules = scheduledClasses.filter(sc => {
        // 匹配课程名称
        const course = findCourseById(courses, sc.course_id);
        const scCourseName = course?.course_name || sc.course_name;
        if (scCourseName !== courseName) return false;
        
        // 匹配教师
        const scTeacherName = sc.teacher_name || course?.teacher_name;
        if (scTeacherName !== teacherName) return false;
        
        // 匹配学生（检查该排课记录的学生是否在小组中）
        const student = students.find(s => s.id === sc.student_id);
        if (!student) return false;
        return currentStudentNames.includes(student.name);
      });
      

      
      // 从所有排课记录中提取时间槽信息
      const timeSlotsFromResult = allGroupSchedules.map((sc: any) => ({
        week: sc.start_week || sc.week_number,
        day: sc.day_of_week,
        period: sc.period
      }));
      
      // 去重（同一时段可能有多条记录，因为是小组课）
      const uniqueTimeSlots = [];
      const seen = new Set();
      for (const slot of timeSlotsFromResult) {
        const key = `${slot.week}-${slot.day}-${slot.period}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueTimeSlots.push(slot);
        }
      }
      
      setSelectedTimeSlots(uniqueTimeSlots);

    }
      // 确保进度条显示 100% 后再结束，避免卡在 98%
      updateProgress(totalTasks, totalTasks);
    } catch (error) {
      console.error('编辑排课失败:', error);
      showToast('error', '编辑排课失败，请重试');
    } finally {
      // 移除进度条
      const progressContainer = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
      if (progressContainer) {
        document.body.removeChild(progressContainer);
      }
    }
  };

  // 删除排课结果
  const handleDeleteSchedule = async (result: any) => {
    if (!confirm('确定要删除该排课记录吗？')) return;

    // 显示进度条（醒目样式）
    const progressContainer = document.createElement('div');
    progressContainer.className = 'fixed top-0 left-0 w-full h-8 bg-gray-100 z-50 shadow-lg flex items-center';

    const progressBar = document.createElement('div');
    progressBar.className = 'h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-300 flex items-center justify-end pr-2';
    progressBar.style.width = '0%';

    const progressText = document.createElement('span');
    progressText.className = 'text-white text-sm font-bold';
    progressText.textContent = '0%';

    progressBar.appendChild(progressText);
    progressContainer.appendChild(progressBar);
    document.body.appendChild(progressContainer);

    // 更新进度条的函数
    const updateProgress = (current: number, total: number) => {
      const percentage = Math.min(100, Math.round((current / total) * 100));
      progressBar.style.width = `${percentage}%`;
      progressText.textContent = `${percentage}%`;
    };

    try {
      setSaving(true);
      
      let schedulesToDelete = [];
      
      // 优先使用 originalSchedules 中的记录ID进行删除
      if (result.originalSchedules && result.originalSchedules.length > 0) {

        schedulesToDelete = result.originalSchedules.filter((sc: any) => sc.id);
      } else {
        // 传统匹配方式作为备用

        // 获取所有排课记录
        const allSchedules = await scheduleService.getAll();
        
        // 获取所有课程
        const allCourses = await courseService.getAll();
        
        // 找到与当前结果匹配的排课记录
        schedulesToDelete = allSchedules.filter(sc => {
          // 匹配课程名称
          const course = findCourseById(allCourses, sc.course_id);
          if (!course || course.course_name !== result.courseName) {
            return false;
          }
          
          // 匹配学生
          const student = students.find(s => s.id === sc.student_id);
          if (!student) {
            return false;
          }
          const studentNames = result.studentName.split('、');
          if (!studentNames.includes(student.name)) {
            return false;
          }
          
          // 匹配时间 - 更宽松的匹配
          return sc.day_of_week === result.dayOfWeek && sc.period === result.period;
        });
        
        // 如果找不到匹配的记录，尝试使用更宽松的匹配
        if (schedulesToDelete.length === 0) {

          
          // 更宽松的匹配逻辑
          const relaxedMatches = allSchedules.filter(sc => {
            // 匹配课程名称
            const course = findCourseById(allCourses, sc.course_id);
            if (!course || !course.course_name.includes(result.courseName)) {
              return false;
            }
            
            // 匹配学生
            const student = students.find(s => s.id === sc.student_id);
            if (!student) {
              return false;
            }
            const studentNames = result.studentName.split('、');
            if (!studentNames.includes(student.name)) {
              return false;
            }
            
            return true;
          });
          

          if (relaxedMatches.length > 0) {
            schedulesToDelete.push(...relaxedMatches);
          }
        }
      }
      

      
      // 收集所有要删的 id，一次批量删除
      const idsToDelete = schedulesToDelete.map((s: any) => s.id).filter(Boolean);
      const totalTasks = idsToDelete.length + 2; // 删除记录 + 刷新数据
      let completedTasks = 0;
      
      if (idsToDelete.length > 0) {
        await scheduleService.deleteMany(idsToDelete);
        completedTasks += schedulesToDelete.length;
        updateProgress(completedTasks, totalTasks);
      }
      
      // 删除接口已成功，立即显示 100% 并移除进度条，避免卡在 98% 等待后续刷新
      updateProgress(totalTasks, totalTasks);
      try {
        const bar = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      } catch (_) {}
      
      // 强制刷新排课数据（后台执行，不再阻塞进度条）
      const effectiveTeacher = targetTeacher || teacher;
      if (effectiveTeacher) {
        // 先获取最新的所有课程数据
        const [latestCourses] = await Promise.all([
          courseService.getAll()
        ]);
        
        // 然后获取教师的排课数据
        const scheduleData = await scheduleService.getByTeacher(effectiveTeacher.id);
        const displaySchedule: ScheduledClassDisplay[] = scheduleData.map(sc => ({
          id: sc.id,
          day_of_week: sc.day_of_week,
          period: sc.period,
          course_id: sc.course_id,
          course_name: sc.courses?.course_name || sc.course_name || findCourseById(latestCourses, sc.course_id)?.course_name || '课程',
          course_type: sc.courses?.course_type || sc.course_type || findCourseById(latestCourses, sc.course_id)?.course_type || '器乐',
          teacher_id: sc.teacher_id,
          teacher_name: sc.teacher_name || sc.courses?.teacher_name || sc.courses?.teacher?.name || effectiveTeacher.name,
          student_id: sc.student_id,
          student_name: sc.students?.name || sc.student_name || students.find(s => s.id === sc.student_id)?.name || '学生',
          room_name: sc.rooms?.room_name || sc.room_name || (sc as any).rooms?.room_name || (sc as any).room_name,
          class_name: sc.class_name || sc.courses?.major_class || findCourseById(latestCourses, sc.course_id)?.major_class || students.find(s => s.id === sc.student_id)?.major_class || '',
          start_week: sc.start_week,
          end_week: sc.end_week,
          group_id: sc.group_id
        }));
        

        setScheduledClasses(displaySchedule);
        completedTasks++;
        updateProgress(completedTasks, totalTasks);
      }
      
      // 刷新全量排课缓存，使学生进度（已排满/未排满）立即重算，恢复被删记录对应学生的未排课状态
      const freshSchedules = await scheduleService.getAll();
      setAllSchedulesCache(freshSchedules);
      
      completedTasks++;
      updateProgress(completedTasks, totalTasks);
      
      // 确保进度条显示 100% 后再结束（避免因步骤舍入或时序卡在 99%）
      updateProgress(totalTasks, totalTasks);
      
      showToast('success', `成功删除 ${schedulesToDelete.length} 条排课记录`);
      
      // 记录操作日志
      await operationLogService.log(
        '删除排课',
        'schedule',
        `删除 ${result.studentName} 的 ${result.courseName}，时间：周${result.dayOfWeek} 第${result.period}节`,
        undefined,
        result.studentName
      );
      
    } catch (error) {
      console.error('删除排课失败:', error);
      showToast('error', '删除排课失败，请检查控制台错误信息');
    } finally {
      // 移除进度条
      const progressContainer = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
      if (progressContainer) {
        document.body.removeChild(progressContainer);
      }
      setSaving(false);
    }
  };

  // 处理批量删除排课
  const handleBatchDeleteSchedules = async () => {
    if (!confirm(`确定要删除选中的 ${selectedScheduleIds.size} 条排课记录吗？`)) return;
    
    // 显示进度条（醒目样式）
    const progressContainer = document.createElement('div');
    progressContainer.className = 'fixed top-0 left-0 w-full h-8 bg-gray-100 z-50 shadow-lg flex items-center';

    const progressBar = document.createElement('div');
    progressBar.className = 'h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-300 flex items-center justify-end pr-2';
    progressBar.style.width = '0%';

    const progressText = document.createElement('span');
    progressText.className = 'text-white text-sm font-bold';
    progressText.textContent = '0%';

    progressBar.appendChild(progressText);
    progressContainer.appendChild(progressBar);
    document.body.appendChild(progressContainer);

    // 更新进度条的函数
    const updateProgress = (current: number, total: number) => {
      const percentage = Math.min(100, Math.round((current / total) * 100));
      progressBar.style.width = `${percentage}%`;
      progressText.textContent = `${percentage}%`;
    };

    try {
      setSaving(true);
      
      // 获取所有排课结果，收集所有要删的底层记录 id
      const allResults = scheduleResults;
      const allIdsToDelete: string[] = [];
      for (const scheduleId of selectedScheduleIds) {
        const schedule = allResults.find((result: any) => result.id === scheduleId);
        if (schedule?.originalSchedules?.length > 0) {
          for (const originalSchedule of schedule.originalSchedules) {
            if (originalSchedule.id) {
              allIdsToDelete.push(originalSchedule.id);
            }
          }
        }
      }
      
      const totalTasks = 3; // 批量删除完成 → 刷新列表 → 清空选中
      let completedTasks = 0;
      
      if (allIdsToDelete.length > 0) {
        await scheduleService.deleteMany(allIdsToDelete);
      }
      completedTasks++;
      updateProgress(completedTasks, totalTasks);
      
      // 删除接口已成功，立即显示 100% 并移除进度条，避免卡在 33% 等待后续刷新
      updateProgress(totalTasks, totalTasks);
      try {
        const bar = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      } catch (_) {}
      
      // 强制刷新排课数据（后台执行，不再阻塞进度条）
      const effectiveTeacher = targetTeacher || teacher;
      if (effectiveTeacher) {
        // 先获取最新的所有课程数据
        const [latestCourses] = await Promise.all([
          courseService.getAll()
        ]);
        
        // 然后获取教师的排课数据
        const scheduleData = await scheduleService.getByTeacher(effectiveTeacher.id);
        const displaySchedule: ScheduledClassDisplay[] = scheduleData.map(sc => ({
          id: sc.id,
          day_of_week: sc.day_of_week,
          period: sc.period,
          course_id: sc.course_id,
          course_name: sc.courses?.course_name || sc.course_name || findCourseById(latestCourses, sc.course_id)?.course_name || '课程',
          course_type: sc.courses?.course_type || sc.course_type || findCourseById(latestCourses, sc.course_id)?.course_type || '器乐',
          teacher_id: sc.teacher_id,
          teacher_name: sc.teacher_name || sc.courses?.teacher_name || sc.courses?.teacher?.name || effectiveTeacher.name,
          student_id: sc.student_id,
          student_name: sc.students?.name || sc.student_name || students.find(s => s.id === sc.student_id)?.name || '学生',
          room_name: sc.rooms?.room_name || sc.room_name || (sc as any).rooms?.room_name || (sc as any).room_name,
          class_name: sc.class_name || sc.courses?.major_class || findCourseById(latestCourses, sc.course_id)?.major_class || students.find(s => s.id === sc.student_id)?.major_class || '',
          start_week: sc.start_week,
          end_week: sc.end_week,
          group_id: sc.group_id
        }));
        
        setScheduledClasses(displaySchedule);
        completedTasks++;
        updateProgress(completedTasks, totalTasks);
      }
      
      // 刷新全量排课缓存，使学生进度（已排满/未排满）立即重算，恢复被删记录对应学生的未排课状态
      const freshSchedules = await scheduleService.getAll();
      setAllSchedulesCache(freshSchedules);
      completedTasks++;
      updateProgress(completedTasks, totalTasks);
      
      // 清空选中状态
      setSelectedScheduleIds(new Set());
      completedTasks++;
      updateProgress(completedTasks, totalTasks);
      
      // 确保进度条显示 100% 后再结束（避免卡在 99%）
      updateProgress(totalTasks, totalTasks);
      
      const deletedCount = allIdsToDelete.length;
      showToast('success', `成功删除 ${deletedCount} 条排课记录`);
      
      // 记录操作日志
      await operationLogService.log(
        '批量删除排课',
        'schedule',
        `批量删除 ${deletedCount} 条排课记录`,
        undefined,
        undefined
      );
    } catch (error) {
      console.error('批量删除排课失败:', error);
      showToast('error', '批量删除排课失败，请检查控制台错误信息');
    } finally {
      // 移除进度条
      const progressContainer = document.querySelector('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
      if (progressContainer) {
        document.body.removeChild(progressContainer);
      }
      setSaving(false);
    }
  };

  // 初始化目标教师和可用教师列表
  useEffect(() => {
    const initializeTargetTeacher = async () => {
      if (isAdmin) {
        // 管理员：加载所有教师列表
        try {
          const teachers = await teacherService.getAll();
          setAvailableTeachers(teachers);
        } catch (error) {
          console.error('加载教师列表失败:', error);
        }
      } else if (teacher) {
        // 教师：将自己添加到可用教师列表（用于显示琴房信息）
        setAvailableTeachers([teacher]);
      }
      
      // 设置目标教师（只在 targetTeacher 为 null 时设置，避免死循环）
      if (isAdmin) {
        // 管理员：不自动设置目标教师，需要手动选择
        // 保持 targetTeacher 为 null，等管理员手动选择教师后再加载学生数据
      } else {
        // 教师：目标教师只能是自己
        // 只在 targetTeacher 为 null 时设置，避免重复设置导致的死循环
        if (!targetTeacher) {
          if (teacher) {
            setTargetTeacher(teacher);
          } else if (user) {
            // 使用user对象构建一个临时的教师对象
            const tempTeacher: Teacher = {
              id: user.id,
              teacher_id: user.teacher_id,
              name: user.full_name,
              email: user.email,
              faculty_id: user.faculty_id,
              faculty_name: user.faculty_name,
              specialty: user.specialty,
              max_students: user.max_students,
              created_at: user.created_at,
              updated_at: user.updated_at
            };
            setTargetTeacher(tempTeacher);
          }
        }
      }
    };
    
    initializeTargetTeacher();
    // 刷新在线教师列表
    if (refreshOnlineTeachers) {
      refreshOnlineTeachers();
    }
    // 注意：不将 targetTeacher 放入依赖项，避免死循环
    // targetTeacher 的变化会触发数据加载 useEffect，不需要在这里重复触发
  }, [teacher, isAdmin, user, refreshOnlineTeachers]);
  
  // 方案 A：进入排课页强制加载完整禁排，未就绪前禁用时间网格与保存
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await refreshBlockedTimes();
        if (!cancelled) {
          syncBlockedTimes();
          setBlockedTimesSchedulingReady(true);
        }
      } catch (e) {
        console.error('加载禁排失败:', e);
        if (!cancelled) setBlockedTimesSchedulingReady(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [refreshBlockedTimes, syncBlockedTimes]);

  // 当 largeClassEntries 变化时，同步到统一格式
  useEffect(() => {
    if (blockedTimesLoaded) syncBlockedTimes();
  }, [blockedTimesLoaded, largeClassEntries, syncBlockedTimes]);

  // 加载数据 - 基于目标教师
  useEffect(() => {
    let isCancelled = false;
    let progressContainer: HTMLDivElement | null = null;
    
    // 添加页面卸载事件监听器
    const handleBeforeUnload = () => {
      if (progressContainer) {
        try {
          document.body.removeChild(progressContainer);
        } catch (e) {
          // 忽略移除失败的错误
        }
      }
      // 移除所有可能的进度条
      removeAllProgressBars();
    };
    
    // 移除所有进度条的函数
    const removeAllProgressBars = () => {
      const progressBars = document.querySelectorAll('.fixed.top-0.left-0.w-full.h-8.bg-gray-100.z-50');
      progressBars.forEach(bar => {
        try {
          document.body.removeChild(bar);
        } catch (e) {
          // 忽略移除失败的错误
        }
      });
    };
    
    // 监听页面卸载事件
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    const fetchData = async () => {
      try {
        // 先移除任何现有的进度条
        removeAllProgressBars();
        
        // 显示进度条（醒目样式）
        progressContainer = document.createElement('div');
        progressContainer.className = 'fixed top-0 left-0 w-full h-8 bg-gray-100 z-50 shadow-lg flex items-center';
        
        const progressBar = document.createElement('div');
        progressBar.className = 'h-full bg-gradient-to-r from-purple-500 to-purple-600 transition-all duration-300 flex items-center justify-end pr-2';
        progressBar.style.width = '0%';
        
        const progressText = document.createElement('span');
        progressText.className = 'text-white text-sm font-bold';
        progressText.textContent = '0%';
        
        progressBar.appendChild(progressText);
        progressContainer.appendChild(progressBar);
        document.body.appendChild(progressContainer);
        
        // 更新进度条（直接赋值，避免 requestAnimationFrame 循环导致 CPU 占用过高）
        const updateProgress = (current: number, total: number) => {
          if (isCancelled || !progressContainer) return;
          const pct = Math.min(100, Math.round((current / total) * 100));
          progressBar.style.width = `${pct}%`;
          progressText.textContent = `${pct}%`;
        };

        // 计算总任务数
        const totalTasks = 11; // 获取学生数据 + 同步班级 + 获取所有数据 + 筛选小组课 + 过滤学生 + 过滤排课 + 获取琴房配置 + 获取周次配置 + 计算已排完的学生状态 + 转换显示格式 + 初始化时间网格
        let completedTasks = 0;

        // 确定是否需要加载学生数据
        // 管理员：未选教师时不绑定到自己（110），选了教师才按该教师过滤
        // 普通教师：仍然使用自己的 id 作为有效教师
        const effectiveTeacherId = isAdmin
          ? (targetTeacher?.id ?? null)
          : (targetTeacher?.id || teacher?.id);

        // 专门用于调用教师相关 API 的 ID（支持 UUID 或工号）
        // 管理员：先用 id（UUID 或工号），再用 teacher_id
        // 普通教师：优先工号，再退回 id，避免因 user 的 UUID 导致 404
        const effectiveTeacherIdForApi = isAdmin
          ? (targetTeacher?.id ??
             teacher?.id ??
             targetTeacher?.teacher_id ??
             teacher?.teacher_id)
          : (targetTeacher?.teacher_id ??
             targetTeacher?.id ??
             teacher?.teacher_id ??
             teacher?.id);

        // 管理员始终加载全部学生；普通教师在有有效教师ID时加载
        const shouldLoadStudents = isAdmin || !!effectiveTeacherId;
        
        // 获取学生数据（仅在需要时加载）
        updateProgress(completedTasks, totalTasks);
        let allStudentsData: any[] = [];
        if (shouldLoadStudents) {
          allStudentsData = await studentService.getAll();
        }
        if (isCancelled) return;
        completedTasks++;
        updateProgress(completedTasks, totalTasks);
        
        // 设置学生数据
        setStudents(allStudentsData);
        
        // 确保班级数据已同步
        if (allStudentsData.length > 0) {
          const existingClasses = await classService.getAll();
          if (isCancelled) return;
          if (existingClasses.length === 0) {
            await classService.syncFromStudents(allStudentsData);
            if (isCancelled) return;
          }
        }
        completedTasks++;
        updateProgress(completedTasks, totalTasks);
        
        // 获取所有数据（添加超时处理）
        const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
          return Promise.race([
            promise,
            new Promise<T>((_, reject) => 
              setTimeout(() => {
                console.warn('Service request timed out, using fallback');
                reject(new Error('Timeout'));
              }, timeoutMs)
            )
          ]).catch(() => fallback);
        };
        
        const [coursesData, scheduleData, allRooms, classesData, largeClassesData] = await Promise.all([
          withTimeout(courseService.getAll(), 3000, []), // 获取所有课程
          withTimeout(scheduleService.getAll(), 10000, []), // 获取所有排课记录（10s 超时，避免列表不显示）
          withTimeout(roomService.getAll(), 3000, []), // 获取所有琴房
          withTimeout(classService.getAll(), 3000, []), // 获取所有班级
          withTimeout(largeClassScheduleService.getAll(), 3000, []), // 获取通适大课数据
        ]);
        if (isCancelled) return;
        if (!scheduleData || scheduleData.length === 0) {
          console.warn('排课接口返回空或超时，排课结果列表将为空。请检查网络或后端 GET /schedules。');
        }
        completedTasks++;
        updateProgress(completedTasks, totalTasks);

        // 设置通适大课数据
        setLargeClassEntries(largeClassesData || []);


        // 注意：unifiedBlockedTimes 会在 useEffect 中自动同步

        // 筛选小组课数据
        const groupCoursesData = Array.from(
          coursesData
            .filter(course => {
              // 只保留授课类型为小组课的课程
              const isGroupCourse = (course as any).teaching_type === '小组课';
              
              // 根据教师的教研室过滤课程
              if (effectiveTeacherId) {
                const effTeacher = targetTeacher || teacher;
                if (isCourseAssignedToTeacher(course, effTeacher)) {
                  // 课程已分配给当前教师，跳过教研室过滤（跨教研室也显示）
                } else {
                  // 获取教师的教研室代码（使用faculty_id字段，这是教师数据中存储教研室信息的正确字段）
                  const teacherFacultyId = targetTeacher?.faculty_id || teacher?.faculty_id;
                  if (teacherFacultyId) {
                    // 检查课程的教研室是否与教师的教研室匹配
                    const courseFacultyId = (course as any).faculty_id || course.faculty_id;
                    const courseType = (course as any).course_type || course.course_type;
                    const teacherNumber = targetTeacher?.id || teacher?.id;
                    const isLinLinTeacher = teacherNumber === '120170194';
                    if (courseFacultyId) {
                      if (!isGroupCourse || courseFacultyId !== teacherFacultyId) {
                        if (!isLinLinTeacher || courseType !== '钢琴') {
                          return false;
                        }
                      }
                    } else if (courseType) {
                      const courseFacultyCode = INSTRUMENT_TO_FACULTY[courseType] || '';
                      if (!isGroupCourse || courseFacultyCode !== teacherFacultyId) {
                        if (!isLinLinTeacher || courseType !== '钢琴') {
                          return false;
                        }
                      }
                    } else if (!isGroupCourse) {
                      return false;
                    }
                  } else if (!isGroupCourse) {
                    return false;
                  }
                }
              }
              // 如果没有教师信息，至少要是小组课
              else if (!isGroupCourse) {
                return false;
              }
              
              // 根据当前小组的主要专业类型过滤课程
              if (groupMajorType && groupStudents.length > 0) {
                const courseType = (course as any).course_type || course.course_type;
                if (courseType) {
                  // 检查课程类型是否与小组主要专业类型匹配
                  // 例如：如果小组主要是钢琴专业，只显示钢琴课程
                  if (groupMajorType === '钢琴' && courseType !== '钢琴') {
                    return false;
                  } else if (groupMajorType === '声乐' && courseType !== '声乐') {
                    return false;
                  } else if (groupMajorType === '器乐' && courseType !== '器乐') {
                    return false;
                  }
                }
              }
              
              // 根据小组学生的班级过滤课程
              if (groupStudents.length > 0) {
                // 获取小组学生的班级
                const studentClasses = new Set(groupStudents.map(student => student.major_class));
                // 获取课程的班级
                const courseClass = (course as any).class_name || (course as any).major_class || '';
                // 如果课程有班级信息，且不在学生班级列表中，过滤掉
                if (courseClass && !Array.from(studentClasses).some(sClass => courseClass.includes(sClass))) {
                  return false;
                }
              }
              
              return true;
            })
            // 排除任课教师为空的“不完整”课程（本系统课程均为固定数据，排课不生成新课程）
            .filter((c: any) => ((c.teacher_name || c.teacher_id || '').toString().trim()) !== '')
            // 按 (课程编号, 班级) 去重，同一课程只保留一条，避免重复显示
            .reduce((map: Map<string, any>, course: any) => {
              const key = `${(course.course_id || course.id || '').toString().trim()}_${(course.major_class || (course as any).class_name || '').toString().trim()}`;
              const existing = map.get(key);
              if (!existing) {
                map.set(key, course);
                return map;
              }
              const existingHasTeacher = !!((existing.teacher_name || existing.teacher_id || '').toString().trim());
              const currentHasTeacher = !!((course.teacher_name || course.teacher_id || '').toString().trim());
              if (currentHasTeacher && !existingHasTeacher) map.set(key, course);
              return map;
            }, new Map())
            .values()
        );
        setGroupCourses(filterValidGroupCoursesForDisplay(groupCoursesData || []));
        completedTasks++;
        updateProgress(completedTasks, totalTasks);


        setCourses(coursesData || []);
        setStudents(allStudentsData); // 所有学生（用于查找已排课程）
        setRooms(allRooms || []); // 设置所有房间数据
        
        // 根据目标教师过滤数据
        // effectiveTeacherId 已在上面定义

        
        if (effectiveTeacherId) {
          // 尝试多种方式匹配学生（包括主项和副项），并为每个课程类型创建学生实例
          const targetStudentsData: any[] = [];
          
          allStudentsData.forEach(s => {
            // 检查学生是否与当前教师有关联
            const isTeacherMatch = (
              // 直接匹配 teacher_id（主项）
              s.teacher_id === effectiveTeacherId ||
              // 尝试通过教师姓名匹配（主项）
              (targetTeacher && s.teacher_name === targetTeacher.name) ||
              // 尝试通过教师工号匹配（主项）
              (targetTeacher && s.teacher_id === targetTeacher.teacher_id) ||
              // 匹配主项教师（通过assigned_teachers）
              (s.assigned_teachers && (
                // 尝试匹配教师ID
                s.assigned_teachers.primary_teacher_id === effectiveTeacherId ||
                // 尝试匹配教师工号
                (targetTeacher && s.assigned_teachers.primary_teacher_id === targetTeacher.teacher_id) ||
                // 匹配副项教师（副项1、副项2、副项3）
                // 尝试匹配教师ID
                s.assigned_teachers.secondary1_teacher_id === effectiveTeacherId ||
                s.assigned_teachers.secondary2_teacher_id === effectiveTeacherId ||
                s.assigned_teachers.secondary3_teacher_id === effectiveTeacherId ||
                // 尝试匹配教师工号
                (targetTeacher && (
                  s.assigned_teachers.secondary1_teacher_id === targetTeacher.teacher_id ||
                  s.assigned_teachers.secondary2_teacher_id === targetTeacher.teacher_id ||
                  s.assigned_teachers.secondary3_teacher_id === targetTeacher.teacher_id
                ))
              ))
            );
            
            // 分别检查主项教师和副项教师匹配
            // 1. 检查是否为主项教师
            const isPrimaryTeacherMatch = (
              s.teacher_id === effectiveTeacherId ||
              (targetTeacher && s.teacher_name === targetTeacher.name) ||
              (targetTeacher && s.teacher_id === targetTeacher.teacher_id) ||
              (targetTeacher && s.teacher_id === targetTeacher.id) ||
              (s.assigned_teachers && (
                s.assigned_teachers.primary_teacher_id === effectiveTeacherId ||
                (targetTeacher && s.assigned_teachers.primary_teacher_id === targetTeacher.teacher_id) ||
                (targetTeacher && s.assigned_teachers.primary_teacher_id === targetTeacher.id) ||
                (targetTeacher && s.assigned_teachers.primary_teacher_name === targetTeacher.name)
              ))
            );
            
            // 2. 检查是否为副项教师
            const isSecondaryTeacherMatch = s.assigned_teachers && (
              s.assigned_teachers.secondary1_teacher_id === effectiveTeacherId ||
              s.assigned_teachers.secondary2_teacher_id === effectiveTeacherId ||
              s.assigned_teachers.secondary3_teacher_id === effectiveTeacherId ||
              (targetTeacher && (
                s.assigned_teachers.secondary1_teacher_id === targetTeacher.teacher_id ||
                s.assigned_teachers.secondary2_teacher_id === targetTeacher.teacher_id ||
                s.assigned_teachers.secondary3_teacher_id === targetTeacher.teacher_id ||
                s.assigned_teachers.secondary1_teacher_id === targetTeacher.id ||
                s.assigned_teachers.secondary2_teacher_id === targetTeacher.id ||
                s.assigned_teachers.secondary3_teacher_id === targetTeacher.id ||
                s.assigned_teachers.secondary1_teacher_name === targetTeacher.name ||
                s.assigned_teachers.secondary2_teacher_name === targetTeacher.name ||
                s.assigned_teachers.secondary3_teacher_name === targetTeacher.name
              ))
            );
            
            // 1. 主项课程：只有当教师是学生的主项教师时才添加
            if (isPrimaryTeacherMatch && s.primary_instrument) {
              targetStudentsData.push({
                ...s,
                __courseType: s.primary_instrument,
                __source: 'primary'
              });
            }
            
            // 2. 副项课程：只有当教师是学生的副项教师时才添加
            if (isSecondaryTeacherMatch && s.secondary_instruments && s.secondary_instruments.length > 0) {
              // 检查每个副项是否由当前教师教授
              s.secondary_instruments.forEach((instrument: string, index: number) => {
                // 检查副项教师是否为当前教师
                let isThisSecondaryTeacherMatch = false;
                
                // 根据索引检查对应的副项教师
                switch (index) {
                  case 0:
                    if (s.assigned_teachers?.secondary1_teacher_id === effectiveTeacherId ||
                        (targetTeacher && s.assigned_teachers?.secondary1_teacher_id === targetTeacher.teacher_id)) {
                      isThisSecondaryTeacherMatch = true;
                    }
                    break;
                  case 1:
                    if (s.assigned_teachers?.secondary2_teacher_id === effectiveTeacherId ||
                        (targetTeacher && s.assigned_teachers?.secondary2_teacher_id === targetTeacher.teacher_id)) {
                      isThisSecondaryTeacherMatch = true;
                    }
                    break;
                  case 2:
                    if (s.assigned_teachers?.secondary3_teacher_id === effectiveTeacherId ||
                        (targetTeacher && s.assigned_teachers?.secondary3_teacher_id === targetTeacher.teacher_id)) {
                      isThisSecondaryTeacherMatch = true;
                    }
                    break;
                }
                
                // 只有当副项教师是当前教师时，才创建学生实例
                if (isThisSecondaryTeacherMatch) {
                  targetStudentsData.push({
                    ...s,
                    __courseType: instrument,
                    __source: 'secondary'
                  });
                }
              });
            } else if (isSecondaryTeacherMatch && s.secondary_instrument1) {
              // 兼容旧格式
              // 检查副项1教师是否为当前教师
              if (s.assigned_teachers?.secondary1_teacher_id === effectiveTeacherId ||
                  (targetTeacher && s.assigned_teachers?.secondary1_teacher_id === targetTeacher.teacher_id)) {
                targetStudentsData.push({
                  ...s,
                  __courseType: s.secondary_instrument1,
                  __source: 'secondary'
                });
              }
            }
        });
        
          setMyStudents(targetStudentsData);
          completedTasks++;
          updateProgress(completedTasks, totalTasks);
          
          // 获取排课记录
          // 管理员可以查看所有教师的排课，教师只能查看自己的排课
          // 同时过滤掉专业大课（理论课），只显示专业小课
          const rawScheduleList = Array.isArray(scheduleData) ? scheduleData : [];
          let filteredScheduleData = rawScheduleList;

          // 如果选择了目标教师，只显示该教师的排课（管理员选择教师后也只显示该教师的排课）
          if (effectiveTeacherId) {
            const teacherIdSet = getCurrentTeacherIdSet();
            // 只要排课中的 teacher_id 归一化后命中当前教师ID集合，就认为是当前教师的排课
            filteredScheduleData = filteredScheduleData.filter(sc => isCurrentTeacherSchedule(sc, teacherIdSet));
          }
          
          // 过滤掉专业大课（理论课），只显示专业小课
          // 通过关联的课程数据判断课程类型
          filteredScheduleData = filteredScheduleData.filter(sc => {
            // 同时检查课程的内部ID和课程编号
            const course = coursesData.find(c => c.id === sc.course_id || (c as any).course_id === sc.course_id);

            // 如果找到了课程数据
            if (course) {
              // 检查 teaching_type 是否为专业大课
              if ((course as any).teaching_type === '专业大课') {
                return false;
              }
              // 检查 course_type 是否为理论课
              if (course.course_type === '理论课') {
                return false;
              }
            }

            // 检查排课记录本身的 teaching_type
            if ((sc as any).teaching_type === '专业大课' || (sc as any).teaching_type === '大课') {
              return false;
            }

            // 检查课程名称是否包含"理论"或"大课"
            const courseName = sc.course_name || course?.course_name || '';
            if (courseName.includes('理论') || courseName.includes('大课')) {
              return false;
            }

            // 通过以上所有检查，显示该课程
            return true;
          });
          

          
          // 检查 group_id 是否存在
          const hasGroupId = filteredScheduleData.some((sc: any) => sc.group_id);

          // 转为展示格式（与管理员分支一致），保证排课结果列表有 course_name/teacher_name 等
          const effectiveTeacher = targetTeacher || teacher;
          const displayScheduleForTeacher: ScheduledClassDisplay[] = filteredScheduleData.map((sc: any) => ({
            id: sc.id,
            day_of_week: sc.day_of_week,
            period: sc.period,
            course_id: sc.course_id,
            course_name: sc.course_name || findCourseById(coursesData || [], sc.course_id)?.course_name || '课程',
            course_type: sc.course_type || findCourseById(coursesData || [], sc.course_id)?.course_type || '器乐',
            teacher_id: sc.teacher_id,
            teacher_name: sc.teacher_name || effectiveTeacher?.name || '未知教师',
            student_id: sc.student_id,
            student_name: sc.student_name || allStudentsData.find((s: any) => s.id === sc.student_id)?.name || '学生',
            room_name: sc.room_name || (sc as any).rooms?.room_name,
            class_name: sc.class_name || findCourseById(coursesData || [], sc.course_id)?.major_class || allStudentsData.find((s: any) => s.id === sc.student_id)?.major_class || '',
            start_week: sc.start_week,
            end_week: sc.end_week
          }));
          setScheduledClasses(displayScheduleForTeacher);
          setHasScheduleData(displayScheduleForTeacher.length > 0);
          completedTasks++;
          updateProgress(completedTasks, totalTasks);
          
          // 获取目标教师的琴房配置
          try {
            const teacherIdForApi = effectiveTeacherIdForApi;
            if (teacherIdForApi) {
              const teacherData = await teacherService.getByTeacherId(teacherIdForApi);
              if (isCancelled) return;
              
              if (teacherData) {
                const roomList: Array<{ room: Room | null; facultyCode: string }> = [];
                
                if (teacherData.fixed_rooms && teacherData.fixed_rooms.length > 0) {
                  for (const fr of teacherData.fixed_rooms) {
                    const room = allRooms.find(r => r.id === fr.room_id);
                    roomList.push({ room: room || null, facultyCode: fr.faculty_code });
                  }
                } else if (teacherData.fixed_room_id) {
                  // 旧格式：单个 fixed_room_id
                  const room = allRooms.find(r => r.id === teacherData.fixed_room_id);
                  roomList.push({ room: room || null, facultyCode: 'PIANO' });
                }
                
                setFixedRooms(roomList);
              } else {
                console.warn('未找到教师数据:', teacherIdForApi);
                // 尝试从所有教师数据中查找
                const allTeachers = await teacherService.getAll();
                if (isCancelled) return;
                const foundTeacher = allTeachers.find(t => t.teacher_id === teacherIdForApi || t.id === teacherIdForApi);
                
                if (foundTeacher) {
                  const roomList: Array<{ room: Room | null; facultyCode: string }> = [];
                  if (foundTeacher.fixed_rooms && foundTeacher.fixed_rooms.length > 0) {
                    for (const fr of foundTeacher.fixed_rooms) {
                      const room = allRooms.find(r => r.id === fr.room_id);
                      roomList.push({ room: room || null, facultyCode: fr.faculty_code });
                    }
                  } else if (foundTeacher.fixed_room_id) {
                    const room = allRooms.find(r => r.id === foundTeacher.fixed_room_id);
                    roomList.push({ room: room || null, facultyCode: 'PIANO' });
                  }
                  setFixedRooms(roomList);
                }
              }
            }
          } catch (roomError) {
            console.error('获取目标教师琴房配置失败:', roomError);
          } finally {
            completedTasks++;
            updateProgress(completedTasks, totalTasks);
          }
          
        } else if (isAdmin) {
          // 管理员未选教师：排课结果模块显示所有已排课程，仅过滤专业大课/理论课，并转成展示结构（与选教师时一致）
          const rawList = Array.isArray(scheduleData) ? scheduleData : [];
          const adminFilteredSchedule = rawList.filter((sc: any) => {
            const course = coursesData.find((c: any) => c.id === sc.course_id || c.course_id === sc.course_id);
            if (course) {
              if ((course as any).teaching_type === '专业大课') return false;
              if ((course as any).course_type === '理论课') return false;
            }
            if (sc.teaching_type === '专业大课' || sc.teaching_type === '大课') return false;
            const courseName = sc.course_name || (course as any)?.course_name || '';
            if (courseName.includes('理论') || courseName.includes('大课')) return false;
            return true;
          });
          const displaySchedule: ScheduledClassDisplay[] = adminFilteredSchedule.map((sc: any) => {
            const effectiveTeacher = targetTeacher || teacher;
            return {
              id: sc.id,
              day_of_week: sc.day_of_week,
              period: sc.period,
              course_id: sc.course_id,
              course_name: sc.courses?.course_name || sc.course_name || findCourseById(coursesData || [], sc.course_id)?.course_name || '课程',
              course_type: sc.courses?.course_type || sc.course_type || findCourseById(coursesData || [], sc.course_id)?.course_type || '器乐',
              teacher_id: sc.teacher_id,
              teacher_name: sc.teacher_name || sc.courses?.teacher_name || sc.courses?.teacher?.name || effectiveTeacher?.name || '未知教师',
              student_id: sc.student_id,
              student_name: sc.students?.name || sc.student_name || allStudentsData.find((s: any) => s.id === sc.student_id)?.name || '学生',
              room_name: sc.rooms?.room_name || sc.room_name || (sc as any).rooms?.room_name || (sc as any).room_name,
              class_name: sc.class_name || sc.courses?.major_class || findCourseById(coursesData || [], sc.course_id)?.major_class || allStudentsData.find((s: any) => s.id === sc.student_id)?.major_class || '',
              start_week: sc.start_week,
              end_week: sc.end_week
            };
          });
          setScheduledClasses(displaySchedule);
          setHasScheduleData(displaySchedule.length > 0);
          setMyStudents([]);
          setFixedRooms([]);
          completedTasks += 3;
          updateProgress(completedTasks, totalTasks);
        } else {
          setMyStudents([]);
          setScheduledClasses([]);
          setHasScheduleData(false);
          setFixedRooms([]);
          completedTasks += 3; // 跳过学生过滤、排课过滤和琴房配置三个任务
          updateProgress(completedTasks, totalTasks);
        }
        
        setClasses(classesData || []);

        // 获取学期周次配置
        try {
          const weekConfigData = await weekConfigService.getBySemester(selectedSemesterLabel);
          
          if (weekConfigData) {
            // 获取总周数
            let totalWeeksValue = weekConfigData.total_weeks || 16;
            setTotalWeeks(totalWeeksValue);
            
            // 获取开始日期
            const startDateValue = weekConfigData.start_date || '';
            setSemesterStartDate(startDateValue);
            
            setSelectedWeekRange({
              startWeek: 1,
              endWeek: totalWeeksValue
            });
          } else {
            console.warn('未找到周次配置，使用默认值');
            setTotalWeeks(16);
            setSemesterStartDate('');
            setSelectedWeekRange({
              startWeek: 1,
              endWeek: 16
            });
          }
        } catch (weekError) {
          console.warn('获取周次配置失败，使用默认值:', weekError);
          setTotalWeeks(16);
          setSemesterStartDate('');
          setSelectedWeekRange({
            startWeek: 1,
            endWeek: 16
          });
        } finally {
          completedTasks++;
          updateProgress(completedTasks, totalTasks);
        }

        // 获取教师的多琴房配置（如果有登录教师）
        if (teacher) {
          try {
            // 管理员：按 id 优先，其次 teacher_id；普通教师：优先 teacher_id
            const teacherIdForApi = isAdmin
              ? (teacher.id ?? (teacher as any).teacher_id)
              : ((teacher as any).teacher_id ?? teacher.id);

            if (teacherIdForApi) {
              const teacherData = await teacherService.getByTeacherId(teacherIdForApi);
              if (isCancelled) return;
              if (teacherData) {
                const roomList: Array<{ room: Room | null; facultyCode: string }> = [];
                
                if (teacherData.fixed_rooms && teacherData.fixed_rooms.length > 0) {
                  for (const fr of teacherData.fixed_rooms) {
                    const room = allRooms.find(r => r.id === fr.room_id);
                    roomList.push({ room: room || null, facultyCode: fr.faculty_code });
                  }
                } else if (teacherData.fixed_room_id) {
                  // 旧格式：单个 fixed_room_id
                  const room = allRooms.find(r => r.id === teacherData.fixed_room_id);
                  roomList.push({ room: room || null, facultyCode: 'PIANO' });
                }
                
                setFixedRooms(roomList);
              }
            }
          } catch (roomError) {
            console.warn('获取教师琴房配置失败');
          } finally {
            completedTasks++;
            updateProgress(completedTasks, totalTasks);
          }
        } else {
          completedTasks++;
          updateProgress(completedTasks, totalTasks);
        }

        // 计算已排完的学生状态
        completedTasks++;
        updateProgress(completedTasks, totalTasks);

        // 注意：scheduledClasses 已在上面 if (effectiveTeacherId) / else if (isAdmin) / else 中按教师与课程类型正确设置，此处不再用未过滤的 scheduleData 覆盖，避免排课结果列表被清空

        // 使用真实班级数据
        if (classesData && classesData.length > 0) {
          setClasses(classesData as Class[]);
        } else {
          // 如果没有真实数据，提示用户
          console.warn('未获取到班级数据，请先在班级管理中创建班级');
          setClasses([]);
        }

        // 初始化时间网格
        await initializeTimeGrid();
        if (isCancelled) return;
        completedTasks++;
        updateProgress(completedTasks, totalTasks);
        
      } catch (error) {
        console.error('获取数据失败:', error);
        // 即使获取失败也设置为空数组，让页面显示引导
        setStudents([]);
        setCourses([]);
        setScheduledClasses([]);
        setClasses([]);
        setMyStudents([]);
      } finally {
        // 立即移除进度条，不使用setTimeout
        if (progressContainer) {
          try {
            document.body.removeChild(progressContainer);
          } catch (e) {
            // 忽略移除失败的错误
          }
        }
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();
    
    return () => {
      isCancelled = true;
      // 清理函数中立即移除进度条
      if (progressContainer) {
        try {
          document.body.removeChild(progressContainer);
        } catch (e) {
          // 忽略移除失败的错误
        }
      }
      // 移除所有可能的进度条
      removeAllProgressBars();
      // 移除事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [teacher, targetTeacher, isAdmin]);

  // WebSocket实时同步监听
  useEffect(() => {
    const handleScheduleCreated = async (data: any) => {
      console.log('收到新排课:', data);
      const freshSchedules = await scheduleService.getAll();
      setAllSchedulesCache(freshSchedules);
    };

    const handleScheduleUpdated = async (data: any) => {
      console.log('收到排课更新:', data);
      const freshSchedules = await scheduleService.getAll();
      setAllSchedulesCache(freshSchedules);
    };

    const handleScheduleDeleted = async (data: any) => {
      console.log('收到排课删除:', data);
      const freshSchedules = await scheduleService.getAll();
      setAllSchedulesCache(freshSchedules);
    };

    websocketService.on('schedule_created', handleScheduleCreated);
    websocketService.on('schedule_updated', handleScheduleUpdated);
    websocketService.on('schedule_deleted', handleScheduleDeleted);

    return () => {
      websocketService.off('schedule_created', handleScheduleCreated);
      websocketService.off('schedule_updated', handleScheduleUpdated);
      websocketService.off('schedule_deleted', handleScheduleDeleted);
    };
  }, []);

  // 根据选中的学生分组，验证分组有效性
  useEffect(() => {
    validateSelectedStudents();
  }, [selectedStudents, selectedCourseType, myStudents]);

  // 验证选中的学生分组
  const validateSelectedStudents = useCallback(() => {
    const selectedStudentIds = Array.from(selectedStudents);
    const selectedStudentList = students.filter(s => selectedStudentIds.includes(s.id));

    if (selectedStudentList.length === 0) {
      setStudentGroups([]);
      return;
    }

    // 按课程类型分组验证
    const groups: StudentGroup[] = [];

    (['钢琴', '声乐', '器乐'] as const).forEach((courseType) => {
      const studentsOfType = selectedStudentList.filter(s => {
        if (courseType === '钢琴') return s.primary_instrument === '钢琴';
        if (courseType === '声乐') return s.primary_instrument === '声乐';
        return s.primary_instrument && !['钢琴', '声乐'].includes(s.primary_instrument);
      });

      if (studentsOfType.length > 0) {
        const { valid, message } = validateGroup(studentsOfType, courseType);
        groups.push({
          id: uuidv4(),
          students: studentsOfType,
          courseType: courseType,
          isValid: valid,
          message
        });
      }
    });

    setStudentGroups(groups);
  }, [selectedStudents, students]);

  // 验证分组是否符合要求
  const validateGroup = (groupStudents: Student[], courseType: '钢琴' | '声乐' | '器乐'): { valid: boolean; message: string } => {
    if (groupStudents.length === 0) {
      return { valid: true, message: '' };
    }

    // 钢琴/声乐：最多5人，器乐：最多8人
    const maxStudents = ['钢琴', '声乐'].includes(courseType) ? 5 : 8;

    if (groupStudents.length > maxStudents) {
      return { valid: false, message: `${courseType}课每组最多${maxStudents}人，当前${groupStudents.length}人` };
    }

    if (groupStudents.length < 2) {
      return { valid: false, message: `${courseType}课每组至少2人` };
    }

    // 检查主项是否匹配
    const mismatchedStudents = groupStudents.filter(s => {
      if (courseType === '钢琴') return s.primary_instrument !== '钢琴';
      if (courseType === '声乐') return s.primary_instrument !== '声乐';
      return s.primary_instrument === '钢琴' || s.primary_instrument === '声乐';
    });

    if (mismatchedStudents.length > 0) {
      const names = mismatchedStudents.slice(0, 2).map(s => s.name).join('、');
      return { valid: false, message: `学生${names}等的主项与课程类型不匹配` };
    }

    // 检查普通班主项人数限制
    const hasGeneral = groupStudents.some(s => getStudentClassType(s) === 'general');
    if (hasGeneral) {
      const generalStudents = groupStudents.filter(s => getStudentClassType(s) === 'general');
      // 直接使用小组信息中显示的主项学生和副项学生人数计算方式
      const mainCourseStudents = generalStudents.filter(s => studentSources.get(s.id) === 'primary');
      const secondaryStudents = generalStudents.filter(s => studentSources.get(s.id) === 'secondary');

      // 普通班规则：
      // 1. 最多2个主项+0个副项
      // 2. 最多1个主项+2个副项
      // 3. 最多0个主项+4个副项（葫芦丝、竹笛、古筝最多8人）
      if (mainCourseStudents.length > 2) {
        return { 
          valid: false, 
          message: '普通班主项最多2人' 
        };
      }

      if (mainCourseStudents.length === 2 && secondaryStudents.length > 0) {
        return { 
          valid: false, 
          message: '普通班2个主项时不能有副项' 
        };
      }

      if (mainCourseStudents.length === 1 && secondaryStudents.length > 2) {
        return { 
          valid: false, 
          message: '普通班1个主项时最多2个副项' 
        };
      }

      // 检查普通班全部副项人数限制
      if (mainCourseStudents.length === 0) {
        // 检查是否为大组乐器（使用统一常量 LARGE_GROUP_INSTRUMENTS）
        let isLargeGroupCourse = false;
        
        for (const student of generalStudents) {
          if (student.secondary_instruments) {
            for (const instrument of student.secondary_instruments) {
              if (LARGE_GROUP_INSTRUMENTS.includes(instrument)) {
                isLargeGroupCourse = true;
                break;
              }
            }
            if (isLargeGroupCourse) break;
          }
        }
        
        if (isLargeGroupCourse) {
          // 葫芦丝、竹笛、古筝：最多8人
          if (secondaryStudents.length > 8) {
            return { 
              valid: false, 
              message: '普通班全部副项时（葫芦丝、竹笛、古筝）最多8人' 
            };
          }
        } else {
          // 其它专业：最多4人
          if (secondaryStudents.length > 4) {
            return { 
              valid: false, 
              message: '普通班全部副项时最多4人' 
            };
          }
        }
      }
    }

    // 检查专升本副项人数限制
    const hasUpgrade = groupStudents.some(s => getStudentClassType(s) === 'upgrade');
    if (hasUpgrade) {
      const upgradeStudents = groupStudents.filter(s => getStudentClassType(s) === 'upgrade');

      // 按具体乐器区分副项：古筝单独放宽到 3 人，其它乐器仍为 2 人
      const guzhengSecondary = upgradeStudents.filter(s =>
        Array.isArray(s.secondary_instruments) && s.secondary_instruments.includes('古筝')
      );
      const otherSecondary = upgradeStudents.filter(s =>
        Array.isArray(s.secondary_instruments) &&
        !s.secondary_instruments.includes('古筝') &&
        s.secondary_instruments.length > 0
      );

      if (guzhengSecondary.length > 3) {
        return {
          valid: false,
          message: '专升本古筝最多3个副项'
        };
      }

      if (otherSecondary.length > 2) {
        return {
          valid: false,
          message: '专升本最多2个副项'
        };
      }
    }

    return { valid: true, message: `可排课（${groupStudents.length}人/${courseType}）` };
  };

  // 获取周日期
  const getWeekDays = () => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentWeekStart);
      date.setDate(currentWeekStart.getDate() + i);
      days.push(date);
    }
    return days;
  };

  // 获取班级已安排的课程
  const getScheduledForSlot = (dayOfWeek: number, period: number) => {
    return scheduledClasses.filter(
      sc => sc.day_of_week === dayOfWeek && sc.period === period
    );
  };

  // 获取班级中教师名下的学生（根据专业过滤，按学号排序）
  const getClassStudents = () => {
    if (!selectedClass) return [];

    const classYear = selectedClass.class_id.slice(0, 2);

    // 只筛选教师自己名下的学生
    let myClassStudents = myStudents.filter(s => s.major_class?.includes(classYear));

    // 根据选择的专业进一步过滤
    if (selectedMajor !== 'all') {
      myClassStudents = myClassStudents.filter(s => {
        const studentCategory = getStudentCourseType(s);
        return studentCategory === selectedMajor;
      });
    }

    // 根据是否只显示有副项的学生过滤
    if (selectedSecondary) {
      myClassStudents = myClassStudents.filter(s =>
        s.secondary_instruments && s.secondary_instruments.length > 0
      );
    }

    // 按学号排序
    return myClassStudents.sort((a, b) => String(a.student_id).localeCompare(String(b.student_id)));
  };

  // 获取学生已排的课程
  const getStudentSchedules = (studentName: string) => {
    return scheduledClasses.filter(sc => sc.student_name === studentName);
  };

  // 获取选中学生的已排课程时间段（用于高亮课表）
  const getSelectedStudentsBusySlots = () => {
    const busySlots = new Set<string>();
    selectedStudents.forEach(studentId => {
      const student = myStudents.find(s => s.id === studentId);
      if (student) {
        const schedules = getStudentSchedules(student.name);
        schedules.forEach(sc => {
          busySlots.add(`${sc.day_of_week}-${sc.period}`);
        });
      }
    });
    return busySlots;
  };

  // 获取教师自己的已排课程时间段
  const getTeacherBusySlots = () => {
    const busySlots = new Set<string>();
    scheduledClasses.forEach(sc => {
      // 教师的课程就是已排的课程
      busySlots.add(`${sc.day_of_week}-${sc.period}`);
    });
    return busySlots;
  };

  // 检查周次范围冲突
  // 获取禁排时段描述
  const getBlockedSlotDescription = (slot: any): string => {
    if (slot.type === 'recurring') {
      const dayLabels = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      const dayLabel = dayLabels[slot.day_of_week] || '未知';
      const periods = `${slot.start_period}-${slot.end_period}节`;
      return `${dayLabel} ${periods}`;
    } else {
      if (slot.start_date && slot.end_date) {
        return `${slot.start_date} 至 ${slot.end_date}`;
      }
      if (slot.week_number) {
        return `第${slot.week_number}周`;
      }
      return '特定日期';
    }
  };

  // 检查周次范围冲突
  const checkWeekRangeConflict = async (
    dayOfWeek: number, 
    period: number,
    studentIds: string[],
    startWeek: number,
    endWeek: number
  ): Promise<{ hasConflict: boolean; conflicts: string[] }> => {
    try {
      const conflicts: string[] = [];
      
      // 获取所有课程安排
      const allSchedules = await scheduleService.getAll();
      
      // 检查每个学生的周次范围冲突
      for (const studentId of studentIds) {
        const student = students.find(s => s.id === studentId);
        if (!student) continue;

        // 查找该学生在同时段的其他课程
        const studentScheduleConflicts = allSchedules.filter(sc =>
          sc.student_id === studentId &&
          sc.day_of_week === dayOfWeek &&
          sc.period === period &&
          sc.start_week && sc.end_week
        );

        for (const conflictSchedule of studentScheduleConflicts) {
          // 检查周次范围是否重叠
          const existingStartWeek = conflictSchedule.start_week!;
          const existingEndWeek = conflictSchedule.end_week!;
          
          // 如果新课程的周次范围与已有课程重叠，则冲突
          if (!(endWeek < existingStartWeek || startWeek > existingEndWeek)) {
            const course = courses.find(c => c.id === conflictSchedule.course_id);
            const courseName = course?.course_name || conflictSchedule.course_name || '课程';
            conflicts.push(`学生 ${student.name} 在周${['一','二','三','四','五','六','日'][dayOfWeek-1]}第${period}节已有 ${courseName}（第${existingStartWeek}-${existingEndWeek}周）`);
          }
        }
      }

      return {
        hasConflict: conflicts.length > 0,
        conflicts
      };
    } catch (error) {
      console.error('检查周次范围冲突失败:', error);
      return { hasConflict: false, conflicts: [] };
    }
  };

  // 检查禁排时段冲突
  const checkBlockedSlotConflict = async (
    dayOfWeek: number, 
    period: number,
    studentIds: string[]
  ): Promise<{ hasConflict: boolean; conflicts: string[] }> => {
    try {
      const conflicts: string[] = [];
      
      // 获取禁排时段数据
      const blockedSlots = await blockedSlotService.getBySemester(selectedSemesterLabel);
      
      if (blockedSlots.length === 0) {
        return { hasConflict: false, conflicts: [] };
      }

      // 检查禁排时段是否影响当前学生或为全局禁排
      for (const blockedSlot of blockedSlots) {
        let affectsCurrentStudents = false;

        // 检查是否为全局禁排
        if (!blockedSlot.class_associations || blockedSlot.class_associations.length === 0) {
          affectsCurrentStudents = true;
        } else {
          // 检查禁排时段是否关联当前学生所在的班级
          for (const studentId of studentIds) {
            const student = students.find(s => s.id === studentId);
            if (student && student.major_class) {
              const hasClassAssociation = blockedSlot.class_associations?.some(assoc => 
                student.major_class?.includes(assoc.id)
              );
              if (hasClassAssociation) {
                affectsCurrentStudents = true;
                break;
              }
            }
          }
        }

        if (!affectsCurrentStudents) continue;

        // 检查时间是否匹配
        let timeMatches = false;
        
        if (blockedSlot.type === 'recurring') {
          // 每周循环类型
          if (blockedSlot.day_of_week === dayOfWeek && 
              blockedSlot.start_period && blockedSlot.end_period &&
              period >= blockedSlot.start_period && period <= blockedSlot.end_period) {
            timeMatches = true;
          }
        } else if (blockedSlot.type === 'specific') {
          // 特定周次类型 - 这里需要根据当前周次判断，暂时简化处理
          // TODO: 实现根据日期计算当前周次的逻辑
          if (blockedSlot.start_date && blockedSlot.end_date) {
            const today = new Date();
            const startDate = new Date(blockedSlot.start_date);
            const endDate = new Date(blockedSlot.end_date);
            if (today >= startDate && today <= endDate) {
              timeMatches = true;
            }
          }
        }

        if (timeMatches) {
          conflicts.push(`禁排时段：${blockedSlot.reason || '禁排时间'} - ${getBlockedSlotDescription(blockedSlot)}`);
        }
      }

      return {
        hasConflict: conflicts.length > 0,
        conflicts
      };
    } catch (error) {
      console.error('检查禁排时段冲突失败:', error);
      return { hasConflict: false, conflicts: [] };
    }
  };

  // 检查大课表冲突
  const checkLargeClassConflict = async (
    dayOfWeek: number, 
    period: number, 
    studentIds: string[],
    teacherName: string
  ): Promise<{ hasConflict: boolean; conflicts: string[] }> => {
    try {
      const conflicts: string[] = [];
      
      // 获取大课表数据
      const largeClassEntries = await largeClassScheduleService.getEntries(selectedSemesterLabel);
      
      if (largeClassEntries.length === 0) {
        return { hasConflict: false, conflicts: [] };
      }

      // 检查教师是否在大课表中有课程
      const teacherConflict = largeClassEntries.find(entry =>
        entry.teacher_name === teacherName &&
        entry.day_of_week === dayOfWeek &&
        entry.period_start <= period && period <= entry.period_end
      );

      if (teacherConflict) {
        conflicts.push(`教师 ${teacherName} 在大课表中已有课程：${teacherConflict.course_name}（${teacherConflict.class_name}）`);
      }

      // 检查学生是否在大课表中有课程
      for (const studentId of studentIds) {
        const student = students.find(s => s.id === studentId);
        if (!student) continue;

        // 根据学生班级查找大课表中的课程
        const studentClassConflict = largeClassEntries.find(entry =>
          student.major_class && 
          entry.class_name.includes(student.major_class.slice(0, 4)) && // 匹配年级
          entry.day_of_week === dayOfWeek &&
          entry.period_start <= period && period <= entry.period_end
        );

        if (studentClassConflict) {
          conflicts.push(`学生 ${student.name} 所在班级在大课表中已有课程：${studentClassConflict.course_name}`);
        }
      }

      return {
        hasConflict: conflicts.length > 0,
        conflicts
      };
    } catch (error) {
      console.error('检查大课表冲突失败:', error);
      // 如果检查失败，不阻止排课，但记录日志
      return { hasConflict: false, conflicts: [] };
    }
  };

  // 检测周次冲突
  const detectWeekConflicts = async (course: any) => {
    try {
      const conflicts = new Set<number>();
      const allSchedules = await scheduleService.getAll();
      const effectiveTeacherId = targetTeacher?.id || teacher?.id;
      const blockedSlots = await blockedSlotService.getBySemester(selectedSemesterLabel);
      
      // 检测每个周次是否有冲突
      for (let week = 1; week <= selectedWeekRange.endWeek; week++) {
        // 检查教师是否在该周有其他课程
        const teacherConflict = allSchedules.find(sc => 
          sc.teacher_id === effectiveTeacherId &&
          sc.start_week <= week && sc.end_week >= week
        );
        
        // 检查所选班级是否在该周有其他课程
        const classConflict = selectedClassesForMajor.some(classId => 
          allSchedules.some(sc => 
            sc.class_id === classId &&
            sc.start_week <= week && sc.end_week >= week
          )
        );
        
        // 检查该周是否为禁排周次
        const weekBlocked = blockedSlots.some(slot => {
          if (slot.type === 'specific') {
            // 检查特定周次禁排
            if (slot.week_number === week) {
              return true;
            }
            // 检查特定周次的星期几禁排
            if (slot.specific_week_days && slot.specific_week_days.some(wd => wd.week === week)) {
              return true;
            }
            // 检查日期范围禁排
            if (slot.start_date && slot.end_date) {
              // 这里简化处理，实际应该根据日期计算周次
              return true;
            }
          }
          return false;
        });
        
        if (teacherConflict || classConflict || weekBlocked) {
          conflicts.add(week);
        }
      }
      
      setWeekConflicts(conflicts);
    } catch (error) {
      console.error('检测周次冲突失败:', error);
      setWeekConflicts(new Set());
    }
  };

  // 检测星期和节次冲突
  const detectDayAndPeriodConflicts = async (week: number) => {
    try {
      const dayConflicts = new Set<number>();
      const periodConflicts = new Set<number>();
      const allSchedules = await scheduleService.getAll();
      const effectiveTeacherId = targetTeacher?.id || teacher?.id;
      const blockedSlots = await blockedSlotService.getBySemester(selectedSemesterLabel);
      
      // 检测每个星期是否有冲突
      for (let day = 1; day <= 7; day++) {
        // 检查教师是否在该星期有其他课程
        const teacherConflict = allSchedules.find(sc => 
          sc.teacher_id === effectiveTeacherId &&
          sc.day_of_week === day &&
          sc.start_week <= week && sc.end_week >= week
        );
        
        // 检查所选班级是否在该星期有其他课程
        const classConflict = selectedClassesForMajor.some(classId => 
          allSchedules.some(sc => 
            sc.class_id === classId &&
            sc.day_of_week === day &&
            sc.start_week <= week && sc.end_week >= week
          )
        );
        
        // 检查该星期是否为禁排时段
        const dayBlocked = blockedSlots.some(slot => {
          // 检查每周循环禁排
          if (slot.type === 'recurring' && slot.day_of_week === day) {
            return true;
          }
          // 检查特定周次的特定星期禁排
          if (slot.type === 'specific' && slot.specific_week_days) {
            return slot.specific_week_days.some(wd => wd.week === week && wd.day === day);
          }
          return false;
        });
        
        if (teacherConflict || classConflict || dayBlocked) {
          dayConflicts.add(day);
        }
      }
      
      setDayConflicts(dayConflicts);
      setPeriodConflicts(new Set());
    } catch (error) {
      console.error('检测星期冲突失败:', error);
      setDayConflicts(new Set());
      setPeriodConflicts(new Set());
    }
  };

  // 检测节次冲突
  const detectPeriodConflicts = async (week: number, day: number) => {
    try {
      const conflicts = new Set<number>();
      const allSchedules = await scheduleService.getAll();
      const effectiveTeacherId = targetTeacher?.id || teacher?.id;
      const blockedSlots = await blockedSlotService.getBySemester(selectedSemesterLabel);
      
      // 检查教室冲突
      if (selectedRoomForMajor) {
        const roomConflicts = allSchedules.filter(sc => 
          sc.room_id === selectedRoomForMajor &&
          sc.day_of_week === day &&
          sc.start_week <= week && sc.end_week >= week
        );
        
        roomConflicts.forEach(sc => {
          conflicts.add(sc.period);
        });
      }
      
      // 检查教师冲突
      const teacherConflicts = allSchedules.filter(sc => 
        sc.teacher_id === effectiveTeacherId &&
        sc.day_of_week === day &&
        sc.start_week <= week && sc.end_week >= week
      );
      
      teacherConflicts.forEach(sc => {
        conflicts.add(sc.period);
      });
      
      // 检查班级冲突
      selectedClassesForMajor.forEach(classId => {
        const classConflicts = allSchedules.filter(sc => 
          sc.class_id === classId &&
          sc.day_of_week === day &&
          sc.start_week <= week && sc.end_week >= week
        );
        
        classConflicts.forEach(sc => {
          conflicts.add(sc.period);
        });
      });
      
      // 检查禁排节次
      blockedSlots.forEach(slot => {
        // 检查每周循环禁排
        if (slot.type === 'recurring' && slot.day_of_week === day) {
          if (slot.start_period && slot.end_period) {
            for (let period = slot.start_period; period <= slot.end_period; period++) {
              conflicts.add(period);
            }
          }
        }
        // 检查特定周次的特定星期禁排
        if (slot.type === 'specific' && slot.specific_week_days) {
          const isSpecificWeekDay = slot.specific_week_days.some(wd => wd.week === week && wd.day === day);
          if (isSpecificWeekDay && slot.start_period && slot.end_period) {
            for (let period = slot.start_period; period <= slot.end_period; period++) {
              conflicts.add(period);
            }
          }
        }
      });
      
      setPeriodConflicts(conflicts);
    } catch (error) {
      console.error('检测节次冲突失败:', error);
      setPeriodConflicts(new Set());
    }
  };



  // 切换学生选中状态
  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });
  };

  // 全选/取消全选当前类型学生
  const toggleSelectAllOfType = (courseType: '钢琴' | '声乐' | '器乐') => {
    const classStudents = getClassStudents();
    const studentsOfType = classStudents.filter(s => {
      if (courseType === '钢琴') return s.primary_instrument === '钢琴';
      if (courseType === '声乐') return s.primary_instrument === '声乐';
      return s.primary_instrument && !['钢琴', '声乐'].includes(s.primary_instrument);
    });

    setSelectedStudents(prev => {
      const newSet = new Set(prev);
      const allSelected = studentsOfType.every(s => newSet.has(s.id));

      if (allSelected) {
        studentsOfType.forEach(s => newSet.delete(s.id));
      } else {
        studentsOfType.forEach(s => newSet.add(s.id));
      }

      return newSet;
    });
  };

  // 清除选择
  const clearSelection = () => {
    setSelectedStudents(new Set());
    setStudentGroups([]);
  };



  // 创建分组
  const createGroupFromSelection = () => {
    if (studentGroups.length === 0) {
      showToast('error', '请先选择学生');
      return;
    }

    const invalidGroup = studentGroups.find(g => !g.isValid);
    if (invalidGroup) {
      showToast('error', invalidGroup.message);
      return;
    }

    showToast('success', `已创建${studentGroups.length}个分组，拖拽到课表安排时间`);
  };

  // 根据课程名称获取学期序号
  const getSemesterFromCourse = (courseName: string): number => {
    const match = courseName.match(/[（(](\d+)[）)]/);
    return match ? parseInt(match[1]) : 1;
  };

  // 缓存所有排课记录和课程信息
  const [allSchedulesCache, setAllSchedulesCache] = useState<any[]>([]);
  const [allCoursesCache, setAllCoursesCache] = useState<any[]>([]);
  const [cacheTimestamp, setCacheTimestamp] = useState(Date.now());

  // 定期刷新缓存
  useEffect(() => {
    const refreshCache = async () => {
      try {
        const [schedules, courses] = await Promise.all([
          scheduleService.getAll(),
          courseService.getAll()
        ]);
        setAllSchedulesCache(schedules);
        setAllCoursesCache(courses);
        setCacheTimestamp(Date.now());
      } catch (error) {
        console.error('刷新缓存失败:', error);
      }
    };

    // 初始加载
    refreshCache();

    // 每30秒刷新一次缓存
    const interval = setInterval(refreshCache, 30000);
    return () => clearInterval(interval);
  }, []);

  // 计算学生已完成课时（1课时=1节次）
  const calculateStudentCompletedHours = async (studentId: string, courseName: string): Promise<number> => {
    // 使用缓存数据，避免重复网络请求
    const allSchedules = allSchedulesCache.length > 0 ? allSchedulesCache : await scheduleService.getAll();
    const allCourses = allCoursesCache.length > 0 ? allCoursesCache : await courseService.getAll();

    // 优化：使用 Map 存储课程，提高查找效率
    const coursesMap = new Map(allCourses.map(course => [course.id, course]));

    // 过滤学生的排课记录
    const studentSchedules = allSchedules.filter(
      sc => sc.student_id === studentId
    );

    // 按唯一时间点计算已完成课时
    const uniqueTimeSlots = new Set();
    studentSchedules.forEach(sc => {
      // 使用 Map 快速查找课程
      const course = coursesMap.get(sc.course_id);
      if (course && course.course_name === courseName) {
        const timeKey = `${sc.day_of_week || sc.day}_${sc.period}_${sc.start_week || sc.week}`;
        uniqueTimeSlots.add(timeKey);
      }
    });

    return uniqueTimeSlots.size;
  };

  // 智能排课建议
  const getScheduleSuggestions = async () => {
    try {
      const allSchedules = await scheduleService.getAll();
      const blockedSlots = await blockedSlotService.getBySemester(selectedSemesterLabel);
      const effectiveTeacherId = targetTeacher?.id || teacher?.id;
      
      // 收集所有已占用的时间段
      const occupiedSlots = new Set<string>();
      
      // 教师已占用的时间段
      allSchedules.forEach(sc => {
        if (sc.teacher_id === effectiveTeacherId) {
          occupiedSlots.add(`${sc.day_of_week}-${sc.period}`);
        }
      });
      
      // 禁排时段
      blockedSlots.forEach(slot => {
        if (slot.type === 'recurring' && slot.day_of_week && slot.start_period && slot.end_period) {
          for (let period = slot.start_period; period <= slot.end_period; period++) {
            occupiedSlots.add(`${slot.day_of_week}-${period}`);
          }
        }
      });
      
      // 生成所有可能的时间段
      const allPossibleSlots = [];
      for (let day = 1; day <= 7; day++) {
        for (let period = 1; period <= 10; period++) {
          const slotKey = `${day}-${period}`;
          if (!occupiedSlots.has(slotKey)) {
            allPossibleSlots.push({ day, period });
          }
        }
      }
      
      // 按优先级排序（优先考虑工作日和正常上课时间）
      allPossibleSlots.sort((a, b) => {
        // 工作日优先
        const dayPriorityA = a.day >= 1 && a.day <= 5 ? 0 : 1;
        const dayPriorityB = b.day >= 1 && b.day <= 5 ? 0 : 1;
        if (dayPriorityA !== dayPriorityB) return dayPriorityA - dayPriorityB;
        
        // 正常上课时间优先（1-8节）
        const periodPriorityA = a.period >= 1 && a.period <= 8 ? 0 : 1;
        const periodPriorityB = b.period >= 1 && b.period <= 8 ? 0 : 1;
        if (periodPriorityA !== periodPriorityB) return periodPriorityA - periodPriorityB;
        
        // 按星期和节次排序
        if (a.day !== b.day) return a.day - b.day;
        return a.period - b.period;
      });
      
      return allPossibleSlots.slice(0, 5); // 返回前5个建议
    } catch (error) {
      console.error('获取排课建议失败:', error);
      return [];
    }
  };

  // 计算学生剩余课时
  const calculateRemainingHours = async (studentId: string, courseName: string): Promise<{ completed: number; remaining: number; percentage: number }> => {
    const semester = getSemesterFromCourse(courseName);
    const student = students.find(s => s.id === studentId);
    const studentType = student?.student_type || 'general';

    const required = getRequiredHours(courseName, semester, studentType);
    const completed = await calculateStudentCompletedHours(studentId, courseName);
    const remaining = Math.max(0, required - completed);
    const percentage = required > 0 ? (completed / required) * 100 : 100;

    return { completed: Math.round(completed), remaining: Math.round(remaining), percentage };
  };

  // 计算并更新所有学生的课程进度（使用 useMemo 缓存）
  const studentProgress = React.useMemo(() => {
    // 优化：使用 Map 存储课程和排课记录，提高查找效率（同时支持内部ID和课程编号查找）
    const coursesMap = new Map(allCoursesCache.map(course => [course.id, course]));
    // 添加课程编号到映射
    allCoursesCache.forEach(course => {
      if ((course as any).course_id) {
        coursesMap.set((course as any).course_id, course);
      }
    });

    // 批量计算所有学生的进度，按专业类型分组
    const progressMap: {[studentId: string]: {[courseType: string]: {completed: number; remaining: number; percentage: number}}} = {};
    
    // 合并 students 和 myStudents 中的学生，确保所有学生都被计算
    const allStudents = [...students, ...myStudents].filter((student, index, self) => 
      index === self.findIndex(s => s.id === student.id)
    );
    
    allStudents.forEach(student => {
      try {
        const studentId = student.id;
        progressMap[studentId] = {};
        
        // 获取学生的所有专业类型
        const studentSpecialties = new Set<string>();
        if (student.primary_instrument) studentSpecialties.add(student.primary_instrument);
        if (student.secondary_instrument1) studentSpecialties.add(student.secondary_instrument1);
        if (student.secondary_instrument2) studentSpecialties.add(student.secondary_instrument2);
        if (student.secondary_instrument3) studentSpecialties.add(student.secondary_instrument3);
        if (student.secondary_instruments) {
          student.secondary_instruments.forEach((inst: string) => studentSpecialties.add(inst));
        }
        // 也要考虑 __courseType 属性
        if ((student as any).__courseType) {
          studentSpecialties.add((student as any).__courseType);
        }
        
        // 为每个专业类型计算进度
        studentSpecialties.forEach(courseType => {
          // 计算已完成课时
          const uniqueTimeSlots = new Set();
          
          // 遍历所有排课记录，查找该学生的该专业类型的课程
          allSchedulesCache.forEach(sc => {
            if (sc.student_id === studentId) {
              const course = coursesMap.get(sc.course_id);
              if (course) {
                // 检查课程类型是否匹配学生的专业类型，或者课程名称是否包含学生的专业类型，或者学生的专业类型是否是课程类型的子类
                const isCourseTypeMatch = course.course_type === courseType;
                const isCourseNameMatch = course.course_name.includes(courseType);
                
                // 处理特殊情况：如果课程类型是"器乐"，学生的专业类型是具体乐器（如"葫芦丝"），也应该匹配
                // 注意：只有当学生的专业类型不是"声乐"或"钢琴"等其他大类时，才视为乐器子类
                const isNonMusicCourseType = courseType !== "声乐" && courseType !== "钢琴";
                const isInstrumentSubtypeMatch = course.course_type === "器乐" && courseType !== "器乐" && isNonMusicCourseType;
                
                // 处理反向情况：如果学生的专业类型是"器乐"，课程类型是具体乐器，也应该匹配
                const isReverseInstrumentMatch = courseType === "器乐" && course.course_type !== "器乐";
                
                if (isCourseTypeMatch || isCourseNameMatch || isInstrumentSubtypeMatch || isReverseInstrumentMatch) {
                  const timeKey = `${sc.day_of_week || sc.day}_${sc.period}_${sc.start_week || sc.week}`;
                  uniqueTimeSlots.add(timeKey);
                }
              }
            }
          });
          
          const completed = uniqueTimeSlots.size;
          
          // 计算总课时（默认16课时，不受selectedCourseName影响）
          const required = 16; // 固定16课时
          
          const remaining = Math.max(0, required - completed);
          const percentage = required > 0 ? (completed / required) * 100 : 100;
          
          progressMap[studentId][courseType] = {
            completed: Math.round(completed),
            remaining: Math.round(remaining),
            percentage
          };
        });
      } catch (error) {
        console.error(`计算学生 ${student.name} 进度失败:`, error);
        // 出错时设置默认值
        progressMap[student.id] = {};
      }
    });

    return progressMap;
  }, [students, myStudents, allSchedulesCache, allCoursesCache]);

  // 监听教师、学生数据和筛选条件变化，更新学生列表
  useEffect(() => {
    // 无论是否选择了课程名称，都更新学生列表
    setPrimaryStudents(getPrimaryStudents());
    setSecondaryStudents(getSecondaryStudents());
  }, [myStudents, targetTeacher, teacher, primaryFilters, secondaryFilters, groupCourses, scheduledClasses, scheduledStudentIds]);

  // 监听课程名称变化，不需要手动更新进度
  // useMemo 会自动根据依赖项变化重新计算

  // 分析当前小组学生的主要专业类型
  const analyzeGroupMajorType = () => {
    if (groupStudents.length === 0) {
      setGroupMajorType('器乐'); // 默认值
      return;
    }
    
    // 统计小组中各专业类型的学生数量
    const majorTypeCount: {[key: string]: number} = {
      '钢琴': 0,
      '声乐': 0,
      '器乐': 0
    };
    
    groupStudents.forEach(student => {
      const courseType = student.__courseType;
      if (courseType === '钢琴') {
        majorTypeCount['钢琴']++;
      } else if (courseType === '声乐') {
        majorTypeCount['声乐']++;
      } else {
        // 其他专业类型都归为器乐
        majorTypeCount['器乐']++;
      }
    });
    
    // 找出数量最多的专业类型
    let maxCount = 0;
    let dominantType: '钢琴' | '声乐' | '器乐' = '器乐';
    
    Object.entries(majorTypeCount).forEach(([type, count]) => {
      if (count > maxCount) {
        maxCount = count;
        dominantType = type as '钢琴' | '声乐' | '器乐';
      }
    });
    
    setGroupMajorType(dominantType);
  };
  
  // 监听小组学生和课程变化，更新小组进度和专业类型
  useEffect(() => {
    updateGroupProgress();
    analyzeGroupMajorType();
  }, [groupStudents, selectedCourseName, selectedCourseType, studentProgress]);
  
  // 监听小组主要专业类型或小组学生变化，重新加载小组课数据
  useEffect(() => {
    loadGroupCoursesData();
  }, [groupMajorType, groupStudents]);

  // 监听教室列表变化，自动选择第一个教室
  useEffect(() => {
    if (fixedRooms.length > 0 && !selectedRoom) {
      const firstRoom = fixedRooms[0];
      if (firstRoom.room?.id) {
        setSelectedRoom(firstRoom.room.id);
      }
    }
  }, [fixedRooms]);

  // 用于触发缓存更新的函数
  const updateStudentProgress = React.useCallback((courseName: string) => {
    // 由于我们使用了 useMemo，这里不需要实际计算，只需要确保依赖项更新
    // 当 selectedCourseName 变化时，useMemo 会自动重新计算
  }, []);

  // 获取年级选项
  const getGradeOptions = (): string[] => {
    const grades = new Set<string>();
    
    if (schedulingMode === 'major') {
      // 专业大课模式：显示所有班级的年级
      classes.forEach(cls => {
        const grade = extractGradeFromClassId(cls.class_id);
        if (grade !== '未知') {
          grades.add(grade);
        }
      });
    } else {
      // 小组课模式：显示教师名下学生的年级
      if (myStudents.length > 0) {
        myStudents.forEach(student => {
          if (student.major_class) {
            const grade = extractGradeFromClassId(student.major_class);
            grades.add(grade);
          }
        });
      } else {
        // 如果没有学生，显示所有班级的年级
        classes.forEach(cls => {
          const grade = extractGradeFromClassId(cls.class_id);
          if (grade !== '未知') {
            grades.add(grade);
          }
        });
      }
    }
    
    return Array.from(grades).sort();
  };

  // 根据班级类型和年级获取班级选项
  const getFilteredClasses = (): Class[] => {
    let filtered = classes;

    // 按年级筛选
    if (selectedGrade !== 'all') {
      const filteredByGrade = classes.filter(cls => {
        const classGrade = extractGradeFromClassId(cls.class_id);
        return classGrade === selectedGrade || classGrade === '未知';
      });
      
      // 如果筛选后没有数据，显示所有班级
      filtered = filteredByGrade.length > 0 ? filteredByGrade : classes;
    }

    return filtered.sort((a, b) => a.class_name.localeCompare(b.class_name));
  };

  // 获取班级类型选项
  const getClassTypeOptions = (): Array<{value: string; label: string}> => {
    const types = new Set<string>();
    
    if (schedulingMode === 'major') {
      // 专业大课模式：显示所有班级类型
      types.add('general');
      types.add('upgrade');
    } else {
      // 小组课模式：显示教师名下学生的班级类型
      if (myStudents.length > 0) {
        myStudents.forEach(student => {
          types.add(getStudentClassType(student));
        });
      } else {
        // 如果没有学生，显示所有班级类型
        types.add('general');
        types.add('upgrade');
      }
    }
    
    const options = [{ value: 'all', label: '全部' }];
    Array.from(types).sort().forEach(type => {
      options.push({ value: type, label: getClassTypeLabel(type) });
    });
    
    return options;
  };



  // 导出课表
  const handleExportSchedule = async () => {
    if (isAdmin) {
      // 管理员：提供选择导出单个教师或所有教师的小课表
      const choice = window.confirm('是否导出所有教师的小课表？\n\n点击"确定"导出所有教师的课表\n点击"取消"导出当前教师的课表');
      
      if (choice) {
        // 导出所有教师的课表（直接使用scheduleResults中的数据，不要重新计算）
        const exportData = scheduleResults.map((result, index) => ({
          '序号': index + 1,
          '课程名称': result.courseName,
          '教师姓名': result.teacherName,
          '学生姓名': result.studentName?.replace(/<br>/g, '、') || '-',
          '学号': result.studentIds?.replace(/<br>/g, '、') || '-',
          '学生班级': result.studentClasses?.replace(/<br>/g, '、') || '-',
          '小组人数': result.groupSize,
          '排课时间': result.scheduleTime?.replace(/<br>/g, '\n') || '-',
          '已排课时': result.scheduledHours
        }));
        
        const fileName = `所有教师小课表_${selectedAcademicYear}_${selectedSemesterLabel}`;
        exportUtils.exportToExcel(exportData, fileName, '小课表');
      } else {
        // 导出当前教师的课表（使用排课结果的字段和样式）
        // 注意：对于管理员，需要在这里按当前选中教师再次过滤
        const teacherIdSet = getCurrentTeacherIdSet();
        const filteredResults = teacherIdSet.size > 0
          ? scheduleResults.filter(result =>
              teacherIdSet.has(normalizeTeacherId(result.teacherId))
            )
          : scheduleResults;

        const exportData = filteredResults.map((result, index) => ({
          '序号': index + 1,
          '课程名称': result.courseName,
          '教师姓名': result.teacherName,
          '学生姓名': result.students?.map(student => student.name).join('、') || result.studentName,
          '学号': result.students?.map(student => student.student_id || '-').join('、') || '-',
          '学生班级': result.students?.map(student => student.className || '-').join('、') || result.studentClass,
          '小组人数': result.groupSize,
          '排课时间': result.scheduleTime.replace(/<br>/g, '\n'),
          '已排课时': result.scheduledHours
        }));

        const fileName = `${targetTeacher?.name || teacher?.name || '教师'}小课表_${selectedAcademicYear}_${selectedSemesterLabel}`;
        exportUtils.exportToExcel(exportData, fileName, '小课表');
      }
    } else {
      // 教师：只能导出自己的课表（使用排课结果的字段和样式）
      const exportData = scheduleResults.map((result, index) => ({
        '序号': index + 1,
        '课程名称': result.courseName,
        '教师姓名': result.teacherName,
        '学生姓名': result.students?.map(student => student.name).join('、') || result.studentName,
        '学号': result.students?.map(student => student.student_id || '-').join('、') || '-',
        '学生班级': result.students?.map(student => student.className || '-').join('、') || result.studentClass,
        '小组人数': result.groupSize,
        '排课时间': result.scheduleTime.replace(/<br>/g, '\n'),
        '已排课时': result.scheduledHours
      }));

      const fileName = `${teacher?.name || '教师'}小课表_${selectedAcademicYear}_${selectedSemesterLabel}`;
      exportUtils.exportToExcel(exportData, fileName, '小课表');
    }
  };

  // 导出开课信息（CX_JW_KKXX格式）
  const handleExportKKXX = async () => {
    try {
      console.log('开始导出开课信息...');
      console.log('scheduleResults 数量:', scheduleResults.length);
      
      // 学年学期格式：2025-2026-2
      const xnxq = `${selectedAcademicYear}-${selectedSemesterLabel.split('-')[2] || selectedSemesterLabel.split('-')[1] || '1'}`;
      console.log('学年学期:', xnxq);
      
      const kkxxData: any[] = [];
      // 按课程类型和学期分别计数
      const courseTypeIndex: Record<string, number> = {};
      
      // 直接使用scheduleResults中的数据
      scheduleResults.forEach((result) => {
        // 课程名称
        const courseName = result.courseName || '';
        
        // 课程类型
        const courseType = result.courseType || '器乐';
        
        // 从课程名称中提取数字（如"器乐2"中的"2"）
        const courseNumMatch = courseName.match(/\d+/);
        const courseNum = courseNumMatch ? courseNumMatch[0] : '1';
        
        // 课程类型代码
        let courseTypeCode = 'QY'; // 默认器乐
        if (courseType === '钢琴' || courseName.includes('钢琴')) {
          courseTypeCode = 'GQ';
        } else if (courseType === '声乐' || courseName.includes('声乐')) {
          courseTypeCode = 'SY';
        } else if (courseType === '器乐' || courseName.includes('器乐')) {
          courseTypeCode = 'QY';
        }
        
        // 课程名称代码：类型代码+数字（如QY2、GQ4）
        const courseNameCode = `${courseTypeCode}${courseNum}`;
        
        // 按课程编号分别计数（同一课程编号从001开始，不同课程编号独立计数）
        const courseNumber = result.courseId || '';
        const indexKey = courseNumber; // 使用课程编号作为分组键
        
        // 初始化计数器
        if (!courseTypeIndex[indexKey]) {
          courseTypeIndex[indexKey] = 1;
        }
        
        const groupNum = String(courseTypeIndex[indexKey]).padStart(3, '0');
        courseTypeIndex[indexKey]++;
        
        // 教学班级名称：课程名称-序号（如：器乐2-001、钢琴4-001）
        const jxbmc = `${courseName}-${groupNum}`;
        
        // JXBID格式：课程编号 + 课程名称代码 + 序号
        const jxbid = `${courseNumber}${courseNameCode}${groupNum}`;
        
        // 班级人数：直接使用排课结果中的小组人数
        const bjrs = result.groupSize || 0;
        
        // 教学班组成：直接使用排课结果中的学生姓名
        const jxbzc = result.students?.map((s: any) => s.name).join('、') || result.studentName || '';
        
        kkxxData.push({
          JXBID: jxbid,
          XNXQ: xnxq,
          JXBBH: jxbid,
          JXBMC: jxbmc,
          FJXBID: '',
          FJXBBH: '',
          BJRS: bjrs,
          KCMC: courseName,
          KCBH: courseNumber,
          XF: String(result.credits || 1), // 使用排课结果中的学分
          KCXZ: '专业必修课',
          KKYXMC: '影视传媒学院音乐系',
          KKYXBH: 'YSCMMUSIC',
          KKJYSMC: getFacultyDisplayName(courseType) || '',
          KKJYSBH: courseType === '钢琴' ? 'PIANO' : courseType === '声乐' ? 'VOCAL' : 'INSTRUMENT',
          SFSJHJ: '否',
          SKFS: '线下',
          KSXS: '考查',
          JXMS: '小组课',
          KSFS: '随堂考查',
          SFXK: '是',
          SFPK: '是',
          XB: '',
          RKJS: result.teacherName || '',
          JXBZC: jxbzc,
        });
      });

      console.log('导出数据条数:', kkxxData.length);
      const fileName = `开课信息_CX_JW_KKXX_${xnxq}`;
      standardExportUtils.exportKKXX(kkxxData, fileName);
      showToast('success', '开课信息导出成功');
    } catch (error) {
      console.error('导出开课信息失败:', error);
      showToast('error', `导出开课信息失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 导出排课信息（CX_JW_PKXX格式）
  const handleExportPKXX = async () => {
    // 学年学期格式：2025-2026-2
    const xnxq = `${selectedAcademicYear}-${selectedSemesterLabel.split('-')[2] || selectedSemesterLabel.split('-')[1] || '1'}`;
    const [xn, xq] = selectedAcademicYear.split('-');
    
    const pkxxData: any[] = [];
    // 按课程类型和学期分别计数
    const courseTypeIndex: Record<string, number> = {};
    
    // 直接使用scheduleResults中的数据
    scheduleResults.forEach((result) => {
      // 课程名称
      const courseName = result.courseName || '';
      
      // 课程类型
      const courseType = result.courseType || '器乐';
      
      // 从课程名称中提取数字（如"器乐2"中的"2"）
      const courseNumMatch = courseName.match(/\d+/);
      const courseNum = courseNumMatch ? courseNumMatch[0] : '1';
      
      // 课程类型代码
      let courseTypeCode = 'QY'; // 默认器乐
      if (courseType === '钢琴' || courseName.includes('钢琴')) {
        courseTypeCode = 'GQ';
      } else if (courseType === '声乐' || courseName.includes('声乐')) {
        courseTypeCode = 'SY';
      } else if (courseType === '器乐' || courseName.includes('器乐')) {
        courseTypeCode = 'QY';
      }
      
      // 课程名称代码：类型代码+数字（如QY2、GQ4）
      const courseNameCode = `${courseTypeCode}${courseNum}`;
      
      // 按课程编号分别计数（同一课程编号从001开始，不同课程编号独立计数）
      const courseNumber = result.courseId || '';
      const indexKey = courseNumber; // 使用课程编号作为分组键
      
      // 初始化计数器
      if (!courseTypeIndex[indexKey]) {
        courseTypeIndex[indexKey] = 1;
      }
      
      const groupNum = String(courseTypeIndex[indexKey]).padStart(3, '0');
      courseTypeIndex[indexKey]++;
      
      // 教学班级名称：课程名称-序号（如：器乐2-001、钢琴4-001）
      const jxbmc = `${courseName}-${groupNum}`;
      
      // JXBID格式：课程编号 + 课程名称代码 + 序号
      const jxbid = `${courseNumber}${courseNameCode}${groupNum}`;
      
      // 获取教师工号
      const teacherInfo = availableTeachers.find(t => t.name === result.teacherName);
      const teacherWorkId = teacherInfo?.teacher_id || '';

      // 从排课结果列表提取并汇总全部班级，兼容混合班级小组
      const classNames = Array.from(new Set(
        [
          ...(result.students || []).map((student: any) => student.className || ''),
          ...String(result.studentClasses || '').split('<br>'),
          result.studentClass || '',
        ].map((name: string) => String(name).trim()).filter(Boolean)
      ));
      const className = classNames.join(',');
      const classNumber = Array.from(new Set(
        classNames
          .map((name: string) => {
            const match = name.match(/\d+/);
            return match ? match[0] : '';
          })
          .filter(Boolean)
      )).join(',');
      
      // 从originalSchedules中提取排课时间信息，并按星期和节次分组合并周次
      const schedules = result.originalSchedules || [];
      if (schedules.length > 0) {
        // 按星期和节次分组，收集所有周次
        const timeGroupMap = new Map<string, { weeks: number[], day: number, period: number, room_id: string, room_name: string }>();
        
        schedules.forEach((schedule: any) => {
          const week = schedule.start_week || schedule.week;
          const day = schedule.day_of_week || schedule.day;
          const period = schedule.period;
          
          if (week && day && period) {
            const timeKey = `${day}_${period}`;
            if (!timeGroupMap.has(timeKey)) {
              timeGroupMap.set(timeKey, { weeks: [], day, period, room_id: schedule.room_id, room_name: schedule.room_name });
            }
            timeGroupMap.get(timeKey)!.weeks.push(week);
          }
        });
        
        // 为每个合并后的时间段生成一条记录
        timeGroupMap.forEach((timeGroup) => {
          // 去重并排序周次
          const uniqueWeeks = Array.from(new Set(timeGroup.weeks)).sort((a, b) => a - b);
          
          // 合并连续周次
          const mergedRanges: { start: number; end: number }[] = [];
          let start = uniqueWeeks[0];
          let end = uniqueWeeks[0];
          
          for (let j = 1; j < uniqueWeeks.length; j++) {
            if (uniqueWeeks[j] === end + 1) {
              end = uniqueWeeks[j];
            } else {
              mergedRanges.push({ start, end });
              start = uniqueWeeks[j];
              end = uniqueWeeks[j];
            }
          }
          mergedRanges.push({ start, end });
          
          // 生成周次字符串
          const rangeStrings = mergedRanges.map(range => {
            if (range.start === range.end) {
              return `${range.start}`;
            } else {
              return `${range.start}-${range.end}`;
            }
          });
          const skzc = rangeStrings.join(',');
          
          pkxxData.push({
            JXBID: jxbid,
            XNXQ: xnxq,
            JXBBH: jxbid,
            JXBMC: jxbmc,
            BJMC: className,
            BJBH: classNumber,
            KCBH: courseNumber,
            KCMC: courseName,
            RKJSID: parseInt(teacherWorkId?.replace(/\D/g, '') || '0') || 0,
            RKJSGH: teacherWorkId,
            RKJSXM: result.teacherName || '',
            FJID: '',
            FJMC: '',
            XN: '',
            XQ: '',
            ZC: '',
            SHOWZC: '',
            SKZC: skzc,
            SKXQ: String(timeGroup.day || ''),
            JCFW: String(timeGroup.period || ''),
            LXJC: '1',
            CRMC: timeGroup.room_name || result.room_name || '',
            CRBH: timeGroup.room_id || result.room_id || '',
          });
        });
      }
    });

    const fileName = `排课信息_CX_JW_PKXX_${xnxq}`;
    standardExportUtils.exportPKXX(pkxxData, fileName);
    showToast('success', '排课信息导出成功');
  };

  // 导出学生选课数据（CX_JW_XSXK格式）
  const handleExportXSXK = async () => {
    // 学年学期格式：2025-2026-2
    const xnxq = `${selectedAcademicYear}-${selectedSemesterLabel.split('-')[2] || selectedSemesterLabel.split('-')[1] || '1'}`;
    
    const xsxkData: any[] = [];
    // 按课程类型和学期分别计数
    const courseTypeIndex: Record<string, number> = {};
    
    // 直接使用scheduleResults中的数据
    scheduleResults.forEach((result) => {
      // 课程名称
      const courseName = result.courseName || '';
      
      // 课程类型
      const courseType = result.courseType || '器乐';
      
      // 从课程名称中提取数字（如"器乐2"中的"2"）
      const courseNumMatch = courseName.match(/\d+/);
      const courseNum = courseNumMatch ? courseNumMatch[0] : '1';
      
      // 课程类型代码
      let courseTypeCode = 'QY'; // 默认器乐
      if (courseType === '钢琴' || courseName.includes('钢琴')) {
        courseTypeCode = 'GQ';
      } else if (courseType === '声乐' || courseName.includes('声乐')) {
        courseTypeCode = 'SY';
      } else if (courseType === '器乐' || courseName.includes('器乐')) {
        courseTypeCode = 'QY';
      }
      
      // 课程名称代码：类型代码+数字（如QY2、GQ4）
      const courseNameCode = `${courseTypeCode}${courseNum}`;
      
      // 按课程编号分别计数（同一课程编号从001开始，不同课程编号独立计数）
      const courseNumber = result.courseId || '';
      const indexKey = courseNumber; // 使用课程编号作为分组键
      
      // 初始化计数器
      if (!courseTypeIndex[indexKey]) {
        courseTypeIndex[indexKey] = 1;
      }
      
      const groupNum = String(courseTypeIndex[indexKey]).padStart(3, '0');
      courseTypeIndex[indexKey]++;
      
      // 教学班级名称：课程名称-序号（如：器乐2-001、钢琴4-001）
      const jxbmc = `${courseName}-${groupNum}`;
      
      // JXBID格式：课程编号 + 课程名称代码 + 序号
      const jxbid = `${courseNumber}${courseNameCode}${groupNum}`;
      
      // 获取教师工号
      const teacherInfo = availableTeachers.find(t => t.name === result.teacherName);
      const teacherWorkId = teacherInfo?.teacher_id || '';
      
      // 为每个学生生成一条记录（直接使用排课结果中的学生列表）
      result.students?.forEach((student: any) => {
        xsxkData.push({
          XNXQ: xnxq,
          XH: student.student_id || '', // 学生学号
          XM: student.name || '',
          JXBID: jxbid,
          JXBBH: jxbid,
          JXBMC: jxbmc,
          KCBH: courseNumber, // 课程编号
          KCMC: courseName,
          RKJS: result.teacherName || '',
          JSGH: teacherWorkId, // 教师工号
          XDXZ: '必修',
          XDFS: '正常选课',
        });
      });
    });

    const fileName = `学生选课数据_CX_JW_XSXK_${xnxq}`;
    standardExportUtils.exportXSXK(xsxkData, fileName);
    showToast('success', '学生选课数据导出成功');
  };

  // 复制上学期课表
  const handleCopyLastSemester = async () => {
    if (!confirm('确定要复制上学期课表吗？\n注意：这将复制所有排课记录到当前学期。')) return;

    try {
      // 获取上学期数据
      const lastSemesterLabel = selectedSemesterLabel.endsWith('-1')
        ? `${parseInt(selectedAcademicYear) - 1}-2`
        : `${selectedAcademicYear}-1`;

      // 获取当前教师的所有排课
      const allScheduleData = await scheduleService.getAll();
      const lastSemesterSchedule = allScheduleData.filter(sc =>
        sc.teacher_id === teacher?.id &&
        sc.semester_label === lastSemesterLabel
      );

      if (lastSemesterSchedule.length === 0) {
        showToast('info', `上学期（${lastSemesterLabel}）没有排课记录`);
        return;
      }

      let copied = 0;
      for (const sc of lastSemesterSchedule) {
        // 获取课程信息来确定课程类型
        const course = findCourseById(courses, sc.course_id);
        const courseType = course?.course_type || '钢琴';
        const facultyCode = courseType === '钢琴' ? 'PIANO' :
                           courseType === '声乐' ? 'VOCAL' : 'INSTRUMENT';
        
        // 优先使用用户手动选择的教室
        let roomInfo = selectedRoom ? fixedRooms.find(r => r.room?.id === selectedRoom) : null;
        // 如果用户没有选择教室，根据课程类型自动选择
        if (!roomInfo) {
          roomInfo = fixedRooms.find(r => r.facultyCode === facultyCode);
        }

        await scheduleService.create({
          teacher_id: sc.teacher_id,
          teacher_name: sc.teacher_name || teacher?.name || '',
          course_id: sc.course_id,
          course_name: sc.course_name || course?.course_name,
          course_type: sc.course_type || course?.course_type,
          student_id: sc.student_id,
          room_id: roomInfo?.room?.id || sc.room_id,
          day_of_week: sc.day_of_week,
          period: sc.period,
          start_week: sc.start_week || selectedWeekRange.startWeek,
          end_week: sc.end_week || selectedWeekRange.endWeek,
          semester_label: selectedSemesterLabel,
          academic_year: selectedAcademicYear,
          semester: currentSemesterNumber,
          status: 'scheduled'
        });
        copied++;
      }

      showToast('success', `已复制 ${copied} 条排课记录`);
      // 刷新排课数据
      const scheduleData = await scheduleService.getByTeacher(teacher!.id);
      const displaySchedule: ScheduledClassDisplay[] = scheduleData.map(sc => ({
        id: sc.id,
        day_of_week: sc.day_of_week,
        period: sc.period,
        course_name: sc.course_name || sc.courses?.course_name || '课程',
        course_type: sc.course_type || sc.courses?.course_type || '器乐',
        teacher_id: sc.teacher_id,
        teacher_name: sc.teacher_name || sc.courses?.teacher_name || sc.courses?.teacher?.name || teacher!.name,
        student_name: sc.students?.name || '学生',
        room_name: sc.rooms?.room_name
      }));
      setScheduledClasses(displaySchedule);
    } catch (error) {
      console.error('复制失败:', error);
      showToast('error', '复制失败，请重试');
    }
  };

  // 自动排课
  const handleAutoSchedule = async () => {
    if (!selectedClass || !teacher) {
      showToast('error', '请先选择班级');
      return;
    }

    if (!selectedCourseName) {
      showToast('error', '请先选择课程名称');
      return;
    }

    if (!confirm('确定要自动排课吗？\n系统将根据可用时间自动为所有待排课学生安排课程。')) return;

    try {
      // 获取当前课程信息
      const course = courses.find(c =>
        c.course_name === selectedCourseName &&
        c.major_class === selectedClass.class_id
      );

      if (!course) {
        showToast('error', '课程不存在，请先选择有效的课程');
        return;
      }

      const courseType = selectedCourseType;
      const facultyCode = courseType === '钢琴' ? 'PIANO' :
                         courseType === '声乐' ? 'VOCAL' : 'INSTRUMENT';

      // 优先使用用户手动选择的教室
      let roomInfo = selectedRoom ? fixedRooms.find(r => r.room?.id === selectedRoom) : null;
      // 如果用户没有选择教室，根据课程类型自动选择
      if (!roomInfo) {
        roomInfo = fixedRooms.find(r => r.facultyCode === facultyCode);
      }
      const roomId = roomInfo?.room?.id || undefined;
      const roomName = roomInfo?.room?.room_name || '';

      // 获取班级中需要排课的学生（根据专业过滤）
      const studentsToSchedule = myStudents.filter(s => {
        const studentCategory = getStudentCourseType(s);
        return studentCategory === courseType;
      });

      if (studentsToSchedule.length === 0) {
        showToast('info', `该班级没有需要排${courseType}课的学生`);
        return;
      }

      // 检查每个学生的剩余课时
      const studentsWithProgress = await Promise.all(
        studentsToSchedule.map(async (student) => {
          const progress = await calculateRemainingHours(student.id, selectedCourseName);
          return { student, progress };
        })
      );

      // 只保留还有剩余课时的学生
      const needScheduleStudents = studentsWithProgress.filter(
        ({ progress }) => progress.remaining > 0
      );

      if (needScheduleStudents.length === 0) {
        showToast('info', `所有学生的${selectedCourseName}课时已排满`);
        return;
      }

      // 获取所有已排课程用于冲突检测
      const allScheduleData = await scheduleService.getAll();
      const teacherSchedule = allScheduleData.filter(sc =>
        sc.teacher_id === teacher.id &&
        sc.semester_label === selectedSemesterLabel
      );

      // 获取当前选中班级的所有学生（用于检测学生冲突）
      const classYear = selectedClass.class_id.slice(0, 2);
      const classStudents = students.filter(s =>
        s.major_class?.includes(classYear) ||
        myStudents.some(ms => ms.id === s.id)
      );

      // 计算最大分组人数
      const maxGroupSize = ['钢琴', '声乐'].includes(courseType) ? 5 : 8;

      // 尝试为每个学生找到可用时间段
      let scheduledCount = 0;
      const WEEKDAYS_VALUE = [1, 2, 3, 4, 5, 6, 7];

      for (const { student, progress } of needScheduleStudents) {
        // 计算还需要排几次课（1课时=1节次）
        const remainingLessons = Math.ceil(progress.remaining);

        for (let lesson = 0; lesson < remainingLessons; lesson++) {
          let scheduled = false;

          // 遍历所有时间段找可用位置
          for (const dayOfWeek of WEEKDAYS_VALUE) {
            if (scheduled) break;

            for (const period of PERIOD_CONFIG) {
              // 检查是否已被占用
              const slotKey = `${dayOfWeek}-${period.period}`;

              // 检查教师是否可用（跨教师冲突检测）
              const teacherConflict = allScheduleData.find(sc =>
                sc.teacher_id === teacher.id &&
                sc.day_of_week === dayOfWeek &&
                sc.period === period.period
              );
              if (teacherConflict) continue;

              // 检查琴房是否可用
              if (roomId) {
                const roomConflict = allScheduleData.find(sc =>
                  sc.room_id === roomId &&
                  sc.day_of_week === dayOfWeek &&
                  sc.period === period.period &&
                  sc.teacher_id !== teacher.id
                );
                if (roomConflict) continue;
              }

              // 检查学生是否可用（跨教师学生冲突检测）
              const studentConflict = allScheduleData.find(sc =>
                sc.student_id === student.id &&
                sc.day_of_week === dayOfWeek &&
                sc.period === period.period &&
                sc.teacher_id !== teacher.id
              );
              if (studentConflict) continue;

              // 检查禁排时段冲突
              const blockedSlotConflict = await checkBlockedSlotConflict(
                dayOfWeek, 
                period.period, 
                [student.id]
              );

              if (blockedSlotConflict.hasConflict) continue;

              // 检查周次范围冲突
              const weekRangeConflict = await checkWeekRangeConflict(
                dayOfWeek, 
                period.period, 
                [student.id],
                selectedWeekRange.startWeek,
                selectedWeekRange.endWeek
              );

              if (weekRangeConflict.hasConflict) continue;

              // 检查大课表冲突
              const largeClassConflict = await checkLargeClassConflict(
                dayOfWeek, 
                period.period, 
                [student.id], 
                teacher.name
              );

              if (largeClassConflict.hasConflict) continue;

              // 找到可用时段，安排课程
              await scheduleService.create({
                teacher_id: teacher.id,
                teacher_name: teacher.name,
                course_id: course.id,
                course_name: course.course_name,
                course_type: course.course_type,
                student_id: student.id,
                room_id: roomId,
                day_of_week: dayOfWeek,
                period: period.period,
                start_week: selectedWeekRange.startWeek,
                end_week: selectedWeekRange.endWeek,
                semester_label: selectedSemesterLabel,
                academic_year: selectedAcademicYear,
                semester: currentSemesterNumber,
                status: 'scheduled'
              });

              // 更新本地状态
              const newSchedule: ScheduledClassDisplay = {
                id: uuidv4(),
                day_of_week: dayOfWeek,
                period: period.period,
                course_name: selectedCourseName,
                course_type: courseType,
                student_name: student.name,
                room_name: roomName
              };
              setScheduledClasses(prev => [...prev, newSchedule]);

              // 更新教师课表记录
              teacherSchedule.push({
                id: uuidv4(),
                teacher_id: teacher.id,
                course_id: course.id,
                student_id: student.id,
                room_id: roomInfo.room!.id,
                day_of_week: dayOfWeek,
                period: period.period,
                semester_label: selectedSemesterLabel,
                academic_year: selectedAcademicYear,
                semester: currentSemesterNumber,
                status: 'scheduled'
              } as any);

              scheduledCount++;
              scheduled = true;
              break;
            }
          }
        }
      }

      if (scheduledCount > 0) {
        showToast('success', `自动排课完成，已安排 ${scheduledCount} 节课`);
      } else {
        showToast('info', '没有找到可用的排课时间段');
      }
    } catch (error) {
      console.error('自动排课失败:', error);
      showToast('error', '自动排课失败，请重试');
    }
  };

  // 显示提示
  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 获取学生的课程类型
  const getStudentCourseType = (student: Student): '钢琴' | '声乐' | '器乐' => {
    if (student.primary_instrument === '钢琴') return '钢琴';
    if (student.primary_instrument === '声乐') return '声乐';
    return '器乐';
  };

  // 计算已排课的学生ID
  useEffect(() => {
    const scheduledIds = new Set<string>();
    scheduledClasses.forEach(schedule => {
      if (schedule.student_id) {
        scheduledIds.add(schedule.student_id);
      } else if (schedule.student_name) {
        // 通过学生姓名查找ID
        const student = students.find(s => s.name === schedule.student_name);
        if (student) {
          scheduledIds.add(student.id);
        }
      }
    });
    setScheduledStudentIds(scheduledIds);
  }, [scheduledClasses, students]);

  // 获取主项学生（使用 useMemo 缓存）
  const getPrimaryStudents = React.useCallback((): any[] => {
    const effectiveTeacherId = targetTeacher?.id || teacher?.id;
    const effectiveTeacherName = targetTeacher?.name || teacher?.name;
    if (!effectiveTeacherId) return [];
    
    // 状态优先级：未排 > 未排满 > 已排满
    const getStatusPriority = (student: any): number => {
      const courseType = student.__courseType;
      const progress = studentProgress[student.id]?.[courseType];
      if (!progress) return 0; // 视为未排
      if (progress.remaining === 0) return 2; // 已排满
      if (progress.completed === 0) return 0; // 未排
      return 1; // 未排满
    };

    const filtered = myStudents.filter(student => {
      // 只显示普通班学生，专升本学生没有主项
      if (getStudentClassType(student) !== 'general') return false;
      
      // 只显示主项课程的学生实例
      if (student.__source !== 'primary') return false;
      
      // 主项教师匹配：学生的主项教师是当前教师
      const teacherMatch = student.assigned_teachers?.primary_teacher_id === effectiveTeacherId ||
                          student.teacher_id === effectiveTeacherId ||
                          student.teacher_name === effectiveTeacherName;
      
      // 年级筛选
      let gradeMatch = true;
      if (primaryFilters.grade && student.major_class) {
        const studentGrade = extractGradeFromClassId(student.major_class);
        gradeMatch = studentGrade === primaryFilters.grade;
      }
      
      // 班级筛选
      const classMatch = !primaryFilters.className || student.major_class === primaryFilters.className;
      
      // 不过滤排课完成的学生，因为同一学生可能需要在不同课程中排课
      
      return teacherMatch && gradeMatch && classMatch;
    });

    // 排序：先按状态优先级，再按剩余课时从多到少，最后按姓名
    return filtered.slice().sort((a, b) => {
      const pa = studentProgress[a.id]?.[a.__courseType];
      const pb = studentProgress[b.id]?.[b.__courseType];
      const sa = getStatusPriority(a);
      const sb = getStatusPriority(b);
      if (sa !== sb) return sa - sb;
      const ra = pa?.remaining ?? Number.POSITIVE_INFINITY;
      const rb = pb?.remaining ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return rb - ra; // 剩余多的在前
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [myStudents, targetTeacher, teacher, primaryFilters, studentProgress]);

  // 获取副项学生（使用 useMemo 缓存）
  const getSecondaryStudents = React.useCallback((): any[] => {
    const effectiveTeacherId = targetTeacher?.id || teacher?.id;
    if (!effectiveTeacherId) return [];
    
    // 状态优先级：未排 > 未排满 > 已排满
    const getStatusPriority = (student: any): number => {
      const courseType = student.__courseType;
      const progress = studentProgress[student.id]?.[courseType];
      if (!progress) return 0; // 视为未排
      if (progress.remaining === 0) return 2; // 已排满
      if (progress.completed === 0) return 0; // 未排
      return 1; // 未排满
    };

    const filtered = myStudents.filter(student => {
      // 只显示副项课程的学生实例
      if (student.__source !== 'secondary') return false;
      
      // 副项教师匹配：学生的副项教师是当前教师
      const teacherMatch = student.assigned_teachers?.secondary1_teacher_id === effectiveTeacherId ||
                          student.assigned_teachers?.secondary2_teacher_id === effectiveTeacherId ||
                          student.assigned_teachers?.secondary3_teacher_id === effectiveTeacherId;
      
      // 年级筛选
      let gradeMatch = true;
      if (secondaryFilters.grade && student.major_class) {
        const studentGrade = extractGradeFromClassId(student.major_class);
        gradeMatch = studentGrade === secondaryFilters.grade;
      }
      
      // 班级筛选
      const classMatch = !secondaryFilters.className || student.major_class === secondaryFilters.className;
      
      // 不过滤排课完成的学生，因为同一学生可能需要在不同课程中排课
      
      return teacherMatch && gradeMatch && classMatch;
    });

    return filtered.slice().sort((a, b) => {
      const pa = studentProgress[a.id]?.[a.__courseType];
      const pb = studentProgress[b.id]?.[b.__courseType];
      const sa = getStatusPriority(a);
      const sb = getStatusPriority(b);
      if (sa !== sb) return sa - sb;
      const ra = pa?.remaining ?? Number.POSITIVE_INFINITY;
      const rb = pb?.remaining ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return rb - ra;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [myStudents, targetTeacher, teacher, secondaryFilters, studentProgress]);

  // 检查学生在特定时间是否有排课冲突
  const checkStudentConflict = async (studentId: string, day: number, period: number, week: number): Promise<boolean> => {
    try {
      const allSchedules = await scheduleService.getAll();
      const studentConflict = allSchedules.find(sc =>
        sc.student_id === studentId &&
        sc.day_of_week === day &&
        sc.period === period &&
        sc.start_week === week &&
        sc.end_week === week
      );
      return !!studentConflict;
    } catch (error) {
      console.error('检查学生冲突失败:', error);
      return false;
    }
  };

  // 将学生添加到小组
  const addToGroup = async (student: any, source: 'primary' | 'secondary' = 'primary') => {
    // 检查学生是否已在小组中（只基于ID，同一个人不能选到同一个分组）
    if (groupStudents.find(s => s.id === student.id)) {
      showToast('error', '同一个人不能选到同一个分组');
      return;
    }

    // 显示进度条
    const progressContainer = document.createElement('div');
    progressContainer.className = 'fixed top-0 left-0 w-full h-8 bg-gray-100 z-50 shadow-lg flex items-center';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'h-full bg-gradient-to-r from-purple-500 to-purple-600 transition-all duration-300 flex items-center justify-end pr-2';
    progressBar.style.width = '0%';
    
    const progressText = document.createElement('span');
    progressText.className = 'text-white text-sm font-bold';
    progressText.textContent = '0%';
    
    progressBar.appendChild(progressText);
    progressContainer.appendChild(progressBar);
    document.body.appendChild(progressContainer);
    
    // 更新进度条的函数
    const updateProgress = (percentage: number) => {
      progressBar.style.width = `${percentage}%`;
      progressText.textContent = `${percentage}%`;
    };
    
    // 模拟进度更新
    updateProgress(10);

    // 检查人数限制（使用统一常量 LARGE_GROUP_INSTRUMENTS）
    const checkGroupSizeLimit = () => {
      let isLargeGroupCourse = false;
      let courseTypeName = selectedCourseType;
      let isAllSecondary = true;
      let isGeneralClass = true;
      
      for (const existingStudent of groupStudents) {
        if (studentSources.get(existingStudent.id) === 'primary') {
          isAllSecondary = false;
        }
        if (getStudentClassType(existingStudent) !== 'general') {
          isGeneralClass = false;
        }
      }
      
      if (source === 'primary') {
        isAllSecondary = false;
      }
      if (getStudentClassType(student) !== 'general') {
        isGeneralClass = false;
      }
      
      if (LARGE_GROUP_INSTRUMENTS.includes(selectedCourseType)) {
        isLargeGroupCourse = true;
      } else {
        if (student.secondary_instruments) {
          for (const instrument of student.secondary_instruments) {
            if (LARGE_GROUP_INSTRUMENTS.includes(instrument)) {
              isLargeGroupCourse = true;
              courseTypeName = instrument;
              break;
            }
          }
        }
        
        if (!isLargeGroupCourse) {
          for (const existingStudent of groupStudents) {
            if (existingStudent.secondary_instruments) {
              for (const instrument of existingStudent.secondary_instruments) {
                if (LARGE_GROUP_INSTRUMENTS.includes(instrument)) {
                  isLargeGroupCourse = true;
                  courseTypeName = instrument;
                  break;
                }
              }
              if (isLargeGroupCourse) break;
            }
          }
        }
      }
      
      if (isLargeGroupCourse && isAllSecondary && isGeneralClass) {
        // 古筝、葫芦丝、竹笛（普通班级全部为副项）：最多8人
        if (groupStudents.length >= 8) {
          showToast('info', `为了更好地保证教学质量和学习效果，${courseTypeName}课（普通班级全部为副项）建议每个小组不超过8人。当前小组已有${groupStudents.length}人，请合理安排小组人数。`);
          return false;
        }
      } else {
        // 其它专业或包含主项：最多4人
        if (groupStudents.length >= 4) {
          showToast('info', `为了更好地保证教学质量和学习效果，建议每个小组不超过4人。当前小组已有${groupStudents.length}人，请合理安排小组人数。`);
          return false;
        }
      }
      
      return true;
    };

    // 检查人数限制
    if (!checkGroupSizeLimit()) {
      return;
    }

    // 检查年级混合
    const checkGradeMix = () => {
      if (groupStudents.length === 0) {
        return true;
      }
      
      // 获取新学生的年级
      if (!student.major_class) {
        return true;
      }
      const newStudentGradeMatch = student.major_class.match(/\d{2}/);
      if (!newStudentGradeMatch) {
        return true;
      }
      const newStudentGrade = newStudentGradeMatch[0];
      
      // 检查小组中是否有不同年级的学生
      for (const existingStudent of groupStudents) {
        if (existingStudent.major_class) {
          const existingGradeMatch = existingStudent.major_class.match(/\d{2}/);
          if (existingGradeMatch) {
            const existingGrade = existingGradeMatch[0];
            if (existingGrade !== newStudentGrade) {
              showToast('error', '不同年级不能混合编组');
              return false;
            }
          }
        }
      }
      
      return true;
    };

    // 检查年级混合
    if (!checkGradeMix()) {
      // 移除进度条
      try { document.body.removeChild(progressContainer); } catch (e) {}
      return;
    }
    
    updateProgress(30);

    // 检查班级类型混合
    const checkClassTypeMix = () => {
      if (groupStudents.length === 0) {
        return true;
      }
      
      const newStudentClassType = getStudentClassType(student);
      
      for (const existingStudent of groupStudents) {
        const existingClassType = getStudentClassType(existingStudent);
        if (existingClassType !== newStudentClassType) {
          showToast('error', '普通班和专升本不能混合编组');
          return false;
        }
      }
      
      return true;
    };

    // 检查班级类型混合
    if (!checkClassTypeMix()) {
      // 移除进度条
      try { document.body.removeChild(progressContainer); } catch (e) {}
      return;
    }
    
    updateProgress(50);

    // 检查专业混合（不同专业不能混合编组；葫芦丝与竹笛允许混排）
    const checkMajorMix = () => {
      if (groupStudents.length === 0) {
        return true;
      }
      
      // 获取新学生的专业类型
      const newStudentMajor = student.__courseType;
      if (!newStudentMajor) {
        return true;
      }
      
      // 检查小组中是否有不同专业的学生（葫芦丝与竹笛视为可混排）
      for (const existingStudent of groupStudents) {
        const existingMajor = existingStudent.__courseType;
        if (existingMajor && !canMixMajors(existingMajor, newStudentMajor)) {
          showToast('error', '不同专业不能混合编组');
          return false;
        }
      }
      
      return true;
    };

    // 检查专业混合
    if (!checkMajorMix()) {
      // 移除进度条
      try { document.body.removeChild(progressContainer); } catch (e) {}
      return;
    }

    updateProgress(70);

    // 添加学生到小组
    const newGroupStudents = [...groupStudents, student];
    setGroupStudents(newGroupStudents);
    
    updateProgress(80);
    
    // 存储学生来源信息
    const newStudentSources = new Map(studentSources);
    newStudentSources.set(student.id, source);
    setStudentSources(newStudentSources);
    
    // 重要：学生选择变化后，自动更新时间网格，显示基于所选学生的禁排时段和可用时段
    setTimeout(() => {
      initializeTimeGrid();
    }, 100);
    
    // 如果选择了课程，更新学生进度
    if (selectedCourseName) {
      // 不需要手动更新进度，useMemo 会自动计算
    }
    
    // 优化：只在需要时过滤课程，避免每次添加学生都重新获取数据
    // 如果已经有课程数据，直接使用缓存的课程数据进行过滤
    if (courses.length > 0) {
      try {
        // 获取小组中学生的所有班级
        const studentClasses = new Set(newGroupStudents.map(s => s.major_class).filter(Boolean));
        
        // 分析小组中学生的主要专业类型
        const majorTypeCount: {[key: string]: number} = {
          '钢琴': 0,
          '声乐': 0,
          '器乐': 0
        };
        
        newGroupStudents.forEach(student => {
          const courseType = student.__courseType;
          if (courseType === '钢琴') {
            majorTypeCount['钢琴']++;
          } else if (courseType === '声乐') {
            majorTypeCount['声乐']++;
          } else {
            // 其他专业类型都归为器乐
            majorTypeCount['器乐']++;
          }
        });
        
        // 找出数量最多的专业类型
        let maxCount = 0;
        let dominantType: '钢琴' | '声乐' | '器乐' = '器乐';
        
        Object.entries(majorTypeCount).forEach(([type, count]) => {
          if (count > maxCount) {
            maxCount = count;
            dominantType = type as '钢琴' | '声乐' | '器乐';
          }
        });
        
        // 使用指定的教师或当前教师
        const effectiveTeacher = targetTeacher || teacher;

        // 重新过滤小组课数据
        const filteredGroupCourses = courses
          .filter(course => {
            // 只保留授课类型为小组课的课程
            const isGroupCourse = (course as any).teaching_type === '小组课';
            if (!isGroupCourse) return false;

            // 根据教师的教研室过滤课程
            const effectiveTeacherId = effectiveTeacher?.id;
            if (effectiveTeacherId) {
              if (isCourseAssignedToTeacher(course, effectiveTeacher)) {
                // 课程已分配给当前教师，跳过教研室过滤
              } else {
              const teacherFacultyId = effectiveTeacher?.faculty_id;
              if (teacherFacultyId) {
                const courseFacultyId = (course as any).faculty_id || course.faculty_id;
                const courseType = (course as any).course_type || course.course_type;

                // 检查是否是林琳教师（特殊情况：她既带钢琴又带器乐课程）
                const teacherNumber = effectiveTeacher?.teacher_id;
                const isLinLinTeacher = teacherNumber === '120170194';

                // 如果课程有明确的faculty_id字段，直接匹配
                if (courseFacultyId) {
                  if (courseFacultyId !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
                // 否则根据课程类型推断教研室
                else if (courseType) {
                  // 使用INSTRUMENT_TO_FACULTY映射将课程类型转换为教研室代码
                  const courseFacultyCode = INSTRUMENT_TO_FACULTY[courseType] || '';
                  if (courseFacultyCode !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
              }
              }
            }
            
            // 根据小组主要专业类型过滤课程
            const courseType = (course as any).course_type || course.course_type;
            if (courseType) {
              if (dominantType === '钢琴' && courseType !== '钢琴') {
                return false;
              } else if (dominantType === '声乐' && courseType !== '声乐') {
                return false;
              } else if (dominantType === '器乐' && courseType !== '器乐') {
                return false;
              }
            }
            
            // 根据小组中学生的班级过滤课程
            const courseClass = (course as any).class_name || (course as any).major_class || '';
            
            // 检查课程的班级是否与学生的班级匹配
            // 使用更宽松的匹配方式
            const isMatch = Array.from(studentClasses).some(studentClass => {
              if (!studentClass) return false;
              // 如果课程没有班级信息，也视为匹配
              if (!courseClass) return true;
              // 检查学生班级是否包含在课程班级中，或课程班级是否包含学生班级的关键部分
              return courseClass.includes(studentClass) || 
                     studentClass.includes(courseClass) || 
                     courseClass.includes(studentClass.slice(0, 4)) || 
                     studentClass.includes(courseClass.slice(0, 4)) ||
                     // 检查是否包含年级信息
                     courseClass.includes(studentClass.slice(0, 2)) ||
                     studentClass.includes(courseClass.slice(0, 2));
            });
            
            return isMatch;
          })
          .reduce((map, course) => map.set(course.id, course), new Map())
          .values();
      
      const result = Array.from(filteredGroupCourses);

      // 如果过滤后没有课程，尝试更宽松的过滤
      if (result.length === 0) {
        const relaxedFilteredCourses = courses
          .filter(course => {
            // 只保留授课类型为小组课的课程
            const isGroupCourse = (course as any).teaching_type === '小组课';
            if (!isGroupCourse) return false;

            // 根据教师的教研室过滤课程
            const effectiveTeacherId = effectiveTeacher?.id;
            if (effectiveTeacherId) {
              // 获取教师的教研室代码
              const teacherFacultyId = effectiveTeacher?.faculty_id;
              if (teacherFacultyId) {
                // 检查课程的教研室是否与教师的教研室匹配
                const courseFacultyId = (course as any).faculty_id || course.faculty_id;
                const courseType = (course as any).course_type || course.course_type;

                // 检查是否是林琳教师（特殊情况：她既带钢琴又带器乐课程）
                const teacherNumber = effectiveTeacher?.teacher_id;
                const isLinLinTeacher = teacherNumber === '120170194';

                // 如果课程有明确的faculty_id字段，直接匹配
                if (courseFacultyId) {
                  if (courseFacultyId !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
                // 否则根据课程类型推断教研室
                else if (courseType) {
                  // 使用INSTRUMENT_TO_FACULTY映射将课程类型转换为教研室代码
                  const courseFacultyCode = INSTRUMENT_TO_FACULTY[courseType] || '';
                  if (courseFacultyCode !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
              }
            }
            
            // 根据小组主要专业类型过滤课程
            const courseType = (course as any).course_type || course.course_type;
            if (courseType) {
              if (dominantType === '钢琴' && courseType !== '钢琴') {
                return false;
              } else if (dominantType === '声乐' && courseType !== '声乐') {
                return false;
              } else if (dominantType === '器乐' && courseType !== '器乐') {
                return false;
              }
            }
            
            // 不按班级过滤，只按专业类型过滤
            return true;
          });
        
        const relaxedDisplayFirst = filterValidGroupCoursesForDisplay(relaxedFilteredCourses);
        setGroupCourses(relaxedDisplayFirst);

        // 如果当前还没有选择课程，则自动选中过滤后的第一门课
        if (!selectedCourseName && relaxedDisplayFirst.length > 0) {
          const firstCourse: any = relaxedDisplayFirst[0];
          const autoCourseId = firstCourse.course_id || firstCourse.id || '';
          const autoCourseClassId = firstCourse.class_name || firstCourse.major_class || '';
          setSelectedCourseName(firstCourse.course_name || '');
          setSelectedCourseId(autoCourseId);
          setSelectedCourseClassId(autoCourseClassId);
        }
      } else {
        const resultDisplayFirst = filterValidGroupCoursesForDisplay(result);
        setGroupCourses(resultDisplayFirst);

        // 如果当前还没有选择课程，则自动选中过滤结果中的第一门课
        if (!selectedCourseName && resultDisplayFirst.length > 0) {
          const firstCourse: any = resultDisplayFirst[0];
          const autoCourseId = firstCourse.course_id || firstCourse.id || '';
          const autoCourseClassId = firstCourse.class_name || firstCourse.major_class || '';
          setSelectedCourseName(firstCourse.course_name || '');
          setSelectedCourseId(autoCourseId);
          setSelectedCourseClassId(autoCourseClassId);
        }
      }
      } catch (error) {
        console.error('过滤课程失败:', error);
        // 如果过滤失败，保持当前的课程列表
      }
    } else {
      // 如果没有缓存的课程数据，才从服务器获取
      await filterGroupCoursesByStudentClasses(newGroupStudents);
    }
    
    // 完成进度并移除进度条
    updateProgress(100);
    setTimeout(() => {
      try { document.body.removeChild(progressContainer); } catch (e) {}
    }, 300);
  };

  // 处理班级类型选择
  const handleClassTypeChange = (classType: string) => {
    setSelectedClassType(classType);
    // 选择班级类型后，清空具体班级选择
    setSelectedClassId('');
    
    // 如果选择了具体班级类型，清空年级选择（因为年级会根据班级类型重新筛选）
    if (classType !== 'all') {
      setSelectedGrade('all');
    }
  };

  // 处理年级选择
  const handleGradeChange = (grade: string) => {
    setSelectedGrade(grade);
    // 选择年级后，清空具体班级选择
    setSelectedClassId('');
  };

  // 处理班级选择（反向联动）
  const handleSpecificClassChange = (classId: string) => {
    if (!classId) {
      setSelectedClassId('');
      return;
    }

    const selectedClass = classes.find(c => c.id === classId);
    if (!selectedClass) return;

    // 根据选择的班级，自动设置班级类型和年级
    const classGrade = extractGradeFromClassId(selectedClass.class_id);
    
    // 查找该班级的学生类型（通过学生数据判断）
    const classStudents = myStudents.filter(s => s.major_class === selectedClass.class_id);
    const studentClassType = classStudents.length > 0 ? getStudentClassType(classStudents[0]) : 'general';
    
    setSelectedClassId(classId);
    setSelectedClassType(studentClassType);
    setSelectedGrade(classGrade);
  };

  // 从小组移除学生
  const removeFromGroup = async (studentId: string, courseType?: string) => {
    const newGroupStudents = groupStudents.filter(s => {
      if (courseType) {
        return !(s.id === studentId && s.__courseType === courseType);
      }
      return s.id !== studentId;
    });
    setGroupStudents(newGroupStudents);
    
    // 移除学生来源信息
    const newStudentSources = new Map(studentSources);
    newStudentSources.delete(studentId);
    setStudentSources(newStudentSources);
    
    // 重要：学生选择变化后，自动更新时间网格，显示基于所选学生的禁排时段和可用时段
    setTimeout(() => {
      initializeTimeGrid();
    }, 100);
    
    // 如果选择了课程，更新学生进度
    if (selectedCourseName) {
      // 不需要手动更新进度，useMemo 会自动计算
    }
    
    // 优化：只在需要时过滤课程，避免每次移除学生都重新获取数据
    // 如果已经有课程数据，直接使用缓存的课程数据进行过滤
    if (courses.length > 0) {
      try {
        // 获取小组中学生的所有班级
        const studentClasses = new Set(newGroupStudents.map(s => s.major_class).filter(Boolean));
        
        // 分析小组中学生的主要专业类型
        const majorTypeCount: {[key: string]: number} = {
          '钢琴': 0,
          '声乐': 0,
          '器乐': 0
        };
        
        newGroupStudents.forEach(student => {
          const courseType = student.__courseType;
          if (courseType === '钢琴') {
            majorTypeCount['钢琴']++;
          } else if (courseType === '声乐') {
            majorTypeCount['声乐']++;
          } else {
            // 其他专业类型都归为器乐
            majorTypeCount['器乐']++;
          }
        });
        
        // 找出数量最多的专业类型
        let maxCount = 0;
        let dominantType: '钢琴' | '声乐' | '器乐' = '器乐';
        
        Object.entries(majorTypeCount).forEach(([type, count]) => {
          if (count > maxCount) {
            maxCount = count;
            dominantType = type as '钢琴' | '声乐' | '器乐';
          }
        });
        
        // 使用指定的教师或当前教师
        const effectiveTeacher = targetTeacher || teacher;

        // 重新过滤小组课数据
        const filteredGroupCourses = courses
          .filter(course => {
            // 只保留授课类型为小组课的课程
            const isGroupCourse = (course as any).teaching_type === '小组课';
            if (!isGroupCourse) return false;

            // 根据教师的教研室过滤课程
            const effectiveTeacherId = effectiveTeacher?.id;
            if (effectiveTeacherId) {
              if (isCourseAssignedToTeacher(course, effectiveTeacher)) {
                // 课程已分配给当前教师，跳过教研室过滤
              } else {
              const teacherFacultyId = effectiveTeacher?.faculty_id;
              if (teacherFacultyId) {
                const courseFacultyId = (course as any).faculty_id || course.faculty_id;
                const courseType = (course as any).course_type || course.course_type;

                // 检查是否是林琳教师（特殊情况：她既带钢琴又带器乐课程）
                const teacherNumber = effectiveTeacher?.teacher_id;
                const isLinLinTeacher = teacherNumber === '120170194';

                // 如果课程有明确的faculty_id字段，直接匹配
                if (courseFacultyId) {
                  if (courseFacultyId !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
                // 否则根据课程类型推断教研室
                else if (courseType) {
                  // 使用INSTRUMENT_TO_FACULTY映射将课程类型转换为教研室代码
                  const courseFacultyCode = INSTRUMENT_TO_FACULTY[courseType] || '';
                  if (courseFacultyCode !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
              }
              }
            }
            
            // 根据小组主要专业类型过滤课程
            const courseType = (course as any).course_type || course.course_type;
            if (courseType) {
              if (dominantType === '钢琴' && courseType !== '钢琴') {
                return false;
              } else if (dominantType === '声乐' && courseType !== '声乐') {
                return false;
              } else if (dominantType === '器乐' && courseType !== '器乐') {
                return false;
              }
            }
            
            // 根据小组中学生的班级过滤课程
            const courseClass = (course as any).class_name || (course as any).major_class || '';
            
            // 检查课程的班级是否与学生的班级匹配
            // 使用更宽松的匹配方式
            const isMatch = Array.from(studentClasses).some(studentClass => {
              if (!studentClass) return false;
              // 如果课程没有班级信息，也视为匹配
              if (!courseClass) return true;
              // 检查学生班级是否包含在课程班级中，或课程班级是否包含学生班级的关键部分
              return courseClass.includes(studentClass) || 
                     studentClass.includes(courseClass) || 
                     courseClass.includes(studentClass.slice(0, 4)) || 
                     studentClass.includes(courseClass.slice(0, 4)) ||
                     // 检查是否包含年级信息
                     courseClass.includes(studentClass.slice(0, 2)) ||
                     studentClass.includes(courseClass.slice(0, 2));
            });
            
            return isMatch;
          })
          .reduce((map, course) => map.set(course.id, course), new Map())
          .values();
      
      const result = Array.from(filteredGroupCourses);

      // 如果过滤后没有课程，尝试更宽松的过滤
      if (result.length === 0) {
        const relaxedFilteredCourses = courses
          .filter(course => {
            // 只保留授课类型为小组课的课程
            const isGroupCourse = (course as any).teaching_type === '小组课';
            if (!isGroupCourse) return false;

            // 根据教师的教研室过滤课程
            const effectiveTeacherId = effectiveTeacher?.id;
            if (effectiveTeacherId) {
              // 获取教师的教研室代码
              const teacherFacultyId = effectiveTeacher?.faculty_id;
              if (teacherFacultyId) {
                // 检查课程的教研室是否与教师的教研室匹配
                const courseFacultyId = (course as any).faculty_id || course.faculty_id;
                const courseType = (course as any).course_type || course.course_type;

                // 检查是否是林琳教师（特殊情况：她既带钢琴又带器乐课程）
                const teacherNumber = effectiveTeacher?.teacher_id;
                const isLinLinTeacher = teacherNumber === '120170194';

                // 如果课程有明确的faculty_id字段，直接匹配
                if (courseFacultyId) {
                  if (courseFacultyId !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
                // 否则根据课程类型推断教研室
                else if (courseType) {
                  // 使用INSTRUMENT_TO_FACULTY映射将课程类型转换为教研室代码
                  const courseFacultyCode = INSTRUMENT_TO_FACULTY[courseType] || '';
                  if (courseFacultyCode !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
              }
            }
            
            // 根据小组主要专业类型过滤课程
            const courseType = (course as any).course_type || course.course_type;
            if (courseType) {
              if (dominantType === '钢琴' && courseType !== '钢琴') {
                return false;
              } else if (dominantType === '声乐' && courseType !== '声乐') {
                return false;
              } else if (dominantType === '器乐' && courseType !== '器乐') {
                return false;
              }
            }
            
            // 不按班级过滤，只按专业类型过滤
            return true;
          });
        
        setGroupCourses(filterValidGroupCoursesForDisplay(relaxedFilteredCourses));
      } else {
        setGroupCourses(filterValidGroupCoursesForDisplay(result));
      }
      } catch (error) {
        console.error('过滤课程失败:', error);
        // 如果过滤失败，保持当前的课程列表
      }
    } else {
      // 如果没有缓存的课程数据，才从服务器获取
      await filterGroupCoursesByStudentClasses(newGroupStudents);
    }
  };

  // 清空小组
  const clearGroup = async () => {
    setGroupStudents([]);
    setSelectedCourseName('');
    setSelectedCourseId('');
    setSelectedCourseClassId('');
    // 清空学生来源信息
    setStudentSources(new Map());
    // 清空小组后，重新加载所有小组课数据
    await loadGroupCoursesData();
  };



  // 检查是否为禁排时段
  const isPeriodBlocked = (day: number, period: number) => {
    // 检查学生是否已经被其他老师排课
    if (groupStudents.length > 0) {
      for (const student of groupStudents) {
        const studentConflict = scheduledClasses.find(sc =>
          sc.student_id === student.id &&
          sc.day_of_week === day &&
          sc.period === period &&
          ((sc.start_week !== undefined && sc.end_week !== undefined && selectedWeek >= sc.start_week && selectedWeek <= sc.end_week) ||
           (sc.week !== undefined && sc.week === selectedWeek) ||
           (sc.start_week === undefined && sc.end_week === undefined && sc.week === undefined && selectedWeek <= 16))
        );
        if (studentConflict) {
          return true;
        }
      }
    }

    return false;
  };

  // 合并周次范围
  const mergeWeekRanges = (weeks: number[]) => {
    if (weeks.length === 0) return [];
    
    // 去重并排序周次
    const uniqueWeeks = Array.from(new Set(weeks)).sort((a, b) => a - b);
    const ranges = [];
    let start = uniqueWeeks[0];
    let end = uniqueWeeks[0];
    
    for (let i = 1; i < uniqueWeeks.length; i++) {
      if (uniqueWeeks[i] === end + 1) {
        // 周次连续，扩展范围
        end = uniqueWeeks[i];
      } else {
        // 周次不连续，保存当前范围并开始新范围
        ranges.push({ start, end });
        start = uniqueWeeks[i];
        end = uniqueWeeks[i];
      }
    }
    // 保存最后一个范围
    ranges.push({ start, end });
    return ranges;
  };

  // 格式化排课时间（与"当前排课信息"格式一致）
  const formatScheduleTime = (schedules: any[]) => {
    // 星期几映射
    const weekDayMap: {[key: number]: string} = {
      1: '周一',
      2: '周二',
      3: '周三',
      4: '周四',
      5: '周五',
      6: '周六',
      7: '周日'
    };
    
    // 按星期和节次分组，收集所有周次
    const timeGroupMap = new Map<string, number[]>();
    
    schedules.forEach(schedule => {
      const week = schedule.start_week || schedule.week;
      const day = schedule.day_of_week || schedule.day;
      const period = schedule.period;
      
      if (week && day && period) {
        const timeKey = `${day}_${period}`;
        if (!timeGroupMap.has(timeKey)) {
          timeGroupMap.set(timeKey, []);
        }
        timeGroupMap.get(timeKey)!.push(week);
      }
    });
    
    // 生成合并后的时间字符串（与当前排课信息格式一致）
    const timeElements: string[] = [];
    
    // 按星期几和节次排序
    const sortedTimeKeys = Array.from(timeGroupMap.keys()).sort((a, b) => {
      const [dayA, periodA] = a.split('_').map(Number);
      const [dayB, periodB] = b.split('_').map(Number);
      if (dayA !== dayB) return dayA - dayB;
      return periodA - periodB;
    });
    
    sortedTimeKeys.forEach(timeKey => {
      const [day, period] = timeKey.split('_').map(Number);
      const weeks = timeGroupMap.get(timeKey)!;
      
      // 去重并排序周次
      const uniqueWeeks = Array.from(new Set(weeks)).sort((a, b) => a - b);
      
      if (uniqueWeeks.length > 0) {
        // 合并连续周次
        const mergedRanges: { start: number; end: number }[] = [];
        let start = uniqueWeeks[0];
        let end = uniqueWeeks[0];
        
        for (let j = 1; j < uniqueWeeks.length; j++) {
          if (uniqueWeeks[j] === end + 1) {
            end = uniqueWeeks[j];
          } else {
            mergedRanges.push({ start, end });
            start = uniqueWeeks[j];
            end = uniqueWeeks[j];
          }
        }
        mergedRanges.push({ start, end });
        
        // 生成时间字符串（格式：第1-2周、5-9周、11-17周周二第3节）
        const dayName = weekDayMap[day] || `周${day}`;
        const rangeStrings = mergedRanges.map(range => {
          if (range.start === range.end) {
            return `${range.start}`;
          } else {
            return `${range.start}-${range.end}`;
          }
        });
        
        timeElements.push(`第${rangeStrings.join('、')}周${dayName}第${period}节`);
      }
    });
    
    return timeElements.join('<br>');
  };

  // 获取排课结果（使用 useMemo 缓存）
  const scheduleResults = React.useMemo(() => {
    // 优化：使用 Map 存储课程，提高查找效率（同时支持内部ID和课程编号查找）
    const coursesMap = new Map(courses.map(course => [course.id, course]));
    // 添加课程编号到映射
    courses.forEach(course => {
      if ((course as any).course_id) {
        coursesMap.set((course as any).course_id, course);
      }
    });
    
    // 获取当前教师ID集合（兼容 id / teacher_id / user.teacher_id）
    // 管理员未选择教师时不过滤教师，展示所有教师的排课结果
    const currentTeacherIdSet: Set<string> =
      isAdmin && !targetTeacher ? new Set<string>() : getCurrentTeacherIdSet();

    // 从根源上过滤掉专业大课和理论课
    const filteredScheduledClasses = scheduledClasses.filter(schedule => {
      // 当已经明确选择了教师（管理员或普通教师），只显示该教师的排课结果
      if (currentTeacherIdSet.size > 0) {
        const tid = normalizeTeacherId(schedule.teacher_id);
        if (!tid || !currentTeacherIdSet.has(tid)) {
          return false;
        }
      }
      
      // 通过 course_id 关联课程数据获取 teaching_type
      const course = coursesMap.get(schedule.course_id);
      const teachingType = schedule.teaching_type || (course as any)?.teaching_type;
      if (teachingType === '专业大课') {
        return false;
      }
      
      // 检查课程类型是否为理论课
      const courseType = schedule.course_type || course?.course_type;
      if (courseType === '理论课') {
        return false;
      }
      
      return true;
    });
    
    // 根据实际的排课数据生成结果
    // 按课程、教师、学生分组（同一小组的不同节次合并显示）
    const groupedResults = filteredScheduledClasses.reduce((groups, schedule) => {
      // 从 students 状态中获取学生详细信息
      // 同时检查 id 和 student_id 字段（兼容旧数据）
      let studentInfo = null;
      if (schedule.student_id) {
        studentInfo = students.find(s => s.id === schedule.student_id || s.student_id === schedule.student_id);
      }
      if (!studentInfo && schedule.student_name) {
        studentInfo = students.find(s => s.name === schedule.student_name);
      }
      
      // 调试日志
      if (!studentInfo && schedule.student_id) {
        console.log('学生匹配失败:', {
          schedule_student_id: schedule.student_id,
          schedule_student_name: schedule.student_name,
          students_count: students.length,
          first_student: students[0] ? { id: students[0].id, student_id: students[0].student_id, name: students[0].name } : null
        });
      }
      
      // 构建学生对象，包含正确的学号和班级信息
      const studentObj = {
        id: studentInfo?.id || schedule.student_id,
        name: schedule.student_name || studentInfo?.name,
        student_id: studentInfo?.student_id || schedule.student_id,
        className: studentInfo?.major_class || studentInfo?.class_name || schedule.class_name || schedule.major_class || ''
      };
      
      // 直接使用schedule中的课程名称和类型，这些是在保存时设置的
      let courseName = schedule.course_name || '课程';
      let courseType = schedule.course_type || '器乐';
      
      // 从课程表中获取正确的课程编号
      const course = coursesMap.get(schedule.course_id);
      const courseNumber = course ? (course as any).course_id || schedule.course_id : schedule.course_id;
      
      const teacherName = schedule.teacher_name || schedule.courses?.teacher_name || schedule.courses?.teacher?.name || (targetTeacher?.name || teacher?.name) || '未知教师';

      // 使用 group_id（如果有）优先分组，保证同一小组在结果中合并显示
      // 否则退回到“课程编号 + 班级 + 教师 + 时间”作为分组键，避免不同课程/班级被误合并
      const classKey =
        schedule.class_name ||
        schedule.major_class ||
        studentObj.className ||
        '';
      const timeKey = `${schedule.day_of_week}_${schedule.period}`;
      // 使用课程编号 + 课程类型 + 教师姓名 作为基础键，避免同一教师因 teacher_id 不一致而被拆分
      const baseKey = `${courseNumber || 'NOCOURSE'}_${courseType}_${teacherName}`;
      const groupKey = schedule.group_id
        ? `${schedule.group_id}_${timeKey}`
        // 没有 group_id 时，按“课程编号 + 课程类型 + 教师 + 时间”分组，
        // 允许同年级、同类型的跨班混组在结果中合并显示
        : `${baseKey}_${timeKey}`;
      
      if (groups[groupKey]) {
        // 添加到现有组
        const group = groups[groupKey];
        group.schedules.push(schedule);
        // 检查学生是否已在组中，不在则添加
        if (!group.students.some((s: any) => s.id === studentObj.id || s.name === studentObj.name)) {
          group.students.push(studentObj);
        }
      } else {
        // 创建新组
        groups[groupKey] = {
          courseId: courseNumber,
          courseName: courseName,
          courseType: courseType,
          teacherId: schedule.teacher_id,
          teacherName: teacherName,
          students: [studentObj],
          schedules: [schedule]
        };
      }
      
      return groups;
    }, {} as Record<string, any>);
    
    // 第二步：按学生学号再次分组，合并时间
    // 将同一时间组的学生按学号分组，合并他们的所有时间段
    const studentTimeGroups: Record<string, any> = {};
    
    Object.values(groupedResults).forEach((result: any) => {
      result.students.forEach((student: any) => {
        // 使用课程编号 + 教师姓名 + 学号 作为键，确保同一教师的同一小组能正确合并
        const studentKey = `${result.courseId}_${result.teacherName}_${student.student_id || student.id || student.name}`;
        
        if (studentTimeGroups[studentKey]) {
          // 合并时间段
          studentTimeGroups[studentKey].schedules.push(...result.schedules);
        } else {
          studentTimeGroups[studentKey] = {
            courseId: result.courseId,
            courseName: result.courseName,
            courseType: result.courseType,
            teacherId: result.teacherId,
            teacherName: result.teacherName,
            student: student,
            schedules: [...result.schedules]
          };
        }
      });
    });
    
    // 第三步：按时间段分组，合并学生
    // 将相同时间段的学生合并到同一组
    const timeStudentGroups: Record<string, any> = {};
    
    Object.values(studentTimeGroups).forEach((studentGroup: any) => {
      // 仅保留当前学生自己的排课记录，避免不同小组之间的节次被错误合并
      const ownSchedules = (studentGroup.schedules || []).filter((s: any) => {
        return (
          s.student_id === studentGroup.student.student_id ||
          s.student_id === studentGroup.student.id ||
          s.student_name === studentGroup.student.name
        );
      });

      if (ownSchedules.length === 0) {
        return;
      }

      // 生成时间段key（用于合并相同时间段的学生）
      const timeKey = ownSchedules
        .map((s: any) => `${s.day_of_week}_${s.period}_${s.start_week || s.week}`)
        .sort()
        .join('|');

      // 使用 group_id（如果存在）来标识同一小组，确保同一小组跨班学生合并显示
      // 若无 group_id（旧数据或未保存成功），按“课程编号 + 教师姓名 + 时间”合并，不按班级拆分，使混班能合并为一行
      const groupGroupId = ownSchedules[0]?.group_id;
      const groupKey = groupGroupId
        ? `${groupGroupId}_${timeKey}`
        : `${studentGroup.courseId}_${studentGroup.teacherName}_${timeKey}`;
      
      if (timeStudentGroups[groupKey]) {
        // 添加学生到现有组
        if (
          !timeStudentGroups[groupKey].students.some(
            (s: any) =>
              s.student_id === studentGroup.student.student_id ||
              s.id === studentGroup.student.id
          )
        ) {
          timeStudentGroups[groupKey].students.push(studentGroup.student);
        }
        // 合并时间段（去重）
        ownSchedules.forEach((schedule: any) => {
          const exists = timeStudentGroups[groupKey].schedules.some(
            (s: any) => s.id === schedule.id
          );
          if (!exists) {
            timeStudentGroups[groupKey].schedules.push(schedule);
          }
        });
      } else {
        // 创建新组
        timeStudentGroups[groupKey] = {
          courseId: studentGroup.courseId,
          courseName: studentGroup.courseName,
          courseType: studentGroup.courseType,
          teacherId: studentGroup.teacherId,
          teacherName: studentGroup.teacherName,
          students: [studentGroup.student],
          schedules: [...ownSchedules]
        };
      }
    });
    
    // 转换为结果数组并计算相关数据
    const results = Object.values(timeStudentGroups).map(result => {
      // 计算小组人数
      const groupSize = result.students.length;
      
      // 学生姓名分行显示（用<br>分隔）
      const studentNames = result.students.map((s: any) => s.name).join('<br>');
      
      // 学号分行显示
      const studentIds = result.students.map((s: any) => s.student_id || '').join('<br>');
      
      // 班级分行显示
      const studentClasses = result.students.map((s: any) => s.className || '').join('<br>');
      
      // 获取学生班级（使用第一个学生的班级）
      const studentClass = result.students[0]?.className || '';
      
      // 格式化排课时间（合并所有时间）
      const scheduleTime = formatScheduleTime(result.schedules);
      
      // 计算已排课时（1课时=1节次，按小组算，不叠加）
      // 对于小组课，课时按小组算，不是按学生人数算
      const uniqueTimeSlots = new Set();
      result.schedules.forEach(schedule => {
        const timeKey = `${schedule.day_of_week || schedule.day}_${schedule.period}_${schedule.start_week || schedule.week}`;
        uniqueTimeSlots.add(timeKey);
      });
      const scheduledHours = uniqueTimeSlots.size;
      
      // 直接使用从schedule中获取的课程类型，不重新计算
      let courseType = result.courseType || '器乐';
      
      // 确保课程类型与课程管理页面一致
      if (!['钢琴', '声乐', '器乐'].includes(courseType)) {
        courseType = '器乐';
      }
      
      // 确定是否为专业大课
      const isLargeClass = result.courseName.includes('大课') || result.schedules.some(schedule => schedule.teaching_type === '大课');
      
      // 对于专业大课，获取班级人数
      let finalGroupSize = groupSize;
      if (isLargeClass && studentClass) {
        // 查找该班级的学生人数
        const classStudents = students.filter(s => s.major_class === studentClass || s.class_name === studentClass);
        if (classStudents.length > 0) {
          finalGroupSize = classStudents.length;
        }
      }
      
      // 获取琴房信息
      let room_id;
      let room_name;
      
      // 对于林琳老师的课程，根据课程类型重新匹配琴房
      if (result.teacherName === '林琳') {
        // 根据课程类型匹配琴房
        if (result.courseType === '钢琴') {
          // 匹配影琴221-03
          const pianoRoom = fixedRooms.find(r => r.room?.room_name === '影琴221-03');
          if (pianoRoom) {
            room_id = pianoRoom.room?.id || pianoRoom.id;
            room_name = pianoRoom.room?.room_name || pianoRoom.room_name;
          }
        } else if (result.courseType === '器乐') {
          // 匹配器乐排练室114
          const instrumentalRoom = fixedRooms.find(r => r.room?.room_name === '器乐排练室114');
          if (instrumentalRoom) {
            room_id = instrumentalRoom.room?.id || instrumentalRoom.id;
            room_name = instrumentalRoom.room?.room_name || instrumentalRoom.room_name;
          }
        }
      }
      
      // 如果没有匹配到琴房（不是林琳老师或未找到对应琴房），使用保存的琴房信息
      if (!room_id || !room_name) {
        const firstSchedule = result.schedules[0];
        room_id = firstSchedule?.room_id;
        room_name = firstSchedule?.room_name || firstSchedule?.rooms?.room_name || (firstSchedule as any)?.rooms?.room_name || (firstSchedule as any)?.room_name;
      }
      
      // 从 courses 数据中获取课程编号和学分（根据具体班级区分）
      // 获取第一个学生的信息
      const firstStudent = result.students[0];
      const studentInfo = students.find(s => s.id === firstStudent?.id || s.student_id === firstStudent?.student_id || s.name === firstStudent?.name);
      const studentType = studentInfo?.student_type || 'general'; // 默认普通班
      const classType = studentType === 'upgrade' ? '专升本' : '普通班';
      const studentClassInfo = firstStudent?.className || studentInfo?.major_class || result.studentClass;
      
      // 提取班级编号（如从"音乐学2503"提取"2503"）
      const extractClassNumber = (className: string | undefined | null) => {
        if (!className) return '';
        const match = className.match(/\d+/);
        return match ? match[0] : className;
      };
      
      const studentClassNumber = extractClassNumber(studentClassInfo);
      
      // 根据课程名称和班级编号查找正确的课程
      let courseInfo = courses.find(c => {
        if (c.course_name !== result.courseName) return false;
        // 匹配班级编号（支持完整班级名称或只匹配数字部分）
        const courseClassNumber = extractClassNumber(c.major_class);
        return courseClassNumber === studentClassNumber;
      });
      
      // 特别处理：根据班级编号判断学分
      let credits;
      let courseNumber = result.courseId || '';
      
      if (courseInfo) {
        credits = (courseInfo as any)?.credit_hours || (courseInfo as any)?.credit || (courseInfo as any)?.credits;
        courseNumber = (courseInfo as any)?.course_id || courseNumber;
      } else if (studentClassInfo) {
        // 根据班级编号判断：2502班的器乐2应该是1学分
        const classNumMatch = studentClassInfo.match(/\d+/);
        if (classNumMatch && classNumMatch[0] === '2502' && result.courseName.includes('器乐2')) {
          credits = 1;
        } else if (classNumMatch && classNumMatch[0] === '2304' && result.courseName.includes('器乐2')) {
          credits = 2;
        } else if (classNumMatch) {
          // 其他班级默认学分
          credits = 1;
        }
      }
      
      return {
        id: `${result.courseId || result.courseName}_${result.teacherId || result.teacherName}_${result.students.map((s: any) => s.name).join('_')}_${scheduleTime}`,
        courseId: courseNumber, // 添加课程编号
        courseName: result.courseName,
        courseType: courseType,
        credits: credits, // 添加学分
        teacherName: result.teacherName,
        studentName: studentNames,
        studentIds: studentIds,
        studentClasses: studentClasses,
        studentClass: studentClass,
        groupSize: finalGroupSize,
        scheduleTime,
        scheduledHours,
        // 添加琴房信息
        room_id: room_id,
        room_name: room_name,
        // 添加原始排课记录，用于删除操作
        originalSchedules: result.schedules,
        // 添加学生详细信息，用于一人一行显示
        students: result.students,
        // 标记是否为专业大课
        isLargeClass: isLargeClass
      };
    });
    
    // 第二遍合并：按“课程编号 + 教师姓名 + 排课时间”再合并一次，确保混班（无 group_id 或 group_id 未生效时）能合并为一行
    const secondMergeKey = (r: any) => `${r.courseId}_${r.teacherName}_${r.scheduleTime}`;
    const bySecondKey: Record<string, any[]> = {};
    results.forEach((r: any) => {
      const key = secondMergeKey(r);
      if (!bySecondKey[key]) bySecondKey[key] = [];
      bySecondKey[key].push(r);
    });
    const afterSecondMerge: any[] = [];
    Object.values(bySecondKey).forEach((group: any[]) => {
      if (group.length <= 1) {
        afterSecondMerge.push(...group);
        return;
      }
      const first = group[0];
      const mergedStudents: any[] = [];
      const seenStudentIds = new Set<string | number>();
      const mergedSchedules: any[] = [];
      const seenScheduleIds = new Set<string | number>();
      group.forEach((r: any) => {
        (r.students || []).forEach((s: any) => {
          const sid = s.student_id ?? s.id ?? s.name;
          if (sid != null && !seenStudentIds.has(sid)) {
            seenStudentIds.add(sid);
            mergedStudents.push(s);
          }
        });
        (r.originalSchedules || []).forEach((sch: any) => {
          if (sch.id != null && !seenScheduleIds.has(sch.id)) {
            seenScheduleIds.add(sch.id);
            mergedSchedules.push(sch);
          }
        });
      });
      const studentNames = mergedStudents.map((s: any) => s.name).join('<br>');
      const studentIds = mergedStudents.map((s: any) => s.student_id || '').join('<br>');
      const studentClasses = mergedStudents.map((s: any) => s.className || '').join('<br>');
      const studentClass = mergedStudents[0]?.className || '';
      const scheduleTime = first.scheduleTime;
      const uniqueTimeSlots = new Set<string>();
      mergedSchedules.forEach((schedule: any) => {
        const timeKey = `${schedule.day_of_week || schedule.day}_${schedule.period}_${schedule.start_week || schedule.week}`;
        uniqueTimeSlots.add(timeKey);
      });
      const scheduledHours = uniqueTimeSlots.size;
      const groupSize = mergedStudents.length;
      let finalGroupSize = groupSize;
      const isLargeClass = first.isLargeClass;
      if (isLargeClass && studentClass) {
        const classStudents = students.filter(s => s.major_class === studentClass || s.class_name === studentClass);
        if (classStudents.length > 0) finalGroupSize = classStudents.length;
      }
      afterSecondMerge.push({
        ...first,
        id: `${first.courseId}_${first.teacherId ?? first.teacherName}_${mergedStudents.map((s: any) => s.name).join('_')}_${scheduleTime}`,
        studentName: studentNames,
        studentIds,
        studentClasses,
        studentClass,
        groupSize: finalGroupSize,
        scheduledHours,
        students: mergedStudents,
        originalSchedules: mergedSchedules
      });
    });
    
    // 去重处理
    const uniqueResults = [];
    const seenIds = new Set();

    for (const result of afterSecondMerge) {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        uniqueResults.push(result);
      }
    }

    // 只保留钢琴、声乐、器乐的小课，过滤掉理论课
    const filteredByType = uniqueResults.filter(result => {
      return result.courseType === '钢琴' || result.courseType === '声乐' || result.courseType === '器乐';
    });



    return filteredByType;
  }, [scheduledClasses, students, targetTeacher, teacher, courses, isAdmin, fixedRooms]);

  // 过滤状态
  const [scheduleFilters, setScheduleFilters] = useState({
    teacherName: '全部教师',
    className: '全部班级'
  });

  // 搜索状态
  const [searchTerm, setSearchTerm] = useState('');
  
  // 排课结果分页状态
  const [scheduleCurrentPage, setScheduleCurrentPage] = useState(1);
  const [schedulePageSize, setSchedulePageSize] = useState(5);
  // 排课项选择状态
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<Set<string>>(new Set());

  // 渲染排课结果模块
  const renderScheduleResults = () => {
    // 获取所有教师姓名选项（只从已过滤的 scheduleResults 中获取，确保只显示专业小课的教师）
    const teacherOptions = ['全部教师', ...Array.from(new Set(scheduleResults.map(result => result.teacherName).filter(Boolean)))];
    
    // 获取所有班级选项（只从已过滤的 scheduleResults 中获取）
    const classOptions = ['全部班级', ...Array.from(new Set(scheduleResults.map(result => result.studentClass).filter(Boolean)))];
    
    // 过滤排课结果
    const filteredResults = scheduleResults.filter(result => {
      const teacherMatch = scheduleFilters.teacherName === '全部教师' || 
        result.teacherName === scheduleFilters.teacherName;
      
      const classMatch = scheduleFilters.className === '全部班级' || 
        (result.students && result.students.some(student => student.className === scheduleFilters.className)) ||
        result.studentClass === scheduleFilters.className;
      
      // 搜索匹配
      const searchMatch = !searchTerm || 
        result.courseName.includes(searchTerm) ||
        result.teacherName.includes(searchTerm) ||
        result.studentName.includes(searchTerm) ||
        result.studentClass.includes(searchTerm);
      
      return teacherMatch && classMatch && searchMatch;
    });
    
    // 分页处理
    const totalResults = filteredResults.length;
    const totalPages = Math.ceil(totalResults / schedulePageSize);
    const startIndex = (scheduleCurrentPage - 1) * schedulePageSize;
    const endIndex = startIndex + schedulePageSize;
    const paginatedResults = filteredResults.slice(startIndex, endIndex);
    
    // 页码范围
    const getPageNumbers = () => {
      const pages = [];
      const maxVisiblePages = 5;
      let startPage = Math.max(1, scheduleCurrentPage - Math.floor(maxVisiblePages / 2));
      let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      
      if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
      
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }
      return pages;
    };

    return (
      <div className="bg-white rounded-lg p-4 mb-6 mt-0 rounded-t-none">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-purple-600" />
              排课结果
            </h3>
            
            {/* 批量删除按钮 */}
            {selectedScheduleIds.size > 0 && (
              <button
                onClick={() => handleBatchDeleteSchedules()}
                className="px-3 py-1 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-all duration-200 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                批量删除 ({selectedScheduleIds.size})
              </button>
            )}
            
            {/* 搜索框 */}
            <div className="relative">
              <input
                type="text"
                placeholder="搜索课程、教师、学生..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-3 py-1 pl-8 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
          </div>
          
          {/* 过滤器 */}
          <div className="flex flex-wrap gap-2">
            {/* 教师姓名过滤器 */}
            <select
              value={scheduleFilters.teacherName}
              onChange={(e) => setScheduleFilters(prev => ({ ...prev, teacherName: e.target.value }))}
              className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {teacherOptions.map(teacher => (
                <option key={teacher} value={teacher}>{teacher}</option>
              ))}
            </select>
            
            {/* 班级过滤器 */}
            <select
              value={scheduleFilters.className}
              onChange={(e) => setScheduleFilters(prev => ({ ...prev, className: e.target.value }))}
              className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {classOptions.map(className => (
                <option key={className} value={className}>{className}</option>
              ))}
            </select>
          </div>
        </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <input
                      type="checkbox"
                      checked={paginatedResults.length > 0 && paginatedResults.every(result => selectedScheduleIds.has(result.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const allIds = new Set(selectedScheduleIds);
                          paginatedResults.forEach(result => allIds.add(result.id));
                          setSelectedScheduleIds(allIds);
                        } else {
                          const newIds = new Set(selectedScheduleIds);
                          paginatedResults.forEach(result => newIds.delete(result.id));
                          setSelectedScheduleIds(newIds);
                        }
                      }}
                      className="rounded text-purple-600 focus:ring-purple-500"
                    />
                  </th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">序号</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">课程编号</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">课程名称</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">课程类型</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学分</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">教师姓名</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px]">学生姓名</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学号</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学生班级</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">小组人数</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">排课时间</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">已排课时</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">琴房</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedResults.length > 0 ? (
                  paginatedResults.map((result, index) => {
                    // 计算实际序号（考虑分页）
                    const actualIndex = startIndex + index + 1;
                    return (
                      <tr key={result.id}>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          <input
                            type="checkbox"
                            checked={selectedScheduleIds.has(result.id)}
                            onChange={(e) => {
                              const newIds = new Set(selectedScheduleIds);
                              if (e.target.checked) {
                                newIds.add(result.id);
                              } else {
                                newIds.delete(result.id);
                              }
                              setSelectedScheduleIds(newIds);
                            }}
                            className="rounded text-purple-600 focus:ring-purple-500"
                          />
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500 font-mono">{actualIndex}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 font-mono">{result.courseId || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-900">{result.courseName}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{result.courseType}</td>
                        <td className="px-4 py-2 text-sm">
                          {result.credits === 2 ? (
                            <span className="px-2 py-1 text-sm font-bold text-red-600 bg-red-50 rounded font-mono">
                              {result.credits}
                            </span>
                          ) : (
                            <span className="text-gray-500 font-mono">{result.credits || 1}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">{result.teacherName}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 whitespace-pre-line">
                          {result.isLargeClass ? '' : (
                            result.students && result.students.length > 0 
                              ? result.students.map(student => student.name).join('\n') 
                              : result.studentName
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500 whitespace-pre-line font-mono">
                          {result.isLargeClass ? '' : (
                            result.students && result.students.length > 0 
                              ? result.students.map(student => student.student_id || '-').join('\n') 
                              : '-'
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500 whitespace-pre-line font-mono">
                          {result.students && result.students.length > 0
                            ? result.students.map(student => (student.className || '-').replace(/^音乐学/, '')).join('\n')
                            : (result.studentClass || '-').replace(/^音乐学/, '')
                          }
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500 font-mono">{result.groupSize}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 font-mono whitespace-pre-wrap">{result.scheduleTime?.replace(/<br>/g, '\n') || ''}</td>
                        <td className="px-4 py-2 text-sm">
                          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-600 text-white shadow">
                            {result.scheduledHours}
                            <span className="ml-0.5 text-[10px] text-gray-100">节</span>
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {(() => {
                            // 优先使用排课记录中保存的琴房信息
                            if (result.room_name) {
                              return result.room_name;
                            }
                            // 如果没有房间名称，尝试根据房间ID查找
                            else if (result.room_id) {
                              const room = rooms.find(r => r.id === result.room_id || r.room_id === result.room_id);
                              return room?.room_name || result.room_id;
                            }
                            // 后备：根据教师姓名查找琴房
                            const teacher = availableTeachers.find(t => t.name === result.teacherName);
                            if (teacher?.fixed_rooms && teacher.fixed_rooms.length > 0) {
                              // 林琳教师特殊处理：根据课程类型只显示一个琴房
                              if (result.teacherName === '林琳' && result.courseType) {
                                if (result.courseType === '钢琴') {
                                  // 匹配影琴221-03
                                  const pianoRoom = teacher.fixed_rooms.find(fr => {
                                    const room = rooms.find(r => r.id === fr.room_id || r.room_id === fr.room_id);
                                    return room?.room_name === '影琴221-03';
                                  });
                                  if (pianoRoom) {
                                    const room = rooms.find(r => r.id === pianoRoom.room_id || r.room_id === pianoRoom.room_id);
                                    return room?.room_name || pianoRoom.room_id;
                                  }
                                } else if (result.courseType === '器乐') {
                                  // 匹配器乐排练室114
                                  const instrumentalRoom = teacher.fixed_rooms.find(fr => {
                                    const room = rooms.find(r => r.id === fr.room_id || r.room_id === fr.room_id);
                                    return room?.room_name === '器乐排练室114';
                                  });
                                  if (instrumentalRoom) {
                                    const room = rooms.find(r => r.id === instrumentalRoom.room_id || r.room_id === instrumentalRoom.room_id);
                                    return room?.room_name || instrumentalRoom.room_id;
                                  }
                                }
                              }
                              // 其他教师或未找到对应琴房时，显示所有固定琴房
                              return teacher.fixed_rooms.map(fr => {
                                const room = rooms.find(r => r.id === fr.room_id || r.room_id === fr.room_id);
                                return room?.room_name || fr.room_id;
                              }).join('、');
                            } else if (teacher?.fixed_room_id) {
                              const room = rooms.find(r => r.id === teacher.fixed_room_id || r.room_id === teacher.fixed_room_id);
                              return room?.room_name || teacher.fixed_room_id;
                            }
                            return '-';
                          })()}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          <button
                            onClick={() => handleDeleteSchedule(result)}
                            className="text-red-600 hover:text-red-800"
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={13} className="px-4 py-4 text-center text-sm text-gray-500">
                      暂无排课结果
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          {/* 分页控件 */}
          {totalResults > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-gray-600">
                显示 {startIndex + 1} 到 {Math.min(endIndex, totalResults)} 条，共 {totalResults} 条
              </div>
              <div className="flex items-center gap-1">
                {/* 首页按钮 */}
                <button
                  onClick={() => setScheduleCurrentPage(1)}
                  disabled={scheduleCurrentPage === 1}
                  className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  首页
                </button>
                {/* 上一页按钮 */}
                <button
                  onClick={() => setScheduleCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={scheduleCurrentPage === 1}
                  className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                {/* 页码按钮 */}
                {getPageNumbers().map(page => (
                  <button
                    key={page}
                    onClick={() => setScheduleCurrentPage(page)}
                    className={`px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                      scheduleCurrentPage === page
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'border-gray-300'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                {/* 下一页按钮 */}
                <button
                  onClick={() => setScheduleCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={scheduleCurrentPage === totalPages}
                  className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
                {/* 末页按钮 */}
                <button
                  onClick={() => setScheduleCurrentPage(totalPages)}
                  disabled={scheduleCurrentPage === totalPages}
                  className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  末页
                </button>
                {/* 每页显示条数 */}
                <select
                  value={schedulePageSize}
                  onChange={(e) => {
                    setSchedulePageSize(Number(e.target.value));
                    setScheduleCurrentPage(1); // 重置到第一页
                  }}
                  className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value={5}>5条/页</option>
                  <option value={10}>10条/页</option>
                  <option value={20}>20条/页</option>
                  <option value={50}>50条/页</option>
                </select>
              </div>
            </div>
          )}
          
          {/* 当前选中的排课信息 */}
          {groupStudents.length > 0 && selectedCourseName && (
            <div className="mt-4 p-3 bg-green-50 rounded-lg">
              <h4 className="text-sm font-medium text-green-700 mb-2">当前排课信息</h4>
              <div className="grid grid-cols-1 md:grid-cols-10 gap-3">
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">课程编号</p>
                  <p className="text-sm font-medium">{selectedCourseId || '-'}</p>
                </div>
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">课程名称</p>
                  <p className="text-sm font-medium">{selectedCourseName}</p>
                </div>
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">教师姓名</p>
                  <p className="text-sm">{targetTeacher?.name || teacher?.name || '未选择'}</p>
                </div>
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">学生姓名</p>
                  <p className="text-sm whitespace-pre-line">{groupStudents.map(s => s.name).join('\n')}</p>
                </div>
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">学号</p>
                  <p className="text-sm whitespace-pre-line">{groupStudents.map(s => s.student_id || '-').join('\n')}</p>
                </div>
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">学生班级</p>
                  <p className="text-sm whitespace-pre-line">{groupStudents.map(s => s.major_class || s.class_name || '-').join('\n')}</p>
                </div>
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">小组人数</p>
                  <p className="text-sm">{groupStudents.length}</p>
                </div>
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">排课时间</p>
                  <p className="text-sm whitespace-pre-wrap">
                    {selectedTimeSlots.length > 0
                      ? formatScheduleTime(
                          selectedTimeSlots.map(slot => ({
                            ...slot,
                            start_week: slot.week,
                            end_week: slot.week
                          }))
                        ).replace(/<br>/g, '\n')
                      : '未选择时间'}
                  </p>
                </div>
                <div className="md:col-span-1">
                  <p className="text-xs text-gray-500">已排课时</p>
                  <p className="text-2xl font-extrabold text-red-600 tracking-wide drop-shadow-sm">
                    {selectedTimeSlots.length}
                    <span className="ml-1 text-xs text-gray-500">节</span>
                  </p>
                </div>
                <div className="md:col-span-1 flex items-center">
                  <button
                    onClick={handleSaveSchedule}
                    disabled={selectedTimeSlots.length === 0 || !blockedTimesSchedulingReady}
                    className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}
      </div>
    );
  };

  // 检查教师是否有专业大课（用于周次选择的视觉提示）
  const hasTeacherMajorClass = useCallback((week: number, teacherId?: string, teacherName?: string): boolean => {
    if (!teacherId && !teacherName) return false;

    return scheduledClasses.some(sc => {
      // 检查是否为专业大课或理论课（通过course_id关联课程数据判断）
      if (!isMajorClassSchedule(sc)) return false;

      // 检查教师是否匹配（支持部分匹配，用于处理"合上"课程）
      let teacherMatches = false;
      if (teacherId && sc.teacher_id === teacherId) {
        teacherMatches = true;
      } else if (teacherName && sc.teacher_name) {
        if (sc.teacher_name === teacherName) {
          teacherMatches = true;
        } else {
          const scheduleTeachers = sc.teacher_name.split(/[,，、]/).map((t: string) => t.trim());
          teacherMatches = scheduleTeachers.includes(teacherName);
        }
      }
      if (!teacherMatches) return false;

      // 检查周次是否匹配
      if (sc.start_week !== undefined && sc.end_week !== undefined) {
        return week >= sc.start_week && week <= sc.end_week;
      }
      if (sc.week !== undefined) {
        return sc.week === week;
      }
      return week <= 16;
    });
  }, [scheduledClasses]);

  // 检查特定时段教师是否有专业大课
  const isBlockedByTeacherMajorClass = useCallback((week: number, day: number, period: number, teacherId?: string, teacherName?: string): boolean => {
    if (!teacherId && !teacherName) return false;

    return scheduledClasses.some(sc => {
      // 检查是否为专业大课或理论课
      const isMajorClass = (sc as any).teaching_type === '专业大课' || 
                          (sc as any).course_type === '专业大课' ||
                          (sc as any).teaching_type === '理论课' ||
                          (sc as any).course_type === '理论课' ||
                          sc.course_name?.includes('专业大课');
      if (!isMajorClass) return false;

      // 检查教师是否匹配（支持部分匹配，用于处理"合上"课程）
      let teacherMatches = false;
      if (teacherId && sc.teacher_id === teacherId) {
        teacherMatches = true;
      } else if (teacherName && sc.teacher_name) {
        if (sc.teacher_name === teacherName) {
          teacherMatches = true;
        } else {
          const scheduleTeachers = sc.teacher_name.split(/[,，、]/).map((t: string) => t.trim());
          teacherMatches = scheduleTeachers.includes(teacherName);
        }
      }
      if (!teacherMatches) return false;

      // 检查时间是否匹配
      if (sc.day_of_week !== day) return false;
      if (sc.period !== period) return false;

      // 检查周次是否匹配
      if (sc.start_week !== undefined && sc.end_week !== undefined) {
        return week >= sc.start_week && week <= sc.end_week;
      }
      if (sc.week !== undefined) {
        return sc.week === week;
      }
      return week <= 16;
    });
  }, [scheduledClasses]);

  // 计算指定周次的日期范围
  const getWeekDateRange = (week: number): string => {
    if (!semesterStartDate) return '';
    
    const startDate = new Date(semesterStartDate);
    
    // 获取某日期所在周的周一
    const getMonday = (date: Date): Date => {
      const d = new Date(date);
      const day = d.getDay();
      // getDay() 返回 0-6，其中 0 是星期日
      // 周一为一周的第一天：周日(0)属于上一周
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      return d;
    };
    
    // 学期开始的周一
    const startMonday = getMonday(startDate);
    
    // 计算目标周的周一
    const targetMonday = new Date(startMonday);
    targetMonday.setDate(startMonday.getDate() + (week - 1) * 7);
    
    // 计算目标周的周日
    const targetSunday = new Date(targetMonday);
    targetSunday.setDate(targetMonday.getDate() + 6);
    
    const formatDate = (date: Date) => {
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${month}-${day}`;
    };
    
    return `${formatDate(targetMonday)}~${formatDate(targetSunday)}`;
  };

  // 计算指定周和星期几的具体日期
  const getDayDate = (week: number, dayOfWeek: number): string => {
    if (!semesterStartDate) return '';
    
    const startDate = new Date(semesterStartDate);
    
    // 获取某日期所在周的周一
    const getMonday = (date: Date): Date => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      return d;
    };
    
    // 学期开始的周一
    const startMonday = getMonday(startDate);
    
    // 计算目标周的周一
    const targetMonday = new Date(startMonday);
    targetMonday.setDate(startMonday.getDate() + (week - 1) * 7);
    
    // 计算目标日期（周一=1，周日=7）
    const targetDate = new Date(targetMonday);
    targetDate.setDate(targetMonday.getDate() + (dayOfWeek - 1));
    
    const month = (targetDate.getMonth() + 1).toString().padStart(2, '0');
    const day = targetDate.getDate().toString().padStart(2, '0');
    
    return `${month}-${day}`;
  };

  // 渲染周次选择器
  const renderWeekSelector = () => {
    // 获取当前选中的所有班级信息（支持混合小组）
    const allClasses = groupStudents.length > 0 
      ? Array.from(new Set(groupStudents.map(s => s.major_class || s.class_name || '').filter(c => c)))
      : [];
    
    return (
      <div className="bg-white rounded-lg p-4 mb-0 rounded-b-none border-b-0">
        <div className="flex items-center flex-wrap gap-3 mb-4">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-purple-600" />
            周次选择
          </h3>
          <span className="text-sm font-bold text-white ml-2 px-4 py-2 bg-purple-600 rounded-full">
            当前第{selectedWeek}周（{getWeekDateRange(selectedWeek)}）
          </span>
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-gray-100 rounded inline-block border border-gray-200"></span>
              不禁排
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-orange-100 rounded inline-block border border-orange-200"></span>
              部分禁排
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-red-100 rounded inline-block border border-red-200"></span>
              全周禁排
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
            // 使用 unifiedBlockedTimes 检查周次禁排状态（传入所有班级）
            const weekStatus = checkWeekBlockedStatus(week, allClasses);
            // 检查是否有通适大课（传入所有班级）
            const hasLargeClass = hasLargeClassInWeek(week, allClasses);
            // 检查教师是否有专业大课
            const effectiveTeacherId = targetTeacher?.id || teacher?.id;
            const effectiveTeacherName = targetTeacher?.name || teacher?.name;
            const hasMajorClass = hasTeacherMajorClass(week, effectiveTeacherId, effectiveTeacherName);
            // 确定禁排状态
            const fullyBlocked = weekStatus.fullyBlocked;
            const partiallyBlocked = weekStatus.partiallyBlocked || hasLargeClass || hasMajorClass;
            // 只有全周禁排的周次才会被禁用
            const blocked = fullyBlocked;

            // 确定按钮样式
            let buttonClass = 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200';
            let titleText = '';
            let icon = '';

            if (selectedWeek === week) {
              buttonClass = 'bg-purple-600 text-white shadow-md';
            } else if (blocked) {
              buttonClass = 'bg-red-100 text-red-700 cursor-not-allowed border border-red-200';
              titleText = '全周禁排';
              icon = ' ✕';
            } else if (partiallyBlocked) {
              // 部分禁排（包括通适大课和教师专业大课）
              buttonClass = 'bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-200';
              titleText = hasMajorClass ? '教师专业大课' : '部分禁排';
              icon = ' ⚠';
            }

            return (
              <button
                key={week}
                onClick={() => !blocked && setSelectedWeek(week)}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex flex-col items-center leading-tight ${buttonClass}`}
                disabled={blocked}
                title={titleText}
              >
                <span>{week}{icon}</span>
                <span className="text-[10px] opacity-75 mt-0.5">{getWeekDateRange(week)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // 渲染时间网格
  const renderTimeGrid = () => {
    // 获取当前选中的所有班级信息（支持混合小组）
    const allClasses = groupStudents.length > 0 
      ? Array.from(new Set(groupStudents.map(s => s.major_class || s.class_name || '').filter(c => c)))
      : [];

    // 计算每个节次在整个学期中剩余可排的周数
    const calculateRemainingWeeks = (day: number, period: number): number => {
      const teacherIdSet = getCurrentTeacherIdSet();
      const effectiveTeacherName = (targetTeacher?.name || teacher?.name || '').trim();
      const studentIds = groupStudents.map((s: any) => s.id);
      const totalWeeks = 17; // 假设学期总周数为17周
      let blockedWeeks = 0;

      for (let week = 1; week <= totalWeeks; week++) {
        // 检查教师是否已排课（使用与页面一致的教师 ID 集合，避免工号/UUID 不一致导致误判为可排）
        if (teacherIdSet.size > 0) {
          const teacherSchedule = scheduledClasses.find(sc => {
            if (!isCurrentTeacherSchedule(sc, teacherIdSet)) return false;
            if (sc.day_of_week !== day || sc.period !== period) return false;
            if (sc.start_week !== undefined && sc.end_week !== undefined) {
              return week >= sc.start_week && week <= sc.end_week;
            }
            if (sc.week !== undefined) return sc.week === week;
            return week <= 16;
          });
          if (teacherSchedule) {
            blockedWeeks++;
            continue;
          }
        }

        // 检查教师是否有专业大课或理论课
        if (teacherIdSet.size > 0) {
          const teacherMajorClass = scheduledClasses.find(sc => {
            // 检查是否为专业大课或理论课
            const isMajorClass = (sc as any).teaching_type === '专业大课' || 
                                (sc as any).course_type === '专业大课' ||
                                (sc as any).teaching_type === '理论课' ||
                                (sc as any).course_type === '理论课' ||
                                sc.course_name?.includes('专业大课');
            if (!isMajorClass) return false;

            // 检查教师是否匹配（与 isCurrentTeacherSchedule 一致，支持工号/ID）
            if (!isCurrentTeacherSchedule(sc, teacherIdSet)) return false;

            // 检查时间是否匹配
            if (sc.day_of_week !== day || sc.period !== period) return false;

            // 检查周次是否匹配
            if (sc.start_week !== undefined && sc.end_week !== undefined) {
              return week >= sc.start_week && week <= sc.end_week;
            }
            if (sc.week !== undefined) return sc.week === week;
            return week <= 16;
          });
          if (teacherMajorClass) {
            blockedWeeks++;
            continue;
          }
        }

        // 检查班级 / 教师维度的专业大课禁排时间（支持混合小组，检查所有班级 + 当前教师）
        const allClassesBlockedTimes = unifiedBlockedTimes.filter((b: any) => {
          const blockedClassName = b.class_name;
          const classMatches =
            blockedClassName &&
            allClasses.some((className: string) => blockedClassName.includes(className));

          let teacherMatches = false;
          if (effectiveTeacherName && b.teacher_name) {
            const teacherNames = String(b.teacher_name)
              .split(/[,，、]/)
              .map((n: string) => n.trim())
              .filter(Boolean);
            teacherMatches = teacherNames.includes(effectiveTeacherName);
          }

          return classMatches || teacherMatches;
        });

        const blockedTimeEntry = allClassesBlockedTimes.find((blockedTime: any) => {
          const weeksArr = Array.isArray(blockedTime.weeks) ? blockedTime.weeks : [];
          if (weeksArr.length > 0 && !weeksArr.includes(week)) return false;
          const d = blockedTime.day_of_week !== undefined ? blockedTime.day_of_week : blockedTime.day;
          if (d !== day) return false;
          const periodsArr = blockedTime.periods || [];
          if (!periodsArr.includes(period)) return false;
          return true;
        });
        if (blockedTimeEntry) {
          blockedWeeks++;
          continue;
        }

        // 检查学生是否已被其他老师排课（跨教师，全局检查）
        if (studentIds.length > 0) {
          const allSchedules = allSchedulesCache.length > 0 ? allSchedulesCache : scheduledClasses;
          const studentConflict = allSchedules.find(sc => {
            if (!studentIds.includes(sc.student_id)) return false;
            if (sc.day_of_week !== day || sc.period !== period) return false;
            if (sc.start_week !== undefined && sc.end_week !== undefined) {
              return week >= sc.start_week && week <= sc.end_week;
            }
            if (sc.week !== undefined) return sc.week === week;
            return week <= 16;
          });
          if (studentConflict) {
            blockedWeeks++;
            continue;
          }
        }
      }

      return totalWeeks - blockedWeeks;
    };

    // 检查当前时段是否为禁排时段，返回禁排原因
    const checkIsSlotBlocked = (day: number, period: number): { blocked: boolean; reason?: string } => {
      const teacherIdSet = getCurrentTeacherIdSet();
      const effectiveTeacherName = (targetTeacher?.name || teacher?.name || '').trim();
      // 检查教师已经排定的时间（使用与页面一致的教师 ID 集合）
      if (teacherIdSet.size > 0) {
        const teacherSchedule = scheduledClasses.find(sc => {
          if (!isCurrentTeacherSchedule(sc, teacherIdSet)) return false;
          if (sc.day_of_week !== day || sc.period !== period) return false;
          if (sc.start_week !== undefined && sc.end_week !== undefined) {
            return selectedWeek >= sc.start_week && selectedWeek <= sc.end_week;
          }
          if (sc.week !== undefined) return sc.week === selectedWeek;
          if (selectedWeek > 16) return false;
          return true;
        });
        if (teacherSchedule) {
          return { blocked: true, reason: `教师已排课：${teacherSchedule.course_name || '课程'}` };
        }

        // 检查教师是否有专业大课或理论课
        const effectiveTeacherName = targetTeacher?.name || teacher?.name;
        const teacherMajorClass = scheduledClasses.find(sc => {
          const isMajorClass = (sc as any).teaching_type === '专业大课' || 
                              (sc as any).course_type === '专业大课' ||
                              (sc as any).teaching_type === '理论课' ||
                              (sc as any).course_type === '理论课' ||
                              sc.course_name?.includes('专业大课');
          if (!isMajorClass) return false;
          if (!isCurrentTeacherSchedule(sc, teacherIdSet)) return false;
          if (sc.day_of_week !== day || sc.period !== period) return false;
          if (sc.start_week !== undefined && sc.end_week !== undefined) {
            return selectedWeek >= sc.start_week && selectedWeek <= sc.end_week;
          }
          if (sc.week !== undefined) return sc.week === selectedWeek;
          return selectedWeek <= 16;
        });

        if (teacherMajorClass) {
          return { blocked: true, reason: `教师专业大课：${teacherMajorClass.course_name || '课程'}` };
        }
      }

        // 检查班级的专业大课禁排时间数据（支持混合小组，检查所有班级）
        const allClassesBlockedTimes = unifiedBlockedTimes.filter((b: any) => {
        const blockedClassName = b.class_name;
        const classMatches =
          blockedClassName &&
          allClasses.some((className: string) => blockedClassName.includes(className));

        let teacherMatches = false;
        if (effectiveTeacherName && b.teacher_name) {
          const teacherNames = String(b.teacher_name)
            .split(/[,，、]/)
            .map((n: string) => n.trim())
            .filter(Boolean);
          teacherMatches = teacherNames.includes(effectiveTeacherName);
        }

        return classMatches || teacherMatches;
      });

      const blockedTimeEntry = allClassesBlockedTimes.find((blockedTime: any) => {
        const weeksArr = Array.isArray(blockedTime.weeks) ? blockedTime.weeks : [];
        if (weeksArr.length > 0 && !weeksArr.includes(selectedWeek)) return false;
        const d = blockedTime.day_of_week !== undefined ? blockedTime.day_of_week : blockedTime.day;
        if (d !== day) return false;
        const periodsArr = blockedTime.periods || [];
        if (!periodsArr.includes(period)) return false;
        return true;
      });

      if (blockedTimeEntry) {
        // 如果是按教师维度匹配到的禁排，提示教师禁排时间；否则提示班级禁排
        let isTeacherBlocked = false;
        if (effectiveTeacherName && blockedTimeEntry.teacher_name) {
          const teacherNames = String(blockedTimeEntry.teacher_name)
            .split(/[,，、]/)
            .map((n: string) => n.trim())
            .filter(Boolean);
          isTeacherBlocked = teacherNames.includes(effectiveTeacherName);
        }

        return {
          blocked: true,
          reason: blockedTimeEntry.reason || (isTeacherBlocked ? '教师禁排时间' : '班级禁排时间')
        };
      }

      // 检查学生是否已经被其他老师排课（跨教师，全局检查）
      const studentIds = groupStudents.map((s: any) => s.id);
      if (studentIds.length > 0) {
        const allSchedules = allSchedulesCache.length > 0 ? allSchedulesCache : scheduledClasses;
        // 课程映射：同时支持 id 和 course_id，并合并缓存与当前 courses
        const coursesMapForTooltip = new Map<any, any>();
        [...allCoursesCache, ...courses].forEach(course => {
          coursesMapForTooltip.set(course.id, course);
          if ((course as any).course_id) {
            coursesMapForTooltip.set((course as any).course_id, course);
          }
        });

        const studentConflict = allSchedules.find(sc => {
          // 检查是否是当前小组的学生
          if (!studentIds.includes(sc.student_id)) {
            return false;
          }
          // 检查时间是否匹配
          if (sc.day_of_week !== day || sc.period !== period) {
            return false;
          }
          // 检查周次是否匹配
          if (sc.start_week !== undefined && sc.end_week !== undefined) {
            return selectedWeek >= sc.start_week && selectedWeek <= sc.end_week;
          }
          if (sc.week !== undefined) {
            return sc.week === selectedWeek;
          }
          if (selectedWeek > 16) {
            return false;
          }
          return true;
        });
        if (studentConflict) {
          // 获取冲突学生的姓名
          const conflictStudent = groupStudents.find((s: any) => s.id === studentConflict.student_id);
          const studentName = conflictStudent?.name || conflictStudent?.student_name || '未知学生';
          const courseInfo = coursesMapForTooltip.get(studentConflict.course_id);
          const courseName =
            courseInfo?.course_name ||
            studentConflict.course_name ||
            studentConflict.course_type ||
            '小组课';
          return { blocked: true, reason: `学生已排课：${studentName} - ${courseName}` };
        }
      }

      return { blocked: false };
    };
    
    return (
      <div className="bg-white rounded-lg p-4 mb-6 mt-0 rounded-t-none">
        <h3 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Clock className="w-5 h-5 text-purple-600" />
          时间网格 (第{selectedWeek}周)
        </h3>
        <div className="grid grid-cols-8 gap-4">
          {/* 节次时间列 */}
          <div className="space-y-2">
            <div className="text-center font-semibold text-gray-800 py-2 px-2 bg-gray-50 rounded-lg flex flex-col items-center justify-center min-h-[48px] border border-gray-200">
              <span>节次</span>
              <span className="text-xs text-gray-500 font-normal">时间段</span>
            </div>
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(period => {
                const periodInfo = PERIOD_CONFIG.find(p => p.period === period);
                return (
                  <div key={period} className="border border-gray-200 rounded-lg p-2 h-12 flex flex-col justify-center items-center bg-gray-50 transition-all duration-200">
                    <div className="text-xs font-medium text-gray-800">第{period}节</div>
                    <div className="text-xs text-gray-600">{periodInfo?.startTime}-{periodInfo?.endTime}</div>
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* 星期列 */}
          {WEEKDAYS.map((day) => (
            <div key={day.value} className="space-y-2">
              <div className="text-center font-semibold text-gray-800 py-2 px-2 bg-gray-50 rounded-lg flex flex-col items-center justify-center min-h-[48px] border border-gray-200">
                <span>{day.label}</span>
                <span className="text-xs text-gray-500 font-normal">{getDayDate(selectedWeek, day.value)}</span>
              </div>
              <div className="space-y-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(period => {
                  const isSelected = selectedTimeSlots.some(
                    slot => slot.week === selectedWeek && slot.day === day.value && slot.period === period
                  );
                  const blockCheck = checkIsSlotBlocked(day.value, period);
                  const isBlocked = blockCheck.blocked;
                  const blockReason = blockCheck.reason;
                  // 检查是否为通适大课禁排（传入所有班级）
                  const isLargeClassBlock = isBlockedByLargeClass(selectedWeek, day.value, period, allClasses);
                  // 检查是否为教师专业大课
                  const effectiveTeacherIdForGrid = targetTeacher?.id || teacher?.id;
                  const effectiveTeacherNameForGrid = targetTeacher?.name || teacher?.name;
                  const isTeacherMajorClassBlock = isBlockedByTeacherMajorClass(selectedWeek, day.value, period, effectiveTeacherIdForGrid, effectiveTeacherNameForGrid);

                  // 获取教师专业大课的课程名称
                  let teacherMajorClassName = '';
                  if (isTeacherMajorClassBlock) {
                    const teacherMajorClass = scheduledClasses.find(sc => {
                      // 检查是否为专业大课或理论课
                      const isMajorClass = (sc as any).teaching_type === '专业大课' || 
                                          (sc as any).course_type === '专业大课' ||
                                          (sc as any).teaching_type === '理论课' ||
                                          (sc as any).course_type === '理论课' ||
                                          sc.course_name?.includes('专业大课');
                      if (!isMajorClass) return false;

                      // 检查教师是否匹配（支持部分匹配，用于处理"合上"课程）
                      let teacherMatches = false;
                      if (effectiveTeacherIdForGrid && sc.teacher_id === effectiveTeacherIdForGrid) {
                        teacherMatches = true;
                      } else if (effectiveTeacherNameForGrid && sc.teacher_name) {
                        if (sc.teacher_name === effectiveTeacherNameForGrid) {
                          teacherMatches = true;
                        } else {
                          const scheduleTeachers = sc.teacher_name.split(/[,，、]/).map((t: string) => t.trim());
                          teacherMatches = scheduleTeachers.includes(effectiveTeacherNameForGrid);
                        }
                      }
                      if (!teacherMatches) return false;

                      // 检查时间是否匹配
                      if (sc.day_of_week !== day.value || sc.period !== period) return false;

                      // 检查周次是否匹配
                      if (sc.start_week !== undefined && sc.end_week !== undefined) {
                        return selectedWeek >= sc.start_week && selectedWeek <= sc.end_week;
                      }
                      if (sc.week !== undefined) {
                        return sc.week === selectedWeek;
                      }
                      return selectedWeek <= 16;
                    });
                    teacherMajorClassName = teacherMajorClass?.course_name || '专业大课';
                  }

                  let className = '';
                  let displayStatus = '';
                  // 批量选择模式下，即使当前周次被禁排也允许点击，因为批量选择会遍历所有周次
                  let isClickable = selectionMode === 'batch' ? true : !isBlocked && !isLargeClassBlock && !isTeacherMajorClassBlock;

                  // 计算剩余可排周数
                  const remainingWeeks = calculateRemainingWeeks(day.value, period);
                  
                  if (isSelected) {
                    className = 'bg-blue-500 text-white shadow-md';
                    displayStatus = '已选';
                  } else if (remainingWeeks === 0) {
                    // 所有周次都没有空闲节次
                    className = 'bg-gray-100 text-gray-500 cursor-not-allowed';
                    displayStatus = '已满';
                  } else if (isTeacherMajorClassBlock) {
                    // 教师专业大课 - 紫色样式，显示剩余可排周数
                    className = 'bg-purple-100 text-purple-700 cursor-not-allowed';
                    displayStatus = `剩${remainingWeeks}周`;
                  } else if (isLargeClassBlock) {
                    // 通适大课禁排 - 蓝色样式，但显示剩余可排周数
                    className = 'bg-blue-100 text-blue-700 cursor-not-allowed';
                    displayStatus = `剩${remainingWeeks}周`;
                  } else if (isBlocked) {
                    // 其他禁排 - 红色样式，但显示剩余可排周数
                    className = 'bg-red-100 text-red-700 cursor-not-allowed';
                    displayStatus = `剩${remainingWeeks}周`;
                  } else {
                    className = 'bg-green-50 text-green-700 hover:bg-green-100';
                    displayStatus = `剩${remainingWeeks}周`;
                  }

                  // 构建悬停提示文本
                  let titleText = `${day.label} 第${period}节`;
                  if (isTeacherMajorClassBlock) {
                    titleText += `（教师专业大课：${teacherMajorClassName}）`;
                  } else if (blockReason) {
                    titleText += `（${blockReason}）`;
                  } else if (isLargeClassBlock) {
                    titleText += '（通适大课）';
                  }
                  // 无论是否被禁排，都显示剩余可排周数
                  if (!isSelected) {
                    titleText += `（剩余${remainingWeeks}周可排）`;
                  }

                  return (
                    <div
                      key={`${day.value}-${period}`}
                      className={`border border-gray-200 rounded-lg p-2 cursor-pointer transition-all duration-200 ${className} hover:scale-[1.02] h-12 flex flex-col justify-center items-center`}
                      onClick={() => isClickable && handleTimeSlotClick(day.value, period)}
                      onMouseDown={() => isClickable && handleMouseDown(day.value, period)}
                      onMouseEnter={() => isClickable && handleMouseEnter(day.value, period)}
                      onMouseUp={handleMouseUp}
                      title={titleText}
                    >
                      <div className="text-xs font-medium">第{period}节</div>
                      <div className="text-xs">
                        {displayStatus}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 渲染右侧面板
  const renderRightPanel = () => {
    return (
      <div className="space-y-4">
        {/* 操作按钮 */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">操作</h3>
          <div className="space-y-3">
            <button
              onClick={handleClearSelection}
              disabled={selectedTimeSlots.length === 0}
              className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              清空选择
            </button>
          </div>
        </div>

        {/* 选择模式 */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">选择模式</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectionMode('single')}>
              <input
                type="radio"
                name="selectionMode"
                value="single"
                checked={selectionMode === 'single'}
                onChange={() => setSelectionMode('single')}
                className="text-purple-600 focus:ring-purple-500 w-4 h-4"
              />
              <span className="text-sm font-medium">单点选择</span>
            </div>
            <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectionMode('batch')}>
              <input
                type="radio"
                name="selectionMode"
                value="batch"
                checked={selectionMode === 'batch'}
                onChange={() => setSelectionMode('batch')}
                className="text-purple-600 focus:ring-purple-500 w-4 h-4"
              />
              <span className="text-sm font-medium">批量选择</span>
            </div>
          </div>
        </div>
        
        {/* 教室选择 */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">教室选择</h3>
          <div className="space-y-3">
            <select
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-purple-500 focus:border-purple-500"
            >
              <option value="">自动选择（根据课程类型）</option>
              {fixedRooms.map((fr, index) => (
                <option key={index} value={fr.room?.id || ''}>
                  {fr.room?.room_name || '未设置'} ({fr.facultyCode === 'PIANO' ? '钢琴琴房' : fr.facultyCode === 'VOCAL' ? '声乐琴房' : '器乐琴房'})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              提示：选择"自动选择"时，系统会根据课程类型自动匹配对应教室
            </p>
          </div>
        </div>

        {/* 已选时间槽 */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center justify-between">
            <span>已选时间</span>
            <span className="inline-flex items-center justify-center px-3 py-0.5 rounded-full text-xs font-extrabold bg-blue-600 text-white shadow">
              {selectedTimeSlots.length} 节
            </span>
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {(() => {
              // 合并相连的周次
              const groupedSlots = selectedTimeSlots.reduce((groups, slot) => {
                const key = `${slot.day}-${slot.period}`;
                if (!groups[key]) {
                  groups[key] = [];
                }
                groups[key].push(slot.week);
                return groups;
              }, {} as Record<string, number[]>);
              
              // 合并周次范围
              const mergedSlots = Object.entries(groupedSlots).map(([key, weeks]) => {
                const [day, period] = key.split('-').map(Number);
                // 排序周次
                const sortedWeeks = weeks.sort((a, b) => a - b);
                // 合并连续周次
                const ranges = [];
                let start = sortedWeeks[0];
                
                for (let i = 1; i <= sortedWeeks.length; i++) {
                  if (i === sortedWeeks.length || sortedWeeks[i] > sortedWeeks[i - 1] + 1) {
                    ranges.push(start === sortedWeeks[i - 1] ? `${start}` : `${start}-${sortedWeeks[i - 1]}`);
                    start = sortedWeeks[i];
                  }
                }
                
                return {
                  day,
                  period,
                  weekRanges: ranges
                };
              });
              
              // 按星期和节次排序
              mergedSlots.sort((a, b) => {
                if (a.day !== b.day) return a.day - b.day;
                return a.period - b.period;
              });
              
              return mergedSlots.map((slot, index) => (
                <div key={index} className="text-xs bg-gray-50 p-2 rounded">
                  {slot.weekRanges.join('、')}周 {WEEKDAYS.find(d => d.value === slot.day)?.label} 第{slot.period}节
                </div>
              ));
            })()}
            {selectedTimeSlots.length === 0 && (
              <div className="text-xs text-gray-500 text-center py-2">
                未选择时间
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // 小组课列表展示用过滤：不显示教师排课时生成的乱码课程编号（MINOR_ 开头）、不显示课程类型为「专业小课」的课程
  const filterValidGroupCoursesForDisplay = (list: any[]): any[] => {
    if (!Array.isArray(list)) return [];
    return list.filter((c: any) => {
      const courseId = (c.course_id ?? c.id ?? '').toString().trim();
      const courseType = (c.course_type ?? '').toString().trim();
      if (courseId.startsWith('MINOR_')) return false;
      if (courseType === '专业小课') return false;
      return true;
    });
  };

  // 根据小组中学生的班级过滤小组课数据
  const filterGroupCoursesByStudentClasses = async (students: Student[], specificTeacher?: any) => {
    if (students.length === 0) {
      // 如果小组为空，重新加载所有小组课数据
      await loadGroupCoursesData();
      return;
    }

    // 获取小组中学生的所有班级
    const studentClasses = new Set(students.map(s => s.major_class).filter(Boolean));

    // 小组班级类型：同年级下区分专升本 / 普通班，避免误用对方课程
    const allUpgrade = students.every(s => getStudentClassType(s) === 'upgrade');
    const allGeneral = students.every(s => getStudentClassType(s) === 'general');

    // 提取班级“关键码”（例如：音乐学2303 / 2303 → 2303），用于更严格的班级匹配
    const getClassKey = (className: string | undefined | null): string => {
      if (!className) return '';
      const digits = className.replace(/[^\d]/g, '');
      if (!digits) return '';
      // 只取后4位作为班级关键码，兼容“音乐学2303”“2303”这两种格式
      return digits.length > 4 ? digits.slice(-4) : digits;
    };
    const studentClassKeys = new Set(
      Array.from(studentClasses)
        .map(getClassKey)
        .filter(Boolean)
    );

    // 分析小组中学生的主要专业类型
    const majorTypeCount: {[key: string]: number} = {
      '钢琴': 0,
      '声乐': 0,
      '器乐': 0
    };
    
    students.forEach(student => {
      const courseType = student.__courseType;
      if (courseType === '钢琴') {
        majorTypeCount['钢琴']++;
      } else if (courseType === '声乐') {
        majorTypeCount['声乐']++;
      } else {
        // 其他专业类型都归为器乐
        majorTypeCount['器乐']++;
      }
    });
    
    // 找出数量最多的专业类型
    let maxCount = 0;
    let dominantType: '钢琴' | '声乐' | '器乐' = '器乐';
    
    Object.entries(majorTypeCount).forEach(([type, count]) => {
      if (count > maxCount) {
        maxCount = count;
        dominantType = type as '钢琴' | '声乐' | '器乐';
      }
    });

    try {
      // 获取所有课程数据，确保使用最新的课程数据
      const allCourses = await courseService.getAll();

      // 使用指定的教师或当前教师
      const effectiveTeacher = specificTeacher || targetTeacher || teacher;
      const isAdminTeacher =
        effectiveTeacher?.teacher_id === '110' ||
        effectiveTeacher?.faculty_id === 'ADMIN';

      // 重新过滤小组课数据
      const filteredGroupCourses = allCourses
        .filter(course => {
          // 只保留授课类型为小组课的课程
          const isGroupCourse = (course as any).teaching_type === '小组课';
          if (!isGroupCourse) return false;

          // 根据教师的教研室过滤课程（管理员不按教研室过滤）
          const effectiveTeacherId = effectiveTeacher?.id;
          if (!isAdminTeacher && effectiveTeacherId) {
            if (isCourseAssignedToTeacher(course, effectiveTeacher)) {
              // 课程已分配给当前教师，跳过教研室过滤
            } else {
            const teacherFacultyId = effectiveTeacher?.faculty_id;
            if (teacherFacultyId) {
              // 检查课程的教研室是否与教师的教研室匹配
              // 课程的教研室信息可能存储在不同字段中
              const courseFacultyId = (course as any).faculty_id || course.faculty_id;
              const courseType = (course as any).course_type || course.course_type;

              // 检查是否是林琳教师（特殊情况：她既带钢琴又带器乐课程）
              const teacherNumber = effectiveTeacher?.teacher_id;
              const isLinLinTeacher = teacherNumber === '120170194';

              // 如果课程有明确的faculty_id字段，直接匹配
              if (courseFacultyId) {
                if (courseFacultyId !== teacherFacultyId) {
                  // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                  if (!isLinLinTeacher || courseType !== '钢琴') {
                    return false;
                  }
                }
              }
              // 否则根据课程类型推断教研室
              else if (courseType) {
                // 使用INSTRUMENT_TO_FACULTY映射将课程类型转换为教研室代码
                const courseFacultyCode = INSTRUMENT_TO_FACULTY[courseType] || '';
                if (courseFacultyCode !== teacherFacultyId) {
                  // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                  if (!isLinLinTeacher || courseType !== '钢琴') {
                    return false;
                  }
                }
              }
            }
            }
          }
          
          // 根据小组主要专业类型过滤课程
          const courseType = (course as any).course_type || course.course_type;
          if (courseType) {
            if (dominantType === '钢琴' && courseType !== '钢琴') {
              return false;
            } else if (dominantType === '声乐' && courseType !== '声乐') {
              return false;
            } else if (dominantType === '器乐' && courseType !== '器乐') {
              return false;
            }
          }

          // 按班级类型过滤：专升本与普通班23级课程不同，需严格区分
          // 2304=专升本 → 器乐2、钢琴2、声乐2；2301/2302/2303=普通班23级 → 中国器乐6、钢琴6、声乐6
          const courseNameStr = ((course as any).course_name || course.course_name || '').toString();
          const isClass2301_2303 = ['2301','2302','2303'].some(k => studentClassKeys.has(k));

          if (allUpgrade) {
            // 专升本：排除普通班23级课程（中国器乐6、钢琴6、声乐6）
            if (/中国器乐6|钢琴6|声乐6/.test(courseNameStr)) return false;
          } else if (allGeneral) {
            if (courseNameStr.includes('专升本')) return false;
            // 普通班23级（2301/2302/2303）：排除专升本课程（器乐2、钢琴2、声乐2，含器乐2*等格式）
            if (isClass2301_2303 && /^器乐2(\*|$|-)|^钢琴2(\*|$|-)|^声乐2(\*|$|-)/.test(courseNameStr)) return false;
          } else {
            if (courseNameStr.includes('专升本')) return false;
          }
          
          // 根据小组中学生的班级过滤课程
          const courseClass = (course as any).class_name || (course as any).major_class || '';
          const courseKey = getClassKey(courseClass);

          // 优先使用“严格班级匹配”：课程班级关键码必须命中小组学生的班级关键码集合
          if (studentClassKeys.size > 0) {
            if (!courseKey || !studentClassKeys.has(courseKey)) {
              return false;
            }
          }

          // 如果课程没有班级信息，则在有严格班级要求时不匹配；否则视为可选
          if (!courseClass) {
            return studentClassKeys.size === 0;
          }

          return true;
        })
        // 排除任课教师为空的“不完整”课程；按 (课程编号, 班级) 去重，只保留一条
        .filter((c: any) => ((c.teacher_name || c.teacher_id || '').toString().trim()) !== '')
        .reduce((map: Map<string, any>, course: any) => {
          const key = `${(course.course_id || course.id || '').toString().trim()}_${(course.major_class || (course as any).class_name || '').toString().trim()}`;
          const existing = map.get(key);
          if (!existing) {
            map.set(key, course);
            return map;
          }
          const existingHasTeacher = !!((existing.teacher_name || existing.teacher_id || '').toString().trim());
          const currentHasTeacher = !!((course.teacher_name || course.teacher_id || '').toString().trim());
          if (currentHasTeacher && !existingHasTeacher) map.set(key, course);
          return map;
        }, new Map())
        .values();
    
    const result = Array.from(filteredGroupCourses);

    // 如果过滤后没有课程，尝试更宽松的过滤
    if (result.length === 0) {
      const relaxedMap = allCourses
          .filter(course => {
          // 只保留授课类型为小组课的课程
          const isGroupCourse = (course as any).teaching_type === '小组课';
          if (!isGroupCourse) return false;

          // 根据教师的教研室过滤课程（管理员不按教研室过滤）
          const effectiveTeacherId = effectiveTeacher?.id;
          if (!isAdminTeacher && effectiveTeacherId) {
            // 获取教师的教研室代码
            const teacherFacultyId = effectiveTeacher?.faculty_id;
            if (teacherFacultyId) {
              // 检查课程的教研室是否与教师的教研室匹配
              const courseFacultyId = (course as any).faculty_id || course.faculty_id;
              const courseType = (course as any).course_type || course.course_type;

              // 检查是否是林琳教师（特殊情况：她既带钢琴又带器乐课程）
              const teacherNumber = effectiveTeacher?.teacher_id;
              const isLinLinTeacher = teacherNumber === '120170194';

              // 如果课程有明确的faculty_id字段，直接匹配
              if (courseFacultyId) {
                if (courseFacultyId !== teacherFacultyId) {
                  // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                  if (!isLinLinTeacher || courseType !== '钢琴') {
                    return false;
                  }
                }
              }
              // 否则根据课程类型推断教研室
              else if (courseType) {
                // 使用INSTRUMENT_TO_FACULTY映射将课程类型转换为教研室代码
                const courseFacultyCode = INSTRUMENT_TO_FACULTY[courseType] || '';
                if (courseFacultyCode !== teacherFacultyId) {
                  // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                  if (!isLinLinTeacher || courseType !== '钢琴') {
                    return false;
                  }
                }
              }
            }
          }
          
          // 根据小组主要专业类型过滤课程
          const courseType = (course as any).course_type || course.course_type;
          if (courseType) {
            if (dominantType === '钢琴' && courseType !== '钢琴') {
              return false;
            } else if (dominantType === '声乐' && courseType !== '声乐') {
              return false;
            } else if (dominantType === '器乐' && courseType !== '器乐') {
              return false;
            }
          }

          // 按班级类型过滤（宽松分支同样遵守）
          const courseNameStrRelaxed = ((course as any).course_name || course.course_name || '').toString();
          const isClass2301_2303Relaxed = ['2301','2302','2303'].some(k => studentClassKeys.has(k));
          if (allUpgrade) {
            if (/中国器乐6|钢琴6|声乐6/.test(courseNameStrRelaxed)) return false;
          } else if (allGeneral) {
            if (courseNameStrRelaxed.includes('专升本')) return false;
            if (isClass2301_2303Relaxed && /^器乐2(\*|$|-)|^钢琴2(\*|$|-)|^声乐2(\*|$|-)/.test(courseNameStrRelaxed)) return false;
          } else {
            if (courseNameStrRelaxed.includes('专升本')) return false;
          }
          
          // 不按班级过滤，只按专业类型过滤
          return true;
        })
        // 排除任课教师为空的“不完整”课程；按 (课程编号, 班级) 去重
        .filter((c: any) => ((c.teacher_name || c.teacher_id || '').toString().trim()) !== '')
        .reduce((map: Map<string, any>, course: any) => {
          const key = `${(course.course_id || course.id || '').toString().trim()}_${(course.major_class || (course as any).class_name || '').toString().trim()}`;
          const existing = map.get(key);
          if (!existing) {
            map.set(key, course);
            return map;
          }
          const existingHasTeacher = !!((existing.teacher_name || existing.teacher_id || '').toString().trim());
          const currentHasTeacher = !!((course.teacher_name || course.teacher_id || '').toString().trim());
          if (currentHasTeacher && !existingHasTeacher) map.set(key, course);
          return map;
        }, new Map());
      
      const relaxedFilteredCourses = Array.from(relaxedMap.values());
      const relaxedDisplay = filterValidGroupCoursesForDisplay(relaxedFilteredCourses);
      setGroupCourses(relaxedDisplay);

      // 若当前选中课程不在新列表中，清空并自动选第一门（避免2304误用中国器乐6等）
      const isSelectedInList = relaxedDisplay.some((c: any) =>
        (String(c.course_id || c.id) === String(selectedCourseId)) &&
        (String(c.class_name || c.major_class || '') === String(selectedCourseClassId || ''))
      );
      if (!isSelectedInList && relaxedDisplay.length > 0) {
        const firstCourse: any = relaxedDisplay[0];
        setSelectedCourseName(firstCourse.course_name || '');
        setSelectedCourseId(firstCourse.course_id || firstCourse.id || '');
        setSelectedCourseClassId(firstCourse.class_name || firstCourse.major_class || '');
      } else if (!isSelectedInList) {
        setSelectedCourseName('');
        setSelectedCourseId('');
        setSelectedCourseClassId('');
      }
      } else {
      const resultDisplay = filterValidGroupCoursesForDisplay(result);
      setGroupCourses(resultDisplay);

      // 若当前选中课程不在新列表中，清空并自动选第一门
      const isSelectedInList = resultDisplay.some((c: any) =>
        (String(c.course_id || c.id) === String(selectedCourseId)) &&
        (String(c.class_name || c.major_class || '') === String(selectedCourseClassId || ''))
      );
      if (!isSelectedInList && resultDisplay.length > 0) {
        const firstCourse: any = resultDisplay[0];
        setSelectedCourseName(firstCourse.course_name || '');
        setSelectedCourseId(firstCourse.course_id || firstCourse.id || '');
        setSelectedCourseClassId(firstCourse.class_name || firstCourse.major_class || '');
      } else if (!isSelectedInList) {
        setSelectedCourseName('');
        setSelectedCourseId('');
        setSelectedCourseClassId('');
      }
      }
    } catch (error) {
      console.error('过滤课程失败:', error);
      // 如果过滤失败，尝试加载所有小组课数据
      await loadGroupCoursesData();
    }
  };

  // 加载小组课数据
  const loadGroupCoursesData = async () => {
    try {
      // 如果小组不为空，使用与filterGroupCoursesByStudentClasses相同的逻辑过滤课程
      if (groupStudents.length > 0) {
        await filterGroupCoursesByStudentClasses(groupStudents);
        return;
      }

      // 小组为空时，加载所有小组课数据
      const coursesData = await courseService.getAll();

      const effectiveTeacherForCourses = targetTeacher || teacher;
      const effectiveTeacherIdForCourses = effectiveTeacherForCourses?.id;
      const isAdminTeacherForCourses =
        effectiveTeacherForCourses?.teacher_id === '110' ||
        effectiveTeacherForCourses?.faculty_id === 'ADMIN';

      // 筛选小组课数据
      const groupCoursesData = Array.from(
        coursesData
          .filter(course => {
            // 只保留授课类型为小组课的课程
            const isGroupCourse = (course as any).teaching_type === '小组课';

            // 根据教师的教研室过滤课程（管理员不按教研室过滤）
            if (!isAdminTeacherForCourses && effectiveTeacherIdForCourses) {
              if (isCourseAssignedToTeacher(course, effectiveTeacherForCourses)) {
                // 课程已分配给当前教师，跳过教研室过滤
              } else {
              const teacherFacultyId = effectiveTeacherForCourses?.faculty_id;
              if (teacherFacultyId) {
                // 检查课程的教研室是否与教师的教研室匹配
                // 课程的教研室信息可能存储在不同字段中
                const courseFacultyId = (course as any).faculty_id || course.faculty_id;
                const courseType = (course as any).course_type || course.course_type;
                
                // 检查是否是林琳教师（特殊情况：她既带钢琴又带器乐课程）
                const teacherNumber = targetTeacher?.id || teacher?.id;
                const isLinLinTeacher = teacherNumber === '120170194';
                
                // 如果课程有明确的faculty_id字段，直接匹配
                if (courseFacultyId) {
                  if (!isGroupCourse || courseFacultyId !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
                // 否则根据课程类型推断教研室
                else if (courseType) {
                  // 使用INSTRUMENT_TO_FACULTY映射将课程类型转换为教研室代码
                  const courseFacultyCode = INSTRUMENT_TO_FACULTY[courseType] || '';
                  if (!isGroupCourse || courseFacultyCode !== teacherFacultyId) {
                    // 特殊处理：如果是林琳教师，允许她看到钢琴课程
                    if (!isLinLinTeacher || courseType !== '钢琴') {
                      return false;
                    }
                  }
                }
                // 如果没有教研室信息，至少要是小组课
                else if (!isGroupCourse) {
                  return false;
                }
              }
              // 如果没有教师教研室信息，至少要是小组课
              else if (!isGroupCourse) {
                return false;
              }
              }
            }
            // 如果没有教师信息，至少要是小组课
            else if (!isGroupCourse) {
              return false;
            }
            
            return true;
          })
          // 排除任课教师为空的“不完整”课程（本系统课程均为固定数据，排课不生成新课程）
          .filter((c: any) => ((c.teacher_name || c.teacher_id || '').toString().trim()) !== '')
          // 按 (课程编号, 班级) 去重，同一课程只保留一条，避免重复显示
          .reduce((map: Map<string, any>, course: any) => {
            const key = `${(course.course_id || course.id || '').toString().trim()}_${(course.major_class || (course as any).class_name || '').toString().trim()}`;
            const existing = map.get(key);
            if (!existing) {
              map.set(key, course);
              return map;
            }
            const existingHasTeacher = !!((existing.teacher_name || existing.teacher_id || '').toString().trim());
            const currentHasTeacher = !!((course.teacher_name || course.teacher_id || '').toString().trim());
            if (currentHasTeacher && !existingHasTeacher) map.set(key, course);
            return map;
          }, new Map())
          .values()
      );
      setGroupCourses(filterValidGroupCoursesForDisplay(groupCoursesData || []));
    } catch (error) {
      console.error('加载小组课数据失败:', error);
    }
  };

  // 工具函数：提取年级
  const extractGradeFromClassId = (classId: string): string => {
    if (!classId || typeof classId !== 'string') {
      return '未知';
    }
    
    // 尝试从班级ID中提取年份
    // 格式1: 25音本1班 (前两位是年份)
    if (classId.length >= 2) {
      const yearCode = classId.slice(0, 2);
      const year = parseInt(yearCode);
      
      if (!isNaN(year) && year >= 0 && year <= 99) {
        const fullYear = `20${year.toString().padStart(2, '0')}`;
        const yearNum = parseInt(fullYear);
        if (!isNaN(yearNum) && yearNum >= 2020 && yearNum <= 2030) {
          return `${fullYear}级`;
        }
      }
    }
    
    // 格式2: 2025音本1班 (前四位是完整年份)
    if (classId.length >= 4) {
      const fullYearCode = classId.slice(0, 4);
      const yearNum = parseInt(fullYearCode);
      if (!isNaN(yearNum) && yearNum >= 2020 && yearNum <= 2030) {
        return `${fullYearCode}级`;
      }
    }
    
    // 尝试从班级名称中提取年份
    const yearMatch = classId.match(/(20[2-3]\d|2[0-9])/);
    if (yearMatch) {
      const yearStr = yearMatch[0];
      if (yearStr.length === 2) {
        const fullYear = `20${yearStr}`;
        const yearNum = parseInt(fullYear);
        if (!isNaN(yearNum) && yearNum >= 2020 && yearNum <= 2030) {
          return `${fullYear}级`;
        }
      } else if (yearStr.length === 4) {
        const yearNum = parseInt(yearStr);
        if (!isNaN(yearNum) && yearNum >= 2020 && yearNum <= 2030) {
          return `${yearStr}级`;
        }
      }
    }
    
    return '未知';
  };

  // 工具函数：获取学生的班级类型（专升本班编号以04结尾，如2304、2404）
  const getStudentClassType = (student: Student): 'general' | 'upgrade' => {
    if (student.student_type === 'upgrade') return 'upgrade';
    const mc = (student.major_class || '').toString();
    const digits = mc.replace(/[^\d]/g, '');
    const classKey = digits.length > 4 ? digits.slice(-4) : digits;
    if (classKey.endsWith('04') && classKey.length === 4) return 'upgrade'; // 2304、2404 等
    return student.student_type || 'general';
  };

  // 工具函数：获取班级类型显示名称
  const getClassTypeLabel = (type: string): string => {
    switch (type) {
      case 'general': return '普通班';
      case 'upgrade': return '专升本';
      case 'all': return '全部';
      default: return type;
    }
  };

  // 工具函数：获取班级类型对应的学生
  const getStudentsByClassType = (students: Student[], classType: string): Student[] => {
    if (classType === 'all') return students;
    return students.filter(student => getStudentClassType(student) === classType);
  };

  // 小组课时管理函数
  const getGroupKey = (students: Student[], courseType: string): string => {
    const studentIds = students.map(s => s.id).sort().join(',');
    return `${courseType}_${studentIds}`;
  };

  // 计算小组课时进度
  const calculateGroupProgress = (students: Student[], courseName: string): {
    completedHours: number;
    remainingHours: number;
    progress: number;
    totalHours: number;
  } => {
    const totalHours = 16; // 固定16课时
    const studentProgresses = students.map(student => {
      // 尝试获取学生的专业类型
      const courseType = (student as any).__courseType;
      return studentProgress[student.id]?.[courseType];
    });
    
    // 取所有学生的最小进度（确保小组进度一致）
    const minProgress = Math.min(...studentProgresses.map(p => p?.completed || 0));
    const completedHours = Math.min(minProgress, totalHours);
    const remainingHours = Math.max(0, totalHours - completedHours);
    const progress = (completedHours / totalHours) * 100;

    return {
      completedHours: Math.round(completedHours * 100) / 100,
      remainingHours: Math.round(remainingHours * 100) / 100,
      progress: Math.round(progress * 100) / 100,
      totalHours
    };
  };

  // 更新小组进度
  const updateGroupProgress = () => {
    if (!selectedCourseName || groupStudents.length === 0) {
      setGroupProgress({});
      return;
    }

    const groupKey = getGroupKey(groupStudents, selectedCourseType);
    const progress = calculateGroupProgress(groupStudents, selectedCourseName);
    
    setGroupProgress(prev => ({
      ...prev,
      [groupKey]: progress
    }));
  };

  // 获取小组进度状态颜色
  const getGroupProgressColor = (progress: number): string => {
    if (progress >= 80) return 'text-green-600 bg-green-50';
    if (progress >= 50) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  // 获取小组进度状态图标
  const getGroupProgressIcon = (progress: number): string => {
    if (progress >= 80) return '✅';
    if (progress >= 50) return '🟡';
    return '🔴';
  };

  // 验证当前小组的有效性
  const validateCurrentGroup = (): { isValid: boolean; message: string } => {
    if (groupStudents.length === 0) {
      return { isValid: false, message: '小组为空，请先选择学生' };
    }

    if (groupStudents.length > 8) {
      return { isValid: false, message: '小组人数不能超过8人' };
    }

    // 检查班级类型混合（普通班和专升本不能混合编组）
    const hasGeneral = groupStudents.some(s => getStudentClassType(s) === 'general');
    const hasUpgrade = groupStudents.some(s => getStudentClassType(s) === 'upgrade');
    
    if (hasGeneral && hasUpgrade) {
      return { 
        isValid: false, 
        message: '普通班和专升本不能混合编组' 
      };
    }

    // 检查年级混合（不同年级不能混合编组）
    const grades = new Set();
    groupStudents.forEach(student => {
      if (student.major_class) {
        // 从班级格式中提取年级，例如从"音乐2303"提取"23"
        const gradeMatch = student.major_class.match(/\d{2}/);
        if (gradeMatch) {
          const grade = gradeMatch[0];
          grades.add(grade);
        }
      }
    });
    
    if (grades.size > 1) {
      return { 
        isValid: false, 
        message: '不同年级不能混合编组' 
      };
    }

    // 检查专业混合（不同专业不能混合编组；葫芦丝与竹笛允许混排）
    const majors = new Set<string>();
    groupStudents.forEach(student => {
      const major = student.__courseType;
      if (major) {
        majors.add(getMajorGroupKey(major));
      }
    });
    
    if (majors.size > 1) {
      return { 
        isValid: false, 
        message: '不同专业不能混合编组' 
      };
    }

    // 检查普通班主项人数限制
    if (hasGeneral) {
      const generalStudents = groupStudents.filter(s => getStudentClassType(s) === 'general');
      // 直接使用小组信息中显示的主项学生和副项学生人数计算方式
      const mainCourseStudents = generalStudents.filter(s => studentSources.get(s.id) === 'primary');
      const secondaryStudents = generalStudents.filter(s => studentSources.get(s.id) === 'secondary');
      
      // 普通班规则：
      // 1. 最多2个主项+0个副项
      // 2. 最多1个主项+2个副项
      // 3. 最多0个主项+4个副项
      if (mainCourseStudents.length > 2) {
        return { 
          isValid: false, 
          message: '普通班主项最多2人' 
        };
      }
      
      if (mainCourseStudents.length === 2 && secondaryStudents.length > 0) {
        return { 
          isValid: false, 
          message: '普通班2个主项时不能有副项' 
        };
      }
      
      if (mainCourseStudents.length === 1 && secondaryStudents.length > 2) {
        return { 
          isValid: false, 
          message: '普通班1个主项时最多2个副项' 
        };
      }
      
      if (mainCourseStudents.length === 0) {
        // 检查是否为大组乐器（使用统一常量 LARGE_GROUP_INSTRUMENTS）
        let isLargeGroupCourse = false;
        
        for (const student of generalStudents) {
          if (student.secondary_instruments) {
            for (const instrument of student.secondary_instruments) {
              if (LARGE_GROUP_INSTRUMENTS.includes(instrument)) {
                isLargeGroupCourse = true;
                break;
              }
            }
            if (isLargeGroupCourse) break;
          }
        }
        
        if (isLargeGroupCourse) {
          // 竹笛、古筝、葫芦丝：普通班全部副项时最多8人
          if (secondaryStudents.length > 8) {
            return { 
              isValid: false, 
              message: '普通班全部副项时（竹笛、古筝、葫芦丝）最多8人' 
            };
          }
        } else {
          // 其他专业：普通班全部副项时最多4人
          if (secondaryStudents.length > 4) {
            return { 
              isValid: false, 
              message: '普通班全部副项时最多4人' 
            };
          }
        }
      }
    }

    // 检查专升本副项人数限制
    if (hasUpgrade) {
      const upgradeStudents = groupStudents.filter(s => getStudentClassType(s) === 'upgrade');

      // 古筝 / 竹笛 / 葫芦丝 副项单独放宽到 3 人，其它乐器副项最多 2 人
      const largeGroupInstruments = ['古筝', '竹笛', '葫芦丝'];
      const largeGroupSecondary = upgradeStudents.filter(s =>
        Array.isArray(s.secondary_instruments) &&
        s.secondary_instruments.some((ins: string) => largeGroupInstruments.includes(ins))
      );
      const otherSecondary = upgradeStudents.filter(s =>
        Array.isArray(s.secondary_instruments) &&
        s.secondary_instruments.length > 0 &&
        !s.secondary_instruments.some((ins: string) => largeGroupInstruments.includes(ins))
      );

      if (largeGroupSecondary.length > 3) {
        return {
          isValid: false,
          message: '专升本古筝/竹笛/葫芦丝最多3个副项'
        };
      }

      if (otherSecondary.length > 2) {
        return {
          isValid: false,
          message: '专升本其它副项最多2个学生'
        };
      }
    }

    // 检查是否所有学生都有剩余课时
    if (selectedCourseName && studentProgress) {
      const studentsWithoutRemainingHours = groupStudents.filter(student => {
        const courseType = student.__courseType;
        return !studentProgress[student.id] || !studentProgress[student.id][courseType] || studentProgress[student.id][courseType].remaining === 0;
      });

      if (studentsWithoutRemainingHours.length > 0) {
        return { 
          isValid: false, 
          message: `以下学生的${selectedCourseName}课时已排满：${studentsWithoutRemainingHours.map(s => s.name).join('、')}` 
        };
      }
    }

    return { isValid: true, message: '' };
  };

  // 获取课程类型颜色
  const getCourseTypeColor = (type: '钢琴' | '声乐' | '器乐') => {
    switch (type) {
      case '钢琴': return 'bg-blue-100 border-blue-300 text-blue-800';
      case '声乐': return 'bg-green-100 border-green-300 text-green-800';
      case '器乐': return 'bg-orange-100 border-orange-300 text-orange-800';
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
        <p className="text-gray-600">正在加载排课数据...</p>
      </div>
    );
  }

  // 检查是否有基础数据
  const hasStudents = students.length > 0;
  const hasClasses = classes.length > 0;
  const hasCourses = courses.length > 0;
  
  // 检查教师相关数据（更智能的检查）
  const hasMyStudents = myStudents.length > 0;
  const hasMyRooms = myRooms.length > 0;
  const hasMySchedule = scheduledClasses.length > 0;

  // 智能数据检查逻辑
  // 管理员始终进入排课界面（可先选择教师），不显示引导页
  let shouldShowGuide = false;
  
  if (isAdmin) {
    shouldShowGuide = false; // 管理员始终显示排课界面，可先选择教师进行排课
  } else if (teacher) {
    // 教师视图：检查教师名下的基础数据
    // 只有当既没有自己名下的学生、也没有任何排课时才显示引导
    if (!hasMyStudents && !hasMySchedule) {
      shouldShowGuide = true;
    }
  } else {
    // 非管理员且非教师：需要全系统基础数据
    if (!hasStudents && !hasClasses && !hasCourses) {
      shouldShowGuide = true;
    }
  }

  // 如果没有基础数据，显示引导页面
  if (shouldShowGuide) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-purple-600" />
              专业小课排课管理
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {teacher 
                ? '请先确保您有学生或排课数据后再进行排课'
                : '请先导入基础数据后再进行排课'
              }
            </p>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <GraduationCap className="w-10 h-10 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">开始使用排课系统</h2>
            <p className="text-gray-600 mb-6 max-w-md">
              {teacher 
                ? '请先在学生管理中导入您的学生数据，或联系管理员添加班级数据。'
                : '在开始排课之前，您需要先导入学生数据、班级数据和琴房数据。'
              }
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl">
              {teacher ? (
                // 教师视图
                <>
                  {!hasMyStudents && (
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                      <Users className="w-8 h-8 text-purple-600 mb-2" />
                      <h3 className="font-medium text-gray-800">导入学生</h3>
                      <p className="text-sm text-gray-500 mt-1">在学生管理中导入您的学生数据</p>
                    </div>
                  )}
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                    <Building className="w-8 h-8 text-orange-600 mb-2" />
                    <h3 className="font-medium text-gray-800">联系管理员</h3>
                    <p className="text-sm text-gray-500 mt-1">如需添加班级数据，请联系系统管理员</p>
                  </div>
                </>
              ) : (
                // 管理员视图
                <>
                  {!hasStudents && (
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                      <Users className="w-8 h-8 text-purple-600 mb-2" />
                      <h3 className="font-medium text-gray-800">导入学生</h3>
                      <p className="text-sm text-gray-500 mt-1">在学生管理中导入学生数据</p>
                    </div>
                  )}
                  {!hasClasses && (
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                      <GraduationCap className="w-8 h-8 text-green-600 mb-2" />
                      <h3 className="font-medium text-gray-800">创建班级</h3>
                      <p className="text-sm text-gray-500 mt-1">在班级管理中创建或导入班级</p>
                    </div>
                  )}
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                    <Building className="w-8 h-8 text-orange-600 mb-2" />
                    <h3 className="font-medium text-gray-800">设置琴房</h3>
                    <p className="text-sm text-gray-500 mt-1">在教室管理中设置教室信息</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const weekDays = getWeekDays();
  const classStudents = getClassStudents();
  const invalidGroups = studentGroups.filter(g => !g.isValid);
  const validGroups = studentGroups.filter(g => g.isValid);

  // 计算当前选中班级学期的应配课程
  const currentSemesterNumber = selectedClass
    ? calculateSemesterNumber(selectedClass.class_id, selectedAcademicYear, selectedSemesterLabel)
    : 0;
  const expectedCourses = selectedClass
    ? getCoursesForClass(selectedClass.class_id, selectedAcademicYear, currentSemesterNumber)
    : { piano: null, vocal: null, instrument: null };

  // 检查教师是否能教某类课程
  const canTeacherTeach = (courseType: '钢琴' | '声乐' | '器乐'): boolean => {
    if (!teacher || !teacher.can_teach_instruments || teacher.can_teach_instruments.length === 0) {
      return true; // 如果没有设置，默认都能教
    }
    const teacherInstruments = teacher.can_teach_instruments;
    return teacherInstruments.some(inst => {
      if (courseType === '钢琴') {
        return inst === '钢琴' || inst === '钢琴伴奏' || inst === '钢琴合奏';
      }
      if (courseType === '声乐') {
        return inst === '声乐' || inst === '合唱';
      }
      if (courseType === '器乐') {
        return !['钢琴', '声乐', '钢琴伴奏', '钢琴合奏', '合唱'].includes(inst);
      }
      return false;
    });
  };

  // 获取可选课程列表（根据班级、学期和教师专业自动过滤）
  const getAvailableCourses = () => {
    const result = [];
    
    if (schedulingMode === 'major') {
      // 专业大课模式：显示当前教师的专业大课
      const effectiveTeacherId = targetTeacher?.id || teacher?.id;
      const majorCourses = courses.filter(course => {
        const isMajorCourse = (course as any).teaching_type === '专业大课';
        const isTeacherCourse = !course.teacher_id || course.teacher_id === effectiveTeacherId || course.teacher_name === targetTeacher?.name || course.teacher_name === teacher?.name;
        return isMajorCourse && isTeacherCourse;
      });
      
      majorCourses.forEach(course => {
        result.push({ name: course.course_name, type: course.course_type as '钢琴' | '声乐' | '器乐' });
      });
    } else if (selectedClass) {
      // 小组课模式：根据班级和学期生成课程（仅普通班使用）
      // 专升本小组课的课程名称通常与普通班不同，这里不再为专升本自动生成课程，
      // 避免错误地套用普通班 23 级的课程配置，强制从小组课列表中选择。
      const classType = (selectedClass as any).student_type || 'general';
      if (classType !== 'upgrade') {
        const courseAssignment = getCoursesForClass(
          selectedClass.class_id,
          selectedAcademicYear,
          currentSemesterNumber
        );
        // 只添加教师能教授的课程类型
        if (courseAssignment.piano && canTeacherTeach('钢琴')) {
          result.push({ name: courseAssignment.piano, type: '钢琴' as const });
        }
        if (courseAssignment.vocal && canTeacherTeach('声乐')) {
          result.push({ name: courseAssignment.vocal, type: '声乐' as const });
        }
        if (courseAssignment.instrument && canTeacherTeach('器乐')) {
          result.push({ name: courseAssignment.instrument, type: '器乐' as const });
        }
      }
    }
    
    return result;
  };

  const availableCourses = getAvailableCourses();

  // 当选择班级变化时，自动设置课程名称（保持向后兼容）
  const handleClassChange = async (classId: string) => {
    const cls = classes.find(c => c.id === classId);
    setSelectedClass(cls || null);
    setSelectedStudents(new Set());
    setStudentGroups([]);
    setGroupStudents([]); // 清空小组

    // 使用新的班级选择处理逻辑
    handleSpecificClassChange(classId);

    // 自动选择第一个课程
      const courses = getAvailableCourses();
      if (courses.length > 0) {
        setSelectedCourseName(courses[0].name);
        setSelectedCourseType(courses[0].type);
        // 更新学生进度
        // 不需要手动更新进度，useMemo 会自动计算
        // 更新主项和副项学生列表
        setPrimaryStudents(getPrimaryStudents());
        setSecondaryStudents(getSecondaryStudents());
      } else {
        setSelectedCourseName('');
        setSelectedCourseType('钢琴');
        // 不需要手动清空进度，useMemo 会自动计算
        setPrimaryStudents(getPrimaryStudents());
        setSecondaryStudents(getSecondaryStudents());
      }
  };

  // 当学期变化时，更新课程名称和周次配置
  const handleSemesterChange = async (semesterLabel: string) => {
    setSelectedSemesterLabel(semesterLabel);
    const courses = getAvailableCourses();
    // 尝试找到匹配当前课程类型的课程
    const matchingCourse = courses.find(c => c.type === selectedCourseType);
    let newCourseName = '';
    if (matchingCourse) {
      newCourseName = matchingCourse.name;
      setSelectedCourseName(matchingCourse.name);
    } else if (courses.length > 0) {
      newCourseName = courses[0].name;
      setSelectedCourseName(courses[0].name);
      setSelectedCourseType(courses[0].type);
    } else {
      setSelectedCourseName('');
      // 不需要手动清空进度，useMemo 会自动计算
    }
    // 更新学生进度
    if (newCourseName) {
      // 不需要手动更新进度，useMemo 会自动计算
    }
    
    // 更新周次配置
    try {
      const weekConfigData = await weekConfigService.getBySemester(semesterLabel);
      
      if (weekConfigData) {
        const totalWeeksValue = weekConfigData.total_weeks || 16;
        setTotalWeeks(totalWeeksValue);
        
        const startDateValue = weekConfigData.start_date || '';
        setSemesterStartDate(startDateValue);
        
        setSelectedWeekRange({
          startWeek: 1,
          endWeek: totalWeeksValue
        });
      } else {
        console.warn('未找到周次配置，使用默认值');
        setTotalWeeks(16);
        setSemesterStartDate('');
        setSelectedWeekRange({
          startWeek: 1,
          endWeek: 16
        });
      }
    } catch (weekError) {
      console.warn('获取周次配置失败，使用默认值:', weekError);
      setTotalWeeks(16);
      setSemesterStartDate('');
      setSelectedWeekRange({
        startWeek: 1,
        endWeek: 16
      });
    }
    
    // 更新禁排时间
    await initializeTimeGrid();
  };

  return (
    <div className="animate-fade-in">
      <div className="max-w-[1380px] mx-auto px-2.5">
        {/* 页面标题和排课模式切换 */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-purple-600" />
              专业小课排课管理
            </h1>
          </div>
          {/* 导出按钮组 */}
          <div className="flex items-center gap-2 mt-4 md:mt-0">
            <button
              onClick={handleExportSchedule}
              className="btn-secondary flex items-center gap-2"
              disabled={scheduledClasses.length === 0}
            >
              <Download className="w-4 h-4" />
              导出课表
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={handleExportKKXX}
                  className="btn-secondary flex items-center gap-2"
                  disabled={scheduledClasses.length === 0}
                  title="导出开课信息（CX_JW_KKXX格式）"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  导出开课信息
                </button>
                <button
                  onClick={handleExportPKXX}
                  className="btn-secondary flex items-center gap-2"
                  disabled={scheduledClasses.length === 0}
                  title="导出排课信息（CX_JW_PKXX格式）"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  导出排课信息
                </button>
                <button
                  onClick={handleExportXSXK}
                  className="btn-secondary flex items-center gap-2"
                  disabled={scheduledClasses.length === 0}
                  title="导出学生选课数据（CX_JW_XSXK格式）"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  导出选课数据
                </button>
              </>
            )}
          </div>
        </div>

      {/* 提示信息 */}
      {toast && (
        <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg z-50 animate-fade-in flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' :
          toast.type === 'error' ? 'bg-red-100 text-red-800 border border-red-200' :
          'bg-blue-100 text-blue-800 border border-blue-200'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> :
           toast.type === 'error' ? <AlertTriangle className="w-5 h-5" /> :
           <Info className="w-5 h-5" />}
          {toast.message}
        </div>
      )}


      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-4">
            {/* 周次范围显示 */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-sm text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg">
                <CalendarDays className="w-4 h-4" />
                <span>
                  排课周次范围：<strong>第{selectedWeekRange.startWeek}周 - 第{totalWeeks}周</strong>
                </span>
              </div>
              <span className="text-xs text-gray-500">
                （共{Math.max(0, totalWeeks - selectedWeekRange.startWeek + 1)}周）
              </span>
            </div>
            
            {/* 管理员教师选择器 */}
            {isAdmin && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">为</span>
                <select
                  value={targetTeacher?.id || ''}
                  onChange={(e) => {
                    const teacherId = e.target.value;
                    const selectedTeacher = availableTeachers.find(t => t.teacher_id === teacherId || t.id === teacherId);
                    setTargetTeacher(selectedTeacher || null);
                    // 重置状态
                    setSelectedCourseName('');
                    // 根据教师的专业自动设置selectedCourseType
                    let courseType: '钢琴' | '声乐' | '器乐' = '钢琴';
                    if (selectedTeacher) {
                      switch (selectedTeacher.faculty_code) {
                        case 'VOCAL':
                          courseType = '声乐';
                          break;
                        case 'INSTRUMENT':
                          courseType = '器乐';
                          break;
                        case 'PIANO':
                        default:
                          courseType = '钢琴';
                          break;
                      }
                    }
                    setSelectedCourseType(courseType);
                    setSelectedStudents(new Set());
                    setStudentGroups([]);
                    setGroupStudents([]);
                  }}
                  className="input-field min-w-[200px]"
                >
                  <option value="">全部教师</option>
                  {availableTeachers
                    .sort((a, b) => (a.teacher_id || '').localeCompare(b.teacher_id || ''))
                    .map(teacher => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.name} ({teacher.teacher_id})
                      </option>
                    ))}
                </select>
                <span className="text-sm text-gray-600">排课</span>
              </div>
            )}
          </div>
          {/* 显示教师固定琴房 */}
          <div className="mt-2 flex items-center gap-3">
            {targetTeacher && (
              <>{
                fixedRooms.length > 0 ? (
                  <div className="flex items-center gap-2">
                    {fixedRooms.map((fr, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg">
                        <Building className="w-4 h-4" />
                        <span>
                          {fr.facultyCode === 'PIANO' ? '钢琴琴房' :
                           fr.facultyCode === 'VOCAL' ? '声乐琴房' : '器乐琴房'}：
                          <strong>{fr.room?.room_name || '未设置'}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-orange-700 bg-orange-50 px-3 py-1.5 rounded-lg">
                    <AlertTriangle className="w-4 h-4" />
                    <span>您尚未设置固定琴房，请在教室管理中设置</span>
                  </div>
                )
              }</>
            )}
          </div>
          {/* 显示当前学期应配课程 */}
          {selectedClass && (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-sm text-gray-600">
                {selectedClass.class_name} · {selectedSemesterLabel} · 第{currentSemesterNumber}学期
              </span>
              <div className="flex gap-2">
                {expectedCourses.piano && (
                  <span className="badge bg-blue-100 text-blue-700">钢琴{expectedCourses.piano.replace('钢琴', '')}</span>
                )}
                {expectedCourses.vocal && (
                  <span className="badge bg-green-100 text-green-700">声乐{expectedCourses.vocal.replace('声乐', '')}</span>
                )}
                {expectedCourses.instrument && (
                  <span className="badge bg-orange-100 text-orange-700">{expectedCourses.instrument}</span>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* 排课模式内容 */}
      {/* 小组课模式：三框式学生选择界面 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 主项学生框 */}
        <div className="lg:col-span-1">
          <div className="card">
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <h3 className="section-title flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  主项学生
                </h3>
                <span className="text-sm text-gray-500">
                  {primaryStudents.length}人
                </span>
              </div>
              {/* 年级和班级筛选 */}
              <div className="flex flex-wrap gap-2">
                <select
                  value={primaryFilters.grade}
                  onChange={(e) => {
                    setPrimaryFilters(prev => ({ ...prev, grade: e.target.value }));
                  }}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1"
                >
                  <option value="">全部年级</option>
                  {[...new Set(myStudents.map(s => {
                    if (s.major_class) {
                      const grade = extractGradeFromClassId(s.major_class);
                      return grade !== '未知' ? grade : null;
                    }
                    return null;
                  }))].filter(Boolean).sort().map(grade => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </select>
                <select
                  value={primaryFilters.className}
                  onChange={(e) => {
                    setPrimaryFilters(prev => ({ ...prev, className: e.target.value }));
                  }}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1"
                >
                  <option value="">全部班级</option>
                  {myStudents
                    .filter(s => {
                      if (!primaryFilters.grade) return true;
                      if (!s.major_class) return false;
                      const studentGrade = extractGradeFromClassId(s.major_class);
                      return studentGrade === primaryFilters.grade;
                    })
                    .map(s => s.major_class)
                    .filter(Boolean)
                    .filter((value, index, self) => self.indexOf(value) === index)
                    .sort()
                    .map(className => (
                      <option key={className} value={className}>
                        {className}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {primaryStudents.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <GraduationCap className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>暂无主项学生</p>
              </div>
            ) : (
              <div className="space-y-0.5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                {primaryStudents.map(student => {
                  const courseType = student.__courseType;
                  const progress = studentProgress[student.id]?.[courseType];
                  const canSchedule = progress ? progress.remaining > 0 : true;
                  const isInGroup = groupStudents.find(s => s.id === student.id && s.__courseType === student.__courseType);
                  
                  return (
                    <div
                      key={`${student.id}_${student.__courseType}`}
                      className={`flex items-start gap-2 px-2 py-2 rounded cursor-pointer transition-colors hover:bg-blue-50 ${
                        isInGroup ? 'bg-blue-100 border border-blue-300' : 
                        !canSchedule ? 'bg-gray-100 border border-gray-300' : ''
                      }`}
                      onClick={() => {
                        if (isInGroup) {
                          removeFromGroup(student.id, student.__courseType);
                        } else if (canSchedule) {
                          addToGroup(student, 'primary');
                        }
                      }}
                      style={{ opacity: canSchedule ? 1 : 0.6, cursor: canSchedule ? 'pointer' : 'not-allowed' }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {student.name}
                          </p>
                          <span className="text-xs text-blue-700">
                            🎹
                          </span>
                          <span className="text-xs text-gray-500 ml-1">
                            ({student.__courseType})
                          </span>
                          {!canSchedule && (
                            <span className="text-xs text-red-500 ml-1">
                              (已排满)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          主项：{student.primary_instrument}
                        </p>
                        <p className="text-xs text-gray-500">
                          班级：{student.major_class}
                        </p>
                        {/* 课程进度信息 */}
                        {progress && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              progress.remaining === 0 
                                ? 'bg-green-100 text-green-700' 
                                : progress.percentage < 50
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {progress.remaining === 0 
                                ? '已完成' 
                                : `剩余 ${progress.remaining} 节`
                              }
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 副项学生框 */}
        <div className="lg:col-span-1">
          <div className="card">
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <h3 className="section-title flex items-center gap-2">
                  <Users className="w-5 h-5 text-orange-600" />
                  副项学生
                </h3>
                <span className="text-sm text-gray-500">
                  {secondaryStudents.length}人
                </span>
              </div>
              {/* 年级和班级筛选 */}
              <div className="flex flex-wrap gap-2">
                <select
                  value={secondaryFilters.grade}
                  onChange={(e) => {
                    setSecondaryFilters(prev => ({ ...prev, grade: e.target.value }));
                  }}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1"
                >
                  <option value="">全部年级</option>
                  {[...new Set(myStudents.map(s => {
                    if (s.major_class) {
                      const grade = extractGradeFromClassId(s.major_class);
                      return grade !== '未知' ? grade : null;
                    }
                    return null;
                  }))].filter(Boolean).sort().map(grade => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </select>
                <select
                  value={secondaryFilters.className}
                  onChange={(e) => {
                    setSecondaryFilters(prev => ({ ...prev, className: e.target.value }));
                  }}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1"
                >
                  <option value="">全部班级</option>
                  {myStudents
                    .filter(s => {
                      if (!secondaryFilters.grade) return true;
                      if (!s.major_class) return false;
                      const studentGrade = extractGradeFromClassId(s.major_class);
                      return studentGrade === secondaryFilters.grade;
                    })
                    .map(s => s.major_class)
                    .filter(Boolean)
                    .filter((value, index, self) => self.indexOf(value) === index)
                    .sort()
                    .map(className => (
                      <option key={className} value={className}>
                        {className}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {secondaryStudents.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <GraduationCap className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>暂无副项学生</p>
              </div>
            ) : (
              <div className="space-y-0.5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                {secondaryStudents.map(student => {
                  const courseType = student.__courseType;
                  const progress = studentProgress[student.id]?.[courseType];
                  const canSchedule = progress ? progress.remaining > 0 : true;
                  const isInGroup = groupStudents.find(s => s.id === student.id && s.__courseType === student.__courseType);
                  
                  return (
                    <div
                      key={`${student.id}_${student.__courseType}`}
                      className={`flex items-start gap-2 px-2 py-2 rounded cursor-pointer transition-colors hover:bg-orange-50 ${
                        isInGroup ? 'bg-orange-100 border border-orange-300' : 
                        !canSchedule ? 'bg-gray-100 border border-gray-300' : ''
                      }`}
                      onClick={() => {
                        if (isInGroup) {
                          removeFromGroup(student.id, student.__courseType);
                        } else if (canSchedule) {
                          addToGroup(student, 'secondary');
                        }
                      }}
                      style={{ opacity: canSchedule ? 1 : 0.6, cursor: canSchedule ? 'pointer' : 'not-allowed' }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {student.name}
                          </p>
                          <span className="text-xs text-orange-700">
                            🎸
                          </span>
                          <span className="text-xs text-gray-500 ml-1">
                            ({student.__courseType})
                          </span>
                          {!canSchedule && (
                            <span className="text-xs text-red-500 ml-1">
                              (已排满)
                            </span>
                          )}
                        </div>
                        {getStudentClassType(student) === 'general' ? (
                          <>
                            <p className="text-xs text-gray-500">
                              主项：{student.primary_instrument}
                            </p>
                            <p className="text-xs text-orange-600">
                              副项：{student.__courseType}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-orange-600">
                            副项：{student.__courseType}
                          </p>
                        )}
                        <p className="text-xs text-gray-500">
                          班级：{student.major_class}
                        </p>
                        {/* 课程进度信息 */}
                        {progress && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              progress.remaining === 0 
                                ? 'bg-green-100 text-green-700' 
                                : progress.percentage < 50
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {progress.remaining === 0 
                                ? '已完成' 
                                : `剩余 ${progress.remaining} 节`
                              }
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 小组框 */}
        <div className="lg:col-span-1">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-600" />
                小组
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={clearGroup}
                  className="text-xs text-gray-500 hover:text-gray-700"
                  disabled={groupStudents.length === 0}
                >
                  清空
                </button>
                <span className="text-sm text-gray-500">
                  {groupStudents.length}人
                </span>
              </div>
            </div>

            {groupStudents.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>点击主项或副项框中的学生添加到小组</p>
                <p className="text-xs mt-1">
                  支持主副项混合小组
                </p>
              </div>
            ) : (
              <div 
                className="space-y-0.5"
              >
                {groupStudents.map(student => {
                  const studentCategory = getStudentCourseType(student);
                  const categoryIcon = studentCategory === '钢琴' ? '🎹' : studentCategory === '声乐' ? '🎤' : '🎸';
                  const categoryColor = studentCategory === '钢琴' ? 'text-blue-700' : studentCategory === '声乐' ? 'text-green-700' : 'text-orange-700';
                  const classType = getStudentClassType(student) === 'general' ? '普通班' : '专升本';
                  
                  return (
                    <div
                      key={student.id}
                      className="flex items-center gap-2 px-2 py-2 rounded bg-purple-50 border border-purple-200"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {student.name}
                          </p>
                          <span className={`text-xs ${categoryColor}`}>
                            {categoryIcon}
                          </span>
                          <span className="text-xs text-gray-500">
                            ({classType})
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          班级：{student.major_class}
                        </p>
                        <p className="text-xs text-gray-500">
                          主项：{student.primary_instrument}
                        </p>
                        {student.secondary_instruments && student.secondary_instruments.length > 0 && (
                          <p className="text-xs text-orange-600">
                            副项：{student.secondary_instruments.join('、')}
                          </p>
                        )}
                        {/* 课程进度信息 */}
                        {selectedCourseName && studentProgress[student.id] && student.__courseType && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              studentProgress[student.id][student.__courseType]?.remaining === 0 
                                ? 'bg-green-100 text-green-700' 
                                : studentProgress[student.id][student.__courseType]?.percentage < 50
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {studentProgress[student.id][student.__courseType]?.remaining === 0 
                                ? '已完成' 
                                : `剩余 ${studentProgress[student.id][student.__courseType]?.remaining || 0} 节`
                              }
                            </span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeFromGroup(student.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
                
                {/* 小组规则验证提醒 */}
                {groupStudents.length > 0 && (
                  <div className="mt-2">
                    {(() => {
                      const validation = validateCurrentGroup();
                      if (!validation.isValid) {
                        return (
                          <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <p>{validation.message}</p>
                            </div>
                          </div>
                        );
                      } else {
                        return (
                          <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                            <div className="flex items-start gap-2">
                              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <p>小组验证通过，可以排课</p>
                            </div>
                          </div>
                        );
                      }
                    })()}
                  </div>
                )}
                
                {/* 小组统计信息 */}
                <div className="mt-3 p-2 bg-purple-50 rounded text-xs">
                  <p className="font-medium text-purple-700 mb-1">小组信息</p>
                  <div className="space-y-1">
                    <p className="text-purple-600">
                      总人数: {groupStudents.length}人
                    </p>
                    <p className="text-purple-600">
                      主项学生: {groupStudents.filter(s => studentSources.get(s.id) === 'primary').length}人
                    </p>
                    <p className="text-purple-600">
                      副项学生: {groupStudents.filter(s => studentSources.get(s.id) === 'secondary').length}人
                    </p>
                  </div>
                </div>

                {/* 小组课时进度信息 */}
                {groupStudents.length > 0 && selectedCourseName && (() => {
                  const groupKey = getGroupKey(groupStudents, selectedCourseType);
                  const progress = groupProgress[groupKey];
                  
                  if (!progress) return null;

                  const progressColor = getGroupProgressColor(progress.progress);
                  const progressIcon = getGroupProgressIcon(progress.progress);

                  return (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-medium text-gray-700 text-sm">课时进度</p>
                        <span className={`text-xs px-2 py-1 rounded-full ${progressColor}`}>
                          {progressIcon} {progress.progress.toFixed(1)}%
                        </span>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600">当前进度</span>
                          <span className="font-medium">
                            {progress.completedHours}/{progress.totalHours}课时
                          </span>
                        </div>
                        
                        {/* 进度条 */}
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full transition-all duration-300 ${
                              progress.progress >= 80 ? 'bg-green-500' :
                              progress.progress >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(progress.progress, 100)}%` }}
                          ></div>
                        </div>
                        
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600">剩余课时</span>
                          <span className={`font-medium ${
                            progress.remainingHours === 0 ? 'text-green-600' :
                            progress.progress < 50 ? 'text-red-600' : 'text-yellow-600'
                          }`}>
                            {progress.remainingHours}课时
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* 小组课排课模块 */}
      <div className="mt-6">
        {/* 小组课列表 */}
        <div className="bg-white rounded-lg p-4 mb-6">
          <h3 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-purple-600" />
            小组课列表
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
              <thead className="bg-gray-100">
                <tr>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    序号
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    课程编号
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    课程名称
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    课程类型
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    授课类型
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    任课教师
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    年级
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    班级
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    总学时
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    周数
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    周学时
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    学分
                  </th>
                  <th scope="col" className="px-3 py-2 text-center text-sm font-bold text-gray-700 border border-gray-300">
                    状态
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {/* 计算分页数据 */}
                {(() => {
                  const startIndex = (currentPage - 1) * pageSize;
                  const endIndex = startIndex + pageSize;
                  const paginatedCourses = groupCourses.slice(startIndex, endIndex);
                  
                  return paginatedCourses.map((course, index) => {
                    // 直接从课程数据中获取所有字段信息，参考专业大课排课页面的实现方式
                    // 使用与课程管理页面相同的逻辑计算总学时和周数
                    const courseType = (course as any).course_type || course.course_type || '';
                    const teachingType = (course as any).teaching_type || '';
                    
                    // 检查是否为8周课程
                    const isEightWeekCourse = () => {
                      const eightWeekCourses = [
                        '钢琴即兴伴奏',
                        '器乐室内乐',
                        '声乐舞台表演创编'
                      ];
                      return eightWeekCourses.some(keyword => course.course_name.includes(keyword));
                    };
                    
                    // 获取课程周数（与课程管理页面逻辑一致）
                    const getCourseWeeks = () => {
                      if (teachingType === '专业大课') {
                        if (isEightWeekCourse()) {
                          return 8;
                        }
                        return (course as any).weeks || 16;
                      }
                      return 16;
                    };
                    
                    // 获取课程总学时（与课程管理页面逻辑一致）
                    const getCourseTotalHours = () => {
                      if (teachingType === '专业大课') {
                        if (isEightWeekCourse()) {
                          return 16;
                        }
                        return (course as any).total_hours || (course as any).credit_hours * 16 || 32;
                      }
                      return 16;
                    };
                    
                    const totalHours = getCourseTotalHours();
                    const weeks = getCourseWeeks();
                    const weeklyHours = (course as any).week_frequency || (course as any).weekly_hours || 1;
                    const credits = (course as any).credit_hours || (course as any).credits || (course as any).credit;
                    const teacherName = (course as any).teacher_name || '';
                    const courseId = (course as any).course_id || course.id || '';
                    const majorClassId = (course as any).major_class || '';
                    
                    // 尝试从 classes 状态中查找完整的班级名称
                    const courseClassName = (course as any).class_name || '';
                    const foundClass = classes.find(c => c.class_id === majorClassId);
                    const className = foundClass?.class_name || courseClassName || majorClassId || '';
                    
                    // 获取任课教师信息
                    const teacherId = (course as any).teacher_id || course.teacher_id || '';
                    // 尝试从 availableTeachers 中查找教师名称
                    const foundTeacher = availableTeachers.find(t => t.teacher_id === teacherId || t.id === teacherId);
                    const teacherFullName = foundTeacher?.name || teacherName || '';
                    
                    // 获取年级信息
                    const grade = foundClass?.enrollment_year || (course as any).grade || '';
                    const isSelected = selectedCourseName === course.course_name;
                    const actualIndex = startIndex + index;
                    const courseClassId = majorClassId;
                    
                    return (
                      <tr 
                        key={course.id || actualIndex} 
                        className={`hover:bg-blue-50 ${actualIndex % 2 === 0 ? 'bg-gray-50' : ''} ${credits === 1 ? 'bg-red-50' : ''} ${isSelected ? 'bg-blue-50 border border-blue-200' : ''}`}
                        onClick={() => {
                          setSelectedCourseName(course.course_name || '');
                          setSelectedCourseId(courseId);
                          setSelectedCourseClassId(courseClassId);
                        }}
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 text-center border border-gray-300">
                          {actualIndex + 1}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {courseId}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900 cursor-pointer hover:text-blue-600 text-center border border-gray-300">
                          {course.course_name || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-center border border-gray-300">
                          <span className={`px-2 py-1 text-xs rounded-full ${courseType === '钢琴' ? 'bg-blue-100 text-blue-700' : courseType === '声乐' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            {courseType || ''}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {teachingType || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {teacherFullName || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {grade || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {className || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {totalHours || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {weeks || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {weeklyHours || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center border border-gray-300">
                          {credits || ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-center border border-gray-300">
                          <button 
                            className={`px-2 py-1 text-xs rounded-full ${isSelected ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'} hover:opacity-80 transition-opacity`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCourseName(course.course_name || '');
                              setSelectedCourseId(courseId);
                              setSelectedCourseClassId(courseClassId);
                            }}
                          >
                            {isSelected ? '已选择' : '选择'}
                          </button>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
          
          {/* 分页控件 */}
          {groupCourses.length > pageSize && (
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span>
                  显示 {((currentPage - 1) * pageSize) + 1} 到 {Math.min(currentPage * pageSize, groupCourses.length)} 共 {groupCourses.length} 条
                </span>
                <div className="flex items-center gap-2">
                  <span>每页显示：</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1); // 切换每页显示数量时重置到第一页
                    }}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1"
                  >
                    <option value={5}>5条</option>
                    <option value={10}>10条</option>
                    <option value={15}>15条</option>
                    <option value={20}>20条</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  首页
                </button>
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                {/* 页码按钮 */}
                {(() => {
                  const totalPages = Math.ceil(groupCourses.length / pageSize);
                  const pageButtons = [];
                  
                  for (let i = 1; i <= totalPages; i++) {
                    pageButtons.push(
                      <button
                        key={i}
                        onClick={() => setCurrentPage(i)}
                        className={`px-3 py-1 border ${currentPage === i ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-300 bg-white text-gray-600'} rounded-md text-sm hover:bg-gray-100`}
                      >
                        {i}
                      </button>
                    );
                  }
                  
                  return pageButtons;
                })()}
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(groupCourses.length / pageSize)))}
                  disabled={currentPage === Math.ceil(groupCourses.length / pageSize)}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
                <button 
                  onClick={() => setCurrentPage(Math.ceil(groupCourses.length / pageSize))}
                  disabled={currentPage === Math.ceil(groupCourses.length / pageSize)}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  末页
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* 排课结果展示 */}
        {renderScheduleResults()}
        
        {/* 周次选择 */}
        {renderWeekSelector()}
        
        {/* 时间网格和侧边面板 */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 时间网格（禁排未就绪前禁用） */}
          <div className="lg:col-span-3 relative">
            {!blockedTimesSchedulingReady && (
              <div className="absolute inset-0 bg-gray-100/80 flex items-center justify-center z-10 rounded-lg">
                <span className="text-gray-600">正在加载禁排时间…</span>
              </div>
            )}
            <div className={!blockedTimesSchedulingReady ? 'pointer-events-none opacity-60' : ''}>
              {renderTimeGrid()}
            </div>
          </div>

          {/* 侧边面板 */}
          {renderRightPanel()}
        </div>
      </div>

      </div>
    </div>
  );
}
