import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import type { Student, Course, Room, LargeClassEntry } from '../types';
import { DAY_OF_WEEK_MAP } from '../types';

// HTML转义函数，防止XSS攻击
function escapeHtml(text: string): string {
  if (!text || typeof text !== 'string') return text;
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export const excelUtils = {
  async readFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  },

  parseStudents(data: any[], teacherId: string): Omit<Student, 'id' | 'created_at'>[] {
    const results: Omit<Student, 'id' | 'created_at'>[] = [];
    const errors: string[] = [];

    data.forEach((row, index) => {
      try {
        // 支持新的10字段结构：班级类型-年级-班级-学号-姓名-主项-副项1-副项2-副项3-备注
        // 对导入的字符串数据进行HTML转义，防止XSS攻击
        const classType = escapeHtml(row['班级类型'] || row['class_type']);
        const year = escapeHtml(row['年级'] || row['grade']);
        let className = escapeHtml(row['班级'] || row['class']);
        const studentId = escapeHtml(row['学号'] || row['student_id'] || `S${String(index + 1).padStart(4, '0')}`);
        const name = escapeHtml(row['姓名'] || row['name'] || `学生${index + 1}`);
        const primaryInstrument = escapeHtml(row['主项'] || row['primary_instrument'] || '');
        const secondary1 = escapeHtml(row['副项1'] || row['secondary1'] || '');
        const secondary2 = escapeHtml(row['副项2'] || row['secondary2'] || '');
        const secondary3 = escapeHtml(row['副项3'] || row['secondary3'] || '');
        const remarks = escapeHtml(row['备注'] || row['remarks'] || '');

        // 验证必填字段
        if (!classType) throw new Error(`班级类型为必填项（普通班/专升本）`);
        if (!year) throw new Error(`年级为必填项（如：2023级）`);
        if (!className) throw new Error(`班级为必填项（如：音乐学2301）`);
        if (!studentId) throw new Error(`学号为必填项`);
        if (!name) throw new Error(`姓名为必填项`);

        // 清理班级名称，防止重复的"音乐学"前缀（如"音乐学音乐学2301" -> "音乐学2301"）
        if (className.includes('音乐学音乐学')) {
          className = className.replace('音乐学音乐学', '音乐学');
        }
        // 也处理其他可能的重复前缀
        const prefixRegex = /^(音乐学|舞蹈学|美术学|表演系)\1+/;
        if (prefixRegex.test(className)) {
          className = className.replace(prefixRegex, '$1');
        }

        // 验证班级类型
        if (!['普通班', '专升本'].includes(classType)) {
          throw new Error(`班级类型只能是"普通班"或"专升本"，当前值为：${classType}`);
        }

        // 提取年级数字（如"2023级" -> 2023）
        const enrollmentYear = parseInt(year.toString().replace(/[^0-9]/g, '')) || new Date().getFullYear();
        // 保存完整的入学年份作为年级
        const gradeNum = enrollmentYear;
        // 同时保存入学年份用于导出
        const enrollmentYear4Digit = enrollmentYear;

        // 构建副项数组（过滤空值）
        const secondaryInstruments = [secondary1, secondary2, secondary3].filter(s => s && s.trim());

        // 验证填写规则
        if (primaryInstrument && primaryInstrument.trim()) {
          // 主项有值 + 2个副项 = 有主副项
          if (secondaryInstruments.length < 2) {
            throw new Error(`填写规则错误：有主副项格式需要2个副项`);
          }
        } else {
          // 主项为空 + 3个副项 = 通用（不分主副项）
          if (secondaryInstruments.length < 3) {
            throw new Error(`填写规则错误：通用格式需要3个副项，当前只有${secondaryInstruments.length}个`);
          }
        }

        // 根据填写规则处理主副项
        let primary = '';
        let finalSecondaryInstruments = [...secondaryInstruments];

        if (primaryInstrument && primaryInstrument.trim()) {
          // 主项有值 + 2个副项 = 有主副项
          primary = primaryInstrument.trim();
          finalSecondaryInstruments = secondaryInstruments;
        } else {
          // 主项为空 + 3个副项 = 通用（不分主副项）
          primary = ''; // 主项为空
          finalSecondaryInstruments = secondaryInstruments;
        }

        // 确定教研室代码
        let facultyCode = 'INSTRUMENT'; // 默认器乐教研室
        if (primary === '钢琴') {
          facultyCode = 'PIANO';
        } else if (primary === '声乐') {
          facultyCode = 'VOCAL';
        } else if (finalSecondaryInstruments.length > 0) {
          // 如果没有主项，根据第一个副项确定教研室
          const firstSecondary = finalSecondaryInstruments[0];
          if (firstSecondary === '钢琴') {
            facultyCode = 'PIANO';
          } else if (firstSecondary === '声乐') {
            facultyCode = 'VOCAL';
          }
        }

        results.push({
          teacher_id: teacherId,
          student_id: studentId,
          name: name,
          major_class: className, // 直接使用班级字段
          grade: gradeNum,
          enrollment_year: enrollmentYear,
          student_type: classType === '专升本' ? 'upgrade' as const : 'general' as const,
          primary_instrument: primary,
          secondary_instruments: finalSecondaryInstruments,
          remarks: remarks, // 器乐详细专业
          faculty_code: facultyCode,
          status: 'active' as const
        });
      } catch (error) {
        errors.push(`第${index + 1}行：${error instanceof Error ? error.message : '未知错误'}`);
      }
    });

    if (errors.length > 0) {
      throw new Error(`导入失败：\n${errors.join('\n')}`);
    }

    return results;
  },

  parseCourses(data: any[], teacherId: string): Omit<Course, 'id' | 'created_at'>[] {
    return data.map((row, index) => ({
      teacher_id: teacherId,
      course_name: escapeHtml(row['课程名称'] || row['course_name'] || `课程${index + 1}`),
      course_type: (escapeHtml(row['课程类型'] || row['course_type'] || '钢琴')) as '钢琴' | '声乐' | '器乐',
      student_id: row['学生ID'] || row['student_id'] ? escapeHtml(row['学生ID'] || row['student_id']) : undefined,
      student_name: row['学生姓名'] || row['student_name'] ? escapeHtml(row['学生姓名'] || row['student_name']) : undefined,
      duration: parseInt(row['课时长度'] || row['duration'] || '30'),
      week_frequency: parseInt(row['每周次数'] || row['week_frequency'] || '1'),
      course_category: 'general' as const,
    }));
  },

  parseRooms(data: any[], teacherId: string): Omit<Room, 'id' | 'created_at'>[] {
    return data.map((row, index) => ({
      teacher_id: teacherId,
      room_name: escapeHtml(row['教室名称'] || row['room_name'] || `教室${index + 1}`),
      room_type: (escapeHtml(row['教室类型'] || row['room_type'] || '琴房')) as '琴房' | '教室' | '大教室' | '排练厅',
      capacity: parseInt(row['容量'] || row['capacity'] || '1'),
    }));
  },
};

export const exportUtils = {
  exportToExcel(data: any[], fileName: string, sheetName: string = 'Sheet1') {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
  },

  exportSchedule(scheduledClasses: any[], fileName: string = '课表') {
    const exportData = scheduledClasses.map(cls => ({
      '课程名称': cls.courses?.course_name || '',
      '学生姓名': cls.students?.name || '',
      '教室': cls.rooms?.room_name || '',
      '星期': ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][cls.day_of_week - 1] || '',
      '节次': `第${cls.period}节`,
      '课程类型': cls.courses?.course_type || '',
      '状态': cls.status === 'scheduled' ? '已排课' : '已完成',
    }));
    this.exportToExcel(exportData, fileName, '课表');
  },

  exportStudents(students: Student[], fileName: string = '学生名单') {
    const exportData = students.map(s => ({
      '班级类型': s.student_type === 'upgrade' ? '专升本' : '普通班',
      '年级': s.enrollment_year || (s.major_class ? s.major_class.match(/(\d{4})/)?.[1] : ''),
      '班级': s.major_class,
      '学号': s.student_id,
      '姓名': s.name,
      '主项': s.primary_instrument || '',
      '副项1': s.secondary_instruments && s.secondary_instruments.length > 0 ? s.secondary_instruments[0] : '',
      '副项2': s.secondary_instruments && s.secondary_instruments.length > 1 ? s.secondary_instruments[1] : '',
      '副项3': s.secondary_instruments && s.secondary_instruments.length > 2 ? s.secondary_instruments[2] : '',
      '备注': s.remarks || ''
    }));
    this.exportToExcel(exportData, fileName, '学生');
  },

  exportCourses(courses: Course[], fileName: string = '课程列表') {
    const exportData = courses.map(c => ({
      '课程名称': c.course_name,
      '课程类型': c.course_type,
      '学生姓名': c.student_name || '',
      '课时长度(分钟)': c.duration,
      '每周次数': c.week_frequency,
    }));
    this.exportToExcel(exportData, fileName, '课程');
  },

  exportRooms(rooms: Room[], fileName: string = '教室列表') {
    const exportData = rooms.map(r => ({
      '教室名称': r.room_name,
      '教室类型': r.room_type,
      '容量': r.capacity,
    }));
    this.exportToExcel(exportData, fileName, '教室');
  },
};

export const generateId = (): string => uuidv4();

// ==================== 标准格式导出 ====================

export interface KKXXEntry {
  JXBID: string;
  XNXQ: string;
  JXBBH: string;
  JXBMC: string;
  FJXBID: string;
  FJXBBH: string;
  BJRS: number;
  KCMC: string;
  KCBH: string;
  XF: string;
  KCXZ: string;
  KKYXMC: string;
  KKYXBH: string;
  KKJYSMC: string;
  KKJYSBH: string;
  SFSJHJ: string;
  SKFS: string;
  KSXS: string;
  JXMS: string;
  KSFS: string;
  SFXK: string;
  SFPK: string;
  XB: string;
  RKJS: string;
  JXBZC: string;
}

export interface PKXXEntry {
  JXBID: string;
  XNXQ: string;
  JXBBH: string;
  JXBMC: string;
  BJMC: string;
  BJBH: string;
  KCBH: string;
  KCMC: string;
  RKJSID: number;
  RKJSGH: string;
  RKJSXM: string;
  FJID: string;
  FJMC: string;
  XN: string;
  XQ: string;
  ZC: string;
  SHOWZC: string;
  SKZC: string;
  SKXQ: string;
  JCFW: string;
  LXJC: string;
  CRMC: string;
  CRBH: string;
}

export interface XSXKEntry {
  XNXQ: string;
  XH: string;
  XM: string;
  JXBID: string;
  JXBBH: string;
  JXBMC: string;
  KCBH: string;
  KCMC: string;
  RKJS: string;
  JSGH: string;
  XDXZ: string;
  XDFS: string;
}

export const standardExportUtils = {
  exportKKXX(data: KKXXEntry[], fileName: string = '开课信息') {
    const exportData = data.map(entry => ({
      'JXBID': entry.JXBID,
      'XNXQ': entry.XNXQ,
      'JXBBH': entry.JXBBH,
      'JXBMC': entry.JXBMC,
      'FJXBID': entry.FJXBID,
      'FJXBBH': entry.FJXBBH,
      'BJRS': entry.BJRS,
      'KCMC': entry.KCMC,
      'KCBH': entry.KCBH,
      'XF': entry.XF,
      'KCXZ': entry.KCXZ,
      'KKYXMC': entry.KKYXMC,
      'KKYXBH': entry.KKYXBH,
      'KKJYSMC': entry.KKJYSMC,
      'KKJYSBH': entry.KKJYSBH,
      'SFSJHJ': entry.SFSJHJ,
      'SKFS': entry.SKFS,
      'KSXS': entry.KSXS,
      'JXMS': entry.JXMS,
      'KSFS': entry.KSFS,
      'SFXK': entry.SFXK,
      'SFPK': entry.SFPK,
      'XB': entry.XB,
      'RKJS': entry.RKJS,
      'JXBZC': entry.JXBZC,
    }));
    exportUtils.exportToExcel(exportData, fileName, '开课信息');
  },

  exportPKXX(data: PKXXEntry[], fileName: string = '排课信息') {
    const exportData = data.map(entry => ({
      'JXBID': entry.JXBID,
      'XNXQ': entry.XNXQ,
      'JXBBH': entry.JXBBH,
      'JXBMC': entry.JXBMC,
      'BJMC': entry.BJMC,
      'BJBH': entry.BJBH,
      'KCBH': entry.KCBH,
      'KCMC': entry.KCMC,
      'RKJSID': entry.RKJSID,
      'RKJSGH': entry.RKJSGH,
      'RKJSXM': entry.RKJSXM,
      'FJID': entry.FJID,
      'FJMC': entry.FJMC,
      'XN': entry.XN,
      'XQ': entry.XQ,
      'ZC': entry.ZC,
      'SHOWZC': entry.SHOWZC,
      'SKZC': entry.SKZC,
      'SKXQ': entry.SKXQ,
      'JCFW': entry.JCFW,
      'LXJC': entry.LXJC,
      'CRMC': entry.CRMC,
      'CRBH': entry.CRBH,
    }));
    exportUtils.exportToExcel(exportData, fileName, '排课信息');
  },

  exportXSXK(data: XSXKEntry[], fileName: string = '学生选课数据') {
    const exportData = data.map(entry => ({
      'XNXQ': entry.XNXQ,
      'XH': entry.XH,
      'XM': entry.XM,
      'JXBID': entry.JXBID,
      'JXBBH': entry.JXBBH,
      'JXBMC': entry.JXBMC,
      'KCBH': entry.KCBH,
      'KCMC': entry.KCMC,
      'RKJS': entry.RKJS,
      'JSGH': entry.JSGH,
      'XDXZ': entry.XDXZ,
      'XDFS': entry.XDFS,
    }));
    exportUtils.exportToExcel(exportData, fileName, '学生选课数据');
  },
};

// ==================== 大课表解析 ====================

interface ParsedClassInfo {
  courseName: string;
  teacherName: string;
  location: string;
  weekRange?: string;
}

/**
 * 解析大课表Excel文件
 * 特殊处理合并单元格的课表格式
 */
export const largeClassExcelUtils = {
  /**
   * 读取Excel文件并返回原始数据
   */
  async readFile(file: File): Promise<{ rawData: any[]; sheetName: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];

          // 获取单元格范围
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
          console.log(`Excel范围: ${XLSX.utils.encode_range(range)}`);

          // 提取所有单元格数据
          const rawData: any[] = [];
          for (let R = range.s.r; R <= range.e.r; ++R) {
            const row: any = { _rowIndex: R };
            for (let C = range.s.c; C <= range.e.c; ++C) {
              const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
              const columnName = XLSX.utils.encode_col(C);
              const cell = worksheet[cellAddress];

              if (cell) {
                let cellValue = cell.v;

                // 如果是日期格式，转换为字符串
                if (cell.t === 'n' && cell.z && cell.z.includes('yyyy')) {
                  // 处理日期
                  const date = XLSX.SSF.parse_date_code(cell.v);
                  cellValue = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
                }

                row[columnName] = cellValue;
              } else {
                // 即使单元格不存在，也标记该列存在（值为null）
                row[columnName] = null;
              }
            }
            rawData.push(row);
          }

          // 打印调试信息
          console.log(`读取了 ${rawData.length} 行数据`);
          console.log('星期行（行2）:', rawData[2]);
          console.log('节次行（行3）:', rawData[3]);
          console.log('数据行（行4）:', rawData[4]);

          resolve({ rawData, sheetName });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * 从原始数据中提取班级名称
   * 班级名称通常在第一列(A列)
   */
  extractClassNames(rawData: any[]): string[] {
    const classNames: string[] = [];
    const processedRows = new Set<number>();
    
    for (const row of rawData) {
      if (processedRows.has(row._rowIndex)) continue;
      
      const className = row['A'];
      if (className && typeof className === 'string' && className.includes('级音乐')) {
        classNames.push(className);
        processedRows.add(row._rowIndex);
      }
    }
    
    return classNames;
  },

  /**
   * 从单元格内容中解析课程信息
   */
  parseClassInfo(cellContent: string | undefined): ParsedClassInfo {
    if (!cellContent) {
      return { courseName: '', teacherName: '', location: '' };
    }

    const info: ParsedClassInfo = {
      courseName: '',
      teacherName: '',
      location: ''
    };

    // 分割多行内容
    const lines = cellContent.split('\n').map(s => s.trim()).filter(s => s);
    
    for (const line of lines) {
      // 匹配周次信息（如 "1-16周" 或 "1-8周"）
      if (/^\d+[-–]\d+周?$/.test(line) || /^\d+-\d+$/.test(line)) {
        info.weekRange = line.replace(/(\d+)-(\d+)/, '$1-$2周');
        continue;
      }
      
      // 匹配教室信息（如 "阶梯教室"）
      if (line.includes('教室') || line.includes('琴房') || line.includes('排练厅')) {
        info.location = line;
        continue;
      }
      
      // 假设第一部分是课程名称，第二部分是教师
      if (!info.courseName) {
        info.courseName = line;
      } else if (!info.teacherName) {
        info.teacherName = line;
      }
    }

    return info;
  },

  /**
   * 确定时间槽对应的星期和节次
   */
  determineTimeSlot(headerRow: any, columnName: string, weekDayRow?: any): { dayOfWeek: number; periodStart: number; periodEnd: number } | null {
    const cellValue = headerRow[columnName];
    if (!cellValue) return null;

    const timeStr = String(cellValue).trim();
    
    // 解析星期 - 优先使用第二行的星期信息
    let dayOfWeek = 0;
    if (weekDayRow) {
      const weekDayValue = weekDayRow[columnName];
      if (weekDayValue) {
        const weekDayStr = String(weekDayValue).trim();
        for (const [dayText, dayNum] of Object.entries(DAY_OF_WEEK_MAP)) {
          if (weekDayStr.includes(dayText)) {
            dayOfWeek = dayNum;
            break;
          }
        }
      }
    }
    
    // 如果没找到，尝试从当前行解析
    if (dayOfWeek === 0) {
      for (const [dayText, dayNum] of Object.entries(DAY_OF_WEEK_MAP)) {
        if (timeStr.includes(dayText)) {
          dayOfWeek = dayNum;
          break;
        }
      }
    }
    
    if (dayOfWeek === 0) return null;

    // 解析节次
    let periodStart = 1;
    let periodEnd = 1;

    // 匹配 "1-2节"、"3-4节" 等
    const rangeMatch = timeStr.match(/(\d+)[-–](\d+)节/);
    if (rangeMatch) {
      periodStart = parseInt(rangeMatch[1]);
      periodEnd = parseInt(rangeMatch[2]);
    } else {
      // 匹配单个节次 "第1节" 或纯数字
      const singleMatch = timeStr.match(/第?(\d+)节?/);
      if (singleMatch) {
        periodStart = parseInt(singleMatch[1]);
        periodEnd = periodStart;
      }
    }

    return { dayOfWeek, periodStart, periodEnd };
  },

  /**
   * 从单元格内容中解析课程信息（改进版）
   * 支持多种格式：
   * - "劳动教育- 实训指导教师:【3-4周】"
   * - "合唱与指挥（二）- 王冠慈:【1-2,5,7-18周】 音乐厅310"
   * - "创新素质培育（理论） 王薇：【1-5，8-17周】 实训207"（空格分隔格式）
   * - 多个课程用换行符分隔，如"劳动教育（理论）\n中国近现代史纲要"（提取所有周次并合并）
   */
  parseClassInfoImproved(cellContent: string | undefined): ParsedClassInfo[] {
    if (!cellContent) {
      return [];
    }

    const result: ParsedClassInfo[] = [];

    const cleanText = String(cellContent).trim();
    
    // 按换行符分割，处理多门课程的情况
    const courses = cleanText.split(/\n+/);
    
    // 提取所有课程的周次信息
    const allWeekRanges: string[] = [];
    
    for (const course of courses) {
      if (!course.trim()) continue;
      
      // 提取周次信息
      const weekMatch = course.match(/【([^】]+)】/);
      if (weekMatch) {
        allWeekRanges.push(weekMatch[1].trim());
      }
    }
    
    // 处理第一门课程
    if (courses.length > 0) {
      const firstCourse = courses[0].trim();
      const info: ParsedClassInfo = {
        courseName: '',
        teacherName: '',
        location: ''
      };

      // 提取第一门课程的周次信息（会被合并的周次替换）
      const weekMatch = firstCourse.match(/【([^】]+)】/);
      if (weekMatch) {
        info.weekRange = weekMatch[1].trim();
      }
      
      // 提取教室信息（周次之后的内容）
      const weekParts = firstCourse.split('】');
      if (weekParts.length > 1) {
        const afterWeek = weekParts[1].trim();
        if (afterWeek && !afterWeek.includes('【')) {
          info.location = afterWeek;
        }
      }
      
      // 提取课程名称和教师
      // 支持中文冒号和英文冒号
      const cleanTextWithEnglishColon = firstCourse.replace(/：/g, ':');
      
      // 格式1："课程名称- 教师名:【周次】" 或 "课程名称-教师名:【周次】"
      const colonParts = cleanTextWithEnglishColon.split(':');
      if (colonParts.length >= 2) {
        const beforeColon = colonParts[0].trim();
        
        // 优先检查是否包含"-"，这是最常见的格式
        if (beforeColon.includes('-')) {
          // 按 "-" 分割（最后一个 "-" 是分隔符）
          const dashParts = beforeColon.split('-');
          if (dashParts.length >= 2) {
            // 最后一个部分是教师，前面的是课程名称
            info.teacherName = dashParts[dashParts.length - 1].trim();
            info.courseName = dashParts.slice(0, dashParts.length - 1).join('-').trim();
          } else {
            // 格式2："教师名:【周次】" 格式
            info.courseName = beforeColon;
          }
        } else {
          // 检查是否包含空格，可能是空格分隔格式 "课程名称 教师名:【周次】"
          const spaceParts = beforeColon.split(/\s+/);
          if (spaceParts.length >= 2) {
            // 空格分隔格式：最后一个部分是教师，前面的是课程名称
            info.teacherName = spaceParts[spaceParts.length - 1].trim();
            info.courseName = spaceParts.slice(0, spaceParts.length - 1).join(' ').trim();
          } else {
            // 格式2："教师名:【周次】" 格式
            info.courseName = beforeColon;
          }
        }
      } else {
        // 格式3："创新素质培育（理论） 王薇：【1-5，8-17周】 实训207"（空格分隔格式）
        // 尝试按空格分割，找到包含":"的部分作为教师信息
        const parts = cleanTextWithEnglishColon.split(/\s+/);
        let courseNameParts: string[] = [];
        let foundTeacher = false;
        
        for (const part of parts) {
          if (part.includes(':')) {
            // 找到教师信息
            info.teacherName = part.replace(':', '').trim();
            foundTeacher = true;
          } else if (part.includes('【')) {
            // 找到周次信息，跳过
            continue;
          } else if (part.includes('】')) {
            // 找到周次结束，后面可能是地点，跳过
            continue;
          } else if (foundTeacher) {
            // 教师信息后面的可能是地点，跳过
            continue;
          } else {
            // 课程名称部分
            courseNameParts.push(part);
          }
        }
        
        if (courseNameParts.length > 0) {
          info.courseName = courseNameParts.join(' ').trim();
        } else {
          // 如果没有解析出课程名称，使用整个文本
          info.courseName = firstCourse;
        }
      }

      // 合并所有周次信息到第一门课程
      if (allWeekRanges.length > 0) {
        info.weekRange = allWeekRanges.join('; ');
      }

      // 确保至少有课程名称或教师姓名
      if (info.courseName || info.teacherName) {
        // 如果只有教师姓名，将其作为课程名称
        if (!info.courseName && info.teacherName) {
          info.courseName = info.teacherName;
          info.teacherName = '';
        }
        result.push(info);
      }
    }

    return result;
  },

  /**
   * 解析大课表数据（改进版 - 匹配实际Excel格式）
   * 实际格式：
   * - 行0: 标题 "2025-2026学年第2学期课程总表"
   * - 行1: 空行
   * - 行2: 星期 "一、一、一..." (7天)
   * - 行3: 节次 "1、2、3..." (11节)
   * - 行4+: 班级数据
   */
  parseLargeClassScheduleImproved(
    rawData: any[],
    academicYear: string,
    semesterLabel: string
  ): Omit<LargeClassEntry, 'id' | 'academic_year' | 'semester_label' | 'created_at'>[] {
    const entries: Omit<LargeClassEntry, 'id' | 'academic_year' | 'semester_label' | 'created_at'>[] = [];

    console.log('=== 开始解析大课表 ===');
    console.log(`总行数: ${rawData.length}`);

    // 星期行（行2）和节次行（行3）
    const weekDayRow = rawData[2];  // 包含"一、二、三..."
    const periodRow = rawData[3];   // 包含"1、2、3..."

    if (!weekDayRow || !periodRow) {
      console.error('无法找到表头行');
      console.log('尝试降级处理...');
      
      // 降级处理：假设简单的数据格式
      return this.parseSimpleFormat(rawData, academicYear, semesterLabel);
    }

    console.log('星期行数据:', JSON.stringify(weekDayRow, null, 2));
    console.log('节次行数据:', JSON.stringify(periodRow, null, 2));

    // 获取所有列名 - 从星期行(行2)获取
    const allColumns = Object.keys(weekDayRow || {}).filter(col => col !== '_rowIndex');
    console.log(`找到 ${allColumns.length} 个列:`, allColumns.slice(0, 10), '...');

    // 构建列到(星期, 节次)的映射
    const columnTimeMap = new Map<string, { dayOfWeek: number; period: number }>();

    for (const col of allColumns) {
      const periodValue = periodRow[col];
      if (!periodValue) continue;

      const periodStr = String(periodValue).trim();
      // 匹配节次数字（支持 "1" 或 "1、2" 等格式）
      const periodMatch = periodStr.match(/^(\d+)[、,，]?.*$/);
      if (!periodMatch) continue;

      const period = parseInt(periodMatch[1]);

      // 查找对应的星期
      const weekDayValue = weekDayRow[col];
      if (!weekDayValue) continue;

      const weekDayStr = String(weekDayValue).trim();
      let dayOfWeek = 0;
      for (const [dayText, dayNum] of Object.entries(DAY_OF_WEEK_MAP)) {
        if (weekDayStr === dayText || weekDayStr.includes(dayText)) {
          dayOfWeek = dayNum;
          break;
        }
      }

      if (dayOfWeek > 0) {
        columnTimeMap.set(col, { dayOfWeek, period });
      }
    }

    console.log(`找到 ${columnTimeMap.size} 个时间列`);
    console.log('时间列映射示例:', Array.from(columnTimeMap.entries()).slice(0, 5));

    // 遍历数据行（从行4开始）
    let processedRows = 0;
    for (let rowIndex = 4; rowIndex < rawData.length; rowIndex++) {
      const row = rawData[rowIndex];

      // 获取班级名称（A列）
      const classNameRaw = row['A'];
      console.log(`行${rowIndex} - A列原始值:`, classNameRaw);

      if (!classNameRaw) continue;

      // 班级名称格式："音乐学2201\n(25)" 或 "音乐学2301\n(26)" 或 "音乐学（专升本）2304"
      let className = String(classNameRaw).replace(/\s*\(\d+\)\s*/, '').replace(/\n/g, ' ').trim();
      // 将"音乐学（专升本）2304"改为"音乐学2304"
      className = className.replace(/（专升本）/g, '').replace(/\(专升本\)/g, '');
      className = className.replace(/专升本/g, '');
      console.log(`行${rowIndex} - 处理后班级名:`, className);

      if (!className.includes('音乐学')) continue;

      processedRows++;
      console.log(`处理班级: ${className}`);

      // 遍历每个时间列
      let foundCourses = 0;
      for (const [col, timeInfo] of columnTimeMap) {
        const cellContent = row[col];
        if (!cellContent) continue;

        console.log(`  列${col} - 内容:`, String(cellContent).substring(0, 100));

        // 解析课程信息（返回数组，可能包含多个课程）
        const classInfoList = this.parseClassInfoImproved(cellContent);

        for (const classInfo of classInfoList) {
          if (!classInfo.courseName) continue;

          foundCourses++;
          entries.push({
            class_name: className,
            course_name: classInfo.courseName,
            teacher_name: classInfo.teacherName || '未知教师',
            location: classInfo.location || '',
            day_of_week: timeInfo.dayOfWeek,
            period_start: timeInfo.period,
            period_end: timeInfo.period,
            week_range: classInfo.weekRange,
          });
        }
      }

      console.log(`  班级 ${className} 找到 ${foundCourses} 门课程`);
    }

    console.log(`处理了 ${processedRows} 个班级`);
    console.log(`解析完成，共 ${entries.length} 条记录`);
    return entries;
  },

  /**
   * 解析简单格式的Excel数据（降级处理）
   */
  parseSimpleFormat(
    rawData: any[],
    academicYear: string,
    semesterLabel: string
  ): Omit<LargeClassEntry, 'id' | 'academic_year' | 'semester_label' | 'created_at'>[] {
    const entries: Omit<LargeClassEntry, 'id' | 'academic_year' | 'semester_label' | 'created_at'>[] = [];

    console.log('=== 开始解析简单格式大课表 ===');
    console.log(`总行数: ${rawData.length}`);

    // 假设数据从第1行开始，第一行是表头
    for (let rowIndex = 1; rowIndex < rawData.length; rowIndex++) {
      const row = rawData[rowIndex];
      if (!row) continue;

      // 尝试解析不同列的数据
      // 假设：A列=课程名, B列=教师名, C列=时间(格式如"周一第1节"), D列=教室
      const courseName = row['A'] || row['课程名'] || '';
      const teacherName = row['B'] || row['教师名'] || '';
      const timeInfo = row['C'] || row['时间'] || '';
      const location = row['D'] || row['教室'] || '';

      if (!courseName) continue;

      console.log(`行${rowIndex} - 解析数据:`, { courseName, teacherName, timeInfo, location });

      // 解析时间信息
      let dayOfWeek = 1; // 默认为周一
      let periodStart = 1;
      let periodEnd = 1;

      if (timeInfo) {
        // 匹配 "周X第Y节" 格式
        const timeMatch = String(timeInfo).match(/周([一二三四五六日])第(\d+)节/);
        if (timeMatch) {
          const dayText = timeMatch[1];
          periodStart = parseInt(timeMatch[2]);
          periodEnd = periodStart;

          // 转换星期
          const dayMap: { [key: string]: number } = {
            '一': 1, '二': 2, '三': 3, '四': 4, 
            '五': 5, '六': 6, '日': 7
          };
          dayOfWeek = dayMap[dayText] || 1;
        }
      }

      // 如果没有时间信息，使用默认值
      if (!timeInfo) {
        dayOfWeek = Math.floor((rowIndex - 1) / 3) % 7 + 1; // 循环分配星期
        periodStart = ((rowIndex - 1) % 10) + 1; // 循环分配节次
        periodEnd = periodStart;
      }

      // 解析周次信息
      const weekRange = '1-16周'; // 默认16周

      entries.push({
        class_name: '音乐学2201', // 默认班级名
        course_name: String(courseName).trim(),
        teacher_name: String(teacherName || '未知教师').trim(),
        location: String(location || '').trim(),
        day_of_week: dayOfWeek,
        period_start: periodStart,
        period_end: periodEnd,
        week_range: weekRange
      });

      console.log(`成功解析课程: ${courseName} - ${teacherName} - 周${dayOfWeek}第${periodStart}节`);
    }

    console.log(`简单格式解析完成，共 ${entries.length} 条记录`);
    return entries;
  },
};
