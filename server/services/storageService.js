import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// 인메모리 캐시 (서버리스 환경 대비)
let memorySettings = { ...DEFAULT_SETTINGS };
let memoryHistory = [];

// 데이터 디렉터리 확인 및 생성
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('데이터 디렉토리 생성 경고 (인메모리 모드 사용):', e.message);
}

// 설정 불러오기
export function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      memorySettings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      return memorySettings;
    }
  } catch (error) {
    console.warn('설정 파일 로드 경고 (인메모리 반환):', error.message);
  }
  return memorySettings;
}

// 설정 저장하기
export function saveSettings(newSettings) {
  memorySettings = { ...memorySettings, ...newSettings };
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(memorySettings, null, 2), 'utf-8');
  } catch (error) {
    console.warn('설정 파일 저장 실패 (인메모리 유지):', error.message);
  }
  return memorySettings;
}

// 분석 이력 불러오기
export function getHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('히스토리 로드 실패:', error);
  }
  return [];
}

// 분석 이력 저장/추가하기
export function addHistoryItem(item) {
  try {
    const history = getHistory();
    // 중복 id 검사 및 갱신
    const existingIndex = history.findIndex(h => h.id === item.id);
    if (existingIndex >= 0) {
      history[existingIndex] = { ...history[existingIndex], ...item, updatedAt: new Date().toISOString() };
    } else {
      history.unshift({
        ...item,
        createdAt: item.createdAt || new Date().toISOString()
      });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    return item;
  } catch (error) {
    console.error('히스토리 저장 실패:', error);
    throw error;
  }
}

// 히스토리 항목 삭제
export function deleteHistoryItem(id) {
  try {
    let history = getHistory();
    history = history.filter(h => h.id !== id);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('히스토리 삭제 실패:', error);
    throw error;
  }
}
