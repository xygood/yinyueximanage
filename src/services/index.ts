import * as localStorageService from './localStorage';
import * as apiService from './api';
import * as apiAuthService from './authService';
import { teachingCalendarService } from './teachingCalendarService';
export * from './scheduleViewService';
export { STORAGE_KEYS } from './localStorage';

const USE_DATABASE = import.meta.env.VITE_USE_DATABASE === 'true';

export const teacherService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.teachersApi.getAll();
    }
    return localStorageService.teacherService.getAll();
  },

  async getById(id: string) {
    if (USE_DATABASE) {
      return apiService.teachersApi.getById(id);
    }
    return localStorageService.teacherService.getById(id);
  },

  async create(data: any) {
    if (USE_DATABASE) {
      return apiService.teachersApi.create(data);
    }
    return localStorageService.teacherService.create(data);
  },

  async update(id: string, data: any) {
    if (USE_DATABASE) {
      return apiService.teachersApi.update(id, data);
    }
    return localStorageService.teacherService.update(id, data);
  },

  async delete(id: string) {
    if (USE_DATABASE) {
      return apiService.teachersApi.delete(id);
    }
    return localStorageService.teacherService.delete(id);
  },

  async getByTeacherId(teacherId: string) {
    if (USE_DATABASE) {
      return apiService.teachersApi.getById(teacherId);
    }
    return localStorageService.teacherService.getByTeacherId(teacherId);
  },

  async importManyWithUpsert(teachers: any[]) {
    if (USE_DATABASE) {
      return apiService.teachersApi.batchCreate(teachers);
    }
    return localStorageService.teacherService.importManyWithUpsert(teachers);
  },

  async getTeacherRoomMappings() {
    if (USE_DATABASE) {
      return apiService.teachersApi.getRoomMappings();
    }
    return localStorageService.teacherService.getTeacherRoomMappings?.() || [];
  },

  async assignRoom(teacherId: string, roomId: string, facultyCode?: string) {
    if (USE_DATABASE) {
      return apiService.teachersApi.assignRoom(teacherId, roomId, facultyCode || '');
    }
    return localStorageService.teacherService.assignRoom?.(teacherId, roomId);
  },

  async removeRoomAssignment(teacherId: string, roomId: string) {
    if (USE_DATABASE) {
      return apiService.teachersApi.removeRoom(teacherId, roomId);
    }
    return localStorageService.teacherService.removeRoomAssignment?.(teacherId, roomId);
  },

  async getByFaculty(facultyCode: string) {
    return localStorageService.teacherService.getByFaculty?.(facultyCode) || [];
  },

  async getAvailableTeachers(instrument?: string) {
    return localStorageService.teacherService.getAvailableTeachers?.(instrument) || [];
  },

  async importTeacherRoomsByFaculty(entries: any[]) {
    if (USE_DATABASE) {
      return apiService.teachersApi.importRooms(entries);
    }
    return localStorageService.teacherService.importTeacherRoomsByFaculty(entries);
  }
};

export { teachingCalendarService };

export const studentService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.studentsApi.getAll();
    }
    return localStorageService.studentService.getAll();
  },

  async create(data: any) {
    if (USE_DATABASE) {
      return apiService.studentsApi.create(data);
    }
    return localStorageService.studentService.create(data);
  },

  async update(id: string, data: any) {
    if (USE_DATABASE) {
      return apiService.studentsApi.update(id, data);
    }
    return localStorageService.studentService.update(id, data);
  },

  async delete(id: string) {
    if (USE_DATABASE) {
      return apiService.studentsApi.delete(id);
    }
    return localStorageService.studentService.delete(id);
  },

  async getByTeacher(teacherId: string) {
    return localStorageService.studentService.getByTeacher(teacherId);
  },

  async importManyWithUpsert(students: any[]) {
    if (USE_DATABASE) {
      return apiService.studentsApi.batchCreate(students);
    }
    return localStorageService.studentService.importManyWithUpsert(students);
  },

  async getByFaculty(facultyCode: string) {
    return localStorageService.studentService.getByFaculty?.(facultyCode) || [];
  },

  async getByClass(className: string) {
    return localStorageService.studentService.getByClass?.(className) || [];
  },

  async getById(id: string) {
    return localStorageService.studentService.getById?.(id);
  }
};

export const courseService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.coursesApi.getAll();
    }
    return localStorageService.courseService.getAll();
  },

  async create(data: any) {
    if (USE_DATABASE) {
      return apiService.coursesApi.create(data);
    }
    return localStorageService.courseService.create(data);
  },

  async update(id: string, data: any) {
    if (USE_DATABASE) {
      return apiService.coursesApi.update(id, data);
    }
    return localStorageService.courseService.update(id, data);
  },

  async delete(id: string) {
    if (USE_DATABASE) {
      return apiService.coursesApi.delete(id);
    }
    return localStorageService.courseService.delete(id);
  },

  async getByTeacher(teacherId: string) {
    return localStorageService.courseService.getByTeacher(teacherId);
  },

  async getByStudent(studentId: string) {
    return localStorageService.courseService.getByStudent?.(studentId) || [];
  },

  async getByFaculty(facultyCode: string) {
    return localStorageService.courseService.getByFaculty?.(facultyCode) || [];
  }
};

export const roomService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.roomsApi.getAll();
    }
    return localStorageService.roomService.getAll();
  },

  async create(data: any) {
    if (USE_DATABASE) {
      return apiService.roomsApi.create(data);
    }
    return localStorageService.roomService.create(data);
  },

  async update(id: string, data: any) {
    if (USE_DATABASE) {
      return apiService.roomsApi.update(id, data);
    }
    return localStorageService.roomService.update(id, data);
  },

  async delete(id: string) {
    if (USE_DATABASE) {
      return apiService.roomsApi.delete(id);
    }
    return localStorageService.roomService.delete(id);
  },

  async getById(id: string) {
    return localStorageService.roomService.getById?.(id);
  },

  async getByFaculty(facultyCode: string) {
    return localStorageService.roomService.getByFaculty?.(facultyCode) || [];
  },

  async getAvailableRooms() {
    return localStorageService.roomService.getAvailableRooms?.() || [];
  }
};

export const scheduleService = {
  async getAll(params?: { teacher_id?: string; week_number?: number }) {
    if (USE_DATABASE) {
      return apiService.schedulesApi.getAll(params);
    }
    const all = await localStorageService.scheduleService.getAll();
    if (params?.teacher_id && all) {
      return all.filter((s: any) => s.teacher_id === params.teacher_id);
    }
    if (params?.week_number !== undefined && all) {
      return all.filter((s: any) => s.week_number === params.week_number);
    }
    return all;
  },

  async create(data: any) {
    if (USE_DATABASE) {
      return apiService.schedulesApi.create(data);
    }
    return localStorageService.scheduleService.create(data);
  },

  async update(id: string, data: any) {
    if (USE_DATABASE) {
      return apiService.schedulesApi.update(id, data);
    }
    return localStorageService.scheduleService.update(id, data);
  },

  async delete(id: string) {
    if (USE_DATABASE) {
      return apiService.schedulesApi.delete(id);
    }
    return localStorageService.scheduleService.delete(id);
  },

  async deleteMany(ids: string[]) {
    if (USE_DATABASE) {
      if (ids.length === 0) return { deleted: 0, ids: [] };
      return apiService.schedulesApi.deleteMany(ids);
    }
    for (const id of ids) {
      await localStorageService.scheduleService.delete(id);
    }
    return { deleted: ids.length, ids };
  },

  async getByTeacher(teacherId: string, startDate?: string, endDate?: string) {
    if (USE_DATABASE) {
      return apiService.schedulesApi.getAll({ teacher_id: teacherId });
    }
    return localStorageService.scheduleService.getByTeacher(teacherId, startDate, endDate);
  },

  async getByStudent(studentId: string) {
    if (USE_DATABASE) {
      const all = await apiService.schedulesApi.getAll();
      return all.filter((s: any) => s.student_id === studentId);
    }
    return localStorageService.scheduleService.getByStudent?.(studentId) || [];
  },

  async getByRoom(roomId: string) {
    if (USE_DATABASE) {
      const all = await apiService.schedulesApi.getAll();
      return all.filter((s: any) => s.room_id === roomId);
    }
    return localStorageService.scheduleService.getByRoom?.(roomId) || [];
  },

  async getByDateRange(startDate: string, endDate: string) {
    if (USE_DATABASE) {
      const all = await apiService.schedulesApi.getAll();
      return all.filter((s: any) => {
        if (!s.date) return false;
        return s.date >= startDate && s.date <= endDate;
      });
    }
    return localStorageService.scheduleService.getByDateRange?.(startDate, endDate) || [];
  },

  async getByWeek(weekNumber: number) {
    if (USE_DATABASE) {
      return apiService.schedulesApi.getAll({ week_number: weekNumber });
    }
    return localStorageService.scheduleService.getByWeek?.(weekNumber) || [];
  },

  async batchCreate(schedules: any[]) {
    if (USE_DATABASE) {
      return apiService.schedulesApi.batchCreate(schedules);
    }
    return localStorageService.scheduleService.batchCreate?.(schedules);
  },

  async createMany(schedules: any[]) {
    if (USE_DATABASE) {
      return apiService.schedulesApi.batchCreate(schedules);
    }
    return localStorageService.scheduleService.batchCreate?.(schedules) ||
           localStorageService.scheduleService.createMany?.(schedules);
  },

  /** 检查所有教师在同一时间是否被排了 2 节及以上课（同星期、同节次、周次重叠） */
  async getTeacherConflicts(semester_label?: string): Promise<{ conflicts: any[]; count: number }> {
    if (USE_DATABASE) {
      return apiService.schedulesApi.getTeacherConflicts(semester_label);
    }
    return { conflicts: [], count: 0 };
  }
};

export const blockedSlotService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.blockedSlotsApi.getAll();
    }
    return localStorageService.blockedSlotService.getAll();
  },

  async create(data: any) {
    if (USE_DATABASE) {
      return apiService.blockedSlotsApi.create(data);
    }
    return localStorageService.blockedSlotService.create(data);
  },

  async update(id: string, data: any) {
    if (USE_DATABASE) {
      return apiService.blockedSlotsApi.update(id, data);
    }
    return localStorageService.blockedSlotService.update(id, data);
  },

  async delete(id: string) {
    if (USE_DATABASE) {
      return apiService.blockedSlotsApi.delete(id);
    }
    return localStorageService.blockedSlotService.delete(id);
  },

  async getBySemester(semesterLabel: string) {
    if (USE_DATABASE) {
      const allSlots = await apiService.blockedSlotsApi.getAll();
      return allSlots.filter((s: any) => s.semester_label === semesterLabel);
    }
    return localStorageService.blockedSlotService.getBySemester?.(semesterLabel) || [];
  },

  async getByFaculty(facultyCode: string) {
    if (USE_DATABASE) {
      const allSlots = await apiService.blockedSlotsApi.getAll();
      return allSlots.filter((s: any) => s.faculty_code === facultyCode);
    }
    return localStorageService.blockedSlotService.getByFaculty?.(facultyCode) || [];
  },

  async getByClass(className: string) {
    if (USE_DATABASE) {
      const allSlots = await apiService.blockedSlotsApi.getAll();
      return allSlots.filter((s: any) => 
        s.class_associations?.some((c: any) => c.name === className || c.id === className)
      );
    }
    return localStorageService.blockedSlotService.getByClass?.(className) || [];
  },

  async batchCreate(slots: any[]) {
    if (USE_DATABASE) {
      return apiService.blockedSlotsApi.batchCreate(slots);
    }
    return localStorageService.blockedSlotService.batchCreate?.(slots);
  }
};

export const classService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.classesApi.getAll();
    }
    return localStorageService.classService.getAll();
  },
  async getById(id: string) {
    if (USE_DATABASE) {
      return apiService.classesApi.getById(id);
    }
    return localStorageService.classService.getById(id);
  },
  async getByClassName(className: string) {
    if (USE_DATABASE) {
      const classes = await apiService.classesApi.getAll();
      return classes.find((c: any) => c.class_name === className) || null;
    }
    return localStorageService.classService.getByClassName(className);
  },
  async syncFromStudents(students: any[]) {
    if (USE_DATABASE) {
      return;
    }
    return localStorageService.classService.syncFromStudents(students);
  }
};
export const authService = USE_DATABASE ? apiAuthService.authService : localStorageService.authService;

export const weekConfigService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.semesterConfigsApi.getAll();
    }
    return localStorageService.weekConfigService.getAll();
  },

  async getBySemester(semesterLabel: string) {
    if (USE_DATABASE) {
      return apiService.semesterConfigsApi.getBySemester(semesterLabel);
    }
    return localStorageService.weekConfigService.getBySemester(semesterLabel);
  },

  async upsert(data: any) {
    if (USE_DATABASE) {
      return apiService.semesterConfigsApi.upsert(data);
    }
    return localStorageService.weekConfigService.upsert(data);
  },

  async create(data: any) {
    if (USE_DATABASE) {
      return apiService.semesterConfigsApi.create(data);
    }
    return localStorageService.weekConfigService.create(data);
  },

  async update(id: string, data: any) {
    if (USE_DATABASE) {
      return apiService.semesterConfigsApi.update(id, data);
    }
    return localStorageService.weekConfigService.update(id, data);
  }
};

export const largeClassScheduleService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.largeClassScheduleApi.getAll();
    }
    return localStorageService.largeClassScheduleService.getAll();
  },
  async getEntries(semesterLabel?: string) {
    if (USE_DATABASE) {
      const all = await apiService.largeClassScheduleApi.getAll();
      const entries: any[] = [];
      for (const s of all) {
        if (semesterLabel && s.semester_label !== semesterLabel) continue;
        entries.push(...(s.entries || []));
      }
      return entries;
    }
    return localStorageService.largeClassScheduleService.getEntries(semesterLabel);
  },
  async importSchedule(
    fileName: string,
    academicYear: string,
    semesterLabel: string,
    entries: any[]
  ) {
    if (USE_DATABASE) {
      return apiService.largeClassScheduleApi.create({
        file_name: fileName,
        academic_year: academicYear,
        semester_label: semesterLabel,
        entries,
      });
    }
    return localStorageService.largeClassScheduleService.importSchedule(
      fileName,
      academicYear,
      semesterLabel,
      entries
    );
  },
  async clearAll() {
    if (USE_DATABASE) {
      return apiService.largeClassScheduleApi.clearAll();
    }
    return localStorageService.largeClassScheduleService.clearAll();
  },
};

export const studentTeacherAssignmentService = {
  async getAll() {
    if (USE_DATABASE) {
      // 数据库模式下，学生教师分配数据已包含在学生表的 assigned_teachers 字段中
      // 这里返回空数组，避免重复存储
      return [];
    }
    return localStorageService.studentTeacherAssignmentService.getAll();
  }
};

export const operationLogService = localStorageService.operationLogService;

export const syncService = {
  async getAll() {
    if (USE_DATABASE) {
      return apiService.syncApi.getAll();
    }
    return {
      teachers: await localStorageService.teacherService.getAll(),
      students: await localStorageService.studentService.getAll(),
      courses: await localStorageService.courseService.getAll(),
      rooms: await localStorageService.roomService.getAll(),
      schedules: await localStorageService.scheduleService.getAll(),
      blocked_slots: await localStorageService.blockedSlotService.getAll(),
      classes: await localStorageService.classService.getAll(),
    };
  },

  async import(data: any) {
    if (USE_DATABASE) {
      return apiService.syncApi.import(data);
    }
    if (data.teachers) {
      await localStorageService.teacherService.importManyWithUpsert(data.teachers);
    }
    if (data.students) {
      await localStorageService.studentService.importManyWithUpsert(data.students);
    }
    return { message: 'Data imported successfully' };
  },

  async clear() {
    if (USE_DATABASE) {
      return apiService.syncApi.clear();
    }
    localStorageService.clearAllData();
    return { message: 'All data cleared' };
  },
};

export default {
  teacherService,
  studentService,
  courseService,
  roomService,
  scheduleService,
  blockedSlotService,
  classService,
  authService,
  weekConfigService,
  largeClassScheduleService,
  studentTeacherAssignmentService,
  syncService,
};
