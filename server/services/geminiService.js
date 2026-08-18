import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import { getSettings } from './storageService.js';

// 파일의 Base64 및 MIME 타입 반환 헬퍼
function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType: mimeType || 'audio/mp4'
    },
  };
}

/**
 * 통화 녹음 오디오 파일을 Gemini AI로 분석하여 
 * 일시, 통화자(담당자), 주요 키워드, 상세 요약, 대화록, 액션아이템 등을 JSON 형식으로 추출
 */
export async function analyzeCallAudio(filePath, originalFilename, mimeType = 'audio/mp4', customApiKey = null) {
  const settings = getSettings();
  const apiKey = customApiKey || settings.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Gemini API Key가 설정되지 않았습니다. 설정 화면에서 API 키를 입력해주세요.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // Gemini 2.5 Flash 모델 사용 (오디오 분석 및 한글 요약에 최적화됨)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const audioPart = fileToGenerativePart(filePath, mimeType);

  const prompt = `
당신은 통화 녹음 내용을 분석하고 비즈니스 업무 노트로 정리하는 전문 AI 어시스턴트입니다.
제공된 통화 녹음 파일(파일명: "${originalFilename}")을 듣고 다음 항목들을 분석하여 반드시 지정된 JSON 포맷으로만 응답해 주세요.

파일명에서 날짜, 시간, 상대방 이름/전화번호 힌트를 얻을 수 있습니다 (예: "통화 녹음 홍길동_240815_143022.m4a").

요청하는 JSON 구조:
{
  "callDate": "YYYY-MM-DD", // 통화 날짜 (파일 이름이나 대화 내용 기준)
  "callTime": "HH:MM", // 통화 시간
  "managerName": "담당자/상대방 이름 또는 직함 (모를 경우 '미확인' 또는 파일명의 대상)",
  "keywords": ["핵심키워드1", "핵심키워드2", "핵심키워드3"], // 2~4개의 핵심 단어
  "title": "날짜_담당자_주요주제 형식의 한글 제목 (예: 2026-08-15_홍길동_계약서 검토 및 미팅 일정 조율)",
  "summary": "전체 통화 내용의 3~5줄 핵심 요약",
  "actionItems": [
    "다음에 해야 할 구체적인 할 일(Action Item) 목록"
  ],
  "sentiment": "긍정적 / 중립적 / 긴급 / 주의 필요 등",
  "transcript": [
    {
      "speaker": "화자1(예: 본인 또는 담당자명)",
      "text": "말한 대화 내용"
    }
  ]
}

주의사항:
- Markdown 코드 블록(예: \`\`\`json ... \`\`\`)으로 감싸서 반환하거나 순수 JSON으로 반환하세요.
- 한국어로 정확하고 정중하게 요약해 주세요.
`;

  try {
    const result = await model.generateContent([prompt, audioPart]);
    const responseText = result.response.text();

    // JSON 파싱 (코드블록 제거 처리)
    let cleanedJsonStr = responseText.trim();
    if (cleanedJsonStr.startsWith('```json')) {
      cleanedJsonStr = cleanedJsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanedJsonStr.startsWith('```')) {
      cleanedJsonStr = cleanedJsonStr.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsedData = JSON.parse(cleanedJsonStr);
    return parsedData;
  } catch (error) {
    console.error('Gemini 통화 분석 오류:', error);
    throw new Error(`AI 통화 분석 실패: ${error.message}`);
  }
}
