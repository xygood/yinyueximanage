import React, { useState, useRef, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  ChevronRight,
  CheckCircle,
  XCircle,
  Upload,
  Download,
  Zap,
  Settings,
  AlertTriangle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { studentService, teacherService } from '../services';

// 扩展的学生数据接口 - 支持多专业分配
interface Student {
  id: string;
  student_id: string;
  name: string;
  grade: number;
  class_name: string;
  major_class: string;           // 专业班级，如"音乐学2501"
  // 原有字段保持兼容
  instrument: string;
  faculty_code: string;
  assigned_teacher_id?: string;  // 向后兼容
  assigned_teacher_name?: string; // 向后兼容
  
  // 新增多专业分配字段
  primary_instrument: string;        // 主项专业
  secondary_instruments: string[];   // 副项列表（2-3个）
  secondary_instrument1?: string;     // 副项1专业（向后兼容）
  secondary_instrument2?: string;     // 副项2专业（向后兼容）
  secondary_instrument3?: string;     // 副项3专业（向后兼容）
  secondary1_teacher_id?: string;     // 副项1教师ID（向后兼容）
  secondary1_teacher_name?: string;   // 副项1教师姓名（向后兼容）
  secondary2_teacher_id?: string;     // 副项2教师ID（向后兼容）
  secondary2_teacher_name?: string;   // 副项2教师姓名（向后兼容）
  secondary3_teacher_id?: string;     // 副项3教师ID（向后兼容）
  secondary3_teacher_name?: string;   // 副项3教师姓名（向后兼容）
  notes?: string;                    // 备注信息
  
  // 分配给教师的映射
  assigned_teachers: {
    primary_teacher_id?: string;      // 主项教师
    primary_teacher_name?: string;   // 主项教师姓名
    secondary1_teacher_id?: string;   // 副项1教师
    secondary1_teacher_name?: string; // 副项1教师姓名
    secondary2_teacher_id?: string;   // 副项2教师
    secondary2_teacher_name?: string; // 副项2教师姓名
    secondary3_teacher_id?: string;   // 副项3教师
    secondary3_teacher_name?: string; // 副项3教师姓名
  };
}

// 扩展的教师数据接口 - 支持分配能力
interface Teacher {
  id: string;
  teacher_id?: string;
  name: string;
  faculty_name: string;
  faculty_code: string;
  instruments: string[];
  student_count: number;
}

const SmartStudentAssignment: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClass, setFilterClass] = useState<string>('all');
  const [filterMajor, setFilterMajor] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Map<string, string[]>>(new Map());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 获取专业名称的颜色样式（与Teachers页面可教课程颜色一致）
  const getInstrumentColorClass = (instrument: string): string => {
    if (instrument === '钢琴') return 'bg-blue-100 text-blue-700';
    if (instrument === '声乐') return 'bg-green-100 text-green-700';
    if (instrument === '音乐理论') return 'bg-purple-100 text-purple-700';
    return 'bg-orange-100 text-orange-700';
  };

  // 构建教师-乐器映射表
  const teacherInstrumentMap: Record<string, string[]> = {
    // 钢琴教师
    "吴玉敏": ["钢琴"], "杨柳": ["钢琴"], "邱林": ["钢琴"], "王冠慈": ["钢琴"], 
    "刘熹": ["钢琴"], "李馨荷": ["钢琴"], "周晓": ["钢琴"], "吴宇迪": ["钢琴"], "林琳": ["钢琴", "双排键"],
    // 声乐教师
    "邵荣": ["声乐"], "陈思仪": ["声乐"], "王琴": ["声乐"], "张辰": ["声乐"], 
    "吴姗姗": ["声乐"], "张鹏飞": ["声乐"], "梁吉": ["声乐"], "周旺": ["声乐"], 
    "唐仲": ["声乐"], "刘芸": ["声乐"], "周乐翟": ["声乐"], "吴京阳": ["声乐"], 
    "巫嵋": ["声乐"], "宋艳琼": ["声乐"],
    // 其他乐器教师
    "王武": ["竹笛", "葫芦丝", "古琴"], "徐颖": ["古筝"], "陈梦微": ["小提琴"], "庞博天": ["萨克斯"]
  };

  // 加载数据
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // 并行加载教师和学生数据
        const [teachersData, studentsData] = await Promise.all([
          teacherService.getAll(),
          studentService.getAll()
        ]);

        // 转换为教师显示格式
        const formattedTeachers: Teacher[] = teachersData.map(t => ({
          id: t.id,
          name: t.full_name || t.name || '未知教师',
          faculty_name: t.faculty_name || (t.faculty_id === 'PIANO' ? '钢琴专业' : t.faculty_id === 'VOCAL' ? '声乐专业' : '器乐专业'),
          faculty_code: t.faculty_id || t.faculty_code || 'PIANO',
          instruments: t.can_teach_instruments || [],
          student_count: studentsData.filter(s => s.teacher_id === t.id).length
        }));

        console.log('[教师分配] 加载教师数据:', formattedTeachers.length, '位');
        console.log('[教师分配] 教师列表示例:', formattedTeachers.slice(0, 3));

        // 转换为学生显示格式 - 扩展支持多专业分配
        const formattedStudents: Student[] = studentsData.map(s => {
          // 提取专业信息 - 优先使用新字段，兼容旧字段
          const primaryInstrument = s.primary_instrument || s.instrument || '钢琴';
          
          // 从secondary_instruments数组中提取副项信息
          const secondaryInstruments = s.secondary_instruments || [];
          const secondaryInstrument1 = s.secondary_instrument1 || secondaryInstruments[0] || null;
          const secondaryInstrument2 = s.secondary_instrument2 || secondaryInstruments[1] || null;
          const secondaryInstrument3 = s.secondary_instrument3 || secondaryInstruments[2] || null;
          
          // 构建分配教师映射
          const assignedTeachers = {
            primary_teacher_id: s.assigned_teachers?.primary_teacher_id || s.teacher_id,
            primary_teacher_name: s.assigned_teachers?.primary_teacher_name || 
                                 teachersData.find(t => t.id === (s.assigned_teachers?.primary_teacher_id || s.teacher_id) || t.teacher_id === (s.assigned_teachers?.primary_teacher_id || s.teacher_id))?.full_name || 
                                 teachersData.find(t => t.id === (s.assigned_teachers?.primary_teacher_id || s.teacher_id) || t.teacher_id === (s.assigned_teachers?.primary_teacher_id || s.teacher_id))?.name,
            secondary1_teacher_id: s.assigned_teachers?.secondary1_teacher_id || s.secondary1_teacher_id || undefined,
            secondary1_teacher_name: s.assigned_teachers?.secondary1_teacher_name || 
                                    teachersData.find(t => t.id === (s.assigned_teachers?.secondary1_teacher_id || s.secondary1_teacher_id) || t.teacher_id === (s.assigned_teachers?.secondary1_teacher_id || s.secondary1_teacher_id))?.full_name || 
                                    teachersData.find(t => t.id === (s.assigned_teachers?.secondary1_teacher_id || s.secondary1_teacher_id) || t.teacher_id === (s.assigned_teachers?.secondary1_teacher_id || s.secondary1_teacher_id))?.name,
            secondary2_teacher_id: s.assigned_teachers?.secondary2_teacher_id || s.secondary2_teacher_id || undefined,
            secondary2_teacher_name: s.assigned_teachers?.secondary2_teacher_name || 
                                    teachersData.find(t => t.id === (s.assigned_teachers?.secondary2_teacher_id || s.secondary2_teacher_id) || t.teacher_id === (s.assigned_teachers?.secondary2_teacher_id || s.secondary2_teacher_id))?.full_name || 
                                    teachersData.find(t => t.id === (s.assigned_teachers?.secondary2_teacher_id || s.secondary2_teacher_id) || t.teacher_id === (s.assigned_teachers?.secondary2_teacher_id || s.secondary2_teacher_id))?.name,
            secondary3_teacher_id: s.assigned_teachers?.secondary3_teacher_id || s.secondary3_teacher_id || undefined,
            secondary3_teacher_name: s.assigned_teachers?.secondary3_teacher_name || 
                                    teachersData.find(t => t.id === (s.assigned_teachers?.secondary3_teacher_id || s.secondary3_teacher_id) || t.teacher_id === (s.assigned_teachers?.secondary3_teacher_id || s.secondary3_teacher_id))?.full_name || 
                                    teachersData.find(t => t.id === (s.assigned_teachers?.secondary3_teacher_id || s.secondary3_teacher_id) || t.teacher_id === (s.assigned_teachers?.secondary3_teacher_id || s.secondary3_teacher_id))?.name,
          };

          return {
            id: s.id,
            student_id: s.student_id,
            name: s.name,
            grade: s.grade || 1,
            class_name: s.major_class || '',
            major_class: s.major_class || '',
            instrument: primaryInstrument, // 保持向后兼容
            faculty_code: s.faculty_code || 'PIANO',
            
            // 向后兼容字段
            assigned_teacher_id: assignedTeachers.primary_teacher_id,
            assigned_teacher_name: assignedTeachers.primary_teacher_name,
            teacher_id: assignedTeachers.primary_teacher_id, // 保持与旧字段兼容
            secondary1_teacher_id: assignedTeachers.secondary1_teacher_id,
            secondary1_teacher_name: assignedTeachers.secondary1_teacher_name,
            secondary2_teacher_id: assignedTeachers.secondary2_teacher_id,
            secondary2_teacher_name: assignedTeachers.secondary2_teacher_name,
            secondary3_teacher_id: assignedTeachers.secondary3_teacher_id,
            secondary3_teacher_name: assignedTeachers.secondary3_teacher_name,
            
            // 新增多专业字段
            primary_instrument: primaryInstrument,
            secondary_instrument1: secondaryInstrument1 || undefined,
            secondary_instrument2: secondaryInstrument2 || undefined,
            secondary_instrument3: secondaryInstrument3 || undefined,
            secondary_instruments: secondaryInstruments,
            notes: s.notes || '',
            
            // 分配教师映射
            assigned_teachers: assignedTeachers
          };
        });

        setTeachers(formattedTeachers);
        setStudents(formattedStudents);
        
      } catch (error) {
        console.error('加载数据失败:', error);
        alert('加载数据失败，请检查网络连接');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // 辅助函数：将教师分配到对应的专业列
  const assignTeacherToMajor = (
    studentEntry: { 
      primaryTeacher?: Teacher; 
      secondary1Teacher?: Teacher; 
      secondary2Teacher?: Teacher;
    },
    teacher: Teacher,
    instruments: string[],
    primaryMajor: string,
    secondary1Major: string,
    secondary2Major: string,
    assignedMajors: Set<string>
  ) => {
    
    // 检查主项
    if (primaryMajor && instruments.some(instrument => primaryMajor.includes(instrument) || instrument.includes(primaryMajor)) && !assignedMajors.has('primary')) {
      studentEntry.primaryTeacher = teacher;
      assignedMajors.add('primary');
    }
    // 检查副项1
    else if (secondary1Major && instruments.some(instrument => secondary1Major.includes(instrument) || instrument.includes(secondary1Major)) && !assignedMajors.has('secondary1')) {
      studentEntry.secondary1Teacher = teacher;
      assignedMajors.add('secondary1');
    }
    // 检查副项2
    else if (secondary2Major && instruments.some(instrument => secondary2Major.includes(instrument) || instrument.includes(secondary2Major)) && !assignedMajors.has('secondary2')) {
      studentEntry.secondary2Teacher = teacher;
      assignedMajors.add('secondary2');
    }
    // 如果没有匹配的专业，尝试分配到未分配的专业
    else {
      if (!assignedMajors.has('primary')) {
        studentEntry.primaryTeacher = teacher;
        assignedMajors.add('primary');
      } else if (!assignedMajors.has('secondary1')) {
        studentEntry.secondary1Teacher = teacher;
        assignedMajors.add('secondary1');
      } else if (!assignedMajors.has('secondary2')) {
        studentEntry.secondary2Teacher = teacher;
        assignedMajors.add('secondary2');
      }
    }
  };

  // 处理学生分配
  const processStudentAllocation = async (allocationResults: Array<{ student: Student; primaryTeacher?: Teacher; secondary1Teacher?: Teacher; secondary2Teacher?: Teacher; secondary3Teacher?: Teacher }>) => {
    const importResults: { success: number; failed: number; errors: string[] } = {
      success: 0,
      failed: 0,
      errors: []
    };


    // 构建新的学生数组
    let updatedStudents = [...students];

    for (const result of allocationResults) {
      const { student, primaryTeacher, secondary1Teacher, secondary2Teacher, secondary3Teacher } = result;

      try {
        // 更新学生分配状态
        updatedStudents = updatedStudents.map(s => {
          if (s.id === student.id) {
            // 创建深拷贝，确保嵌套对象也被正确复制
            const updated = {
              ...s,
              assigned_teachers: {
                ...(s.assigned_teachers || {})
              }
            };

            // 分配主项教师
            if (primaryTeacher) {
              const teacherWorkId = primaryTeacher.teacher_id || primaryTeacher.id;
              updated.assigned_teachers.primary_teacher_id = teacherWorkId;
              updated.assigned_teachers.primary_teacher_name = primaryTeacher.name;
              // 保持向后兼容
              updated.assigned_teacher_id = teacherWorkId;
              updated.assigned_teacher_name = primaryTeacher.name;
            }

            // 分配副项1教师
            if (secondary1Teacher) {
              const teacherWorkId = secondary1Teacher.teacher_id || secondary1Teacher.id;
              updated.assigned_teachers.secondary1_teacher_id = teacherWorkId;
              updated.assigned_teachers.secondary1_teacher_name = secondary1Teacher.name;
              // 保持向后兼容
              updated.secondary1_teacher_id = teacherWorkId;
              updated.secondary1_teacher_name = secondary1Teacher.name;
            }

            // 分配副项2教师
            if (secondary2Teacher) {
              const teacherWorkId = secondary2Teacher.teacher_id || secondary2Teacher.id;
              updated.assigned_teachers.secondary2_teacher_id = teacherWorkId;
              updated.assigned_teachers.secondary2_teacher_name = secondary2Teacher.name;
              // 保持向后兼容
              updated.secondary2_teacher_id = teacherWorkId;
              updated.secondary2_teacher_name = secondary2Teacher.name;
            }

            // 分配副项3教师
            if (secondary3Teacher) {
              const teacherWorkId = secondary3Teacher.teacher_id || secondary3Teacher.id;
              updated.assigned_teachers.secondary3_teacher_id = teacherWorkId;
              updated.assigned_teachers.secondary3_teacher_name = secondary3Teacher.name;
              // 保持向后兼容
              updated.secondary3_teacher_id = teacherWorkId;
              updated.secondary3_teacher_name = secondary3Teacher.name;
            }

            return updated;
          }
          return s;
        });

        // 保存到本地存储
        const updatedStudent = updatedStudents.find(s => s.id === student.id);
        if (updatedStudent) {
          await studentService.update(student.id, updatedStudent);
        }


        importResults.success++;
      } catch (error) {
        importResults.errors.push(`分配失败: ${student.name} - ${error}`);
        importResults.failed++;
        console.error(`分配失败: ${student.name}`, error);
      }
    }


    // 验证更新是否正确
    allocationResults.forEach(result => {
      const updatedStudent = updatedStudents.find(s => s.id === result.student.id);
      if (updatedStudent) {
      }
    });

    // 一次性更新学生状态
    setStudents(updatedStudents);

    return importResults;
  };

  // 处理文件导入（支持 Excel 和 CSV）
  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      let data: any[] = [];

      // 解析文件（支持 .xlsx, .xls, .csv）
      if (file.name.endsWith('.csv')) {
        const text = await file.text();
        const lines = text.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(v => v.trim());
        data = lines.slice(1).map(line => {
          const values = line.split(',').map(v => v.trim());
          const row: any = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          return row;
        });
      } else {
        // Excel 文件
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        data = XLSX.utils.sheet_to_json(firstSheet);
      }

      if (data.length === 0) {
        alert('模板文件格式不正确，请下载模板后重新填写');
        setImporting(false);
        return;
      }

      // 统计总行数
      const totalRows = data.length;

      // 直接读取Excel中的教师分配信息
      const studentTeacherMap = new Map<string, { 
        student: Student; 
        primaryTeacher?: Teacher; 
        secondary1Teacher?: Teacher; 
        secondary2Teacher?: Teacher; 
        secondary3Teacher?: Teacher; 
        className: string 
      }>();
      let processedRows = 0;
      let failedRows = 0;
      const errors: string[] = [];

      // 遍历数据，直接读取教师分配信息
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        
        // 提取学生信息
        const studentName = String(
          row['学生姓名'] || row['学生'] || row['student'] || row['student_name'] || 
          row['姓名'] || ''
        ).trim();
        const className = String(
          row['班级'] || row['class'] || row['专业班级'] || ''
        ).trim();
        // 从班级中提取班级号（如从"音乐学2301"提取"2301"）
        const classNumber = className.match(/(\d{4})/) ? className.match(/(\d{4})/)![1] : className;
        
        // 提取教师信息
        const primaryTeacherName = String(row['主项教师'] || '').trim();
        const secondary1TeacherName = String(row['副项1教师'] || '').trim();
        const secondary2TeacherName = String(row['副项2教师'] || '').trim();
        const secondary3TeacherName = String(row['副项3教师'] || '').trim();
        

        if (!studentName) continue;

        // 查找学生 - 更灵活的匹配逻辑
        let student = students.find(s => {
          const studentClassName = s.major_class || s.class_name || '';
          const studentClassNumber = studentClassName.match(/(\d{4})/) ? studentClassName.match(/(\d{4})/)![1] : studentClassName;
          
          // 优先按姓名和班级号匹配
          if (s.name === studentName && studentClassNumber === classNumber) {
            return true;
          }
          return false;
        });
        
        // 如果按班级号匹配失败，尝试只按姓名匹配
        if (!student) {
          student = students.find(s => s.name === studentName);
        }
        
        if (!student) {
          errors.push(`第${i + 1}行：找不到学生 "${studentName}${className ? '(' + className + ')' : ''}"`);
          failedRows++;
          continue;
        }

        // 生成学生唯一键（姓名 + 班级号）
        const studentKey = `${studentName}_${classNumber}`;

        // 如果学生还没有在映射中，创建一个新条目
        if (!studentTeacherMap.has(studentKey)) {
          // 查找教师
          const primaryTeacher = primaryTeacherName ? teachers.find(t => t.name === primaryTeacherName) : undefined;
          const secondary1Teacher = secondary1TeacherName ? teachers.find(t => t.name === secondary1TeacherName) : undefined;
          const secondary2Teacher = secondary2TeacherName ? teachers.find(t => t.name === secondary2TeacherName) : undefined;
          const secondary3Teacher = secondary3TeacherName ? teachers.find(t => t.name === secondary3TeacherName) : undefined;

          // 检查教师是否存在
          if (primaryTeacherName && !primaryTeacher) {
            errors.push(`第${i + 1}行：找不到主项教师 "${primaryTeacherName}"`);
            failedRows++;
          }
          if (secondary1TeacherName && !secondary1Teacher) {
            errors.push(`第${i + 1}行：找不到副项1教师 "${secondary1TeacherName}"`);
            failedRows++;
          }
          if (secondary2TeacherName && !secondary2Teacher) {
            errors.push(`第${i + 1}行：找不到副项2教师 "${secondary2TeacherName}"`);
            failedRows++;
          }
          if (secondary3TeacherName && !secondary3Teacher) {
            errors.push(`第${i + 1}行：找不到副项3教师 "${secondary3TeacherName}"`);
            failedRows++;
          }

          // 添加到映射
          studentTeacherMap.set(studentKey, { 
            student, 
            primaryTeacher,
            secondary1Teacher,
            secondary2Teacher,
            secondary3Teacher,
            className
          });

          processedRows++;
        }
      }


      // 构建分配结果 - 直接使用Excel中的教师分配信息
      const allocationResults: Array<{ student: Student; primaryTeacher?: Teacher; secondary1Teacher?: Teacher; secondary2Teacher?: Teacher; secondary3Teacher?: Teacher }> = [];

      // 处理每个学生的教师分配
      studentTeacherMap.forEach((entry, studentKey) => {
        const { student, primaryTeacher, secondary1Teacher, secondary2Teacher, secondary3Teacher, className } = entry;
        // 提取班级号用于显示
        const displayClass = className.match(/(\d{4})/) ? className.match(/(\d{4})/)![1] : className;

        // 创建分配结果
        const result = { 
          student, 
          primaryTeacher, 
          secondary1Teacher, 
          secondary2Teacher, 
          secondary3Teacher 
        };

        // 检查2304班级的分配
        if ((student.major_class || student.class_name)?.includes('2304')) {
          // 2304班级（专升本）：确保主项为空，只使用副项1-3
          result.primaryTeacher = undefined;
        }

        allocationResults.push(result);
      });


      // 处理分配
      const importResults = await processStudentAllocation(allocationResults);

      // 显示结果
      let resultMessage = `导入完成：Excel文件共 ${totalRows} 行，成功处理 ${processedRows} 行，成功分配 ${importResults.success} 个学生`;
      if (importResults.failed > 0) {
        resultMessage += `，失败 ${importResults.failed} 个学生`;
      }
      if (errors.length > 0) {
        resultMessage += `\n错误详情：\n${errors.slice(0, 5).join('\n')}`;
        if (errors.length > 5) {
          resultMessage += `\n...还有 ${errors.length - 5} 条错误`;
        }
      }
      alert(resultMessage);

    } catch (error) {
      console.error('导入失败:', error);
      alert('导入失败，请检查文件格式');
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 下载导入模板（Excel格式）
  const downloadTemplate = () => {
    const templateData = [
      {
        '学号': '20230401',
        '姓名': '沈进航',
        '班级': '2304',
        '主项专业': '声乐',
        '主项教师': '梁吉',
        '副项1': '钢琴',
        '副项1教师': '吴玉敏',
        '副项2': '-',
        '副项2教师': '-',
        '副项3': '-',
        '副项3教师': '-'
      },
      {
        '学号': '20230402',
        '姓名': '陈怡晓',
        '班级': '2304',
        '主项专业': '钢琴',
        '主项教师': '杨柳',
        '副项1': '声乐',
        '副项1教师': '张鹏飞',
        '副项2': '-',
        '副项2教师': '-',
        '副项3': '-',
        '副项3教师': '-'
      },
      {
        '学号': '20230403',
        '姓名': '程丹',
        '班级': '2304',
        '主项专业': '钢琴',
        '主项教师': '吴玉敏',
        '副项1': '声乐',
        '副项1教师': '张鹏飞',
        '副项2': '钢琴',
        '副项2教师': '林琳',
        '副项3': '-',
        '副项3教师': '-'
      },
      {
        '学号': '20230404',
        '姓名': '付宏宇',
        '班级': '2304',
        '主项专业': '声乐',
        '主项教师': '张辰',
        '副项1': '钢琴',
        '副项1教师': '杨柳',
        '副项2': '-',
        '副项2教师': '-',
        '副项3': '-',
        '副项3教师': '-'
      },
      {
        '学号': '20230405',
        '姓名': '付逸凡',
        '班级': '2304',
        '主项专业': '小提琴',
        '主项教师': '陈梦微',
        '副项1': '钢琴',
        '副项1教师': '吴玉敏',
        '副项2': '-',
        '副项2教师': '-',
        '副项3': '-',
        '副项3教师': '-'
      },
      {
        '学号': '20230406',
        '姓名': '何泽',
        '班级': '2304',
        '主项专业': '古筝',
        '主项教师': '徐颖',
        '副项1': '钢琴',
        '副项1教师': '杨柳',
        '副项2': '-',
        '副项2教师': '-',
        '副项3': '-',
        '副项3教师': '-'
      },
      {
        '学号': '20230407',
        '姓名': '黄誉安俐',
        '班级': '2304',
        '主项专业': '钢琴',
        '主项教师': '吴玉敏',
        '副项1': '声乐',
        '副项1教师': '梁吉',
        '副项2': '-',
        '副项2教师': '-',
        '副项3': '-',
        '副项3教师': '-'
      }
    ];

    // 创建工作簿和工作表
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);

    // 设置列宽
    ws['!cols'] = [
      { wch: 15 },  // 学号
      { wch: 10 },  // 姓名
      { wch: 10 },  // 班级
      { wch: 15 },  // 主项专业
      { wch: 12 },  // 主项教师
      { wch: 12 },  // 副项1
      { wch: 12 },  // 副项1教师
      { wch: 12 },  // 副项2
      { wch: 12 },  // 副项2教师
      { wch: 12 },  // 副项3
      { wch: 12 }   // 副项3教师
    ];

    XLSX.utils.book_append_sheet(wb, ws, '学生分配');
    XLSX.writeFile(wb, '智能学生分配导入模板.xlsx');
  };

  // 筛选学生
  const filteredStudents = students.filter(student => {
    const matchesSearch = student.name.includes(searchTerm) ||
                         String(student.student_id).includes(searchTerm);
    const matchesClass = filterClass === 'all' || student.major_class === filterClass || student.class_name === filterClass;
    const matchesMajor = filterMajor === 'all' || 
                        student.instrument === filterMajor ||
                        student.primary_instrument === filterMajor;
    
    // 根据具体专业类型检查分配状态
    const primaryAssigned = student.assigned_teacher_id || student.assigned_teachers?.primary_teacher_id;
    const secondary1Assigned = student.assigned_teachers?.secondary1_teacher_id;
    const secondary2Assigned = student.assigned_teachers?.secondary2_teacher_id;
    
    const matchesStatus = filterStatus === 'all' || 
                        (filterStatus === 'primary_unassigned' && !primaryAssigned) ||
                        (filterStatus === 'secondary1_unassigned' && !secondary1Assigned) ||
                        (filterStatus === 'secondary2_unassigned' && !secondary2Assigned) ||
                        (filterStatus === 'any_unassigned' && (!primaryAssigned || !secondary1Assigned || !secondary2Assigned)) ||
                        (filterStatus === 'assigned' && (primaryAssigned || secondary1Assigned || secondary2Assigned));
    
    return matchesSearch && matchesClass && matchesMajor && matchesStatus;
  });

  // 获取唯一班级列表
  const uniqueClasses = [...new Set(students.map(s => s.major_class || s.class_name).filter(Boolean))].sort();
  
  // 获取唯一专业列表
  const uniqueMajors = [...new Set(students.map(s => s.instrument).filter(Boolean))].sort();

  // 分页计算
  const totalPages = Math.ceil(filteredStudents.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedStudents = filteredStudents.slice(startIndex, endIndex);

  // 学生数据映射逻辑 - 统一处理所有班级
  const getStudentDataForDisplay = (student: Student) => {
    // 检查是否为2304班级
    const isClass2304 = (student.major_class || student.class_name)?.includes('2304');
    
    // 2304班级：主项为空，副项1-3显示导入数据
    if (isClass2304) {
      const primaryMajor = ''; // 主项为空
      const secondary1Major = student.secondary_instrument1 || (student.secondary_instruments && student.secondary_instruments[0]) || '';
      const secondary2Major = student.secondary_instrument2 || (student.secondary_instruments && student.secondary_instruments[1]) || '';
      const secondary3Major = student.secondary_instrument3 || (student.secondary_instruments && student.secondary_instruments[2]) || '';
      
      // 教师分配映射
      const primaryTeacher = ''; // 主项教师为空
      const secondary1Teacher = student.assigned_teachers?.secondary1_teacher_name || '';
      const secondary2Teacher = student.assigned_teachers?.secondary2_teacher_name || '';
      const secondary3Teacher = student.assigned_teachers?.secondary3_teacher_name || '';
      
      return {
        primaryMajor,
        primaryTeacher,
        secondary1Major,
        secondary1Teacher,
        secondary2Major,
        secondary2Teacher,
        secondary3Major,
        secondary3Teacher,
        instrument: student.notes || ''
      };
    } else {
      // 其他班级：正常显示主项和副项1-2，副项3为空
      const primaryMajor = student.primary_instrument || student.instrument || '';
      const secondary1Major = student.secondary_instrument1 || (student.secondary_instruments && student.secondary_instruments[0]) || '';
      const secondary2Major = student.secondary_instrument2 || (student.secondary_instruments && student.secondary_instruments[1]) || '';
      const secondary3Major = ''; // 普通班副项3为空
      
      const primaryTeacher = student.assigned_teachers?.primary_teacher_name || 
                           student.assigned_teacher_name || '';
      const secondary1Teacher = student.assigned_teachers?.secondary1_teacher_name || '';
      const secondary2Teacher = student.assigned_teachers?.secondary2_teacher_name || '';
      const secondary3Teacher = ''; // 普通班副项3教师为空
      
      return {
        primaryMajor,
        primaryTeacher,
        secondary1Major,
        secondary1Teacher,
        secondary2Major,
        secondary2Teacher,
        secondary3Major,
        secondary3Teacher,
        instrument: student.instrument || ''
      };
    }
  };

  // 从备注中提取具体乐器类型的函数
  const extractInstrumentFromNotes = (notes: string, instrumentType: string): string => {
    if (instrumentType !== '器乐' || !notes) return instrumentType;
    
    // 从备注中提取具体乐器类型
    const instrumentKeywords = [
      '古筝', '竹笛', '二胡', '琵琶', '古琴', '柳琴', '阮', '扬琴',
      '笛子', '箫', '葫芦丝', '笙', '唢呐', '巴乌', '陶笛', '木笛',
      '小提琴', '中提琴', '大提琴', '低音提琴', '单簧管', '双簧管',
      '萨克斯', '小号', '长号', '圆号', '大号', '长笛', '短笛',
      '打击乐', '马林巴', '钢琴', '电子琴', '手风琴'
    ];
    
    // 检查备注中是否包含具体乐器
    for (const keyword of instrumentKeywords) {
      if (notes.includes(keyword)) {
        return keyword;
      }
    }
    
    return '器乐'; // 如果没有找到具体乐器，返回默认器乐
  };

  // 辅助函数：根据乐器获取对应的教师列表
  const getTeachersForInstrument = (instrument: string) => {
    if (!instrument) return [];
    return teachers.filter(teacher => {
      const instruments = teacherInstrumentMap[teacher.name] || teacher.instruments;
      return instruments.some(tInstrument => instrument.includes(tInstrument) || tInstrument.includes(instrument));
    });
  };

  // 处理教师选择变化的函数
  const handleTeacherChange = async (studentId: string, position: string, teacherId: string) => {
    setStudents(prevStudents => {
      let updatedStudent = null;
      const updatedStudents = prevStudents.map(student => {
        if (student.id === studentId) {
          const updated = {
            ...student,
            assigned_teachers: {
              ...(student.assigned_teachers || {})
            }
          };
          
          const teacher = teachers.find(t => t.teacher_id === teacherId || t.id === teacherId);
          if (position === 'primary') {
            updated.assigned_teachers.primary_teacher_id = teacherId || undefined;
            updated.assigned_teachers.primary_teacher_name = teacher?.name || undefined;
            updated.assigned_teacher_id = teacherId || undefined;
            updated.assigned_teacher_name = teacher?.name || undefined;
            // 同步更新主字段，避免专业小课页面仍用 teacher_id 匹配导致原教师处仍显示该学生
            updated.teacher_id = teacherId || undefined;
          } else if (position === 'secondary1') {
            updated.assigned_teachers.secondary1_teacher_id = teacherId || undefined;
            updated.assigned_teachers.secondary1_teacher_name = teacher?.name || undefined;
            updated.secondary1_teacher_id = teacherId || undefined;
            updated.secondary1_teacher_name = teacher?.name || undefined;
          } else if (position === 'secondary2') {
            updated.assigned_teachers.secondary2_teacher_id = teacherId || undefined;
            updated.assigned_teachers.secondary2_teacher_name = teacher?.name || undefined;
            updated.secondary2_teacher_id = teacherId || undefined;
            updated.secondary2_teacher_name = teacher?.name || undefined;
          } else if (position === 'secondary3') {
            updated.assigned_teachers.secondary3_teacher_id = teacherId || undefined;
            updated.assigned_teachers.secondary3_teacher_name = teacher?.name || undefined;
            updated.secondary3_teacher_id = teacherId || undefined;
            updated.secondary3_teacher_name = teacher?.name || undefined;
          }
          
          updatedStudent = updated;
          return updated;
        }
        return student;
      });
      
      // 保存到本地存储
      if (updatedStudent) {
        studentService.update(studentId, updatedStudent)
          .then(() => {
          })
          .catch(error => {
            console.error(`保存学生教师分配数据失败:`, error);
          });
      }
      
      return updatedStudents;
    });
  };

  // 切换学生选择
  const toggleStudentSelection = (studentId: string) => {
    const newSelected = new Set(selectedStudents);
    if (newSelected.has(studentId)) {
      newSelected.delete(studentId);
    } else {
      newSelected.add(studentId);
    }
    setSelectedStudents(newSelected);
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedStudents.size === filteredStudents.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(filteredStudents.map(s => s.id)));
    }
  };

  // 加载状态
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1380px] mx-auto px-4 py-3 sm:py-4 lg:py-6">
        {/* 页面标题 */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-3">
                <Users className="w-6 h-6 text-purple-600" />
                学生分配
              </h1>
              <p className="text-gray-600 mt-2">
                为学生分配专业教师，支持Excel批量导入
              </p>
            </div>
            
            {/* 功能按钮区域 */}
            <div className="flex items-center gap-3">
              {/* 下载模板按钮 */}
              <button
                onClick={downloadTemplate}
                className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 text-sm"
              >
                <Download className="w-4 h-4" />
                <span>下载模板</span>
              </button>

              {/* 导入按钮 */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm"
              >
                {importing ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                <span>导入分配</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileImport}
                className="hidden"
              />
              
              <span className="text-sm text-gray-500">
                已选 {selectedStudents.size} 名
              </span>
            </div>
          </div>
        </div>

        {/* 筛选器 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索学生姓名或学号"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex flex-col">
              <select
                value={filterClass}
                onChange={(e) => setFilterClass(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部班级</option>
                {uniqueClasses.map(cls => (
                  <option key={cls} value={cls}>{cls}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col">
              <select
                value={filterMajor}
                onChange={(e) => setFilterMajor(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部专业</option>
                {uniqueMajors.map(major => (
                  <option key={major} value={major}>{major}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部状态</option>
                <option value="primary_unassigned">主项未分配</option>
                <option value="secondary1_unassigned">副项1未分配</option>
                <option value="secondary2_unassigned">副项2未分配</option>
                <option value="any_unassigned">任一未分配</option>
                <option value="assigned">已分配</option>
              </select>
            </div>
          </div>
        </div>

        {/* 学生列表 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-4">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-600" />
                学生列表
                <span className="text-sm font-normal text-purple-600 bg-purple-50 px-2 py-1 rounded">
                  {filteredStudents.length} 名
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedStudents.size === filteredStudents.length && filteredStudents.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">全选</span>
              </div>
            </div>
          </div>

          {/* 学生列表 */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0 border-b-2 border-gray-200">
                <tr>
                  <th className="px-3 sm:px-4 py-4 text-left w-12">
                    <input
                      type="checkbox"
                      checked={selectedStudents.size === filteredStudents.length && filteredStudents.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">序号</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">学号</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">姓名</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">班级</th>
                  
                  {/* 多专业分配列 */}
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">主项专业</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">主项教师</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">副项1</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">副项1教师</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">副项2</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">副项2教师</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">副项3</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">副项3教师</th>
                  <th className="px-3 sm:px-4 py-4 text-left text-sm font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedStudents.map((student, index) => {
                  const studentErrors = validationErrors.get(student.id);
                  const studentData = getStudentDataForDisplay(student);
                  const actualIndex = startIndex + index + 1;
                  
                  return (
                    <tr
                      key={student.id}
                      className={`hover:bg-gray-50 transition-all duration-200 group ${
                        selectedStudents.has(student.id) ? 'bg-blue-50' : ''
                      } ${
                        studentErrors ? 'bg-red-50' : ''
                      }`}
                    >
                      <td className="px-3 sm:px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selectedStudents.has(student.id)}
                          onChange={() => toggleStudentSelection(student.id)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 sm:px-4 py-4 text-sm text-gray-500 font-normal font-mono">{actualIndex}</td>
                      <td className="px-3 sm:px-4 py-4 text-sm text-gray-600 font-mono">
                        <span 
                          className="cursor-pointer hover:text-blue-600 transition-colors"
                        >
                          {String(student.student_id)}
                        </span>
                      </td>
                      <td className="px-3 sm:px-4 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-normal text-gray-900">{student.name}</span>
                          {studentErrors && (
                            <span className="text-xs text-red-600 flex items-center gap-1 mt-1">
                              <XCircle className="w-3 h-3" />
                              {studentErrors[0]}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 sm:px-4 py-4 text-sm text-gray-600 font-normal font-mono">
                        {(student.major_class || student.class_name)?.replace('音乐学', '') || student.major_class || student.class_name}
                      </td>
                       
                      {/* 多专业分配显示 */}
                      <>
                        {/* 主项专业和教师 */}
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {(() => {
                            const instrument = extractInstrumentFromNotes(student.notes || '', studentData.primaryMajor);
                            return (
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-normal ${getInstrumentColorClass(instrument)}`}>
                                {instrument}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {/* 检查是否为2304班级（专升本） */}
                          {(student.major_class || student.class_name)?.includes('2304') ? (
                            <span className="text-sm text-gray-400">-</span>
                          ) : editingStudentId === student.id ? (
                            <select
                              value={student.assigned_teachers?.primary_teacher_id || ''}
                              onChange={(e) => handleTeacherChange(student.id, 'primary', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">未分配</option>
                              {getTeachersForInstrument(studentData.primaryMajor).map(teacher => (
                                <option key={teacher.id} value={teacher.teacher_id || teacher.id}>
                                  {teacher.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm font-normal">
                              {studentData.primaryTeacher || '未分配'}
                            </span>
                          )}
                        </td>
                        
                        {/* 副项1专业和教师 */}
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {studentData.secondary1Major ? (
                            (() => {
                              const instrument = extractInstrumentFromNotes(student.notes || '', studentData.secondary1Major);
                              return (
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-normal ${getInstrumentColorClass(instrument)}`}>
                                  {instrument}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
                              未设置
                            </span>
                          )}
                        </td>
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {editingStudentId === student.id ? (
                            <select
                              value={student.assigned_teachers?.secondary1_teacher_id || ''}
                              onChange={(e) => handleTeacherChange(student.id, 'secondary1', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">未分配</option>
                              {getTeachersForInstrument(studentData.secondary1Major).map(teacher => (
                                <option key={teacher.id} value={teacher.teacher_id || teacher.id}>
                                  {teacher.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm font-normal">
                              {studentData.secondary1Teacher || '未分配'}
                            </span>
                          )}
                        </td>
                        
                        {/* 副项2专业和教师 */}
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {studentData.secondary2Major ? (
                            (() => {
                              const instrument = extractInstrumentFromNotes(student.notes || '', studentData.secondary2Major);
                              return (
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-normal ${getInstrumentColorClass(instrument)}`}>
                                  {instrument}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
                              未设置
                            </span>
                          )}
                        </td>
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {editingStudentId === student.id ? (
                            <select
                              value={student.assigned_teachers?.secondary2_teacher_id || ''}
                              onChange={(e) => handleTeacherChange(student.id, 'secondary2', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">未分配</option>
                              {getTeachersForInstrument(studentData.secondary2Major).map(teacher => (
                                <option key={teacher.id} value={teacher.teacher_id || teacher.id}>
                                  {teacher.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm font-normal">
                              {studentData.secondary2Teacher || '未分配'}
                            </span>
                          )}
                        </td>
                        
                        {/* 副项3专业和教师 */}
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {(student.major_class || student.class_name)?.includes('2304') ? (
                            studentData.secondary3Major ? (
                              (() => {
                                const instrument = extractInstrumentFromNotes(student.notes || '', studentData.secondary3Major);
                                return (
                                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-normal ${getInstrumentColorClass(instrument)}`}>
                                    {instrument}
                                  </span>
                                );
                              })()
                            ) : (
                              <span className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
                                未设置
                              </span>
                            )
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {(student.major_class || student.class_name)?.includes('2304') ? (
                            editingStudentId === student.id ? (
                              <select
                                value={student.assigned_teachers?.secondary3_teacher_id || ''}
                                onChange={(e) => handleTeacherChange(student.id, 'secondary3', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">未分配</option>
                              {getTeachersForInstrument(studentData.secondary3Major).map(teacher => (
                                <option key={teacher.id} value={teacher.teacher_id || teacher.id}>
                                  {teacher.name}
                                </option>
                              ))}
                              </select>
                            ) : (
                              <span className="text-sm font-normal">
                                {studentData.secondary3Teacher || '未分配'}
                              </span>
                            )
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        
                        {/* 操作列 */}
                        <td className="px-3 sm:px-4 py-4 text-sm text-gray-900">
                          {editingStudentId === student.id ? (
                            <div className="flex gap-2">
                              <button
                                onClick={() => setEditingStudentId(null)}
                                className="px-2 py-1 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setEditingStudentId(null)}
                                className="px-2 py-1 bg-gray-600 text-white rounded-lg text-xs hover:bg-gray-700"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingStudentId(student.id)}
                              className="px-2 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              编辑
                            </button>
                          )}
                        </td>
                      </>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 分页控件 */}
          <div className="px-4 py-3 border-t border-gray-200 bg-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              {/* 每页显示数量 */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">每页显示：</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1); // 重置到第一页
                  }}
                  className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value={10}>10条</option>
                  <option value={20}>20条</option>
                  <option value={50}>50条</option>
                  <option value={100}>100条</option>
                </select>
              </div>

              {/* 页码导航 */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                {/* 分页信息 */}
                <div className="text-sm text-gray-600">
                  显示 {startIndex + 1} - {Math.min(endIndex, filteredStudents.length)} 条，共 {filteredStudents.length} 条
                </div>

                {/* 分页按钮 */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    上一页
                  </button>

                  {/* 页码按钮 */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else {
                      if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`px-3 py-1 border rounded-lg text-sm ${currentPage === pageNum ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-50'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    下一页
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SmartStudentAssignment;