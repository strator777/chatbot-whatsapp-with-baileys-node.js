// connect socket.io
const socket = io()
const sessionsList = document.getElementById("sessionsList")
const emptyState = document.getElementById("emptyState")

const sessions = {}

function getStatusBadgeClass(status) {
  const statusLower = (status || '').toLowerCase()
  if (statusLower === 'ready' || statusLower === 'loggedin') {
    return 'status-online'
  } else if (statusLower === 'logout' || statusLower === 'notloggedin') {
    return 'status-logout'
  } else {
    return 'status-offline'
  }
}

function getStatusText(status) {
  const statusLower = (status || '').toLowerCase()
  if (statusLower === 'ready' || statusLower === 'loggedin' || statusLower === 'connected') {
    return '🟢 Online'
  } else if (statusLower === 'logout' || statusLower === 'notloggedin') {
    return '🟡 Need Login'
  } else {
    return '🔴 Offline'
  }
}

function config(sessionId) {
  window.location.href = "/config?sessionId=" + sessionId
}

function deleteSession(sessionId) {
  if (!confirm(`Apakah Anda yakin ingin menghapus session "${sessionId}"?`)) {
    return
  }

  fetch(`/api/wa/delete/${sessionId}`, {
    method: 'DELETE'
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }
    return res.json()
  })
  .then(data => {
    if (data.ok || data.success) {
      delete sessions[sessionId]
      renderSessions()
      alert('✓ Session berhasil dihapus')
    } else {
      alert('Gagal menghapus session: ' + (data.error || data.message || 'Unknown error'))
    }
  })
  .catch(err => {
    console.error('Error:', err)
    alert('✗ Error deleting session: ' + err.message)
  })
}

function openAddSessionModal() {
  document.getElementById('addSessionModal').classList.add('active')
  document.getElementById('sessionName').focus()
}

function closeAddSessionModal() {
  document.getElementById('addSessionModal').classList.remove('active')
  document.getElementById('sessionName').value = ''
  document.getElementById('successMessage').style.display = 'none'
  document.getElementById('errorMessage').style.display = 'none'
}

function submitAddSession(event) {
  event.preventDefault()
  const sessionName = document.getElementById('sessionName').value.trim()
  const successMsg = document.getElementById('successMessage')
  const errorMsg = document.getElementById('errorMessage')

  successMsg.style.display = 'none'
  errorMsg.style.display = 'none'

  if (!sessionName) {
    errorMsg.textContent = '⚠ Nama session tidak boleh kosong'
    errorMsg.style.display = 'block'
    return
  }

  fetch('/api/wa/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sessionName }),
    body: JSON.stringify({ sessionName: sessionName })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }
    return res.json()
  })
  .then(data => {
    if (data.ok || data.uid) {
      successMsg.style.display = 'block'
      document.getElementById('sessionName').value = ''
      setTimeout(() => {
        closeAddSessionModal()
        // Reload sessions
        location.reload()
      }, 1500)
    } else {
      errorMsg.textContent = '✗ ' + (data.error || data.message || 'Gagal menambahkan session')
      errorMsg.style.display = 'block'
    }
  })
  .catch(err => {
    console.error('Error:', err)
    errorMsg.textContent = '✗ Error: ' + err.message
    errorMsg.style.display = 'block'
  })
}

function renderSessions() {
  const sessionIds = Object.keys(sessions)
  
  if (sessionIds.length === 0) {
    sessionsList.innerHTML = ''
    emptyState.style.display = 'block'
    return
  }

  emptyState.style.display = 'none'
  sessionsList.innerHTML = sessionIds.map(uid => {
    const s = sessions[uid]
    const statusClass = getStatusBadgeClass(s.status)
    const statusText = getStatusText(s.status)

    return `
      <div class="session-card">
        <div class="session-name">${s.session_name || uid}</div>
        <div class="session-info">
          <div class="info-row">
            <span class="info-label">Phone</span>
            <span class="info-value">${s.phone || '-'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Status</span>
            <span class="status-badge ${statusClass}">${statusText}</span>
          </div>
        </div>
        <div class="session-actions">
          <button class="btn-action" onclick="openManageRulesModal('${uid}')">📋 Rules</button>
          <button class="btn-action" onclick="config('${uid}')">⚙ Config</button>
          <button class="btn-action danger" onclick="deleteSession('${uid}')">🗑 Delete</button>
        </div>
      </div>
    `
  }).join('')
}

// load initial data
fetch("/api/wa/list")
  .then(res => res.json())
  .then(data => {
    data.forEach(row => {
      updateRow({
        uid: row.uid,
        session_name: row.session_name,
        phone: row.phone,
        status: row.status
      })
    })
  })
  .catch(err => {
    console.error('Error loading sessions:', err)
  })

// realtime update
// realtime update (from wa-manager)
socket.on("qr", data => {
  updateRow({ uid: data.uid, status: 'QR', qr: data.qr, session_name: data.sessionName })
})

socket.on("ready", data => {
  updateRow({ uid: data.uid, status: 'CONNECTED', phone: data.phone, session_name: data.sessionName })
})

socket.on("disconnected", data => {
  updateRow({ uid: data.uid, status: data.status, session_name: data.sessionName })
})

function updateRow(data) {
  const key = data.uid || data.sessionId
  sessions[key] = {
    ...sessions[key],
    ...data
  }
  
  renderSessions()
}

// Chatbot Rules Management (per session)
let currentSessionIdForRules = null

function openManageRulesModal(sessionId) {
  currentSessionIdForRules = sessionId
  document.getElementById('sessionIdForRules').value = sessionId
  document.getElementById('ruleId').value = ''
  document.getElementById('triggerWord').value = ''
  document.getElementById('ruleResponse').value = ''
  document.getElementById('actionType').value = 'reply'
  document.getElementById('actionParam').value = ''
  document.getElementById('ruleSubmitBtn').textContent = 'Tambah Rule'
  document.getElementById('actionParamGroup').style.display = 'none'
  document.getElementById('manageRulesModal').classList.add('active')
  loadRulesForSession(sessionId)
  document.getElementById('triggerWord').focus()
}

function closeManageRulesModal() {
  document.getElementById('manageRulesModal').classList.remove('active')
  document.getElementById('ruleId').value = ''
  document.getElementById('triggerWord').value = ''
  document.getElementById('ruleResponse').value = ''
  document.getElementById('actionType').value = 'reply'
  document.getElementById('actionParam').value = ''
  document.getElementById('ruleSubmitBtn').textContent = 'Tambah Rule'
  document.getElementById('rulesSuccessMessage').style.display = 'none'
  document.getElementById('rulesErrorMessage').style.display = 'none'
  document.getElementById('actionParamGroup').style.display = 'none'
  currentSessionIdForRules = null
}

function submitAddRule(event) {
  event.preventDefault()
  const ruleId = document.getElementById('ruleId').value
  const triggerWord = document.getElementById('triggerWord').value.trim()
  const ruleResponse = document.getElementById('ruleResponse').value.trim()
  const successMsg = document.getElementById('rulesSuccessMessage')
  const errorMsg = document.getElementById('rulesErrorMessage')

  successMsg.style.display = 'none'
  errorMsg.style.display = 'none'

  if (!triggerWord || !ruleResponse) {
    errorMsg.textContent = '⚠ Keyword dan balasan harus diisi'
    errorMsg.style.display = 'block'
    return
  }

  if (!currentSessionIdForRules) {
    errorMsg.textContent = '⚠ Session ID tidak ditemukan'
    errorMsg.style.display = 'block'
    return
  }

  const actionType = document.getElementById('actionType').value
  const actionParam = document.getElementById('actionParam').value.trim()

  let url, method
  if (ruleId) {
    url = `/api/chatbot/rules/${ruleId}`
    method = 'PUT'
  } else {
    url = `/api/chatbot/rules/${currentSessionIdForRules}`
    method = 'POST'
  }

  fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      trigger_word: triggerWord, 
      response: ruleResponse,
      action_type: actionType,
      action_param: actionParam || null
    })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }
    return res.json()
  })
  .then(data => {
    if (data.ok) {
      successMsg.style.display = 'block'
      document.getElementById('triggerWord').value = ''
      document.getElementById('ruleResponse').value = ''
      document.getElementById('actionType').value = 'reply'
      document.getElementById('actionParam').value = ''
      document.getElementById('ruleId').value = ''
      document.getElementById('ruleSubmitBtn').textContent = 'Tambah Rule'
      loadRulesForSession(currentSessionIdForRules)
      setTimeout(() => {
        successMsg.style.display = 'none'
      }, 1500)
    } else {
      errorMsg.textContent = '✗ ' + (data.error || 'Gagal menyimpan rule')
      errorMsg.style.display = 'block'
    }
  })
  .catch(err => {
    console.error('Error:', err)
    errorMsg.textContent = '✗ Error: ' + err.message
    errorMsg.style.display = 'block'
  })
}

function editRule(rule) {
  document.getElementById('ruleId').value = rule.id
  document.getElementById('triggerWord').value = rule.trigger_word
  document.getElementById('ruleResponse').value = rule.response
  document.getElementById('actionType').value = rule.action_type || 'reply'
  document.getElementById('actionParam').value = rule.action_param || ''
  document.getElementById('ruleSubmitBtn').textContent = 'Update Rule'
  onActionTypeChange()
  document.getElementById('triggerWord').focus()
}

function onActionTypeChange() {
  const actionType = document.getElementById('actionType').value
  const actionParamGroup = document.getElementById('actionParamGroup')
  const actionParamInput = document.getElementById('actionParam')
  
  if (actionType === 'webhook' || actionType === 'function') {
    actionParamGroup.style.display = 'block'
    if (actionType === 'function') {
      actionParamInput.placeholder = "Masukkan nama function";
    }else{
      actionParamInput.placeholder = "Masukkan URL webhook";
    }
  } else {
    actionParamGroup.style.display = 'none'
  }
}

function deleteRule(ruleId) {
  if (!confirm('Apakah Anda yakin ingin menghapus rule ini?')) {
    return
  }

  fetch(`/api/chatbot/rules/${ruleId}`, {
    method: 'DELETE'
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }
    return res.json()
  })
  .then(data => {
    if (data.ok) {
      if (currentSessionIdForRules) {
        loadRulesForSession(currentSessionIdForRules)
      }
    } else {
      alert('Gagal menghapus rule: ' + (data.error || 'Unknown error'))
    }
  })
  .catch(err => {
    console.error('Error:', err)
    alert('✗ Error deleting rule: ' + err.message)
  })
}

function renderRulesTable(rules) {
  if (rules.length === 0) {
    return '<div class="empty-rules">Belum ada rules. Tambahkan rule baru di atas!</div>'
  }

  const tableHTML = `
    <table class="rules-table">
      <thead>
        <tr>
          <th>Pesan Diterima</th>
          <th>Balasan</th>
          <th>Aksi</th>
        </tr>
      </thead>
      <tbody>
        ${rules.map(rule => `
          <tr>
            <td>${rule.trigger_word}</td>
            <td>${rule.response}</td>
            <td>
              <div class="action-buttons">
                <button class="btn-edit" onclick="editRule(${JSON.stringify(rule).replace(/"/g, '&quot;')})">Edit</button>
                <button class="btn-delete" onclick="deleteRule(${rule.id})">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
  return tableHTML
}

function loadRulesForSession(sessionId) {
  fetch(`/api/chatbot/rules/${sessionId}`)
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data)) {
        document.getElementById('rulesList').innerHTML = renderRulesTable(data)
      } else {
        document.getElementById('rulesList').innerHTML = '<div class="empty-rules">Error loading rules</div>'
      }
    })
    .catch(err => {
      console.error('Error loading rules:', err)
      document.getElementById('rulesList').innerHTML = '<div class="empty-rules">Error loading rules</div>'
    })
}

// Close modal when clicking outside
window.addEventListener('click', (event) => {
  const addSessionModal = document.getElementById('addSessionModal')
  const manageRulesModal = document.getElementById('manageRulesModal')
  if (event.target === addSessionModal) {
    closeAddSessionModal()
  }
  if (event.target === manageRulesModal) {
    closeManageRulesModal()
  }
})

// ==============================
// END OF FILE
// ==============================