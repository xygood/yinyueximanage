/**
 * 数据备份与恢复页面
 * 管理员专用：导出和导入系统数据备份
 */

import React, { useState, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { teacherService, studentService, courseService, roomService, scheduleService, largeClassScheduleService, STORAGE_KEYS, authService, weekConfigService, classService, blockedSlotService, studentTeacherAssignmentService } from '../services';
import { syncService, operationLogService } from '../services';

const USE_DATABASE = import.meta.env.VITE_USE_DATABASE === 'true';

const semesterWeekConfigService = weekConfigService;

import {
  Database,
  Download,
  Upload,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  FileJson,
  Clock,
  Users,
  BookOpen,
  MapPin,
  Calendar,
  Trash2
} from 'lucide-react';

const Backup: React.FC = () => {
  const { user } = useAuth();
  const [backupProgress, setBackupProgress] = useState('');
  const [restoreProgress, setRestoreProgress] = useState('');
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [customFileName, setCustomFileName] = useState('');

  // 备份数据类型选择状态
  const [selectedBackupTypes, setSelectedBackupTypes] = useState({
    teachers: true,
    students: true,
    courses: true,
    rooms: true,
    largeClassSchedules: true,
    majorClassScheduledClasses: true,  // 专业大课排课结果
    groupClassScheduledClasses: true,  // 专业小课排课结果
    conflicts: true,
    users: true,
    semesterWeekConfigs: true,
    classes: true,
    blockedSlots: true,
    importedBlockedTimes: true,
    studentTeacherAssignments: true,
    studentMajorAssignments: true,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 判断是否为管理员
  const isAdmin = user?.faculty_id === 'ADMIN' || user?.is_admin === true || user?.role === 'admin' || user?.teacher_id === '110' || user?.email === 'admin@music.edu.cn';

  // 导出备份
  const handleExportBackup = async () => {
    if (!isAdmin) {
      alert('此功能仅限管理员使用');
      return;
    }

    try {
      const backupData: any = {
        version: '1.7', // 更新版本号，支持课程编码字段和完整字段顺序导出
        exportDate: new Date().toISOString(),
        exportBy: user?.full_name || user?.email || '管理员',
        data: {}
      };

      // 根据选择导出数据
      if (selectedBackupTypes.teachers) {
        setBackupProgress('正在导出教师数据...');
        backupData.data.teachers = await teacherService.getAll();
      }

      if (selectedBackupTypes.students) {
        setBackupProgress('正在导出学生数据...');
        backupData.data.students = await studentService.getAll();
      }

      if (selectedBackupTypes.courses) {
        setBackupProgress('正在导出课程数据...');
        backupData.data.courses = await courseService.getAll();
      }

      if (selectedBackupTypes.rooms) {
        setBackupProgress('正在导出教室数据...');
        backupData.data.rooms = await roomService.getAll();
      }

      if (selectedBackupTypes.largeClassSchedules) {
        setBackupProgress('正在导出大课表数据...');
        backupData.data.large_class_schedules = await largeClassScheduleService.getAll();
      }

      // 排课记录按页面来源区分
      if (selectedBackupTypes.majorClassScheduledClasses || selectedBackupTypes.groupClassScheduledClasses) {
        const allScheduledClasses = await scheduleService.getAll();
        const allCourses = await courseService.getAll();
        const allTeachers = await teacherService.getAll();
        
        // 创建课程ID到课程的映射（同时支持内部ID和课程编号）
        const courseMap = new Map();
        allCourses.forEach((c: any) => {
          // 用内部ID作为键
          courseMap.set(c.id, c);
          // 如果有课程编号，也用课程编号作为键
          if (c.course_id) {
            courseMap.set(c.course_id, c);
          }
        });
        
        // 创建教师ID到教师的映射
        const teacherMap = new Map();
        allTeachers.forEach((t: any) => {
          teacherMap.set(t.id, t);
          if (t.teacher_id) {
            teacherMap.set(t.teacher_id, t);
          }
        });
        
        // 按页面来源筛选（通过关联的课程判断）
        if (selectedBackupTypes.majorClassScheduledClasses) {
          // 专业大课页面：关联的课程 teaching_type 为 '专业大课'
          const majorClassSchedules = allScheduledClasses.filter((s: any) => {
            const course = courseMap.get(s.course_id);
            return course && course.teaching_type === '专业大课';
          });
          
          // 按排课结果列表中的字段顺序导出，新增课程编码字段
          // 字段顺序：id, course_id, course_code, class_id, room_id, teacher_id, teacher_name, 
          //          day_of_week, period, week_number, start_week, end_week, status, created_at, updated_at
          const formattedMajorClassSchedules = majorClassSchedules.map((s: any) => {
            const course = courseMap.get(s.course_id);
            const teacher = teacherMap.get(s.teacher_id);
            return {
              id: s.id,
              course_id: s.course_id,
              course_code: course?.course_code || '',  // 新增课程编码字段
              class_id: s.class_id,
              room_id: s.room_id,
              teacher_id: course?.teacher_id || s.teacher_id || '',
              teacher_name: course?.teacher_name || teacher?.name || s.teacher_name || '',
              day_of_week: s.day_of_week,
              period: s.period,
              week_number: s.week_number,
              start_week: s.start_week,
              end_week: s.end_week,
              status: s.status,
              created_at: s.created_at,
              updated_at: s.updated_at
            };
          });
          
          backupData.data.major_class_scheduled_classes = formattedMajorClassSchedules;
          
          // 同时导出相关的课程、班级、教室数据
          const relatedCourseIds = new Set(majorClassSchedules.map((s: any) => s.course_id).filter(Boolean));
          const relatedClassIds = new Set(majorClassSchedules.map((s: any) => s.class_id).filter(Boolean));
          const relatedRoomIds = new Set(majorClassSchedules.map((s: any) => s.room_id).filter(Boolean));
          const relatedTeacherIds = new Set(majorClassSchedules.map((s: any) => {
            const course = courseMap.get(s.course_id);
            return course?.teacher_id || s.teacher_id;
          }).filter(Boolean));
          
          backupData.data.major_class_courses = allCourses.filter((c: any) => relatedCourseIds.has(c.id) || relatedCourseIds.has(c.course_id));
          backupData.data.major_class_teachers = allTeachers.filter((t: any) => 
            relatedTeacherIds.has(t.id) || relatedTeacherIds.has(t.teacher_id)
          );
        }
        
        if (selectedBackupTypes.groupClassScheduledClasses) {
          // 专业小课页面：关联的课程 teaching_type 为 '小组课' 或其他
          const groupClassSchedules = allScheduledClasses.filter((s: any) => {
            const course = courseMap.get(s.course_id);
            // 专业小课：课程存在且 teaching_type 为 '小组课'，或者课程不存在（兼容旧数据）
            return !course || course.teaching_type === '小组课';
          });
          backupData.data.group_class_scheduled_classes = groupClassSchedules;
          
          // 同时导出相关的课程、班级、教室、学生数据
          const relatedCourseIds = new Set(groupClassSchedules.map((s: any) => s.course_id).filter(Boolean));
          const relatedClassIds = new Set(groupClassSchedules.map((s: any) => s.class_id).filter(Boolean));
          const relatedRoomIds = new Set(groupClassSchedules.map((s: any) => s.room_id).filter(Boolean));
          const relatedStudentIds = new Set(groupClassSchedules.map((s: any) => s.student_id).filter(Boolean));
          const relatedTeacherIds = new Set(groupClassSchedules.map((s: any) => s.teacher_id).filter(Boolean));
          
          backupData.data.group_class_courses = allCourses.filter((c: any) => relatedCourseIds.has(c.id) || relatedCourseIds.has(c.course_id));
          backupData.data.group_class_teachers = allTeachers.filter((t: any) => relatedTeacherIds.has(t.id) || relatedTeacherIds.has(t.teacher_id));
        }
      }

      // 其他数据类型
      if (selectedBackupTypes.conflicts) {
        backupData.data.conflicts = [];
      }

      if (selectedBackupTypes.users) {
        setBackupProgress('正在导出用户账户...');
        backupData.data.users = await authService.getAll();
      }

      if (selectedBackupTypes.semesterWeekConfigs) {
        setBackupProgress('正在导出周次配置...');
        backupData.data.semester_week_configs = await semesterWeekConfigService.getAll();
      }

      if (selectedBackupTypes.classes) {
        setBackupProgress('正在导出班级数据...');
        backupData.data.classes = await classService.getAll();
      }

      if (selectedBackupTypes.blockedSlots) {
        setBackupProgress('正在导出禁排时间...');
        backupData.data.blocked_slots = await blockedSlotService.getAll();
      }

      if (selectedBackupTypes.importedBlockedTimes) {
        setBackupProgress('正在导出导入的禁排时间...');
        const importedBlockedTimesData = localStorage.getItem('music_scheduler_imported_blocked_times');
        backupData.data.imported_blocked_times = importedBlockedTimesData ? JSON.parse(importedBlockedTimesData) : [];
      }

      if (selectedBackupTypes.studentTeacherAssignments) {
        setBackupProgress('正在导出学生教师分配...');
        backupData.data.student_teacher_assignments = await studentTeacherAssignmentService.getAll();
      }

      if (selectedBackupTypes.studentMajorAssignments) {
        setBackupProgress('正在导出学生专业分配...');
        // 学生专业分配数据已包含在学生数据的 assigned_teachers 字段中
        // 这里导出一份摘要，方便查看
        const students = await studentService.getAll();
        const assignments = students.map((s: any) => ({
          student_id: s.student_id,
          student_name: s.name,
          major_class: s.major_class,
          primary_instrument: s.primary_instrument,
          assigned_teachers: s.assigned_teachers
        }));
        backupData.data.student_major_assignments = assignments;
      }

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const defaultFileName = `音乐排课系统备份_${new Date().toISOString().split('T')[0]}`;
      const finalFileName = customFileName.trim() 
        ? `${customFileName.trim()}_${new Date().toISOString().split('T')[0]}` 
        : defaultFileName;
      a.download = `${finalFileName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupProgress('导出完成！');
      setTimeout(() => setBackupProgress(''), 3000);
    } catch (error) {
      console.error('导出失败:', error);
      setBackupProgress('导出失败，请重试');
    }
  };

  // 处理恢复备份文件
  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isAdmin) {
      alert('此功能仅限管理员使用');
      return;
    }

    setRestoreProgress('正在读取备份文件...');
    setRestoreResult(null);

    try {
      const text = await file.text();
      const backupData = JSON.parse(text);

      // 验证备份格式
      if (!backupData.version || !backupData.data) {
        setRestoreResult({ success: false, message: '无效的备份文件格式' });
        setRestoreProgress('');
        return;
      }

      if (USE_DATABASE) {
        setRestoreProgress('正在导入数据到数据库...');
        try {
          await syncService.import(backupData.data);
          setRestoreResult({ success: true, message: '数据导入成功！页面将自动刷新。' });
          setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
          console.error('导入失败:', error);
          setRestoreResult({ success: false, message: `导入失败: ${error}` });
        }
        setRestoreProgress('');
        return;
      }

      setRestoreProgress('正在恢复教师数据...');
      if (backupData.data.teachers) {
        await teacherService.importManyWithUpsert(backupData.data.teachers);
      }

      setRestoreProgress('正在恢复学生数据...');
      if (backupData.data.students) {
        // 获取教师列表，建立姓名到工号的映射
        const teachers = await teacherService.getAll();
        const teacherNameToId = new Map<string, string>();
        teachers.forEach((t: any) => {
          if (t.name && (t.teacher_id || t.id)) {
            teacherNameToId.set(t.name, t.teacher_id || t.id);
          }
        });
        
        console.log('教师姓名到工号映射:', Object.fromEntries(teacherNameToId));
        
        // 判断是否为临时ID（非纯数字）
        const isTemporaryId = (id: string | undefined) => {
          if (!id) return false;
          // 纯数字是工号/学号，不是临时ID
          return !id.match(/^\d+$/);
        };
        
        // 转换学生数据中的教师ID为工号
        const convertedStudents = backupData.data.students.map((student: any) => {
          const converted = { ...student };
          
          // 转换 assigned_teachers 中的教师ID
          if (converted.assigned_teachers) {
            const at = { ...converted.assigned_teachers };
            
            // 通过姓名查找工号，转换临时ID
            if (isTemporaryId(at.primary_teacher_id)) {
              if (at.primary_teacher_name && teacherNameToId.has(at.primary_teacher_name)) {
                console.log(`转换主项教师ID: ${at.primary_teacher_id} -> ${teacherNameToId.get(at.primary_teacher_name)}`);
                at.primary_teacher_id = teacherNameToId.get(at.primary_teacher_name);
              } else {
                console.warn(`无法转换主项教师ID: ${at.primary_teacher_id}, 姓名: ${at.primary_teacher_name}`);
              }
            }
            if (isTemporaryId(at.secondary1_teacher_id)) {
              if (at.secondary1_teacher_name && teacherNameToId.has(at.secondary1_teacher_name)) {
                at.secondary1_teacher_id = teacherNameToId.get(at.secondary1_teacher_name);
              }
            }
            if (isTemporaryId(at.secondary2_teacher_id)) {
              if (at.secondary2_teacher_name && teacherNameToId.has(at.secondary2_teacher_name)) {
                at.secondary2_teacher_id = teacherNameToId.get(at.secondary2_teacher_name);
              }
            }
            if (isTemporaryId(at.secondary3_teacher_id)) {
              if (at.secondary3_teacher_name && teacherNameToId.has(at.secondary3_teacher_name)) {
                at.secondary3_teacher_id = teacherNameToId.get(at.secondary3_teacher_name);
              }
            }
            
            converted.assigned_teachers = at;
          }
          
          // 转换顶层的教师ID字段
          if (isTemporaryId(converted.secondary1_teacher_id)) {
            if (converted.secondary1_teacher_name && teacherNameToId.has(converted.secondary1_teacher_name)) {
              converted.secondary1_teacher_id = teacherNameToId.get(converted.secondary1_teacher_name);
            }
          }
          if (isTemporaryId(converted.secondary2_teacher_id)) {
            if (converted.secondary2_teacher_name && teacherNameToId.has(converted.secondary2_teacher_name)) {
              converted.secondary2_teacher_id = teacherNameToId.get(converted.secondary2_teacher_name);
            }
          }
          if (isTemporaryId(converted.secondary3_teacher_id)) {
            if (converted.secondary3_teacher_name && teacherNameToId.has(converted.secondary3_teacher_name)) {
              converted.secondary3_teacher_id = teacherNameToId.get(converted.secondary3_teacher_name);
            }
          }
          
          return converted;
        });
        
        // 建立旧UUID到学号的映射（从备份文件原始数据）
        const oldStudentIdToNewMap = new Map<string, string>();
        const oldStudentIdToNameMap = new Map<string, string>();
        
        const firstStudent = backupData.data.students[0];
        console.log('备份文件中第一个学生数据:', firstStudent);
        alert(`第一个学生: id=${firstStudent?.id}, student_id=${firstStudent?.student_id}, name=${firstStudent?.name}`);
        
        backupData.data.students.forEach((s: any) => {
          // 备份文件中的id是旧UUID，student_id是学号
          if (s.id && s.student_id && s.id !== s.student_id) {
            oldStudentIdToNewMap.set(s.id, s.student_id);
          }
          // 建立UUID到姓名的映射
          if (s.id && s.name) {
            oldStudentIdToNameMap.set(s.id, s.name);
          }
        });
        console.log('建立旧UUID到学号映射，共', oldStudentIdToNewMap.size, '条');
        console.log('建立旧UUID到姓名映射，共', oldStudentIdToNameMap.size, '条');
        alert(`UUID到学号映射: ${oldStudentIdToNewMap.size}条\nUUID到姓名映射: ${oldStudentIdToNameMap.size}条`);
        
        // 保存映射供排课数据转换使用
        (window as any).__oldStudentIdToNewMap = oldStudentIdToNewMap;
        (window as any).__oldStudentIdToNameMap = oldStudentIdToNameMap;
        
        await studentService.importManyWithUpsert(convertedStudents);
      }

      setRestoreProgress('正在恢复课程数据...');
      if (backupData.data.courses) {
        // 先获取现有课程
        const existingCourses = await courseService.getAll();
        const existingCourseIds = new Set(existingCourses.map((c: any) => c.id));
        
        // 过滤出新课程
        const newCourses = backupData.data.courses.filter((c: any) => !existingCourseIds.has(c.id));
        
        // 批量创建新课程
        if (newCourses.length > 0) {
          await Promise.all(newCourses.map(course => courseService.create(course)));
        }
        
        // 更新现有课程
        for (const course of backupData.data.courses) {
          if (existingCourseIds.has(course.id)) {
            await courseService.update(course.id, course);
          }
        }
      }

      setRestoreProgress('正在恢复教室数据...');
      if (backupData.data.rooms) {
        await roomService.importManyWithUpsert(backupData.data.rooms);
      }

      // 恢复大课表数据
      setRestoreProgress('正在恢复大课表数据...');
      if (backupData.data.large_class_schedules) {
        localStorage.setItem(STORAGE_KEYS.LARGE_CLASS_SCHEDULES, JSON.stringify(backupData.data.large_class_schedules));
      }

      // 先恢复关联的课程数据（确保排课记录能正确判断类型）
      setRestoreProgress('正在恢复关联课程数据...');
      if (backupData.data.major_class_courses) {
        for (const course of backupData.data.major_class_courses) {
          try {
            await courseService.create(course);
          } catch (error) {
            // 课程可能已存在，忽略错误
          }
        }
      }
      
      // 恢复小组课关联的课程
      if (backupData.data.group_class_courses) {
        for (const course of backupData.data.group_class_courses) {
          try {
            await courseService.create(course);
          } catch (error) {
            // 课程可能已存在，忽略错误
          }
        }
      }

      // 恢复排课记录（增量恢复，不清空其他类型的数据）
      setRestoreProgress('正在恢复排课记录...');
      
      // 获取现有的排课数据和课程数据
      const existingScheduledClasses = await scheduleService.getAll();
      const currentCourses = await courseService.getAll();
      const currentStudents = await studentService.getAll();
      const currentTeachers = await teacherService.getAll();
      
      // 创建课程映射（支持多种ID格式）
      const courseMap = new Map();
      currentCourses.forEach((c: any) => {
        if (c.id) courseMap.set(c.id, c);
        if (c.course_id) courseMap.set(c.course_id, c);
      });
      
      // 创建学生映射（支持UUID和学号查找）
      const studentIdMap = new Map();
      const studentNameMap = new Map();
      currentStudents.forEach((s: any) => {
        if (s.id) studentIdMap.set(s.id, s);
        if (s.student_id) {
          studentIdMap.set(s.student_id, s);
        }
        if (s.name) studentNameMap.set(s.name, s);
      });
      
      // 创建教师映射（支持UUID和工号查找）
      const teacherIdMap = new Map();
      const teacherNameMap = new Map();
      currentTeachers.forEach((t: any) => {
        if (t.id) teacherIdMap.set(t.id, t);
        if (t.teacher_id) teacherIdMap.set(t.teacher_id, t);
        if (t.name) teacherNameMap.set(t.name, t);
      });
      
      // 判断备份文件中包含哪些类型的排课数据
      const hasMajorClassData = backupData.data.major_class_scheduled_classes && backupData.data.major_class_scheduled_classes.length > 0;
      const hasGroupClassData = backupData.data.group_class_scheduled_classes && backupData.data.group_class_scheduled_classes.length > 0;
      const hasLegacyData = backupData.data.scheduled_classes && backupData.data.scheduled_classes.length > 0;
      
      let schedulesToCreate: any[] = [];
      
      if (hasMajorClassData) {
        schedulesToCreate = [...schedulesToCreate, ...backupData.data.major_class_scheduled_classes];
      }
      
      if (hasGroupClassData) {
        schedulesToCreate = [...schedulesToCreate, ...backupData.data.group_class_scheduled_classes];
      }
      
      if (hasLegacyData) {
        schedulesToCreate = [...schedulesToCreate, ...backupData.data.scheduled_classes];
      }
      
      // 获取旧UUID到学号的映射
      const oldStudentIdToNewMap = (window as any).__oldStudentIdToNewMap || new Map();
      const oldStudentIdToNameMap = (window as any).__oldStudentIdToNameMap || new Map();
      
      // 转换排课数据中的学生ID和教师ID为学号/工号
      const convertedSchedules = schedulesToCreate.map((schedule: any) => {
        const converted = { ...schedule };
        const originalStudentId = converted.student_id; // 保存原始ID用于查找姓名
        
        // 转换学生ID：优先使用UUID映射
        if (converted.student_id && !converted.student_id?.match(/^\d+$/)) {
          // 先尝试使用UUID映射
          if (oldStudentIdToNewMap.has(converted.student_id)) {
            converted.student_id = oldStudentIdToNewMap.get(converted.student_id);
            // 同时修复student_name（使用原始ID查找）
            if (converted.student_name === '学生' || !converted.student_name) {
              converted.student_name = oldStudentIdToNameMap.get(originalStudentId) || converted.student_name;
            }
          } else if (converted.student_name && converted.student_name !== '学生') {
            // 再尝试通过姓名查找学号
            const student = studentNameMap.get(converted.student_name);
            if (student) {
              converted.student_id = student.student_id || student.id;
            }
          }
        }
        
        // 转换教师ID：通过姓名查找工号
        if (converted.teacher_id && !converted.teacher_id?.match(/^\d+$/)) {
          // 旧的UUID或临时ID格式，尝试通过姓名查找工号
          if (converted.teacher_name) {
            const teacher = teacherNameMap.get(converted.teacher_name);
            if (teacher) {
              converted.teacher_id = teacher.teacher_id || teacher.id;
            }
          }
        }
        
        return converted;
      });
      
      // 批量创建排课记录
      if (convertedSchedules.length > 0) {
        await Promise.all(convertedSchedules.map(schedule => scheduleService.create(schedule)));
      }
      
      // 恢复专业大课关联的教师数据
      if (backupData.data.major_class_teachers) {
        await teacherService.importManyWithUpsert(backupData.data.major_class_teachers);
      }
      
      // 恢复小组课关联的教师数据
      if (backupData.data.group_class_teachers) {
        await teacherService.importManyWithUpsert(backupData.data.group_class_teachers);
      }

      if (backupData.data.conflicts) {
        localStorage.setItem(STORAGE_KEYS.CONFLICTS, JSON.stringify(backupData.data.conflicts));
      }

      if (backupData.data.users) {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(backupData.data.users));
      }

      // 恢复周次配置数据
      setRestoreProgress('正在恢复周次配置数据...');
      if (backupData.data.semester_week_configs) {
        localStorage.setItem(STORAGE_KEYS.SEMESTER_WEEK_CONFIGS, JSON.stringify(backupData.data.semester_week_configs));
      }

      // 恢复班级数据
      setRestoreProgress('正在恢复班级数据...');
      if (backupData.data.classes) {
        for (const cls of backupData.data.classes) {
          try {
            await classService.create(cls);
          } catch (error) {
            // 班级可能已存在，忽略错误
          }
        }
      }

      // 恢复禁排时间数据
      setRestoreProgress('正在恢复禁排时间数据...');
      if (backupData.data.blocked_slots) {
        localStorage.setItem(STORAGE_KEYS.BLOCKED_SLOTS, JSON.stringify(backupData.data.blocked_slots));
      }

      // 恢复专业大课页面导入的禁排时间数据
      setRestoreProgress('正在恢复导入的禁排时间数据...');
      if (backupData.data.imported_blocked_times) {
        localStorage.setItem('music_scheduler_imported_blocked_times', JSON.stringify(backupData.data.imported_blocked_times));
      }

      // 恢复学生-教师分配数据
      setRestoreProgress('正在恢复学生-教师分配数据...');
      if (backupData.data.student_teacher_assignments) {
        localStorage.setItem(STORAGE_KEYS.STUDENT_TEACHER_ASSIGNMENTS, JSON.stringify(backupData.data.student_teacher_assignments));
      }

      // 恢复学生-专业分配数据
      setRestoreProgress('正在恢复学生-专业分配数据...');
      if (backupData.data.student_major_assignments) {
        localStorage.setItem(STORAGE_KEYS.STUDENT_MAJOR_ASSIGNMENTS, JSON.stringify(backupData.data.student_major_assignments));
      }

      setRestoreResult({ success: true, message: '数据恢复成功！页面将在5秒后自动刷新，请查看控制台日志确认数据转换情况。' });
      setRestoreProgress('');
      
      // 记录操作日志
      await operationLogService.log(
        '导入数据备份',
        'system',
        `导入数据备份文件：${file.name}`,
        undefined,
        undefined
      );
      
      // 5秒后自动刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 5000);
    } catch (error) {
      console.error('恢复失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setRestoreResult({ success: false, message: `恢复失败: ${errorMessage}` });
      setRestoreProgress('');
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 清空所有数据
  const handleClearAllData = async () => {
    if (!isAdmin) {
      alert('此功能仅限管理员使用');
      return;
    }
    
    try {
      if (USE_DATABASE) {
        setRestoreProgress('正在清空数据库...');
        await syncService.clear();
        setRestoreResult({ success: true, message: '数据库已清空！页面将自动刷新。' });
        setShowClearConfirm(false);
        setTimeout(() => window.location.reload(), 1000);
        return;
      }

      // 保存当前用户信息，避免清空后需要重新登录
      const currentUser = sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER);
      
      // 清空所有 localStorage 数据
      Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
      });
      
      // 清除可能的其他自定义键
      localStorage.removeItem('music_scheduler_imported_blocked_times');
      
      // 恢复当前用户信息
      if (currentUser) {
        sessionStorage.setItem(STORAGE_KEYS.CURRENT_USER, currentUser);
      }
      
      setRestoreResult({ success: true, message: '数据已清空！页面已自动重置。' });
      setShowClearConfirm(false);
      
      // 延迟刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('清空数据失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setRestoreResult({ success: false, message: `清空失败: ${errorMessage}` });
    }
  };



  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="page-title flex items-center gap-3">
          <Database className="w-8 h-8 text-orange-600" />
          数据备份与恢复
        </h1>
        <p className="text-gray-600 mt-2">
          导出或恢复系统数据备份。建议定期备份以防止数据丢失。
        </p>
      </div>

      {/* 警告信息 */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium">注意事项：</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>此功能仅限管理员使用</li>
              <li>恢复备份会覆盖当前所有数据，请谨慎操作</li>
              <li>建议在恢复前先导出当前数据的备份</li>
              <li>恢复完成后请刷新页面查看数据</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 导出备份 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Download className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">导出备份</h3>
              <p className="text-sm text-gray-500">将所有系统数据导出为JSON文件</p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-700">选择要备份的数据：</h4>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedBackupTypes(prev => Object.keys(prev).reduce((acc, key) => ({ ...acc, [key]: true }), {} as typeof prev))}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  全选
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setSelectedBackupTypes(prev => Object.keys(prev).reduce((acc, key) => ({ ...acc, [key]: false }), {} as typeof prev))}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  全不选
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.teachers}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, teachers: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Users className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.teachers ? 'text-gray-900' : 'text-gray-400'}>教师数据</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.students}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, students: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Users className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.students ? 'text-gray-900' : 'text-gray-400'}>学生数据</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.courses}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, courses: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <BookOpen className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.courses ? 'text-gray-900' : 'text-gray-400'}>课程数据</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.rooms}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, rooms: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <MapPin className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.rooms ? 'text-gray-900' : 'text-gray-400'}>教室数据</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.largeClassSchedules}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, largeClassSchedules: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.largeClassSchedules ? 'text-gray-900' : 'text-gray-400'}>通适大课</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.majorClassScheduledClasses}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, majorClassScheduledClasses: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.majorClassScheduledClasses ? 'text-gray-900' : 'text-gray-400'}>专业大课排课结果</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.groupClassScheduledClasses}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, groupClassScheduledClasses: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.groupClassScheduledClasses ? 'text-gray-900' : 'text-gray-400'}>专业小课排课结果</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.users}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, users: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <FileJson className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.users ? 'text-gray-900' : 'text-gray-400'}>用户账户</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.semesterWeekConfigs}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, semesterWeekConfigs: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.semesterWeekConfigs ? 'text-gray-900' : 'text-gray-400'}>周次配置</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.classes}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, classes: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Users className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.classes ? 'text-gray-900' : 'text-gray-400'}>班级数据</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.blockedSlots}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, blockedSlots: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Clock className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.blockedSlots ? 'text-gray-900' : 'text-gray-400'}>禁排时间</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.studentTeacherAssignments}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, studentTeacherAssignments: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Users className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.studentTeacherAssignments ? 'text-gray-900' : 'text-gray-400'}>学生-教师分配</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedBackupTypes.studentMajorAssignments}
                  onChange={(e) => setSelectedBackupTypes(prev => ({ ...prev, studentMajorAssignments: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <Users className="w-4 h-4 text-gray-400" />
                <span className={selectedBackupTypes.studentMajorAssignments ? 'text-gray-900' : 'text-gray-400'}>学生-专业分配</span>
              </label>
            </div>
          </div>

          <div className="mb-4">
            <label className="label">自定义文件名（可选）</label>
            <input
              type="text"
              value={customFileName}
              onChange={(e) => setCustomFileName(e.target.value)}
              placeholder="留空则使用默认文件名"
              className="input"
            />
            <p className="text-xs text-gray-500 mt-1">
              最终文件名：{customFileName.trim() 
                ? `${customFileName.trim()}_${new Date().toISOString().split('T')[0]}.json`
                : `音乐排课系统备份_${new Date().toISOString().split('T')[0]}.json`}
            </p>
          </div>

          <button
            onClick={handleExportBackup}
            disabled={!!backupProgress}
            className="w-full btn-primary flex items-center justify-center gap-2"
          >
            {backupProgress ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                {backupProgress}
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                导出数据备份
              </>
            )}
          </button>
        </div>

        {/* 恢复备份 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <Upload className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">恢复备份</h3>
              <p className="text-sm text-gray-500">从JSON备份文件恢复数据</p>
            </div>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-green-500 transition-colors mb-4">
            <FileJson className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 mb-2">点击或拖拽上传备份文件</p>
            <p className="text-sm text-gray-500 mb-4">支持 .json 格式</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleRestoreBackup}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!!restoreProgress}
              className="btn-secondary"
            >
              选择备份文件
            </button>
          </div>

          {(restoreProgress || restoreResult) && (
            <div className="space-y-3">
              {restoreProgress && (
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {restoreProgress}
                </div>
              )}

              {restoreResult && (
                <div className={`p-3 rounded-lg border ${restoreResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-2">
                    {restoreResult.success ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                    )}
                    <span className={`text-sm ${restoreResult.success ? 'text-green-700' : 'text-red-700'}`}>
                      {restoreResult.message}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 备份历史建议 */}
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">备份建议</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-blue-800">定期备份</span>
            </div>
            <p className="text-sm text-blue-700">
              建议每周至少备份一次，特别是在重要操作前
            </p>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-5 h-5 text-green-600" />
              <span className="font-medium text-green-800">多地存储</span>
            </div>
            <p className="text-sm text-green-700">
              将备份文件保存到多个位置，防止单点故障
            </p>
          </div>
          <div className="bg-purple-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-purple-600" />
              <span className="font-medium text-purple-800">验证备份</span>
            </div>
            <p className="text-sm text-purple-700">
              定期尝试恢复备份文件，确保备份可用
            </p>
          </div>
        </div>
      </div>

      {/* 清空数据 */}
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-red-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">清空所有数据</h3>
            <p className="text-sm text-gray-500">清空系统所有数据，恢复初始状态</p>
          </div>
        </div>
        
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
            <div className="text-sm text-red-800">
              <p className="font-medium">⚠️ 警告：</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>此操作将清空所有数据，不可撤销</li>
                <li>建议先导出备份再执行此操作</li>
                <li>当前用户会保持登录状态</li>
              </ul>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowClearConfirm(true)}
          className="w-full bg-red-600 hover:bg-red-700 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Trash2 className="w-5 h-5" />
          清空所有数据
        </button>
      </div>

      {/* 清空数据确认对话框 */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
              <h3 className="text-xl font-bold text-gray-900">确认清空数据？</h3>
            </div>
            
            <p className="text-gray-600 mb-6">
              此操作将清空系统所有数据，包括：教师、学生、课程、教室、排课记录等，恢复初始状态。此操作不可撤销！
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 py-2 px-4 rounded-lg font-medium transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleClearAllData}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};

export default Backup;