document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const sampleBtn = document.getElementById('sampleBtn');
  const processingCard = document.getElementById('processingCard');
  const processingStatusTitle = document.getElementById('processingStatusTitle');
  const processingStatusDetail = document.getElementById('processingStatusDetail');
  const historyList = document.getElementById('historyList');
  const historyCount = document.getElementById('historyCount');

  // Status Elements
  const statusDriveVal = document.getElementById('statusDriveVal');
  const statusObsidianVal = document.getElementById('statusObsidianVal');

  // Modals & Buttons
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
  const settingsForm = document.getElementById('settingsForm');

  const guideBtn = document.getElementById('guideBtn');
  const guideModal = document.getElementById('guideModal');
  const closeGuideBtn = document.getElementById('closeGuideBtn');

  // Form Inputs
  const geminiApiKeyInput = document.getElementById('geminiApiKey');
  const obsidianVaultPathInput = document.getElementById('obsidianVaultPath');
  const googleDriveLocalPathInput = document.getElementById('googleDriveLocalPath');
  const googleDriveFolderIdInput = document.getElementById('googleDriveFolderId');
  const googleDriveCredentialsInput = document.getElementById('googleDriveCredentials');
  const syncDriveBtn = document.getElementById('syncDriveBtn');

  // Initialize
  loadSettings();
  loadHistory();
  // 10초마다 히스토리 자동 갱신
  setInterval(loadHistory, 10000);

  // 1. Settings Loading & Saving
  async function loadSettings() {
    let s = {};
    // 브라우저 로컬스토리지 우선 확인
    try {
      const localSaved = localStorage.getItem('galaxy_call_settings');
      if (localSaved) {
        s = JSON.parse(localSaved);
      }
    } catch (e) {}

    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.settings) {
          s = { ...s, ...data.settings };
        }
      }
    } catch (err) {
      console.warn('서버 설정 불러오기 대체:', err);
    }

    if (geminiApiKeyInput) geminiApiKeyInput.value = s.geminiApiKey || '';
    if (obsidianVaultPathInput) obsidianVaultPathInput.value = s.obsidianVaultPath || '';
    if (googleDriveLocalPathInput) googleDriveLocalPathInput.value = s.googleDriveLocalPath || '';
    if (googleDriveFolderIdInput) googleDriveFolderIdInput.value = s.googleDriveFolderId || '';
    if (googleDriveCredentialsInput) googleDriveCredentialsInput.value = s.googleDriveCredentials || '';

    // Status bar update
    if (s.googleDriveLocalPath) {
      statusDriveVal.textContent = `PC 자동연동 (${s.googleDriveLocalPath})`;
    } else if (s.googleDriveFolderId) {
      statusDriveVal.textContent = `클라우드 연동 (${s.googleDriveFolderId.substring(0, 8)}...)`;
    } else {
      statusDriveVal.textContent = '로컬 백업 모드';
    }
    statusObsidianVal.textContent = s.obsidianVaultPath ? s.obsidianVaultPath : '기본 볼트 폴더';
  }

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updatedSettings = {
      geminiApiKey: geminiApiKeyInput.value.trim(),
      obsidianVaultPath: obsidianVaultPathInput.value.trim(),
      googleDriveLocalPath: googleDriveLocalPathInput ? googleDriveLocalPathInput.value.trim() : '',
      googleDriveFolderId: googleDriveFolderIdInput.value.trim(),
      googleDriveCredentials: googleDriveCredentialsInput.value.trim()
    };

    // 로컬 스토리지에 즉시 영구 저장
    try {
      localStorage.setItem('galaxy_call_settings', JSON.stringify(updatedSettings));
    } catch (e) {}

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings)
      });
      if (res.ok) {
        await res.json();
      }
    } catch (err) {
      console.warn('서버 설정 동기화 알림 (로컬 저장 유지):', err.message);
    }

    alert('설정이 안전하게 저장되었습니다.');
    settingsModal.classList.add('hidden');
    loadSettings();
  });

  // Modal Controls
  settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
  cancelSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
  settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => settingsModal.classList.add('hidden'));

  guideBtn.addEventListener('click', () => guideModal.classList.remove('hidden'));
  closeGuideBtn.addEventListener('click', () => guideModal.classList.add('hidden'));
  guideModal.querySelector('.modal-backdrop').addEventListener('click', () => guideModal.classList.add('hidden'));

  // 2. File Upload & Processing
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  async function handleFileUpload(file) {
    const formData = new FormData();
    formData.append('audio', file);

    showProcessing('통화 녹음 AI 분석 파이프라인 시작...', `${file.name} 파일 업로드 및 분석 중`);

    try {
      const res = await fetch('/api/process-audio', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        hideProcessing();
        loadHistory();
      } else {
        hideProcessing();
        alert('오류 발생: ' + data.message);
        loadHistory();
      }
    } catch (err) {
      hideProcessing();
      alert('요청 중 통신 오류가 발생했습니다: ' + err.message);
      loadHistory();
    }
  }

  // 3. 구글 드라이브 새 녹음 즉시 동기화 버튼
  const headerSyncDriveBtn = document.getElementById('headerSyncDriveBtn');
  const triggerSync = async () => {
    showProcessing('구글 드라이브 동기화 진행 중...', '통화 녹음 파일을 확인하고 있습니다.');
    try {
      let savedSettings = {};
      try {
        const local = localStorage.getItem('galaxy_call_settings');
        if (local) savedSettings = JSON.parse(local);
      } catch (e) {}

      const completedFileNames = (window.currentHistoryItems || [])
        .filter(h => h.status === 'completed' || h.status === 'skipped')
        .map(h => h.originalFileName);

      const res = await fetch('/api/sync-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          settings: { 
            ...savedSettings,
            completedFileNames 
          } 
        })
      });
      hideProcessing();
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.processedCount > 0) {
            alert(`🎉 동기화 완료: ${data.processedCount}개의 새 통화 녹음 파일을 분석하여 정리했습니다!`);
          } else if (data.errors && data.errors.length > 0) {
            alert(`동기화 오류 알림:\n${data.errors.map(e => e.error || e.file).join('\n')}`);
          } else {
            alert('동기화 완료: 새로운 통화 녹음 파일이 없습니다.\n(구글 드라이브 폴더에 서비스 계정이 공유되어 있는지 확인해 주세요.)');
          }
          loadHistory();
        } else {
          alert('동기화 안내: ' + (data.message || '파일을 직접 드래그하여 업로드하세요.'));
        }
      } else {
        alert('안내: 클라우드(Vercel) 배포 환경에서는 화면의 파일 업로드 박스에 통화 녹음 파일(.m4a)을 직접 드래그하여 분석해 주세요.');
      }
    } catch (err) {
      hideProcessing();
      alert('안내: 녹음 파일(.m4a)을 화면의 업로드 영역으로 직접 드래그하여 분석을 진행해 주세요.');
    }
  };

  if (syncDriveBtn) syncDriveBtn.addEventListener('click', triggerSync);
  if (headerSyncDriveBtn) headerSyncDriveBtn.addEventListener('click', triggerSync);

  // 4. Sample Simulation Trigger
  sampleBtn.addEventListener('click', async () => {
    showProcessing('샘플 통화 데이터 시뮬레이션 처리 중...', '가상의 갤럭시 통화 녹음 파일 분석 및 동기화 테스트');
    try {
      const res = await fetch('/api/process-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: `통화 녹음 김부장_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_143000.m4a` })
      });
      hideProcessing();
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          loadHistory();
        }
      } else {
        alert('샘플 처리는 로컬 환경(npm start)에서 권장됩니다.');
      }
    } catch (err) {
      hideProcessing();
      alert('샘플 실행 실패: ' + err.message);
    }
  });

  function showProcessing(title, detail) {
    processingCard.classList.remove('hidden');
    processingStatusTitle.textContent = title;
    processingStatusDetail.textContent = detail;
  }

  function hideProcessing() {
    processingCard.classList.add('hidden');
  }

  // 4. Load and Render History
  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          renderHistoryList(data.history || []);
        }
      }
    } catch (err) {
      console.warn('히스토리 로드 대체:', err.message);
    }
  }

  function renderHistoryList(items) {
    window.currentHistoryItems = items || [];
    historyCount.textContent = `${items.length}건`;

    if (items.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📁</div>
          <p>아직 분석된 통화 기록이 없습니다.</p>
          <p class="empty-sub">위의 업로드 영역에 갤럭시 녹음 파일을 추가해보세요!</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = items.map(item => {
      const a = item.analysis || {};
      const keywordsHtml = (a.keywords || []).map(k => `<span class="tag-badge">#${escapeHtml(k)}</span>`).join(' ');
      const actionItemsHtml = (a.actionItems && a.actionItems.length > 0)
        ? `<div class="action-items-list">
             <div class="action-items-title">✅ 주요 실행 과제 (Action Items)</div>
             ${a.actionItems.map(act => `<div class="action-item"><span>▫️</span> ${escapeHtml(act)}</div>`).join('')}
           </div>`
        : '';

      const transcriptHtml = (a.transcript && a.transcript.length > 0)
        ? `<details class="transcript-accordion">
             <summary>대화 녹취록 전체 보기 (${a.transcript.length}개 대화)</summary>
             <div class="transcript-content">
               ${a.transcript.map(t => `<div class="transcript-bubble"><strong>${escapeHtml(t.speaker)}:</strong> ${escapeHtml(t.text)}</div>`).join('')}
             </div>
           </details>`
        : '';

      const driveLink = item.driveAudio?.webViewLink || '#';
      const obsidianUri = item.obsidian?.obsidianUri || '#';

      return `
        <div class="call-item-card">
          <div class="call-item-header">
            <div>
              <h3 class="call-title">${escapeHtml(a.title || item.originalFileName)}</h3>
              <div class="call-meta-bar">
                <span>📅 ${a.callDate || '날짜미상'} ${a.callTime || ''}</span>
                <span>👤 담당/상대: <strong>${escapeHtml(a.managerName || '미확인')}</strong></span>
                <span class="badge badge-sentiment">분위기: ${escapeHtml(a.sentiment || '보통')}</span>
              </div>
            </div>
            <button class="btn btn-sm btn-outline" onclick="deleteHistory('${item.id}')" title="삭제">🗑️</button>
          </div>

          <div style="margin-bottom: 10px;">
            ${keywordsHtml}
          </div>

          <div class="summary-box">
            <strong>💡 요약:</strong> ${escapeHtml(a.summary || item.statusMessage || '분석 진행 중')}
          </div>

          ${actionItemsHtml}
          ${transcriptHtml}

          <div class="call-actions-footer">
            <span style="font-size: 0.8rem; color: var(--text-muted);">
              💾 ${item.obsidian?.fileName ? `옵시디언 노트 생성: <code>${escapeHtml(item.obsidian.fileName)}</code>` : '동기화 완료'}
            </span>
            <div class="links-group">
              <button class="btn btn-sm btn-outline" onclick="copyMarkdown('${item.id}')" title="마크다운 내용 복사">
                📋 마크다운 복사
              </button>
              <a href="${driveLink}" target="_blank" class="btn btn-sm btn-drive">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                구글 드라이브 원본/리포트
              </a>
              <a href="${obsidianUri}" class="btn btn-sm btn-obsidian">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                옵시디언에서 노트 열기
              </a>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 마크다운 복사 핸들러
  window.copyMarkdown = (id) => {
    try {
      const item = currentHistoryItems.find(i => i.id === id);
      if (item && item.obsidian?.markdownContent) {
        navigator.clipboard.writeText(item.obsidian.markdownContent);
        alert('📋 옵시디언 마크다운 내용이 클립보드에 복사되었습니다! 옵시디언에 붙여넣기(Ctrl+V)하세요.');
      } else {
        alert('마크다운 내용을 찾을 수 없습니다.');
      }
    } catch (e) {
      alert('복사 중 오류: ' + e.message);
    }
  };

  window.deleteHistory = async (id) => {
    if (!confirm('이 기록을 목록에서 삭제하시겠습니까?')) return;
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' });
      loadHistory();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  };

  function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
