// 全局类型声明：便签 / 分组 / 设置 / 存档等核心数据结构（单一来源）。
//
// 仅用于编辑器 IntelliSense 与 `npm run typecheck`（tsc --noEmit + checkJs），
// **不产生任何运行时代码**，也不会被打包进应用。
//
// 用法（渐进式）：在纯逻辑模块里按需标注，例如
//   /** @param {Note} n @returns {number} */ function posOf(n) { ... }
// 未标注的模块不受影响；标注后 tsc 就会校验字段读写。

interface Pos { x: number; y: number }

interface NoteItem { id?: string; text: string; done?: boolean }

interface NoteImage { id: string; [k: string]: any }

interface NoteFile { id?: string; path: string; isDir?: boolean; [k: string]: any }

interface TableMerge { r: number; c: number; rowspan: number; colspan: number }

interface TableDiagonal { r: number; c: number; dir: string; t1?: string; t2?: string }

interface NoteTable {
  id: string;
  rows: number;
  cols: number;
  cells: string[][];
  merges: TableMerge[];
  diagonals: TableDiagonal[];
  borderWidth?: number;
  borderColor?: string | null;
  fontSize?: number | null;
  textColor?: string | null;
}

interface Reminder {
  time: number | string;
  fired?: boolean;
  sound?: boolean;
  [k: string]: any;
}

// 便签（备注 + 待办共用）。字段大多可选：旧存档可能缺失，由 migrateNote 回填。
interface Note {
  id: string;
  title?: string;
  content?: string;
  type?: 'note' | 'todo';
  items?: NoteItem[];
  images?: NoteImage[];
  files?: NoteFile[];
  tables?: NoteTable[];
  color?: string | null;
  textColor?: string | null;
  fontFamily?: string | null;
  fontSize?: number;
  groupId?: string | null;
  pinned?: boolean;
  desktopPin?: boolean;
  archived?: boolean;
  preview?: boolean;
  opacity?: number;
  z?: number | string;
  reminder?: Reminder | null;
  x?: number;
  y?: number;
  positionAll?: Pos;
  w?: number;
  h?: number;
  createdAt?: number;
  updatedAt?: number;
}

interface Group { id: string; name: string; color?: string | null }

interface TrashItem { note: Note; deletedAt?: number; [k: string]: any }

interface CustomTheme {
  id: string;
  name: string;
  en?: string;
  light?: boolean;
  bg?: string;
  accent?: string;
  mini?: string[];
}

interface CustomFont { family: string; path?: string }

// 设置结构 = DEFAULT_SETTINGS（state.js）的键。新增设置项时同步这里。
interface AppSettings {
  version?: number;
  themeId?: string;
  appearanceMode?: string;
  accent?: string;
  noteOpacity?: number;
  winOpacity?: number;
  fontSize?: number;
  fontFamily?: string;
  canvasColor?: string | null;
  alwaysOnTop?: boolean;
  backgroundImage?: string | null;
  backgroundMode?: string;
  backgroundReadability?: boolean;
  noteTextColor?: string | null;
  viewMode?: string;
  bgOpacity?: number;
  topBarColor?: string | null;
  topBarOpacity?: number;
  topBarAcrylic?: boolean;
  sortMode?: string;
  ctxMenuMode?: 'compact' | 'full';
  noteToolbarCompact?: boolean;
  noteToolbarHidden?: string[];
  shortcuts?: Record<string, string>;
  noteOrder?: string[];
  groupOrders?: Record<string, string[]>;
  customThemes?: CustomTheme[];
  recycleBinDays?: number;
  backupDir?: string | null;
  language?: string;
  customFonts?: CustomFont[];
  todoSearchColor?: string | null;
  todoSearchOpacity?: number;
  todoItemsColor?: string | null;
  todoItemsOpacity?: number;
  todoRemindColor?: string | null;
  todoRemindOpacity?: number;
  noteColor?: string;
  noteRadius?: number;
  noteShadow?: number;
  noteBorderWidth?: number;
  noteBorderColor?: string | null;
  noteLetterSpacing?: number;
  menuAcrylic?: boolean;
  menuOpacity?: number;
  boardZoom?: number;
  recentGroups?: string[];
  collapsedGroups?: Record<string, boolean>;
  collapseSnapshot?: Record<string, any>;
  glass?: boolean;
  desktopMica?: boolean;
  markdown?: boolean;
  highlightColor?: string | null;
  reminderSound?: boolean;
  reminderSoundPath?: string | null;
  reminderSoundName?: string | null;
  reminderVolume?: number;
  lastSeenVersion?: string;
}

// 存档根对象：notes-data.json 的结构
interface AppData {
  version?: number;
  settings: AppSettings;
  groups: Group[];
  notes: Note[];
  trash: TrashItem[];
}
