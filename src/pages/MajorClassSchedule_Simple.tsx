import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { courseService, scheduleService, teacherService, roomService, classService, blockedSlotService, weekConfigService, largeClassScheduleService } from '../services';
import websocketService from '../services/websocketService';
import type { LargeClassEntry } from '../types';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import {
  Clock,
  Save
} from 'lucide-react';
import type { Course, Room } from '../types';

// 导入拆分后的组件
import TeacherSelector from '../components/MajorClassSchedule/TeacherSelector';
import CourseList from '../components/MajorClassSchedule/CourseList';
import WeekSelector from '../components/MajorClassSchedule/WeekSelector';
import TimeGrid from '../components/MajorClassSchedule/TimeGrid';
import SelectedTimeSlots from '../components/MajorClassSchedule/SelectedTimeSlots';
import ScheduleResult from '../components/MajorClassSchedule/ScheduleResult';
import ConflictDetector from '../components/MajorClassSchedule/ConflictDetector';

// 导入类型和工具函数
import { WEEKDAYS, CourseStatus, CourseScheduleStatus, Class } from '../components/MajorClassSchedule/types';
import { getWeekRange, isWeekBlocked, isSlotAvailable, getActualIndex, generateDefaultCourseStatus, generateScheduleRecord, detectConflicts, processBatchSelection } from '../components/MajorClassSchedule/utils';

const USE_DATABASE = import.meta.env.VITE_USE_DATABASE === 'true';

export default function MajorClassSchedule() {
  const { user, teacher, isAdmin } = useAuth();
// 加载状态
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // 自动保存状态
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showSaveNotification, setShowSaveNotification] = useState(false);
  
  // 批量模式状态
  const [batchWeeks, setBatchWeeks] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const [batchDay, setBatchDay] = useState<number>(2);
  const [batchPeriods, setBatchPeriods] = useState<number[]>([4]);
  const [progress, setProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  
  // 目标教师状态
  const [targetTeacher, setTargetTeacher] = useState<any>(null);
  const [availableTeachers, setAvailableTeachers] = useState<any[]>([]);
  
  // 数据状态
  const [courses, setCourses] = useState<Course[]>([]);
  const [scheduledClasses, setScheduledClasses] = useState<any[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  
  // 获取当前学年的函数 (格式: 2025-2026)
  const getCurrentAcademicYear = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    // 8月及以后为新学年第一学期，1-7月为上一学年第二学期
    if (month >= 8) {
      return `${year}-${year + 1}`;
    } else {
      return `${year - 1}-${year}`;
    }
  };

  // 获取当前学期标签 (格式: 2025-2026-1 或 2025-2026-2)
  const getCurrentSemesterLabel = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const academicYear = getCurrentAcademicYear();
    const semester = month >= 8 ? '1' : '2';
    return `${academicYear}-${semester}`;
  };

  // 学年学期状态 - 使用系统默认学期
  const [selectedSemesterLabel, setSelectedSemesterLabel] = useState(getCurrentSemesterLabel());
  
  // 学期开始日期 - 从周次配置中获取
  const [semesterStartDate, setSemesterStartDate] = useState<string>('');
  
  // 加载周次配置，获取学期开始日期
  useEffect(() => {
    const loadWeekConfig = async () => {
      try {
        // 从周次配置中获取当前学期的开始日期
        const weekConfig = await weekConfigService.getBySemester(selectedSemesterLabel);
        if (weekConfig && weekConfig.start_date) {
          setSemesterStartDate(weekConfig.start_date);
        }
      } catch (error) {
        console.error('加载周次配置失败:', error);
      }
    };
    
    loadWeekConfig();
  }, [selectedSemesterLabel]);
  
  // 排课状态
  const [courseScheduleStatuses, setCourseScheduleStatuses] = useState<CourseScheduleStatus[]>([]);
  const [currentCourse, setCurrentCourse] = useState<CourseScheduleStatus | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [totalWeeks, setTotalWeeks] = useState(17);
  
  // 排课选项状态
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  
  // 排课时间网格状态
  const [timeGridStatus, setTimeGridStatus] = useState<Array<Array<{status: 'available' | 'scheduled' | 'blocked', courseId?: string}>>>([]);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<Array<{week: number, day: number, period: number}>>([]);
  
  // 时间选择模式
  const [selectionMode, setSelectionMode] = useState<'single' | 'batch'>('batch');
  
  // 框选模式状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{day: number, period: number} | null>(null);
  const [dragEnd, setDragEnd] = useState<{day: number, period: number} | null>(null);
  
  // 冲突检测状态
  const [conflicts, setConflicts] = useState<Array<{week: number, day: number, period: number, type: 'room' | 'time' | 'class', message: string, suggestion: string}>>([]);
  
  // 批量选择状态
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  
  // 禁排时段状态
  const [blockedSlots, setBlockedSlots] = useState<any[]>([]);
  
  // 通识大课状态
  const [largeClassEntries, setLargeClassEntries] = useState<LargeClassEntry[]>([]);
  
  // 导入禁排时间状态
  const [importedBlockedTimes, setImportedBlockedTimes] = useState<any[]>([]);
  const [importSuccess, setImportSuccess] = useState<boolean>(false);
  
  // 导入禁排时间分页状态
  const [blockedTimesPage, setBlockedTimesPage] = useState(1);
  const [blockedTimesPageSize, setBlockedTimesPageSize] = useState(10);
  
  // 筛选状态
  const [filters, setFilters] = useState({
    class_name: '',
    week: '',
    day: '',
    period: '',
    reason: ''
  });
  

  
  // 解析周次范围字符串，返回包含的周次数组
  const parseWeekRange = useCallback((weekRange: string): number[] => {
    const weeks: number[] = [];
    if (!weekRange) return weeks;
    
    // 移除所有非数字、非连字符和非分隔符的字符
    const cleanStr = weekRange.replace(/[^\d,，;；-]/g, '');
    
    // 分割多个周次范围
    const ranges = cleanStr.split(/[,，;；]/).map(r => r.trim()).filter(r => r);
    
    for (const range of ranges) {
      // 处理单个周次，如 "1"
      if (/^\d+$/.test(range)) {
        weeks.push(parseInt(range));
      }
      // 处理周次范围，如 "1-5"
      else if (/-/.test(range)) {
        const [start, end] = range.split('-').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        if (start && end && start <= end) {
          for (let i = start; i <= end; i++) {
            weeks.push(i);
          }
        }
      }
    }
    
    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => Number(a) - Number(b));
  }, []);

  // 解析节次范围字符串，返回包含的节次数组
  const parsePeriods = useCallback((periodsStr: string): number[] => {
    const periods: number[] = [];
    if (!periodsStr) return periods;
    
    // 移除所有非数字和非连字符的字符
    const cleanStr = periodsStr.replace(/[^\d-]/g, '');
    
    // 处理单个节次，如 "3" 或 "3节"
    if (/^\d+$/.test(cleanStr)) {
      const period = parseInt(cleanStr);
      // 只添加1-10之间的节次
      if (period >= 1 && period <= 10) {
        periods.push(period);
      }
      return periods;
    }
    
    // 处理节次范围，如 "3-4" 或 "3-4节"
    if (/-/.test(cleanStr)) {
      const [start, end] = cleanStr.split('-').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      if (start && end && start <= end) {
        for (let i = start; i <= end; i++) {
          // 只添加1-10之间的节次
          if (i >= 1 && i <= 10) {
            periods.push(i);
          }
        }
      }
      return periods;
    }
    
    // 处理逗号分隔的多个节次，如 "1,2,3"
    if (/,/.test(periodsStr)) {
      const parts = periodsStr.split(/[,，]/).map(p => p.trim());
      for (const part of parts) {
        const period = parseInt(part);
        // 只添加1-10之间的节次
        if (!isNaN(period) && period >= 1 && period <= 10) {
          periods.push(period);
        }
      }
      return periods;
    }
    
    return periods;
  }, []);

  // 解析星期字符串，返回数字格式
  const parseDay = useCallback((dayStr: string): number => {
    // 移除所有非中文字符
    const cleanStr = dayStr.replace(/[^\u4e00-\u9fa5]/g, '');
    
    const dayMap: Record<string, number> = {
      '周一': 1,
      '周二': 2,
      '周三': 3,
      '周四': 4,
      '周五': 5,
      '周六': 6,
      '周日': 7,
      '一': 1,
      '二': 2,
      '三': 3,
      '四': 4,
      '五': 5,
      '六': 6,
      '日': 7
    };
    
    // 尝试直接匹配
    if (dayMap[cleanStr]) {
      return dayMap[cleanStr];
    }
    
    // 尝试匹配部分字符串
    for (const [key, value] of Object.entries(dayMap)) {
      if (cleanStr.includes(key)) {
        return value;
      }
    }
    
    return 0;
  }, []);

  // 处理禁排时间导入


  // 从禁排时间中移除课程的禁排记录
  const removeScheduleFromBlockedTimes = useCallback((courseId: string, classId: string) => {
    try {

      
      // 获取课程信息
      const courseInfo = courses.find(c => c.id === courseId);
      if (!courseInfo) {

        return;
      }
      
      // 获取班级信息
      const classInfo = classes.find(c => c.class_id === classId);
      const className = classInfo?.class_name || '';
      
      if (!className) {

        return;
      }
      
      // 从禁排时间中移除该课程的记录
      const updatedBlockedTimes = importedBlockedTimes.filter(item => {
        // 如果班级不匹配，保留该记录
        if (item.class_name !== className) {
          return true;
        }
        // 如果禁排原因不是该课程，保留该记录
        if (item.reason !== `${courseInfo.course_name}上课`) {
          return true;
        }
        // 否则移除该记录
        return false;
      });
      
      // 更新状态
      setImportedBlockedTimes(updatedBlockedTimes);
      
      // 保存到本地存储
      localStorage.setItem('music_scheduler_imported_blocked_times', JSON.stringify(updatedBlockedTimes));
      

      
    } catch (error) {
      console.error('从禁排时间中移除课程失败:', error);
    }
  }, [courses, classes, importedBlockedTimes]);

  // 将排课时间添加到禁排时间中
  const addScheduleToBlockedTimes = useCallback(async (schedules: any[], course: any) => {
    try {

      
      // 首先移除该课程已有的禁排记录，避免重复
      await removeScheduleFromBlockedTimes(course.course_id, course.class_id);
      
      // 获取课程信息
      const courseInfo = courses.find(c => c.id === course.course_id);
      if (!courseInfo) {

        return;
      }
      
      // 获取班级信息
      const classInfo = classes.find(c => c.class_id === course.class_id);
      const className = classInfo?.class_name || course.class_name;
      
      // 获取教师信息
      const teacherName = course.teacher_name || '未知教师';
      
      // 获取教室信息
      const roomInfo = rooms.find(r => r.id === selectedRoom) || rooms[0];
      const roomName = roomInfo?.room_name || '未知教室';
      
      // 按班级、星期、禁排原因分组，收集所有周次和节次
      const blockedTimeMap = new Map();
      const reason = `${courseInfo.course_name}上课`;
      
      schedules.forEach(schedule => {
        // 按班级、星期、禁排原因分组
        const key = `${className}-${schedule.day_of_week}-${reason}`;
        
        if (!blockedTimeMap.has(key)) {
          blockedTimeMap.set(key, {
            weeks: [schedule.week_number],
            day: schedule.day_of_week,
            periods: [schedule.period],
            class_name: className,
            teacher_name: teacherName,
            room_name: roomName,
            course_name: courseInfo.course_name,
            reason: reason
          });

        } else {
          const item = blockedTimeMap.get(key);
          if (!item.weeks.includes(schedule.week_number)) {
            item.weeks.push(schedule.week_number);
          }
          if (!item.periods.includes(schedule.period)) {
            item.periods.push(schedule.period);
          }
        }
      });
      
      // 创建禁排时间记录
      const newBlockedTimes: any[] = [];
      
      blockedTimeMap.forEach((value, key) => {
        // 对周次进行排序和去重
        const sortedWeeks = [...new Set(value.weeks)].sort((a, b) => Number(a) - Number(b));
        // 对节次进行排序和去重
        const sortedPeriods = [...new Set(value.periods)].sort((a, b) => Number(a) - Number(b));
        
        // 为班级创建禁排记录
        newBlockedTimes.push({
          class_name: value.class_name,
          weeks: sortedWeeks,
          day: value.day,
          periods: sortedPeriods,
          reason: value.reason
        });
      });
      

      
      // 合并到现有的导入禁排时间中
      const updatedBlockedTimes = [...importedBlockedTimes];
      
      newBlockedTimes.forEach(newItem => {
        // 查找是否已存在相同的禁排记录（相同班级、星期、禁排原因）
        const existingIndex = updatedBlockedTimes.findIndex(existing => 
          existing.class_name === newItem.class_name &&
          existing.day === newItem.day &&
          existing.reason === newItem.reason
        );
        
        if (existingIndex >= 0) {
          // 合并周次和节次
          const existingItem = updatedBlockedTimes[existingIndex];
          const mergedWeeks = [...new Set([...existingItem.weeks, ...newItem.weeks])].sort((a, b) => Number(a) - Number(b));
          const mergedPeriods = [...new Set([...existingItem.periods, ...newItem.periods])].sort((a, b) => Number(a) - Number(b));
          updatedBlockedTimes[existingIndex] = {
            ...existingItem,
            weeks: mergedWeeks,
            periods: mergedPeriods
          };
        } else {
          updatedBlockedTimes.push(newItem);
        }
      });
      
      // 更新状态
      setImportedBlockedTimes(updatedBlockedTimes);
      
      // 保存到本地存储
      localStorage.setItem('music_scheduler_imported_blocked_times', JSON.stringify(updatedBlockedTimes));
      

      
    } catch (error) {
      console.error('添加禁排时间失败:', error);
    }
  }, [courses, classes, rooms, importedBlockedTimes, selectedRoom, removeScheduleFromBlockedTimes]);

  // 同步排课数据到导入的禁排时间列表（用于数据导入后自动同步）
  const syncScheduleToImportedBlockedTimes = useCallback((scheduleData: any[], coursesData: any[], classesData: any[], roomsData: any[]) => {
    try {

      
      // 按班级、课程、星期、节次分组排课记录
      // 注意：不同节次的记录应该分开，避免混淆（如周次1-15节次3-4 和 周次16-17节次9-10 应该分开）
      const scheduleMap = new Map();
      
      scheduleData.forEach(schedule => {
        const course = coursesData.find(c => c.id === schedule.course_id);
        const classInfo = classesData.find(c => c.class_id === schedule.class_id);
        const room = roomsData.find(r => r.id === schedule.room_id);
        
        if (!course || !classInfo) return;
        
        const className = classInfo.class_name;
        const courseName = course.course_name;
        const dayOfWeek = schedule.day_of_week;
        const period = schedule.period;
        const reason = `${courseName}上课`;
        
        // 按班级、星期、节次、禁排原因分组
        const key = `${className}-${dayOfWeek}-${period}-${reason}`;
        
        if (!scheduleMap.has(key)) {
          scheduleMap.set(key, {
            weeks: [],
            day: dayOfWeek,
            periods: [period],
            class_name: className,
            reason: reason
          });
        }
        
        const item = scheduleMap.get(key);
        if (schedule.week_number && !item.weeks.includes(schedule.week_number)) {
          item.weeks.push(schedule.week_number);
        }
      });
      
      // 创建禁排时间记录
      const newBlockedTimes: any[] = [];
      
      scheduleMap.forEach((value, key) => {
        // 对周次进行排序和去重
        const sortedWeeks = [...new Set(value.weeks)].sort((a, b) => Number(a) - Number(b));
        // 对节次进行排序和去重
        const sortedPeriods = [...new Set(value.periods)].sort((a, b) => Number(a) - Number(b));
        
        if (sortedWeeks.length > 0 && sortedPeriods.length > 0) {
          newBlockedTimes.push({
            class_name: value.class_name,
            weeks: sortedWeeks,
            day: value.day,
            periods: sortedPeriods,
            reason: value.reason
          });
        }
      });
      

      
      if (newBlockedTimes.length === 0) {
        return;
      }
      
      // 获取当前的导入禁排时间
      const currentImportedBlockedTimes = JSON.parse(localStorage.getItem('music_scheduler_imported_blocked_times') || '[]');
      
      // 合并到现有的导入禁排时间中
      const updatedBlockedTimes = [...currentImportedBlockedTimes];
      
      newBlockedTimes.forEach(newItem => {
        // 查找是否已存在相同的禁排记录（相同班级、星期、节次、禁排原因）
        const existingIndex = updatedBlockedTimes.findIndex(existing => 
          existing.class_name === newItem.class_name &&
          existing.day === newItem.day &&
          existing.reason === newItem.reason &&
          JSON.stringify(existing.periods.sort((a: number, b: number) => a - b)) === JSON.stringify(newItem.periods.sort((a: number, b: number) => a - b))
        );
        
        if (existingIndex >= 0) {
          // 合并周次
          const existingItem = updatedBlockedTimes[existingIndex];
          const mergedWeeks = [...new Set([...existingItem.weeks, ...newItem.weeks])].sort((a, b) => Number(a) - Number(b));
          updatedBlockedTimes[existingIndex] = {
            ...existingItem,
            weeks: mergedWeeks
          };
        } else {
          updatedBlockedTimes.push(newItem);
        }
      });
      
      // 更新状态
      setImportedBlockedTimes(updatedBlockedTimes);
      
      // 保存到本地存储
      localStorage.setItem('music_scheduler_imported_blocked_times', JSON.stringify(updatedBlockedTimes));
      

      
    } catch (error) {
      console.error('同步排课数据到导入禁排时间列表失败:', error);
    }
  }, []);

  // 将周次配置禁排时间同步到导入的禁排时间列表（直接从blockedSlots获取，不经过禁排查询页面）
  const syncBlockedSlotsToImportedBlockedTimes = useCallback((blockedSlotsData: any[], classesData: any[]) => {
    try {

      
      const newBlockedTimes: any[] = [];
      
      blockedSlotsData.forEach(slot => {
        // 获取班级信息
        const classInfo = classesData.find(c => c.class_id === slot.class_id);
        const className = classInfo?.class_name || slot.class_id;
        
        // 解析周次范围
        const weeks: number[] = [];
        if (slot.weeks) {
          const weekParts = slot.weeks.split(/[,，]/);
          weekParts.forEach((part: string) => {
            const trimmed = part.trim();
            if (trimmed.includes('-')) {
              const [start, end] = trimmed.split('-').map((s: string) => parseInt(s.trim()));
              for (let i = start; i <= end; i++) {
                weeks.push(i);
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
        if (slot.periods) {
          slot.periods.forEach((period: number) => {
            periods.push(period);
          });
        } else if (slot.period) {
          const periodNum = parseInt(slot.period);
          if (!isNaN(periodNum)) {
            periods.push(periodNum);
          }
        }
        
        if (weeks.length > 0 && periods.length > 0 && slot.day_of_week) {
          newBlockedTimes.push({
            class_name: className,
            weeks: [...new Set(weeks)].sort((a, b) => Number(a) - Number(b)),
            day: slot.day_of_week,
            periods: [...new Set(periods)].sort((a, b) => Number(a) - Number(b)),
            reason: slot.reason || '禁排时间'
          });
        }
      });
      

      
      if (newBlockedTimes.length === 0) {
        return;
      }
      
      // 获取当前的导入禁排时间
      const currentImportedBlockedTimes = JSON.parse(localStorage.getItem('music_scheduler_imported_blocked_times') || '[]');
      
      // 合并到现有的导入禁排时间中
      const updatedBlockedTimes = [...currentImportedBlockedTimes];
      
      newBlockedTimes.forEach(newItem => {
        const existingIndex = updatedBlockedTimes.findIndex(existing => 
          existing.class_name === newItem.class_name &&
          existing.day === newItem.day &&
          existing.reason === newItem.reason
        );
        
        if (existingIndex >= 0) {
          const existingItem = updatedBlockedTimes[existingIndex];
          const mergedWeeks = [...new Set([...existingItem.weeks, ...newItem.weeks])].sort((a, b) => Number(a) - Number(b));
          const mergedPeriods = [...new Set([...existingItem.periods, ...newItem.periods])].sort((a, b) => Number(a) - Number(b));
          updatedBlockedTimes[existingIndex] = {
            ...existingItem,
            weeks: mergedWeeks,
            periods: mergedPeriods
          };
        } else {
          updatedBlockedTimes.push(newItem);
        }
      });
      
      // 更新状态
      setImportedBlockedTimes(updatedBlockedTimes);
      
      // 保存到本地存储
      localStorage.setItem('music_scheduler_imported_blocked_times', JSON.stringify(updatedBlockedTimes));
      

      
    } catch (error) {
      console.error('同步周次配置禁排时间到导入禁排时间列表失败:', error);
    }
  }, []);

  // 一次性同步所有数据到导入的禁排时间列表
  const syncAllDataToImportedBlockedTimes = useCallback((
    scheduleData: any[],
    coursesData: any[],
    classesData: any[],
    roomsData: any[],
    largeClassData: any[],
    blockedSlotsData: any[],
    weekConfigData?: any
  ) => {
    try {
      
      const allBlockedTimes: any[] = [];
      
      // 1. 处理排课数据 - 按班级、星期、原因分组，合并相同周次范围的节次
      if (scheduleData.length > 0) {
        const scheduleMap = new Map();
        
        scheduleData.forEach(schedule => {
          const course = coursesData.find(c => c.id === schedule.course_id);
          const classInfo = classesData.find(c => c.class_id === schedule.class_id);
          
          if (!course || !classInfo) return;
          
          // 按班级、星期、原因分组
          const baseKey = `${classInfo.class_name}-${schedule.day_of_week}-${course.course_name}上课`;
          
          if (!scheduleMap.has(baseKey)) {
            scheduleMap.set(baseKey, {
              class_name: classInfo.class_name,
              day: schedule.day_of_week,
              reason: `${course.course_name}上课`,
              // 使用 Map 存储周次集合到节次数组的映射
              weekPeriodsMap: new Map()
            });
          }
          
          const item = scheduleMap.get(baseKey);
          const weekKey = schedule.week_number;
          
          if (!item.weekPeriodsMap.has(weekKey)) {
            item.weekPeriodsMap.set(weekKey, []);
          }
          if (schedule.period && !item.weekPeriodsMap.get(weekKey).includes(schedule.period)) {
            item.weekPeriodsMap.get(weekKey).push(schedule.period);
          }
        });
        
        // 处理分组后的数据，合并相同周次范围的节次
        scheduleMap.forEach(value => {
          // 按节次集合分组周次
          const periodsToWeeks = new Map();
          
          value.weekPeriodsMap.forEach((periods: number[], week: number) => {
            const periodsKey = [...periods].sort((a, b) => Number(a) - Number(b)).join(',');
            if (!periodsToWeeks.has(periodsKey)) {
              periodsToWeeks.set(periodsKey, {
                weeks: [],
                periods: periods
              });
            }
            periodsToWeeks.get(periodsKey).weeks.push(week);
          });
          
          // 为每个不同的节次集合创建一条记录
          periodsToWeeks.forEach((data, key) => {
            allBlockedTimes.push({
              class_name: value.class_name,
              weeks: [...new Set(data.weeks)].sort((a, b) => Number(a) - Number(b)),
              day: value.day,
              periods: [...new Set(data.periods)].sort((a, b) => Number(a) - Number(b)),
              reason: value.reason
            });
          });
        });
      }
      
      // 2. 处理通识大课数据 - 按班级、星期、原因分组，合并相同周次范围的节次
      if (largeClassData.length > 0) {

        
        // 先按班级、星期、原因分组
        const largeClassMap = new Map();
        
        largeClassData.forEach(entry => {
          const className = entry.class_name || entry.class_id;
          const baseKey = `${className}-${entry.day_of_week}-${entry.course_name}`;
          
          if (!largeClassMap.has(baseKey)) {
            largeClassMap.set(baseKey, {
              class_name: className,
              day: entry.day_of_week,
              reason: entry.course_name || '通识大课',
              weekPeriodsMap: new Map()
            });
          }
          
          // 解析周次范围
          const weeks: number[] = [];
          const weekRange = entry.week_range || entry.weeks;
          if (weekRange) {
            const cleanWeekRange = weekRange.replace(/周/g, '');
            const weekParts = cleanWeekRange.split(/[,，]/);
            weekParts.forEach((part: string) => {
              const trimmed = part.trim();
              if (trimmed.includes('-')) {
                const [start, end] = trimmed.split('-').map((s: string) => parseInt(s.trim()));
                for (let i = start; i <= end; i++) {
                  weeks.push(i);
                }
              } else {
                const weekNum = parseInt(trimmed);
                if (!isNaN(weekNum)) {
                  weeks.push(weekNum);
                }
              }
            });
          }
          
          // 解析节次 - 使用 period_start 和 period_end
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
          
          // 记录每个周次对应的节次
          const item = largeClassMap.get(baseKey);
          weeks.forEach((week: number) => {
            if (!item.weekPeriodsMap.has(week)) {
              item.weekPeriodsMap.set(week, []);
            }
            periods.forEach((period: number) => {
              if (!item.weekPeriodsMap.get(week).includes(period)) {
                item.weekPeriodsMap.get(week).push(period);
              }
            });
          });
        });
        
        // 处理分组后的数据，合并相同周次范围的节次
        largeClassMap.forEach(value => {
          const periodsToWeeks = new Map();
          
          value.weekPeriodsMap.forEach((periods: number[], week: number) => {
            const periodsKey = [...periods].sort((a, b) => Number(a) - Number(b)).join(',');
            if (!periodsToWeeks.has(periodsKey)) {
              periodsToWeeks.set(periodsKey, {
                weeks: [],
                periods: periods
              });
            }
            periodsToWeeks.get(periodsKey).weeks.push(week);
          });
          
          // 为每个不同的节次集合创建一条记录
          periodsToWeeks.forEach((data, key) => {
            allBlockedTimes.push({
              class_name: value.class_name,
              weeks: [...new Set(data.weeks)].sort((a, b) => Number(a) - Number(b)),
              day: value.day,
              periods: [...new Set(data.periods)].sort((a, b) => Number(a) - Number(b)),
              reason: value.reason
            });
          });
        });
      }
      
      // 3. 处理周次配置禁排数据 - 重新构建简洁完整的导入逻辑
      if (blockedSlotsData.length > 0) {

        
        blockedSlotsData.forEach((slot: any) => {
          // 提取班级列表
          const classNames: string[] = [];
          if (slot.class_associations && slot.class_associations.length > 0) {
            slot.class_associations.forEach((assoc: any) => {
              if (typeof assoc === 'string') {
                classNames.push(assoc);
              } else if (assoc && assoc.name) {
                classNames.push(assoc.name);
              }
            });
          }
          
          // 如果没有班级关联，跳过（因为无法确定应用到哪个班级）
          if (classNames.length === 0) {

            return;
          }
          
          // 提取节次范围
          const periods: number[] = [];
          if (slot.start_period && slot.end_period) {
            for (let i = slot.start_period; i <= slot.end_period; i++) {
              periods.push(i);
            }
          }
          
          // 如果没有节次，跳过
          if (periods.length === 0) {

            return;
          }
          
          // 情况1: 有 specific_week_days 数组（特定周次的特定星期）
          if (slot.specific_week_days && slot.specific_week_days.length > 0) {
            slot.specific_week_days.forEach((swd: any) => {
              if (swd.week && swd.day) {
                classNames.forEach((className: string) => {
                  allBlockedTimes.push({
                    class_name: className,
                    weeks: [swd.week],
                    day: swd.day,
                    periods: [...periods],
                    reason: slot.reason || '禁排时间'
                  });
                });
              }
            });
            return; // 已处理，跳过后续逻辑
          }
          
          // 情况2: 有日期范围（start_date 和 end_date）
          if (slot.start_date && slot.end_date && weekConfigData && weekConfigData.start_date) {
            const semesterStart = new Date(weekConfigData.start_date);
            const slotStart = new Date(slot.start_date);
            const slotEnd = new Date(slot.end_date);
            
            // 遍历日期范围内的每一天
            const currentDate = new Date(slotStart);
            while (currentDate <= slotEnd) {
              // 计算周次
              const weekNumber = Math.floor((currentDate.getTime() - semesterStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
              // 计算星期（1-7，周一到周日）
              const dayOfWeek = currentDate.getDay() === 0 ? 7 : currentDate.getDay();
              
              if (weekNumber > 0) {
                classNames.forEach((className: string) => {
                  allBlockedTimes.push({
                    class_name: className,
                    weeks: [weekNumber],
                    day: dayOfWeek,
                    periods: [...periods],
                    reason: slot.reason || '禁排时间'
                  });
                });
              }
              
              // 移动到下一天
              currentDate.setDate(currentDate.getDate() + 1);
            }
            return; // 已处理，跳过后续逻辑
          }
          
          // 情况3: 有 day_of_week（每周循环）
          if (slot.day_of_week) {
            // 对于每周循环类型，应用到所有周次（使用配置中的总周数）
            const totalWeeks = weekConfigData?.total_weeks || 18;
            const allWeeks = Array.from({length: totalWeeks}, (_, i) => i + 1);
            classNames.forEach((className: string) => {
              allBlockedTimes.push({
                class_name: className,
                weeks: allWeeks,
                day: slot.day_of_week,
                periods: [...periods],
                reason: slot.reason || '禁排时间'
              });
            });
            return;
          }
          

        });
      }
      

      
      if (allBlockedTimes.length === 0) {
        return;
      }
      
      // 合并相同班级、星期、周次、节次、原因的记录
      const mergedBlockedTimes: any[] = [];
      
      allBlockedTimes.forEach(item => {
        // 检查是否已存在完全相同的记录（班级、星期、周次、节次、原因都相同）
        const existingIndex = mergedBlockedTimes.findIndex(existing => 
          existing.class_name === item.class_name &&
          existing.day === item.day &&
          existing.reason === item.reason &&
          JSON.stringify(existing.weeks.sort((a: number, b: number) => a - b)) === JSON.stringify(item.weeks.sort((a: number, b: number) => a - b)) &&
          JSON.stringify(existing.periods.sort((a: number, b: number) => a - b)) === JSON.stringify(item.periods.sort((a: number, b: number) => a - b))
        );
        
        if (existingIndex >= 0) {
          // 完全相同的记录，跳过（不重复添加）

        } else {
          mergedBlockedTimes.push(item);
        }
      });
      

      
      // 更新状态和本地存储
      setImportedBlockedTimes(mergedBlockedTimes);
      localStorage.setItem('music_scheduler_imported_blocked_times', JSON.stringify(mergedBlockedTimes));
      

      
    } catch (error) {
      console.error('同步所有数据到导入禁排时间列表失败:', error);
    }
  }, []);

  // 导入排课结果
  const handleImportScheduleResults = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // 处理导入的数据
        const newSchedules = [];
        
        jsonData.forEach((item: any) => {
          const courseCode = item['课程编号'] || '';
          const courseName = item['课程名称'] || '';
          const courseType = item['课程类型'] || '理论课';
          const teacherName = item['任课教师'] || '未分配';
          const className = item['学生班级'] || '未知班级';
          const roomName = item['教室'] || '未选择教室';
          const scheduleTime = item['排课时间'] || '';
          
          // 查找课程信息
          let course = courses.find(c => c.course_name === courseName);
          if (!course) {
            // 如果课程不存在，创建一个新的课程
            course = {
              id: courseCode || uuidv4(),
              course_id: courseCode,
              course_name: courseName,
              course_type: courseType,
              teacher_id: '',
              teacher_name: teacherName,
              required_hours: 32,
              teaching_type: '专业大课',
              major_class: className,
              course_category: 'general',
              duration: 2,
              week_frequency: 1,
              created_at: new Date().toISOString()
            };
          } else if (courseCode && !course.course_id) {
            // 如果课程存在但没有课程编号，更新课程编号
            course.course_id = courseCode;
          }
          
          // 查找班级信息
          let classInfo = classes.find(c => c.class_name === className);
          if (!classInfo) {
            // 如果班级不存在，创建一个新的班级
            classInfo = {
              id: uuidv4(),
              class_id: uuidv4(),
              class_name: className,
              enrollment_year: new Date().getFullYear(),
              class_number: 1,
              student_count: item['人数'] || 0,
              student_type: 'general',
              status: 'active',
              created_at: new Date().toISOString()
            };
          }
          
          // 查找教室信息
          let room = rooms.find(r => r.room_name === roomName);
          if (!room) {
            // 如果教室不存在，创建一个新的教室
            room = {
              id: uuidv4(),
              room_name: roomName,
              teacher_id: '',
              room_type: '教室',
              capacity: 50,
              created_at: new Date().toISOString()
            };
          }
          
          // 解析排课时间
          if (scheduleTime) {
            const timeLines = scheduleTime.split('\n');
            timeLines.forEach(timeLine => {
              // 解析时间格式：第1-16周 周一 第1-2节
              const weekMatch = timeLine.match(/第([\d-、]+)周/);
              const dayMatch = timeLine.match(/(周一|周二|周三|周四|周五|周六|周日)/);
              const periodMatch = timeLine.match(/第([\d-]+)节/);
              
              if (weekMatch && dayMatch && periodMatch) {
                const weekStr = weekMatch[1];
                const dayStr = dayMatch[1];
                const periodStr = periodMatch[1];
                
                // 解析周次
                const weeks: number[] = [];
                const weekParts = weekStr.split(/[,，、]/);
                weekParts.forEach(part => {
                  if (part.includes('-')) {
                    const [start, end] = part.split('-').map(Number);
                    for (let i = start; i <= end; i++) {
                      weeks.push(i);
                    }
                  } else {
                    weeks.push(Number(part));
                  }
                });
                
                // 解析星期
                const dayMap: Record<string, number> = {
                  '周一': 1,
                  '周二': 2,
                  '周三': 3,
                  '周四': 4,
                  '周五': 5,
                  '周六': 6,
                  '周日': 7
                };
                const day = dayMap[dayStr] || 1;
                
                // 解析节次
                const periods: number[] = [];
                if (periodStr.includes('-')) {
                  const [start, end] = periodStr.split('-').map(Number);
                  for (let i = start; i <= end; i++) {
                    periods.push(i);
                  }
                } else {
                  periods.push(Number(periodStr));
                }
                
                // 创建排课记录
                weeks.forEach(week => {
                  periods.forEach(period => {
                    newSchedules.push({
                      id: uuidv4(),
                      course_id: course.id,
                      class_id: classInfo.class_id,
                      room_id: room.id,
                      week_number: week,
                      day_of_week: day,
                      period: period,
                      start_week: week,
                      end_week: week,
                      created_at: new Date().toISOString(),
                      status: 'draft'
                    });
                  });
                });
              }
            });
          }
        });
        
        // 保存到本地存储
        let currentStorageData = JSON.parse(localStorage.getItem('music_scheduler_scheduled_classes') || '[]');
        const updatedStorageData = [...currentStorageData, ...newSchedules];
        localStorage.setItem('music_scheduler_scheduled_classes', JSON.stringify(updatedStorageData));
        
        // 重新加载数据
        const loadData = async () => {
          const [scheduleData] = await Promise.all([
            scheduleService.getAll()
          ]);
          setScheduledClasses(scheduleData || []);
        };
        
        loadData();
        
        // 显示导入成功通知
        setShowSaveNotification(true);
        setTimeout(() => setShowSaveNotification(false), 3000);
        
      } catch (error) {
        console.error('导入排课结果失败:', error);
        alert('导入排课结果失败，请检查文件格式');
      }
    };
    reader.readAsArrayBuffer(file);
  }, [courses, classes, rooms, scheduleService]);
  
  // 导出排课结果
  const handleExportScheduleResults = useCallback(() => {
    // 获取所有已排课的课程（从 scheduledClasses 中）
    const uniqueCourseClassPairs = new Map();
    
    // 遍历所有排课记录，按 course_id + class_id 分组
    scheduledClasses.forEach(schedule => {
      const key = `${schedule.course_id}_${schedule.class_id}`;
      if (!uniqueCourseClassPairs.has(key)) {
        uniqueCourseClassPairs.set(key, {
          course_id: schedule.course_id,
          class_id: schedule.class_id,
          schedules: []
        });
      }
      uniqueCourseClassPairs.get(key).schedules.push(schedule);
    });
    
    // 准备导出数据
    const exportData = [];
    
    uniqueCourseClassPairs.forEach((pair, key) => {
      const course = courses.find(c => c.id === pair.course_id);
      const classInfo = classes.find(c => c.class_id === pair.class_id);
      const room = rooms.find(r => r.id === pair.schedules[0]?.room_id);
      
      // 按星期和节次分组，合并相同节次范围的周次
      const dayPeriodGroups = new Map();
      
      pair.schedules.forEach(schedule => {
        const periodKey = `${schedule.day_of_week}-${schedule.period}`;
        if (!dayPeriodGroups.has(periodKey)) {
          dayPeriodGroups.set(periodKey, {
            day: schedule.day_of_week,
            period: schedule.period,
            weeks: []
          });
        }
        dayPeriodGroups.get(periodKey).weeks.push(schedule.week_number);
      });
      
      // 按节次分组周次，生成合并后的记录
      const mergedRecords: { day: number; periods: number[]; weeks: number[] }[] = [];
      const dayGroups = new Map();
      
      dayPeriodGroups.forEach((group) => {
        const dayKey = group.day;
        if (!dayGroups.has(dayKey)) {
          dayGroups.set(dayKey, new Map());
        }
        const periodMap = dayGroups.get(dayKey);
        const sortedWeeks = [...new Set(group.weeks)].sort((a, b) => Number(a) - Number(b));
        const weeksKey = sortedWeeks.join(',');
        
        if (!periodMap.has(weeksKey)) {
          periodMap.set(weeksKey, {
            day: group.day,
            periods: [],
            weeks: sortedWeeks
          });
        }
        periodMap.get(weeksKey).periods.push(group.period);
      });
      
      // 将分组数据转换为数组
      dayGroups.forEach((periodMap) => {
        periodMap.forEach((record: { day: number; periods: number[]; weeks: number[] }) => {
          mergedRecords.push(record);
        });
      });
      
      // 按星期排序
      mergedRecords.sort((a, b) => a.day - b.day);
      
      // 格式化排课时间，合并后的节次分行显示
      const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      const scheduleTimeLines: string[] = [];
      
      mergedRecords.forEach(record => {
        const sortedPeriods = [...new Set(record.periods)].sort((a, b) => Number(a) - Number(b));
        const periodStart = sortedPeriods[0];
        const periodEnd = sortedPeriods[sortedPeriods.length - 1];
        const periodStr = periodStart === periodEnd ? `第${periodStart}节` : `第${periodStart}-${periodEnd}节`;
        
        // 合并周次显示
        const weeks = record.weeks;
        let weekStr = '';
        if (weeks.length > 0) {
          const ranges: string[] = [];
          let start = weeks[0];
          let end = weeks[0];
          
          for (let i = 1; i <= weeks.length; i++) {
            if (weeks[i] === end + 1) {
              end = weeks[i];
            } else {
              if (start === end) {
                ranges.push(`${start}`);
              } else {
                ranges.push(`${start}-${end}`);
              }
              start = weeks[i];
              end = weeks[i];
            }
          }
          weekStr = `第${ranges.join('、')}周`;
        }
        
        scheduleTimeLines.push(`${weekStr} ${dayNames[record.day]} ${periodStr}`);
      });
      
      const scheduleTime = scheduleTimeLines.length > 0 ? scheduleTimeLines.join('\n') : '未安排';
      
      // 计算已排课时（每2节课算2课时）
      const scheduledHours = pair.schedules.length;
      
      exportData.push({
        '课程编号': course?.course_id || course?.id || '无',
        '课程名称': course?.course_name || '未知课程',
        '课程类型': course?.course_type || '理论课',
        '任课教师': course?.teacher_name || '未分配',
        '学生班级': classInfo?.class_name || '未知班级',
        '人数': classInfo?.student_count || 0,
        '教室': room?.room_name || '未选择教室',
        '排课时间': scheduleTime,
        '已排课时': scheduledHours
      });
    });
    
    // 创建工作簿和工作表
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // 设置列宽
    const colWidths = [
      { wch: 20 }, // 课程名称
      { wch: 15 }, // 课程类型
      { wch: 15 }, // 任课教师
      { wch: 15 }, // 学生班级
      { wch: 8 },  // 人数
      { wch: 15 }, // 教室
      { wch: 40 }, // 排课时间
      { wch: 10 }  // 已排课时
    ];
    worksheet['!cols'] = colWidths;
    
    // 添加工作表到工作簿
    XLSX.utils.book_append_sheet(workbook, worksheet, '排课结果');
    
    // 导出文件
    XLSX.writeFile(workbook, `排课结果_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [scheduledClasses, courses, classes, rooms]);

  // 检查周次是否为禁排周
  const isWeekBlocked = useCallback((week: number) => {
    const currentClassId = selectedClass || currentCourse?.class_id;
    const currentClassName = classes.find(c => c.class_id === currentClassId)?.class_name;
    
    // 检查传统禁排时段
    const isBlockedByConfig = blockedSlots.some(slot => {
      // 检查是否指定了班级，如果指定了，只有当班级匹配时才禁排
      if (slot.class_associations && slot.class_associations.length > 0) {
        const hasClassAssociation = slot.class_associations.some(assoc => {
          // 处理不同格式的班级关联
          if (typeof assoc === 'string') {
            // 如果assoc是字符串，直接匹配班级名称或ID
            return assoc === currentClassId || assoc === currentClassName || 
                   currentClassName?.includes(assoc) || assoc.includes(currentClassName || '');
          } else {
            // 如果assoc是对象，匹配ID或名称
            return assoc?.id === currentClassId || 
                   assoc?.name === currentClassName ||
                   assoc?.id === currentClassName ||
                   assoc?.name === currentClassId ||
                   currentClassName?.includes(assoc?.name || '') ||
                   (assoc?.name || '').includes(currentClassName || '');
          }
        });
        if (!hasClassAssociation) {
          return false;
        }
      }
      
      if (slot.type === 'specific') {
        // 检查特定周次禁排
        if (slot.week_number === week) {
          return true;
        }
        // 检查特定周次的星期几禁排
        if (slot.specific_week_days) {
          return slot.specific_week_days.some(wd => wd.week === week);
        }
      }
      return false;
    });
    
    if (isBlockedByConfig) return true;
    
    // 检查通识大课禁排
    return false;
  }, [blockedSlots, classes, selectedClass, currentCourse, selectedSemesterLabel]);
  
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  
  // 编辑状态
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [editWeeks, setEditWeeks] = useState<number[]>([]);
  const [editDay, setEditDay] = useState<number>(1);
  const [editPeriod, setEditPeriod] = useState<number>(1);
  const [editRoomId, setEditRoomId] = useState<string>('');
  
  // 筛选后的课程（去重）
  const filteredCourses = Array.from(
    courses
      .filter(course => {
        const isMajorCourse = (course as any).teaching_type === '专业大课';
        const effectiveTeacherId = isAdmin && !targetTeacher ? null : (targetTeacher?.id || teacher?.id);
        const effectiveTeacherName = isAdmin && !targetTeacher ? null : (targetTeacher?.name || teacher?.name);
        
        // 当没有教师信息时，显示所有专业大课
        // 当有教师信息时，显示包含该教师的专业大课
        let isTeacherCourse = !effectiveTeacherId || 
                               course.teacher_id === effectiveTeacherId || 
                               course.teacher_name === effectiveTeacherName ||
                               (effectiveTeacherName && course.teacher_name && course.teacher_name.includes(effectiveTeacherName));
        
        // 额外检查：如果教师名称包含多个教师，且其中有匹配的教师，也应该显示
        if (!isTeacherCourse && effectiveTeacherName && course.teacher_name) {
          // 尝试分割教师名称，检查是否有匹配的教师
          const teachers = course.teacher_name.split(/[,，、]/).map((t: string) => t.trim());
          isTeacherCourse = teachers.some((t: string) => t.includes(effectiveTeacherName) || effectiveTeacherName.includes(t));
        }
        
        return isMajorCourse && isTeacherCourse;
      })
      .reduce((map, course) => map.set(course.id, course), new Map())
      .values()
  );
  
  // 生成教师筛选后的课程状态
  const filteredCourseScheduleStatuses = courseScheduleStatuses.filter(status => {
    // 使用user对象作为备选（当teacher对象为null时）
    const effectiveTeacherId = isAdmin && !targetTeacher ? null : (targetTeacher?.id || teacher?.id || user?.teacher_id);
    const effectiveTeacherName = isAdmin && !targetTeacher ? null : (targetTeacher?.name || teacher?.name || user?.full_name);
    
    // 当effectiveTeacherId为null时（管理员未选择教师），显示所有专业大课
    // 当有教师信息时，显示包含该教师的专业大课
    let isTeacherCourse = false;
    
    if (effectiveTeacherId === null) {
      // 管理员模式，未选择教师，显示所有课程
      isTeacherCourse = true;
    } else if (effectiveTeacherId || effectiveTeacherName) {
      // 教师模式或管理员选择了教师，筛选该教师的课程
      isTeacherCourse = status.teacher_id === effectiveTeacherId || 
                         status.teacher_name === effectiveTeacherName ||
                         (effectiveTeacherName && status.teacher_name && status.teacher_name.includes(effectiveTeacherName));
      
      // 额外检查：如果教师名称包含多个教师，且其中有匹配的教师，也应该显示
      if (!isTeacherCourse && effectiveTeacherName && status.teacher_name) {
        // 尝试分割教师名称，检查是否有匹配的教师
        const teachers = status.teacher_name.split(/[,，、]/).map((t: string) => t.trim());
        isTeacherCourse = teachers.some((t: string) => t.includes(effectiveTeacherName) || effectiveTeacherName.includes(t));
      }
    }
    
    return isTeacherCourse;
  });

  // 根据教师筛选排课结果
  const filteredScheduledClasses = scheduledClasses.filter(schedule => {
    // 使用user对象作为备选（当teacher对象为null时）
    const effectiveTeacherId = isAdmin && !targetTeacher ? null : (targetTeacher?.id || teacher?.id || user?.teacher_id);
    const effectiveTeacherName = isAdmin && !targetTeacher ? null : (targetTeacher?.name || teacher?.name || user?.full_name);
    
    // 管理员模式，未选择教师，显示所有排课结果
    if (effectiveTeacherId === null) {
      return true;
    }
    
    // 获取排课对应的课程信息
    const course = courses.find(c => c.id === schedule.course_id);
    if (!course) return false;
    
    // 检查是否匹配当前教师
    const teacherMatch = course.teacher_id === effectiveTeacherId || 
                         course.teacher_name === effectiveTeacherName ||
                         (effectiveTeacherName && course.teacher_name && course.teacher_name.includes(effectiveTeacherName));
    
    // 额外检查：如果教师名称包含多个教师
    if (!teacherMatch && effectiveTeacherName && course.teacher_name) {
      const teachers = course.teacher_name.split(/[,，、]/).map((t: string) => t.trim());
      return teachers.some((t: string) => t.includes(effectiveTeacherName) || effectiveTeacherName.includes(t));
    }
    
    return teacherMatch;
  });

  // 分页逻辑
  const totalCourses = filteredCourseScheduleStatuses.length;
  const totalPages = Math.ceil(totalCourses / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedCourses = filteredCourseScheduleStatuses.slice(startIndex, endIndex);
  
  // 处理分页变化
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };
  
  // 初始化时间网格
  const initializeTimeGrid = useCallback(() => {
    const grid = [];
    for (let day = 0; day < 7; day++) {
      const dayRow = [];
      for (let period = 0; period < 5; period++) {
        dayRow.push({ status: 'available' });
      }
      grid.push(dayRow);
    }
    setTimeGridStatus(grid);
  }, []);
  


  // 课程选择处理
  const handleCourseSelect = useCallback((courseStatus: any) => {
    setCurrentCourse(courseStatus);
    
    // 直接使用课程状态中的 class_id 设置 selectedClass
    if (courseStatus.class_id) {
      setSelectedClass(courseStatus.class_id);
    }
    
    // 不自动选择教室，让用户手动选择
    setSelectedRoom('');
    
    // 显示课程选择成功的通知
    setShowSaveNotification(true);
    setTimeout(() => setShowSaveNotification(false), 2000);
  }, []);
  
  // 检查时段是否可用
  const isSlotAvailable = (week: number, day: number, period: number) => {
    // 检查该时段是否为禁排时段（考虑班级）
    const currentClassId = selectedClass || currentCourse?.class_id;
    const currentClassName = classes.find(c => c.class_id === currentClassId)?.class_name;
    const currentTeacherId = currentCourse?.teacher_id;
    
    // 检查传统禁排时段
    const isBlockedByConfig = blockedSlots.some(slot => {
      // 检查是否指定了班级，如果指定了，只有当班级匹配时才禁排
      if (slot.class_associations && slot.class_associations.length > 0) {
        // 检查当前班级是否在禁排关联班级中
        const hasClassAssociation = slot.class_associations.some(assoc => {
          // 处理不同格式的班级关联
          if (typeof assoc === 'string') {
            // 如果assoc是字符串，直接匹配班级名称或ID
            return assoc === currentClassId || assoc === currentClassName || 
                   currentClassName?.includes(assoc) || assoc.includes(currentClassName || '');
          } else {
            // 如果assoc是对象，匹配ID或名称
            return assoc?.id === currentClassId || 
                   assoc?.name === currentClassName ||
                   assoc?.id === currentClassName ||
                   assoc?.name === currentClassId ||
                   currentClassName?.includes(assoc?.name || '') ||
                   (assoc?.name || '').includes(currentClassName || '');
          }
        });
        if (!hasClassAssociation) {
          return false;
        }
      }
      
      // 检查每周循环禁排
      if (slot.type === 'recurring' && slot.day_of_week === day) {
        if (slot.start_period && slot.end_period) {
          return period >= slot.start_period && period <= slot.end_period;
        }
        return true; // 如果没有指定节次，则整个时段都禁排
      }
      
      // 检查特定周次的特定星期禁排
      if (slot.type === 'specific' && slot.specific_week_days) {
        const isSpecificWeekDay = slot.specific_week_days.some(wd => wd.week === week && wd.day === day);
        if (isSpecificWeekDay) {
          if (slot.start_period && slot.end_period) {
            return period >= slot.start_period && period <= slot.end_period;
          }
          return true; // 如果没有指定节次，则整个时段都禁排
        }
      }
      
      // 检查特定周次的特定天禁排
      if (slot.type === 'specific' && slot.week_number === week && slot.day_of_week === day) {
        // 如果指定了节次范围，检查节次是否匹配
        if (slot.start_period && slot.end_period) {
          return period >= slot.start_period && period <= slot.end_period;
        }
        return true; // 没有指定节次范围，整个时段都禁排
      }
      
      // 检查全周禁排
      if (slot.type === 'specific' && slot.week_number === week) {
        // 如果指定了节次范围，检查节次是否匹配
        if (slot.start_period && slot.end_period) {
          return period >= slot.start_period && period <= slot.end_period;
        }
        return true; // 没有指定节次范围，整个时段都禁排
      }
      
      return false;
    });
    
    if (isBlockedByConfig) return false;
    
    // 检查通识大课禁排
    const isBlockedByLargeClass = largeClassEntries.some(entry => {
      // 检查班级是否匹配
      if (currentClassName && entry.class_name !== currentClassName) {
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
      
      // 检查周次是否匹配
      const weeks = parseWeekRange(entry.week_range || '');
      return weeks.includes(week);
    });
    
    if (isBlockedByLargeClass) return false;
    
    // 检查专业大课和专业小课的教师冲突
    const currentTeacherName = currentCourse?.teacher_name;
    const isBlockedByTeacherConflict = scheduledClasses.some(schedule => {
      // 排除当前课程的排课记录
      if (currentCourse && schedule.course_id === currentCourse.course_id) {
        return false;
      }
      // 检查教师是否匹配
      // 如果teacher_id有效且不是'unknown'，使用teacher_id比较
      if (currentTeacherId && currentTeacherId !== 'unknown' && schedule.teacher_id && schedule.teacher_id !== 'unknown') {
        if (schedule.teacher_id === currentTeacherId) {
          // 检查时间是否匹配
          return schedule.week_number === week && 
                 schedule.day_of_week === day && 
                 schedule.period === period;
        }
      } else if (currentTeacherId === 'unknown' && schedule.teacher_id === 'unknown') {
        // 如果两个teacher_id都是'unknown'，必须使用teacher_name比较
        if (currentTeacherName && schedule.teacher_name && schedule.teacher_name === currentTeacherName) {
          // 检查时间是否匹配
          return schedule.week_number === week && 
                 schedule.day_of_week === day && 
                 schedule.period === period;
        }
      }
      return false;
    });
    
    if (isBlockedByTeacherConflict) return false;
    
    // 检查导入的禁排时间
    const isBlockedByImported = importedBlockedTimes.some(blockedTime => {
      // 检查班级是否匹配
      const currentClassName = classes.find(c => c.class_id === currentClassId)?.class_name;
      if (blockedTime.class_name && currentClassName && blockedTime.class_name !== currentClassName) {
        return false;
      }
      // 如果没有选择班级且禁排时间指定了班级，则不匹配
      if (blockedTime.class_name && !currentClassName) {
        return false;
      }
      // 检查周次是否匹配
      if (!blockedTime.weeks.includes(week)) {
        return false;
      }
      // 检查星期是否匹配
      if (blockedTime.day !== day) {
        return false;
      }
      // 检查节次是否匹配
      if (!blockedTime.periods.includes(period)) {
        return false;
      }
      return true;
    });
    
    if (isBlockedByImported) return false;
    
    return true;
  };

  // 时间格子点击处理
  const handleTimeSlotClick = useCallback((week: number, day: number, period: number) => {
    // 检查该时段是否可用（包括传统禁排和通识大课禁排）
    const isAvailable = isSlotAvailable(week, day, period);
    
    // 如果是禁排时段，不允许选择
    if (!isAvailable) {
      return;
    }
    
    // 使用函数式更新，避免依赖 selectedTimeSlots
    setSelectedTimeSlots(prev => {
      const isSelected = prev.some(
        slot => slot.week === week && slot.day === day && slot.period === period
      );
      
      if (isSelected) {
        // 取消选择
        return prev.filter(slot => !(slot.week === week && slot.day === day && slot.period === period));
      } else {
        // 根据选择模式添加选择
        if (selectionMode === 'batch') {
          // 批量选择：根据总学时自动计算需要选择的周次数量（总学时 ÷ 2）
          const course = courses.find(c => c.id === currentCourse?.course_id);
          const totalHours = course?.required_hours || course?.credit || 32;
          const requiredWeeks = Math.ceil(totalHours / 2); // 每2节课算2课时，所以需要选择 totalHours/2 周
          
          // 计算还需要选择多少周（减去已选择的周次）
          const alreadySelectedWeeks = new Set(
            prev.filter(slot => slot.day === day && slot.period === period).map(slot => slot.week)
          ).size;
          const remainingWeeks = Math.max(0, requiredWeeks - alreadySelectedWeeks);
          
          if (remainingWeeks === 0) {
            // 已经选满了，不再添加
            return prev;
          }
          
          const newSlots = [];
          let selectedCount = 0;
          let currentWeek = 1;
          
          // 遍历所有可能的周次，直到选择满所需周次
          while (selectedCount < remainingWeeks && currentWeek <= totalWeeks) {
            // 检查当前周次、当前课时是否可用（包括传统禁排和通识大课禁排）
            const isAvailable = isSlotAvailable(currentWeek, day, period);
            
            if (isAvailable) {
              // 检查是否已经选择过
              const isAlreadySelected = prev.some(existingSlot => 
                existingSlot.week === currentWeek && 
                existingSlot.day === day && 
                existingSlot.period === period
              );
              
              if (!isAlreadySelected) {
                newSlots.push({ week: currentWeek, day, period });
                selectedCount++;
              }
            }
            
            currentWeek++;
          }
          
          return [...prev, ...newSlots];
        } else {
          // 单个选择
          return [...prev, { week, day, period }];
        }
      }
    });
  }, [blockedSlots, selectionMode, selectedClass, currentCourse, classes, importedBlockedTimes, largeClassEntries, totalWeeks, isSlotAvailable]);
  
  // 拖拽开始
  const handleDragStart = useCallback((day: number, period: number) => {
    setIsDragging(true);
    setDragStart({ day, period });
  }, []);
  
  // 拖拽进入
  const handleDragEnter = useCallback((day: number, period: number) => {
    if (isDragging && dragStart) {
      setDragEnd({ day, period });
      
      // 计算拖拽范围
      const startDay = Math.min(dragStart.day, day);
      const endDay = Math.max(dragStart.day, day);
      const startPeriod = Math.min(dragStart.period, period);
      const endPeriod = Math.max(dragStart.period, period);
      
      // 生成选择的时间格子
      const newSelectedSlots = [];
      for (let d = startDay; d <= endDay; d++) {
        for (let p = startPeriod; p <= endPeriod; p++) {
          newSelectedSlots.push({ week: selectedWeek, day: d, period: p });
        }
      }
      
      setSelectedTimeSlots(newSelectedSlots);
    }
  }, [isDragging, dragStart, selectedWeek]);
  
  // 拖拽结束
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
  }, []);
  
  // 检测冲突
  const detectConflicts = useCallback((week: number, day: number, period: number, courseId: string, classId: string) => {
    const newConflicts = [];
    
    // 获取当前课程和教室信息
    const currentCourse = courses.find(c => c.id === courseId);
    const currentRoomId = selectedRoom || rooms[0]?.id;
    const currentClass = classes.find(c => c.class_id === classId);
    const currentClassName = currentClass?.class_name || '';
    
    // 检查教室冲突 - 同一时间段，同一教室
    const roomConflict = scheduledClasses.find(schedule => {
      // 检查时间是否匹配
      if (schedule.week_number !== week || schedule.day_of_week !== day || schedule.period !== period) {
        return false;
      }
      // 排除当前课程的排课记录
      if (schedule.course_id === courseId) {
        return false;
      }
      // 检查是否使用同一教室
      if (currentRoomId && schedule.room_id === currentRoomId) {
        return true;
      }
      return false;
    });
    
    if (roomConflict) {
      const conflictingCourse = courses.find(c => c.id === roomConflict.course_id);
      const conflictingRoom = rooms.find(r => r.id === roomConflict.room_id);
      newConflicts.push({
        week,
        day,
        period,
        type: 'room' as const,
        message: `第${week}周${WEEKDAYS[day-1].label}第${period}节教室${conflictingRoom?.room_name || ''}已被占用（${conflictingCourse?.course_name || '未知课程'}）`,
        suggestion: '请选择其他教室或时间'
      });
    }
    
    // 检查班级冲突 - 同一时间段，同一班级
    const classConflict = scheduledClasses.find(schedule => {
      // 检查时间是否匹配
      if (schedule.week_number !== week || schedule.day_of_week !== day || schedule.period !== period) {
        return false;
      }
      // 排除当前课程的排课记录
      if (schedule.course_id === courseId) {
        return false;
      }
      // 检查是否同一班级
      if (classId && schedule.class_id === classId) {
        return true;
      }
      return false;
    });
    
    if (classConflict) {
      const conflictingCourse = courses.find(c => c.id === classConflict.course_id);
      newConflicts.push({
        week,
        day,
        period,
        type: 'class' as const,
        message: `第${week}周${WEEKDAYS[day-1].label}第${period}节班级${currentClassName}已有其他课程（${conflictingCourse?.course_name || '未知课程'}）`,
        suggestion: '请选择其他时间'
      });
    }
    
    // 检查教师冲突 - 排除当前课程的排课记录
    const teacherConflict = scheduledClasses.some(schedule => {
      // 首先排除当前课程的排课记录 - 只要course_id匹配就直接排除
      if (schedule.course_id === courseId) {
        return false;
      }
      
      const scheduleCourse = courses.find(c => c.id === schedule.course_id);
      const currentCourse = courses.find(c => c.id === courseId);
      // 获取当前课程的教师ID
      const currentTeacherId = currentCourse?.teacher_id;
      
      // 如果教师ID为'unknown'，使用教师名称进行比较
      const currentTeacherName = currentCourse?.teacher_name;
      const scheduleTeacherName = scheduleCourse?.teacher_name;
      
      // 调试信息 - 检测周二第5-6节的冲突
      if (day === 2 && (period === 5 || period === 6)) {
        // 过滤出周二第5-6节的排课记录
        const tuesday56Classes = scheduledClasses.filter(s => s.day_of_week === 2 && (s.period === 5 || s.period === 6));
        // 查找戏曲听唱2课程的信息
        const xiquCourse = courses.find(c => c.course_name === '戏曲听唱2');
        const duoshengCourse = courses.find(c => c.course_name === '多声部音乐分析与写作2');
      }
      
      // 只有当当前课程有教师信息，且与已排课的教师信息相同时，才检测教师冲突
      if (!scheduleCourse || !currentCourse) {
        return false;
      }
      
      // 检查教师是否匹配（优先使用teacher_id，如果为'unknown'则使用teacher_name）
      let isSameTeacher = false;
      if (currentTeacherId && currentTeacherId !== 'unknown' && scheduleCourse.teacher_id && scheduleCourse.teacher_id !== 'unknown') {
        // 使用teacher_id比较
        isSameTeacher = scheduleCourse.teacher_id === currentTeacherId;
      } else if (currentTeacherId === 'unknown' && scheduleCourse.teacher_id === 'unknown') {
        // 如果两个teacher_id都是'unknown'，必须使用teacher_name比较
        if (currentTeacherName && scheduleTeacherName) {
          isSameTeacher = scheduleTeacherName === currentTeacherName;
        } else {
          // 如果没有teacher_name，无法确定是否是同一教师，默认不匹配
          isSameTeacher = false;
        }
      } else if (currentTeacherName && scheduleTeacherName) {
        // 使用teacher_name比较
        isSameTeacher = scheduleTeacherName === currentTeacherName;
      }
      
      if (!isSameTeacher) {
        return false;
      }
      
      // 检查时间是否匹配
      if (schedule.week_number !== week || schedule.day_of_week !== day || schedule.period !== period) {
        return false;
      }
      return true;
    });
    
    if (teacherConflict) {
      // 获取当前课程的教师名称
      const currentCourse = courses.find(c => c.id === courseId);
      const currentTeacherName = currentCourse?.teacher_name || '当前教师';
      
      newConflicts.push({
        week,
        day,
        period,
        type: 'teacher' as const,
        message: `${currentTeacherName}在第${week}周${WEEKDAYS[day-1].label}第${period}节有其他课程`,
        suggestion: '请选择其他时间'
      });
    }
    
    return newConflicts;
  }, [scheduledClasses, courses, rooms, classes]);
  
  // 排课处理
  const handleSchedule = useCallback(async () => {
    if (!currentCourse || selectedTimeSlots.length === 0) {
      return;
    }
    
    try {
      setSaving(true);
      
      // 去重 selectedTimeSlots
      const uniqueTimeSlots = [];
      const seenSlots = new Set();
      
      for (const slot of selectedTimeSlots) {
        const slotKey = `${slot.week}-${slot.day}-${slot.period}`;
        if (!seenSlots.has(slotKey)) {
          seenSlots.add(slotKey);
          uniqueTimeSlots.push(slot);
        }
      }
      
      // 检测冲突
      const allConflicts = [];
      const newScheduleKeys = new Set();
      
      for (const slot of uniqueTimeSlots) {
        // 检查与现有排课的冲突
        const conflicts = detectConflicts(slot.week, slot.day, slot.period, currentCourse.course_id, selectedClass || currentCourse.class_id);
        allConflicts.push(...conflicts);
        
        // 检查与新排课的冲突（防止重复）
        const scheduleKey = `${slot.week}-${slot.day}-${slot.period}`;
        if (newScheduleKeys.has(scheduleKey)) {
          allConflicts.push({
            week: slot.week,
            day: slot.day,
            period: slot.period,
            type: 'time' as const,
            message: `第${slot.week}周${WEEKDAYS[slot.day-1].label}第${slot.period}节已在选择列表中`,
            suggestion: '请避免重复选择同一时间段'
          });
        } else {
          newScheduleKeys.add(scheduleKey);
        }
      }
      
      if (allConflicts.length > 0) {
        setConflicts(allConflicts);

        return;
      }
      
      // 创建排课记录
      setProgress(40);
      const newSchedules: any[] = [];
      
      if (selectedCourses.length > 1) {
        // 合班上课：为每个选中的课程创建排课记录
        for (const courseStatus of courseScheduleStatuses.filter(status => selectedCourses.includes(status.id))) {
          const course = courses.find(c => c.id === courseStatus.course_id);
          for (const slot of uniqueTimeSlots) {
            newSchedules.push({
              id: uuidv4(),
              course_id: courseStatus.course_id,
              class_id: courseStatus.class_id,
              room_id: selectedRoom || currentCourse.room_id || rooms[0]?.id || '',
              week_number: slot.week,
              day_of_week: slot.day,
              period: slot.period,
              start_week: slot.week,
              end_week: slot.week,
              teacher_id: course?.teacher_id || courseStatus.teacher_id || '',
              teacher_name: course?.teacher_name || courseStatus.teacher_name || '',
              created_at: new Date().toISOString(),
              status: 'draft'
            });
          }
        }
      } else {
        // 单个课程：为当前课程创建排课记录
        const course = courses.find(c => c.id === currentCourse.course_id);
        for (const slot of uniqueTimeSlots) {
          newSchedules.push({
            id: uuidv4(),
            course_id: currentCourse.course_id,
            class_id: selectedClass || currentCourse.class_id || '',
            room_id: selectedRoom || currentCourse.room_id || rooms[0]?.id || '',
            week_number: slot.week,
            day_of_week: slot.day,
            period: slot.period,
            start_week: slot.week,
            end_week: slot.week,
            teacher_id: course?.teacher_id || currentCourse.teacher_id || '',
            teacher_name: course?.teacher_name || currentCourse.teacher_name || '',
            created_at: new Date().toISOString(),
            status: 'draft'
          });
        }
      }

      setProgress(70);

      if (USE_DATABASE) {
        // 数据库模式：先删除旧排课，再写入新排课
        const targetPairs = new Set<string>();

        if (selectedCourses.length > 1) {
          const selectedStatuses = courseScheduleStatuses.filter(status => selectedCourses.includes(status.id));
          selectedStatuses.forEach(status => {
            targetPairs.add(`${status.course_id}-${status.class_id}`);
          });
        } else if (currentCourse) {
          const classId = selectedClass || currentCourse.class_id;
          targetPairs.add(`${currentCourse.course_id}-${classId}`);
        }

        const schedulesToDelete = scheduledClasses.filter((item: any) =>
          targetPairs.has(`${item.course_id}-${item.class_id}`)
        );

        for (const sc of schedulesToDelete) {
          await scheduleService.delete(sc.id);
        }

        setProgress(80);
        await scheduleService.createMany(
          newSchedules.map(s => ({
            ...s,
            semester_label: selectedSemesterLabel,
          }))
        );
      } else {
        // 本地模式：保留原有 localStorage 行为
        let currentStorageData = JSON.parse(localStorage.getItem('music_scheduler_scheduled_classes') || '[]');

        let filteredStorageData;
        if (selectedCourses.length > 1) {
          const selectedStatuses = courseScheduleStatuses.filter(status => selectedCourses.includes(status.id));
          const selectedClassIds = selectedStatuses.map(status => status.class_id);
          filteredStorageData = currentStorageData.filter((item: any) => 
            !(item.course_id === currentCourse.course_id && selectedClassIds.includes(item.class_id))
          );
        } else {
          filteredStorageData = currentStorageData.filter((item: any) => 
            item.course_id !== currentCourse.course_id
          );
        }
        
        setProgress(80);
        const updatedStorageData = [...filteredStorageData, ...newSchedules];
        localStorage.setItem('music_scheduler_scheduled_classes', JSON.stringify(updatedStorageData));
      }
      
      // 清空选择
      setSelectedTimeSlots([]);
      
      // 重新加载数据
      const [scheduleData] = await Promise.all([
        scheduleService.getAll()
      ]);
      setScheduledClasses(scheduleData || []);
      
      // 显示保存成功通知
      setShowSaveNotification(true);
      setTimeout(() => setShowSaveNotification(false), 3000);
      
    } catch (error) {
      console.error('排课失败:', error);
    } finally {
      setSaving(false);
    }
  }, [currentCourse, selectedTimeSlots, detectConflicts, rooms, scheduleService, selectedClass, selectedRoom, selectedCourses, courseScheduleStatuses, scheduledClasses, selectedSemesterLabel]);
  
  // 保存排课结果（与 handleSchedule 功能相同）
  const handleSaveSchedule = useCallback(async () => {
    if (!currentCourse || selectedTimeSlots.length === 0) {
      alert('请选择课程和时间');
      return;
    }
    
    // 检查是否选择了教室
    if (!selectedRoom) {
      alert('请选择教室');
      return;
    }
    
    // 检查已排课时是否与课程总学时一致
    // 计算已排课时 - 每个单元格计2课时
    const uniqueTimeSlots = new Set();
    selectedTimeSlots.forEach(slot => {
      if (slot.period % 2 === 1) {
        uniqueTimeSlots.add(`${slot.week}-${slot.day}-${slot.period}`);
      }
    });
    const scheduledHours = uniqueTimeSlots.size * 2;
    
    // 获取课程总学时
    const course = courses.find(c => c.id === currentCourse.course_id);
    const totalHours = course?.required_hours || course?.credit || 32;
    
    // 检查课时是否一致
    if (scheduledHours !== totalHours) {
      if (scheduledHours > totalHours) {
        alert(`已排课时（${scheduledHours}课时）超过了课程总学时（${totalHours}课时），请调整排课时间`);
      } else {
        alert(`已排课时（${scheduledHours}课时）少于课程总学时（${totalHours}课时），请继续排课`);
      }
      return;
    }
    
    // 检查是否有多个课程被选择（合班上课）
    let combinedCourses = [];
    if (selectedCourses.length > 1) {
      // 获取所有选中的课程
      combinedCourses = courseScheduleStatuses.filter(status => selectedCourses.includes(status.id));

    }
    
    try {
      setSaving(true);
      setShowProgress(true);
      setProgress(0);
      
      // 去重 selectedTimeSlots
      setProgress(10);
      const uniqueTimeSlotsList = [];
      const seenSlots = new Set();
      
      for (const slot of selectedTimeSlots) {
        const slotKey = `${slot.week}-${slot.day}-${slot.period}`;
        if (!seenSlots.has(slotKey)) {
          seenSlots.add(slotKey);
          uniqueTimeSlotsList.push(slot);
        }
      }
      
      // 检测冲突 - 排除当前课程的现有排课记录
      setProgress(20);
      const allConflicts = [];
      const newScheduleKeys = new Set();
      const currentCourseScheduleKeys = new Set();
      
      // 记录当前课程的现有排课时间槽
      for (const item of scheduledClasses) {
        if (item.course_id === currentCourse.course_id) {
          const key = `${item.week_number}-${item.day_of_week}-${item.period}`;
          currentCourseScheduleKeys.add(key);
        }
      }
      
      for (const slot of uniqueTimeSlotsList) {
        const slotKey = `${slot.week}-${slot.day}-${slot.period}`;
        
        // 跳过当前课程的现有排课记录（这些是我们要更新的）
        if (!currentCourseScheduleKeys.has(slotKey)) {
          // 检查与现有排课的冲突
          const conflicts = detectConflicts(slot.week, slot.day, slot.period, currentCourse.course_id, selectedClass || currentCourse.class_id);
          allConflicts.push(...conflicts);
        }
        
        // 检查与新排课的冲突（防止重复）
        if (newScheduleKeys.has(slotKey)) {
          allConflicts.push({
            week: slot.week,
            day: slot.day,
            period: slot.period,
            type: 'time' as const,
            message: `第${slot.week}周${WEEKDAYS[slot.day-1].label}第${slot.period}节已在选择列表中`,
            suggestion: '请避免重复选择同一时间段'
          });
        } else {
          newScheduleKeys.add(slotKey);
        }
      }
      
      if (allConflicts.length > 0) {
        // 按类型和时间段合并冲突提醒
        const mergedConflicts = [];
        const conflictMap = new Map();
        
        // 对冲突进行分组
        allConflicts.forEach(conflict => {
          // 使用类型、星期和节次作为分组键
          const key = `${conflict.type}-${conflict.day}-${conflict.period}`;
          if (!conflictMap.has(key)) {
            conflictMap.set(key, {
              type: conflict.type,
              day: conflict.day,
              period: conflict.period,
              weeks: [],
              message: conflict.message,
              suggestion: conflict.suggestion
            });
          }
          conflictMap.get(key).weeks.push(conflict.week);
        });
        
        // 对每个分组生成合并后的冲突提醒
        conflictMap.forEach(group => {
          // 对周次排序并生成周次范围
          const sortedWeeks = [...new Set(group.weeks)].sort((a, b) => Number(a) - Number(b));
          
          // 生成周次范围字符串
          let weekRange = '';
          if (sortedWeeks.length === 1) {
            weekRange = `第${sortedWeeks[0]}周`;
          } else {
            // 简单处理，直接显示周次列表
            weekRange = `第${sortedWeeks.join('、')}周`;
          }
          
          // 生成合并后的冲突信息
          mergedConflicts.push({
            ...group,
            message: `${weekRange}${WEEKDAYS[group.day-1].label}第${group.period}节${group.type === 'time' ? '已被占用' : '教师有其他课程'}`,
            weeks: sortedWeeks
          });
        });
        
        setConflicts(mergedConflicts);
        alert('检测到排课冲突，请调整排课时间');
        setShowProgress(false);
        return;
      }
      
      // 创建排课记录
      setProgress(40);
      const newSchedules: any[] = [];
      
      if (selectedCourses.length > 1) {
        // 合班上课：为每个选中的课程创建排课记录
        for (const courseStatus of courseScheduleStatuses.filter(status => selectedCourses.includes(status.id))) {
          const course = courses.find(c => c.id === courseStatus.course_id);
          for (const slot of uniqueTimeSlotsList) {
            newSchedules.push({
              id: uuidv4(),
              course_id: courseStatus.course_id,
              class_id: courseStatus.class_id,
              room_id: selectedRoom || currentCourse.room_id || rooms[0]?.id || '',
              week_number: slot.week,
              day_of_week: slot.day,
              period: slot.period,
              start_week: slot.week,
              end_week: slot.week,
              teacher_id: course?.teacher_id || courseStatus.teacher_id || '',
              teacher_name: course?.teacher_name || courseStatus.teacher_name || '',
              created_at: new Date().toISOString(),
              status: 'draft'
            });
          }
        }
      } else {
        // 单个课程：为当前课程创建排课记录
        const course = courses.find(c => c.id === currentCourse.course_id);
        for (const slot of uniqueTimeSlotsList) {
          newSchedules.push({
            id: uuidv4(),
            course_id: currentCourse.course_id,
            class_id: selectedClass || currentCourse.class_id || '',
            room_id: selectedRoom || currentCourse.room_id || rooms[0]?.id || '',
            week_number: slot.week,
            day_of_week: slot.day,
            period: slot.period,
            start_week: slot.week,
            end_week: slot.week,
            teacher_id: course?.teacher_id || currentCourse.teacher_id || '',
            teacher_name: course?.teacher_name || currentCourse.teacher_name || '',
            created_at: new Date().toISOString(),
            status: 'draft'
          });
        }
      }
      setProgress(70);

      if (USE_DATABASE) {
        // 数据库模式：删除当前课程相关旧排课，再写入新排课
        const targetPairs = new Set<string>();

        if (selectedCourses.length > 1) {
          const selectedStatuses = courseScheduleStatuses.filter(status => selectedCourses.includes(status.id));
          selectedStatuses.forEach(status => {
            targetPairs.add(`${status.course_id}-${status.class_id}`);
          });
        } else if (currentCourse) {
          const classId = selectedClass || currentCourse.class_id;
          targetPairs.add(`${currentCourse.course_id}-${classId}`);
        }

        const schedulesToDelete = scheduledClasses.filter((item: any) =>
          targetPairs.has(`${item.course_id}-${item.class_id}`)
        );

        for (const sc of schedulesToDelete) {
          await scheduleService.delete(sc.id);
        }

        setProgress(80);
        await scheduleService.createMany(
          newSchedules.map(s => ({
            ...s,
            semester_label: selectedSemesterLabel,
          }))
        );
      } else {
        // 本地存储模式：保留原逻辑
        let currentStorageData = JSON.parse(localStorage.getItem('music_scheduler_scheduled_classes') || '[]');
        
        let filteredStorageData;
        if (selectedCourses.length > 1) {
          const selectedStatuses = courseScheduleStatuses.filter(status => selectedCourses.includes(status.id));
          const selectedClassIds = selectedStatuses.map(status => status.class_id);
          filteredStorageData = currentStorageData.filter((item: any) => 
            !(item.course_id === currentCourse.course_id && selectedClassIds.includes(item.class_id))
          );
        } else {
          filteredStorageData = currentStorageData.filter((item: any) => 
            item.course_id !== currentCourse.course_id
          );
        }
        
        setProgress(80);
        const updatedStorageData = [...filteredStorageData, ...newSchedules];
        setProgress(90);
        localStorage.setItem('music_scheduler_scheduled_classes', JSON.stringify(updatedStorageData));
      }
      
      // 将排课时间添加到禁排时间中（教师、班级、教室）
      setProgress(92);
      await addScheduleToBlockedTimes(newSchedules, currentCourse);
      
      // 更新课程状态为已完成
      setCourseScheduleStatuses(prev => 
        prev.map(status => 
          status.course_id === currentCourse.course_id && status.class_id === currentCourse.class_id
            ? { ...status, status: 'completed' as const, scheduled_hours: status.total_hours }
            : status
        )
      );
      
      // 清空选择
      setSelectedTimeSlots([]);
      
      // 重新加载数据
      setProgress(95);
      const [scheduleData] = await Promise.all([
        scheduleService.getAll()
      ]);
      setScheduledClasses(scheduleData || []);
      
      // 通过WebSocket同步排课数据给其他教师
      try {
        await websocketService.sendCourseUpdate(scheduleData || []);
        console.log('Major course data synchronized via WebSocket');
      } catch (error) {
        console.error('WebSocket synchronization failed:', error);
      }
      
      // 显示保存成功通知
      setShowSaveNotification(true);
      setTimeout(() => setShowSaveNotification(false), 3000);
      
      setProgress(100);
      setTimeout(() => setShowProgress(false), 500);
      
    } catch (error) {
      console.error('保存排课失败:', error);
      setShowProgress(false);
    } finally {
      setSaving(false);
    }
  }, [currentCourse, selectedTimeSlots, detectConflicts, rooms, scheduleService, selectedClass, selectedRoom, addScheduleToBlockedTimes, selectedCourses, courseScheduleStatuses, scheduledClasses, selectedSemesterLabel]);
  
  // 批量排课处理
  const handleBatchSchedule = useCallback(async () => {
    if (!currentCourse || selectedTimeSlots.length === 0) {
      return;
    }
    
    try {
      setSaving(true);
      
      // 生成所有周次的排课记录
      const allSlots = [];
      for (const week of batchWeeks) {
        for (const slot of selectedTimeSlots) {
          allSlots.push({ ...slot, week });
        }
      }
      
      // 去重 allSlots
      const uniqueSlots = [];
      const seenSlots = new Set();
      
      for (const slot of allSlots) {
        const slotKey = `${slot.week}-${slot.day}-${slot.period}`;
        if (!seenSlots.has(slotKey)) {
          seenSlots.add(slotKey);
          uniqueSlots.push(slot);
        }
      }
      
      // 检测冲突
      const allConflicts = [];
      const newScheduleKeys = new Set();
      
      for (const slot of uniqueSlots) {
        // 检查与现有排课的冲突
        const conflicts = detectConflicts(slot.week, slot.day, slot.period, currentCourse.course_id, selectedClass || currentCourse.class_id);
        allConflicts.push(...conflicts);
        
        // 检查与新排课的冲突（防止重复）
        const scheduleKey = `${slot.week}-${slot.day}-${slot.period}`;
        if (newScheduleKeys.has(scheduleKey)) {
          allConflicts.push({
            week: slot.week,
            day: slot.day,
            period: slot.period,
            type: 'time' as const,
            message: `第${slot.week}周${WEEKDAYS[slot.day-1].label}第${slot.period}节已在复制列表中`,
            suggestion: '请检查复制选项，避免重复选择'
          });
        } else {
          newScheduleKeys.add(scheduleKey);
        }
      }
      
      if (allConflicts.length > 0) {
        setConflicts(allConflicts);

        return;
      }
      
      // 创建排课记录
      const newSchedules = uniqueSlots.map(slot => ({
        id: uuidv4(),
        course_id: currentCourse.course_id,
        class_id: selectedClass || currentCourse.class_id,
        room_id: selectedRoom || currentCourse.room_id || rooms[0]?.id || '',
        week_number: slot.week,
        day_of_week: slot.day,
        period: slot.period,
        start_week: slot.week,
        end_week: slot.week,
        created_at: new Date().toISOString(),
        status: 'draft' // 标记为草稿状态
      }));
      
      // 保存到本地存储
      // 先读取当前存储数据
      let currentStorageData = JSON.parse(localStorage.getItem('music_scheduler_scheduled_classes') || '[]');
      
      // 手动处理保存逻辑，确保不重复
      const finalSchedules = [];
      const existingScheduleKeys = new Set();
      
      // 记录现有排课的时间槽
      for (const item of currentStorageData) {
        if (item.course_id === currentCourse.course_id) {
          const key = `${item.week_number}-${item.day_of_week}-${item.period}`;
          existingScheduleKeys.add(key);
        }
      }
      
      // 只添加新的、不重复的排课
      for (const schedule of newSchedules) {
        const scheduleKey = `${schedule.week_number}-${schedule.day_of_week}-${schedule.period}`;
        if (!existingScheduleKeys.has(scheduleKey)) {
          finalSchedules.push(schedule);
          existingScheduleKeys.add(scheduleKey);

        }
      }
      

      
      // 合并并保存
      const updatedStorageData = [...currentStorageData, ...finalSchedules];
      localStorage.setItem('music_scheduler_scheduled_classes', JSON.stringify(updatedStorageData));
      

      
      // 清空选择
      setSelectedTimeSlots([]);
      
      // 重新加载数据
      const [scheduleData] = await Promise.all([
        scheduleService.getAll()
      ]);
      setScheduledClasses(scheduleData || []);
      
      // 显示保存成功通知
      setShowSaveNotification(true);
      setTimeout(() => setShowSaveNotification(false), 3000);
      
    } catch (error) {
      console.error('批量排课失败:', error);
    } finally {
      setSaving(false);
    }
  }, [currentCourse, selectedTimeSlots, batchWeeks, detectConflicts, rooms, scheduleService, selectedClass, selectedRoom]);
  
  // 清空选择
  const handleClearSelection = useCallback(() => {
    setSelectedTimeSlots([]);
    setConflicts([]);
  }, []);
  
  // 移除已选时段
  const handleRemoveSlot = useCallback((day: number, startPeriod: number, endPeriod: number, weeks: number[]) => {
    setSelectedTimeSlots(prev => {
      return prev.filter(slot => {
        // 检查是否在要移除的范围内
        const isInDay = slot.day === day;
        const isInPeriod = slot.period === startPeriod || slot.period === endPeriod;
        const isInWeek = weeks.includes(slot.week);
        return !(isInDay && isInPeriod && isInWeek);
      });
    });
  }, []);
  
  // 处理课程选择/取消选择（用于合班上课）
  const handleCourseToggle = useCallback((courseStatus: any) => {
    setSelectedCourses(prev => {
      if (prev.includes(courseStatus.id)) {
        // 取消选择
        return prev.filter(id => id !== courseStatus.id);
      } else {
        // 选择课程
        return [...prev, courseStatus.id];
      }
    });
  }, []);
  
  // 暂存功能
  const handleSaveDraft = useCallback(async () => {
    if (!currentCourse || selectedTimeSlots.length === 0) {
      return;
    }
    
    try {
      setSaving(true);
      
      // 去重 selectedTimeSlots
      const uniqueTimeSlots = [];
      const seenSlots = new Set();
      
      for (const slot of selectedTimeSlots) {
        const slotKey = `${slot.week}-${slot.day}-${slot.period}`;
        if (!seenSlots.has(slotKey)) {
          seenSlots.add(slotKey);
          uniqueTimeSlots.push(slot);
        }
      }
      
      // 检测冲突
      const allConflicts = [];
      const newScheduleKeys = new Set();
      
      for (const slot of uniqueTimeSlots) {
        // 检查与现有排课的冲突
        const conflicts = detectConflicts(slot.week, slot.day, slot.period, currentCourse.course_id, selectedClass || currentCourse.class_id);
        allConflicts.push(...conflicts);
        
        // 检查与新排课的冲突（防止重复）
        const scheduleKey = `${slot.week}-${slot.day}-${slot.period}`;
        if (newScheduleKeys.has(scheduleKey)) {
          allConflicts.push({
            week: slot.week,
            day: slot.day,
            period: slot.period,
            type: 'time' as const,
            message: `第${slot.week}周${WEEKDAYS[slot.day-1].label}第${slot.period}节已在选择列表中`,
            suggestion: '请避免重复选择同一时间段'
          });
        } else {
          newScheduleKeys.add(scheduleKey);
        }
      }
      
      if (allConflicts.length > 0) {
        setConflicts(allConflicts);

        return;
      }
      
      // 创建排课记录（草稿状态）
      const newSchedules = uniqueTimeSlots.map(slot => ({
        id: uuidv4(),
        course_id: currentCourse.course_id,
        class_id: selectedClass || currentCourse.class_id,
        room_id: selectedRoom || currentCourse.room_id || rooms[0]?.id || '',
        week_number: slot.week,
        day_of_week: slot.day,
        period: slot.period,
        start_week: slot.week,
        end_week: slot.week,
        created_at: new Date().toISOString(),
        status: 'draft' // 标记为草稿状态
      }));
      
      // 保存到本地存储
      // 先读取当前存储数据
      let currentStorageData = JSON.parse(localStorage.getItem('music_scheduler_scheduled_classes') || '[]');
      
      // 手动处理保存逻辑，确保不重复
      const finalSchedules = [];
      const existingScheduleKeys = new Set();
      
      // 记录现有排课的时间槽
      for (const item of currentStorageData) {
        if (item.course_id === currentCourse.course_id) {
          const key = `${item.week_number}-${item.day_of_week}-${item.period}`;
          existingScheduleKeys.add(key);
        }
      }
      
      // 只添加新的、不重复的排课
      for (const schedule of newSchedules) {
        const scheduleKey = `${schedule.week_number}-${schedule.day_of_week}-${schedule.period}`;
        if (!existingScheduleKeys.has(scheduleKey)) {
          finalSchedules.push(schedule);
          existingScheduleKeys.add(scheduleKey);

        }
      }
      

      
      // 合并并保存
      const updatedStorageData = [...currentStorageData, ...finalSchedules];
      localStorage.setItem('music_scheduler_scheduled_classes', JSON.stringify(updatedStorageData));
      

      
      // 清空选择
      setSelectedTimeSlots([]);
      
      // 重新加载数据
      const [scheduleData] = await Promise.all([
        scheduleService.getAll()
      ]);
      setScheduledClasses(scheduleData || []);
      
      // 显示保存成功通知
      setShowSaveNotification(true);
      setTimeout(() => setShowSaveNotification(false), 3000);
      
    } catch (error) {
      console.error('暂存排课失败:', error);
    } finally {
      setSaving(false);
    }
  }, [currentCourse, selectedTimeSlots, detectConflicts, rooms, scheduleService, selectedClass, selectedRoom]);
  
  // 提交功能
  const handleSubmit = useCallback(async () => {
    if (!currentCourse) {
      return;
    }
    

    
    try {
      setSaving(true);
      
      // 获取所有与当前课程相关的排课记录
      const allSchedules = await scheduleService.getAll();
      const courseSchedules = allSchedules.filter(schedule => 
        schedule.course_id === currentCourse.course_id
      );
      
      // 更新所有草稿状态的排课记录为已提交状态
      for (const schedule of courseSchedules) {
        if (schedule.status === 'draft') {
          await scheduleService.update(schedule.id, {
            ...schedule,
            status: 'submitted'
          });
        }
      }
      

      
      // 重新加载数据
      const [scheduleData] = await Promise.all([
        scheduleService.getAll()
      ]);
      setScheduledClasses(scheduleData || []);
      
      // 显示保存成功通知
      setShowSaveNotification(true);
      setTimeout(() => setShowSaveNotification(false), 3000);
      
    } catch (error) {
      console.error('提交排课失败:', error);
    } finally {
      setSaving(false);
    }
  }, [currentCourse, scheduleService]);
  
  // 打开编辑模态框 - 修改为回到当前排课信息模块
  const handleEditGroup = useCallback((group: any) => {
    // 提取当前组的周次
    const weeks = group.schedules.map((s: any) => s.week_number);
    const uniqueWeeks = [...new Set(weeks)];
    
    // 获取课程信息
    const course = courses.find(c => c.id === group.course_id);
    if (!course) return;
    
    // 创建课程状态对象
    const courseStatus: CourseScheduleStatus = {
      id: `${group.course_id}-${group.class_id}`,
      course_id: group.course_id,
      class_id: group.class_id,
      course_name: course.course_name,
      class_name: classes.find(c => c.class_id === group.class_id)?.class_name || '未知班级',
      room_id: group.room_id,
      room_name: rooms.find(r => r.id === group.room_id)?.room_name || '未选择教室',
      teacher_id: course.teacher_id,
      teacher_name: course.teacher_name || '未分配',
      total_hours: Number(course.required_hours || course.credit || 32),
      scheduled_hours: 0,
      status: 'in_progress',
      schedule_time: '',
      week_number: 0,
      day_of_week: 0,
      period: 0
    };
    
    // 删除当前课程的现有排课记录
    
    // 从本地存储中删除 - 合班上课：删除同一课程、同一教室的所有班级记录
    let currentStorageData = JSON.parse(localStorage.getItem('music_scheduler_scheduled_classes') || '[]');
    const filteredStorageData = currentStorageData.filter((item: any) => 
      !(item.course_id === group.course_id && item.room_id === group.room_id)
    );
    localStorage.setItem('music_scheduler_scheduled_classes', JSON.stringify(filteredStorageData));
    
    // 从状态中删除 - 合班上课：删除同一课程、同一教室的所有班级记录
    const filteredScheduledClasses = scheduledClasses.filter((item: any) => 
      !(item.course_id === group.course_id && item.room_id === group.room_id)
    );
    setScheduledClasses(filteredScheduledClasses);
    
    // 从禁排时间中移除该课程的记录
    removeScheduleFromBlockedTimes(group.course_id, group.class_id);
    
    // 设置当前课程
    setCurrentCourse(courseStatus);
    
    // 设置班级和教室
    setSelectedClass(group.class_id);
    setSelectedRoom(group.room_id);
    
    // 生成时间槽
    const timeSlots = [];
    for (const week of uniqueWeeks) {
      // 添加奇数节次
      timeSlots.push({ week, day: group.day_of_week, period: group.period });
      // 添加偶数节次
      timeSlots.push({ week, day: group.day_of_week, period: group.period + 1 });
    }
    
    // 设置选中的时间槽
    setSelectedTimeSlots(timeSlots);
    

  }, [courses, classes, rooms, scheduledClasses]);
  
  // 保存编辑后的排课记录
  const handleSaveEdit = useCallback(async () => {
    if (!editingGroup || editWeeks.length === 0) return;
    
    try {
      setSaving(true);
      
      // 1. 删除旧的排课记录
      for (const schedule of editingGroup.schedules) {
        await scheduleService.delete(schedule.id);
      }
      
      // 2. 创建新的排课记录
      const newSchedules = [];
      
      // 获取课程ID和班级ID
      const courseId = editingGroup.course_id || editingGroup.schedules[0]?.course_id;
      const classId = editingGroup.class_id || editingGroup.schedules[0]?.class_id;
      
      if (!courseId || !classId) {
        console.error('缺少课程ID或班级ID');
        return;
      }
      
      // 为每个选择的周次创建新的排课记录
      for (const week of editWeeks) {
        // 创建两节连排的两个记录
        for (let periodOffset = 0; periodOffset < 2; periodOffset++) {
          const actualPeriod = editPeriod + periodOffset;
          
          const newSchedule = {
            course_id: courseId,
            class_id: classId,
            room_id: editRoomId || editingGroup.room_id,
            week_number: week,
            day_of_week: editDay,
            period: actualPeriod,
            status: 'draft',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          
          const savedSchedule = await scheduleService.create(newSchedule);
          newSchedules.push(savedSchedule);
        }
      }
      
      // 3. 重新加载数据
      const [scheduleData] = await Promise.all([
        scheduleService.getAll()
      ]);
      setScheduledClasses(scheduleData || []);
      
      // 4. 关闭模态框
      setShowEditModal(false);
      
      // 5. 显示保存成功通知
      setShowSaveNotification(true);
      setTimeout(() => setShowSaveNotification(false), 2000);
    } catch (error) {
      console.error('保存排课记录失败:', error);
    } finally {
      setSaving(false);
    }
  }, [editingGroup, editWeeks, editDay, editPeriod, editRoomId, scheduleService]);
  
  // 加载教师列表
  useEffect(() => {
    const loadTeachers = async () => {
      try {
        const teachers = await teacherService.getAll();
        setAvailableTeachers(teachers);
        
        // 设置目标教师
        if (isAdmin) {
          // 管理员默认显示所有教师的课程，不设置 targetTeacher
          // 用户可以通过下拉框选择特定教师或"所有教师"
        } else {
          // 非管理员只能查看自己的课程
          setTargetTeacher(teacher);
        }
      } catch (error) {
        console.error('加载教师列表失败:', error);
      }
    };
    
    loadTeachers();
  }, [teacher, isAdmin]);
  
  // 加载数据
  useEffect(() => {
    
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // 获取所有数据
                const [coursesData, scheduleData, allRooms, classesData, blockedSlotsData, weekConfigData, largeClassData] = await Promise.all([
                  courseService.getAll(),
                  scheduleService.getAll(),
                  roomService.getAll(),
                  classService.getAll(),
                  blockedSlotService.getBySemester(selectedSemesterLabel),
                  weekConfigService.getBySemester(selectedSemesterLabel),
                  largeClassScheduleService.getEntries(selectedSemesterLabel),
                ]);
                
                // 从周次配置中获取总周数
                if (weekConfigData && weekConfigData.total_weeks) {
                  setTotalWeeks(weekConfigData.total_weeks);
                } else {
                  setTotalWeeks(18); // 默认值
                }
                
                // 从本地存储加载导入的禁排时间
                const importedBlockedTimesData = localStorage.getItem('music_scheduler_imported_blocked_times');
                if (importedBlockedTimesData) {
                  try {
                    const importedData = JSON.parse(importedBlockedTimesData);
                    setImportedBlockedTimes(importedData);
                  } catch (error) {
                    console.error('加载导入禁排时间失败:', error);
                  }
                }
        
        // 添加默认数据（如果本地存储为空）
        let finalCoursesData = coursesData || [];
        let finalRoomsData = allRooms || [];
        let finalClassesData = classesData || [];
        let finalBlockedSlotsData = blockedSlotsData || [];
        let finalWeekConfigData = weekConfigData || [];
        let finalLargeClassData = largeClassData || [];

        // 获取教师列表，用于匹配教师工号
        const teachers = await teacherService.getAll();
        
        // 修复课程数据中的 teacher_id：根据教师姓名匹配教师工号
        finalCoursesData = finalCoursesData.map(course => {
          // 如果 teacher_id 为空、'unknown' 或 'user-temp-xxx' 格式，尝试根据 teacher_name 匹配
          if (!course.teacher_id || course.teacher_id === 'unknown' || course.teacher_id.startsWith('user-temp-')) {
            const matchedTeacher = teachers.find(t => 
              t.name === course.teacher_name || 
              t.full_name === course.teacher_name
            );
            if (matchedTeacher) {
              return {
                ...course,
                teacher_id: matchedTeacher.teacher_id || matchedTeacher.id
              };
            }
          }
          return course;
        });

        // 更新状态
        setCourses(finalCoursesData);
        setScheduledClasses(scheduleData || []);
        setRooms(finalRoomsData);
        setClasses(finalClassesData);
        setBlockedSlots(finalBlockedSlotsData);
        setLargeClassEntries(finalLargeClassData);

        // 过滤出专业大课数据
        const majorCoursesData = finalCoursesData.filter(course => (course as any).teaching_type === '专业大课');
        
        // 生成课程排课状态
        const generatedCourseStatuses = majorCoursesData.map(course => {
          // 根据课程的major_class字段找到对应的班级
          // 同时通过班级ID和班级名称来查找班级
          const courseClass = finalClassesData.find(cls => 
            cls.class_id === course.major_class || cls.class_name === course.major_class
          );
          
          const classId = courseClass?.class_id || course.major_class || '';
          
          // 检查是否已有排课记录
          const existingSchedules = scheduleData?.filter((s: any) => 
            s.course_id === course.id && s.class_id === classId
          ) || [];
          const hasScheduled = existingSchedules.length > 0;
          const scheduledHours = hasScheduled ? (course.credit || 32) : 0;
          
          const defaultRoom = finalRoomsData[0];
          return {
            id: `${course.id}_${classId || 'default'}`,
            course_id: course.id,
            class_id: classId,
            course_name: course.course_name,
            class_name: courseClass?.class_name || course.major_class || '未选择班级',
            room_id: defaultRoom?.id || '',
            room_name: defaultRoom?.room_name || '未选择教室',
            teacher_id: course.teacher_id,
            teacher_name: course.teacher_name || course.teacher_id,
            total_hours: Number(course.credit || 32),
            scheduled_hours: scheduledHours,
            status: hasScheduled ? 'completed' : 'pending' as CourseStatus,
            schedule_time: hasScheduled ? '已安排' : '未安排',
            week_number: 0,
            day_of_week: 0,
            period: 0
          };
        });
        
        // 统计班级分布
        const classDistribution: Record<string, number> = {};
        generatedCourseStatuses.forEach(status => {
          const className = status.class_name;
          classDistribution[className] = (classDistribution[className] || 0) + 1;
        });
        
        setCourseScheduleStatuses(generatedCourseStatuses);

        // 初始化时间网格
        initializeTimeGrid();

        // 从本地存储加载导入的禁排时间
        const storedImportedBlockedTimes = localStorage.getItem('music_scheduler_imported_blocked_times');
        if (storedImportedBlockedTimes) {
          try {
            const parsedData = JSON.parse(storedImportedBlockedTimes);
            // 保留所有数据：从Excel导入的禁排时间、通识大课数据、周次配置禁排数据和排课数据
            setImportedBlockedTimes(parsedData || []);
          } catch (error) {
            console.error('解析导入的禁排时间失败:', error);
          }
        }

        
        // 一次性同步所有数据到导入的禁排时间列表
        syncAllDataToImportedBlockedTimes(
          scheduleData || [],
          finalCoursesData,
          finalClassesData,
          finalRoomsData,
          finalLargeClassData,
          finalBlockedSlotsData,
          finalWeekConfigData
        );
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [targetTeacher, teacher, selectedSemesterLabel]);

  // 当选择的周次变化时，更新时间网格
  useEffect(() => {
    if (currentCourse) {
    }
  }, [selectedWeek, currentCourse]);

  // 渲染页面
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* 页面标题和控制栏 - 实现用户要求的布局 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-center mb-4 sm:mb-0 w-full sm:w-auto">
            <h1 className="text-2xl font-bold text-gray-800 mr-4">专业大课排管理</h1>
            
            {/* 教师筛选框 */}
            {isAdmin && (
              <div className="mr-4 w-full sm:w-64">
                <TeacherSelector
                  targetTeacher={targetTeacher}
                  availableTeachers={availableTeachers}
                  isAdmin={isAdmin}
                  onTeacherChange={(teacherId) => {
                    if (teacherId === 'all') {
                      setTargetTeacher(null);
                    } else {
                      const teacher = availableTeachers.find(t => t.teacher_id === teacherId);
                      if (teacher) {
                        setTargetTeacher(teacher);
                      }
                    }
                  }}
                />
              </div>
            )}
          </div>
          
          {/* 操作按钮组 - 只对管理员显示 */}
          {isAdmin && (
            <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-start sm:justify-end">
              {/* 导出排课结果按钮 */}
              <button
                onClick={handleExportScheduleResults}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md flex items-center gap-2"
              >
                <Save size={16} />
                导出排课结果
              </button>
              {/* 导入排课结果按钮 */}
              <div className="relative">
                <button
                  onClick={() => document.getElementById('importScheduleInput')?.click()}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md flex items-center gap-2"
                >
                  <Save size={16} />
                  导入排课结果
                </button>
                <input
                  id="importScheduleInput"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImportScheduleResults}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 导入成功通知 */}
        {importSuccess && (
          <div className="mb-4 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded">
            <p>禁排时间导入成功！</p>
          </div>
        )}

        {/* 保存成功通知 */}
        {showSaveNotification && (
          <div className="fixed top-4 right-4 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded shadow-lg animate-in slide-in-from-top-5 duration-300">
            <p>操作成功！</p>
          </div>
        )}

        {/* 进度条 */}
        {showProgress && (
          <div className="fixed top-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-80 animate-in slide-in-from-top-5 duration-300">
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">处理中...</span>
              <span className="text-sm text-gray-500">{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-300 ease-in-out"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* 主要内容区域 */}
        <div className="space-y-6">
          {/* 课程列表 - 独占一行 */}
          <div>
            <CourseList
              paginatedCourses={paginatedCourses}
              courses={filteredCourses}
              classes={classes}
              rooms={rooms}
              startIndex={startIndex}
              totalCourses={totalCourses}
              totalPages={totalPages}
              currentPage={currentPage}
              pageSize={pageSize}
              courseScheduleStatuses={courseScheduleStatuses}
              targetTeacher={targetTeacher}
              isAdmin={isAdmin}
              onPageChange={handlePageChange}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
              onCourseSelect={handleCourseSelect}
              onCourseToggle={handleCourseToggle}
              selectedCourses={selectedCourses}
              selectedRoom={selectedRoom}
              onRoomChange={setSelectedRoom}
              currentCourse={currentCourse}
              showSaveNotification={showSaveNotification}
              onSchedule={handleSchedule}
            />
          </div>

          {/* 排课结果 */}
          <ScheduleResult
            scheduledClasses={filteredScheduledClasses}
            courses={courses}
            rooms={rooms}
            classes={classes}
            courseScheduleStatuses={courseScheduleStatuses}
            currentCourse={currentCourse}
            selectedTimeSlots={selectedTimeSlots}
            selectedRoom={selectedRoom}
            targetTeacher={targetTeacher}
            currentTeacher={teacher}
            selectedCourses={selectedCourses}
            onEditGroup={handleEditGroup}
            onDeleteGroup={async (group) => {
              if (window.confirm('确定要删除这个排课记录吗？')) {
                try {
                  setSaving(true);
                  setShowProgress(true);
                  setProgress(0);
                  
                  // 删除排课记录
                  const totalSchedules = group.schedules.length;
                  for (let i = 0; i < totalSchedules; i++) {
                    const schedule = group.schedules[i];
                    await scheduleService.delete(schedule.id);
                    setProgress(Math.floor((i + 1) / totalSchedules * 80));
                  }
                  
                  // 从禁排时间中移除该课程的记录
                  removeScheduleFromBlockedTimes(group.course_id, group.class_id);
                  
                  // 重新加载数据
                  setProgress(85);
                  const [scheduleData] = await Promise.all([
                    scheduleService.getAll()
                  ]);
                  setScheduledClasses(scheduleData || []);
                  
                  // 显示删除成功通知
                  setShowSaveNotification(true);
                  setTimeout(() => setShowSaveNotification(false), 3000);
                  
                  setProgress(100);
                  setTimeout(() => setShowProgress(false), 500);
                  
                } catch (error) {
                  console.error('删除排课记录失败:', error);
                  setShowProgress(false);
                } finally {
                  setSaving(false);
                }
              }
            }}
            onSaveSchedule={handleSaveSchedule}
          />

          {/* 冲突检测 - 放在排课结果下方，确保教师能看到 */}
          {conflicts.length > 0 && (
            <ConflictDetector conflicts={conflicts} />
          )}

          {/* 周次选择和时间网格 - 合并为一个整体模块 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="mb-2 border-b border-gray-200 pb-2">
              <WeekSelector
                totalWeeks={totalWeeks}
                selectedWeek={selectedWeek}
                scheduledClasses={scheduledClasses}
                currentCourse={currentCourse}
                selectedClass={selectedClass}
                classes={classes}
                blockedSlots={blockedSlots}
                importedBlockedTimes={importedBlockedTimes}
                onWeekChange={setSelectedWeek}
                semesterStartDate={semesterStartDate}
              />
            </div>
            <div className="mt-0">
              <TimeGrid
                timeGridStatus={timeGridStatus}
                selectedWeek={selectedWeek}
                selectionMode={selectionMode}
                selectedTimeSlots={selectedTimeSlots}
                scheduledClasses={scheduledClasses}
                currentCourse={currentCourse}
                selectedClass={selectedClass}
                selectedRoom={selectedRoom}
                classes={classes}
                courses={courses}
                rooms={rooms}
                blockedSlots={blockedSlots}
                largeClassEntries={largeClassEntries}
                importedBlockedTimes={importedBlockedTimes}
                isDragging={isDragging}
                dragStart={dragStart}
                dragEnd={dragEnd}
                onClearSelection={handleClearSelection}
                onTimeSlotClick={handleTimeSlotClick}
                onDragStart={handleDragStart}
                onDragEnter={handleDragEnter}
                onDragEnd={handleDragEnd}
                onSelectionModeChange={(mode) => setSelectionMode(mode)}
                onRemoveSlot={handleRemoveSlot}
                selectedSemesterLabel={selectedSemesterLabel}
                semesterStartDate={semesterStartDate}
              />
            </div>
          </div>
        </div>

        {/* 禁排时间列表 */}
        <div className="mt-6 bg-white p-4 rounded-lg shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">禁排时间</h2>
          
          {importedBlockedTimes.length > 0 && (
            <div className="mb-4">
              <div className="grid grid-cols-5 gap-2">
                <input
                  type="text"
                  placeholder="班级筛选"
                  value={filters.class_name}
                  onChange={(e) => setFilters({ ...filters, class_name: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="周次筛选"
                  value={filters.week}
                  onChange={(e) => setFilters({ ...filters, week: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="星期筛选"
                  value={filters.day}
                  onChange={(e) => setFilters({ ...filters, day: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="节次筛选"
                  value={filters.period}
                  onChange={(e) => setFilters({ ...filters, period: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="禁排原因筛选"
                  value={filters.reason}
                  onChange={(e) => setFilters({ ...filters, reason: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
          
          <div className="overflow-x-auto">
            {importedBlockedTimes.length > 0 ? (
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">班级</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">周次</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">星期</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">节次</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">禁排原因</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(() => {
                    // 筛选数据
                    const filteredData = importedBlockedTimes.filter(item => {
                      // 班级筛选
                      if (filters.class_name && !item.class_name.toLowerCase().includes(filters.class_name.toLowerCase())) {
                        return false;
                      }
                      // 周次筛选
                      if (filters.week && !item.weeks.some((week: number) => week.toString().includes(filters.week))) {
                        return false;
                      }
                      // 星期筛选
                      if (filters.day) {
                        const dayMap: Record<number, string> = {
                          1: '周一',
                          2: '周二',
                          3: '周三',
                          4: '周四',
                          5: '周五',
                          6: '周六',
                          7: '周日'
                        };
                        const dayName = dayMap[item.day];
                        if (!dayName.toLowerCase().includes(filters.day.toLowerCase())) {
                          return false;
                        }
                      }
                      // 节次筛选
                      if (filters.period && !item.periods.some((period: number) => period.toString().includes(filters.period))) {
                        return false;
                      }
                      // 禁排原因筛选
                      if (filters.reason && !item.reason.toLowerCase().includes(filters.reason.toLowerCase())) {
                        return false;
                      }
                      return true;
                    });

                    // 合并逻辑（两遍）：
                    // 1. 禁排原因、星期、节次相同时，将周次合并到一行
                    // 2. 禁排原因、节次、周次相同时，将星期合并到一行（如劳动节放假 周五、周六、周日）
                    const periodsKey = (p: number[]) => [...(p || [])].sort((a, b) => a - b).join(',');
                    const weeksKey = (w: number[]) => [...(w || [])].sort((a, b) => a - b).join(',');
                    type MergeItem = { class_name: string; weeks: number[]; days: number[]; periods: number[]; reason: string };
                    // 第一遍：按 (班级, 星期, 节次, 原因) 合并周次
                    const mergeMap1 = new Map<string, MergeItem>();
                    filteredData.forEach(item => {
                      const key = `${item.class_name}|${item.day}|${periodsKey(item.periods || [])}|${item.reason || ''}`;
                      if (mergeMap1.has(key)) {
                        const existing = mergeMap1.get(key)!;
                        const mergedWeeks = [...new Set([...existing.weeks, ...(item.weeks || [])])].sort((a, b) => a - b);
                        mergeMap1.set(key, { ...existing, weeks: mergedWeeks });
                      } else {
                        mergeMap1.set(key, {
                          class_name: item.class_name,
                          weeks: [...(item.weeks || [])].sort((a, b) => a - b),
                          days: [item.day],
                          periods: [...(item.periods || [])].sort((a, b) => a - b),
                          reason: item.reason || ''
                        });
                      }
                    });
                    const afterPass1 = Array.from(mergeMap1.values());
                    // 第二遍：按 (班级, 周次, 节次, 原因) 合并星期
                    const mergeMap2 = new Map<string, MergeItem>();
                    afterPass1.forEach(item => {
                      const key = `${item.class_name}|${weeksKey(item.weeks)}|${periodsKey(item.periods)}|${item.reason}`;
                      if (mergeMap2.has(key)) {
                        const existing = mergeMap2.get(key)!;
                        const mergedDays = [...new Set([...existing.days, ...item.days])].sort((a, b) => a - b);
                        mergeMap2.set(key, { ...existing, days: mergedDays });
                      } else {
                        mergeMap2.set(key, { ...item });
                      }
                    });
                    const mergedData = Array.from(mergeMap2.values()).sort((a, b) => a.days[0] - b.days[0] || a.weeks[0] - b.weeks[0]);
                    
                    // 计算分页
                    const totalItems = mergedData.length;
                    const totalPages = Math.ceil(totalItems / blockedTimesPageSize);
                    const startIndex = (blockedTimesPage - 1) * blockedTimesPageSize;
                    const endIndex = startIndex + blockedTimesPageSize;
                    const paginatedData = mergedData.slice(startIndex, endIndex);
                    
                    return (
                      <>
                        {paginatedData.map((item, index) => {
                          const dayNames: Record<number, string> = {
                            1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日'
                          };
                          const dayDisplay = (item.days || []).map((d: number) => dayNames[d] || '').filter(Boolean).join('、');
                          return (
                            <tr key={index}>
                              <td className="px-4 py-2 text-sm text-gray-900">{item.class_name}</td>
                              <td className="px-4 py-2 text-sm text-gray-900">{item.weeks.join(', ')}</td>
                              <td className="px-4 py-2 text-sm text-gray-900">{dayDisplay}</td>
                              <td className="px-4 py-2 text-sm text-gray-900">{item.periods.join(', ')}</td>
                              <td className="px-4 py-2 text-sm text-gray-900">{item.reason}</td>
                            </tr>
                          );
                        })}
                        
                        {/* 分页控件 */}
                        {totalPages >= 1 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <div className="text-sm text-gray-600">
                                    共 {totalItems} 条记录，第 {blockedTimesPage} / {totalPages} 页
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-600">每页显示:</span>
                                    <select
                                      value={blockedTimesPageSize}
                                      onChange={(e) => {
                                        setBlockedTimesPageSize(Number(e.target.value));
                                        setBlockedTimesPage(1);
                                      }}
                                      className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                    >
                                      <option value={5}>5条</option>
                                      <option value={10}>10条</option>
                                      <option value={20}>20条</option>
                                      <option value={50}>50条</option>
                                    </select>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {/* 首页 */}
                                  <button
                                    onClick={() => setBlockedTimesPage(1)}
                                    disabled={blockedTimesPage === 1}
                                    className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    首页
                                  </button>
                                  
                                  {/* 上一页 */}
                                  <button
                                    onClick={() => setBlockedTimesPage(prev => Math.max(1, prev - 1))}
                                    disabled={blockedTimesPage === 1}
                                    className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    上一页
                                  </button>
                                  
                                  {/* 页码显示 */}
                                  <span className="px-3 py-1 text-sm">
                                    {blockedTimesPage} / {totalPages}
                                  </span>
                                  
                                  {/* 下一页 */}
                                  <button
                                    onClick={() => setBlockedTimesPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={blockedTimesPage === totalPages}
                                    className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    下一页
                                  </button>
                                  
                                  {/* 尾页 */}
                                  <button
                                    onClick={() => setBlockedTimesPage(totalPages)}
                                    disabled={blockedTimesPage === totalPages}
                                    className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    尾页
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <p>暂无禁排时间</p>
                <p className="text-sm mt-2">点击顶部的"导入禁排"按钮导入Excel文件</p>
              </div>
            )}
          </div>
        </div>

        {/* 编辑模态框 */}
        {showEditModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
              <h3 className="text-lg font-semibold mb-4">编辑排课记录</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">周次</label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    value={editWeeks.join(',')}
                    onChange={(e) => setEditWeeks(e.target.value.split(',').map(Number))}
                  >
                    <option value="1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18">所有周</option>
                    <option value="1,2,3,4,5,6">第1-6周</option>
                    <option value="7,8,9,10,11,12">第7-12周</option>
                    <option value="13,14,15,16,17,18">第13-18周</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">星期</label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    value={editDay}
                    onChange={(e) => setEditDay(Number(e.target.value))}
                  >
                    {WEEKDAYS.map(day => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">节次</label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    value={editPeriod}
                    onChange={(e) => setEditPeriod(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5].map(period => (
                      <option key={period} value={period}>{period}节</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">教室</label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    value={editRoomId}
                    onChange={(e) => setEditRoomId(e.target.value)}
                  >
                    <option value="">请选择教室</option>
                    {rooms.map(room => (
                      <option key={room.id} value={room.id}>{room.room_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-6 flex gap-2 justify-end">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
