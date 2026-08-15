import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSettings } from './storageService.js';

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DEFAULT_NOTES_DIR = isVercel ? '/tmp/obsidian_vault_output' : path.join(__dirname, '../../storage/obsidian_vault_output');

try {
  if (!fs.existsSync(DEFAULT_NOTES_DIR)) {
    fs.mkdirSync(DEFAULT_NOTES_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('옵시디언 기본 디렉터리 생성 경고:', e.message);
}

/**
 * AI 분석 데이터 및 구글 드라이브 링크를 바탕으로 
 * 마크다운 형식의 옵시디언 노트를 생성하고 저장
 */
export function saveToObsidianVault(analysisData, driveAudioResult, driveReportResult) {
  const settings = getSettings();
  
  // 저장할 대상 볼트 디렉토리 결정
  let targetDir = DEFAULT_NOTES_DIR;
  if (settings.obsidianVaultPath && settings.obsidianVaultPath.trim() !== '') {
    targetDir = settings.obsidianVaultPath.trim();
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }

  const callDate = analysisData.callDate || new Date().toISOString().split('T')[0];
  const managerName = (analysisData.managerName || '미지정').replace(/[\\/:*?"<>|]/g, '_');
  const primaryKeywords = (analysisData.keywords || []).slice(0, 3).join('_').replace(/[\\/:*?"<>|]/g, '_') || '통화내용';

  // 파일명: [날짜]_[담당자명]_[주요키워드].md
  const sanitizedTitle = `${callDate}_${managerName}_${primaryKeywords}`.trim();
  const fileName = `${sanitizedTitle}.md`;
  const filePath = path.join(targetDir, fileName);

  // 구글 드라이브 링크
  const audioLink = driveAudioResult?.webViewLink || '#';
  const reportLink = driveReportResult?.webViewLink || '#';

  // 태그 목록 생성
  const tagsList = ['통화녹음', '자동요약'];
  if (analysisData.managerName) tagsList.push(analysisData.managerName.replace(/\s+/g, '_'));
  if (analysisData.keywords) {
    analysisData.keywords.forEach(k => tagsList.push(k.replace(/\s+/g, '_')));
  }

  // Obsidian Markdown 템플릿 생성
  const markdownContent = `---
title: "${analysisData.title || sanitizedTitle}"
date: ${callDate}
time: "${analysisData.callTime || ''}"
manager: "${analysisData.managerName || ''}"
keywords: [${(analysisData.keywords || []).map(k => `"${k}"`).join(', ')}]
tags: [${tagsList.map(t => `#${t}`).join(', ')}]
google_drive_audio: "${audioLink}"
google_drive_report: "${reportLink}"
sentiment: "${analysisData.sentiment || '중립'}"
---

# 📞 ${analysisData.title || sanitizedTitle}

> **통화 일시:** \`${callDate} ${analysisData.callTime || ''}\`  
> **통화 상대 / 담당자:** **${analysisData.managerName || '미확인'}**  
> **통화 분위기:** \`${analysisData.sentiment || '보통'}\`  
> **📁 구글 드라이브 원본 녹음:** [녹음 파일 열기](${audioLink})  
> **📄 구글 드라이브 분석 리포트:** [리포트 열기](${reportLink})

---

## 🏷️ 주요 키워드
${(analysisData.keywords || []).map(k => `- **#${k}**`).join('\n')}

---

## 💡 핵심 요약
${analysisData.summary || '요약 내용이 없습니다.'}

---

## ✅ 해야 할 일 (Action Items)
${(analysisData.actionItems && analysisData.actionItems.length > 0)
    ? analysisData.actionItems.map(item => `- [ ] ${item}`).join('\n')
    : '- [ ] 별도 후속 조치 없음'}

---

## 📝 상세 대화 녹취록
${(analysisData.transcript && analysisData.transcript.length > 0)
    ? analysisData.transcript.map(t => `> **${t.speaker || '화자'}**: ${t.text}`).join('\n>\n')
    : '_상세 대화록이 제공되지 않았습니다._'}

---
*Generated automatically by Galaxy Call Recorder Obsidian Sync on ${new Date().toLocaleString('ko-KR')}*
`;

  // 파일 작성
  fs.writeFileSync(filePath, markdownContent, 'utf-8');

  return {
    filePath,
    fileName,
    markdownContent,
    obsidianUri: `obsidian://open?file=${encodeURIComponent(sanitizedTitle)}`
  };
}
