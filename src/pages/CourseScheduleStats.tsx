import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { BarChart3, Users, BookOpen, CheckCircle, Clock, TrendingUp, ChevronDown, ChevronUp, Music, User, GraduationCap, XCircle, AlertCircle, Search, Filter } from 'lucide-react';
import { courseService, scheduleService, teacherService, classService, roomService, studentService } from '../services';
import { INSTRUMENT_TO_FACULTY } from '../types';

interface ScheduleInfo {
  weekDay: string;
  period: string;
  weeks: string;
  room: string;
  className: string;
}

interface CourseDetail {
  id: string;
  name: string;
  totalHours: number;
  scheduledHours: number;
  remainingHours: number;
  completionRate: number;
  classes: string[];
  schedules: ScheduleInfo[];
}

interface TeacherStats {
  teacherId: string;
  teacherName: string;
  teacherJobId: string;
  majorCourses: number;
  majorHours: number;
  majorScheduled: number;
  majorRemaining: number;
  individualCourses: number;
  individualHours: number;
  individualScheduled: number;
  individualRemaining: number;
  totalCourses: number;
  totalHours: number;
  totalScheduled: number;
  totalRemaining: number;
  completionRate: number;
  majorCourseDetails: CourseDetail[];
  individualCourseDetails: CourseDetail[];
}

interface StudentCourseStatus {
  instrument: string;
  teacherName: string;
  isScheduled: boolean;
  scheduleCount: number;
  scheduleDetails: ScheduleInfo[];
}

interface StudentScheduleStats {
  studentId: string;
  studentName: string;
  studentNumber: string;
  majorClass: string;
  primaryInstrument?: string;
  secondaryInstruments: string[];
  courseStatuses: StudentCourseStatus[];
  totalCourses: number;
  scheduledCourses: number;
  unscheduledCourses: number;
}

interface ClassStudentStats {
  className: string;
  students: StudentScheduleStats[];
  totalStudents: number;
  totalScheduled: number;
  totalUnscheduled: number;
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

export default function CourseScheduleStats() {
  const { user, isAdmin, onlineTeachers, refreshOnlineTeachers } = useAuth();
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [scheduledClasses, setScheduledClasses] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'completion' | 'hours' | 'name' | 'jobId'>('jobId');
  const [filterType, setFilterType] = useState<'all' | 'major' | 'individual'>('all');
  const [activeTab, setActiveTab] = useState<'major' | 'individual' | 'student'>('major');
  const [expandedClass, setExpandedClass] = useState<string | null>(null);
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [studentFilterClass, setStudentFilterClass] = useState<string>('all');
  const [studentFilterStatus, setStudentFilterStatus] = useState<'all' | 'scheduled' | 'unscheduled'>('all');

  // 加载数据
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [teachersData, coursesData, schedulesData, classesData, roomsData, studentsData] = await Promise.all([
          teacherService.getAll(),
          courseService.getAll(),
          scheduleService.getAll(),
          classService.getAll(),
          roomService.getAll(),
          studentService.getAll()
        ]);
        setTeachers(teachersData);
        setCourses(coursesData);
        setScheduledClasses(schedulesData);
        setClasses(classesData);
        setRooms(roomsData);
        setStudents(studentsData);
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
    
    // 刷新在线教师列表
    if (refreshOnlineTeachers) {
      refreshOnlineTeachers();
    }
  }, [refreshOnlineTeachers]);

  // 计算每位教师的排课统计
  const teacherStats = useMemo(() => {
    const stats: TeacherStats[] = [];

    // 全局调试：查看排课记录格式
    if (scheduledClasses.length > 0) {
    }

    teachers.forEach(teacher => {
      // 辅助函数：检查教师是否参与课程（支持多位教师合课）
      const isTeacherInCourse = (course: any, teacher: any): boolean => {
        // 先检查 teacher_id 匹配
        if (course.teacher_id === teacher.teacher_id) return true;
        
        // 再检查 teacher_name，支持多位教师以逗号、顿号分隔
        const courseTeacherName = course.teacher_name || '';
        const teacherName = teacher.name || teacher.full_name || '';
        
        if (courseTeacherName && teacherName) {
          // 分割多位教师名称
          const courseTeachers = courseTeacherName.split(/[,，、]/).map((t: string) => t.trim());
          // 检查当前教师是否在课程教师列表中
          return courseTeachers.some((t: string) => 
            t === teacherName || 
            t.includes(teacherName) || 
            teacherName.includes(t)
          );
        }
        
        return false;
      };

      // 专业大课
      const majorCourses = courses.filter(course =>
        (course as any).teaching_type === '专业大课' &&
        isTeacherInCourse(course, teacher)
      );

      // 专业小课（小组课）
      const individualCourses = courses.filter(course =>
        ((course as any).teaching_type === '专业小课' || (course as any).teaching_type === '小组课') &&
        isTeacherInCourse(course, teacher)
      );

      // 计算专业大课课时和详情
      const majorCourseDetails: CourseDetail[] = [];
      let majorScheduled = 0;
      
      majorCourses.forEach(course => {
        const courseSchedules = scheduledClasses.filter(schedule => 
          schedule.course_id === course.id
        );
        let courseScheduledHours = 0;
        courseSchedules.forEach(schedule => {
          if (schedule.period % 2 === 1) courseScheduledHours += 2;
        });
        majorScheduled += courseScheduledHours;
        
        // 使用与专业大课页面一致的逻辑：优先使用 total_hours，其次 required_hours，然后 credit/credit_hours，最后默认32
        const courseTotalHours = parseInt((course as any).total_hours) || parseInt((course as any).required_hours) || parseInt((course as any).credit) || parseInt((course as any).credit_hours) || 32;
        const courseRemaining = Math.max(0, courseTotalHours - courseScheduledHours);
        
        // 获取排课的班级
        const scheduleClassesList = courseSchedules.map(s => {
          const cls = classes.find(c => c.class_id === s.class_id);
          return cls?.class_name || s.class_id;
        }).filter((v, i, a) => a.indexOf(v) === i); // 去重
        
        // 获取详细的排课信息（时间、教室）- 合并相同星期、节次、教室和班级的排课
        // 按 room_id + class_id 分组，然后合并周次
        const roomClassMap = new Map<string, { 
          roomId: string, 
          roomName: string, 
          classId: string, 
          className: string,
          schedules: Map<string, { weekDay: string, period: string, weeks: number[] }>
        }>();
        
        const weekDayMap: { [key: number]: string } = {
          1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日'
        };
        
        courseSchedules.forEach(s => {
          const weekDay = weekDayMap[s.day_of_week] || `周${s.day_of_week}`;
          const periodNum = s.period || 1;
          // 将节次转换为范围显示（1->1-2, 3->3-4, 5->5-6, 7->7-8, 9->9-10, 11->11-12）
          const periodRange = periodNum % 2 === 1 ? `${periodNum}-${periodNum + 1}` : `${periodNum - 1}-${periodNum}`;
          const period = `第${periodRange}节`;
          const weekNum = s.week_number || 1;
          const roomId = s.room_id || '';
          const roomName = rooms.find(r => r.id === roomId || r.room_id === roomId)?.room_name || roomId || '未分配';
          const classId = s.class_id || '';
          const className = classes.find(c => c.class_id === classId)?.class_name || classId;
          
          // 按 room + class 分组
          const roomClassKey = `${roomId}-${classId}`;
          if (!roomClassMap.has(roomClassKey)) {
            roomClassMap.set(roomClassKey, {
              roomId,
              roomName,
              classId,
              className,
              schedules: new Map()
            });
          }
          
          const roomClassGroup = roomClassMap.get(roomClassKey)!;
          const scheduleKey = `${weekDay}-${period}`;
          
          if (roomClassGroup.schedules.has(scheduleKey)) {
            const existing = roomClassGroup.schedules.get(scheduleKey)!;
            if (!existing.weeks.includes(weekNum)) {
              existing.weeks.push(weekNum);
            }
          } else {
            roomClassGroup.schedules.set(scheduleKey, {
              weekDay,
              period,
              weeks: [weekNum]
            });
          }
        });
        
        // 将周次数组转换为范围字符串
        const formatWeekRanges = (weeks: number[]): string => {
          if (weeks.length === 0) return '';
          const sorted = [...weeks].sort((a, b) => a - b);
          const ranges: string[] = [];
          let start = sorted[0];
          let end = sorted[0];
          
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === end + 1) {
              end = sorted[i];
            } else {
              if (start === end) {
                ranges.push(`${start}`);
              } else {
                ranges.push(`${start}-${end}`);
              }
              start = end = sorted[i];
            }
          }
          
          if (start === end) {
            ranges.push(`${start}`);
          } else {
            ranges.push(`${start}-${end}`);
          }
          
          return `第${ranges.join('、')}周`;
        };
        
        // 转换为 ScheduleInfo 数组
        const scheduleDetails: ScheduleInfo[] = [];
        roomClassMap.forEach(roomClassGroup => {
          roomClassGroup.schedules.forEach(schedule => {
            scheduleDetails.push({
              weekDay: schedule.weekDay,
              period: schedule.period,
              weeks: formatWeekRanges(schedule.weeks),
              room: roomClassGroup.roomName,
              className: roomClassGroup.className
            });
          });
        });
        
        majorCourseDetails.push({
          id: course.id,
          name: (course as any).course_name || course.name,
          totalHours: courseTotalHours,
          scheduledHours: courseScheduledHours,
          remainingHours: courseRemaining,
          completionRate: courseTotalHours > 0 ? (courseScheduledHours / courseTotalHours) * 100 : 0,
          classes: scheduleClassesList,
          schedules: scheduleDetails
        });
      });
      
      const majorHours = majorCourseDetails.reduce((sum, c) => sum + c.totalHours, 0);

      // 计算专业小课课时和详情（小组课）
      // 小组课逻辑：先获取该教师的所有排课记录，再按课程分组统计
      const individualCourseDetails: CourseDetail[] = [];
      let individualScheduled = 0;

      // 调试日志

      // 获取该教师的所有小组课排课记录
      const teacherId = teacher.teacher_id || teacher.id;
      const teacherName = teacher.name || teacher.full_name;

      // 先检查该教师的排课记录（不限于小组课）
      // 注意：教师ID应统一使用工号格式（如 '120150239'）
      const teacherAllSchedules = scheduledClasses.filter(schedule => {
        const scheduleTeacherId = schedule.teacher_id;
        const scheduleTeacherName = schedule.teacher_name;
        // 多种方式匹配教师：ID匹配（包含字符串包含）、姓名匹配
        const isIdMatch = scheduleTeacherId === teacherId ||
                         scheduleTeacherId === teacher.id ||
                         String(scheduleTeacherId).includes(String(teacherId)) ||
                         String(teacherId).includes(String(scheduleTeacherId));
        const isNameMatch = scheduleTeacherName === teacherName;
        return isIdMatch || isNameMatch;
      });

      if (teacherAllSchedules.length > 0) {
      }

      const teacherIndividualSchedules = scheduledClasses.filter(schedule => {
        // 匹配教师（使用与上面相同的匹配逻辑）
        const scheduleTeacherId = schedule.teacher_id;
        const scheduleTeacherName = schedule.teacher_name;

        const isIdMatch = scheduleTeacherId === teacherId ||
                         scheduleTeacherId === teacher.id ||
                         String(scheduleTeacherId).includes(String(teacherId)) ||
                         String(teacherId).includes(String(scheduleTeacherId));
        const isNameMatch = scheduleTeacherName === teacherName;
        const isTeacherMatch = isIdMatch || isNameMatch;

        if (!isTeacherMatch) return false;

        // 检查对应的课程是否是小组课
        const course = courses.find(c => c.id === schedule.course_id || (c as any).course_id === schedule.course_id);
        const teachingType = (course as any)?.teaching_type || (schedule as any).teaching_type;
        const courseType = (course as any)?.course_type || (schedule as any).course_type;
        const courseName = (course as any)?.course_name || (schedule as any).course_name || '';

        // 判断是否是小组课：
        // 1. 优先使用 teaching_type
        // 2. 否则使用 course_type：钢琴、声乐、器乐都是小组课（理论课除外）
        // 3. 最后根据课程名称判断
        let isIndividualCourse = teachingType === '小组课' || teachingType === '专业小课';

        // 如果 teaching_type 未定义，使用 course_type 判断
        if (!teachingType && courseType) {
          // 钢琴、声乐、器乐都是小组课，理论课不是
          isIndividualCourse = courseType === '钢琴' || courseType === '声乐' || courseType === '器乐';
        }

        // 如果 course_type 也未定义，根据课程名称判断
        if (!teachingType && !courseType && courseName) {
          // 排除大课和理论课
          const isLargeClass = courseName.includes('大课') ||
                              courseName.includes('音乐鉴赏') ||
                              courseName.includes('艺术实践') ||
                              courseName.includes('理论');
          // 包含小组课关键词
          const isIndividualKeyword = courseName.includes('6*') ||
                                     courseName.includes('钢琴') ||
                                     courseName.includes('声乐') ||
                                     courseName.includes('器乐') ||
                                     courseName.includes('古筝') ||
                                     courseName.includes('竹笛') ||
                                     courseName.includes('葫芦丝');

          isIndividualCourse = !isLargeClass && isIndividualKeyword;
        }

        // 调试：记录未匹配的课程信息
        if (!isIndividualCourse && course) {
        }

        return isIndividualCourse;
      });

      if (teacherIndividualSchedules.length > 0 || teacherAllSchedules.length > 0) {
      }

      // 按课程ID分组统计
      const courseScheduleMap = new Map<string, any[]>();
      teacherIndividualSchedules.forEach(schedule => {
        const courseId = schedule.course_id;
        if (!courseScheduleMap.has(courseId)) {
          courseScheduleMap.set(courseId, []);
        }
        courseScheduleMap.get(courseId)?.push(schedule);
      });

      // 统计每个课程的课时
      courseScheduleMap.forEach((schedules, courseId) => {
        const course = courses.find(c => c.id === courseId);
        if (!course) return;

        // 计算已排课时（与排课结果页保持一致：1 个节次记为 1 课时）
        let courseScheduledHours = 0;
        const uniqueTimeSlots = new Set<string>();
        schedules.forEach(schedule => {
          // 使用星期+节次+周次作为唯一标识
          const timeKey = `${schedule.day_of_week}-${schedule.period}-${schedule.start_week || schedule.week_number}`;
          if (!uniqueTimeSlots.has(timeKey)) {
            uniqueTimeSlots.add(timeKey);
            courseScheduledHours += 1;
          }
        });
        individualScheduled += courseScheduledHours;

        // 课程总学时：小组课按实际排课计算总课时，而不是使用课程定义的学时
        // 因为小组课可能由多个小组组成，总课时是所有小组课时的总和
        const definedTotalHours = parseInt((course as any).total_hours) || parseInt((course as any).required_hours) || parseInt((course as any).credit) || parseInt((course as any).credit_hours) || 32;
        // 实际总课时 = 已排课时 + 剩余课时（按课程定义）
        // 但对于小组课，实际总课时应该是所有小组的课时总和
        const courseTotalHours = Math.max(definedTotalHours, courseScheduledHours);
        const courseRemaining = Math.max(0, courseTotalHours - courseScheduledHours);

        // 获取排课的班级（从学生信息中推断）
        const scheduleClassesList = schedules.map(s => {
          const student = students.find(stu => stu.id === s.student_id);
          return student?.major_class || s.class_id;
        }).filter((v, i, a) => v && a.indexOf(v) === i); // 去重

        // 获取详细的排课信息
        const weekDayMap: { [key: number]: string } = {
          1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日'
        };

        // 收集所有使用的琴房
        const usedRoomIds = new Set<string>();
        schedules.forEach(s => {
          if (s.room_id) usedRoomIds.add(s.room_id);
        });
        const usedRoomNames = Array.from(usedRoomIds).map(roomId => {
          const room = rooms.find(r => r.id === roomId || r.room_id === roomId);
          return room?.room_name || roomId;
        }).filter(Boolean);

        const scheduleDetails: ScheduleInfo[] = [];
        const timeSlotMap = new Map<string, { weekDay: string, period: string, weeks: number[], roomId: string }>();

        schedules.forEach(s => {
          const weekDay = weekDayMap[s.day_of_week] || `周${s.day_of_week}`;
          const periodNum = s.period || 1;
          const periodRange = periodNum % 2 === 1 ? `${periodNum}-${periodNum + 1}` : `${periodNum - 1}-${periodNum}`;
          const period = `第${periodRange}节`;
          const weekNum = s.start_week || s.week_number || 1;
          const roomId = s.room_id || '';
          const classId = s.class_id || '';
          const className = classes.find(c => c.class_id === classId)?.class_name || scheduleClassesList[0] || '';

          const timeKey = `${weekDay}-${period}-${roomId}`;
          if (timeSlotMap.has(timeKey)) {
            const existing = timeSlotMap.get(timeKey)!;
            if (!existing.weeks.includes(weekNum)) {
              existing.weeks.push(weekNum);
            }
          } else {
            timeSlotMap.set(timeKey, {
              weekDay,
              period,
              weeks: [weekNum],
              roomId
            });
          }
        });

        // 将周次数组转换为范围字符串
        const formatWeekRanges = (weeks: number[]): string => {
          if (weeks.length === 0) return '';
          const sorted = [...weeks].sort((a, b) => a - b);
          const ranges: string[] = [];
          let start = sorted[0];
          let end = sorted[0];

          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === end + 1) {
              end = sorted[i];
            } else {
              if (start === end) {
                ranges.push(`${start}`);
              } else {
                ranges.push(`${start}-${end}`);
              }
              start = end = sorted[i];
            }
          }

          if (start === end) {
            ranges.push(`${start}`);
          } else {
            ranges.push(`${start}-${end}`);
          }

          return `第${ranges.join('、')}周`;
        };

        timeSlotMap.forEach((value, key) => {
          const room = rooms.find(r => r.id === value.roomId || r.room_id === value.roomId);
          scheduleDetails.push({
            weekDay: value.weekDay,
            period: value.period,
            weeks: formatWeekRanges(value.weeks),
            room: room?.room_name || value.roomId || '未分配',
            className: scheduleClassesList.join('、') || ''
          });
        });

        individualCourseDetails.push({
          id: course.id,
          name: (course as any).course_name || course.name,
          totalHours: courseTotalHours,
          scheduledHours: courseScheduledHours,
          remainingHours: courseRemaining,
          completionRate: courseTotalHours > 0 ? (courseScheduledHours / courseTotalHours) * 100 : 0,
          classes: scheduleClassesList,
          schedules: scheduleDetails
        });
      });

      // 如果没有排课记录，但教师有小组课课程，也要显示课程列表（已排0课时）
      individualCourses.forEach(course => {
        const existingDetail = individualCourseDetails.find(d => d.id === course.id);
        if (!existingDetail) {
          const courseTotalHours = parseInt((course as any).total_hours) || parseInt((course as any).required_hours) || parseInt((course as any).credit) || parseInt((course as any).credit_hours) || 32;
          individualCourseDetails.push({
            id: course.id,
            name: (course as any).course_name || course.name,
            totalHours: courseTotalHours,
            scheduledHours: 0,
            remainingHours: courseTotalHours,
            completionRate: 0,
            classes: [],
            schedules: []
          });
        }
      });

      const individualHours = individualCourseDetails.reduce((sum, c) => sum + c.totalHours, 0);

      const totalCourses = majorCourses.length + individualCourses.length;
      const totalHours = majorHours + individualHours;
      const totalScheduled = majorScheduled + individualScheduled;
      const totalRemaining = Math.max(0, totalHours - totalScheduled);
      const completionRate = totalHours > 0 ? (totalScheduled / totalHours) * 100 : 0;

      stats.push({
        teacherId: teacher.teacher_id || teacher.id,
        teacherName: teacher.name || teacher.full_name,
        teacherJobId: teacher.teacher_id || '',
        majorCourses: majorCourses.length,
        majorHours,
        majorScheduled,
        majorRemaining: Math.max(0, majorHours - majorScheduled),
        individualCourses: individualCourses.length,
        individualHours,
        individualScheduled,
        individualRemaining: Math.max(0, individualHours - individualScheduled),
        totalCourses,
        totalHours,
        totalScheduled,
        totalRemaining,
        completionRate,
        majorCourseDetails,
        individualCourseDetails
      });
    });

    // 根据排序方式排序
    return stats.sort((a, b) => {
      switch (sortBy) {
        case 'completion':
          return b.completionRate - a.completionRate;
        case 'hours':
          return b.totalHours - a.totalHours;
        case 'name':
          return a.teacherName.localeCompare(b.teacherName);
        case 'jobId':
          return a.teacherJobId.localeCompare(b.teacherJobId);
        default:
          return a.teacherJobId.localeCompare(b.teacherJobId);
      }
    });
  }, [teachers, courses, scheduledClasses, students, classes, rooms]);

  // 根据筛选类型过滤
  const filteredStats = useMemo(() => {
    if (filterType === 'all') return teacherStats;
    if (filterType === 'major') {
      return teacherStats.filter(stat => stat.majorCourses > 0);
    }
    if (filterType === 'individual') {
      return teacherStats.filter(stat => stat.individualCourses > 0);
    }
    return teacherStats;
  }, [teacherStats, filterType]);

  // 计算总计
  const totalStats = useMemo(() => {
    return filteredStats.reduce((acc, stat) => ({
      totalCourses: acc.totalCourses + stat.totalCourses,
      totalHours: acc.totalHours + stat.totalHours,
      totalScheduled: acc.totalScheduled + stat.totalScheduled,
      totalRemaining: acc.totalRemaining + stat.totalRemaining,
      majorCourses: acc.majorCourses + stat.majorCourses,
      majorHours: acc.majorHours + stat.majorHours,
      majorScheduled: acc.majorScheduled + stat.majorScheduled,
      individualCourses: acc.individualCourses + stat.individualCourses,
      individualHours: acc.individualHours + stat.individualHours,
      individualScheduled: acc.individualScheduled + stat.individualScheduled
    }), { 
      totalCourses: 0, totalHours: 0, totalScheduled: 0, totalRemaining: 0,
      majorCourses: 0, majorHours: 0, majorScheduled: 0,
      individualCourses: 0, individualHours: 0, individualScheduled: 0
    });
  }, [filteredStats]);

  const studentScheduleStats = useMemo(() => {
    const weekDayMap: { [key: number]: string } = {
      1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日'
    };

    const formatWeekRanges = (weeks: number[]): string => {
      if (weeks.length === 0) return '';
      const sorted = [...weeks].sort((a, b) => a - b);
      const ranges: string[] = [];
      let start = sorted[0];
      let end = sorted[0];
      
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) {
          end = sorted[i];
        } else {
          if (start === end) {
            ranges.push(`${start}`);
          } else {
            ranges.push(`${start}-${end}`);
          }
          start = end = sorted[i];
        }
      }
      
      if (start === end) {
        ranges.push(`${start}`);
      } else {
        ranges.push(`${start}-${end}`);
      }
      
      return `第${ranges.join('、')}周`;
    };

    const classMap = new Map<string, StudentScheduleStats[]>();
    
    students.forEach(student => {
      const courseStatuses: StudentCourseStatus[] = [];
      
      const primaryInstrument = student.primary_instrument;
      const secondaryInstruments = student.secondary_instruments || [];
      
      const isUpgradeStudent = student.student_type === 'upgrade' || 
                              student.major_class?.includes('2304') ||
                              student.class_name?.includes('2304');
      
      const allInstruments: { instrument: string; type: 'primary' | 'secondary'; teacherId?: string; teacherName?: string }[] = [];
      
      if (primaryInstrument && !isUpgradeStudent) {
        const primaryTeacherId = student.assigned_teachers?.primary_teacher_id;
        const primaryTeacherName = student.assigned_teachers?.primary_teacher_name;
        allInstruments.push({
          instrument: primaryInstrument,
          type: 'primary',
          teacherId: primaryTeacherId,
          teacherName: primaryTeacherName
        });
      } else if (isUpgradeStudent) {
        allInstruments.push({
          instrument: '',
          type: 'primary',
          teacherId: undefined,
          teacherName: ''
        });
      }
      
      if (student.secondary_instrument1 || secondaryInstruments[0]) {
        const sec1TeacherId = student.assigned_teachers?.secondary1_teacher_id;
        const sec1TeacherName = student.assigned_teachers?.secondary1_teacher_name;
        allInstruments.push({
          instrument: student.secondary_instrument1 || secondaryInstruments[0],
          type: 'secondary',
          teacherId: sec1TeacherId,
          teacherName: sec1TeacherName
        });
      }
      
      if (student.secondary_instrument2 || secondaryInstruments[1]) {
        const sec2TeacherId = student.assigned_teachers?.secondary2_teacher_id;
        const sec2TeacherName = student.assigned_teachers?.secondary2_teacher_name;
        allInstruments.push({
          instrument: student.secondary_instrument2 || secondaryInstruments[1],
          type: 'secondary',
          teacherId: sec2TeacherId,
          teacherName: sec2TeacherName
        });
      }
      
      if (student.secondary_instrument3 || secondaryInstruments[2]) {
        const sec3TeacherId = student.assigned_teachers?.secondary3_teacher_id;
        const sec3TeacherName = student.assigned_teachers?.secondary3_teacher_name;
        allInstruments.push({
          instrument: student.secondary_instrument3 || secondaryInstruments[2],
          type: 'secondary',
          teacherId: sec3TeacherId,
          teacherName: sec3TeacherName
        });
      }
      
      allInstruments.forEach(({ instrument, type, teacherId, teacherName }) => {
        const studentSchedules = scheduledClasses.filter(schedule => {
          const isStudentMatch = schedule.student_id === student.id || 
                                schedule.student_id === student.student_id;
          
          if (!isStudentMatch) return false;
          
          const scheduleCourse = courses.find(c => c.id === schedule.course_id || (c as any).course_id === schedule.course_id);
          const scheduleCourseType = scheduleCourse?.course_type || (schedule as any).course_type;
          const scheduleTeachingType = (scheduleCourse as any)?.teaching_type || (schedule as any).teaching_type;
          
          const isGroupCourse = scheduleTeachingType === '小组课' || 
                               scheduleTeachingType === '专业小课' ||
                               scheduleCourseType === '钢琴' || 
                               scheduleCourseType === '声乐' || 
                               scheduleCourseType === '器乐';
          
          return isGroupCourse;
        });
        
        const instrumentSchedules = studentSchedules.filter(schedule => {
          const scheduleCourse = courses.find(c => c.id === schedule.course_id || (c as any).course_id === schedule.course_id);
          const scheduleCourseType = scheduleCourse?.course_type || (schedule as any).course_type;
          const coursePrimaryInstrument = scheduleCourse?.primary_instrument || (scheduleCourse as any)?.primary_instrument;
          const courseSecondaryInstrument = scheduleCourse?.secondary_instrument || (scheduleCourse as any)?.secondary_instrument;
          const courseName = scheduleCourse?.course_name || (schedule as any).course_name || '';
          
          const instrumentMatch = scheduleCourseType === instrument ||
                                 coursePrimaryInstrument === instrument ||
                                 courseSecondaryInstrument === instrument ||
                                 courseName.includes(instrument) ||
                                 courseName === instrument;
          
          const instrumentFaculty = INSTRUMENT_TO_FACULTY[instrument];
          const isInstrumentTypeMatch = instrumentFaculty === 'INSTRUMENT' && scheduleCourseType === '器乐';
          
          return instrumentMatch || isInstrumentTypeMatch;
        });
        
        const scheduleDetails: ScheduleInfo[] = [];
        const timeSlotMap = new Map<string, { weekDay: string, period: string, weeks: number[], roomId: string }>();
        
        instrumentSchedules.forEach(s => {
          const weekDay = weekDayMap[s.day_of_week] || `周${s.day_of_week}`;
          const periodNum = s.period || 1;
          const periodRange = periodNum % 2 === 1 ? `${periodNum}-${periodNum + 1}` : `${periodNum - 1}-${periodNum}`;
          const period = `第${periodRange}节`;
          const weekNum = s.start_week || s.week_number || 1;
          const roomId = s.room_id || '';
          
          const timeKey = `${weekDay}-${period}-${roomId}`;
          if (timeSlotMap.has(timeKey)) {
            const existing = timeSlotMap.get(timeKey)!;
            if (!existing.weeks.includes(weekNum)) {
              existing.weeks.push(weekNum);
            }
          } else {
            timeSlotMap.set(timeKey, {
              weekDay,
              period,
              weeks: [weekNum],
              roomId
            });
          }
        });
        
        timeSlotMap.forEach((value, key) => {
          const room = rooms.find(r => r.id === value.roomId || r.room_id === value.roomId);
          scheduleDetails.push({
            weekDay: value.weekDay,
            period: value.period,
            weeks: formatWeekRanges(value.weeks),
            room: room?.room_name || value.roomId || '未分配',
            className: student.major_class || ''
          });
        });
        
        const teacher = teachers.find(t => 
          t.id === teacherId || 
          t.teacher_id === teacherId ||
          t.name === teacherName ||
          t.full_name === teacherName
        );
        
        courseStatuses.push({
          instrument,
          teacherName: instrument ? (teacherName || teacher?.name || teacher?.full_name || '未分配') : '',
          isScheduled: instrument ? instrumentSchedules.length > 0 : false,
          scheduleCount: instrumentSchedules.length,
          scheduleDetails
        });
      });
      
      const validCourseStatuses = courseStatuses.filter(c => c.instrument);
      const totalCourses = validCourseStatuses.length;
      const scheduledCourses = validCourseStatuses.filter(c => c.isScheduled).length;
      const unscheduledCourses = totalCourses - scheduledCourses;
      
      const studentStat: StudentScheduleStats = {
        studentId: student.id,
        studentName: student.name,
        studentNumber: student.student_id,
        majorClass: student.major_class || student.class_name || '未知班级',
        primaryInstrument,
        secondaryInstruments: secondaryInstruments.filter(Boolean),
        courseStatuses,
        totalCourses,
        scheduledCourses,
        unscheduledCourses
      };
      
      const className = studentStat.majorClass;
      if (!classMap.has(className)) {
        classMap.set(className, []);
      }
      classMap.get(className)!.push(studentStat);
    });
    
    const result: ClassStudentStats[] = [];
    classMap.forEach((studentsList, className) => {
      result.push({
        className,
        students: studentsList.sort((a, b) => a.studentName.localeCompare(b.studentName)),
        totalStudents: studentsList.length,
        totalScheduled: studentsList.reduce((sum, s) => sum + s.scheduledCourses, 0),
        totalUnscheduled: studentsList.reduce((sum, s) => sum + s.unscheduledCourses, 0)
      });
    });
    
    return result.sort((a, b) => a.className.localeCompare(b.className));
  }, [students, scheduledClasses, courses, teachers, rooms]);

  const filteredStudentStats = useMemo(() => {
    let result = studentScheduleStats;
    
    if (studentFilterClass !== 'all') {
      result = result.filter(c => c.className === studentFilterClass);
    }
    
    if (studentSearchTerm) {
      const term = studentSearchTerm.toLowerCase();
      result = result.map(classStat => ({
        ...classStat,
        students: classStat.students.filter(student => 
          student.studentName.toLowerCase().includes(term) ||
          (student.studentNumber && String(student.studentNumber).toLowerCase().includes(term))
        )
      })).filter(classStat => classStat.students.length > 0);
    }
    
    if (studentFilterStatus !== 'all') {
      result = result.map(classStat => ({
        ...classStat,
        students: classStat.students.filter(student => {
          if (studentFilterStatus === 'scheduled') {
            return student.scheduledCourses > 0;
          } else {
            return student.unscheduledCourses > 0;
          }
        })
      })).filter(classStat => classStat.students.length > 0);
    }
    
    return result;
  }, [studentScheduleStats, studentFilterClass, studentSearchTerm, studentFilterStatus]);

  const uniqueClasses = useMemo(() => {
    return [...new Set(students.map(s => s.major_class || s.class_name).filter(Boolean))].sort();
  }, [students]);

  const studentTotalStats = useMemo(() => {
    return filteredStudentStats.reduce((acc, classStat) => ({
      totalStudents: acc.totalStudents + classStat.totalStudents,
      totalScheduled: acc.totalScheduled + classStat.totalScheduled,
      totalUnscheduled: acc.totalUnscheduled + classStat.totalUnscheduled
    }), { totalStudents: 0, totalScheduled: 0, totalUnscheduled: 0 });
  }, [filteredStudentStats]);

  const teacherGroupClassStats = useMemo(() => {
    const HOURS_PER_STUDENT = 16;
    const stats: TeacherGroupClassStats[] = [];

    teachers.forEach(teacher => {
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

      students.forEach(student => {
        const studentClass = student.major_class || student.class_name || '未知班级';
        const studentId = student.id;
        const studentName = student.name;
        const studentNumber = student.student_id;
        const teacherIdForFilter = teacher.id || teacher.teacher_id;

        const getStudentScheduledHours = (sId: string, tId: string, instrumentName?: string): number => {
          const studentSchedules = scheduledClasses.filter(sc => {
            const isStudentMatch = sc.student_id === sId;
            if (!isStudentMatch) return false;
            
            const isTeacherMatch = sc.teacher_id === tId || 
                                   sc.teacher_id === teacher.teacher_id ||
                                   sc.teacher_id === teacher.id;
            if (!isTeacherMatch) return false;
            
            const course = courses.find(c => c.id === sc.course_id || (c as any).course_id === sc.course_id);
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
          
          return studentSchedules.length;
        };

        if (student.assigned_teachers?.primary_teacher_id === teacher.id ||
            student.assigned_teachers?.primary_teacher_id === teacher.teacher_id) {
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
          if (assignment.teacherId === teacher.id || assignment.teacherId === teacher.teacher_id) {
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
          teacherId: teacher.id || teacher.teacher_id,
          teacherName: teacher.name || teacher.full_name,
          teacherJobId: teacher.teacher_id || '',
          facultyName: teacher.faculty_name || '',
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
  }, [teachers, students, scheduledClasses, courses]);

  const teacherGroupTotalStats = useMemo(() => {
    return teacherGroupClassStats.reduce((acc, stat) => ({
      totalTeachers: acc.totalTeachers + 1,
      totalStudents: acc.totalStudents + stat.totalStudentCount,
      totalHours: acc.totalHours + stat.totalHours,
      scheduledHours: acc.scheduledHours + stat.scheduledHours,
      remainingHours: acc.remainingHours + stat.remainingHours
    }), { totalTeachers: 0, totalStudents: 0, totalHours: 0, scheduledHours: 0, remainingHours: 0 });
  }, [teacherGroupClassStats]);

  // 格式化百分比
  const formatRate = (rate: number) => `${rate.toFixed(1)}%`;

  // 获取进度条颜色
  const getProgressColor = (rate: number) => {
    if (rate >= 100) return 'bg-green-500';
    if (rate >= 75) return 'bg-blue-500';
    if (rate >= 50) return 'bg-yellow-500';
    if (rate >= 25) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // 展开/收起详情
  const toggleExpand = (teacherId: string) => {
    setExpandedTeacher(expandedTeacher === teacherId ? null : teacherId);
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-700">您没有权限查看此页面</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">排课统计</h1>
            <p className="text-sm text-gray-500">专业大课和专业小课排课进度详情</p>
          </div>
        </div>

        {/* 在线教师显示 - 仅管理员可见 */}
        {onlineTeachers && onlineTeachers.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">在线教师：</span>
            <div className="flex items-center gap-1 flex-wrap">
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
                  <span className={`w-2 h-2 rounded-full ${
                    t.status === 'online' ? 'bg-green-500' : 
                    t.status === 'busy' ? 'bg-yellow-500' : 'bg-gray-400'
                  }`}></span>
                  <span>{t.name}</span>
                  {t.id === user?.id && <span className="text-green-600">(我)</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 教师列表 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        {/* 选项卡 */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {activeTab === 'student' ? '学生小组课排课详情' : '教师排课详情'}
          </h2>
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('major')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'major'
                  ? 'bg-white text-purple-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              专业大课
            </button>
            <button
              onClick={() => setActiveTab('individual')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'individual'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              小组课
            </button>
            <button
              onClick={() => setActiveTab('student')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'student'
                  ? 'bg-white text-green-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              学生小组课
            </button>
          </div>
        </div>
        
        <div className="space-y-4">
          {activeTab === 'student' ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索学生姓名或学号..."
                    value={studentSearchTerm}
                    onChange={(e) => setStudentSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
                <select
                  value={studentFilterClass}
                  onChange={(e) => setStudentFilterClass(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                >
                  <option value="all">全部班级</option>
                  {uniqueClasses.map(className => (
                    <option key={className} value={className}>{className}</option>
                  ))}
                </select>
                <select
                  value={studentFilterStatus}
                  onChange={(e) => setStudentFilterStatus(e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                >
                  <option value="all">全部状态</option>
                  <option value="scheduled">有已排课程</option>
                  <option value="unscheduled">有未排课程</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-100">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-green-600" />
                    <span className="text-sm text-green-700">学生总数</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700 mt-1">{studentTotalStats.totalStudents}</p>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-4 border border-blue-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-blue-600" />
                    <span className="text-sm text-blue-700">已排专业课次</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-700 mt-1">{studentTotalStats.totalScheduled}</p>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-lg p-4 border border-orange-100">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-orange-600" />
                    <span className="text-sm text-orange-700">未排专业课次</span>
                  </div>
                  <p className="text-2xl font-bold text-orange-700 mt-1">{studentTotalStats.totalUnscheduled}</p>
                </div>
              </div>

              {filteredStudentStats.map((classStat) => (
                <div key={classStat.className} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div 
                    className="p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => setExpandedClass(expandedClass === classStat.className ? null : classStat.className)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-green-100 to-emerald-100 rounded-lg flex items-center justify-center">
                          <GraduationCap className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-900">{classStat.className}</h3>
                          <p className="text-sm text-gray-500">
                            {classStat.totalStudents}名学生 · 
                            <span className="text-green-600 ml-1">{classStat.totalScheduled}门已排</span>
                            <span className="text-orange-600 ml-1">· {classStat.totalUnscheduled}门未排</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="w-32">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-500">排课率</span>
                            <span className="font-medium text-gray-700">
                              {classStat.totalScheduled + classStat.totalUnscheduled > 0 
                                ? ((classStat.totalScheduled / (classStat.totalScheduled + classStat.totalUnscheduled)) * 100).toFixed(0) 
                                : 0}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className="h-2 rounded-full bg-green-500"
                              style={{ width: `${classStat.totalScheduled + classStat.totalUnscheduled > 0 
                                ? (classStat.totalScheduled / (classStat.totalScheduled + classStat.totalUnscheduled)) * 100 
                                : 0}%` }}
                            />
                          </div>
                        </div>
                        {expandedClass === classStat.className ? (
                          <ChevronUp className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>

                  {expandedClass === classStat.className && (
                    <div className="border-t border-gray-200">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学号</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">姓名</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">主项</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">副项1</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">副项2</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">副项3</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">排课状态</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {classStat.students.map((student) => (
                              <tr key={student.studentId} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm text-gray-900">{student.studentNumber}</td>
                                <td className="px-4 py-3 text-sm font-medium text-gray-900">{student.studentName}</td>
                                {student.courseStatuses.map((course, idx) => (
                                  <td key={idx} className="px-4 py-3 text-center">
                                    {course.instrument ? (
                                      <div className="flex flex-col items-center gap-1">
                                        <div className="flex items-center gap-1">
                                          <span className="text-sm font-medium text-gray-700">{course.instrument}</span>
                                          {course.isScheduled ? (
                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                          ) : (
                                            <XCircle className="w-4 h-4 text-red-400" />
                                          )}
                                        </div>
                                        <span className="text-xs text-gray-500">{course.teacherName}</span>
                                        {course.isScheduled && course.scheduleDetails.length > 0 && (
                                          <div className="text-xs text-gray-400 max-w-[200px] truncate" title={course.scheduleDetails.map(s => `${s.weeks}${s.weekDay}${s.period}`).join('; ')}>
                                            {course.scheduleDetails.map(s => `${s.weeks}${s.weekDay}${s.period}`).join('; ')}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-sm text-gray-400">无</span>
                                    )}
                                  </td>
                                ))}
                                {[...Array(4 - student.courseStatuses.length)].map((_, idx) => (
                                  <td key={`empty-${idx}`} className="px-4 py-3 text-center text-sm text-gray-400">-</td>
                                ))}
                                <td className="px-4 py-3 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-sm text-green-600">{student.scheduledCourses}已排</span>
                                    <span className="text-sm text-gray-300">|</span>
                                    <span className="text-sm text-orange-600">{student.unscheduledCourses}未排</span>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                                    <div 
                                      className={`h-1.5 rounded-full ${student.unscheduledCourses === 0 ? 'bg-green-500' : student.scheduledCourses === 0 ? 'bg-red-400' : 'bg-yellow-400'}`}
                                      style={{ width: `${student.totalCourses > 0 ? (student.scheduledCourses / student.totalCourses) * 100 : 0}%` }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {filteredStudentStats.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <GraduationCap className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>暂无学生小组课数据</p>
                </div>
              )}
            </div>
          ) : activeTab === 'individual' ? (
            <div className="space-y-4">
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
                <div key={teacherStat.teacherId} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div 
                    className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleExpand(teacherStat.teacherId)}
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
                              {teacherStat.totalHours > 0 ? formatRate((teacherStat.scheduledHours / teacherStat.totalHours) * 100) : '0%'}
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

                        {expandedTeacher === teacherStat.teacherId ? (
                          <ChevronUp className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>

                  {expandedTeacher === teacherStat.teacherId && (
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
          ) : (
            <>
              {filteredStats
                .filter(stat => activeTab === 'major' && stat.majorCourses > 0)
                .map((stat) => (
                  <div key={stat.teacherId} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* 教师统计摘要 */}
              <div 
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleExpand(stat.teacherId)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                      activeTab === 'major' 
                        ? 'bg-gradient-to-br from-purple-100 to-indigo-100 text-purple-600' 
                        : 'bg-gradient-to-br from-blue-100 to-cyan-100 text-blue-600'
                    }`}>
                      {stat.teacherName.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{stat.teacherName}</h3>
                      <p className="text-sm text-gray-500">
                        {activeTab === 'major' 
                          ? `${stat.majorCourses}门专业大课，共${stat.majorHours}课时`
                          : `${stat.individualCourses}门小组课，共${stat.individualHours}课时`
                        }
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {/* 进度条 */}
                    <div className="w-32">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-500">完成率</span>
                        <span className="font-medium text-gray-700">
                          {formatRate(activeTab === 'major' 
                            ? (stat.majorHours > 0 ? (stat.majorScheduled / stat.majorHours) * 100 : 0)
                            : (stat.individualHours > 0 ? (stat.individualScheduled / stat.individualHours) * 100 : 0)
                          )}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${getProgressColor(activeTab === 'major' 
                            ? (stat.majorHours > 0 ? (stat.majorScheduled / stat.majorHours) * 100 : 0)
                            : (stat.individualHours > 0 ? (stat.individualScheduled / stat.individualHours) * 100 : 0)
                          )}`}
                          style={{ width: `${Math.min(100, activeTab === 'major' 
                            ? (stat.majorHours > 0 ? (stat.majorScheduled / stat.majorHours) * 100 : 0)
                            : (stat.individualHours > 0 ? (stat.individualScheduled / stat.individualHours) * 100 : 0)
                          )}%` }}
                        />
                      </div>
                    </div>

                    {/* 课时统计 */}
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-green-600">
                        已排 {activeTab === 'major' ? stat.majorScheduled : stat.individualScheduled}课时
                      </span>
                      <span className="text-orange-600">
                        剩余 {activeTab === 'major' ? stat.majorRemaining : stat.individualRemaining}课时
                      </span>
                    </div>

                    {/* 展开/收起图标 */}
                    {expandedTeacher === stat.teacherId ? (
                      <ChevronUp className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>
              </div>

              {/* 展开的课程详情 */}
              {expandedTeacher === stat.teacherId && (
                <div className="border-t border-gray-200 bg-gray-50 p-4">
                  <div className="space-y-4">
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-2">课程明细</h5>
                      <div className="space-y-2">
                        {stat.majorCourseDetails.map((course) => (
                          <div key={course.id} className="bg-white p-3 rounded-lg border border-gray-200">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-900">{course.name}</span>
                              <span className="text-sm text-gray-400">|</span>
                              <span className="text-sm text-gray-500">总{course.totalHours}课时</span>
                              <span className="text-sm text-green-600">已排{course.scheduledHours}</span>
                              <span className="text-sm text-orange-600">剩{course.remainingHours}</span>
                              {course.classes.length > 0 && (
                                <>
                                  <span className="text-sm text-gray-400">|</span>
                                  <span className="text-sm text-gray-500">{course.classes.join('、')}</span>
                                </>
                              )}
                              {course.schedules.length > 0 && (
                                <>
                                  <span className="text-sm text-gray-400">|</span>
                                  {course.schedules.map((schedule, idx) => (
                                    <span key={idx} className="text-sm text-gray-600">
                                      {schedule.weeks},{schedule.weekDay}{schedule.period}·{schedule.room}
                                    </span>
                                  ))}
                                </>
                              )}
                              <span className={`text-sm px-2 py-0.5 rounded ml-auto ${
                                course.completionRate >= 100 
                                  ? 'bg-green-100 text-green-700' 
                                  : course.completionRate > 0 
                                    ? 'bg-yellow-100 text-yellow-700' 
                                    : 'bg-gray-100 text-gray-700'
                              }`}>
                                {course.completionRate >= 100 ? '已完成' : course.completionRate > 0 ? '进行中' : '未开始'}
                              </span>
                            </div>
                            
                            <div className="w-full bg-gray-200 rounded-full h-1 mt-2">
                              <div 
                                className={`h-1 rounded-full ${getProgressColor(course.completionRate)}`}
                                style={{ width: `${Math.min(100, course.completionRate)}%` }}
                              />
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
