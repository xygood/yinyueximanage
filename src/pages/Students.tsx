import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNotification } from '../contexts/NotificationContext';
import { EnhancedTable, ColumnConfig, ColumnSettings, BatchAction, SortConfig } from '../components/EnhancedTable';
import { studentService, courseService, classService, operationLogService } from '../services';
import { excelUtils, exportUtils } from '../utils/excel';
import * as XLSX from 'xlsx';
import { Upload, Download, Plus, Trash2, Edit2, FileSpreadsheet, X, Users, GraduationCap, Filter, BarChart3, CheckSquare, Square, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Student } from '../types';
import { INSTRUMENTS, getMaxStudentsForInstrument } from '../types';
import { ConfirmationDialog } from '../components/NotificationComponents';
import StudentListFilters from '../components/StudentListFilters';

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

export default function Students() {
  const { user, teacher } = useAuth();
  const { showSuccess, showError, showWarning, showInfo } = useNotification();
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);

  // 搜索和筛选条件
  const [searchTerm, setSearchTerm] = useState('');
  
  // 新的筛选状态
  const [currentFilters, setCurrentFilters] = useState({
    classType: '',
    year: '',
    class: '',
    primaryInstrument: '',
    secondaryInstrument: ''
  });

  // 表格增强功能状态
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'student_id', direction: 'asc' });
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [recordsToDelete, setRecordsToDelete] = useState<string[]>([]);

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10); // 默认每页10条

  // 统计数据
  const [stats, setStats] = useState({
    total: 0,
    piano: 0,
    vocal: 0,
    instrument: 0
  });

  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null); // 编辑模式的学生
  const [formData, setFormData] = useState({
    student_id: '',
    name: '',
    major_class: '',
    grade: '',
    student_type: 'general' as 'general' | 'upgrade',
    primary_instrument: '',
    secondary_instruments: [] as string[],
    remarks: ''
  });
  const [editFormData, setEditFormData] = useState({
    student_id: '',
    name: '',
    major_class: '',
    grade: '',
    student_type: 'general' as 'general' | 'upgrade',
    primary_instrument: '',
    secondary_instruments: [] as string[],
    remarks: ''
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 模拟班级数据（根据实际班级情况调整）
  const MOCK_CLASSES: Class[] = [
    // 2023级普通班
    { id: 'c1', class_id: '2301', class_name: '音乐学2301', enrollment_year: 2023, class_number: 1, student_count: 30, student_type: 'general', status: 'active', created_at: '2023-09-01T00:00:00Z' },
    { id: 'c2', class_id: '2302', class_name: '音乐学2302', enrollment_year: 2023, class_number: 2, student_count: 28, student_type: 'general', status: 'active', created_at: '2023-09-01T00:00:00Z' },
    { id: 'c3', class_id: '2303', class_name: '音乐学2303', enrollment_year: 2023, class_number: 3, student_count: 32, student_type: 'general', status: 'active', created_at: '2023-09-01T00:00:00Z' },
    // 2023级专升本
    { id: 'c4', class_id: '2304', class_name: '专升本2304', enrollment_year: 2023, class_number: 4, student_count: 25, student_type: 'upgrade', status: 'active', created_at: '2023-09-01T00:00:00Z' },
    // 2024级普通班
    { id: 'c5', class_id: '2401', class_name: '音乐学2401', enrollment_year: 2024, class_number: 1, student_count: 35, student_type: 'general', status: 'active', created_at: '2024-09-01T00:00:00Z' },
    { id: 'c6', class_id: '2402', class_name: '音乐学2402', enrollment_year: 2024, class_number: 2, student_count: 32, student_type: 'general', status: 'active', created_at: '2024-09-01T00:00:00Z' },
    { id: 'c7', class_id: '2403', class_name: '音乐学2403', enrollment_year: 2024, class_number: 3, student_count: 30, student_type: 'general', status: 'active', created_at: '2024-09-01T00:00:00Z' },
    // 2025级普通班
    { id: 'c8', class_id: '2501', class_name: '音乐学2501', enrollment_year: 2025, class_number: 1, student_count: 38, student_type: 'general', status: 'active', created_at: '2025-09-01T00:00:00Z' },
    { id: 'c9', class_id: '2502', class_name: '音乐学2502', enrollment_year: 2025, class_number: 2, student_count: 36, student_type: 'general', status: 'active', created_at: '2025-09-01T00:00:00Z' },
    { id: 'c10', class_id: '2503', class_name: '音乐学2503', enrollment_year: 2025, class_number: 3, student_count: 34, student_type: 'general', status: 'active', created_at: '2025-09-01T00:00:00Z' },
  ];

  // 获取学生班级（返回完整的班级名称）
  const getStudentClass = (s: Student): string => {
    // 优先使用 class_name 字段
    const className = (s as any).class_name;
    if (className) {
      return className;
    }
    // 如果有 major_class 字段，直接使用
    if (s.major_class) {
      return s.major_class;
    }
    // 从 class_id 查找班级名称
    const classId = (s as any).class_id;
    if (classId) {
      const cls = classes.find(c => c.class_id === classId || c.id === classId);
      if (cls) {
        return cls.class_name;
      }
      return classId;
    }
    return '-';
  };

  // 获取学生备注（显示器乐的具体专业，如：古筝、竹笛、葫芦丝、古琴等）
  const getStudentRemarks = (s: Student): string => {
    // 如果有 remarks 字段，显示具体器乐专业
    if (s.remarks) {
      return s.remarks;
    }
    // 如果没有 remarks 字段，显示 '-'
    return '-';
  };

  // 获取学生副项
  const getStudentSecondaryInstruments = (s: Student): string => {
    if (s.secondary_instruments && s.secondary_instruments.length > 0) {
      return s.secondary_instruments.join(', ');
    }
    return '-';
  };

  // 获取学生乐器（兼容旧版本）
  const getStudentInstrument = (s: Student): string => {
    // 专升本学生没有主项，返回空字符串
    const studentClass = getStudentClass(s);
    if (studentClass.includes('2304') || s.student_type === 'upgrade') {
      return '';
    }
    if (s.primary_instrument) return s.primary_instrument;
    if (s.secondary_instruments && s.secondary_instruments.length > 0) return s.secondary_instruments[0];
    return '钢琴';
  };

  // 获取乐器大类（钢琴/声乐/器乐）
  const getInstrumentCategory = (instrument: string): string => {
    if (instrument === '钢琴' || instrument === '钢琴伴奏' || instrument === '钢琴合奏') return 'piano';
    if (instrument === '声乐' || instrument === '合唱') return 'vocal';
    return 'instrument';
  };

  // 获取专业名称的颜色样式（与Teachers页面可教课程颜色一致）
  const getInstrumentColorClass = (instrument: string): string => {
    if (instrument === '钢琴') return 'bg-blue-100 text-blue-700';
    if (instrument === '声乐') return 'bg-green-100 text-green-700';
    if (instrument === '音乐理论') return 'bg-purple-100 text-purple-700';
    return 'bg-orange-100 text-orange-700';
  };

  // 检查乐器是否匹配过滤条件（支持大类和小类）
  // 处理新的筛选器变化
  const handleFiltersChange = (filters: any) => {
    setCurrentFilters(filters);
  };

  // 处理重置筛选器
  const handleResetFilters = () => {
    setSearchTerm('');
  };



  // 从现有数据中动态获取副项选项（所有具体专业）


  // 表格列配置
  const [columns, setColumns] = useState<ColumnConfig[]>([
    {
      key: 'select',
      label: '',
      visible: true,
      sortable: false,
      width: 'w-12'
    },
    {
      key: 'sequence',
      label: '序号',
      visible: true,
      sortable: false,
      width: 'w-16',
      render: (value: any, record: Student) => (
        <span className="text-sm text-gray-500 font-normal">
          {(record as any).sequenceNumber || '-'}
        </span>
      )
    },
    {
      key: 'student_id',
      label: '学号',
      visible: true,
      sortable: true,
      width: 'w-24',
      render: (value: string) => (
        <span className="font-mono text-sm text-gray-700">{value}</span>
      )
    },
    {
      key: 'name',
      label: '姓名',
      visible: true,
      sortable: true,
      width: 'w-20',
      render: (value: string) => (
        <span>{value}</span>
      )
    },
    {
      key: 'class',
      label: '班级',
      visible: true,
      sortable: true,
      width: 'w-24',
      render: (value: any, record: Student) => (
        <span className="text-sm text-gray-600">{getStudentClass(record)}</span>
      )
    },
    {
      key: 'type',
      label: '班级类型',
      visible: true,
      sortable: true,
      width: 'w-20',
      render: (value: string, record: Student) => {
        // 检查是否为2304班级或专升本类型
        const studentClass = getStudentClass(record);
        const isUpgrade = studentClass.includes('2304') || value === 'upgrade' || record.student_type === 'upgrade';

        return (
          <span className={`inline-block px-2 py-1 text-xs rounded-full ${
            isUpgrade ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {isUpgrade ? '专升本' : '普通班'}
          </span>
        );
      }
    },
    {
      key: 'grade',
      label: '年级',
      visible: true,
      sortable: true,
      width: 'w-20',
      render: (value: number) => (
        <span className="text-sm text-gray-700">
          {value ? `${value}级` : '-'}
        </span>
      )
    },
    {
      key: 'primary_instrument',
      label: '主项',
      visible: true,
      sortable: true,
      width: 'w-20',
      render: (value: string, record: Student) => {
        // 2304班级取消主项列的数据显示
        const studentClass = getStudentClass(record);
        if (studentClass === '2304') {
          return (
            <span className="text-sm text-gray-400">-</span>
          );
        }

        // 其他班级正常显示主项
        const displayInstrument = getStudentInstrument(record);
        if (!displayInstrument) {
          return (
            <span className="text-sm text-gray-400">-</span>
          );
        }
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${getInstrumentColorClass(displayInstrument)}`}>
            <span className="truncate max-w-16" title={displayInstrument}>{displayInstrument}</span>
          </span>
        );
      }
    },
    {
      key: 'secondary_instrument_1',
      label: '副项1',
      visible: true,
      sortable: false,
      width: 'w-20',
      render: (value: string[], record: Student) => {
        // 统一显示副项1，取消专升本学生的特殊处理
        const displayInstrument = record.secondary_instruments?.[0];
        if (!displayInstrument) {
          return (
            <span className="text-sm text-gray-400 max-w-20 truncate">-</span>
          );
        }
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${getInstrumentColorClass(displayInstrument)}`} title={displayInstrument}>
            <span className="truncate max-w-16">{displayInstrument}</span>
          </span>
        );
      }
    },
    {
      key: 'secondary_instrument_2',
      label: '副项2',
      visible: true,
      sortable: false,
      width: 'w-20',
      render: (value: string[], record: Student) => {
        const displayInstrument = record.secondary_instruments?.[1];
        if (!displayInstrument) {
          return (
            <span className="text-sm text-gray-400 max-w-20 truncate">-</span>
          );
        }
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${getInstrumentColorClass(displayInstrument)}`} title={displayInstrument}>
            <span className="truncate max-w-16">{displayInstrument}</span>
          </span>
        );
      }
    },
    {
      key: 'secondary_instrument_3',
      label: '副项3',
      visible: true,
      sortable: false,
      width: 'w-20',
      render: (value: string[], record: Student) => {
        const displayInstrument = record.secondary_instruments?.[2];
        if (!displayInstrument) {
          return (
            <span className="text-sm text-gray-400 max-w-20 truncate">-</span>
          );
        }
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${getInstrumentColorClass(displayInstrument)}`} title={displayInstrument}>
            <span className="truncate max-w-16">{displayInstrument}</span>
          </span>
        );
      }
    },
    {
      key: 'remarks',
      label: '备注',
      visible: true,
      sortable: true,
      width: 'w-24',
      render: (value: string, record: Student) => (
        <span className="text-sm text-gray-600 max-w-24 truncate" title={getStudentRemarks(record)}>
          {getStudentRemarks(record)}
        </span>
      )
    },
    {
      key: 'actions',
      label: '操作',
      visible: true,
      sortable: false,
      width: 'w-20'
    }
  ]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 获取所有学生（不分教师）
        const studentsData = await studentService.getAll();
        // 为学生数据添加序号，并确保2304班级的学生类型为专升本
        const studentsWithSequence = studentsData.map((student, index) => {
          // 检查是否为2304班级
          const studentClass = getStudentClass(student);
          const isUpgrade = studentClass === '2304' || student.student_type === 'upgrade';
          
          return {
            ...student,
            student_type: isUpgrade ? 'upgrade' : student.student_type || 'general',
            sequenceNumber: index + 1
          };
        });
        setStudents(studentsWithSequence);

        // 获取真实班级数据
        const classesData = await classService.getAll();
        setClasses(classesData.length > 0 ? classesData : MOCK_CLASSES);

        // 计算统计数据
        const pianoCount = studentsData.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'piano').length;
        const vocalCount = studentsData.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'vocal').length;
        const instrumentCount = studentsData.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'instrument').length;

        setStats({
          total: studentsData.length,
          piano: pianoCount,
          vocal: vocalCount,
          instrument: instrumentCount
        });
      } catch (error) {
        console.error('获取数据失败:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // 当教师信息加载完成后，设置默认专业
  useEffect(() => {
    if (teacher && teacher.can_teach_instruments && teacher.can_teach_instruments.length > 0) {
      setFormData(prev => ({
        ...prev,
        instrument: prev.instrument || teacher.can_teach_instruments[0]
      }));
    }
  }, [teacher]);

  // 当筛选条件变化时，重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, currentFilters]);

  // 过滤后的学生列表（使用新的统一筛选逻辑）
  const filteredStudents = useMemo(() => {
    let result = [...students];
    
    // 文本搜索
    const searchLower = searchTerm.toLowerCase();
    if (searchLower) {
      result = result.filter(s => {
        const instrument = getStudentInstrument(s);
        return (
          String(s.name || '').toLowerCase().includes(searchLower) ||
          String(s.student_id || '').toLowerCase().includes(searchLower) ||
          instrument.toLowerCase().includes(searchLower) ||
          s.major_class?.toLowerCase().includes(searchLower)
        );
      });
    }
    
    // 应用新的筛选器
    // 按班级类型筛选
    if (currentFilters.classType) {
      result = result.filter(s => s.student_type === currentFilters.classType);
    }
    
    // 按年级筛选
    if (currentFilters.year) {
      result = result.filter(s => s.grade === parseInt(currentFilters.year));
    }
    
    // 按具体班级筛选
    if (currentFilters.class) {
      result = result.filter(s => s.major_class === currentFilters.class);
    }
    
    // 按主项筛选
    if (currentFilters.primaryInstrument) {
      result = result.filter(s => s.primary_instrument === currentFilters.primaryInstrument);
    }
    
    // 按副项筛选
    if (currentFilters.secondaryInstrument) {
      result = result.filter(s => 
        s.secondary_instruments && 
        s.secondary_instruments.includes(currentFilters.secondaryInstrument)
      );
    }
    
    // 排序并添加序号
    const sortedResult = result.sort((a, b) => String(a.student_id || '').localeCompare(String(b.student_id || '')));
    
    // 为每个学生添加序号
    return sortedResult.map((student, index) => ({
      ...student,
      sequenceNumber: index + 1
    }));
  }, [students, searchTerm, currentFilters]);



  // 分页后的学生列表
  const paginatedStudents = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredStudents.slice(startIndex, endIndex);
  }, [filteredStudents, currentPage, pageSize]);

  // 计算总页数
  const totalPages = useMemo(() => {
    return Math.ceil(filteredStudents.length / pageSize);
  }, [filteredStudents.length, pageSize]);

  // 乐器选项已迁移到新的筛选组件中

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      // 年级：从输入文本解析数字（如 "2025级" -> 2025），保存为后端 grade 字段
      const gradeStr = String(formData.grade || '').trim();
      const gradeNum = parseGradeFromInput(gradeStr);

      const primaryInst = formData.primary_instrument;
      const facultyCode = primaryInst === '钢琴' ? 'PIANO' : primaryInst === '声乐' ? 'VOCAL' : primaryInst ? 'INSTRUMENT' : '';
      const secondaryList = formData.secondary_instruments || [];
      const [sec1, sec2, sec3] = secondaryList;

      await studentService.create({
        teacher_id: user.id,
        student_id: formData.student_id,
        name: formData.name,
        major_class: formData.major_class,
        grade: gradeNum,
        student_type: formData.student_type,
        primary_instrument: formData.primary_instrument,
        secondary_instruments: secondaryList,
        secondary_instrument1: sec1 || null,
        secondary_instrument2: sec2 || null,
        secondary_instrument3: sec3 || null,
        faculty_code: facultyCode,
        remarks: formData.remarks,
        status: 'active'
      });

      showSuccess('添加成功', '学生信息已成功保存');
      setShowModal(false);
      setFormData({ student_id: '', name: '', major_class: '', grade: '', student_type: 'general', primary_instrument: '', secondary_instruments: [], remarks: '' });
      
      const data = await studentService.getAll();
      // 为学生数据添加序号，并确保2304班级的学生类型为专升本
      const studentsWithSequence = data.map((student, index) => {
        // 检查是否为2304班级
        const studentClass = getStudentClass(student);
        const isUpgrade = studentClass === '2304' || student.student_type === 'upgrade';
        
        return {
          ...student,
          student_type: isUpgrade ? 'upgrade' : student.student_type || 'general',
          sequenceNumber: index + 1
        };
      });
      setStudents(studentsWithSequence);

      // 更新统计
      const pianoCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'piano').length;
      const vocalCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'vocal').length;
      const instrumentCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'instrument').length;
      setStats({ total: data.length, piano: pianoCount, vocal: vocalCount, instrument: instrumentCount });
    } catch (error) {
      console.error('保存学生失败:', error);
      showError('添加失败', '保存学生信息时出错，请重试');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await studentService.delete(id);
      showSuccess('删除成功', '学生信息已成功删除');
      
      const data = await studentService.getAll();
      // 为学生数据添加序号，并确保2304班级的学生类型为专升本
      const studentsWithSequence = data.map((student, index) => {
        // 检查是否为2304班级
        const studentClass = getStudentClass(student);
        const isUpgrade = studentClass === '2304' || student.student_type === 'upgrade';
        
        return {
          ...student,
          student_type: isUpgrade ? 'upgrade' : student.student_type || 'general',
          sequenceNumber: index + 1
        };
      });
      setStudents(studentsWithSequence);

      // 更新统计
      const pianoCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'piano').length;
      const vocalCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'vocal').length;
      const instrumentCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'instrument').length;
      setStats({ total: data.length, piano: pianoCount, vocal: vocalCount, instrument: instrumentCount });
    } catch (error) {
      console.error('删除学生失败:', error);
      showError('删除失败', '无法删除学生信息，请重试');
    }
  };

  // 打开编辑弹窗
  const handleEdit = (student: Student) => {
    setEditingStudent(student);
    const isUpgrade = student.student_type === 'upgrade' || student.major_class?.includes('2304');
    const g = (student as any).grade;
    const gradeDisplay = g != null && g !== '' ? (typeof g === 'number' ? `${g}级` : String(g)) : '';
    setEditFormData({
      student_id: student.student_id,
      name: student.name,
      major_class: student.major_class || '',
      grade: gradeDisplay,
      student_type: student.student_type || 'general',
      primary_instrument: isUpgrade ? '' : (student.primary_instrument || ''),
      secondary_instruments: student.secondary_instruments || [],
      remarks: student.remarks || ''
    });
  };

  // 从年级输入解析为数字（如 "2025级"、"2025" -> 2025；"25" -> 2025）
  const parseGradeFromInput = (input: string): number => {
    const s = String(input || '').replace(/\s/g, '');
    const digits = s.replace(/\D/g, '');
    if (!digits) return new Date().getFullYear();
    const num = parseInt(digits, 10);
    if (digits.length <= 2) return 2000 + num; // 25 -> 2025
    return num;
  };

  // 保存编辑后的学生信息（使用表单中输入的年级，不再从班级推导）
  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;

    try {
      // 年级：使用表单输入的文本解析为数字保存
      const gradeNum = parseGradeFromInput(editFormData.grade);

      const primaryInst = editFormData.primary_instrument;
      const facultyCode = primaryInst === '钢琴' ? 'PIANO' : primaryInst === '声乐' ? 'VOCAL' : primaryInst ? 'INSTRUMENT' : '';
      const secondaryList = editFormData.secondary_instruments || [];
      const [sec1, sec2, sec3] = secondaryList;

      await studentService.update(editingStudent.id, {
        student_id: editFormData.student_id,
        name: editFormData.name,
        major_class: editFormData.major_class,
        grade: gradeNum,
        student_type: editFormData.student_type,
        primary_instrument: editFormData.primary_instrument,
        secondary_instruments: secondaryList,
        secondary_instrument1: sec1 || null,
        secondary_instrument2: sec2 || null,
        secondary_instrument3: sec3 || null,
        faculty_code: facultyCode,
        remarks: editFormData.remarks,
        status: 'active'
      });
      
      showSuccess('更新成功', '学生信息已成功保存');
      setEditingStudent(null);
      
      const data = await studentService.getAll();
      // 为学生数据添加序号，并确保2304班级的学生类型为专升本
      const studentsWithSequence = data.map((student, index) => {
        // 检查是否为2304班级
        const studentClass = getStudentClass(student);
        const isUpgrade = studentClass === '2304' || student.student_type === 'upgrade';
        
        return {
          ...student,
          student_type: isUpgrade ? 'upgrade' : student.student_type || 'general',
          sequenceNumber: index + 1
        };
      });
      setStudents(studentsWithSequence);

      // 更新统计
      const pianoCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'piano').length;
      const vocalCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'vocal').length;
      const instrumentCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'instrument').length;
      setStats({ total: data.length, piano: pianoCount, vocal: vocalCount, instrument: instrumentCount });
    } catch (error) {
      console.error('更新学生失败:', error);
      showError('更新失败', '保存学生信息时出错，请重试');
    }
  };

  // 下载导入模板（Excel格式）- 支持新的10字段结构和填写规则
  const downloadTemplate = () => {
    const templateData = [
      { 
        '班级类型': '普通班', 
        '年级': '2024',
        '班级': '音乐学2401',
        '学号': '2024001',
        '姓名': '张三', 
        '主项': '钢琴',
        '副项1': '声乐',
        '副项2': '古筝',
        '副项3': '',
        '备注': '填写规则：班级类型：必填项，普通班、专升本。年级：必填项，如2023级。班级：必填项，如音乐学2301代表2023级1班。学号：必填项，唯一标识每个学生。姓名：必填项。主项为空 + 3个副项 = 通用（不分主副项）。主项有值 + 2个副项 = 有主副项'
      },
      { 
        '班级类型': '普通班', 
        '年级': '2024',
        '班级': '音乐学2402',
        '学号': '2024002',
        '姓名': '李四', 
        '主项': '声乐',
        '副项1': '钢琴',
        '副项2': '小提琴',
        '副项3': '',
        '备注': '示例：有主副项格式。主项有值，填写2个副项。钢琴课程：钢琴，声乐课程：声乐，器乐课程：古筝、竹笛、葫芦丝、古琴、小提琴、萨克斯、双排键'
      },
      { 
        '班级类型': '专升本', 
        '年级': '2023',
        '班级': '音乐学2301',
        '学号': '2023001',
        '姓名': '王五', 
        '主项': '',
        '副项1': '古筝',
        '副项2': '竹笛',
        '副项3': '葫芦丝',
        '备注': '示例：通用格式。主项为空，填写3个副项。钢琴课程：钢琴，声乐课程：声乐，器乐课程：古筝、竹笛、葫芦丝、古琴、小提琴、萨克斯、双排键'
      },
      { 
        '班级类型': '专升本', 
        '年级': '2023',
        '班级': '音乐学2302',
        '学号': '2023002',
        '姓名': '赵六', 
        '主项': '',
        '副项1': '古琴',
        '副项2': '萨克斯',
        '副项3': '小提琴',
        '备注': '通用格式：古琴、萨克斯、小提琴。钢琴课程：钢琴，声乐课程：声乐，器乐课程：古筝、竹笛、葫芦丝、古琴、小提琴、萨克斯、双排键'
      },
      { 
        '班级类型': '普通班', 
        '年级': '2023',
        '班级': '音乐学2303',
        '学号': '2023003',
        '姓名': '孙七', 
        '主项': '双排键',
        '副项1': '钢琴',
        '副项2': '声乐',
        '副项3': '',
        '备注': '有主副项格式：主项双排键，辅修钢琴和声乐。钢琴课程：钢琴，声乐课程：声乐，器乐课程：古筝、竹笛、葫芦丝、古琴、小提琴、萨克斯、双排键'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    
    // 设置列宽
    const cols = [
      { wch: 8 },   // 班级类型
      { wch: 6 },   // 年级
      { wch: 6 },   // 班级
      { wch: 12 },  // 学号
      { wch: 8 },   // 姓名
      { wch: 8 },   // 主项
      { wch: 8 },   // 副项1
      { wch: 8 },   // 副项2
      { wch: 8 },   // 副项3
      { wch: 30 },  // 备注
    ];
    ws['!cols'] = cols;

    XLSX.utils.book_append_sheet(wb, ws, '学生信息');
    XLSX.writeFile(wb, '学生信息导入模板.xlsx');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadFile(file);
    setUploading(true);
    setUploadProgress('正在解析文件...');
    try {
      const data = await excelUtils.readFile(file);
      const parsedStudents = excelUtils.parseStudents(data, user.id);
      setUploadProgress(`正在导入 ${parsedStudents.length} 条记录...`);
      const result = await studentService.importManyWithUpsert(parsedStudents);
      setUploadProgress(`导入完成！新增 ${result.created} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`);
      
      // 记录操作日志
      await operationLogService.log(
        '导入学生数据',
        'system',
        `导入学生数据：新增 ${result.created} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`,
        undefined,
        undefined
      );
      
      showSuccess('导入完成', `成功导入 ${result.created} 条记录，更新 ${result.updated} 条记录`);
      
      setTimeout(() => {
        setUploadFile(null);
        setUploading(false);
        const fetchStudents = async () => {
          const data = await studentService.getAll();
          // 为学生数据添加序号
          const studentsWithSequence = data.map((student, index) => ({
            ...student,
            sequenceNumber: index + 1
          }));
          setStudents(studentsWithSequence);

          // 更新统计
          const pianoCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'piano').length;
          const vocalCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'vocal').length;
          const instrumentCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'instrument').length;
          setStats({ total: data.length, piano: pianoCount, vocal: vocalCount, instrument: instrumentCount });
        };
        fetchStudents();
      }, 2000);
    } catch (error) {
      console.error('导入失败:', error);
      setUploadProgress('导入失败，请检查文件格式');
      setUploading(false);
      showError('导入失败', '请检查文件格式后重试');
    }
  };

  const handleExport = useCallback(() => {
    try {
      exportUtils.exportStudents(filteredStudents);
      showSuccess('导出成功', `已导出 ${filteredStudents.length} 名学生的信息`);
    } catch (error) {
      console.error('导出失败:', error);
      showError('导出失败', '请重试');
    }
  }, [filteredStudents, showSuccess, showError]);

  // 表格增强功能处理函数
  const handleSort = useCallback((key: string) => {
    if (sortConfig.key === key) {
      // 如果点击同一列，切换排序方向
      const newDirection = sortConfig.direction === 'asc' ? 'desc' : sortConfig.direction === 'desc' ? null : 'asc';
      setSortConfig({ key, direction: newDirection });
    } else {
      // 如果点击新列，默认升序
      setSortConfig({ key, direction: 'asc' });
    }
  }, [sortConfig]);

  // 批量删除处理
  const handleBatchDelete = useCallback(async (selectedRecords: Student[]) => {
    setRecordsToDelete(selectedRecords.map(r => r.id));
    setShowDeleteConfirm(true);
  }, []);

  const confirmBatchDelete = useCallback(async () => {
    try {
      for (const id of recordsToDelete) {
        await studentService.delete(id);
      }
      showSuccess('批量删除成功', `已成功删除 ${recordsToDelete.length} 名学生`);
      
      // 刷新数据
      const data = await studentService.getAll();
      // 为学生数据添加序号，并确保2304班级的学生类型为专升本
      const studentsWithSequence = data.map((student, index) => {
        // 检查是否为2304班级
        const studentClass = getStudentClass(student);
        const isUpgrade = studentClass === '2304' || student.student_type === 'upgrade';
        
        return {
          ...student,
          student_type: isUpgrade ? 'upgrade' : student.student_type || 'general',
          sequenceNumber: index + 1
        };
      });
      setStudents(studentsWithSequence);
      setSelectedRecords([]);

      // 更新统计
      const pianoCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'piano').length;
      const vocalCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'vocal').length;
      const instrumentCount = data.filter(s => getInstrumentCategory(getStudentInstrument(s)) === 'instrument').length;
      setStats({ total: data.length, piano: pianoCount, vocal: vocalCount, instrument: instrumentCount });
    } catch (error) {
      console.error('批量删除失败:', error);
      showError('批量删除失败', '请检查网络连接后重试');
    } finally {
      setShowDeleteConfirm(false);
      setRecordsToDelete([]);
    }
  }, [recordsToDelete, showSuccess, showError]);

  // 批量编辑处理
  const handleBatchEdit = useCallback((selectedRecords: Student[]) => {
    showInfo('批量编辑', `选中 ${selectedRecords.length} 名学生，将在下一个版本中实现此功能`);
  }, [showInfo]);

  // 导出选中记录
  const handleBatchExport = useCallback((selectedRecords: Student[]) => {
    try {
      exportUtils.exportStudents(selectedRecords);
      showSuccess('导出成功', `已导出 ${selectedRecords.length} 名学生的信息`);
    } catch (error) {
      console.error('导出失败:', error);
      showError('导出失败', '请重试');
    }
  }, [showSuccess, showError]);

  // 分页相关函数
  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  // 批量操作配置
  const batchActions: BatchAction[] = [
    {
      key: 'edit',
      label: '批量编辑',
      icon: <Edit2 className="w-3 h-3" />,
      type: 'edit',
      onClick: handleBatchEdit
    },
    {
      key: 'delete',
      label: '批量删除',
      icon: <Trash2 className="w-3 h-3" />,
      type: 'delete',
      onClick: handleBatchDelete
    },
    {
      key: 'export',
      label: '导出选中',
      icon: <Download className="w-3 h-3" />,
      type: 'export',
      onClick: handleBatchExport
    }
  ];

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div></div>;

  return (
    <div className="animate-fade-in">
      <div className="max-w-[1380px] mx-auto px-2.5">
      {/* 顶部操作栏 - 极简布局 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-purple-600" />
            学生管理
          </h1>
          {/* 精简统计信息 */}
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="bg-white border border-gray-200 px-2 py-1 rounded">总数: <strong className="text-purple-600 ml-1">{stats.total}</strong></span>
            <span className="flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded">🎹 <strong className="text-pink-600">{stats.piano}</strong></span>
            <span className="flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded">🎤 <strong className="text-blue-600">{stats.vocal}</strong></span>
            <span className="flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded">🎸 <strong className="text-green-600">{stats.instrument}</strong></span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-xs">
            <FileSpreadsheet className="w-3 h-3" />
            下载模板
          </button>
          <div className="flex items-center text-xs text-gray-600">
            <span className="mr-1">📋 填写规则：</span>
            <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">
              主项为空+3副项=通用 | 主项有值+2副项=有主副项
            </span>
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-xs" disabled={uploading}>
            <Upload className="w-3 h-3" />
            {uploading ? '导入中...' : '导入'}
          </button>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-xs"><Download className="w-3 h-3" />导出</button>
          <button onClick={() => { setFormData({ student_id: '', name: '', major_class: '', grade: new Date().getFullYear(), student_type: 'general', primary_instrument: '', secondary_instruments: [], remarks: '' }); setShowModal(true); }} className="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs"><Plus className="w-3 h-3" />添加学生</button>
        </div>
      </div>

      {/* 学生筛选区域 */}
      <div className="card mb-6">
        {/* 新的统一筛选组件 */}
        <StudentListFilters
          students={students}
          onFiltersChange={handleFiltersChange}
          onReset={handleResetFilters}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />
        
        {/* 文件上传状态 */}
        {uploadFile && (
          <div className="mt-4 flex items-center gap-2 bg-white border border-gray-200 px-3 py-2 rounded-lg">
            <FileSpreadsheet className="w-4 h-4 text-green-600" />
            <span className="text-xs text-gray-700">{uploadFile.name}</span>
            <span className="text-xs text-purple-600">{uploadProgress}</span>
          </div>
        )}
      </div>

      {/* 学生表格 */}
      <div className="card mb-6">
        {/* 表格工具栏 */}
        <div className="flex items-center justify-between mb-4 p-4 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              显示 {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredStudents.length)} / {filteredStudents.length} 条记录
            </span>
            {selectedRecords.length > 0 && (
              <span className="text-sm text-blue-600 bg-blue-50 px-2 py-1 rounded">
                已选择 {selectedRecords.length} 项
              </span>
            )}
          </div>
          <ColumnSettings 
            columns={columns} 
            onColumnsChange={setColumns} 
          />
        </div>

        {/* 增强表格 */}
        <div className="table-container">
          <EnhancedTable
            data={paginatedStudents}
            columns={columns}
            sortConfig={sortConfig}
            onSort={(key) => {
              if (key) {
                handleSort(key);
              } else {
                // 重置为默认排序
                setSortConfig({ key: 'student_id', direction: 'asc' });
              }
            }}
            selectedRecords={selectedRecords}
            onSelectionChange={setSelectedRecords}
            batchActions={batchActions}
            loading={loading}
            emptyMessage="暂无学生数据，请导入 Excel 文件或手动添加学生"
            onRecordEdit={handleEdit}
            onRecordDelete={handleDelete}
            className=""
          />
        </div>

        {/* 分页控件 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-4 py-3 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                第 {currentPage} 页，共 {totalPages} 页
              </span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value={10}>10条/页</option>
                <option value={20}>20条/页</option>
                <option value={50}>50条/页</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                title="首页"
              >
                首页
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-1 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                title="上一页"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded">
                {currentPage}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-1 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                title="下一页"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                title="末页"
              >
                末页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 添加学生弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4 animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">添加学生</h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">学号</label>
                  <input type="text" value={formData.student_id} onChange={(e) => setFormData({ ...formData, student_id: e.target.value })} className="input" placeholder="请输入学号" required />
                </div>
                <div>
                  <label className="label">姓名</label>
                  <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="input" placeholder="请输入姓名" required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">年级</label>
                  <input
                    type="text"
                    value={formData.grade}
                    onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                    className="input"
                    placeholder="如：2025级"
                  />
                </div>
                <div>
                  <label className="label">学生类型</label>
                  <select
                    value={formData.student_type}
                    onChange={(e) => setFormData({ ...formData, student_type: e.target.value as 'general' | 'upgrade' })}
                    className="input"
                  >
                    <option value="general">普通班</option>
                    <option value="upgrade">专升本</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">专业班级</label>
                <input
                  type="text"
                  value={formData.major_class}
                  onChange={(e) => setFormData({ ...formData, major_class: e.target.value })}
                  className="input"
                  placeholder="如：音乐学2401"
                  required
                />
              </div>

              <div>
                <label className="label">主项专业</label>
                <select
                  value={formData.student_type}
                  onChange={(e) => setFormData({ ...formData, student_type: e.target.value as 'general' | 'upgrade' })}
                  className="input"
                >
                  <option value="general">普通班</option>
                  <option value="upgrade">专升本</option>
                </select>
              </div>

              <div>
                <label className="label">主项专业</label>
                <select
                  value={formData.primary_instrument}
                  onChange={(e) => setFormData({ ...formData, primary_instrument: e.target.value })}
                  className="input"
                >
                  <option value="">无（通用类型）</option>
                  {INSTRUMENTS.map(inst => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  普通班：有主副项时填写；专升本：留空（不分主副项）
                </p>
              </div>

              <div>
                <label className="label">副项专业（最多3个，用逗号或顿号分隔）</label>
                <textarea
                  value={formData.secondary_instruments.join('、')}
                  onChange={(e) => {
                    const value = e.target.value;
                    // 支持逗号和顿号分隔
                    const instruments = value.split(/[、,]/).map(s => s.trim()).filter(s => s);
                    setFormData({ ...formData, secondary_instruments: instruments });
                  }}
                  className="input"
                  rows={2}
                  placeholder="如：钢琴、声乐、古筝"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {formData.student_type === 'upgrade' ? '专升本：三个副项' : '普通班：主项+两个副项'}
                </p>
              </div>

              <div>
                <label className="label">备注</label>
                <input
                  type="text"
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  className="input"
                  placeholder="如：主项古筝"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 btn-secondary">取消</button>
                <button type="submit" className="flex-1 btn-primary">添加</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 编辑学生弹窗 */}
      {editingStudent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4 animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">编辑学生信息</h2>
              <button onClick={() => setEditingStudent(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleUpdateStudent} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">学号</label>
                  <input
                    type="text"
                    value={editFormData.student_id}
                    onChange={(e) => setEditFormData({ ...editFormData, student_id: e.target.value })}
                    className="input"
                    placeholder="请输入学号"
                    required
                  />
                </div>
                <div>
                  <label className="label">姓名</label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="input"
                    placeholder="请输入姓名"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">年级</label>
                  <input
                    type="text"
                    value={editFormData.grade}
                    onChange={(e) => setEditFormData({ ...editFormData, grade: e.target.value })}
                    className="input"
                    placeholder="如：2025级"
                  />
                </div>
                <div>
                  <label className="label">学生类型</label>
                  <select
                    value={editFormData.student_type}
                    onChange={(e) => setEditFormData({ ...editFormData, student_type: e.target.value as 'general' | 'upgrade' })}
                    className="input"
                  >
                    <option value="general">普通班</option>
                    <option value="upgrade">专升本</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">专业班级</label>
                <input
                  type="text"
                  value={editFormData.major_class}
                  onChange={(e) => setEditFormData({ ...editFormData, major_class: e.target.value })}
                  className="input"
                  placeholder="如：音乐学2401"
                  required
                />
              </div>

              <div>
                <label className="label">主项专业</label>
                <select
                  value={editFormData.student_type}
                  onChange={(e) => setEditFormData({ ...editFormData, student_type: e.target.value as 'general' | 'upgrade' })}
                  className="input"
                >
                  <option value="general">普通班</option>
                  <option value="upgrade">专升本</option>
                </select>
              </div>

              <div>
                <label className="label">主项专业</label>
                <select
                  value={editFormData.primary_instrument}
                  onChange={(e) => setEditFormData({ ...editFormData, primary_instrument: e.target.value })}
                  className="input"
                >
                  <option value="">无（通用类型）</option>
                  {INSTRUMENTS.map(inst => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  普通班：有主副项时填写；专升本：留空（不分主副项）
                </p>
              </div>

              <div>
                <label className="label">副项专业（最多3个，用逗号或顿号分隔）</label>
                <textarea
                  value={editFormData.secondary_instruments.join('、')}
                  onChange={(e) => {
                    const value = e.target.value;
                    // 支持逗号和顿号分隔
                    const instruments = value.split(/[、,]/).map(s => s.trim()).filter(s => s);
                    setEditFormData({ ...editFormData, secondary_instruments: instruments });
                  }}
                  className="input"
                  rows={2}
                  placeholder="如：钢琴、声乐、古筝"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {editFormData.student_type === 'upgrade' ? '专升本：三个副项' : '普通班：主项+两个副项'}
                </p>
              </div>

              <div>
                <label className="label">备注</label>
                <input
                  type="text"
                  value={editFormData.remarks}
                  onChange={(e) => setEditFormData({ ...editFormData, remarks: e.target.value })}
                  className="input"
                  placeholder="如：主项古筝"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setEditingStudent(null)} className="flex-1 btn-secondary">取消</button>
                <button type="submit" className="flex-1 btn-primary">保存修改</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 批量删除确认对话框 */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        title="确认删除"
        message={`确定要删除选中的 ${recordsToDelete.length} 名学生吗？此操作不可撤销。`}
        confirmLabel="确认删除"
        cancelLabel="取消"
        onConfirm={confirmBatchDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setRecordsToDelete([]);
        }}
        type="error"
      />
      </div>
    </div>
  );
}
