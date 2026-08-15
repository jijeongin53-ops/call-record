import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// 기본 설정 초기화
const DEFAULT_SETTINGS = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  googleDriveFolderId: '',
  googleDriveLocalPath: '', // PC용 구글 드라이브 동기화 폴더 경로 (예: G:/내 드라이브/통화내용)
  googleDriveCredentials: '', // 서비스 계정 JSON 또는 토큰
  obsidianVaultPath: '', // 옵시디언 볼트 로컬 경로 (예: C:/Users/.../MyVault/CallNotes)
  autoScanIntervalMin: 10,
  autoProcessNewRecordings: true
};

// 데이터 디렉터리 확인 및 생성
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 설정 불러오기
export function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('설정 로드 실패:', error);
  }
  return DEFAULT_SETTINGS;
}

// 설정 저장하기
export function saveSettings(newSettings) {
  try {
    const current = getSettings();
    const updated = { ...current, ...newSettings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  } catch (error) {
    console.error('설정 저장 실패:', error);
    throw error;
  }
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
