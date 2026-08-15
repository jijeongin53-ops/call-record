import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { getSettings, saveSettings, getHistory, addHistoryItem, deleteHistoryItem } from './services/storageService.js';
import { analyzeCallAudio } from './services/geminiService.js';
import { uploadToGoogleDrive, uploadReportToGoogleDrive } from './services/googleDriveService.js';
import { saveToObsidianVault } from './services/obsidianService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, '../storage/uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // 한글 파일명 깨짐 방지 처리
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniquePrefix}_${originalName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/storage', express.static(path.join(__dirname, '../storage')));

// 1. 설정 API
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: getSettings() });
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = saveSettings(req.body);
    res.json({ success: true, settings: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. 히스토리 API
app.get('/api/history', (req, res) => {
  res.json({ success: true, history: getHistory() });
});

app.delete('/api/history/:id', (req, res) => {
  try {
    deleteHistoryItem(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 재사용 가능한 통화녹음 전체 파이프라인 처리 함수
async function processCallRecording(filePath, originalName, mimeType = 'audio/mp4') {
  const historyEntry = {
    id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    originalFileName: originalName,
    status: 'processing',
    statusMessage: 'AI 음성 분석 중...'
  };
  addHistoryItem(historyEntry);

  try {
    // 1단계: 구글 드라이브에 원본 녹음 파일 백업
    historyEntry.statusMessage = '구글 드라이브에 원본 오디오 백업 중...';
    addHistoryItem(historyEntry);
    const driveAudioResult = await uploadToGoogleDrive(filePath, originalName, mimeType);

    // 2단계: Gemini AI 통화 분석 및 STT
    historyEntry.statusMessage = 'Gemini AI 통화 분석 및 핵심 요약 추출 중...';
    addHistoryItem(historyEntry);
    const analysisData = await analyzeCallAudio(filePath, originalName, mimeType);

    // 3단계: 구글 드라이브에 분석 리포트 마크다운 업로드
    historyEntry.statusMessage = '구글 드라이브에 분석 리포트 업로드 중...';
    addHistoryItem(historyEntry);
    const reportFileName = `${analysisData.callDate}_${analysisData.managerName}_${(analysisData.keywords || []).slice(0, 3).join('_')}_리포트.md`;
    const driveReportResult = await uploadReportToGoogleDrive(
      `# ${analysisData.title}\n\n${analysisData.summary}`,
      reportFileName
    );

    // 4단계: 옵시디언 볼트에 마크다운 파일 저장
    historyEntry.statusMessage = '옵시디언 볼트에 노트 저장 중...';
    addHistoryItem(historyEntry);
    const obsidianResult = await saveToObsidianVault(analysisData, driveAudioResult, driveReportResult);

    // 최종 완료 업데이트
    const completedEntry = {
      ...historyEntry,
      status: 'completed',
      statusMessage: '정리 및 동기화 완료',
      analysis: analysisData,
      driveAudio: driveAudioResult,
      driveReport: driveReportResult,
      obsidian: obsidianResult,
      completedAt: new Date().toISOString()
    };
    addHistoryItem(completedEntry);
    return completedEntry;
  } catch (error) {
    console.error('처리 파이프라인 에러:', error);
    const failedEntry = {
      ...historyEntry,
      status: 'failed',
      statusMessage: `처리 실패: ${error.message}`,
      error: error.message
    };
    addHistoryItem(failedEntry);
    throw error;
  }
}

// 3. 통화 녹음 파일 업로드 및 전체 파이프라인 처리
app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: '녹음 오디오 파일이 필요합니다.' });
  }

  const rawOriginalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const filePath = req.file.path;
  const mimeType = req.file.mimetype || 'audio/mp4';

  try {
    const result = await processCallRecording(filePath, rawOriginalName, mimeType);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. 구글 드라이브 폴더 자동 스캔 및 새 녹음 파일 일괄 동기화
app.post('/api/sync-drive', async (req, res) => {
  const settings = getSettings();
  const processedHistory = getHistory();
  const processedNames = new Set(processedHistory.map(h => h.originalFileName));
  const newProcessed = [];
  const errors = [];

  // 방법 A: PC용 Google Drive 로컬 동기화 폴더 검사
  if (settings.googleDriveLocalPath && fs.existsSync(settings.googleDriveLocalPath)) {
    try {
      const files = fs.readdirSync(settings.googleDriveLocalPath);
      const audioFiles = files.filter(f => /\.(m4a|mp3|wav|amr)$/i.test(f));

      for (const file of audioFiles) {
        if (!processedNames.has(file)) {
          const fullPath = path.join(settings.googleDriveLocalPath, file);
          try {
            const res = await processCallRecording(fullPath, file, 'audio/mp4');
            newProcessed.push(res);
            processedNames.add(file);
          } catch (e) {
            errors.push({ file, error: e.message });
          }
        }
      }
    } catch (err) {
      console.error('로컬 드라이브 스캔 실패:', err);
    }
  }

  res.json({
    success: true,
    processedCount: newProcessed.length,
    newItems: newProcessed,
    errors
  });
});

// 5. 샘플 통화 데이터로 즉시 시뮬레이션 테스트
app.post('/api/process-sample', async (req, res) => {
  const sampleName = req.body.fileName || `통화 녹음 김부장님_20260815_143000.m4a`;
  const sampleData = {
    callDate: new Date().toISOString().split('T')[0],
    callTime: '14:30',
    managerName: '김부장 (전략기획팀)',
    keywords: ['신규프로젝트', '일정조율', '예산검토'],
    title: `${new Date().toISOString().split('T')[0]}_김부장_신규프로젝트 일정조율 및 예산검토`,
    summary: '신규 프로젝트 런칭 일정에 대해 논의함. 다음 주 화요일까지 기획안 1차 초안을 전달하기로 협의하였으며, 예산 증액 건은 이사님 결재 후 재확인 예정.',
    actionItems: [
      '화요일 17:00까지 프로젝트 1차 기획안 초안 송부',
      '예산 세부 산출 내역서 준비하여 메일 공유',
      '차주 목요일 대면 킥오프 미팅 일정 캘린더 등록'
    ],
    sentiment: '긍정적 및 협력적',
    transcript: [
      { speaker: '김부장', text: '여보세요? 오늘 보낸 기획서 초안 확인해 봤어?' },
      { speaker: '나', text: '네 부장님, 확인했습니다. 전반적인 방향성은 좋고 일정만 조금 조율하면 될 것 같습니다.' },
      { speaker: '김부장', text: '좋아. 그럼 다음 주 화요일까지 수정본 보내주고, 예산 부분은 내가 확인해둘게.' },
      { speaker: '나', text: '알겠습니다. 화요일 오후 5시 전까지 정리해서 공유드리겠습니다!' }
    ]
  };

  const historyEntry = {
    id: `call_${Date.now()}`,
    originalFileName: sampleName,
    status: 'completed',
    statusMessage: '시뮬레이션 샘플 처리 완료',
    analysis: sampleData,
    driveAudio: {
      fileName: sampleName,
      webViewLink: 'https://drive.google.com/drive/folders/sample_folder_id',
      isRealDrive: false
    },
    driveReport: {
      fileName: `${sampleData.title}_리포트.md`,
      webViewLink: 'https://drive.google.com/file/d/sample_report_id/view',
      isRealDrive: false
    }
  };

  const obsidianResult = saveToObsidianVault(sampleData, historyEntry.driveAudio, historyEntry.driveReport);
  historyEntry.obsidian = obsidianResult;
  addHistoryItem(historyEntry);

  res.json({ success: true, result: historyEntry });
});

// 파일 다운로드 핸들러
app.get('/api/files/download/:filename', (req, res) => {
  const fileName = decodeURIComponent(req.params.filename);
  const filePath = path.join(__dirname, '../storage/google_drive_synced', fileName);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('파일을 찾을 수 없습니다.');
  }
});

// 백그라운드 자동 스캔 타이머 (30초마다 실행)
setInterval(async () => {
  const settings = getSettings();
  if (settings.autoProcessNewRecordings && settings.googleDriveLocalPath && fs.existsSync(settings.googleDriveLocalPath)) {
    try {
      const processedHistory = getHistory();
      const processedNames = new Set(processedHistory.map(h => h.originalFileName));
      const files = fs.readdirSync(settings.googleDriveLocalPath);
      const audioFiles = files.filter(f => /\.(m4a|mp3|wav|amr)$/i.test(f));

      for (const file of audioFiles) {
        if (!processedNames.has(file)) {
          const fullPath = path.join(settings.googleDriveLocalPath, file);
          console.log(`[자동 감지] 새 통화녹음 파일 처리 시작: ${file}`);
          await processCallRecording(fullPath, file, 'audio/mp4');
          processedNames.add(file);
        }
      }
    } catch (e) {
      console.warn('백그라운드 자동 스캔 경고:', e.message);
    }
  }
}, 30000);

app.listen(PORT, () => {
  console.log(`🚀 갤럭시 통화녹음 자동정리 서버 가동: http://localhost:${PORT}`);
});
