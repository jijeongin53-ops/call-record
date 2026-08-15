import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { getSettings, saveSettings, getHistory, addHistoryItem, deleteHistoryItem } from '../server/services/storageService.js';
import { analyzeCallAudio } from '../server/services/geminiService.js';
import { uploadToGoogleDrive, uploadReportToGoogleDrive } from '../server/services/googleDriveService.js';
import { saveToObsidianVault } from '../server/services/obsidianService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = '/tmp/uploads';

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniquePrefix}_${originalName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

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
    const driveAudioResult = await uploadToGoogleDrive(filePath, originalName, mimeType);
    const analysisData = await analyzeCallAudio(filePath, originalName, mimeType);
    const reportFileName = `${analysisData.callDate}_${analysisData.managerName}_${(analysisData.keywords || []).slice(0, 3).join('_')}_리포트.md`;
    const driveReportResult = await uploadReportToGoogleDrive(
      `# ${analysisData.title}\n\n${analysisData.summary}`,
      reportFileName
    );

    const obsidianResult = saveToObsidianVault(analysisData, driveAudioResult, driveReportResult);

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

// 4. 구글 드라이브 동기화 API
app.post('/api/sync-drive', async (req, res) => {
  res.json({ success: true, processedCount: 0, newItems: [], message: '클라우드 환경에서는 파일 직접 업로드를 사용하세요.' });
});

export default app;
