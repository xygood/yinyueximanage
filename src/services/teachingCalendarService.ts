import { semesterConfigsApi, api as coreApi } from './api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const getAuthToken = (): string | null => {
  const userStr = sessionStorage.getItem('music_scheduler_current_user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      return btoa(`${user.teacher_id}:${user.password || ''}`);
    } catch {
      return null;
    }
  }
  return null;
};

export interface TeachingCalendarHeaderDto {
  id?: string;
  academic_year?: string | null;
  semester_label: string;
  teacher_id: string;
  course_id: string;
  class_id?: string | null;
  group_id?: string | null;
  class_display_name?: string | null;
  extra_info?: Record<string, any>;
}

export interface TeachingCalendarEntryDto {
  id?: string | null;
  schedule_id?: string | null;
  week_number: number;
  is_empty_week: boolean;
  date?: string | null;
  date_text?: string;
  period_text?: string;
  hours?: number | null;
  teaching_content: string;
  remark: string;
}

export interface TeachingCalendarDto {
  header: TeachingCalendarHeaderDto;
  entries: TeachingCalendarEntryDto[];
}

export const teachingCalendarService = {
  /**
   * 获取教学日历（若尚未存在，将自动创建默认头信息与空表）
   */
  async getCalendar(params: {
    semester_label: string;
    teacher_id: string;
    course_id: string;
    class_id?: string;
    group_id?: string;
  }): Promise<TeachingCalendarDto> {
    const query = new URLSearchParams();
    query.set('semester_label', params.semester_label);
    query.set('teacher_id', params.teacher_id);
    query.set('course_id', params.course_id);
    if (params.class_id) query.set('class_id', params.class_id);
    if (params.group_id) query.set('group_id', params.group_id);

    return coreApi.get<TeachingCalendarDto>(`/teaching-calendar?${query.toString()}`);
  },

  /**
   * 保存教学日历（头信息 + 行信息）
   */
  async saveCalendar(payload: {
    semester_label: string;
    teacher_id: string;
    course_id: string;
    class_id?: string;
    group_id?: string;
    header: Partial<TeachingCalendarHeaderDto>;
    entries: TeachingCalendarEntryDto[];
  }): Promise<TeachingCalendarDto> {
    return coreApi.post<TeachingCalendarDto>('/teaching-calendar', payload);
  },

  /**
   * 导出教学日历 Word 文档（返回 Blob 与文件名，由调用方触发下载）
   * 文件名规则：教师姓名_课程名称_班级.docx（见教学日历功能设计文档）
   */
  async exportCalendar(params: {
    semester_label: string;
    teacher_id: string;
    course_id: string;
    class_id?: string;
    group_id?: string;
  }): Promise<{ blob: Blob; filename: string }> {
    const query = new URLSearchParams();
    query.set('semester_label', params.semester_label);
    query.set('teacher_id', params.teacher_id);
    query.set('course_id', params.course_id);
    if (params.class_id) query.set('class_id', params.class_id);
    if (params.group_id) query.set('group_id', params.group_id);

    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/teaching-calendar/export?${query.toString()}`, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Basic ${token}` } : {}),
      },
    });
    if (!response.ok) {
      let msg = `导出教学日历失败: HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body && typeof body.error === 'string') msg += ` — ${body.error}`;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }

    let filename = '教学日历.docx';
    const disp = response.headers.get('Content-Disposition');
    if (disp) {
      const utf8Match = disp.match(/filename\*=UTF-8''([^;]+)/i);
      const plainMatch = disp.match(/filename=["']?([^"';]+)["']?/i);
      if (utf8Match) {
        try {
          filename = decodeURIComponent(utf8Match[1].trim());
        } catch {
          filename = '教学日历.docx';
        }
      } else if (plainMatch) {
        filename = plainMatch[1].trim().replace(/^["']|["']$/g, '') || filename;
      }
    }

    const blob = await response.blob();
    return { blob, filename };
  },

  /**
   * 从教师上传的 Word 模板导入教学内容与备注
   */
  async importCalendar(
    params: {
      semester_label: string;
      teacher_id: string;
      course_id: string;
      class_id?: string;
      group_id?: string;
    },
    file: File,
  ): Promise<TeachingCalendarDto> {
    const formData = new FormData();
    formData.append('semester_label', params.semester_label);
    formData.append('teacher_id', params.teacher_id);
    formData.append('course_id', params.course_id);
    if (params.class_id) formData.append('class_id', params.class_id);
    if (params.group_id) formData.append('group_id', params.group_id);
    formData.append('file', file);

    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/teaching-calendar/import`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Basic ${token}` } : {}),
      },
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `导入教学日历失败: HTTP ${response.status}`);
    }
    return (await response.json()) as TeachingCalendarDto;
  },

  /**
   * 获取学期配置，便于前端选择学年学期
   */
  async getSemesterConfigs() {
    return semesterConfigsApi.getAll();
  },
};

