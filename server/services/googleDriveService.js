import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSettings } from './storageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const LOCAL_DRIVE_BACKUP_DIR = isVercel ? '/tmp/google_drive_synced' : path.join(__dirname, '../../storage/google_drive_synced');

try {
  if (!fs.existsSync(LOCAL_DRIVE_BACKUP_DIR)) {
    fs.mkdirSync(LOCAL_DRIVE_BACKUP_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('드라이브 백업 디렉터리 생성 경고:', e.message);
}

// Google Drive 클라이언트 인스턴스 생성
function getDriveClient() {
  const settings = getSettings();
  if (!settings.googleDriveCredentials) {
    return null;
  }

  try {
    let credentials;
    if (typeof settings.googleDriveCredentials === 'string') {
      // 파일 경로인지 혹은 JSON 문자열인지 확인
      if (fs.existsSync(settings.googleDriveCredentials)) {
        credentials = JSON.parse(fs.readFileSync(settings.googleDriveCredentials, 'utf-8'));
      } else {
        credentials = JSON.parse(settings.googleDriveCredentials);
      }
    } else {
      credentials = settings.googleDriveCredentials;
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive']
    });

    return google.drive({ version: 'v3', auth });
  } catch (error) {
    console.warn('Google Drive 인증 설정 오류 (로컬 저장소 모드로 대체):', error.message);
    return null;
  }
}

/**
 * 구글 드라이브(또는 백업 스토리지)에 파일 업로드
 */
export async function uploadToGoogleDrive(filePath, fileName, mimeType, folderId = null) {
  const settings = getSettings();
  const targetFolderId = folderId || settings.googleDriveFolderId;
  const drive = getDriveClient();

  // 실제 구글 드라이브 API 연동이 설정되어 있는 경우
  if (drive) {
    try {
      const fileMetadata = {
        name: fileName,
        parents: targetFolderId ? [targetFolderId] : undefined
      };

      const media = {
        mimeType: mimeType,
        body: fs.createReadStream(filePath)
      };

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, webContentLink'
      });

      // 누구나 읽기 권한 설정 (링크 공유 가능하도록)
      try {
        await drive.permissions.create({
          fileId: response.data.id,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });
      } catch (permErr) {
        console.warn('Google Drive 권한 설정 주의:', permErr.message);
      }

      return {
        fileId: response.data.id,
        fileName: response.data.name,
        webViewLink: response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view?usp=sharing`,
        isRealDrive: true
      };
    } catch (error) {
      console.error('Google Drive 업로드 실패, 로컬 백업으로 전환:', error);
    }
  }

  // Google Drive API 미설정 시 로컬 시뮬레이션 백업
  const destPath = path.join(LOCAL_DRIVE_BACKUP_DIR, fileName);
  fs.copyFileSync(filePath, destPath);
  const simulatedId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    fileId: simulatedId,
    fileName: fileName,
    localPath: destPath,
    webViewLink: targetFolderId 
      ? `https://drive.google.com/drive/folders/${targetFolderId}` 
      : `/api/files/download/${encodeURIComponent(fileName)}`,
    isRealDrive: false
  };
}

/**
 * 통화 분석 결과 텍스트(마크다운)를 구글 드라이브에 저장
 */
export async function uploadReportToGoogleDrive(content, reportFileName, folderId = null) {
  const tempReportPath = path.join(__dirname, '../../storage', `temp_${Date.now()}_${reportFileName}`);
  const storageDir = path.dirname(tempReportPath);
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  fs.writeFileSync(tempReportPath, content, 'utf-8');

  try {
    const result = await uploadToGoogleDrive(tempReportPath, reportFileName, 'text/markdown', folderId);
    return result;
  } finally {
    if (fs.existsSync(tempReportPath)) {
      fs.unlinkSync(tempReportPath);
    }
  }
}

/**
 * 구글 드라이브 지정 폴더 내의 녹음 파일 목록 조회
 */
export async function listDriveFiles(folderId = null) {
  const settings = getSettings();
  const targetFolderId = folderId || settings.googleDriveFolderId;
  const drive = getDriveClient();

  if (!drive || !targetFolderId) {
    return [];
  }

  try {
    const q = `'${targetFolderId}' in parents and trashed = false`;
    const response = await drive.files.list({
      q,
      fields: 'files(id, name, mimeType, createdTime, webViewLink, size)',
      orderBy: 'createdTime desc',
      pageSize: 50
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Google Drive 파일 목록 조회 실패:', error);
    return [];
  }
}

/**
 * 구글 드라이브 파일 다운로드
 */
export async function downloadDriveFile(fileId, destPath) {
  const drive = getDriveClient();
  if (!drive) {
    throw new Error('Google Drive 클라이언트가 구성되지 않았습니다.');
  }

  const dest = fs.createWriteStream(destPath);
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    response.data
      .pipe(dest)
      .on('finish', () => resolve(destPath))
      .on('error', err => reject(err));
  });
}

